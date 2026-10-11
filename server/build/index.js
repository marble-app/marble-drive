// Build mode on the host: marks, builds and their checkpoints for each app.
//
// A build is one turn of one conversation per app, sent the brief the marks
// make (brief.js). The turn is an ordinary turn — it draws its own change
// marks on the page, shows in Agents, undoes like any other — and this module
// watches its events (`onEvent`, fed by the hub's publish) to know when it has
// ended, and keeps what the lead says of its plan (`plan`, the build_plan
// tool). Pause, resume, stop and going back to a build are here too, and
// every tab of the app hears each change on `build:<path>`.

import { parsePath, splitPath } from '../paths.js';
import { LOG_MAX, linesOf, partNow, stepOf } from './steps.js';
import { timelineOf } from './history.js';
import { aboutBuild, summaryPrompt } from './summary.js';
import { readSkill, unfingernail } from '../agent/drawer.js';
import { indexOf } from '../agent/source.js';
import { buildBrief, phraseOf, resumeBrief } from './brief.js';
import { outlineOf, pieceFrom, previewOf } from './pieces.js';
import { cleanMark, cleanPlan, newId, shaOf } from './store.js';

const TERMINAL = new Set(['turn.completed', 'turn.failed', 'turn.cancelled']);
const STOP_WAIT = 15_000;
const TITLE_MAX = 48;
const UNTITLED = /^Untitled( \d+)?$/;
// A drawing is the drawer's widget, at most 40k characters (drawer.js).
const DRAWN_MAX = 40_000;
const THREAD_MAX = 40;

const clip = (text, max = TITLE_MAX) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** What a build is called in Builds: the words of what it took. */
function titleOf(marks) {
  const first = marks.find((m) => m.first);
  if (first) return 'From your prompt';
  const words = marks.find((m) => (m.type === 'note' && m.text) || (m.type === 'piece' && m.piece?.title));
  if (words) return clip(words.type === 'note' ? words.text : `${words.piece.title} (piece)`);
  return `${marks.length} mark${marks.length === 1 ? '' : 's'}`;
}

/** The state as the page is sent it. `current` is the document's sha now,
 *  so the page knows which build it is looking at. */
function publicState(state, current = null) {
  // A build's drawing is sent for the build in hand (running or paused) and
  // the last one that ended; older ones are asked for when picked in Builds,
  // so the state every tab is sent stays small.
  const lastEnded = [...state.builds].reverse().find((b) => b.status !== 'running' && b.status !== 'paused')?.id ?? null;
  const builds = state.builds.map((b) => ({
    id: b.id, n: b.n, status: b.status, title: b.title, marks: b.marks,
    conversation: b.conversation, turn: b.turn, plan: b.plan,
    startedAt: b.startedAt, endedAt: b.endedAt, error: b.error ?? null, said: b.said ?? null,
    showing: Boolean(current) && (b.end === current || (!b.end && b.status === 'running')),
    hasEnd: Boolean(b.end),
    drawn: b.drawn && (b.status === 'running' || b.status === 'paused' || b.id === lastEnded) ? b.drawn : null,
    hasDrawn: Boolean(b.drawn),
    // What it made, said and was asked, drawn once it has ended (summary.js).
    summary: b.summary && b.id === lastEnded ? b.summary : null,
    // What was said to it from its status, and its answers.
    thread: b.thread ?? [],
    hasSummary: Boolean(b.summary),
    // Being drawn; a host that went down meanwhile does not leave it so.
    summing: Boolean(b.summing) && Date.now() - (b.endedAt ?? 0) < 180_000,
    // Its steps, by stage, on the same rule as its drawing.
    log: b.log && (b.status === 'running' || b.status === 'paused' || b.id === lastEnded) ? b.log : null,
    hasLog: Boolean(b.log?.length),
  }));
  const first = state.builds[0];
  return {
    path: state.path,
    rev: state.rev,
    marks: state.marks,
    builds,
    // The app as it was before any build: "Your prompt", in Builds.
    origin: first ? { showing: Boolean(current) && first.start === current && !builds.some((b) => b.showing) } : null,
    conversation: state.conversation,
    folder: state.folder ?? null,
    running: builds.find((b) => b.status === 'running')?.id ?? null,
  };
}

export function createBuilds({ buildStore, store, oplog = null, undoTurns = null, runner, agentStore, hub, startConversation, defaultProvider, putDocument, moveDocument = null, freePath = null, reply = null, suggest = null, driveRegions = null, drawSummary = null, log = console }) {
  // conversation id → document path, for the builds running or paused now.
  const byConversation = new Map();
  // turn id → resolve(), for a stop waiting on its turn to end.
  const waiters = new Map();
  // Suggestions, once per version of an app.
  const suggestions = new Map();

  const channel = (docPath) => `build:${docPath}`;

  async function currentSha(docPath) {
    const source = await store.read(docPath);
    return source === null ? null : shaOf(source);
  }

  async function announce(docPath, state, extra = {}) {
    const current = await currentSha(docPath).catch(() => null);
    hub.publish(channel(docPath), { type: 'state', ...extra, state: publicState(state, current) });
  }

  async function read(docPath) {
    const state = await buildStore.read(docPath);
    return publicState(state, await currentSha(docPath));
  }

  // Steps come many a second; the tabs hear them at most every 800ms.
  const later = new Map();
  function soon(docPath) {
    if (later.has(docPath)) return;
    later.set(docPath, setTimeout(async () => {
      later.delete(docPath);
      await announce(docPath, await buildStore.read(docPath)).catch(() => {});
    }, 800));
  }

  /** One change to an app's state, said to every tab of it. */
  async function change(docPath, edit, extra = {}) {
    const { state, result } = await buildStore.update(docPath, edit);
    await announce(docPath, state, extra);
    return { state, result };
  }

  // ------------------------------------------------------------------ marks

  async function putMark(docPath, raw, { client = null } = {}) {
    const mark = cleanMark(raw);
    if (!mark) throw httpError(400, 'not a mark');
    const { result } = await change(docPath, (state) => {
      const at = state.marks.findIndex((m) => m.id === mark.id);
      // What the page cannot change of a mark: whose build it is in, and,
      // for a comment, what the agent said in its thread.
      // Nor whether it is held back or, for a comment, resolved: those are
      // set by their own presses (hold, resolve), and a page filing a mark it
      // moved must not undo them.
      if (at >= 0) {
        const prior = state.marks[at];
        mark.state = prior.state;
        mark.build = prior.build;
        if (prior.held) mark.held = true;
        else delete mark.held;
        if (prior.archived === undefined) delete mark.archived;
        else mark.archived = prior.archived;
        // Set on the host by sending, never by the page.
        for (const key of ['now', 'sent', 'forNote']) {
          if (prior[key] !== undefined) mark[key] = prior[key];
          else delete mark[key];
        }
        if (prior.type === 'comment') { mark.thread = prior.thread; mark.resolved = Boolean(prior.resolved); }
        state.marks[at] = mark;
      } else {
        if (mark.type === 'comment') { mark.thread = mark.thread.filter((line) => line.who === 'you'); mark.resolved = false; }
        delete mark.held;
        delete mark.now;
        delete mark.forNote;
        mark.state = 'waiting';
        mark.build = null;
        state.marks.push(mark);
      }
      return mark;
    }, { by: client });
    return result;
  }

  async function removeMarks(docPath, ids, { client = null } = {}) {
    const wanted = new Set(ids);
    const { result } = await change(docPath, (state) => {
      const before = state.marks.length;
      // A mark a build is working from is its brief now, not this page's to
      // rub out; it is let go when the build ends.
      state.marks = state.marks.filter((m) => !wanted.has(m.id) || m.state === 'building');
      return before - state.marks.length;
    }, { by: client });
    return result;
  }

  /** Hold a mark back from the next build, or put it back. Only a mark that
   *  is waiting can be: one in a build is that build's brief. */
  async function hold(docPath, id, held, { client = null } = {}) {
    await change(docPath, (state) => {
      const mark = state.marks.find((m) => m.id === id);
      if (!mark) throw httpError(404, 'That mark is gone');
      if (mark.type === 'comment') throw httpError(400, 'A comment is not built, so it is not held back');
      if (mark.state !== 'waiting') throw httpError(409, 'Only a mark waiting for a build can be held back');
      if (held) mark.held = true;
      else delete mark.held;
      return null;
    }, { by: client });
    return read(docPath);
  }

  /** A comment resolved, or opened again. Resolved is put away; opened
   *  again is back on the app. */
  async function resolve(docPath, id, resolved, { client = null } = {}) {
    await change(docPath, (state) => {
      const mark = state.marks.find((m) => m.id === id && m.type === 'comment');
      if (!mark) throw httpError(404, 'That comment is gone');
      mark.resolved = Boolean(resolved);
      mark.archived = mark.resolved;
      return null;
    }, { by: client });
    return read(docPath);
  }

  /** Marks put away in the Archived list, or brought back. A mark a build is
   *  working from stays where it is: it is that build's brief. */
  async function archive(docPath, ids, archived, { client = null } = {}) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!wanted.size) throw httpError(400, 'Say which marks');
    await change(docPath, (state) => {
      for (const mark of state.marks) {
        if (!wanted.has(mark.id) || mark.state === 'building') continue;
        mark.archived = Boolean(archived);
      }
      return null;
    }, { by: client });
    return read(docPath);
  }

  /** A build's last drawing, for a build picked in Builds. */
  /** History: the builds and the person's own edits, newest first. */
  async function history(docPath) {
    const state = await read(docPath);
    const lines = oplog ? await oplog.since(docPath, { limit: 4000 }).catch(() => []) : [];
    const checkpoints = store.history ? await store.history(docPath).catch(() => []) : [];
    return { entries: timelineOf({ builds: state.builds, lines, checkpoints }) };
  }

  async function drawnOf(docPath, id) {
    const state = await buildStore.read(docPath);
    const build = find(state, id);
    return { drawn: build.drawn ?? null, summary: build.summary ?? null, log: build.log ?? [] };
  }

  // ----------------------------------------------------------------- builds

  async function conversationFor(state, docPath, { busy = new Set() } = {}) {
    // The app's own conversation, unless a build in hand is using it: one
    // alongside gets a conversation of its own.
    if (state.conversation && !busy.has(state.conversation) && await agentStore.conversation(state.conversation)) return state.conversation;
    const made = await startConversation({ provider: await defaultProvider() });
    if (made.error) throw httpError(made.status ?? 500, made.error);
    const id = made.summary.id;
    await agentStore.updateConversation(id, { title: `Build · ${splitPath(docPath).name}`, titleAuto: false, target: docPath });
    hub.publish(id, { type: 'meta' }, await agentStore.summary(id));
    return id;
  }

  /** A piece's markup for the brief: its saved snapshot, or read again from
   *  where it lives. */
  async function pieceSnapshots(marks) {
    const out = new Map();
    const saved = await buildStore.pieces();
    for (const mark of marks) {
      if (mark.type !== 'piece' || !mark.piece?.id || out.has(mark.piece.id)) continue;
      const kept = saved.find((p) => p.id === mark.piece.id);
      if (kept) { out.set(mark.piece.id, kept); continue; }
      const src = mark.piece.source;
      if (!src?.path || !src.id) continue;
      const source = await store.read(src.path).catch(() => null);
      const taken = source ? pieceFrom(source, src.id, { path: src.path }) : null;
      if (taken) out.set(mark.piece.id, taken);
    }
    return out;
  }

  async function start(docPath, { marks: chosen = null, words = '', anchor = null, client = null, model = null } = {}) {
    const source = await store.read(docPath);
    if (source === null) throw httpError(404, `no document "${docPath}"`);
    const startSha = await buildStore.putSnapshot(source);

    // First, settled under the state's own lock: which marks this build
    // takes, its number, and that no other build is running.
    const { state, result: build } = await buildStore.update(docPath, async (state) => {
      // Builds may run side by side (startOrJoin decides); each takes its own
      // marks, and a mark in a build is not taken twice.
      const text = String(words ?? '').trim().slice(0, 4_000);
      const wanted = Array.isArray(chosen) && chosen.length ? new Set(chosen.map(String)) : null;
      if (text) {
        const at = wanted ? state.marks.find((m) => wanted.has(m.id)) : null;
        const note = cleanMark({ id: newId('m'), type: 'note', anchorId: anchor ?? at?.anchorId ?? null, u: at?.u ?? 0, v: at?.v ?? 0, text });
        state.marks.push(note);
        wanted?.add(note.id);
      }
      // A comment is context for a build, not one of its asks: what it asked
      // for is a note once Build that is pressed.
      // A mark held back waits out this build, unless it is one of the marks
      // picked to build by name (Build these), which lets it go.
      // An archived mark is put away, and waits for nothing.
      const taken = state.marks.filter((m) => m.state === 'waiting' && m.type !== 'comment' && (wanted ? wanted.has(m.id) : !m.held && !m.archived));
      if (!taken.length) throw httpError(409, 'Nothing is marked to build yet');
      state.n = (state.n ?? state.builds.length) + 1;
      const made = {
        id: `b${state.n}`,
        n: state.n,
        status: 'running',
        title: titleOf(taken),
        marks: taken.map((m) => m.id),
        conversation: null,
        turn: null,
        turns: [],
        plan: { parts: [], title: null, folder: null },
        start: startSha,
        end: null,
        startedAt: Date.now(),
        endedAt: null,
      };
      for (const mark of taken) { mark.state = 'building'; mark.build = made.id; delete mark.held; }
      state.builds.push(made);
      return made;
    });

    try {
      const busy = new Set(state.builds.filter((b) => b.id !== build.id && (b.status === 'running' || b.status === 'paused')).map((b) => b.conversation).filter(Boolean));
      const conversation = await conversationFor(state, docPath, { busy });
      const taken = state.marks.filter((m) => build.marks.includes(m.id));
      // A model and effort chosen on what it takes (a note sent with them) are
      // the build's.
      const wanted = model ?? taken.find((m) => m.model)?.model ?? null;
      const effort = taken.find((m) => m.effort)?.effort ?? null;
      const patch = { ...(wanted ? { model: wanted } : {}), ...(effort ? { effort } : {}) };
      if (Object.keys(patch).length) await agentStore.updateConversation(conversation, patch).catch(() => {});
      // The comment a sent note became is that note's, not context.
      const context = state.marks.filter((m) => m.type === 'comment' && m.state === 'waiting' && !m.resolved && !m.archived && !m.forNote);
      const index = indexOf(source);
      const prompt = buildBrief({
        path: docPath,
        n: build.n,
        marks: taken,
        context,
        pieces: await pieceSnapshots(taken),
        index,
        empty: !outlineOf(source).trim() || taken.some((m) => m.first),
        untitled: UNTITLED.test(splitPath(docPath).name),
        imagePath: buildStore.imagePath,
      });
      const anchors = [...new Set(taken.map((m) => m.anchorId).filter((id) => id && index.has(id)))].slice(0, 20);
      byConversation.set(conversation, docPath);
      const sent = await runner.send(conversation, {
        prompt,
        context: { viewing: docPath, target: docPath, selection: anchors, also: [] },
      });
      const { state: next } = await change(docPath, (s) => {
        // The app's conversation stays the first one; one made for a build
        // alongside is that build's alone.
        s.conversation ??= conversation;
        const b = s.builds.find((x) => x.id === build.id);
        if (b) { b.conversation = conversation; b.turn = sent.turnId; b.turns = [sent.turnId]; }
        return null;
      }, { by: client });
      return publicState(next, startSha);
    } catch (err) {
      // Nothing started: the marks go back to waiting and the build is not kept.
      await change(docPath, (s) => {
        s.builds = s.builds.filter((b) => b.id !== build.id);
        s.n = Math.max(0, (s.n ?? 1) - 1);
        for (const m of s.marks) if (m.build === build.id) { m.state = 'waiting'; m.build = null; }
        return null;
      });
      throw err;
    }
  }

  const find = (state, id) => {
    const build = state.builds.find((b) => b.id === id);
    if (!build) throw httpError(404, `no build "${id}"`);
    return build;
  };

  /** Waits for a turn to leave the runner, or gives up after a while. */
  function untilEnded(turnId) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { waiters.delete(turnId); resolve(false); }, STOP_WAIT);
      timer.unref?.();
      waiters.set(turnId, () => { clearTimeout(timer); waiters.delete(turnId); resolve(true); });
    });
  }

  async function pause(docPath, id) {
    const state = await buildStore.read(docPath);
    const build = find(state, id);
    if (build.status !== 'running') throw httpError(409, 'That build is not running');
    await change(docPath, (s) => { find(s, id).want = 'pause'; return null; });
    const ended = untilEnded(build.turn);
    const cancelled = await runner.cancel(build.turn);
    if (cancelled) await ended;
    else waiters.delete(build.turn);
    // The turn may have ended on its own just then; whatever it ended as, a
    // build still marked running is held now.
    const { state: next } = await change(docPath, (s) => {
      const b = find(s, id);
      if (b.status === 'running') b.status = 'paused';
      delete b.want;
      return null;
    });
    return publicState(next, await currentSha(docPath));
  }

  async function resume(docPath, id) {
    const state = await buildStore.read(docPath);
    const build = find(state, id);
    if (build.status !== 'paused') throw httpError(409, 'Only a paused build can be resumed');
    if (state.builds.some((b) => b.status === 'running')) throw httpError(409, 'A build is running already');
    const conversation = await conversationFor(state, docPath);
    byConversation.set(conversation, docPath);
    const sent = await runner.send(conversation, {
      prompt: resumeBrief({ path: docPath, n: build.n, plan: build.plan }),
      context: { viewing: docPath, target: docPath, selection: [], also: [] },
    });
    const { state: next } = await change(docPath, (s) => {
      const b = find(s, id);
      b.status = 'running';
      b.conversation = conversation;
      b.turn = sent.turnId;
      b.turns = [...(b.turns ?? []), sent.turnId];
      b.endedAt = null;
      s.conversation = conversation;
      return null;
    });
    return publicState(next, await currentSha(docPath));
  }

  /** Stop: the build ends where it got to, kept in Builds as it was, and the
   *  version before it is put back. Its marks wait for the next build. */
  async function stop(docPath, id) {
    let state = await buildStore.read(docPath);
    let build = find(state, id);
    if (build.status !== 'running' && build.status !== 'paused') throw httpError(409, 'That build has ended already');
    if (build.status === 'running') {
      await change(docPath, (s) => { find(s, id).want = 'stop'; return null; });
      const ended = untilEnded(build.turn);
      const cancelled = await runner.cancel(build.turn);
      if (cancelled) await ended;
      else waiters.delete(build.turn);
    }
    const source = await store.read(docPath);
    const end = source === null ? null : await buildStore.putSnapshot(source);
    state = await buildStore.read(docPath);
    build = find(state, id);
    // Alone, the app goes back to where the build started. With another
    // build at work on it since, or ended since, only this build's own
    // changes are taken back, op by op, and theirs stay.
    const shared = state.builds.some((b) => b.id !== id && (b.status === 'running' || b.status === 'paused' || (b.endedAt && b.endedAt > (build.startedAt ?? 0))));
    if (shared && undoTurns) await undoTurns(build.turns ?? [build.turn]).catch((err) => log.error(`[builds] undo on stop: ${err.message}`));
    else {
      const back = await buildStore.snapshot(build.start);
      if (back !== null && back !== source) await putDocument(docPath, back, { label: 'before-restore', event: 'changed' });
    }
    const { state: next } = await change(docPath, (s) => {
      const b = find(s, id);
      b.status = 'stopped';
      b.end = end;
      b.endedAt = Date.now();
      delete b.want;
      for (const m of s.marks) if (m.build === id) { m.state = 'waiting'; m.build = null; }
      return null;
    });
    return publicState(next, await currentSha(docPath));
  }

  /** See the app as it was at a build's end (or before the first, "origin"):
   *  a restore, so where it was is itself kept. */
  async function view(docPath, id) {
    const state = await buildStore.read(docPath);
    if (state.builds.some((b) => b.status === 'running')) throw httpError(409, 'Wait for the build to finish, or stop it');
    let sha = null;
    if (id === 'origin') sha = state.builds[0]?.start ?? null;
    else {
      const build = find(state, id);
      sha = build.end ?? build.start;
    }
    const wanted = sha ? await buildStore.snapshot(sha) : null;
    if (wanted === null) throw httpError(404, 'That version is not kept any more');
    const source = await store.read(docPath);
    if (source !== null && source !== wanted) {
      // Where the app was, kept too, so going back to it is one more pick.
      await buildStore.putSnapshot(source);
      await putDocument(docPath, wanted, { label: 'before-restore', event: 'changed' });
    }
    await announce(docPath, await buildStore.read(docPath));
    return read(docPath);
  }

  // --------------------------------------------------------------- the turn

  /** The lead agent's build_plan: the parts, which one is being made, and
   *  the app's name and folder when it has none. */
  async function plan(turn, input) {
    const docPath = byConversation.get(turn.conversationId) ?? turn.target;
    if (!docPath) return { error: 'this conversation is not building an app' };
    const state = await buildStore.read(docPath);
    const build = state.builds.find((b) => b.status === 'running' && b.conversation === turn.conversationId);
    if (!build) return { error: 'no build is running for this conversation; build_plan is only for Build mode' };
    const { state: next } = await change(docPath, (s) => {
      const b = find(s, build.id);
      b.plan = cleanPlan(input, b.plan);
      if (b.plan.folder && !docPath.includes('/') && b.plan.folder !== s.dismissedFolder) s.folder = b.plan.folder;
      return null;
    });
    const parts = find(next, build.id).plan.parts;
    return { ok: true, parts: parts.length, done: parts.filter((p) => p.state === 'done').length };
  }

  /** Every event any conversation publishes: a build's turn ending is the
   *  build ending. */
  async function onEvent(conversationId, event) {
    const docPath = byConversation.get(conversationId);
    if (!docPath || !event?.turn) return;
    if (event.type === 'progress.drawn') {
      // The drawer's picture of the build's work (server/agent/drawer.js), from
      // any of its turns. Kept on the build and sent to every tab. One that
      // comes after the build has ended is stale, unless it is the last one.
      const html = typeof event.html === 'string' ? event.html : '';
      if (!html.trim() || html.length > DRAWN_MAX) return;
      const { state, result } = await buildStore.update(docPath, (s) => {
        const b = s.builds.find((x) => (x.turns ?? [x.turn]).includes(event.turn));
        if (!b) return false;
        const live = b.status === 'running' || b.status === 'paused';
        if (!live && !event.final) return false;
        b.drawn = { html, at: Date.now(), final: Boolean(event.final) };
        return true;
      }).catch((err) => { log.error(`[builds] ${err.message}`); return {}; });
      if (result) await announce(docPath, state);
      return;
    }
    if (event.type === 'tool.call' || event.type === 'tool.result') {
      // A step of the build, under the stage being made: kept with it, and
      // said to every tab a beat later, with whatever else came meanwhile.
      const { state, result } = await buildStore.update(docPath, (s) => {
        const b = s.builds.find((x) => (x.turns ?? [x.turn]).includes(event.turn) && (x.status === 'running' || x.status === 'paused'));
        if (!b) return false;
        b.log ??= [];
        if (event.type === 'tool.call') {
          const step = stepOf(event.name, event.input ?? {}, { app: docPath });
          if (!step) return false;
          b.log.push({ id: String(event.callId ?? ''), at: Date.now(), part: partNow(b.plan), ...step, lines: [] });
          if (b.log.length > LOG_MAX) b.log.splice(0, b.log.length - LOG_MAX);
          return true;
        }
        const step = event.callId ? b.log.find((x) => x.id === String(event.callId)) : null;
        if (!step) return false;
        if (event.ok === false || event.denied) step.failed = true;
        if (step.kind !== 'change') step.lines = linesOf(event.summary);
        return true;
      }).catch((err) => { log.error(`[builds] ${err.message}`); return {}; });
      if (result) soon(docPath, state);
      return;
    }
    if (event.type === 'text' && event.text) {
      await buildStore.update(docPath, (s) => {
        const b = s.builds.find((x) => x.turn === event.turn);
        if (b) b.said = clip(event.text, 400);
        return null;
      }).catch(() => {});
      return;
    }
    if (!TERMINAL.has(event.type)) return;
    const status = event.type.slice('turn.'.length);
    const source = await store.read(docPath).catch(() => null);
    const end = source === null ? null : await buildStore.putSnapshot(source);
    let named = null;
    const { state } = await buildStore.update(docPath, (s) => {
      const b = s.builds.find((x) => x.turn === event.turn);
      if (!b || b.status !== 'running') return null;
      // A stop finishes its own bookkeeping (it puts the version before
      // back); here it is only marked as no longer running.
      if (b.want === 'stop') return null;
      if (status === 'completed') {
        b.status = 'finished';
        b.end = end;
        b.endedAt = Date.now();
        // Built is done with: off the app, into the Archived list.
        for (const m of s.marks) if (m.build === b.id) { m.state = 'built'; m.archived = true; }
        // A note sent to be made now is answered in its comment: what the
        // build said of it, or that it is done, and the comment is put away.
        const sentFor = new Map(s.marks.filter((m) => m.build === b.id && m.sent).map((m) => [m.sent, m.id]));
        for (const m of s.marks) {
          if (m.type !== 'comment' || !sentFor.has(m.id) || m.resolved) continue;
          const said = (b.plan?.settled ?? []).find((x) => x.id === m.id)?.said;
          m.thread = [...(m.thread ?? []).filter((line) => !line.pending), { who: 'agent', text: said || `Done in Build ${b.n}.`, at: Date.now() }];
          m.resolved = true;
          m.archived = true;
        }
        for (const m of s.marks) if (m.build === b.id) delete m.now;
        // The comments the build said it settled are answered, resolved and
        // put away, in the app's name.
        for (const { id, said } of b.plan?.settled ?? []) {
          const m = s.marks.find((x) => x.id === id && x.type === 'comment' && !x.resolved);
          if (!m) continue;
          m.thread = [...(m.thread ?? []).filter((line) => !line.pending), { who: 'agent', text: said || `Done in Build ${b.n}.`, at: Date.now() }];
          m.resolved = true;
          m.archived = true;
        }
        if (b.plan?.title && UNTITLED.test(splitPath(docPath).name) && !s.named) {
          named = b.plan.title;
          s.named = true;
        }
      } else if (status === 'cancelled' || b.want === 'pause') {
        // Cancelled from somewhere else (Agents, Esc on the line): held, as a
        // pause would, so it can be resumed or stopped from Builds.
        b.status = 'paused';
        b.end = end;
      } else {
        b.status = 'failed';
        b.end = end;
        b.endedAt = Date.now();
        b.error = clip(event.error ?? 'The build did not finish', 300);
        for (const m of s.marks) if (m.build === b.id) { m.state = 'waiting'; m.build = null; }
      }
      delete b.want;
      return null;
    }).catch((err) => { log.error(`[builds] ${err.message}`); return {}; });
    waiters.get(event.turn)?.();
    if (state) await announce(docPath, state);
    // Anything sent to be made now while this build ran is made next.
    if (state && status !== 'cancelled') startNow(docPath).catch((err) => log.error(`[builds] ${err.message}`));
    let at = docPath;
    if (named && moveDocument && freePath) at = (await name(docPath, named).catch((err) => log.error(`[builds] naming failed: ${err.message}`))) ?? docPath;
    // Its summary, drawn once it is over (at the app's new name, if the build
    // gave it one): what is new, what changed, what to know, what was asked.
    // The card shows the last drawing of the work until it comes.
    if (state && (status === 'completed' || status === 'failed')) summarize(at, event.turn).catch((err) => log.error(`[builds] summary: ${err.message}`));
  }

  /** Ask the drawer for an ended build's summary, and keep it with the build.
   *  Never fails the build: no drawer, no answer, and the card keeps the last
   *  drawing of its work. */
  async function summarize(docPath, turn) {
    if (!drawSummary) return;
    const first = await buildStore.read(docPath);
    const build = first.builds.find((x) => x.turn === turn);
    if (!build || (build.status !== 'finished' && build.status !== 'failed')) return;
    await buildStore.update(docPath, (s) => { const b = s.builds.find((x) => x.id === build.id); if (b) b.summing = true; return null; });
    let html = null;
    try {
      const prompt = summaryPrompt({ build, marks: first.marks });
      const drawn = await drawSummary({ system: await readSkill(), prompt });
      html = drawn ? unfingernail(drawn) : null;
    } finally {
      const { state } = await buildStore.update(docPath, (s) => {
        const b = s.builds.find((x) => x.id === build.id);
        if (!b) return null;
        delete b.summing;
        if (html && html.length <= DRAWN_MAX) b.summary = { html, at: Date.now() };
        return null;
      });
      if (state) await announce(docPath, state).catch(() => {});
    }
  }

  /** A rename retitles the document, so the build that named it ends where
   *  the rename left it: that is the version it is shown as. */
  async function settleEnd(docPath) {
    const source = await store.read(docPath);
    if (source === null) return;
    const end = await buildStore.putSnapshot(source);
    await change(docPath, (s) => {
      const b = [...s.builds].reverse().find((x) => x.status === 'finished');
      if (b) b.end = end;
      return null;
    });
  }

  /** The app's first build named it: the document takes the name, and every
   *  tab of it is sent to the new address. */
  async function name(docPath, title) {
    const { parent } = splitPath(docPath);
    const to = await freePath([parent, title].filter(Boolean).join('/'));
    hub.publish(channel(docPath), { type: 'moved', to, href: `/a/${to.split('/').map(encodeURIComponent).join('/')}` });
    await moveDocument(docPath, to);
    await settleEnd(to);
    return to;
  }

  /** The folder chip: take the folder the lead suggested, or another. */
  async function file(docPath, folder) {
    if (!moveDocument || !freePath) throw httpError(501, 'Moving is not available here');
    const into = parsePath(String(folder ?? ''), { allowRoot: false });
    const to = await freePath(`${into}/${splitPath(docPath).name}`);
    await buildStore.update(docPath, (s) => { s.folder = null; return null; });
    hub.publish(channel(docPath), { type: 'moved', to, href: `/a/${to.split('/').map(encodeURIComponent).join('/')}` });
    await moveDocument(docPath, to);
    return { path: to, href: `/a/${to.split('/').map(encodeURIComponent).join('/')}` };
  }

  async function dismissFolder(docPath) {
    await change(docPath, (s) => { s.dismissedFolder = s.folder; s.folder = null; return null; });
    return read(docPath);
  }

  // --------------------------------------------------------------- comments

  /** A line added to a comment's thread, and the agent's answer after it. */
  async function comment(docPath, id, text, { client = null, images = [] } = {}) {
    const words = String(text ?? '').trim().slice(0, 2_000);
    const pictures = (Array.isArray(images) ? images : []).filter((image) => typeof image?.name === 'string');
    if (!words && !pictures.length) throw httpError(400, 'Say something first');
    const { state, result: mark } = await change(docPath, (s) => {
      const m = s.marks.find((x) => x.id === id && x.type === 'comment');
      if (!m) throw httpError(404, 'That comment is gone');
      const said = cleanMark({ id: 'x', type: 'comment', thread: [{ who: 'you', text: words || 'This, as pasted.', images: pictures }] }).thread[0];
      m.thread = [...(m.thread ?? []).filter((line) => !line.pending), { ...said, at: Date.now() }, { who: 'agent', text: '', pending: true, at: Date.now() }];
      m.resolved = false;
      return m;
    }, { by: client });
    answer(docPath, mark, state).catch((err) => log.error(`[builds] ${err.message}`));
    return read(docPath);
  }

  async function answer(docPath, mark) {
    const source = await store.read(docPath);
    let said = null;
    if (reply && source !== null) {
      const index = indexOf(source);
      said = await reply({
        title: splitPath(docPath).name,
        html: (mark.anchorId && index.outerOf(mark.anchorId)) || '',
        outline: outlineOf(source),
        thread: mark.thread.filter((line) => !line.pending),
      });
    }
    await change(docPath, (s) => {
      const m = s.marks.find((x) => x.id === mark.id);
      if (!m) return null;
      m.thread = (m.thread ?? []).filter((line) => !line.pending);
      m.thread.push(said
        ? { who: 'agent', text: said.answer, at: Date.now(), ...(said.offer ? { offer: { text: said.offer, taken: null } } : {}) }
        : { who: 'agent', text: 'I could not answer just now. It is kept for the next build.', at: Date.now() });
      return null;
    });
  }

  /** Build, pressed while a build runs: no queue. What is marked joins
   *  the running build when it is about the same parts of the app (one holds
   *  the other, or they are the same), and otherwise starts at once as a
   *  build of its own, alongside. */
  async function startOrJoin(docPath, options = {}) {
    const state = await buildStore.read(docPath);
    const running = state.builds.filter((b) => b.status === 'running');
    if (!running.length) return start(docPath, options);
    const wanted = Array.isArray(options.marks) && options.marks.length ? new Set(options.marks.map(String)) : null;
    const taking = state.marks.filter((m) => m.state === 'waiting' && m.type !== 'comment' && (wanted ? wanted.has(m.id) : !m.held && !m.archived));
    if (!taking.length && !String(options.words ?? '').trim()) throw httpError(409, 'Nothing is marked to build yet');
    const source = await store.read(docPath);
    const index = source === null ? null : indexOf(source);
    const join = relatedBuild(index, taking, running, state);
    if (join) return { ...(await steer(docPath, { ...options, marks: taking.map((m) => m.id), into: join.id })), joined: join.n };
    return { ...(await start(docPath, options)), alongside: true };
  }

  /** The running build these marks are about, if any: one of its marks or
   *  its plan's parts is the same part as one of theirs, or holds it, or is
   *  held by it. */
  function relatedBuild(index, marks, running, state) {
    if (!index) return null;
    const of = (m) => [m.anchorId, m.from, ...(m.ids ?? [])].filter(Boolean);
    const ours = new Set(marks.flatMap(of));
    if (!ours.size) return null;
    const holds = (a, b) => a === b || (index.has(a) && String(index.outerOf(a) ?? '').includes(`data-marble-id="${b}"`));
    const near = (a, b) => holds(a, b) || holds(b, a);
    // The page, its body and its main hold everything; being on them says
    // nothing about which parts a mark is about.
    const whole = (id) => /^(html|body|main)$/i.test(index.tagOf?.(id) ?? '');
    const body = new Set([...ours].filter(whole));
    for (const b of running) {
      const theirs = new Set([
        ...state.marks.filter((m) => m.build === b.id).flatMap(of),
        ...(b.plan?.parts ?? []).flatMap((p) => p.ids ?? []),
      ]);
      for (const a of ours) {
        if (body.has(a)) continue;
        for (const t of theirs) if (!whole(t) && near(a, t)) return b;
      }
    }
    return null;
  }

  /** Steer the running build: these marks join it now, sent into its turn as
   *  a course-correction rather than waiting for the next build. */
  async function steer(docPath, { marks: chosen = null, client = null, into = null } = {}) {
    const before = await buildStore.read(docPath);
    const running = before.builds.find((b) => b.status === 'running' && (!into || b.id === into)) ?? before.builds.find((b) => b.status === 'running');
    if (!running?.conversation) return start(docPath, { marks: chosen, client });
    const wanted = Array.isArray(chosen) && chosen.length ? new Set(chosen.map(String)) : null;
    const { result: taken } = await change(docPath, (s) => {
      const b = find(s, running.id);
      const list = s.marks.filter((m) => m.state === 'waiting' && m.type !== 'comment' && (wanted ? wanted.has(m.id) : !m.held && !m.archived));
      if (!list.length) throw httpError(409, 'Nothing is marked to steer with');
      for (const m of list) { m.state = 'building'; m.build = b.id; delete m.now; delete m.held; }
      b.marks = [...new Set([...(b.marks ?? []), ...list.map((m) => m.id)])];
      return list.map((m) => ({ ...m }));
    }, { by: client });
    const source = await store.read(docPath);
    const index = source === null ? null : indexOf(source);
    const lines = [
      `More marks for this build (build ${running.n}), made on the app while it runs. Work them into the plan you are on: add them to build_plan's parts, and keep going.`,
      '',
      ...taken.map((mark, i) => `${i + 1}. ${phraseOf(mark, { index, imagePath: buildStore.imagePath })}`),
    ];
    const anchors = [...new Set(taken.map((m) => m.anchorId).filter((id) => id && index?.has(id)))].slice(0, 20);
    const sent = await runner.send(running.conversation, {
      prompt: lines.join('\n'),
      context: { viewing: docPath, target: docPath, selection: anchors, also: [] },
      dispatch: 'steer',
    });
    // The build is the steered turn now: it ends when that turn ends.
    const { state } = await change(docPath, (s) => {
      const b = find(s, running.id);
      if (sent?.turnId && b.status === 'running') { b.turn = sent.turnId; b.turns = [...new Set([...(b.turns ?? []), sent.turnId])]; }
      return null;
    }, { by: client });
    if (sent?.turnId) byConversation.set(running.conversation, docPath);
    return { ...publicState(state, await currentSha(docPath).catch(() => null)), steered: taken.length };
  }

  /** A note sent with ⌘↵: it becomes a comment, which the app answers when
   *  it asks something, and which a build makes, at once, when it asks for a
   *  change. The note itself is kept, out of sight, as that build's brief. */
  async function send(docPath, id, { client = null } = {}) {
    const { result } = await change(docPath, (s) => {
      const note = s.marks.find((m) => m.id === id && m.type === 'note');
      if (!note) throw httpError(404, 'That note is gone');
      if (note.state !== 'waiting') throw httpError(409, 'That note is in a build already');
      if (!note.text && !note.images?.length && !note.clips?.length) throw httpError(400, 'Write something first');
      const at = Date.now();
      const comment = cleanMark({ id: newId('m'), type: 'comment', anchorId: note.anchorId, u: note.u, v: note.v, at });
      comment.thread = [
        { who: 'you', text: note.text || 'This, as pasted.', at },
        { who: 'agent', text: '', pending: true, at },
      ];
      comment.forNote = note.id;
      note.sent = comment.id;
      note.archived = true;
      delete note.held;
      s.marks.push(comment);
      return { note: { ...note }, comment: { ...comment } };
    }, { by: client });
    triage(docPath, result).catch((err) => log.error(`[builds] ${err.message}`));
    return { ...(await read(docPath)), comment: result.comment.id };
  }

  /** Is a sent note a question or a change? Answered, or built. Without a
   *  model to ask, it is built: the build answers a question in its stead. */
  async function triage(docPath, { note, comment }) {
    const source = await store.read(docPath);
    let said = null;
    if (reply && source !== null) {
      const index = indexOf(source);
      said = await reply({
        title: splitPath(docPath).name,
        html: (note.anchorId && index.outerOf(note.anchorId)) || '',
        outline: outlineOf(source),
        thread: comment.thread.filter((line) => !line.pending),
        model: note.model ?? null,
      });
    }
    const making = !said || said.change;
    await change(docPath, (s) => {
      const c = s.marks.find((m) => m.id === comment.id);
      const n = s.marks.find((m) => m.id === note.id);
      if (!c) return null;
      c.thread = (c.thread ?? []).filter((line) => !line.pending);
      if (making && n) {
        c.thread.push({ who: 'agent', text: 'Making this now.', at: Date.now() });
      } else {
        c.thread.push({ who: 'agent', text: said?.answer || 'I could not answer just now.', at: Date.now(), ...(said?.offer ? { offer: { text: said.offer, taken: null } } : {}) });
        // A question was asked and answered: the note it came from has done
        // its work.
        if (n) s.marks = s.marks.filter((m) => m !== n);
        delete c.forNote;
      }
      return null;
    });
    // Built at once: on its own, or into the running build it is about.
    if (making) await startOrJoin(docPath, { marks: [note.id] }).catch((err) => log.error(`[builds] ${err.message}`));
  }

  /** Start a build of what was sent to be made now, if nothing is running. */
  async function startNow(docPath) {
    const state = await buildStore.read(docPath);
    if (state.builds.some((b) => b.status === 'running' || b.status === 'paused')) return null;
    const ids = state.marks.filter((m) => m.now && m.state === 'waiting').map((m) => m.id);
    if (!ids.length) return null;
    return start(docPath, { marks: ids }).catch((err) => {
      if (err.status !== 409) throw err;
      return null;
    });
  }

  // ------------------------------------------------------- talking to one

  /** A line said to a build, from its status card: a question about it is
   *  answered in its thread; a change is made at once, worked into the
   *  build while it runs, or once it has ended as a build of its own (or
   *  into one running on the same parts). */
  async function talk(docPath, id, text, { client = null, images = [] } = {}) {
    const words = String(text ?? '').trim().slice(0, 2_000);
    const pictures = (Array.isArray(images) ? images : []).filter((image) => typeof image?.name === 'string');
    if (!words && !pictures.length) throw httpError(400, 'Say something first');
    const { result: build } = await change(docPath, (s) => {
      const b = find(s, id);
      const said = cleanMark({ id: 'x', type: 'comment', thread: [{ who: 'you', text: words || 'This, as pasted.', images: pictures }] }).thread[0];
      b.thread = [...(b.thread ?? []).filter((line) => !line.pending), { ...said, at: Date.now() }, { who: 'agent', text: '', pending: true, at: Date.now() }].slice(-THREAD_MAX);
      return structuredClone(b);
    }, { by: client });
    answerBuild(docPath, build).catch((err) => log.error(`[builds] ${err.message}`));
    return read(docPath);
  }

  async function answerBuild(docPath, build) {
    const source = await store.read(docPath);
    const marks = (await buildStore.read(docPath)).marks;
    let said = null;
    if (reply && source !== null) {
      said = await reply({
        title: splitPath(docPath).name,
        about: aboutBuild({ build, marks }),
        outline: outlineOf(source),
        thread: (build.thread ?? []).filter((line) => !line.pending),
      });
    }
    const making = !said || said.change;
    let noteId = null;
    const { state } = await change(docPath, (s) => {
      const b = find(s, build.id);
      b.thread = (b.thread ?? []).filter((line) => !line.pending);
      if (!making) {
        b.thread.push({ who: 'agent', text: said.answer, at: Date.now() });
        return null;
      }
      // What was asked becomes a note on the part the build was about, and
      // is made like any other.
      const last = [...b.thread].reverse().find((line) => line.who !== 'agent');
      const at = s.marks.find((m) => (b.marks ?? []).includes(m.id) && m.anchorId);
      const note = cleanMark({ id: newId('m'), type: 'note', anchorId: at?.anchorId ?? null, u: at?.u ?? 0, v: at?.v ?? 0, text: last?.text ?? '', images: last?.images ?? [] });
      s.marks.push(note);
      noteId = note.id;
      return null;
    });
    if (!making) return;
    let line = '';
    try {
      if (state.builds.find((b) => b.id === build.id)?.status === 'running') {
        await steer(docPath, { marks: [noteId], into: build.id });
        line = `Working it into build ${build.n} now.`;
      } else {
        const got = await startOrJoin(docPath, { marks: [noteId] });
        const n = got.joined ?? got.builds?.find((b) => (b.marks ?? []).includes(noteId))?.n;
        line = got.joined ? `Making it now, in build ${n}, which is on the same parts.` : n ? `Making it now, in build ${n}.` : 'Making it now.';
      }
    } catch (err) {
      log.error(`[builds] ${err.message}`);
      line = 'I could not start making that just now. It waits on the app as a note.';
    }
    await change(docPath, (s) => {
      const b = s.builds.find((x) => x.id === build.id);
      if (b) b.thread = [...(b.thread ?? []).filter((l) => !l.pending), { who: 'agent', text: line, at: Date.now() }].slice(-THREAD_MAX);
      return null;
    });
  }

  /** Build that, or Not now, on an answer that offered a change. */
  async function takeOffer(docPath, id, take, { client = null } = {}) {
    await change(docPath, (s) => {
      const m = s.marks.find((x) => x.id === id && x.type === 'comment');
      if (!m) throw httpError(404, 'That comment is gone');
      const line = [...(m.thread ?? [])].reverse().find((l) => l.offer && l.offer.taken === null);
      if (!line) throw httpError(409, 'There is nothing offered there');
      line.offer.taken = Boolean(take);
      if (take) {
        s.marks.push(cleanMark({ id: newId('m'), type: 'note', anchorId: m.anchorId, u: m.u, v: m.v + 0.02, text: line.offer.text, at: Date.now() }));
        m.resolved = true;
        m.archived = true;
      }
      return null;
    }, { by: client });
    return read(docPath);
  }

  // ----------------------------------------------------------------- pieces

  async function pieces(docPath) {
    const saved = (await buildStore.pieces()).map(({ html: _h, css: _c, script: _s, ...p }) => p);
    const drive = driveRegions ? await driveRegions({ exclude: docPath }).catch(() => []) : [];
    return { saved: saved.reverse(), drive };
  }

  async function suggested(docPath) {
    const source = await store.read(docPath);
    if (source === null || !suggest) return { suggested: [] };
    const sha = shaOf(source);
    const kept = suggestions.get(docPath);
    if (kept?.sha === sha) return { suggested: kept.list };
    const state = await buildStore.read(docPath);
    const { saved, drive } = await pieces(docPath);
    const candidates = [
      ...saved.map((p) => ({ id: p.id, title: p.title, kind: p.kind, doc: p.source?.path ?? '', source: p.source, saved: true })),
      ...drive,
    ];
    const marks = state.marks.filter((m) => m.type === 'note' && m.text).map((m) => `- ${m.text}`).join('\n');
    const list = await suggest({ title: splitPath(docPath).name, outline: outlineOf(source), marks, candidates });
    suggestions.set(docPath, { sha, list });
    return { suggested: list };
  }

  async function savePiece({ path: from, id, title = '', line = '' }) {
    const docPath = parsePath(String(from ?? ''), { allowRoot: false });
    const source = await store.read(docPath);
    if (source === null) throw httpError(404, `no document "${docPath}"`);
    const taken = pieceFrom(source, String(id ?? ''), { path: docPath });
    if (!taken) throw httpError(404, 'That part is not in the document any more');
    const kept = await buildStore.savePiece({ ...taken, id: newId('p'), title: String(title).trim() || taken.title, line });
    const { html: _h, css: _c, script: _s, ...rest } = kept;
    return rest;
  }

  /** A piece's look, for a sandboxed frame: saved, or read from its source. */
  async function preview({ id = null, path: from = null, at = null }) {
    if (id) {
      const kept = (await buildStore.pieces()).find((p) => p.id === id);
      if (kept) return previewOf(kept);
    }
    if (from && at) {
      const docPath = parsePath(String(from), { allowRoot: false });
      const source = await store.read(docPath);
      const taken = source ? pieceFrom(source, String(at), { path: docPath }) : null;
      if (taken) return previewOf(taken);
    }
    return null;
  }

  // ------------------------------------------------------------------- boot

  /** On start: a build the host was running when it stopped is held, as a
   *  pause; its conversation is remembered so a resume finds it. */
  async function boot() {
    for (const saved of await buildStore.all()) {
      const docPath = saved.path;
      if (saved.conversation) byConversation.set(saved.conversation, docPath);
      if (!saved.builds?.some((b) => b.status === 'running')) continue;
      await buildStore.update(docPath, (s) => {
        for (const b of s.builds) if (b.status === 'running') { b.status = 'paused'; delete b.want; }
        return null;
      }).catch((err) => log.error(`[builds] ${err.message}`));
    }
  }

  async function move(at) {
    for (const saved of await buildStore.all()) {
      const next = at(saved.path);
      if (!next) continue;
      await buildStore.move(saved.path, next);
      for (const [conversation, docPath] of byConversation) if (docPath === saved.path) byConversation.set(conversation, next);
    }
  }

  return {
    channel,
    read,
    putMark,
    removeMarks,
    hold,
    resolve,
    archive,
    history,
    send,
    startOrJoin,
    steer,
    drawnOf,
    start,
    pause,
    resume,
    stop,
    view,
    plan,
    onEvent,
    file,
    dismissFolder,
    comment,
    talk,
    takeOffer,
    pieces,
    suggested,
    savePiece,
    removePiece: (id) => buildStore.removePiece(id),
    putImage: (bytes, type) => buildStore.putImage(bytes, type),
    image: (name) => buildStore.image(name),
    preview,
    boot,
    move,
  };
}
