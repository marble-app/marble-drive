// The sections a page is about to be given, said before they are written.
//
// An agent building a page (a new document from a starter, or a page grown in
// stages) knows the shape of what comes next before it has the markup: a
// header, a row of three cards, a list. `outline` on apply_ops says so, and
// the page draws that shape where it will go, as placeholders that resolve
// into the real sections as their inserts land (runtime/gen-progress.js).
// Never filed: like marks, it is drawn on every open tab and gone when the
// turn ends.
//
// The host keeps the count of what has landed, so a tab that opens mid-build
// (and catches up from /presence) draws only what is still to come: every
// root a batch inserts into the outline's parent is one block landed.

export const OUTLINE_SHAPES = ['header', 'text', 'cards', 'rows', 'media', 'form'];
export const OUTLINE_MAX = 8;   // blocks in one outline
const COUNT_MAX = 12;           // cards or rows in one block

export const OUTLINE = {
  type: 'object',
  description:
    'The sections this step is about to write, said before their markup exists, so the page can draw their shape where they will go ' +
    'and resolve each into the real section as it lands. Where they go, as for an insert: parentId, and beforeId (omit for the end). ' +
    'Each block is one top-level element you will insert there, in order: header, text, cards (count), rows (count), media, form. ' +
    'Give it once, with the step\'s first call (an apply_ops with no ops is fine); a new outline replaces the last. Drawn, never saved.',
  required: ['parentId', 'blocks'],
  properties: {
    parentId: { type: 'string', description: 'The data-marble-id the sections will be inserted into.' },
    beforeId: { type: 'string', description: 'The child they will be inserted before; omit for the end.' },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: OUTLINE_MAX,
      items: {
        type: 'object',
        required: ['shape'],
        properties: {
          shape: { type: 'string', enum: OUTLINE_SHAPES },
          count: { type: 'integer', minimum: 1, maximum: COUNT_MAX, description: 'How many cards or rows.' },
        },
      },
    },
  },
};

/** An outline as the agent gave it, checked: a parent that is in the
 *  document, a before that is too (or none), and at least one block of a
 *  known shape. Anything else is no outline. `has` answers whether an id is
 *  in the document. */
export function outlineOf(value, { has = () => true } = {}) {
  if (!value || typeof value !== 'object') return null;
  const parentId = typeof value.parentId === 'string' ? value.parentId : '';
  if (!parentId || !has(parentId)) return null;
  const beforeId = typeof value.beforeId === 'string' && value.beforeId && has(value.beforeId) ? value.beforeId : null;
  const blocks = (Array.isArray(value.blocks) ? value.blocks : [])
    .map((block) => {
      const shape = typeof block === 'string' ? block : block?.shape;
      if (!OUTLINE_SHAPES.includes(shape)) return null;
      const count = Number.isInteger(block?.count) ? Math.min(COUNT_MAX, Math.max(1, block.count)) : null;
      return count && (shape === 'cards' || shape === 'rows') ? { shape, count } : { shape };
    })
    .filter(Boolean)
    .slice(0, OUTLINE_MAX);
  if (!blocks.length) return null;
  return { parentId, beforeId, blocks, landed: 0 };
}

/** The outline after a batch's inserts: each root put into its parent is
 *  one block landed. Returns a new outline; null stays null. */
export function landOutline(outline, inserts) {
  if (!outline) return outline;
  let landed = outline.landed;
  for (const entry of inserts ?? []) {
    if (entry?.parentId === outline.parentId) landed += (entry.ids ?? []).length;
  }
  return landed === outline.landed ? outline : { ...outline, landed: Math.min(landed, outline.blocks.length) };
}
