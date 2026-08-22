// Content-addressed bytes that are not structure.
//
// One document in the Marble checkout is 1.76 MB, nearly all of it base64 JPEG
// inside the markup. That is the case this exists for: pixels, audio, a large
// table — the parts of a document that a hand will never drag and a diff will
// never read, sitting in the middle of the parts it will.
//
// The tension is real and named in the vision: "one file, one app" is the whole
// claim, and a document that points at a hash outside itself is no longer one
// file. So this ships with its own way out — `flatten` in ../flatten.js puts
// every blob back inline and hands you a single self-contained document again.
// A blob is a storage decision, never a format one.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SAFE_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

export function createBlobs({ dir }) {
  const fileOf = (hash) => path.join(dir, hash.slice(0, 2), hash);
  const metaOf = (hash) => `${fileOf(hash)}.json`;

  const ready = () => fsp.mkdir(dir, { recursive: true });

  /** Bytes in, hash out. Writing the same bytes twice costs one blob. */
  async function put(bytes, { type = 'application/octet-stream' } = {}) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    if (!SAFE_TYPE.test(type)) type = 'application/octet-stream';
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const file = fileOf(hash);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    try {
      await fsp.writeFile(file, buffer, { flag: 'wx' });
      await fsp.writeFile(metaOf(hash), JSON.stringify({ type, bytes: buffer.length, t: Date.now() }));
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    return { hash, bytes: buffer.length, type };
  }

  // `data` is the buffer and `bytes` is how many of them there are. They were
  // one key once, and the metadata's count quietly replaced the buffer on the
  // way out — a 200 with an empty body, which is the kind of bug that looks
  // like a network problem for an afternoon.
  async function get(hash) {
    if (!/^[0-9a-f]{64}$/.test(hash ?? '')) return null;
    const [data, meta] = await Promise.all([
      fsp.readFile(fileOf(hash)).catch(() => null),
      fsp
        .readFile(metaOf(hash), 'utf8')
        .then(JSON.parse)
        .catch(() => ({ type: 'application/octet-stream' })),
    ]);
    return data === null ? null : { ...meta, hash, data, bytes: data.length };
  }

  const head = async (hash) => {
    const blob = await get(hash);
    return blob && { hash: blob.hash, type: blob.type, bytes: blob.bytes };
  };

  return { ready, put, get, head, dir };
}
