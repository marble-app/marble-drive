// The shell: ⌘\ opens the drive around the document you are in. (⌘J asks
// about what you are on, in place: agent-callout.js.)
//
// The tree on the left, the chat on the right where it already is, and a thin
// bar across the top that says where you are and lets you share it. Each side
// is pinned or on hover, by its own button at its end of the bar: pinned, it
// keeps a column and the document takes the space that is left; on hover, it
// waits just off its edge and slides over the document as a card when the
// pointer reaches for it. Closed — App alone — nothing sits on the page but a
// pill that rises at the top-left corner when the pointer goes there, and the
// agent button in the other corner.
//
// Everything here is transient chrome in an open shadow root, like the drawer:
// the file on disk never hears about it. What it remembers (open or not, which
// sides are pinned, which folders are unfolded) is this browser's,
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
  // A side on hover stays out of the way until the pointer reaches for it:
  // this close to the window's edge, and this long after it leaves.
  const EDGE = 10;
  const LINGER = 320;
  const GAP = 8;
  const PHONE = '(max-width: 719px)';
  const KEY = 'marble-shell:';
  const RECENT = 6;
  // The sidebar as the last page left it (remember/restore). Past this size it
  // is not kept, and the next page asks the way it did before there was one.
  const LAST = `${KEY}last`;
  const LAST_MAX = 1_500_000;
  // All a conversation's row and pips are drawn from.
  const CONV_KEEP = ['id', 'target', 'title', 'running', 'queued', 'asking', 'status', 'needsReview', 'updatedAt', 'lastFinishedAt', 'lastInteractedAt', 'createdAt'];
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
  // Whether this drive publishes folders that are git repositories
  // (server/git.js). The host says so only where MARBLE_DRIVE_GIT is on.
  const GIT = document.currentScript?.dataset.git === '1';
  // Who files a pin from here, so the Drive open in another tab hears it.
  const CLIENT = Math.random().toString(36).slice(2, 10);

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
    pin: '<path d="M6 2.25h4M6.75 2.25v4L4.5 9.25h7l-2.25-3v-4M8 9.25v4.5"/>',
    tab: '<path d="M9.25 2.75h4v4M13.25 2.75 7.5 8.5"/><path d="M11.5 9.5v2.75c0 .83-.67 1.5-1.5 1.5H3.75c-.83 0-1.5-.67-1.5-1.5V6c0-.83.67-1.5 1.5-1.5H6.5"/>',
    copy: '<rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.75"/><path d="M10.75 5.25V3.75c0-.83-.67-1.5-1.5-1.5h-5.5c-.83 0-1.5.67-1.5 1.5v5.5c0 .83.67 1.5 1.5 1.5h1.5"/>',
    edit: '<path d="M10.25 3.25 12.75 5.75 6 12.5l-3.25.75.75-3.25z"/><path d="M8.75 4.75l2.5 2.5"/>',
    path: '<path d="M2.25 8h11.5M10.5 4.75 13.75 8l-3.25 3.25"/><path d="M2.25 4.25v7.5"/>',
    trash: '<path d="M2.75 4.25h10.5M6.25 4.25v-1c0-.55.45-1 1-1h1.5c.55 0 1 .45 1 1v1"/><path d="M4 4.25l.6 8.3c.06.8.72 1.45 1.53 1.45h3.74c.8 0 1.47-.64 1.53-1.45l.6-8.3"/>',
  };
  // A pin's glyph as the Drive draws it (templates/drive.mrbl, ICON), so a pin
  // filed from here looks like one filed there.
  const PIN_GLYPH = {
    folder: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2.4 3.404h2.796a.9.9 0 0 1 .9.9v.598a.8.8 0 0 0 .8.8h6.454a1.15 1.15 0 0 1 1.15 1.15v4.594a1.15 1.15 0 0 1-1.15 1.15H2.65A1.15 1.15 0 0 1 1.5 11.446V4.304a.9.9 0 0 1 .9-.9z"/></svg>',
    doc: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2.2" y="2.7" width="11.6" height="10.6" rx="2.1" fill="none" stroke="currentColor" stroke-width="1.3"/><path stroke="currentColor" stroke-width="1.3" d="M2.2 6.2h11.6"/><circle cx="4.6" cy="4.45" r=".78" fill="currentColor"/></svg>',
  };
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // How long a finger rests on a row before its menu opens.
  const PRESS = 500;
  const icon = (name) => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true">${PATHS[name]}</svg>`;
  // What each share link lets its holder do (server/share-policy.js says the
  // same thing as rules). The names are the ones the owner chose.
  const SHARE_LEVELS = [
    ['view', 'Read only', 'Sees the page and its changes as they happen.'],
    ['edit', 'Read &amp; write', 'Can type, tick, add and reorder where the page allows it.'],
    ['modify', 'Read, write &amp; modify', 'Can also rewrite and restyle the page. Its code stays yours.'],
  ];
  const LEVEL_NAME = { view: 'Read only', edit: 'Read & write', modify: 'Read, write & modify' };
  // The colour a folder wears on the Drive (templates/drive.mrbl, .item[data-realm]
  // --folder), light and dark, so a row here is the same colour as its tile there.
  const REALMS = {
    research: ['#2f6f5b', '#6fbfa2'],
    fun: ['#c45c3e', '#e08a6a'],
    days: ['#6f8f7d', '#8fb09a'],
    marble: ['#7e91a3', '#9bb0c0'],
    travel: ['#3d6b8a', '#7aa0b8'],
  };
  const REALM_CSS = Object.entries(REALMS).map(([name, [light]]) => `[data-realm="${name}"] { --tint: ${light}; }`).join('\n    ')
    + `\n    @media (prefers-color-scheme: dark) { ${Object.entries(REALMS).map(([name, [, dark]]) => `[data-realm="${name}"] { --tint: ${dark}; }`).join(' ')} }`;
  const tidyHex = (value) => {
    const m = String(value ?? '').trim().match(/^#([0-9a-f]{6})$/i);
    return m ? `#${m[1].toLowerCase()}` : '';
  };
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
    /* A row wears its folder's colour, the one its tile has on the Drive; a
       document with a favicon of its own shows that instead. */
    ${REALM_CSS}
    :is([data-realm], [data-tinted]) > .i:not(.car) { color: var(--tint); }
    img.i { stroke: none; object-fit: contain; border-radius: 3px; }
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
    :host([data-nav="hover"]) .edge::before { top: 14px; bottom: 14px; }
    /* Under the hand the panel follows at once; easing would trail it. */
    :host([data-resizing]) .nav { transition: none; }

    /* ── On hover: a side as a card over the page ──
       The bar stays docked whatever the sides do. It is the one line that
       says where you are, and a page that slid under it would lose its top
       edge to it. */
    :host([data-nav="hover"]) .nav { top: ${BAR + GAP}px; left: ${GAP}px; bottom: ${GAP}px; border: 1px solid var(--line); border-radius: 16px;
      box-shadow: var(--shadow-lift); background: color-mix(in srgb, var(--paper) 82%, transparent); -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3); }
    @media (prefers-reduced-transparency: reduce) { :host([data-nav="hover"]) .nav { background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; } }

    /* ── On hover, at rest: the side waits at its edge ──
       Each is a hand's reach away — the pointer at that edge brings it out —
       and a thin mark on the edge says that something is there. */
    :host([data-hide-nav]) .nav { transform: translateX(calc(-100% - 24px)); opacity: 0; pointer-events: none; visibility: hidden; --hide-after: ${MOTION}ms; }
    .hint { position: fixed; top: calc(${BAR}px + (100vh - ${BAR}px) / 2); width: 4px; height: 44px; margin-top: -22px; border-radius: 2px;
      background: color-mix(in srgb, var(--ink) 22%, transparent); opacity: 0; pointer-events: none; transition: opacity 200ms var(--settle); }
    .hint[data-side="nav"] { left: 3px; }
    .hint[data-side="chat"] { right: 3px; }
    :host([data-hide-nav]) .hint[data-side="nav"], :host([data-hide-chat]) .hint[data-side="chat"] { opacity: 1; pointer-events: auto; }

    /* ── Closed ── */
    :host(:not([data-open])) .bar { transform: translateY(-100%); opacity: 0; pointer-events: none; visibility: hidden; --hide-after: ${MOTION}ms; }
    :host(:not([data-open])) .nav { transform: translateX(calc(-100% - 24px)); opacity: 0; pointer-events: none; visibility: hidden; --hide-after: ${MOTION}ms; }
    /* Pinned, the tree travels exactly as far as the page's edge does, on the
       same curve, so the page is never seen pulling away from a panel that has
       not arrived yet. A card on hover clears its own shadow on the way out. */
    :host([data-nav="pin"]:not([data-open])) .nav { transform: translateX(-100%); }

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
    .menu button > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .menu hr { border: 0; border-top: 1px solid var(--line); margin: 5px 4px; }
    .menu button[data-danger]:is(:hover, :focus-visible), .menu button[data-danger]:is(:hover, :focus-visible) .i { color: var(--danger, #b4533e); }

    /* ── A row's menu, and what you carry out of a row ──
       The row a menu is about keeps its hover while the menu is open. What
       you drag tracks the pointer one to one with no transition; the folder
       it would land in answers with a ring inside its edge, and in Pinned the
       room opens where it would go. */
    .row[data-menu] { background: var(--paper-2); color: var(--ink); }
    .row { -webkit-touch-callout: none; }
    .ghost { position: fixed; top: 0; left: 0; z-index: 3; display: flex; align-items: center; gap: 7px; max-width: 240px; padding: 5px 10px;
      background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow-lift);
      font-size: 13px; white-space: nowrap; pointer-events: none; transform-origin: 0 0; }
    .ghost > span { overflow: hidden; text-overflow: ellipsis; }
    .ghost .i { color: var(--faint); }
    .row[data-carried] { opacity: .45; }
    .row[data-drop] { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 0 0 2px var(--accent); }
    .sec-h[data-drop] .sec-fold { color: var(--ink); background: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent); }
    li.slot > .row { background: var(--accent-soft); color: var(--ink); }
    ul:has(> li.slot) > li.empty { display: none; }
    :host([data-carrying]) .scroll { user-select: none; cursor: grabbing; }
    :host([data-carrying]) .row:hover:not([data-drop]) { background: none; }
    .row input.rename { flex: 1; min-width: 0; font: inherit; color: var(--ink); background: var(--card); border: 0; border-radius: 4px;
      padding: 0 4px; margin: -1px -4px; outline: 2px solid var(--accent); outline-offset: 0; }
    /* Share: a link per level, each its own row, and the owner's own address
       last. A row that has a link shows it, so what is out there is on screen. */
    .sharing { width: min(340px, calc(100vw - 16px)); padding: 12px; }
    .sharing h3 { margin: 0 0 2px; font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sharing .lede { margin: 0 0 8px; color: var(--muted); font-size: 12.5px; }
    .sharing .lede[data-open] { color: var(--caution); }
    .levels { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .level, .own { display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 8px; row-gap: 2px; padding: 9px 0; border-top: 1px solid var(--line); }
    .lv-name { font-weight: 600; color: var(--ink); white-space: nowrap; }
    .lv-says { grid-column: 1 / -1; color: var(--muted); font-size: 12px; text-wrap: pretty; }
    .lv-acts { display: flex; gap: 4px; }
    .lv-acts button, .own button { height: 28px; padding: 0 10px; border-radius: 8px; font-weight: 600; font-size: 12.5px; display: flex; align-items: center; gap: 6px; }
    .lv-copy, .own button { background: var(--ink); color: var(--paper); }
    .lv-copy:active, .own button:active { background: var(--accent-ink); }
    .lv-off { color: var(--muted); }
    .lv-off:hover { background: var(--paper-2); color: var(--ink); }
    .lv-off[data-sure] { color: var(--danger, #b4533e); background: var(--paper-2); }
    .lv-off[hidden], .lv-url[hidden] { display: none; }
    .lv-url { grid-column: 1 / -1; margin-top: 4px; width: 100%; min-width: 0; height: 28px; border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; font: 11.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); background: var(--paper); }
    .sharing button:disabled { opacity: .5; cursor: default; }
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
  // Which version of a document a tree saw: it changes whenever the file does.
  const stampOf = (tree, docPath) => {
    if (!docPath) return null;
    let folder = tree;
    for (const part of splitPath(docPath).slice(0, -1)) {
      folder = folder?.children?.find((c) => c.kind === 'folder' && c.name === part);
    }
    const doc = folder?.children?.find((c) => c.kind === 'doc' && c.path === docPath);
    return doc ? `${doc.modified}:${doc.bytes}` : null;
  };
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
        <button type="button" class="pill" aria-label="Open the drive (⌘\\)">${LOGO}<b></b><kbd>⌘\\</kbd></button>
        <header class="bar" aria-label="Drive">
          <button type="button" class="ib" data-act="nav" aria-pressed="true" aria-label="Pin the tree" title="Pin the tree (⌘⇧\\)">${icon('nav')}</button>
          <a class="home" aria-label="Drive" title="Drive">${LOGO}</a>
          <nav class="crumbs" aria-label="Where you are"></nav>
          <span class="spacer"></span>
          <button type="button" class="ib" data-act="describe" aria-pressed="false" aria-label="Describe a change (⌘⇧D)" title="Describe a change (⌘⇧D)" hidden>${icon('describe')}</button>
          <button type="button" class="share" data-act="share" aria-haspopup="dialog" aria-expanded="false">${icon('share')}Share</button>
          <span class="vr"></span>
          <button type="button" class="ib" data-act="chat" aria-pressed="true" aria-label="Pin the chat" title="Pin the chat (⌘⇧J)" aria-keyshortcuts="Meta+Shift+J" hidden>${icon('chat')}</button>
          <button type="button" class="ib" data-act="close" aria-label="Hide everything" title="Hide everything (⌘\\)">${icon('collapse')}</button>
        </header>
        <nav class="nav" aria-label="Drive tree">
          <button type="button" class="edge" role="separator" aria-orientation="vertical" aria-label="Resize the tree" title="Drag to resize · double-click to reset"></button>
          <label class="search">${icon('search')}<input type="search" placeholder="Search the drive" aria-label="Search the drive" autocomplete="off" spellcheck="false"><kbd>⌘K</kbd></label>
          <div class="scroll"></div>
        </nav>
        <div class="pop menu" role="menu" aria-label="This document" hidden></div>
        <div class="pop sharing" role="dialog" aria-label="Share" hidden>
          <h3></h3>
          <p class="lede">A link opens this page and nothing else in your drive.</p>
          <ul class="levels">
            ${SHARE_LEVELS.map(([role, name, says]) => `<li class="level" data-role="${role}">
              <span class="lv-name">${name}</span>
              <span class="lv-acts"><button type="button" class="lv-off" hidden>Turn off</button><button type="button" class="lv-copy">${icon('link')}Copy link</button></span>
              <span class="lv-says">${says}</span>
              <input class="lv-url" readonly aria-label="${name} link" hidden>
            </li>`).join('')}
          </ul>
          <div class="own">
            <span class="lv-name">Your link</span>
            <button type="button" class="copy">Copy</button>
            <span class="lv-says">Asks for your drive’s passphrase.</span>
          </div>
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
      // A pointer that can hover is what reaching for a side is for; on a
      // touch screen every side simply stays pinned.
      this.fine = matchMedia('(hover: hover) and (pointer: fine)');
      this.shown = { nav: false, chat: false };
      this.quiet = { nav: false, chat: false };
      this.intro = false;
      this.pointer = null;
      this.hideTimers = {};
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)');

      // Each side is pinned or on hover. Until one is chosen, it follows what
      // this browser had before there was a choice per side: Float was both
      // on hover, and a side put away was one out of the way.
      const float = stored('mode', 'fit') === 'float';
      this.state = {
        open: stored('open', '0') === '1',
        pinNav: stored('pinNav', float || stored('nav', '1') === '0' ? '0' : '1') === '1',
        pinChat: stored('pinChat', float || stored('chat', '1') === '0' ? '0' : '1') === '1',
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

    /** A side on hover, with a pointer that can reach: it hides until wanted. */
    hovers(side) {
      const pinned = side === 'nav' ? this.state.pinNav : this.state.pinChat;
      return this.state.open && !pinned && this.fine.matches && !this.phone.matches;
    }

    /** Whether a side takes a column of its own: pinned, or on a screen with
     *  no pointer to reach for it with. */
    docked(side) {
      return !this.hovers(side);
    }

    get drawer() {
      return document.querySelector('marble-agent-drawer');
    }

    /** What the drawer and anything else sitting in the page needs to know. */
    get layout() {
      const active = this.state.open && !this.phone.matches;
      const chatDocked = this.docked('chat');
      return {
        open: active,
        // The chat's own: docked beside the page, or a card over it.
        mode: chatDocked ? 'fit' : 'float',
        nav: true,
        chat: true,
        pinNav: this.state.pinNav,
        pinChat: this.state.pinChat,
        top: chatDocked ? BAR : BAR + GAP,
        gap: GAP,
        // How much of the window the tree takes, so the chat's edge knows
        // how far it may be pulled.
        side: active ? this.navWidth + (this.docked('nav') ? 0 : GAP) : 0,
        // On hover the chat is out only while it is reached for; `focusChat`
        // is a one-time ask to put the caret in it, for a reveal somebody
        // asked for rather than one a passing pointer caused.
        chatShown: chatDocked || this.shown.chat,
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
        if (act === 'nav') this.pin('nav', !this.state.pinNav);
        else if (act === 'chat') this.pin('chat', !this.state.pinChat);
        else if (act === 'close') this.setOpen(false);
        else if (act === 'share') this.toggleSharing();
        else if (act === 'describe') dispatchEvent(new CustomEvent('marble-marks:toggle'));
        else if (act === 'doc') this.toggleMenu(event.target.closest('[data-act]'));
      });
      this.sharing.querySelector('.own .copy').addEventListener('click', () => this.copyLink());
      this.sharing.querySelector('.levels').addEventListener('click', (event) => {
        const row = event.target.closest('.level');
        if (!row) return;
        if (event.target.closest('.lv-copy')) this.copyShare(row);
        else if (event.target.closest('.lv-off')) this.turnOff(row, event.target.closest('.lv-off'));
      });
      this.bindMove();
      this.arrive();
      this.menu.addEventListener('click', async (event) => {
        const pick = event.target.closest('[data-pick]')?.dataset.pick;
        const fn = pick === undefined ? null : this.menuFns?.get(pick);
        if (!fn) return;
        this.hidePops();
        try {
          await fn();
        } catch (err) {
          this.say(err?.message || 'That did not work');
        }
      });
      // Up and Down walk an open menu, the way every menu you right-click on
      // a desktop lets you.
      this.menu.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...this.menu.querySelectorAll(':scope > button')];
        if (!buttons.length) return;
        event.preventDefault();
        const at = buttons.indexOf(this.shadowRoot.activeElement);
        const next = event.key === 'Home' ? 0
          : event.key === 'End' ? buttons.length - 1
          : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
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
      this.bindRows();
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
      if (this.onHide) removeEventListener('pagehide', this.onHide);
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
      // Opening onto a side on hover shows it once, so it is plain what and
      // where it is; the first thing done on the page puts it away.
      if (patch.open && !was.open && (this.hovers('nav') || this.hovers('chat'))) this.startIntro();
      this.apply();
    }

    /** Pin a side, or set it on hover. Unpinned, it goes to its edge and
     *  stays there until the hand that unpinned it has left and comes back. */
    pin(side, pinned) {
      const key = side === 'nav' ? 'pinNav' : 'pinChat';
      if (this.state[key] === pinned) return;
      clearTimeout(this.hideTimers[side]);
      this.hideTimers[side] = null;
      this.shown[side] = false;
      this.quiet[side] = !pinned;
      if (!pinned && side === 'nav' && this.nav.contains(this.shadowRoot.activeElement)) this.shadowRoot.activeElement.blur();
      this.set({ [key]: pinned });
    }

    setOpen(open) {
      if (open === this.state.open) return;
      this.set({ open });
      if (open) {
        // Opening onto the chat puts you in its box, and a shell without a
        // chat puts you in the search.
        if (!this.drawer) this.search.focus({ preventScroll: true });
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

    // ------------------------------------------------------------ reaching for a side

    startIntro() {
      this.intro = true;
      this.shown.nav = this.hovers('nav');
      this.shown.chat = this.hovers('chat') && Boolean(this.drawer);
    }

    /** Bring a side out on purpose — ⌘K, the chat button, a conversation
     *  opened — rather than because the pointer passed by. */
    reveal(side, { focus = false } = {}) {
      if (!this.hovers(side)) return;
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
      if (!this.hovers(side)) return;
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
      if (!this.hovers(side)) return false;
      if (side === 'chat' && !this.drawer) return false;
      if (this.intro) return true;
      // A row's menu or dialog is open, something is being carried out of
      // the tree, or a pin is being renamed: the tree stays for it.
      if (side === 'nav' && (this.popRow || this.carrying || this.editing)) return true;
      const focused = side === 'nav'
        ? this.nav.contains(this.shadowRoot.activeElement)
        : document.activeElement === this.drawer;
      if (focused) return true;
      if (side === 'nav' ? this.hasAttribute('data-resizing') : this.rectOf('chat') && this.drawer.shadowRoot.querySelector('.panel')?.dataset.resizing === 'true') return true;
      const p = this.pointer;
      if (!p) return false;
      const atEdge = p.y > BAR && (side === 'nav' ? p.x <= EDGE : p.x >= innerWidth - EDGE);
      // The side's own button in the bar is a reach for it too.
      const b = this.$(`[data-act="${side}"]`).getBoundingClientRect();
      const onButton = b.width > 0 && p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
      let over = false;
      if (this.shown[side]) {
        const r = this.rectOf(side);
        over = Boolean(r && r.width && p.x >= r.left - 16 && p.x <= r.right + 16 && p.y >= r.top - 16 && p.y <= r.bottom + 16);
      }
      const reaching = atEdge || onButton || over;
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
      let changed = false;
      for (const side of ['nav', 'chat']) {
        if (!this.hovers(side)) continue;
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
      const { open } = this.layout;
      const { pinNav, pinChat } = this.state;
      this.toggleAttribute('data-open', open);
      this.dataset.nav = this.docked('nav') ? 'pin' : 'hover';
      this.dataset.chat = this.docked('chat') ? 'pin' : 'hover';
      const navButton = this.$('[data-act="nav"]');
      navButton.setAttribute('aria-pressed', String(pinNav));
      navButton.setAttribute('aria-label', pinNav ? 'Unpin the tree' : 'Pin the tree');
      navButton.title = `${pinNav ? 'Unpin the tree: it waits at the edge' : 'Pin the tree'} (⌘⇧\\)`;
      const chatButton = this.$('[data-act="chat"]');
      chatButton.hidden = !this.drawer;
      chatButton.setAttribute('aria-pressed', String(pinChat));
      chatButton.setAttribute('aria-label', pinChat ? 'Unpin the chat' : 'Pin the chat');
      chatButton.title = `${pinChat ? 'Unpin the chat: it waits at the edge' : 'Pin the chat'} (⌘⇧J)`;
      this.$('[data-act="describe"]').hidden = !document.querySelector('.marble-marks-layer');
      const hoverNav = this.hovers('nav');
      this.toggleAttribute('data-hide-nav', hoverNav && !this.shown.nav);
      this.toggleAttribute('data-hide-chat', this.hovers('chat') && Boolean(this.drawer) && !this.shown.chat);
      this.nav.inert = !open || (hoverNav && !this.shown.nav);
      this.bar.inert = !open;
      this.navWidth = this.clampNav(this.navWidth);
      this.style.setProperty('--nav-w', `${this.navWidth}px`);
      const edge = this.$('.edge');
      edge.setAttribute('aria-valuenow', String(this.navWidth));
      edge.setAttribute('aria-valuemin', String(NAV_MIN));
      edge.setAttribute('aria-valuemax', String(this.clampNav(NAV_MAX)));
      this.dock(open ? { top: BAR, left: this.docked('nav') ? this.navWidth : 0 } : null, { animate: animate && !this.hasAttribute('data-still') });
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

    /** Move or rename a document or a folder: the one you are in, from the
     *  bar, or any row's, from its menu. The host does the moving and makes
     *  the old address forward (server/moves.js), so a link or a tab left on
     *  it still lands, and the Drive's pins follow it. A page bound to an
     *  address that moved opens again at the new one, where you were on it. */
    openMove(subject = null) {
      this.hidePops();
      const dialog = this.moving;
      const path = subject?.path ?? this.here;
      const kind = subject?.kind ?? 'doc';
      this.moveTo = { path, kind, folder: folderOf(path) };
      dialog.querySelector('.name').value = nameOf(path);
      dialog.querySelector('.find').value = '';
      dialog.hidden = false;
      const anchor = subject?.row?.isConnected ? subject.row : this.$('.crumbs .here');
      if (subject?.row?.isConnected) this.holdRow(subject.row);
      if (!this.tree) this.load().then(() => this.drawDests());
      this.drawDests();
      this.place(dialog, anchor, 'left');
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
      const { path: moving, kind } = this.moveTo;
      list.replaceChildren();
      for (const folder of this.folders()) {
        if (query && !folder.path.toLowerCase().includes(query) && !(folder.path === '' && 'drive'.includes(query))) continue;
        // A folder cannot go inside itself.
        if (kind === 'folder' && (folder.path === moving || folder.path.startsWith(`${moving}/`))) continue;
        const b = h('button', 'dest');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.dataset.dest = folder.path;
        b.style.paddingLeft = `${8 + (query ? 0 : folder.depth * 14)}px`;
        b.setAttribute('aria-selected', String(folder.path === this.moveTo.folder));
        b.innerHTML = icon('folder');
        b.append(h('span', '', query && folder.path ? folder.path : folder.name));
        if (folder.path === folderOf(moving)) b.append(h('span', 'here-tag', 'now'));
        list.append(b);
      }
      this.checkMove();
    }

    target() {
      const name = this.moving.querySelector('.name').value.trim();
      return { name, path: [this.moveTo.folder, name].filter(Boolean).join('/') };
    }

    /** Whether something other than `except` already has this address. */
    taken(path, except = null) {
      return path !== except && (this.docs().some((d) => d.path === path) || this.folders().some((f) => f.path && f.path === path));
    }

    checkMove() {
      const { name, path } = this.target();
      const from = this.moveTo.path;
      const note = this.moving.querySelector('.note');
      const ok = this.moving.querySelector('.ok');
      const bad = !name ? (this.moveTo.kind === 'folder' ? 'A folder needs a name.' : 'A document needs a name.')
        : /[\/\\]/.test(name) ? 'A name cannot hold a slash; pick the folder below.'
        : this.taken(path, from) ? `Something called ${name} is already there.`
        : null;
      note.toggleAttribute('data-bad', Boolean(bad));
      note.textContent = bad ?? (path === from ? '' : 'Links to it keep working: the old address sends them here.');
      ok.disabled = Boolean(bad) || path === from;
      ok.textContent = folderOf(path) === folderOf(from) ? 'Rename' : 'Move';
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
      const from = this.moveTo.path;
      if (ok.disabled || path === from) return;
      ok.disabled = true;
      try {
        await this.moveItem(from, path);
      } catch (err) {
        const note = this.moving.querySelector('.note');
        note.setAttribute('data-bad', '');
        note.textContent = err.message || 'The move did not happen.';
        ok.disabled = false;
        return;
      }
      this.hidePops();
    }

    /** The one way anything here moves, from the dialog or a drop. A move
     *  that carries the page you are on (it, or a folder it is in) opens the
     *  page again at its new address; any other says where it went. */
    async moveItem(from, to) {
      const carries = from === this.here || this.here.startsWith(`${from}/`);
      // Whatever is still on its way to the file lands at the old address
      // first; the move carries it.
      if (carries) await window.marble.flush?.();
      await window.marble.drive.move(from, to);
      const renamed = folderOf(to) === folderOf(from);
      if (carries) {
        const next = to + this.here.slice(from.length);
        try {
          sessionStorage.setItem(`${KEY}arrive`, JSON.stringify({ path: next, x: scrollX, y: scrollY, renamed, to }));
        } catch { /* a fresh page at the top is all that is lost */ }
        location.replace(`${window.marble.href(next)}${location.hash}`);
        return;
      }
      // A folder that was open stays open under its new name.
      if (this.unfolded.has(from)) {
        this.unfolded.delete(from);
        this.unfolded.add(to);
        store('unfolded', JSON.stringify([...this.unfolded]));
      }
      this.say(renamed ? `Renamed to ${nameOf(to)}` : `Moved ${nameOf(to)} to ${nameOf(folderOf(to)) || 'Drive'}`);
      this.load();
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
      // What moved may have been a folder this page is in.
      const moved = at.to ?? at.path;
      this.say(at.renamed ? `Renamed to ${nameOf(moved)}` : `Moved to ${nameOf(folderOf(moved)) || 'Drive'}`);
    }

    // ------------------------------------------------------------ the tree's edge

    clampNav(px) {
      const chat = this.drawer?.isOpen ? this.drawer.width ?? 0 : 0;
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
        // One key, one meaning: ⌘J asks in place — a card at the selection,
        // the caret's block or what the pointer is over (agent-callout.js).
        // With nothing to ask about it opens the chat. It never moves the
        // shell; that is ⌘\.
        event.preventDefault();
        event.stopPropagation();
        if (!dispatchEvent(new CustomEvent('marble-callout:summon', { cancelable: true }))) return;
        window.marble?.agent?.open?.();
      } else if (mod && !event.shiftKey && event.key === '\\') {
        // ⌘\ shows and hides the whole drive around the page.
        event.preventDefault();
        event.stopPropagation();
        this.setOpen(!this.state.open);
      } else if (mod && !event.shiftKey && k === 'k') {
        event.preventDefault();
        event.stopPropagation();
        if (!this.state.open) this.set({ open: true });
        this.reveal('nav');
        this.search.focus({ preventScroll: true });
        this.search.select();
      } else if (mod && event.shiftKey && (event.key === '\\' || event.key === '|') && this.state.open) {
        event.preventDefault();
        event.stopPropagation();
        this.pin('nav', !this.state.pinNav);
      } else if (event.key === 'Escape' && (!this.menu.hidden || !this.sharing.hidden || !this.moving.hidden)) {
        event.stopPropagation();
        this.hidePops();
      }
    }

    // Up and Down walk the visible rows; Right and Left unfold and fold.
    walkRows(event) {
      // Alt and the arrows move what is focused (a section, a pin), not focus.
      if (event.altKey) return;
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
      const held = this.popRow;
      this.menu.hidden = true;
      this.sharing.hidden = true;
      this.moving.hidden = true;
      this.$('.crumbs .here')?.setAttribute('aria-expanded', 'false');
      this.$('[data-act="share"]').setAttribute('aria-expanded', 'false');
      this.popRow?.removeAttribute('data-menu');
      this.popRow = null;
      // A tree on hover that stayed out for its menu may go now.
      if (held) this.settle();
    }

    place(pop, anchor, align) {
      const r = anchor.getBoundingClientRect();
      pop.style.top = `${r.bottom + 6}px`;
      if (align === 'right') {
        pop.style.left = '';
        pop.style.right = `${Math.max(8, innerWidth - r.right)}px`;
      } else {
        pop.style.right = '';
        pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
      }
      // Too near the foot of the window, it opens upward instead.
      if (r.bottom + 6 + pop.offsetHeight > innerHeight - 8) pop.style.top = `${Math.max(8, r.top - 6 - pop.offsetHeight)}px`;
    }

    /** Where a right-click was: the menu's corner at the pointer, flipped to
     *  stay on screen. */
    placeAt(pop, x, y) {
      pop.style.right = '';
      const w = pop.offsetWidth;
      const ht = pop.offsetHeight;
      pop.style.left = `${Math.max(8, x + w + 8 > innerWidth ? x - w : x)}px`;
      pop.style.top = `${Math.max(8, y + ht + 8 > innerHeight ? y - ht : y)}px`;
    }

    /** One menu, whatever it is about: each entry is [glyph, label, what it
     *  does, { pick, danger }], and '-' is a rule between groups. An entry is
     *  known by its pick, its glyph's name unless it says otherwise. */
    fillMenu(entries, label) {
      this.menu.replaceChildren();
      this.menu.setAttribute('aria-label', label);
      this.menuFns = new Map();
      for (const entry of entries) {
        if (!entry) continue;
        if (entry === '-') {
          if (this.menu.lastChild && this.menu.lastChild.localName !== 'hr') this.menu.append(h('hr'));
          continue;
        }
        const [glyph, text, fn, { pick = glyph, danger = false } = {}] = entry;
        const b = h('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.dataset.pick = pick;
        if (danger) b.dataset.danger = '';
        b.innerHTML = icon(glyph);
        b.append(h('span', '', text));
        this.menuFns.set(pick, fn);
        this.menu.append(b);
      }
      while (this.menu.lastChild?.localName === 'hr') this.menu.lastChild.remove();
    }

    toggleMenu(anchor) {
      const opening = this.menu.hidden;
      this.hidePops();
      if (!opening) return;
      const drive = window.marble?.drive;
      this.fillMenu([
        ['link', 'Copy link', () => this.copyLink()],
        drive?.move && ['move', 'Move or rename…', () => this.openMove()],
        ['open', 'Show in Drive', () => { location.href = this.folderHref(folderOf(this.here)); }, { pick: 'drive' }],
        drive?.downloadHref && ['download', 'Download', () => { location.href = drive.downloadHref(this.here); }],
      ], 'This document');
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
      this.drawShares(null);
      this.sharing.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      this.place(this.sharing, button, 'right');
      this.sharing.querySelector('.lv-copy')?.focus({ preventScroll: true });
      this.loadShares();
    }

    // ------------------------------------------------------------ share links

    async loadShares() {
      const shares = window.marble?.drive?.shares;
      if (!shares || !this.here) return;
      const asked = (this.sharesAsked ?? 0) + 1;
      this.sharesAsked = asked;
      try {
        const answer = await shares.list(this.here);
        if (asked === this.sharesAsked) this.drawShares(answer);
      } catch {
        // The rows still make links; they just do not know which are on.
      }
    }

    /** The rows as the drive says they are: a level with a link on shows its
     *  address and a way to turn it off. `null` while that is not known. */
    drawShares(answer) {
      const lede = this.sharing.querySelector('.lede');
      const open = Boolean(answer?.open);
      lede.toggleAttribute('data-open', open);
      lede.textContent = open
        ? 'This drive has no passphrase, so anyone who can reach it can already change everything.'
        : 'A link opens this page and nothing else in your drive.';
      this.shareLinks = new Map((answer?.links ?? []).map((link) => [link.role, link]));
      for (const row of this.sharing.querySelectorAll('.level')) this.drawShareRow(row);
    }

    drawShareRow(row) {
      const link = this.shareLinks?.get(row.dataset.role);
      const off = row.querySelector('.lv-off');
      const url = row.querySelector('.lv-url');
      off.hidden = !link;
      off.removeAttribute('data-sure');
      off.textContent = 'Turn off';
      url.hidden = !link;
      url.value = link ? new URL(link.href, location.href).href : '';
    }

    /** Copy this level's link, making it if there is none. The clipboard is
     *  handed a promise inside the press, because Safari will not take text
     *  that arrives after a request has gone out and come back. */
    async copyShare(row) {
      const role = row.dataset.role;
      const shares = window.marble?.drive?.shares;
      if (!shares || !this.here) return;
      const button = row.querySelector('.lv-copy');
      button.disabled = true;
      const making = this.shareLinks?.get(role)
        ? Promise.resolve(this.shareLinks.get(role))
        : shares.make(this.here, role).then((answer) => answer.link);
      const href = making.then((link) => new URL(link.href, location.href).href);
      let copied = false;
      try {
        if (window.ClipboardItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': href.then((text) => new Blob([text], { type: 'text/plain' })) })]);
        } else {
          await navigator.clipboard.writeText(await href);
        }
        copied = true;
      } catch {
        copied = await href.then((text) => navigator.clipboard.writeText(text)).then(() => true, () => false);
      }
      try {
        const link = await making;
        this.shareLinks?.set(role, link);
        this.drawShareRow(row);
        this.say(copied ? `${LEVEL_NAME[role]} link copied` : 'Could not copy the link');
        if (!copied) row.querySelector('.lv-url').select();
      } catch (err) {
        this.say(err?.message ? `No link: ${err.message}` : 'Could not make the link');
      } finally {
        button.disabled = false;
      }
    }

    /** Two presses: the first asks, the second turns the link off for
     *  everyone who has it. Whoever had it is out on their next request, and
     *  an open page stops hearing changes at once. */
    async turnOff(row, button) {
      const link = this.shareLinks?.get(row.dataset.role);
      if (!link) return;
      if (!button.hasAttribute('data-sure')) {
        button.setAttribute('data-sure', '');
        button.textContent = 'Yes, turn off';
        clearTimeout(this.sureTimer);
        this.sureTimer = setTimeout(() => this.drawShareRow(row), 4000);
        return;
      }
      clearTimeout(this.sureTimer);
      button.disabled = true;
      try {
        await window.marble.drive.shares.off(link.id);
        this.shareLinks.delete(row.dataset.role);
        this.say(`${LEVEL_NAME[row.dataset.role]} link turned off`);
      } catch {
        this.say('Could not turn the link off');
      } finally {
        button.disabled = false;
        this.drawShareRow(row);
      }
    }

    async copyLink() {
      try {
        await navigator.clipboard.writeText(this.link());
        this.say('Link copied');
      } catch {
        this.say('Could not copy the link');
      }
    }

    say(text, ms = 1600) {
      const toast = this.$('.toast');
      toast.textContent = text;
      toast.setAttribute('data-on', '');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => toast.removeAttribute('data-on'), ms);
    }

    // ------------------------------------------------------------ the tree

    /** Read on first open, not on every page: most visits never open it.
     *  Every page is a new page, so the sidebar is drawn at once from how the
     *  last one left it (`restore`), and then from what the drive says now. */
    async load() {
      const drive = window.marble?.drive;
      if (!drive) return;
      if (!this.tree) this.restore();
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
      // Leaving is when the conversations are newest: the stream has been
      // talking since the tree was last kept.
      if (!this.onHide) addEventListener('pagehide', this.onHide = () => this.remember());
      this.watchAgents();
      const asked = (this.asked ?? 0) + 1;
      this.asked = asked;
      // Folders and documents only: the sidebar draws nothing else, and in a
      // drive with a dataset in it the files are most of the answer. The
      // drive's realms — which top-level folders wear which colour
      // (server/drive-settings.js) — once a page, beside it.
      const [tree] = await Promise.all([
        drive.tree('', { files: false }),
        this.realmsRead ? null : (drive.settings?.() ?? Promise.resolve(null)).then(
          (settings) => { this.realms = settings?.realms ?? {}; this.realmsRead = true; },
          () => { this.realms ??= {}; },
        ),
      ]);
      if (asked !== this.asked) return;
      // A drive always holds at least its own Drive page, so a tree with
      // nothing in it is the host not answering: keep what is drawn.
      if (!tree?.children?.length && this.tree) return;
      // The Drive's file moving is the one thing that can move the pins or a
      // folder's tint; its stamp in the tree says whether it has, without
      // reading the file.
      const stamp = stampOf(tree, HOME_DOC);
      if (!this.pins || this.pinsStale || stamp !== this.pinsStamp) await this.loadPins(stamp);
      if (asked !== this.asked) return;
      // Most of the time nothing moved since the last page: then what the
      // restore drew stands, and the row under the pointer is not rebuilt.
      const said = JSON.stringify(tree);
      const pinsSaid = JSON.stringify([this.pins, this.tints, this.realms]);
      const same = said === this.treeSaid && pinsSaid === this.pinsSaid;
      this.tree = tree;
      this.byPath = new Map(this.docs().map((d) => [d.path, d]));
      this.treeSaid = said;
      this.pinsSaid = pinsSaid;
      if (same) return;
      this.drawTree();
      this.remember();
    }

    /** Pinned is the Drive's sidebar list, read out of the Drive's own file —
     *  the one place a pin is kept — rather than a second list kept here. */
    async loadPins(stamp = null) {
      this.pinsStale = false;
      if (!HOME_DOC || !window.marble?.href) { this.pins = []; return; }
      try {
        this.readPins(await this.homeDoc({ file: true }));
        this.pinsStamp = stamp;
      } catch {
        // Unread is not empty: the pins and tints already drawn stay, and the
        // next tree asks again.
        this.pins ??= [];
        this.tints ??= [];
        this.pinsStamp = null;
      }
    }

    readPins(doc) {
      this.pins = [...doc.querySelectorAll('#pins > .pin[data-path]')].map((li) => {
        const label = [...li.querySelectorAll('[data-marble-editable]')].at(-1);
        return {
          path: li.dataset.path,
          kind: li.dataset.kind === 'folder' ? 'folder' : 'doc',
          label: label?.textContent.trim() || nameOf(li.dataset.path),
        };
      });
      // A colour somebody gave a folder on the Drive, kept in the same file
      // beside the pins; the longest path that holds a row wins.
      this.tints = [...doc.querySelectorAll('#folder-tints > [data-path][data-tint]')]
        .map((li) => ({ path: li.dataset.path, hex: tidyHex(li.dataset.tint) }))
        .filter((t) => t.path && t.hex)
        .sort((a, b) => b.path.length - a.path.length);
    }

    /** The Drive's document: this page, when you are on the Drive (only
     *  what is drawn is current there), else its file as it is now. */
    async homeDoc({ file = false } = {}) {
      if (!file && HOME_DOC === this.here) return document;
      const res = await fetch(window.marble.href(HOME_DOC), { cache: 'no-store' });
      if (!res.ok) throw new Error(`The Drive did not open (${res.status})`);
      return new DOMParser().parseFromString(await res.text(), 'text/html');
    }

    pinned(path) {
      return this.pins?.find((p) => p.path === path) ?? null;
    }

    // ------------------------------------------------------------ pinning
    //
    // A pin is markup in the Drive's own file (templates/drive.mrbl, #pins),
    // so pinning from here files the same ops the Drive files: an insert, a
    // remove, a move, a label's text. Each is built against the file as it is
    // at that moment, by its ids, so it lands on the pin it means even if the
    // Drive is open somewhere else; that tab hears it like any other edit.
    // On the Drive itself the page files it, so ⌘Z takes it back there.

    async editPins(build) {
      if (!HOME_DOC || !window.marble?.href) throw new Error('This drive has no Drive page to pin to');
      const doc = await this.homeDoc();
      const list = doc.querySelector('#pins');
      const listId = list?.getAttribute('data-marble-id');
      if (!listId) throw new Error('The Drive page has no Pinned list');
      const pins = [...list.querySelectorAll(':scope > .pin[data-path]')];
      const idOf = (el) => el?.getAttribute('data-marble-id') ?? null;
      const ops = build({ doc, listId, pins, idOf, find: (path) => pins.find((li) => li.dataset.path === path) ?? null });
      if (!ops?.length) return false;
      const m = window.marble;
      if (HOME_DOC === this.here && m?.apply && m?.op) {
        const undo = [];
        for (const op of ops) {
          const inverse = m.invert?.(op);
          m.apply(op);
          if (inverse) undo.unshift(inverse);
        }
        m.record?.({ redo: ops, undo });
        for (const op of ops) m.op(op, { immediate: true });
        this.readPins(document);
      } else {
        const res = await fetch(`/ops?app=${encodeURIComponent(HOME_DOC)}&client=shell-${CLIENT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ops),
        });
        if (!res.ok) {
          const why = await res.json().catch(() => ({}));
          throw new Error(why.error || `The Drive did not take the change (${res.status})`);
        }
        this.readPins(await this.homeDoc({ file: true }));
      }
      // The Drive's file changed under the stamp the tree last saw.
      this.pinsStamp = null;
      this.pinsSaid = JSON.stringify([this.pins, this.tints, this.realms]);
      this.redraw('pinned');
      this.remember();
      return true;
    }

    /** Pin a document or folder, before the pin at `before` (last if none).
     *  One already pinned is moved there instead. */
    pinPath(path, kind, before = null) {
      return this.editPins(({ doc, listId, pins, find, idOf }) => {
        const at = before ? idOf(find(before)) : null;
        const already = find(path);
        if (already) {
          // Already where it was asked to go: nothing to file.
          if (before === path || idOf(pins[pins.indexOf(already) + 1]) === at) return [];
          return [{ type: 'move', id: idOf(already), parentId: listId, beforeId: at }];
        }
        const taken = new Set([...doc.querySelectorAll('[data-marble-id]')].map(idOf));
        const fresh = () => {
          let id;
          do id = Math.random().toString(36).slice(2, 10);
          while (taken.has(id));
          taken.add(id);
          return id;
        };
        const html = `<li class="pin" data-marble-id="${fresh()}" data-path="${escapeHtml(path)}" data-kind="${kind === 'folder' ? 'folder' : 'doc'}" data-marble-removable>`
          + `<span class="ico" data-marble-id="${fresh()}">${PIN_GLYPH[kind === 'folder' ? 'folder' : 'doc']}</span>`
          + `<span data-marble-id="${fresh()}" data-marble-editable>${escapeHtml(nameOf(path))}</span></li>`;
        return [{ type: 'insert', html, parentId: listId, beforeId: at }];
      });
    }

    unpin(path) {
      return this.editPins(({ find, idOf }) => {
        const li = find(path);
        return li ? [{ type: 'remove', id: idOf(li) }] : [];
      });
    }

    relabelPin(path, label) {
      return this.editPins(({ find, idOf }) => {
        const span = [...(find(path)?.querySelectorAll('[data-marble-editable]') ?? [])].at(-1);
        return span && span.textContent.trim() !== label ? [{ type: 'setText', id: idOf(span), text: label }] : [];
      });
    }

    async togglePin(subject) {
      const { path, kind } = subject;
      if (this.pinned(path)) {
        if (await this.unpin(path)) this.say(`Unpinned ${this.label(subject)}`);
      } else if (await this.pinPath(path, kind)) {
        this.say(`Pinned ${nameOf(path)}`);
      }
    }

    /** The colour a row wears: its folder's tint if somebody gave it one on
     *  the Drive, else its realm's; a document takes the folder it is in. */
    wear(el, path, kind) {
      const folder = kind === 'folder' ? path : folderOf(path);
      if (!folder) return;
      const tint = this.tints?.find((t) => folder === t.path || folder.startsWith(`${t.path}/`));
      if (tint) {
        el.dataset.tinted = '';
        el.style.setProperty('--tint', tint.hex);
        return;
      }
      const realm = this.realms?.[splitPath(folder)[0]];
      if (REALMS[realm]) el.dataset.realm = realm;
    }

    /** A row's glyph: the document's own favicon when it has one, else the
     *  folder or the document, in the row's colour. */
    glyph(el, path, kind) {
      const own = kind === 'doc' ? this.byPath?.get(path)?.icon : null;
      if (own) {
        const img = h('img', 'i');
        img.src = own;
        img.alt = '';
        img.decoding = 'async';
        el.prepend(img);
      } else {
        el.insertAdjacentHTML('afterbegin', icon(kind === 'folder' ? 'folder' : 'doc'));
        this.wear(el, path, kind);
      }
    }

    /** The sidebar as this page leaves it, for the next page to draw before it
     *  has asked anybody anything. The conversations keep only what a row and
     *  its pips are drawn from. */
    remember() {
      if (!this.tree) return;
      const convs = [...this.convs.values()].filter((c) => !c.archived && c.target).map((c) => {
        const slim = {};
        for (const k of CONV_KEEP) if (c[k] !== undefined) slim[k] = c[k];
        return slim;
      });
      const saved = JSON.stringify({ v: 1, tree: this.tree, pins: this.pins ?? null, pinsStamp: this.pinsStamp ?? null, tints: this.tints ?? null, realms: this.realms ?? null, convs });
      if (saved.length > LAST_MAX) return;
      try { localStorage.setItem(LAST, saved); } catch { /* full, or private: the next page asks, as it always did */ }
    }

    /** Draws what the last page left, if it left anything. What the drive says
     *  replaces it a moment later; until then this is at worst a few seconds
     *  old, which is better than a blank panel. */
    restore() {
      let last = null;
      try { last = JSON.parse(localStorage.getItem(LAST) ?? 'null'); } catch { /* unreadable: nothing */ }
      if (last?.v !== 1 || !last.tree?.children?.length) return;
      this.tree = last.tree;
      this.byPath = new Map(this.docs().map((d) => [d.path, d]));
      this.treeSaid = JSON.stringify(last.tree);
      // The colours come with it, so a row is not drawn grey and then tinted.
      if (last.realms) this.realms = last.realms;
      if (last.pins) {
        this.pins = last.pins;
        this.pinsStamp = last.pinsStamp;
        this.tints = last.tints ?? [];
        this.pinsSaid = JSON.stringify([this.pins, this.tints, this.realms]);
      }
      this.restored = new Set();
      for (const c of last.convs ?? []) {
        if (!c?.id || this.convs.has(c.id)) continue;
        this.convs.set(c.id, c);
        this.restored.add(c.id);
      }
      this.drawTree();
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
        // What the last page left is replaced by the list, and one the list no
        // longer has (deleted since) goes.
        const listed = new Set(list.map((summary) => summary.id));
        for (const id of this.restored ?? []) if (!listed.has(id) && !heard.has(id)) this.convs.delete(id);
        this.restored = null;
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
        dispatchEvent(new CustomEvent('marble:agent-open', { detail: { id: c.id } }));
        return;
      }
      // The drawer on the next page picks the conversation up from the hash
      // and opens with it, the way the Drive hands one over.
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
        go.append(h('span', 'name', nameOf(app.path)));
        this.glyph(go, app.path, 'doc');
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
      a.dataset.path = entry.path;
      a.append(h('span', '', entry.name));
      this.glyph(a, entry.path, 'doc');
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
          b.append(h('span', '', child.name));
          this.glyph(b, child.path, 'folder');
          b.insertAdjacentHTML('afterbegin', `<svg class="i car" viewBox="0 0 16 16" aria-hidden="true">${PATHS.chev}</svg>`);
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
        // With somewhere to pin to, Pinned is there even empty: it is where a
        // row is dragged to pin it, and a drop zone that only appeared for a
        // drag would move the whole tree the moment you lifted something.
        if (!this.pins?.length && !(HOME_DOC && window.marble?.drive)) return null;
        const ul = h('ul', 'pins');
        for (const pin of this.pins ?? []) {
          const a = h('a', 'row');
          a.href = pin.kind === 'folder' ? this.folderHref(pin.path) : window.marble?.href?.(pin.path) ?? '#';
          a.dataset.path = pin.path;
          a.dataset.kind = pin.kind;
          a.dataset.pin = '';
          a.append(h('span', '', pin.label));
          this.glyph(a, pin.path, pin.kind);
          a.title = pin.path;
          // A pin is something you chose by name: the name is the row, and
          // where it lives is the tooltip's (the path, above).
          if (pin.path === this.here) a.setAttribute('aria-current', 'page');
          ul.append(this.item(a));
        }
        if (!this.pins?.length) ul.append(h('li', 'empty', 'Drag a page or folder here to pin it.'));
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
      if (this.dragging || this.editing) { this.dirty = true; return; }
      const old = this.scroll.querySelector(`:scope > .sec[data-sec="${name}"]`);
      if (!old) { this.drawTree(); return; }
      const next = this.build(name);
      if (next) old.replaceWith(next);
      else old.remove();
    }

    drawTree() {
      if (!this.tree) return;
      if (this.dragging || this.editing) { this.dirty = true; return; }
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

    // ------------------------------------------------------------ a row's menu
    //
    // Right-click a row (or hold a finger on it, or press the menu key on it)
    // and it offers what you would do with that page or folder: open it,
    // pin it, rename or move it, copy it, throw it away. The same verbs the
    // Drive's own menu has, so a thing is not done one way there and another
    // here, and each goes through the same host verb (runtime/drive.js).

    /** What a row is about: a path, a kind, and the row itself. A pin is
     *  about its pin; an agent's row about its document. */
    subjectOf(row) {
      if (!row || !this.scroll.contains(row) || row.classList.contains('thread')) return null;
      if (row.dataset.pin !== undefined) {
        const pin = this.pinned(row.dataset.path);
        return pin ? { path: pin.path, kind: pin.kind, pin, row } : null;
      }
      if (row.dataset.folder !== undefined) return { path: row.dataset.folder, kind: 'folder', row };
      if (row.dataset.app) return { path: row.dataset.app, kind: 'doc', row };
      if (row.dataset.path) return { path: row.dataset.path, kind: 'doc', row };
      return null;
    }

    label(subject) {
      return subject.pin?.label || nameOf(subject.path) || 'Drive';
    }

    hrefOf({ path, kind }) {
      return kind === 'folder' ? this.folderHref(path) : window.marble?.href?.(path) ?? '#';
    }

    /** The row keeps its hover for as long as its menu or dialog is open. */
    holdRow(row) {
      this.popRow?.removeAttribute('data-menu');
      this.popRow = row;
      row.setAttribute('data-menu', '');
    }

    rowMenu(subject, at) {
      const drive = window.marble?.drive;
      const { path, kind, pin } = subject;
      const folder = kind === 'folder';
      const pinnable = Boolean(HOME_DOC && window.marble?.drive);
      const pinnedNow = this.pinned(path);
      const open = (href) => () => { location.href = href; };
      // Publish is offered on a folder once the host has said it is a
      // repository. Asked the first time its menu opens, and the menu is
      // filled again with the answer if it is still open.
      this.repos ??= new Map();
      const publishable = GIT && folder && drive?.git;
      const publish = publishable && this.repos.get(path) === true
        && ['share', 'Publish', () => this.publish(path), { pick: 'publish' }];
      const entries = pin
        ? [
          // A pin is a shortcut: what it offers is the shortcut's, and the
          // page or folder it points at keeps its own menu in the tree.
          folder ? ['open', 'Open in Drive', open(this.folderHref(path))] : ['open', 'Show in Drive', open(this.folderHref(folderOf(path)))],
          ['tab', 'Open in new tab', () => window.open(this.hrefOf(subject), '_blank')],
          '-',
          ['edit', 'Rename pin', () => this.renamePin(subject), { pick: 'rename' }],
          ['link', 'Copy link', () => this.copyText(new URL(this.hrefOf(subject), location.href).href, 'Link copied')],
          ['path', 'Copy path', () => this.copyText(path, 'Path copied')],
          '-',
          publish,
          ['pin', 'Unpin', () => this.togglePin(subject)],
        ]
        : [
          folder ? ['open', 'Open in Drive', open(this.folderHref(path))] : ['open', 'Show in Drive', open(this.folderHref(folderOf(path)))],
          ['tab', 'Open in new tab', () => window.open(this.hrefOf(subject), '_blank')],
          '-',
          pinnable && ['pin', pinnedNow ? 'Unpin' : 'Pin', () => this.togglePin(subject)],
          drive?.move && ['edit', 'Rename or move…', () => this.openMove(subject), { pick: 'move' }],
          !folder && drive?.create && ['copy', 'Make a copy', () => this.copyDoc(path)],
          '-',
          ['link', 'Copy link', () => this.copyText(new URL(this.hrefOf(subject), location.href).href, 'Link copied')],
          ['path', 'Copy path', () => this.copyText(path, 'Path copied')],
          !folder && drive?.downloadHref && ['download', 'Download', () => { location.href = drive.downloadHref(path); }],
          '-',
          publish,
          '-',
          drive?.remove && ['trash', 'Move to trash', () => this.trash(subject), { danger: true }],
        ];
      this.hidePops();
      this.fillMenu(entries, this.label(subject));
      this.menu.hidden = false;
      this.holdRow(subject.row);
      if (at) this.placeAt(this.menu, at.x, at.y);
      else this.place(this.menu, subject.row, 'left');
      this.menu.querySelector('button')?.focus({ preventScroll: true });
      if (publishable && !this.repos.has(path)) {
        drive.git.status(path).then((answer) => {
          this.repos.set(path, answer.repo === true);
          if (answer.repo && !this.menu.hidden && this.popRow === subject.row) this.rowMenu(subject, at);
        }, () => {});
      }
    }

    /** Commit and push a folder that is its own repository (server/git.js).
     *  The page this is on may still have edits on their way to disk, and the
     *  commit has to have them, so they are sent first. A refusal stays up
     *  long enough to read, because it says what to do next. */
    async publish(path) {
      this.say('Publishing…', 60_000);
      try {
        await window.marble.flush?.();
        const done = await window.marble.drive.git.publish(path);
        const count = done.files.length;
        this.say(done.nothing
          ? 'Nothing to publish'
          : count ? `Published ${count} ${count === 1 ? 'file' : 'files'} to ${done.branch}` : `Published to ${done.branch}`, 3000);
      } catch (err) {
        this.say(err?.message || 'Could not publish', 8000);
      }
    }

    async copyText(text, said) {
      try {
        await navigator.clipboard.writeText(text);
        this.say(said);
      } catch {
        this.say('Could not copy');
      }
    }

    /** A copy beside the original, named the way the Drive names one. */
    async copyDoc(path) {
      let to = `${path} copy`;
      for (let n = 2; this.taken(to); n += 1) to = `${path} copy ${n}`;
      await window.marble.drive.create({ path: to, copy: path });
      this.say(`Made ${nameOf(to)}`);
      this.load();
    }

    /** To the trash, from where the Drive's Trash brings it back. Throwing
     *  away the page you are on (or a folder it is in) takes you to the
     *  folder it was in. */
    async trash(subject) {
      const { path } = subject;
      const carries = path === this.here || this.here.startsWith(`${path}/`);
      if (carries) await window.marble.flush?.();
      await window.marble.drive.remove(path);
      if (carries) {
        location.href = this.folderHref(folderOf(path));
        return;
      }
      this.say(`Moved ${nameOf(path)} to trash`);
      this.load();
    }

    /** A pin's name, typed over in place: Enter or leaving keeps it, Escape
     *  puts it back. Only the pin's label changes; the page keeps its name. */
    renamePin(subject) {
      const row = subject.row?.isConnected ? subject.row : this.scroll.querySelector(`.row[data-pin][data-path="${CSS.escape(subject.path)}"]`);
      const span = row?.querySelector(':scope > span:not(.where)');
      if (!span) return;
      const was = subject.pin.label;
      const input = h('input', 'rename');
      input.value = was;
      input.setAttribute('aria-label', 'Name of the pin');
      input.spellcheck = false;
      this.editing = true;
      span.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = async (keep) => {
        if (done) return;
        done = true;
        const label = input.value.trim().replace(/\s+/g, ' ');
        this.editing = false;
        if (keep && label && label !== was) span.textContent = label;
        input.replaceWith(span);
        row.focus({ preventScroll: true });
        this.settle();
        try {
          if (keep && label && label !== was) await this.relabelPin(subject.path, label);
        } catch (err) {
          span.textContent = was;
          this.say(err?.message || 'The pin kept its name');
        }
        if (this.dirty) { this.dirty = false; this.drawTree(); }
      };
      // Inside a link: a press in the box places the caret, it does not open.
      input.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
    }

    bindRows() {
      this.scroll.addEventListener('contextmenu', (event) => {
        if (event.target.closest('input')) return;
        const subject = this.subjectOf(event.target.closest('.row'));
        if (!subject) return;
        event.preventDefault();
        this.rowMenu(subject, { x: event.clientX, y: event.clientY });
      });

      // A held finger opens the menu: a phone has no right button, and iOS
      // fires no contextmenu at all. The press that opened it opens nothing.
      let press = null;
      const unpress = () => { clearTimeout(press?.timer); press = null; };
      this.scroll.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') return;
        const subject = this.subjectOf(event.target.closest('.row'));
        if (!subject) return;
        unpress();
        press = {
          x: event.clientX,
          y: event.clientY,
          timer: setTimeout(() => {
            press = null;
            this.swallowClick = true;
            this.rowMenu(subject, { x: event.clientX, y: event.clientY });
          }, PRESS),
        };
      });
      this.scroll.addEventListener('pointermove', (event) => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) unpress();
      });
      for (const type of ['pointerup', 'pointercancel', 'scroll']) this.scroll.addEventListener(type, unpress, { passive: true });
      // A drag or a held finger ends in a click on whatever it let go over;
      // that click is the gesture's, not a press of the row.
      this.scroll.addEventListener('click', (event) => {
        if (!this.swallowClick) return;
        this.swallowClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);

      this.scroll.addEventListener('keydown', (event) => {
        const row = event.target.closest?.('.row, .go');
        const subject = this.subjectOf(row?.classList.contains('go') ? row.closest('.row') : row);
        if (!subject) return;
        // The menu key, or Shift+F10: the menu, under the row.
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          this.rowMenu(subject, null);
          return;
        }
        // Alt and the arrows move a pin up and down Pinned, the way they move
        // a section by its grip.
        if (subject.pin && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          const paths = this.pins.map((p) => p.path);
          const at = paths.indexOf(subject.path);
          const to = at + (event.key === 'ArrowUp' ? -1 : 1);
          if (to < 0 || to >= paths.length) return;
          const before = event.key === 'ArrowUp' ? paths[to] : paths[to + 1] ?? null;
          this.pinPath(subject.path, subject.kind, before)
            .then(() => this.scroll.querySelector(`.row[data-pin][data-path="${CSS.escape(subject.path)}"]`)?.focus({ preventScroll: true }))
            .catch((err) => this.say(err?.message || 'The pin stayed where it was'));
        }
      });

      this.bindCarry();
    }

    // ------------------------------------------------------------ carrying a row
    //
    // Press a row and move, and you are carrying it. Into Pinned, it pins
    // there, and a pin carried up or down Pinned moves; onto a folder in the
    // tree, it moves into that folder, and onto the Drive heading, to the top.
    // Pointer events rather than drag and drop, like the Drive's own drags:
    // the drag image is a picture, and what you hold should be the row.
    // A finger keeps the list's scroll; its hold opens the menu instead.

    bindCarry() {
      // An <a> would start the browser's own drag of its address.
      this.scroll.addEventListener('dragstart', (event) => event.preventDefault());
      this.scroll.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.pointerType === 'touch' || this.carrying) return;
        if (event.target.closest('.sec-grip, .fold, input')) return;
        const subject = this.subjectOf(event.target.closest('.row'));
        if (!subject) return;
        const start = { x: event.clientX, y: event.clientY };
        let held = null;
        const move = (ev) => {
          if (!held) {
            if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
            held = this.lift(subject, start);
          }
          this.carry(held, ev);
        };
        const end = (ev) => {
          removeEventListener('pointermove', move, true);
          removeEventListener('pointerup', end, true);
          removeEventListener('pointercancel', end, true);
          removeEventListener('keydown', esc, true);
          if (held) this.drop(held, ev?.type !== 'pointerup');
        };
        const esc = (ev) => {
          if (ev.key !== 'Escape' || !held) return;
          ev.preventDefault();
          ev.stopPropagation();
          end(null);
        };
        addEventListener('pointermove', move, true);
        addEventListener('pointerup', end, true);
        addEventListener('pointercancel', end, true);
        addEventListener('keydown', esc, true);
      });
    }

    lift(subject, start) {
      this.hidePops();
      const row = subject.row;
      const ghost = h('div', 'ghost');
      ghost.innerHTML = icon(subject.kind === 'folder' ? 'folder' : 'doc');
      ghost.append(h('span', '', this.label(subject)));
      this.shadowRoot.append(ghost);
      const held = {
        subject,
        ghost,
        slot: null,
        target: null,
        // A pin carried along Pinned is its own slot, and goes back if it
        // is let go of anywhere else.
        home: subject.pin ? { li: row.closest('li'), next: row.closest('li').nextElementSibling } : null,
        x: start.x,
        y: start.y,
      };
      row.setAttribute('data-carried', '');
      this.carrying = held;
      this.dragging = true;
      this.setAttribute('data-carrying', '');
      getSelection()?.removeAllRanges();
      const style = document.createElement('style');
      style.id = 'marble-shell-carrying';
      style.setAttribute('data-marble-transient', '');
      style.textContent = 'html, html * { cursor: grabbing !important; user-select: none !important; }';
      document.getElementById(style.id)?.remove();
      document.head.append(style);
      this.scrollLoop(held);
      return held;
    }

    /** The list scrolls itself while a carried row is held near its top or
     *  foot, so Pinned is in reach from anywhere in a long tree. */
    scrollLoop(held) {
      const step = () => {
        if (this.carrying !== held) return;
        const r = this.scroll.getBoundingClientRect();
        const near = 36;
        const dy = held.y < r.top + near ? -Math.ceil((r.top + near - held.y) / 4)
          : held.y > r.bottom - near ? Math.ceil((held.y - (r.bottom - near)) / 4)
          : 0;
        if (dy && held.x >= r.left && held.x <= r.right) {
          this.scroll.scrollTop += dy;
          this.aim(held);
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    carry(held, event) {
      held.x = event.clientX;
      held.y = event.clientY;
      // One to one, and no transition: it is where the hand is, just below
      // and beside the pointer, so the row it would land on stays readable.
      held.ghost.style.transform = `translate(${held.x + 14}px, ${held.y + 12}px) scale(1.02)`;
      this.aim(held);
    }

    /** What the carried row would land in, if let go here. */
    aim(held) {
      const { subject } = held;
      const el = this.shadowRoot.elementFromPoint(held.x, held.y);
      const inNav = el && this.nav.contains(el);
      const pinsSec = inNav ? el.closest('.sec[data-sec="pinned"]') : null;
      let target = null;
      if (pinsSec && !pinsSec.hasAttribute('data-folded') && HOME_DOC) {
        target = { type: 'pin', before: this.openRoom(held, pinsSec.querySelector(':scope > ul')) };
      } else {
        this.closeRoom(held);
        const folderRow = inNav ? el.closest('.sec[data-sec="drive"] button.row[data-folder]') : null;
        const driveHead = inNav ? el.closest('.sec[data-sec="drive"] > .sec-h') : null;
        const into = folderRow ? folderRow.dataset.folder : driveHead ? '' : null;
        const fits = into !== null && into !== folderOf(subject.path) && !subject.pin
          && !(subject.kind === 'folder' && (into === subject.path || into.startsWith(`${subject.path}/`)));
        if (fits) target = { type: 'move', folder: into, el: folderRow ?? driveHead };
      }
      if (held.target?.el !== target?.el) {
        held.target?.el?.removeAttribute('data-drop');
        target?.el?.setAttribute('data-drop', '');
      }
      held.target = target;
    }

    /** The room opens in Pinned where the carried row would go: a slot in
     *  the list, the others sliding to make it. Answers the pin it would go
     *  before, or null for last. */
    openRoom(held, ul) {
      let slot = held.slot;
      if (!slot) {
        if (held.home) {
          slot = held.home.li;
        } else {
          slot = h('li', 'slot');
          const row = h('div', 'row');
          row.innerHTML = icon(held.subject.kind === 'folder' ? 'folder' : 'doc');
          row.append(h('span', '', nameOf(held.subject.path)));
          slot.append(row);
        }
        held.slot = slot;
      }
      const pins = [...ul.querySelectorAll(':scope > li:not(.empty)')].filter((li) => li !== slot);
      const next = pins.find((li) => {
        const r = li.getBoundingClientRect();
        return held.y < r.top + r.height / 2;
      }) ?? null;
      const before = next ?? ul.querySelector(':scope > li.empty');
      if (slot.parentNode !== ul || slot.nextElementSibling !== before) this.slide(ul, () => ul.insertBefore(slot, before));
      return next?.querySelector('.row')?.dataset.path ?? null;
    }

    closeRoom(held) {
      const slot = held.slot;
      if (!slot) return;
      held.slot = null;
      if (held.home) {
        // A pin goes back to where it was in the list.
        const { li, next } = held.home;
        if (li.nextElementSibling !== next) this.slide(li.parentNode, () => li.parentNode.insertBefore(li, next?.isConnected ? next : null));
      } else if (slot.isConnected) {
        const ul = slot.parentNode;
        this.slide(ul, () => slot.remove());
      }
    }

    /** Moves rows in a list and lets the others slide to their new places
     *  (FLIP), as the sections do. */
    slide(ul, change) {
      const rows = [...ul.children];
      const before = new Map(rows.map((el) => [el, el.getBoundingClientRect().top]));
      change();
      if (this.reduced.matches) return;
      for (const el of rows) {
        if (!el.isConnected || el.classList.contains('slot')) continue;
        const dy = before.get(el) - el.getBoundingClientRect().top;
        if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 180, easing: EASE });
      }
    }

    async drop(held, cancelled) {
      const { subject, ghost } = held;
      const target = cancelled ? null : held.target;
      this.carrying = null;
      this.removeAttribute('data-carrying');
      document.getElementById('marble-shell-carrying')?.remove();
      target?.el?.removeAttribute('data-drop');
      subject.row.removeAttribute('data-carried');
      this.swallowClick = !cancelled;
      setTimeout(() => { this.swallowClick = false; }, 0);
      // It springs to where it is going: the slot, the folder, or home.
      const to = (target?.type === 'pin' ? held.slot : target?.el ?? (subject.row.isConnected ? subject.row : null))?.getBoundingClientRect();
      if (to && !this.reduced.matches) {
        const from = ghost.style.transform;
        ghost.animate([{ transform: from }, { transform: `translate(${to.left}px, ${to.top}px) scale(${target?.type === 'move' ? 0.6 : 1})`, opacity: target?.type === 'move' ? 0 : 1 }],
          { duration: 220, easing: EASE }).finished.then(() => ghost.remove(), () => ghost.remove());
      } else {
        ghost.remove();
      }
      let failed = null;
      try {
        if (target?.type === 'pin') {
          const was = this.pinned(subject.path);
          const filed = await this.pinPath(subject.path, subject.kind, target.before);
          if (filed && !was) this.say(`Pinned ${nameOf(subject.path)}`);
        } else if (target?.type === 'move') {
          const to = [target.folder, nameOf(subject.path)].filter(Boolean).join('/');
          if (this.taken(to)) throw new Error(`Something called ${nameOf(subject.path)} is already in ${nameOf(target.folder) || 'Drive'}`);
          await this.moveItem(subject.path, to);
        }
      } catch (err) {
        failed = err;
      }
      // Whatever the file now says is what is drawn: a slot that was not
      // filed, or a pin put back, goes with the redraw.
      if (held.slot && !held.home && held.slot.isConnected && (failed || target?.type !== 'pin')) held.slot.remove();
      if (held.home && (failed || !target)) this.closeRoom(held);
      this.dragging = false;
      this.dirty = false;
      this.drawTree();
      this.settle();
      if (failed) this.say(failed.message || 'That did not move');
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
      // The chat pinned, or on hover: there is no chat turned off in the shell.
      setChat: (pinned) => el.pin('chat', pinned),
      reveal: (side, options) => el.reveal(side, options),
      conceal: (side) => el.conceal(side),
      // Whether the chat is on hover, hiding until reached for.
      get autoHide() { return el.hovers('chat'); },
      // The drawer leaves ⌘J and ⌘\\ to the shell wherever the shell can open.
      get takesKeys() { return !el.phone.matches; },
    };
    document.body.append(el);
  };

  if (document.body) mount();
  else addEventListener('DOMContentLoaded', mount, { once: true });
})();
