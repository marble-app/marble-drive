// Notes: annotate as you go, send once.
//
// Every ask is already a note pinned to a thing. In the callout card, ⏎
// sends as it always has; ⇧⏎ keeps the ask instead (agent-offer.js): the
// card closes and a small numbered pin stays at the thing's corner. Point at
// the next thing and do the same. Beside the chat button, "3 notes" says how
// many are waiting, with Send all; its list outlines each thing on hover and
// has Clear. Send all is one brief to one new agent, each note with its ids,
// so a review pass is one agent and one Undo instead of ten (v2, Notes and
// Sketches/Ask at Anything).
//
// Notes are drafts: kept for this document in this browser until sent or
// cleared, and nobody else sees them. So they live in localStorage, and
// everything drawn here is transient chrome; the document is never touched.

(() => {
  const TRANSIENT = 'data-marble-transient';

  const STYLE = `
    .marble-notes-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147482950;
      font: 13px/1.4 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      --notes-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --notes-paper: var(--card, var(--paper, #fff)); --notes-ink: var(--ink, #222); }
    /* A pin is a numbered bubble with its beak on the thing's corner. */
    .marble-note-pin { position: fixed; width: 19px; height: 19px; padding: 0; margin: 0; border: 0; cursor: pointer; pointer-events: auto;
      border-radius: 50% 50% 50% 3px; background: var(--notes-mark); color: var(--notes-paper);
      font: 650 10.5px/19px var(--ui-font, system-ui, sans-serif); text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.2);
      transition: transform 140ms cubic-bezier(.22, 1, .36, 1); }
    @starting-style { .marble-note-pin { transform: scale(.4); } }
    .marble-note-pin:hover, .marble-note-pin:focus-visible { transform: scale(1.12); outline: none; }
    .marble-note-pin[hidden] { display: none; }
    .marble-note-soft { position: fixed; pointer-events: none; border-radius: 8px;
      border: 1px solid color-mix(in srgb, var(--notes-mark) 40%, transparent);
      background: color-mix(in srgb, var(--notes-mark) 5%, transparent); }
    .marble-note-soft[hidden] { display: none; }
    /* Resting on a pin opens its note: what was kept, and what to do with
       it. A card, not a tip, because a tip cannot be acted on and a kept
       note has to be easy to let go of. It hangs over its pin and stays up
       while the pointer crosses into it. */
    .marble-note-card { position: fixed; pointer-events: auto; box-sizing: border-box; width: max-content; min-width: 12rem; max-width: 17rem;
      display: grid; gap: 4px; padding: 10px 8px 6px 12px; border-radius: 12px; color: var(--notes-ink);
      background: color-mix(in srgb, var(--notes-paper) 92%, transparent);
      -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
      border: 1px solid var(--line, #e6e2d8);
      box-shadow: var(--shadow-lift, 0 2px 6px rgba(0,0,0,.08), 0 10px 26px rgba(0,0,0,.12));
      font-size: 13px; line-height: 1.4; transition: opacity 140ms cubic-bezier(.22, 1, .36, 1), translate 140ms cubic-bezier(.22, 1, .36, 1); }
    @starting-style { .marble-note-card { opacity: 0; translate: 0 3px; } }
    .marble-note-card[hidden] { display: none; }
    .marble-note-card-name { padding-right: 4px; font-size: 12px; color: var(--muted, #5a5a5a); }
    .marble-note-card-text { padding-right: 4px; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
    .marble-note-card-acts { display: flex; justify-content: flex-end; gap: 2px; margin-top: 2px; }
    .marble-note-card-acts button, .marble-notes-del { appearance: none; margin: 0; border: 0; border-radius: 8px; background: none; cursor: pointer;
      font: inherit; font-size: 12.5px; font-weight: 500; color: var(--notes-mark); transition: background-color 120ms cubic-bezier(.22, .61, .36, 1); }
    .marble-note-card-acts button { height: 28px; padding: 0 9px; }
    .marble-note-card-acts button:is(:hover, :focus-visible), .marble-notes-del:is(:hover, :focus-visible) {
      background: var(--paper-3, color-mix(in srgb, var(--notes-ink) 7%, transparent)); outline: none; }
    .marble-note-card-acts button:active, .marble-notes-del:active { background: color-mix(in srgb, var(--notes-ink) 12%, transparent); }
    .marble-note-card-acts button.danger, .marble-notes-del { color: var(--danger, #b3261e); }
    @media (prefers-reduced-transparency: reduce) { .marble-note-card { background: var(--notes-paper); -webkit-backdrop-filter: none; backdrop-filter: none; } }
    @media (pointer: coarse) { .marble-note-card-acts button { height: 36px; padding: 0 12px; } }
    /* The count sits beside the chat button: words, and the one action. */
    .marble-notes-count { position: fixed; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 3px 0 4px; pointer-events: auto;
      border-radius: 999px; background: var(--notes-paper); color: var(--notes-ink); border: 1px solid var(--line, #e6e2d8);
      box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 2px 4px rgba(0,0,0,.03); font-size: 12.5px; }
    .marble-notes-count[hidden] { display: none; }
    .marble-notes-count button { font: inherit; font-size: 12px; border: 0; cursor: pointer; border-radius: 999px; }
    .marble-notes-open { background: none; color: var(--notes-ink); padding: 6px 8px; }
    .marble-notes-open:hover, .marble-notes-open[aria-expanded="true"] { background: var(--paper-2, color-mix(in srgb, var(--notes-ink) 6%, transparent)); }
    .marble-notes-send { background: var(--notes-mark); color: var(--notes-paper); padding: 6px 11px; font-weight: 500; }
    .marble-notes-send:active { opacity: .8; }
    .marble-notes-list { position: fixed; width: 288px; max-width: calc(100vw - 24px); box-sizing: border-box; padding: 5px; pointer-events: auto;
      border-radius: 12px; background: var(--notes-paper); color: var(--notes-ink); border: 1px solid var(--line, #e6e2d8);
      box-shadow: 0 2px 6px rgba(0,0,0,.08), 0 10px 26px rgba(0,0,0,.12); }
    .marble-notes-list[hidden] { display: none; }
    .marble-notes-head { padding: 6px 8px 4px; font-size: 13px; font-weight: 600; color: var(--muted, #5a5a5a); }
    /* A row is the note, which opens it, and a way to let just that one go. */
    .marble-notes-row { display: flex; align-items: center; gap: 2px; border-radius: 8px; }
    .marble-notes-row:is(:hover, :focus-within) { background: var(--paper-2, color-mix(in srgb, var(--notes-ink) 5%, transparent)); }
    .marble-notes-pick { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: baseline; padding: 6px 8px; border: 0; border-radius: 8px; text-align: left; cursor: pointer;
      font: inherit; font-size: 12.5px; color: var(--muted, #5a5a5a); background: none; outline: none; }
    .marble-notes-del { flex: none; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; color: var(--faint, #8a8a8a); opacity: 0; }
    .marble-notes-del svg { width: 14px; height: 14px; }
    .marble-notes-row:is(:hover, :focus-within) .marble-notes-del { opacity: 1; }
    @media (hover: none) { .marble-notes-del { opacity: 1; } }
    .marble-notes-del:is(:hover, :focus-visible) { color: var(--danger, #b3261e); }
    .marble-notes-row i { font-style: normal; flex: none; width: 17px; height: 17px; border-radius: 50% 50% 50% 3px; background: var(--notes-mark); color: var(--notes-paper);
      font: 650 10px/17px var(--ui-font, system-ui, sans-serif); text-align: center; }
    .marble-notes-row b { color: var(--notes-ink); font-weight: 500; }
    .marble-notes-acts { display: flex; gap: 6px; padding: 6px 8px 5px; }
    .marble-notes-acts button { font: inherit; font-size: 12px; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line, #e6e2d8); cursor: pointer;
      background: var(--notes-paper); color: var(--notes-ink); }
    .marble-notes-acts button.primary { background: var(--notes-mark); border-color: var(--notes-mark); color: var(--notes-paper); }
    .marble-notes-acts button.danger { color: var(--danger, #b3261e); }
    @media (prefers-reduced-motion: reduce) { .marble-note-pin, .marble-note-card { transition: none; } }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-notes-layer')) return;
    const app = marble.app;
    const KEY = `marble-notes:${app}`;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);
    const layer = document.createElement('div');
    layer.className = 'marble-notes-layer';
    layer.setAttribute(TRANSIENT, '');
    document.documentElement.append(layer);

    const h = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };
    const byId = (id) => document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
    const elementsOf = (ids) => (ids ?? []).map(byId).filter(Boolean);
    const clip = (s, n) => { s = String(s ?? '').trim().replace(/\s+/g, ' '); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
    const boxOf = (ids) => {
      const rs = elementsOf(ids).map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
      if (!rs.length) return null;
      const left = Math.min(...rs.map((r) => r.left));
      const top = Math.min(...rs.map((r) => r.top));
      const right = Math.max(...rs.map((r) => r.right));
      const bottom = Math.max(...rs.map((r) => r.bottom));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };

    // ------------------------------------------------------------ state

    const read = () => {
      try {
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(list) ? list.filter((n) => n && Array.isArray(n.ids) && typeof n.text === 'string') : [];
      } catch { return []; }
    };
    let notes = read();
    const save = () => {
      try {
        if (notes.length) localStorage.setItem(KEY, JSON.stringify(notes));
        else localStorage.removeItem(KEY);
      } catch { /* private mode: they last as long as the tab */ }
    };

    function add({ ids, text, brief = '', name = '' }) {
      if (!ids?.length || !String(text ?? '').trim()) return;
      notes.push({ id: Math.random().toString(36).slice(2, 10), ids: [...ids], text: String(text).trim(), brief: brief || '', name: name || '', at: Date.now() });
      save();
      paint();
    }
    function drop(id) {
      notes = notes.filter((n) => n.id !== id);
      save();
      paint();
    }
    function clear() {
      notes = [];
      save();
      paint();
    }

    /** One brief for one agent: each note with its thing, in order, in the
     *  shape Describe mode sends its marks. */
    function briefOf(list) {
      const lines = [
        list.length === 1 ? 'A note on this page:' : `${list.length} notes on this page, one for each thing. Do each of them, in order, as one change.`,
        '',
      ];
      list.forEach((n, i) => {
        const at = n.ids.map((id) => `[data-marble-id="${id}"]`).join(', ');
        lines.push(`${i + 1}. ${n.name ? `${n.name} ` : ''}(${at}): ${n.text}`);
      });
      return lines.join('\n');
    }

    function sendAll() {
      if (!notes.length) return;
      const list = notes;
      const ids = [...new Set(list.flatMap((n) => n.ids))];
      const hidden = list.map((n, i) => (n.brief ? `For note ${i + 1}: ${n.brief}` : '')).filter(Boolean).join('\n\n');
      const sent = new CustomEvent('marble-callout:send', { cancelable: true, detail: { ids, text: briefOf(list), brief: hidden } });
      // The callout sends it from a card at the things, like any other ask.
      // A page with no callout has nowhere to send from, and keeps its notes.
      if (dispatchEvent(sent)) return;
      notes = [];
      save();
      closeList();
      paint();
    }

    // ------------------------------------------------------------ drawing

    const soft = h('div', 'marble-note-soft');
    soft.hidden = true;
    const card = h('div', 'marble-note-card');
    card.setAttribute('role', 'dialog');
    card.hidden = true;
    const cardName = h('div', 'marble-note-card-name');
    const cardText = h('div', 'marble-note-card-text');
    const cardActs = h('div', 'marble-note-card-acts');
    const cardOpen = h('button', '', 'Open');
    cardOpen.type = 'button';
    const cardDelete = h('button', 'danger', 'Delete');
    cardDelete.type = 'button';
    cardActs.append(cardOpen, cardDelete);
    card.append(cardName, cardText, cardActs);
    const count = h('div', 'marble-notes-count');
    count.hidden = true;
    const openList = h('button', 'marble-notes-open');
    openList.type = 'button';
    openList.setAttribute('aria-expanded', 'false');
    const send = h('button', 'marble-notes-send', 'Send all');
    send.type = 'button';
    count.append(openList, send);
    const list = h('div', 'marble-notes-list');
    list.setAttribute('role', 'dialog');
    list.setAttribute('aria-label', 'Notes on this page');
    list.hidden = true;
    layer.append(soft, count, list, card);
    const pins = new Map(); // note id -> button

    const outline = (ids) => {
      const b = ids && boxOf(ids);
      if (!b) { soft.hidden = true; return; }
      Object.assign(soft.style, { left: `${b.left - 4}px`, top: `${b.top - 3}px`, width: `${b.width + 8}px`, height: `${b.height + 6}px` });
      soft.hidden = false;
    };
    // The note card: which note it is showing, and a short grace before it
    // goes, so the pointer can cross from the pin into it.
    let cardFor = null;
    let cardTimer = 0;
    const hover = matchMedia('(hover: hover)');
    function showCard(pin, n) {
      clearTimeout(cardTimer);
      cardFor = n.id;
      cardName.textContent = n.name || '';
      cardName.hidden = !n.name;
      cardText.textContent = n.text;
      card.setAttribute('aria-label', `Note: ${n.text}`);
      card.hidden = false;
      const a = pin.getBoundingClientRect();
      const t = card.getBoundingClientRect();
      let top = a.top - t.height - 8;
      if (top < 8) top = a.bottom + 8;
      card.style.left = `${Math.round(Math.max(8, Math.min(a.right - t.width + 6, innerWidth - t.width - 8)))}px`;
      card.style.top = `${Math.round(top)}px`;
      outline(n.ids);
    }
    function hideCard() {
      clearTimeout(cardTimer);
      if (card.hidden) return;
      card.hidden = true;
      cardFor = null;
      outline(null);
    }
    const hideSoon = () => { clearTimeout(cardTimer); cardTimer = setTimeout(hideCard, 160); };
    card.addEventListener('pointerenter', () => clearTimeout(cardTimer));
    card.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') hideSoon(); });
    card.addEventListener('focusout', (event) => { if (!card.contains(event.relatedTarget) && !pins.get(cardFor)?.contains(event.relatedTarget)) hideSoon(); });
    cardOpen.addEventListener('click', () => { const id = cardFor; hideCard(); if (id) reopen(id); });
    cardDelete.addEventListener('click', (event) => {
      const id = cardFor;
      const n = notes.find((x) => x.id === id);
      const at = notes.indexOf(n);
      hideCard();
      if (!id) return;
      drop(id);
      // From the keys (a press with no pointer, or ⌫ on a pin), the keys go
      // to the next pin, or the count, rather than nowhere. A click leaves
      // them be, so no other card opens under the pointer.
      if (event.detail !== 0) return;
      const next = notes[Math.min(at, notes.length - 1)];
      (next ? pins.get(next.id) : count.hidden ? null : openList)?.focus({ preventScroll: true });
    });

    function paintPins() {
      const keep = new Set(notes.map((n) => n.id));
      for (const [id, pin] of pins) if (!keep.has(id)) { pin.remove(); pins.delete(id); }
      const seen = new Map();
      notes.forEach((n, i) => {
        let pin = pins.get(n.id);
        if (!pin) {
          pin = h('button', 'marble-note-pin');
          pin.type = 'button';
          pin.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') showCard(pin, notes.find((x) => x.id === n.id) ?? n); });
          pin.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') hideSoon(); });
          pin.addEventListener('focus', () => showCard(pin, notes.find((x) => x.id === n.id) ?? n));
          pin.addEventListener('blur', (event) => { if (!card.contains(event.relatedTarget)) hideSoon(); });
          // Pressing a pin takes the note back into the line, to change or
          // send. A finger has no hover to open the card with, so its first
          // tap opens the card, and Open there takes it back.
          pin.addEventListener('click', () => {
            if (!hover.matches && cardFor !== n.id) { showCard(pin, notes.find((x) => x.id === n.id) ?? n); return; }
            hideCard();
            reopen(n.id);
          });
          // ⌫ or Delete on a pin lets just that note go.
          pin.addEventListener('keydown', (event) => {
            if (event.key !== 'Backspace' && event.key !== 'Delete') return;
            event.preventDefault();
            cardFor = n.id;
            cardDelete.click();
          });
          layer.insertBefore(pin, count);
          pins.set(n.id, pin);
        }
        pin.textContent = String(i + 1);
        pin.setAttribute('aria-label', `Note ${i + 1}: ${n.text}. Press to open, Delete to remove`);
        const b = boxOf(n.ids);
        if (!b || b.bottom < 0 || b.top > innerHeight) { pin.hidden = true; return; }
        const key = n.ids.join(',');
        const k = seen.get(key) ?? 0;
        seen.set(key, k + 1);
        pin.hidden = false;
        pin.style.left = `${Math.round(Math.min(innerWidth - 22, b.right - 6 - k * 22))}px`;
        pin.style.top = `${Math.round(Math.max(2, b.top - 10))}px`;
      });
    }

    function reopen(id) {
      const n = notes.find((x) => x.id === id);
      if (!n) return;
      drop(id);
      outline(null);
      hideCard();
      agent.select(n.ids);
      dispatchEvent(new CustomEvent('marble-callout:ask', { detail: { ids: n.ids, draft: n.text } }));
    }

    // Beside the chat button, to its left, on the same line; and left of the
    // turn's pill when that is there too (agent-work.js), never under it.
    function placeCount() {
      const launcher = document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher');
      const island = document.querySelector('marble-work')?.shadowRoot?.querySelector('.island:not([hidden])');
      const beside = island?.getBoundingClientRect();
      const r = beside?.width ? beside : launcher?.getBoundingClientRect();
      const w = count.offsetWidth;
      if (r?.width) {
        count.style.left = `${Math.round(r.left - 8 - w)}px`;
        count.style.top = `${Math.round(r.top + r.height / 2 - count.offsetHeight / 2)}px`;
      } else {
        count.style.left = `${Math.round(innerWidth - 20 - w)}px`;
        count.style.top = `${Math.round(innerHeight - 20 - count.offsetHeight)}px`;
      }
      if (!list.hidden) {
        const c = count.getBoundingClientRect();
        list.style.left = `${Math.round(Math.max(12, Math.min(c.right - list.offsetWidth, innerWidth - list.offsetWidth - 12)))}px`;
        list.style.top = `${Math.round(Math.max(12, c.top - 8 - list.offsetHeight))}px`;
      }
    }

    function paintList() {
      list.replaceChildren(h('div', 'marble-notes-head', 'Notes on this page'));
      notes.forEach((n, i) => {
        const row = h('div', 'marble-notes-row');
        const pick = h('button', 'marble-notes-pick');
        pick.type = 'button';
        pick.append(h('i', '', String(i + 1)));
        const words = h('span');
        if (n.name) words.append(h('b', '', n.name), ' · ');
        words.append(clip(n.text, 44));
        pick.append(words);
        pick.addEventListener('click', () => { closeList(); reopen(n.id); });
        const del = h('button', 'marble-notes-del');
        del.type = 'button';
        del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        del.setAttribute('aria-label', `Delete note ${i + 1}`);
        del.addEventListener('click', () => { outline(null); drop(n.id); if (notes.length) list.querySelector('.marble-notes-pick')?.focus({ preventScroll: true }); });
        row.append(pick, del);
        row.addEventListener('pointerenter', () => outline(n.ids));
        row.addEventListener('pointerleave', () => outline(null));
        row.addEventListener('focusin', () => outline(n.ids));
        row.addEventListener('focusout', () => outline(null));
        list.append(row);
      });
      const acts = h('div', 'marble-notes-acts');
      const all = h('button', 'primary', 'Send all');
      all.type = 'button';
      all.addEventListener('click', sendAll);
      const wipe = h('button', 'danger', 'Clear');
      wipe.type = 'button';
      wipe.addEventListener('click', () => { closeList(); clear(); });
      acts.append(all, wipe);
      list.append(acts);
    }
    function closeList() {
      list.hidden = true;
      openList.setAttribute('aria-expanded', 'false');
      outline(null);
    }
    openList.addEventListener('click', () => {
      if (!list.hidden) { closeList(); return; }
      paintList();
      list.hidden = false;
      openList.setAttribute('aria-expanded', 'true');
      placeCount();
    });
    send.addEventListener('click', sendAll);

    function paint() {
      if (cardFor && !notes.some((n) => n.id === cardFor)) hideCard();
      paintPins();
      count.hidden = !notes.length;
      openList.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
      if (!notes.length) closeList();
      else if (!list.hidden) paintList();
      placeCount();
    }

    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintPins(); placeCount(); }); };
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('marble:ops', schedule);
    addEventListener('marble-shell:layout', schedule);
    addEventListener('marble-tray:ready', schedule);
    addEventListener('pointerdown', (event) => {
      if (!list.hidden && !event.composedPath().includes(layer)) closeList();
    }, true);
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !card.hidden) { event.stopPropagation(); const pin = pins.get(cardFor); hideCard(); pin?.focus({ preventScroll: true }); return; }
      if (event.key === 'Escape' && !list.hidden) { event.stopPropagation(); closeList(); openList.focus({ preventScroll: true }); }
    }, true);
    addEventListener('pointerdown', (event) => {
      if (!card.hidden && !event.composedPath().some((n) => n === card || n?.classList?.contains?.('marble-note-pin'))) hideCard();
    }, true);
    // Another tab kept or sent a note on this document.
    addEventListener('storage', (event) => { if (event.key === KEY) { notes = read(); paint(); } });

    window.marbleNotes = { add, list: () => notes.map((n) => ({ ...n })), sendAll, clear, remove: drop, brief: () => briefOf(notes) };
    paint();
    // The launcher mounts after this script, and the turn's pill comes and
    // goes by itself: while there are notes, the count checks its place.
    setTimeout(schedule, 300);
    setInterval(() => { if (notes.length) schedule(); }, 700);
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
