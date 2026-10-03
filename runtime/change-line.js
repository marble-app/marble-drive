// The line (v5, Notes and Sketches/Ask at Anything, "Asking, flush with the
// thing"): what ⌘J opens.
//
// Until v5, ⌘J opened a card wider than the thing it was about, with a head,
// tools and doors, and after a send the card stayed on the work as a folded
// chat. Now the thing takes a light tint and one line grows under it, as wide
// as it is: no head, no tools, no chat. The line is the only place words go
// in and the only place words come back.
//
//   - ⏎ folds the line back into the thing. What answers is the thing
//     changing, marked part by part (change-marks.js), and this layer's tint
//     steps aside the moment those marks arrive. A change that landed
//     reopens nothing: rest on it to review it.
//   - A question comes back as its answer, in the line, with the line under
//     it for the next one, in the same conversation.
//   - A change that could not be made gives the words back, with why above
//     them, so it can be said another way.
//   - A question back from the work opens the line with its choices; a press
//     answers it and the work carries on.
//   - Esc puts the line away and keeps its words for the next ⌘J on the same
//     thing. Esc while a change runs stops it, when the page has the keys.
//
// With nothing under the pointer or the caret, ⌘J is about the page, and the
// line sits at the foot of the window. Nothing of the conversation (bubbles,
// status, Undo) is drawn here; the chat holds it, a ⌘⇧J away. Everything is
// transient chrome in one top-layer host; nothing here is filed as an op.
//
// agent-callout.js decides what ⌘J is about and calls `marbleLine.open`.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const GAP = 10;          // px the line hangs under its thing
  const OUT = 6;           // px the thing's tint stands out past it
  const INSIDE = 8;        // px the line keeps inside the window
  const NARROW = 320;      // px, the least a line is wide
  const WIDE = 720;        // px, the most
  const PAGE = 560;        // px, the page's line
  const FOOT = 16;         // px from the foot of the window, for the page's line
  const FADE = 120;        // ms the words take to go on ⏎
  const CLOSE = 220;       // ms the line takes to close into its thing
  const STILL = 150;       // ms, the one crossfade reduced motion keeps
  const LONG = 280;        // characters of an answer before it offers the chat
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';    // arriving and settling
  const COLOUR = 'cubic-bezier(.22, .61, .36, 1)'; // colour only
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  // A question is one that ends with a question mark or opens with a
  // question word; "Do the same to the others" is a change (ruling R17).
  const QUESTION = /^(what|why|how|when|who|which|where)\b/i;
  const ENDS = new Set(['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted', 'turn.removed']);

  // The parts' own unit, named the way the marks count them (change-marks.js).
  const unitOf = (el) => window.marbleChange?.unitOf?.(el) ?? ['part', 'parts'];

  const STYLE = `
    .marble-line-host {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none; color: inherit;
      --line-accent: var(--accent, light-dark(#9bb6cf, #7fa8c9));
      --line-ink: var(--accent-ink, light-dark(#738698, #9dc0dc));
      --line-card: var(--card, var(--paper, light-dark(#fff, #1f2023)));
      --line-text: var(--ink, light-dark(#1d1d1f, #ececee));
      --line-muted: var(--muted, light-dark(#5f6267, #a6a9ae));
      --line-faint: var(--faint, light-dark(#8b8e93, #7e8187));
      --line-rule: var(--line, color-mix(in srgb, var(--line-text) 14%, transparent));
      --line-font: var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif));
      font: 14px/1.45 var(--line-font);
    }
    .marble-line-host:popover-open { position: fixed; inset: 0; }
    /* While pointing (agent-callout.js), the pointer names what is under the
       line, so the line lets it through. */
    html.marble-callout-latched .marble-line-host * { pointer-events: none !important; }
    .marble-line-aloud { position: fixed; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
      clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

    /* What the line is about: a fill out past its edge, the way a selection
       is shown. Never a border down one side. */
    .marble-line-scope { position: fixed; left: 0; top: 0; box-sizing: border-box; border-radius: 12px; pointer-events: none;
      background-color: color-mix(in srgb, var(--line-accent) 14%, transparent);
      opacity: 1; transition: opacity 200ms ${EASE}; }
    @starting-style { .marble-line-scope { opacity: 0; } }
    .marble-line-scope[data-state="out"] { opacity: 0; }
    .marble-line-scope[hidden] { display: none; }

    /* The line: one ring of the accent all the way round, on the page's own
       card, so it reads as part of the thing above it. */
    .marble-line { position: fixed; left: 0; top: 0; box-sizing: border-box; pointer-events: auto;
      display: grid; gap: 6px; padding: 6px 6px 6px 10px; border-radius: 10px;
      background: var(--line-card); color: var(--line-text);
      box-shadow: 0 0 0 1px var(--line-ink), 0 0 0 4px color-mix(in srgb, var(--line-accent) 30%, transparent),
                  var(--shadow-lift, 0 10px 28px -12px rgba(0, 0, 0, .3));
      transform-origin: 50% 0; opacity: 1; transform: none;
      transition: opacity 200ms ${EASE}, transform 200ms ${EASE}; }
    @starting-style { .marble-line { opacity: 0; transform: translateY(-4px); } }
    .marble-line[data-flip], .marble-line[data-scope="page"] { transform-origin: 50% 100%; }
    @starting-style { .marble-line[data-flip], .marble-line[data-scope="page"] { transform: translateY(4px); } }
    .marble-line button { font: inherit; }
    .marble-line button:focus-visible { outline: 2px solid var(--line-ink); outline-offset: 2px; }

    .marble-line-row { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .marble-line-input { flex: 1; min-width: 0; margin: 0; padding: 1px 0; outline: none;
      font-family: var(--line-font); font-size: 14px; font-weight: 400; line-height: 1.45; color: var(--line-text);
      white-space: pre-wrap; overflow-wrap: anywhere; max-height: calc(3 * 1.45em); overflow-y: auto;
      caret-color: var(--line-ink); }
    .marble-line-input:empty::before { content: attr(data-placeholder); color: var(--placeholder, var(--line-faint)); pointer-events: none; }
    .marble-line kbd { flex: none; margin-top: 1px; padding: 2px 5px; border-radius: 4px; border: 1px solid var(--line-rule);
      font: 500 11px/1.2 ui-monospace, "SF Mono", Menlo, monospace; color: var(--line-faint); background: none; }

    /* Why nothing changed, over the words given back. */
    .marble-line-said { margin: 0; font-size: 13px; line-height: 1.4; color: var(--line-muted); overflow-wrap: anywhere; }
    .marble-line[data-failed] .marble-line-said { color: var(--danger, var(--line-muted)); }

    /* An answer: a sentence or two, six lines at most before it scrolls, and
       the line for the next question under a rule. */
    .marble-line-answer { margin: 0; padding-right: 4px; line-height: 1.45; color: var(--line-text);
      white-space: pre-wrap; overflow-wrap: anywhere; max-height: calc(6 * 1.45em); overflow-y: auto; }
    .marble-line-open { justify-self: start; appearance: none; margin: -2px 0 0 -6px; padding: 2px 6px; border: 0; border-radius: 6px;
      background: none; color: var(--line-ink); font-size: 12.5px; font-weight: 500; line-height: 1.4; cursor: pointer;
      transition: background-color 120ms ${COLOUR}; }
    .marble-line-open:hover { background: color-mix(in srgb, var(--line-accent) 14%, transparent); }
    .marble-line-more { padding-top: 6px; border-top: 1px solid var(--line-rule); }

    /* A question back: what it asks, and a press for each choice. */
    .marble-line-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .marble-line-question { flex: 1 1 12ch; min-width: 0; font-weight: 500; color: var(--line-text); overflow-wrap: anywhere; }
    .marble-line-opts { display: flex; flex-wrap: wrap; gap: 6px; }
    .marble-line-opt { appearance: none; margin: 0; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line-rule);
      background: var(--line-card); color: var(--line-text); font-size: 12.5px; font-weight: 500; line-height: 1.4; cursor: pointer;
      transition: background-color 120ms ${COLOUR}, border-color 120ms ${COLOUR}; }
    .marble-line-opt:hover { background: color-mix(in srgb, var(--line-accent) 14%, var(--line-card));
      border-color: color-mix(in srgb, var(--line-ink) 40%, transparent); }
    .marble-line-opt:active { background: color-mix(in srgb, var(--line-accent) 26%, var(--line-card)); }
    .marble-line-opt:disabled { opacity: .55; cursor: default; }

    /* The words a line is about, when it is about words. */
    ::highlight(marble-line-words) { background-color: color-mix(in srgb, var(--accent, light-dark(#9bb6cf, #7fa8c9)) 34%, transparent); }

    @media (prefers-reduced-motion: reduce) {
      .marble-line { transition: opacity ${STILL}ms linear; }
      .marble-line-scope { transition: opacity ${STILL}ms linear; }
      .marble-line-open, .marble-line-opt { transition: none; }
    }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    // The Agents page hosts its own conversation UI.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-line-host')) return;
    const app = marble.app;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    // In the top layer, so a document's own stacking contexts cannot cover it.
    const host = document.createElement('div');
    host.className = 'marble-line-host';
    host.setAttribute(TRANSIENT, '');
    host.setAttribute('popover', 'manual');
    document.documentElement.append(host);
    try { host.showPopover(); } catch { /* no popover here: fixed positioning still stands */ }
    // What the line says when it comes back on its own (an answer, why
    // nothing changed, a question) is read out, whether or not it has the keys.
    const aloud = document.createElement('div');
    aloud.className = 'marble-line-aloud';
    aloud.setAttribute('role', 'status');
    aloud.setAttribute('aria-atomic', 'true');
    host.append(aloud);

    const byId = (id) => {
      const el = id ? (marble.byId?.(id) ?? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`)) : null;
      return el && el.isConnected && !el.closest(`[${TRANSIENT}]`) ? el : null;
    };
    const elementsOf = (ids) => (ids ?? []).map(byId).filter(Boolean);
    const said = (node) => (node?.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    const viewW = () => document.documentElement.clientWidth || innerWidth;
    const viewH = () => document.documentElement.clientHeight || innerHeight;
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));

    // ------------------------------------------------------------ drafts
    // Words put away with Esc wait, per thing, for this tab's next ⌘J on it.

    const DRAFTS = `marble-line-drafts:${app}`;
    const drafts = () => {
      try { return JSON.parse(sessionStorage.getItem(DRAFTS) || '{}') ?? {}; } catch { return {}; }
    };
    const keepDraft = (key, text) => {
      const all = drafts();
      if (text) all[key] = text;
      else delete all[key];
      try { sessionStorage.setItem(DRAFTS, JSON.stringify(all)); } catch { /* private mode: the words go with the line */ }
    };

    // ------------------------------------------------------------ sessions
    // One session per thing asked about: its scope, its conversation once
    // there is one, and the turn it is waiting on. One line is on screen at
    // a time; a session whose change still runs keeps its tint, and comes
    // back to the line when its work has something to say.

    const sessions = new Set();
    let shown = null;

    const keyOf = (s) => (s.page ? 'page' : s.words ? `words:${s.words.text}` : s.ids.join(','));

    function placeholderOf(s) {
      if (s.page) return 'Change this page';
      if (s.words) return 'Change these words';
      const els = elementsOf(s.ids);
      if (els.length > 1) {
        const units = [...new Set(els.map((el) => unitOf(el)[1]))];
        return `Change these ${els.length} ${units.length === 1 ? units[0] : 'parts'}`;
      }
      return `Change this ${unitOf(els[0])[0]}`;
    }

    function makeSession({ ids, scope, from, conversation }) {
      const page = !ids.length;
      const range = !page && scope && typeof scope === 'object' && scope.words ? scope.range : null;
      const words = range && !range.collapsed
        ? { range: range.cloneRange(), text: range.toString().replace(/\s+/g, ' ').trim() }
        : null;
      let chain = !page && scope && Array.isArray(scope.chain) ? scope.chain.filter(Boolean) : [];
      let index = Number(scope?.index) || 0;
      if (ids.length === 1) {
        const el = byId(ids[0]);
        if (!chain.length && el) { chain = globalThis.marbleScope?.chainFrom(el) ?? [el]; index = 0; }
        const at = chain.indexOf(el);
        if (at >= 0) index = at;
      }
      return {
        ids: [...ids], page, words, chain, index, from,
        action: null, conversation: conversation ?? null, convo: null, off: null, after: 0,
        turn: null, awaiting: false, asked: '', texts: [], ask: null,
        state: null, el: null, input: null, tint: null, handed: false, failed: false,
        answer: '', said: '', returnTo: null, stop: false,
      };
    }

    const running = () => {
      let found = null;
      for (const s of sessions) if (s.conversation && s.turn) found = s;
      return found ? { conversation: found.conversation, turn: found.turn } : null;
    };
    const busy = (s) => Boolean(s.turn || s.awaiting);

    /** Done with a session: its line, its tint, its stream and its hidden
     *  conversation go. */
    function drop(s) {
      sessions.delete(s);
      if (shown === s) shown = null;
      s.off?.();
      s.off = null;
      s.convo?.remove();
      s.convo = null;
      if (s.el) { const el = s.el; s.el = null; s.input = null; leave(el); }
      handOff(s);
      schedule();
    }

    // ------------------------------------------------------------ the tint

    function paintScope(s) {
      const want = !s.page && !s.words && !s.handed && sessions.has(s);
      if (want && !s.tint) {
        const tint = document.createElement('i');
        tint.className = 'marble-line-scope';
        tint.setAttribute(TRANSIENT, '');
        tint.setAttribute('aria-hidden', 'true');
        host.prepend(tint);
        s.tint = tint;
      } else if (!want && s.tint) {
        const tint = s.tint;
        s.tint = null;
        tint.dataset.state = 'out';
        setTimeout(() => tint.remove(), stillness.matches ? STILL : 220);
      }
      paintWords();
    }

    function paintWords() {
      if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return;
      const ranges = [...sessions].filter((s) => s.words && !s.handed).map((s) => s.words.range);
      if (ranges.length) CSS.highlights.set('marble-line-words', new Highlight(...ranges));
      else CSS.highlights.delete('marble-line-words');
    }

    /** The marks have the change now (or it is over): this layer's tint
     *  gives way to theirs. */
    function handOff(s) {
      if (s.handed && !s.tint) return;
      s.handed = true;
      paintScope(s);
    }
    const claimed = (s) => {
      const client = `agent:${s.conversation}`;
      return Boolean(window.marbleChange?.claims?.(client) || window.marbleText?.claims?.(client));
    };
    const checkClaims = () => {
      for (const s of sessions) if (s.conversation && !s.handed && busy(s) && s.state !== 'edit' && claimed(s)) handOff(s);
    };
    addEventListener('marble-change:claims', checkClaims);
    addEventListener('marble-text:claims', checkClaims);
    // After the marks have read the frame (they listen in capture).
    document.addEventListener('marble:presence', () => queueMicrotask(checkClaims));

    // ------------------------------------------------------------ geometry

    function rectOf(els) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      return left === Infinity ? null : { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    function placeLine(s, r) {
      const el = s.el;
      const vw = viewW();
      const vh = viewH();
      if (!r) {
        const width = Math.min(PAGE, vw - 32);
        el.style.width = `${Math.round(width)}px`;
        const h = el.offsetHeight;
        Object.assign(el.style, { left: `${Math.round((vw - width) / 2)}px`, top: `${Math.round(vh - FOOT - h)}px` });
        el.toggleAttribute('data-flip', false);
        return;
      }
      const width = Math.min(Math.max(r.width, NARROW), WIDE, vw - INSIDE * 2);
      // Flush with its thing; centred on it when the thing is narrower than a
      // line can be.
      const left = clamp(r.width >= NARROW ? r.left : r.left + r.width / 2 - width / 2, INSIDE, vw - INSIDE - width);
      el.style.width = `${Math.round(width)}px`;
      const h = el.offsetHeight;
      let top = r.bottom + GAP;
      let flip = false;
      if (top + h > vh - INSIDE && r.top - GAP - h >= INSIDE) { top = r.top - GAP - h; flip = true; }
      top = clamp(top, INSIDE, Math.max(INSIDE, vh - INSIDE - h));
      Object.assign(el.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
      el.toggleAttribute('data-flip', flip);
    }

    const observed = new Set();
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    function watch(els) {
      if (!resized) return;
      const want = new Set(els);
      for (const el of observed) if (!want.has(el)) { resized.unobserve(el); observed.delete(el); }
      for (const el of want) if (!observed.has(el)) { resized.observe(el); observed.add(el); }
    }

    function place() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const watching = [];
      for (const s of [...sessions]) {
        const els = s.page ? [] : elementsOf(s.ids);
        watching.push(...els);
        // The thing went: a line still being written goes with it, and keeps
        // its words. One with something to say says it at the foot instead.
        if (s === shown && s.el && !s.page && !els.length && s.state === 'edit') { put(s, { keep: true }); continue; }
        const r = els.length ? rectOf(els) : null;
        if (s.tint) {
          s.tint.hidden = !r;
          if (r) {
            Object.assign(s.tint.style, {
              left: `${Math.round(r.left - OUT)}px`, top: `${Math.round(r.top - OUT)}px`,
              width: `${Math.round(r.width + OUT * 2)}px`, height: `${Math.round(r.height + OUT * 2)}px`,
            });
          }
        }
        if (s === shown && s.el) {
          if (s.page || r || !els.length) placeLine(s, s.page ? null : r);
          watching.push(s.el);
        }
      }
      watch(watching);
    }
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('marble:ops', schedule);

    // ------------------------------------------------------------ drawing

    const h = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };

    function makeInput(s, label, text = '') {
      const input = h('div', 'marble-line-input');
      input.setAttribute('contenteditable', 'plaintext-only');
      if (input.contentEditable !== 'plaintext-only') input.setAttribute('contenteditable', 'true');
      input.setAttribute('role', 'textbox');
      input.setAttribute('aria-multiline', 'true');
      input.setAttribute('aria-label', label);
      input.dataset.placeholder = label;
      input.spellcheck = true;
      input.textContent = text;
      input.addEventListener('keydown', (event) => onKey(s, event));
      input.addEventListener('input', () => {
        // An emptied line holds a stray break, which would hide its placeholder.
        if (!input.textContent) input.replaceChildren();
        schedule();
      });
      // A paste is words, not somebody else's markup.
      input.addEventListener('paste', (event) => {
        const plain = event.clipboardData?.getData('text/plain');
        if (plain == null) return;
        event.preventDefault();
        document.execCommand('insertText', false, plain);
      });
      return input;
    }
    const kbd = (text) => {
      const k = h('kbd', '', text);
      k.setAttribute('aria-hidden', 'true');
      return k;
    };

    function caretAt(input, from = null, to = null) {
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
    }

    /** Where the keys were before the line took them: the element, and the
     *  caret when it was in something editable. */
    function keysNow() {
      let a = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      if (!a || a === document.body || a === document.documentElement || host.contains(a)) return null;
      const sel = getSelection();
      const range = a.isContentEditable && sel?.rangeCount && a.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
      return { el: a, range };
    }
    function giveBack(to) {
      if (!to?.el?.isConnected) return;
      to.el.focus({ preventScroll: true });
      if (to.range && to.el.contains(to.range.startContainer)) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(to.range);
      }
    }
    const holdsKeys = (s) => Boolean(s.el && s.el.contains(document.activeElement));

    // A line coming back on its own takes the keys only from nobody.
    const mayTakeFocus = () => {
      const a = document.activeElement;
      return !a || a === document.body || a === document.documentElement || host.contains(a);
    };

    /** Draw `s` in the line, in `state`. */
    function show(s, state, { text = '', focus = true } = {}) {
      // A line taking the place of one that had the keys gives them back,
      // when it goes, to where that one would have.
      const inherited = shown && shown !== s && holdsKeys(shown) ? shown.returnTo : null;
      if (shown && shown !== s) put(shown, { keep: true, restore: false });
      shown = s;
      s.state = state;
      let el = s.el;
      if (!el) {
        el = h('div', 'marble-line');
        el.setAttribute(TRANSIENT, '');
        // Esc anywhere in the line, its words or its buttons, puts it away.
        el.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape' || event.isComposing || s.el !== el) return;
          event.preventDefault();
          event.stopPropagation();
          put(s, { keep: true });
        });
        host.append(el);
        s.el = el;
      }
      for (const a of el.getAnimations({ subtree: true })) a.cancel();
      el.style.pointerEvents = '';
      el.dataset.state = state;
      if (s.page) el.dataset.scope = 'page';
      else delete el.dataset.scope;
      el.toggleAttribute('data-failed', state === 'cant' && s.failed);
      el.replaceChildren();
      let input = null;
      if (state === 'edit' || state === 'cant') {
        const label = placeholderOf(s);
        if (state === 'cant') el.append(h('p', 'marble-line-said', s.said));
        input = makeInput(s, label, text);
        const row = h('div', 'marble-line-row');
        row.append(input, kbd('⏎'));
        el.append(row);
      } else if (state === 'answer') {
        const answer = h('p', 'marble-line-answer', s.answer);
        el.append(answer);
        if (s.answer.length > LONG && s.conversation) {
          const open = h('button', 'marble-line-open', 'Open in chat');
          open.type = 'button';
          open.addEventListener('click', () => {
            const id = s.conversation;
            put(s, { keep: false, restore: false });
            agent.open?.(id);
          });
          el.append(open);
        }
        input = makeInput(s, 'Ask more');
        const row = h('div', 'marble-line-row marble-line-more');
        row.append(input, kbd('esc'));
        el.append(row);
      } else if (state === 'ask') {
        const q = s.ask?.input?.questions?.[0] ?? {};
        const ask = h('div', 'marble-line-ask');
        const opts = h('div', 'marble-line-opts');
        opts.setAttribute('role', 'group');
        opts.setAttribute('aria-label', q.question ?? '');
        for (const option of q.options ?? []) {
          const b = h('button', 'marble-line-opt', option.label);
          b.type = 'button';
          if (option.description) b.title = option.description;
          b.addEventListener('click', () => reply(s, option.label));
          opts.append(b);
        }
        ask.append(h('span', 'marble-line-question', q.question ?? ''), opts);
        el.append(ask);
        input = makeInput(s, 'Type an answer');
        const row = h('div', 'marble-line-row');
        row.append(input, kbd('⏎'));
        el.append(row);
      }
      s.input = input;
      paintScope(s);
      place();
      if (state === 'answer' || state === 'cant' || state === 'ask') {
        aloud.textContent = state === 'answer' ? s.answer : state === 'cant' ? s.said : (s.ask?.input?.questions?.[0]?.question ?? '');
      } else aloud.textContent = '';
      if (input && focus) {
        if (!holdsKeys(s)) s.returnTo = keysNow() ?? inherited;
        caretAt(input);
        // Again once it has its place, in case something took the keys back
        // while it was drawn.
        requestAnimationFrame(() => { if (s.input === input && document.activeElement !== input && mayTakeFocus()) caretAt(input); });
      }
    }

    /** A line leaving: a short fade, then gone. One already folding into
     *  its thing finishes folding instead. */
    function leave(el) {
      el.style.pointerEvents = 'none';
      // No longer the line: nothing should take it for the one on screen.
      el.setAttribute('data-leaving', '');
      el.inert = true;
      const gone = () => el.remove();
      if (el.dataset.state === 'sent') {
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).then(gone, gone);
        return;
      }
      for (const a of el.getAnimations({ subtree: true })) a.cancel();
      try {
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: stillness.matches ? STILL : FADE, easing: EASE, fill: 'forwards' }).finished.then(gone, gone);
      } catch { gone(); }
    }

    /** Put the line away, keeping its words (or not) for this thing, and
     *  give the keys back to where they were if the line had them: at once
     *  (`restore: true`), or after a press outside if that press did not take
     *  them itself (`'press'`). */
    function put(s, { keep = true, restore = true } = {}) {
      if (!s) return;
      const was = s.state;
      const had = holdsKeys(s);
      const to = s.returnTo;
      // Words typed in any of its inputs (an ask, more to an answer, a draft)
      // wait for the next ⌘J on the same thing.
      if (s.input) {
        const words = said(s.input);
        if (keep && words) keepDraft(keyOf(s), words);
        else if (!keep || was === 'edit' || was === 'cant') keepDraft(keyOf(s), '');
      }
      if (shown === s) shown = null;
      aloud.textContent = '';
      if (s.el) { const el = s.el; s.el = null; s.input = null; leave(el); }
      if (had && restore === true) giveBack(to);
      else if (had && restore === 'press') {
        // Wait for the press to land: one that focused something has
        // decided where the keys go.
        addEventListener('pointerup', () => setTimeout(() => {
          const a = document.activeElement;
          if (!a || a === document.body || a === document.documentElement) giveBack(to);
        }, 0), { once: true, capture: true });
      }
      if (busy(s)) {
        // Its change still runs: the line goes, the session stays for what
        // the work says next.
        s.state = 'sent';
      } else {
        s.state = null;
        drop(s);
      }
      if (was === 'edit') agent.select(null);
      document.dispatchEvent(new CustomEvent('marble-line:closed'));
    }

    /** ⏎: the words go and the line closes its height into the thing. The
     *  keys go back where they were, unless that was inside the thing being
     *  changed: a caret there would hold the change off its own part (the
     *  engine and the marks leave a part with a hand in it alone). */
    function fold(s) {
      if (shown === s) shown = null;
      s.state = 'sent';
      aloud.textContent = '';
      const el = s.el;
      if (!el) return;
      el.dataset.state = 'sent';
      el.style.pointerEvents = 'none';
      if (s.input) {
        const had = holdsKeys(s);
        s.input.setAttribute('contenteditable', 'false');
        if (document.activeElement === s.input) s.input.blur();
        const to = s.returnTo;
        const inThing = to && elementsOf(s.ids).some((part) => part.contains(to.el) || to.el.contains(part));
        if (had && to && !inThing) giveBack(to);
      }
      // A line that came back before it finished closing is not this one's.
      const gone = () => {
        if (s.el !== el || s.state !== 'sent') return;
        s.el = null;
        s.input = null;
        el.remove();
        document.dispatchEvent(new CustomEvent('marble-line:closed'));
      };
      try {
        if (stillness.matches) {
          el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: STILL, fill: 'forwards' }).finished.then(gone, gone);
          return;
        }
        for (const child of el.children) child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE, easing: EASE, fill: 'forwards' });
        el.animate([{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(0)', opacity: 0 }], { duration: CLOSE, delay: FADE - 20, easing: EASE, fill: 'forwards' })
          .finished.then(gone, gone);
      } catch { gone(); }
    }

    // ------------------------------------------------------------ keys

    function onKey(s, event) {
      if (event.isComposing) return;
      const input = s.input;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.altKey) { document.execCommand('insertText', false, '\n'); return; }
        const text = said(input);
        if (event.shiftKey) { if (s.state === 'edit' || s.state === 'cant') keepAsNote(s, text); return; }
        if (!text) return;
        if (s.state === 'ask') reply(s, text);
        else send(s, text);
        return;
      }
      // [ takes in the containing element, ] steps back in, while the line
      // has nothing in it to type them into.
      if ((event.key === '[' || event.key === ']') && !event.altKey && !event.metaKey && !event.ctrlKey
        && s.state === 'edit' && !input?.textContent && s.ids.length === 1) {
        const next = s.index + (event.key === '[' ? 1 : -1);
        const el = s.chain[next];
        if (!el?.isConnected) return;
        event.preventDefault();
        s.index = next;
        s.ids = [el.getAttribute('data-marble-id')];
        s.words = null;
        agent.select(s.ids);
        const label = placeholderOf(s);
        input.dataset.placeholder = label;
        input.setAttribute('aria-label', label);
        paintScope(s);
        place();
      }
    }

    // ⇧⏎: the ask waits as a note on its thing (agent-notes.js), and the line
    // goes, so the next thing can be pointed at.
    function keepAsNote(s, text) {
      const notes = window.marbleNotes;
      if (!notes || !text || s.page) return;
      const mode = s.action && text.startsWith(s.action.lead) ? s.action.mode : 'main';
      notes.add({ ids: [...s.ids], text, brief: globalThis.marbleOffer?.briefFor?.(mode, s.ids) ?? '', name: window.marbleCallout?.nameFor?.(s.ids) ?? '' });
      put(s, { keep: false });
      agent.select(null);
    }

    // ------------------------------------------------------------ sending

    /** What rides beside the words, unseen: where they were asked, and how
     *  the answer comes back. */
    function briefFor(s) {
      const at = s.ids.map((id) => `[data-marble-id="${id}"]`).join(', ');
      const where = s.page
        ? 'Asked in a line at the foot of the page the person is looking at, about the whole page.'
        : s.words
          ? `Asked in a line under the words "${s.words.text.slice(0, 300)}" in ${at}, on the page the person is looking at.`
          : `Asked in a line under ${at}, on the page the person is looking at.`;
      return [
        where,
        'Change it in place: the page changing is the answer, and the person watches it change.',
        'If the words ask a question, answer in a sentence or two in that line and change nothing.',
        'If nothing can be changed, say why in one sentence.',
      ].join(' ');
    }

    function convoFor(s) {
      if (s.convo?.isConnected) return s.convo;
      // A real conversation, kept out of sight: the line is its composer.
      const convo = document.createElement('marble-conversation');
      convo.setAttribute(TRANSIENT, '');
      convo.dataset.chrome = 'callout';
      convo.setAttribute('project', 'drive');
      convo.setAttribute('data-folded', '');
      convo.style.display = 'none';
      convo.addEventListener('conversation', (event) => {
        const id = event.detail?.id ?? null;
        if (!id || id === s.conversation) return;
        s.conversation = id;
        agent.attend?.(id);
        follow(s, id);
      });
      host.append(convo);
      // The attribute after the append: the component only loads once connected.
      if (s.conversation) convo.setAttribute('conversation', s.conversation);
      s.convo = convo;
      return convo;
    }

    async function follow(s, id, { baseline = false } = {}) {
      s.off?.();
      s.off = null;
      s.after = 0;
      // A conversation that already has turns: only what happens from here
      // on is this line's.
      if (baseline) {
        try { s.after = Number((await agent.conversation(id, { turns: 0 }))?.seq) || 0; } catch { s.after = 0; }
      }
      if (!sessions.has(s)) return;
      s.off = agent.on(id, (event) => onEvent(s, event), { after: s.after });
    }

    async function send(s, text, { brief = null, keepWords = false } = {}) {
      const ids = [...s.ids];
      if (!keepWords) keepDraft(keyOf(s), '');
      s.asked = text;
      s.texts = [];
      s.turn = null;
      s.awaiting = true;
      s.stop = false;
      s.ask = null;
      s.failed = false;
      s.handed = false;
      const mode = s.action && text.startsWith(s.action.lead) ? s.action.mode : 'main';
      const meaning = mode === 'main' ? '' : (globalThis.marbleOffer?.briefFor?.(mode, ids) ?? '');
      const hidden = [briefFor(s), meaning, brief].filter(Boolean).join('\n\n');
      if (mode === 'variations') dispatchEvent(new CustomEvent('marble-variations:watch', { detail: { ids } }));
      fold(s);
      paintScope(s);
      if (s.conversation && !s.off) await follow(s, s.conversation, { baseline: true });
      const convo = convoFor(s);
      // Pinned for the send, so the brief carries what the line is about,
      // and let go after it: the next selection is the person's again.
      agent.select(ids.length ? ids : null);
      agent.brief?.(hidden);
      if (s.words?.range) dispatchEvent(new CustomEvent('marble-text:words', { detail: { range: s.words.range } }));
      try {
        await convo.sendNow(text);
      } finally {
        agent.select(null);
      }
      // A send the host refused leaves the words in the composer, and the
      // reason in its log.
      const stuck = String(convo.input?.value ?? '').trim() || !convo.getAttribute('conversation');
      if (stuck) {
        // The host's own words are for the console; the page says it plainly.
        const why = [...(convo.shadowRoot?.querySelectorAll('.system.error') ?? [])].at(-1)?.textContent?.trim();
        if (why) console.warn(`marble-line: the send was refused: ${why}`);
        try { convo.input.value = ''; } catch { /* nothing to clear */ }
        s.awaiting = false;
        s.stop = false;
        s.failed = true;
        s.said = "Couldn't send. Try again.";
        handOff(s);
        reopen(s, 'cant', { text });
        return;
      }
      document.dispatchEvent(new CustomEvent('marble-line:sent', { detail: { conversation: s.conversation, ids } }));
    }

    // ------------------------------------------------------------ the work

    function onEvent(s, event) {
      if (!event || typeof event !== 'object' || !sessions.has(s)) return;
      if (event.seq != null && event.seq <= s.after) return;
      const type = event.type;
      if (type === 'turn.started') {
        if (!s.awaiting) return;
        s.awaiting = false;
        s.turn = event.turn;
        s.texts = [];
        // Esc came before the turn had an id: it stops now.
        if (s.stop) { s.stop = false; agent.cancel(s.turn).catch(() => { /* already over */ }); }
        return;
      }
      if (!s.turn || event.turn !== s.turn) return;
      if (type === 'text' && event.text) s.texts.push(String(event.text));
      else if (type === 'ask') asked(s, event);
      else if ((type === 'ask.answered' || type === 'ask.void') && s.ask?.requestId === event.requestId) {
        s.ask = null;
        if (shown === s && s.state === 'ask') fold(s);
      } else if (ENDS.has(type)) ended(s, event);
    }

    // A question with choices comes to the line; anything else it asks (a
    // permission, several questions at once) is the chat's to show.
    function asked(s, event) {
      const questions = event.kind === 'question' ? event.input?.questions : null;
      if (!Array.isArray(questions) || questions.length !== 1 || !questions[0]?.question) {
        agent.open?.(s.conversation);
        return;
      }
      s.ask = event;
      reopen(s, 'ask');
    }

    /** An answer to a question back, pressed or typed, in the shape the chat
     *  sends (agent-ui.js, askResponse). */
    async function reply(s, label) {
      const ask = s.ask;
      if (!ask || !s.turn) return;
      const q = ask.input.questions[0];
      const picks = new Map([[q.question, new Set([label])]]);
      const response = window.marbleAgentUI?.askResponse?.('question', ask.input, picks)
        ?? { behavior: 'allow', updatedInput: { ...ask.input, answers: { [q.question]: label } } };
      const buttons = [...(s.el?.querySelectorAll('button') ?? [])];
      for (const b of buttons) b.disabled = true;
      try {
        await agent.answer(s.turn, ask.requestId, response);
      } catch {
        for (const b of buttons) b.disabled = false;
        return;
      }
      if (s.ask === ask) s.ask = null;
      if (shown === s && s.state === 'ask') fold(s);
    }

    const firstSentences = (text, n) => {
      const parts = String(text ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
      return parts.slice(0, n).join(' ');
    };
    // What the agent wrote, as words: no emphasis marks or code ticks.
    const plain = (text) => String(text ?? '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
    const isQuestion = (text) => /\?\s*$/.test(text) || QUESTION.test(String(text).trim());

    function ended(s, event) {
      s.turn = null;
      s.awaiting = false;
      s.stop = false;
      s.ask = null;
      handOff(s);
      const applied = Number(event.applied) || 0;
      // It changed something, or the person stopped it: the page says the
      // rest, and review takes over.
      if (applied > 0 || event.type === 'turn.cancelled' || event.type === 'turn.removed') {
        if (shown === s) put(s, { keep: false });
        else if (sessions.has(s)) drop(s);
        return;
      }
      const last = plain(s.texts.at(-1));
      if (isQuestion(s.asked) && event.type === 'turn.completed') {
        s.answer = last || 'No answer came back.';
        reopen(s, 'answer');
        return;
      }
      s.failed = event.type !== 'turn.completed';
      const why = firstSentences(last, 2);
      s.said = why || (s.failed ? (firstSentences(event.error, 1) ? `Didn't finish. ${firstSentences(event.error, 1)}` : "Didn't finish.") : 'Nothing changed.');
      reopen(s, 'cant', { text: s.asked });
    }

    /** The work has something to say: the line comes back on its thing,
     *  putting away (and keeping) whatever line was there. */
    function reopen(s, state, { text = '' } = {}) {
      if (!sessions.has(s)) return;
      show(s, state, { text, focus: mayTakeFocus() });
      // The line speaks for this change now; the marks need not (ruling R16).
      if (s.conversation) document.dispatchEvent(new CustomEvent('marble-line:speaks', { detail: { conversation: s.conversation, state } }));
    }

    // ------------------------------------------------------------ leaving

    // A line nobody is using is put away by looking elsewhere: a press
    // outside it and outside its thing.
    addEventListener('pointerdown', (event) => {
      const s = shown;
      if (!s?.el || s.state === 'sent') return;
      // Pointing (agent-callout.js) is not looking away: ⇧-click adds to it.
      if (document.documentElement.classList.contains('marble-callout-latched')) return;
      if (host.contains(event.target)) return;
      if (event.composedPath().some((n) => n?.localName === 'marble-agent-drawer')) return;
      if (!s.page && elementsOf(s.ids).some((el) => el.contains(event.target))) return;
      put(s, { keep: true, restore: 'press' });
    }, true);

    // Esc while a change from the line runs stops it, but only when the page
    // itself had the key. Where it came from is read off the event's path,
    // not off the focus at the end: the chat hands the keys back to the page
    // on Esc without taking the key, and a panel that closes on Esc leaves
    // nothing open by the time the key bubbles. So it is judged in capture,
    // before anything acts on it, and never from a field, an editable, a
    // component (the chat), the drive's own chrome, a dialog, a popover or a
    // menu, nor while the variations panel, the tour of a change, Describe
    // mode or pointing is open.
    function anotherOverlay() {
      const html = document.documentElement;
      if (html.classList.contains('marble-callout-latched')) return true;
      const marks = document.querySelector('.marble-marks-layer');
      if (marks && (marks.dataset.mode || marks.hasAttribute('data-describing'))) return true;
      if (document.querySelector('.marble-variations-panel:not([hidden])')) return true;
      if (document.querySelector('marble-work')?.shadowRoot?.querySelector('.tour:not([hidden])')) return true;
      try {
        if (document.querySelector('[popover]:not([popover="manual"]):popover-open, dialog:modal')) return true;
      } catch { /* an older engine: the path test below still stands */ }
      return false;
    }
    const MENUS = 'dialog, [role="dialog"], [role="alertdialog"], [popover], [role="menu"], [role="menubar"], [role="listbox"], [role="combobox"]';
    function pageHadKey(event) {
      if (anotherOverlay()) return false;
      for (const node of event.composedPath()) {
        if (node === document.body || node === document.documentElement || node === document || node === window) break;
        // Inside a component with its own keys: the chat, the drive's tree.
        if (node instanceof ShadowRoot) return false;
        if (!(node instanceof Element)) continue;
        if (node.hasAttribute(TRANSIENT)) return false;
        if (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) return false;
        if (node.matches(MENUS)) return false;
      }
      return true;
    }
    const judged = new WeakSet();
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.isComposing && pageHadKey(event)) judged.add(event);
    }, true);
    addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !judged.has(event)) return;
      let s = null;
      for (const one of sessions) if (busy(one)) s = one;
      if (!s) return;
      event.preventDefault();
      // Sent, but the turn has no id yet: it stops the moment it has one.
      if (!s.turn) { s.stop = true; return; }
      agent.cancel(s.turn).catch(() => { /* already over */ });
    });

    // ------------------------------------------------------------ opening

    /**
     * Open the line on `ids` (none: the page).
     * @param {object} o
     * @param {string[]} [o.ids]
     * @param {object|'page'} [o.scope]   `{ words, range, chain, index }` from the callout
     * @param {string} [o.from]           'key', 'point', 'note', 'nudge', 'review'
     * @param {string} [o.draft]          words to open with
     * @param {string} [o.conversation]   carry on this conversation
     * @param {string} [o.action]         one of the offer's actions, drafted for this thing
     * @param {boolean} [o.send]          send the draft at once, with `o.brief` beside it
     */
    function open({ ids = [], scope = null, from = null, draft = null, conversation = null, action = null, send: now = false, brief = null } = {}) {
      const asked = scope === 'page' ? [] : (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
      const present = asked.filter((id) => byId(id));
      if (asked.length && !present.length) return false;
      const s = makeSession({ ids: present, scope, from, conversation });
      // Already open on the same thing and still being written: that line.
      if (shown && shown.state === 'edit' && !conversation && draft == null && !now && keyOf(shown) === keyOf(s)) {
        if (shown.input) caretAt(shown.input);
        return true;
      }
      // Words carried on to the new line (⇧-click adds a thing to it) moved
      // with it: they are not kept under the old thing as well.
      const carried = Boolean(shown?.input) && draft != null && said(shown.input) === String(draft).trim();
      if (shown) put(shown, { keep: !carried, restore: false });
      sessions.add(s);
      let text = draft ?? drafts()[keyOf(s)] ?? '';
      let idea = null;
      // An action drafted for this thing (an offer after an edit): its words,
      // with the idea after the lead selected so typing replaces it, and its
      // meaning beside them while they still lead.
      if (action && action !== 'sketch' && draft == null && globalThis.marbleOffer?.draftFor) {
        const els = elementsOf(s.ids);
        const kinds = [...new Set(els.map((el) => globalThis.marbleScope?.kindOf(el) ?? 'part'))];
        const kind = s.words ? 'words' : els.length > 1 ? (kinds.length === 1 ? kinds[0] : 'part') : kinds[0] ?? 'part';
        const d = globalThis.marbleOffer.draftFor(action, { kind, count: els.length, element: els[0] ?? null });
        if (d?.lead) {
          s.action = { mode: action, lead: d.lead.trim() };
          text = d.lead + (d.idea ?? '');
          if (d.idea) idea = [d.lead.length, text.length];
        }
      }
      agent.select(s.ids.length ? s.ids : null);
      show(s, 'edit', { text });
      if (idea && s.input) caretAt(s.input, idea[0], idea[1]);
      // The conversation's composer, loading while the words are written.
      convoFor(s);
      if (now) send(s, text, { brief, keepWords: true });
      return true;
    }

    window.marbleLine = {
      open,
      close: ({ keep = true } = {}) => { if (shown) put(shown, { keep }); },
      running,
      /** The line on screen: what it is about, what it holds, whose
       *  conversation it speaks for, and whether it has the keys. */
      current: () => (shown ? {
        ids: [...shown.ids], words: Boolean(shown.words), page: shown.page, state: shown.state,
        text: shown.input ? said(shown.input) : '', conversation: shown.conversation, focused: holdsKeys(shown),
      } : null),
      /** Give the keys to the line on screen (⌘J, for one that came back on
       *  its own), the caret at the end of its words. */
      focus() {
        if (!shown?.input) return false;
        if (!holdsKeys(shown)) shown.returnTo = keysNow();
        caretAt(shown.input);
        return true;
      },
      /** Whether this conversation was asked from the line, so the line
       *  speaks for how it ends (change-marks.js asks). */
      owns: (conversation) => Boolean(conversation) && [...sessions].some((one) => one.conversation === conversation),
    };
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
