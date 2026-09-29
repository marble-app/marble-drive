// The offer: what a fresh callout card shows before anything is sent.
//
// Asking starts with Marble saying what the thing could become, not with an
// empty box. So a new card is one quiet input under the element, with four
// bare icons at its end — Variations, Make it automatic, Make it
// interactive, Describe — and a few suggestions written for this element,
// falling in under it one after another.
//
// An icon is a mode, not a form: it lights, writes a starting prompt for
// this element into the input with the idea after the colon selected (type
// over it and keep the ask), and the suggestions stand down. Click it again
// to leave. Everything builds in place; Undo is the way back.
//
// A suggestion drafts, it never sends.
//
// The callout owns the card and the conversation; this only draws the offer
// into a container it is given and hands back the brief to send.

(() => {
  const TRANSIENT = 'data-marble-transient';

  const ICONS = {
    variations: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="7" rx="2"/><rect x="3" y="13" width="8" height="7" rx="2"/><rect x="13" y="13" width="8" height="7" rx="2"/></svg>',
    automatic: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>',
    interactive: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5v-2a1.5 1.5 0 0 1 3 0V12"/><path d="M14 11a1.5 1.5 0 0 1 3 0v1.5"/><path d="M17 12a1.5 1.5 0 0 1 3 0v3a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.9-2.6L5 15.5a1.6 1.6 0 0 1 2.6-1.9L8 14"/></svg>',
    describe: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M7.5 15c2.2-4.6 3.8-6.9 4.8-6.9 1.5 0 .3 6.9 1.8 6.9 1 0 1.9-1.4 2.6-4.2"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  };
  const DOORS = [
    ['variations', 'Variations', 'A few versions to compare'],
    ['automatic', 'Make it automatic', 'Fill or fetch by itself'],
    ['interactive', 'Make it interactive', 'Something to touch, not read'],
    ['describe', 'Describe', 'Sketch and mark what you mean'],
  ];

  // Until the host writes suggestions for this element (POST /agent/offer),
  // these stand in, by kind. They are drafts either way.
  const DEFAULTS = {
    row: { sugs: ['Fill in what is missing', 'Add a one-line takeaway', 'Link it to its source'], auto: 'a Fill button that looks up what is missing', interactive: 'click to change its status' },
    cell: { sugs: ['Fill this in', 'Explain this value', 'Link it to its source'], auto: 'fill this in from the rest of the row', interactive: 'click to edit it in place' },
    table: { sugs: ['Fill in what is missing', 'Sort it by what matters most', 'Add a column saying why each one matters'], auto: 'a Fill button on every row with gaps', interactive: 'sort by clicking a header' },
    heading: { sugs: ['A shorter title', 'Add a line under it that says what this is for', 'Make it match the rest of the page'], auto: 'keep it in step with what the page is about', interactive: 'click to fold what is under it' },
    paragraph: { sugs: ['Tighten it', 'Turn it into a short list', 'Say it more plainly'], auto: 'keep it current with the rest of the page', interactive: 'show the detail only when asked' },
    list: { sugs: ['Order it by what matters', 'Group the items', 'Add what is missing'], auto: 'add an item when I paste a link', interactive: 'drag items to reorder them' },
    item: { sugs: ['Say it more plainly', 'Add a detail', 'Link it to its source'], auto: 'fill in its detail from its title', interactive: 'click to check it off' },
    figure: { sugs: ['Add a caption', 'Describe it for a screen reader', 'Make it the right size for the page'], auto: 'caption it from what it shows', interactive: 'click to see it larger' },
    control: { sugs: ['Say what it does', 'Make it easier to find', 'Give it a clearer label'], auto: 'do this on its own when the page opens', interactive: 'show what will happen before it does' },
    section: { sugs: ['Summarise it in a line', 'Make it easier to scan', 'Split it into parts'], auto: 'keep it up to date', interactive: 'fold it into a summary you can open' },
    words: { sugs: ['Rephrase this', 'Define it', 'Link it to a source'], auto: 'link terms like this to their definition', interactive: 'show a definition on hover' },
    part: { sugs: ['Make it clearer', 'Make it look better', 'Explain what it is for'], auto: 'fill in what is missing when I press a button', interactive: 'make it respond to a click' },
  };

  const STYLE = `
    .marble-offer { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%;
      font: 13px/1.4 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      color: var(--callout-ink, var(--ink, #111)); }
    .marble-offer-pill { box-sizing: border-box; width: 100%; display: flex; align-items: center;
      background: var(--callout-paper, var(--card, #fff)); border: 1px solid color-mix(in srgb, var(--callout-ink, #111) 10%, transparent);
      border-radius: 12px; padding: 3px 4px 3px 12px; box-shadow: 0 6px 22px rgba(0,0,0,.08); transition: border-color 140ms ease; }
    .marble-offer-pill:focus-within { border-color: color-mix(in srgb, var(--callout-mark, #738698) 45%, transparent); }
    .marble-offer-input { flex: 1; min-width: 0; outline: none; font-size: 13.5px; line-height: 1.4; padding: 6px 0; white-space: pre-wrap; }
    .marble-offer-input:empty::before { content: attr(data-placeholder); color: var(--placeholder, #767676); }
    .marble-offer-icons { display: flex; align-items: center; margin-left: 6px; padding-left: 4px; border-left: 1px solid color-mix(in srgb, var(--callout-ink, #111) 8%, transparent); }
    .marble-offer-icon, .marble-offer-send { width: 28px; height: 28px; border: 0; padding: 0; margin: 0; border-radius: 8px; display: grid; place-items: center; cursor: pointer; background: none; }
    .marble-offer-icon { color: var(--faint, #8a8a8a); transition: color 120ms ease, background 120ms ease; }
    .marble-offer-icon svg { width: 16px; height: 16px; }
    .marble-offer-icon:hover, .marble-offer-icon:focus-visible, .marble-offer-icon[aria-pressed="true"] {
      color: var(--callout-mark, #738698); background: var(--accent-soft, #f1f5f8); outline: none; }
    .marble-offer-send { margin-left: 2px; background: var(--callout-mark, #738698); color: var(--callout-paper, #fff); }
    .marble-offer-send svg { width: 14px; height: 14px; }
    .marble-offer-send[hidden] { display: none; }
    .marble-offer-below { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; }
    .marble-offer-bubble { text-align: left; font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 14px; cursor: pointer;
      background: var(--callout-paper, var(--card, #fff)); color: var(--callout-ink, #111);
      border: 1px solid color-mix(in srgb, var(--callout-ink, #111) 9%, transparent); box-shadow: 0 3px 12px rgba(0,0,0,.06);
      opacity: 0; transform: translateY(-6px); animation: marble-offer-cascade 280ms cubic-bezier(.22, 1, .36, 1) forwards;
      animation-delay: calc(var(--i, 0) * 80ms); transition: border-color 120ms ease, color 120ms ease; }
    .marble-offer-bubble:hover, .marble-offer-bubble:focus-visible { border-color: color-mix(in srgb, var(--callout-mark, #738698) 40%, transparent); color: var(--callout-mark, #738698); outline: none; }
    @keyframes marble-offer-cascade { to { opacity: 1; transform: none; } }
      border: 1px solid color-mix(in srgb, var(--callout-ink, #111) 8%, transparent); }
    @media (prefers-reduced-motion: reduce) {
      .marble-offer-bubble { opacity: 1; transform: none; animation: none; }
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
  const lower = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

  const names = (ids) => ids.map((id) => `[data-marble-id="${id}"]`).join(', ');

  /** The brief a mode sends: what was typed, and what the mode means. */
  function briefFor(mode, text, ids) {
    const at = ids.length ? names(ids) : 'the element';
    if (mode === 'variations') {
      return [
        text,
        '',
        `Write them into the document as alternatives, not as prose: wrap ${at} in a <marble-alt> carrying that element's own data-marble-id, move the existing version inside it as the first child with a fresh id and data-marble-alt="v1", and add 2 more children, each a full version of the element with a fresh id, a short data-marble-alt name, and a data-why saying in a few words what it is trying. Set data-marble-active to the original. Do not change anything outside those elements, and do not explain the variations in chat — the page reads them from the file.`,
      ].join('\n');
    }
    if (mode === 'automatic') {
      return [
        text,
        '',
        `Build it into the document as a trigger, not a script: an element carrying data-marble-run="<the brief an agent should be given each time it runs>", data-marble-scope="<the data-marble-id it acts on>" and data-marble-on="press" (a button, labelled with what it does), placed on or beside ${at}. The Drive runs the brief with an agent when it is pressed; the agent does any fetching, never the page. If part of what was asked cannot be done this way, say so in one line.`,
      ].join('\n');
    }
    if (mode === 'interactive') {
      return [
        text,
        '',
        `Change ${at} in place so it can be acted on rather than read: prefer direct manipulation, live feedback and graphics over text. Keep what it says; change how you can act on it. State that must survive a reload goes in the document (attributes or text with ids), not in script variables. Undo is how the person gets the original back.`,
      ].join('\n');
    }
    return text;
  }

  /**
   * Draw the offer into `container`.
   * @param {object} o
   * @param {HTMLElement} o.container
   * @param {string[]} o.ids        what the card is about
   * @param {string} o.kind         from marbleScope.kindOf, or 'words'
   * @param {string} o.what         "row", "these 2 rows", "selection"
   * @param {(brief: string, meta: object) => void} o.onSend
   * @param {() => void} o.onDescribe
   * @param {(anchor: Element, text: string) => void} [o.tip]
   * @param {() => void} [o.onResize]
   */
  function mount(o) {
    ensureStyle();
    const kind = DEFAULTS[o.kind] ? o.kind : 'part';
    const offer = { ...DEFAULTS[kind] };
    const root = h('div', 'marble-offer');
    const pill = h('div', 'marble-offer-pill');
    const input = h('div', 'marble-offer-input');
    input.contentEditable = 'true';
    input.setAttribute('role', 'textbox');
    input.setAttribute('aria-label', 'Ask an agent');
    const icons = h('div', 'marble-offer-icons');
    const send = h('button', 'marble-offer-send');
    send.type = 'button';
    send.innerHTML = ICONS.send;
    send.setAttribute('aria-label', 'Send');
    send.hidden = true;
    pill.append(input, icons, send);
    const below = h('div', 'marble-offer-below');
    root.append(pill, below);
    o.container.append(root);

    let mode = 'main';
    let drafted = null;
    const placeholder = () => ({
      main: o.kind === 'words' ? 'Ask about this selection…' : `Ask about this ${o.what}…`,
      variations: 'Say what the variations should try…',
      automatic: 'Say what should happen by itself…',
      interactive: 'Say what you want to get your hands on…',
    })[mode];
    const text = () => input.textContent.trim();
    const paintSend = () => { send.hidden = !text(); };

    const caret = (from = null) => {
      input.focus({ preventScroll: true });
      const range = document.createRange();
      const node = input.firstChild;
      if (node && from != null) {
        range.setStart(node, Math.min(from, node.length));
        range.setEnd(node, node.length);
      } else {
        range.selectNodeContents(input);
        range.collapse(false);
      }
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };

    const doorPrompt = (id) => {
      if (id === 'variations') return [`Explore 3 variations of this ${o.what}`, null];
      const head = `Make this ${o.what} ${id === 'automatic' ? 'automatic' : 'interactive'}: `;
      return [head + lower(id === 'automatic' ? offer.auto : offer.interactive), head.length];
    };

    const doorButtons = new Map();
    for (const [id, name, line] of DOORS) {
      const b = h('button', 'marble-offer-icon');
      b.type = 'button';
      b.innerHTML = ICONS[id];
      b.dataset.door = id;
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') o.tip?.(b, `${name} · ${line}`); });
      b.addEventListener('pointerleave', () => o.tip?.(null));
      b.addEventListener('focus', () => o.tip?.(b, `${name} · ${line}`));
      b.addEventListener('blur', () => o.tip?.(null));
      b.addEventListener('click', () => {
        o.tip?.(null);
        if (id === 'describe') { o.onDescribe(); return; }
        const leaving = mode === id;
        // Leaving a door takes its prompt with it, unless it was edited.
        if (drafted && text() === drafted) input.textContent = '';
        drafted = null;
        mode = leaving ? 'main' : id;
        paint();
        if (!leaving) {
          const [prompt, from] = doorPrompt(id);
          input.textContent = prompt;
          drafted = prompt;
          caret(from);
        } else caret();
        paintSend();
      });
      icons.append(b);
      doorButtons.set(id, b);
    }

    function paintSuggestions() {
      below.replaceChildren();
      if (mode !== 'main') { o.onResize?.(); return; }
      offer.sugs.forEach((s, i) => {
        const b = h('button', 'marble-offer-bubble', s);
        b.type = 'button';
        b.style.setProperty('--i', String(i));
        b.addEventListener('click', () => { input.textContent = s; paintSend(); caret(); });
        below.append(b);
      });
      o.onResize?.();
    }

    function paint() {
      input.dataset.placeholder = placeholder();
      for (const [id, b] of doorButtons) b.setAttribute('aria-pressed', String(mode === id));
      paintSuggestions();
    }

    // The kind's defaults paint at once; the host writes suggestions for this
    // element when it can (a small model, seconds away), and they take the
    // defaults' place when they come — unless the person has started typing,
    // when moving the bubbles under them would be the card interrupting.
    const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    (async () => {
      let written = null;
      if (o.fetchOffer) {
        try { written = await o.fetchOffer(); } catch { written = null; }
      }
      if (!root.isConnected || !written) return;
      if (written.automatic) offer.auto = written.automatic;
      if (written.interactive) offer.interactive = written.interactive;
      const sugs = (written.suggestions ?? []).map((s) => (typeof s === 'string' ? s : s?.label)).filter(Boolean).slice(0, 3).map(capital);
      if (!sugs.length) return;
      offer.sugs = sugs;
      if (mode === 'main' && !text()) paintSuggestions();
    })();

    const submit = () => {
      const said = text();
      if (!said) return;
      o.onSend(briefFor(mode, said, o.ids), { mode, text: said });
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); }
    });
    input.addEventListener('input', paintSend);
    // A paste is text, not somebody else's markup.
    input.addEventListener('paste', (event) => {
      const plain = event.clipboardData?.getData('text/plain');
      if (plain == null) return;
      event.preventDefault();
      document.execCommand('insertText', false, plain);
    });

    paint();
    return {
      el: root,
      focus: () => caret(),
      get mode() { return mode; },
      destroy: () => root.remove(),
    };
  }

  globalThis.marbleOffer = { mount, briefFor, DEFAULTS };
})();
