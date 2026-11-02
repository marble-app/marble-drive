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

const CHUNK = 1024 * 1024;

/** Lines from the end of a file, newest first, read backwards a chunk at a
 *  time: stops at `want` lines, at a line no later than `after`, or once
 *  `maxBytes` have been read. A 300 MB log written before segments existed
 *  costs what is asked of it. Splits on the newline byte, which never occurs
 *  inside a multi-byte UTF-8 character. */
export async function tailLines(file, { want = Infinity, after = 0, maxBytes = Infinity, keep = null, until = null } = {}) {
  const handle = await fsp.open(file, 'r').catch(() => null);
  if (!handle) return [];
  const out = [];
  try {
    const { size } = await handle.stat();
    const floor = Number.isFinite(maxBytes) ? Math.max(0, size - maxBytes) : 0;
    let pos = size;
    let carry = Buffer.alloc(0);
    while (pos > floor && out.length < want) {
      const len = Math.min(CHUNK, pos - floor);
      pos -= len;
      const buf = Buffer.alloc(len);
      await handle.read(buf, 0, len, pos);
      let data = carry.length ? Buffer.concat([buf, carry]) : buf;
      // Unless this chunk starts the file (or the window), its first line is
      // only the end of one: kept for the next read back.
      let start = 0;
      if (pos > floor) {
        start = data.indexOf(10) + 1;
        if (start === 0) {
          carry = data;
          continue;
        }
        carry = data.subarray(0, start - 1);
      } else {
        carry = Buffer.alloc(0);
        // A window cut mid-line starts with a fragment; JSON.parse drops it.
      }
      const lines = data.subarray(start).toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (!lines[i].trim()) continue;
        let entry;
        try {
          entry = JSON.parse(lines[i]);
        } catch {
          continue; // a truncated line: an interrupted append, or the window's edge
        }
        if (entry.t <= after) return out;
        // `until`: the first line it is true of ends the read, unkept, and the
        // answer says so (`stopped`).
        if (until?.(entry)) {
          out.stopped = true;
          return out;
        }
        if (keep && !keep(entry)) continue;
        out.push(entry);
        if (out.length >= want) return out;
      }
      data = null;
    }
    return out;
  } finally {
    await handle.close();
  }
}

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

  // `v` is the document's version once this batch has landed, the same on
  // every line of the batch (server/versions.js); `by` says what kind of
  // writer it was (person, agent, outside, restore); `fixed` that the sender's
  // own copy had to be corrected (its answer carried fixes), so a retry after
  // a restart knows to reload. A batch with no ops to show for it (a restore,
  // a create, an outside write no op could express) is one marker line,
  // `type: "reset"`, which carries its version and nothing to replay.
  async function append(docPath, ops, { client = 'anon', label = null, batch = null, v = null, by = null, fixed = false, reload = false } = {}) {
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
        ...(Number.isInteger(v) ? { v } : {}),
        ...(by ? { by } : {}),
        ...(fixed ? { fixed: true } : {}),
        ...(reload ? { reload: true } : {}),
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

  /** A batch that has no ops to log — a restore, a create, an outside write
   *  no op could express — still has a version, and the log is where versions
   *  live: one marker line. */
  //
  // `type: "noop"` is a batch that applied nothing but still took a version
  // (its sender's fixes are placed at it): it replays as a batch with no ops.
  async function mark(docPath, { client = 'anon', v, by = null, batch = null, label = null, type = 'reset', reload = false } = {}) {
    return append(docPath, [{ type }], { client, v, by, batch, label, fixed: type === 'noop', reload });
  }

  /** The tail of the log, oldest first. Reads the active segment, then sealed
   *  ones newest first, each from its end, and stops as soon as it has `limit`
   *  lines after `after` — so a long-lived document's history costs what is
   *  asked for, not its whole life. Its reader today is build mode's History
   *  (server/build). Version markers (`type: "reset"`) are left out unless
   *  `markers` asks for them: they are not edits anybody made. */
  async function since(docPath, { after = 0, limit: want = 500, markers = false } = {}) {
    const clean = parsePath(docPath, { allowRoot: false });
    const keep = markers ? null : (entry) => entry.type !== 'reset' && entry.type !== 'noop';
    const newest = await tailLines(activeFile(clean), { want, after, keep });
    if (newest.length < want) {
      for (const segment of await segments(clean)) {
        if (segment.last <= after) break;
        newest.push(...(await tailLines(segment.file, { want: want - newest.length, after, keep })));
        if (newest.length >= want) break;
      }
    }
    return newest.reverse();
  }

  /** Every line newest first across the active segment and then the sealed
   *  ones, until `stop(entry)` says enough (or the log ends). */
  async function walkBack(clean, stop, { maxBytes = Infinity } = {}) {
    const files = [activeFile(clean), ...(await segments(clean)).map((s) => s.file)];
    const out = [];
    let read = 0;
    for (const file of files) {
      const lines = await tailLines(file, { until: stop, maxBytes: maxBytes - read });
      out.push(...lines);
      if (lines.stopped) return { lines: out, stopped: true };
      const info = await fsp.stat(file).catch(() => null);
      read += info?.size ?? 0;
      if (read >= maxBytes) break;
    }
    return { lines: out, stopped: false };
  }

  /** The document's version as the log last said it: the `v` of its newest
   *  line, from the active segment or, when that is empty, the newest sealed
   *  one. 0 for a document whose log has none (never written, or only ever
   *  written before versions existed). */
  async function lastVersion(docPath) {
    const clean = parsePath(docPath, { allowRoot: false });
    for (const file of [activeFile(clean), ...(await segments(clean)).map((s) => s.file)]) {
      const [newest] = await tailLines(file, { want: 1 });
      if (newest) return Number.isInteger(newest.v) ? newest.v : 0;
    }
    return 0;
  }

  /** The batches after version `after`, oldest first: `[{ v, client, batch,
   *  by, ops, reset? }]`. `null` when the log cannot say: a version in the
   *  range has no lines (lost, or written before versions), or reading back
   *  would pass `maxBytes`. A batch that was a marker (`reset`) is returned
   *  with `reset: true` and no ops. */
  async function versionsSince(docPath, after, { upTo = Infinity, maxBytes = 64 * 1024 * 1024 } = {}) {
    const clean = parsePath(docPath, { allowRoot: false });
    const { lines, stopped } = await walkBack(clean, (entry) => !Number.isInteger(entry.v) || entry.v <= after, { maxBytes });
    if (!stopped && after > 0) return null;
    const byV = new Map();
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const { t, doc, client, seq, batch, v, by, fixed, reload, label, ...op } = lines[i];
      if (v > upTo) continue;
      let entry = byV.get(v);
      if (!entry) {
        entry = { v, client, batch: batch ?? null, by: by ?? null, ops: [] };
        byV.set(v, entry);
      }
      if (op.type === 'reset' || reload) entry.reset = true;
      if (op.type !== 'reset' && op.type !== 'noop') entry.ops.push(op);
    }
    const out = [...byV.values()].sort((a, b) => a.v - b.v);
    // Every version from after+1 up, with none missing.
    for (let i = 0; i < out.length; i += 1) if (out[i].v !== after + 1 + i) return null;
    return out;
  }

  /** The batch ids in the active segment, with how many ops each filed and
   *  who filed it — what a restart rebuilds its "already landed" set from.
   *  Only the last segment's worth of bytes is read: a log from before
   *  segments existed holds no batch ids, and may be hundreds of MB. */
  async function batches(docPath) {
    const clean = parsePath(docPath, { allowRoot: false });
    const out = new Map();
    const lines = await tailLines(activeFile(clean), { maxBytes: limit() });
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const entry = lines[i];
      if (typeof entry.batch !== 'string' || entry.type === 'reset') continue;
      const seen = out.get(entry.batch);
      // A batch that applied nothing still landed (and took a version).
      if (entry.type === 'noop') {
        if (!seen) out.set(entry.batch, { applied: 0, t: entry.t, client: entry.client, v: Number.isInteger(entry.v) ? entry.v : null, fixed: true });
        continue;
      }
      if (seen) seen.applied += 1;
      else out.set(entry.batch, { applied: 1, t: entry.t, client: entry.client, v: Number.isInteger(entry.v) ? entry.v : null, fixed: Boolean(entry.fixed) });
    }
    return out;
  }

  /** A document moved: its active segment's bookkeeping follows the name
   *  (the files themselves are renamed by the store). */
  function move(from, to) {
    active.delete(from);
    active.delete(to);
  }

  return { append, mark, since, lastVersion, versionsSince, batches, segments: (docPath) => segments(parsePath(docPath, { allowRoot: false })), move, dir };
}

/** Total order over two log lines, for whoever needs one. Time first because it
 *  is what a person means by "first"; the client id last because it is
 *  arbitrary and only has to be *consistent* to break a tie. */
export const compareOps = (a, b) =>
  a.t - b.t || (a.client === b.client ? a.seq - b.seq : a.client < b.client ? -1 : 1);
