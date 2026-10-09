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
//     your own last edit and either ended while this tab was open or is drawn
//     now, and ⇧⌘Z puts it back; otherwise both are the document's own
//     history (a change from before a reload is not this tab's to take back
//     unseen, ruling R42);
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
// Everything here is transient chrome in one top-layer host, but for the
// thing as it was while its tag is held (and the moment an old shape is
// measured): that copy stands right after its original, marked transient,
// inert and out of the flow, so the page's own rules style it as they style
// the original. Nothing is filed as an op. It never says Agent.

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
  const TYPING = 800;        // ms after a key or an input before a rest may draw
  const GESTURE = 2000;      // ms a history change may come after the person's own hand
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

    /* The page as it was, while the tag is held: a copy right after the
       thing, laid over it (placed inline, where it stands). */
    .marble-review-before { pointer-events: none !important; }

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
    .marble-review-bar button[aria-disabled="true"] { opacity: .55; cursor: default; }
    .marble-review-bar button > * { position: relative; }
    .marble-review-bar svg { width: 14px; height: 14px; flex: none; }
    /* Change more reads as the line it opens: words to type, not a button. */
    .marble-review-bar [data-act="more"] { flex: 1 1 auto; min-width: 0; justify-content: flex-start; padding-left: 8px;
      color: var(--review-faint); font-weight: 400; }
    .marble-review-bar [data-act="more"] > span { overflow: hidden; text-overflow: ellipsis; }
    .marble-review-bar [data-act="keep"] { color: var(--review-ink); }
    .marble-review-say { flex: 1 1 auto; min-width: 0; padding-left: 8px; color: var(--review-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* What did not happen, in the page's own word for a failure. */
    .marble-review-say[data-failed] { color: var(--danger, var(--review-muted)); }
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
  // What the copy of a whole page takes over from the body it stands in for:
  // the box, the type and the colours, not the size.
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
    // Where each part is, kept between lookups: a big page answers a lookup
    // by reading the whole of itself, and a drawing paints every frame. An
    // element is asked for again only once it has left the page (a part
    // replaced under the same id); an id not found, once the page has
    // changed since it was asked.
    let pageAt = 0;               // bumped by every change of the page's own
    const found = new Map();      // id -> { el, at }
    const usable = (el, id) => el.isConnected && el.getAttribute('data-marble-id') === id && !el.closest(`[${TRANSIENT}]`);
    const byId = (id) => {
      if (!id) return null;
      const known = found.get(id);
      if (known && (known.el ? usable(known.el, id) : known.at === pageAt)) return known.el;
      let el = marble.byId?.(id) ?? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
      if (el && !usable(el, id)) el = null;
      found.set(id, { el, at: pageAt });
      return el;
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
    const known = new Map();      // turn id -> when this page first listed it (this page's clock), for a host without one
    let offset = null;            // the host's clock minus this page's, from its own answers
    const redoneAt = new Map();   // turn id -> when this page redid it (the host's clock)
    let inFlight = false;         // a Keep, Undo or Redo the host has not answered yet
    let tookZ = false;            // this ⌘Z press was the change's, repeats and all
    let typedAt = 0;              // the person's last key or input (this page's clock)
    let gestureAt = 0;            // the person's last own gesture of any kind
    const keptHere = new Set();   // kept from here, before the host's list says so
    const undoneHere = [];        // { turn, at }: undone from here, newest last, for ⇧⌘Z
    const yours = new Set();      // `${turn}|${part}`: a person's own edit made it theirs
    let groups = [];
    let personAt = 0;             // the person's last own history change, this page's clock
    const views = new Set();      // what is drawn: one per change on screen
    let everything = false;       // Show what changed is up
    const ended = new Set();      // `${client}|${turn}`: changes whose end was heard here
    const landedHere = new Set(); // turn ids that ended (or were redone) while this tab was open

    const undone = (id) => undoneHere.some((u) => u.turn === id);

    // ------------------------------------------------------------ one change, since you last kept

    function common(els) {
      let at = els[0] ?? null;
      for (const el of els.slice(1)) while (at && !at.contains(el)) at = at.parentElement;
      return at;
    }

    /** Up from an element to the block it sits in: past runs of words and
     *  boxes that lay out nothing of their own, a cell to its row, a row
     *  group to its table; with `addressed`, to one the file names. The page
     *  itself is none. */
    function blockUp(el, { addressed = false } = {}) {
      let at = el ?? null;
      while (at && !whole(at)) {
        if (/^(TD|TH)$/.test(at.tagName)) { at = at.parentElement; continue; }
        if (/^(TBODY|THEAD|TFOOT)$/.test(at.tagName)) { at = at.closest('table') ?? at.parentElement; continue; }
        const display = getComputedStyle(at).display;
        if (display.startsWith('inline') || display === 'contents' || (addressed && !at.hasAttribute('data-marble-id'))) { at = at.parentElement; continue; }
        break;
      }
      return whole(at) ? null : at;
    }

    /** Whether an element is a piece of a larger thing: its parent lays its
     *  children out in a row (a date in a row, a title beside a chip), or is
     *  a box of its own (a card, a bordered row). */
    function pieceOf(parent) {
      if (!parent || whole(parent)) return false;
      const css = getComputedStyle(parent);
      if (/flex/.test(css.display) && !css.flexDirection.startsWith('column')) return true;
      if (css.display === 'table-row') return true;
      return parseFloat(css.borderTopWidth) > 0 || opaque(css.backgroundColor) || (css.boxShadow && css.boxShadow !== 'none');
    }

    /** Where a part is found on the page: the block it is, or the row or
     *  card it is a piece of (a date is found on its row, a due line on its
     *  card), one level up and no more; for one that is gone, what took its
     *  place, else what held it. Resting there draws its change. */
    function homeOf(part) {
      if (part.kind === 'removed') {
        const next = byId(part.beforeId);
        if (next) return next;
        const parent = byId(part.parentId);
        return whole(parent) ? null : parent;
      }
      const el = byId(part.id);
      if (!el) return null;
      const home = blockUp(el) ?? el;
      return pieceOf(home.parentElement) ? (blockUp(home.parentElement) ?? home.parentElement) : home;
    }
    const homesOf = (parts) => [...new Set(parts.map(homeOf).filter(Boolean))];

    /** What a part hangs from: its parent, and for one that left its place,
     *  the parent it left as well. */
    function parentsOf(part) {
      if (part.kind === 'removed') return [byId(part.parentId)].filter(Boolean);
      const el = byId(part.id);
      const out = el?.parentElement ? [el.parentElement] : [];
      if (part.kind === 'moved') {
        const from = byId(part.parentId);
        if (from) out.push(from);
      }
      return out;
    }

    /** One change, since you last kept (rulings R23, R26). Two asks are one
     *  change only when a part of one is, holds or is inside a part of the
     *  other, or when their parts hang from the same block (the common
     *  ancestor of their parents), or from blocks one level apart: a list,
     *  and one of its rows. A higher block both happen to sit in (a board, a
     *  page's column) never makes them one. An ask's own parts are always one. */
    function rebuild() {
      const items = [];
      for (const turn of turns) {
        if (keptHere.has(turn.id) || undone(turn.id)) continue;
        const parts = (turn.parts ?? []).filter((p) => p?.id && !yours.has(`${turn.id}|${p.id}`));
        if (!parts.length) continue;
        // Nothing of it to rest on (only the last thing on the page taken
        // out): it is still a change, drawn where that was.
        if (!homesOf(parts).length && !parts.some((p) => p.kind === 'removed' && oldPlace(p))) continue;
        const els = parts.filter((p) => p.kind !== 'removed').map((p) => byId(p.id)).filter(Boolean);
        const parents = parts.flatMap(parentsOf);
        items.push({ turn, parts, els, ids: new Set(parts.map((p) => p.id)), under: parents.length ? blockUp(common(parents)) : null });
      }
      const root = items.map((_, i) => i);
      const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          const a = items[i];
          const b = items[j];
          const shared = [...a.ids].some((id) => b.ids.has(id))
            || a.els.some((x) => b.els.some((y) => x.contains(y) || y.contains(x)));
          const hung = Boolean(a.under && b.under) && (a.under === b.under
            || blockUp(a.under.parentElement) === b.under || blockUp(b.under.parentElement) === a.under);
          if (shared || hung) root[find(i)] = find(j);
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
        return { turns: members.map((m) => m.turn), members, parts: [...parts.values()] };
      });
      settleViews();
      offerTray();
    }

    /** The block the change is shown as it was in: what holds every part a
     *  structural change put in, took out or moved (a list for one row
     *  added), and the part itself for one changed in place. */
    function beforeBlockOf(group) {
      const els = [];
      for (const m of group.members) {
        for (const part of m.parts) {
          const el = part.kind === 'removed' ? null : byId(part.id);
          if (part.kind === 'added' || part.kind === 'moved') { if (el?.parentElement) els.push(el.parentElement); }
          else if (el) els.push(el);
          if (part.kind === 'removed' || part.kind === 'moved') {
            const from = byId(part.parentId);
            if (from) els.push(from);
          }
        }
      }
      if (!els.length) return null;
      return blockUp(common(els), { addressed: true }) ?? document.body;
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

    // What is left to review, asked of the host. One answer on its way was
    // asked before whatever asks now (a redo, a keep), so a caller then gets
    // a fresh one asked after it, never the one already travelling.
    let current = null;
    let queued = null;
    function load() {
      if (!current) {
        current = fetchList().finally(() => { current = null; });
        return current;
      }
      queued ??= current.then(() => { queued = null; return load(); });
      return queued;
    }
    async function fetchList() {
      const asked = Date.now();
      let body;
      try {
        body = await agent.review(app);
      } catch {
        return; // The host could not say: what was known stands.
      }
      const answered = Date.now();
      // The host's clock against this page's, to the middle of the trip.
      if (Number.isFinite(body?.now)) offset = body.now - (asked + answered) / 2;
      // A Build mode build's changes are reviewed in its History (build-mode.js),
      // where hovering a build lights what it changed; they are not offered
      // here, on the parts, after it ends.
      const builders = window.marbleBuild?.buildConversations?.() ?? new Set([window.marbleBuild?.state?.()?.conversation].filter(Boolean));
      turns = (Array.isArray(body?.turns) ? body.turns : []).filter((t) => !builders.has(t.conversationId));
      for (const t of turns) if (!known.has(t.id)) known.set(t.id, answered);
      // Undone from here and listed again, by a list asked for after the
      // undo: it was redone somewhere else.
      for (let i = undoneHere.length - 1; i >= 0; i -= 1) {
        const u = undoneHere[i];
        if (u.at < asked && turns.some((t) => t.id === u.turn)) undoneHere.splice(i, 1);
      }
      for (const id of [...keptHere]) if (!turns.some((t) => t.id === id)) keptHere.delete(id);
      rebuild();
    }
    /** When a turn's change last landed on the page, by the host's clock. */
    const landedAt = (t) => Math.max(Number(t.finishedAt) || 0, redoneAt.get(t.id) ?? 0);
    /** Whether a change came after the person's own last edit: by the
     *  host's clock, the page's own edit put on it; a host that does not
     *  say its clock, by when this page first listed the change. */
    const cameAfterPerson = (t) => (offset !== null && Number(t.finishedAt)
      ? landedAt(t) > personAt + offset
      : (known.get(t.id) ?? 0) > personAt);
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
        rect: null, area: [], leave: 0, focusFrom: null, before: null, frame: null,
        // After an undo: what it took back, what is left to take back (a hold
        // that stopped halfway), whether Redo can be offered, and what the
        // bar says. `error`: a verdict the host refused, said in its place.
        undone: [], pending: [], redoable: false, said: 'Undone', failed: false, error: null,
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
      // After the last thing in it that shows (a script or a style is no place).
      const kids = [...parent.children].filter((k) => !k.hasAttribute(TRANSIENT) && k.getAttribute('data-marble-id') !== part.id);
      for (const last of kids.reverse()) {
        const r = last.getBoundingClientRect();
        if (r.width || r.height) return { left: r.left, top: r.bottom, width: r.width, ref: last };
      }
      const r = parent.getBoundingClientRect();
      const css = getComputedStyle(parent);
      const left = r.left + parseFloat(css.borderLeftWidth) + parseFloat(css.paddingLeft);
      const right = r.right - parseFloat(css.borderRightWidth) - parseFloat(css.paddingRight);
      return { left, top: r.top + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop), width: Math.max(0, right - left), ref: null };
    }

    /** Placed absolutely right after its original, then moved onto it: an
     *  element out of the flow takes no room, and standing beside its
     *  original it keeps every rule its ancestors give it. */
    function layOver(copy, original) {
      for (const [k, v] of [['position', 'absolute'], ['left', '0px'], ['top', '0px'], ['margin', '0'], ['box-sizing', 'border-box'],
        ['transition', 'none'], ['animation', 'none']]) copy.style.setProperty(k, v, 'important');
      if (original === document.body) document.body.append(copy);
      else original.after(copy);
      fitOver(copy, original);
    }
    function fitOver(copy, original) {
      const b = original.getBoundingClientRect();
      const c = copy.getBoundingClientRect();
      const dx = b.left - c.left;
      const dy = b.top - c.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      copy.style.setProperty('left', `${(parseFloat(copy.style.left) || 0) + dx}px`, 'important');
      copy.style.setProperty('top', `${(parseFloat(copy.style.top) || 0) + dy}px`, 'important');
    }

    /** The shape a look change took away: the element copied with its old
     *  value, set right after it out of sight, measured, and gone again, in
     *  the same task. Read once per element. */
    function oldShape(view, part, el, r) {
      const cached = view.shapes.get(`old:${part.id}`);
      if (cached && cached.el === el) return cached;
      const copy = sanitize(copyOf(el));
      if (!copy) return null;
      if (part.before == null) copy.removeAttribute(part.name);
      else copy.setAttribute(part.name, part.before);
      copy.setAttribute(TRANSIENT, '');
      copy.setAttribute('aria-hidden', 'true');
      copy.inert = true;
      copy.style.setProperty('visibility', 'hidden', 'important');
      copy.style.setProperty('pointer-events', 'none', 'important');
      const sized = part.name === 'style' && /(^|;)\s*width\s*:/i.test(String(part.before ?? ''));
      if (!sized) copy.style.setProperty('width', `${r.width}px`, 'important');
      layOver(copy, el);
      const got = copy.getBoundingClientRect();
      const was = getComputedStyle(copy);
      const shape = {
        el, dx: got.left - r.left, dy: got.top - r.top, width: got.width, height: got.height,
        radius: `${was.borderTopLeftRadius} ${was.borderTopRightRadius} ${was.borderBottomRightRadius} ${was.borderBottomLeftRadius}`,
      };
      copy.remove();
      view.shapes.set(`old:${part.id}`, shape);
      return shape;
    }

    // --------------------------------------------------------- copies of the page

    /** Nothing that runs, loads, takes focus or names an element; ids kept
     *  only while the copy still has inverses to take by id. A custom element
     *  becomes a plain box, the root as well, so a copy never comes to life
     *  as a second one of itself. Returns the root, replaced or not. */
    function sanitize(root, { ids = false } = {}) {
      if (!root) return root;
      const all = root.nodeType === 11 ? [...root.querySelectorAll('*')] : [root, ...root.querySelectorAll('*')];
      let top = root;
      for (const el of all) {
        const tag = el.localName?.toLowerCase();
        if (el !== root && (UNSAFE.has(tag) || el.hasAttribute('popover') || el.hasAttribute(TRANSIENT))) { el.remove(); continue; }
        for (const { name } of [...el.attributes]) {
          const n = name.toLowerCase();
          if (n.startsWith('on') || UNSAFE_ATTRS.has(n)) el.removeAttribute(name);
          else if (n.startsWith('data-marble') && !(ids && n === 'data-marble-id')) el.removeAttribute(name);
          else if ((n === 'href' || n === 'src' || n === 'xlink:href') && /^\s*javascript:/i.test(el.getAttribute(name) ?? '')) el.removeAttribute(name);
        }
        if (tag?.includes('-') && el.namespaceURI === 'http://www.w3.org/1999/xhtml') {
          const box = (el.ownerDocument ?? document).createElement('div');
          for (const { name, value } of [...el.attributes]) box.setAttribute(name, value);
          box.append(...el.childNodes);
          if (el.parentNode) el.replaceWith(box);
          if (el === root) top = box;
        }
      }
      return top;
    }

    /** A copy of an element made from its markup, in an inert document: no
     *  handler, load or component of it stirs on the way. Ids are kept for
     *  the inverses to find their parts by. The page's body copies as a box
     *  of its children. */
    function copyOf(el) {
      const t = document.createElement('template');
      t.innerHTML = el === document.body ? `<div>${el.innerHTML}</div>` : el.outerHTML;
      sanitize(t.content, { ids: true });
      return t.content.firstElementChild;
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

    /** The thing as it was before this change: a copy of the block that
     *  holds it, with every ask's inverse applied to the copy by id, newest
     *  ask first. Nothing is undone. */
    function beforeOf(view) {
      const block = beforeBlockOf(view.group);
      if (!block) return null;
      const copy = copyOf(block);
      if (!copy) return null;
      const find = (id) => {
        if (id == null) return null;
        if (copy.getAttribute('data-marble-id') === id) return copy;
        return copy.querySelector(`[data-marble-id="${CSS.escape(id)}"]`);
      };
      for (const member of view.group.members) {
        for (const part of [...member.parts].reverse()) {
          // A before sent cut (past the host's limit) is words, not the
          // markup or the value it was: that part shows as it is now.
          if (part.truncated) continue;
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
      const done = sanitize(copy);
      // The body's copy is a box of its children: it wears the body's look.
      if (block === document.body) {
        const css = getComputedStyle(block);
        done.setAttribute('style', LOOK.map((p) => `${p}:${css.getPropertyValue(p)}`).join(';'));
      }
      return { block, copy: done };
    }

    function showBefore(view) {
      if (view.before || view.state !== 'normal' || view.busy) return;
      let made;
      try { made = beforeOf(view); } catch { made = null; }
      if (!made) return;
      const { block, copy } = made;
      copy.classList.add('marble-review-before');
      copy.setAttribute(TRANSIENT, '');
      copy.setAttribute('aria-hidden', 'true');
      copy.inert = true;
      copy.style.setProperty('pointer-events', 'none', 'important');
      copy.style.setProperty('width', `${block.getBoundingClientRect().width}px`, 'important');
      layOver(copy, block);
      view.before = { copy, block };
      const id = block.getAttribute('data-marble-id');
      const sel = id ? `[data-marble-id="${id.replace(/["\\]/g, '\\$&')}"]` : null;
      hiding.textContent = block === document.body
        ? `body > :not([${TRANSIENT}]) { visibility: hidden !important; }`
        : sel ? `${sel} { visibility: hidden !important; }` : '';
      view.tag.root.toggleAttribute('data-held', true);
      aloud.textContent = 'Before';
      paint(view, handNodes());
    }

    function hideBefore(view) {
      if (!view.before) return;
      view.before.copy.remove();
      view.before = null;
      hiding.textContent = '';
      view.tag.root.removeAttribute('data-held');
      schedule();
    }
    /** Every held Before goes back: the window lost the hold. */
    // A hold not yet shown is let go too, or it would show after.
    const letGoAll = () => { for (const view of views) { clearTimeout(view.tag.timer); hideBefore(view); } };
    addEventListener('blur', letGoAll);
    addEventListener('pagehide', letGoAll);
    addEventListener('pointercancel', letGoAll, true);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') letGoAll(); });

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
          const text = oldWords(part);
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

    /** A part's old words, as the struck line says them: a before sent cut
     *  (past the host's limit) ends in an ellipsis. Read once per part. */
    function oldWords(part) {
      if (part.was === undefined) {
        const text = wordsOf(part.before);
        part.was = text && part.truncated ? `${text}…` : text;
      }
      return part.was;
    }
    /** Whether a part's old words are the words there now: a word made bold,
     *  or made a link, changed the markup and not the words, and its old
     *  words under it would only say the same sentence twice. */
    function sameWords(part, el) {
      if (part.sameAs !== el) {
        part.sameAs = el;
        part.same = !part.truncated && oldWords(part) === (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      }
      return part.same;
    }

    /** Where a drawing's parts are found, and the block they share: read
     *  again only once the page has changed, not every frame. */
    function homesFor(view) {
      if (view.homesAt !== pageAt || view.homesFrom !== view.group) {
        const homes = homesOf(view.group.parts);
        view.homes = { homes, shared: homes.length > 1 ? blockUp(common(homes)) : homes[0] ?? null };
        view.homesAt = pageAt;
        view.homesFrom = view.group;
      }
      return view.homes;
    }

    function paint(view, hand) {
      if (view.state === 'out' || view.state === 'lift') return;
      const { group } = view;
      const marking = view.state === 'normal' && !view.before && !view.busy;
      const specs = [];
      const boxes = [];
      for (const part of group.parts) {
        if (part.kind === 'removed') {
          // One sent cut has no markup to draw back: the bar and the tag
          // still count it.
          if (!marking || part.truncated) continue;
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
            if (!sameWords(part, el)) specs.push({ key: `was:${part.id}`, part, kind: 'was', at: { left: w.left, top: w.top + w.height + 2 }, max: Math.max(r.width, 200) });
            break;
          }
          case 'look': {
            const o = part.truncated ? null : oldShape(view, part, el, r);
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

      // What the change covers: where its parts are found; and the block they
      // share, when they fill most of it (three dated rows are their list),
      // so the bar is flush with that. A block they barely touch (a board, a
      // column) is not the change.
      const { homes, shared } = homesFor(view);
      const covered = union([...homes.map((el) => el.getBoundingClientRect()), ...boxes]);
      const frameRect = shared?.isConnected ? shared.getBoundingClientRect() : null;
      view.frame = frameRect && covered && covered.height >= frameRect.height * 0.5 ? shared : null;
      const rect = (view.frame ? union([frameRect, covered]) : covered) ?? union(drawn) ?? view.rect;
      if (!rect) { view.tag.root.hidden = true; view.bar.root.hidden = true; return; }
      view.rect = rect;
      const under = Math.max(rect.bottom, ...drawn.map((d) => d.top + d.height));

      if (view.before?.block.isConnected) fitOver(view.before.copy, view.before.block);

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
        const edged = !flip && Boolean(view.frame) && shapeOf(view, view.frame).shaped;
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
      const tag = { root, press, words, key: '', timer: 0 };

      // Held, it shows the thing as it was; let go, the change is back.
      const let_go = () => { clearTimeout(tag.timer); hideBefore(view); };
      press.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        try { press.setPointerCapture(event.pointerId); } catch { /* the pointer is gone already */ }
        clearTimeout(tag.timer);
        tag.timer = setTimeout(() => showBefore(view), HOLD_TAG);
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
      const error = h('span', 'marble-review-say');
      error.toggleAttribute('data-failed', true);
      const bar = { root, more, keep, undo, redo, say, error, key: '' };

      more.addEventListener('click', () => { if (!view.busy) changeMore(view); });
      keep.addEventListener('click', () => keepView(view));
      redo.addEventListener('click', () => redoView(view));

      // Press: the last ask. Hold: every ask since the last Keep.
      let holding = 0;
      let held = false;
      const stop = () => { clearTimeout(holding); undo.removeAttribute('data-holding'); };
      undo.addEventListener('pointerdown', (event) => {
        held = false;
        if (event.button !== 0 || view.state !== 'normal' || view.group.turns.length < 2) return;
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
        // After an undo that stopped halfway, Undo takes the rest.
        undoTurns(view, view.state === 'undone' ? [...view.pending] : view.group.turns.slice(0, 1));
      });
      tipOn(undo, () => (view.group.turns.length > 1 ? `Hold to undo all ${view.group.turns.length}` : null));
      return bar;
    }

    function fillBar(view) {
      const bar = view.bar;
      let want;
      if (view.state === 'undone') {
        bar.say.textContent = view.said;
        bar.say.toggleAttribute('data-failed', view.failed);
        want = [bar.say, ...(view.pending.length ? [bar.undo] : []), ...(view.redoable ? [bar.redo] : [])];
      } else {
        bar.error.textContent = view.error ?? '';
        want = [view.error ? bar.error : bar.more, bar.keep, bar.undo];
      }
      const key = `${view.state}|${want.map((el) => el.dataset.act ?? 'say').join()}|${view.said}|${view.error ?? ''}`;
      if (bar.key !== key) {
        // Only what goes is taken out and only what comes is put in, so the
        // button with the keys stays where it is; if it went, the keys go to
        // the button for the same action, else the first.
        const had = bar.root.contains(document.activeElement) ? document.activeElement : null;
        bar.key = key;
        for (const el of [...bar.root.children]) if (!want.includes(el)) el.remove();
        want.forEach((el, i) => { if (bar.root.children[i] !== el) bar.root.insertBefore(el, bar.root.children[i] ?? null); });
        if (had && document.activeElement !== had) {
          const same = bar.root.contains(had) ? had : want.find((el) => el.dataset.act && el.dataset.act === had.dataset.act);
          (same ?? want.find((el) => el.localName === 'button'))?.focus({ preventScroll: true });
        }
      }
      // Busy, not disabled: a disabled button would drop the keys to the
      // page, and the drawing focus asked for with them. Every press waits
      // on the host anyway.
      for (const b of [bar.more, bar.keep, bar.undo, bar.redo]) {
        if (view.busy) b.setAttribute('aria-disabled', 'true');
        else b.removeAttribute('aria-disabled');
      }
      const n = view.group.turns.length;
      if (n > 1 && view.state === 'normal') bar.undo.setAttribute('aria-description', `Hold to undo all ${n}`);
      else bar.undo.removeAttribute('aria-description');
      const name = view.state === 'undone' ? view.said : view.error ?? said(tagPieces(view.group));
      if (bar.root.getAttribute('aria-label') !== name) bar.root.setAttribute('aria-label', name);
    }

    // ------------------------------------------------------------ verdicts

    const reviewed = (list) => {
      for (const id of new Set(list.map((t) => t.conversationId))) {
        document.dispatchEvent(new CustomEvent('marble-callout:reviewed', { detail: { id } }));
      }
    };

    /** Keep: the change is the page now. Once the host says so, its drawing
     *  lifts and never shows again, and the chats it came from are reviewed
     *  here. A Keep the host refuses changes nothing and says so. */
    async function keepView(view) {
      if (inFlight || view.busy) return;
      inFlight = true;
      view.busy = true;
      view.error = null;
      paint(view, handNodes());
      const list = [...view.group.turns];
      const results = await Promise.allSettled(list.map((t) => agent.keep(t.id)));
      inFlight = false;
      view.busy = false;
      const kept = list.filter((_, i) => results[i].status === 'fulfilled');
      for (const t of kept) keptHere.add(t.id);
      if (kept.length && kept.length === list.length && views.has(view)) {
        // Lifting before the list moves on, and the keys going back after
        // it, so neither puts it away twice nor draws it again.
        const back = view.root.contains(document.activeElement) ? view.focusFrom : null;
        putAway(view, { lift: true, keys: false });
        rebuild();
        if (back?.isConnected) giveBack(back);
        else if (view.root.contains(document.activeElement)) document.activeElement.blur();
        aloud.textContent = 'Kept';
        reviewed(kept);
        await load();
        return;
      }
      if (kept.length) reviewed(kept);
      if (kept.length < list.length) {
        view.error = "Couldn't keep it. Try again.";
        aloud.textContent = view.error;
      }
      rebuild();
      if (views.has(view)) paint(view, handNodes());
    }

    /** Undo, newest first. The marks and the engine play it as it lands
     *  (agent-undo frames); the bar says so, and offers Redo while you are
     *  here. One that stops partway says how far it got, and Undo takes the
     *  rest. Nothing else is asked of the host while one is on its way. */
    async function undoTurns(view, list) {
      if (!list.length || inFlight || view?.busy) return;
      inFlight = true;
      const before = view?.state === 'undone' ? view.undone.length : 0;
      const all = before + list.length;
      if (view) { view.busy = true; view.error = null; hideBefore(view); paint(view, handNodes()); }
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
      inFlight = false;
      // A ⌘Z with nothing drawn that the host refused is drawn now, so what
      // happened is said where the change is.
      if (!view && !done.length) {
        const g = groups.find((one) => one.turns.some((t) => t.id === list[0].id));
        if (g) view = viewOf(g) ?? draw(g, 'keys');
      }
      if (view && views.has(view)) {
        view.busy = false;
        const got = before + done.length;
        if (got) {
          view.state = 'undone';
          view.undone = [...view.undone, ...done];
          view.pending = list.slice(done.length);
          view.redoable = true;
          view.failed = got < all;
          view.said = got < all ? `Undid ${got} of ${all}. Try again.` : 'Undone';
        } else {
          view.error = "Couldn't undo it. Try again.";
        }
        paint(view, handNodes());
      }
      aloud.textContent = done.length === list.length ? 'Undone' : view?.said && view.state === 'undone' ? view.said : "Couldn't undo it. Try again.";
      rebuild();
      await load();
    }

    /** Redo puts back what this bar undid, the oldest first. A turn with
     *  nothing kept to redo it from (a whole-file restore: the host answers
     *  409) offers no Redo; any other refusal says so and Redo stays. */
    async function redoTurns(view, ids) {
      if (!ids.length || inFlight || view?.busy) return;
      inFlight = true;
      if (view) { view.busy = true; paint(view, handNodes()); }
      const back = [];
      let refused = false;
      let failed = false;
      for (const id of ids) {
        try {
          await agent.redo(id);
        } catch (err) {
          if (err?.status === 409) refused = true;
          else failed = true;
          break;
        }
        back.push(id);
        const at = undoneHere.findIndex((u) => u.turn === id);
        if (at >= 0) undoneHere.splice(at, 1);
        redoneAt.set(id, Date.now() + (offset ?? 0));
        known.set(id, Date.now());
        landedHere.add(id);
      }
      inFlight = false;
      // Back on the host's list before the drawing comes back over it.
      await load();
      if (view && views.has(view)) {
        view.busy = false;
        view.undone = view.undone.filter((t) => !back.includes(t.id));
        if (!view.undone.length) {
          // All of it back: the drawing over it again, as it was.
          view.state = 'normal';
          view.pending = [];
          view.failed = false;
          view.said = 'Undone';
        } else if (refused) {
          // Not possible, not a failure: no Redo, and nothing more to say.
          view.redoable = false;
          view.failed = false;
          view.said = 'Undone';
        } else if (failed) {
          view.failed = true;
          view.said = "Couldn't redo. Try again.";
        }
        settleViews();
        paint(view, handNodes());
      }
      if (back.length === ids.length) aloud.textContent = 'Redone';
      else if (failed) aloud.textContent = "Couldn't redo. Try again.";
    }
    const redoView = (view) => redoTurns(view, [...view.undone].reverse().map((t) => t.id));

    /** Change more: the line, on what the change made, carrying on the chat
     *  that made it. */
    function changeMore(view) {
      const g = view.group;
      const present = g.parts.filter((p) => p.kind !== 'removed').map((p) => byId(p.id)).filter(Boolean);
      const outer = present.filter((el) => !present.some((o) => o !== el && o.contains(el)));
      let ids = outer.map((el) => el.getAttribute('data-marble-id'));
      if (!ids.length) ids = homesOf(g.parts).map((el) => el.getAttribute('data-marble-id')).filter(Boolean);
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
    // How focus last moved: by a press, or by the keys.
    let pressedAt = -Infinity;
    let keyedAt = -Infinity;
    addEventListener('keydown', () => { keyedAt = performance.now(); }, true);
    const inside = (view, p) => Boolean(p) && view.area.some((r) => p.x >= r.left - 1 && p.x <= r.left + r.width + 1 && p.y >= r.top - 1 && p.y <= r.top + r.height + 1);

    /** Something else has the page: the line is open, pointing or Describe is
     *  on, or a change is still being made. (Words being selected hold the
     *  pointer down, which a rest already waits out.) */
    function busyElsewhere() {
      if (window.marbleLine?.current?.()) return true;
      // Reshape (change-rules.js) has the pointer: a rest is a hand on a part.
      if (document.documentElement.classList.contains('marble-reshaping')) return true;
      if (document.documentElement.classList.contains('marble-callout-latched')) return true;
      const marks = document.querySelector('.marble-marks-layer');
      if (marks?.dataset.mode || marks?.hasAttribute('data-describing')) return true;
      return (window.marbleChange?.runs?.() ?? []).some((r) => String(r.client).startsWith('agent:') && !ended.has(`${r.client}|${r.turn}`));
    }

    /** What the pointer is on belongs to a change: it is where one of the
     *  change's parts is found (a date's row, a card, what took a removed
     *  row's place). Not merely inside some block the change is in. The
     *  innermost wins. */
    function groupAt(target) {
      let best = null;
      let depth = -1;
      for (const g of groups) {
        const hit = homesOf(g.parts).find((el) => el.contains(target)) ?? null;
        if (!hit) continue;
        let d = 0;
        for (let n = hit; n; n = n.parentElement) d += 1;
        if (d > depth) { best = g; depth = d; }
      }
      return best;
    }

    function onRest() {
      if (!pointer || !groups.length || pressing || busyElsewhere()) return;
      // Hands on the keys a moment ago: a rest is the pointer left where it
      // was, not a request.
      if (Date.now() - typedAt < TYPING) return;
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
      // A drag is under way: nothing it passes over is a rest.
      if (event.buttons) {
        restAt = null;
        clearTimeout(restTimer);
        checkLeave();
        return;
      }
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
      pressedAt = performance.now();
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
    const TEXT_ENTRY = 'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"], input[type="number"]';
    /** Focus that asks for the drawing: the keys walking into the change, or
     *  a press on something there that is not for typing in. A press into
     *  words to edit them is the hand going to work on them, and the change
     *  drawn over them would only be in the way. */
    const askedBy = (t) => !(t.isContentEditable || t.matches(TEXT_ENTRY)) || (keyedAt > pressedAt && t.matches(':focus-visible'));

    document.addEventListener('focusin', (event) => {
      const t = event.composedPath()[0] ?? event.target;
      if (!(t instanceof Element) || host.contains(t) || returning) return;
      for (const view of [...views]) if (view.by === 'focus' && view.state !== 'out' && view.state !== 'lift' && !holding(view, t)) putAway(view, { keys: false });
      if (t.closest(`[${TRANSIENT}]`) || t.getRootNode() !== document || !askedBy(t)) return;
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
      // What the edit is inside, read once from it up: a part holds the edit
      // when it is one of these. Never a lookup per part per key.
      const around = new Set();
      for (let at = el; at; at = at.parentElement) {
        const id = at.getAttribute('data-marble-id');
        if (id) around.add(id);
      }
      let changed = false;
      for (const turn of turns) {
        for (const p of turn.parts ?? []) {
          if (p.kind === 'removed' || !around.has(p.id)) continue;
          const key = `${turn.id}|${p.id}`;
          if (yours.has(key)) continue;
          yours.add(key);
          changed = true;
        }
      }
      if (changed) rebuild();
    }
    document.addEventListener('input', (event) => mine(event.composedPath()[0] ?? event.target), true);

    // The person's own history, by its time. Only a change that follows the
    // person's own hand is theirs: a ring the host's ops pruned (those ops
    // are heard in the same task, before this looks again), or one a write
    // from outside the page emptied (no key, input or press of theirs
    // shortly before), is not.
    let opsSeen = 0;
    document.addEventListener('marble:ops', () => { opsSeen += 1; pageAt += 1; }, true);
    for (const type of ['keydown', 'input', 'pointerup', 'drop', 'paste', 'cut']) {
      addEventListener(type, (event) => {
        if (!event.isTrusted) return;
        gestureAt = Date.now();
        // Typing: a key that writes or edits, not one that moves or leaves.
        const writes = type === 'keydown' && !event.metaKey && !event.ctrlKey
          && (event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key));
        if (type === 'input' || writes) typedAt = gestureAt;
      }, true);
    }
    // A rule the person made (change-rules.js: Reshape, or a few words the
    // page made one rule of) is theirs however long after their hand it
    // landed: ⌘Z takes it back before an agent's change.
    document.addEventListener('marble-rules:commit', () => { personAt = Date.now(); });
    document.addEventListener('marble:history', (event) => {
      // Nothing to undo and nothing to redo: the ring was emptied, which is
      // the carrier hearing an outside write, never an edit of the person's.
      if (event.detail?.canUndo === false && event.detail?.canRedo === false) return;
      const seen = opsSeen;
      const at = Date.now();
      const where = handNodes().at(-1) ?? null;
      queueMicrotask(() => {
        if (opsSeen !== seen || at - gestureAt > GESTURE) return;
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

    // The stops of a drawing, in the order Tab walks them: its tag, then its
    // bar's buttons. The page's own stops, as Tab would find them.
    const stopsOf = (view) => [view.tag.press, ...view.bar.root.querySelectorAll('button')]
      .filter((el) => el.isConnected && !el.closest('[hidden]'));
    const TABBABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, summary, audio[controls], video[controls], [contenteditable], [tabindex]';
    // An editable root takes Tab though it reports a tabIndex of -1.
    const stopIndex = (el) => (el.isContentEditable && !el.hasAttribute('tabindex') ? 0 : el.tabIndex);
    const tabbable = (el) => !el.closest(`[${TRANSIENT}]`) && !el.closest('[inert]') && !el.disabled && stopIndex(el) >= 0
      && !(el.isContentEditable && el.parentElement?.isContentEditable)
      && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true }));
    const pageStops = () => [...document.querySelectorAll(TABBABLE)].filter(tabbable);
    const partEls = (view) => view.group.parts.filter((p) => p.kind !== 'removed').map((p) => byId(p.id)).filter(Boolean);
    /** The change's own last stop: after it, Tab reaches the drawing. */
    function lastStopIn(view) {
      const els = partEls(view);
      return pageStops().filter((s) => els.some((el) => el.contains(s))).at(-1) ?? null;
    }
    /** The first stop in the page after the change, where Tab goes on from
     *  the drawing's last. */
    function stopAfter(view) {
      const els = partEls(view);
      const from = lastStopIn(view) ?? els.at(-1);
      if (!from) return null;
      return pageStops().find((s) => (from.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !els.some((el) => el.contains(s))) ?? null;
    }

    /** The last stop in the page before the change, where Shift+Tab goes
     *  from the tag of a change with no stop of its own. */
    function stopBefore(view) {
      const els = partEls(view);
      const anchors = els.length ? els : homesOf(view.group.parts);
      const first = anchors.reduce((a, b) => (a && !(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING) ? a : b), null);
      if (!first) return null;
      return pageStops().filter((s) => !anchors.some((el) => el.contains(s))
        && (s.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1) ?? null;
    }

    addEventListener('keyup', (event) => { if (event.key.toLowerCase() === 'z') tookZ = false; }, true);

    addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      const key = event.key;
      const mod = (event.metaKey || event.ctrlKey) && !event.altKey;
      const take = () => { event.preventDefault(); event.stopImmediatePropagation(); };

      // ⌘Z: the change, when it came after the person's own last edit.
      if (mod && key.toLowerCase() === 'z') {
        if (!pageHasKey(event)) return;
        // A key held down repeats: while a change is being taken back, or
        // when this press was the change's, the repeats are too, so none of
        // them falls through to the person's own undo.
        if (event.repeat) {
          if (inFlight || tookZ) take();
          return;
        }
        tookZ = false;
        // One verdict at a time: a second ⌘Z while one is on its way is
        // heard and does nothing.
        if (inFlight) { take(); tookZ = true; return; }
        if (!event.shiftKey) {
          const turn = newest();
          if (!turn || !cameAfterPerson(turn)) return;
          // Only a change this tab saw land, or one drawn now: after a
          // reload, or in a tab opened since, an old change is not taken
          // back unseen, and ⌘Z is the document's (ruling R42).
          const view = shownViews().find((v) => v.group.turns.some((t) => t.id === turn.id)) ?? null;
          if (!view && !landedHere.has(turn.id)) return;
          take();
          tookZ = true;
          undoTurns(view, [turn]);
        } else {
          const last = undoneHere.at(-1);
          if (!last || last.at <= personAt) return;
          take();
          tookZ = true;
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

      // Tab: the drawing is a stop of the page's own, right after the
      // change's last stop. Tab from there reaches the tag, then Change more,
      // Keep and Undo, then goes on to the page's next stop after the change;
      // Shift+Tab walks back into the change.
      if (key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const a = deepActive();
        const shown = shownViews();
        const view = shown.find((v) => v.root.contains(a)) ?? shown.find((v) => v.by === 'focus' && holding(v, a));
        if (!view) return;
        const stops = stopsOf(view);
        const i = stops.indexOf(a);
        if (i < 0) {
          if (event.shiftKey || !stops.length || a !== lastStopIn(view)) return;
          event.preventDefault();
          view.focusFrom = a;
          stops[0].focus({ preventScroll: true });
          return;
        }
        event.preventDefault();
        if (event.shiftKey) {
          const back = i > 0 ? stops[i - 1]
            : lastStopIn(view) ?? (view.focusFrom?.isConnected ? view.focusFrom : null) ?? stopBefore(view);
          if (back) back.focus({ preventScroll: true });
          else { putAway(view, { keys: false }); a.blur(); }
        } else if (i < stops.length - 1) {
          stops[i + 1].focus({ preventScroll: true });
        } else {
          const next = stopAfter(view);
          if (next) next.focus({ preventScroll: true });
          else { putAway(view, { keys: false }); a.blur(); }
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
    // The page's own changes move a drawing; its copies and measures (in
    // the document, marked transient) do not.
    new MutationObserver((records) => {
      if (!records.some(({ target }) => !elementOf(target)?.closest(`[${TRANSIENT}]`))) return;
      pageAt += 1;
      if (views.size) schedule();
    }).observe(document.body ?? document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });

    // A change that ended here: its turn is on the host's list once the host
    // has written it. An undo's end changes the list too.
    document.addEventListener('marble-change:end', (event) => {
      const d = event.detail ?? {};
      const client = String(d.client ?? '');
      if (d.turn) ended.add(`${client}|${d.turn}`);
      if (d.turn && client.startsWith('agent:')) landedHere.add(String(d.turn));
      const done = d.done;
      const changed = done && (done.changed || done.added || done.removed) && done.status !== 'failed';
      if (client.startsWith('agent:') && d.turn && changed) expect(String(d.turn));
      else soon();
    });

    // Any change's end heard here, followed or not: it landed while this tab
    // was open, so ⌘Z may take it back.
    document.addEventListener('marble:presence', (event) => {
      const d = event.detail ?? {};
      if (d.stage === 'end' && d.turn && String(d.client ?? '').startsWith('agent:')) landedHere.add(String(d.turn));
    }, true);

    // Back from the background, from a page cache, or with the drive's
    // stream open again after it was away (a resting tab, a host restart):
    // whatever ended meanwhile was heard by nobody here, so the list is
    // asked again.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(); });
    addEventListener('pageshow', (event) => { if (event.persisted) soon(); });
    addEventListener('marble:agent-reopened', soon);

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

    // The build's conversation is known once Build mode has its state.
    let builderSeen = null;
    addEventListener('marble-build:state', () => {
      const builder = [...(window.marbleBuild?.buildConversations?.() ?? [])].sort().join(' ');
      if (builder === builderSeen) return;
      builderSeen = builder;
      load();
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
