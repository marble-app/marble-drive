// The offer: what a fresh callout card shows before anything is sent.
//
// Asking starts with Marble saying what the thing could become, not with an
// empty box. So a new card is one card: the input on top, then the four
// actions as a row of words — Try variations, Automate it, Make it
// interactive, Sketch it — then two suggestions written for this element,
// then one faint line of help.
//
// All four actions stay in sight, in words, so there is nothing to decode and
// no menu to open (v2, Notes and Sketches/Ask at Anything). Pointing at one
// puts what it would ask for this thing in the empty line, in grey. Pressing
// it drafts that, with the idea after the colon selected so typing replaces
// it; over words already typed it only frames them. Pressing it again clears
// its draft. A suggestion drafts too. Nothing is sent until you send.
//
// ⏎ sends, ⇧⏎ keeps the ask as a note (agent-notes.js), ⌥⏎ makes a new line.
//
// What an action means is a brief the agent reads and the chat does not
// show: the person's words are the message, and "wrap it in a <marble-alt>"
// rides beside them (agent.brief). The host adds the Marble way to any ask
// that builds (server/agent/marble-way.js).
//
// The callout owns the card and the conversation; this only draws the offer
// into a container it is given and hands back what to send.

(() => {
  const TRANSIENT = 'data-marble-transient';

  const ICONS = {
    variations: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="7" rx="2"/><rect x="3" y="13" width="8" height="7" rx="2"/><rect x="13" y="13" width="8" height="7" rx="2"/></svg>',
    automate: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>',
    interactive: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5v-2a1.5 1.5 0 0 1 3 0V12"/><path d="M14 11a1.5 1.5 0 0 1 3 0v1.5"/><path d="M17 12a1.5 1.5 0 0 1 3 0v3a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.9-2.6L5 15.5a1.6 1.6 0 0 1 2.6-1.9L8 14"/></svg>',
    sketch: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7.5 15c2.2-4.6 3.8-6.9 4.8-6.9 1.5 0 .3 6.9 1.8 6.9 1 0 1.9-1.4 2.6-4.2"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    // A suggestion's mark: a drawn corner arrow, so it weighs what the action
    // icons weigh, never a typed ↳.
    suggest: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v6.5A2.5 2.5 0 0 0 8.5 14H18"/><path d="m14 10 4 4-4 4"/></svg>',
  };
  const ACTIONS = [
    ['variations', 'Try variations'],
    ['automate', 'Automate it'],
    ['interactive', 'Make it interactive'],
    ['sketch', 'Sketch it'],
  ];

  // Until the host writes suggestions for this element (POST /agent/offer),
  // these stand in, by kind. They are drafts either way.
  const DEFAULTS = {
    row: { sugs: ['Add a one-line takeaway', 'Link it to its source'], auto: 'a Fill button that looks up what is missing', interactive: 'click to change its status', axes: 'as a card, compact, or title first' },
    cell: { sugs: ['Explain this value', 'Link it to its source'], auto: 'fill this in from the rest of the row', interactive: 'click to edit it in place', axes: 'shorter, plainer, or with a note' },
    table: { sugs: ['Sort it by what matters most', 'Add a column saying why each one matters'], auto: 'a Fill button on every row with gaps', interactive: 'sort by clicking a header', axes: 'as a table, cards, or a board' },
    heading: { sugs: ['A shorter title', 'Add a line under it that says what this is for'], auto: 'keep it in step with what the page is about', interactive: 'click to fold what is under it', axes: 'shorter, bolder, or quieter' },
    paragraph: { sugs: ['Tighten it', 'Turn it into a short list'], auto: 'keep it current with the rest of the page', interactive: 'show the detail only when asked', axes: 'plainer, shorter, or warmer' },
    list: { sugs: ['Order it by what matters', 'Group the items'], auto: 'add an item when I paste a link', interactive: 'drag items to reorder them', axes: 'as chips, a list, or with counts' },
    item: { sugs: ['Say it more plainly', 'Add a detail'], auto: 'fill in its detail from its title', interactive: 'click to check it off', axes: 'plainer, shorter, or with a detail' },
    figure: { sugs: ['Add a caption', 'Describe it for a screen reader'], auto: 'caption it from what it shows', interactive: 'click to see it larger', axes: 'larger, cropped, or captioned' },
    control: { sugs: ['Say what it does', 'Give it a clearer label'], auto: 'do this on its own when the page opens', interactive: 'show what will happen before it does', axes: 'quieter, clearer, or as a toggle' },
    section: { sugs: ['Summarise it in a line', 'Make it easier to scan'], auto: 'keep it up to date', interactive: 'fold it into a summary you can open', axes: 'shorter, as a list, or as a table' },
    words: { sugs: ['Rephrase this', 'Define it'], auto: 'link terms like this to their definition', interactive: 'show a definition on hover', axes: 'plainer, shorter, or warmer' },
    part: { sugs: ['Make it clearer', 'Explain what it is for'], auto: 'fill in what is missing when I press a button', interactive: 'make it respond to a click', axes: 'plainer, bolder, or quieter' },
  };
  const PLURAL = { row: 'rows', cell: 'cells', table: 'tables', heading: 'headings', paragraph: 'paragraphs', list: 'lists', item: 'items', figure: 'figures', control: 'controls', section: 'sections', part: 'parts' };

  const STYLE = `
    .marble-offer { box-sizing: border-box; width: 100%; display: flex; flex-direction: column; overflow: hidden;
      font: 13px/1.4 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      color: var(--callout-ink, var(--ink, #111)); background: var(--callout-paper, var(--card, #fff));
      border: 1px solid color-mix(in srgb, var(--callout-ink, #111) 11%, transparent); border-radius: 12px;
      box-shadow: 0 8px 26px rgba(0,0,0,.10); }
    .marble-offer-pill { display: flex; align-items: flex-start; padding: 5px 6px 3px 12px; }
    .marble-offer-input { flex: 1; min-width: 0; outline: none; font-size: 13.5px; line-height: 1.4; padding: 6px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .marble-offer-input:empty::before { content: attr(data-placeholder); color: var(--placeholder, #767676); }
    .marble-offer-input.is-previewing:empty::before { color: color-mix(in srgb, var(--callout-mark, #738698) 70%, var(--placeholder, #767676)); }
    .marble-offer-send { flex: none; width: 28px; height: 28px; border: 0; padding: 0; margin: 1px 0 0 6px; border-radius: 8px; display: grid; place-items: center; cursor: pointer;
      background: var(--callout-mark, #738698); color: var(--callout-paper, #fff); }
    .marble-offer-send svg { width: 14px; height: 14px; }
    .marble-offer-send[hidden] { display: none; }
    .marble-offer-send:active { opacity: .75; }
    /* The four actions: words on the bare card, lit only when pointed at or
       holding the draft. Words, not capsules. */
    .marble-offer-acts { display: flex; flex-wrap: wrap; gap: 2px; padding: 0 6px 5px; }
    .marble-offer-act { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 8px; border: 0; border-radius: 8px; cursor: pointer;
      font: inherit; font-size: 12.5px; font-weight: 500; color: var(--muted, #5a5a5a); background: none; transition: color 120ms ease, background-color 120ms ease; }
    .marble-offer-act svg { width: 15px; height: 15px; flex: none; color: var(--callout-mark, #738698); }
    .marble-offer-act:hover, .marble-offer-act:focus-visible { color: var(--callout-ink, #111); background: var(--paper-2, color-mix(in srgb, var(--callout-ink, #111) 5%, transparent)); outline: none; }
    .marble-offer-act:active { background: var(--accent-soft, #eef3f7); }
    .marble-offer-act[aria-pressed="true"] { color: var(--callout-mark, #738698); background: var(--accent-soft, #eef3f7); }
    .marble-offer-act[data-act="sketch"] svg { color: var(--sketch, var(--callout-mark, #738698)); }
    .marble-offer-sugs { display: flex; flex-direction: column; padding: 4px; border-top: 1px solid color-mix(in srgb, var(--callout-ink, #111) 7%, transparent); }
    .marble-offer-sugs:empty { display: none; }
    .marble-offer-bubble { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit; font-size: 12.5px; padding: 7px 10px; border: 0; border-radius: 8px; cursor: pointer;
      background: none; color: var(--callout-ink, #111); opacity: 0; transform: translateY(-4px);
      animation: marble-offer-cascade 240ms cubic-bezier(.22, 1, .36, 1) forwards; animation-delay: calc(var(--i, 0) * 60ms);
      transition: background-color 120ms ease, color 120ms ease; }
    .marble-offer-bubble svg { width: 15px; height: 15px; flex: none; color: var(--faint, #8a8a8a); }
    .marble-offer-bubble[data-act] svg { color: var(--callout-mark, #738698); }
    .marble-offer-bubble:hover, .marble-offer-bubble:focus-visible { background: var(--accent-soft, #eef3f7); color: var(--callout-mark, #738698); outline: none; }
    .marble-offer-bubble:hover svg { color: currentColor; }
    @keyframes marble-offer-cascade { to { opacity: 1; transform: none; } }
    .marble-offer-hint { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 7px 12px 8px; font-size: 11.5px; line-height: 1.3; color: var(--faint, #8a8a8a);
      border-top: 1px solid color-mix(in srgb, var(--callout-ink, #111) 6%, transparent); }
    .marble-offer-hint kbd { font: 500 10.5px/1 ui-monospace, "SF Mono", Menlo, monospace; color: var(--faint, #8a8a8a); padding: 1px 4px; border-radius: 4px;
      border: 1px solid color-mix(in srgb, var(--callout-ink, #111) 12%, transparent); background: var(--paper, transparent); }
    .marble-offer-hint .marble-offer-teach { color: var(--callout-mark, #738698); }
    @media (prefers-reduced-motion: reduce) {
      .marble-offer-bubble { opacity: 1; transform: none; animation: none; }
      .marble-offer-act, .marble-offer-bubble { transition: none; }
    }
  `;

  let styled = false;
  const ensureStyle = () => {
    if (styled) return;
    styled = true;
    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);
  };

  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  const names = (ids) => ids.map((id) => `[data-marble-id="${id}"]`).join(', ');
  const listed = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? '');

  /** What an action means, for the agent: the brief that rides beside the
   *  person's words. None for a plain ask. */
  function briefFor(mode, ids) {
    const at = ids.length ? names(ids) : 'the element';
    if (mode === 'variations') {
      return `Write them into the document as alternatives, not as prose: wrap ${at} in a <marble-alt> carrying that element's own data-marble-id, move the existing version inside it as the first child with a fresh id and data-marble-alt="v1", and add 2 more children, each a full version of the element with a fresh id, a short data-marble-alt name, and a data-why saying in a few words what it is trying. Set data-marble-active to the original. Do not change anything outside those elements, and do not explain the variations in chat — the page reads them from the file.`;
    }
    if (mode === 'automate') {
      return `Build it into the document as a trigger, not a script: an element carrying data-marble-run="<the brief an agent should be given each time it runs>", data-marble-scope="<the data-marble-id it acts on>" and data-marble-on="press" (a button, labelled with what it does), placed on or beside ${at}. The Drive runs the brief with an agent when it is pressed; the agent does any fetching, never the page. If part of what was asked cannot be done this way, say so in one line.`;
    }
    if (mode === 'interactive') {
      return `Change ${at} in place so it can be acted on rather than read: prefer direct manipulation, live feedback and graphics over text. Keep what it says; change how you can act on it. State that must survive a reload goes in the document (attributes or text with ids), not in script variables. Undo is how the person gets the original back.`;
    }
    return '';
  }

  const EMPTY = new Set(['', '—', '–', '-', '?']);
  /** A row's cells that are still to fill, and the names of their columns. */
  function gapsOf(el) {
    const tr = el?.closest?.('tr');
    if (!tr || !tr.cells?.length) return null;
    const cells = [...tr.cells];
    const empty = cells.slice(1).filter((td) => EMPTY.has(td.textContent.replace(/\s+/g, ' ').trim()));
    if (!empty.length || !cells[0].textContent.trim()) return null;
    const heads = [...(tr.closest('table')?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent.trim());
    const cols = empty.map((td) => heads[td.cellIndex]).filter(Boolean);
    const first = (heads[0] || 'title').toLowerCase();
    return { cols: cols.length ? listed(cols) : 'the rest', from: first };
  }

  /** "this row", "these 2 rows", "these words": what an action is about. */
  function thisOf(kind, count, what = kind) {
    if (kind === 'words') return 'these words';
    return count > 1 ? `these ${count} ${PLURAL[DEFAULTS[kind] ? kind : 'part'] ?? 'things'}` : `this ${what}`;
  }

  /** What an action asks for, for a thing: the words it drafts, the lead
   *  and the idea after it apart, so the idea can be selected to type over. */
  function actionWords(id, thisWhat, offer) {
    if (id === 'variations') return { lead: `Try 3 variations of ${thisWhat}: `, idea: offer.axes };
    if (id === 'automate') return { lead: `Automate ${thisWhat}: `, idea: offer.auto };
    if (id === 'interactive') return { lead: `Make ${thisWhat} interactive: `, idea: offer.interactive };
    return { lead: '', idea: '', line: 'Mark and draw on the page what you mean' };
  }

  /** An action drafted for a thing outside a card: the line (change-line.js)
   *  opens with these words when an offer after an edit names an action. */
  function draftFor(id, { kind = 'part', count = 1, element = null } = {}) {
    const k = DEFAULTS[kind] ? kind : 'part';
    const offer = { ...DEFAULTS[k] };
    const gaps = !(count > 1) && kind !== 'words' && kind !== 'table' ? gapsOf(element) : null;
    if (gaps) offer.auto = `fill ${gaps.cols} from the ${gaps.from}`;
    return actionWords(id, thisOf(kind, count, k === 'part' ? 'part' : kind), offer);
  }

  /**
   * Draw the offer into `container`.
   * @param {object} o
   * @param {HTMLElement} o.container
   * @param {string[]} o.ids          what the card is about
   * @param {string} o.kind           from marbleScope.kindOf, or 'words'
   * @param {string} o.what           the kind as a noun: "row", "selection"
   * @param {number} [o.count]        how many things, when it is a group
   * @param {Element} [o.element]     the thing itself, to read its gaps
   * @param {string} [o.draft]        words to open with (a note)
   * @param {string} [o.action]       an action to open drafted (a chip)
   * @param {boolean} [o.teach]       add the line that teaches asking without selecting
   * @param {string} [o.first]        an action to lead the suggestions with
   * @param {(text: string, meta: object) => void} o.onSend
   * @param {(text: string, meta: object) => void} [o.onKeep]  ⇧⏎
   * @param {() => void} o.onSketch
   * @param {(anchor: Element, text: string) => void} [o.tip]
   * @param {() => void} [o.onResize]
   */
  function mount(o) {
    ensureStyle();
    const kind = DEFAULTS[o.kind] ? o.kind : 'part';
    const offer = { ...DEFAULTS[kind] };
    const gaps = !(o.count > 1) && o.kind !== 'words' && o.kind !== 'table' ? gapsOf(o.element) : null;
    if (gaps) offer.auto = `fill ${gaps.cols} from the ${gaps.from}`;
    const thisWhat = thisOf(o.kind === 'words' ? 'words' : kind, o.count, o.what);

    const root = h('div', 'marble-offer');
    const pill = h('div', 'marble-offer-pill');
    const input = h('div', 'marble-offer-input');
    input.contentEditable = 'true';
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Ask an agent');
    input.setAttribute('aria-multiline', 'true');
    const send = h('button', 'marble-offer-send');
    send.type = 'button';
    send.innerHTML = ICONS.send;
    send.setAttribute('aria-label', 'Send');
    send.hidden = true;
    pill.append(input, send);
    const acts = h('div', 'marble-offer-acts');
    acts.setAttribute('role', 'toolbar');
    acts.setAttribute('aria-label', 'Actions');
    const sugs = h('div', 'marble-offer-sugs');
    const hint = h('div', 'marble-offer-hint');
    root.append(pill, acts, sugs, hint);
    o.container.append(root);

    const placeholder = () => `Ask about ${thisWhat}…`;
    const text = () => input.textContent.trim();
    let act = null;
    let drafted = null;

    // What an action asks for, for this thing: the words it drafts, with the
    // idea after the lead selected so typing replaces it.
    const actionFor = (id) => actionWords(id, thisWhat, offer);

    const caret = (from = null, to = null) => {
      input.focus({ preventScroll: true });
      const range = document.createRange();
      const node = input.firstChild;
      if (node?.nodeType === 3 && from != null) {
        range.setStart(node, Math.min(from, node.length));
        range.setEnd(node, Math.min(to ?? node.length, node.length));
      } else {
        range.selectNodeContents(input);
        range.collapse(false);
      }
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };

    function draft(lead, idea = '') {
      input.textContent = lead + idea;
      drafted = input.textContent;
      input.classList.remove('is-previewing');
      input.dataset.placeholder = placeholder();
      changed();
      if (idea) caret(lead.length, lead.length + idea.length);
      else caret();
    }

    // Pressing an action drafts its words for this thing. On an empty line,
    // or one still holding an untouched draft, the draft replaces it; over
    // words the person typed, the action only frames them. Pressing it again
    // clears its own draft.
    function pick(id) {
      o.tip?.(null);
      if (id === 'sketch') { o.onSketch(); return; }
      const a = actionFor(id);
      const t = text();
      if (act === id && (!t || t === drafted?.trim())) {
        input.textContent = '';
        act = null;
        drafted = null;
        changed();
        caret();
        return;
      }
      act = id;
      const leads = ACTIONS.map(([other]) => actionFor(other).lead).filter(Boolean);
      const had = leads.find((lead) => input.textContent.startsWith(lead));
      if (!t || t === drafted?.trim()) draft(a.lead, a.idea);
      else if (had) draft(a.lead + input.textContent.slice(had.length));
      else draft(a.lead + t);
      paintActs();
    }

    // Pointing at an action shows, in the empty line, exactly what it would
    // ask for here.
    function preview(id, on) {
      if (on && !input.textContent) {
        const a = actionFor(id);
        input.dataset.placeholder = id === 'sketch' ? a.line : a.lead + a.idea;
        input.classList.add('is-previewing');
      } else {
        input.dataset.placeholder = placeholder();
        input.classList.remove('is-previewing');
      }
    }

    for (const [id, name] of ACTIONS) {
      const b = h('button', 'marble-offer-act');
      b.type = 'button';
      b.dataset.act = id;
      b.innerHTML = `${ICONS[id]}<span>${name}</span>`;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') preview(id, true); });
      b.addEventListener('pointerleave', () => preview(id, false));
      b.addEventListener('focus', () => preview(id, true));
      b.addEventListener('blur', () => preview(id, false));
      // A press must not take the caret out of the input it is drafting into.
      b.addEventListener('pointerdown', (event) => event.preventDefault());
      b.addEventListener('click', () => pick(id));
      acts.append(b);
    }
    const paintActs = () => {
      for (const b of acts.children) b.setAttribute('aria-pressed', String(b.dataset.act === act));
    };

    // Two plain edits the four don't cover, written for this thing. When one
    // action is plainly the next step — a row with empty cells — its move
    // leads the list, with its icon.
    function paintSuggestions() {
      sugs.replaceChildren();
      if (text()) { o.onResize?.(); return; }
      const list = offer.sugs.slice(0, 2).map((s) => [null, s]);
      if (gaps) list.unshift(['automate', capital(offer.auto)]);
      else if (o.first === 'variations') list.unshift(['variations', `Try 3 variations of ${thisWhat}`]);
      list.slice(0, 3).forEach(([lead, s], i) => {
        const b = h('button', 'marble-offer-bubble');
        b.type = 'button';
        b.style.setProperty('--i', String(i));
        b.innerHTML = lead ? ICONS[lead] : ICONS.suggest;
        if (lead) b.dataset.act = lead;
        b.append(s);
        b.addEventListener('pointerdown', (event) => event.preventDefault());
        b.addEventListener('click', () => {
          if (lead) {
            act = lead;
            const a = actionFor(lead);
            draft(a.lead, a.idea);
            paintActs();
          } else {
            act = null;
            draft(s);
          }
        });
        sugs.append(b);
      });
      o.onResize?.();
    }

    function paintHint() {
      hint.replaceChildren();
      const key = (k, what) => {
        const span = h('span');
        span.append(h('kbd', '', k), ` ${what}`);
        hint.append(span);
      };
      key('⏎', 'send');
      if (o.onKeep) key('⇧⏎', 'keep as a note');
      key('⌥⏎', 'new line');
      if (o.teach) hint.append(h('span', 'marble-offer-teach', 'No need to select: ⌘J asks about what the pointer is on.'));
    }

    let lastEmpty = null;
    function changed() {
      const t = text();
      send.hidden = !t;
      // Clearing the line lets an action's draft go.
      if (!t) { act = null; drafted = null; paintActs(); }
      const empty = !t;
      if (empty !== lastEmpty) { lastEmpty = empty; paintSuggestions(); }
      o.onResize?.();
    }

    // The kind's defaults paint at once; the host writes suggestions for this
    // element when it can (a small model, seconds away), and they take the
    // defaults' place when they come — unless the person has started typing,
    // when moving the list under them would be the card interrupting.
    (async () => {
      let written = null;
      if (o.fetchOffer) {
        try { written = await o.fetchOffer(); } catch { written = null; }
      }
      if (!root.isConnected || !written) return;
      if (written.automatic && !gaps) offer.auto = written.automatic;
      if (written.interactive) offer.interactive = written.interactive;
      if (written.variations) offer.axes = written.variations;
      const got = (written.suggestions ?? []).map((s) => (typeof s === 'string' ? s : s?.label)).filter(Boolean).map(capital);
      if (!got.length) return;
      offer.sugs = got;
      if (!text()) paintSuggestions();
    })();

    const finish = (keep) => {
      const said = text();
      if (!said) return;
      // An action is what was asked only while its words still lead the line.
      const mode = act && said.startsWith(actionFor(act).lead.trim()) ? act : 'main';
      const meta = { mode, text: said, brief: briefFor(mode, o.ids) };
      if (keep && o.onKeep) o.onKeep(said, meta);
      else o.onSend(said, meta);
    };
    send.addEventListener('click', () => finish(false));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      if (event.altKey) { document.execCommand('insertLineBreak'); return; }
      finish(event.shiftKey);
    });
    input.addEventListener('input', changed);
    // A paste is text, not somebody else's markup.
    input.addEventListener('paste', (event) => {
      const plain = event.clipboardData?.getData('text/plain');
      if (plain == null) return;
      event.preventDefault();
      document.execCommand('insertText', false, plain);
    });

    input.dataset.placeholder = placeholder();
    paintHint();
    changed();
    // Opened with something in it: one of the four drafted for this thing
    // (an offer after an edit), or words to carry on with (a note).
    if (o.action && o.action !== 'sketch') pick(o.action);
    else if (o.draft) { act = null; draft(o.draft); }
    return {
      el: root,
      input,
      // Focusing a card that already has the caret leaves it where it is: a
      // drafted idea stays selected, and a first keystroke is not lost.
      focus: () => { if (document.activeElement !== input) caret(); },
      get mode() { return act ?? 'main'; },
      destroy: () => root.remove(),
    };
  }

  globalThis.marbleOffer = { mount, briefFor, draftFor, DEFAULTS, ACTIONS };
})();
