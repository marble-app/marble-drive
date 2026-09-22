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
  // One duration and one curve for the whole layer, so a handle, a card and
  // a pill all arrive at the same speed and read as one piece of furniture.
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
    .marble-callout[data-state="pill"] { width: auto; max-width: 320px; border-radius: 999px; cursor: pointer; }
    .marble-callout[data-state="pill"] .marble-callout-head { padding: 5px 12px; }
    .marble-callout[data-state="pill"] marble-conversation,
    .marble-callout[data-state="pill"] .marble-callout-tools,
    .marble-callout[data-state="pill"] .marble-callout-actions { display: none; }
    /* The body crossfades while the box travels, so folding reads as one
       move rather than a resize with a hole in it. */
    .marble-callout marble-conversation { transition: opacity 120ms ease; }
    .marble-callout[data-state="pill"] marble-conversation { opacity: 0; }
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

    // A fold is this tab's opinion about this document, and nothing more: a
    // dismissed callout needs no memory, because markReviewed is the memory.
    const FOLD_KEY = `marble-callout-folded:${app}`;
    const foldedIds = () => {
      try { return new Set(JSON.parse(sessionStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); }
    };
    function rememberFold(id, on) {
      if (!id) return;
      const set = foldedIds();
      if (on) set.add(id); else set.delete(id);
      try { sessionStorage.setItem(FOLD_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
    }
    // A pill has one line. It is the chat's name at rest, but a turn that
    // ended while the callout was folded is news, and news is what you want
    // from a line you are not going to open. What you can *do* about it —
    // Undo, Done — stays in the card: those come after looking.
    function paintPill(record) {
      if (record.state !== 'pill' || record.said) return;
      record.status.textContent = record.title || 'Agent';
    }

    function placeCard(record) {
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
      rememberFold(record.id, state === 'pill');
      if (state === 'pill') paintPill(record);
      else if (!record.zone && !record.said && !record.actions.childElementCount) record.status.textContent = 'Ask about this';
      syncDock(record);
      placeCard(record);
    }

    /** Card to pill and back. The box is measured either side of the change
     *  and animated between the two rectangles — not scaled, which would
     *  stretch the words inside it, but really resized, with the card's own
     *  overflow doing the hiding. */
    function morph(record, apply) {
      const el = record.el;
      const was = el.dataset.state;
      if (stillness.matches || !el.isConnected || !was || was === record.state) { apply(); return; }
      const before = el.getBoundingClientRect();
      apply();
      const after = el.getBoundingClientRect();
      const still = Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1
        && Math.abs(before.left - after.left) < 1 && Math.abs(before.top - after.top) < 1;
      if (still) return;
      el.animate([
        { width: `${before.width}px`, height: `${before.height}px`, left: `${before.left}px`, top: `${before.top}px` },
        { width: `${after.width}px`, height: `${after.height}px`, left: `${after.left}px`, top: `${after.top}px` },
      ], { duration: MOTION, easing: EASE });
    }

    function setState(record, state) {
      morph(record, () => applyState(record, state));
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
      vanish(record.el, () => record.el.remove());
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

      const record = { id, ids: [...ids], el, convo, head, live, status, actions, tools, state, changed: new Set(), docked: false, title: '', zone: null, said: false };
      records.push(record);

      // The two corner controls. The side icon folds the card and opens the
      // drawer. × only folds it. The pill that is left opens the card again,
      // so neither control is reachable from the pill. Open in Agents still
      // needs a conversation to point at, which is why it waits for an id.
      const beside = iconButton(SIDE_ICON, 'Open this chat on the side', 'Open on the side', () => {
        setState(record, 'pill');
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
      tools.append(inAgents, beside, iconButton(MINIMIZE_ICON, 'Minimize', 'Minimize', () => setState(record, 'pill')));

      head.addEventListener('click', (event) => {
        if (record.state === 'pill' && !event.target.closest('button')) setState(record, 'card');
      });
      convo.addEventListener('conversation', (event) => {
        record.id = event.detail?.id ?? null;
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
      if (state === 'card') convo.focusInput?.();
      // A card is the one place a brief made somewhere else can land. The
      // marks layer listens for this to write a sketch's reading into the
      // composer; anything else that briefs an agent about a region can do
      // the same, and nothing here needs to know about any of them.
      dispatchEvent(new CustomEvent('marble-callout:card', { detail: { id: record.id, ids: [...record.ids], convo } }));
      return record;
    }

    // ------------------------------------------------------------ watching
    // Docked means: this card stands where the zone's label would, so the
    // label steps back. Only a card docks; a pill is small enough to sit
    // beside a label and lets it return.

    function syncDock(record) {
      // While the agent is working here the zone's label *is* this callout's
      // folded state: a pill hangs at the same corner as the label, saying
      // the same thing over the top of it. Open chat on the label brings the
      // card back, which is what a pill would have done.
      record.el.hidden = Boolean(record.zone) && record.state === 'pill';
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
            if (record.state === 'pill') setState(record, 'card');
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
      try { detail = await agent.conversation(record.id); } catch { return; }
      const turn = [...(detail?.turns ?? [])].reverse().find((t) => t.status === 'completed' && t.applied && !t.undoneAt);
      if (!turn) return;
      try { await agent.undo(turn.id); } catch { return; }
      record.changed.clear();
      record.status.textContent = 'Undone';
      record.said = true;
      record.actions.replaceChildren(button('Done', 'Mark reviewed and put the callout away', () => done(record)));
    }

    // An older × used to shut a callout for this tab. That list is still
    // honored, so a callout closed before this change does not come back.
    const SHUT_KEY = `marble-callout-shut:${app}`;
    const shutIds = () => {
      try { return new Set(JSON.parse(sessionStorage.getItem(SHUT_KEY) || '[]')); } catch { return new Set(); }
    };

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
      const drawn = records.some((r) => r.id === null);
      // Inside a marks tool mode an overlay in the top layer has the pointer,
      // so a handle drawn now would be visible and unclickable. The tray is
      // the way out of a mode; the handle comes back when the mode ends.
      const marking = Boolean(document.querySelector('.marble-marks-layer')?.dataset.mode);
      const target = pointerDown || !ids.length || drawn || marking ? null : anchorOf(ids);
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
    addEventListener('marble-marks:mode', scheduleHandle);

    // ------------------------------------------------------------ summon

    function summon() {
      const ids = agent.context().selection;
      if (!ids.length) return false;
      handle.hidden = true;
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
      openCard({ ids });
      return true;
    }
    addEventListener('marble-callout:summon', (event) => {
      if (summon()) event.preventDefault();
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

    // ------------------------------------------------------------ rehydration
    //
    // The store already remembers everything the layer needs: which document a
    // chat is about, what its last turn was aimed at, and whether it is still
    // running, asking, or waiting to be looked at. So a reload rebuilds the
    // callouts rather than storing a second copy of where they were.

    const endedActions = (record) => {
      record.actions.replaceChildren(button('Done', 'Mark reviewed and put the callout away', () => done(record)));
    };

    const adopt = async (summary, { folded = foldedIds() } = {}) => {
      if (recordOf(summary.id) || records.some((r) => r.convo.getAttribute('conversation') === summary.id)) return null;
      let detail = null;
      try { detail = await agent.conversation(summary.id); } catch { return null; }
      const ids = detail?.turns?.at(-1)?.context?.selection ?? [];
      // A selection that no longer resolves draws nothing; the drawer still
      // lists the chat.
      if (!elementsOf(ids).length) return null;
      const live = summary.status === 'running' || summary.asking;
      const record = openCard({ id: summary.id, ids, state: live && !folded.has(summary.id) ? 'card' : 'pill' });
      record.title = summary.title ?? '';
      if (live) record.el.dataset.live = '1';
      else endedActions(record);
      // Rebuilt, not just finished: the line is the chat's name again.
      record.said = false;
      paintPill(record);
      return record;
    };

    const mine = (summary) => summary.target === app && !summary.archived
      && !shutIds().has(summary.id)
      && (summary.status === 'running' || summary.asking || summary.needsReview);

    async function rehydrate() {
      let list = [];
      try { list = await agent.conversations(); } catch { return; }
      const folded = foldedIds();
      const wanted = list
        .filter(mine)
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
        .slice(0, 6);
      for (const summary of wanted) await adopt(summary, { folded });
    }

    // Live: a brief about this document sent from anywhere — the drawer, the
    // Agents page, another tab — gets a callout here too, so the two paths
    // converge on one object.
    agent.on('*', (summary) => {
      if (!summary || typeof summary.id !== 'string') return;
      const record = recordOf(summary.id);
      if (record) {
        record.title = summary.title ?? record.title;
        paintPill(record);
        // Reviewed somewhere else: the trail was about being unread.
        if (summary.running === false && summary.needsReview === false) {
          document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id: summary.id } }));
        }
        return;
      }
      if (mine(summary)) adopt(summary);
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

    rehydrate();
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
