// The shell: ⌘J opens the drive around the document you are in.
//
// The tree on the left, the chat on the right where it already is, and a thin
// bar across the top that says where you are and lets you share it. Fit gives
// the document the space the three leave; Float lays them over it as cards and
// leaves the document where it was. Closed — App alone — nothing sits on the
// page but a pill that rises at the top-left corner when the pointer goes
// there, and the agent button in the other corner.
//
// Everything here is transient chrome in an open shadow root, like the drawer:
// the file on disk never hears about it. What it remembers (open or not, Fit or
// Float, the tree shown or not, which folders are unfolded) is this browser's,
// in localStorage, and it follows you from document to document because the
// shell is the drive's, not any one page's.
//
// The chat is the drawer's (runtime/agent-ui.js). The shell tells it where to
// sit with `marble-shell:layout` and reads its width back from
// `marble-agent:layout`; the drawer keeps its own conversation, launcher and
// tray. A page with no drawer — agents off, or a page that draws its own —
// gets the bar and the tree and no chat button.

(() => {
  if (window.top !== window || customElements.get('marble-shell')) return;
  if (document.querySelector('meta[name="marble-shell"][content="off"]')) return;

  const BAR = 44;
  // One motion for everything the shell moves: the panels, and the page making
  // room for them. The drawer's spring (runtime/agent-ui.js) settles in about
  // the same time, so the chat arrives with the rest rather than after it.
  const MOTION = 340;
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  const NAV = 260;
  const NAV_MIN = 200;
  const NAV_MAX = 520;
  // However wide the two panels are pulled, the document keeps this much.
  const PAGE_MIN = 360;
  // Float keeps the sidebars out of the way until the pointer reaches for
  // them: this close to the window's edge, and this long after it leaves.
  const EDGE = 10;
  const LINGER = 320;
  const GAP = 8;
  const PHONE = '(max-width: 719px)';
  const KEY = 'marble-shell:';
  const RECENT = 6;
  const SECTIONS = ['pinned', 'recent', 'agents', 'drive'];
  const LABELS = { pinned: 'Pinned', recent: 'Recent', agents: 'Agents', drive: 'Drive' };
  // Most urgent first, everywhere a set of agents is drawn.
  const ORDER = ['waiting', 'working', 'done'];
  const WORDS = { waiting: 'needs you', working: 'working', done: 'done' };
  // Which conversations are old enough to leave out: the Agents page's own
  // idle cut (templates/agents.mrbl, IDLE_KEY), read from where that page
  // keeps it so the slider there is the one setting for both. Minutes, 'all'
  // for no cut, and five hours until somebody moves it.
  const IDLE_KEY = 'marble-agents:idle';
  const IDLE_MIN = 5;
  const IDLE_MID = 5 * 60;
  const IDLE_MAX = (IDLE_MID * IDLE_MID) / IDLE_MIN;
  // The host's front door lands on the Drive, wherever this drive keeps it,
  // and a fragment rides through the redirect: `#/<folder>` is how the Drive
  // reads which folder to show.
  const HOME = '/';
  // How long the pointer rests in the corner's strip before the pill rises.
  const DWELL = 280;
  // The Drive's own path, from the host (server/app.js), which is the one
  // that knows what this drive calls it.
  const HOME_DOC = document.currentScript?.dataset.home ?? null;

  const stored = (name, fallback) => {
    try { return localStorage.getItem(KEY + name) ?? fallback; } catch { return fallback; }
  };
  const store = (name, value) => {
    try { localStorage.setItem(KEY + name, value); } catch { /* private mode: this visit only */ }
  };

  const UI = window.marbleAgentUI;
  // Without agents there is no drawer and none of its tokens; these are the
  // same design-system pair, enough for a bar and a tree.
  const FALLBACK_TOKENS = `
    :host {
      --ink: #111111; --muted: #5a5a5a; --faint: #8a8a8a; --line: #ddd9cf;
      --paper: #fafaf7; --paper-2: #f3f1ea; --paper-3: #eceae1; --card: #ffffff;
      --accent: #9bb6cf; --accent-soft: #f1f5f8; --accent-ink: #738698; --caution: #a07a2c;
      --shadow-lift: 0 4px 10px rgba(74,66,52,.10), 0 14px 28px rgba(74,66,52,.12);
      --shadow-rest: 0 1px 2px rgba(74,66,52,.06), 0 6px 16px rgba(74,66,52,.08);
      --settle: cubic-bezier(.22, 1, .36, 1);
      font: 14px/1.5 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      color: var(--ink); -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --ink: #e8e6e1; --muted: #a3a7ab; --faint: #71767a; --line: #2f3438;
        --paper: #16181a; --paper-2: #1e2124; --paper-3: #262a2e; --card: #1c1f22;
        --accent: #7fa8c9; --accent-soft: #1d2932; --accent-ink: #9dc0dc; --caution: #d9b25e;
        --shadow-lift: 0 6px 16px rgba(0,0,0,.45), 0 18px 36px rgba(0,0,0,.35);
        --shadow-rest: 0 1px 2px rgba(0,0,0,.40), 0 8px 20px rgba(0,0,0,.28);
      }
    }
  `;

  // One stroke weight for every glyph, drawn on the same 16-box.
  const PATHS = {
    nav: '<rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M6.25 2.75v10.5"/>',
    chat: '<rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M9.75 2.75v10.5"/>',
    fit: '<rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M5.75 2.75v10.5M10.25 2.75v10.5"/>',
    float: '<rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M5 5.75v4.5M11 5.75v4.5"/>',
    chev: '<path d="M6.75 5.25 9.5 8l-2.75 2.75"/>',
    down: '<path d="M5.25 6.75 8 9.5l2.75-2.75"/>',
    search: '<circle cx="7.25" cy="7.25" r="4.25"/><path d="m10.5 10.5 3 3"/>',
    folder: '<path d="M2 4.75c0-.83.67-1.5 1.5-1.5h2.88c.4 0 .78.16 1.06.44l.62.62c.28.28.66.44 1.06.44h3.38c.83 0 1.5.67 1.5 1.5v4.99c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5z"/>',
    doc: '<path d="M4 3.5c0-.83.67-1.5 1.5-1.5h3.88L12 4.62v7.88c0 .83-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z"/><path d="M9 2v2.75h3M6.25 8.5h3.5M6.25 11h2.5"/>',
    share: '<path d="M8 9.75V2.25M5.25 5 8 2.25 10.75 5"/><path d="M3.25 8.5v3.75c0 .83.67 1.5 1.5 1.5h6.5c.83 0 1.5-.67 1.5-1.5V8.5"/>',
    link: '<path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2.1-2.1a2.75 2.75 0 0 0-3.9-3.9l-.6.6"/><path d="M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2.1 2.1a2.75 2.75 0 0 0 3.9 3.9l.6-.6"/>',
    open: '<path d="M2 11.25v-6.5c0-.83.67-1.5 1.5-1.5h2.88c.4 0 .78.16 1.06.44l.62.62c.28.28.66.44 1.06.44h3.38c.83 0 1.5.67 1.5 1.5v4.99c0 .83-.67 1.5-1.5 1.5H3.5c-.83 0-1.5-.67-1.5-1.5z"/><path d="M6 9.25h4.25M8.75 7.5 10.5 9.25 8.75 11"/>',
    download: '<path d="M8 2.25v7.5M5.25 7 8 9.75 10.75 7"/><path d="M3.25 10.5v1.75c0 .83.67 1.5 1.5 1.5h6.5c.83 0 1.5-.67 1.5-1.5V10.5"/>',
    collapse: '<path d="M6 2.75V4.5c0 .83-.67 1.5-1.5 1.5H2.75M13.25 6H11.5c-.83 0-1.5-.67-1.5-1.5V2.75M2.75 10H4.5c.83 0 1.5.67 1.5 1.5v1.75M10 13.25V11.5c0-.83.67-1.5 1.5-1.5h1.75"/>',
    check: '<path d="m3.75 8.25 2.75 2.75 5.75-6.25"/>',
    describe: '<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.75"/><path d="M5 10.25c1.5-3.1 2.55-4.65 3.2-4.65 1 0 .2 4.65 1.2 4.65.65 0 1.25-.95 1.75-2.85"/>',
    move: '<path d="M2 11.25v-6.5c0-.83.67-1.5 1.5-1.5h2.88c.4 0 .78.16 1.06.44l.62.62c.28.28.66.44 1.06.44h3.38c.83 0 1.5.67 1.5 1.5v4.99c0 .83-.67 1.5-1.5 1.5H3.5c-.83 0-1.5-.67-1.5-1.5z"/><path d="M6 9.25h4.25M8.75 7.5 10.5 9.25 8.75 11"/>',
    // Two ticks: every one of them, read.
    read: '<path d="m1.75 8.5 2.75 2.75 5-5.75"/><path d="m7.75 11 .25.25 5.5-6"/>',
    grip: '<path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2"/>',
  };
  const icon = (name) => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true">${PATHS[name]}</svg>`;
  const LOGO = '<span class="logo" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 6 14 10 10 14 6 10z"/></svg></span>';

  const STYLE = `
    :host { position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483001; }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
    .i { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    kbd { font: 500 10.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--faint); border: 1px solid var(--line); border-radius: 5px; padding: 2px 4px; background: var(--card); }
    .logo { width: 20px; height: 20px; border-radius: 6px; background: var(--accent-ink); color: var(--paper); display: grid; place-items: center; flex: none; }
    .logo svg { width: 20px; height: 20px; fill: currentColor; stroke: currentColor; stroke-width: 1; stroke-linejoin: round; }

    /* Shown at once and hidden only after the slide: a panel that is still
       visibility: hidden on the frame it opens cannot take the focus ⌘K gives it. */
    .bar, .nav { position: fixed; transition: transform ${MOTION}ms ${EASE}, opacity ${Math.round(MOTION * 0.7)}ms ${EASE},
      top ${MOTION}ms ${EASE}, left ${MOTION}ms ${EASE}, width ${MOTION}ms ${EASE}, bottom ${MOTION}ms ${EASE},
      border-radius ${MOTION}ms ${EASE}, box-shadow ${MOTION}ms ${EASE}, background-color ${MOTION}ms ${EASE},
      visibility 0s linear var(--hide-after, 0s); }

    /* ── The bar ── */
    .bar { top: 0; left: 0; width: 100vw; height: ${BAR}px; display: flex; align-items: center; gap: 6px; padding: 0 8px;
      background: var(--paper); border-bottom: 1px solid var(--line); font-size: 13px; }
    .ib { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; color: var(--muted); flex: none; }
    .ib:hover, .ib[aria-pressed="true"] { background: var(--paper-2); color: var(--ink); }
    .ib[hidden] { display: none; }
    .home { display: grid; border-radius: 7px; padding: 4px; margin: 0 2px; }
    .home:hover { background: var(--paper-2); }
    .crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; color: var(--muted); overflow: hidden; }
    .crumbs a, .crumbs .here { padding: 3px 6px; border-radius: 6px; white-space: nowrap; text-decoration: none; color: inherit; }
    .crumbs a { overflow: hidden; text-overflow: ellipsis; max-width: 16ch; flex: 0 1 auto; }
    .crumbs a:hover { background: var(--paper-2); color: var(--ink); }
    .crumbs .sep { color: var(--faint); opacity: .7; }
    .crumbs .here { color: var(--ink); font-weight: 600; display: flex; align-items: center; gap: 3px; min-width: 0; flex: 0 1 auto; }
    .crumbs .here span { overflow: hidden; text-overflow: ellipsis; }
    .crumbs .here:hover, .crumbs .here[aria-expanded="true"] { background: var(--paper-2); }
    .spacer { flex: 1; }
    .share { height: 28px; padding: 0 12px; border-radius: 8px; background: var(--ink); color: var(--paper); font-weight: 600; font-size: 12.5px; display: flex; align-items: center; gap: 6px; flex: none; }
    .share[aria-expanded="true"] { background: var(--accent-ink); }
    .seg { display: flex; padding: 2px; border-radius: 8px; background: var(--paper-2); flex: none; }
    .seg button { width: 26px; height: 24px; border-radius: 6px; display: grid; place-items: center; color: var(--faint); }
    .seg button[aria-pressed="true"] { background: var(--card); color: var(--ink); box-shadow: var(--shadow-rest); }
    .vr { width: 1px; height: 18px; background: var(--line); margin: 0 4px; flex: none; }
    button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

    /* ── The tree ── */
    .nav { top: ${BAR}px; left: 0; bottom: 0; width: var(--nav-w, ${NAV}px); display: flex; flex-direction: column;
      background: var(--paper); border-right: 1px solid var(--line); font-size: 13px; }
    .search, .finder { margin: 10px 10px 6px; display: flex; align-items: center; gap: 8px; padding: 0 8px; height: 32px; border-radius: 8px; background: var(--paper-2); color: var(--faint); }
    .search input, .finder input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; color: var(--ink); padding: 0; }
    .search input::placeholder, .finder input::placeholder { color: var(--faint); }
    .search:focus-within, .finder:focus-within { box-shadow: inset 0 0 0 1px var(--accent); }
    .search:focus-within kbd { display: none; }
    .scroll { flex: 1; overflow: auto; padding: 2px 6px 12px; overscroll-behavior: contain; }
    .sec { position: relative; border-radius: 10px; }
    .sec-h { display: flex; align-items: center; gap: 2px; margin: 10px 2px 2px; }
    .sec-fold { display: flex; align-items: center; gap: 4px; padding: 3px 6px 3px 4px; border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: .02em; color: var(--faint); }
    .sec-fold:hover { color: var(--ink); background: var(--paper-2); }
    .sec-fold .i { width: 12px; height: 12px; transition: transform 160ms var(--settle); transform: rotate(90deg); }
    .sec[data-folded] .sec-fold .i { transform: none; }
    .sec-meta { display: inline-flex; align-items: center; gap: 5px; margin-left: 4px; font-size: 11px; color: var(--caution); }
    /* The grip is there when you reach for the heading, and for the keyboard. */
    .sec-gap { flex: 1; }
    .sec-act { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; color: var(--faint); }
    .sec-act:hover { background: var(--paper-2); color: var(--ink); }
    .older { padding: 4px 10px 2px 32px; font-size: 11.5px; color: var(--faint); }
    .sec-grip { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; color: var(--faint);
      cursor: grab; touch-action: none; opacity: 0; transition: opacity 120ms var(--settle); }
    .sec-h:hover .sec-grip, .sec-grip:focus-visible, .sec[data-lifted] .sec-grip { opacity: 1; }
    .sec-grip:hover { background: var(--paper-2); color: var(--ink); }
    @media (hover: none) { .sec-grip { opacity: 1; } }
    /* Held: lifted off the list, over the others as they make room. */
    .sec[data-lifted] { z-index: 2; background: var(--card); box-shadow: var(--shadow-lift); cursor: grabbing; }
    :host([data-sorting]) .scroll, :host([data-sorting]) .sec-grip { cursor: grabbing; user-select: none; }
    .sec[data-folded] > ul { display: none; }
    ul { list-style: none; margin: 0; padding: 0; }
    ul ul { padding-left: 14px; }
    .row { display: flex; align-items: center; gap: 7px; width: 100%; padding: 4px 8px; border-radius: 6px; color: var(--muted); text-decoration: none; white-space: nowrap; text-align: left; min-width: 0; }
    .row > span { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .row:hover { background: var(--paper-2); color: var(--ink); }
    .row .i { color: var(--faint); }
    .row .car { width: 12px; height: 12px; margin: 0 -3px 0 -5px; transition: transform 160ms var(--settle); }
    .row[aria-expanded="true"] .car { transform: rotate(90deg); }
    .row[aria-current="page"] { background: var(--accent-soft); color: var(--ink); font-weight: 560; }
    .row[aria-current="page"] .i { color: var(--accent-ink); }
    .row .where { margin-left: auto; padding-left: 8px; font-size: 11px; color: var(--faint); font-weight: 400; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
    .empty { padding: 6px 10px; color: var(--faint); font-size: 12px; }

    /* ── Agents: a document per row; folded, a mark per state and how many ── */
    .row.app { padding: 0; gap: 0; }
    .row.app .go { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; padding: 4px 8px; border-radius: 6px; text-align: left; color: inherit; }
    .row.app .go .name, .thread .name { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .row.app .fold { width: 16px; height: 26px; margin-right: -8px; display: grid; place-items: center; color: var(--faint); flex: none; position: relative; z-index: 1; }
    .row.app .fold .car { width: 12px; height: 12px; transition: transform 160ms var(--settle); }
    .row.app .fold[aria-expanded="true"] .car { transform: rotate(90deg); }
    .row.app:has(.fold) .go { padding-left: 10px; }
    .row.app .pips { margin: 0 8px 0 6px; }
    ul.threads { padding-left: 24px; }
    /* Unfolding slides the agents open, and the marks hand over: the
       document's sink away as each agent's drops into place below. */
    .agents .drop { display: grid; grid-template-rows: 0fr; visibility: hidden; transition: grid-template-rows 240ms var(--settle), visibility 0s linear 240ms; }
    .agents .drop > ul { min-height: 0; overflow: hidden; opacity: 0; transition: opacity 140ms ease; }
    .agents [data-open] > .drop { grid-template-rows: 1fr; visibility: visible; transition: grid-template-rows 240ms var(--settle), visibility 0s; }
    .agents [data-open] > .drop > ul { opacity: 1; transition: opacity 200ms ease 40ms; }
    .row.app .pips { transition: opacity 140ms ease, transform 200ms var(--settle); }
    .agents [data-open] > .row.app .pips { opacity: 0; transform: translateY(5px); }
    .drop .pip { opacity: 0; transform: translateY(-6px); transition: opacity 120ms ease, transform 120ms ease; }
    .agents [data-open] .drop .pip { opacity: 1; transform: none; transition: opacity 180ms ease 90ms, transform 260ms var(--settle) 90ms; }
    .agents [data-open] .drop li:nth-child(2) .pip { transition-delay: 120ms; }
    .agents [data-open] .drop li:nth-child(n+3) .pip { transition-delay: 150ms; }
    .thread { font-size: 12.5px; }
    /* Bold while unread: waiting on you, or finished since you last looked. */
    [data-unread] .name, .thread[data-unread] .name { color: var(--ink); font-weight: 620; }
    /* Each agent's mark sits at the row's end, under its document's. */
    .thread .pip { margin-left: auto; }
    .pips { display: inline-flex; align-items: center; gap: 3px; flex: none; }
    .pips .pg { display: inline-flex; align-items: center; gap: 1px; }
    .pips .n { font-size: 10.5px; font-weight: 560; line-height: 1; color: var(--faint); font-variant-numeric: tabular-nums; }
    /* Each mark's box is as wide as what it draws, so the gaps are the gaps. */
    .pip { width: 6px; height: 10px; display: grid; place-items: center; flex: none; }
    .pip[data-st="waiting"], .pip[data-st="done"] { width: 7px; }
    /* One column down the right edge: a row's last mark sits in the same slot,
       drawn at its centre, the document's and each agent's alike. */
    .pips > .pg:last-child > .pip:last-child, .thread .pip { width: 9px; }
    .pip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; }
    /* Needs you is a ring — the Agents page's word for it — so it reads apart
       from the working dot by its shape, whatever the palette does to the
       colours. The same stroke as the done check beside it. */
    .pip[data-st="waiting"]::before { width: 7px; height: 7px; box-sizing: border-box; background: none; border: 1.6px solid var(--caution); }
    .pip[data-st="working"]::before { background: var(--accent-ink); animation: breathe 1.8s ease-in-out infinite; }
    .pip[data-st="done"]::before { display: none; }
    .pip svg { width: 10px; height: 10px; fill: none; stroke: var(--muted); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    @keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
    @media (prefers-reduced-motion: reduce) {
      .pip[data-st="working"]::before { animation: none; }
      .agents .drop, .agents .drop > ul, .agents .pips, .agents .pip { transition-duration: 0s !important; transition-delay: 0s !important; transform: none !important; }
    }

    /* The tree's inner edge: drag it, or focus it and use the arrow keys.
       Double-click puts it back. The same edge the chat has on its side. */
    .edge { position: absolute; top: 0; bottom: 0; right: -5px; width: 10px; z-index: 1; cursor: ew-resize; touch-action: none; }
    .edge::before { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px; border-radius: 1px; background: transparent;
      transition: background-color 120ms var(--settle); }
    .edge:hover::before, .edge:focus-visible::before, :host([data-resizing]) .edge::before { background: var(--accent-ink); }
    .edge:focus-visible { outline: none; }
    :host([data-mode="float"]) .edge::before { top: 14px; bottom: 14px; }
    /* Under the hand the panel follows at once; easing would trail it. */
    :host([data-resizing]) .nav { transition: none; }

    /* ── Float: the two sidebars as cards over the page ──
       The bar stays where Fit has it in either mode. It is the one line that
       says where you are, and a page that slid under it would lose its top
       edge to it; Float is about the sidebars, not the bar. */
    :host([data-mode="float"]) .nav { top: ${BAR + GAP}px; left: ${GAP}px; bottom: ${GAP}px; border: 1px solid var(--line); border-radius: 16px;
      box-shadow: var(--shadow-lift); background: color-mix(in srgb, var(--paper) 82%, transparent); -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3); }
    @media (prefers-reduced-transparency: reduce) { :host([data-mode="float"]) .nav { background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; } }

    /* ── Float, at rest: the sidebars wait at the edges ──
       Each is a hand's reach away — the pointer at that edge brings it out —
       and a thin mark on the edge says that something is there. */
    :host([data-hide-nav]) .nav { transform: translateX(calc(-100% - 24px)); opacity: 0; pointer-events: none; visibility: hidden; --hide-after: ${MOTION}ms; }
    .hint { position: fixed; top: calc(${BAR}px + (100vh - ${BAR}px) / 2); width: 4px; height: 44px; margin-top: -22px; border-radius: 2px;
      background: color-mix(in srgb, var(--ink) 22%, transparent); opacity: 0; pointer-events: none; transition: opacity 200ms var(--settle); }
    .hint[data-side="nav"] { left: 3px; }
    .hint[data-side="chat"] { right: 3px; }
    :host([data-hide-nav]) .hint[data-side="nav"], :host([data-hide-chat]) .hint[data-side="chat"] { opacity: 1; pointer-events: auto; }

    /* ── Closed, or the tree put away ── */
    :host(:not([data-open])) .bar { transform: translateY(-100%); opacity: 0; pointer-events: none; visibility: hidden; --hide-after: ${MOTION}ms; }
    :host(:not([data-open])) .nav, :host([data-nav="off"]) .nav { transform: translateX(calc(-100% - 24px)); opacity: 0; pointer-events: none; visibility: hidden; --hide-after: ${MOTION}ms; }
    /* In Fit each panel travels exactly as far as the page's edge does, on the
       same curve, so the page is never seen pulling away from a panel that has
       not arrived yet. Floating cards clear their own shadow on the way out. */
    :host([data-mode="fit"]:not([data-open])) .nav, :host([data-mode="fit"][data-nav="off"]) .nav { transform: translateX(-100%); }

    /* ── App alone: a pill at the top-left corner, only when the pointer rests there ──
       The hot strip is thin on purpose, and it asks for a moment's rest rather
       than a pass: the corner is where an app keeps its own title and tools,
       and a pointer on its way to them — or down from the tab bar — must not
       raise a pill over them. */
    .zone { position: fixed; top: 0; left: 0; width: 220px; height: 10px; }
    .pill { position: fixed; top: 12px; left: 12px; display: flex; align-items: center; gap: 8px; padding: 5px 6px; max-width: 320px;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lift);
      opacity: 0; transform: translateY(-8px); pointer-events: none; transition: opacity 180ms var(--settle), transform 180ms var(--settle); }
    .pill b { font-weight: 620; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .pill:hover kbd { color: var(--ink); border-color: var(--accent); }
    :host([data-peek]:not([data-open])) .pill, :host(:not([data-open])) .pill:focus-visible { opacity: 1; transform: none; pointer-events: auto; }
    :host([data-open]) .zone { display: none; }
    :host([data-open]) .pill { opacity: 0; transform: translateY(-8px); pointer-events: none; }
    @media (hover: none) { .zone { display: none; } :host(:not([data-open])) .pill { opacity: 1; transform: none; pointer-events: auto; } }

    /* ── Popovers: Share and the document's menu ── */
    .pop { position: fixed; z-index: 2; background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lift); padding: 6px; font-size: 13px; }
    .pop[hidden] { display: none; }
    .menu { min-width: 200px; }
    .menu button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border-radius: 8px; color: var(--ink); text-align: left; }
    .menu button:hover, .menu button:focus-visible { background: var(--paper-2); outline: none; }
    .menu .i { color: var(--muted); }
    .sharing { width: 320px; padding: 12px; }
    .sharing h3 { margin: 0 0 2px; font-size: 13.5px; font-weight: 600; }
    .sharing p { margin: 0 0 10px; color: var(--muted); font-size: 12.5px; }
    .sharing .link { display: flex; gap: 6px; }
    .sharing input { flex: 1; min-width: 0; height: 30px; border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); background: var(--paper); }
    .sharing .copy { height: 30px; padding: 0 12px; border-radius: 8px; background: var(--ink); color: var(--paper); font-weight: 600; font-size: 12.5px; display: flex; align-items: center; gap: 6px; }
    /* Move or rename: the name, then where. */
    .moving { width: 320px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .moving h3 { margin: 0; font-size: 13.5px; font-weight: 600; }
    .moving .name { height: 30px; border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; font: inherit; color: var(--ink); background: var(--paper); }
    .moving .name:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
    .moving .finder { margin: 0; }
    .dests { max-height: 220px; overflow: auto; display: flex; flex-direction: column; gap: 1px; }
    .dest { display: flex; align-items: center; gap: 7px; padding: 5px 8px; border-radius: 6px; color: var(--muted); text-align: left; white-space: nowrap; }
    .dest > span { overflow: hidden; text-overflow: ellipsis; }
    .dest:hover { background: var(--paper-2); color: var(--ink); }
    .dest[aria-selected="true"] { background: var(--accent-soft); color: var(--ink); font-weight: 560; }
    .dest[aria-selected="true"] .i { color: var(--accent-ink); }
    .dest .here-tag { margin-left: auto; font-size: 11px; color: var(--faint); font-weight: 400; }
    .moving .note { margin: 0; font-size: 12px; color: var(--muted); }
    .moving .note[data-bad] { color: var(--danger, #b4533e); }
    .moving .go { display: flex; justify-content: flex-end; gap: 6px; }
    .moving .go button { height: 30px; padding: 0 12px; border-radius: 8px; font-weight: 600; font-size: 12.5px; }
    .moving .cancel { color: var(--muted); }
    .moving .cancel:hover { background: var(--paper-2); color: var(--ink); }
    .moving .ok { background: var(--ink); color: var(--paper); }
    .moving .ok:disabled { opacity: .4; cursor: default; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 8px); opacity: 0; pointer-events: none; background: var(--ink); color: var(--paper);
      border-radius: 999px; padding: 7px 14px; font-size: 12.5px; transition: opacity 160ms var(--settle), transform 160ms var(--settle); }
    .toast[data-on] { opacity: 1; transform: translate(-50%, 0); }

    /* Arriving at a document with the shell open is not the shell opening. */
    :host([data-still]) *, :host([data-still]) *::before { transition: none !important; }
    @media (prefers-reduced-motion: reduce) {
      .bar, .nav, .pill, .toast, .sec-h .i, .row .car { transition: opacity 120ms linear, visibility 0s linear var(--hide-after, 0s); transform: none !important; }
    }
  `;

  const h = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const splitPath = (p) => String(p ?? '').split('/').filter(Boolean);
  const nameOf = (p) => splitPath(p).at(-1) ?? '';
  const folderOf = (p) => splitPath(p).slice(0, -1).join('/');
  // The Agents page's words for a span of minutes (templates/agents.mrbl, idleLabel).
  const idleLabel = (minutes) => {
    if (minutes == null) return 'ever';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = minutes / 60;
    if (hours < 24) return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} hr`;
    const days = hours / 24;
    const n = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
    return `${n} ${n === 1 ? 'day' : 'days'}`;
  };

  class MarbleShell extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      // Typing in the search or a dialog here is typing, not the page's
      // shortcuts (runtime/agent-ui.js, keepKeys).
      UI?.keepKeys?.(root);
      root.innerHTML = `<style>${UI?.TOKENS ?? FALLBACK_TOKENS}${STYLE}</style>
        <div class="zone" aria-hidden="true"></div>
        <div class="hint" data-side="nav" aria-hidden="true"></div>
        <div class="hint" data-side="chat" aria-hidden="true"></div>
        <button type="button" class="pill" aria-label="Open the drive (⌘J)">${LOGO}<b></b><kbd>⌘J</kbd></button>
        <header class="bar" aria-label="Drive">
          <button type="button" class="ib" data-act="nav" aria-pressed="true" aria-label="Tree" title="Tree (⌘\\)">${icon('nav')}</button>
          <a class="home" aria-label="Drive" title="Drive">${LOGO}</a>
          <nav class="crumbs" aria-label="Where you are"></nav>
          <span class="spacer"></span>
          <button type="button" class="ib" data-act="describe" aria-pressed="false" aria-label="Describe a change (⌘⇧D)" title="Describe a change (⌘⇧D)" hidden>${icon('describe')}</button>
          <button type="button" class="share" data-act="share" aria-haspopup="dialog" aria-expanded="false">${icon('share')}Share</button>
          <span class="vr"></span>
          <span class="seg" role="group" aria-label="Layout">
            <button type="button" data-act="fit" aria-pressed="true" aria-label="Fit" title="Fit — the document takes the space that is left">${icon('fit')}</button>
            <button type="button" data-act="float" aria-pressed="false" aria-label="Float" title="Float — the panels lie over the document">${icon('float')}</button>
          </span>
          <button type="button" class="ib" data-act="chat" aria-pressed="true" aria-label="Chat" title="Chat" hidden>${icon('chat')}</button>
          <button type="button" class="ib" data-act="close" aria-label="Hide everything" title="Hide everything (⌘J)">${icon('collapse')}</button>
        </header>
        <nav class="nav" aria-label="Drive tree">
          <button type="button" class="edge" role="separator" aria-orientation="vertical" aria-label="Resize the tree" title="Drag to resize · double-click to reset"></button>
          <label class="search">${icon('search')}<input type="search" placeholder="Search the drive" aria-label="Search the drive" autocomplete="off" spellcheck="false"><kbd>⌘K</kbd></label>
          <div class="scroll"></div>
        </nav>
        <div class="pop menu" role="menu" aria-label="This document" hidden></div>
        <div class="pop sharing" role="dialog" aria-label="Share" hidden>
          <h3></h3>
          <p>Anyone who can open this drive can open this link.</p>
          <div class="link"><input readonly aria-label="Link"><button type="button" class="copy">${icon('link')}Copy</button></div>
        </div>
        <div class="pop moving" role="dialog" aria-label="Move or rename" hidden>
          <h3>Move or rename</h3>
          <input class="name" aria-label="Name" spellcheck="false" autocomplete="off">
          <label class="finder">${icon('search')}<input class="find" type="search" placeholder="Find a folder" aria-label="Find a folder" autocomplete="off" spellcheck="false"></label>
          <div class="dests" role="listbox" aria-label="Folders"></div>
          <p class="note"></p>
          <div class="go"><button type="button" class="cancel">Cancel</button><button type="button" class="ok" disabled>Move</button></div>
        </div>
        <div class="toast" role="status" aria-live="polite"></div>`;
      this.$ = (selector) => root.querySelector(selector);
      this.bar = this.$('.bar');
      this.nav = this.$('.nav');
      this.scroll = this.$('.scroll');
      this.search = this.$('.nav .search input');
      this.menu = this.$('.menu');
      this.sharing = this.$('.sharing');
      this.moving = this.$('.moving');
      this.phone = matchMedia(PHONE);
      // A pointer that can hover is what Float's reaching is for; on a touch
      // screen the sidebars simply stay out, as they always have.
      this.fine = matchMedia('(hover: hover) and (pointer: fine)');
      this.shown = { nav: false, chat: false };
      this.quiet = { nav: false, chat: false };
      this.intro = false;
      this.pointer = null;
      this.hideTimers = {};
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)');

      this.state = {
        open: stored('open', '0') === '1',
        mode: stored('mode', 'fit') === 'float' ? 'float' : 'fit',
        nav: stored('nav', '1') !== '0',
        chat: stored('chat', '1') !== '0',
      };
      this.folded = new Set(JSON.parse(stored('folded', '[]')));
      this.unfolded = new Set(JSON.parse(stored('unfolded', '[]')));
      this.closed = new Set();
      this.navWidth = Number(stored('nav-width', NAV)) || NAV;
      const order = JSON.parse(stored('order', '[]')).filter((name) => SECTIONS.includes(name));
      this.order = [...order, ...SECTIONS.filter((name) => !order.includes(name))];
      this.openApps = new Set(JSON.parse(stored('open-apps', '[]')));
      this.convs = new Map();
      this.tree = null;
    }

    get here() {
      return window.marble?.app ?? '';
    }

    /** Float, with a pointer that can reach: the sidebars hide until wanted. */
    get autoHide() {
      return this.state.open && this.state.mode === 'float' && this.fine.matches && !this.phone.matches;
    }

    get drawer() {
      return document.querySelector('marble-agent-drawer');
    }

    /** What the drawer and anything else sitting in the page needs to know. */
    get layout() {
      const active = this.state.open && !this.phone.matches;
      return {
        open: active,
        mode: this.state.mode,
        nav: this.state.nav,
        chat: this.state.chat,
        top: this.state.mode === 'float' ? BAR + GAP : BAR,
        gap: GAP,
        // How much of the window the tree takes, so the chat's edge knows
        // how far it may be pulled.
        side: active && this.state.nav ? this.navWidth + (this.state.mode === 'float' ? GAP : 0) : 0,
        // In Float the chat is out only while it is reached for; `focusChat`
        // is a one-time ask to put the caret in it, for a reveal somebody
        // asked for rather than one a passing pointer caused.
        chatShown: !this.autoHide || this.shown.chat,
        focusChat: Boolean(this.focusChat),
      };
    }

    connectedCallback() {
      if (UI?.watchPageTheme) this.unwatchTheme = UI.watchPageTheme(this);
      this.fillCrumbs();
      this.$('.pill b').textContent = nameOf(this.here) || document.title;
      this.$('.home').href = HOME;

      this.$('.pill').addEventListener('click', () => this.setOpen(true));
      const zone = this.$('.zone');
      // A move, not an arrival: a page that loads under a still pointer, or
      // a pointer crossing the strip on its way somewhere, raises nothing.
      zone.addEventListener('pointermove', () => {
        if (!this.hasAttribute('data-peek') && !this.dwell) this.dwell = setTimeout(() => this.peek(true), DWELL);
      });
      this.$('.pill').addEventListener('pointerenter', () => { if (this.hasAttribute('data-peek')) this.peek(true); });
      this.$('.pill').addEventListener('pointerleave', () => this.peek(false));
      zone.addEventListener('pointerleave', (event) => {
        clearTimeout(this.dwell);
        this.dwell = null;
        if (!event.relatedTarget || !this.shadowRoot.contains(event.relatedTarget)) this.peek(false);
      });

      this.bar.addEventListener('click', (event) => {
        const act = event.target.closest('[data-act]')?.dataset.act;
        if (act === 'nav') this.set({ nav: !this.state.nav });
        else if (act === 'fit' || act === 'float') this.set({ mode: act });
        else if (act === 'chat') this.set({ chat: !this.state.chat });
        else if (act === 'close') this.setOpen(false);
        else if (act === 'share') this.toggleSharing();
        else if (act === 'describe') dispatchEvent(new CustomEvent('marble-marks:toggle'));
        else if (act === 'doc') this.toggleMenu(event.target.closest('[data-act]'));
      });
      this.sharing.querySelector('.copy').addEventListener('click', () => this.copyLink());
      this.bindMove();
      this.arrive();
      this.menu.addEventListener('click', (event) => {
        const pick = event.target.closest('[data-pick]')?.dataset.pick;
        if (!pick) return;
        this.hidePops();
        if (pick === 'link') this.copyLink();
        else if (pick === 'move') this.openMove();
        else if (pick === 'drive') location.href = this.folderHref(folderOf(this.here));
        else if (pick === 'download') location.href = window.marble.drive.downloadHref(this.here);
      });
      this.shadowRoot.addEventListener('pointerdown', (event) => {
        if (!event.composedPath().some((node) => node === this.menu || node === this.sharing || node === this.moving || node?.dataset?.act === 'share' || node?.dataset?.act === 'doc')) this.hidePops();
      });
      this.onOutside = (event) => {
        if (!event.composedPath().includes(this)) this.hidePops();
      };
      addEventListener('pointerdown', this.onOutside);

      this.search.addEventListener('input', () => this.drawTree());
      this.search.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (this.search.value) { this.search.value = ''; this.drawTree(); } else this.search.blur();
        } else if (event.key === 'Enter') {
          this.scroll.querySelector('a.row')?.click();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.scroll.querySelector('.row')?.focus();
        }
      });
      this.scroll.addEventListener('click', (event) => {
        const t = event.target;
        const row = t.closest('.row');
        if (row?.dataset.folder !== undefined && row.localName === 'button') this.toggleFolder(row.dataset.folder);
        const fold = t.closest('.sec-fold');
        if (fold) this.toggleSection(fold.closest('.sec').dataset.sec);
        if (t.closest('[data-mark-read]')) { this.markAllRead(); return; }
        const app = t.closest('[data-fold-app]');
        if (app) this.toggleApp(app.dataset.foldApp);
        const thread = t.closest('[data-thread]');
        if (thread) {
          const c = this.convs.get(thread.dataset.thread);
          if (c) this.openThread(c);
        }
      });
      this.bindReorder();
      this.scroll.addEventListener('keydown', (event) => this.walkRows(event));

      this.onKey = (event) => this.key(event);
      addEventListener('keydown', this.onKey, true);
      // The drawer mounts when the agent client arrives, which may be before
      // this or after it; either way it asks once it exists.
      this.onDrawer = () => this.announce();
      addEventListener('marble-tray:ready', this.onDrawer);
      // Describe mode (runtime/agent-marks.js) is there only where the tray
      // is; its button here says whether it is on.
      this.onMarks = (event) => {
        this.$('[data-act="describe"]').setAttribute('aria-pressed', String(Boolean(event.detail?.describing)));
        this.$('[data-act="describe"]').hidden = false;
      };
      addEventListener('marble-marks:mode', this.onMarks);
      this.onViewport = () => this.apply();
      this.phone.addEventListener('change', this.onViewport);
      this.onWindowResize = () => this.apply({ animate: false });
      addEventListener('resize', this.onWindowResize);
      this.bindEdge();
      this.bindReach();
      for (const hint of this.shadowRoot.querySelectorAll('.hint')) {
        hint.addEventListener('click', () => this.reveal(hint.dataset.side, { focus: hint.dataset.side === 'chat' }));
      }

      this.setAttribute('data-still', '');
      this.apply();
      requestAnimationFrame(() => requestAnimationFrame(() => this.removeAttribute('data-still')));
    }

    disconnectedCallback() {
      this.unwatchTheme?.();
      removeEventListener('keydown', this.onKey, true);
      removeEventListener('pointerdown', this.onOutside);
      removeEventListener('marble-tray:ready', this.onDrawer);
      removeEventListener('marble-marks:mode', this.onMarks);
      this.phone.removeEventListener('change', this.onViewport);
      removeEventListener('resize', this.onWindowResize);
      removeEventListener('pointermove', this.onPointer, true);
      document.removeEventListener('mouseout', this.onLeave);
      removeEventListener('focusin', this.onFocus, true);
      removeEventListener('focusout', this.onFocus, true);
      for (const type of ['pointerdown', 'wheel', 'keydown']) removeEventListener(type, this.onWork, true);
      this.fine.removeEventListener('change', this.onFine);
      this.offDrive?.();
      this.offAgents?.();
      removeEventListener('marble-agent:seen', this.onSeen);
      removeEventListener('storage', this.onCut);
      document.removeEventListener('input', this.onCut, true);
      document.removeEventListener('change', this.onCut, true);
      this.dock(null, { animate: false });
    }

    // ------------------------------------------------------------ state

    set(patch) {
      const was = { ...this.state };
      Object.assign(this.state, patch);
      for (const [name, value] of Object.entries(patch)) {
        store(name, typeof value === 'boolean' ? (value ? '1' : '0') : value);
      }
      // Arriving in Float shows both sidebars once, so it is plain what and
      // where they are; the first thing done on the page puts them away.
      if (this.autoHide && (patch.mode === 'float' && was.mode !== 'float' || patch.open && !was.open)) this.startIntro();
      // Turned on while floating: out, for the hand that just asked for it.
      if (this.autoHide && patch.nav && !was.nav) this.shown.nav = true;
      if (this.autoHide && patch.chat && !was.chat) { this.shown.chat = true; this.focusChat = true; }
      this.apply();
    }

    setOpen(open) {
      if (open === this.state.open) return;
      this.set({ open });
      if (open) {
        // ⌘J has always meant "the agent": opening onto the chat puts you in
        // its box, and a shell without a chat puts you in the search.
        if (!(this.state.chat && this.drawer)) this.search.focus({ preventScroll: true });
      } else {
        this.hidePops();
        if (this.shadowRoot.activeElement) this.shadowRoot.activeElement.blur();
      }
    }

    peek(on) {
      clearTimeout(this.peekTimer);
      clearTimeout(this.dwell);
      this.dwell = null;
      if (on) this.setAttribute('data-peek', '');
      // Leaving the strip for the pill crosses a sliver of page; the delay is
      // what makes the two one target to the hand. Short, so that a pill left
      // behind gives the app its corner back almost at once.
      else this.peekTimer = setTimeout(() => this.removeAttribute('data-peek'), 140);
    }

    // ------------------------------------------------------------ Float's reach

    startIntro() {
      this.intro = true;
      this.shown.nav = this.state.nav;
      this.shown.chat = this.state.chat && Boolean(this.drawer);
    }

    /** Bring a side out on purpose — ⌘K, the chat button, a conversation
     *  opened — rather than because the pointer passed by. */
    reveal(side, { focus = false } = {}) {
      if (!this.autoHide) return;
      this.quiet[side] = false;
      if (this.shown[side] && !(focus && side === 'chat')) return;
      clearTimeout(this.hideTimers[side]);
      this.shown[side] = true;
      if (focus && side === 'chat') this.focusChat = true;
      this.apply();
    }

    /** Put a side away now, pointer or not: it stays away until the pointer
     *  has left and comes back for it. */
    conceal(side) {
      if (!this.autoHide) return;
      this.quiet[side] = true;
      const drawer = this.drawer;
      if (side === 'chat' && document.activeElement === drawer) {
        let focused = drawer;
        while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
        focused?.blur?.();
      }
      if (side === 'nav' && this.nav.contains(this.shadowRoot.activeElement)) this.shadowRoot.activeElement.blur();
      this.shown[side] = false;
      this.apply();
    }

    rectOf(side) {
      const el = side === 'nav' ? this.nav : this.drawer?.shadowRoot?.querySelector('.panel');
      return el?.getBoundingClientRect() ?? null;
    }

    /** Whether a side is being reached for, read, typed in or resized. */
    wanted(side) {
      if (!this.autoHide) return false;
      if (side === 'nav' && !this.state.nav) return false;
      if (side === 'chat' && (!this.state.chat || !this.drawer)) return false;
      if (this.intro) return true;
      const focused = side === 'nav'
        ? this.nav.contains(this.shadowRoot.activeElement)
        : document.activeElement === this.drawer;
      if (focused) return true;
      if (side === 'nav' ? this.hasAttribute('data-resizing') : this.rectOf('chat') && this.drawer.shadowRoot.querySelector('.panel')?.dataset.resizing === 'true') return true;
      const p = this.pointer;
      if (!p) return false;
      const atEdge = p.y > BAR && (side === 'nav' ? p.x <= EDGE : p.x >= innerWidth - EDGE);
      let over = false;
      if (this.shown[side]) {
        const r = this.rectOf(side);
        over = Boolean(r && r.width && p.x >= r.left - 16 && p.x <= r.right + 16 && p.y >= r.top - 16 && p.y <= r.bottom + 16);
      }
      const reaching = atEdge || over;
      // Put away on purpose: the same hand has to leave before it can call
      // the side back.
      if (this.quiet[side]) {
        if (!reaching) this.quiet[side] = false;
        return false;
      }
      return reaching;
    }

    /** Out at once when wanted; away a beat after it stops being wanted, so
     *  a hand crossing the gap between the edge and the card keeps it. */
    settle() {
      if (!this.autoHide) return;
      let changed = false;
      for (const side of ['nav', 'chat']) {
        if (this.wanted(side)) {
          clearTimeout(this.hideTimers[side]);
          this.hideTimers[side] = null;
          if (!this.shown[side]) { this.shown[side] = true; changed = true; }
        } else if (this.shown[side] && !this.hideTimers[side]) {
          this.hideTimers[side] = setTimeout(() => {
            this.hideTimers[side] = null;
            if (this.wanted(side) || !this.shown[side]) return;
            this.shown[side] = false;
            this.apply();
          }, LINGER);
        }
      }
      if (changed) this.apply();
    }

    bindReach() {
      let queued = 0;
      this.onPointer = (event) => {
        this.pointer = { x: event.clientX, y: event.clientY };
        if (!queued) queued = requestAnimationFrame(() => { queued = 0; this.settle(); });
      };
      this.onLeave = (event) => {
        if (event.relatedTarget) return;
        this.pointer = null;
        this.settle();
      };
      this.onFocus = () => setTimeout(() => this.settle(), 0);
      // Doing something on the page — a press, a scroll, a key — is being
      // back at work, and the introduction is over.
      this.onWork = (event) => {
        if (!this.intro) return;
        const path = event.composedPath();
        if (path.includes(this) || (this.drawer && path.includes(this.drawer))) return;
        this.intro = false;
        this.settle();
      };
      addEventListener('pointermove', this.onPointer, { capture: true, passive: true });
      document.addEventListener('mouseout', this.onLeave);
      addEventListener('focusin', this.onFocus, true);
      addEventListener('focusout', this.onFocus, true);
      for (const type of ['pointerdown', 'wheel', 'keydown']) addEventListener(type, this.onWork, { capture: true, passive: true });
      this.onFine = () => this.apply({ animate: false });
      this.fine.addEventListener('change', this.onFine);
    }

    apply({ animate = true } = {}) {
      const { open, mode, nav, chat } = this.layout;
      this.toggleAttribute('data-open', open);
      this.dataset.mode = mode;
      this.dataset.nav = nav ? 'on' : 'off';
      this.$('[data-act="nav"]').setAttribute('aria-pressed', String(nav));
      this.$('[data-act="fit"]').setAttribute('aria-pressed', String(mode === 'fit'));
      this.$('[data-act="float"]').setAttribute('aria-pressed', String(mode === 'float'));
      const chatButton = this.$('[data-act="chat"]');
      chatButton.hidden = !this.drawer;
      this.$('[data-act="describe"]').hidden = !document.querySelector('.marble-marks-layer');
      chatButton.setAttribute('aria-pressed', String(chat));
      const auto = this.autoHide;
      this.toggleAttribute('data-hide-nav', auto && nav && !this.shown.nav);
      this.toggleAttribute('data-hide-chat', auto && chat && Boolean(this.drawer) && !this.shown.chat);
      this.nav.inert = !open || !nav || (auto && !this.shown.nav);
      this.bar.inert = !open;
      this.navWidth = this.clampNav(this.navWidth);
      this.style.setProperty('--nav-w', `${this.navWidth}px`);
      const edge = this.$('.edge');
      edge.setAttribute('aria-valuenow', String(this.navWidth));
      edge.setAttribute('aria-valuemin', String(NAV_MIN));
      edge.setAttribute('aria-valuemax', String(this.clampNav(NAV_MAX)));
      this.dock(open ? { top: BAR, left: mode === 'fit' && nav ? this.navWidth : 0 } : null, { animate: animate && !this.hasAttribute('data-still') });
      if (open && !this.tree) this.load();
      this.announce();
    }

    announce() {
      const layout = this.layout;
      this.focusChat = false;
      window.marbleShell.layout = { ...layout, focusChat: false };
      dispatchEvent(new CustomEvent('marble-shell:layout', { detail: layout }));
    }

    /** Fit moves the page, the way the pinned drawer always has: a transient
     *  stylesheet, so nothing about the document changes. The drawer adds its
     *  own right-hand margin; this is the top and the left.
     *
     *  The page glides into the room it is given rather than jumping to it:
     *  for one motion after a change the stylesheet also carries a transition
     *  on the root's margins, which covers the drawer's margin too, and on
     *  --marble-shell-top, so a document that sizes itself to the window
     *  resizes with the rest. Only for that long — a margin that eased while
     *  you dragged the chat's edge would trail your hand. */
    dock(inset, { animate = true } = {}) {
      const top = inset?.top ?? 0;
      const left = inset?.left ?? 0;
      const moving = animate && !this.reduced.matches;
      let style = document.getElementById('marble-shell-dock');
      if (!inset && !style) return;
      if (!style) {
        style = document.createElement('style');
        style.id = 'marble-shell-dock';
        style.setAttribute('data-marble-transient', '');
        document.head.append(style);
      }
      const write = (withMotion) => {
        const motion = withMotion
          ? `transition: margin ${MOTION}ms ${EASE}, height ${MOTION}ms ${EASE}, --marble-shell-top ${MOTION}ms ${EASE}, --marble-shell-left ${MOTION}ms ${EASE} !important;`
          : '';
        // A document that sizes itself to the window can ask how much of it the
        // shell has taken: calc(100dvh - var(--marble-shell-top, 0px)).
        style.textContent = `html { --marble-shell-top: ${top}px; --marble-shell-left: ${left}px; margin-top: ${top}px !important; margin-left: ${left}px !important; height: calc(100% - ${top}px) !important; ${motion} }`;
      };
      clearTimeout(this.settleTimer);
      if (!moving) {
        if (inset) write(false);
        else style.remove();
        return;
      }
      write(true);
      // Once it has arrived: the motion comes off, and a page that is not
      // docked any more gets back exactly the stylesheet it had.
      this.settleTimer = setTimeout(() => {
        if (inset) write(false);
        else style.remove();
      }, MOTION + 60);
    }

    // ------------------------------------------------------------ moving this document

    /** Move or rename the document you are in. The host does the moving and
     *  makes the old address forward (server/moves.js), so a link or a tab
     *  left on it still lands; this page is bound to the old address, so it
     *  opens again at the new one, where you were on it. */
    openMove() {
      this.hidePops();
      const dialog = this.moving;
      this.moveTo = { folder: folderOf(this.here) };
      dialog.querySelector('.name').value = nameOf(this.here);
      dialog.querySelector('.find').value = '';
      dialog.hidden = false;
      const anchor = this.$('.crumbs .here');
      this.place(dialog, anchor, 'left');
      if (!this.tree) this.load().then(() => this.drawDests());
      this.drawDests();
      const name = dialog.querySelector('.name');
      name.focus({ preventScroll: true });
      name.select();
    }

    folders() {
      const out = [{ path: '', name: 'Drive', depth: 0 }];
      const walk = (folder, depth) => {
        const kids = (folder.children ?? []).filter((c) => c.kind === 'folder')
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        for (const child of kids) {
          out.push({ path: child.path, name: child.name, depth });
          walk(child, depth + 1);
        }
      };
      if (this.tree) walk(this.tree, 1);
      return out;
    }

    drawDests() {
      const list = this.moving.querySelector('.dests');
      const query = this.moving.querySelector('.find').value.trim().toLowerCase();
      list.replaceChildren();
      for (const folder of this.folders()) {
        if (query && !folder.path.toLowerCase().includes(query) && !(folder.path === '' && 'drive'.includes(query))) continue;
        const b = h('button', 'dest');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.dataset.dest = folder.path;
        b.style.paddingLeft = `${8 + (query ? 0 : folder.depth * 14)}px`;
        b.setAttribute('aria-selected', String(folder.path === this.moveTo.folder));
        b.innerHTML = icon('folder');
        b.append(h('span', '', query && folder.path ? folder.path : folder.name));
        if (folder.path === folderOf(this.here)) b.append(h('span', 'here-tag', 'now'));
        list.append(b);
      }
      this.checkMove();
    }

    target() {
      const name = this.moving.querySelector('.name').value.trim();
      return { name, path: [this.moveTo.folder, name].filter(Boolean).join('/') };
    }

    checkMove() {
      const { name, path } = this.target();
      const note = this.moving.querySelector('.note');
      const ok = this.moving.querySelector('.ok');
      const taken = path !== this.here && this.docs().some((d) => d.path === path);
      const bad = !name ? 'A document needs a name.'
        : /[\/\\]/.test(name) ? 'A name cannot hold a slash; pick the folder below.'
        : taken ? `Something called ${name} is already there.`
        : null;
      note.toggleAttribute('data-bad', Boolean(bad));
      note.textContent = bad ?? (path === this.here ? '' : 'Links to it keep working: the old address sends them here.');
      ok.disabled = Boolean(bad) || path === this.here;
      ok.textContent = folderOf(path) === folderOf(this.here) ? 'Rename' : 'Move';
    }

    bindMove() {
      const dialog = this.moving;
      dialog.querySelector('.name').addEventListener('input', () => this.checkMove());
      dialog.querySelector('.find').addEventListener('input', () => this.drawDests());
      dialog.querySelector('.dests').addEventListener('click', (event) => {
        const dest = event.target.closest('.dest');
        if (!dest) return;
        this.moveTo.folder = dest.dataset.dest;
        for (const b of dialog.querySelectorAll('.dest')) b.setAttribute('aria-selected', String(b === dest));
        this.checkMove();
      });
      dialog.querySelector('.cancel').addEventListener('click', () => this.hidePops());
      dialog.querySelector('.ok').addEventListener('click', () => this.commitMove());
      dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !dialog.querySelector('.ok').disabled && !event.target.closest?.('.dest, .cancel')) {
          event.preventDefault();
          this.commitMove();
        }
      });
    }

    async commitMove() {
      const ok = this.moving.querySelector('.ok');
      const { path } = this.target();
      if (ok.disabled || path === this.here) return;
      ok.disabled = true;
      try {
        // Whatever is still on its way to the file lands at the old address
        // first; the move carries it.
        await window.marble.flush?.();
        await window.marble.drive.move(this.here, path);
      } catch (err) {
        const note = this.moving.querySelector('.note');
        note.setAttribute('data-bad', '');
        note.textContent = err.message || 'The move did not happen.';
        ok.disabled = false;
        return;
      }
      try {
        sessionStorage.setItem(`${KEY}arrive`, JSON.stringify({ path, x: scrollX, y: scrollY, renamed: folderOf(path) === folderOf(this.here) }));
      } catch { /* a fresh page at the top is all that is lost */ }
      location.replace(`${window.marble.href(path)}${location.hash}`);
    }

    /** Arriving at a document this page just moved: back to where you were on it. */
    arrive() {
      let at = null;
      try {
        at = JSON.parse(sessionStorage.getItem(`${KEY}arrive`) ?? 'null');
        sessionStorage.removeItem(`${KEY}arrive`);
      } catch { /* nothing to come back to */ }
      if (!at || at.path !== this.here) return;
      const go = () => scrollTo(at.x, at.y);
      if (document.readyState === 'complete') requestAnimationFrame(go);
      else addEventListener('load', () => requestAnimationFrame(go), { once: true });
      this.say(at.renamed ? `Renamed to ${nameOf(at.path)}` : `Moved to ${nameOf(folderOf(at.path)) || 'Drive'}`);
    }

    // ------------------------------------------------------------ the tree's edge

    clampNav(px) {
      const chat = this.state.chat && this.drawer?.isOpen ? this.drawer.width ?? 0 : 0;
      const room = innerWidth - chat - PAGE_MIN;
      return Math.round(Math.max(NAV_MIN, Math.min(NAV_MAX, room, Number(px) || NAV)));
    }

    setNavWidth(px, { persist = false, animate = false } = {}) {
      this.navWidth = this.clampNav(px);
      if (persist) store('nav-width', String(this.navWidth));
      this.apply({ animate });
    }

    bindEdge() {
      const edge = this.$('.edge');
      let drag = null;
      const hold = (on) => {
        this.toggleAttribute('data-resizing', on);
        // The cursor and the selection belong to the drag for as long as it
        // lasts, wherever over the page the pointer wanders.
        const id = 'marble-shell-resizing';
        document.getElementById(id)?.remove();
        if (!on) return;
        const style = document.createElement('style');
        style.id = id;
        style.setAttribute('data-marble-transient', '');
        style.textContent = 'html, html * { cursor: ew-resize !important; user-select: none !important; }';
        document.head.append(style);
      };
      edge.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag = { id: event.pointerId, x: event.clientX, width: this.navWidth };
        edge.setPointerCapture(event.pointerId);
        hold(true);
      });
      edge.addEventListener('pointermove', (event) => {
        if (drag?.id !== event.pointerId) return;
        this.setNavWidth(drag.width + event.clientX - drag.x);
      });
      const stop = (event) => {
        if (drag?.id !== event.pointerId) return;
        drag = null;
        hold(false);
        this.setNavWidth(this.navWidth, { persist: true });
      };
      edge.addEventListener('pointerup', stop);
      edge.addEventListener('pointercancel', stop);
      edge.addEventListener('dblclick', () => this.setNavWidth(NAV, { persist: true, animate: true }));
      edge.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 48 : 16;
        const next = event.key === 'ArrowRight' ? this.navWidth + step
          : event.key === 'ArrowLeft' ? this.navWidth - step
          : event.key === 'Home' ? NAV_MIN
          : event.key === 'End' ? NAV_MAX
          : null;
        if (next === null) return;
        event.preventDefault();
        this.setNavWidth(next, { persist: true });
      });
    }

    // ------------------------------------------------------------ keys

    key(event) {
      if (this.phone.matches || event.altKey) return;
      const mod = event.metaKey || event.ctrlKey;
      const k = event.key.toLowerCase();
      if (mod && !event.shiftKey && k === 'j') {
        event.preventDefault();
        event.stopPropagation();
        // A selection still decides first: the callout takes ⌘J when it can
        // draw a card at what you are holding.
        const selected = window.marble?.agent?.context?.().selection?.length;
        if (selected && !dispatchEvent(new CustomEvent('marble-callout:summon', { cancelable: true }))) return;
        this.setOpen(!this.state.open);
      } else if (mod && !event.shiftKey && k === 'k') {
        event.preventDefault();
        event.stopPropagation();
        if (!this.state.open) this.set({ open: true });
        if (!this.state.nav) this.set({ nav: true });
        this.reveal('nav');
        this.search.focus({ preventScroll: true });
        this.search.select();
      } else if (mod && !event.shiftKey && event.key === '\\' && this.state.open) {
        event.preventDefault();
        event.stopPropagation();
        this.set({ nav: !this.state.nav });
      } else if (event.key === 'Escape' && (!this.menu.hidden || !this.sharing.hidden || !this.moving.hidden)) {
        event.stopPropagation();
        this.hidePops();
      }
    }

    // Up and Down walk the visible rows; Right and Left unfold and fold.
    walkRows(event) {
      const rows = [...this.scroll.querySelectorAll('.row:is(a, button), .row .go, .sec-fold')].filter((el) => el.offsetParent && !el.closest('[inert]'));
      const at = rows.indexOf(this.shadowRoot.activeElement);
      if (at < 0) return;
      const row = rows[at];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = rows[at + (event.key === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus();
        else if (event.key === 'ArrowUp') this.search.focus();
      } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && row.dataset.folder !== undefined && row.localName === 'button') {
        event.preventDefault();
        const open = row.getAttribute('aria-expanded') === 'true';
        if ((event.key === 'ArrowRight') !== open) this.toggleFolder(row.dataset.folder);
      }
    }

    // ------------------------------------------------------------ where you are

    folderHref(folder) {
      return folder ? `${HOME}#/${encodeURIComponent(folder)}` : HOME;
    }

    fillCrumbs() {
      const crumbs = this.$('.crumbs');
      crumbs.replaceChildren();
      const sep = () => {
        const s = h('span', 'sep');
        s.innerHTML = icon('chev');
        s.setAttribute('aria-hidden', 'true');
        return s;
      };
      const top = h('a', '', 'Drive');
      top.href = this.folderHref('');
      crumbs.append(top);
      if (HOME_DOC && HOME_DOC === this.here) {
        top.setAttribute('aria-current', 'page');
        top.classList.add('here');
        return;
      }
      const parts = splitPath(this.here);
      parts.slice(0, -1).forEach((part, i) => {
        const a = h('a', '', part);
        a.href = this.folderHref(parts.slice(0, i + 1).join('/'));
        a.title = parts.slice(0, i + 1).join('/');
        crumbs.append(sep(), a);
      });
      const here = h('button', 'here');
      here.type = 'button';
      here.dataset.act = 'doc';
      here.setAttribute('aria-haspopup', 'menu');
      here.setAttribute('aria-expanded', 'false');
      // A document's label is its name in the folder, because that is its
      // address; the <title> inside it is what the tooltip is for.
      here.title = document.title && document.title !== nameOf(this.here) ? document.title : this.here;
      here.append(h('span', '', nameOf(this.here) || document.title));
      here.insertAdjacentHTML('beforeend', icon('down'));
      crumbs.append(sep(), here);
    }

    // ------------------------------------------------------------ popovers

    hidePops() {
      this.menu.hidden = true;
      this.sharing.hidden = true;
      this.moving.hidden = true;
      this.$('.crumbs .here')?.setAttribute('aria-expanded', 'false');
      this.$('[data-act="share"]').setAttribute('aria-expanded', 'false');
    }

    place(pop, anchor, align) {
      const r = anchor.getBoundingClientRect();
      pop.style.top = `${r.bottom + 6}px`;
      if (align === 'right') {
        pop.style.left = '';
        pop.style.right = `${Math.max(8, innerWidth - r.right)}px`;
      } else {
        pop.style.right = '';
        pop.style.left = `${Math.max(8, r.left)}px`;
      }
    }

    toggleMenu(anchor) {
      const opening = this.menu.hidden;
      this.hidePops();
      if (!opening) return;
      this.menu.replaceChildren();
      const item = (pick, glyph, label) => {
        const b = h('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.dataset.pick = pick;
        b.innerHTML = icon(glyph);
        b.append(label);
        this.menu.append(b);
      };
      item('link', 'link', 'Copy link');
      if (window.marble?.drive?.move) item('move', 'move', 'Move or rename…');
      item('drive', 'open', 'Show in Drive');
      if (window.marble?.drive?.downloadHref) item('download', 'download', 'Download');
      this.menu.hidden = false;
      anchor.setAttribute('aria-expanded', 'true');
      this.place(this.menu, anchor, 'left');
      this.menu.querySelector('button')?.focus({ preventScroll: true });
    }

    link() {
      return new URL(window.marble?.href?.(this.here) ?? location.pathname, location.href).href;
    }

    toggleSharing() {
      const opening = this.sharing.hidden;
      this.hidePops();
      if (!opening) return;
      const button = this.$('[data-act="share"]');
      this.sharing.querySelector('h3').textContent = `Share ${nameOf(this.here) || document.title}`;
      const input = this.sharing.querySelector('input');
      input.value = this.link();
      this.sharing.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      this.place(this.sharing, button, 'right');
      input.focus({ preventScroll: true });
      input.select();
    }

    async copyLink() {
      try {
        await navigator.clipboard.writeText(this.link());
        this.say('Link copied');
      } catch {
        this.say('Could not copy the link');
      }
    }

    say(text) {
      const toast = this.$('.toast');
      toast.textContent = text;
      toast.setAttribute('data-on', '');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => toast.removeAttribute('data-on'), 1600);
    }

    // ------------------------------------------------------------ the tree

    /** Read on first open, not on every page: most visits never open it. */
    async load() {
      const drive = window.marble?.drive;
      if (!drive) return;
      if (!this.offDrive && drive.on) {
        let queued = 0;
        this.offDrive = drive.on('*', (change) => {
          // The pins are written in the Drive's own file, so only a change to
          // that file can move them.
          if (change?.path === HOME_DOC || change?.from === HOME_DOC || change?.to === HOME_DOC) this.pinsStale = true;
          clearTimeout(queued);
          queued = setTimeout(() => this.load(), 300);
        });
      }
      this.watchAgents();
      const [tree] = await Promise.all([drive.tree(''), this.pins && !this.pinsStale ? null : this.loadPins()]);
      this.tree = tree;
      this.drawTree();
    }

    /** Pinned is the Drive's sidebar list, read out of the Drive's own file —
     *  the one place a pin is kept — rather than a second list kept here. */
    async loadPins() {
      this.pinsStale = false;
      if (!HOME_DOC || !window.marble?.href) { this.pins = []; return; }
      try {
        const res = await fetch(window.marble.href(HOME_DOC), { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        this.pins = [...doc.querySelectorAll('#pins > .pin[data-path]')].map((li) => ({
          path: li.dataset.path,
          kind: li.dataset.kind === 'folder' ? 'folder' : 'doc',
          label: [...li.querySelectorAll('[data-marble-editable]')].at(-1)?.textContent.trim() || nameOf(li.dataset.path),
        }));
      } catch {
        this.pins = [];
      }
    }

    // ------------------------------------------------------------ agents

    /** Conversations, as the drawer and the Agents page hear them: one list,
     *  then every change as it happens. */
    watchAgents() {
      const api = window.marble?.agent;
      if (!api || this.offAgents) return;
      // What the stream says is newer than the list, which was read at some
      // moment while the stream was already open: a conversation the stream
      // has spoken for keeps what the stream said, and an ask heard before
      // its conversation is known waits for it.
      const heard = new Set();
      this.asks = new Map();
      this.offAgents = api.on('*', (summary) => {
        // An ask opening or closing arrives on its own, ahead of any summary
        // that would say so.
        if (summary?.kind === 'ask' || summary?.kind === 'ask.resolved') {
          this.asks.set(summary.conversation, summary.kind === 'ask');
          this.redraw('agents');
          return;
        }
        if (!summary?.id || summary.kind) return;
        heard.add(summary.id);
        this.asks.delete(summary.id);
        if (summary.removed) this.convs.delete(summary.id);
        else this.convs.set(summary.id, summary);
        this.redraw('agents');
      });
      api.conversations().then((list) => {
        for (const summary of list) if (!heard.has(summary.id)) this.convs.set(summary.id, summary);
        this.redraw('agents');
      }).catch(() => {});
      // The chat saw one (runtime/agent-ui.js, markSeen): it is read now,
      // whatever the list said when it was fetched.
      this.onSeen = (event) => {
        const c = this.convs.get(event.detail?.id);
        if (!c?.needsReview) return;
        this.convs.set(c.id, { ...c, needsReview: false });
        this.redraw('agents');
      };
      addEventListener('marble-agent:seen', this.onSeen);
      // The cut moved: in another tab, or by the slider on this very page when
      // it is the Agents page (which writes it as the slider goes).
      this.onCut = (event) => {
        if (event.type === 'storage' ? event.key === IDLE_KEY : event.target?.matches?.('.idle-range')) {
          requestAnimationFrame(() => this.redraw('agents'));
        }
      };
      addEventListener('storage', this.onCut);
      document.addEventListener('input', this.onCut, true);
      document.addEventListener('change', this.onCut, true);
    }

    /** What a conversation is doing, in the three words the pips draw. */
    asking(c) {
      return this.asks?.has(c.id) ? this.asks.get(c.id) : Boolean(c.asking);
    }

    stateOf(c) {
      if (this.asking(c)) return 'waiting';
      if (c.running || c.queued) return 'working';
      return 'done';
    }

    // Unread: waiting on you, or finished since you last looked.
    unread(c) {
      return Boolean(this.asking(c) || c.needsReview);
    }

    /** The Agents page's cut, in minutes, or null for none. */
    idleCut() {
      let saved = null;
      try { saved = localStorage.getItem(IDLE_KEY); } catch { /* private browsing: the default */ }
      if (saved === 'all') return null;
      const n = Number(saved);
      return Number.isFinite(n) && n > 0 ? Math.min(IDLE_MAX, Math.max(IDLE_MIN, n)) : IDLE_MID;
    }

    /** The Agents page's rule, word for word: untouched longer than the cut —
     *  by you or by the agent — and not live work, which is never stale, nor
     *  the conversation showing in the chat. */
    idleHides(c, cut, now = Date.now()) {
      if (cut == null) return false;
      if (this.drawer?.isOpen && c.id === this.drawer.view?.getAttribute('conversation')) return false;
      if (c.running || c.queued || this.asking(c) || c.status === 'running') return false;
      const touched = Math.max(c.lastInteractedAt ?? 0, c.updatedAt ?? 0, c.lastFinishedAt ?? 0, c.createdAt ?? 0);
      return touched > 0 && now - touched > cut * 60_000;
    }

    /** The documents agents are at, most urgent first — every conversation the
     *  Agents page's idle cut would keep. */
    agentApps() {
      const now = Date.now();
      const cut = this.idleCut();
      const apps = new Map();
      this.olderCount = 0;
      for (const c of this.convs.values()) {
        if (c.archived || !c.target) continue;
        if (this.idleHides(c, cut, now)) { this.olderCount += 1; continue; }
        if (!apps.has(c.target)) apps.set(c.target, []);
        apps.get(c.target).push(c);
      }
      const rank = (c) => ORDER.indexOf(this.stateOf(c));
      const latest = (c) => Math.max(c.updatedAt ?? 0, c.lastFinishedAt ?? 0);
      const list = [...apps].map(([path, threads]) => ({
        path,
        threads: threads.sort((a, b) => rank(a) - rank(b) || latest(b) - latest(a)),
      }));
      return list.sort((a, b) => rank(a.threads[0]) - rank(b.threads[0]) || latest(b.threads[0]) - latest(a.threads[0]));
    }

    /** One mark per state, most urgent first, with how many when more than one. */
    pips(threads) {
      const wrap = h('span', 'pips');
      const counts = { waiting: 0, working: 0, done: 0 };
      for (const c of threads) counts[this.stateOf(c)] += 1;
      const said = ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${WORDS[k]}`).join(', ');
      wrap.setAttribute('role', 'img');
      wrap.setAttribute('aria-label', said);
      wrap.title = said;
      for (const k of ORDER) {
        if (!counts[k]) continue;
        const group = h('span', 'pg');
        group.append(this.pip(k));
        if (counts[k] > 1) group.append(h('span', 'n', String(counts[k])));
        wrap.append(group);
      }
      return wrap;
    }

    pip(state) {
      const pip = h('span', 'pip');
      pip.dataset.st = state;
      if (state === 'done') pip.innerHTML = `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2.4 5.3 1.8 1.8 3.6-4"/></svg>`;
      return pip;
    }

    /** Opens the conversation at its document, with the chat beside it. */
    openThread(c) {
      if (c.target === this.here) {
        if (!this.state.chat) this.set({ chat: true });
        dispatchEvent(new CustomEvent('marble:agent-open', { detail: { id: c.id } }));
        return;
      }
      // The drawer on the next page picks the conversation up from the hash
      // and opens with it, the way the Drive hands one over.
      if (!this.state.chat) this.set({ chat: true });
      location.href = `${window.marble.href(c.target)}#chat=${encodeURIComponent(c.id)}`;
    }

    agentsList() {
      const ul = h('ul', 'agents');
      const apps = this.agentApps();
      for (const app of apps) {
        const li = h('li');
        const many = app.threads.length > 1;
        const open = many && this.openApps.has(app.path);
        if (open) li.setAttribute('data-open', '');
        const row = h('div', 'row app');
        row.dataset.app = app.path;
        if (app.threads.some((c) => this.unread(c))) row.setAttribute('data-unread', '');
        if (app.path === this.here) row.setAttribute('aria-current', 'page');
        if (many) {
          const car = h('button', 'fold');
          car.type = 'button';
          car.dataset.foldApp = app.path;
          car.setAttribute('aria-expanded', String(open));
          car.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the ${app.threads.length} conversations at ${nameOf(app.path)}`);
          car.innerHTML = `<svg class="i car" viewBox="0 0 16 16" aria-hidden="true">${PATHS.chev}</svg>`;
          row.append(car);
        }
        const go = h('button', 'go');
        go.type = 'button';
        go.dataset.thread = app.threads[0].id;
        go.title = `${app.path} — open with its chat`;
        go.innerHTML = icon('doc');
        go.append(h('span', 'name', nameOf(app.path)));
        // Unfolded, these fade and the rows below say it agent by agent.
        row.append(go, this.pips(app.threads));
        li.append(row);
        if (many) {
          // Always there, folded shut, so unfolding can slide it open.
          const drop = h('div', 'drop');
          drop.inert = !open;
          const threads = h('ul', 'threads');
          for (const c of app.threads) {
            const t = h('button', 'row thread');
            t.type = 'button';
            t.dataset.thread = c.id;
            if (this.unread(c)) t.setAttribute('data-unread', '');
            t.append(h('span', 'name', c.title || 'New chat'), this.pip(this.stateOf(c)));
            t.title = `${c.title || 'New chat'} — ${WORDS[this.stateOf(c)]}`;
            threads.append(this.item(t));
          }
          drop.append(threads);
          li.append(drop);
        }
        ul.append(li);
      }
      const cut = this.idleCut();
      if (!apps.length) ul.append(h('li', 'empty', this.olderCount ? `Nothing in the last ${idleLabel(cut)}.` : 'No agent is at work.'));
      if (this.olderCount) {
        const older = h('li', 'older', `${this.olderCount} older than ${idleLabel(cut)}`);
        older.title = 'The cut is the Agents page\'s: move its slider to show more or fewer';
        ul.append(older);
      }
      return ul;
    }

    /** Everything finished and not yet looked at, looked at. A conversation
     *  waiting on you stays bold: reading it does not answer it. */
    markAllRead() {
      const api = window.marble?.agent;
      const unread = [...this.convs.values()].filter((c) => !c.archived && c.needsReview);
      for (const c of unread) this.convs.set(c.id, { ...c, needsReview: false });
      this.redraw('agents');
      for (const c of unread) api?.markReviewed(c.id).catch(() => {});
    }

    agentsActions() {
      const unread = [...this.convs.values()].some((c) => !c.archived && c.needsReview);
      if (!unread) return [];
      const b = h('button', 'sec-act');
      b.type = 'button';
      b.dataset.markRead = '';
      b.innerHTML = icon('read');
      b.setAttribute('aria-label', 'Mark all as read');
      b.title = 'Mark all as read';
      return [b];
    }

    agentsMeta() {
      let waiting = 0;
      for (const c of this.convs.values()) if (!c.archived && this.asking(c)) waiting += 1;
      if (!waiting) return null;
      const meta = h('span', 'sec-meta', `${waiting} need${waiting === 1 ? 's' : ''} you`);
      meta.prepend(this.pip('waiting'));
      return meta;
    }

    // ------------------------------------------------------------ sections

    toggleSection(name) {
      if (this.folded.has(name)) this.folded.delete(name);
      else this.folded.add(name);
      store('folded', JSON.stringify([...this.folded]));
      this.redraw(name);
    }

    toggleFolder(path) {
      const open = this.isUnfolded(path);
      if (open) {
        this.unfolded.delete(path);
        this.closed.add(path);
      } else {
        this.unfolded.add(path);
        this.closed.delete(path);
      }
      store('unfolded', JSON.stringify([...this.unfolded]));
      this.redraw('drive');
      this.scroll.querySelector(`button.row[data-folder="${CSS.escape(path)}"]`)?.focus({ preventScroll: true });
    }

    toggleApp(path) {
      if (this.openApps.has(path)) this.openApps.delete(path);
      else this.openApps.add(path);
      store('open-apps', JSON.stringify([...this.openApps]));
      // In place, not redrawn, so the rows slide and the marks hand over.
      const car = this.scroll.querySelector(`[data-fold-app="${CSS.escape(path)}"]`);
      const li = car?.closest('li');
      if (!li) { this.redraw('agents'); return; }
      const open = this.openApps.has(path);
      li.toggleAttribute('data-open', open);
      li.querySelector(':scope > .drop').inert = !open;
      car.setAttribute('aria-expanded', String(open));
      car.setAttribute('aria-label', car.getAttribute('aria-label').replace(/^(Show|Hide)/, open ? 'Hide' : 'Show'));
      car.focus({ preventScroll: true });
    }

    // The folders you are inside are unfolded until you fold one yourself.
    isUnfolded(path) {
      if (this.closed.has(path)) return false;
      const inside = this.here === path || this.here.startsWith(`${path}/`);
      return this.unfolded.has(path) || inside;
    }

    docRow(entry, { where = false } = {}) {
      const a = h('a', 'row');
      a.href = window.marble?.href?.(entry.path) ?? '#';
      a.innerHTML = icon('doc');
      a.append(h('span', '', entry.name));
      a.title = entry.path;
      if (where) {
        const folder = folderOf(entry.path);
        if (folder) a.append(h('span', 'where', nameOf(folder)));
      }
      if (entry.path === this.here) a.setAttribute('aria-current', 'page');
      return a;
    }

    item(row) {
      const li = h('li');
      li.append(row);
      return li;
    }

    section(name, list, meta = null, actions = []) {
      const label = LABELS[name];
      const sec = h('section', 'sec');
      sec.dataset.sec = name;
      if (this.folded.has(name)) sec.setAttribute('data-folded', '');
      const head = h('div', 'sec-h');
      const fold = h('button', 'sec-fold');
      fold.type = 'button';
      fold.setAttribute('aria-expanded', String(!this.folded.has(name)));
      fold.innerHTML = icon('chev');
      fold.append(label);
      const grip = h('button', 'sec-grip');
      grip.type = 'button';
      grip.innerHTML = icon('grip');
      grip.setAttribute('aria-label', `Move ${label}: drag, or Alt+Up and Alt+Down`);
      grip.title = 'Drag to reorder';
      head.append(fold);
      if (meta) head.append(meta);
      head.append(h('span', 'sec-gap'), ...actions, grip);
      sec.append(head, list);
      return sec;
    }

    branch(folder) {
      const ul = h('ul');
      const kids = (folder.children ?? []).filter((c) => c.kind === 'folder' || c.kind === 'doc')
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'folder' ? -1 : 1));
      for (const child of kids) {
        const li = h('li');
        if (child.kind === 'folder') {
          const open = this.isUnfolded(child.path);
          const b = h('button', 'row');
          b.type = 'button';
          b.dataset.folder = child.path;
          b.setAttribute('aria-expanded', String(open));
          b.innerHTML = `<svg class="i car" viewBox="0 0 16 16" aria-hidden="true">${PATHS.chev}</svg>${icon('folder')}`;
          b.append(h('span', '', child.name));
          li.append(b);
          if (open) li.append(this.branch(child));
        } else {
          li.append(this.docRow(child));
        }
        ul.append(li);
      }
      return ul;
    }

    docs() {
      const docs = [];
      const walk = (folder) => {
        for (const child of folder.children ?? []) {
          if (child.kind === 'doc') docs.push(child);
          else if (child.kind === 'folder') walk(child);
        }
      };
      if (this.tree) walk(this.tree);
      return docs;
    }

    /** One section, built fresh; null when it has nothing to say at all. */
    build(name) {
      if (name === 'pinned') {
        if (!this.pins?.length) return null;
        const ul = h('ul');
        for (const pin of this.pins) {
          const a = h('a', 'row');
          a.href = pin.kind === 'folder' ? this.folderHref(pin.path) : window.marble?.href?.(pin.path) ?? '#';
          a.innerHTML = icon(pin.kind === 'folder' ? 'folder' : 'doc');
          a.append(h('span', '', pin.label));
          a.title = pin.path;
          const folder = folderOf(pin.path);
          if (folder) a.append(h('span', 'where', nameOf(folder)));
          if (pin.path === this.here) a.setAttribute('aria-current', 'page');
          ul.append(this.item(a));
        }
        return this.section(name, ul);
      }
      if (name === 'recent') {
        const ul = h('ul');
        for (const d of this.docs().sort((a, b) => b.modified - a.modified).slice(0, RECENT)) ul.append(this.item(this.docRow(d, { where: true })));
        return this.section(name, ul);
      }
      if (name === 'agents') {
        if (!window.marble?.agent) return null;
        return this.section(name, this.agentsList(), this.agentsMeta(), this.agentsActions());
      }
      return this.section(name, this.branch(this.tree));
    }

    /** Only the one section that changed: an agent reporting in every few
     *  seconds should not rebuild the whole tree under your pointer. */
    redraw(name) {
      if (!this.tree || this.search.value.trim()) return;
      if (this.dragging) { this.dirty = true; return; }
      const old = this.scroll.querySelector(`:scope > .sec[data-sec="${name}"]`);
      if (!old) { this.drawTree(); return; }
      const next = this.build(name);
      if (next) old.replaceWith(next);
      else old.remove();
    }

    drawTree() {
      if (!this.tree) return;
      if (this.dragging) { this.dirty = true; return; }
      const keep = this.scroll.scrollTop;
      const query = this.search.value.trim().toLowerCase();
      if (query) {
        const ul = h('ul');
        const hits = this.docs().filter((d) => d.path.toLowerCase().includes(query) || String(d.title ?? '').toLowerCase().includes(query))
          .sort((a, b) => Number(b.name.toLowerCase().includes(query)) - Number(a.name.toLowerCase().includes(query)) || b.modified - a.modified)
          .slice(0, 40);
        for (const d of hits) ul.append(this.item(this.docRow(d, { where: true })));
        if (!hits.length) ul.append(h('li', 'empty', 'Nothing by that name.'));
        this.scroll.replaceChildren(ul);
        return;
      }
      this.scroll.replaceChildren(...this.order.map((name) => this.build(name)).filter(Boolean));
      this.scroll.scrollTop = keep;
      if (!this.revealed) {
        this.revealed = true;
        this.scroll.querySelector('.sec[data-sec="drive"] [aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
      }
    }

    // ------------------------------------------------------------ reordering

    saveOrder() {
      const shown = [...this.scroll.querySelectorAll(':scope > .sec')].map((sec) => sec.dataset.sec);
      // A section with nothing in it today (no pins yet) keeps its place for
      // the day it has something.
      const hidden = this.order.filter((name) => !shown.includes(name));
      const next = [...shown];
      for (const name of hidden) next.splice(Math.min(this.order.indexOf(name), next.length), 0, name);
      this.order = next;
      store('order', JSON.stringify(next));
    }

    /** Moves a section and lets the others slide to their new places rather
     *  than jump there: each is measured, moved, and animated back from
     *  where it was (FLIP). */
    moveSection(sec, beforeNode, { except = null } = {}) {
      const others = [...this.scroll.querySelectorAll(':scope > .sec')].filter((el) => el !== except);
      const before = new Map(others.map((el) => [el, el.getBoundingClientRect().top]));
      this.scroll.insertBefore(sec, beforeNode);
      if (this.reduced.matches) return;
      for (const el of others) {
        const dy = before.get(el) - el.getBoundingClientRect().top;
        if (!dy) continue;
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: EASE });
      }
    }

    bindReorder() {
      this.scroll.addEventListener('keydown', (event) => {
        const grip = event.target.closest?.('.sec-grip');
        if (!grip || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        const sec = grip.closest('.sec');
        const target = event.key === 'ArrowUp' ? sec.previousElementSibling : sec.nextElementSibling?.nextElementSibling ?? null;
        if (event.key === 'ArrowUp' && !target) return;
        if (event.key === 'ArrowDown' && !sec.nextElementSibling) return;
        this.moveSection(sec, target);
        this.saveOrder();
        grip.focus({ preventScroll: true });
      });

      this.scroll.addEventListener('pointerdown', (event) => {
        const grip = event.target.closest?.('.sec-grip');
        if (!grip || event.button !== 0) return;
        event.preventDefault();
        const sec = grip.closest('.sec');
        const start = event.clientY;
        const origin = sec.getBoundingClientRect().top;
        let lifted = false;
        const move = (ev) => {
          const dy = ev.clientY - start;
          if (!lifted) {
            if (Math.abs(dy) < 4) return;
            lifted = true;
            this.dragging = true;
            sec.setAttribute('data-lifted', '');
            this.setAttribute('data-sorting', '');
          }
          // Where the pointer wants the section's top, and so its middle,
          // among the others' middles.
          const want = origin + dy;
          const middle = want + sec.offsetHeight / 2;
          const others = [...this.scroll.querySelectorAll(':scope > .sec')].filter((el) => el !== sec);
          const next = others.find((el) => {
            const r = el.getBoundingClientRect();
            return middle < r.top + r.height / 2;
          }) ?? null;
          if (next !== sec.nextElementSibling) this.moveSection(sec, next, { except: sec });
          // It follows the pointer from wherever the list has put it now.
          const held = Number(sec.dataset.dy) || 0;
          const placed = sec.getBoundingClientRect().top - held;
          sec.dataset.dy = String(want - placed);
          sec.style.transform = `translateY(${want - placed}px)`;
        };
        const up = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
          removeEventListener('pointercancel', up);
          if (!lifted) return;
          const from = Number(sec.dataset.dy) || 0;
          sec.style.transform = '';
          delete sec.dataset.dy;
          sec.removeAttribute('data-lifted');
          this.removeAttribute('data-sorting');
          if (from && !this.reduced.matches) {
            sec.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], { duration: 200, easing: EASE });
          }
          this.dragging = false;
          this.saveOrder();
          if (this.dirty) { this.dirty = false; this.drawTree(); }
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
        addEventListener('pointercancel', up);
      });
    }
  }

  // Registered as lengths so they can be eased; unregistered, a custom
  // property jumps from one value to the next.
  for (const name of ['--marble-shell-top', '--marble-shell-left']) {
    try { CSS.registerProperty({ name, syntax: '<length>', inherits: true, initialValue: '0px' }); } catch { /* already, or unsupported */ }
  }

  customElements.define('marble-shell', MarbleShell);

  const mount = () => {
    if (document.querySelector('marble-shell')) return;
    const el = document.createElement('marble-shell');
    el.setAttribute('data-marble-transient', '');
    window.marbleShell = {
      layout: null,
      toggle: () => el.setOpen(!el.state.open),
      setOpen: (open) => el.setOpen(open),
      setChat: (chat) => el.set({ chat }),
      reveal: (side, options) => el.reveal(side, options),
      conceal: (side) => el.conceal(side),
      // Whether the sidebars are floating and hiding until reached for.
      get autoHide() { return el.autoHide; },
      // The drawer leaves ⌘J to the shell wherever the shell can open.
      get takesKeys() { return !el.phone.matches; },
    };
    document.body.append(el);
  };

  if (document.body) mount();
  else addEventListener('DOMContentLoaded', mount, { once: true });
})();
