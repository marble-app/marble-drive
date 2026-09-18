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

      .marble-fork button:active { transform: scale(0.97); }
      .marble-fork button:focus-visible {
        outline: 2px solid var(--accent, #9bb6cf);
        outline-offset: 2px;
      }

      .marble-zone-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483000;
      }
      .marble-zone {
        --zone-mark: color-mix(in srgb, var(--accent, #9bb6cf) 72%, var(--ink, #111));
        --zone-arm: 15px;
        --zone-hair: 1.5px;
        position: fixed;
        pointer-events: none;
        box-sizing: border-box;
        border: 0;
        background-color: transparent;
        background-image:
          linear-gradient(var(--zone-mark), var(--zone-mark)),
          linear-gradient(var(--zone-mark), var(--zone-mark)),
          linear-gradient(var(--zone-mark), var(--zone-mark)),
          linear-gradient(var(--zone-mark), var(--zone-mark)),
          linear-gradient(var(--zone-mark), var(--zone-mark)),
          linear-gradient(var(--zone-mark), var(--zone-mark)),
          linear-gradient(var(--zone-mark), var(--zone-mark)),
          linear-gradient(var(--zone-mark), var(--zone-mark));
        background-size:
          var(--zone-arm) var(--zone-hair), var(--zone-hair) var(--zone-arm),
          var(--zone-arm) var(--zone-hair), var(--zone-hair) var(--zone-arm),
          var(--zone-arm) var(--zone-hair), var(--zone-hair) var(--zone-arm),
          var(--zone-arm) var(--zone-hair), var(--zone-hair) var(--zone-arm);
        background-position:
          top left, top left,
          top right, top right,
          bottom left, bottom left,
          bottom right, bottom right;
        background-repeat: no-repeat;
        animation: marble-fade-in 220ms ${EASE} both;
        transition:
          top 180ms ${EASE},
          left 180ms ${EASE},
          width 180ms ${EASE},
          height 180ms ${EASE};
      }
      .marble-zone-label {
        pointer-events: auto;
        position: absolute;
        left: 0;
        top: 100%;
        margin-top: 8px;
        display: flex;
        align-items: center;
        gap: .55rem;
        max-width: min(100%, 28rem);
        padding: 0;
        border: 0;
        background: none;
        color: color-mix(in srgb, var(--ink, #111) 82%, var(--paper, #fff));
        font: 500 12px/1.2 var(--ui-font, system-ui, sans-serif);
        letter-spacing: -.012em;
        white-space: nowrap;
        user-select: none;
        text-shadow:
          0 0 10px var(--paper, #fff),
          0 0 10px var(--paper, #fff);
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
        background: var(--zone-mark, color-mix(in srgb, var(--accent, #9bb6cf) 72%, var(--ink, #111)));
        animation: marble-zone-breathe 2.8s ease-in-out infinite;
      }
      @keyframes marble-zone-breathe {
        0%, 100% { opacity: .38; }
        50% { opacity: 1; }
      }
      .marble-zone-tight > .marble-zone-label {
        top: auto;
        bottom: 2px;
        margin-top: 0;
      }
      .marble-zone-page {
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        width: max-content;
        max-width: min(28rem, calc(100vw - 32px));
        height: auto;
        background-image: none;
      }
      .marble-zone-page > .marble-zone-label {
        position: static;
        max-width: none;
        margin: 0;
      }
      .marble-zone-label button,
      .marble-zones-show {
        appearance: none;
        border: 0;
        background: none;
        color: color-mix(in srgb, var(--ink, #111) 52%, var(--paper, #fff));
        cursor: pointer;
        font: inherit;
        letter-spacing: inherit;
        padding: .35rem .15rem;
        border-radius: 0;
        flex: none;
        text-shadow: inherit;
      }
      .marble-zone-label button:hover,
      .marble-zones-show:hover {
        color: color-mix(in srgb, var(--ink, #111) 88%, var(--paper, #fff));
      }
      .marble-zone-label button:active,
      .marble-zones-show:active { opacity: .7; }
      .marble-zone-label button:focus-visible,
      .marble-zones-show:focus-visible {
        outline: 2px solid var(--accent, #9bb6cf);
        outline-offset: 3px;
      }
      .marble-zones-show {
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

      @media (prefers-reduced-motion: reduce) {
        .marble-flash,
        .marble-fork,
        .marble-fork.marble-fork-out,
        .marble-zone,
        .marble-zone-live,
        .marble-zones-show { animation: none; }
        .marble-zone-live { opacity: .7; }
        .marble-presence,
        .marble-presence-out,
        .marble-zone,
        html.marble-collab-host marble-alt.marble-forked > [data-marble-alt],
        .marble-fork-seg button,
        .marble-fork-acts button { transition: none; }
        .marble-fork button:active { transform: none; }
      }
      @media (prefers-reduced-transparency: reduce) {
        .marble-fork-seg { background: var(--paper-2, #f3f1ea); }
        .marble-presence { background-color: color-mix(in srgb, var(--accent, #9bb6cf) 28%, transparent); }
        .marble-zone-label,
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

    function phaseLabel(detail) {
      const note = String(detail.note ?? '').trim();
      if (note) return `Agent · ${asClause(note)}`;
      if (detail.phase === 'reading') return 'Agent · reading';
      if (detail.phase === 'writing') return 'Agent · writing';
      return 'Agent · working';
    }

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

    function paintZones() {
      placed = [];
      sizes?.disconnect();
      zoneLayer.replaceChildren();
      const live = [...presence.values()].filter((detail) => (
        isAgent(detail.client) && (detail.ids?.length || detail.phase)
      ));
      const hidden = zonesHidden();
      document.documentElement.classList.toggle('marble-zones-off', hidden);
      if (!live.length) {
        showWork.hidden = true;
        return;
      }
      if (hidden) {
        showWork.hidden = false;
        return;
      }
      showWork.hidden = true;
      for (const detail of live) {
        const els = (detail.ids ?? []).map((id) => byId(id)).filter(Boolean);
        const target = tapeTarget(els);
        const frame = document.createElement('div');
        frame.className = target ? 'marble-zone' : 'marble-zone marble-zone-page';
        frame.setAttribute(TRANSIENT, '');
        const label = document.createElement('div');
        label.className = 'marble-zone-label';
        const live = document.createElement('span');
        live.className = 'marble-zone-live';
        live.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = phaseLabel(detail);
        const hide = document.createElement('button');
        hide.type = 'button';
        hide.textContent = 'Hide';
        hide.setAttribute('aria-label', 'Hide construction zone');
        hide.addEventListener('click', () => setZonesHidden(true));
        label.append(live, text, hide);
        frame.append(label);
        zoneLayer.append(frame);
        if (target) {
          place(frame, target);
          placed.push({ frame, target });
          sizes?.observe(target);
        }
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

    document.addEventListener('marble:presence', ({ detail }) => {
      if (!detail?.client) return;
      const ids = Array.isArray(detail.ids) ? detail.ids : [];
      const live = ids.length || (isAgent(detail.client) && detail.phase);
      if (live) presence.set(detail.client, { ...detail, ids });
      else presence.delete(detail.client);
      paintPresence();
      paintZones();
    });

    // The page reflows under a zone whenever anyone types — and the person's
    // own edits never come back as ops or presence — so the page itself is
    // what says a target moved. A target that is gone (removed, or replaced
    // under the same id) is found again from the presence map.
    let relayout = 0;
    function relayoutZones() {
      relayout = 0;
      if (placed.some(({ target }) => !target.isConnected)) return paintZones();
      for (const { frame, target } of placed) place(frame, target);
    }
    function scheduleRelayout() {
      if (!placed.length || relayout) return;
      relayout = requestAnimationFrame(relayoutZones);
    }
    addEventListener('scroll', scheduleRelayout, true);
    addEventListener('resize', scheduleRelayout);
    new MutationObserver((records) => {
      // Our own frames move too; only the document's mutations count.
      if (records.some(({ target }) => !zoneLayer.contains(target) && target !== showWork)) scheduleRelayout();
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRelayout) : null;

    document.addEventListener('marble:ops', ({ detail }) => {
      const ops = detail?.ops ?? [];
      const forked = new Set();
      for (const op of ops) {
        if (op.type === 'insert' && /<marble-alt[\s>]/.test(op.html ?? '')) {
          const id = op.html.match(/data-marble-id="([^"]+)"/)?.[1];
          if (id) forked.add(id);
        }
        if (op.id) flash(op.id);
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
