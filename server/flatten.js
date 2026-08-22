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

/** Which blobs a document points at, without reading any of them. */
export const blobsIn = (source) =>
  [...source.matchAll(BLOB_ATTRS)].map(([, hash, type]) => ({ hash, type }));
