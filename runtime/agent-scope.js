// The scope finder: which element the pointer means.
//
// Resting the pointer on a page offers the ask bubble for "the thing under
// it" — but the thing under a pointer is a word, a cell, an icon, rarely the
// thing a person would name. So the finder starts at the deepest addressed
// element and climbs until it reaches a unit:
//
//   - inline text is never the unit (select words to ask about words)
//   - a table cell gives its row: a cell is a value, a row is a thing
//   - anything smaller than 22 × 160 px gives its parent
//   - a unit that would cover most of the view is no unit at all
//
// The chain it climbed is kept, so the card can step out to the containing
// element and back in with [ and ].
//
// Pure DOM reading: nothing here draws. The callout asks.

(() => {
  const INLINE = new Set(['SPAN', 'B', 'I', 'EM', 'STRONG', 'A', 'CODE', 'SMALL', 'MARK', 'SUB', 'SUP', 'TD', 'TH', 'LABEL', 'ABBR', 'TIME', 'KBD', 'S', 'U']);
  // Structural wrappers nobody names: a row's body is the table's business.
  const SKIP = new Set(['TBODY', 'THEAD', 'TFOOT', 'COLGROUP']);
  const CONTROL = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
  const TRANSIENT = 'data-marble-transient';
  const MIN_H = 22;
  const MIN_W = 160;
  const MOST = 0.6;

  const addressed = (el) => el?.nodeType === 1 && el.hasAttribute('data-marble-id') && !el.closest(`[${TRANSIENT}]`);

  /** The addressed elements from `node` up to (not including) body, deepest
   *  first, without the wrappers nobody names. */
  function chainFrom(node) {
    const chain = [];
    let el = node?.nodeType === 1 ? node : node?.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      if (addressed(el) && !SKIP.has(el.tagName)) chain.push(el);
      el = el.parentElement;
    }
    return chain;
  }

  /** The index in `chain` of the first thing a person would name. */
  function unitIndex(chain) {
    for (let i = 0; i < chain.length; i++) {
      const el = chain[i];
      if (INLINE.has(el.tagName) && !CONTROL.has(el.tagName)) continue;
      if (el.closest('thead')) continue;
      const r = el.getBoundingClientRect();
      if (r.height < MIN_H && r.width < MIN_W && !CONTROL.has(el.tagName)) continue;
      return i;
    }
    return chain.length - 1;
  }

  /** What the pointer at (x, y) means: `{ chain, index, element, control }`,
   *  or null when it means nothing — the body, chrome, or a unit so big it is
   *  the page rather than a thing on it. */
  function at(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit.closest(`[${TRANSIENT}]`)) return null;
    const chain = chainFrom(hit);
    if (!chain.length) return null;
    const index = unitIndex(chain);
    const element = chain[index];
    const r = element.getBoundingClientRect();
    if (r.width * r.height > MOST * innerWidth * innerHeight) return null;
    return { chain, index, element, control: CONTROL.has(element.tagName) || Boolean(element.closest('button, a[href], input, select, textarea')) };
  }

  const clip = (s, n) => {
    s = String(s ?? '').trim().replace(/\s+/g, ' ');
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };

  /** A kind for an element, the way a person would say it: "row", "heading". */
  function kindOf(el) {
    if (!el) return 'part';
    const tag = el.tagName;
    if (tag === 'TR') return 'row';
    if (tag === 'TD' || tag === 'TH') return 'cell';
    if (tag === 'TABLE') return 'table';
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'P' || tag === 'BLOCKQUOTE') return 'paragraph';
    if (tag === 'UL' || tag === 'OL' || tag === 'DL') return 'list';
    if (tag === 'LI') return 'item';
    if (tag === 'IMG' || tag === 'FIGURE' || tag === 'SVG' || tag === 'CANVAS' || tag === 'PICTURE') return 'figure';
    if (CONTROL.has(tag)) return 'control';
    if (tag === 'SECTION' || tag === 'ARTICLE') return 'section';
    return 'part';
  }

  /** A short name for an element: "Row · Generative Agents". */
  function nameOf(el) {
    if (!el) return '';
    const kind = kindOf(el);
    const text = kind === 'row' ? el.cells?.[0]?.textContent : (el.getAttribute('aria-label') || el.textContent);
    const word = { row: 'Row', cell: 'Cell', table: 'Table', heading: 'Heading', paragraph: 'Paragraph', list: 'List', item: 'Item', figure: 'Figure', control: 'Control', section: 'Section', part: 'Part' }[kind];
    const said = clip(text, 26);
    return said && kind !== 'table' && kind !== 'figure' ? `${word} · ${said}` : word;
  }

  globalThis.marbleScope = { chainFrom, unitIndex, at, kindOf, nameOf, clip };
})();
