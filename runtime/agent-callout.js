// The callout: a conversation drawn at the region of the document it is about.
//
// The fifth view of a conversation. The drawer and the Agents page show the
// same object in a panel and in panes; this shows it in situ — a handle at
// your selection, a card when you summon, a pill when you fold it, and the
// zone's own label while the agent works there. Everything here is transient
// chrome in one fixed layer; no document is edited to get a callout.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const PHONE = matchMedia('(max-width: 719px)');
  const HANDLE_DELAY = 180;
  const CARD_WIDTH = 440;
  const GAP = 12;
  const PAD = 12;

  const STYLE = `
    .marble-callout-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none; color: inherit;
      --callout-mark: color-mix(in srgb, #6d55d4 78%, var(--ink, #222));
      --callout-paper: var(--card, var(--paper, #fff));
      --callout-ink: var(--ink, #222);
      font: 13px/1.4 var(--ui-font, system-ui, -apple-system, "Segoe UI", sans-serif);
    }
    .marble-callout-handle {
      position: fixed; width: 22px; height: 22px; border-radius: 50%; border: 0; padding: 0;
      background: var(--callout-mark); box-shadow: 0 1px 4px rgba(0,0,0,.28); cursor: pointer;
      pointer-events: auto; display: grid; place-items: center;
    }
    .marble-callout-handle::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #fff; }
    .marble-callout-handle[hidden] { display: none; }
    .marble-callout {
      position: fixed; width: min(${CARD_WIDTH}px, calc(100vw - ${PAD * 2}px)); pointer-events: auto;
      background: var(--callout-paper); color: var(--callout-ink);
      border: 1px solid color-mix(in srgb, var(--callout-mark) 45%, transparent); border-radius: 14px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden;
    }
    .marble-callout-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px 4px 12px; color: var(--callout-mark); font-size: 12.5px; }
    .marble-callout-live { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; opacity: .55; }
    .marble-callout[data-live] .marble-callout-live { opacity: 1; animation: marble-callout-pulse 1.4s ease-in-out infinite; }
    @keyframes marble-callout-pulse { 50% { opacity: .35; } }
    .marble-callout-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-callout-actions, .marble-callout-tools { display: flex; gap: 2px; flex: none; }
    .marble-callout-head button {
      font: inherit; font-size: 12px; border: 0; background: none; color: inherit; cursor: pointer;
      padding: 2px 6px; border-radius: 6px; white-space: nowrap;
    }
    .marble-callout-head button:hover { background: color-mix(in srgb, var(--callout-mark) 12%, transparent); }
    .marble-callout-head button[hidden] { display: none; }
    .marble-callout marble-conversation { display: flex; max-height: min(70vh, 560px); }
    .marble-callout[data-state="pill"] { width: auto; max-width: 320px; border-radius: 999px; cursor: pointer; }
    .marble-callout[data-state="pill"] .marble-callout-head { padding: 5px 12px; }
    .marble-callout[data-state="pill"] marble-conversation,
    .marble-callout[data-state="pill"] .marble-callout-actions { display: none; }
    .marble-callout-pick { position: fixed; pointer-events: none; border: 1.5px solid var(--callout-mark); border-radius: 6px; }
    .marble-callout-pick[hidden] { display: none; }
    /* The layer is in the top layer so a document's own stacking contexts
       cannot cover it; the UA sheet for [popover] would otherwise centre it
       and give it a border. */
    .marble-callout-layer:popover-open { position: fixed; inset: 0; }
    @media (prefers-reduced-motion: reduce) { .marble-callout[data-live] .marble-callout-live { animation: none; } }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    // The Agents page hosts its own conversation UI; a callout there would be
    // a chat drawn over a page made of chats.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-callout-layer')) return;
    const app = marble.app;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    const layer = document.createElement('div');
    layer.className = 'marble-callout-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('popover', 'manual');
    document.documentElement.append(layer);
    try { layer.showPopover(); } catch { /* no popover here: fixed positioning still stands */ }

    const byId = (id) => document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
    const elementsOf = (ids) => (ids ?? []).map(byId).filter(Boolean);
    // The zone's own answer to "where is this set of ids", falling back to the
    // first element when the only thing containing them all is the body.
    const anchorOf = (ids) => {
      const els = elementsOf(ids);
      if (!els.length) return null;
      return marble.collab?.tapeTarget?.(els) ?? els[0];
    };

    const button = (text, label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', (event) => { event.stopPropagation(); onClick(); });
      return b;
    };

    // ------------------------------------------------------------ records

    const records = [];
    const recordOf = (id) => (id ? records.find((r) => r.id === id) ?? null : null);

    function placeCard(record) {
      const el = record.el;
      const anchor = anchorOf(record.ids);
      if (!anchor) {
        // Nothing left to point at: the chat is still reachable, bottom-right.
        Object.assign(el.style, { left: 'auto', top: 'auto', right: `${PAD}px`, bottom: `${PAD}px` });
        return;
      }
      const r = anchor.getBoundingClientRect();
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      const left = Math.min(Math.max(PAD, r.left - 10), Math.max(PAD, innerWidth - PAD - w));
      let top = r.bottom + GAP;
      if (top + h > innerHeight - PAD) top = r.top - GAP - h;
      if (top < PAD) top = Math.max(PAD, Math.min(r.bottom + GAP, innerHeight - PAD - h));
      Object.assign(el.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, right: 'auto', bottom: 'auto' });
    }

    function setState(record, state) {
      record.state = state;
      record.el.dataset.state = state;
      placeCard(record);
    }

    function remove(record) {
      record.off?.();
      record.el.remove();
      const at = records.indexOf(record);
      if (at >= 0) records.splice(at, 1);
      placeHandle();
    }

    function openCard({ id = null, ids, state = 'card' }) {
      const existing = recordOf(id);
      if (existing) {
        setState(existing, state);
        if (state === 'card') existing.convo.focusInput?.();
        return existing;
      }
      const el = document.createElement('div');
      el.className = 'marble-callout';
      el.setAttribute(TRANSIENT, '');
      const head = document.createElement('div');
      head.className = 'marble-callout-head';
      const live = document.createElement('span');
      live.className = 'marble-callout-live';
      live.setAttribute('aria-hidden', 'true');
      const status = document.createElement('span');
      status.className = 'marble-callout-status';
      status.textContent = 'Ask about this';
      const actions = document.createElement('span');
      actions.className = 'marble-callout-actions';
      const tools = document.createElement('span');
      tools.className = 'marble-callout-tools';
      head.append(live, status, actions, tools);

      // A real conversation, never a stub, and never one moved here from
      // somewhere else: the card owns the component it holds.
      const convo = document.createElement('marble-conversation');
      convo.setAttribute(TRANSIENT, '');
      convo.dataset.chrome = 'callout';
      convo.setAttribute('project', 'drive');
      convo.setAttribute('data-folded', '');
      el.append(head, convo);

      const record = { id, ids: [...ids], el, convo, head, live, status, actions, tools, state, changed: new Set(), docked: false, title: '', zone: null };
      records.push(record);
      tools.append(button('×', 'Fold', () => setState(record, 'pill')));
      head.addEventListener('click', (event) => {
        if (record.state === 'pill' && !event.target.closest('button')) setState(record, 'card');
      });
      convo.addEventListener('conversation', (event) => {
        record.id = event.detail?.id ?? null;
      });
      layer.append(el);
      // The attribute after the append: the component only loads once connected.
      if (id) convo.setAttribute('conversation', id);
      handle.hidden = true;
      setState(record, state);
      if (state === 'card') convo.focusInput?.();
      return record;
    }

    // ------------------------------------------------------------ geometry

    let raf = 0;
    const relayout = () => {
      raf = 0;
      for (const record of records) placeCard(record);
      placeHandle();
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(relayout); };
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('marble:ops', schedule);

    // ------------------------------------------------------------ the handle

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'marble-callout-handle';
    handle.setAttribute('aria-label', 'Ask an agent about this selection');
    handle.hidden = true;
    // A mousedown on a button would collapse the very selection it is about.
    handle.addEventListener('pointerdown', (event) => event.preventDefault());
    handle.addEventListener('click', () => summon());
    layer.append(handle);

    let handleTimer = 0;
    let pointerDown = false;
    const scheduleHandle = () => {
      clearTimeout(handleTimer);
      handleTimer = setTimeout(placeHandle, HANDLE_DELAY);
    };
    function placeHandle() {
      const ids = agent.context().selection;
      // A card with no conversation yet is this selection's callout already.
      const drawn = records.some((r) => r.id === null);
      const target = pointerDown || !ids.length || drawn ? null : anchorOf(ids);
      if (!target) { handle.hidden = true; return; }
      const r = target.getBoundingClientRect();
      handle.style.left = `${Math.round(Math.max(PAD, r.left - 10))}px`;
      handle.style.top = `${Math.round(Math.min(innerHeight - 30, r.bottom + 4))}px`;
      handle.hidden = false;
    }
    addEventListener('pointerdown', (event) => {
      if (layer.contains(event.target)) return;
      pointerDown = true;
      handle.hidden = true;
    }, true);
    addEventListener('pointerup', () => { pointerDown = false; scheduleHandle(); }, true);
    addEventListener('marble:agent-context', scheduleHandle);

    // ------------------------------------------------------------ summon

    function summon() {
      const ids = agent.context().selection;
      if (!ids.length) return false;
      handle.hidden = true;
      if (PHONE.matches) {
        // No room for a card beside the text on a phone; the drawer already
        // carries the selection as its own control. Opening it takes focus,
        // and the native selection collapses with it, so the ids are pinned
        // before the hand-off rather than read again after it.
        agent.select(ids);
        agent.open();
        return true;
      }
      openCard({ ids });
      return true;
    }
    addEventListener('marble-callout:summon', (event) => {
      if (summon()) event.preventDefault();
    });
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
