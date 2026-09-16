// Small, pure questions about a document's source that the agent tools ask
// over and over. Everything here parses with the same patcher that splices, so
// "the element" means the same bytes to the tools as it does to the write.

import crypto from 'node:crypto';

import { indexIds, parseSource } from '../engine.js';

const ID = 'data-marble-id';

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

const outer = (source, node) => {
  const loc = node.sourceCodeLocation;
  return source.slice(loc.startOffset, loc.endOffset);
};

/** What each element's bytes are, as a short name. A precondition is "the
 *  element is still what you read", and this is how that is said. */
export function hashesOf(source, ids = null) {
  const byId = indexIds(parseSource(source));
  const out = new Map();
  for (const id of ids ?? byId.keys()) {
    const node = byId.get(id);
    if (node?.sourceCodeLocation) out.set(id, hash(outer(source, node)));
  }
  return out;
}

const hasId = (node) => (node.attrs ?? []).some((a) => a.name === ID);

/** The addressed elements nothing addressed contains — where reading a whole
 *  document starts. */
export function topLevelIds(source) {
  const byId = indexIds(parseSource(source));
  const top = [];
  for (const [id, node] of byId) {
    let up = node.parentNode;
    while (up && !(up.tagName && hasId(up))) up = up.parentNode;
    if (!up) top.push(id);
  }
  return top;
}

export const idsIn = (html) => [...String(html).matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);

export const tagsOf = (source) =>
  [...indexIds(parseSource(source))].map(([id, node]) => ({ id, tag: node.tagName }));
