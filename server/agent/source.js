// Small, pure questions about a document's source that the agent tools ask
// over and over. Everything here parses with the same patcher that splices, so
// "the element" means the same bytes to the tools as it does to the write.
//
// A parse of a large page is most of a tenth of a second (a 1.8 MB day page:
// ~80 ms), so a caller with several questions about one source asks them of
// one `indexOf` rather than parsing again for each.

import crypto from 'node:crypto';

import { indexIds, parseSource } from '../engine.js';

const ID = 'data-marble-id';

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

const outer = (source, node) => {
  const loc = node.sourceCodeLocation;
  return source.slice(loc.startOffset, loc.endOffset);
};

// Every parse made here is told to `watchParses`'s listener, if one is set:
// how a test holds a caller to one parse of a large page.
let onParse = null;
export const watchParses = (listener) => {
  onParse = listener ?? null;
};

/** One parse of `source`, and everything the tools ask of it: each addressed
 *  element (`byId`), its tag, its bytes outside and in, its hash (`hashesOf`'s,
 *  worked out once per id), and the addressed elements above it. */
export function indexOf(source) {
  onParse?.(source);
  const byId = indexIds(parseSource(source));
  const located = (id) => {
    const node = byId.get(id);
    return node?.sourceCodeLocation ? node : null;
  };
  const hashes = new Map();
  const index = {
    source,
    byId,
    has: (id) => byId.has(id),
    tagOf: (id) => byId.get(id)?.tagName ?? null,
    /** The element's own bytes, open tag to close; null when it is not here. */
    outerOf: (id) => {
      const node = located(id);
      return node ? outer(source, node) : null;
    },
    /** What is between its open and close tag; null without both. */
    innerOf: (id) => {
      const loc = located(id)?.sourceCodeLocation;
      if (!loc?.startTag || !loc?.endTag) return null;
      return source.slice(loc.startTag.endOffset, loc.endTag.startOffset);
    },
    hashOf: (id) => {
      if (!hashes.has(id)) {
        const node = located(id);
        hashes.set(id, node ? hash(outer(source, node)) : undefined);
      }
      return hashes.get(id);
    },
    /** `hashesOf`, read from this parse. */
    hashes: (ids = null) => {
      const out = new Map();
      for (const id of ids ?? byId.keys()) {
        const h = index.hashOf(id);
        if (h !== undefined) out.set(id, h);
      }
      return out;
    },
    tags: () => [...byId].map(([id, node]) => ({ id, tag: node.tagName })),
    /** The ids of the addressed elements above `id`, nearest first. */
    ancestorsOf: (id) => {
      const out = [];
      for (let up = byId.get(id)?.parentNode; up; up = up.parentNode) {
        const above = (up.attrs ?? []).find((a) => a.name === ID)?.value;
        if (above) out.push(above);
      }
      return out;
    },
  };
  return index;
}

/** What each element's bytes are, as a short name. A precondition is "the
 *  element is still what you read", and this is how that is said. */
export function hashesOf(source, ids = null) {
  return indexOf(source).hashes(ids);
}

const hasId = (node) => (node.attrs ?? []).some((a) => a.name === ID);

/** The addressed elements nothing addressed contains — where reading a whole
 *  document starts. */
export function topLevelIds(source) {
  const { byId } = indexOf(source);
  const top = [];
  for (const [id, node] of byId) {
    let up = node.parentNode;
    while (up && !(up.tagName && hasId(up))) up = up.parentNode;
    if (!up) top.push(id);
  }
  return top;
}

export const idsIn = (html) => [...String(html).matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);

/** Each list of ids with every addressed element at or inside them, from one
 *  parse: `parts` is id → { tag, html, hash } (the hash is `hashesOf`'s);
 *  `inside` is each listed id → the ids at or inside it; `top` the ids of the
 *  list no other id of it contains. Ids the source does not have are left out
 *  of all three. What one shard of a fan out may touch, what its worker is
 *  shown, and what landing later counts as landing that part. */
export function subtreesOf(source, lists) {
  const { byId } = indexOf(source);
  const partOf = (node) => {
    const html = outer(source, node);
    return { tag: node.tagName, html, hash: hash(html) };
  };
  return lists.map((ids) => {
    const parts = new Map();
    const inside = new Map();
    const below = new Set();
    for (const id of ids) {
      const node = byId.get(id);
      if (!node?.sourceCodeLocation || inside.has(id)) continue;
      const here = new Set([id]);
      const walk = (at) => {
        for (const child of at.childNodes ?? []) {
          const childId = child.attrs?.find((a) => a.name === ID)?.value;
          if (childId && child.sourceCodeLocation) {
            here.add(childId);
            below.add(childId);
            if (!parts.has(childId)) parts.set(childId, partOf(child));
          }
          walk(child);
        }
      };
      if (!parts.has(id)) parts.set(id, partOf(node));
      walk(node);
      inside.set(id, here);
    }
    return { parts, inside, top: ids.filter((id) => inside.has(id) && !below.has(id)) };
  });
}

export const tagsOf = (source) => indexOf(source).tags();
