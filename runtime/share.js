// A page opened by a share link wears this instead of the shell.
//
// The host decides what a link may change (server/share-policy.js) and refuses
// the rest, and the carrier puts a refused change back. This is the half the
// person sees: a mark that says what their link lets them do, the reason when
// a change does not take, and, for a link that only reads, a page that does
// not pretend to be editable in the first place.
//
// It holds no state of its own: the level comes from its script tag, and the
// page is the file's.

(() => {
  const script = document.currentScript;
  const ROLE = script?.dataset.role ?? 'view';
  const NAME = { view: 'Read only', edit: 'Read & write', modify: 'Read, write & modify' };
  const SAYS = {
    view: 'You can read this page and see changes as they happen, but not change it.',
    edit: 'You can type, tick, add and reorder where the page allows it.',
    modify: 'You can change and restyle any part of this page.',
  };
  const READ_ONLY = 'This link can only read the page';
  const OFF = 'This link was turned off';
  const OFF_SAYS = 'This link was turned off. Ask whoever shared it for a new one.';

  document.documentElement.setAttribute('data-marble-share', ROLE);

  // ------------------------------------------------------------------ the mark

  const host = document.createElement('marble-share');
  host.setAttribute('data-marble-transient', '');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    /* Bottom left: a document keeps its own controls at the top, and its
       save status bottom right. */
    :host { all: initial; position: fixed; left: 12px; bottom: 12px; z-index: 2147483000;
      --ink: #111111; --muted: #5f6368; --line: #e4e1da; --card: #ffffff; --paper: #f3f1ea; --accent: #9bb6cf; --danger: #b4533e;
      font: 500 12.5px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); }
    @media (prefers-color-scheme: dark) {
      :host { --ink: #e8e6e1; --muted: #a3a7ab; --line: #2f3438; --card: #1c1f22; --paper: #262a2e; --accent: #7fa8c9; --danger: #e08a74; }
    }
    button { font: inherit; color: inherit; margin: 0; cursor: pointer; }
    .mark { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px;
      background: var(--card); border: 1px solid var(--line); box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 6px 16px rgba(0,0,0,.08);
      transition: background-color 110ms ease; }
    .mark:hover, .mark[aria-expanded="true"] { background: var(--paper); }
    .mark:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .mark[data-off] { color: var(--danger); }
    /* What the link lets this person do: a press on the mark says it, in a
       card just above, and a press anywhere else puts it away. */
    .says { position: absolute; left: 0; bottom: 36px; width: max-content; max-width: min(16rem, calc(100vw - 24px));
      padding: 8px 11px; border-radius: 12px; background: var(--card); border: 1px solid var(--line);
      box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 6px 16px rgba(0,0,0,.08); font-weight: 400; line-height: 1.4; color: var(--ink); }
    .says[hidden] { display: none; }
    .i { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 8px); opacity: 0; pointer-events: none;
      background: var(--ink); color: var(--card); border-radius: 999px; padding: 7px 14px; white-space: nowrap;
      transition: opacity 160ms ease, transform 160ms ease; }
    .toast[data-on] { opacity: 1; transform: translate(-50%, 0); }
    @media (prefers-reduced-motion: reduce) { .toast { transition: opacity 120ms linear; transform: translate(-50%, 0); } }
  </style>
  <p class="says" id="says" hidden>${SAYS[ROLE] ?? SAYS.view}</p>
  <button type="button" class="mark" aria-expanded="false" aria-controls="says" aria-label="${NAME[ROLE] ?? NAME.view} link: what you can do">
    <svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2.1-2.1a2.75 2.75 0 0 0-3.9-3.9l-.6.6"/><path d="M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2.1 2.1a2.75 2.75 0 0 0 3.9 3.9l.6-.6"/></svg>
    <span class="name">${NAME[ROLE] ?? NAME.view}</span>
  </button>
  <div class="toast" role="status" aria-live="polite"></div>`;
  const mark = root.querySelector('.mark');
  const says = root.querySelector('.says');
  const toast = root.querySelector('.toast');
  const showSays = (on) => {
    says.hidden = !on;
    mark.setAttribute('aria-expanded', String(on));
  };
  mark.addEventListener('click', () => showSays(says.hidden));
  addEventListener('pointerdown', (event) => {
    if (!says.hidden && !event.composedPath().includes(host)) showSays(false);
  }, { capture: true });
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !says.hidden) showSays(false);
  });
  let toastTimer = 0;
  const say = (text) => {
    toast.textContent = text;
    toast.setAttribute('data-on', '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.removeAttribute('data-on'), 2400);
  };
  (document.body ?? document.documentElement).append(host);

  // A refusal is only worth saying to someone who just did something: a page
  // that addresses its own elements on load would otherwise greet a reader
  // with an error they did not cause.
  let touched = 0;
  for (const type of ['pointerdown', 'keydown', 'paste', 'drop']) {
    addEventListener(type, () => { touched = Date.now(); }, { capture: true });
  }
  const recent = () => Date.now() - touched < 4000;

  let off = false;
  const turnedOff = () => {
    if (off) return;
    off = true;
    mark.setAttribute('data-off', '');
    mark.querySelector('.name').textContent = 'Link turned off';
    mark.setAttribute('aria-label', 'Link turned off: what that means');
    says.textContent = OFF_SAYS;
    document.documentElement.setAttribute('data-marble-share', 'view');
  };

  document.addEventListener('marble:status', (event) => {
    const { state, message } = event.detail ?? {};
    if (state !== 'error' || !message) return;
    if (/drive is closed|turned off/i.test(message)) {
      turnedOff();
      say(OFF);
      return;
    }
    if (recent()) say(message);
  });

  // Whether the link is still on, asked when the page comes back into view:
  // a link turned off while this tab sat in the background ends its stream,
  // and nothing else would tell the person why the page went quiet.
  const check = async () => {
    if (off || !window.marble?.app) return;
    try {
      const res = await fetch(`/presence?app=${encodeURIComponent(window.marble.app)}`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) turnedOff();
    } catch {
      // Offline is not off.
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });

  // ------------------------------------------------------------- read only

  if (ROLE !== 'view') return;

  const style = document.createElement('style');
  style.setAttribute('data-marble-transient', '');
  // The affordances' own handles, and a caret that would promise typing.
  style.textContent = `
    html[data-marble-share="view"] :is(.marble-btn, .marble-grip, .marble-handle, .marble-resize, .marble-alts-add) { display: none !important; }
    html[data-marble-share="view"] [contenteditable]:not([contenteditable="false"]) { caret-color: transparent; cursor: default; }
  `;
  document.head.append(style);

  const refuse = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    say(READ_ONLY);
  };
  // Typing, pasting, dropping and cutting all arrive as beforeinput first.
  addEventListener('beforeinput', refuse, { capture: true });
  addEventListener('drop', refuse, { capture: true });
  addEventListener('click', (event) => {
    if (event.target?.closest?.('input[type="checkbox"], input[type="radio"]')) refuse(event);
  }, { capture: true });

  // Anything a page's own script would file is dropped here, and the page is
  // put back to what the file says. The host would refuse it anyway; this
  // saves the round trip and says why at once.
  let patching = 0;
  const wrap = (marble) => {
    if (!marble || marble.shareWrapped) return;
    marble.shareWrapped = true;
    marble.op = () => {
      if (recent()) say(READ_ONLY);
      clearTimeout(patching);
      patching = setTimeout(() => marble.patch?.(), 120);
    };
  };
  if (window.marble) wrap(window.marble);
  else addEventListener('marble:ready', (event) => wrap(event.detail), { once: true });
})();
