// Turns: queued, run one at a time per conversation, streamed into the store
// as they happen, and ended one way or another — never left running with
// nobody watching.
//
// The runner knows nothing about any particular CLI. A provider says how to
// start one and how to read a line of what it prints; the runner owns
// everything else: the queue, the process, the token that lets the process's
// MCP bridge call back in, cancellation, stalls, and what the store says
// afterwards.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import { collectSlices, shaOf } from '../engine.js';
import { effectiveCapability } from './capability.js';
import { pickEnv } from './env.js';
import { MAX_HOP, MAX_SENDS, clampSeconds, pickTarget, renderMessages, validateText } from './messages.js';
import { MESSAGING_INSTRUCTIONS } from './instructions.js';

const SELECTION_BUDGET = 6_000;
const STDERR_TAIL = 4_000;
// How long closing the host waits for its running turns to write their end.
const CLOSE_GRACE_MS = 5_000;
const STEER_NOTE = 'While you were working I added this note. Treat it as course-correction.';
const DISPATCH = new Set(['queue', 'steer', 'interrupt']);

export function createRunner({ store, tools, providers, workdir, origin, bridgePath, browserPath, readDocument, publish, limits, log = console, skills = [], driveRoot, projects = null, power = '', sandbox = null, onLook = null, onFinish = null }) {
  const live = new Map(); // turnId → live turn
  const order = []; // turnIds, in the order they were sent
  const tokens = new Map(); // token → live turn
  let closed = false;

  const runningTurns = () => [...live.values()].filter((t) => t.status === 'running');

  const ownsPath = (turn, docPath) =>
    turn.target === docPath
    || turn.writable.has(docPath)
    || turn.touched.has(docPath)
    || turn.origins.has(docPath);
  function liveFor(conversationId) {
    return [...live.values()].filter((t) => t.conversationId === conversationId);
  }
  function queuedFor(conversationId) {
    return order.map((id) => live.get(id)).filter((t) => t && t.conversationId === conversationId && t.status === 'queued');
  }
  function batchDispatch(turns) {
    if (turns.some((t) => t.dispatch === 'interrupt')) return 'interrupt';
    if (turns.some((t) => t.dispatch === 'steer')) return 'steer';
    return 'queue';
  }

  // Every publish for a conversation — a stored event's, or a raw delta's —
  // goes through this one chain, in the order it was called, the same way
  // the store itself serializes appends. Without it, a delta (published the
  // instant it arrives) can race ahead of the text event that logically
  // came first but is still waiting on its own disk write.
  const publishChains = new Map();
  function chained(conversationId, task) {
    const next = (publishChains.get(conversationId) ?? Promise.resolve()).then(task, task);
    publishChains.set(conversationId, next.catch(() => {}));
    return next;
  }

  // messageId → { hop, from, to } for every message this host has sent. The
  // hop cap reads the parent from here; a parent minted before a restart is
  // unknown and starts a fresh thread, which is the lenient side to err on.
  const threads = new Map();

  /** Take this conversation's inbox *for a turn that can act on it*, or hand
   *  it straight back.
   *
   *  Three takers share one inbox — a turn starting (composePrompt), a parked
   *  wait, and a delivery turn — and the rule they all serve is that a message
   *  is delivered exactly once and never lost. A turn that is already
   *  `finishing` cannot act on anything: its process is going away, so a batch
   *  handed to it becomes a tool result nobody reads and an inbox that reads
   *  empty to finish()'s own check. So: take, and if this turn is finishing by
   *  then (or writing the `message` events fails), put the batch back in order
   *  and report nothing. finish() then queues a delivery turn for it.
   *
   *  What a turn did receive is remembered on it (`turn.inbound`): that is the
   *  thread a reply belongs to when the agent forgets `inReplyTo`. */
  async function takeFor(turn, delivered) {
    const messages = await store.takeInbox(turn.conversationId);
    if (!messages.length) return [];
    const handBack = async () => {
      for (const m of messages) await store.appendInbox(turn.conversationId, m);
      return [];
    };
    if (turn.finishing) return handBack();
    try {
      for (const m of messages) {
        await emit(turn, { type: 'message', messageId: m.id, from: m.from, fromTitle: (await store.conversation(m.from))?.title ?? null, text: m.text, about: m.about, delivered });
      }
    } catch (err) {
      log.error(`[agents] ${err.message}`);
      return handBack();
    }
    turn.inbound = [...(turn.inbound ?? []), ...messages];
    return messages;
  }

  async function recordSent(turn, message, receiver, delivered) {
    if (!turn.id) return; // a synthetic turn in a test has no transcript to write
    await emit(turn, {
      type: 'message.sent',
      messageId: message.id,
      to: message.to,
      toTitle: receiver.title,
      text: message.text,
      about: message.about,
      inReplyTo: message.inReplyTo,
      delivered,
    });
  }

  async function emit(turn, event) {
    return chained(turn.conversationId, async () => {
      const stored = await store.appendEvent(turn.conversationId, { turn: turn.id, ...event });
      const meta = await store.conversation(turn.conversationId);
      publish(turn.conversationId, stored, meta ? await store.summary(turn.conversationId) : null);
      return stored;
    });
  }

  /** finish(), wherever it's called from, never throws — a store error at the
   *  end of a turn is logged, not left for whatever fire-and-forget caller
   *  (the child's `close` handler, mainly) to crash on. */
  function safeFinish(turn, outcome) {
    return finish(turn, outcome).catch((err) => log.error(`[agents] ${err.message}`));
  }

  /** The project a conversation works in, resolved now rather than at
   *  creation: a project removed or moved later fails the next turn with a
   *  plain reason instead of running somewhere else. */
  async function resolveProject(meta) {
    const id = meta.project || 'drive';
    const project = projects ? await projects.find(id) : { id: 'drive', name: 'Drive', path: driveRoot, builtIn: true };
    if (!project) throw new Error(`project "${id}" is not registered — pick another project for this conversation`);
    // A host without a drive root (a bare runner in a test) has nothing to check.
    if (project.path) {
      try {
        if (!(await fsp.stat(project.path)).isDirectory()) throw new Error('not a directory');
      } catch {
        throw new Error(`the project directory ${project.path} is missing`);
      }
    }
    return project;
  }

  async function composePrompt(turn, meta, project) {
    const context = turn.context;
    const kind = project.id === 'drive' ? 'drive' : 'project';
    let body = Array.isArray(turn.bundle)
      ? turn.bundle.map((text, i) => `${i + 1}. ${text}`).join('\n')
      : turn.prompt;
    if (turn.dispatch === 'steer' && turn.behind) {
      body = `${STEER_NOTE}\n\n${body}`;
    }
    const lines = [body, '', '---'];
    if (kind === 'drive') {
      lines.push(
        'Context from Marble Drive:',
        `- The person is viewing: ${context.viewing ?? context.target}`,
        `- The document you may edit: ${context.target}`,
      );
      if (context.also?.length) lines.push(`- Also in view: ${context.also.join(', ')}`);
    } else {
      // A project agent may edit anything in its project; the document is
      // where the person was, not a constraint.
      const viewing = context.viewing ?? context.target;
      lines.push(
        `Sent from Marble Drive. The person was viewing the document "${viewing}" (on disk at ${path.join(driveRoot ?? '', `${viewing}.mrbl`)}) when they sent this. Marble's document tools can read and edit it; use them only if the request is about that document.`,
      );
    }
    if (context.selectionSource) lines.push('- They selected these elements:', '', context.selectionSource);
    const others = runningTurns().filter((t) => t.id !== turn.id && t.project?.id === project.id).length;
    if (others) {
      lines.push('', `${others} other agent conversation(s) are running in this project right now. Do not stash, reset, check out or discard changes you did not make.`);
    }
    // Messages that arrived while this conversation was busy or asleep ride in
    // on whatever turn starts next, so no message waits for a person. Kept on
    // the turn too: if this turn never gets to act on them — cancelled before
    // its process spawns, the host closing, `start()` throwing below — finish()
    // hands them back to the inbox rather than losing them.
    const arrived = await takeFor(turn, 'inbox');
    turn.arrived = arrived;
    if (arrived.length) {
      lines.push('', 'Messages that arrived while you were away:', '', renderMessages(arrived, await titlesOf(arrived.map((m) => m.from))));
    }
    if (await hasPeers(turn.conversationId, project.id)) lines.push('', MESSAGING_INSTRUCTIONS);
    if (meta.handoffFrom && turn.n === 1) {
      const brief = await handoffBrief(meta.handoffFrom);
      if (brief) lines.unshift(`This continues an earlier conversation. What happened there:\n\n${brief}\n\n---\n`);
    }
    return lines.join('\n');
  }

  async function handoffBrief(fromId) {
    const events = (await store.events(fromId)).filter((e) =>
      ['user', 'text', 'ops.applied'].includes(e.type),
    );
    const lines = events.slice(-12).map((e) =>
      e.type === 'user' ? `Person: ${e.text}` : e.type === 'text' ? `Agent: ${e.text}` : `(edited ${e.count} element(s) in ${e.path})`,
    );
    return lines.join('\n').slice(-8_000);
  }

  async function titlesOf(ids) {
    const titles = new Map();
    for (const id of new Set(ids)) {
      const meta = await store.conversation(id);
      if (meta) titles.set(id, { title: meta.title, provider: meta.provider });
    }
    return titles;
  }

  async function projectPeers(conversationId, projectId) {
    const all = await store.conversations({ archived: false });
    return all.filter((c) => c.id !== conversationId && (c.project ?? 'drive') === projectId);
  }

  const hasPeers = async (conversationId, projectId) => (await projectPeers(conversationId, projectId)).length > 0;

  async function send(conversationId, { prompt, context, dispatch, from = null }) {
    const meta = await store.conversation(conversationId);
    if (!meta) throw Object.assign(new Error(`no conversation "${conversationId}"`), { status: 404 });
    if (!context?.target) throw Object.assign(new Error('a turn needs context.target'), { status: 400 });
    dispatch = DISPATCH.has(dispatch) ? dispatch : 'queue';
    const behind = liveFor(conversationId).some((t) => t.status === 'queued' || t.status === 'running');

    const frozen = { viewing: context.viewing ?? null, target: context.target, selection: context.selection ?? [] };
    const also = [...new Set((Array.isArray(context.also) ? context.also : []).map((item) => String(item).trim()).filter(Boolean))]
      .filter((doc) => doc !== frozen.target && doc !== frozen.viewing);
    if (also.length) frozen.also = also;
    if (frozen.selection.length) {
      const source = await readDocument(frozen.target).catch(() => null);
      if (source) {
        frozen.selectionSource = collectSlices(source, frozen.selection, { budget: SELECTION_BUDGET })
          .map((s) => s.html)
          .join('\n\n');
      }
    }

    const record = await store.createTurn(conversationId, { prompt: String(prompt ?? ''), context: frozen, dispatch, behind });
    let ended;
    const turn = {
      id: record.id,
      n: record.n,
      conversationId,
      prompt: record.prompt,
      dispatch: record.dispatch,
      behind: record.behind,
      bundle: record.bundle,
      context: frozen,
      target: frozen.target,
      writable: new Set([frozen.target]),
      undo: [],
      status: 'queued',
      token: null,
      child: null,
      cancelled: null,
      provider: null,
      project: null, // resolved at start; the cwd of a full turn
      asks: new Map(), // requestId → { closed }: prompts the process is waiting on
      holdStall: null,
      resumeStall: null,
      resume: null, // the provider session this turn was started to resume
      done: null,
      usage: null,
      applied: 0,
      watchdog: false,
      // docPath → the restore point taken before this turn first changed it.
      // First write wins: undo wants where the document started, not its last step.
      touched: new Map(),
      // path → sha of the document as this turn found it. A later file write's
      // `prior` is post-ops if the turn already filed ops, which is the wrong
      // restore; undo wants this instead.
      origins: new Map(),
      stderr: '',
      timers: [],
      inflight: new Set(), // tool-call promises the bridge is still waiting on
      sent: 0, // messages this turn has sent; capped
      waiter: null, // resolve() of a wait_for_reply parked on this turn
      from, // { conversation, title, provider, messageId, hop } when a message started this turn
      arrived: null, // messages composePrompt() took from the inbox; handed back in finish() if this turn never got to act on them
      inbound: null, // every message this turn has actually received, in order; a reply without `inReplyTo` threads off the last one from that conversation
      finishing: false, // true once finish() has started; new tool calls are refused
      ended: new Promise((resolve) => { ended = resolve; }), // settles once the turn has left the runner
      endTurn: () => ended(),
      // Undo records are written as each batch applies, in the order they
      // applied, not only when the turn ends: a crash, or a host closing
      // under it, would otherwise leave applied ops nobody can take back.
      undoSaved: Promise.resolve(),
      onEvent: (event) => {
        if (event.type === 'ops.applied') turn.applied += event.count;
        if (event.type === 'ops.applied' || event.type === 'document.changed') {
          // Written as each batch or write lands, in order, not only when the
          // turn ends: a crash would otherwise leave changes nobody can take
          // back. `restores` is where the document started, so undo of a
          // document written both ways is one restore, not a restore and a
          // replay.
          const record = {
            steps: [...turn.undo],
            restores: [...turn.touched].map(([docPath, sha]) => ({ path: docPath, sha })),
          };
          turn.undoSaved = turn.undoSaved
            .then(() => store.saveUndo(turn.id, record))
            .catch((err) => log.error(`[agents] ${err.message}`));
        }
        emit(turn, event).catch((err) => log.error(`[agents] ${err.message}`));
      },
    };

    const originSource = await readDocument(frozen.target).catch(() => null);
    if (originSource != null) turn.origins.set(frozen.target, shaOf(originSource));

    // Only listed once its `user`/`turn.queued` events are actually stored —
    // otherwise a pump() running concurrently (another turn on the same
    // conversation finishing right now) could start this one and store
    // `turn.started` before the events that are supposed to precede it.
    await emit(turn, {
      type: 'user',
      text: turn.prompt,
      context: { viewing: frozen.viewing, target: frozen.target, selection: frozen.selection, also: frozen.also ?? [] },
      ...(from ? { from } : {}),
    });
    await emit(turn, { type: 'turn.queued', dispatch: turn.dispatch });
    live.set(turn.id, turn);
    order.push(turn.id);
    const effective = meta.queueCombine ? batchDispatch(queuedFor(conversationId)) : turn.dispatch;
    if (effective === 'interrupt') {
      const running = liveFor(conversationId).find((t) => t.status === 'running' && t.id !== turn.id);
      if (running) await cancel(running.id);
    }
    await pump();
    return { turnId: turn.id, status: turn.status };
  }

  /** Start a turn on an idle conversation carrying the messages in its inbox.
   *  Returns the send result, or null when the conversation is gone, has no
   *  document to work in, or another caller already claimed the inbox (two
   *  `startDelivery`s can race for the same idle conversation — finish()'s
   *  fire-and-forget check and a concurrent `deliver` — and only the one that
   *  actually takes messages may start a turn; the other must not fall back
   *  to the `messages` it was handed, or that batch is delivered twice). */
  async function startDelivery(conversationId, messages, fallbackTarget = null) {
    const meta = await store.conversation(conversationId);
    if (!meta) return null;
    const taken = await store.takeInbox(conversationId);
    if (!taken.length) return null; // someone else already took these
    // Everything about this turn is read from what was actually taken, not
    // from the `messages` the caller happened to hold: the batch may be
    // longer (another message landed first) or simply a different one.
    const handBack = async () => {
      for (const m of taken) await store.appendInbox(conversationId, m);
      return null;
    };
    const first = taken[0];
    const target = pickTarget({ receiver: meta, about: first.about, senderTarget: fallbackTarget });
    if (!target) {
      log.error(`[agents] a message for ${conversationId} has no document to start a turn in; left in its inbox`);
      return handBack();
    }
    const sender = await store.conversation(first.from);
    // A conversation that exists only because someone wrote to it has no name
    // yet. Say where it came from, so the board is not a row of blank titles.
    if (!meta.title) {
      await store.updateConversation(conversationId, { title: `Message from ${sender?.title || first.from}` });
    }
    try {
      return await send(conversationId, {
        prompt: renderMessages(taken, await titlesOf(taken.map((m) => m.from))),
        context: { target },
        // `messageId` and `hop` are the thread this turn is an answer to: a
        // reply that forgets `inReplyTo` still counts against the hop cap.
        from: {
          conversation: first.from,
          title: sender?.title ?? null,
          provider: sender?.provider ?? null,
          messageId: first.id,
          hop: first.hop ?? 0,
        },
      });
    } catch (err) {
      // The batch is out of the inbox and no turn will carry it. Put it back
      // before the throw reaches whoever asked for the delivery.
      await handBack();
      throw err;
    }
  }

  async function pump() {
    if (closed) return;
    for (const turnId of [...order]) {
      if (runningTurns().length >= limits.maxRunning) return;
      const turn = live.get(turnId);
      if (!turn || turn.status !== 'queued') continue;
      if (runningTurns().some((t) => t.conversationId === turn.conversationId)) continue;
      await start(turn);
    }
  }

  function look(turn, extra = {}) {
    if (!onLook || !turn?.target) return;
    const ids = Object.hasOwn(extra, 'ids')
      ? extra.ids
      : (Array.isArray(turn.context?.selection) ? turn.context.selection.map(String) : []);
    const meta = {};
    if (extra.phase) meta.phase = extra.phase;
    if (extra.note) meta.note = extra.note;
    try {
      onLook(turn.target, ids, `agent:${turn.conversationId}`, Object.keys(meta).length ? meta : undefined);
    } catch (err) {
      log.error(`[agents] ${err.message}`);
    }
  }

  async function mergeQueued(conversationId) {
    if (!(await store.conversation(conversationId)).queueCombine) return;
    const waiting = queuedFor(conversationId);
    if (waiting.length < 2) return;
    const survivor = waiting[0];
    survivor.bundle = waiting.map((t) => t.prompt);
    survivor.dispatch = batchDispatch(waiting);
    await store.updateTurn(survivor.id, { bundle: survivor.bundle, dispatch: survivor.dispatch });
    for (const extra of waiting.slice(1)) {
      live.delete(extra.id);
      const idx = order.indexOf(extra.id);
      if (idx !== -1) order.splice(idx, 1);
      await emit(extra, { type: 'turn.combined' });
      await store.updateTurn(extra.id, { status: 'combined', finishedAt: Date.now() });
    }
  }

  async function start(turn) {
    await mergeQueued(turn.conversationId);
    if (!live.has(turn.id) || turn.status !== 'queued') return;
    turn.status = 'running';
    // The moment the turn's base is taken: a person's edits before it are
    // history the turn reads; edits after it are concurrent with its writes.
    turn.startedAt = Date.now();
    try {
      const meta = await store.conversation(turn.conversationId);
      const provider = providers.get(meta.provider);
      await store.updateTurn(turn.id, { status: 'running', startedAt: turn.startedAt });
      await store.updateConversation(turn.conversationId, {
        running: true,
        activity: turn.from ? `Message from ${turn.from.title || turn.from.conversation}` : `Working on ${turn.target}`,
      });
      await emit(turn, { type: 'turn.started', provider: meta.provider });
      look(turn, { phase: 'working' });

      if (!provider) return safeFinish(turn, { status: 'failed', error: `no provider "${meta.provider}"` });
      turn.provider = provider;
      turn.resume = meta.providerSession ?? null;

      turn.token = crypto.randomBytes(32).toString('hex');
      tokens.set(turn.token, turn);
      const workspace = path.join(workdir, turn.conversationId);
      await fsp.mkdir(workspace, { recursive: true });
      const capability = effectiveCapability(provider, { power });
      turn.capability = capability;
      const project = await resolveProject(meta);
      turn.project = project;
      const kind = project.id === 'drive' ? 'drive' : 'project';
      const mcp = {
        command: process.execPath,
        args: [bridgePath],
        env: { MARBLE_DRIVE_URL: origin(), MARBLE_AGENT_TOKEN: turn.token },
      };
      const profile = path.join(workspace, 'browser-profile');
      const browser = capability === 'full' && browserPath
        ? {
            command: process.execPath,
            args: [browserPath],
            env: { MARBLE_BROWSER_PROFILE: profile },
          }
        : null;
      if (browser) await fsp.rm(profile, { recursive: true, force: true });
      await provider.prepare?.({ workspace, mcp, browser, meta, skills, capability, kind, project });
      const prompt = await composePrompt(turn, meta, project);

      // Cancel (or a host shutdown) can land anywhere in the awaits above,
      // before there is any child to kill. Check here, the last point before
      // a process would actually start, rather than leave it running unwanted.
      if (turn.cancelled) return safeFinish(turn, turn.cancelled);
      if (closed) return safeFinish(turn, { status: 'cancelled', error: 'host closing' });

      const base = { ...pickEnv(process.env), ...mcp.env };
      const spec = provider.spawn({
        workspace,
        mcp,
        prompt,
        resume: meta.providerSession,
        model: meta.model,
        effort: meta.effort,
        mode: meta.mode,
        env: base,
        capability,
        kind,
        project,
        cwd: capability === 'full' ? project.path : null,
      });

      // The runner builds the environment, not the provider: a provider that
      // returns none gets the allowlist rather than Node's default of
      // everything this host has, and the drive's secret never goes, whoever
      // asks for it.
      const env = { ...base, ...(spec.env ?? {}) };
      delete env.MARBLE_DRIVE_SECRET;

      // A full agent's own tools are confined to its working directory, so the
      // working directory is the boundary: the drive for a full turn, the empty
      // workspace for every other. The seam below is where an OS sandbox goes
      // when one is written (spec §10.1); until then it is null and this is a
      // plain spawn.
      const cwd = spec.cwd ?? workspace;
      const launch = sandbox ? sandbox({ command: spec.command, args: spec.args, cwd }) : spec;
      const child = spawn(launch.command, launch.args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      turn.child = child;
      child.stdin.on('error', () => {});
      // A provider that answers prompts mid-turn keeps stdin open; finish()
      // closes it. Every other CLI reads to EOF before it starts.
      turn.stdinOpen = Boolean(spec.stdinOpen);
      if (spec.stdinOpen) child.stdin.write(spec.stdin ?? '');
      else child.stdin.end(spec.stdin ?? '');

      const state = {};
      let stall;
      const openAsks = () => [...turn.asks.values()].filter((a) => !a.closed).length;
      const resetStall = () => {
        clearTimeout(stall);
        if (openAsks()) return; // waiting on the person is not a stall
        stall = setTimeout(() => stop(turn, { status: 'failed', error: `stalled — no output for ${Math.round(limits.stallMs / 1000)} s` }), limits.stallMs);
        stall.unref?.();
      };
      turn.holdStall = () => clearTimeout(stall);
      turn.resumeStall = resetStall;
      resetStall();
      turn.timers.push(() => clearTimeout(stall));
      // A cap is opt-in. A person stops a turn; a timer does not.
      if (limits.maxMs > 0) {
        const cap = setTimeout(() => stop(turn, { status: 'cancelled', error: `took longer than ${Math.round(limits.maxMs / 60000)} min` }), limits.maxMs);
        cap.unref?.();
        turn.timers.push(() => clearTimeout(cap));
      }

      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        if (!line.trim()) return;
        resetStall();
        store.appendRaw(turn.id, line).catch(() => {});
        let events = [];
        try {
          events = provider.parse(line, state);
        } catch {
          return;
        }
        for (const event of events) handle(turn, event);
      });
      child.stderr.on('data', (chunk) => {
        turn.stderr = (turn.stderr + chunk).slice(-STDERR_TAIL);
      });
      child.on('error', (err) => {
        turn.stderr = err.message;
      });
      child.on('close', (code) => {
        const ok = code === 0 && turn.done?.ok !== false;
        safeFinish(turn, turn.cancelled ?? {
          status: ok ? 'completed' : 'failed',
          error: ok ? null : turn.done?.error ?? (turn.stderr.trim() || `exited with ${code}`),
        });
      });
    } catch (err) {
      return safeFinish(turn, { status: 'failed', error: err.message });
    }
  }

  /** The CLI's own list of skills, kept per provider so the composer's `/`
   *  menu shows what the terminal would. Descriptions come from the
   *  initialize reply; names alone from init keep an older description. */
  function recordCatalog(turn, event) {
    const provider = turn.provider?.id;
    if (!provider || !Array.isArray(event.skills) || !event.skills.length) return;
    store.settings().then((settings) => {
      const old = new Map((settings.skills?.[provider] ?? []).map((s) => [s.id, s]));
      const next = event.skills.map((s) => ({ id: s.id, name: s.name ?? s.id, description: s.description || old.get(s.id)?.description || '' }));
      return store.saveSettings({ skills: { ...(settings.skills ?? {}), [provider]: next } });
    }).catch((err) => log.error(`[agents] ${err.message}`));
  }

  function handle(turn, event) {
    switch (event.type) {
      case 'session':
        store.updateConversation(turn.conversationId, { providerSession: event.id }).catch(() => {});
        return;
      case 'catalog':
        recordCatalog(turn, event);
        return;
      case 'ask': {
        const kind = event.tool === 'AskUserQuestion' ? 'question' : 'permission';
        turn.asks.set(event.requestId, { closed: false });
        turn.holdStall?.();
        chained(turn.conversationId, () => store.updateConversation(turn.conversationId, { asking: true }))
          .then(() => emit(turn, { ...event, kind }))
          .catch((err) => log.error(`[agents] ${err.message}`));
        return;
      }
      case 'text.delta':
        chained(turn.conversationId, () => {
          publish(turn.conversationId, { turn: turn.id, ...event });
        });
        return;
      case 'text':
      case 'tool.call':
      case 'tool.result':
        turn.onEvent(event);
        return;
      case 'usage':
        turn.usage = { ...event };
        delete turn.usage.type;
        return;
      case 'done':
        turn.done = event;
        // A CLI reading stream-json waits for the next message after its
        // result, so the turn is over only once we close its stdin. If it
        // still lingers, it is stopped rather than left counted as running.
        if (turn.stdinOpen) {
          try {
            turn.child?.stdin?.end();
          } catch {
            // Already gone.
          }
          const linger = setTimeout(() => turn.child?.kill('SIGTERM'), limits.killGraceMs * 3);
          linger.unref?.();
          turn.timers.push(() => clearTimeout(linger));
        }
        return;
      default:
    }
  }

  const writeControl = (turn, requestId, response) => {
    try {
      turn.child?.stdin?.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })}\n`);
    } catch {
      // The process is gone; finish() voids the ask.
    }
  };

  /** Close every open ask: deny it to the process (if asked to) and void it in the log. */
  async function voidAsks(turn, why, { deny = false } = {}) {
    for (const [requestId, ask] of turn.asks) {
      if (ask.closed) continue;
      ask.closed = true;
      if (deny) writeControl(turn, requestId, { behavior: 'deny', message: `Turn ${why} from Marble` });
      await emit(turn, { type: 'ask.void', requestId, why });
    }
  }

  /** Ask a running process to stop, and make sure it does — or, if it hasn't
   *  spawned yet, just record the outcome: `start` checks it before spawning
   *  and finishes the turn instead of launching a process nobody wants. */
  function stop(turn, outcome) {
    if (turn.cancelled) return;
    turn.cancelled = outcome;
    if (!turn.child) return;
    voidAsks(turn, 'cancelled', { deny: true }).catch((err) => log.error(`[agents] ${err.message}`));
    turn.child.kill('SIGTERM');
    const kill = setTimeout(() => turn.child.kill('SIGKILL'), limits.killGraceMs);
    kill.unref?.();
    turn.timers.push(() => clearTimeout(kill));
  }

  async function finish(turn, { status, error = null }) {
    // `finishing` — not `status` — is the once-only guard: the turn stays
    // `status: 'running'`, and so stays counted by runningTurns(), for this
    // entire function. Flip status away from 'running' any earlier and
    // pump() reads the conversation's slot (or a maxRunning slot) as free
    // while this turn is still draining an in-flight tool call or writing
    // its own outcome — letting the next turn start, run, and finish first,
    // so that when this turn's finish() finally gets to its own
    // store.updateConversation, that (by-then-stale) write lands last and
    // clobbers the next turn's fresher one.
    if (turn.finishing) return;
    turn.finishing = true;
    look(turn, { ids: [] });
    for (const clear of turn.timers) clear();
    turn.waiter?.(); // a wait parked on this turn returns now; the tool call is in `inflight` and drains below
    await voidAsks(turn, 'ended').catch((err) => log.error(`[agents] ${err.message}`));
    try {
      turn.child?.stdin?.end();
    } catch {
      // Already gone.
    }
    if (turn.inflight.size) await Promise.allSettled([...turn.inflight]);

    // Compute everything up front: the stored turn, the conversation, and
    // the closing event all carry the same values.
    const finishedAt = Date.now();
    const outcome = turn.watchdog
      ? 'watchdog'
      : status === 'completed'
        ? turn.applied ? 'changes' : 'done'
        : status;
    const applied = turn.applied;
    // A CLI that has deleted the session this turn resumed will refuse every
    // later resume the same way. Forget it, so the next message starts fresh
    // instead of failing again; retrying this one is the person's call.
    let lostSession = false;
    if (status === 'failed' && turn.resume && error) {
      try {
        lostSession = Boolean(turn.provider?.lostSession?.(error));
      } catch (err) {
        log.error(`[agents] ${err.message}`);
      }
    }
    if (lostSession) {
      error = `${error} — the provider no longer has this conversation's session; the next message starts a new one`;
    }
    try {
      try {
        await turn.undoSaved;
        if (turn.undo.length || turn.touched.size) {
          await store.saveUndo(turn.id, {
            steps: [...turn.undo],
            restores: [...turn.touched].map(([docPath, sha]) => ({ path: docPath, sha })),
          });
        }
        await store.updateConversation(turn.conversationId, {
          ...(lostSession ? { providerSession: null } : {}),
          running: false,
          asking: false,
          activity: status === 'completed' ? (applied ? `Changed ${applied} element(s)` : 'Answered') : error ?? status,
          lastOutcome: outcome,
          lastFinishedAt: finishedAt,
        });
        await emit(turn, { type: `turn.${status}`, applied, ...(error ? { error } : {}) });
      } finally {
        // The terminal status is the LAST store write. Anyone polling the
        // turn (tests, GET /agent/conversations/:id, the UI) treats a
        // terminal status as "done — read the rest now", so the undo record,
        // the conversation's outcome, and the closing event must already be
        // there when it appears. It is still written if one of those failed,
        // so the stored turn is not left reading `running` forever.
        await store.updateTurn(turn.id, { status, finishedAt, error, applied, usage: turn.usage });
      }
    } finally {
      // Whatever happened above — success, or one of those store writes
      // throwing — the turn must actually leave the runner. Skip this and a
      // failed write stores nothing but the in-memory turn stays forever
      // `status: 'running'`, permanently holding its conversation's slot
      // and a maxRunning slot hostage, with nothing left to sweep it.
      turn.status = status;
      if (turn.token) tokens.delete(turn.token);
      live.delete(turn.id);
      // The writer is done: whatever the host remembers it touching is no
      // longer being worked on. Told after the turn has left the runner, so
      // the host cannot see a still-running turn with nothing to its name.
      try {
        onFinish?.(turn.conversationId);
      } catch (err) {
        log.error(`[agents] ${err.message}`);
      }
      const idx = order.indexOf(turn.id);
      if (idx !== -1) order.splice(idx, 1);
      // This turn took the inbox in composePrompt() but never got to act on
      // it — cancelled before its process spawned, the host closing, `start()`
      // throwing before spawn. Hand the messages back rather than lose them;
      // the check just below then queues a delivery turn for them (or, when
      // `closed`, the next boot recovers them).
      if (!turn.child && turn.arrived?.length) {
        for (const m of turn.arrived) await store.appendInbox(turn.conversationId, m);
        turn.arrived = null;
      }
      // Anything that arrived for this conversation while it was running and
      // was not taken by a wait rides in on a delivery turn. At most one: the
      // next turn to start takes the whole inbox. A turn already queued here
      // is that next turn — starting a delivery turn as well would race it
      // for the inbox and leave the conversation with one turn too many.
      if (!closed && !liveFor(turn.conversationId).length) {
        store.inbox(turn.conversationId)
          .then((pending) => (pending.length ? startDelivery(turn.conversationId, pending, turn.target) : null))
          .catch((err) => log.error(`[agents] ${err.message}`));
      }
      turn.endTurn();
      await pump().catch((err) => log.error(`[agents] ${err.message}`));
    }
  }

  async function dequeue(turnId) {
    const turn = live.get(turnId);
    if (!turn || turn.status !== 'queued') return false;
    live.delete(turnId);
    const idx = order.indexOf(turnId);
    if (idx !== -1) order.splice(idx, 1);
    // Same rule as finish(): the terminal status is written last.
    await emit(turn, { type: 'turn.removed' });
    await store.updateTurn(turnId, { status: 'removed', finishedAt: Date.now() });
    // The removed turn was the one that would have carried this
    // conversation's inbox in at start. If nothing live is left to do it, a
    // delivery turn does — the same fire-and-forget check finish() makes.
    if (!closed && !liveFor(turn.conversationId).length) {
      store.inbox(turn.conversationId)
        .then((pending) => (pending.length ? startDelivery(turn.conversationId, pending, turn.target) : null))
        .catch((err) => log.error(`[agents] ${err.message}`));
    }
    return true;
  }

  async function cancel(turnId) {
    const turn = live.get(turnId);
    if (!turn || turn.finishing) return false;
    if (turn.status === 'queued') return dequeue(turnId);
    stop(turn, { status: 'cancelled', error: null });
    return true;
  }

  async function patchQueued(turnId, { prompt, dispatch } = {}) {
    const turn = live.get(turnId);
    if (!turn || turn.status !== 'queued') {
      throw Object.assign(new Error('turn is not queued'), { status: 409 });
    }
    if (prompt !== undefined) {
      const next = String(prompt).trim();
      if (!next) throw Object.assign(new Error('prompt is empty'), { status: 400 });
      turn.prompt = next;
      await store.updateTurn(turnId, { prompt: next });
      await emit(turn, { type: 'user.edited', text: next });
    }
    if (dispatch !== undefined) {
      if (!DISPATCH.has(dispatch)) throw Object.assign(new Error('bad dispatch'), { status: 400 });
      turn.dispatch = dispatch;
      await store.updateTurn(turnId, { dispatch });
      await emit(turn, { type: 'turn.dispatch', dispatch });
      const meta = await store.conversation(turn.conversationId);
      const effective = meta.queueCombine ? batchDispatch(queuedFor(turn.conversationId)) : turn.dispatch;
      if (effective === 'interrupt') {
        const running = liveFor(turn.conversationId).find((t) => t.status === 'running');
        if (running) await cancel(running.id);
        await pump();
      }
    }
    return store.turn(turnId);
  }

  async function kick(conversationId) {
    const meta = await store.conversation(conversationId);
    if (!meta?.queueCombine) return;
    const effective = batchDispatch(queuedFor(conversationId));
    if (effective === 'interrupt') {
      const running = liveFor(conversationId).find((t) => t.status === 'running');
      if (running) await cancel(running.id);
    }
    await pump();
  }

  return {
    async boot() {
      await store.interruptUnfinished();
      // A host that stopped with messages waiting delivers them now.
      for (const c of await store.conversations({ archived: false })) {
        const pending = await store.inbox(c.id);
        if (pending.length) await startDelivery(c.id, pending).catch((err) => log.error(`[agents] ${err.message}`));
      }
    },

    send,

    cancel,

    dequeue,

    patchQueued,

    kick,

    turnForToken: (token) => tokens.get(token) ?? null,

    /** The person's answer to a prompt the process is waiting on. */
    async answer(turnId, requestId, response) {
      const turn = live.get(turnId);
      if (!turn || turn.status !== 'running' || turn.finishing) throw Object.assign(new Error('the turn is not running'), { status: 409 });
      const ask = turn.asks.get(requestId);
      if (!ask) throw Object.assign(new Error(`no ask "${requestId}" on this turn`), { status: 404 });
      if (ask.closed) throw Object.assign(new Error('this ask was already answered'), { status: 409 });
      ask.closed = true;
      writeControl(turn, requestId, response);
      const stillOpen = [...turn.asks.values()].some((a) => !a.closed);
      if (!stillOpen) await store.updateConversation(turn.conversationId, { asking: false });
      await emit(turn, { type: 'ask.answered', requestId, response });
      if (!stillOpen) turn.resumeStall?.();
      return true;
    },

    /** The other conversations in this turn's project, with what each is
     *  doing right now. The caller is omitted; archived ones too. */
    async peers(turn) {
      const meta = await store.conversation(turn.conversationId);
      const projectId = turn.project?.id ?? meta?.project ?? 'drive';
      const others = await projectPeers(turn.conversationId, projectId);
      const statusOf = (c) => {
        const running = runningTurns().find((t) => t.conversationId === c.id);
        if (running?.waiter) return 'waiting';
        if (running && [...running.asks.values()].some((a) => !a.closed)) return 'asking';
        if (running) return 'running';
        if ([...live.values()].some((t) => t.conversationId === c.id && t.status === 'queued')) return 'queued';
        return 'idle';
      };
      return {
        agents: others
          .sort((x, y) => (y.lastInteractedAt ?? 0) - (x.lastInteractedAt ?? 0))
          .map((c) => ({ id: c.id, title: c.title, provider: c.provider, target: c.target, status: statusOf(c), activity: c.activity, lastFinishedAt: c.lastFinishedAt })),
      };
    },

    /** Send a message from this turn's conversation. Every refusal is a
     *  returned reason; nothing here throws at an agent. */
    async deliver(turn, { to, text, about = null, inReplyTo = null }) {
      const badText = validateText(text);
      if (badText) return { error: badText };
      if (typeof to !== 'string' || !to) return { error: 'to is required' };
      if (to === turn.conversationId) return { error: 'you cannot message yourself' };
      const receiver = await store.conversation(to);
      if (!receiver) return { error: `no conversation "${to}"` };
      if (receiver.archived) return { error: `conversation "${to}" is archived` };
      const sender = await store.conversation(turn.conversationId);
      const projectId = turn.project?.id ?? sender?.project ?? 'drive';
      if ((receiver.project ?? 'drive') !== projectId) return { error: `conversation "${to}" is in another project` };
      if ((turn.sent ?? 0) >= MAX_SENDS) return { error: `this turn has already sent ${MAX_SENDS} messages` };
      // What thread is this a reply to? The named parent if this host still
      // remembers it; failing that, what this turn itself received from the
      // conversation it is answering — the message that started the turn, or
      // one that arrived during it. Without that fallback an agent that never
      // passes `inReplyTo` restarts at hop 0 every time and two of them can
      // answer each other forever.
      const named = inReplyTo ? threads.get(inReplyTo) : null; // unknown (host restarted) starts a fresh thread
      const received = [
        ...(turn.from?.messageId ? [{ id: turn.from.messageId, from: turn.from.conversation, hop: turn.from.hop ?? 0 }] : []),
        ...(turn.inbound ?? []),
      ];
      const parent = named ?? [...received].reverse().find((m) => m.from === to) ?? null;
      let hop = 0;
      if (parent) {
        hop = (parent.hop ?? 0) + 1;
        if (hop > MAX_HOP) return { error: `this thread is ${MAX_HOP} replies deep; start a new message if there is something new to say` };
      }
      const cleanAbout = about && typeof about.path === 'string' && about.path
        ? { path: about.path, ...(Array.isArray(about.ids) ? { ids: about.ids.map(String) } : {}) }
        : null;
      const message = store.createMessage({ from: turn.conversationId, to, text, about: cleanAbout, inReplyTo, hop });
      threads.set(message.id, { hop, from: message.from, to });
      turn.sent = (turn.sent ?? 0) + 1;

      await store.appendInbox(to, message);
      const running = runningTurns().find((t) => t.conversationId === to);
      const queued = [...live.values()].some((t) => t.conversationId === to && t.status === 'queued');
      let delivered;
      if (running?.waiter) {
        delivered = 'live';
        running.waiter();
      } else if (running || queued) {
        delivered = 'inbox';
      } else {
        let started = null;
        try {
          started = await startDelivery(to, [message], turn.target);
        } catch (err) {
          // The turn could not be started, but the message is safely in the
          // inbox (startDelivery puts back whatever it took): the receiver
          // reads it at its next turn, or at the next boot. The sender is told
          // it was queued rather than handed a failure it cannot act on.
          log.error(`[agents] ${err.message}`);
        }
        delivered = started ? 'turn' : 'inbox';
      }
      await recordSent(turn, message, receiver, delivered);
      return { messageId: message.id, delivered, to: { id: to, title: receiver.title } };
    },

    /** Park this turn until a message arrives or the clamp runs out. The
     *  stall timer is held, as it is for an open ask. */
    async wait(turn, seconds) {
      const ms = clampSeconds(seconds) * 1000;
      const early = await takeFor(turn, 'live');
      if (early.length) return { messages: early };
      // takeFor() handed the batch back because this turn is already ending;
      // parking now would hang finish() until the clamp ran out, for a result
      // nobody will read.
      if (turn.finishing) return { timeout: true };
      turn.holdStall?.();
      let timer;
      const woke = await new Promise((resolve) => {
        turn.waiter = () => {
          turn.waiter = null; // a deliver racing the timeout must not report `live` to a turn that already gave up
          resolve(true);
        };
        timer = setTimeout(() => {
          turn.waiter = null;
          resolve(false);
        }, ms);
        timer.unref?.();
      });
      clearTimeout(timer);
      // finish() may have woken this wait (turn.waiter?.() in its cleanup) —
      // in which case the turn is already ending and a fresh stall timer here
      // would outlive it. Only re-arm the stall when this turn is still going.
      if (!turn.finishing) turn.resumeStall?.();
      if (!woke) return { timeout: true };
      // A wait can also be woken by finish() (`turn.waiter?.()` in its
      // cleanup). takeFor() hands the batch back in that case and this
      // reports a timeout, so the messages ride in on a delivery turn instead
      // of vanishing into a dying process.
      const messages = await takeFor(turn, 'live');
      return messages.length ? { messages } : { timeout: true };
    },

    async callTool(token, name, input) {
      const turn = tokens.get(token);
      if (!turn || turn.finishing) return null;
      const call = tools.call(name, input, turn);
      turn.inflight.add(call);
      try {
        return await call;
      } finally {
        turn.inflight.delete(call);
      }
    },

    watchdog(docPath, sha) {
      for (const turn of runningTurns()) {
        if (turn.capability === 'full') continue;
        if (docPath && !ownsPath(turn, docPath)) continue;
        turn.watchdog = true;
        turn.onEvent({ type: 'watchdog', path: docPath, sha });
      }
    },

    /** A document changed on disk without this host writing it.
     *
     *  A `full` turn has its own file tools, so while one is running this is
     *  almost always that turn: it is recorded as the turn's work, with the
     *  restore point just taken, rather than flagged. A `documents` turn writes
     *  only through ops, so a change under it is what the watchdog was written
     *  for and is left to it.
     *
     *  Two full turns must not share a write. Claim the turn that already
     *  owns the path (target, created docs, earlier writes). If only one full
     *  turn is running, it can write anywhere, so it still claims. Otherwise
     *  leave the change unclaimed — a sibling conversation is not a writer.
     *
     *  Returns the claiming conversation id, or null.
     *
     *  The cost, accepted in spec §6 for a single full turn: your own edit
     *  during that turn is filed under it. You do not lose it — it is in the
     *  turn's change list with its restore point. */
    documentTouched(docPath, sha) {
      const full = runningTurns().filter((turn) => turn.capability === 'full');
      const pick = full.find((turn) => ownsPath(turn, docPath)) ?? (full.length === 1 ? full[0] : null);
      if (!pick) return null;
      if (!pick.touched.has(docPath)) {
        pick.touched.set(docPath, pick.origins.get(docPath) ?? sha);
      }
      pick.onEvent({ type: 'document.changed', path: docPath, sha: pick.touched.get(docPath) });
      return pick.conversationId;
    },

    running: runningTurns,

    /** Running turns end as cancelled, with their outcome written, before
     *  this resolves — a serve that exits right after would otherwise leave
     *  them reading `running` until the next boot calls them interrupted.
     *  Queued turns stay queued on disk, and that boot interrupts them. A
     *  turn that cannot finish within the grace period is left to it. */
    async close() {
      closed = true;
      const ending = runningTurns().map((turn) => {
        turn.cancelled ??= { status: 'cancelled', error: 'host closing' };
        turn.child?.kill('SIGKILL');
        return turn.ended;
      });
      if (!ending.length) return;
      let timer;
      const grace = new Promise((resolve) => {
        timer = setTimeout(resolve, CLOSE_GRACE_MS);
      });
      await Promise.race([Promise.allSettled(ending), grace]);
      clearTimeout(timer);
    },
  };
}
