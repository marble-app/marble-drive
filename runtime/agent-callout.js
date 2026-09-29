// The callout: a conversation drawn at the region of the document it is about.
//
// The fifth view of a conversation. The drawer and the Agents page show the
// same object in a panel and in panes; this shows it in situ — a handle at
// your selection, a card when you summon, and the zone's own label while the
// agent works there. Closing a card puts it away: it never folds into a pill
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
    window.marbleCallout = { holds: (id) => Boolean(recordOf(id)) };
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
      const r = anchor.getBoundingClientRect();
      if (record.frame) {
        Object.assign(record.frame.style, {
          left: `${Math.round(r.left - 4)}px`, top: `${Math.round(r.top - 3)}px`,
          width: `${Math.round(r.width + 8)}px`, height: `${Math.round(r.height + 6)}px`,
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

    function openCard({ id = null, ids, state = 'card', focus = true, owner = null, scope = null }) {
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

      const record = { id, ids: [...ids], el, convo, head, live, status, actions, tools, state, changed: new Set(), docked: false, title: '', zone: null, said: false, owner, label: '' };
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
            ? (marble.collab?.phaseLabel?.(zone) ?? 'Agent · working')
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
      if (!id && !owner && globalThis.marbleOffer) startOffer(record, scope);
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
      for (const op of detail.ops ?? []) if (op.id) record.changed.add(op.id);
    });

    // ------------------------------------------------------------ finishing

    function endRow(record, event) {
      delete record.el.dataset.live;
      record.zone = null;
      syncDock(record);
      const n = record.changed.size;
      const ok = event.type === 'turn.completed';
      record.status.textContent = !ok
        ? (event.type === 'turn.failed' ? 'Failed' : 'Stopped')
        : n ? `Changed ${n} element${n === 1 ? '' : 's'}` : 'No changes';
      record.said = true;
      // A failure is a thing to read, not a thing to summarise in one line.
      if (event.type === 'turn.failed') record.convo.removeAttribute('data-folded');
      record.actions.replaceChildren();
      if (ok && n) record.actions.append(button('Undo', 'Undo this turn', () => undoLast(record)));
      record.actions.append(button('Done', 'Mark reviewed and put the callout away', () => done(record)));
      placeCard(record);
    }

    async function undoLast(record) {
      let detail = null;
      try { detail = await agent.conversation(record.id, { turns: 0 }); } catch { return; }
      const turn = [...(detail?.turns ?? [])].reverse().find((t) => t.status === 'completed' && t.applied && !t.undoneAt);
      if (!turn) return;
      try { await agent.undo(turn.id); } catch { return; }
      record.changed.clear();
      record.status.textContent = 'Undone';
      record.said = true;
      record.actions.replaceChildren(button('Done', 'Mark reviewed and put the callout away', () => done(record)));
    }

    // Seeing it and saying done is reviewing it — the rule the Focus pane
    // already uses. The trail goes with the review.
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
    handle.setAttribute('aria-label', 'Ask an agent about this selection');
    // Stroked in the mark, filled with the page's paper: the same two colours
    // the zone uses, so the thing you summon it with already looks like it.
    handle.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="var(--callout-paper)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.5 15.1A8 8 0 1 1 10.9 18.2L4.9 21.1a.6.6 0 0 1-.72-.85Z"/></svg>';
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
      // A card Describe mode has borrowed is that mode's, and hides with it.
      const drawn = records.some((r) => r.id === null && !r.owner);
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
      handle.setAttribute('aria-label', 'Ask an agent about this selection');
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
      handle.setAttribute('aria-label', `Ask an agent about this ${marbleScope.kindOf(hover.element)}`);
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
      let ids = agent.context().selection;
      let scope = null;
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
        scope = { words, chain: marbleScope?.chainFrom(anchorOf(ids)) ?? [], index: 0 };
      }
      if (!ids.length) return false;
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
      openCard({ ids, scope });
      return true;
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

    function startOffer(record, scope) {
      record.scope = scope ?? { chain: [], index: 0 };
      const anchor = anchorOf(record.ids);
      const kind = record.scope.words ? 'words' : marbleScope?.kindOf(anchor) ?? 'part';
      const box = document.createElement('div');
      box.className = 'marble-callout-offer';
      record.el.insertBefore(box, record.convo);
      record.el.dataset.offer = '';
      const frame = document.createElement('div');
      frame.className = 'marble-callout-frame';
      frame.setAttribute(TRANSIENT, '');
      layer.insertBefore(frame, record.el);
      record.frame = frame;
      record.offer = marbleOffer.mount({
        container: box,
        ids: record.ids,
        kind,
        what: kindWord(kind),
        tip: (anchorEl, text) => (anchorEl ? showTip(anchorEl, text) : hideTip()),
        onResize: () => placeCard(record),
        fetchOffer: () => fetchOffer(record),
        onSend: (brief, meta) => {
          if (meta.mode === 'variations') dispatchEvent(new CustomEvent('marble-variations:watch', { detail: { ids: [...record.ids] } }));
          // Pinned for the send, so the brief carries what the card is about,
          // and let go after it: the next selection is the person's again.
          agent.select(record.ids);
          endOffer(record);
          placeCard(record);
          Promise.resolve(record.convo.sendNow(brief)).finally(() => agent.select(null));
        },
        onDescribe: () => {
          const ids = [...record.ids];
          remove(record);
          dispatchEvent(new CustomEvent('marble-marks:toggle', { detail: { on: true, ids } }));
        },
      });
      placeCard(record);
      requestAnimationFrame(() => record.offer?.focus());
    }

    /** The offer goes, the card stays: after a send it is an ordinary
     *  callout on the work, and on the way out it goes with the card. */
    function endOffer(record) {
      if (!record.offer) return;
      record.offer.destroy();
      record.offer = null;
      delete record.el.dataset.offer;
      record.el.querySelector('.marble-callout-offer')?.remove();
      const frame = record.frame;
      record.frame = null;
      if (frame) vanish(frame, () => frame.remove());
      hideTip();
    }

    // An offer nobody used is put away by looking elsewhere: a click outside
    // it, or Escape. A card with a chat in it stays until it is closed.
    const offering = () => records.find((r) => r.offer);
    addEventListener('pointerdown', (event) => {
      const record = offering();
      if (!record || layer.contains(event.target) || event.composedPath().some((n) => n?.localName === 'marble-agent-drawer')) return;
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
      // does not have the keys.
      if ((event.key === '[' || event.key === ']') && !event.target?.isContentEditable) {
        const { chain } = record.scope;
        const next = record.scope.index + (event.key === '[' ? 1 : -1);
        if (!chain?.[next]) return;
        event.preventDefault();
        record.scope.index = next;
        const ids = [chain[next].getAttribute('data-marble-id')];
        record.ids = ids;
        agent.select(ids);
        endOffer(record);
        startOffer(record, { ...record.scope, words: false });
      }
    }, true);

    // ------------------------------------------------------------ hover
    // Resting the pointer on something long enough offers the bubble for it,
    // at the right scope (agent-scope.js). Quiet: mouse and pen only, never
    // while typing, dragging, scrolling or marking, and if three offers in a
    // row are passed by, the rest doubles for the session.

    const HOVER_DWELL = 400;
    const HOME = document.querySelector('script[data-home]')?.dataset.home ?? null;
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
      if (!globalThis.marbleScope || PHONE.matches || pointerDown || typing() || marking()) return false;
      // The Drive's own listing is made of things to open, not to ask about.
      if (HOME && app === HOME) return false;
      if (records.some((r) => r.offer || (r.id === null && !r.owner))) return false;
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
    document.addEventListener('pointerleave', () => clearHover(true));
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

    // ------------------------------------------------------------ pick mode
    // Option held: the pointer names an element instead of firing it. Holding
    // a key is the only way a click on a page full of live controls can mean
    // "this one" without setting it off, and Option is already Marble's pick
    // modifier — the Drive listing's lasso is Option-drag.

    const pickFrame = document.createElement('div');
    pickFrame.className = 'marble-callout-pick';
    pickFrame.setAttribute(TRANSIENT, '');
    pickFrame.hidden = true;
    layer.append(pickFrame);
    const picked = new Set();
    let hovered = null;

    const addressedAt = (x, y) => {
      const hit = document.elementFromPoint(x, y)?.closest?.('[data-marble-id]');
      if (!hit || hit === document.body || hit === document.documentElement || hit.closest(`[${TRANSIENT}]`)) return null;
      return hit;
    };
    const outline = (el) => {
      hovered = el;
      if (!el) { pickFrame.hidden = true; return; }
      const r = el.getBoundingClientRect();
      Object.assign(pickFrame.style, {
        left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`,
      });
      pickFrame.hidden = false;
    };
    const commitPicks = () => agent.select(picked.size ? [...picked] : null);

    addEventListener('pointermove', (event) => {
      if (!event.altKey) { if (hovered) outline(null); return; }
      outline(addressedAt(event.clientX, event.clientY));
    }, true);
    addEventListener('keyup', (event) => {
      if (event.key === 'Alt' && hovered) outline(null);
    }, true);
    addEventListener('click', (event) => {
      if (!event.altKey || layer.contains(event.target)) return;
      const el = addressedAt(event.clientX, event.clientY);
      if (!el) return;
      // The page never sees this click: it is a name, not a press.
      event.preventDefault();
      event.stopPropagation();
      const id = el.getAttribute('data-marble-id');
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      commitPicks();
    }, true);
    addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !picked.size) return;
      // A marks tool mode owns Escape while it is on — this listener runs
      // first, because this script is injected first, so without the check its
      // Escape would clear the picks before the mode ever saw the key. The
      // picks are still there when the mode ends.
      if (document.querySelector('.marble-marks-layer')?.dataset.mode) return;
      picked.clear();
      commitPicks();
    }, true);
    // A fresh text selection is the person choosing something else; the two
    // must never disagree about what is selected.
    document.addEventListener('selectionchange', () => {
      const selection = getSelection();
      if (!picked.size || !selection || selection.isCollapsed || !selection.rangeCount) return;
      const node = selection.anchorNode;
      const anchor = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!anchor || anchor.closest(`[${TRANSIENT}]`)) return;
      picked.clear();
      agent.select(null);
    });

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
