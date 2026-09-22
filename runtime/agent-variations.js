// Variations: the pill on an element that has more than one version, and the
// surface for comparing them.
//
// A variation is not a preview and not a screenshot — it is a `<marble-alt>`
// child in the document, which is the element this format already has for the
// thing that might have been. So this layer knows nothing about where the
// alternatives came from: an agent asked for them through Describe mode's
// Explore, another person wrote them by hand, a fork left two — all the same
// object, and switching between them is one `setAttr` that records, undoes and
// travels like any other edit.
//
// What it adds is a way to see them: a version pill at the element, and a
// compare surface that lays the versions out in the space the page actually
// has left, measured rather than assumed.
//
// Spec: docs/superpowers/specs/2026-09-21-describe-mode-design.md

(() => {
  const TRANSIENT = 'data-marble-transient';
  const ALT = 'data-marble-alt';
  const ACTIVE = 'data-marble-active';
  const WHY = 'data-why';
  const MINE = 'marble-variations';
  const EASE = 'cubic-bezier(.2, .8, .3, 1)';
  const CARD_MIN = 240;
  const STAGE_MAX = 280;

  const GLYPHS = {
    left: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="4" width="8" height="7" rx="2"/><rect x="13" y="4" width="8" height="7" rx="2"/><rect x="3" y="13" width="8" height="7" rx="2"/><rect x="13" y="13" width="8" height="7" rx="2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  const STYLE = `
    /* Which version shows is the document's own business — its stylesheet
       pairs the names against data-marble-active. A document that has just
       been given alternatives by an agent has no such rule yet, and without
       one every version would stand on the page at once. So for the alts this
       layer has taken charge of, the one collab.js derives as shown is the one
       that shows, and the rest stand down. It sets no display on the shown
       child: whatever the document makes that element is what it stays. */
    marble-alt.${MINE}:has(> .marble-alt-shown) > [${ALT}]:not(.marble-alt-shown) { display: none; }

    .marble-variations-layer {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none;
      z-index: 2147483003;
      --var-mark: var(--accent-ink, color-mix(in srgb, #6d55d4 78%, var(--ink, #222)));
      --var-paper: var(--card, var(--paper, #fff));
      --var-ink: var(--ink, #222);
      --var-line: color-mix(in srgb, var(--var-ink) 12%, transparent);
      font: 400 12.5px/1.35 var(--ui-font, system-ui, -apple-system, sans-serif);
      color: var(--var-ink);
    }
    .marble-variations-layer:popover-open { position: fixed; inset: 0; }

    /* The pill sits on the element, says where you are in the set, and moves
       through it. Nothing else: choosing *which* is a comparison, and a
       comparison needs the surface. */
    .marble-variations-pill {
      position: fixed; pointer-events: auto; display: flex; align-items: center; gap: 1px;
      padding: 2px; border-radius: 999px; background: var(--var-paper);
      border: 1px solid var(--var-line);
      box-shadow: 0 1px 2px rgba(0, 0, 0, .06), 0 6px 18px rgba(0, 0, 0, .12);
      transition: opacity 140ms ${EASE};
    }
    .marble-variations-pill[hidden] { display: none; }
    .marble-variations-step {
      all: unset; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
      cursor: pointer; color: color-mix(in srgb, var(--var-ink) 65%, transparent);
    }
    .marble-variations-step svg { width: 13px; height: 13px; }
    .marble-variations-step:hover { background: color-mix(in srgb, var(--var-ink) 8%, transparent); color: var(--var-ink); }
    .marble-variations-step:focus-visible { outline: 2px solid var(--var-mark); outline-offset: 1px; }
    .marble-variations-name {
      font: 600 11.5px/1 var(--ui-font, system-ui, sans-serif); padding: 0 4px; white-space: nowrap;
      max-width: 120px; overflow: hidden; text-overflow: ellipsis; color: var(--var-mark);
    }
    .marble-variations-of { font-weight: 400; color: color-mix(in srgb, var(--var-ink) 45%, transparent); }
    .marble-variations-open {
      all: unset; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center;
      cursor: pointer; color: color-mix(in srgb, var(--var-ink) 65%, transparent);
    }
    .marble-variations-open svg { width: 13px; height: 13px; }
    .marble-variations-open:hover { background: color-mix(in srgb, var(--var-ink) 8%, transparent); color: var(--var-ink); }

    /* The surface. It takes the space the page has left after the drawer and
       the toolbar, and it is moved and resized by the hand, because whatever
       it measured is still only a guess about what you are reading. */
    .marble-variations-panel {
      position: fixed; pointer-events: auto; display: flex; flex-direction: column;
      min-width: 280px; min-height: 180px; border-radius: 16px; overflow: hidden;
      background: color-mix(in srgb, var(--var-paper) 92%, transparent);
      -webkit-backdrop-filter: blur(24px) saturate(180%); backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid var(--var-line);
      box-shadow: 0 1px 2px rgba(0, 0, 0, .06), 0 20px 60px rgba(0, 0, 0, .22);
      transition: opacity 180ms ${EASE};
    }
    .marble-variations-panel[hidden] { display: none; }
    @starting-style { .marble-variations-panel { opacity: 0; } }
    .marble-variations-bar {
      flex: none; display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 13px;
      cursor: grab; touch-action: none; border-bottom: 1px solid var(--var-line);
    }
    .marble-variations-panel[data-dragging] .marble-variations-bar { cursor: grabbing; }
    .marble-variations-title { font: 600 12.5px/1.2 inherit; }
    .marble-variations-sub { font-size: 11.5px; color: color-mix(in srgb, var(--var-ink) 50%, transparent); }
    .marble-variations-spacer { flex: 1; }
    .marble-variations-shut {
      all: unset; width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center;
      cursor: pointer; color: color-mix(in srgb, var(--var-ink) 60%, transparent);
    }
    .marble-variations-shut svg { width: 14px; height: 14px; }
    .marble-variations-shut:hover { background: color-mix(in srgb, var(--var-ink) 8%, transparent); color: var(--var-ink); }

    .marble-variations-body {
      flex: 1; min-height: 0; overflow: auto; padding: 12px;
      display: grid; gap: 12px; align-content: start; align-items: start;
    }
    .marble-variations-card {
      display: flex; flex-direction: column; gap: 0; border-radius: 12px; overflow: hidden;
      background: var(--var-paper); border: 1px solid var(--var-line);
    }
    .marble-variations-card[data-active="true"] { border-color: var(--var-mark); box-shadow: 0 0 0 1px var(--var-mark); }
    /* The version itself, at the width it has in the page, scaled down to fit
       the card — a preview of the thing, not a drawing of it. */
    .marble-variations-stage {
      position: relative; overflow: hidden; background: var(--var-paper);
      border-bottom: 1px solid var(--var-line);
    }
    .marble-variations-hold { position: absolute; top: 0; left: 0; transform-origin: top left; }
    .marble-variations-foot { display: flex; align-items: center; gap: 6px; padding: 8px 9px; }
    .marble-variations-label { min-width: 0; flex: 1; }
    .marble-variations-label b { display: block; font: 600 12px/1.25 inherit; }
    .marble-variations-why {
      display: block; font-size: 11.5px; color: color-mix(in srgb, var(--var-ink) 55%, transparent);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .marble-variations-use, .marble-variations-keep {
      all: unset; flex: none; padding: 5px 9px; border-radius: 8px; cursor: pointer;
      font: 600 11.5px/1 var(--ui-font, system-ui, sans-serif);
    }
    .marble-variations-use { background: var(--var-mark); color: var(--var-paper); }
    .marble-variations-use[disabled] { background: color-mix(in srgb, var(--var-ink) 8%, transparent); color: color-mix(in srgb, var(--var-ink) 45%, transparent); cursor: default; }
    .marble-variations-keep { color: color-mix(in srgb, var(--var-ink) 60%, transparent); }
    .marble-variations-keep:hover { background: color-mix(in srgb, var(--var-ink) 8%, transparent); color: var(--var-ink); }
    .marble-variations-empty { padding: 18px 12px; text-align: center; color: color-mix(in srgb, var(--var-ink) 50%, transparent); }

    .marble-variations-grab {
      position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; touch-action: none;
    }
    .marble-variations-grab::after {
      content: ''; position: absolute; right: 5px; bottom: 5px; width: 7px; height: 7px;
      border-right: 1.5px solid color-mix(in srgb, var(--var-ink) 30%, transparent);
      border-bottom: 1.5px solid color-mix(in srgb, var(--var-ink) 30%, transparent);
    }
    @media (prefers-reduced-transparency: reduce) {
      .marble-variations-panel { background: var(--var-paper); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .marble-variations-pill, .marble-variations-panel { transition: none; }
    }
  `;

  const boot = (marble) => {
    if (!marble?.app || typeof marble.apply !== 'function') return;
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-variations-layer')) return;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    const layer = document.createElement('div');
    layer.className = 'marble-variations-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('popover', 'manual');
    document.documentElement.append(layer);
    try { layer.showPopover(); } catch { /* fixed positioning still stands */ }

    const el = (tag, className, parent = null, text = null) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      node.setAttribute(TRANSIENT, '');
      if (text !== null) node.textContent = text;
      if (parent) parent.append(node);
      return node;
    };

    const versionsOf = (alt) => [...alt.children].filter((child) => !child.hasAttribute(TRANSIENT) && child.hasAttribute(ALT));
    const nameOf = (version) => version.getAttribute(ALT) || 'version';
    const activeIn = (alt) => {
      const versions = versionsOf(alt);
      const active = alt.getAttribute(ACTIVE);
      return versions.find((v) => v.getAttribute(ALT) === active) ?? versions[0] ?? null;
    };

    /** The carrier's own write path, exactly as collab.js plays an op: apply,
     *  file, record the inverse so Mod+Z takes it back, flush to disk. */
    const play = (ops) => {
      const inverses = [];
      for (const op of ops) {
        const inverse = marble.invert?.(op);
        if (inverse) inverses.unshift(inverse);
        marble.apply(op);
        marble.op(op);
      }
      if (inverses.length) marble.record?.({ redo: ops, undo: inverses });
      return marble.flush?.() ?? Promise.resolve();
    };

    /** Which version shows, derived from which one is active. collab.js derives
     *  the same class on its own schedule; doing it here as well costs nothing
     *  and means a switch lands on the frame it was asked for rather than the
     *  next one — the whole point of the pill is that flipping is instant. */
    const derive = (alt) => {
      const current = activeIn(alt);
      for (const version of versionsOf(alt)) version.classList.toggle('marble-alt-shown', version === current);
    };
    const use = (alt, version) => {
      const name = nameOf(version);
      if (alt.getAttribute(ACTIVE) === name) return Promise.resolve();
      const done = play([{ type: 'setAttr', id: marble.id(alt), name: ACTIVE, value: name }]);
      derive(alt);
      placePill(alt);
      return done;
    };
    /** Keeping one version is unwrapping the alternative: the others go, and
     *  the survivor takes the wrapper's id, so every link and every op that
     *  ever pointed at this element still lands. */
    const keepOnly = async (alt, version) => {
      const others = versionsOf(alt).filter((other) => other !== version);
      const parent = alt.parentElement;
      const altId = marble.id(alt);
      if (!parent || !marble.id(parent) || !altId) return;
      await use(alt, version);
      if (others.length) await play(others.map((other) => ({ type: 'remove', id: marble.id(other) })));
      const clone = marble.clone(version);
      clone.removeAttribute(ALT);
      clone.removeAttribute(WHY);
      clone.classList.remove('marble-alt-shown');
      clone.setAttribute('data-marble-id', altId);
      let before = alt.nextElementSibling;
      while (before && before.hasAttribute(TRANSIENT)) before = before.nextElementSibling;
      // The wrapper goes first, so the id it was holding is free for the child
      // that inherits it.
      await play([
        { type: 'remove', id: altId },
        {
          type: 'insert',
          html: marble.source.outer(clone),
          parentId: marble.id(parent),
          beforeId: before ? marble.id(before) : null,
        },
      ]);
    };

    // ----------------------------------------------------------------- pills

    const pills = new Map();
    const pillFor = (alt) => {
      let pill = pills.get(alt);
      if (pill) return pill;
      const node = el('div', 'marble-variations-pill', layer);
      const back = el('button', 'marble-variations-step', node);
      back.type = 'button';
      back.setAttribute('aria-label', 'Previous version');
      back.innerHTML = GLYPHS.left;
      const label = el('span', 'marble-variations-name', node);
      const next = el('button', 'marble-variations-step', node);
      next.type = 'button';
      next.setAttribute('aria-label', 'Next version');
      next.innerHTML = GLYPHS.right;
      const open = el('button', 'marble-variations-open', node);
      open.type = 'button';
      open.setAttribute('aria-label', 'Compare versions');
      open.innerHTML = GLYPHS.grid;
      const step = (by) => {
        const versions = versionsOf(alt);
        const at = versions.indexOf(activeIn(alt));
        const to = versions[(at + by + versions.length) % versions.length];
        if (to) use(alt, to);
      };
      back.addEventListener('click', () => step(-1));
      next.addEventListener('click', () => step(1));
      open.addEventListener('click', () => openPanel(alt));
      pill = { node, label };
      pills.set(alt, pill);
      return pill;
    };

    const placePill = (alt) => {
      const pill = pills.get(alt);
      if (!pill) return;
      const r = alt.getBoundingClientRect();
      const versions = versionsOf(alt);
      const at = versions.indexOf(activeIn(alt));
      pill.label.innerHTML = '';
      pill.label.append(document.createTextNode(nameOf(versions[at] ?? versions[0] ?? alt)));
      const of = el('span', 'marble-variations-of', null, ` ${at + 1}/${versions.length}`);
      pill.label.append(of);
      const size = pill.node.getBoundingClientRect();
      const offscreen = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || (!r.width && !r.height);
      pill.node.hidden = offscreen;
      if (offscreen) return;
      const left = Math.min(Math.max(8, r.right - size.width), innerWidth - size.width - 8);
      const top = Math.min(Math.max(8, r.top - size.height - 6), innerHeight - size.height - 8);
      pill.node.style.left = `${Math.round(left)}px`;
      pill.node.style.top = `${Math.round(top)}px`;
    };

    const scan = () => {
      const live = new Set();
      for (const alt of document.querySelectorAll('marble-alt')) {
        if (alt.closest(`[${TRANSIENT}]`)) continue;
        if (versionsOf(alt).length < 2 || !marble.id(alt)) continue;
        // A fork is somebody else's disagreement and collab.js draws its own
        // bar for it; this layer is for a set somebody asked for.
        if (alt.classList.contains('marble-forked')) continue;
        alt.classList.add(MINE);
        // The rule above hides on this class, so the layer never waits to be
        // told which version is the shown one. A derived class is not a change
        // and files no op.
        derive(alt);
        live.add(alt);
        pillFor(alt);
      }
      for (const [alt, pill] of pills) {
        if (live.has(alt)) continue;
        pill.node.remove();
        pills.delete(alt);
        alt.classList.remove(MINE);
      }
      for (const alt of live) placePill(alt);
      if (open.alt && !live.has(open.alt)) shutPanel();
      else if (open.alt) fillPanel();
      // Something was asked for, and it has landed.
      if (waiting.size) {
        for (const alt of live) {
          const id = marble.id(alt);
          if (!waiting.has(id) && !waiting.has(marble.id(alt.parentElement))) continue;
          waiting.clear();
          openPanel(alt);
          break;
        }
      }
    };
    let scanning = 0;
    const scheduleScan = () => { if (!scanning) scanning = requestAnimationFrame(() => { scanning = 0; scan(); }); };
    const schedulePlace = () => {
      if (scanning) return;
      for (const alt of pills.keys()) placePill(alt);
      if (open.alt) placePanel();
    };

    // --------------------------------------------------------------- surface

    const panel = el('div', 'marble-variations-panel', layer);
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Variations');
    const bar = el('div', 'marble-variations-bar', panel);
    const heading = el('div', null, bar);
    const title = el('div', 'marble-variations-title', heading, 'Variations');
    const sub = el('div', 'marble-variations-sub', heading, '');
    el('span', 'marble-variations-spacer', bar);
    const shut = el('button', 'marble-variations-shut', bar);
    shut.type = 'button';
    shut.setAttribute('aria-label', 'Close');
    shut.innerHTML = GLYPHS.close;
    const body = el('div', 'marble-variations-body', panel);
    const grab = el('div', 'marble-variations-grab', panel);
    const open = { alt: null };
    const waiting = new Set();

    const store = marble.agent?.storage;
    const KEY = `marble-variations:panel:${marble.app}`;
    // The agent's storage is a string store — handing it an object writes the
    // words "[object Object]" and loses the panel's corner in a way nothing
    // complains about — so the JSON is made here, on both sides.
    const remembered = () => {
      try {
        const raw = store ? store.get(KEY) : localStorage.getItem(KEY);
        const at = raw ? JSON.parse(raw) : null;
        return at && Number.isFinite(at.left) ? at : null;
      } catch { return null; }
    };
    const remember = (at) => {
      const raw = JSON.stringify(at);
      try {
        if (store) store.set(KEY, raw);
        else localStorage.setItem(KEY, raw);
      } catch { /* a panel that cannot remember still works */ }
    };

    /** The page's own edges, which is not the window's: a pinned drawer takes
     *  a margin off `<html>`, and Describe mode's toolbar sits along the foot.
     *  Whatever is left of that is what there is to lay cards out in. */
    const freeSpace = () => {
      const page = document.documentElement.getBoundingClientRect();
      // Describe mode fades its layer out rather than removing it, so a toolbar
      // that is merely invisible must not go on taking up the foot of the page.
      const toolbar = document.querySelector('.marble-marks-layer[data-describing] .marble-marks-bar:not([hidden])')?.getBoundingClientRect();
      const left = Math.max(8, page.left + 8);
      const right = Math.min(innerWidth - 8, page.right - 8);
      const top = 8;
      const bottom = (toolbar ? toolbar.top - 12 : innerHeight) - 8;
      return { left, top, width: Math.max(280, right - left), height: Math.max(180, bottom - top) };
    };

    /** Beside the element if there is room beside it, under it if there is room
     *  under it, and otherwise over the emptier half of what is left. */
    const restingPlace = (alt, size) => {
      const free = freeSpace();
      const r = alt.getBoundingClientRect();
      const rightRoom = free.left + free.width - (r.right + 16);
      const belowRoom = free.top + free.height - (r.bottom + 16);
      const leftRoom = r.left - 16 - free.left;
      if (rightRoom >= size.width) return { left: r.right + 16, top: Math.min(Math.max(free.top, r.top), free.top + free.height - size.height) };
      if (leftRoom >= size.width) return { left: r.left - 16 - size.width, top: Math.min(Math.max(free.top, r.top), free.top + free.height - size.height) };
      if (belowRoom >= size.height) return { left: Math.min(Math.max(free.left, r.left), free.left + free.width - size.width), top: r.bottom + 16 };
      return { left: free.left + free.width - size.width, top: free.top + free.height - size.height };
    };

    const placePanel = ({ reset = false } = {}) => {
      const free = freeSpace();
      if (reset || !panel.dataset.placed) {
        const at = remembered();
        const size = {
          width: Math.min(at?.width ?? Math.min(760, free.width), free.width),
          height: Math.min(at?.height ?? Math.min(520, free.height), free.height),
        };
        panel.style.width = `${Math.round(size.width)}px`;
        panel.style.height = `${Math.round(size.height)}px`;
        const spot = at && Number.isFinite(at.left) ? at : restingPlace(open.alt ?? document.body, size);
        panel.style.left = `${Math.round(Math.min(Math.max(free.left, spot.left), free.left + free.width - size.width))}px`;
        panel.style.top = `${Math.round(Math.min(Math.max(free.top, spot.top), free.top + free.height - size.height))}px`;
        panel.dataset.placed = '1';
        return;
      }
      // Already placed: keep it inside whatever the page is now.
      const r = panel.getBoundingClientRect();
      panel.style.left = `${Math.round(Math.min(Math.max(free.left, r.left), Math.max(free.left, free.left + free.width - r.width)))}px`;
      panel.style.top = `${Math.round(Math.min(Math.max(free.top, r.top), Math.max(free.top, free.top + free.height - r.height)))}px`;
    };

    /** One live copy of the version, at the width it has in the page, scaled to
     *  the card. Ids are stripped on the way in: two elements answering to one
     *  `data-marble-id` is a broken document, and a preview is not a place. */
    const stageVersion = (stage, version, width) => {
      const hold = el('div', 'marble-variations-hold', stage);
      const clone = version.cloneNode(true);
      for (const node of [clone, ...clone.querySelectorAll('[data-marble-id]')]) node.removeAttribute('data-marble-id');
      clone.removeAttribute(ALT);
      clone.classList.remove('marble-alt-shown');
      clone.setAttribute(TRANSIENT, '');
      clone.style.display = '';
      hold.style.width = `${Math.round(width)}px`;
      hold.append(clone);
      const cardWidth = stage.clientWidth || CARD_MIN;
      const scale = Math.min(1, cardWidth / Math.max(1, width));
      hold.style.transform = `scale(${scale})`;
      const height = hold.getBoundingClientRect().height || clone.getBoundingClientRect().height;
      stage.style.height = `${Math.round(Math.min(STAGE_MAX, Math.max(56, height)))}px`;
    };

    const fillPanel = () => {
      const alt = open.alt;
      if (!alt) return;
      const versions = versionsOf(alt);
      title.textContent = `Variations of ${marble.id(alt)}`;
      sub.textContent = `${versions.length} version${versions.length === 1 ? '' : 's'} in the document`;
      const free = panel.getBoundingClientRect().width - 24;
      const width = alt.getBoundingClientRect().width || CARD_MIN;
      // Side by side only while the versions stay legible. A card narrower than
      // the thing in it means scaling the thing down, and three columns of
      // five-pixel type compare nothing — so a wide element asks for a wide
      // card, and gets fewer of them across.
      const wants = Math.max(CARD_MIN, Math.min(width, 420));
      const columns = Math.max(1, Math.min(versions.length, Math.floor(free / wants)));
      body.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      body.replaceChildren();
      const activeName = alt.getAttribute(ACTIVE) ?? nameOf(versions[0] ?? alt);
      for (const version of versions) {
        const card = el('div', 'marble-variations-card', body);
        const isActive = nameOf(version) === activeName;
        card.dataset.active = String(isActive);
        const stage = el('div', 'marble-variations-stage', card);
        const foot = el('div', 'marble-variations-foot', card);
        const label = el('div', 'marble-variations-label', foot);
        el('b', null, label, nameOf(version));
        const why = version.getAttribute(WHY);
        if (why) el('span', 'marble-variations-why', label, why);
        const useButton = el('button', 'marble-variations-use', foot, isActive ? 'In use' : 'Use');
        useButton.type = 'button';
        useButton.disabled = isActive;
        useButton.addEventListener('click', () => use(alt, version).then(scheduleScan));
        const keepButton = el('button', 'marble-variations-keep', foot, 'Keep only this');
        keepButton.type = 'button';
        keepButton.addEventListener('click', () => keepOnly(alt, version).then(() => { shutPanel(); scheduleScan(); }));
        // After the card is in the flow, so the stage has its real width.
        stageVersion(stage, version, width);
      }
      if (!versions.length) el('div', 'marble-variations-empty', body, 'Nothing to compare.');
    };

    const openPanel = (alt) => {
      open.alt = alt;
      panel.hidden = false;
      delete panel.dataset.placed;
      placePanel({ reset: true });
      fillPanel();
    };
    const shutPanel = () => {
      open.alt = null;
      panel.hidden = true;
      body.replaceChildren();
    };
    shut.addEventListener('click', shutPanel);

    // Drag by the bar, resize from the corner; both remembered per document,
    // because a surface that lands somewhere useful should stay there.
    let hold = null;
    bar.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      hold = { kind: 'move', id: event.pointerId, x: event.clientX, y: event.clientY, left: r.left, top: r.top };
      panel.dataset.dragging = '';
      bar.setPointerCapture(event.pointerId);
    });
    grab.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const r = panel.getBoundingClientRect();
      hold = { kind: 'size', id: event.pointerId, x: event.clientX, y: event.clientY, width: r.width, height: r.height };
      grab.setPointerCapture(event.pointerId);
    });
    addEventListener('pointermove', (event) => {
      if (!hold || event.pointerId !== hold.id) return;
      const free = freeSpace();
      const dx = event.clientX - hold.x;
      const dy = event.clientY - hold.y;
      if (hold.kind === 'move') {
        const r = panel.getBoundingClientRect();
        panel.style.left = `${Math.round(Math.min(Math.max(free.left, hold.left + dx), free.left + free.width - r.width))}px`;
        panel.style.top = `${Math.round(Math.min(Math.max(free.top, hold.top + dy), free.top + free.height - r.height))}px`;
        return;
      }
      panel.style.width = `${Math.round(Math.min(Math.max(280, hold.width + dx), free.width))}px`;
      panel.style.height = `${Math.round(Math.min(Math.max(180, hold.height + dy), free.height))}px`;
      fillPanel();
    });
    const drop = (event) => {
      if (!hold || event.pointerId !== hold.id) return;
      hold = null;
      delete panel.dataset.dragging;
      const r = panel.getBoundingClientRect();
      remember({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    addEventListener('pointerup', drop);
    addEventListener('pointercancel', drop);

    // ---------------------------------------------------------------- events

    // Describe mode's Explore says what it asked for, so the surface can open
    // itself the moment the alternatives land rather than waiting to be found.
    addEventListener('marble-variations:watch', (event) => {
      waiting.clear();
      for (const id of event.detail?.ids ?? []) waiting.add(id);
    });
    addEventListener('scroll', schedulePlace, true);
    addEventListener('resize', () => { schedulePlace(); if (open.alt) placePanel(); });
    document.addEventListener('marble:ops', scheduleScan);
    new ResizeObserver(schedulePlace).observe(document.documentElement);
    marble.register?.(() => scheduleScan());
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true, attributeFilter: [ACTIVE] });
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); shutPanel(); }
    });

    scan();
  };

  if (window.marble) boot(window.marble);
  else addEventListener('marble:ready', (event) => boot(event.detail ?? window.marble), { once: true });
})();
