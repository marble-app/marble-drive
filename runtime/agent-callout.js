// The callout: a conversation drawn at the region of the document it is about.
//
// The fifth view of a conversation. The drawer and the Agents page show the
// same object in a panel and in panes; this shows it in situ — a handle at
// your selection, a card when you summon, and the zone's own label while the
// agent works there.
//
// Quiet until reached (v2, Notes and Sketches/Ask at Anything): nothing about
// asking appears until the person does something only someone who wants to
// change the thing would do. Select words and the bubble hangs under them.
// ⌘J is about the selection, the block the caret is in, or what the pointer
// is over, and with none of those, the page: the drive around the page is ⌘\
// (shell.js). Since v5 what it opens is the line flush under the thing
// (change-line.js), not a card; this layer only decides what it is about.
// Point at something, in the tray, outlines what is under the pointer at the
// right scope, with its name; click to open the line on it, [ and ] to widen
// or narrow it first, ⇧-click to add more. The card stays for Describe mode,
// which borrows it. ⌥ does nothing here
// (v4): it is the key that moves the caret by a word. Resting the pointer
// offers nothing unless it is turned on in Agent settings › Chat. Closing a card puts it away: it never folds into a pill
// left on the page. Chats nobody here is looking at are a glint on their
// element instead (agent-glints.js). Everything here is transient chrome in
// one fixed layer; no document is edited to get a callout.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const PHONE = matchMedia('(max-width: 719px)');
  const HANDLE_DELAY = 180;
  const CARD_WIDTH = 440;
  const GAP = 12;
  const PAD = 12;
  // One duration and one curve for the whole layer, so a handle and a card
  // arrive at the same speed and read as one piece of furniture.
  const MOTION = 180;
  const EASE = 'cubic-bezier(.2, .8, .3, 1)';
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');

  const STYLE = `
    .marble-callout-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none; color: inherit;
      --callout-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --callout-paper: var(--card, var(--paper, #fff));
      --callout-ink: var(--ink, #222);
      font: 13px/1.4 var(--ui-font, system-ui, -apple-system, "Segoe UI", sans-serif);
    }
    /* A drawn speech bubble, outlined, with a beak at the lower left — the
       comment icon, not a marker. A filled disc says only that something is
       here; a rounded box with dots in it is every interface's *more
       options*. The interior is the page's own paper so the text under it
       does not read through, and the drop-shadow is on the glyph rather than
       a box, so the mark has no box. */
    .marble-callout-handle {
      position: fixed; width: 24px; height: 24px; border: 0; padding: 0;
      background: none; cursor: pointer; color: var(--callout-mark);
      pointer-events: auto; display: grid; place-items: center;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,.28));
      opacity: 1; transform: none;
      /* It grows out of the corner it hangs from, not out of its own middle:
         scaling about the centre walks the disc away from the selection it
         is pointing at, and a handle that arrives somewhere other than where
         it settles is a handle you reach for twice.
         allow-discrete is what lets display:none take part, so the handle can
         fade out instead of being cut. The overshoot is only on the way in:
         something offering itself may bounce, something leaving may not. */
      transform-origin: top left;
      transition: opacity 130ms ease, transform 160ms cubic-bezier(.2, .9, .35, 1.35),
                  display 160ms allow-discrete;
    }
    @starting-style { .marble-callout-handle { opacity: 0; transform: scale(.4); } }
    .marble-callout-handle[hidden] { display: none; opacity: 0; transform: scale(.4); }
    .marble-callout-handle:hover { transform: scale(1.12); }
    .marble-callout {
      position: fixed; width: min(${CARD_WIDTH}px, calc(100vw - ${PAD * 2}px)); pointer-events: auto;
      background: var(--callout-paper); color: var(--callout-ink);
      border: 1px solid color-mix(in srgb, var(--callout-mark) 45%, transparent); border-radius: 14px;
      box-shadow: 0 8px 28px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden;
      opacity: 1; transform: none;
      transition: opacity ${MOTION}ms ease, transform ${MOTION}ms ${EASE},
                  border-radius ${MOTION}ms ${EASE}, display ${MOTION}ms allow-discrete;
    }
    /* Arriving and leaving are the same small move, run in opposite
       directions: up from under the line it is about, back down into it. */
    @starting-style { .marble-callout { opacity: 0; transform: translateY(8px) scale(.98); } }
    .marble-callout[hidden] { display: none; opacity: 0; transform: translateY(4px); }
    .marble-callout.is-out { opacity: 0; transform: translateY(8px) scale(.98); pointer-events: none; }
    .marble-callout-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px 4px 12px; color: var(--callout-mark); font-size: 12.5px; }
    .marble-callout-live { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; opacity: .55; }
    .marble-callout[data-live] .marble-callout-live { opacity: 1; animation: marble-callout-pulse 1.4s ease-in-out infinite; }
    @keyframes marble-callout-pulse { 50% { opacity: .35; } }
    .marble-callout-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .marble-callout-actions, .marble-callout-tools { display: flex; align-items: center; gap: 2px; flex: none; }
    .marble-callout-head button {
      font: inherit; font-size: 12px; border: 0; background: none; color: inherit; cursor: pointer;
      padding: 2px 6px; border-radius: 6px; white-space: nowrap;
    }
    .marble-callout-head button:hover { background: color-mix(in srgb, var(--callout-mark) 12%, transparent); }
    .marble-callout-head button:active { opacity: .7; }
    .marble-callout-head button[hidden] { display: none; }
    /* The head's own padding would win over a lone class and make the icon
       button a different box from its neighbour. Both corners are this box. */
    .marble-callout-head button.marble-callout-icon {
      box-sizing: border-box; width: 22px; height: 22px; padding: 0; flex: none;
      display: grid; place-items: center; line-height: 0; border-radius: 6px;
    }
    .marble-callout-icon svg { display: block; }
    .marble-callout-tip {
      position: fixed; z-index: 2; margin: 0; padding: 3px 7px; border-radius: 6px;
      border: 1px solid color-mix(in srgb, var(--callout-ink) 12%, transparent);
      background: var(--callout-paper); color: var(--callout-ink);
      box-shadow: 0 4px 14px rgba(0,0,0,.14);
      font: 500 11px/1.3 var(--ui-font, system-ui, sans-serif);
      letter-spacing: -.011em; white-space: nowrap; pointer-events: none;
    }
    .marble-callout-tip[hidden] { display: none; }
    .marble-callout marble-conversation { display: flex; max-height: min(70vh, 560px); }
    .marble-callout[hidden] { display: none; }
    /* Resting the pointer: the element is outlined with one soft line and the
       faintest wash, and the mark waits in its left margin. Quieter than the
       selection's handle, because a rest is not a choice. */
    .marble-callout-hover {
      position: fixed; pointer-events: none; border-radius: 8px; opacity: 1;
      border: 1px solid color-mix(in srgb, var(--callout-mark) 34%, transparent);
      background: color-mix(in srgb, var(--accent, #9bb6cf) 5%, transparent);
      transition: opacity 160ms ease, left 180ms ${EASE}, top 180ms ${EASE}, width 180ms ${EASE}, height 180ms ${EASE}, display 160ms allow-discrete;
    }
    @starting-style { .marble-callout-hover { opacity: 0; } }
    .marble-callout-hover[hidden] { display: none; opacity: 0; }
    .marble-callout-handle.is-quiet { width: 22px; height: 22px; opacity: .92; }
    .marble-callout-handle.is-quiet svg { width: 22px; height: 22px; }
    /* A fresh card: what it is about is outlined, and the rest of the page
       steps back so the offer reads over quiet paper. */
    .marble-callout-frame {
      position: fixed; pointer-events: none; border-radius: 8px;
      border: 1.5px solid var(--callout-mark);
      box-shadow: 0 0 0 200vmax color-mix(in srgb, var(--callout-paper) 78%, transparent);
      opacity: 1; transition: opacity ${MOTION}ms ease, left ${MOTION}ms ${EASE}, top ${MOTION}ms ${EASE}, width ${MOTION}ms ${EASE}, height ${MOTION}ms ${EASE};
    }
    @starting-style { .marble-callout-frame { opacity: 0; } }
    .marble-callout-frame.is-out { opacity: 0; }
    /* Several things in one card: a line round each, and no dimming, which
       would stack where the frames meet. */
    .marble-callout-frame.is-group { box-shadow: none; }
    .marble-callout[data-offer] {
      width: min(540px, calc(100vw - ${PAD * 2}px)); background: none; border: 0; box-shadow: none; overflow: visible;
    }
    .marble-callout[data-offer] .marble-callout-head,
    .marble-callout[data-offer] marble-conversation { display: none; }
    .marble-callout-pick {
      position: fixed; pointer-events: none; border: 1.5px solid var(--callout-mark); border-radius: 6px;
      opacity: 1;
      /* It glides between blocks rather than teleporting: the outline is one
         pointer, moving, not a new box each time the pointer crosses a line. */
      transition: opacity 110ms ease, left 130ms ${EASE}, top 130ms ${EASE},
                  width 130ms ${EASE}, height 130ms ${EASE}, display 130ms allow-discrete;
    }
    @starting-style { .marble-callout-pick { opacity: 0; } }
    .marble-callout-pick[hidden] { display: none; opacity: 0; }
    /* Its name at the corner, the way a person would point at it. */
    .marble-callout-pick-name {
      position: absolute; left: -1.5px; bottom: calc(100% + 4px); white-space: nowrap; pointer-events: none;
      font: 500 11px/1 var(--ui-font, system-ui, -apple-system, "Segoe UI", sans-serif); padding: 4px 7px; border-radius: 6px;
      color: var(--callout-mark); background: var(--callout-paper);
      border: 1px solid color-mix(in srgb, var(--callout-mark) 28%, transparent); box-shadow: 0 2px 8px rgba(0,0,0,.08);
    }
    .marble-callout-pick.is-low .marble-callout-pick-name { bottom: auto; top: calc(100% + 4px); }
    /* ⇧-clicking something else while a card is open adds it: dashed. */
    .marble-callout-pick.is-adding { border-style: dashed; }
    /* Point at something, from the tray: one line at the top says what a
       click will do now, and how to leave. */
    .marble-callout-latch {
      position: fixed; left: 50%; top: 12px; transform: translateX(-50%); pointer-events: none;
      display: flex; align-items: center; gap: 8px; white-space: nowrap;
      font: 500 12.5px/1 var(--ui-font, system-ui, -apple-system, "Segoe UI", sans-serif);
      padding: 7px 8px 7px 12px; border-radius: 999px; color: var(--callout-ink); background: var(--callout-paper);
      border: 1px solid color-mix(in srgb, var(--callout-ink) 12%, transparent); box-shadow: 0 8px 28px rgba(0,0,0,.14);
    }
    .marble-callout-latch[hidden] { display: none; }
    .marble-callout-latch kbd {
      font: 500 10.5px/1 ui-monospace, "SF Mono", Menlo, monospace; color: var(--faint, #8a8a8a); padding: 2px 5px; border-radius: 4px;
      border: 1px solid color-mix(in srgb, var(--callout-ink) 14%, transparent);
    }
    html.marble-callout-latched, html.marble-callout-latched * { cursor: default !important; }
    /* The layer is in the top layer so a document's own stacking contexts
       cannot cover it; the UA sheet for [popover] would otherwise centre it
       and give it a border. */
    .marble-callout-layer:popover-open { position: fixed; inset: 0; }
    @media (prefers-reduced-motion: reduce) {
      .marble-callout[data-live] .marble-callout-live { animation: none; }
      .marble-callout, .marble-callout-handle, .marble-callout-pick,
      .marble-callout marble-conversation { transition: none; }
      .marble-callout-handle:hover { transform: none; }
    }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    // The Agents page hosts its own conversation UI; a callout there would be
    // a chat drawn over a page made of chats.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-callout-layer')) return;
    const app = marble.app;
    // The Drive's own listing: the document the drive lands on. Asked when
    // it matters, since the shell's tag that names it comes after this one.
    const atHome = () => {
      const home = document.querySelector('script[data-home]')?.dataset.home ?? null;
      return Boolean(home) && app === home;
    };

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

    // The box round several things, for a card about all of them: their
    // common ancestor is often the whole list, which is not where they are.
    const boxOf = (ids) => {
      const els = elementsOf(ids);
      if (els.length < 2) return null;
      const rs = els.map((el) => el.getBoundingClientRect());
      const left = Math.min(...rs.map((r) => r.left));
      const top = Math.min(...rs.map((r) => r.top));
      const right = Math.max(...rs.map((r) => r.right));
      const bottom = Math.max(...rs.map((r) => r.bottom));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };

    const button = (text, label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', (event) => { event.stopPropagation(); onClick(); });
      return b;
    };

    // The tip lives on the layer, not in the card: the card clips its overflow
    // so the fold can hide the body, and a label inside it would be cut off.
    const tip = document.createElement('div');
    tip.className = 'marble-callout-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    layer.append(tip);
    let tipTimer = 0;
    const hideTip = () => {
      clearTimeout(tipTimer);
      tip.hidden = true;
    };
    const showTip = (anchor, text) => {
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => {
        if (!anchor.isConnected) return;
        tip.textContent = text;
        layer.append(tip);
        tip.hidden = false;
        const box = anchor.getBoundingClientRect();
        const size = tip.getBoundingClientRect();
        let left = box.left + box.width / 2 - size.width / 2;
        left = Math.max(8, Math.min(left, innerWidth - size.width - 8));
        let top = box.top - size.height - 6;
        if (top < 8) top = box.bottom + 6;
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
      }, stillness.matches ? 0 : 320);
    };
    const iconButton = (svg, label, hint, onClick) => {
      const b = button('', label, onClick);
      b.classList.add('marble-callout-icon');
      b.innerHTML = svg;
      const arm = (event) => {
        if (event.pointerType === 'touch') return;
        showTip(b, hint);
      };
      b.addEventListener('pointerenter', arm);
      b.addEventListener('focus', () => showTip(b, hint));
      b.addEventListener('pointerleave', hideTip);
      b.addEventListener('pointerdown', hideTip);
      b.addEventListener('blur', hideTip);
      return b;
    };
    const SIDE_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.15 2.75v10.5" stroke="currentColor" stroke-width="1.4"/></svg>';
    const MINIMIZE_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.7 4.7l6.6 6.6M11.3 4.7l-6.6 6.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

    // ------------------------------------------------------------ records

    const records = [];
    const recordOf = (id) => (id ? records.find((r) => r.id === id) ?? null : null);
    // A chat with a card on this page is shown by the card; its glint steps
    // back while the card is there (agent-glints.js asks).
    window.marbleCallout = { holds: (id) => Boolean(recordOf(id)), nameFor: (ids) => nameFor(ids) };
    const held = () => dispatchEvent(new CustomEvent('marble-callout:held'));

    function placeCard(record) {
      // A card lent to Describe mode hangs on the marks, and the marks layer
      // knows where those are; this layer only knows the selection.
      if (record.owner) return;
      const el = record.el;
      const anchor = anchorOf(record.ids);
      if (!anchor) {
        // Nothing left to point at: the chat is still reachable, bottom-right
        // — above whatever already lives down there. The drawer's tray takes
        // its own inset from the safe area, which this layer cannot assume, so
        // it is measured and the card clears it.
        const tray = document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.tray');
        const r = tray?.getBoundingClientRect();
        const bottom = r?.height ? Math.max(PAD, innerHeight - r.top + GAP) : PAD;
        Object.assign(el.style, { left: 'auto', top: 'auto', right: `${PAD}px`, bottom: `${bottom}px` });
        return;
      }
      const r = boxOf(record.ids) ?? anchor.getBoundingClientRect();
      if (record.frames?.length) {
        const els = record.frames.length > 1 ? elementsOf(record.ids) : [anchor];
        record.frames.forEach((frame, i) => {
          const b = (els[i] ?? anchor).getBoundingClientRect();
          Object.assign(frame.style, {
            left: `${Math.round(b.left - 4)}px`, top: `${Math.round(b.top - 3)}px`,
            width: `${Math.round(b.width + 8)}px`, height: `${Math.round(b.height + 6)}px`,
          });
        });
      }
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      const left = Math.min(Math.max(PAD, r.left - 10), Math.max(PAD, innerWidth - PAD - w));
      let top = r.bottom + GAP;
      if (top + h > innerHeight - PAD) top = r.top - GAP - h;
      if (top < PAD) top = Math.max(PAD, Math.min(r.bottom + GAP, innerHeight - PAD - h));
      Object.assign(el.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, right: 'auto', bottom: 'auto' });
    }

    function applyState(record, state) {
      record.state = state;
      record.el.dataset.state = state;
      if (!record.zone && !record.said && !record.actions.childElementCount) record.status.textContent = record.label || 'Ask about this';
      syncDock(record);
      placeCard(record);
    }

    function setState(record, state) {
      applyState(record, state);
    }

    /** Let a thing finish leaving before it is gone. The timer is the net:
     *  a transition on an element the browser never painted never ends. */
    function vanish(el, then) {
      if (stillness.matches || !el.isConnected) { then(); return; }
      el.classList.add('is-out');
      let done = false;
      const finish = () => { if (done) return; done = true; then(); };
      el.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, MOTION + 80);
    }

    function remove(record) {
      record.off?.();
      // Undock on the way out. A card shut while the agent is still working
      // here would otherwise take the zone's label with it and give nothing
      // back, leaving a box on the page that no longer says whose it is.
      record.zone = null;
      syncDock(record);
      record.el.hidden = false;
      const at = records.indexOf(record);
      if (at >= 0) records.splice(at, 1);
      endOffer(record);
      vanish(record.el, () => record.el.remove());
      placeHandle();
      held();
      // Describe mode keeps the marks a brief was made of on the page while
      // the agent works; this is when they can go.
      dispatchEvent(new CustomEvent('marble-callout:removed', { detail: { id: record.id } }));
    }

    function openCard({ id = null, ids, state = 'card', focus = true, owner = null, scope = null, first = null, draft = null, action = null, from = null }) {
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

      const record = { id, ids: [...ids], asked: [...ids], el, convo, head, live, status, actions, tools, state, changed: new Set(), docked: false, title: '', zone: null, said: false, owner, label: '', described: owner === 'describe' };
      records.push(record);

      // The two corner controls. The side icon puts the card away and opens
      // the chat in the drawer; × just puts it away. Neither leaves anything
      // on the page: a chat still going shows as its glint. Open in Agents
      // needs a conversation to point at, which is why it waits for an id.
      const beside = iconButton(SIDE_ICON, 'Open this chat on the side', 'Open on the side', () => {
        remove(record);
        if (record.id) {
          agent.remember?.(record.id);
          agent.open(record.id);
          return;
        }
        const drawer = document.querySelector('marble-agent-drawer');
        if (typeof drawer?.startNew === 'function') drawer.startNew();
        else agent.open();
      });
      const inAgents = button('Open in Agents', 'Open this chat on the Agents page', () => {
        if (!record.id) return;
        const url = new URL(marble.href?.('Agents') ?? '/a/Agents', location.href);
        url.searchParams.set('open', record.id);
        location.href = url.href;
      });
      const paintTools = () => { inAgents.hidden = !record.id; };
      paintTools();
      tools.append(inAgents, beside, iconButton(MINIMIZE_ICON, 'Close', 'Close', () => remove(record)));
      convo.addEventListener('conversation', (event) => {
        record.id = event.detail?.id ?? null;
        held();
        paintTools();
        if (record.id) follow(record);
      });

      // A summoned card is a new conversation. The chat this tab was last in
      // stays where it was: spawning at a selection is a fresh brief, and the
      // first send creates the conversation rather than joining that one.

      // The zone the conversation is drawing is the card's own status line:
      // one object on the page saying where the work is, not two.
      convo.addEventListener('zone', (event) => {
        const zone = event.detail?.zone ?? null;
        record.zone = zone && zone.path === app && elementsOf(zone.ids).length ? zone : null;
        if (record.zone) record.ids = [...record.zone.ids];
        if (zone) {
          record.status.textContent = zone.path === app
            ? (marble.collab?.phaseLabel?.(zone) ?? 'Working')
            : `Building in ${zone.path}`;
        }
        syncDock(record);
        placeCard(record);
      });
      layer.append(el);
      // The attribute after the append: the component only loads once connected.
      if (id) { convo.setAttribute('conversation', id); follow(record); }
      handle.hidden = true;
      setState(record, state);
      // Not on the way in for a lent card: it appears the moment something is
      // marked, often while a note is still being typed, and taking the caret
      // out of that note would be the card interrupting the thing it is for.
      // A fresh card offers before it asks: the light input, the four
      // doors and the suggestions (agent-offer.js). A lent card is the
      // brief's own composer and a card for a chat already has one.
      if (!id && !owner && globalThis.marbleOffer) startOffer(record, scope, { first, draft, action, from });
      else if (state === 'card' && focus) convo.focusInput?.();
      // A card is the one place a brief made somewhere else can land. The
      // marks layer listens for this to write a sketch's reading into the
      // composer; anything else that briefs an agent about a region can do
      // the same, and nothing here needs to know about any of them.
      dispatchEvent(new CustomEvent('marble-callout:card', { detail: { id: record.id, ids: [...record.ids], convo } }));
      return record;
    }

    // ------------------------------------------------------------ watching
    // Docked means: this card stands where the zone's label would, so the
    // label steps back while the card is there.

    function syncDock(record) {
      const want = Boolean(record.zone) && record.state === 'card' && Boolean(record.id);
      if (want === record.docked) return;
      record.docked = want;
      document.dispatchEvent(new CustomEvent(want ? 'marble-callout:docked' : 'marble-callout:undocked', { detail: { id: record.id } }));
    }

    function follow(record) {
      record.off?.();
      record.off = agent.on(record.id, (event) => {
        switch (event.type) {
          case 'turn.started':
            record.changed.clear();
            record.said = false;
            record.el.dataset.live = '1';
            record.actions.replaceChildren();
            break;
          case 'ask':
            // An ask needs an answer, and an answer needs the log.
            record.convo.removeAttribute('data-folded');
            break;
          case 'turn.completed':
          case 'turn.failed':
          case 'turn.cancelled':
          case 'turn.interrupted':
            endRow(record, event);
            break;
          default:
        }
      });
    }

    // What the turn changed, counted where it lands rather than asked for
    // afterwards: the ops are already on their way to this page.
    document.addEventListener('marble:ops', ({ detail }) => {
      const client = String(detail?.client ?? '');
      if (!client.startsWith('agent:')) return;
      const record = recordOf(client.slice('agent:'.length));
      if (!record) return;
      // An insert changes the element it goes into.
      for (const op of detail.ops ?? []) {
        const id = op.id ?? op.parentId;
        if (id) record.changed.add(id);
      }
    });

    // ------------------------------------------------------------ finishing

    // Since v5 an ask's change is reviewed where it happened: rest on it, or
    // Show what changed, for Keep, Undo and Change more (change-review.js).
    // The card is not used for asks any more, so it says nothing at the end
    // of one. Describe mode's card still closes with what it changed and
    // Done, which puts the marks it was made of away and reviews the chat.
    function endRow(record, event) {
      delete record.el.dataset.live;
      record.zone = null;
      syncDock(record);
      if (!record.described) return;
      const n = record.changed.size;
      const ok = event.type === 'turn.completed';
      record.status.textContent = !ok
        ? (event.type === 'turn.failed' ? 'Failed' : 'Stopped')
        : n ? `Changed ${n} element${n === 1 ? '' : 's'}` : 'No changes';
      record.said = true;
      // A failure is a thing to read, not a thing to summarise in one line.
      if (event.type === 'turn.failed') record.convo.removeAttribute('data-folded');
      record.actions.replaceChildren();
      // Undo is the change's own bar now, on the page (change-review.js).
      record.actions.append(button('Done', 'Mark reviewed and put the callout away', () => done(record)));
      placeCard(record);
    }

    // Seeing it and saying done is reviewing it — the rule the Focus pane
    // already uses. Describe mode's card only: an ask is kept from its bar.
    async function done(record) {
      if (record.id) {
        try { await agent.markReviewed(record.id); } catch { /* the callout still goes */ }
        document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id: record.id } }));
      }
      remove(record);
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
    handle.setAttribute('aria-label', 'Change this selection');
    // Stroked in the mark, filled with the page's paper: the same two colours
    // the zone uses, so the thing you summon it with already looks like it.
    handle.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="var(--callout-paper)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.5 15.1A8 8 0 1 1 10.9 18.2L4.9 21.1a.6.6 0 0 1-.72-.85Z"/></svg>';
    handle.hidden = true;
    // A tip that says what a press does, and the key that does it too.
    handle.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') showTip(handle, 'Change this · ⌘J'); });
    handle.addEventListener('pointerleave', hideTip);
    handle.addEventListener('click', hideTip);
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
      // A card Describe mode has borrowed is that mode's, and hides with it.
      const drawn = records.some((r) => r.id === null && !r.owner) || Boolean(window.marbleLine?.current());
      // Inside a marks tool mode an overlay in the top layer has the pointer,
      // so a handle drawn now would be visible and unclickable. The tray is
      // the way out of a mode; the handle comes back when the mode ends.
      // In Describe mode at all, the card is already hung on what is marked:
      // a handle beside it would summon a second composer for the same brief.
      const marksLayer = document.querySelector('.marble-marks-layer');
      const marking = Boolean(marksLayer?.dataset.mode) || Boolean(marksLayer?.hasAttribute('data-describing'));
      const target = pointerDown || !ids.length || drawn || marking ? null : anchorOf(ids);
      if (!target) {
        // No selection: a rested-on element may still be offering.
        if (hover && !drawn && !marking && !pointerDown) placeQuiet();
        else { handle.hidden = true; handle.classList.remove('is-quiet'); }
        return;
      }
      clearHover();
      handle.classList.remove('is-quiet');
      handle.setAttribute('aria-label', 'Change this selection');
      const r = target.getBoundingClientRect();
      handle.style.left = `${Math.round(Math.max(PAD, r.left - 10))}px`;
      handle.style.top = `${Math.round(Math.min(innerHeight - 30, r.bottom + 4))}px`;
      handle.hidden = false;
    }
    // The rested-on element's mark sits in its left margin, at its first line,
    // where a block handle sits in a notes app.
    function placeQuiet() {
      const r = hover.element.getBoundingClientRect();
      handle.classList.add('is-quiet');
      handle.setAttribute('aria-label', `Change this ${marbleScope.kindOf(hover.element)}`);
      handle.style.left = `${Math.round(Math.max(4, r.left - 32))}px`;
      handle.style.top = `${Math.round(r.top + Math.min(r.height / 2 - 11, 2))}px`;
      handle.hidden = false;
    }
    addEventListener('pointerdown', (event) => {
      if (layer.contains(event.target)) return;
      pointerDown = true;
      handle.hidden = true;
    }, true);
    addEventListener('pointerup', () => { pointerDown = false; scheduleHandle(); }, true);
    addEventListener('marble:agent-context', scheduleHandle);
    addEventListener('marble-marks:mode', scheduleHandle);

    // ------------------------------------------------------------ summon

    function summon() {
      // ⌘J and Ask here inside Describe mode mean the card that is already
      // there, not a second one.
      if (document.querySelector('.marble-marks-layer[data-describing]')) {
        dispatchEvent(new CustomEvent('marble-marks:focus'));
        return true;
      }
      // The line on screen: a second ⌘J puts away one being written, or one
      // that has the keys, words kept; one that came back on its own (an
      // answer, why nothing changed, a question) without the keys gets them.
      const line = window.marbleLine;
      const shown = line?.current();
      if (shown && (shown.state === 'edit' || shown.focused)) {
        line.close({ keep: true });
        agent.select(null);
        return true;
      }
      if (shown && ['answer', 'cant', 'ask'].includes(shown.state)) {
        line.focus();
        return true;
      }
      // A card still waiting to be sent: a second ⌘J puts it away.
      const waiting = records.find((r) => r.offer);
      if (waiting) {
        remove(waiting);
        agent.select(null);
        return true;
      }
      let ids = agent.context().selection;
      let scope = null;
      let from = ids.length ? 'selection' : 'point';
      // Words are a selection of their own only when they are part of an
      // element; selecting all of a heading is selecting the heading.
      const sel = getSelection();
      const said = sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, ' ').trim() : '';
      const whole = ids.length ? (anchorOf(ids)?.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
      const words = Boolean(said && said !== whole);
      if (!ids.length && hover) {
        // Nothing selected, but the pointer rested on something: that is
        // what ⌘J and the mark mean. Pinned, so the brief carries it.
        ids = [hover.element.getAttribute('data-marble-id')];
        scope = { chain: hover.chain, index: hover.index };
        agent.select(ids);
      } else if (ids.length) {
        // The words themselves ride along, so the agent's caret can wait at
        // their end while it works (agent-text.js).
        const range = words && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        scope = { words, range, chain: marbleScope?.chainFrom(anchorOf(ids)) ?? [], index: 0 };
      }
      if (!ids.length) {
        // Nothing selected: the block the caret is in while typing, for
        // writers, or else what the pointer is over, with no wait.
        const found = caretUnit() ?? (pointerX != null && globalThis.marbleScope ? marbleScope.at(pointerX, pointerY) : null);
        if (found) {
          ids = [found.element.getAttribute('data-marble-id')];
          scope = { words: false, chain: found.chain, index: found.index };
          from = 'point';
          agent.select(ids);
        }
      }
      if (!ids.length) {
        // Nothing under the pointer or the caret: ⌘J is about the page, and
        // the line sits at the foot of the window. A phone opens the chat,
        // and so does the Drive's own listing, which is a place to open
        // things from, not a page to change (ruling R44).
        if (PHONE.matches || !line || atHome()) return false;
        handle.hidden = true;
        clearHover();
        return line.open({ ids: [], scope: 'page', from: 'key' });
      }
      handle.hidden = true;
      clearHover();
      if (PHONE.matches) {
        // No room for a card beside the text on a phone; the drawer already
        // carries the selection as its own control. Opening it takes focus,
        // and the native selection collapses with it, so the ids are pinned
        // before the hand-off rather than read again after it. The drawer
        // otherwise opens on the chat this tab was last in; a spawn here is
        // a new conversation, the same as the card on a wider window.
        agent.select(ids);
        const drawer = document.querySelector('marble-agent-drawer');
        if (typeof drawer?.startNew === 'function') drawer.startNew();
        else agent.open();
        return true;
      }
      if (line) return line.open({ ids, scope, from: 'key' });
      openCard({ ids, scope, from });
      return true;
    }

    /** The unit around the caret, while the person is typing in the page. */
    function caretUnit() {
      const active = document.activeElement;
      if (!globalThis.marbleScope || !active?.isContentEditable || active.closest(`[${TRANSIENT}]`)) return null;
      const sel = getSelection();
      if (!sel?.rangeCount || !active.contains(sel.anchorNode)) return null;
      const chain = marbleScope.chainFrom(sel.anchorNode);
      if (!chain.length) return null;
      const index = marbleScope.unitIndex(chain);
      return { chain, index, element: chain[index] };
    }
    addEventListener('marble-callout:summon', (event) => {
      if (summon()) event.preventDefault();
    });

    // ------------------------------------------------------------ the offer

    const kindWord = (kind) => ({ part: 'part', words: 'selection' })[kind] ?? kind;
    async function fetchOffer(record) {
      const words = record.scope?.words ? getSelection()?.toString().trim().slice(0, 400) : '';
      try {
        const res = await fetch('/agent/offer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: app, ids: record.ids, words }),
        });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    }

    // The first three cards opened from a selection carry one faint line
    // that teaches asking without selecting, and then never again (v2's
    // Teaching, taught with ⌘J since v4).
    const TAUGHT = 'marble-ask-taught';
    const teach = () => {
      let n = 0;
      try { n = Number(localStorage.getItem(TAUGHT) || 0); } catch { return false; }
      if (n >= 3) return false;
      try { localStorage.setItem(TAUGHT, String(n + 1)); } catch { /* private mode */ }
      return true;
    };

    function startOffer(record, scope, { first = null, draft = null, action = null, from = null } = {}) {
      record.scope = scope ?? { chain: [], index: 0 };
      const anchor = anchorOf(record.ids);
      const count = record.ids.length;
      const kinds = [...new Set(elementsOf(record.ids).map((el) => marbleScope?.kindOf(el) ?? 'part'))];
      const kind = record.scope.words ? 'words' : count > 1 ? (kinds.length === 1 ? kinds[0] : 'part') : marbleScope?.kindOf(anchor) ?? 'part';
      const box = document.createElement('div');
      box.className = 'marble-callout-offer';
      record.el.insertBefore(box, record.convo);
      record.el.dataset.offer = '';
      record.frames = (count > 1 ? elementsOf(record.ids) : [anchor]).map(() => {
        const frame = document.createElement('div');
        frame.className = `marble-callout-frame${count > 1 ? ' is-group' : ''}`;
        frame.setAttribute(TRANSIENT, '');
        layer.insertBefore(frame, record.el);
        return frame;
      });
      record.offer = marbleOffer.mount({
        container: box,
        ids: record.ids,
        kind,
        what: kindWord(kind),
        count,
        element: anchor,
        draft,
        action,
        first,
        teach: from === 'selection' && teach(),
        tip: (anchorEl, text) => (anchorEl ? showTip(anchorEl, text) : hideTip()),
        onResize: () => placeCard(record),
        fetchOffer: () => fetchOffer(record),
        onSend: (text, meta) => {
          if (meta.mode === 'variations') dispatchEvent(new CustomEvent('marble-variations:watch', { detail: { ids: [...record.ids] } }));
          // Pinned for the send, so the brief carries what the card is about,
          // and let go after it: the next selection is the person's again.
          // What the action means rides beside the words, not in them.
          agent.select(record.ids);
          agent.brief?.(meta.brief);
          if (record.scope?.range) dispatchEvent(new CustomEvent('marble-text:words', { detail: { range: record.scope.range } }));
          endOffer(record);
          placeCard(record);
          Promise.resolve(record.convo.sendNow(text)).finally(() => agent.select(null));
        },
        // ⇧⏎: the ask waits as a note on its thing (agent-notes.js), and the
        // card goes, so the next thing can be pointed at.
        onKeep: window.marbleNotes ? (text, meta) => {
          window.marbleNotes.add({ ids: [...record.ids], text, brief: meta.brief, name: nameFor(record.ids) });
          remove(record);
          agent.select(null);
        } : null,
        onSketch: () => {
          const ids = [...record.ids];
          remove(record);
          dispatchEvent(new CustomEvent('marble-marks:toggle', { detail: { on: true, ids } }));
        },
      });
      placeCard(record);
      // At once, so the first key typed lands in it; and again once the card
      // has its place, in case the layer took focus back while it was drawn.
      record.offer.focus();
      requestAnimationFrame(() => record.offer?.focus());
    }

    /** A name for what a set of ids is: "Row · Generative Agents", "2 items". */
    function nameFor(ids) {
      const els = elementsOf(ids);
      if (els.length > 1) {
        const kinds = [...new Set(els.map((el) => marbleScope?.kindOf(el) ?? 'part'))];
        return `${els.length} ${kinds.length === 1 ? `${kinds[0]}s` : 'things'}`;
      }
      return els[0] ? (marbleScope?.nameOf(els[0]) ?? '') : '';
    }

    /** The offer goes, the card stays: after a send it is an ordinary
     *  callout on the work, and on the way out it goes with the card. */
    function endOffer(record) {
      if (!record.offer) return;
      record.offer.destroy();
      record.offer = null;
      delete record.el.dataset.offer;
      record.el.querySelector('.marble-callout-offer')?.remove();
      const frames = record.frames ?? [];
      record.frames = [];
      for (const frame of frames) vanish(frame, () => frame.remove());
      hideTip();
    }

    // An offer nobody used is put away by looking elsewhere: a click outside
    // it, or Escape. A card with a chat in it stays until it is closed.
    const offering = () => records.find((r) => r.offer);
    addEventListener('pointerdown', (event) => {
      const record = offering();
      // Pointing is not looking away: a ⇧-click adds to the card.
      if (!record || latched || layer.contains(event.target) || event.composedPath().some((n) => n?.localName === 'marble-agent-drawer')) return;
      remove(record);
      agent.select(null);
    }, true);
    addEventListener('keydown', (event) => {
      const record = offering();
      if (!record) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        remove(record);
        agent.select(null);
        return;
      }
      // [ takes in the containing element, ] steps back in, while the input
      // has nothing in it to type them into.
      const input = record.offer?.input;
      const free = !event.target?.isContentEditable || (event.target === input && !input.textContent);
      if ((event.key === '[' || event.key === ']') && free && !event.altKey && record.ids.length === 1) {
        const { chain } = record.scope;
        const next = record.scope.index + (event.key === '[' ? 1 : -1);
        if (!chain?.[next]) return;
        event.preventDefault();
        record.scope.index = next;
        const ids = [chain[next].getAttribute('data-marble-id')];
        record.ids = ids;
        record.asked = [...ids];
        agent.select(ids);
        endOffer(record);
        startOffer(record, { ...record.scope, words: false, range: null });
      }
    }, true);

    // ------------------------------------------------------------ hover
    // Offer when I rest: resting the pointer on something long enough offers
    // the bubble for it, at the right scope (agent-scope.js). Off unless the
    // person turns it on in Agent settings › Chat, per browser: resting is what reading
    // looks like, and a page that outlines whatever you rest on feels like it
    // is watching (v2). When on, it is quiet: mouse and pen only, never while
    // typing, dragging, scrolling or marking, and if three offers in a row
    // are passed by, the rest doubles for the session.

    const REST_KEY = 'marble-ask-rest';
    const restOn = () => {
      try { return localStorage.getItem(REST_KEY) === '1'; } catch { return false; }
    };
    // Turned on and off in Agent settings › Chat (agent-ui.js), this tab or
    // another one.
    const restChanged = (key) => { if (key === REST_KEY && !restOn()) clearHover(); };
    addEventListener('storage', (event) => restChanged(event.key));
    addEventListener('marble-agent-prefs', (event) => restChanged(event.detail?.key));

    const HOVER_DWELL = 400;
    const hoverFrame = document.createElement('div');
    hoverFrame.className = 'marble-callout-hover';
    hoverFrame.setAttribute(TRANSIENT, '');
    hoverFrame.hidden = true;
    layer.insertBefore(hoverFrame, handle);
    let hover = null;
    let dwellTimer = 0;
    let lastX = -99;
    let lastY = -99;
    let passedBy = 0;

    const typing = () => {
      const a = document.activeElement;
      return Boolean(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
    };
    const marking = () => {
      const marksLayer = document.querySelector('.marble-marks-layer');
      return Boolean(marksLayer?.dataset.mode) || Boolean(marksLayer?.hasAttribute('data-describing'));
    };
    function canHover() {
      if (!restOn() || latched) return false;
      if (!globalThis.marbleScope || PHONE.matches || pointerDown || typing() || marking()) return false;
      // The Drive's own listing is made of things to open, not to ask about.
      if (atHome()) return false;
      if (records.some((r) => r.offer || (r.id === null && !r.owner)) || window.marbleLine?.current()) return false;
      const sel = getSelection();
      return !(sel && !sel.isCollapsed);
    }
    function showHover(found) {
      hover = found;
      const r = found.element.getBoundingClientRect();
      Object.assign(hoverFrame.style, {
        left: `${Math.round(r.left - 4)}px`, top: `${Math.round(r.top - 3)}px`,
        width: `${Math.round(r.width + 8)}px`, height: `${Math.round(r.height + 6)}px`,
      });
      hoverFrame.hidden = false;
      placeHandle();
    }
    function clearHover(passed = false) {
      clearTimeout(dwellTimer);
      if (!hover) return;
      if (passed && !handle.hidden) passedBy += 1;
      hover = null;
      hoverFrame.hidden = true;
      if (handle.classList.contains('is-quiet')) { handle.hidden = true; handle.classList.remove('is-quiet'); }
    }
    const inGrace = (x, y) => {
      if (!hover) return false;
      const r = hover.element.getBoundingClientRect();
      return x >= r.left - 40 && x <= r.right + 4 && y >= r.top - 6 && y <= r.bottom + 6;
    };
    addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || event.buttons) return;
      if (layer.contains(event.target)) return;
      if (Math.hypot(event.clientX - lastX, event.clientY - lastY) < 4) return;
      lastX = event.clientX;
      lastY = event.clientY;
      clearTimeout(dwellTimer);
      if (hover && inGrace(lastX, lastY)) return;
      if (hover) clearHover(true);
      if (!canHover()) return;
      // Controls are for using: the offer waits twice as long on them.
      const slow = event.target?.closest?.('button, a[href], input, select, textarea') ? 2 : 1;
      dwellTimer = setTimeout(() => {
        if (!canHover()) return;
        const found = marbleScope.at(lastX, lastY);
        if (found) showHover(found);
      }, HOVER_DWELL * slow * (passedBy >= 3 ? 2 : 1));
    }, { passive: true });
    addEventListener('scroll', () => clearHover(), true);
    document.addEventListener('pointerleave', () => { clearHover(true); pointerX = null; pointerY = null; });
    // The mark is how the offer is taken: passing it by is counted, using it resets.
    handle.addEventListener('click', () => { passedBy = 0; }, true);

    // A top-layer sheet shown later paints over one shown earlier. Describe
    // mode's overlay takes the pointer across the window, and the card it
    // borrows has to be clickable over it, so it asks for this layer to be
    // shown again after its own. Hidden and shown in one task, nothing blinks.
    addEventListener('marble-callout:raise', () => {
      try { layer.hidePopover(); layer.showPopover(); } catch { /* not a popover here */ }
    });

    // Describe mode borrows a card rather than drawing a composer of its own,
    // so there is one way to talk to an agent on a page and it looks the same
    // everywhere. The lender keeps the conversation model; the borrower says
    // where the card hangs and what its head line reads, then hands it back
    // once the brief is sent, when it becomes an ordinary callout on the work.
    addEventListener('marble-callout:describe', (event) => {
      const record = openCard({ ids: event.detail?.ids ?? [], focus: false, owner: 'describe' });
      event.preventDefault();
      event.detail.card = {
        el: record.el,
        convo: record.convo,
        label(text) {
          record.label = text;
          if (!record.zone && !record.said && !record.actions.childElementCount) record.status.textContent = text || 'Ask about this';
        },
        focus() {
          if (record.state !== 'card') setState(record, 'card');
          record.convo.focusInput?.();
        },
        show(on) { record.el.hidden = !on; },
        release(ids) {
          record.owner = null;
          record.label = '';
          if (ids?.length) record.ids = [...ids];
          record.el.hidden = false;
          placeCard(record);
        },
        discard() { if (records.includes(record)) remove(record); },
      };
    });

    // ------------------------------------------------------------ pointing
    // Point at something, in the tray: the pointer names a thing instead of
    // firing it, so a click on a page full of live controls can mean "this
    // one" without setting it off. The outline is at the unit a person would
    // name (agent-scope.js), with that name at its corner; [ and ] widen and
    // narrow it. Click and the card opens on it, and pointing ends. ⇧-click
    // and the thing joins the card ("these 2 rows"), and pointing goes on.
    // Escape leaves with nothing done.
    //
    // Until v4 holding ⌥ did the same. It is gone: ⌥ is how a Mac moves the
    // caret by a word, and every ⌥← drew an outline under a resting pointer.

    const pickFrame = document.createElement('div');
    pickFrame.className = 'marble-callout-pick';
    pickFrame.setAttribute(TRANSIENT, '');
    pickFrame.hidden = true;
    const pickName = document.createElement('span');
    pickName.className = 'marble-callout-pick-name';
    pickFrame.append(pickName);
    layer.append(pickFrame);
    const latchLine = document.createElement('div');
    latchLine.className = 'marble-callout-latch';
    latchLine.setAttribute(TRANSIENT, '');
    latchLine.hidden = true;
    latchLine.innerHTML = '<span>Click anything to ask about it. ⇧-click to add more.</span><kbd>esc</kbd>';
    layer.append(latchLine);

    let aim = null; // { chain, index }
    let latched = false;
    let pointerX = null;
    let pointerY = null;

    const aimedAt = () => (aim ? aim.chain[aim.index] : null);
    function aimAt(x, y) {
      if (!globalThis.marbleScope || x == null) { outline(null); return; }
      const found = marbleScope.at(x, y);
      if (!found) { outline(null); return; }
      // Still over the same thing: keep how far [ and ] moved the scope.
      if (!(aim && aim.chain[0] === found.chain[0])) aim = { chain: found.chain, index: found.index };
      outline(aimedAt());
    }
    function outline(el) {
      if (!el) {
        aim = el === null ? null : aim;
        pickFrame.hidden = true;
        return;
      }
      const r = el.getBoundingClientRect();
      const adding = addsTo(el.getAttribute('data-marble-id'));
      pickFrame.classList.toggle('is-adding', adding);
      pickFrame.classList.toggle('is-low', r.top < 28);
      pickName.textContent = `${adding ? '+ ' : ''}${marbleScope.nameOf(el)}`;
      Object.assign(pickFrame.style, {
        left: `${r.left - 4}px`, top: `${r.top - 3}px`, width: `${r.width + 8}px`, height: `${r.height + 6}px`,
      });
      pickFrame.hidden = false;
    }
    const stopPointing = () => { outline(null); aim = null; };

    function setLatched(on) {
      latched = on;
      latchLine.hidden = !on;
      document.documentElement.classList.toggle('marble-callout-latched', on);
      if (on) aimAt(pointerX, pointerY);
      else stopPointing();
    }

    addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      if (!layer.contains(event.target)) { pointerX = event.clientX; pointerY = event.clientY; }
      if (latched) { aimAt(event.clientX, event.clientY); return; }
      if (aim) stopPointing();
    }, true);
    addEventListener('keydown', (event) => {
      if (aim && latched && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
        const next = aim.index + (event.code === 'BracketLeft' ? 1 : -1);
        event.preventDefault();
        event.stopPropagation();
        if (!aim.chain[next]) return;
        aim.index = next;
        outline(aimedAt());
        return;
      }
      if (event.key === 'Escape' && latched) {
        event.preventDefault();
        event.stopPropagation();
        setLatched(false);
      }
    }, true);
    addEventListener('click', (event) => {
      if (!latched || layer.contains(event.target)) return;
      if (event.composedPath().some((n) => n?.localName === 'marble-agent-drawer')) return;
      if (marking()) return;
      if (!aim) aimAt(event.clientX, event.clientY);
      const el = aimedAt();
      // The page never sees this click: it is a name, not a press.
      event.preventDefault();
      event.stopPropagation();
      // A plain click is one thing named, and pointing is over; ⇧ says there
      // are more to come.
      const adding = event.shiftKey;
      if (!adding) setLatched(false);
      if (!el) return;
      const id = el.getAttribute('data-marble-id');
      const line = window.marbleLine;
      const open = line?.current();
      const card = offering();
      if (line && adding && open?.state === 'edit' && !open.words && !open.page) {
        if (!open.ids.includes(id)) line.open({ ids: [...open.ids, id], draft: open.text || null, from: 'point' });
      } else if (!line && card && adding && !card.scope?.words) {
        if (!card.ids.includes(id)) addToCard(card, id);
      } else {
        const scope = { words: false, chain: aim?.chain ?? [el], index: aim?.index ?? 0 };
        if (card) remove(card);
        if (line) line.open({ ids: [id], scope, from: 'point' });
        else openCard({ ids: [id], scope, from: 'point' });
      }
      aim = null;
      if (adding) aimAt(event.clientX, event.clientY);
    }, true);

    /** Whether a ⇧-click on `id` would add it to what is open: the line
     *  still being written about parts (not words, not the page), or a card. */
    function addsTo(id) {
      const open = window.marbleLine?.current();
      if (open) return open.state === 'edit' && !open.words && !open.page && !open.ids.includes(id);
      const card = offering();
      return Boolean(card && !card.scope?.words && !card.ids.includes(id));
    }

    /** ⇧-click with a card open: the thing joins the card's scope. What was
     *  typed stays; the card is redrawn about all of them. */
    function addToCard(record, id) {
      const said = record.offer?.input?.textContent ?? '';
      record.ids = [...record.ids, id];
      record.asked = [...record.ids];
      agent.select(record.ids);
      endOffer(record);
      startOffer(record, { words: false, chain: [], index: 0 }, { draft: said.trim() || null });
    }

    // The tray's row for pointing. Offer when I rest, v1's dwell kept as a
    // switch and off by default, is a setting since v4 (Agent settings ›
    // Chat), not something to do.
    const POINT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M5 3.5l13 6.2-5.6 1.7-1.7 5.6z"/><path d="M12.6 12.6 19 19"/></svg>';
    let trayHeld = false;
    function offerTray() {
      const spec = { id: 'point', order: 8, label: 'Point at something', icon: POINT_ICON, always: true, onSelect: () => setLatched(true) };
      if (!trayHeld) {
        trayHeld = !dispatchEvent(new CustomEvent('marble-tray:register', { cancelable: true, detail: spec }));
        return;
      }
      dispatchEvent(new CustomEvent('marble-tray:update', { detail: spec }));
    }
    addEventListener('marble-tray:ready', () => { trayHeld = false; offerTray(); });
    offerTray();

    // Reviewed somewhere else — the drawer, the Agents page, a glint's Done:
    // the trail was about being unread. A card is only ever for a chat this
    // tab opened; a reload rebuilds none, and a brief sent from elsewhere
    // shows here as a glint, not a card.
    agent.on('*', (summary) => {
      if (!summary || typeof summary.id !== 'string' || !recordOf(summary.id)) return;
      if (summary.running === false && summary.needsReview === false) {
        document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id: summary.id } }));
      }
    });

    // A card with something already in it, from somewhere else on the page:
    // a note's pin taken back (agent-notes.js), or an offer after an edit
    // (agent-nudge.js). `action` drafts one of the four for this thing; a
    // suggestion drafts, it never sends.
    addEventListener('marble-callout:ask', (event) => {
      const ids = (event.detail?.ids ?? []).filter((id) => byId(id));
      if (!ids.length) return;
      event.preventDefault();
      const open = offering();
      if (open) remove(open);
      // The line, with the words in it (or the action drafted for this thing).
      const line = window.marbleLine;
      if (line) {
        line.open({ ids, draft: event.detail?.draft ?? null, action: event.detail?.action ?? null, from: event.detail?.from ?? 'note' });
        return;
      }
      const el = byId(ids[0]);
      const chain = ids.length === 1 ? (marbleScope?.chainFrom(el) ?? [el]) : [];
      openCard({ ids, scope: { words: false, chain, index: 0 }, draft: event.detail?.draft ?? null, action: event.detail?.action ?? null, from: event.detail?.from ?? 'note' });
    });

    // Sent from somewhere else, as one ask from a card at the things: Send
    // all from the notes. The card is an ordinary callout on the work after.
    addEventListener('marble-callout:send', (event) => {
      const { ids = [], text = '', brief = '' } = event.detail ?? {};
      if (!String(text).trim()) return;
      event.preventDefault();
      const open = offering();
      if (open) remove(open);
      // One ask from the line at the things, sent at once.
      const line = window.marbleLine;
      if (line) {
        const at = ids.filter((id) => byId(id));
        line.open({ ids: at, scope: at.length ? null : 'page', draft: String(text), brief, send: true, from: 'note' });
        return;
      }
      const record = openCard({ ids, focus: false, owner: 'send' });
      record.owner = null;
      placeCard(record);
      agent.select(ids.length ? ids : null);
      agent.brief?.(brief);
      Promise.resolve(record.convo.sendNow(text)).finally(() => agent.select(null));
    });

    // The zone's Open chat, offered to the callout first: being taken to a
    // card two inches away is not being taken anywhere.
    document.addEventListener('marble-callout:open', (event) => {
      const record = recordOf(event.detail?.id);
      if (!record) return;
      event.preventDefault();
      setState(record, 'card');
      record.convo.focusInput?.();
    });
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
