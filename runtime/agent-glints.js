// Working agents: every agent at work on this document, marked on the thing
// it is working on.
//
// A chat about this page that nobody here is following — running somewhere
// else, or asking a question mid-turn — is a small dot at the corner of its
// element, in the same state language as the drawer and the Agents page (a
// caution ring when it needs you, a breathing accent dot while it works).
// The dot is only there while the turn is: a finished chat leaves nothing on
// the page. The chat button's dot and the Agents page are where finished
// work waits, and a dot that stayed would look the same as one that meant
// "working" (v3, Notes and Sketches/Ask at Anything). The code still calls
// the dot a glint; nothing a person reads does.
//
// None of it is drawn unless the person asks: the dots are off by default,
// and Show agent dots in the chat button's tray turns them on — these, and
// the marks on what agents changed (agent-work.js). A page full of dots by
// default was the interface talking over the document.
//
// Hover the dot and the element is outlined, softly. Click it and a small
// card opens just below the element with two buttons, never more: Follow (or
// Answer, when it is asking you), and Hide. Hide lasts until someone sends
// in that chat again. The launcher's tray holds one switch for all of them,
// Show agent dots / Hide agent dots.
//
// Nothing here edits the document: the layer is transient chrome in a shadow
// root, the way the callout is.

(() => {
  const TRANSIENT = 'data-marble-transient';
  // On only when the person turned it on, in this browser.
  const ON_KEY = 'marble-agent-dots';
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  // What a dot is shown for: a turn that is still open. Finished, failed and
  // idle chats are history, not presence.
  const SHOWN = new Set(['waiting', 'working']);
  const WORD = { waiting: 'Needs you', working: 'Working' };

  const STYLE = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none;
      font: 13px/1.4 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      color: var(--ink); -webkit-font-smoothing: antialiased; }
    .glint { position: fixed; width: 20px; height: 20px; margin: 0; padding: 0; border: 0; background: none;
      display: grid; place-items: center; cursor: pointer; pointer-events: auto; border-radius: 50%;
      animation: arrive 200ms var(--settle) both; }
    .glint .dot { box-shadow: 0 0 0 2px var(--paper); transition: transform 160ms var(--settle); }
    .glint:hover .dot, .glint[aria-expanded="true"] .dot, .glint:focus-visible .dot { transform: scale(1.3); }
    .glint:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-ink) 50%, transparent); outline-offset: 1px; }
    @keyframes arrive { from { opacity: 0; transform: scale(.4); } }

    /* The rectangle round the element: one soft line and the faintest wash. */
    .outline { position: fixed; pointer-events: none; border-radius: 8px; opacity: 0;
      border: 1px solid color-mix(in srgb, var(--accent-ink) 40%, transparent);
      background: color-mix(in srgb, var(--accent) 6%, transparent);
      transition: opacity 180ms ease; }
    .outline[data-state="waiting"] { border-color: color-mix(in srgb, var(--caution) 55%, transparent);
      background: color-mix(in srgb, var(--caution) 6%, transparent); }
    .outline.on { opacity: 1; }

    .peek { position: fixed; width: 280px; max-width: calc(100vw - 24px); box-sizing: border-box; pointer-events: auto;
      padding: 10px 12px 11px; background: var(--card); color: var(--ink);
      border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-lift);
      animation: rise 180ms var(--settle) both; }
    .peek.leaving { animation: sink 160ms var(--snap) both; pointer-events: none; }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
    @keyframes sink { to { opacity: 0; transform: translateY(4px); } }
    .top { display: flex; align-items: center; gap: 8px; }
    .top > span:first-child { display: flex; flex: none; }
    .top .dot, .glint .dot { display: block; }
    .title { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ago { color: var(--faint); font-size: 12px; white-space: nowrap; }
    .where { margin: 2px 0 0 16px; color: var(--accent-ink); font-size: 12px; }
    .line { margin: 3px 0 0 16px; color: var(--muted); font-size: 12.5px; }
    .acts { display: flex; gap: 6px; margin: 9px 0 0 16px; }
    .acts button { font: inherit; font-size: 12.5px; padding: 3px 11px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--line); background: var(--card); color: var(--ink); }
    .acts button:hover { border-color: color-mix(in srgb, var(--accent-ink) 45%, transparent); }
    .acts button.primary { background: var(--ink); border-color: var(--ink); color: var(--card); }
    .acts button.primary:hover { opacity: .88; }
    @media (prefers-reduced-motion: reduce) {
      .glint, .peek, .peek.leaving { animation: none; }
      .outline { transition: none; }
    }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    const UI = window.marbleAgentUI;
    if (!agent || !marble.app || !UI?.stateOf) return;
    // The Agents page is made of chats; marking its own elements would be
    // marking the chats with themselves.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-glints-host')) return;
    const app = marble.app;

    const host = document.createElement('div');
    host.className = 'marble-glints-host';
    host.setAttribute(TRANSIENT, '');
    // Above the page, below the drawer (2147483000): a glint marks the page,
    // and an open chat panel covers the page, glints and all.
    Object.assign(host.style, {
      position: 'fixed', inset: '0', width: 'auto', height: 'auto', margin: '0', padding: '0',
      border: '0', background: 'none', overflow: 'visible', pointerEvents: 'none', zIndex: '2147482900',
    });
    const root = host.attachShadow({ mode: 'open' });
    const sheet = document.createElement('style');
    sheet.textContent = `${UI.TOKENS ?? ''}${UI.STATE_CSS ?? ''}${STYLE}`;
    const layer = document.createElement('div');
    layer.className = 'layer';
    root.append(sheet, layer);
    document.documentElement.append(host);
    if (UI.watchPageTheme) UI.watchPageTheme(host);

    const h = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };
    const byId = (id) => document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
    const anchorOf = (ids) => {
      const els = (ids ?? []).map(byId).filter(Boolean);
      if (!els.length) return null;
      return marble.collab?.tapeTarget?.(els) ?? els[0];
    };
    const clip = (s, n) => { s = String(s ?? '').trim().replace(/\s+/g, ' '); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
    // A name for the element, the way a person would point at it.
    function placeOf(el) {
      if (!el) return '';
      const tag = el.tagName;
      if (tag === 'TR') return `Row · ${clip(el.cells?.[0]?.textContent, 24)}`;
      if (/^H[1-6]$/.test(tag)) return `Heading · ${clip(el.textContent, 24)}`;
      if (tag === 'TABLE') return 'Table';
      if (tag === 'IMG' || tag === 'FIGURE') return 'Figure';
      if (tag === 'LI') return `Item · ${clip(el.textContent, 24)}`;
      if (tag === 'P') return `Paragraph · ${clip(el.textContent, 20)}`;
      const label = el.getAttribute('aria-label') || el.querySelector?.('h1,h2,h3,h4')?.textContent;
      return label ? clip(label, 28) : clip(el.textContent, 24) || tag.toLowerCase();
    }
    const ago = (iso) => {
      const t = Date.parse(iso ?? '');
      if (!t) return '';
      const m = Math.round((Date.now() - t) / 60000);
      if (m < 1) return 'now';
      if (m < 60) return `${m}m`;
      const hrs = Math.round(m / 60);
      return hrs < 24 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;
    };

    // ------------------------------------------------------------ state

    const HIDDEN_KEY = `marble-glints-hidden:${app}`;
    const hiddenIds = () => {
      try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch { return new Set(); }
    };
    const setHidden = (id, on) => {
      const set = hiddenIds();
      if (on) set.add(id); else set.delete(id);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set].slice(-200))); } catch { /* private mode */ }
    };
    const glintsOff = () => {
      try { return localStorage.getItem(ON_KEY) !== '1'; } catch { return true; }
    };

    // id -> { summary, ids }
    const entries = new Map();
    const stateOf = (summary) => UI.stateOf(summary);
    const mine = (summary) => summary && typeof summary.id === 'string' && summary.target === app
      && !summary.archived && SHOWN.has(stateOf(summary));

    async function idsOf(id) {
      try {
        const detail = await agent.conversation(id, { turns: 0 });
        return detail?.turns?.at(-1)?.context?.selection ?? [];
      } catch { return []; }
    }

    async function upsert(summary) {
      if (!summary || typeof summary.id !== 'string') return;
      const had = entries.get(summary.id);
      if (!mine(summary)) {
        if (had) { entries.delete(summary.id); schedule(); }
        return;
      }
      // A new turn may be about somewhere else on the page: its aim is read
      // again when the chat starts running, not on every progress event.
      const started = stateOf(summary) === 'working' && had && stateOf(had.summary) !== 'working';
      const entry = { summary, ids: had?.ids ?? null };
      entries.set(summary.id, entry);
      if (!had || started || !entry.ids) entry.ids = await idsOf(summary.id);
      schedule();
    }

    async function load() {
      let list = [];
      try { list = await agent.conversations(); } catch { return; }
      await Promise.all(list.filter(mine).map(upsert));
    }

    // Whose zone or card is already on the page says the same thing louder;
    // a glint beside it would say it twice.
    const covered = (id) => window.marbleCallout?.holds?.(id)
      || (agent.attending?.(id) && stateOf(entries.get(id)?.summary) === 'working');

    // ------------------------------------------------------------ drawing

    const outline = h('div', 'outline');
    layer.append(outline);
    let open = null; // { id, peek }
    const glints = new Map(); // id -> button

    function visible() {
      if (glintsOff()) return [];
      const hidden = hiddenIds();
      const out = [];
      for (const [id, entry] of entries) {
        if (hidden.has(id) || covered(id)) continue;
        const anchor = anchorOf(entry.ids);
        if (anchor) out.push({ id, entry, anchor });
      }
      return out;
    }

    function paint() {
      raf = 0;
      const want = visible();
      const keep = new Set(want.map((w) => w.id));
      for (const [id, el] of glints) if (!keep.has(id)) { el.remove(); glints.delete(id); }
      for (const { id, entry, anchor } of want) {
        let el = glints.get(id);
        if (!el) {
          el = h('button', 'glint');
          el.type = 'button';
          el.append(h('span', 'dot'));
          el.addEventListener('pointerenter', () => { if (open?.id !== id) showOutline(id, true); });
          el.addEventListener('pointerleave', () => { if (open?.id !== id) showOutline(open?.id ?? null, Boolean(open)); });
          el.addEventListener('click', (event) => { event.stopPropagation(); toggle(id); });
          layer.append(el);
          glints.set(id, el);
        }
        const state = stateOf(entry.summary);
        el.dataset.state = state;
        el.setAttribute('aria-label', `${entry.summary.title || 'Agent'} — ${WORD[state]}`);
        el.setAttribute('aria-expanded', String(open?.id === id));
        const r = anchor.getBoundingClientRect();
        el.style.left = `${Math.round(Math.min(innerWidth - 22, r.right - 10))}px`;
        el.style.top = `${Math.round(Math.max(2, r.top - 10))}px`;
      }
      if (open && !keep.has(open.id)) close();
      else if (open) { placePeek(); showOutline(open.id, true); }
    }

    function showOutline(id, on, ids = null) {
      const entry = id && entries.get(id);
      const anchor = anchorOf(ids ?? entry?.ids);
      if (!on || !anchor) { outline.classList.remove('on'); return; }
      const r = anchor.getBoundingClientRect();
      Object.assign(outline.style, {
        left: `${Math.round(r.left - 4)}px`, top: `${Math.round(r.top - 3)}px`,
        width: `${Math.round(r.width + 8)}px`, height: `${Math.round(r.height + 6)}px`,
      });
      outline.dataset.state = entry ? stateOf(entry.summary) : 'idle';
      outline.classList.add('on');
    }

    function toggle(id) {
      if (open?.id === id) { close(); return; }
      close({ quiet: true });
      const entry = entries.get(id);
      if (!entry) return;
      const { summary } = entry;
      const state = stateOf(summary);
      const peek = h('div', 'peek');
      peek.setAttribute('role', 'dialog');
      peek.setAttribute('aria-label', summary.title || 'Agent');
      const top = h('div', 'top');
      const dotWrap = h('span');
      dotWrap.dataset.state = state;
      dotWrap.append(h('span', 'dot'));
      top.append(dotWrap, h('span', 'title', summary.title || 'Agent'), h('span', 'ago', ago(summary.updatedAt)));
      const place = placeOf(anchorOf(entry.ids));
      peek.append(top, h('div', 'where', `${place ? `${place} · ` : ''}${WORD[state]}`));
      if (summary.activity) peek.append(h('div', 'line', summary.activity));
      const acts = h('div', 'acts');
      const follow = h('button', 'primary', state === 'waiting' ? 'Answer' : 'Follow');
      follow.type = 'button';
      follow.addEventListener('click', () => {
        close();
        agent.attend?.(id);
        agent.remember?.(id);
        agent.open(id);
      });
      acts.append(follow);
      const hide = h('button', '', 'Hide');
      hide.type = 'button';
      hide.addEventListener('click', () => { close(); setHidden(id, true); schedule(); });
      acts.append(hide);
      peek.append(acts);
      peek.addEventListener('pointerdown', (event) => event.stopPropagation());
      layer.append(peek);
      open = { id, peek };
      glints.get(id)?.setAttribute('aria-expanded', 'true');
      placePeek();
      showOutline(id, true);
      follow.focus({ preventScroll: true });
    }

    // Never over the element it is about: just below it, or above when there
    // is no room, lined up with its right edge where the glint is.
    function placePeek() {
      if (!open) return;
      const entry = entries.get(open.id);
      const anchor = entry && anchorOf(entry.ids);
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const w = open.peek.offsetWidth, hgt = open.peek.offsetHeight;
      let left = r.right - w;
      let top = r.bottom + 8;
      if (top + hgt > innerHeight - 8) top = r.top - hgt - 8;
      left = Math.max(8, Math.min(left, innerWidth - w - 8));
      top = Math.max(8, Math.min(top, innerHeight - hgt - 8));
      open.peek.style.left = `${Math.round(left)}px`;
      open.peek.style.top = `${Math.round(top)}px`;
    }

    function close({ quiet = false } = {}) {
      if (!open) return;
      const { id, peek } = open;
      open = null;
      glints.get(id)?.setAttribute('aria-expanded', 'false');
      showOutline(null, false);
      if (quiet || stillness.matches) { peek.remove(); return; }
      peek.classList.add('leaving');
      setTimeout(() => peek.remove(), 180);
    }

    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('marble:ops', schedule);
    addEventListener('marble:attending', schedule);
    addEventListener('marble-callout:held', schedule);
    // A click anywhere else, or Escape, puts an open card away.
    addEventListener('pointerdown', (event) => {
      if (open && !event.composedPath().includes(host)) close();
    }, true);
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && open) { event.stopPropagation(); close(); }
    }, true);

    // The drawer's switcher points at one of this page's chats: outline it.
    let pointing = null;
    addEventListener('marble-glints:point', (event) => {
      const id = event.detail?.id ?? null;
      pointing = id;
      if (!id) { showOutline(open?.id ?? null, Boolean(open)); return; }
      // A finished chat has no glint, but it still has a place on the page.
      if (entries.has(id)) { showOutline(id, true); return; }
      idsOf(id).then((ids) => { if (pointing === id) showOutline(id, true, ids); });
    });

    // Sending in a chat is the progress that brings a hidden one back.
    addEventListener('marble:agent-sent', (event) => {
      const id = event.detail?.id;
      if (id && hiddenIds().has(id)) { setHidden(id, false); schedule(); }
    });

    agent.on('*', (summary) => { upsert(summary); });

    // ------------------------------------------------------------ the switch
    // One switch for every working agent's dot and every changed-part dot
    // (agent-work.js), off by default. It is this browser's view, not the
    // chats' state, and since v4 it lives in Agent settings › Chat
    // (agent-ui.js) rather than the tray, which keeps to things to do.
    addEventListener('marble-agent-prefs', (event) => {
      if (event.detail?.key !== ON_KEY) return;
      close({ quiet: true });
      schedule();
      dispatchEvent(new CustomEvent('marble-agent-dots'));
    });
    // Another tab turned them off or on.
    addEventListener('storage', (event) => { if (event.key === ON_KEY || event.key === HIDDEN_KEY) schedule(); });

    window.marbleGlints = { refresh: load, entries: () => [...entries.keys()], toggle };
    load();
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
