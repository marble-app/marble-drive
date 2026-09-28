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
  const GAP = 8;
  const PHONE = '(max-width: 719px)';
  const KEY = 'marble-shell:';
  const RECENT = 6;
  // The host's front door lands on the Drive, wherever this drive keeps it,
  // and a fragment rides through the redirect: `#/<folder>` is how the Drive
  // reads which folder to show.
  const HOME = '/';
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
      --accent: #9bb6cf; --accent-soft: #f1f5f8; --accent-ink: #738698;
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
        --accent: #7fa8c9; --accent-soft: #1d2932; --accent-ink: #9dc0dc;
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
  };
  const icon = (name) => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true">${PATHS[name]}</svg>`;
  const LOGO = '<span class="logo" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 6 14 10 10 14 6 10z"/></svg></span>';

  const CSS = `
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
    .search { margin: 10px 10px 6px; display: flex; align-items: center; gap: 8px; padding: 0 8px; height: 32px; border-radius: 8px; background: var(--paper-2); color: var(--faint); }
    .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font: inherit; color: var(--ink); padding: 0; }
    .search input::placeholder { color: var(--faint); }
    .search:focus-within { box-shadow: inset 0 0 0 1px var(--accent); }
    .search:focus-within kbd { display: none; }
    .scroll { flex: 1; overflow: auto; padding: 2px 6px 12px; overscroll-behavior: contain; }
    .sec-h { display: flex; align-items: center; gap: 2px; margin: 10px 2px 2px; }
    .sec-h button { display: flex; align-items: center; gap: 4px; padding: 3px 6px 3px 4px; border-radius: 6px; font-size: 11px; font-weight: 600; letter-spacing: .02em; color: var(--faint); }
    .sec-h button:hover { color: var(--ink); background: var(--paper-2); }
    .sec-h .i { width: 12px; height: 12px; transition: transform 160ms var(--settle); transform: rotate(90deg); }
    .sec[data-folded] .sec-h .i { transform: none; }
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

    /* ── Float: the same three, as cards over the page ── */
    :host([data-mode="float"]) .bar { top: ${GAP}px; left: ${GAP}px; width: calc(100vw - ${GAP * 2}px); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: var(--shadow-lift); background: color-mix(in srgb, var(--paper) 82%, transparent); -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3); }
    :host([data-mode="float"]) .nav { top: ${BAR + GAP * 2}px; left: ${GAP}px; bottom: ${GAP}px; border: 1px solid var(--line); border-radius: 16px;
      box-shadow: var(--shadow-lift); background: color-mix(in srgb, var(--paper) 82%, transparent); -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3); }
    @media (prefers-reduced-transparency: reduce) { :host([data-mode="float"]) .bar, :host([data-mode="float"]) .nav { background: var(--paper); -webkit-backdrop-filter: none; backdrop-filter: none; } }

    /* ── Closed, or the tree put away ── */
    :host(:not([data-open])) .bar { transform: translateY(calc(-100% - 16px)); opacity: 0; pointer-events: none; visibility: hidden; --hide-after: ${MOTION}ms; }
    :host(:not([data-open])) .nav, :host([data-nav="off"]) .nav { transform: translateX(calc(-100% - 24px)); opacity: 0; pointer-events: none; visibility: hidden; --hide-after: ${MOTION}ms; }
    /* In Fit each panel travels exactly as far as the page's edge does, on the
       same curve, so the page is never seen pulling away from a panel that has
       not arrived yet. Floating cards clear their own shadow on the way out. */
    :host([data-mode="fit"]:not([data-open])) .bar { transform: translateY(-100%); }
    :host([data-mode="fit"]:not([data-open])) .nav, :host([data-mode="fit"][data-nav="off"]) .nav { transform: translateX(-100%); }

    /* ── App alone: a pill at the top-left corner, only when the pointer goes there ──
       The hot strip is thin on purpose: the corner is where an app keeps its
       own title and tools, and a wide invisible target would take their clicks. */
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

  class MarbleShell extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${UI?.TOKENS ?? FALLBACK_TOKENS}${CSS}</style>
        <div class="zone" aria-hidden="true"></div>
        <button type="button" class="pill" aria-label="Open the drive (⌘J)">${LOGO}<b></b><kbd>⌘J</kbd></button>
        <header class="bar" aria-label="Drive">
          <button type="button" class="ib" data-act="nav" aria-pressed="true" aria-label="Tree" title="Tree (⌘\\)">${icon('nav')}</button>
          <a class="home" aria-label="Drive" title="Drive">${LOGO}</a>
          <nav class="crumbs" aria-label="Where you are"></nav>
          <span class="spacer"></span>
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
        <div class="toast" role="status" aria-live="polite"></div>`;
      this.$ = (selector) => root.querySelector(selector);
      this.bar = this.$('.bar');
      this.nav = this.$('.nav');
      this.scroll = this.$('.scroll');
      this.search = this.$('.search input');
      this.menu = this.$('.menu');
      this.sharing = this.$('.sharing');
      this.phone = matchMedia(PHONE);
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
      this.tree = null;
    }

    get here() {
      return window.marble?.app ?? '';
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
        top: this.state.mode === 'float' ? BAR + GAP * 2 : BAR,
        gap: GAP,
        // How much of the window the tree takes, so the chat's edge knows
        // how far it may be pulled.
        side: active && this.state.nav ? this.navWidth + (this.state.mode === 'float' ? GAP : 0) : 0,
      };
    }

    connectedCallback() {
      if (UI?.watchPageTheme) this.unwatchTheme = UI.watchPageTheme(this);
      this.fillCrumbs();
      this.$('.pill b').textContent = nameOf(this.here) || document.title;
      this.$('.home').href = HOME;

      this.$('.pill').addEventListener('click', () => this.setOpen(true));
      const zone = this.$('.zone');
      zone.addEventListener('pointerenter', () => this.peek(true));
      this.$('.pill').addEventListener('pointerenter', () => this.peek(true));
      this.$('.pill').addEventListener('pointerleave', () => this.peek(false));
      zone.addEventListener('pointerleave', (event) => {
        if (!event.relatedTarget || !this.shadowRoot.contains(event.relatedTarget)) this.peek(false);
      });

      this.bar.addEventListener('click', (event) => {
        const act = event.target.closest('[data-act]')?.dataset.act;
        if (act === 'nav') this.set({ nav: !this.state.nav });
        else if (act === 'fit' || act === 'float') this.set({ mode: act });
        else if (act === 'chat') this.set({ chat: !this.state.chat });
        else if (act === 'close') this.setOpen(false);
        else if (act === 'share') this.toggleSharing();
        else if (act === 'doc') this.toggleMenu(event.target.closest('[data-act]'));
      });
      this.sharing.querySelector('.copy').addEventListener('click', () => this.copyLink());
      this.menu.addEventListener('click', (event) => {
        const pick = event.target.closest('[data-pick]')?.dataset.pick;
        if (!pick) return;
        this.hidePops();
        if (pick === 'link') this.copyLink();
        else if (pick === 'drive') location.href = this.folderHref(folderOf(this.here));
        else if (pick === 'download') location.href = window.marble.drive.downloadHref(this.here);
      });
      this.shadowRoot.addEventListener('pointerdown', (event) => {
        if (!event.composedPath().some((node) => node === this.menu || node === this.sharing || node?.dataset?.act === 'share' || node?.dataset?.act === 'doc')) this.hidePops();
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
        const row = event.target.closest('.row');
        if (row?.dataset.folder !== undefined && row.localName === 'button') this.toggleFolder(row.dataset.folder);
        const sec = event.target.closest('.sec-h button');
        if (sec) this.toggleSection(sec.closest('.sec').dataset.sec);
      });
      this.scroll.addEventListener('keydown', (event) => this.walkRows(event));

      this.onKey = (event) => this.key(event);
      addEventListener('keydown', this.onKey, true);
      // The drawer mounts when the agent client arrives, which may be before
      // this or after it; either way it asks once it exists.
      this.onDrawer = () => this.announce();
      addEventListener('marble-tray:ready', this.onDrawer);
      this.onViewport = () => this.apply();
      this.phone.addEventListener('change', this.onViewport);
      this.onWindowResize = () => this.apply({ animate: false });
      addEventListener('resize', this.onWindowResize);
      this.bindEdge();

      this.setAttribute('data-still', '');
      this.apply();
      requestAnimationFrame(() => requestAnimationFrame(() => this.removeAttribute('data-still')));
    }

    disconnectedCallback() {
      this.unwatchTheme?.();
      removeEventListener('keydown', this.onKey, true);
      removeEventListener('pointerdown', this.onOutside);
      removeEventListener('marble-tray:ready', this.onDrawer);
      this.phone.removeEventListener('change', this.onViewport);
      removeEventListener('resize', this.onWindowResize);
      this.offDrive?.();
      this.dock(null, { animate: false });
    }

    // ------------------------------------------------------------ state

    set(patch) {
      Object.assign(this.state, patch);
      for (const [name, value] of Object.entries(patch)) {
        store(name, typeof value === 'boolean' ? (value ? '1' : '0') : value);
      }
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
      if (on) this.setAttribute('data-peek', '');
      // Leaving the strip for the pill crosses a gap of empty page; the delay
      // is what makes the two one target to the hand.
      else this.peekTimer = setTimeout(() => this.removeAttribute('data-peek'), 260);
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
      chatButton.setAttribute('aria-pressed', String(chat));
      this.nav.inert = !open || !nav;
      this.bar.inert = !open;
      this.navWidth = this.clampNav(this.navWidth);
      this.style.setProperty('--nav-w', `${this.navWidth}px`);
      const edge = this.$('.edge');
      edge.setAttribute('aria-valuenow', String(this.navWidth));
      edge.setAttribute('aria-valuemin', String(NAV_MIN));
      edge.setAttribute('aria-valuemax', String(this.clampNav(NAV_MAX)));
      this.dock(open && mode === 'fit' ? { top: BAR, left: nav ? this.navWidth : 0 } : null, { animate: animate && !this.hasAttribute('data-still') });
      if (open && !this.tree) this.load();
      this.announce();
    }

    announce() {
      const layout = this.layout;
      window.marbleShell.layout = layout;
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
        this.search.focus({ preventScroll: true });
        this.search.select();
      } else if (mod && !event.shiftKey && event.key === '\\' && this.state.open) {
        event.preventDefault();
        event.stopPropagation();
        this.set({ nav: !this.state.nav });
      } else if (event.key === 'Escape' && (!this.menu.hidden || !this.sharing.hidden)) {
        event.stopPropagation();
        this.hidePops();
      }
    }

    // Up and Down walk the visible rows; Right and Left unfold and fold.
    walkRows(event) {
      const rows = [...this.scroll.querySelectorAll('.row, .sec-h button')].filter((el) => el.offsetParent);
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
        this.offDrive = drive.on('*', () => {
          clearTimeout(queued);
          queued = setTimeout(() => this.load(), 300);
        });
      }
      this.tree = await drive.tree('');
      this.drawTree();
    }

    toggleSection(name) {
      if (this.folded.has(name)) this.folded.delete(name);
      else this.folded.add(name);
      store('folded', JSON.stringify([...this.folded]));
      this.drawTree();
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
      this.drawTree();
      this.scroll.querySelector(`button.row[data-folder="${CSS.escape(path)}"]`)?.focus({ preventScroll: true });
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

    section(name, label, list) {
      const sec = h('section', 'sec');
      sec.dataset.sec = name;
      if (this.folded.has(name)) sec.setAttribute('data-folded', '');
      const head = h('div', 'sec-h');
      const b = h('button');
      b.type = 'button';
      b.setAttribute('aria-expanded', String(!this.folded.has(name)));
      b.innerHTML = icon('chev');
      b.append(label);
      head.append(b);
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

    drawTree() {
      if (!this.tree) return;
      const docs = [];
      const walk = (folder) => {
        for (const child of folder.children ?? []) {
          if (child.kind === 'doc') docs.push(child);
          else if (child.kind === 'folder') walk(child);
        }
      };
      walk(this.tree);
      const keep = this.scroll.scrollTop;
      const query = this.search.value.trim().toLowerCase();
      if (query) {
        const ul = h('ul');
        const hits = docs.filter((d) => d.path.toLowerCase().includes(query) || String(d.title ?? '').toLowerCase().includes(query))
          .sort((a, b) => Number(b.name.toLowerCase().includes(query)) - Number(a.name.toLowerCase().includes(query)) || b.modified - a.modified)
          .slice(0, 40);
        for (const d of hits) ul.append(this.item(this.docRow(d, { where: true })));
        if (!hits.length) ul.append(h('li', 'empty', 'Nothing by that name.'));
        this.scroll.replaceChildren(ul);
        return;
      }
      const recent = h('ul');
      for (const d of [...docs].sort((a, b) => b.modified - a.modified).slice(0, RECENT)) recent.append(this.item(this.docRow(d, { where: true })));
      this.scroll.replaceChildren(
        this.section('recent', 'Recent', recent),
        this.section('drive', 'Drive', this.branch(this.tree)),
      );
      this.scroll.scrollTop = keep;
      if (!this.revealed) {
        this.revealed = true;
        this.scroll.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
      }
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
      // The drawer leaves ⌘J to the shell wherever the shell can open.
      get takesKeys() { return !el.phone.matches; },
    };
    document.body.append(el);
  };

  if (document.body) mount();
  else addEventListener('DOMContentLoaded', mount, { once: true });
})();
