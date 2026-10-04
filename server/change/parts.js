// Which parts of a document an agent's batch touched — the shape later tasks
// draw from.
//
// `apply_ops` already knows the ids an op addresses (idsOfOps), which is
// enough to refuse a stale write. It is not enough to tell the page *what
// kind* of change landed, or to narrow a `setInner` that rewrote a whole list
// down to the one row that actually changed. `partsOf` answers that, from the
// ops alone and the source they are about to apply to — nothing it does
// writes anything or depends on a turn, a conversation, or the host.
//
// `parseStep` is the other half of the same idea in words: an agent that
// narrates its own batches ("Stage 2 of 4: …") hands the page a step and a
// count for free, if the note is read for it rather than only logged.

import { idsIn, indexOf, topLevelIds } from '../agent/source.js';

const LOOK_ATTRS = new Set(['style', 'class']);
// Union sizes above this are not worth naming one by one — the batch reports
// its container instead, the same answer a `setInner` the model can't see
// into gets.
const UNION_LIMIT = 60;

// A fragment is parsed as a whole document, and the HTML parser drops what
// cannot stand in a body on its own: a <tr> outside a table, a <td> outside a
// row, a <tbody> outside a table. So a fragment is read inside the elements its
// parent needs around it. The wrappers carry no ids, so they never become a
// part; the fragment's own bytes, and so its hashes, are unchanged by them.
const CONTEXT = {
  table: ['<table>', '</table>'],
  thead: ['<table><thead>', '</thead></table>'],
  tbody: ['<table><tbody>', '</tbody></table>'],
  tfoot: ['<table><tfoot>', '</tfoot></table>'],
  tr: ['<table><tbody><tr>', '</tr></tbody></table>'],
  colgroup: ['<table><colgroup>', '</colgroup></table>'],
  select: ['<select>', '</select>'],
  optgroup: ['<select><optgroup>', '</optgroup></select>'],
  datalist: ['<datalist>', '</datalist>'],
};
// When the parent is not known, the fragment's first tag says what it needs.
const PARENT_OF = {
  tr: 'tbody', td: 'tr', th: 'tr', thead: 'table', tbody: 'table', tfoot: 'table',
  caption: 'table', colgroup: 'table', col: 'colgroup', option: 'select', optgroup: 'select',
};
function inContext(html, parentTag) {
  const first = /^\s*<([a-zA-Z][\w-]*)/.exec(String(html))?.[1]?.toLowerCase();
  const tag = CONTEXT[parentTag] ? parentTag : PARENT_OF[first] ?? null;
  const wrap = tag ? CONTEXT[tag] : null;
  return wrap ? `${wrap[0]}${html}${wrap[1]}` : String(html);
}

/** The topmost of `union`: drop any id whose ancestor is also in the set.
 *  `removedIds` live in the old document (`doc`, its one parse); everything
 *  else in `union` is from the new fragment (`fragment`, its own) — two
 *  different trees, so each id's ancestors are read from whichever tree it
 *  actually belongs to. */
function topmostOf(doc, fragment, removedIds, union) {
  if (!union.length) return union;
  const removed = new Set(removedIds);
  const unionSet = new Set(union);
  return union.filter((id) => {
    const anc = removed.has(id) ? doc.ancestorsOf(id) : fragment.ancestorsOf(id);
    for (const a of anc) if (unionSet.has(a)) return false;
    return true;
  });
}

const stripTags = (html) => String(html).replace(/<[^>]*>/g, '').trim();

/** The children of an outer-HTML string — what's between its own open and
 *  close tag. Only ever asked of a non-raw-text element here (style/script
 *  are short-circuited in `partsForOp` before this runs). */
function innerOf(outerHtml) {
  const openEnd = outerHtml.indexOf('>');
  const closeStart = outerHtml.lastIndexOf('<');
  if (openEnd === -1 || closeStart === -1 || closeStart <= openEnd) return '';
  return outerHtml.slice(openEnd + 1, closeStart);
}

function setInnerParts(doc, op, tag) {
  const { id } = op;
  const html = inContext(op.html, tag);
  const outer = doc.outerOf(id);
  // The id named by the op is not in the document the batch is about to
  // apply to — the write itself will refuse this upstream; here it is just
  // one part, generically.
  if (outer === null) return { parts: [id], kind: 'structure' };
  const oldIds = idsIn(outer).filter((x) => x !== id);
  const newIds = idsIn(html);
  const fragment = indexOf(html);
  // Compared only with what was inside the element: an id from elsewhere
  // on the page is new here, whatever its bytes.
  const inside = new Set(oldIds);
  const changed = newIds.filter((nid) => (inside.has(nid) ? doc.hashOf(nid) : undefined) !== fragment.hashOf(nid));
  const removed = oldIds.filter((oid) => !newIds.includes(oid));
  const union = [...new Set([...changed, ...removed])];

  if (union.length && union.length <= UNION_LIMIT) {
    const topmost = topmostOf(doc, fragment, removed, union);
    const removedSet = new Set(removed);
    return {
      parts: topmost,
      removes: topmost.filter((pid) => removedSet.has(pid)),
      kind: 'structure',
    };
  }

  // Neither side has any addressed children: this is a plain-text container,
  // and the only question left is whether its words actually moved.
  const words = !oldIds.length && !newIds.length && stripTags(innerOf(outer)) !== stripTags(html);
  return { parts: [id], kind: words ? 'words' : 'structure' };
}

function partsForOp(doc, op, tagById) {
  switch (op.type) {
    case 'setText':
      return { parts: [op.id], kind: 'words' };
    case 'setAttr':
      return { parts: [op.id], kind: LOOK_ATTRS.has(op.name) ? 'look' : 'attr' };
    case 'setInner': {
      const tag = tagById.get(op.id);
      if (tag === 'style') return { parts: [op.id], kind: 'look' };
      if (tag === 'script') return { parts: [op.id], kind: 'attr' };
      return setInnerParts(doc, op, tag);
    }
    case 'insert': {
      const roots = topLevelIds(inContext(op.html, tagById.get(op.parentId)));
      return {
        parts: roots,
        inserts: [{ parentId: op.parentId, beforeId: op.beforeId ?? null, ids: roots }],
        kind: 'structure',
      };
    }
    case 'remove':
      return { parts: [op.id], removes: [op.id], kind: 'structure' };
    case 'move':
      return { parts: [op.id], moves: [op.id], kind: 'structure' };
    default:
      return { parts: op.id ? [op.id] : [], kind: 'structure' };
  }
}

/** Where each id in the document's own markup first appears — "document
 *  order" for a batch that may touch ids from several different ops. An id
 *  this batch is inserting has none yet, and sorts after every id that does,
 *  in the order the batch introduced it (sort is stable). */
function docOrderOf(source) {
  const order = new Map();
  let i = 0;
  for (const m of String(source).matchAll(/data-marble-id="([^"]+)"/g)) {
    if (!order.has(m[1])) order.set(m[1], i);
    i += 1;
  }
  return order;
}

/** What one batch of ops touched: the parts to redraw, in document order,
 *  and enough about each to say what kind of touch it was. Pure — it only
 *  reads `source`, the document as it is before the batch applies, parsed
 *  once for the whole batch; `index` is that parse (`indexOf(source)`) when
 *  the caller already has it. */
export function partsOf(source, ops, { index = null } = {}) {
  const doc = index ?? indexOf(source);
  const tagById = new Map(doc.tags().map((t) => [t.id, t.tag]));
  const results = (ops ?? []).map((op) => partsForOp(doc, op, tagById));

  const kinds = new Set(results.map((r) => r.kind));
  const kind = kinds.size === 0 ? 'structure' : kinds.size === 1 ? [...kinds][0] : 'mixed';

  const order = docOrderOf(source);
  const seen = new Set();
  const parts = [];
  for (const r of results) {
    for (const id of r.parts) {
      if (!seen.has(id)) {
        seen.add(id);
        parts.push(id);
      }
    }
  }
  parts.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));

  const inserts = results.flatMap((r) => r.inserts ?? []);
  const removes = [...new Set(results.flatMap((r) => r.removes ?? []))];
  const moves = [...new Set(results.flatMap((r) => r.moves ?? []))];

  return { parts, inserts, removes, moves, kind };
}

const STEP_RE = /^(?:stage|step)\s+(\d+)\s*(?:of|\/)\s*(\d+)\s*(.*)$/i;
const LEADING_PUNCT = /^[\s:\-\u2013\u2014]+/;

/** "Stage 2 of 4: lay out the three columns" → { n: 2, of: 4, text: 'lay out
 *  the three columns' }, read out of an agent's own note on a batch. Not
 *  found: null — most notes are not a step, and that is the ordinary case. */
export function parseStep(note) {
  const m = STEP_RE.exec(String(note ?? '').trim());
  if (!m) return null;
  return { n: Number(m[1]), of: Number(m[2]), text: m[3].replace(LEADING_PUNCT, '').trim() };
}
