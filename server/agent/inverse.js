// The op that undoes an op, worked out on the host from the source as it stood
// before the op ran. The carrier has the same idea (`invert` in Marble's
// runtime), computed from a live DOM; an agent's edits never pass through a
// page, so the host keeps its own.
//
// Two choices worth knowing:
//
//   - `setText` is undone with `setInner` holding the old inner bytes, because
//     "the old text" of an element with markup inside it is not something a
//     setText can put back;
//   - every step records what the element looked like *right after* its op.
//     Undo compares against that, so an element somebody edited afterwards is
//     left alone instead of being rolled back over their work.

import { applyOp, indexIds, parseSource } from '../engine.js';
import { hashesOf, idsIn } from './source.js';

const ID = 'data-marble-id';
const TRANSIENT = 'data-marble-transient';

const attr = (node, name) => (node.attrs ?? []).find((a) => a.name === name)?.value ?? null;
const isElement = (node) => Boolean(node?.tagName);

function innerOf(source, node) {
  const loc = node.sourceCodeLocation;
  if (!loc?.startTag || !loc?.endTag) return null;
  return source.slice(loc.startTag.endOffset, loc.endTag.startOffset);
}

/** Where an element sits, as ids: its parent's, and the next addressed,
 *  non-transient sibling's. Null when the parent has no id to name it by. */
function placeOf(node) {
  const parentId = isElement(node.parentNode) ? attr(node.parentNode, ID) : null;
  if (!parentId) return null;
  const siblings = node.parentNode.childNodes.filter((c) => isElement(c) && attr(c, TRANSIENT) === null);
  const after = siblings.slice(siblings.indexOf(node) + 1);
  const next = after.find((c) => attr(c, ID));
  return { parentId, beforeId: next ? attr(next, ID) : null };
}

/** The addressed elements an insert put in the document that nothing else it
 *  put there contains — one for each top-level element of the payload. Read
 *  from the document after the insert, not from the payload alone, so markup
 *  the parser places by context (a row, an item) lands where it really did. */
function insertedRoots(before, after, html) {
  const existing = indexIds(parseSource(before));
  const byId = indexIds(parseSource(after));
  const added = new Set(idsIn(html).filter((id) => !existing.has(id) && byId.has(id)));
  return [...added].filter((id) => {
    for (let up = byId.get(id).parentNode; up; up = up.parentNode) {
      if (isElement(up) && added.has(attr(up, ID))) return false;
    }
    return true;
  });
}

function inverseOf(source, op) {
  const node = op.id ? indexIds(parseSource(source)).get(op.id) : null;

  switch (op.type) {
    case 'setText':
    case 'setInner': {
      const html = node && innerOf(source, node);
      return html === null || html === undefined ? null : { type: 'setInner', id: op.id, html };
    }
    case 'setAttr':
      return node ? { type: 'setAttr', id: op.id, name: op.name, value: attr(node, op.name.toLowerCase()) } : null;
    case 'remove': {
      const place = node && placeOf(node);
      if (!place) return null;
      const loc = node.sourceCodeLocation;
      return { type: 'insert', html: source.slice(loc.startOffset, loc.endOffset), ...place };
    }
    case 'move': {
      const place = node && placeOf(node);
      return place ? { type: 'move', id: op.id, ...place } : null;
    }
    default:
      return null;
  }
}

/** One undo step per op, in the order the ops apply — except an insert, which
 *  has one step per element it put at the top level. */
export function inverseSteps(source, ops) {
  const steps = [];
  let current = source;
  for (const op of ops) {
    if (op.type === 'insert') {
      const before = current;
      current = applyOp(current, op);
      const roots = insertedRoots(before, current, op.html);
      const expected = hashesOf(current, roots);
      for (const id of roots) {
        steps.push({ inverse: { type: 'remove', id }, id, expect: expected.get(id) ?? null, absent: null });
      }
      if (!roots.length) steps.push({ inverse: null, id: null, expect: null, absent: null });
      continue;
    }
    const inverse = inverseOf(current, op);
    current = applyOp(current, op);
    const id = op.type === 'remove' ? null : op.id;
    steps.push({
      inverse,
      id,
      expect: id ? hashesOf(current, [id]).get(id) ?? null : null,
      absent: op.type === 'remove' ? op.id : null,
    });
  }
  return steps;
}
