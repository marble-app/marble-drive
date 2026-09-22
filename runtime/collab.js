// Drive's collaboration chrome. Transient, injected like the agent drawer.
//
// The package decides what landed: ops, a fork, a presence set. This file is
// the look — a quiet mark while an agent works, a wash on a person
// sitting in an id, and Keep / Merge on a conflict <marble-alt>. Authoring
// alts (natures, drafts, titles) keep the document's own switcher. Another
// host using @bdhmin/marble draws something else against the same events.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const ID = 'data-marble-id';
  const ALT = 'data-marble-alt';
  const ACTIVE = 'data-marble-active';
  const BY = 'data-marble-by';
  const EASE = 'var(--settle, cubic-bezier(.22, 1, .36, 1))';

  const attach = (marble) => {
    if (document.documentElement.classList.contains('marble-collab-host')) return;
    document.documentElement.classList.add('marble-collab-host');
    marble.pageOnly('data-marble-choice');

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = `
      html.marble-collab-host marble-alt.marble-forked .marble-alts { display: none; }

      html.marble-collab-host marble-alt.marble-forked {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
      }
      html.marble-collab-host marble-alt.marble-forked > [data-marble-alt] {
        grid-area: 1 / 1;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      html.marble-collab-host marble-alt.marble-forked.marble-fork-live > [data-marble-alt] {
        transition: opacity 180ms ${EASE}, visibility 180ms ${EASE};
      }
      html.marble-collab-host marble-alt.marble-forked > .marble-alt-shown {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      html.marble-collab-host marble-alt.marble-forked > .marble-fork {
        grid-area: 2 / 1;
      }

      .marble-presence,
      .marble-presence-out {
        border-radius: 4px;
        transition: background-color 220ms ${EASE};
      }
      .marble-presence {
        background-color: color-mix(in srgb, var(--accent, #9bb6cf) 22%, transparent);
      }
      .marble-presence-out {
        background-color: transparent;
      }

      .marble-flash {
        animation: marble-flash 480ms ${EASE} 1;
      }
      @keyframes marble-flash {
        0% { box-shadow: 0 0 0 0 transparent; }
        18% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #9bb6cf) 42%, transparent); }
        100% { box-shadow: 0 0 0 0 transparent; }
      }

      /* Where an agent's turn landed, until the chat is reviewed. An inset
         rule: it cannot move layout, it survives the element's own overflow,
         and it goes when the class goes. */
      html.marble-collab-host .marble-trail {
        box-shadow: inset 2px 0 0 var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      }

      .marble-fork {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .5rem .85rem;
        margin-top: .55rem;
        font: 500 12px/1.2 var(--ui-font, system-ui, sans-serif);
        letter-spacing: -.01em;
        animation: marble-fade-in 200ms ${EASE} both;
      }
      .marble-fork-why {
        flex-basis: 100%;
        color: var(--muted, #5a5a5a);
        margin-bottom: -.15rem;
      }
      @keyframes marble-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .marble-fork.marble-fork-out {
        animation: marble-fade-out 160ms ${EASE} both;
      }
      @keyframes marble-fade-out {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      .marble-fork-seg {
        display: inline-flex;
        padding: 2px;
        gap: 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--ink, #111) 7%, transparent);
      }
      .marble-fork-seg button {
        appearance: none;
        border: 0;
        background: none;
        color: var(--muted, #5a5a5a);
        padding: .34rem .78rem;
        border-radius: 999px;
        cursor: pointer;
        font: inherit;
        transition:
          color 180ms ${EASE},
          background 180ms ${EASE},
          box-shadow 180ms ${EASE},
          transform 90ms ${EASE};
      }
      .marble-fork-seg button:hover { color: var(--ink, #111); }
      .marble-fork-seg button[aria-pressed="true"] {
        background: var(--paper, #fff);
        color: var(--ink, #111);
        box-shadow: 0 1px 2px color-mix(in srgb, var(--ink, #111) 14%, transparent);
      }

      .marble-fork-acts {
        display: inline-flex;
        align-items: center;
        gap: .1rem;
      }
      .marble-fork-acts button {
        appearance: none;
        border: 0;
        background: none;
        color: var(--muted, #5a5a5a);
        padding: .34rem .55rem;
        border-radius: 7px;
        cursor: pointer;
        font: inherit;
        transition:
          color 180ms ${EASE},
          background 180ms ${EASE},
          transform 90ms ${EASE};
      }
      .marble-fork-acts button:hover {
        color: var(--ink, #111);
        background: color-mix(in srgb, var(--ink, #111) 6%, transparent);
      }
      .marble-fork-acts .marble-fork-keep {
        color: var(--ink, #111);
        font-weight: 600;
      }

      .marble-fork button:focus-visible {
        outline: 2px solid var(--accent, #9bb6cf);
        outline-offset: 2px;
      }

      .marble-zone-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483000;
        /* An agent is not a feature of the app it is working in, so its frame
           does not borrow the document's accent — a box in the app's own colour
           reads as a piece of the app. One violet, the same on every document,
           outside the vocabulary every accent here is drawn from (muted blue,
           sage, terracotta, gold): someone else's hands, not a control.

           The agent works in the document's own accent. It used to wear one
           violet, chosen to sit outside every document's palette so that an
           agent could never be read as a control of the app it was standing
           in; the zone's shape, its wash and its label carry that now, and
           belonging to the page it is on costs nothing.
           The fallback is that violet, and it keeps the old carry toward the
           page's ink: dark mode here is per-document, not per-OS, so a fixed
           literal has to adapt itself, where a document's own accent already has. */
        --zone-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #111)));
        --zone-fill: color-mix(in srgb, var(--zone-mark) 12%, transparent);
      }
      .marble-zone {
        position: fixed;
        /* The wash is over the work, and the work is still yours: nothing in the
           frame takes a click. Only the label does. */
        pointer-events: none;
        box-sizing: border-box;
        border: 1.5px solid var(--zone-mark);
        border-radius: 10px;
        background-color: var(--zone-fill);
        animation: marble-fade-in 220ms ${EASE} both;
        transition:
          top 180ms ${EASE},
          left 180ms ${EASE},
          width 180ms ${EASE},
          height 180ms ${EASE};
      }
      /* The label belongs to the box, so it is made of the box: same colour, a
         pill hung off its bottom-left corner. It used to be bare text kept
         legible by a paper text-shadow, which floated free of anything. */
      .marble-zone-label {
        pointer-events: auto;
        cursor: pointer;
        position: absolute;
        left: -1.5px;
        top: 100%;
        margin-top: 6px;
        display: flex;
        align-items: center;
        gap: .45rem;
        max-width: min(calc(100% + 3px), 30rem);
        padding: .26rem .5rem .26rem .58rem;
        border: 1px solid color-mix(in srgb, var(--zone-mark) 34%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--zone-mark) 12%, var(--paper, #fff));
        color: color-mix(in srgb, var(--zone-mark) 62%, var(--ink, #111));
        box-shadow: 0 1px 3px color-mix(in srgb, var(--ink, #111) 12%, transparent);
        font: 500 12px/1.2 var(--ui-font, system-ui, sans-serif);
        letter-spacing: -.012em;
        white-space: nowrap;
        user-select: none;
      }
      .marble-zone-label span:not(.marble-zone-live) {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .marble-zone-live {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex: none;
        background: var(--zone-mark, #6d55d4);
        animation: marble-zone-breathe 2.8s ease-in-out infinite;
      }
      @keyframes marble-zone-breathe {
        0%, 100% { opacity: .38; }
        50% { opacity: 1; }
      }
      .marble-zone-tight > .marble-zone-label {
        top: auto;
        bottom: 4px;
        margin-top: 0;
      }
      .marble-zone-label button {
        appearance: none;
        border: 0;
        background: none;
        color: color-mix(in srgb, var(--zone-mark) 52%, var(--ink, #111));
        cursor: pointer;
        font: inherit;
        letter-spacing: inherit;
        padding: .12rem .34rem;
        border-radius: 999px;
        flex: none;
      }
      /* One hairline between what the zone says and what you can do about it. */
      .marble-zone-label button:first-of-type {
        margin-left: .18rem;
        border-left: 1px solid color-mix(in srgb, var(--zone-mark) 26%, transparent);
        border-radius: 0 999px 999px 0;
        padding-left: .44rem;
      }
      .marble-zone-label button:hover {
        color: var(--zone-mark);
        background: color-mix(in srgb, var(--zone-mark) 16%, transparent);
      }
      .marble-zone-label button:active { opacity: .7; }
      .marble-zone-label button:focus-visible {
        outline: 2px solid var(--zone-mark);
        outline-offset: 2px;
      }
      /* The last resort. The work toggle lives in the agent tray above the
         launcher now; this corner button survives only for a page that mounts
         no drawer for the tray to be part of — Agents.mrbl, which carries its
         own conversation chrome. There, nothing is on the page to belong to,
         so it stays what it always was: quiet text in the corner, kept
         legible by a halo of paper. */
      .marble-zones-show {
        appearance: none;
        border: 0;
        background: none;
        padding: .35rem .15rem;
        cursor: pointer;
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483001;
        pointer-events: auto;
        color: color-mix(in srgb, var(--ink, #111) 72%, var(--paper, #fff));
        font: 500 12px/1.2 var(--ui-font, system-ui, sans-serif);
        letter-spacing: -.012em;
        text-shadow:
          0 0 10px var(--paper, #fff),
          0 0 10px var(--paper, #fff);
        animation: marble-fade-in 220ms ${EASE} both;
      }
      .marble-zones-show:hover {
        color: color-mix(in srgb, var(--ink, #111) 92%, var(--paper, #fff));
      }
      .marble-zones-show:active { opacity: .7; }
      .marble-zones-show:focus-visible {
        outline: 2px solid var(--zone-mark, #6d55d4);
        outline-offset: 3px;
      }

      /* --------------------------------------------------------- the tether

         Following is a mode the person turned on, so its mark is theirs and
         not the document's: fixed to the top edge, in the same place whatever
         the page does underneath, saying who is being followed, what they are
         doing, and how to stop. Everything else the drive draws hangs on the
         work; this one hangs on you. */
      /* Centred on the page, not on the window. A pinned panel takes its width
         out of <html> with margin-inline-end, and a fixed box centred on the
         viewport lands half under it — which is why the work toggle left this
         corner once already. The px is set from the document's own width. */
      .marble-follow {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        transition: left 180ms ${EASE};
        z-index: 2147483002;
        display: flex;
        align-items: center;
        gap: .45rem;
        max-width: min(34rem, calc(100vw - 2rem));
        padding: .3rem .5rem .3rem .62rem;
        border: 1px solid color-mix(in srgb, var(--zone-mark) 34%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--zone-mark) 12%, var(--paper, #fff));
        color: color-mix(in srgb, var(--zone-mark) 62%, var(--ink, #111));
        box-shadow: 0 2px 10px color-mix(in srgb, var(--ink, #111) 14%, transparent);
        font: 500 12px/1.2 var(--ui-font, system-ui, sans-serif);
        letter-spacing: -.012em;
        white-space: nowrap;
        user-select: none;
        --zone-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #111)));
        animation: marble-fade-in 220ms ${EASE} both;
      }
      .marble-follow-what {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .marble-follow button {
        appearance: none;
        border: 0;
        background: none;
        color: color-mix(in srgb, var(--zone-mark) 52%, var(--ink, #111));
        cursor: pointer;
        font: inherit;
        letter-spacing: inherit;
        padding: .12rem .4rem;
        border-radius: 999px;
        flex: none;
      }
      .marble-follow button {
        margin-left: .18rem;
        border-left: 1px solid color-mix(in srgb, var(--zone-mark) 26%, transparent);
        border-radius: 0 999px 999px 0;
        padding-left: .46rem;
      }
      .marble-follow button[hidden] { display: none; }
      .marble-follow button:hover {
        color: var(--zone-mark);
        background: color-mix(in srgb, var(--zone-mark) 16%, transparent);
      }
      .marble-follow button:active { opacity: .7; }
      .marble-follow button:focus-visible {
        outline: 2px solid var(--zone-mark);
        outline-offset: 2px;
      }
      /* Paused: you took the wheel. The tether is still tied — it just stopped
         pulling — so the dot stops breathing rather than going out. */
      .marble-follow[data-state="paused"] .marble-zone-live { animation: none; opacity: .45; }
      .marble-follow[data-state="waiting"] .marble-zone-live { animation-duration: 4.4s; }

      /* ------------------------------------------------------- the act mark

         A press is not a region, so it is not a zone: no wash, no padding, no
         box around the neighbourhood. One ring, in the control's own shape, on
         the control's own outline — drawn in the agent's violet, because the
         press is the only part of this the agent did. Whatever changes next
         keeps the flash in the document's own accent, because the app changed
         it, by its own code.

         Design: docs/superpowers/specs/2026-09-22-watching-an-agent-use-your-app-design.md */
      .marble-act-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483000;
        --zone-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #111)));
      }
      .marble-act {
        position: fixed;
        pointer-events: none;
        transition:
          top 180ms ${EASE},
          left 180ms ${EASE},
          width 180ms ${EASE},
          height 180ms ${EASE};
      }
      /* The ring and the label are siblings so the ring can let go while the
         label is still saying what happened. */
      .marble-act-ring {
        position: absolute;
        inset: 0;
        box-sizing: border-box;
        border: 1.5px solid var(--zone-mark);
        border-radius: inherit;
        transform-origin: 50% 50%;
        /* Arrival without a journey. A cursor gliding in from off-screen would
           draw a pointer this agent does not have. */
        animation: marble-act-in 140ms ${EASE} both;
      }
      /* The zone's pill is sized against the zone, which is a region. A control
         is not: 100% of a Sort button is four characters wide, which clipped
         the sentence down to its ellipsis. The act's label is sized against
         the viewport it has to be read in. */
      .marble-act > .marble-zone-label {
        max-width: min(30rem, calc(100vw - 2rem));
      }
      /* A control acts on what is under it — a toolbar sits above its table —
         so the act's label goes above the control, clear of the rows it just
         changed. Under it only when there is no room up there. */
      .marble-act-above > .marble-zone-label {
        top: auto;
        bottom: 100%;
        margin-top: 0;
        margin-bottom: 6px;
      }
      .marble-act-live { animation: marble-act-breathe 1.6s ease-in-out infinite; }
      /* Arrived, not pressed: the person's hands are on this control, so the
         act is waiting for them. Still, and a shade back. */
      .marble-act-wait { opacity: .72; }
      .marble-act-out { animation: marble-act-out 180ms ${EASE} both; }
      @keyframes marble-act-in {
        from { transform: scale(1.14); opacity: 0; }
        to { transform: none; opacity: 1; }
      }
      @keyframes marble-act-breathe {
        0%, 100% { opacity: .55; }
        50% { opacity: 1; }
      }
      @keyframes marble-act-out {
        from { transform: none; opacity: 1; }
        to { transform: scale(1.06); opacity: 0; }
      }
      /* The control is held down for as long as the act is in flight. Transform
         and filter only: a press may not move the page around it. */
      html.marble-collab-host [data-marble-acting] {
        transform: translateY(1px);
        filter: brightness(.96);
        transition: transform 120ms ${EASE}, filter 120ms ${EASE};
      }

      @media (prefers-reduced-motion: reduce) {
        .marble-act-ring,
        .marble-act-live,
        .marble-act-out,
        .marble-flash,
        .marble-fork,
        .marble-fork.marble-fork-out,
        .marble-zone,
        .marble-zone-live,
        .marble-zones-show,
        .marble-follow { animation: none; }
        .marble-zone-live { opacity: .7; }
        .marble-act-ring { opacity: 1; }
        .marble-act-out { opacity: 0; }
        html.marble-collab-host [data-marble-acting] { transform: none; transition: none; }
        .marble-presence,
        .marble-presence-out,
        .marble-zone,
        html.marble-collab-host marble-alt.marble-forked > [data-marble-alt],
        .marble-fork-seg button,
        .marble-fork-acts button { transition: none; }
      }
      @media (prefers-reduced-transparency: reduce) {
        .marble-fork-seg { background: var(--paper-2, #f3f1ea); }
        .marble-follow { background: var(--paper, #fff); }
        /* The ring is a line, and lines are what survive both reductions. */
        .marble-presence { background-color: color-mix(in srgb, var(--accent, #9bb6cf) 28%, transparent); }
        /* The wash goes; the box stays. Where the agent is must still be said. */
        .marble-zone { background-color: transparent; }
        .marble-zones-show { text-shadow: none; }
      }
    `;
    document.head.append(style);

    const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const byId = (id) => marble.byId(id);
    const persistentChildren = (el) => [...el.children].filter((c) => !c.hasAttribute(TRANSIENT));
    const nextPersistent = (el) => {
      let sibling = el.nextElementSibling;
      while (sibling && sibling.hasAttribute(TRANSIENT)) sibling = sibling.nextElementSibling;
      return sibling;
    };
    const altsIn = (root) => [
      ...(root.matches?.('marble-alt') ? [root] : []),
      ...root.querySelectorAll?.('marble-alt') ?? [],
    ];

    const isConflict = (alt) => persistentChildren(alt).some((el) => {
      const by = el.getAttribute(BY) ?? '';
      return by === 'person' || by.startsWith('agent');
    });

    const labelOf = (version) => {
      const by = version.getAttribute(BY) ?? '';
      if (by === 'person') return 'You';
      const name = version.getAttribute(ALT) ?? '';
      if (name === 'you') return 'You';
      if (by.startsWith('agent') || name.startsWith('agent') || name === 'claude') return 'Agent';
      return name || 'Version';
    };

    function deriveAlts(root = document) {
      for (const alt of altsIn(root)) {
        const versions = persistentChildren(alt);
        const active = alt.getAttribute(ACTIVE);
        const current = versions.find((el) => el.getAttribute(ALT) === active) ?? versions[0];
        const conflict = alt.classList.contains('marble-forked');
        for (const version of versions) {
          const shown = version === current;
          version.classList.toggle('marble-alt-shown', shown);
          if (!conflict) continue;
          version.toggleAttribute('inert', !shown);
          version.setAttribute('aria-hidden', String(!shown));
        }
      }
    }

    const flashes = new WeakMap();
    function flash(id) {
      const el = byId(id);
      if (!el) return;
      el.classList.remove('marble-flash');
      void el.offsetWidth;
      el.classList.add('marble-flash');
      clearTimeout(flashes.get(el));
      flashes.set(el, setTimeout(() => el.classList.remove('marble-flash'), 480));
    }

    const isAgent = (client) => String(client ?? '').startsWith('agent');
    const hideKey = () => `marble-zones-off:${marble.app ?? location.pathname}`;
    const zonesHidden = () => {
      try { return sessionStorage.getItem(hideKey()) === '1'; } catch { return false; }
    };
    const setZonesHidden = (off) => {
      try { sessionStorage.setItem(hideKey(), off ? '1' : '0'); } catch { /* private mode */ }
      paintZones();
    };

    const skipTape = new Set(['HTML', 'BODY', 'HEAD', 'STYLE', 'SCRIPT', 'LINK', 'META', 'TITLE']);
    function tapeTarget(els) {
      const visible = els.filter((el) => {
        if (skipTape.has(el.tagName)) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      });
      if (!visible.length) return null;
      let node = visible[0];
      for (let i = 1; i < visible.length; i++) {
        while (node && !node.contains(visible[i])) node = node.parentElement;
      }
      if (!node || node === document.documentElement || node === document.body) return null;
      return node;
    }

    // The note is written as a sentence ("Rename the heading."); after
    // "Agent ·" it reads as a clause, so it loses its capital and its period —
    // unless the first word is all capitals, which is a name, not a sentence.
    function asClause(note) {
      const text = note.replace(/\.\s*$/, '');
      const first = text.match(/^\S+/)?.[0] ?? '';
      if (first && first === first.toUpperCase() && /[A-Z]/.test(first)) return text;
      return text.charAt(0).toLowerCase() + text.slice(1);
    }

    // The gesture vocabulary is closed — press, type, set, move, size, remove,
    // pick — so the past tense is a lookup and not a conjugation. The host
    // sends the landed sentence itself; this is what the page can still say
    // when a frame arrives without one.
    const PAST = new Map([
      ['pressing', 'Pressed'], ['typing', 'Typed'], ['setting', 'Set'], ['moving', 'Moved'],
      ['sizing', 'Resized'], ['removing', 'Removed'], ['picking', 'Picked'],
    ]);
    function pastNote(note) {
      const words = String(note ?? '').trim().split(/\s+/);
      const past = PAST.get(words[0]?.toLowerCase());
      return past ? [past, ...words.slice(1)].join(' ') : note;
    }
    /** A deferred act has not been done, so its label names the control and
     *  not the gesture: "waiting for you · Unread", never "pressing Unread". */
    function bareNote(note) {
      const words = String(note ?? '').trim().split(/\s+/);
      return PAST.has(words[0]?.toLowerCase()) ? words.slice(1).join(' ') : String(note ?? '').trim();
    }

    function phaseLabel(detail) {
      const note = String(detail.note ?? '').trim();
      // A press is one control at one instant, and the sentence for it is the
      // host's: written from the id, the gesture and the control's own words,
      // never from the agent's account of what it meant to do.
      if (detail.phase === 'acting') {
        if (detail.deferred) {
          const what = bareNote(note);
          return what ? `Agent · waiting for you · ${what}` : 'Agent · waiting for you';
        }
        return note ? `Agent · ${asClause(note)}` : 'Agent · pressing';
      }
      if (note) return `Agent · ${asClause(note)}`;
      if (detail.phase === 'reading') return 'Agent · reading';
      if (detail.phase === 'writing') return 'Agent · writing';
      return 'Agent · working';
    }

    // The callout layer hangs its card where the zone hangs its label, and
    // says the same thing in its head; both need the same answer to "where is
    // this set of ids" and "what is it doing". Frozen: a helper, not a surface
    // to extend.
    if (window.marble && !window.marble.collab) {
      window.marble.collab = Object.freeze({ tapeTarget, phaseLabel });
    }

    // A zone is drawn by a client named `agent:<conversation>`; an undo writes
    // as `agent-undo:<conversation>` and draws none, so only the first form is
    // ever a chat you could be taken to.
    const conversationOf = (client) => {
      const name = String(client ?? '');
      return name.startsWith('agent:') ? name.slice('agent:'.length) || null : null;
    };

    // Where a conversation is read depends on where you are standing. A page
    // that hosts its own conversation UI says so with this meta — it is the
    // same flag that keeps the dock from mounting there — and already listens
    // for `marble-agent:open` to put a chat on its stage. Everywhere else, the
    // dock on the right is the place a conversation opens.
    const hostsConversations = () =>
      Boolean(document.querySelector('meta[name="marble-agent"][content="custom"]'));

    function openConversation(id) {
      if (!id) return;
      if (hostsConversations()) {
        document.dispatchEvent(new CustomEvent('marble-agent:open', { bubbles: true, composed: true, detail: { id } }));
        return;
      }
      marble.agent?.open?.(id);
    }

    // The other direction: a conversation pointing back at its zone. A document
    // that builds its own body from script has none of these ids at first
    // paint, so this keeps looking for a beat before giving up.
    function jumpTo(ids) {
      let tries = 0;
      const land = () => {
        const targets = ids.map(byId).filter(Boolean);
        if (!targets.length) {
          if (tries++ < 20) setTimeout(land, 150);
          return;
        }
        (tapeTarget(targets) ?? targets[0]).scrollIntoView({
          block: 'center',
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
        for (const el of targets) flash(marble.id(el));
      };
      land();
    }

    // The conversation was reading another document, so getting here was a
    // navigation, and the ids rode in the hash. A tether rides the same way:
    // following an agent across documents is a navigation like any other, and
    // what has to survive it is which conversation you are following.
    const hashValue = (key) => new RegExp(`(?:^|[#&])${key}=([^&]*)`).exec(location.hash)?.[1] ?? null;
    let followFromHash = null;
    let takeFollowHash = null;
    function jumpToHash() {
      const at = hashValue('at');
      const followed = hashValue('follow');
      if (!at && !followed) return;
      // The hash is an instruction, not an address: it is spent on arrival.
      history.replaceState(null, '', location.pathname + location.search);
      if (followed) {
        const id = decodeURIComponent(followed);
        if (takeFollowHash) takeFollowHash(id);
        else followFromHash = id;
      }
      if (at) jumpTo(at.split(',').map(decodeURIComponent).filter(Boolean));
    }
    jumpToHash();
    addEventListener('hashchange', jumpToHash);
    // Already on the document: the conversation asks for the scroll directly,
    // rather than leaving a hash in the history to get back past.
    addEventListener('marble:jump-to', ({ detail }) => {
      const ids = (detail?.ids ?? []).map(String).filter(Boolean);
      if (ids.length) jumpTo(ids);
    });

    const zoneLayer = document.createElement('div');
    zoneLayer.className = 'marble-zone-layer';
    zoneLayer.setAttribute(TRANSIENT, '');
    zoneLayer.setAttribute('aria-live', 'polite');
    document.documentElement.append(zoneLayer);

    const showWork = document.createElement('button');
    showWork.type = 'button';
    showWork.className = 'marble-zones-show';
    showWork.setAttribute(TRANSIENT, '');
    showWork.textContent = 'Show work';
    showWork.hidden = true;
    showWork.addEventListener('click', () => setZonesHidden(false));
    document.documentElement.append(showWork);

    // Where the work toggle goes. It used to be quiet text pinned to the
    // viewport's top-right corner, which is a corner the document already owns
    // — and once the agent panel is pinned, a corner the panel is sitting in,
    // where it landed across the panel's own bar. So it moves to the tray
    // above the launcher, with the rest of the agent's affordances, and is
    // only there at all while there is a zone on this page to toggle.
    //
    // The tray belongs to the drawer, so a page that mounts no drawer has
    // none. Registering is cancelable: preventing it is the tray saying it
    // took the tool. Unanswered, the corner button stays, which is the old
    // behaviour and the only thing such a page can do.
    const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';
    const EYE_OFF = `${EYE.slice(0, -6)}<path d="M4 20 20 4"/></svg>`;
    let trayHasWork = false;

    function askTray() {
      if (trayHasWork) return true;
      const asked = new CustomEvent('marble-tray:register', {
        cancelable: true,
        detail: {
          id: 'work',
          order: 10,
          hidden: true,
          label: 'Show work',
          icon: EYE,
          onSelect: () => setZonesHidden(!zonesHidden()),
        },
      });
      trayHasWork = !dispatchEvent(asked);
      return trayHasWork;
    }

    // A drawer that mounts after this script ran was told there was no tray.
    addEventListener('marble-tray:ready', () => {
      trayHasWork = false;
      if (askTray()) paintZones();
    });

    /** `state` is what the toggle would do next: nothing, show, or hide. */
    function offerWork(state) {
      if (askTray()) {
        showWork.hidden = true;
        dispatchEvent(new CustomEvent('marble-tray:update', {
          detail: {
            id: 'work',
            hidden: state === 'none',
            label: state === 'hide' ? 'Hide work' : 'Show work',
            icon: state === 'hide' ? EYE_OFF : EYE,
          },
        }));
        return;
      }
      showWork.hidden = state !== 'show';
    }

    let placed = [];
    function place(frame, el) {
      const r = el.getBoundingClientRect();
      const pad = 10;
      Object.assign(frame.style, {
        top: `${r.top - pad}px`,
        left: `${r.left - pad}px`,
        width: `${Math.max(24, r.width + pad * 2)}px`,
        height: `${Math.max(24, r.height + pad * 2)}px`,
      });
      frame.classList.toggle('marble-zone-tight', r.bottom > innerHeight - 40);
    }

    // A zone points: it says the work is *here*. Work with nothing to point at —
    // no ids, ids that are not on this page, or a spread so wide the only
    // element containing it is the body — used to become a banner floating over
    // the top of the page, which is not a zone but an ambient status line, and
    // one the app's own chrome (the agent rows, the dock) already carries. No
    // target, no zone.
    function zonesToPaint() {
      const zones = [];
      for (const detail of presence.values()) {
        if (!isAgent(detail.client)) continue;
        // A client mid-press has a ring, and the ring carries the label. A box
        // around the button as well would say the agent is rewriting it.
        if (acts.has(detail.client)) continue;
        const target = tapeTarget((detail.ids ?? []).map((id) => byId(id)).filter(Boolean));
        if (target) zones.push({ detail, target });
      }
      return zones;
    }

    // A callout card docked to a zone *is* that zone's label; the pill beside
    // it would say the same thing twice. The layer says so with docked and
    // undocked, and takes it back when it folds.
    const docked = new Set();
    document.addEventListener('marble-callout:docked', (event) => {
      if (event.detail?.id) { docked.add(event.detail.id); paintZones(); }
    });
    document.addEventListener('marble-callout:undocked', (event) => {
      if (event.detail?.id) { docked.delete(event.detail.id); paintZones(); }
    });

    function paintZones() {
      placed = [];
      sizes?.disconnect();
      zoneLayer.replaceChildren();
      const zones = zonesToPaint();
      const hidden = zonesHidden();
      document.documentElement.classList.toggle('marble-zones-off', hidden);
      if (!zones.length) {
        offerWork('none');
        return;
      }
      if (hidden) {
        offerWork('show');
        return;
      }
      offerWork('hide');
      for (const { detail, target } of zones) {
        const frame = document.createElement('div');
        frame.className = 'marble-zone';
        frame.setAttribute(TRANSIENT, '');
        const label = document.createElement('div');
        label.className = 'marble-zone-label';
        const dot = document.createElement('span');
        dot.className = 'marble-zone-live';
        dot.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = phaseLabel(detail);
        label.append(dot, text);
        // Saying work is happening and giving you nowhere to go with that is
        // half a signal. The zone knows which conversation drew it, so it can
        // hand you the chat.
        const conversation = conversationOf(detail.client);
        const openHere = () => {
          // A callout on this page for the same chat gets first refusal:
          // the pill under the zone opens that tooltip, not the drawer.
          if (!conversation) return;
          const offer = new CustomEvent('marble-callout:open', { cancelable: true, detail: { id: conversation } });
          if (!document.dispatchEvent(offer)) return;
          openConversation(conversation);
        };
        if (conversation) {
          const open = document.createElement('button');
          open.type = 'button';
          open.textContent = 'Open chat';
          open.setAttribute('aria-label', 'Open the conversation working here');
          open.addEventListener('click', (event) => {
            event.stopPropagation();
            openHere();
          });
          label.append(open);
          label.addEventListener('click', openHere);
        }
        const hide = document.createElement('button');
        hide.type = 'button';
        hide.textContent = 'Hide';
        hide.setAttribute('aria-label', 'Hide construction zone');
        hide.addEventListener('click', (event) => {
          event.stopPropagation();
          setZonesHidden(true);
        });
        label.append(hide);
        if (conversation && docked.has(conversation)) label.hidden = true;
        frame.append(label);
        zoneLayer.append(frame);
        place(frame, target);
        placed.push({ frame, target });
        sizes?.observe(target);
      }
    }

    const presence = new Map();
    const presenceOut = new WeakMap();
    function paintPresence() {
      const wanted = new Set();
      for (const detail of presence.values()) {
        if (isAgent(detail.client)) continue;
        for (const id of detail.ids ?? []) if (id) wanted.add(id);
      }

      for (const el of document.querySelectorAll('.marble-presence, .marble-presence-out')) {
        const id = marble.id(el);
        if (wanted.has(id)) continue;
        el.classList.remove('marble-presence');
        el.classList.add('marble-presence-out');
        clearTimeout(presenceOut.get(el));
        presenceOut.set(el, setTimeout(() => el.classList.remove('marble-presence-out'), 240));
      }

      for (const id of wanted) {
        const el = byId(id);
        if (!el) continue;
        clearTimeout(presenceOut.get(el));
        el.classList.remove('marble-presence-out');
        el.classList.add('marble-presence');
      }
    }


    // ------------------------------------------------------------ acting
    //
    // The third thing an agent can be doing here. Reading is a claim on ids,
    // writing is a claim on a region — both are states, and a zone says a
    // state well. A press is an event: one control, one instant, and a
    // consequence its own app files. Told as a zone it reads as "the agent is
    // rewriting this button", which is the one thing it is not.
    //
    // So the press gets its own mark, and the design holds three lines:
    //   cause at the control, in the agent's colour;
    //   effect where it lands, in the document's own;
    //   cause first, even when the ops arrive ahead of the news of the press.
    //
    // Design: docs/superpowers/specs/2026-09-22-watching-an-agent-use-your-app-design.md

    const ACT_CONTACT = 140;      // the ring converging on the control
    const ACT_DWELL = 360;        // the floor under how briefly a press can be seen
    const ACT_SAID = 2400;        // how long the label holds what happened
    const ACT_SAID_EMPTY = 3600;  // ... longer when the answer was "nothing"
    const ACT_LOST = 15000;       // an act whose closing frame never came

    const acts = new Map();
    let placedActs = [];

    const actLayer = document.createElement('div');
    actLayer.className = 'marble-act-layer';
    actLayer.setAttribute(TRANSIENT, '');
    actLayer.setAttribute('aria-live', 'polite');
    document.documentElement.append(actLayer);

    /** The ring is the control's own shape — a pill around a pill, a circle
     *  around a checkbox — grown by the gap it stands off at. */
    function ringRadius(el, pad) {
      const radius = getComputedStyle(el).borderRadius || '0px';
      if (radius.includes('%')) return radius;
      return radius.replace(/([\d.]+)px/g, (_, n) => `${Number(n) + pad}px`);
    }

    function placeAct(act) {
      const r = act.target.getBoundingClientRect();
      const pad = 3;
      Object.assign(act.frame.style, {
        top: `${r.top - pad}px`,
        left: `${r.left - pad}px`,
        width: `${Math.max(12, r.width + pad * 2)}px`,
        height: `${Math.max(12, r.height + pad * 2)}px`,
        borderRadius: ringRadius(act.target, pad),
      });
      act.frame.classList.toggle('marble-act-above', r.top > 40);
    }

    function actText(act) {
      return phaseLabel({ phase: 'acting', note: act.note, deferred: act.deferred });
    }

    function landedText(act, changed) {
      const note = pastNote(act.landed ?? act.note);
      const said = changed
        ? `${changed} change${changed === 1 ? '' : 's'}`
        // An act that ran and changed nothing is a finding about the app, not
        // a failure of the press. Silence would read as the feedback breaking.
        : 'nothing changed';
      return `${note ? `Agent · ${asClause(note)}` : 'Agent · pressed'} · ${said}`;
    }

    function beginAct(detail) {
      const ids = (detail.ids ?? []).filter(Boolean);
      const act = {
        client: detail.client,
        ids,
        note: detail.note ?? '',
        deferred: Boolean(detail.deferred),
        target: tapeTarget(ids.map(byId).filter(Boolean)),
        startedAt: performance.now(),
        held: [],
        changed: 0,
        ending: false,
        frame: null,
        ring: null,
        text: null,
        dot: null,
      };
      act.lost = setTimeout(() => endAct(act.client, {}), ACT_LOST);
      acts.set(detail.client, act);
      // Nothing on this page to point at: the press is the conversation's to
      // report. The page does not narrate what it cannot show.
      if (!act.target) return act;

      const frame = document.createElement('div');
      frame.className = 'marble-act';
      frame.setAttribute(TRANSIENT, '');
      const ring = document.createElement('div');
      ring.className = act.deferred ? 'marble-act-ring marble-act-wait' : 'marble-act-ring';
      const label = document.createElement('div');
      label.className = 'marble-zone-label';
      const dot = document.createElement('span');
      dot.className = 'marble-zone-live';
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = actText(act);
      label.append(dot, text);
      const conversation = conversationOf(detail.client);
      if (conversation) {
        const open = document.createElement('button');
        open.type = 'button';
        open.textContent = 'Open chat';
        open.setAttribute('aria-label', 'Open the conversation working here');
        open.addEventListener('click', (event) => {
          event.stopPropagation();
          const offer = new CustomEvent('marble-callout:open', { cancelable: true, detail: { id: conversation } });
          if (document.dispatchEvent(offer)) openConversation(conversation);
        });
        label.append(open);
      }
      frame.append(ring, label);
      Object.assign(act, { frame, ring, text, dot });
      actLayer.append(frame);
      placeAct(act);
      placedActs.push(act);
      sizes?.observe(act.target);
      // Held down for as long as it is held down. A deferred act has arrived
      // and pressed nothing, so the control stays up.
      if (!act.deferred) {
        act.target.setAttribute('data-marble-acting', '');
        setTimeout(() => {
          if (acts.get(act.client) === act && !act.ending) ring.classList.add('marble-act-live');
        }, ACT_CONTACT);
      }
      return act;
    }

    function updateAct(act, detail) {
      const ids = (detail.ids ?? []).filter(Boolean);
      // A second control in the same turn is a second act, not a moved ring.
      if (ids.join('\u0000') !== act.ids.join('\u0000')) {
        endAct(act.client, detail);
        beginAct(detail);
        return;
      }
      act.note = detail.note ?? act.note;
      act.deferred = Boolean(detail.deferred);
      if (act.ring) act.ring.classList.toggle('marble-act-wait', act.deferred);
      if (act.target) act.target.toggleAttribute('data-marble-acting', !act.deferred);
      if (act.text) act.text.textContent = actText(act);
    }

    function endAct(client, detail = {}) {
      const act = acts.get(client);
      if (!act || act.ending) return;
      act.ending = true;
      clearTimeout(act.lost);
      // A frame that claims other ids is the agent getting on with something
      // else, not a report on the act. Its note belongs to that work, and its
      // zone is more use than the tail of this label — so the tail is cut and
      // the sentence is conjugated from what this act already said.
      const elsewhere = (detail.ids ?? []).filter(Boolean).length > 0;
      act.superseded = elsewhere;
      if (detail.note && !elsewhere) act.landed = detail.note;
      if (Number.isFinite(detail.changed)) act.changed = detail.changed;
      // A press too quick to see is, for the person, a press that never
      // happened. The host can resolve an act in under a frame; the floor is
      // the page's, not the act's.
      const wait = Math.max(0, ACT_DWELL - (performance.now() - act.startedAt));
      setTimeout(() => releaseAct(act), wait);
    }

    function releaseAct(act) {
      act.target?.removeAttribute('data-marble-acting');
      const changed = act.changed || new Set(act.held).size;
      if (act.ring) {
        act.ring.classList.remove('marble-act-live');
        act.ring.classList.add('marble-act-out');
      }
      // An act that was still waiting for the person when it ended was never
      // done, and has nothing to report. It just goes.
      if (act.text && !act.deferred) act.text.textContent = landedText(act, changed);
      if (act.dot) {
        act.dot.style.animation = 'none';
        act.dot.style.opacity = '.45';
      }
      flushHeld(act);
      const tail = act.deferred ? 0 : act.superseded ? 400 : changed ? ACT_SAID : ACT_SAID_EMPTY;
      setTimeout(() => {
        act.frame?.remove();
        placedActs = placedActs.filter((other) => other !== act);
        if (act.target) sizes?.unobserve(act.target);
        // A second act may have taken this client's slot while this one was
        // letting go; it owns the entry now.
        if (acts.get(act.client) === act) acts.delete(act.client);
        paintZones();
      }, act.frame ? tail : 0);
    }

    /** The effect, in document order, once the ring has let go. A stagger so a
     *  wide effect reads as a sweep rather than a jump cut. */
    function flushHeld(act) {
      const ids = [...new Set(act.held)];
      act.held = [];
      const els = ids.map(byId).filter(Boolean);
      els.sort((a, b) =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
      els.forEach((el, i) => {
        const id = marble.id(el);
        if (i < 8 && !reducedMotion()) setTimeout(() => flash(id), i * 40);
        else flash(id);
      });
    }


    // ------------------------------------------------------------ following
    //
    // Zones and act marks answer "what is happening here". A tether answers
    // the other half — "where are they now" — by tying your view to one
    // conversation: it scrolls to what the agent is on, and when the agent's
    // work moves to another document, it takes you there.
    //
    // The signal already exists and needs no route. Every look an agent takes
    // is published to its own conversation as a `zone` frame carrying the
    // document's path, the ids and the phase (server/agent/index.js, which
    // calls it a look going two ways), and any page can hear it through the
    // carrier: `marble.agent.on(id, …)`. A tether is a subscription.
    //
    // Three rules hold it, and they are all the same rule from different
    // sides — following is the person's mode, not the agent's:
    //   your scroll wins. A hand on the wheel pauses the tether instead of
    //     fighting it, and the pill offers the way back.
    //   it moves lazily. Only when the work has left a comfortable band, and
    //     at most once a beat — an agent touches ids faster than anyone reads.
    //   it never takes you out of a document you are working in. A move it
    //     cannot make becomes an offer.

    const FOLLOW_KEY = 'marble-follow';
    const FOLLOW_SETTLE = 700;          // one move a beat, and the beat keeps the latest
    const FOLLOW_TOP = 0.12;            // the band the work is left alone in
    const FOLLOW_BOTTOM = 0.74;

    let follow = null;
    let followPill = null;

    const followStore = {
      get() { try { return sessionStorage.getItem(FOLLOW_KEY); } catch { return null; } },
      set(id) {
        try {
          if (id) sessionStorage.setItem(FOLLOW_KEY, id);
          else sessionStorage.removeItem(FOLLOW_KEY);
        } catch { /* private mode: the tether lasts this page and no longer */ }
      },
    };

    /** Somewhere a person is mid-sentence: their own writing, or anything in
     *  the drive's chrome, which is where the composer lives. */
    const busyHere = () => {
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return true;
      if (el?.closest?.(`[${TRANSIENT}]`)) return true;
      const selection = getSelection?.();
      return Boolean(selection && !selection.isCollapsed && selection.rangeCount);
    };

    function startFollow(id) {
      if (!id || follow?.id === id) return;
      const on = window.marble?.agent?.on;
      if (typeof on !== 'function') return;
      stopFollow({ quiet: true });
      follow = { id, title: 'the agent', zone: null, paused: false, pending: null, target: null, timer: 0, lastMove: 0 };
      followStore.set(id);
      follow.off = on(id, (event) => {
        if (follow?.id === id && event?.type === 'zone') onZone(event);
      });
      // A name, when the host has one. Until then the pill says "the agent",
      // which is true and says the same thing.
      window.marble.agent.conversation?.(id)
        .then((meta) => {
          if (follow?.id === id && meta?.title) {
            follow.title = meta.title;
            paintFollow();
          }
        })
        .catch(() => {});
      paintFollow();
    }

    function stopFollow({ quiet = false } = {}) {
      if (!follow) return;
      follow.off?.();
      clearTimeout(follow.timer);
      follow = null;
      followStore.set(null);
      if (!quiet) paintFollow();
    }

    function onZone(frame) {
      if (!follow) return;
      follow.zone = frame;
      const ids = (frame.ids ?? []).filter(Boolean);
      if (frame.path && frame.path !== marble.app) {
        // Another document. Going is what following means — but not out from
        // under someone's hands, and not while they have taken the wheel.
        follow.pending = { path: frame.path, ids };
        if (!follow.paused && !busyHere()) return leaveFor(follow.pending);
      } else {
        // A frame naming this document is the agent back here, so an offer to
        // go somewhere else is spent — including the frame with no ids that
        // ends a turn, which otherwise left "moved to atlas" standing over a
        // tether that had nowhere to go.
        follow.pending = null;
        if (ids.length) aimAt(ids);
      }
      paintFollow();
    }

    function leaveFor(where) {
      const at = (where.ids ?? []).map(encodeURIComponent).join(',');
      const tether = `follow=${encodeURIComponent(follow.id)}`;
      location.href = `/a/${encodeURIComponent(where.path)}#${tether}${at ? `&at=${at}` : ''}`;
    }

    /** Lazy: the work is left where it is unless it has left the band, and a
     *  burst of looks costs one scroll, not one each. */
    function aimAt(ids) {
      const target = tapeTarget(ids.map(byId).filter(Boolean)) ?? byId(ids[0]);
      if (!target) return;
      follow.target = target;
      if (follow.paused || follow.timer) return;
      const since = performance.now() - follow.lastMove;
      follow.timer = setTimeout(moveToTarget, Math.max(0, FOLLOW_SETTLE - since));
    }

    function moveToTarget() {
      if (!follow) return;
      follow.timer = 0;
      const el = follow.target;
      if (!el?.isConnected || follow.paused) return;
      follow.lastMove = performance.now();
      const r = el.getBoundingClientRect();
      if (r.top > innerHeight * FOLLOW_TOP && r.bottom < innerHeight * FOLLOW_BOTTOM) return;
      el.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: reducedMotion() ? 'auto' : 'smooth',
      });
    }

    // A wheel or a finger is a person; our own scrolling is neither, and
    // neither fires these.
    const tookTheWheel = () => {
      if (!follow || follow.paused) return;
      follow.paused = true;
      paintFollow();
    };
    addEventListener('wheel', tookTheWheel, { passive: true });
    addEventListener('touchmove', tookTheWheel, { passive: true });

    function resumeFollow() {
      if (!follow) return;
      follow.paused = false;
      if (follow.pending) {
        leaveFor(follow.pending);
        return;
      }
      clearTimeout(follow.timer);
      follow.timer = 0;
      moveToTarget();
      paintFollow();
    }

    function followState() {
      if (follow.pending) return 'moved';
      if (follow.paused) return 'paused';
      return (follow.zone?.ids ?? []).length ? 'live' : 'waiting';
    }

    function followText() {
      const who = follow.title;
      const state = followState();
      if (state === 'moved') return `Following ${who} · moved to ${follow.pending.path}`;
      if (state === 'paused') return `Following ${who} · paused`;
      if (state === 'waiting') return `Following ${who} · waiting`;
      const note = String(follow.zone?.note ?? '').trim();
      if (note) return `Following ${who} · ${asClause(note)}`;
      const phase = follow.zone?.phase;
      if (phase === 'acting') return `Following ${who} · pressing`;
      return `Following ${who} · ${phase ?? 'working'}`;
    }

    /** Over the page the person is reading, whatever the dock has taken. */
    function fitFollow() {
      if (!followPill) return;
      followPill.style.left = `${Math.round(document.documentElement.getBoundingClientRect().width / 2)}px`;
    }
    const followFit = typeof ResizeObserver === 'function' ? new ResizeObserver(fitFollow) : null;

    function paintFollow() {
      if (!follow) {
        followPill?.remove();
        followPill = null;
        followFit?.disconnect();
        return;
      }
      if (!followPill) {
        const pill = document.createElement('div');
        pill.className = 'marble-follow';
        pill.setAttribute(TRANSIENT, '');
        pill.setAttribute('role', 'status');
        pill.setAttribute('aria-live', 'polite');
        const dot = document.createElement('span');
        dot.className = 'marble-zone-live';
        dot.setAttribute('aria-hidden', 'true');
        const what = document.createElement('span');
        what.className = 'marble-follow-what';
        const again = document.createElement('button');
        again.type = 'button';
        again.addEventListener('click', resumeFollow);
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.textContent = 'Stop';
        stop.setAttribute('aria-label', 'Stop following this agent');
        stop.addEventListener('click', () => stopFollow());
        pill.append(dot, what, again, stop);
        document.documentElement.append(pill);
        followPill = Object.assign(pill, { what, again });
        fitFollow();
        followFit?.observe(document.documentElement);
      }
      const state = followState();
      followPill.dataset.state = state;
      followPill.what.textContent = followText();
      followPill.again.hidden = state !== 'moved' && state !== 'paused';
      followPill.again.textContent = state === 'moved' ? 'Go' : 'Catch up';
      followPill.again.setAttribute(
        'aria-label',
        state === 'moved' ? `Follow the agent to ${follow.pending.path}` : 'Catch up with the agent',
      );
    }

    // The same key that leaves every other mode here.
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && follow) stopFollow();
    });

    takeFollowHash = (id) => startFollow(id);
    // A conversation asking to be followed from this page: the mast's Follow.
    addEventListener('marble:follow', ({ detail }) => {
      const id = detail?.id ?? null;
      if (id) startFollow(id);
      else stopFollow();
    });
    /** Is this page following that conversation? The mast asks, to paint its
     *  own toggle; a page with no tether answers no. */
    addEventListener('marble:following?', (event) => {
      if (follow && (!event.detail?.id || event.detail.id === follow.id)) event.preventDefault();
    });

    // A tether outlives the page it was tied on: that is the whole point of
    // following something that moves between documents.
    {
      const resume = () => startFollow(followFromHash ?? followStore.get());
      if (typeof window.marble?.agent?.on === 'function') resume();
      else addEventListener('marble:agent', resume, { once: true });
    }

    document.addEventListener('marble:presence', ({ detail }) => {
      if (!detail?.client) return;
      const ids = Array.isArray(detail.ids) ? detail.ids : [];
      const acting = detail.phase === 'acting' && ids.length > 0;
      const current = acts.get(detail.client);
      if (acting && !current) beginAct(detail);
      else if (acting && current && !current.ending) updateAct(current, detail);
      else if (!acting && current) endAct(detail.client, detail);
      // Ids are the whole of it now: an agent that names none has no zone to
      // draw, and keeping it here would only be state nothing reads.
      if (ids.length) presence.set(detail.client, { ...detail, ids });
      else presence.delete(detail.client);
      paintPresence();
      paintZones();
    });

    // A presence frame is broadcast once, to whoever was listening. This file
    // is the last of several script tags, and the stream is opened in the
    // first — so a page that opens while an agent is mid-turn can have missed
    // the frame before this listener existed. Which is exactly the page a
    // conversation's "take me to the work" opens. So ask.
    if (marble.app) {
      fetch(`/presence?app=${encodeURIComponent(marble.app)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          let landed = false;
          for (const frame of body?.frames ?? []) {
            // Anything that arrived while this was in flight is newer.
            if (!frame?.client || presence.has(frame.client) || !frame.ids?.length) continue;
            presence.set(frame.client, frame);
            landed = true;
          }
          if (landed) paintZones();
        })
        .catch(() => {
          // No standing zone is the same answer as a host that cannot say.
        });
    }

    // The page reflows under a zone whenever anyone types — and the person's
    // own edits never come back as ops or presence — so the page itself is
    // what says a target moved. A target that is gone (removed, or replaced
    // under the same id) is found again from the presence map.
    let relayout = 0;
    function relayoutZones() {
      relayout = 0;
      for (const act of placedActs) {
        if (act.target?.isConnected) placeAct(act);
      }
      if (placed.some(({ target }) => !target.isConnected)) return paintZones();
      for (const { frame, target } of placed) place(frame, target);
    }
    function scheduleRelayout() {
      if ((!placed.length && !placedActs.length) || relayout) return;
      relayout = requestAnimationFrame(relayoutZones);
    }
    addEventListener('scroll', scheduleRelayout, true);
    addEventListener('resize', scheduleRelayout);
    new MutationObserver((records) => {
      // Our own frames move too; only the document's mutations count.
      if (records.some(({ target }) => !zoneLayer.contains(target) && target !== showWork)) scheduleRelayout();
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRelayout) : null;

    // The trail: what an agent's turn touched, kept per conversation so the
    // one that wrote it is the one that can take it back. An undo writes as
    // `agent-undo:<id>`, which lifts the trail its own turn left.
    const trails = new Map();
    const trailClient = (client) => {
      const name = String(client ?? '');
      if (name.startsWith('agent-undo:')) return { client: `agent:${name.slice('agent-undo:'.length)}`, undo: true };
      if (name.startsWith('agent:')) return { client: name, undo: false };
      return null;
    };
    const clearTrail = (client) => {
      for (const id of trails.get(client) ?? []) byId(id)?.classList.remove('marble-trail');
      trails.delete(client);
    };
    document.addEventListener('marble-callout:reviewed', (event) => {
      if (event.detail?.id) clearTrail(`agent:${event.detail.id}`);
    });

    document.addEventListener('marble:ops', ({ detail }) => {
      const ops = detail?.ops ?? [];
      const act = acts.get(detail?.client);
      const forked = new Set();
      const trail = trailClient(detail?.client);
      for (const op of ops) {
        if (op.type === 'insert' && /<marble-alt[\s>]/.test(op.html ?? '')) {
          const id = op.html.match(/data-marble-id="([^"]+)"/)?.[1];
          if (id) forked.add(id);
        }
        // Cause before effect. The host computes an act's op and writes it
        // before the page has been told a press happened, so played back as
        // they arrive these would be the document telling its own history
        // backwards. They wait for the ring to let go.
        if (op.id) {
          if (act?.frame && !act.ending) act.held.push(op.id);
          else flash(op.id);
        }
        if (trail && op.id) {
          const set = trails.get(trail.client) ?? new Set();
          if (trail.undo) {
            set.delete(op.id);
            byId(op.id)?.classList.remove('marble-trail');
          } else {
            set.add(op.id);
            byId(op.id)?.classList.add('marble-trail');
          }
          trails.set(trail.client, set);
        }
      }
      deriveAlts();
      for (const id of forked) wireFork(byId(id));
      paintPresence();
    });

    function play(ops) {
      const inverses = [];
      for (const op of ops) {
        const inverse = marble.invert(op);
        if (inverse) inverses.unshift(inverse);
        marble.apply(op);
        marble.op(op);
      }
      if (inverses.length) marble.record({ redo: ops, undo: inverses });
      return marble.flush();
    }

    function unwrapAlt(alt) {
      const keep = persistentChildren(alt)[0];
      if (!keep) return;
      const parent = alt.parentElement;
      if (!parent || !marble.id(parent)) return;
      const altId = marble.id(alt);
      const before = nextPersistent(alt);
      const clone = marble.clone(keep);
      clone.removeAttribute(ALT);
      clone.removeAttribute(BY);
      clone.setAttribute(ID, altId);
      // Remove the wrapper first so the guard sees `ha` as destroyed with it,
      // then insert the kept child under the original id. Renaming via setAttr
      // would drop `ha` without a remove.
      play([
        { type: 'remove', id: altId },
        {
          type: 'insert',
          html: marble.source.outer(clone),
          parentId: marble.id(parent),
          beforeId: before ? marble.id(before) : null,
        },
      ]);
    }

    function resolve(alt, keepName) {
      const versions = persistentChildren(alt);
      const keep = versions.find((el) => el.getAttribute(ALT) === keepName) ?? versions[0];
      if (!keep) return;
      const doomed = versions.filter((el) => el !== keep);
      const id = marble.id(alt);
      const ops = [];
      if (alt.getAttribute(ACTIVE) !== keepName) {
        ops.push({ type: 'setAttr', id, name: ACTIVE, value: keepName });
      }
      for (const node of doomed) ops.push({ type: 'remove', id: marble.id(node) });
      const commit = () => play(ops).then(() => {
        if (persistentChildren(alt).length <= 1) unwrapAlt(alt);
        else deriveAlts(alt);
      });
      const bar = alt.querySelector(':scope > .marble-fork');
      if (bar && !reducedMotion()) {
        bar.classList.add('marble-fork-out');
        setTimeout(commit, 160);
      } else {
        commit();
      }
    }

    function askMerge(alt) {
      const versions = persistentChildren(alt);
      const ids = versions.map((el) => marble.id(el)).filter(Boolean);
      const prompt =
        'Merge these two versions of the selected component into a third alternative. ' +
        'Keep both authors’ intent. Add a new data-marble-alt child — do not overwrite either existing version.';
      if (!marble.agent) return;
      marble.agent.select(ids);
      marble.agent.aim(marble.app);
      const current = marble.agent.current?.();
      if (current) {
        marble.agent.send(current, { prompt, target: marble.app, selection: ids });
      } else {
        marble.agent.open();
      }
    }

    function wireFork(alt) {
      if (!alt || alt.tagName !== 'MARBLE-ALT' || !isConflict(alt)) return;
      const versions = persistentChildren(alt);
      if (versions.length < 2) return;
      alt.classList.add('marble-forked');
      deriveAlts(alt);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => alt.classList.add('marble-fork-live'));
      });
      if (alt.querySelector(':scope > .marble-fork')) return;

      const bar = document.createElement('div');
      bar.className = 'marble-fork';
      bar.setAttribute(TRANSIENT, '');
      bar.setAttribute('contenteditable', 'false');

      // Why the bar is here at all, before what to do about it.
      const why = document.createElement('div');
      why.className = 'marble-fork-why';
      why.textContent = 'You and the agent both changed this.';

      const seg = document.createElement('div');
      seg.className = 'marble-fork-seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Version');

      const acts = document.createElement('div');
      acts.className = 'marble-fork-acts';

      const render = () => {
        const kids = persistentChildren(alt);
        const active = alt.getAttribute(ACTIVE);
        seg.replaceChildren();
        acts.replaceChildren();
        for (const version of kids) {
          const name = version.getAttribute(ALT);
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = labelOf(version);
          button.setAttribute('aria-pressed', String(name === active));
          button.addEventListener('click', () => {
            if (!name || alt.getAttribute(ACTIVE) === name) return;
            const undo = { type: 'setAttr', id: marble.id(alt), name: ACTIVE, value: alt.getAttribute(ACTIVE) };
            const redo = { type: 'setAttr', id: marble.id(alt), name: ACTIVE, value: name };
            alt.setAttribute(ACTIVE, name);
            marble.apply(redo);
            marble.record({ redo: [redo], undo: [undo] });
            marble.op(redo, { immediate: true });
            deriveAlts(alt);
            render();
          });
          seg.append(button);
        }
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'marble-fork-keep';
        keep.textContent = 'Keep this';
        keep.addEventListener('click', () => {
          resolve(alt, alt.getAttribute(ACTIVE) ?? kids[0]?.getAttribute(ALT));
        });
        const merge = document.createElement('button');
        merge.type = 'button';
        // It does not merge; it hands both versions to an agent for a third.
        merge.textContent = 'Ask an agent to combine';
        merge.setAttribute('aria-label', 'Ask an agent to combine both versions');
        merge.title = 'Sends both versions to an agent, which writes a third';
        merge.addEventListener('click', () => askMerge(alt));
        acts.append(keep, merge);
      };

      bar.append(why, seg, acts);
      alt.append(bar);
      render();
      new MutationObserver(render).observe(alt, { attributes: true, attributeFilter: [ACTIVE], childList: true });
    }

    marble.register((root) => {
      deriveAlts(root);
      for (const alt of altsIn(root)) wireFork(alt);
    });
  };

  if (window.marble) attach(window.marble);
  else addEventListener('marble:ready', (event) => attach(event.detail), { once: true });
})();
