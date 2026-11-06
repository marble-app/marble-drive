// The small things every route does, in one place so no route does them
// slightly differently.

import zlib from 'node:zlib';

// Text is compressed on the way out: a page is its document plus about 800 KB
// of runtime, and over a sprite's URL every byte of it crosses the internet.
// Brotli at 5, not its default 11, which takes most of a second on a large
// document for a few percent more.
const COMPRESSIBLE = /^(text\/|application\/(json|javascript)|image\/svg\+xml)/i;
const MIN_COMPRESS_BYTES = 1024;
const BROTLI = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } };
// Above this the squeezing is done on libuv's threads, not the event loop's:
// brotli takes 15 ms over the Drive page and 400 ms over a 30 MB document,
// and every other request in the drive waited that long behind it.
const OFF_LOOP_BYTES = 64 * 1024;

/** `body` compressed with `encoding`, off the event loop. */
export const compress = (body, encoding) =>
  new Promise((resolve, reject) => {
    const done = (err, out) => (err ? reject(err) : resolve(out));
    if (encoding === 'br') zlib.brotliCompress(body, BROTLI, done);
    else zlib.gzip(body, done);
  });

const finish = (res, status, head, body) => {
  // A body that took a moment to squeeze may find its asker gone.
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, head);
  res.end(body);
};

const header = (headers, name) => {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
};

export const encodingFor = (accepts = '') =>
  /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;

export const send = (res, status, body, headers = {}) => {
  const head = { 'Cache-Control': 'no-store', ...headers };
  if (COMPRESSIBLE.test(header(head, 'content-type') ?? '') && header(head, 'content-encoding') === undefined) {
    head.Vary = 'Accept-Encoding';
    const encoding = encodingFor(res.req?.headers['accept-encoding']);
    if (encoding && body && status !== 204 && status !== 304 && Buffer.byteLength(body) >= MIN_COMPRESS_BYTES) {
      head['Content-Encoding'] = encoding;
      if (body.length >= OFF_LOOP_BYTES) {
        return compress(body, encoding).then(
          (packed) => finish(res, status, head, packed),
          () => {
            delete head['Content-Encoding'];
            finish(res, status, head, body);
          },
        );
      }
      body = encoding === 'br' ? zlib.brotliCompressSync(body, BROTLI) : zlib.gzipSync(body);
    }
  }
  return finish(res, status, head, body);
};

/**
 * A JSON answer made once and sent many times: `kept` is `{body}`, and the
 * compressed forms are added to it as they are first asked for, so a hundred
 * tabs asking for one answer cost one squeeze of it.
 */
export async function sendKept(res, status, kept, headers = {}) {
  const head = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', Vary: 'Accept-Encoding', ...headers };
  const encoding = Buffer.byteLength(kept.body) >= MIN_COMPRESS_BYTES ? encodingFor(res.req?.headers['accept-encoding']) : null;
  if (!encoding) return finish(res, status, head, kept.body);
  kept.packed ??= new Map();
  if (!kept.packed.has(encoding)) kept.packed.set(encoding, compress(kept.body, encoding));
  try {
    const packed = await kept.packed.get(encoding);
    return finish(res, status, { ...head, 'Content-Encoding': encoding }, packed);
  } catch {
    kept.packed.delete(encoding);
    return finish(res, status, head, kept.body);
  }
}

export const json = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', ...headers });

export const text = (res, status, body, headers = {}) =>
  send(res, status, body, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });

export const html = (res, status, body, headers = {}) =>
  send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', ...headers });

export async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error(`request body is larger than ${limit} bytes`);
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const readJson = async (req, limit) => {
  const body = (await readBody(req, limit)).toString('utf8');
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    const err = new Error('that body is not JSON');
    err.status = 400;
    throw err;
  }
};

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
