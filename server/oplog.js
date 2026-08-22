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
//   {"t":1734…, "doc":"work/notes", "client":"a3f1c2", "seq":41, "type":"move", …}
//
// Nothing in G0 or G1 reads `client` or `seq`. They are here because the vision
// is right that they are two free fields now and a migration across a year of
// logs later — and because "sync over the op log" at G4 is the one thing in the
// plan that cannot be added in front of the data it needs.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { docKey, parsePath } from './paths.js';

export function createOpLog({ dir }) {
  // Per client, in this process. A client that reconnects starts again at 1 and
  // that is correct: the pair (client, seq) is only ever compared within a
  // client, and a new connection is a new client id.
  const counters = new Map();

  const next = (client) => {
    const seq = (counters.get(client) ?? 0) + 1;
    counters.set(client, seq);
    return seq;
  };

  async function append(docPath, ops, { client = 'anon', label = null } = {}) {
    if (!ops?.length) return { written: 0 };
    const clean = parsePath(docPath, { allowRoot: false });
    await fsp.mkdir(dir, { recursive: true });

    const t = Date.now();
    const lines = ops
      .map((op) => JSON.stringify({ t, doc: clean, client, seq: next(client), ...(label ? { label } : {}), ...op }))
      .join('\n');

    await fsp.appendFile(path.join(dir, `${docKey(clean)}.ops.jsonl`), `${lines}\n`);
    return { written: ops.length };
  }

  /** The tail of the log, oldest first. For a history view, and for the sync
   *  work at G4 that will want to ask "what have I not seen". */
  async function since(docPath, { after = 0, limit = 500 } = {}) {
    const clean = parsePath(docPath, { allowRoot: false });
    const log = await fsp
      .readFile(path.join(dir, `${docKey(clean)}.ops.jsonl`), 'utf8')
      .catch(() => '');

    const out = [];
    for (const line of log.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.t > after) out.push(entry);
      } catch {
        // A truncated last line is what an interrupted append looks like.
      }
    }
    return out.slice(-limit);
  }

  return { append, since, dir };
}

/** Total order over two log lines, for whoever needs one. Time first because it
 *  is what a person means by "first"; the client id last because it is
 *  arbitrary and only has to be *consistent* to break a tie. */
export const compareOps = (a, b) =>
  a.t - b.t || (a.client === b.client ? a.seq - b.seq : a.client < b.client ? -1 : 1);
