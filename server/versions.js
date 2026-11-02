// Every document has a version, and every edit names the one it was made on.
//
// A document's version `v` is a whole number this host owns. Every batch that
// lands on it — a person's ops, an agent's, an outside write the watcher took
// in, a restore, a create — makes it one more, and a batch that changes
// nothing (all of it dropped, or a replay) leaves it alone. A page is served
// with the version its bytes are (`<meta name="marble-version">`), sends that
// version as the `base` of every batch it forms, and hears every other batch
// as a frame carrying the version it made. So when a batch arrives the host
// knows exactly which batches its sender had not seen: those after its base,
// from anybody else. Those are what it is rebased over (server/rebase.js).
//
// What is kept, per document:
//
//   - `v`, durable in the op log: every line of a batch carries it
//     (server/oplog.js), and on start a document's version is the newest line's.
//   - a ring of the last batches (RING_BATCHES, or RING_BYTES of them,
//     whichever is fewer): each one's version, who sent it, its canonical ops
//     and the change record the rebase needs. A batch whose base is older
//     than the ring is rebased over nothing and answered `stale: true`
//     (the records hold what elements said before each change, which the op
//     log does not, so it cannot stand in for them). The ring is also the
//     first place catch-up (`GET /ops?since`) looks; the op log the second.
//   - the document engine (`openDocument`), kept open between batches with
//     the bytes it was last written with and the file's fingerprint at that
//     moment: a batch costs no read and no parse while the file is still the
//     one this host wrote.
//
// Nothing here writes a file. server/app.js does that, inside each document's
// queue, and tells this module what landed.

const RING_BATCHES = 2000;
const RING_BYTES = 64 * 1024 * 1024;

const envNumber = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 && process.env[name] !== '' ? n : fallback;
};

/** What kind of writer a client is, for frames and records. */
export function byOf(client) {
  const c = String(client ?? '');
  if (c.startsWith('agent:') || c.startsWith('agent-undo:') || c === 'agent') return 'agent';
  if (c === 'outside') return 'outside';
  if (c === 'restore') return 'restore';
  return 'person';
}

// A rough size of what a ring entry holds, for the byte budget.
const sizeOf = (entry) => {
  let n = 64;
  try {
    n += JSON.stringify(entry.ops ?? []).length;
    n += JSON.stringify(entry.record ?? null).length;
  } catch {
    n += 1024;
  }
  return n;
};

export function createVersions({ oplog, log = console, ringBatches = null, ringBytes = null } = {}) {
  const docs = new Map(); // docPath → state
  const maxBatches = () => ringBatches ?? envNumber('MARBLE_SYNC_RING_BATCHES', RING_BATCHES);
  const maxBytes = () => ringBytes ?? envNumber('MARBLE_SYNC_RING_BYTES', RING_BYTES);

  /** The state of a document, its version read from the op log the first
   *  time it is asked for. */
  async function stateOf(docPath) {
    let state = docs.get(docPath);
    if (state) {
      if (state.loading) await state.loading;
      return state;
    }
    state = { v: 0, ring: [], ringBytes: 0, floor: 0, source: null, doc: null, fp: null, loading: null };
    docs.set(docPath, state);
    state.loading = (async () => {
      try {
        state.v = await oplog.lastVersion(docPath);
      } catch (err) {
        log.error?.(`[versions] could not read the version of ${docPath}: ${err.message}`);
        state.v = 0;
      }
      // Nothing before this version is in the ring.
      state.floor = state.v;
      state.loading = null;
    })();
    await state.loading;
    return state;
  }

  /** The version a document is at now. */
  const current = async (docPath) => (await stateOf(docPath)).v;

  /** Is a version known to be in memory? Without loading. */
  const peek = (docPath) => {
    const state = docs.get(docPath);
    return state && !state.loading ? state.v : null;
  };

  /** A batch landed: version up by one, and its entry kept on the ring.
   *  Call only inside the document's queue. Returns the new version. */
  // `reload`: a batch with ops and a record (it is rebased over like any
  // other) that a copy can still only settle by reloading: catch-up across it
  // is a reset.
  function landed(state, { client, batch = null, by = byOf(client), ops = null, record = null, reset = false, reload = false }) {
    state.v += 1;
    const entry = { v: state.v, client: client ?? 'anon', batch, by, ops: reset ? null : ops ?? [], record, reset: Boolean(reset), reload: Boolean(reload) };
    entry.size = sizeOf(entry);
    state.ring.push(entry);
    state.ringBytes += entry.size;
    while (state.ring.length > 1 && (state.ring.length > maxBatches() || state.ringBytes > maxBytes())) {
      const old = state.ring.shift();
      state.ringBytes -= old.size;
      state.floor = old.v;
    }
    return state.v;
  }

  /** The change records a batch from `client` made on `base` has to be
   *  rebased over: everything after `base` from anybody else, oldest first.
   *  `{ concurrent, stale }`; `stale` when the ring no longer reaches back to
   *  `base` (then `concurrent` is empty: treated as made on the current
   *  version). A whole-document reset in the range (a restore, an outside
   *  write no op could say) is a new start: only what came after it counts. */
  function concurrentFor(state, base, client) {
    if (!Number.isInteger(base) || base >= state.v) return { concurrent: [], stale: false, ahead: Number.isInteger(base) && base > state.v };
    if (base < state.floor) return { concurrent: [], stale: true };
    let from = state.ring.findIndex((entry) => entry.v > base);
    if (from < 0) return { concurrent: [], stale: false };
    for (let i = state.ring.length - 1; i >= from; i -= 1) {
      if (state.ring[i].reset && state.ring[i].client !== client) {
        from = i + 1;
        break;
      }
    }
    const concurrent = [];
    for (let i = from; i < state.ring.length; i += 1) {
      const entry = state.ring[i];
      if (entry.client === client || !entry.record) continue;
      concurrent.push(entry.record);
    }
    return { concurrent, stale: false };
  }

  /** The batches after `since`, oldest first, for catch-up: from the ring
   *  when it reaches back that far, else from the op log. `{ v, batches }`,
   *  or `{ v, reset: true }` when the host can no longer produce them (or
   *  one of them was a whole-document reset, which has no ops to replay). */
  async function since(docPath, since) {
    const state = await stateOf(docPath);
    const v = state.v;
    if (!Number.isInteger(since) || since < 0 || since > v) return { v, reset: true };
    if (since === v) return { v, batches: [] };
    let batches = null;
    if (since >= state.floor) {
      batches = state.ring.filter((entry) => entry.v > since).map(({ v: at, client, batch, by, ops, reset, reload }) => ({ v: at, client, batch, by, ops, ...(reset || reload ? { reset: true } : {}) }));
    } else {
      batches = await oplog.versionsSince(docPath, since, { upTo: v }).catch((err) => {
        log.error?.(`[versions] catch-up for ${docPath} from the op log failed: ${err.message}`);
        return null;
      });
    }
    if (!batches || batches.length !== v - since || batches.some((b) => b.reset || !Array.isArray(b.ops))) return { v, reset: true };
    return { v, batches };
  }

  /** A document or folder moved: the versions of what it held follow the
   *  name, as their op logs do. */
  function move(from, to) {
    for (const key of [...docs.keys()]) {
      const moved = key === from ? to : key.startsWith(`${from}/`) ? to + key.slice(from.length) : null;
      if (moved === null) continue;
      docs.set(moved, docs.get(key));
      docs.delete(key);
    }
  }

  /** A batch says it was made on a version this host has not reached: its
   *  versions went back (a log line lost in a crash, a restore of `.marble`
   *  from a backup). The version goes on from the page's, so no version is
   *  ever handed out twice; nothing is kept for the ones skipped, so catch-up
   *  across them is a reset. */
  function reach(state, base) {
    // Far past it is not a lost line but a page that is wrong: ignored.
    if (!Number.isInteger(base) || base <= state.v || base - state.v > 10_000) return false;
    state.v = base;
    state.floor = base;
    state.ring = [];
    state.ringBytes = 0;
    return true;
  }

  /** A document is gone: forget what is kept in memory (its log stays, so a
   *  document made again at this name goes on from its last version). */
  const forget = (docPath) => docs.delete(docPath);

  return { stateOf, current, peek, landed, concurrentFor, since, move, reach, forget, byOf };
}
