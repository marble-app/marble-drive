// Blobs out of a document, and blobs back into it.
//
// These are inverses, and they exist as a pair on purpose. `extract` is the
// storage win — a 1.76 MB document becomes a 40 KB one that points at its
// pixels. `flatten` is the promise that makes taking the win safe: any document
// can be turned back into a single self-contained file to hand to someone, or
// to open with no host at all.
//
// Neither one is a format change. A document carries `data-marble-blob="<hash>"`
// and the Drive's carrier extension resolves it to a source at load; a document
// that never meets a Drive shows the placeholder its own markup gives it. The
// file still names no server.

// A 1x1 transparent GIF. What an element carrying a blob shows before the
// carrier resolves it, and what it shows forever with no host at all.
export const PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const DATA_URL = /(<[^>]*?\ssrc=")(data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+))(")/gi;

/** Data URLs at or above `min` bytes become blobs. Small ones are left alone —
 *  an inline 400-byte icon is cheaper than a fetch, and a document full of
 *  hashes for things that were never heavy is harder to read for no gain. */
export async function extract(source, blobs, { min = 64 * 1024 } = {}) {
  const found = [...source.matchAll(DATA_URL)];
  if (!found.length) return { source, extracted: [] };

  const extracted = [];
  let out = '';
  let at = 0;

  for (const match of found) {
    const [whole, open, url, type, base64, close] = match;
    const bytes = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
    if (bytes.length < min) continue;

    const { hash } = await blobs.put(bytes, { type });
    extracted.push({ hash, type, bytes: bytes.length });

    out += source.slice(at, match.index);
    // The heavy `src` goes and a placeholder takes its place, because an empty
    // one resolves to the page and a stale one renders the bytes we just moved.
    // The element keeps its position and its id, so nothing about addressing
    // moves — the document is the same document, minus a megabyte.
    out += `${open.replace(/\ssrc="$/, '')} data-marble-blob="${hash}" data-marble-type="${type}" src="`;
    out += PLACEHOLDER;
    out += close;
    at = match.index + whole.length;
    void url;
  }

  out += source.slice(at);
  return { source: extracted.length ? out : source, extracted };
}

const BLOB_ATTRS = /\sdata-marble-blob="([0-9a-f]{64})"\sdata-marble-type="([^"]*)"/g;

/** Every blob this document points at, put back inside it. */
export async function flatten(source, blobs) {
  const found = [...source.matchAll(BLOB_ATTRS)];
  if (!found.length) return { source, inlined: 0, missing: [] };

  const missing = [];
  let out = '';
  let at = 0;
  let inlined = 0;

  for (const match of found) {
    const [whole, hash, type] = match;
    const blob = await blobs.get(hash);
    out += source.slice(at, match.index);
    at = match.index + whole.length;

    if (!blob) {
      // A missing blob is left named rather than silently dropped: the document
      // still says what it wanted, and the caller is told what it did not get.
      missing.push(hash);
      out += whole;
      continue;
    }
    inlined += 1;
    out += '';
    // Replace the emptied src that sits after these attributes.
    const rest = source.slice(at);
    const src = rest.match(/^([^>]*?\ssrc=")([^"]*)(")/);
    if (src) {
      out += `${src[1]}data:${blob.type || type};base64,${blob.data.toString('base64')}${src[3]}`;
      at += src[0].length;
    }
  }

  out += source.slice(at);
  return { source: out, inlined, missing };
}

/** Base64 in pieces whose joins fall on whole three-byte groups, so that the
 *  pieces read together are what one toString('base64') of the whole is. */
async function* base64Of(stream) {
  let carry = Buffer.alloc(0);
  for await (const chunk of stream) {
    const bytes = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const whole = bytes.length - (bytes.length % 3);
    if (whole) yield Buffer.from(bytes.subarray(0, whole).toString('base64'), 'latin1');
    // A copy: the stream may hand the same memory out again.
    carry = Buffer.from(bytes.subarray(whole));
  }
  if (carry.length) yield Buffer.from(carry.toString('base64'), 'latin1');
}

/**
 * The document `flatten` makes, in pieces, for a reader that must not hold it
 * whole: a deck with its talk recorded into it is a gigabyte of sound, which
 * as one string is more than a string can be. The text between blobs comes as
 * it is, and each blob is read from disk and sent as base64 a piece at a time.
 * Read together, the pieces are byte for byte what `flatten` answers, which is
 * what /drive/download sends (server/export.js; test/drive-export.test.js).
 */
export async function* flattenChunks(source, blobs) {
  const text = (piece) => Buffer.from(piece, 'utf8');
  let at = 0;
  for (const match of source.matchAll(BLOB_ATTRS)) {
    const [whole, hash, type] = match;
    const blob = await blobs.open(hash);
    const before = source.slice(at, match.index);
    if (before) yield text(before);
    at = match.index + whole.length;
    if (!blob) {
      yield text(whole);
      continue;
    }
    const src = source.slice(at).match(/^([^>]*?\ssrc=")([^"]*)(")/);
    if (!src) continue;
    yield text(`${src[1]}data:${blob.type || type};base64,`);
    yield* base64Of(blob.stream());
    yield text(src[3]);
    at += src[0].length;
  }
  const rest = source.slice(at);
  if (rest) yield text(rest);
}

/** Which blobs a document points at, without reading any of them. */
export const blobsIn = (source) =>
  [...source.matchAll(BLOB_ATTRS)].map(([, hash, type]) => ({ hash, type }));
