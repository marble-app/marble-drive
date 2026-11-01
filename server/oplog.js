// The op log, with the two fields that make it orderable.
//
// Marble's host writes `{t, …op}` — a timestamp and the operation. That is
// enough to read back what happened and not enough to say what happened first.
// Two clients whose clocks differ by 40ms, which is every pair of clients, are
// unorderable by `t` alone; and a client that files two ops inside one
// millisecond, which a drag does constantly, is unorderable by `t` even against
// itself.
//
// So every line here also carries who filed it and their count of it:
//
//   {"t":1734…, "doc":"work/notes", "client":"a3f1c2", "seq":41, "batch":"b7…", "type":"move", …}
//
// `batch` is the id the page gave the POST the op came in (absent when it gave
// none). Unlike `seq`, which this process counts and a restart starts again, it
// means the same thing after a restart: it is how the host knows a retried
// batch has already landed (server/app.js, `batches`).
//
// A log is kept in segments (docs/OPLOG.md). The active one is
// `.marble/<docKey>.ops.jsonl`; once it passes MARBLE_OPLOG_SEGMENT_BYTES it
// is renamed, whole, to `.marble/<docKey>@<firstT>-<lastT>.ops.jsonl` and never
// written again, so a sync that uploads changed files uploads it once. `@`
// cannot appear in a document's name (server/paths.js), so the two never mix.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { docKey, parsePath } from './paths.js';

const SEGMENT_BYTES = 4 * 1024 * 1024;

const segmentBytes = () => {
  const n = Number(process.env.MARBLE_OPLOG_SEGMENT_BYTES);
  return Number.isFinite(n) && n > 0 ? n : SEGMENT_BYTES;
};

/** `<docKey>@<firstT>-<lastT>.ops.jsonl` → { first, last }, or null. */
export function sealedName(name, key) {
  if (!name.startsWith(`${key}@`) || !name.endsWith('.ops.jsonl')) return null;
  const m = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(name.slice(key.length + 1, -'.ops.jsonl'.length));
  return m ? { first: Number(m[1]), last: Number(m[2]) } : null;
}

const parseLines = (text) => {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A truncated last line is what an interrupted append looks like.
    }
  }
  return out;
};

export function createOpLog({ dir, maxBytes = null }) {
  // Per client, in this process. A client that reconnects starts again at 1 and
  // that is correct: the pair (client, seq) is only ever compared within a
  // client, and a new connection is a new client id.
  const counters = new Map();
  // Active segment size and first `t`, per document, once looked at. Saves a
  // stat on every append; the file is only ever grown through here.
  const active = new Map();
  const limit = () => maxBytes ?? segmentBytes();

  const next = (client) => {
    const seq = (counters.get(client) ?? 0) + 1;
    counters.set(client, seq);
    return seq;
  };

  const activeFile = (clean) => path.join(dir, `${docKey(clean)}.ops.jsonl`);

  async function firstT(file) {
    const handle = await fsp.open(file, 'r').catch(() => null);
    if (!handle) return null;
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
      const head = buffer.subarray(0, bytesRead).toString('utf8').split('\n')[0];
      return Number(/"t":(\d+)/.exec(head)?.[1]) || null;
    } finally {
      await handle.close();
    }
  }

  async function stateOf(clean) {
    if (active.has(clean)) return active.get(clean);
    const file = activeFile(clean);
    const info = await fsp.stat(file).catch(() => null);
    const state = { bytes: info?.size ?? 0, first: info?.size ? await firstT(file) : null, last: null };
    active.set(clean, state);
    return state;
  }

  /** Rename the active segment out of the way; the next append starts a new one. */
  async function seal(clean, state, now) {
    const key = docKey(clean);
    const file = activeFile(clean);
    const first = state.first ?? now;
    const last = state.last ?? now;
    let target = path.join(dir, `${key}@${first}-${last}.ops.jsonl`);
    // Two segments that share both ends (a burst sealed twice inside one ms)
    // get a counter rather than overwrite each other.
    for (let n = 2; await fsp.access(target).then(() => true, () => false); n += 1) {
      target = path.join(dir, `${key}@${first}-${last}-${n}.ops.jsonl`);
    }
    await fsp.rename(file, target);
    active.set(clean, { bytes: 0, first: null, last: null });
    return target;
  }

  async function append(docPath, ops, { client = 'anon', label = null, batch = null } = {}) {
    if (!ops?.length) return { written: 0 };
    const clean = parsePath(docPath, { allowRoot: false });
    await fsp.mkdir(dir, { recursive: true });

    const t = Date.now();
    const lines = `${ops
      .map((op) => JSON.stringify({
        t,
        doc: clean,
        client,
        seq: next(client),
        ...(batch ? { batch } : {}),
        ...(label ? { label } : {}),
        ...op,
      }))
      .join('\n')}\n`;

    const state = await stateOf(clean);
    // A log that is already over the line — every log written before segments
    // existed — is sealed on its next append, before this batch joins it.
    let sealed = null;
    if (state.bytes > 0 && state.bytes >= limit()) sealed = await seal(clean, state, t);
    const now = active.get(clean);

    await fsp.appendFile(activeFile(clean), lines);
    now.bytes += Buffer.byteLength(lines);
    now.first ??= t;
    now.last = t;
    return { written: ops.length, ...(sealed ? { sealed } : {}) };
  }

  /** Sealed segments of a document, newest first. */
  async function segments(clean) {
    const key = docKey(clean);
    const names = await fsp.readdir(dir).catch(() => []);
    return names
      .map((name) => ({ name, at: sealedName(name, key) }))
      .filter((s) => s.at)
      .sort((a, b) => b.at.first - a.at.first || b.at.last - a.at.last || (a.name < b.name ? 1 : -1))
      .map((s) => ({ file: path.join(dir, s.name), ...s.at }));
  }

  /** The tail of the log, oldest first. Reads the active segment, then sealed
   *  ones newest first, and stops as soon as it has `limit` lines after `after`
   *  — so a long-lived document's history costs what is asked for, not its
   *  whole life. Its reader today is build mode's History (server/build). */
  async function since(docPath, { after = 0, limit: want = 500 } = {}) {
    const clean = parsePath(docPath, { allowRoot: false });
    const chunks = [];
    let count = 0;
    const take = (lines) => {
      const kept = lines.filter((entry) => entry.t > after);
      chunks.unshift(kept);
      count += kept.length;
    };
    take(parseLines(await fsp.readFile(activeFile(clean), 'utf8').catch(() => '')));
    if (count < want) {
      for (const segment of await segments(clean)) {
        if (segment.last <= after) break;
        take(parseLines(await fsp.readFile(segment.file, 'utf8').catch(() => '')));
        if (count >= want) break;
      }
    }
    return chunks.flat().slice(-want);
  }

  /** The batch ids in the active segment, oldest first, with how many ops each
   *  filed — what a restart rebuilds its "already landed" set from. */
  async function batches(docPath) {
    const clean = parsePath(docPath, { allowRoot: false });
    const text = await fsp.readFile(activeFile(clean), 'utf8').catch(() => '');
    const out = new Map();
    if (!text.includes('"batch":')) return out;
    for (const entry of parseLines(text)) {
      if (typeof entry.batch !== 'string') continue;
      const seen = out.get(entry.batch);
      if (seen) seen.applied += 1;
      else out.set(entry.batch, { applied: 1, t: entry.t, client: entry.client });
    }
    return out;
  }

  /** A document moved: its active segment's bookkeeping follows the name
   *  (the files themselves are renamed by the store). */
  function move(from, to) {
    active.delete(from);
    active.delete(to);
  }

  return { append, since, batches, segments: (docPath) => segments(parsePath(docPath, { allowRoot: false })), move, dir };
}

/** Total order over two log lines, for whoever needs one. Time first because it
 *  is what a person means by "first"; the client id last because it is
 *  arbitrary and only has to be *consistent* to break a tie. */
export const compareOps = (a, b) =>
  a.t - b.t || (a.client === b.client ? a.seq - b.seq : a.client < b.client ? -1 : 1);
