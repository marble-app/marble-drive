// The one place in this repo that reaches into the Marble package.
//
// Marble is the format and the machinery: it knows how to splice a byte range
// addressed by node id, how to refuse a batch that would destroy something, how
// to keep a gzipped restore point, and how to turn a gesture into ops with a
// model. None of that is Drive work, and reimplementing it here would be two
// answers to the same question.
//
// What it does not know about is folders, so everything above this line is the
// Drive's and everything below it is Marble's. Keeping the import in one module
// means the boundary is a file you can read rather than a habit spread across
// twenty of them — and when Marble grows the subpath exports for these, this is
// the only file that changes.
//
// Resolved by file URL rather than by package specifier on purpose: the package
// exports `./patcher` and little else today, and a file URL is not filtered by
// an exports map. `@bdhmin/marble/package.json` *is* exported, which is what
// gives us the package root to resolve against.

const ROOT = new URL('./', import.meta.resolve('@bdhmin/marble/package.json'));

const load = (relative) => import(new URL(relative, ROOT).href);

const [patcher, guard, history, ops, intent, providers, scaffold] = await Promise.all([
  load('server/patcher.js'),
  load('server/guard.js'),
  load('server/history.js'),
  load('server/ops-schema.js'),
  load('server/intent.js'),
  load('server/providers/index.js'),
  load('bin/scaffold.js'),
]);

/** Absolute path to a file inside the Marble package — the carrier, the
 *  affordance library, the starter template. Read, never imported: these are
 *  served to a browser or spliced into a new document as text. */
export const enginePath = (relative) => new URL(relative, ROOT).pathname;

export const { applyOp, applyOps, knownIds } = patcher;
export const { guardOps } = guard;
export const {
  bytesOf,
  checkpoint,
  listCheckpoints,
  prune,
  readCheckpoint,
  readIndex,
  shaOf,
  writeAtomic,
} = history;
export const { OP_TYPES } = ops;
export const { resolveIntent } = intent;
export const { chooseProvider, loadProvider } = providers;
// The cut-point reader for `lib/affordances.js`. The gallery composes starters
// out of those parts rather than keeping a fourth copy of them.
export const { readParts } = scaffold;
