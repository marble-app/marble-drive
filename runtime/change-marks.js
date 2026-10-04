// The marks: a change, drawn part by part while it happens (v5, Notes and
// Sketches/Ask at Anything, "The marks, from reading to done").
//
// A zone (collab.js) boxes the one element that holds everything an edit
// touched and writes the edit's note on it: it says something is changing
// somewhere in there, not which part, how far along, or what is still to
// come. The host now says all of that in its presence frames (the turn, the
// finest parts each batch changes, the step, a count, a total and the reach
// of a step sent ahead), so this layer draws it where it happens:
//
//   - a light tint on each part the step will touch, shaped to the part and
//     all at once, before any of them changes, so the reach is seen first;
//   - the tint deepens, with a hairline of the accent round it, on the parts
//     landing now, and lifts slowly once they have landed;
//   - past a dozen parts a tint on every row would run together into one
//     block, so each new part gets a dot in the margin instead, and only the
//     parts landing now are tinted;
//   - one tag for the whole change, on the part changing now: what it is
//     doing in the parts' own unit, how many, a meter when the total is
//     known, the steps, and the time. Resting on it opens what was asked and
//     the steps so far; a press opens the conversation. It never says Agent;
//   - a rail at the window's edge for parts out of view, with a pill that
//     takes you to the next one. The page never scrolls by itself.
//
// A change fanned out to workers (server/change/fanout.js) lands a group at a
// time. A group whose worker failed is said in a frame of its own (`failed`):
// its parts keep their light tint until the change ends or they land after
// all, and the tag counts the groups of the latest fan out ("3 of 4 groups
// done · 1 failed").
//
// Done, the tag says what changed in numbers, then every mark goes: nothing
// stays on the page. Everything is transient chrome in one fixed layer;
// nothing here is filed as an op. Only work this tab is following is drawn
// (a chat nobody here follows is a glint, agent-glints.js); an undo is drawn
// as tints, with no tag. A change of one part inside one block of words is
// the caret's (agent-text.js, rulings R2 and R6), and a press is collab.js's
// ring. What this layer draws, the zone does not (`claims`).
//
// A change the page makes itself (a rule from Reshape or from a few words,
// change-rules.js) is drawn with the same tints and tag through `begin`: no
// presence frames, no conversation behind the tag, and a part can be left
// out (a dashed ring, no fill). It is not work: Hide work leaves it drawn.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const MANY = 12;           // parts in one change before the margin takes over
  const LAND_AFTER = 300;    // ms after a batch's ops, when no engine plays them
  const LIFT = 900;          // ms a landed part's tint takes to lift
  const STILL = 150;         // ms, the one crossfade reduced motion keeps
  const GONE = 220;          // ms the marks take to go at the end
  const SHOWN = 2200;        // ms the end's numbers stay up
  const REST = 350;          // ms of rest on the tag before its status opens
  const SPREAD = 380;        // ms a step's reach is spread over as it arrives
  const OUT = 6;             // px the scope's tint stands out past it
  const INSIDE = 8;          // px the tag keeps inside the window
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  const SKIP = new Set(['HTML', 'BODY', 'HEAD', 'STYLE', 'SCRIPT', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'NOSCRIPT']);
  const UNDO_IDLE = 8000;    // ms an undo's marks wait for its next frame before they lift
  const RAIL_MAX = 400;      // parts the rail measures in one paint
  const MOST_GOING = 60;     // parts of one batch measured ahead in case they go

  const STYLE = `
    .marble-change-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147482900;
      --change-accent: var(--accent, light-dark(#9bb6cf, #7fa8c9));
      --change-ink: var(--accent-ink, light-dark(#738698, #9dc0dc));
      --change-card: var(--card, var(--paper, light-dark(#fff, #1f2023)));
      --change-text: var(--ink, light-dark(#1d1d1f, #ececee));
      --change-muted: var(--muted, light-dark(#5f6267, #a6a9ae));
      --change-faint: var(--faint, light-dark(#8b8e93, #7e8187));
      --change-line: var(--line, color-mix(in srgb, var(--change-text) 14%, transparent));
      --change-ease: var(--ease-out, ${EASE});
      --change-colour: cubic-bezier(.22, .61, .36, 1);
      --change-inset: 0px;
      font: 500 11.5px/1 var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif)); }
    /* Hide work in the tray hides this too: it is the same work. A change
       the page is making by hand is not work, and stays. */
    html.marble-zones-off .marble-change-layer:not(:has(> [data-local])),
    html.marble-zones-off .marble-change-layer > :not([data-local]) { display: none; }

    /* A tint is a fill, the way a selection is shown: light ahead, deeper
       with a full hairline of the accent while the part lands, and it lifts
       as a fade. Nothing is drawn on one side of anything. */
    .marble-change-tint { position: fixed; left: 0; top: 0; box-sizing: border-box; border-radius: 6px;
      background-color: color-mix(in srgb, var(--change-accent) 13%, transparent);
      transition: background-color 240ms var(--change-colour), box-shadow 240ms var(--change-colour), opacity 220ms var(--change-ease); }
    .marble-change-tint[data-state="now"] { background-color: color-mix(in srgb, var(--change-accent) 22%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--change-ink) 26%, transparent); }
    .marble-change-tint[data-state="lift"] { opacity: 0;
      transition: background-color 240ms var(--change-colour), box-shadow 240ms var(--change-colour), opacity ${LIFT}ms var(--change-ease); }
    .marble-change-tint[data-state="gone"], .marble-change-dot[data-state="gone"], .marble-change-tag[data-state="gone"],
    .marble-change-rail[data-state="gone"], .marble-change-more[data-state="gone"] { opacity: 0; transition: opacity ${GONE}ms var(--change-ease); }
    .marble-change-tint[hidden], .marble-change-dot[hidden] { display: none; }
    /* A part whose group of a fan out failed (data-state="failed") keeps
       the light tint above, the one it had ahead: not yet changed. */
    /* Left out of a change made by hand: a full dashed ring, no fill. */
    .marble-change-tint[data-state="out"] { background-color: transparent;
      border: 1px dashed color-mix(in srgb, var(--change-ink) 70%, transparent); }

    /* Too many to mark: a dot in the margin beside each part. Faint ahead, a
       ring while it lands, solid once it has. */
    .marble-change-dot { position: fixed; left: 0; top: 0; width: 5px; height: 5px; margin: -2.5px 0 0 -2.5px; border-radius: 50%;
      background-color: color-mix(in srgb, var(--change-ink) 26%, transparent);
      transition: background-color 240ms var(--change-colour), box-shadow 240ms var(--change-colour), opacity 220ms var(--change-ease); }
    .marble-change-dot[data-state="now"] { background-color: var(--change-card); box-shadow: 0 0 0 1.5px var(--change-ink); }
    .marble-change-dot[data-state="landed"] { background-color: var(--change-ink); }

    /* The tag hangs from the part changing now: its squared corner on the
       part, or across a bordered part's top edge. It moves with the work. */
    .marble-change-tag { position: fixed; left: 0; top: 0; pointer-events: auto; }
    .marble-change-tag[data-glide] { transition: left 400ms var(--change-ease), top 400ms var(--change-ease); }
    .marble-change-press { appearance: none; margin: 0; display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 7px; border: 1px solid color-mix(in srgb, var(--change-ink) 30%, transparent);
      border-radius: 6px 6px 6px 1px; background: color-mix(in srgb, var(--change-ink) 12%, var(--change-card));
      color: color-mix(in srgb, var(--change-ink) 70%, var(--change-text)); font: inherit; letter-spacing: -.005em;
      white-space: nowrap; cursor: pointer; transition: background-color 120ms var(--change-colour); }
    .marble-change-tag[data-edge] .marble-change-press { border-radius: 6px; }
    /* A change made by hand: the tag only says what it is doing; it is no
       way into a conversation, and never takes a press from the hand. */
    .marble-change-tag[data-local] { pointer-events: none; }
    .marble-change-tag[data-local] .marble-change-press { cursor: default; }
    .marble-change-tag[data-local] .marble-change-time,
    .marble-change-tag[data-local] .marble-change-meter,
    .marble-change-tag[data-local] .marble-change-steps { display: none; }
    .marble-change-press:hover { background: color-mix(in srgb, var(--change-ink) 18%, var(--change-card)); }
    .marble-change-press:active { background: color-mix(in srgb, var(--change-ink) 24%, var(--change-card)); }
    .marble-change-press:focus-visible { outline: 2px solid color-mix(in srgb, var(--change-ink) 55%, transparent); outline-offset: 2px; }
    .marble-change-tag-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--change-ink); }
    .marble-change-said:empty { display: none; }
    .marble-change-said b, .marble-change-said-aloud b { font-weight: 650; font-variant-numeric: tabular-nums; color: var(--change-ink); }
    .marble-change-meter { position: relative; flex: none; width: 40px; height: 4px; border-radius: 2px; overflow: hidden;
      background: color-mix(in srgb, var(--change-ink) 22%, transparent); }
    .marble-change-meter > i { position: absolute; inset: 0 auto 0 0; width: var(--p, 0%); border-radius: 2px; background: var(--change-ink);
      transition: width 240ms var(--change-ease); }
    .marble-change-steps { display: inline-flex; gap: 3px; }
    .marble-change-steps > i { position: relative; flex: none; width: 12px; height: 4px; border-radius: 2px; overflow: hidden;
      background: color-mix(in srgb, var(--change-ink) 22%, transparent); }
    .marble-change-steps > i[data-state="done"] { background: var(--change-ink); }
    .marble-change-steps > i[data-state="now"]::after { content: ""; position: absolute; inset: 0 50% 0 0; background: var(--change-ink); }
    .marble-change-meter[hidden], .marble-change-steps[hidden] { display: none; }
    .marble-change-time { font-weight: 400; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--change-ink) 52%, var(--change-text)); }

    /* Resting on the tag opens the change's status under it, in the page's
       ink: what was asked, whole; how long it has run; its steps so far. */
    .marble-change-status { position: absolute; left: 0; top: calc(100% + 6px); box-sizing: border-box;
      width: max-content; min-width: 13rem; max-width: min(18rem, calc(100vw - ${INSIDE * 2}px));
      padding: 10px 12px 11px; border-radius: 10px; background: var(--change-card); color: var(--change-text);
      box-shadow: 0 0 0 1px var(--change-line), var(--shadow-lift, 0 10px 28px -12px rgba(0, 0, 0, .3));
      font: 400 12px/1.4 var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif));
      white-space: normal; text-wrap: pretty; text-align: left; pointer-events: auto;
      opacity: 0; visibility: hidden; transition: opacity 140ms var(--change-colour), visibility 0s linear 140ms; }
    .marble-change-tag[data-open] .marble-change-status { opacity: 1; visibility: visible; transition: opacity 200ms var(--change-colour), visibility 0s; }
    .marble-change-tag[data-flip] .marble-change-status { top: auto; bottom: calc(100% + 6px); }
    .marble-change-ask { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .marble-change-ask:empty { display: none; }
    .marble-change-status time { display: block; margin-top: 3px; color: var(--change-muted); font-variant-numeric: tabular-nums; }
    /* A rule in the page's grey line, between what was asked and its steps. */
    .marble-change-steplist { list-style: none; display: grid; gap: 6px; margin: 9px 0 0; padding: 9px 0 0;
      border-top: 1px solid var(--change-line); }
    .marble-change-steplist:empty { display: none; }
    .marble-change-steplist > li { display: flex; align-items: center; gap: 8px; color: var(--change-faint); }
    .marble-change-steplist .mark { flex: none; box-sizing: border-box; display: grid; place-items: center; width: 10px; height: 10px; border-radius: 50%;
      border: 1.5px solid color-mix(in srgb, var(--change-ink) 32%, transparent); color: var(--change-card); }
    .marble-change-steplist .mark svg { width: 8px; height: 8px; visibility: hidden; }
    .marble-change-steplist > li[data-state="done"] { color: var(--change-muted); }
    .marble-change-steplist > li[data-state="done"] .mark { border-color: var(--change-ink); background: var(--change-ink); }
    .marble-change-steplist > li[data-state="done"] .mark svg { visibility: visible; }
    .marble-change-steplist > li[data-state="now"] { color: var(--change-text); font-weight: 560; }
    .marble-change-steplist > li[data-state="now"] .mark { border-color: var(--change-ink); }
    .marble-change-steplist > li[data-state="more"] { padding-left: 18px; }

    /* Out of view: the rail stands for the whole page, a tick per part at
       its place, and the pill takes you to the next one. */
    .marble-change-rail { position: fixed; right: calc(6px + var(--change-inset)); top: 12px; bottom: 12px; width: 2px; border-radius: 1px;
      background: color-mix(in srgb, var(--change-ink) 14%, transparent); transition: opacity ${GONE}ms var(--change-ease); }
    .marble-change-tick { position: absolute; left: -4px; top: 0; width: 10px; height: 3px; margin-top: -1.5px; border-radius: 2px;
      background: color-mix(in srgb, var(--change-ink) 32%, transparent); }
    .marble-change-tick[data-state="landed"] { background: var(--change-ink); }
    .marble-change-tick[data-state="now"] { left: -6px; width: 14px; height: 4px; margin-top: -2px; background: var(--change-ink); }
    .marble-change-more { position: fixed; right: calc(20px + var(--change-inset)); bottom: 80px; pointer-events: auto; appearance: none; margin: 0;
      display: inline-flex; align-items: center; gap: 4px; padding: 5px 8px 5px 11px; border-radius: 999px;
      border: 1px solid var(--change-line); background: var(--change-card); color: var(--change-text);
      box-shadow: var(--shadow, 0 1px 3px rgba(0, 0, 0, .12)); font: inherit; white-space: nowrap; cursor: pointer;
      transition: background-color 120ms var(--change-colour), opacity ${GONE}ms var(--change-ease); }
    .marble-change-more[data-dir="above"] { bottom: auto; top: 16px; }
    .marble-change-more:hover { background: color-mix(in srgb, var(--change-text) 5%, var(--change-card)); }
    .marble-change-more:active { background: color-mix(in srgb, var(--change-text) 9%, var(--change-card)); }
    .marble-change-more:focus-visible { outline: 2px solid color-mix(in srgb, var(--change-ink) 55%, transparent); outline-offset: 2px; }
    .marble-change-more svg { width: 12px; height: 12px; flex: none; }
    .marble-change-said-aloud { position: fixed; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

    @media (prefers-reduced-motion: reduce) {
      .marble-change-tag[data-glide] { transition: none; }
      .marble-change-tint[data-state="lift"] { transition-duration: ${STILL}ms; }
      .marble-change-meter > i { transition: none; }
    }
  `;

  const CHEVRON = (dir) => `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'above' ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}"/></svg>`;
  const CHECK = '<svg viewBox="0 0 8 8" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.6 4.2l1.6 1.5 3.2-3.4"/></svg>';

  // The parts' own unit, from what they are. A kind the page cannot tell by
  // its tag names itself (`data-marble-kind="chart"`). The line ⌘J opens
  // (change-line.js) and a rule (change-rules.js) name their things with the
  // same words.
  const UNITS = [
    ['li, tr', 'row', 'rows'],
    ['td, th', 'cell', 'cells'],
    ['p', 'paragraph', 'paragraphs'],
    ['h1, h2, h3, h4, h5, h6', 'heading', 'headings'],
    ['img, picture, figure', 'picture', 'pictures'],
    ['section', 'section', 'sections'],
    ['button', 'button', 'buttons'],
    ['input, select, textarea', 'field', 'fields'],
    ['a', 'link', 'links'],
    ['svg', 'drawing', 'drawings'],
    ['ul, ol, dl', 'list', 'lists'],
    ['table', 'table', 'tables'],
  ];
  // A class that names a thing ("card", "v5-card", "paper_tile") says what a
  // part is better than its tag does: a <div class="card"> is a card. Only
  // the last word of a class counts ("card-header" is a header, not a card),
  // and only these nouns, so a class that says how a part looks ("round",
  // "wide", "active") never becomes its name.
  const NOUNS = new Map(Object.entries({
    card: 'cards', panel: 'panels', pane: 'panes', tile: 'tiles', chip: 'chips', tag: 'tags', pill: 'pills',
    badge: 'badges', btn: ['button', 'buttons'], button: 'buttons', item: 'items', row: 'rows', cell: 'cells',
    entry: 'entries', note: 'notes', post: 'posts', box: 'boxes', field: 'fields', tab: 'tabs', avatar: 'avatars',
    thumb: ['thumbnail', 'thumbnails'], photo: 'photos', image: 'images', quote: 'quotes', callout: 'callouts',
    banner: 'banners', step: 'steps', slide: 'slides', column: 'columns', col: ['column', 'columns'],
    section: 'sections', link: 'links', icon: 'icons', label: 'labels', event: 'events', task: 'tasks',
    paper: 'papers', list: 'lists', table: 'tables', chart: 'charts', widget: 'widgets', bubble: 'bubbles',
    message: 'messages', comment: 'comments', block: 'blocks', group: 'groups', sheet: 'sheets',
    dialog: 'dialogs', modal: ['dialog', 'dialogs'], toolbar: 'toolbars', menu: 'menus', stat: 'stats',
  }));
  function nounOf(el) {
    for (const name of el.classList ?? []) {
      if (name.startsWith('marble-')) continue;
      const last = name.toLowerCase().split(/[-_]/).filter(Boolean).at(-1);
      const many = last && NOUNS.get(last);
      if (many) return Array.isArray(many) ? many : [last, many];
    }
    return null;
  }
  function unitOf(el) {
    if (!el) return ['part', 'parts'];
    const kind = el.getAttribute('data-marble-kind')?.trim();
    if (kind) return [kind, `${kind}s`];
    const noun = nounOf(el);
    if (noun) return noun;
    for (const [selector, one, many] of UNITS) if (el.matches(selector)) return [one, many];
    return ['part', 'parts'];
  }

  const list = (value) => (Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : []);
  const clock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };


  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    // A page with its own conversation UI keeps the zone (collab.js).
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-change-layer')) return;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);
    // The layer itself is not hidden from assistive tech: the tag and the
    // pill are buttons. Each mark that is only a picture says so itself.
    const layer = document.createElement('div');
    layer.className = 'marble-change-layer';
    layer.setAttribute(TRANSIENT, '');
    document.documentElement.append(layer);
    const aloud = document.createElement('div');
    aloud.className = 'marble-change-said-aloud';
    aloud.setAttribute(TRANSIENT, '');
    aloud.setAttribute('role', 'status');
    document.documentElement.append(aloud);

    const byId = (id) => (id ? (marble.byId?.(id) ?? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`)) : null);
    const drawable = (el) => Boolean(el?.isConnected && !SKIP.has(el.tagName) && !el.closest(`[${TRANSIENT}]`));
    /** A holder's element, kept between paints and looked up again only once
     *  it has left the page (a part replaced under the same id). */
    function resolve(holder) {
      const el = holder.node;
      if (el?.isConnected && el.getAttribute('data-marble-id') === holder.id) return el;
      holder.node = byId(holder.id);
      return holder.node;
    }
    const conversationOf = (client) => /^agent(?:-undo)?:(.+)$/.exec(String(client ?? ''))?.[1] ?? null;
    const isUndo = (client) => String(client ?? '').startsWith('agent-undo:');
    // A chat this tab is following: asked from here, or opened to follow.
    // An undo is the person's own verdict, so it is always drawn.
    const attended = (client) => {
      if (isUndo(client)) return true;
      if (!String(client).startsWith('agent:')) return false;
      const id = conversationOf(client);
      return Boolean(id) && (typeof agent.attending !== 'function' || agent.attending(id));
    };
    // Ruling R2: words in one block are the caret's, and its tag is the
    // change's tag. Nothing of this layer is drawn for it meanwhile.
    const inText = (client) => Boolean(window.marbleText?.claims?.(client));
    const still = () => stillness.matches;

    // ------------------------------------------------------------ state

    // client -> run. One run is one turn of one chat on this page.
    const runs = new Map();

    function newRun(client, turn) {
      return {
        client,
        turn,
        conversation: conversationOf(client),
        undo: isUndo(client),
        startedAt: performance.now(),
        endedAt: null,
        prompt: '',
        read: new Set(),
        reading: false,
        scope: new Map(),     // id -> { id, state: 'soon'|'lift', el }
        parts: new Map(),     // id -> { id, state: 'soon'|'now'|'landed', lifted, dotted, unit, delay, tint, dot }
        reachKey: '',
        many: false,
        verb: null,
        count: 0,
        total: null,
        step: null,
        steps: new Map(),     // n -> what the note called it
        groups: null,         // the latest fan out's groups, as the host counts them: { call, done, failed, of, seq }
        failedGroups: new Map(), // key -> { ids, left }: failed groups whose parts have not landed since
        hang: null,
        hangHolder: null,
        hangBox: null,
        tagOn: null,
        tag: null,
        batches: [],
        seen: new Set(),      // the batches whose first frame this page saw
        ending: false,
        gone: false,
        done: null,
        drawn: false,
        idle: 0,
        timers: new Set(),
        local: false,         // a change the page makes itself (`begin`)
        words: null,          // what its tag says, as pieces
        endWords: null,
      };
    }

    function after(run, ms, fn) {
      const timer = setTimeout(() => {
        run.timers.delete(timer);
        if (runs.get(run.client) === run) fn();
      }, ms);
      run.timers.add(timer);
      return timer;
    }

    function addPart(run, id, state, delay = 0) {
      const part = { id, state, lifted: false, dotted: run.many, unit: null, delay, tint: null, dot: null, node: null };
      run.parts.set(id, part);
      return part;
    }

    function liftScope(run) {
      for (const mark of run.scope.values()) {
        if (mark.state === 'lift') continue;
        mark.state = 'lift';
        after(run, GONE, () => { run.scope.delete(mark.id); mark.el?.remove(); schedule(); });
      }
    }

    function landPart(run, id) {
      const part = run.parts.get(id);
      if (!part || part.state === 'landed') return;
      part.state = 'landed';
      after(run, still() ? STILL : LIFT, () => { part.lifted = true; schedule(); });
    }

    function land(run, batch) {
      if (batch.landed) return;
      batch.landed = true;
      batch.played = true;
      for (const id of batch.parts) landPart(run, id);
      run.batches = run.batches.filter((b) => b !== batch);
      document.dispatchEvent(new CustomEvent('marble-change:landed', { detail: { client: run.client, turn: run.turn, ids: [...batch.parts] } }));
      schedule();
    }

    /** An undo has no end of its own to wait for if its last frames never
     *  come: a while after the last one, its marks lift anyway. */
    function touch(run) {
      if (!run.undo) return;
      clearTimeout(run.idle);
      run.timers.delete(run.idle);
      run.idle = after(run, UNDO_IDLE, () => {
        for (const batch of [...run.batches]) land(run, batch);
        for (const id of run.parts.keys()) landPart(run, id);
        schedule();
      });
    }

    function settleFields(run, d) {
      if (Number.isFinite(d.count) && d.count > 0) run.count = Math.max(run.count, d.count);
      if (Number.isFinite(d.total) && d.total > 0) run.total = d.total;
      if (d.step && Number.isFinite(d.step.n)) {
        run.step = { n: d.step.n, of: Number.isFinite(d.step.of) ? d.step.of : null };
        if (d.step.text) run.steps.set(d.step.n, String(d.step.text));
      }
      // The host numbers every count it says: a frame that crossed a newer
      // one on the way is older, and a new fan out (a newer count) starts
      // its own from nothing.
      const g = d.groups;
      if (g && Number.isFinite(g.of) && g.of > 0) {
        const seq = Number.isFinite(g.seq) ? g.seq : null;
        if (!run.groups || seq === null || run.groups.seq === null || seq > run.groups.seq) {
          run.groups = {
            call: g.call ?? null,
            of: g.of,
            done: Number.isFinite(g.done) ? g.done : 0,
            failed: Number.isFinite(g.failed) ? g.failed : 0,
            seq,
          };
        }
      }
    }

    /** How many groups of a fan out are failed: at the end, as the host says;
     *  while it runs, as the host counts the latest fan out; with nothing from
     *  the host, the failed groups this page saw whose parts have not landed. */
    function failedOf(run) {
      if (run.ending && Number.isFinite(run.done?.failed)) return run.done.failed;
      if (run.groups) return run.groups.failed;
      return run.failedGroups.size;
    }

    /** A batch whose ops name a failed group's part, or something inside it
     *  — change, remove or move it, or insert into it — has landed that part
     *  after all, and its mark goes as any landed part's does. An op beside
     *  it, or on what holds it, is not about it: the host's rule
     *  (server/agent/tools.js, `settleLost`). A group whose every part has
     *  landed is not failed. */
    function recover(run, ids, landing) {
      if (!run.failedGroups.size || !ids.length) return;
      const els = ids.map(byId).filter(Boolean);
      for (const [key, group] of run.failedGroups) {
        for (const id of [...group.left]) {
          const el = byId(id);
          if (!ids.includes(id) && !(el && els.some((other) => el.contains(other)))) continue;
          group.left.delete(id);
          if (run.parts.get(id)?.state === 'failed' && !landing.includes(id)) landPart(run, id);
        }
        if (!group.left.size) run.failedGroups.delete(key);
      }
    }

    // A batch's two frames carry the same count and parts; nothing else
    // names which batch an `after` closes.
    const batchKey = (d) => `${Number.isFinite(d.count) ? d.count : ''}|${list(d.parts).join(',')}`;

    function verbOf(d, parts, inserted) {
      switch (d.kind) {
        case 'words': return 'Rewriting';
        case 'look': return 'Restyling';
        case 'structure': {
          const ins = new Set(inserted);
          const rem = new Set(list(d.removes));
          const moved = list(d.moves).length > 0;
          if (ins.size && !rem.size && !moved && parts.every((id) => ins.has(id))) return 'Adding';
          if (rem.size && !ins.size && !moved && parts.every((id) => rem.has(id))) return 'Removing';
          return 'Changing';
        }
        default: return 'Changing';
      }
    }

    /** The outermost of `ids`: a row and the cells inside it are one part.
     *  Ids not on the page (yet, or any more) are kept as they are. */
    function topmost(ids) {
      if (ids.length > 300) return ids;
      const els = ids.map((id) => [id, byId(id)]);
      return ids.filter((id, i) => {
        const el = els[i][1];
        return !el || !els.some(([other, o]) => other !== id && o && o !== el && o.contains(el));
      });
    }

    function dropPart(run, id) {
      const part = run.parts.get(id);
      if (!part) return;
      part.tint?.remove();
      part.dot?.remove();
      run.parts.delete(id);
    }

    /** The first element among `ids` there is something of on screen, the
     *  nearest the window first. */
    function firstShown(ids) {
      let fallback = null;
      for (const id of ids.slice(0, 400)) {
        const el = byId(id);
        if (!drawable(el)) continue;
        const r = rectOf(el);
        if (!r) continue;
        if (r.bottom > 0 && r.top < innerHeight) return id;
        fallback ??= id;
      }
      return fallback;
    }

    function onStart(run, d) {
      run.startedAt = performance.now();
      for (const id of list(d.ids)) {
        if (drawable(byId(id))) run.scope.set(id, { id, state: 'soon', el: null, node: null });
      }
      run.hang ??= run.scope.keys().next().value ?? null;
    }

    function onRead(run, d) {
      const ids = list(d.ids);
      for (const id of ids) run.read.add(id);
      if (!run.read.size) return;
      run.reading = true;
      if (!run.hang || !drawable(byId(run.hang))) run.hang = firstShown(ids) ?? run.hang;
    }

    function onBatch(run, d, { landed = false } = {}) {
      run.reading = false;
      settleFields(run, d);
      // The batch's finest parts (server/change/parts.js). A frame that names
      // none, from a host before v5, falls back to the ids its ops address,
      // and a row is one part with the cells inside it.
      const named = list(d.parts);
      const parts = topmost(named.length ? named : list(d.ids));
      const inserted = (Array.isArray(d.inserts) ? d.inserts : []).flatMap((entry) => list(entry?.ids));
      const reach = list(d.reach);
      // An earlier batch whose ops never came has landed as far as anyone
      // here will see. One still moving lands when its motion ends.
      for (const old of run.batches.filter((b) => !b.played)) land(run, old);
      // What the batch's ops name (the frame's ids; a frame that names none,
      // its parts), and where its inserts go.
      const addressed = list(d.ids).length ? list(d.ids) : parts;
      recover(run, [...addressed, ...(Array.isArray(d.inserts) ? d.inserts : []).map((entry) => entry?.parentId).filter(Boolean)], parts);
      const distinct = new Set([...run.parts.keys(), ...parts, ...reach]);
      if (!run.many && Math.max(distinct.size, run.count, run.total ?? 0) > MANY) run.many = true;
      const reachKey = reach.join(',');
      if (reach.length && reachKey !== run.reachKey) {
        run.reachKey = reachKey;
        for (const id of reach) {
          if (!run.parts.has(id)) addPart(run, id, 'soon', still() ? 0 : Math.random() * SPREAD);
        }
      }
      for (const id of parts) {
        const part = run.parts.get(id) ?? addPart(run, id, 'soon');
        part.state = 'now';
        part.lifted = false;
        part.delay = 0;
      }
      if (parts.length) liftScope(run);
      if (d.kind || !run.verb) run.verb = verbOf(d, parts, inserted);
      const hang = parts.find((id) => drawable(byId(id)));
      if (hang) run.hang = hang;
      const key = batchKey(d);
      run.seen.add(key);
      const batch = {
        key, parts, inserted, landed: false, played: false, snapshot: null,
        structure: d.kind === 'structure', named: inserted.length > 0 || list(d.removes).length > 0 || list(d.moves).length > 0,
        fresh: new Set(parts.filter((id) => !byId(id))),
      };
      run.batches.push(batch);
      const morph = window.marbleMorph;
      if (landed) {
        batch.played = true;
        after(run, LAND_AFTER, () => land(run, batch));
      } else if (typeof morph?.capture === 'function') {
        try { batch.snapshot = morph.capture(parts, d); } catch { batch.snapshot = null; }
      }
      // What this batch may take out is measured now, while it is here: its
      // ops can land before the next paint, and it is still tinted where it
      // stood. A frame that does not say its kind (an undo's) does not say
      // what it takes out either.
      if (!landed) for (const id of (d.kind ? list(d.removes) : parts).slice(0, MOST_GOING)) markWhereItIs(run, id);
    }

    /** A part's tint box, from where it stands now, kept for when it is gone. */
    function markWhereItIs(run, id) {
      const part = run.parts.get(id);
      const el = part && resolve(part);
      if (!drawable(el)) return;
      const r = rectOf(el);
      if (!r) return;
      const box = partBox(r, shapeOf(part, el));
      part.box = { ...page(box), radius: box.radius };
      part.seeded = true;
    }

    function onAfter(run, d) {
      settleFields(run, d);
      const key = batchKey(d);
      if (!run.seen.has(key)) {
        // The batch's first frame went by before this page was listening.
        onBatch(run, d, { landed: true });
        return;
      }
      // Its ops never reached this page: it has landed all the same.
      const batch = run.batches.find((b) => b.key === key && !b.played);
      if (batch) {
        batch.played = true;
        after(run, LAND_AFTER, () => land(run, batch));
      }
    }

    /** A group whose worker failed: nothing of it changed, so its parts
     *  keep a light tint until the change ends, and the tag counts it. */
    function onFailed(run, d) {
      settleFields(run, d);
      const ids = topmost(list(d.failed));
      run.failedGroups.set(`${d.groups?.call ?? ''}|${ids.join(',')}`, { ids, left: new Set(ids) });
      for (const id of ids) {
        const part = run.parts.get(id) ?? addPart(run, id, 'failed');
        part.state = 'failed';
        part.lifted = false;
        part.delay = 0;
      }
      if (!run.hang || !drawable(byId(run.hang))) run.hang = firstShown(ids) ?? run.hang;
    }

    function onOps(detail) {
      const run = runs.get(String(detail?.client ?? ''));
      if (!run || run.ending) return;
      const batch = run.batches.find((b) => !b.played);
      if (!batch) return;
      batch.played = true;
      touch(run);
      // What the ops brought in is on the page now. A row and its cells are
      // one part; a part whose look the ops changed is measured afresh.
      const kept = topmost(batch.parts);
      for (const id of batch.parts) if (!kept.includes(id)) dropPart(run, id);
      batch.parts = kept;
      for (const id of kept) { const part = run.parts.get(id); if (part) part.shape = null; }
      // A frame that named no inserts or removes (a host before v5): parts
      // that were not here before were added, parts that went were removed.
      if (batch.structure && !batch.named && kept.length) {
        if (kept.every((id) => batch.fresh.has(id) && byId(id))) run.verb = 'Adding';
        else if (kept.every((id) => !batch.fresh.has(id) && !byId(id))) run.verb = 'Removing';
      }
      if (!run.hang || !drawable(byId(run.hang))) {
        run.hang = [...batch.parts, ...batch.inserted].find((id) => drawable(byId(id))) ?? run.hang;
      }
      // The engine (change-morph.js) plays the batch from what was to what
      // is; each part lifts as its own motion ends, and the batch lands once
      // all of it has. A part with nothing to play (past the engine's budget,
      // or nothing of it seen to change) still shows that it landed: none
      // lifts sooner than it would with no engine at all.
      const morph = window.marbleMorph;
      if (batch.snapshot && typeof morph?.play === 'function') {
        let played = null;
        batch.moving = true;
        const opsAt = performance.now();
        const settled = (fn) => {
          const wait = opsAt + LAND_AFTER - performance.now();
          if (wait > 0) after(run, wait, fn);
          else fn();
        };
        try {
          played = morph.play(batch.snapshot, {
            onPart: (id, phase) => {
              if (phase === 'end' && runs.get(run.client) === run) settled(() => { landPart(run, id); schedule(); });
            },
          });
        } catch { played = null; }
        batch.snapshot = null;
        const landed = () => settled(() => { batch.moving = false; land(run, batch); });
        Promise.resolve(played).then(landed, landed);
      } else {
        after(run, LAND_AFTER, () => land(run, batch));
      }
      schedule();
    }

    function endWords(done, failed = 0) {
      const counts = [];
      if (done?.changed) counts.push([done.changed, 'changed']);
      if (done?.added) counts.push([done.added, 'added']);
      if (done?.removed) counts.push([done.removed, 'removed']);
      const lost = failed ? [[failed, 'failed']] : [];
      if (done?.status === 'cancelled') return [['Stopped'], ...counts, ...lost];
      if (done?.status === 'failed') return [['Didn\'t finish'], ...counts, ...lost];
      return [...(counts.length ? counts : [['Nothing changed']]), ...lost];
    }

    function end(run, done) {
      if (run.ending) return;
      run.ending = true;
      run.done = done;
      run.reading = false;
      run.endedAt = performance.now();
      // A batch still moving lands when its motion ends, not before.
      const moving = new Set(run.batches.filter((b) => b.moving).flatMap((b) => b.parts));
      for (const batch of [...run.batches]) if (!batch.moving) land(run, batch);
      for (const id of run.parts.keys()) if (!moving.has(id)) landPart(run, id);
      liftScope(run);
      document.dispatchEvent(new CustomEvent('marble-change:end', { detail: { client: run.client, turn: run.turn, done } }));
      // Nothing changed, and the line this was asked from will say why (or
      // answer): the marks say nothing more (ruling R16).
      run.quiet = lineSpeaks(run, done);
      const shown = run.tag && done && !run.quiet;
      if (shown) aloud.textContent = endWords(done, failedOf(run)).map((bit) => bit.join(' ')).join(' · ');
      schedule();
      // The numbers stay up a moment; then everything goes, and the page is
      // the page.
      after(run, shown ? SHOWN : 0, () => {
        run.gone = true;
        schedule();
        after(run, GONE, () => forget(run));
      });
    }

    /** Whether the line (change-line.js) will speak for this run's end: it
     *  was asked from the line and nothing changed, so it comes back there
     *  as an answer or as why, and an end tag would say it twice. */
    function lineSpeaks(run, done) {
      if (run.undo || !done || done.status === 'cancelled') return false;
      if (done.changed || done.added || done.removed) return false;
      return Boolean(window.marbleLine?.owns?.(run.conversation));
    }
    // The line spoke before the end was heard here: the marks go now.
    document.addEventListener('marble-line:speaks', (event) => {
      const run = runs.get(`agent:${event.detail?.conversation ?? ''}`);
      if (!run || !run.ending || run.quiet || run.gone) return;
      run.quiet = true;
      aloud.textContent = '';
      run.gone = true;
      schedule();
      after(run, GONE, () => forget(run));
    });

    /** An undo's end (the host's empty look once it has written): what it
     *  marked lifts as it lands, and the run goes once that has lifted. A
     *  redo under the same client and turn picks the run up again. */
    function endUndo(run) {
      for (const batch of run.batches.filter((b) => !b.played)) land(run, batch);
      document.dispatchEvent(new CustomEvent('marble-change:end', { detail: { client: run.client, turn: run.turn, done: null } }));
      touch(run);
      schedule();
    }

    function forget(run) {
      for (const timer of run.timers) clearTimeout(timer);
      run.timers.clear();
      for (const mark of run.scope.values()) mark.el?.remove();
      for (const part of run.parts.values()) { part.tint?.remove(); part.dot?.remove(); }
      run.tag?.root.remove();
      run.tag = null;
      if (runs.get(run.client) === run) runs.delete(run.client);
      schedule();
    }

    // ------------------------------------------------------------ frames

    function onPresence(detail, { caught = false } = {}) {
      const client = String(detail?.client ?? '');
      if (!/^agent(-undo)?:/.test(client)) return;
      // A press is one control at one instant: collab.js rings it.
      if (detail.phase === 'acting') return;
      let run = runs.get(client);
      // The end is heard whoever is following, so a chat put out of mind
      // mid-change still lets go of its marks.
      if (detail.stage === 'end') {
        if (run && (!detail.turn || detail.turn === run.turn)) {
          if (run.undo) endUndo(run);
          else end(run, detail.done ?? null);
        }
        return;
      }
      // Unattended: a dot on the element, if the person asked for dots.
      if (!attended(client)) {
        if (run) forget(run);
        return;
      }
      // A frame without a turn is from before the host said which parts:
      // the zone draws it.
      if (!detail.turn) return;
      if (run && run.turn !== detail.turn) {
        forget(run);
        run = null;
      }
      if (run?.ending) return;
      if (!run) {
        run = newRun(client, String(detail.turn));
        runs.set(client, run);
      }
      if (detail.prompt) run.prompt = String(detail.prompt);
      if (list(detail.failed).length) onFailed(run, detail);
      else if (detail.stage === 'start') onStart(run, detail);
      else if (detail.stage === 'before') onBatch(run, detail, { landed: caught });
      else if (detail.stage === 'after') onAfter(run, detail);
      else if (detail.phase === 'reading') onRead(run, detail);
      touch(run);
      schedule();
    }

    // ------------------------------------------------------------ measuring
    //
    // One paint a frame, however many frames, ops and timers asked for one.
    // A paint reads everything first (where each part is, what it looks
    // like, where the person's hand is), then writes, then places the tags,
    // whose size it can only know once their words are written. A part with
    // nothing to draw is not measured; what a part looks like is read once
    // per element and state, not every paint.

    const stats = { renders: 0, rects: 0, styles: 0 };
    let paint = 0;
    const rectOf = (el) => {
      stats.rects += 1;
      const r = el.getBoundingClientRect();
      return r.width || r.height ? r : null;
    };
    const page = (r) => ({ left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height });
    const view = (b) => ({ left: b.left - scrollX, top: b.top - scrollY, width: b.width, height: b.height });
    const opaque = (colour) => colour && colour !== 'transparent' && !/rgba?\([^)]*,\s*0\)$/.test(colour) && !/\/\s*0\)$/.test(colour);

    /** A holder's rect in this paint, measured at most once. */
    function measure(holder) {
      if (holder.rectAt === paint) return holder.rect;
      const el = resolve(holder);
      holder.rectAt = paint;
      holder.rect = drawable(el) ? rectOf(el) : null;
      return holder.rect;
    }

    /** What a part looks like to its tint and its tag. */
    function shapeOf(holder, el) {
      if (holder.shape && holder.shapeEl === el && holder.shapeKey === holder.state) return holder.shape;
      stats.styles += 1;
      const css = getComputedStyle(el);
      const edged = parseFloat(css.borderTopWidth) > 0;
      const shaped = edged || parseFloat(css.borderLeftWidth) > 0 || opaque(css.backgroundColor) || (css.boxShadow && css.boxShadow !== 'none');
      holder.shape = {
        edged,
        shaped,
        words: !shaped && window.marbleText?.textBlockOf?.(el) === el,
        radius: css.borderRadius || '0px',
        rounded: parseFloat(css.borderTopLeftRadius) > 0,
        rows: /^(list-item|table)/.test(css.display),
      };
      holder.shapeEl = el;
      holder.shapeKey = holder.state;
      return holder.shape;
    }

    const grow = (radius) => (radius.includes('%') ? radius : radius.replace(/([\d.]+)px/g, (_, n) => `${Number(n) + OUT}px`));
    const scopeBox = (r, shape) => ({
      left: r.left - OUT, top: r.top - OUT, width: r.width + OUT * 2, height: r.height + OUT * 2, radius: grow(shape.radius),
    });
    /** A part with a shape of its own is tinted to its edge and corners;
     *  words have none, so they get a little room round them, as a
     *  highlighter would leave. Rows sit edge to edge, so they get none above
     *  and below, or it would wash into the next. */
    function partBox(r, shape) {
      if (shape.shaped) return { left: r.left, top: r.top, width: r.width, height: r.height, radius: shape.radius };
      if (!shape.words) return { left: r.left, top: r.top, width: r.width, height: r.height, radius: shape.rounded ? shape.radius : '4px' };
      const y = shape.rows ? 0 : 3;
      return { left: r.left - 6, top: r.top - y, width: r.width + 12, height: r.height + y * 2, radius: '6px' };
    }

    /** The person's hand: focus in a part, or their caret in it. */
    function handNodes() {
      const out = [];
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement && !active.closest?.(`[${TRANSIENT}]`)) out.push(active);
      const sel = getSelection?.();
      const node = sel?.rangeCount ? sel.anchorNode : null;
      const at = node?.nodeType === 1 ? node : node?.parentElement;
      if (at?.isContentEditable) out.push(at);
      return out;
    }
    const inHand = (el, hand) => Boolean(el) && hand.some((node) => el.contains(node));

    // ------------------------------------------------------------ marks

    function tintStateOf(run, part) {
      let tint = null;
      if (part.state === 'out') tint = 'out';
      else if (part.state === 'now') tint = 'now';
      else if (part.state === 'failed') tint = 'failed';
      else if (part.state === 'soon' && !part.dotted) tint = 'soon';
      else if (part.state === 'landed' && !part.lifted) tint = 'lift';
      return run.gone && tint ? 'gone' : tint;
    }

    /** What one tint should be in this paint. Lifting and going are what a
     *  tint already there does; nothing is made just to fade. A part that has
     *  gone keeps its tint where it last stood while that lifts. */
    function planTint(holder, key, state, kind, hand) {
      const existing = holder[key];
      const leaving = state === 'lift' || state === 'gone';
      if (!state || (leaving && !existing)) return existing ? { holder, key, remove: true } : null;
      const r = measure(holder);
      let box = null;
      if (r) {
        const shape = shapeOf(holder, holder.node);
        box = kind === 'scope' ? scopeBox(r, shape) : partBox(r, shape);
        holder.box = { ...page(box), radius: box.radius };
      } else if (holder.box && (existing || (holder.seeded && !holder.node))) {
        // Gone: its tint stays where it last stood, or where it stood when
        // its batch began if it went before a paint came.
        box = { ...view(holder.box), radius: holder.box.radius };
      }
      if (!box) return existing ? { holder, key, remove: true } : null;
      return { holder, key, kind, state, box, held: Boolean(r) && inHand(holder.node, hand) };
    }

    function planDot(part, state, hand) {
      const existing = part.dot;
      if (!state || (state === 'gone' && !existing)) return existing ? { holder: part, key: 'dot', remove: true } : null;
      const r = measure(part);
      if (!r && !existing) return null;
      return {
        holder: part, key: 'dot', kind: 'dot', state,
        at: r ? { left: Math.max(6, r.left - 10), top: r.top + Math.min(r.height / 2, 11) } : null,
        held: Boolean(r) && inHand(part.node, hand),
      };
    }

    function fadeIn(el, delay = 0) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: still() ? STILL : 340, delay: still() ? 0 : delay, easing: EASE, fill: 'backwards',
      });
    }

    /** Only what moved is written. */
    function place(el, box) {
      const at = box.width === undefined
        ? `${Math.round(box.left)},${Math.round(box.top)}`
        : `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)},${box.radius}`;
      if (el.marblePlaced === at) return;
      el.marblePlaced = at;
      el.style.left = `${Math.round(box.left)}px`;
      el.style.top = `${Math.round(box.top)}px`;
      if (box.width !== undefined) {
        el.style.width = `${Math.round(box.width)}px`;
        el.style.height = `${Math.round(box.height)}px`;
        el.style.borderRadius = box.radius;
      }
    }

    function writeMark(plan) {
      const { holder, key } = plan;
      if (plan.remove) {
        holder[key]?.remove();
        holder[key] = null;
        return false;
      }
      let el = holder[key];
      const box = plan.kind === 'dot' ? plan.at : plan.box;
      if (!el) {
        el = document.createElement('i');
        el.className = plan.kind === 'dot' ? 'marble-change-dot' : 'marble-change-tint';
        el.setAttribute(TRANSIENT, '');
        el.setAttribute('aria-hidden', 'true');
        el.dataset.id = holder.id;
        el.dataset.state = plan.state;
        if (plan.local) el.toggleAttribute('data-local', true);
        holder[key] = el;
        if (box) place(el, box);
        layer.append(el);
        fadeIn(el, plan.kind === 'dot' ? 0 : holder.delay ?? 0);
      }
      if (el.dataset.state !== plan.state) el.dataset.state = plan.state;
      if (box) place(el, box);
      if (el.hidden !== plan.held) el.hidden = plan.held;
      return true;
    }

    // ------------------------------------------------------------ the tag

    function openConversation(run) {
      const id = run.conversation;
      if (!id) return;
      // A callout on this page for the same chat gets first refusal.
      const offer = new CustomEvent('marble-callout:open', { cancelable: true, detail: { id } });
      if (!document.dispatchEvent(offer)) return;
      agent.open?.(id);
    }

    function makeTag(run) {
      const root = document.createElement('div');
      root.className = 'marble-change-tag';
      root.setAttribute(TRANSIENT, '');
      root.dataset.client = run.client;
      const press = document.createElement('button');
      press.type = 'button';
      press.className = 'marble-change-press';
      const dot = document.createElement('span');
      dot.className = 'marble-change-tag-dot';
      dot.setAttribute('aria-hidden', 'true');
      const said = document.createElement('span');
      said.className = 'marble-change-said';
      const meter = document.createElement('span');
      meter.className = 'marble-change-meter';
      meter.setAttribute('aria-hidden', 'true');
      meter.append(document.createElement('i'));
      const steps = document.createElement('span');
      steps.className = 'marble-change-steps';
      steps.setAttribute('aria-hidden', 'true');
      const time = document.createElement('time');
      time.className = 'marble-change-time';
      press.append(dot, said, meter, steps, time);
      const status = document.createElement('div');
      status.className = 'marble-change-status';
      status.id = `marble-change-status-${Math.random().toString(36).slice(2, 9)}`;
      const ask = document.createElement('p');
      ask.className = 'marble-change-ask';
      const ran = document.createElement('time');
      const steplist = document.createElement('ol');
      steplist.className = 'marble-change-steplist';
      status.append(ask, ran, steplist);
      press.setAttribute('aria-describedby', status.id);
      root.append(press, status);
      // A change made by hand says itself where the hand is (change-rules.js
      // speaks for it); its tag is only drawn.
      if (run.local) {
        root.toggleAttribute('data-local', true);
        root.setAttribute('aria-hidden', 'true');
        press.tabIndex = -1;
      }

      const tag = { root, press, said, meter, steps, time, status, ask, ran, steplist, rest: 0, at: null, over: false };
      const open = () => { root.toggleAttribute('data-open', true); fillStatus(run, tag); placeStatus(tag); };
      const close = () => { if (!tag.over && !root.contains(document.activeElement)) root.removeAttribute('data-open'); };
      root.addEventListener('pointerenter', (event) => {
        tag.over = true;
        tag.at = { x: event.clientX, y: event.clientY };
        clearTimeout(tag.rest);
        tag.rest = setTimeout(open, REST);
      });
      root.addEventListener('pointermove', (event) => {
        if (root.hasAttribute('data-open') || !tag.at) return;
        if (Math.hypot(event.clientX - tag.at.x, event.clientY - tag.at.y) < 4) return;
        tag.at = { x: event.clientX, y: event.clientY };
        clearTimeout(tag.rest);
        tag.rest = setTimeout(open, REST);
      });
      root.addEventListener('pointerleave', () => { tag.over = false; clearTimeout(tag.rest); close(); });
      press.addEventListener('focus', open);
      press.addEventListener('blur', () => setTimeout(close, 0));
      press.addEventListener('click', () => openConversation(run));
      layer.append(root);
      root.animate(still()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: still() ? STILL : 200, easing: EASE });
      return tag;
    }

    function unitWords(run) {
      const units = new Set();
      for (const part of run.parts.values()) {
        if (!part.unit) {
          const el = resolve(part);
          if (drawable(el)) part.unit = unitOf(el);
        }
        if (part.unit) units.add(part.unit.join('|'));
      }
      return units.size === 1 ? [...units][0].split('|') : ['part', 'parts'];
    }

    /** What the tag says, as pieces: words, and numbers to set in figures. */
    function tagWords(run) {
      if (run.local) return run.ending ? run.endWords : run.words ?? [];
      // A change the line speaks for keeps its words while it goes.
      if (run.ending) return run.quiet ? null : run.done ? endWords(run.done, failedOf(run)) : [];
      if (run.reading) return [['Reading'], [run.read.size, run.read.size === 1 ? 'part' : 'parts']];
      // Some groups of a fan out failed: the tag counts groups, not parts.
      const failed = failedOf(run);
      if (failed && run.groups?.of) {
        const { done, of } = run.groups;
        return [[done, `of ${of} ${of === 1 ? 'group' : 'groups'} done`], [failed, 'failed']];
      }
      const lost = failed ? [[failed, 'failed']] : [];
      if (!run.verb) return lost;
      const n = run.count || [...run.parts.values()].filter((p) => p.state !== 'soon' && p.state !== 'failed').length;
      const [one, many] = unitWords(run);
      const howMany = run.total ?? n;
      const count = run.total ? [n, `of ${run.total} ${howMany === 1 ? one : many}`] : [n, n === 1 ? one : many];
      return lost.length ? [[run.verb, ...count], ...lost] : [[run.verb], count];
    }

    // The verb and its count read as one phrase; the end's tallies, a list.
    const VERBS = new Set(['Rewriting', 'Restyling', 'Changing', 'Adding', 'Removing', 'Reading']);
    const isCount = (pieces) => pieces.length === 2 && pieces[0].length === 1 && VERBS.has(pieces[0][0]) && typeof pieces[1][0] === 'number';

    function writeSaid(node, pieces) {
      const phrase = isCount(pieces);
      const key = JSON.stringify(pieces);
      if (node.dataset.key === key) return;
      node.dataset.key = key;
      node.replaceChildren();
      pieces.forEach((bit, i) => {
        if (i > 0) node.append(phrase ? ' ' : ' · ');
        bit.forEach((word, j) => {
          if (j > 0) node.append(' ');
          if (typeof word === 'number') {
            const b = document.createElement('b');
            b.textContent = String(word);
            node.append(b);
          } else node.append(word);
        });
      });
    }

    function elapsed(run) {
      return clock((run.endedAt ?? performance.now()) - run.startedAt);
    }

    function fillTag(run, tag) {
      const pieces = tagWords(run);
      if (pieces) writeSaid(tag.said, pieces);
      const time = elapsed(run);
      if (tag.time.textContent !== time) tag.time.textContent = time;
      const metered = Boolean(run.total) && !run.ending && !run.reading && Boolean(run.verb);
      if (tag.meter.hidden !== !metered) tag.meter.hidden = !metered;
      if (metered) {
        const p = `${Math.round(Math.min(1, (run.count || 0) / run.total) * 100)}%`;
        if (tag.meter.firstChild.style.getPropertyValue('--p') !== p) tag.meter.firstChild.style.setProperty('--p', p);
      }
      const of = run.step?.of && run.step.of <= 12 ? run.step.of : 0;
      if (tag.steps.hidden !== !of) tag.steps.hidden = !of;
      if (of) {
        while (tag.steps.children.length < of) tag.steps.append(document.createElement('i'));
        while (tag.steps.children.length > of) tag.steps.lastChild.remove();
        [...tag.steps.children].forEach((tile, i) => {
          const n = i + 1;
          const state = n < run.step.n || (run.ending && n === run.step.n && run.done?.status === 'completed') ? 'done' : n === run.step.n ? 'now' : '';
          if ((tile.dataset.state ?? '') !== state) {
            if (state) tile.dataset.state = state;
            else delete tile.dataset.state;
          }
        });
      }
      // The time is left out of the name: a focused button whose name changed
      // every second would be read out every second.
      const words = tag.said.textContent;
      const name = `${words ? `${words}. ` : ''}Open the conversation`;
      if (!run.local && tag.press.getAttribute('aria-label') !== name) tag.press.setAttribute('aria-label', name);
      if (tag.root.hasAttribute('data-open')) fillStatus(run, tag);
    }

    function fillStatus(run, tag) {
      if (tag.ask.textContent !== run.prompt) tag.ask.textContent = run.prompt;
      tag.ran.textContent = elapsed(run);
      const current = run.step?.n ?? null;
      const named = [...run.steps.entries()].sort((a, b) => a[0] - b[0]);
      const rows = named.map(([n, text]) => {
        const state = current === null ? '' : n < current || (run.ending && run.done?.status === 'completed') ? 'done' : n === current ? 'now' : '';
        return { state, text: text.charAt(0).toUpperCase() + text.slice(1) };
      });
      const last = named.at(-1)?.[0] ?? 0;
      const more = run.step?.of && run.step.of > last ? run.step.of - last : 0;
      if (more && named.length) rows.push({ state: 'more', text: `and ${more} more` });
      const key = JSON.stringify(rows);
      if (tag.steplist.dataset.key === key) return;
      tag.steplist.dataset.key = key;
      tag.steplist.replaceChildren(...rows.map(({ state, text }) => {
        const li = document.createElement('li');
        if (state) li.dataset.state = state;
        if (state !== 'more') {
          const mark = document.createElement('span');
          mark.className = 'mark';
          mark.setAttribute('aria-hidden', 'true');
          mark.innerHTML = CHECK;
          li.append(mark);
        }
        li.append(text);
        return li;
      }));
    }

    function placeStatus(tag) {
      tag.root.removeAttribute('data-flip');
      const r = tag.status.getBoundingClientRect();
      if (r.bottom > innerHeight - INSIDE) tag.root.toggleAttribute('data-flip', true);
      const left = tag.root.getBoundingClientRect().left;
      const over = left + tag.status.offsetWidth - (innerWidth - INSIDE);
      tag.status.style.left = over > 0 ? `${-Math.round(over)}px` : '0px';
    }

    /** The holder for an id the tag may hang from: a part, the scope, or an
     *  element read. */
    function holderOf(run, id) {
      if (!id) return null;
      const known = run.parts.get(id) ?? run.scope.get(id);
      if (known) return known;
      if (run.hangHolder?.id !== id) run.hangHolder = { id, node: null };
      return run.hangHolder;
    }

    /** Where the tag hangs: the part changing now; once that has gone, the
     *  newest part that has changed, else any still to come; else the last
     *  place it hung. */
    function hangOf(run, plans) {
      let holder = holderOf(run, run.hang);
      let r = holder ? measure(holder) : null;
      if (!r) {
        const parts = [...run.parts.values()].reverse();
        holder = parts.find((part) => part.state !== 'soon' && measure(part)) ?? parts.find((part) => measure(part)) ?? null;
        r = holder?.rect ?? null;
        if (holder) run.hang = holder.id;
      }
      if (r) {
        const shape = shapeOf(holder, holder.node);
        const tint = plans.find((plan) => plan && !plan.remove && plan.holder === holder && plan.kind !== 'dot'
          && plan.state !== 'gone' && !plan.held && plan.box);
        run.hangBox = { ...page(r), edged: shape.edged, tint: tint ? page(tint.box) : null };
      }
      if (!run.hangBox) return null;
      const b = run.hangBox;
      return { ...view(b), edged: b.edged, tint: b.tint ? view(b.tint) : null };
    }

    function placeTag(run, tag, at, [w, h]) {
      let x;
      let y;
      if (at.edged) {
        // Across the part's top edge, near its start: over neither its words
        // nor its neighbours'.
        x = at.left + 16;
        y = at.top - h / 2;
      } else if (at.tint) {
        // Resting on the top of the words' tint.
        x = at.tint.left;
        y = at.tint.top + 3 - h;
      } else {
        x = at.left;
        y = at.top - 2 - h;
      }
      x = Math.max(INSIDE, Math.min(x, innerWidth - INSIDE - w));
      y = Math.max(INSIDE, Math.min(y, innerHeight - INSIDE - h));
      if (tag.root.hasAttribute('data-edge') !== at.edged) tag.root.toggleAttribute('data-edge', at.edged);
      if (run.tagOn !== run.hang && run.tagOn !== null && !still()) {
        tag.root.toggleAttribute('data-glide', true);
        clearTimeout(tag.glide);
        tag.glide = setTimeout(() => tag.root.removeAttribute('data-glide'), 420);
      }
      run.tagOn = run.hang;
      place(tag.root, { left: x, top: y });
    }

    // ------------------------------------------------------------ the rail

    let rail = null;
    let more = null;

    /** Where each part is against the window: rects only, and no more of
     *  them than a rail can show. */
    function planRail(entries) {
      const below = [];
      const above = [];
      const ticks = [];
      let budget = RAIL_MAX;
      for (const { holder, state } of entries) {
        let r;
        if (holder.rectAt === paint) r = holder.rect;
        else if (budget > 0) { budget -= 1; r = measure(holder); } else continue;
        if (!r) continue;
        if (r.top >= innerHeight) below.push({ holder, r });
        else if (r.bottom <= 0) above.push({ holder, r });
        ticks.push({ top: r.top + scrollY, state });
      }
      if (!below.length && !above.length) return null;
      return {
        below, above, ticks,
        height: Math.max(1, document.documentElement.scrollHeight),
        gone: entries.length > 0 && entries.every((e) => e.gone),
      };
    }

    function writeRail(plan) {
      if (!plan) {
        rail?.remove();
        more?.remove();
        rail = null;
        more = null;
        return;
      }
      if (!rail) {
        rail = document.createElement('div');
        rail.className = 'marble-change-rail';
        rail.setAttribute(TRANSIENT, '');
        rail.setAttribute('aria-hidden', 'true');
        layer.append(rail);
      }
      while (rail.children.length < plan.ticks.length) {
        const tick = document.createElement('i');
        tick.className = 'marble-change-tick';
        rail.append(tick);
      }
      while (rail.children.length > plan.ticks.length) rail.lastChild.remove();
      plan.ticks.forEach(({ top, state }, i) => {
        const tick = rail.children[i];
        const y = `${(Math.min(1, Math.max(0, top / plan.height)) * 100).toFixed(2)}%`;
        if (tick.style.top !== y) tick.style.top = y;
        if (tick.dataset.state !== state) tick.dataset.state = state;
      });
      if (!more) {
        more = document.createElement('button');
        more.type = 'button';
        more.className = 'marble-change-more';
        more.setAttribute(TRANSIENT, '');
        more.addEventListener('click', () => {
          const target = more.target;
          if (target?.isConnected) target.scrollIntoView({ block: 'center', behavior: still() ? 'auto' : 'smooth' });
        });
        layer.append(more);
      }
      const dir = plan.below.length ? 'below' : 'above';
      const out = dir === 'below' ? plan.below : plan.above;
      const next = dir === 'below'
        ? out.reduce((a, b) => (b.r.top < a.r.top ? b : a))
        : out.reduce((a, b) => (b.r.bottom > a.r.bottom ? b : a));
      more.target = next.holder.node;
      const label = `${out.length} ${dir}`;
      if (more.dataset.label !== label) {
        more.dataset.label = label;
        more.dataset.dir = dir;
        more.innerHTML = `<span>${label}</span>${CHEVRON(dir)}`;
        more.setAttribute('aria-label', `${label}: show the next one`);
      }
      for (const el of [rail, more]) {
        if (plan.gone && el.dataset.state !== 'gone') el.dataset.state = 'gone';
        else if (!plan.gone && el.dataset.state) delete el.dataset.state;
      }
    }

    // ------------------------------------------------------------ painting

    let claimKey = '';
    let ticking = 0;
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
    // The page moved under the marks: worth a paint only while there are any.
    const nudge = () => { if (runs.size || layer.childElementCount) schedule(); };

    function render() {
      frame = 0;
      paint += 1;
      stats.renders += 1;
      // An undo has no end frame of its own to wait for: it is over once
      // everything it marked has lifted.
      for (const run of [...runs.values()]) {
        if (run.undo && !run.batches.length && [...run.parts.values()].every((p) => p.state === 'landed' && p.lifted)) forget(run);
      }
      // Read.
      const hand = handNodes();
      const html = document.documentElement;
      const inset = Math.max(0, html.clientWidth - html.getBoundingClientRect().right);
      const plans = [];
      const entries = [];
      for (const run of runs.values()) {
        const hidden = inText(run.client);
        const marks = [];
        for (const mark of run.scope.values()) {
          marks.push(planTint(mark, 'el', hidden ? null : run.gone ? 'gone' : mark.state, 'scope', hand));
        }
        for (const part of run.parts.values()) {
          marks.push(planTint(part, 'tint', hidden ? null : tintStateOf(run, part), 'part', hand));
          marks.push(planDot(part, hidden || !part.dotted || part.state === 'out' ? null : run.gone ? 'gone' : part.state, hand));
          if (!hidden && part.state !== 'out') entries.push({ holder: part, state: part.state, gone: run.gone });
        }
        if (run.local) for (const mark of marks) if (mark) mark.local = true;
        // A change made by hand has a tag only while it has words to say.
        const silent = run.local && !(run.ending ? run.endWords?.length : run.words?.length);
        plans.push({ run, marks, at: hidden || run.undo || silent ? null : hangOf(run, marks) });
      }
      const railPlan = planRail(entries);
      // Write.
      layer.style.setProperty('--change-inset', `${Math.round(inset)}px`);
      const placing = [];
      for (const { run, marks, at } of plans) {
        let drawn = false;
        for (const mark of marks) if (mark) drawn = writeMark(mark) || drawn;
        if (at) {
          run.tag ??= makeTag(run);
          fillTag(run, run.tag);
          if (run.gone && run.tag.root.dataset.state !== 'gone') run.tag.root.dataset.state = 'gone';
          placing.push({ run, at });
          drawn = true;
        } else if (run.tag) {
          run.tag.root.remove();
          run.tag = null;
        }
        run.drawn = drawn;
      }
      writeRail(railPlan);
      // The tags, once their words are written: their sizes, then their places.
      const sizes = placing.map(({ run }) => [run.tag.press.offsetWidth, run.tag.press.offsetHeight]);
      placing.forEach(({ run, at }, i) => placeTag(run, run.tag, at, sizes[i]));

      const tagged = [...runs.values()].some((run) => run.tag);
      if (tagged && !ticking) ticking = setInterval(tick, 1000);
      if (!tagged && ticking) { clearInterval(ticking); ticking = 0; }
      const key = [...runs.values()].filter((run) => !run.local && claims(run.client)).map((run) => run.client).sort().join('\n');
      if (key !== claimKey) {
        claimKey = key;
        dispatchEvent(new CustomEvent('marble-change:claims'));
      }
    }

    function tick() {
      for (const run of runs.values()) if (run.tag) fillTag(run, run.tag);
    }

    addEventListener('scroll', nudge, true);
    addEventListener('resize', nudge);
    document.addEventListener('focusin', nudge);
    document.addEventListener('focusout', nudge);
    document.addEventListener('selectionchange', nudge);
    new MutationObserver((records) => {
      if (records.some(({ target }) => !layer.contains(target) && target !== aloud)) nudge();
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });

    /** Whether a run has something on the page, or will at the next paint —
     *  asked from state, so the zone (collab.js) has its answer within the
     *  same frame that started the run, before anything is painted. */
    function wanted(run) {
      if (run.tag) return true;
      for (const mark of run.scope.values()) if (mark.el || (mark.state === 'soon' && drawable(resolve(mark)))) return true;
      for (const part of run.parts.values()) {
        if (part.tint || part.dot) return true;
        if (part.seeded && !part.lifted && part.state !== 'soon' && !resolve(part)) return true;
        const creatable = part.dotted ? !run.gone : part.state === 'soon' || part.state === 'now' || part.state === 'failed';
        if (creatable && drawable(resolve(part))) return true;
      }
      if (run.undo) return false;
      const hang = holderOf(run, run.hang);
      return Boolean(run.hangBox) || Boolean(hang && drawable(resolve(hang)));
    }

    function claims(client) {
      const run = runs.get(String(client ?? ''));
      return Boolean(run) && !inText(run.client) && wanted(run);
    }

    // ------------------------------------------------------------ listening

    // Capture, so the run is known before the zone (collab.js) asks whether
    // it is claimed; the caret (agent-text.js) answers its own claim after,
    // and says so with `marble-text:claims`.
    document.addEventListener('marble:presence', ({ detail }) => onPresence(detail), true);
    document.addEventListener('marble:ops', ({ detail }) => onOps(detail), true);
    addEventListener('marble-text:claims', schedule);

    // A presence frame is broadcast once, to whoever was listening; a tab
    // that opens mid-change asks for the frames that are standing.
    function catchUp(only = null) {
      fetch(`/presence?app=${encodeURIComponent(marble.app)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          for (const frame of body?.frames ?? []) {
            const client = String(frame?.client ?? '');
            // An undo's frames are history by the time anyone asks.
            if (!client.startsWith('agent:') || !frame.turn || runs.has(client)) continue;
            if (only && client !== `agent:${only}`) continue;
            onPresence(frame, { caught: true });
          }
        })
        .catch(() => {
          // No standing change is the same answer as a host that cannot say.
        });
    }
    catchUp();
    // A chat followed from here mid-change (Follow on its glint) is drawn
    // from where it is.
    addEventListener('marble:attending', (event) => { if (event.detail?.id) catchUp(event.detail.id); });

    // An end frame missed while the stream was away: the chat's summary says
    // it is no longer working, the host confirms the turn is over, and the
    // marks go. (A summary can arrive late, after the next turn has begun.)
    agent.on?.('*', (summary) => {
      if (!summary?.id || summary.running || summary.queued) return;
      const run = runs.get(`agent:${summary.id}`);
      if (!run || run.ending) return;
      setTimeout(async () => {
        if (runs.get(run.client) !== run || run.ending) return;
        try {
          const detail = await agent.conversation(summary.id, { turns: 1 });
          const turn = (detail?.turns ?? []).find((t) => t.id === run.turn);
          if (turn && (turn.status === 'running' || turn.status === 'queued')) return;
        } catch {
          return;
        }
        if (runs.get(run.client) === run && !run.ending) end(run, null);
      }, 1500);
    });

    // ------------------------------------------------------------ by hand

    /**
     * A change the page makes itself (change-rules.js), drawn with the same
     * tints and tag as one that comes in frames. `ids` are tinted light at
     * once; the handle moves each part on: `now` (landing), `land` (lifts
     * over 900 ms), `out` (left out: a dashed ring) and `soon` (back in).
     * `say` sets the tag's words as pieces (`[['Rounding', 4, 'cards']]`,
     * numbers set in figures), `hang` the part it hangs from, `refresh`
     * reads the parts' shapes again (a hand is changing them), `end` lets
     * the marks go, saying `pieces` a moment first if given, and `clear`
     * fades them at once when nothing changed.
     */
    function begin({ key = 'local', ids = [], hang = null, say = null } = {}) {
      const client = `local:${key}`;
      const old = runs.get(client);
      if (old) forget(old);
      const run = newRun(client, String(key));
      run.local = true;
      runs.set(client, run);
      const mine = () => runs.get(client) === run && !run.ending;
      const set = (given, state) => {
        if (!mine()) return;
        for (const id of list(given)) {
          const part = run.parts.get(id) ?? addPart(run, id, state);
          part.state = state;
          part.lifted = false;
          part.delay = 0;
          part.shape = null;
        }
        schedule();
      };
      const first = list(ids);
      run.many = first.length > MANY;
      set(first, 'soon');
      run.hang = hang ? String(hang) : first[0] ?? null;
      run.words = Array.isArray(say) ? say : null;
      return {
        soon: (given) => set(given, 'soon'),
        now: (given) => set(given, 'now'),
        out: (given) => set(given, 'out'),
        land(given) {
          if (!mine()) return;
          for (const id of list(given)) landPart(run, id);
          schedule();
        },
        hang(id) { if (mine() && id) { run.hang = String(id); schedule(); } },
        say(pieces) { if (mine()) { run.words = Array.isArray(pieces) ? pieces : null; schedule(); } },
        refresh() {
          if (!mine()) return;
          for (const part of run.parts.values()) part.shape = null;
          schedule();
        },
        end(pieces = null) {
          if (!mine()) return;
          run.ending = true;
          run.endedAt = performance.now();
          run.endWords = Array.isArray(pieces) && pieces.length ? pieces : null;
          // What was left out was never changed: its ring goes now. The rest
          // lift as they have landed.
          for (const part of [...run.parts.values()]) {
            if (part.state === 'out') dropPart(run, part.id);
            else landPart(run, part.id);
          }
          schedule();
          after(run, run.endWords ? SHOWN : still() ? STILL : LIFT, () => {
            run.gone = true;
            schedule();
            after(run, GONE, () => forget(run));
          });
        },
        /** Nothing was changed after all: every mark fades at once. */
        clear() {
          if (!mine()) return;
          run.ending = true;
          run.gone = true;
          run.endWords = null;
          schedule();
          after(run, GONE, () => forget(run));
        },
        get live() { return mine(); },
      };
    }

    window.marbleChange = {
      claims,
      unitOf,
      runs: () => [...runs.values()].filter((run) => !run.local && claims(run.client))
        .map(({ client, turn, count, total }) => ({ client, turn, count, total })),
      begin,
      tintFor(id) {
        for (const run of runs.values()) {
          if (run.local || inText(run.client) || run.gone) continue;
          const part = run.parts.get(String(id));
          if (part && (part.state === 'soon' || part.state === 'now' || part.state === 'failed') && drawable(resolve(part))) return part.state;
          const mark = run.scope.get(String(id));
          if (mark && mark.state === 'soon' && drawable(resolve(mark))) return 'soon';
        }
        return null;
      },
      // How much painting it has done: paints, rects read, styles read.
      stats: () => ({ ...stats }),
    };
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
