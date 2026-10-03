// The change on request (v5, Notes and Sketches/Ask at Anything, "After a
// change: the result, and the change on request").
//
// Until v5 a changed part kept a line down its side until its chat was marked
// Done, and the card's Undo and Done stayed as long as the card did: the page
// ended up wearing every change it was asked for. Now a change ends with the
// new interface and nothing else. Nothing marks a changed part until you ask:
//
//   - rest the pointer on it for half a second, or move focus into it, and
//     the change draws itself over what it made: what was added is tinted
//     with an accent edge, old words are struck through under the new ones, a
//     removed part is a ghost at its old place, a moved one leaves a dashed
//     gap where it was, and an old shape shows in dashes;
//   - one tag over it counts the change in its parts' own unit. Hold the tag
//     and the thing is shown as it was, over itself; let go and the change is
//     back. Nothing is undone;
//   - one bar under it, flush with it: Change more opens the line on what the
//     change made (change-line.js), Keep takes the drawing away for good, and
//     Undo takes the last ask back (hold it for every ask since the last
//     Keep), then offers Redo while you are there;
//   - ⌘Z from anywhere on the page takes the change back when it came after
//     your own last edit, and ⇧⌘Z puts it back; otherwise both are the
//     document's own history;
//   - an edit of yours inside a changed part makes that part yours: its
//     drawing goes, and the rest of the change still shows;
//   - the chat button's menu has Show what changed while anything here is
//     unreviewed, which draws every change at once: on touch, where there is
//     no rest, that is the way in.
//
// Move away without choosing and the drawing goes; the change still waits,
// after a reload too, because the host keeps each turn's parts (GET
// /agent/review). The page asks it on load, when a change ends here, and when
// a chat about this page says something changed; never on a timer.
// Everything here is transient chrome in one top-layer host; nothing it draws
// is filed as an op. It never says Agent.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const REST = 500;          // ms the pointer rests before a change draws itself
  const DRIFT = 4;           // px a resting pointer may drift and still be resting
  const LEAVE = 300;         // ms away from the change and its bar before it goes
  const GAP = 10;            // px the bar hangs under the change
  const NARROW = 300;        // px, the least a bar is wide
  const INSIDE = 8;          // px the bar, the tag and a tip keep inside the window
  const LIFT = 900;          // ms a kept change's drawing takes to lift
  const OUT = 140;           // ms a drawing put away takes to go
  const HOLD_TAG = 250;      // ms the tag is held before it shows the thing as it was
  const HOLD_UNDO = 600;     // ms Undo is held before it takes back every ask
  const TIP = 750;           // ms of rest before a control's tip
  const LOOKS = 1500;        // elements whose look a copy takes over
  const SOON = 120;          // ms a burst of reasons to ask the host is gathered into one
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';    // arriving and settling
  const COLOUR = 'cubic-bezier(.22, .61, .36, 1)'; // colour only
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');

  const STYLE = `
    .marble-review-host {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none; color: inherit;
      --review-accent: var(--accent, light-dark(#9bb6cf, #7fa8c9));
      --review-ink: var(--accent-ink, light-dark(#738698, #9dc0dc));
      --review-card: var(--card, var(--paper, light-dark(#fff, #1f2023)));
      --review-text: var(--ink, light-dark(#1d1d1f, #ececee));
      --review-muted: var(--muted, light-dark(#5f6267, #a6a9ae));
      --review-faint: var(--faint, light-dark(#8b8e93, #7e8187));
      --review-line: var(--line, color-mix(in srgb, var(--review-text) 14%, transparent));
      --review-well: var(--well, color-mix(in srgb, var(--review-text) 6%, var(--review-card)));
      --review-font: var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif));
      font: 13px/1.35 var(--review-font);
    }
    .marble-review-host:popover-open { position: fixed; inset: 0; }
    .marble-review-host i { font-style: normal; }
    .marble-review-aloud { position: fixed; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap; border: 0; }

    /* One change, drawn: it comes in and goes as one piece. */
    .marble-review-group { position: fixed; inset: 0; pointer-events: none; opacity: 1; transition: opacity ${OUT}ms ${COLOUR}; }
    @media (prefers-reduced-motion: no-preference) {
      @starting-style { .marble-review-group { opacity: 0; } }
    }
    .marble-review-group[data-state="out"] { opacity: 0; }
    .marble-review-group[data-state="lift"] { opacity: 0; transition: opacity ${LIFT}ms ${EASE}; }
    .marble-review-group[data-state="out"] *, .marble-review-group[data-state="lift"] * { pointer-events: none !important; }

    /* What was added: a fill with a full hairline of the accent round it,
       shaped to the part. Never a border down one side. */
    .marble-review-add, .marble-review-tint, .marble-review-outline, .marble-review-gap, .marble-review-ghost, .marble-review-was {
      position: fixed; left: 0; top: 0; box-sizing: border-box; margin: 0; pointer-events: none; }
    .marble-review-add { border-radius: 4px; background: color-mix(in srgb, var(--review-accent) 24%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--review-ink) 70%, transparent); }
    /* What changed in place: the new is tinted. A changed value is a tint and nothing more. */
    .marble-review-tint { border-radius: 4px; background: color-mix(in srgb, var(--review-accent) 24%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--review-ink) 50%, transparent); }
    .marble-review-tint[data-kind="attr"] { box-shadow: none; }
    /* The old words, under the new: struck through, faint, two lines at most. */
    .marble-review-was { width: max-content; padding: 1px 5px; border-radius: 4px; background: var(--review-card);
      color: var(--review-faint); font: 400 12px/1.35 var(--review-font); text-align: start;
      text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--review-faint) 70%, transparent);
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
    /* The old shape, in dashes over the new one. */
    .marble-review-outline { border: 1px dashed color-mix(in srgb, var(--review-ink) 60%, transparent); }
    /* Where a moved part came from: one dashed line across its old place. */
    .marble-review-gap { height: 0; border-top: 1px dashed color-mix(in srgb, var(--review-ink) 55%, transparent); }
    /* A removed part, drawn back where it was: dashed all the way round, its
       words struck through, faint. It takes no room. */
    .marble-review-ghost { display: block; overflow: hidden; border-radius: 4px; background: var(--review-ghost-paper, var(--review-card));
      border: 1px dashed color-mix(in srgb, var(--review-ink) 50%, transparent); }
    .marble-review-ghost > * { opacity: .55; }
    .marble-review-ghost * { text-decoration-line: line-through; text-decoration-color: color-mix(in srgb, currentColor 70%, transparent); }
    .marble-review-ghost table { border-collapse: collapse; width: 100%; }
    .marble-review-ghost ul, .marble-review-ghost ol, .marble-review-ghost dl { margin: 0; padding: 0; list-style: none; }

    /* The page as it was, while the tag is held: a copy laid over the thing. */
    .marble-review-before { position: fixed; left: 0; top: 0; margin: 0; pointer-events: none; box-sizing: border-box; }
    .marble-review-before > * { margin: 0 !important; }

    /* The tag says what the change did, in ink on the page's card: it is the
       page's own state now, not work going on. Its squared corner points at
       what it counts. */
    .marble-review-tag { position: fixed; left: 0; top: 0; pointer-events: auto; }
    .marble-review-tag button { appearance: none; margin: 0; display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 7px; border: 1px solid var(--review-line); border-radius: 6px 6px 6px 1px;
      background: var(--review-card); color: var(--review-text); box-shadow: var(--shadow, 0 1px 3px rgba(0, 0, 0, .12));
      font: 500 11.5px/1 var(--review-font); letter-spacing: -.005em; white-space: nowrap; cursor: default;
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: none;
      transition: background-color 120ms ${COLOUR}; }
    .marble-review-tag button::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--review-ink); }
    .marble-review-tag[data-edge] button { border-radius: 6px; }
    .marble-review-tag b { font-weight: 600; color: var(--review-ink); font-variant-numeric: tabular-nums; }
    .marble-review-tag[data-held] button { background: var(--review-well); }
    .marble-review-tag[data-held] button::before { background: var(--review-faint); }
    .marble-review-tag button:focus-visible { outline: 2px solid var(--review-ink); outline-offset: 2px; }
    .marble-review-tag[hidden], .marble-review-bar[hidden] { display: none; }

    /* One bar under the change, flush with it. */
    .marble-review-bar { position: fixed; left: 0; top: 0; box-sizing: border-box; pointer-events: auto;
      display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 9px;
      border: 1px solid var(--review-line); background: var(--review-card); color: var(--review-text);
      box-shadow: var(--shadow-lift, 0 10px 28px -12px rgba(0, 0, 0, .3)); font: 13px/1.3 var(--review-font); }
    .marble-review-bar button { font: inherit; appearance: none; margin: 0; border: 0; background: none; color: inherit;
      position: relative; overflow: hidden; flex: none; display: inline-flex; align-items: center; gap: 5px;
      box-sizing: border-box; min-height: 28px; padding: 4px 9px; border-radius: 6px; font-weight: 500; white-space: nowrap;
      cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
      transition: background-color 120ms ${COLOUR}; }
    .marble-review-bar button:hover { background: var(--review-well); }
    .marble-review-bar button:active { background: color-mix(in srgb, var(--review-text) 10%, var(--review-card)); }
    .marble-review-bar button:focus-visible { outline: 2px solid var(--review-ink); outline-offset: 1px; }
    .marble-review-bar button:disabled { opacity: .55; cursor: default; }
    .marble-review-bar button > * { position: relative; }
    .marble-review-bar svg { width: 14px; height: 14px; flex: none; }
    /* Change more reads as the line it opens: words to type, not a button. */
    .marble-review-bar [data-act="more"] { flex: 1 1 auto; min-width: 0; justify-content: flex-start; padding-left: 8px;
      color: var(--review-faint); font-weight: 400; }
    .marble-review-bar [data-act="more"] > span { overflow: hidden; text-overflow: ellipsis; }
    .marble-review-bar [data-act="keep"] { color: var(--review-ink); }
    .marble-review-say { flex: 1 1 auto; min-width: 0; padding-left: 8px; color: var(--review-muted); }
    /* Holding Undo fills it across, at the pace of the hold: a meter of time,
       so it moves evenly. */
    .marble-review-fill { position: absolute !important; inset: 0 auto 0 0; width: 0; pointer-events: none;
      background: color-mix(in srgb, var(--review-accent) 30%, transparent); }
    .marble-review-bar button[data-holding] .marble-review-fill { width: 100%; transition: width ${HOLD_UNDO}ms linear; }
    @media (hover: none) {
      .marble-review-bar button { min-height: 44px; }
      .marble-review-tag button { position: relative; padding: 6px 10px 6px 9px; }
      .marble-review-tag button::after { content: ""; position: absolute; inset: -10px -4px; }
    }

    /* A word for a control whose word does not say it all. */
    .marble-review-tip { position: fixed; left: 0; top: 0; z-index: 2; margin: 0; padding: 6px 10px; box-sizing: border-box;
      max-width: 16rem; border-radius: 8px; border: 1px solid var(--review-line); background: var(--review-card);
      color: var(--review-text); box-shadow: var(--shadow, 0 1px 3px rgba(0, 0, 0, .12));
      font: 400 12.5px/1.35 var(--review-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      pointer-events: none; opacity: 1; transition: opacity 140ms ${COLOUR}; }
    @starting-style { .marble-review-tip { opacity: 0; } }
    .marble-review-tip[hidden] { display: none; }

    @media (prefers-reduced-motion: reduce) {
      .marble-review-group, .marble-review-group[data-state="lift"], .marble-review-tip { transition: none; }
    }
  `;

  const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const UNDO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 3 6.5l3 3"/><path d="M3.5 6.5H10a3 3 0 0 1 0 6H8"/></svg>';
  const REDO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5l3 3-3 3"/><path d="M12.5 6.5H6a3 3 0 0 0 0 6h2"/></svg>';
  // The tray's row: the old shape in dashes behind the new one, as a change is drawn.
  const CHANGES = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 17H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" stroke-dasharray="2.2 2.4"/><rect x="8" y="9" width="12" height="11" rx="2"/></svg>';

  // What each kind of change does, said as a verb.
  const VERB = { added: 'added', removed: 'removed', moved: 'moved', look: 'restyled', words: 'changed', changed: 'changed', attr: 'changed' };
  const VERBS = ['changed', 'added', 'removed', 'moved', 'restyled'];

  // What a copy of the page may not carry: nothing that runs, loads a sheet,
  // takes focus, submits, or names an element the page already names.
  const UNSAFE = new Set(['script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'template', 'noscript', 'dialog']);
  const UNSAFE_ATTRS = new Set(['id', 'tabindex', 'name', 'for', 'autofocus', 'autoplay', 'popover', 'popovertarget', 'popovertargetaction',
    'contenteditable', 'draggable', 'accesskey', 'form', 'formaction', 'action', 'srcdoc', 'ping']);
  // What a copy takes over from each element it copies, so it reads as the
  // page out of its place: the box, the type and the colours, not the size,
  // which the copy's own content decides.
  const LOOK = [
    'display', 'box-sizing', 'position', 'float', 'clear',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'box-shadow', 'opacity',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric', 'line-height', 'letter-spacing',
    'text-align', 'text-decoration-line', 'text-transform', 'text-indent', 'white-space', 'vertical-align', 'overflow-wrap', 'word-break',
    'list-style-type', 'list-style-position',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-content', 'align-self',
    'row-gap', 'column-gap', 'order',
    'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'grid-auto-columns', 'grid-auto-rows', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
    'border-collapse', 'border-spacing', 'table-layout', 'min-width', 'max-width',
  ];
  const REPLACED = /^(img|svg|video|canvas|picture|iframe|input|select|textarea|progress|meter)$/i;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app || typeof agent.review !== 'function') return;
    // The Agents page hosts its own conversation UI.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-review-host')) return;
    const app = marble.app;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);
    // The rule that takes the thing out of sight while its copy shows how it was.
    const hiding = document.createElement('style');
    hiding.setAttribute(TRANSIENT, '');
    document.head.append(hiding);

    // In the top layer, so a document's own stacking contexts cannot cover it.
    const host = document.createElement('div');
    host.className = 'marble-review-host';
    host.setAttribute(TRANSIENT, '');
    host.setAttribute('popover', 'manual');
    document.documentElement.append(host);
    try { host.showPopover(); } catch { /* no popover here: fixed positioning still stands */ }
    const aloud = document.createElement('div');
    aloud.className = 'marble-review-aloud';
    aloud.setAttribute(TRANSIENT, '');
    aloud.setAttribute('role', 'status');
    host.append(aloud);

    const h = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      el.setAttribute(TRANSIENT, '');
      return el;
    };
    const byId = (id) => {
      const el = id ? (marble.byId?.(id) ?? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`)) : null;
      return el && el.isConnected && !el.closest(`[${TRANSIENT}]`) ? el : null;
    };
    const unitOf = (el) => window.marbleChange?.unitOf?.(el) ?? ['part', 'parts'];
    const still = () => stillness.matches;
    const whole = (el) => !el || el === document.body || el === document.documentElement;
    const viewW = () => document.documentElement.clientWidth || innerWidth;
    const viewH = () => document.documentElement.clientHeight || innerHeight;
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, Math.max(lo, hi)));
    const opaque = (colour) => colour && colour !== 'transparent' && !/rgba?\([^)]*,\s*0\)$/.test(colour) && !/\/\s*0\)$/.test(colour);
    const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement ?? null);
    const deepActive = () => {
      let a = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      return a;
    };
    const wordsOf = (html) => {
      const t = document.createElement('template');
      t.innerHTML = String(html ?? '');
      return (t.content.textContent ?? '').replace(/\s+/g, ' ').trim();
    };

    // ------------------------------------------------------------ state

    let turns = [];               // the host's list for this page, newest first
    const known = new Map();      // turn id -> when this page first heard it was over (this page's clock)
    const keptHere = new Set();   // kept from here, before the host's list says so
    const undoneHere = [];        // { turn, at }: undone from here, newest last, for ⇧⌘Z
    const yours = new Set();      // `${turn}|${part}`: a person's own edit made it theirs
    let groups = [];
    let personAt = 0;             // the person's last own history change, this page's clock
    const views = new Set();      // what is drawn: one per change on screen
    let everything = false;       // Show what changed is up
    const ended = new Set();      // `${client}|${turn}`: changes whose end was heard here

    const undone = (id) => undoneHere.some((u) => u.turn === id);

    // ------------------------------------------------------------ one change, since you last kept

    /** Where a part is, or was: the element itself, and for a part that left
     *  its place, the place it left. */
    function anchorsOf(part) {
      if (part.kind === 'removed') {
        const parent = byId(part.parentId) ?? byId(part.beforeId)?.parentElement ?? null;
        return parent ? [parent] : [];
      }
      const el = byId(part.id);
      const out = el ? [el] : [];
      if (part.kind === 'moved') {
        const from = byId(part.parentId);
        if (from) out.push(from);
      }
      return out;
    }

    function common(els) {
      let at = els[0] ?? null;
      for (const el of els.slice(1)) while (at && !at.contains(el)) at = at.parentElement;
      return at;
    }

    /** The nearest block that holds all of `els`: a row for its cells, a
     *  table for its rows, never a run of words. The page itself is none. */
    function blockOf(els) {
      let at = common(els.filter(Boolean));
      while (at && !whole(at)) {
        if (/^(TD|TH)$/.test(at.tagName)) { at = at.parentElement; continue; }
        if (/^(TBODY|THEAD|TFOOT)$/.test(at.tagName)) { at = at.closest('table') ?? at.parentElement; continue; }
        const display = getComputedStyle(at).display;
        if (display.startsWith('inline') || display === 'contents' || !at.hasAttribute('data-marble-id')) { at = at.parentElement; continue; }
        break;
      }
      return whole(at) ? null : at;
    }

    /** Turns that touched the same part, or whose parts sit in the same block
     *  (or one block holds the other), are one change. */
    function rebuild() {
      const items = [];
      for (const turn of turns) {
        if (keptHere.has(turn.id) || undone(turn.id)) continue;
        const parts = (turn.parts ?? []).filter((p) => p?.id && !yours.has(`${turn.id}|${p.id}`));
        if (!parts.length) continue;
        const anchors = parts.flatMap(anchorsOf);
        if (!anchors.length) continue;
        items.push({ turn, parts, anchors, block: blockOf(anchors), ids: new Set(parts.map((p) => p.id)) });
      }
      const root = items.map((_, i) => i);
      const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          const shared = [...a.ids].some((id) => b.ids.has(id));
          const near = a.block && b.block && (a.block.contains(b.block) || b.block.contains(a.block));
          if (shared || near) root[find(i)] = find(j);
        }
      }
      const sets = new Map();
      items.forEach((item, i) => {
        const r = find(i);
        if (!sets.has(r)) sets.set(r, []);
        sets.get(r).push(item);
      });
      groups = [...sets.values()].map((members) => {
        // A part more than one ask touched is drawn as the first of them saw
        // it: what it was before this change began.
        const parts = new Map();
        for (const m of [...members].reverse()) for (const p of m.parts) if (!parts.has(p.id)) parts.set(p.id, { ...p, turn: m.turn.id });
        return {
          turns: members.map((m) => m.turn),
          members,
          parts: [...parts.values()],
          block: blockOf(members.flatMap((m) => m.anchors)),
        };
      });
      settleViews();
      offerTray();
    }

    const turnIds = (g) => new Set(g.turns.map((t) => t.id));
    const overlaps = (a, b) => { const ids = turnIds(b); return a.turns.some((t) => ids.has(t.id)); };

    /** The host's list moved on: each drawing follows its change, and one
     *  whose change is no longer waiting goes (kept or undone somewhere else). */
    function settleViews() {
      for (const view of [...views]) {
        if (view.state !== 'normal' || view.busy) continue;
        const next = groups.find((g) => overlaps(g, view.group));
        if (!next) { putAway(view); continue; }
        view.group = next;
      }
      if (everything) {
        for (const g of groups) if (!viewOf(g)) draw(g, 'all');
        if (!groups.length) everything = false;
      }
      schedule();
    }

    // ------------------------------------------------------------ asking the host

    let loading = null;
    let again = false;
    async function load() {
      if (loading) { again = true; return loading; }
      loading = (async () => {
        const asked = Date.now();
        try {
          const body = await agent.review(app);
          const now = Date.now();
          turns = Array.isArray(body?.turns) ? body.turns : [];
          for (const t of turns) if (!known.has(t.id)) known.set(t.id, now);
          // Undone from here and listed again, by a list asked for after the
          // undo: it was redone somewhere else.
          for (let i = undoneHere.length - 1; i >= 0; i -= 1) {
            const u = undoneHere[i];
            if (u.at < asked && turns.some((t) => t.id === u.turn)) undoneHere.splice(i, 1);
          }
          for (const id of [...keptHere]) if (!turns.some((t) => t.id === id)) keptHere.delete(id);
          rebuild();
        } catch {
          // The host could not say: what was known stands.
        }
      })();
      try { await loading; } finally { loading = null; }
      if (again) { again = false; await load(); }
    }
    let soonTimer = 0;
    const soon = () => { clearTimeout(soonTimer); soonTimer = setTimeout(load, SOON); };

    /** A change just ended here: the host writes the turn's own status last,
     *  after the frame that said so, so it is asked again, twice at most,
     *  until the turn is on its list. */
    function expect(turnId) {
      const waits = [SOON, 400, 1200];
      const step = async (i) => {
        await load();
        if (turns.some((t) => t.id === turnId) || keptHere.has(turnId) || i + 1 >= waits.length) return;
        setTimeout(() => step(i + 1), waits[i + 1]);
      };
      setTimeout(() => step(0), waits[0]);
    }

    // ------------------------------------------------------------ drawing

    let frame = 0;
    const schedule = () => { if (!frame && views.size) frame = requestAnimationFrame(render); };
    function render() {
      frame = 0;
      const hand = handNodes();
      for (const view of views) paint(view, hand);
    }

    /** The person's hand: focus in a part, or their caret in it. */
    function handNodes() {
      const out = [];
      const a = document.activeElement;
      if (a && a !== document.body && a !== document.documentElement && !a.closest?.(`[${TRANSIENT}]`)) out.push(a);
      const sel = getSelection?.();
      const at = elementOf(sel?.rangeCount ? sel.anchorNode : null);
      if (at?.isContentEditable && !at.closest(`[${TRANSIENT}]`)) out.push(at);
      return out;
    }

    function viewOf(group) {
      for (const view of views) if (view.state !== 'out' && view.state !== 'lift' && overlaps(view.group, group)) return view;
      return null;
    }

    function draw(group, by) {
      const view = makeView(group, by);
      views.add(view);
      paint(view, handNodes());
      return view;
    }

    function makeView(group, by) {
      const root = h('div', 'marble-review-group');
      const marks = h('div', 'marble-review-marks');
      marks.setAttribute('aria-hidden', 'true');
      const view = {
        group, by, state: 'normal', busy: false, root, marks, made: new Map(), shapes: new Map(),
        rect: null, area: [], leave: 0, focusFrom: null, before: null, undone: [], redoable: false,
      };
      view.tag = makeTag(view);
      view.bar = makeBar(view);
      root.append(marks, view.tag.root, view.bar.root);
      host.append(root);
      return view;
    }

    /** Away it goes: at once, a quick fade, or a slow lift once kept. The
     *  keys, if they were in its bar, go back to where they came from. */
    function putAway(view, { lift = false, keys = true } = {}) {
      if (view.state === 'out' || view.state === 'lift') return;
      hideBefore(view);
      clearTimeout(view.leave);
      const hadKeys = view.root.contains(document.activeElement);
      view.state = lift ? 'lift' : 'out';
      view.root.dataset.state = view.state;
      if (hadKeys && keys) {
        const back = view.focusFrom?.isConnected ? view.focusFrom : null;
        if (back) giveBack(back);
        else document.activeElement?.blur?.();
      }
      hideTip();
      const gone = () => { view.root.remove(); views.delete(view); };
      const ms = still() ? 0 : lift ? LIFT : OUT;
      if (ms) setTimeout(gone, ms);
      else gone();
    }

    /** The keys back to where they were, without that drawing the change
     *  again: it is going because the person put it away. */
    let returning = false;
    function giveBack(el) {
      returning = true;
      try { el.focus({ preventScroll: true }); } finally { returning = false; }
    }

    function hideAll() {
      everything = false;
      let any = false;
      for (const view of [...views]) if (view.state !== 'out' && view.state !== 'lift') { putAway(view); any = true; }
      return any;
    }

    function showAll() {
      everything = true;
      for (const view of views) if (view.state === 'normal') view.by = 'all';
      for (const g of groups) if (!viewOf(g)) draw(g, 'all');
      // Placed once each knows where the others are.
      schedule();
    }

    // --------------------------------------------------- geometry of a part

    /** A part's own shape, read once per element: a part with an edge or a
     *  fill is tinted to its corners; words get a little room round them. */
    function shapeOf(view, el) {
      let shape = view.shapes.get(el);
      if (shape) return shape;
      const css = getComputedStyle(el);
      shape = {
        shaped: parseFloat(css.borderTopWidth) > 0 || opaque(css.backgroundColor) || (css.boxShadow && css.boxShadow !== 'none'),
        inline: css.display.startsWith('inline'),
        radius: css.borderRadius || '0px',
        rounded: parseFloat(css.borderTopLeftRadius) > 0,
      };
      view.shapes.set(el, shape);
      return shape;
    }
    function partBox(view, el, r) {
      const s = shapeOf(view, el);
      if (s.shaped) return { left: r.left, top: r.top, width: r.width, height: r.height, radius: s.radius };
      const x = s.inline ? 3 : 0;
      const y = s.inline ? 1 : 0;
      return { left: r.left - x, top: r.top - y, width: r.width + x * 2, height: r.height + y * 2, radius: s.rounded ? s.radius : '4px' };
    }
    /** New words are tinted where the words are, not across the column a
     *  heading or a paragraph spans. */
    function wordsBox(view, el, r) {
      const s = shapeOf(view, el);
      if (s.shaped || s.inline) return partBox(view, el, r);
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      if (!t.width || !t.height) return partBox(view, el, r);
      return { left: t.left - 3, top: t.top - 1, width: t.width + 6, height: t.height + 2, radius: '4px' };
    }

    /** Where a part that left stood: at the top of the part that came after
     *  it, or else after the last thing in what held it. */
    function oldPlace(part) {
      const next = byId(part.beforeId);
      const parent = byId(part.parentId) ?? next?.parentElement ?? null;
      if (next && next.getAttribute('data-marble-id') !== part.id && (!parent || parent.contains(next))) {
        const r = next.getBoundingClientRect();
        if (r.width || r.height) return { left: r.left, top: r.top, width: r.width, ref: next };
      }
      if (!parent) return null;
      const kids = [...parent.children].filter((k) => !k.hasAttribute(TRANSIENT) && k.getAttribute('data-marble-id') !== part.id);
      const last = kids.at(-1);
      if (last) {
        const r = last.getBoundingClientRect();
        if (r.width || r.height) return { left: r.left, top: r.bottom, width: r.width, ref: last };
      }
      const r = parent.getBoundingClientRect();
      const css = getComputedStyle(parent);
      const left = r.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft);
      const right = r.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight);
      return { left, top: r.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop), width: Math.max(0, right - left), ref: null };
    }

    /** The shape a look change took away: the element copied into this layer
     *  with its old value, out of sight at the same place, measured, and
     *  gone again. Read once per element. */
    function oldShape(view, part, el, r) {
      const cached = view.shapes.get(`old:${part.id}`);
      if (cached && cached.el === el) return cached;
      const css = getComputedStyle(el.parentElement ?? el);
      const room = document.createElement('div');
      room.setAttribute(TRANSIENT, '');
      room.style.cssText = `position:fixed;left:0;top:0;width:0;height:0;overflow:visible;visibility:hidden;pointer-events:none;`
        + `font:${css.font};line-height:${css.lineHeight};letter-spacing:${css.letterSpacing};color:${css.color};white-space:${css.whiteSpace}`;
      const copy = el.cloneNode(true);
      sanitize(copy);
      if (part.before == null) copy.removeAttribute(part.name);
      else copy.setAttribute(part.name, part.before);
      const sized = part.name === 'style' && /(^|;)\s*width\s*:/i.test(String(part.before ?? ''));
      for (const [k, v] of [['position', 'fixed'], ['left', `${r.left}px`], ['top', `${r.top}px`], ['margin', '0'],
        ['visibility', 'hidden'], ['transition', 'none'], ['animation', 'none'], ['box-sizing', 'border-box'],
        ...(sized ? [] : [['width', `${r.width}px`]])]) copy.style.setProperty(k, v, 'important');
      room.append(copy);
      host.append(room);
      const got = copy.getBoundingClientRect();
      const was = getComputedStyle(copy);
      const shape = {
        el, dx: got.left - r.left, dy: got.top - r.top, width: got.width, height: got.height,
        radius: `${was.borderTopLeftRadius} ${was.borderTopRightRadius} ${was.borderBottomRightRadius} ${was.borderBottomLeftRadius}`,
      };
      room.remove();
      view.shapes.set(`old:${part.id}`, shape);
      return shape;
    }

    // --------------------------------------------------------- copies of the page

    /** Nothing that runs, loads, takes focus or names an element; ids kept
     *  only while the copy still has inverses to take by id. */
    function sanitize(root, { ids = false } = {}) {
      const all = root.nodeType === 11 ? [...root.querySelectorAll('*')] : [root, ...root.querySelectorAll('*')];
      for (const el of all) {
        const tag = el.localName?.toLowerCase();
        if (UNSAFE.has(tag) || el.hasAttribute('popover') || (el !== root && el.hasAttribute(TRANSIENT))) { el.remove(); continue; }
        for (const { name } of [...el.attributes]) {
          const n = name.toLowerCase();
          if (n.startsWith('on') || UNSAFE_ATTRS.has(n)) el.removeAttribute(name);
          else if (n.startsWith('data-marble') && !(ids && n === 'data-marble-id')) el.removeAttribute(name);
          else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*javascript:/i.test(el.getAttribute(name) ?? '')) el.removeAttribute(name);
        }
        // A custom element in a copy would come to life as a second one of
        // itself (open streams, mount a drawer): it stays a plain box.
        if (tag?.includes('-') && el !== root && el.namespaceURI === 'http://www.w3.org/1999/xhtml') {
          const box = document.createElement('div');
          for (const { name, value } of [...el.attributes]) box.setAttribute(name, value);
          box.append(...el.childNodes);
          el.replaceWith(box);
        }
      }
      return root;
    }
    function fragmentOf(html, { ids = false } = {}) {
      const t = document.createElement('template');
      t.innerHTML = String(html ?? '');
      return sanitize(t.content, { ids });
    }

    /** A removed part, as it was, in a frame of its own kind: a row in a
     *  table, an item in a list. */
    function ghostOf(part, place) {
      const frag = fragmentOf(part.html);
      const el = frag.firstElementChild;
      if (!el) return null;
      const tag = el.localName;
      let body = el;
      if (tag === 'tr' || tag === 'td' || tag === 'th') {
        const table = document.createElement('table');
        const tbody = document.createElement('tbody');
        const row = tag === 'tr' ? el : document.createElement('tr');
        if (row !== el) row.append(el);
        tbody.append(row);
        table.append(tbody);
        // The columns of the row that took its place.
        const ref = place?.ref?.localName === 'tr' ? [...place.ref.children] : [];
        [...row.children].forEach((cell, i) => {
          const w = ref[i]?.getBoundingClientRect().width;
          if (w) cell.style.width = `${w}px`;
        });
        body = table;
      } else if (tag === 'li') {
        body = document.createElement(byId(part.parentId)?.localName === 'ol' ? 'ol' : 'ul');
        body.append(el);
      } else if (tag === 'dt' || tag === 'dd') {
        body = document.createElement('dl');
        body.append(el);
      }
      const ghost = h('i', 'marble-review-ghost');
      ghost.dataset.id = part.id;
      ghost.inert = true;
      // Written in the type and on the paper of what it stood in.
      const parent = byId(part.parentId) ?? place?.ref?.parentElement ?? null;
      if (parent) {
        const css = getComputedStyle(parent);
        Object.assign(ghost.style, { font: css.font, lineHeight: css.lineHeight, color: css.color, letterSpacing: css.letterSpacing });
        let paper = parent;
        while (paper && !opaque(getComputedStyle(paper).backgroundColor)) paper = paper.parentElement;
        if (paper) ghost.style.setProperty('--review-ghost-paper', getComputedStyle(paper).backgroundColor);
      }
      ghost.append(body);
      return ghost;
    }

    /** The thing as it was before this change: a copy of the change's block,
     *  wearing each element's look as it stands, with every ask's inverse
     *  applied to the copy by id, newest ask first. Nothing is undone. */
    function beforeOf(view) {
      const block = view.group.block ?? document.body;
      const copy = block.cloneNode(true);
      const from = [block, ...block.querySelectorAll('*')];
      const to = [copy, ...copy.querySelectorAll('*')];
      const own = new WeakMap();
      const n = Math.min(from.length, to.length, LOOKS);
      for (let i = 0; i < n; i += 1) {
        const css = getComputedStyle(from[i]);
        own.set(to[i], from[i].getAttribute('style'));
        let text = LOOK.map((p) => `${p}:${css.getPropertyValue(p)}`).join(';');
        if (i === 0) text += `;position:static;margin:0;box-sizing:border-box;width:${block.getBoundingClientRect().width}px`;
        else if (REPLACED.test(from[i].localName)) text += `;width:${css.width};height:${css.height}`;
        to[i].setAttribute('style', text);
      }
      // In the same task the copy was made in, so no handler it carried ever
      // hears an event; ids stay until the inverses have found their parts.
      sanitize(copy, { ids: true });
      const find = (id) => {
        if (id == null) return null;
        if (copy.getAttribute('data-marble-id') === id) return copy;
        return copy.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
      };
      for (const member of view.group.members) {
        for (const part of [...member.parts].reverse()) {
          const el = find(part.id);
          switch (part.kind) {
            case 'added':
              if (el && el !== copy) el.remove();
              break;
            case 'words':
            case 'changed':
              if (el) el.replaceChildren(fragmentOf(part.before, { ids: true }));
              break;
            case 'look':
            case 'attr':
              if (!el) break;
              // Its old look is its own again, not the one copied from now.
              if (part.kind === 'look') {
                const was = own.get(el);
                if (was == null) el.removeAttribute('style');
                else el.setAttribute('style', was);
              }
              if (part.before == null) el.removeAttribute(part.name);
              else el.setAttribute(part.name, part.before);
              break;
            case 'removed': {
              const parent = find(part.parentId);
              if (!parent) break;
              const next = find(part.beforeId);
              const frag = fragmentOf(part.html, { ids: true });
              if (next && next.parentElement === parent) parent.insertBefore(frag, next);
              else parent.append(frag);
              break;
            }
            case 'moved': {
              const parent = find(part.parentId);
              if (!el || !parent || el === copy) break;
              const next = find(part.beforeId);
              if (next && next !== el && next.parentElement === parent) parent.insertBefore(el, next);
              else parent.append(el);
              break;
            }
            default:
          }
        }
      }
      sanitize(copy);
      if (block === document.body) {
        const div = document.createElement('div');
        div.setAttribute('style', copy.getAttribute('style') ?? '');
        div.append(...copy.childNodes);
        return { block, copy: div };
      }
      return { block, copy };
    }

    function showBefore(view) {
      if (view.before || view.state !== 'normal' || view.busy) return;
      let made;
      try { made = beforeOf(view); } catch { return; }
      const wrap = h('div', 'marble-review-before');
      wrap.inert = true;
      wrap.setAttribute('aria-hidden', 'true');
      wrap.append(made.copy);
      view.root.prepend(wrap);
      view.before = { wrap, block: made.block };
      const id = made.block.getAttribute('data-marble-id');
      const sel = id ? `[data-marble-id="${id.replace(/["\\]/g, '\\$&')}"]` : null;
      hiding.textContent = made.block === document.body
        ? `body > :not([${TRANSIENT}]) { visibility: hidden !important; }`
        : sel ? `${sel} { visibility: hidden !important; }` : '';
      view.tag.root.toggleAttribute('data-held', true);
      aloud.textContent = 'Before';
      paint(view, handNodes());
    }

    function hideBefore(view) {
      if (!view.before) return;
      view.before.wrap.remove();
      view.before = null;
      hiding.textContent = '';
      view.tag.root.removeAttribute('data-held');
      schedule();
    }

    // ------------------------------------------------------------ painting

    function makeMark(view, spec) {
      const { part } = spec;
      let el;
      switch (spec.kind) {
        case 'add': el = h('i', 'marble-review-add'); break;
        case 'tint':
          el = h('i', 'marble-review-tint');
          el.dataset.kind = part.kind;
          break;
        case 'was': {
          const text = wordsOf(part.before);
          if (!text) return null;
          el = h('div', 'marble-review-was', text);
          break;
        }
        case 'outline': el = h('i', 'marble-review-outline'); break;
        case 'gap': el = h('i', 'marble-review-gap'); break;
        case 'ghost': el = ghostOf(part, spec.at); break;
        default: return null;
      }
      if (!el) return null;
      el.dataset.id = part.id;
      return el;
    }

    function place(el, b) {
      el.style.left = `${Math.round(b.left)}px`;
      el.style.top = `${Math.round(b.top)}px`;
      if (b.width !== undefined) el.style.width = `${Math.round(b.width)}px`;
      if (b.height !== undefined) el.style.height = `${Math.round(b.height)}px`;
      if (b.radius !== undefined) el.style.borderRadius = b.radius;
    }

    function union(rects) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const r of rects) {
        if (!r || (!r.width && !r.height)) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.left + r.width); bottom = Math.max(bottom, r.top + r.height);
      }
      return left === Infinity ? null : { left, top, width: right - left, height: bottom - top, right, bottom };
    }

    function paint(view, hand) {
      if (view.state === 'out' || view.state === 'lift') return;
      const { group } = view;
      const marking = view.state === 'normal' && !view.before && !view.busy;
      const specs = [];
      const boxes = [];
      for (const part of group.parts) {
        if (part.kind === 'removed') {
          if (!marking) continue;
          const at = oldPlace(part);
          if (at) specs.push({ key: `ghost:${part.id}`, part, kind: 'ghost', at });
          continue;
        }
        const el = byId(part.id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        boxes.push(r);
        if (!marking) continue;
        // A part with the person's hand in it is theirs to work in, unless it
        // was their focus moving in that asked for the drawing.
        if (view.by !== 'focus' && hand.some((node) => el.contains(node))) continue;
        const b = partBox(view, el, r);
        switch (part.kind) {
          case 'added':
            specs.push({ key: `add:${part.id}`, part, kind: 'add', box: b });
            break;
          case 'words':
          case 'changed': {
            const w = part.kind === 'words' ? wordsBox(view, el, r) : b;
            specs.push({ key: `tint:${part.id}`, part, kind: 'tint', box: w });
            specs.push({ key: `was:${part.id}`, part, kind: 'was', at: { left: w.left, top: w.top + w.height + 2 }, max: Math.max(r.width, 200) });
            break;
          }
          case 'look': {
            const o = oldShape(view, part, el, r);
            if (o) specs.push({ key: `outline:${part.id}`, part, kind: 'outline', box: { left: r.left + o.dx, top: r.top + o.dy, width: o.width, height: o.height, radius: o.radius } });
            break;
          }
          case 'attr':
            specs.push({ key: `tint:${part.id}`, part, kind: 'tint', box: b });
            break;
          case 'moved': {
            specs.push({ key: `tint:${part.id}`, part, kind: 'tint', box: b });
            const at = oldPlace(part);
            if (at) specs.push({ key: `gap:${part.id}`, part, kind: 'gap', at: { left: at.left, top: at.top, width: at.width } });
            break;
          }
          default:
        }
      }

      // Write the marks: only what moved, and nothing made twice. Old words
      // and ghosts are measured once, when made; after that a paint (one a
      // frame while the page scrolls) reads nothing back.
      const seen = new Set();
      const vw = viewW();
      const drawn = [];
      for (const spec of specs) {
        seen.add(spec.key);
        let el = view.made.get(spec.key);
        const fresh = !el;
        if (!el) {
          el = makeMark(view, spec);
          if (!el) continue;
          view.made.set(spec.key, el);
          view.marks.append(el);
        }
        if (spec.box) {
          place(el, spec.box);
          drawn.push(spec.box);
          continue;
        }
        place(el, { left: spec.at.left, top: spec.at.top, width: spec.kind === 'was' ? undefined : spec.at.width });
        if (spec.kind === 'was' && fresh) el.style.maxWidth = `${Math.round(Math.max(80, Math.min(spec.max, vw - INSIDE - spec.at.left)))}px`;
        if (fresh || !el.marbleSize) el.marbleSize = [el.offsetWidth, el.offsetHeight];
        drawn.push({ left: spec.at.left, top: spec.at.top, width: el.marbleSize[0], height: el.marbleSize[1] });
      }
      for (const [key, el] of view.made) if (!seen.has(key)) { el.remove(); view.made.delete(key); }

      // What the change covers: its block, or the parts themselves when it
      // is spread across the page; and what is drawn for it.
      const block = group.block?.isConnected ? group.block.getBoundingClientRect() : null;
      const rect = (block && (block.width || block.height) ? union([block, ...boxes]) : union(boxes)) ?? union(drawn) ?? view.rect;
      if (!rect) { view.tag.root.hidden = true; view.bar.root.hidden = true; return; }
      view.rect = rect;
      const under = Math.max(rect.bottom, ...drawn.map((d) => d.top + d.height));

      if (view.before) {
        const b = view.before.block.getBoundingClientRect();
        place(view.before.wrap, { left: b.left, top: b.top, width: b.width });
      }

      fillTag(view);
      fillBar(view);
      const vh = viewH();
      const offscreen = rect.bottom < 0 || rect.top > vh;
      view.tag.root.hidden = offscreen || view.state !== 'normal';
      view.bar.root.hidden = offscreen;
      if (offscreen) { view.area = [rect]; return; }

      // The bar: flush under the change, as wide as it is; above it when
      // there is no room below, or when below is another change drawn at
      // the same time (Show what changed) and above is clear.
      const bar = view.bar.root;
      const width = Math.round(Math.min(Math.max(rect.width, NARROW), vw - INSIDE * 2));
      const sizeKey = `${view.bar.key}|${width}`;
      if (view.bar.sizeKey !== sizeKey) {
        bar.style.width = `${width}px`;
        view.bar.sizeKey = sizeKey;
        view.bar.height = bar.offsetHeight;
      }
      const bh = view.bar.height;
      const left = clamp(rect.left, INSIDE, vw - INSIDE - width);
      const others = [...views].filter((v) => v !== view && v.rect && v.state !== 'out' && v.state !== 'lift')
        .map((v) => ({ left: v.rect.left, top: v.rect.top - 30, width: v.rect.width, height: v.rect.height + 30 }));
      const hits = (b) => others.some((o) => b.left < o.left + o.width && b.left + b.width > o.left && b.top < o.top + o.height && b.top + b.height > o.top);
      let top = under + GAP;
      const above = rect.top - GAP - bh;
      const roomAbove = above >= INSIDE;
      let flip = false;
      if (roomAbove && (top + bh > vh - INSIDE
        || (hits({ left, top, width, height: bh }) && !hits({ left, top: above, width, height: bh })))) { top = above; flip = true; }
      top = clamp(top, INSIDE, vh - INSIDE - bh);
      place(bar, { left, top });

      // The tag: across the top edge of a block with an edge of its own, near
      // its start, as the marks hang theirs; else over its top-left corner;
      // over the bar when the bar had to go above.
      const tag = view.tag.root;
      let tagBox = null;
      if (!tag.hidden) {
        if (view.tag.sizeKey !== view.tag.key) {
          view.tag.sizeKey = view.tag.key;
          view.tag.size = [view.tag.press.offsetWidth, view.tag.press.offsetHeight];
        }
        const [tw, th] = view.tag.size;
        const edged = !flip && group.block?.isConnected && shapeOf(view, group.block).shaped;
        const tx = clamp(edged ? rect.left + 12 : rect.left, INSIDE, vw - INSIDE - tw);
        const ty = clamp(edged ? rect.top - th / 2 : (flip ? top : rect.top) - 6 - th, INSIDE, vh - INSIDE - th);
        tag.toggleAttribute('data-edge', Boolean(edged));
        place(tag, { left: tx, top: ty });
        tagBox = { left: tx, top: ty, width: tw, height: th };
      }
      view.area = [rect, ...drawn, { left, top, width, height: bh }, tagBox].filter(Boolean);
    }

    // ------------------------------------------------------------ the tag

    function unitFor(part) {
      if (part.unit) return part.unit;
      let el = null;
      if (part.kind === 'removed') el = fragmentOf(part.html).firstElementChild;
      else el = byId(part.id);
      part.unit = el ? unitOf(el) : ['part', 'parts'];
      return part.unit;
    }

    /** What the tag says, in pieces: "3 dates added", "3 changed · 1 added",
     *  and "· 2 asks" when more than one ask made it. */
    function tagPieces(group) {
      const counts = new Map();
      const units = new Map();
      for (const part of group.parts) {
        const verb = VERB[part.kind] ?? 'changed';
        counts.set(verb, (counts.get(verb) ?? 0) + 1);
        if (!units.has(verb)) units.set(verb, new Set());
        units.get(verb).add(unitFor(part).join('|'));
      }
      const verbs = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || VERBS.indexOf(a) - VERBS.indexOf(b));
      const pieces = [];
      if (verbs.length === 1) {
        const verb = verbs[0];
        const n = counts.get(verb);
        const named = units.get(verb);
        const [one, many] = named.size === 1 ? [...named][0].split('|') : ['part', 'parts'];
        pieces.push([n, `${n === 1 ? one : many} ${verb}`]);
      } else {
        for (const verb of verbs) pieces.push([counts.get(verb), verb]);
      }
      if (group.turns.length > 1) pieces.push([group.turns.length, 'asks']);
      return pieces;
    }
    const said = (pieces) => pieces.map(([n, words]) => `${n} ${words}`).join(' · ');

    function makeTag(view) {
      const root = h('div', 'marble-review-tag');
      const press = h('button');
      press.type = 'button';
      const words = h('span', 'marble-review-said');
      press.append(words);
      root.append(press);
      const tag = { root, press, words, key: '' };

      // Held, it shows the thing as it was; let go, the change is back.
      let timer = 0;
      const let_go = () => { clearTimeout(timer); hideBefore(view); };
      press.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        try { press.setPointerCapture(event.pointerId); } catch { /* the pointer is gone already */ }
        clearTimeout(timer);
        timer = setTimeout(() => showBefore(view), HOLD_TAG);
      });
      press.addEventListener('pointerup', let_go);
      press.addEventListener('pointercancel', let_go);
      press.addEventListener('lostpointercapture', let_go);
      press.addEventListener('contextmenu', (event) => event.preventDefault());
      press.addEventListener('keydown', (event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        if (!event.repeat) showBefore(view);
      });
      press.addEventListener('keyup', (event) => { if (event.key === ' ' || event.key === 'Enter') let_go(); });
      press.addEventListener('blur', let_go);
      tipOn(press, () => 'Hold to see it before');
      return tag;
    }

    function fillTag(view) {
      const pieces = view.before ? null : tagPieces(view.group);
      const key = pieces ? JSON.stringify(pieces) : 'before';
      if (view.tag.key === key) return;
      view.tag.key = key;
      const node = view.tag.words;
      node.replaceChildren();
      if (!pieces) node.append('Before');
      else {
        pieces.forEach(([n, words], i) => {
          if (i) node.append(' · ');
          const b = document.createElement('b');
          b.textContent = String(n);
          node.append(b, ` ${words}`);
        });
      }
      const name = pieces ? said(pieces) : 'Before';
      view.tag.press.setAttribute('aria-label', `${name}. Hold to see it before`);
    }

    // ------------------------------------------------------------ the bar

    function makeBar(view) {
      const root = h('div', 'marble-review-bar');
      root.setAttribute('role', 'group');
      const button = (act, label, icon = '') => {
        const b = h('button');
        b.type = 'button';
        b.dataset.act = act;
        b.innerHTML = `${icon}<span>${label}</span>`;
        return b;
      };
      const more = button('more', 'Change more');
      const keep = button('keep', 'Keep', CHECK);
      const undo = button('undo', 'Undo', UNDO);
      const fill = h('i', 'marble-review-fill');
      fill.setAttribute('aria-hidden', 'true');
      undo.prepend(fill);
      const redo = button('redo', 'Redo', REDO);
      const say = h('span', 'marble-review-say', 'Undone');
      const bar = { root, more, keep, undo, redo, say, key: '' };

      more.addEventListener('click', () => changeMore(view));
      keep.addEventListener('click', () => keepView(view));
      redo.addEventListener('click', () => redoView(view));

      // Press: the last ask. Hold: every ask since the last Keep.
      let holding = 0;
      let held = false;
      const stop = () => { clearTimeout(holding); undo.removeAttribute('data-holding'); };
      undo.addEventListener('pointerdown', (event) => {
        held = false;
        if (event.button !== 0 || view.group.turns.length < 2) return;
        undo.toggleAttribute('data-holding', true);
        holding = setTimeout(() => {
          held = true;
          stop();
          undoTurns(view, [...view.group.turns]);
        }, HOLD_UNDO);
      });
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) undo.addEventListener(type, stop);
      undo.addEventListener('contextmenu', (event) => { if (view.group.turns.length > 1) event.preventDefault(); });
      undo.addEventListener('click', () => {
        if (held) { held = false; return; }
        stop();
        undoTurns(view, view.group.turns.slice(0, 1));
      });
      tipOn(undo, () => (view.group.turns.length > 1 ? `Hold to undo all ${view.group.turns.length}` : null));
      return bar;
    }

    function fillBar(view) {
      const bar = view.bar;
      const want = view.state === 'undone' ? (view.redoable ? [bar.say, bar.redo] : [bar.say]) : [bar.more, bar.keep, bar.undo];
      const key = view.state === 'undone' ? `undone:${view.redoable}` : 'normal';
      if (bar.key !== key) {
        const hadKeys = bar.root.contains(document.activeElement);
        bar.key = key;
        bar.root.replaceChildren(...want);
        if (hadKeys) (want.find((el) => el.localName === 'button') ?? null)?.focus({ preventScroll: true });
      }
      for (const b of [bar.more, bar.keep, bar.undo, bar.redo]) b.disabled = view.busy;
      const n = view.group.turns.length;
      if (n > 1) bar.undo.setAttribute('aria-description', `Hold to undo all ${n}`);
      else bar.undo.removeAttribute('aria-description');
      const name = view.state === 'undone' ? 'Undone' : said(tagPieces(view.group));
      if (bar.root.getAttribute('aria-label') !== name) bar.root.setAttribute('aria-label', name);
    }

    // ------------------------------------------------------------ verdicts

    /** Keep: the change is the page now. Its drawing lifts and never shows
     *  again, and the chat it came from is reviewed when nothing of it is
     *  left waiting. */
    async function keepView(view) {
      const list = [...view.group.turns];
      for (const t of list) keptHere.add(t.id);
      // Lifting before the list moves on, and the keys going back after it,
      // so neither puts it away twice nor draws it again.
      const back = view.root.contains(document.activeElement) ? view.focusFrom : null;
      putAway(view, { lift: true, keys: false });
      rebuild();
      if (back?.isConnected) giveBack(back);
      else if (view.root.contains(document.activeElement)) document.activeElement.blur();
      aloud.textContent = 'Kept';
      await Promise.allSettled(list.map((t) => agent.keep(t.id)));
      // Other listeners still hear that these chats were reviewed here.
      for (const id of new Set(list.map((t) => t.conversationId))) {
        document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id } }));
      }
      await load();
    }

    /** Undo, newest first. The marks and the engine play it as it lands
     *  (agent-undo frames); the bar says so and offers Redo while you are here. */
    async function undoTurns(view, list) {
      if (!list.length) return;
      if (view) { view.busy = true; hideBefore(view); paint(view, handNodes()); }
      const done = [];
      for (const turn of list) {
        try {
          await agent.undo(turn.id);
        } catch {
          break;
        }
        done.push(turn);
        undoneHere.push({ turn: turn.id, at: Date.now() });
      }
      if (view && views.has(view)) {
        view.busy = false;
        if (done.length) {
          view.state = 'undone';
          view.undone = done;
          view.redoable = true;
        }
        paint(view, handNodes());
      }
      if (done.length) aloud.textContent = 'Undone';
      rebuild();
      await load();
    }

    /** Redo puts back what this bar undid, the oldest first. A turn with
     *  nothing kept to redo it from (a whole-file restore) offers none. */
    async function redoTurns(view, ids) {
      if (view) { view.busy = true; paint(view, handNodes()); }
      let ok = 0;
      for (const id of ids) {
        try {
          await agent.redo(id);
        } catch {
          if (view) view.redoable = false;
          break;
        }
        ok += 1;
        const at = undoneHere.findIndex((u) => u.turn === id);
        if (at >= 0) undoneHere.splice(at, 1);
        known.set(id, Date.now());
      }
      // Back on the host's list before the drawing comes back over it.
      await load();
      if (view && views.has(view)) {
        view.busy = false;
        if (ok === ids.length) { view.state = 'normal'; view.undone = []; }
        settleViews();
        paint(view, handNodes());
      }
      if (ok) aloud.textContent = 'Redone';
    }
    const redoView = (view) => redoTurns(view, [...view.undone].reverse().map((t) => t.id));

    /** Change more: the line, on what the change made, carrying on the chat
     *  that made it. */
    function changeMore(view) {
      const g = view.group;
      const present = g.parts.filter((p) => p.kind !== 'removed').map((p) => byId(p.id)).filter(Boolean);
      const outer = present.filter((el) => !present.some((o) => o !== el && o.contains(el)));
      let ids = outer.map((el) => el.getAttribute('data-marble-id'));
      if (!ids.length && g.block) ids = [g.block.getAttribute('data-marble-id')];
      const conversation = g.turns[0]?.conversationId ?? null;
      putAway(view, { keys: false });
      if (window.marbleLine?.open) window.marbleLine.open({ ids, conversation, from: 'review' });
      else agent.open?.(conversation);
    }

    // ------------------------------------------------------------ tips

    const tip = h('div', 'marble-review-tip');
    tip.setAttribute('role', 'tooltip');
    tip.id = `marble-review-tip-${Math.random().toString(36).slice(2, 9)}`;
    tip.hidden = true;
    host.append(tip);
    let tipTimer = 0;
    function tipOn(el, text) {
      el.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        clearTimeout(tipTimer);
        tipTimer = setTimeout(() => showTip(el, text()), TIP);
      });
      el.addEventListener('pointerleave', hideTip);
      el.addEventListener('pointerdown', hideTip);
      el.addEventListener('blur', hideTip);
      el.addEventListener('focus', () => { if (el.matches(':focus-visible')) showTip(el, text()); });
    }
    function showTip(el, text) {
      clearTimeout(tipTimer);
      if (!text || !el.isConnected) return;
      tip.textContent = text;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const w = tip.offsetWidth;
      const th = tip.offsetHeight;
      let top = r.top - 8 - th;
      if (top < INSIDE) top = r.bottom + 8;
      place(tip, { left: clamp(r.left + r.width / 2 - w / 2, INSIDE, viewW() - INSIDE - w), top });
      el.setAttribute('aria-describedby', tip.id);
    }
    function hideTip() {
      clearTimeout(tipTimer);
      tip.hidden = true;
    }

    // ------------------------------------------------------------ rest, and leaving

    let pointer = null;
    let restAt = null;
    let restTimer = 0;
    let pressing = false;
    const inside = (view, p) => Boolean(p) && view.area.some((r) => p.x >= r.left - 1 && p.x <= r.left + r.width + 1 && p.y >= r.top - 1 && p.y <= r.top + r.height + 1);

    /** Something else has the page: the line is open, pointing or Describe is
     *  on, or a change is still being made. (Words being selected hold the
     *  pointer down, which a rest already waits out.) */
    function busyElsewhere() {
      if (window.marbleLine?.current?.()) return true;
      if (document.documentElement.classList.contains('marble-callout-latched')) return true;
      const marks = document.querySelector('.marble-marks-layer');
      if (marks?.dataset.mode || marks?.hasAttribute('data-describing')) return true;
      return (window.marbleChange?.runs?.() ?? []).some((r) => String(r.client).startsWith('agent:') && !ended.has(`${r.client}|${r.turn}`));
    }

    /** What the pointer is on belongs to a change: it is in a changed part,
     *  or in the block the change happened in. The innermost wins. */
    function groupAt(target) {
      let best = null;
      let depth = -1;
      for (const g of groups) {
        let hit = null;
        for (const p of g.parts) {
          for (const el of anchorsOf(p)) if (!whole(el) && el.contains(target)) { hit = el; break; }
          if (hit) break;
        }
        if (!hit && g.block?.contains(target)) hit = g.block;
        if (!hit) continue;
        let d = 0;
        for (let n = hit; n; n = n.parentElement) d += 1;
        if (d > depth) { best = g; depth = d; }
      }
      return best;
    }

    function onRest() {
      if (!pointer || !groups.length || pressing || busyElsewhere()) return;
      const target = document.elementFromPoint(pointer.x, pointer.y);
      if (!target || host.contains(target) || target.closest(`[${TRANSIENT}]`) || target.getRootNode() !== document) return;
      const g = groupAt(target);
      if (!g || viewOf(g)) return;
      for (const view of [...views]) if (view.by === 'rest' && view.state === 'normal') putAway(view);
      draw(g, 'rest');
    }

    function checkLeave() {
      for (const view of views) {
        if (view.state === 'out' || view.state === 'lift' || view.by !== 'rest') continue;
        if (inside(view, pointer) || view.before) { clearTimeout(view.leave); view.leave = 0; continue; }
        if (!view.leave) view.leave = setTimeout(() => { view.leave = 0; if (!inside(view, pointer)) putAway(view); }, LEAVE);
      }
    }

    addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!restAt || Math.hypot(pointer.x - restAt.x, pointer.y - restAt.y) >= DRIFT) {
        restAt = pointer;
        clearTimeout(restTimer);
        restTimer = setTimeout(onRest, REST);
      }
      checkLeave();
    }, { capture: true, passive: true });
    document.documentElement.addEventListener('pointerleave', () => { pointer = null; clearTimeout(restTimer); checkLeave(); });

    // A press on empty page puts the drawing away; one in the change or its
    // bar does not.
    addEventListener('pointerdown', (event) => {
      pressing = true;
      clearTimeout(restTimer);
      if (host.contains(event.composedPath()[0])) return;
      const p = { x: event.clientX, y: event.clientY };
      const shown = [...views].filter((v) => v.state !== 'out' && v.state !== 'lift');
      if (everything) {
        if (!shown.some((v) => inside(v, p))) hideAll();
        return;
      }
      for (const view of shown) if (!inside(view, p)) putAway(view);
    }, true);
    addEventListener('pointerup', () => { pressing = false; }, true);
    addEventListener('pointercancel', () => { pressing = false; }, true);

    // ------------------------------------------------------------ focus

    const holding = (view, node) => view.group.parts.some((p) => p.kind !== 'removed' && byId(p.id)?.contains(node));

    document.addEventListener('focusin', (event) => {
      const t = event.composedPath()[0] ?? event.target;
      if (!(t instanceof Element) || host.contains(t) || returning) return;
      for (const view of [...views]) if (view.by === 'focus' && view.state !== 'out' && view.state !== 'lift' && !holding(view, t)) putAway(view, { keys: false });
      if (t.closest(`[${TRANSIENT}]`) || t.getRootNode() !== document) return;
      const g = groups.find((one) => one.parts.some((p) => p.kind !== 'removed' && byId(p.id)?.contains(t)));
      if (!g) return;
      const drawn = viewOf(g);
      if (drawn) {
        if (drawn.by !== 'all') drawn.by = 'focus';
        drawn.focusFrom = t;
        schedule();
        return;
      }
      for (const view of [...views]) if (view.by === 'rest' && view.state === 'normal') putAway(view);
      draw(g, 'focus').focusFrom = t;
    }, true);
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        const a = deepActive();
        if (a && a !== document.body && a !== document.documentElement) return;
        for (const view of [...views]) {
          if (view.by !== 'focus') continue;
          if (inside(view, pointer)) view.by = 'rest';
          else putAway(view, { keys: false });
        }
      }, 0);
    }, true);

    // ------------------------------------------------------------ yours

    /** An edit of the person's inside a changed part: that part is theirs. */
    function mine(node) {
      const el = elementOf(node);
      if (!el || el.closest(`[${TRANSIENT}]`) || el.getRootNode() !== document) return;
      let changed = false;
      for (const turn of turns) {
        for (const p of turn.parts ?? []) {
          if (p.kind === 'removed') continue;
          const key = `${turn.id}|${p.id}`;
          if (yours.has(key) || !byId(p.id)?.contains(el)) continue;
          yours.add(key);
          changed = true;
        }
      }
      if (changed) rebuild();
    }
    document.addEventListener('input', (event) => mine(event.composedPath()[0] ?? event.target), true);

    // The person's own history, by its time. A ring the host's ops pruned is
    // not the person: those ops are heard in the same task, before this
    // looks again.
    let opsSeen = 0;
    document.addEventListener('marble:ops', () => { opsSeen += 1; }, true);
    document.addEventListener('marble:history', () => {
      const seen = opsSeen;
      const at = Date.now();
      const where = handNodes().at(-1) ?? null;
      queueMicrotask(() => {
        if (opsSeen !== seen) return;
        personAt = at;
        if (where) mine(where);
      });
    });

    // ------------------------------------------------------------ keys

    /** Whose a key is: not a field's, a chat's, a menu's or a mode's. */
    function pageHasKey(event) {
      for (const node of event.composedPath()) {
        if (node instanceof ShadowRoot) return false;
        if (!(node instanceof Element)) continue;
        if (node.matches('input, textarea, select')) return false;
        if (node.isContentEditable && !node.closest('[data-marble-editable]')) return false;
        if (node.hasAttribute(TRANSIENT) && !host.contains(node)) return false;
      }
      const marks = document.querySelector('.marble-marks-layer');
      if (marks?.dataset.mode || marks?.hasAttribute('data-describing')) return false;
      return true;
    }

    // The newest change still drawn here: one whose every part has become the
    // person's, or left the page, has nothing left for ⌘Z to take back.
    const newest = () => {
      const drawable = new Set(groups.flatMap((g) => g.turns.map((t) => t.id)));
      return turns.find((t) => drawable.has(t.id)) ?? null;
    };
    const shownViews = () => [...views].filter((v) => v.state !== 'out' && v.state !== 'lift');
    /** The drawing the keys are about: the one holding focus, then the one
     *  under the pointer, then the only one. */
    function activeView() {
      const shown = shownViews().filter((v) => v.state === 'normal');
      const a = deepActive();
      return shown.find((v) => v.root.contains(a) || holding(v, a))
        ?? shown.find((v) => inside(v, pointer))
        ?? (shown.length === 1 ? shown[0] : null);
    }

    addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      const key = event.key;
      const mod = (event.metaKey || event.ctrlKey) && !event.altKey;

      // ⌘Z: the change, when it came after the person's own last edit.
      if (mod && key.toLowerCase() === 'z' && !event.repeat) {
        if (!pageHasKey(event)) return;
        if (!event.shiftKey) {
          const turn = newest();
          if (!turn || (known.get(turn.id) ?? 0) <= personAt) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const view = shownViews().find((v) => v.group.turns.some((t) => t.id === turn.id)) ?? null;
          undoTurns(view, [turn]);
        } else {
          const last = undoneHere.at(-1);
          if (!last || last.at <= personAt) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const view = shownViews().find((v) => v.state === 'undone' && v.undone.some((t) => t.id === last.turn)) ?? null;
          redoTurns(view, [last.turn]);
        }
        return;
      }

      if (key === 'Escape') {
        if (!shownViews().length) return;
        const a = deepActive();
        const ours = !a || a === document.body || host.contains(a) || shownViews().some((v) => holding(v, a));
        if (hideAll() && ours) event.preventDefault();
        return;
      }

      // Tab from a part focus drew reaches the bar; ⇧Tab from the bar goes back.
      if (key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const view = shownViews().find((v) => v.by === 'focus');
        if (!view) return;
        const a = deepActive();
        const first = view.bar.root.querySelector('button[data-act="keep"]') ?? view.bar.root.querySelector('button');
        if (!event.shiftKey && holding(view, a) && first) {
          event.preventDefault();
          view.focusFrom = a;
          first.focus({ preventScroll: true });
        } else if (event.shiftKey && (a === first || a === view.bar.more)) {
          event.preventDefault();
          const back = view.focusFrom?.isConnected ? view.focusFrom
            : view.group.parts.map((p) => byId(p.id)).find(Boolean);
          back?.focus({ preventScroll: true });
        }
      }
    }, true);

    // ⌘J while a change is drawn is Change more. Heard before the callout,
    // which would otherwise open a line of its own.
    addEventListener('marble-callout:summon', (event) => {
      const view = activeView();
      if (!view) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      changeMore(view);
    }, true);

    // ------------------------------------------------------------ the tray

    let trayHeld = false;
    function offerTray() {
      if (groups.length) {
        if (trayHeld) return;
        trayHeld = !dispatchEvent(new CustomEvent('marble-tray:register', {
          cancelable: true,
          detail: { id: 'changes', order: 6, label: 'Show what changed', icon: CHANGES, onSelect: showAll },
        }));
      } else if (trayHeld) {
        trayHeld = false;
        dispatchEvent(new CustomEvent('marble-tray:unregister', { detail: { id: 'changes' } }));
      }
    }
    addEventListener('marble-tray:ready', () => { trayHeld = false; offerTray(); });

    // ------------------------------------------------------------ listening

    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('marble:ops', schedule);
    new MutationObserver((records) => {
      if (views.size && records.some(({ target }) => !host.contains(target))) schedule();
    }).observe(document.body ?? document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });

    // A change that ended here: its turn is on the host's list once the host
    // has written it. An undo's end changes the list too.
    document.addEventListener('marble-change:end', (event) => {
      const d = event.detail ?? {};
      const client = String(d.client ?? '');
      if (d.turn) ended.add(`${client}|${d.turn}`);
      const done = d.done;
      const changed = done && (done.changed || done.added || done.removed) && done.status !== 'failed';
      if (client.startsWith('agent:') && d.turn && changed) expect(String(d.turn));
      else soon();
    });

    // A chat about this page (or one already on its list) changed: kept,
    // undone or redone somewhere else, or a turn just finished.
    const wasRunning = new Map();
    agent.on?.('*', (summary) => {
      if (!summary?.id || summary.kind) return;
      const busy = Boolean(summary.running || summary.queued);
      const before = wasRunning.get(summary.id);
      wasRunning.set(summary.id, busy);
      const ours = summary.target === app || turns.some((t) => t.conversationId === summary.id);
      if (!ours || busy) return;
      soon();
      // A turn that just finished writes its own status last.
      if (before) setTimeout(soon, 1000);
    });

    window.marbleReview = {
      /** Every change still waiting here: its turns (newest first) and parts. */
      groups: () => groups.map((g) => ({ turns: g.turns.map((t) => t.id), ids: g.parts.map((p) => p.id) })),
      showAll,
      hide: () => { hideAll(); },
    };

    load();
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
