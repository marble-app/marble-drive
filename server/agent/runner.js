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

import { collectSlices } from '../engine.js';
import { summarize } from './store.js';

const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR'];
const SELECTION_BUDGET = 6_000;
const STDERR_TAIL = 4_000;

const pick = (env) => Object.fromEntries(ENV_ALLOWLIST.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));

export function createRunner({ store, tools, providers, workdir, origin, bridgePath, readDocument, publish, limits, log = console }) {
  const live = new Map(); // turnId → live turn
  const order = []; // turnIds, in the order they were sent
  const tokens = new Map(); // token → live turn
  let closed = false;

  const runningTurns = () => [...live.values()].filter((t) => t.status === 'running');

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

  async function emit(turn, event) {
    return chained(turn.conversationId, async () => {
      const stored = await store.appendEvent(turn.conversationId, { turn: turn.id, ...event });
      const meta = await store.conversation(turn.conversationId);
      publish(turn.conversationId, stored, meta ? summarize(meta) : null);
      return stored;
    });
  }

  /** finish(), wherever it's called from, never throws — a store error at the
   *  end of a turn is logged, not left for whatever fire-and-forget caller
   *  (the child's `close` handler, mainly) to crash on. */
  function safeFinish(turn, outcome) {
    return finish(turn, outcome).catch((err) => log.error(`[agents] ${err.message}`));
  }

  async function composePrompt(turn, meta) {
    const context = turn.context;
    const lines = [
      turn.prompt,
      '',
      '---',
      'Context from Marble Drive:',
      `- The person is viewing: ${context.viewing ?? context.target}`,
      `- The document you may edit: ${context.target}`,
    ];
    if (context.selectionSource) lines.push('- They selected these elements:', '', context.selectionSource);
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

  async function send(conversationId, { prompt, context }) {
    const meta = await store.conversation(conversationId);
    if (!meta) throw Object.assign(new Error(`no conversation "${conversationId}"`), { status: 404 });
    if (!context?.target) throw Object.assign(new Error('a turn needs context.target'), { status: 400 });

    const frozen = { viewing: context.viewing ?? null, target: context.target, selection: context.selection ?? [] };
    if (frozen.selection.length) {
      const source = await readDocument(frozen.target).catch(() => null);
      if (source) {
        frozen.selectionSource = collectSlices(source, frozen.selection, { budget: SELECTION_BUDGET })
          .map((s) => s.html)
          .join('\n\n');
      }
    }

    const record = await store.createTurn(conversationId, { prompt: String(prompt ?? ''), context: frozen });
    const turn = {
      id: record.id,
      n: record.n,
      conversationId,
      prompt: record.prompt,
      context: frozen,
      target: frozen.target,
      writable: new Set([frozen.target]),
      undo: [],
      status: 'queued',
      token: null,
      child: null,
      cancelled: null,
      done: null,
      usage: null,
      applied: 0,
      watchdog: false,
      stderr: '',
      timers: [],
      inflight: new Set(), // tool-call promises the bridge is still waiting on
      finishing: false, // true once finish() has started; new tool calls are refused
      onEvent: (event) => {
        if (event.type === 'ops.applied') turn.applied += event.count;
        emit(turn, event).catch((err) => log.error(`[agents] ${err.message}`));
      },
    };

    // Only listed once its `user`/`turn.queued` events are actually stored —
    // otherwise a pump() running concurrently (another turn on the same
    // conversation finishing right now) could start this one and store
    // `turn.started` before the events that are supposed to precede it.
    await emit(turn, { type: 'user', text: turn.prompt, context: { viewing: frozen.viewing, target: frozen.target, selection: frozen.selection } });
    await emit(turn, { type: 'turn.queued' });
    live.set(turn.id, turn);
    order.push(turn.id);
    await pump();
    return { turnId: turn.id, status: turn.status };
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

  async function start(turn) {
    turn.status = 'running';
    try {
      const meta = await store.conversation(turn.conversationId);
      const provider = providers.get(meta.provider);
      await store.updateTurn(turn.id, { status: 'running', startedAt: Date.now() });
      await store.updateConversation(turn.conversationId, { running: true, activity: `Working on ${turn.target}` });
      await emit(turn, { type: 'turn.started', provider: meta.provider });

      if (!provider) return safeFinish(turn, { status: 'failed', error: `no provider "${meta.provider}"` });

      turn.token = crypto.randomBytes(32).toString('hex');
      tokens.set(turn.token, turn);
      const workspace = path.join(workdir, turn.conversationId);
      const mcp = {
        command: process.execPath,
        args: [bridgePath],
        env: { MARBLE_DRIVE_URL: origin(), MARBLE_AGENT_TOKEN: turn.token },
      };

      await fsp.mkdir(workspace, { recursive: true });
      await provider.prepare?.({ workspace, mcp, meta });
      const prompt = await composePrompt(turn, meta);

      // Cancel (or a host shutdown) can land anywhere in the awaits above,
      // before there is any child to kill. Check here, the last point before
      // a process would actually start, rather than leave it running unwanted.
      if (turn.cancelled) return safeFinish(turn, turn.cancelled);
      if (closed) return safeFinish(turn, { status: 'cancelled', error: 'host closing' });

      const spec = provider.spawn({
        workspace,
        mcp,
        prompt,
        resume: meta.providerSession,
        model: meta.model,
        env: { ...pick(process.env), ...mcp.env },
      });

      const child = spawn(spec.command, spec.args, { cwd: workspace, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] });
      turn.child = child;
      child.stdin.on('error', () => {});
      child.stdin.end(spec.stdin ?? '');

      const state = {};
      let stall;
      const resetStall = () => {
        clearTimeout(stall);
        stall = setTimeout(() => stop(turn, { status: 'failed', error: `stalled — no output for ${Math.round(limits.stallMs / 1000)} s` }), limits.stallMs);
        stall.unref?.();
      };
      resetStall();
      const cap = setTimeout(() => stop(turn, { status: 'cancelled', error: `took longer than ${Math.round(limits.maxMs / 60000)} min` }), limits.maxMs);
      cap.unref?.();
      turn.timers.push(() => clearTimeout(stall), () => clearTimeout(cap));

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

  function handle(turn, event) {
    switch (event.type) {
      case 'session':
        store.updateConversation(turn.conversationId, { providerSession: event.id }).catch(() => {});
        return;
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
        return;
      default:
    }
  }

  /** Ask a running process to stop, and make sure it does — or, if it hasn't
   *  spawned yet, just record the outcome: `start` checks it before spawning
   *  and finishes the turn instead of launching a process nobody wants. */
  function stop(turn, outcome) {
    if (turn.cancelled) return;
    turn.cancelled = outcome;
    if (!turn.child) return;
    turn.child.kill('SIGTERM');
    const kill = setTimeout(() => turn.child.kill('SIGKILL'), limits.killGraceMs);
    kill.unref?.();
    turn.timers.push(() => clearTimeout(kill));
  }

  async function finish(turn, { status, error = null }) {
    if (turn.status === 'finished') return;
    turn.status = 'finished';
    // From here, a tool call in flight can still finish — callTool checks
    // this and refuses anything new — but we wait for the ones already
    // running so their undo records and `ops.applied` counts land before
    // the turn's own totals and closing event do.
    turn.finishing = true;
    for (const clear of turn.timers) clear();
    if (turn.inflight.size) await Promise.allSettled([...turn.inflight]);
    if (turn.token) tokens.delete(turn.token);
    live.delete(turn.id);
    const idx = order.indexOf(turn.id);
    if (idx !== -1) order.splice(idx, 1);

    const finishedAt = Date.now();
    if (turn.undo.length) await store.saveUndo(turn.id, turn.undo);
    await store.updateTurn(turn.id, { status, finishedAt, error, applied: turn.applied, usage: turn.usage });
    const outcome = turn.watchdog
      ? 'watchdog'
      : status === 'completed'
        ? turn.applied ? 'changes' : 'done'
        : status;
    await store.updateConversation(turn.conversationId, {
      running: false,
      activity: status === 'completed' ? (turn.applied ? `Changed ${turn.applied} element(s)` : 'Answered') : error ?? status,
      lastOutcome: outcome,
      lastFinishedAt: finishedAt,
    });
    await emit(turn, { type: `turn.${status}`, applied: turn.applied, ...(error ? { error } : {}) });
    await pump().catch((err) => log.error(`[agents] ${err.message}`));
  }

  return {
    async boot() {
      await store.interruptUnfinished();
    },

    send,

    async cancel(turnId) {
      const turn = live.get(turnId);
      if (!turn) return false;
      if (turn.status === 'queued') return this.dequeue(turnId);
      stop(turn, { status: 'cancelled', error: null });
      return true;
    },

    async dequeue(turnId) {
      const turn = live.get(turnId);
      if (!turn || turn.status !== 'queued') return false;
      live.delete(turnId);
      const idx = order.indexOf(turnId);
      if (idx !== -1) order.splice(idx, 1);
      await store.updateTurn(turnId, { status: 'removed', finishedAt: Date.now() });
      await emit(turn, { type: 'turn.removed' });
      return true;
    },

    turnForToken: (token) => tokens.get(token) ?? null,

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
        turn.watchdog = true;
        turn.onEvent({ type: 'watchdog', path: docPath, sha });
      }
    },

    running: runningTurns,

    async close() {
      closed = true;
      for (const turn of runningTurns()) turn.child?.kill('SIGKILL');
    },
  };
}
