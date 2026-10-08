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
import { indexOf } from '../agent/source.js';
import { buildBrief, resumeBrief } from './brief.js';
import { outlineOf, pieceFrom, previewOf } from './pieces.js';
import { cleanMark, cleanPlan, newId, shaOf } from './store.js';

const TERMINAL = new Set(['turn.completed', 'turn.failed', 'turn.cancelled']);
const STOP_WAIT = 15_000;
const TITLE_MAX = 48;
const UNTITLED = /^Untitled( \d+)?$/;
// A drawing is the drawer's widget, at most 40k characters (drawer.js).
const DRAWN_MAX = 40_000;

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

export function createBuilds({ buildStore, store, runner, agentStore, hub, startConversation, defaultProvider, putDocument, moveDocument = null, freePath = null, reply = null, suggest = null, driveRegions = null, log = console }) {
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
        if (prior.type === 'comment') { mark.thread = prior.thread; mark.resolved = Boolean(prior.resolved); }
        state.marks[at] = mark;
      } else {
        if (mark.type === 'comment') { mark.thread = mark.thread.filter((line) => line.who === 'you'); mark.resolved = false; }
        delete mark.held;
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

  /** A comment resolved, or opened again. */
  async function resolve(docPath, id, resolved, { client = null } = {}) {
    await change(docPath, (state) => {
      const mark = state.marks.find((m) => m.id === id && m.type === 'comment');
      if (!mark) throw httpError(404, 'That comment is gone');
      mark.resolved = Boolean(resolved);
      return null;
    }, { by: client });
    return read(docPath);
  }

  /** A build's last drawing, for a build picked in Builds. */
  async function drawnOf(docPath, id) {
    const state = await buildStore.read(docPath);
    const build = find(state, id);
    return { drawn: build.drawn ?? null };
  }

  // ----------------------------------------------------------------- builds

  async function conversationFor(state, docPath) {
    if (state.conversation && await agentStore.conversation(state.conversation)) return state.conversation;
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

  async function start(docPath, { marks: chosen = null, words = '', anchor = null, client = null } = {}) {
    const source = await store.read(docPath);
    if (source === null) throw httpError(404, `no document "${docPath}"`);
    const startSha = await buildStore.putSnapshot(source);

    // First, settled under the state's own lock: which marks this build
    // takes, its number, and that no other build is running.
    const { state, result: build } = await buildStore.update(docPath, async (state) => {
      if (state.builds.some((b) => b.status === 'running')) throw httpError(409, 'A build is running already');
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
      const taken = state.marks.filter((m) => m.state === 'waiting' && m.type !== 'comment' && (wanted ? wanted.has(m.id) : !m.held));
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
      const conversation = await conversationFor(state, docPath);
      const taken = state.marks.filter((m) => build.marks.includes(m.id));
      const context = state.marks.filter((m) => m.type === 'comment' && m.state === 'waiting' && !m.resolved);
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
      });
      const anchors = [...new Set(taken.map((m) => m.anchorId).filter((id) => id && index.has(id)))].slice(0, 20);
      byConversation.set(conversation, docPath);
      const sent = await runner.send(conversation, {
        prompt,
        context: { viewing: docPath, target: docPath, selection: anchors, also: [] },
      });
      const { state: next } = await change(docPath, (s) => {
        s.conversation = conversation;
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
    const back = await buildStore.snapshot(build.start);
    if (back !== null && back !== source) await putDocument(docPath, back, { label: 'before-restore', event: 'changed' });
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
        for (const m of s.marks) if (m.build === b.id) m.state = 'built';
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
    if (named && moveDocument && freePath) await name(docPath, named).catch((err) => log.error(`[builds] naming failed: ${err.message}`));
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
  async function comment(docPath, id, text, { client = null } = {}) {
    const words = String(text ?? '').trim().slice(0, 2_000);
    if (!words) throw httpError(400, 'Say something first');
    const { state, result: mark } = await change(docPath, (s) => {
      const m = s.marks.find((x) => x.id === id && x.type === 'comment');
      if (!m) throw httpError(404, 'That comment is gone');
      m.thread = [...(m.thread ?? []).filter((line) => !line.pending), { who: 'you', text: words, at: Date.now() }, { who: 'agent', text: '', pending: true, at: Date.now() }];
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
    takeOffer,
    pieces,
    suggested,
    savePiece,
    removePiece: (id) => buildStore.removePiece(id),
    preview,
    boot,
    move,
  };
}
