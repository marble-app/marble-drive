// Uploads that survive the link they travel over.
//
// One request per file is fine for a song over a laptop's Wi-Fi and wrong for a
// 4 GB video from a phone: a dropped connection loses all of it, and a proxy
// with a per-request limit caps it. So a big file goes up as a session — the
// page asks to start one, sends chunks at the offsets the host says it has,
// and asks the host to finish. Each chunk is an ordinary short request.
//
//   start({ folder, name, bytes, modified }) → { id, chunk, received }
//   append(id, offset, stream)               → { received }   409 names `received`
//   status(id)                               → { received, bytes }
//   finish(id)                               → { path, bytes }
//   cancel(id)
//   sweep({ now })                           → how many sessions were dropped
//
// A session is a JSON record and a part file, both in `.marble/uploads/` —
// under the drive root, so on its volume (finishing is a link, not a copy),
// and in a dotted folder, so nothing half-arrived is ever listed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { joinPath, parsePath, safePath, safeSegment } from './paths.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ID = /^[0-9a-f]{24}$/;

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** A name as the drive will take it: the stem and the extension cleaned
 *  apart, so brackets the path grammar refuses do not strand a space before
 *  the `.mp3`. A document's name is refused — it goes to /drive/upload. */
export function cleanFileName(wanted) {
  const raw = String(wanted ?? '');
  if (/\.(mrbl|html?)$/i.test(raw)) throw fail(400, `"${raw}" is a document — send it to /drive/upload`);
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot + 1).replace(/[^a-z0-9]/gi, '').slice(0, 16) : '';
  const stem = safeSegment(dot > 0 ? raw.slice(0, dot) : raw);
  return ext ? `${stem}.${ext}` : stem;
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`;

export function createUploads({ store, maxBytes, chunkBytes, marginBytes, freePath, now = Date.now }) {
  const dir = path.join(store.marbleDir, 'uploads');
  const recordAt = (id) => path.join(dir, `${id}.json`);
  const partAt = (id) => path.join(dir, `${id}.part`);

  // One thing at a time per session: two chunks racing for one offset is how
  // a file gets a byte twice.
  const chains = new Map();
  const serial = (id, task) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(task, task);
    chains.set(id, next.catch(() => {}));
    return next;
  };

  async function read(id) {
    if (!ID.test(String(id))) throw fail(404, 'no such upload');
    try {
      return JSON.parse(await fsp.readFile(recordAt(id), 'utf8'));
    } catch {
      throw fail(404, 'no such upload');
    }
  }
  const save = async (record) => {
    const tmp = `${recordAt(record.id)}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(record));
    await fsp.rename(tmp, recordAt(record.id));
  };
  const sizeOf = async (id) => (await fsp.stat(partAt(id)).catch(() => null))?.size ?? 0;

  /** Refused up front when the file could not fit: above the cap, or above
   *  what the drive's volume has left once a margin is kept back. */
  async function room(bytes) {
    if (bytes > maxBytes) throw fail(413, `too large for this drive — the most it takes in one file is ${gb(maxBytes)}`);
    const free = await freeBytes();
    if (free !== null && bytes > free - marginBytes) {
      throw fail(507, `not enough room on this drive: ${gb(Math.max(0, free - marginBytes))} left for a ${gb(bytes)} file`);
    }
  }
  async function freeBytes() {
    try {
      const s = await fsp.statfs(store.root);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  }

  async function start({ folder = '', name, bytes, modified = null } = {}) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw fail(400, 'bytes must be a whole number');
    const clean = cleanFileName(name);
    const into = parsePath(safePath(folder ?? ''));
    joinPath(into, clean);
    await room(bytes);
    await fsp.mkdir(dir, { recursive: true });
    const id = crypto.randomBytes(12).toString('hex');
    await fsp.writeFile(partAt(id), '', { flag: 'wx' });
    const record = { id, folder: into, name: clean, bytes, modified, updated: now() };
    await save(record);
    return { id, chunk: chunkBytes, received: 0 };
  }

  function append(id, offset, input) {
    return serial(id, async () => {
      const record = await read(id);
      const received = await sizeOf(id);
      if (Number(offset) !== received) {
        input.resume?.();
        throw fail(409, `the host has ${received} bytes of this file`, { received });
      }
      let added = 0;
      try {
        await pipeline(
          input,
          async function* (source) {
            for await (const chunk of source) {
              added += chunk.length;
              if (received + added > record.bytes) throw fail(413, `more than the ${record.bytes} bytes this upload said it was`);
              yield chunk;
            }
          },
          fs.createWriteStream(partAt(id), { flags: 'a' }),
        );
      } catch (err) {
        // Whatever of a chunk that was cut off did land is kept only if the
        // chunk was honest; one that ran over is taken back to where it began.
        if (err.status === 413) await fsp.truncate(partAt(id), received);
        record.updated = now();
        await save(record);
        throw err;
      }
      record.updated = now();
      await save(record);
      return { received: received + added };
    });
  }

  async function status(id) {
    const record = await read(id);
    return { received: await sizeOf(id), bytes: record.bytes, folder: record.folder, name: record.name, chunk: chunkBytes };
  }

  function finish(id) {
    return serial(id, async () => {
      const record = await read(id);
      const received = await sizeOf(id);
      if (received !== record.bytes) throw fail(409, `the host has ${received} of ${record.bytes} bytes`, { received });
      const placed = await store.placeFile(await freePath(joinPath(record.folder, record.name)), partAt(id));
      await fsp.rm(recordAt(id), { force: true });
      return placed;
    });
  }

  function cancel(id) {
    return serial(id, async () => {
      await read(id);
      await fsp.rm(partAt(id), { force: true });
      await fsp.rm(recordAt(id), { force: true });
      return { ok: true };
    });
  }

  /** Drop every session nobody has touched for a day. */
  async function sweep({ now: at = now() } = {}) {
    const names = await fsp.readdir(dir).catch(() => []);
    let dropped = 0;
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : null;
      if (!id || !ID.test(id)) continue;
      const record = await read(id).catch(() => null);
      if (!record || at - (record.updated ?? 0) < DAY_MS) continue;
      await cancel(id).catch(() => {});
      dropped += 1;
    }
    return dropped;
  }

  return { start, append, status, finish, cancel, sweep, room };
}

