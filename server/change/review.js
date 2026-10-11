// What a turn changed, for a person to look back on: Keep it, or take it
// back.
//
// A turn's `.undo.json` already knows, step by step, what an inverse would
// put back — that is for running. `reviewPartsOf` reads the same steps the
// other way, for showing: given one path's steps (already flattened to the
// order they applied in) and the document as it stands now, which of them
// are still worth drawing, and as what. `listReview` is the host half: it
// finds the turns that touched a document and keeps the ones with something
// left to show; `conversationHasReview` asks the same question across every
// document a conversation's turns touched, which is what Keep needs before
// it can clear a conversation's launcher dot.
//
// A document is parsed once per request, however many turns and parts are
// read against it: on a large page a parse is most of a tenth of a second,
// and this is asked on every page load and every turn's end, in every tab.

import { normalizeUndo } from '../agent/undo.js';
import { idsIn, indexOf } from '../agent/source.js';

const LOOK_ATTRS = new Set(['style', 'class']);
const MAX_TURNS = 20;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PROMPT_MAX = 300;
const REVIEWABLE_STATUS = new Set(['completed', 'cancelled']);
// The most of any one part's before (or a removed part's markup) a response
// carries. Past it the page is sent the words, cut here, and `truncated`.
export const BEFORE_MAX = 20_000;

/** The children of an outer-HTML string — what's between its own open and
 *  close tag. */
function innerOf(outerHtml) {
  const openEnd = outerHtml.indexOf('>');
  const closeStart = outerHtml.lastIndexOf('<');
  if (openEnd === -1 || closeStart === -1 || closeStart <= openEnd) return '';
  return outerHtml.slice(openEnd + 1, closeStart);
}

const wordsOf = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** A before the page can be sent: whole when it is short; past `BEFORE_MAX`,
 *  its words (an attribute's value, as it is), cut. */
function bounded(text, { markup }) {
  if (text == null || text.length <= BEFORE_MAX) return { text, truncated: false };
  const cut = (markup ? wordsOf(text) : text).slice(0, BEFORE_MAX);
  return { text: cut, truncated: true };
}

/** A removed element too long to send: its own open tag, its words cut, and
 *  its close, so the page still has an element of the right kind to draw. */
function boundedOuter(html) {
  if (html.length <= BEFORE_MAX) return { html, truncated: false };
  const open = /^<([a-zA-Z][\w-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/.exec(html);
  if (!open || open[0].length > BEFORE_MAX / 2) return { html: wordsOf(html).slice(0, BEFORE_MAX), truncated: true };
  const close = `</${open[1]}>`;
  const words = wordsOf(html.slice(open[0].length)).slice(0, BEFORE_MAX - open[0].length - close.length);
  return { html: `${open[0]}${words}${close}`, truncated: true };
}

/** The id a step is about: its own, or — for a step that undoes a `remove`
 *  (so its own `id` is null) — the id the `remove` took away. Exactly one of
 *  the two is ever set. */
const keyOf = (step) => step.id ?? step.absent ?? null;

/** Which of a turn's undo steps for one path are still worth showing, and as
 *  what — pure, reading only the document as it stands now (`source`).
 *
 *  `steps` is the turn's recorded undo steps for this one path, already in
 *  the order they applied (the order `undoTurn` would walk in reverse to
 *  take them back). An id the turn touched more than once keeps only its
 *  first step — the original is what "before" means — except the check for
 *  whether the person has since changed it, which always asks the *last*
 *  step's expectation, the one closest to how the document actually stood
 *  when the turn finished.
 *
 *  `index` is `indexOf(source)`, for a caller asking of one document more
 *  than once; without one, `source` is parsed here — once, and only if a
 *  step needs it. A `before` (or a removed part's `html`) longer than
 *  `BEFORE_MAX` is sent as its words, cut, with `truncated: true`. */
export function reviewPartsOf({ source, steps, index = null }) {
  let parsed = index;
  const doc = () => (parsed ??= indexOf(source));
  const byId = new Map();
  for (const step of steps ?? []) {
    if (!step?.inverse) continue;
    const key = keyOf(step);
    if (!key) continue;
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(step);
  }

  const parts = [];
  for (const [id, group] of byId) {
    const first = group[0];
    const last = group[group.length - 1];
    const { inverse } = first;
    const removed = inverse.type === 'insert' && first.id === null;

    if (!removed) {
      const hash = doc().hashOf(id);
      if (hash === undefined) continue; // gone — nothing left to show it against
      if (last.id && hash !== last.expect) continue; // theirs now
    }

    if (removed) {
      const { html, truncated } = boundedOuter(inverse.html);
      parts.push({ id, kind: 'removed', html, parentId: inverse.parentId, beforeId: inverse.beforeId ?? null, ...(truncated ? { truncated } : {}) });
    } else if (inverse.type === 'remove') {
      parts.push({ id, kind: 'added' });
    } else if (inverse.type === 'setInner') {
      const current = innerOf(doc().outerOf(id));
      const words = idsIn(inverse.html).length === 0 && idsIn(current).length === 0;
      const { text: before, truncated } = bounded(inverse.html, { markup: true });
      parts.push({ id, kind: words ? 'words' : 'changed', before, ...(truncated ? { truncated } : {}) });
    } else if (inverse.type === 'setAttr') {
      const { text: before, truncated } = bounded(inverse.value ?? null, { markup: false });
      parts.push({ id, kind: LOOK_ATTRS.has(inverse.name) ? 'look' : 'attr', name: inverse.name, before, ...(truncated ? { truncated } : {}) });
    } else if (inverse.type === 'move') {
      parts.push({ id, kind: 'moved', parentId: inverse.parentId, beforeId: inverse.beforeId ?? null });
    }
  }
  return parts;
}

/** The steps of a turn's saved undo record that are about one path, in the
 *  order they applied — one turn's record holds one entry per `apply_ops`
 *  call, in call order, and each entry's own `steps` are already in op
 *  order, so concatenating in record order is enough. */
function stepsForPath(saved, path) {
  return saved.steps.filter((entry) => entry.path === path).flatMap((entry) => entry.steps);
}

/** The paths a turn's record touches at all: its target, and every path any
 *  of its undo steps names. */
function pathsOf(turn, saved) {
  const paths = new Set(saved.steps.map((entry) => entry.path));
  if (turn.context?.target) paths.add(turn.context.target);
  return paths;
}

/** The cheap half of "is this turn worth reviewing": everything answerable
 *  from the turn and conversation records alone, before a single document is
 *  read. Shared by `listReview` (one path, every turn) and
 *  `conversationHasReview` (every path, the rest of one conversation's
 *  turns) so the two agree on what counts. */
function isCandidate(turn, conversation, now) {
  if (!REVIEWABLE_STATUS.has(turn.status)) return false;
  if (!(turn.applied > 0)) return false;
  if (turn.undoneAt || turn.keptAt) return false;
  if (!turn.finishedAt || turn.finishedAt < now - WINDOW_MS) return false;
  const reviewedAt = conversation.lastReviewedAt;
  if (!(reviewedAt === null || reviewedAt === undefined || reviewedAt < turn.finishedAt)) return false;
  return true;
}

/** Every turn still worth reviewing for one document: newest first, at most
 *  20, finished in the last 30 days. `read` is how the current document is
 *  read — `(path) => Promise<string|null>`. */
export async function listReview({ store, docPath, read }) {
  const source = await read(docPath);
  if (source == null) return { turns: [] };
  // Parsed the first time a turn needs it, then shared by every turn.
  let index = null;
  const doc = () => (index ??= indexOf(source));

  const now = Date.now();
  const candidates = [];
  for (const conversation of await store.conversations()) {
    for (const turn of await store.turns(conversation.id)) {
      if (!isCandidate(turn, conversation, now)) continue;
      const target = turn.context?.target ?? null;
      const saved = normalizeUndo(await store.undoRecords(turn.id));
      if (target !== docPath && !saved.steps.some((entry) => entry.path === docPath)) continue;

      const parts = reviewPartsOf({ source, steps: stepsForPath(saved, docPath), index: doc() });
      if (!parts.length) continue;

      candidates.push({
        id: turn.id,
        conversationId: turn.conversationId,
        prompt: String(turn.prompt ?? '').slice(0, PROMPT_MAX),
        finishedAt: turn.finishedAt,
        parts,
      });
    }
  }

  candidates.sort((a, b) => b.finishedAt - a.finishedAt);
  return { turns: candidates.slice(0, MAX_TURNS) };
}

/** Whether any turn of `conversationId` other than `excludeTurnId` is still
 *  listed for some path — the question Keep asks before it clears the
 *  conversation's launcher dot. `read` is the same document reader
 *  `listReview` takes; a path it cannot read is skipped, not counted. */
export async function conversationHasReview({ store, read, conversationId, excludeTurnId = null }) {
  const conversation = await store.conversation(conversationId);
  if (!conversation) return false;

  const now = Date.now();
  // Each path read and parsed once, however many turns touched it.
  const docs = new Map();
  const docOf = async (path) => {
    if (!docs.has(path)) {
      const source = await read(path).catch(() => null);
      docs.set(path, source == null ? null : indexOf(source));
    }
    return docs.get(path);
  };
  for (const turn of await store.turns(conversationId)) {
    if (turn.id === excludeTurnId) continue;
    if (!isCandidate(turn, conversation, now)) continue;

    const saved = normalizeUndo(await store.undoRecords(turn.id));
    for (const path of pathsOf(turn, saved)) {
      const index = await docOf(path);
      if (!index) continue;
      if (reviewPartsOf({ source: index.source, steps: stepsForPath(saved, path), index }).length) return true;
    }
  }
  return false;
}
