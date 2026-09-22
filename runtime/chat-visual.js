// A visual in the transcript: the card an agent's ```marble-visual block
// becomes.
//
// The transcript shows agent text and never interprets it. A visual is the one
// exception, and it is an exception only because it is not shown in the page at
// all — it is handed to a sandboxed frame with `allow-scripts` and nothing
// else, so it runs at an opaque origin that cannot read this document, its
// cookie, its storage, or navigate the tab. Interactive means script; this is
// the boundary that makes script safe on a drawer that sits on top of every
// document.
//
// The first half is pure, and the node suite imports it. `mountVisual` below is
// the DOM.

// ------------------------------------------------------------------ the fence

const INFO = /^marble-visual\b\s*/i;

/** `marble-visual Three ways to lay it out` → { caption }. null when the info
 *  string names something else, which is an ordinary code block. */
export function readVisualInfo(info) {
  const line = String(info ?? '').trim();
  if (!INFO.test(line)) return null;
  return { caption: line.replace(INFO, '').trim() };
}

/** What the live message shows while a visual is still arriving: the text
 *  around the fences, and how many visuals are on their way. A half-written
 *  block must never reach the log as raw markup. */
export function maskStreamingVisuals(raw) {
  const lines = String(raw ?? '').replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  let visuals = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const fence = /^\s*```(.*)$/.exec(lines[i]);
    if (!fence || !readVisualInfo(fence[1])) {
      kept.push(lines[i]);
      continue;
    }
    visuals += 1;
    for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]); i += 1);
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), visuals };
}

// ------------------------------------------------------------------ the limits

export const LIMITS = {
  /** Past this a visual is a file, not a card: it is shown as code instead. */
  source: 120_000,
  /** What one card may put in the composer. */
  answer: 2000,
  /** Sends from one card, and the quiet between them. A widget that answers in
   *  a loop is a bug, and a bug must not be able to start twelve turns. */
  sends: 12,
  gapMs: 600,
};

// ------------------------------------------------------------------ the tokens

/** The palette the chrome is already wearing — the open document's, copied on
 *  by applyPageTheme — so a visual is in the accent of the app it is in. */
export const TOKEN_NAMES = [
  'ink', 'muted', 'faint', 'placeholder', 'line',
  'paper', 'paper-2', 'paper-3', 'card',
  'accent', 'accent-soft', 'accent-ink', 'danger', 'caution',
  'radius', 'ui-font', 'settle', 'snap',
  // Not a token the page declares: the size the transcript around the card is
  // being read at. A phone reads at seventeen, and a visual set at fourteen
  // beside it is a picture of a smaller app.
  'visual-font-size',
];

const SAFE_VALUE = /^[^;{}<>\\]{1,180}$/;

/** A computed custom property is a colour, a length or a font stack. Anything
 *  that could close the rule it is written into is dropped rather than escaped:
 *  a document declares these, and a document is not trusted markup. */
export const declarations = (tokens) =>
  TOKEN_NAMES.map((name) => [name, String(tokens?.[name] ?? '').trim()])
    .filter(([, value]) => value && SAFE_VALUE.test(value))
    .map(([name, value]) => `--${name}: ${value};`)
    .join(' ');

const CHANNEL = /^#([0-9a-f]{3,8})$|^rgba?\(([^)]+)\)$/i;

/** Roughly, is this paper unlit? Decides `color-scheme` inside the frame, which
 *  is what makes a scrollbar and a checkbox match the rest after dark. */
export function isDark(paper) {
  const value = String(paper ?? '').trim();
  const match = CHANNEL.exec(value);
  if (!match) return false;
  let rgb;
  if (match[1]) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  } else {
    rgb = match[2].split(/[,/\s]+/).slice(0, 3).map((n) => Number.parseFloat(n));
  }
  if (rgb.some((n) => !Number.isFinite(n))) return false;
  return (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) < 128;
}

// ------------------------------------------------------------------ the frame

/** The base sheet every visual is written against: the design system's own
 *  tokens, its type scale, and the handful of classes that keep a visual from
 *  having to reinvent a card, a grid and an option every time. An author's own
 *  <style> comes after this one, so it wins. */
const BASE = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font: var(--visual-font-size, 14px)/1.5 var(--ui-font, "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    color: var(--ink); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  .marble-fit { padding: 12px; display: grid; gap: 10px; align-content: start; }
  h1, h2, h3, h4 { margin: 0; font-weight: 500; letter-spacing: -.01em; }
  h1 { font-size: 1.15rem; } h2 { font-size: 1rem; } h3 { font-size: .85rem; color: var(--muted); }
  p { margin: 0; } ul, ol { margin: 0; padding-left: 1.15em; }
  a { color: var(--accent-ink); }
  small, .meta { font-size: .78rem; color: var(--muted); line-height: 1.45; }
  .label { font-size: 13px; font-weight: 600; }
  .quiet { color: var(--faint); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 2px 0; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  code { background: var(--paper-2); padding: 1px 4px; border-radius: 4px; }
  svg { display: block; max-width: 100%; height: auto; }
  img { max-width: 100%; }
  input, select, textarea, button { font: inherit; color: inherit; }
  /* The one blue a control is allowed is the app's own. */
  input, select, textarea, progress, meter { accent-color: var(--accent-ink); }
  button { background: none; border: 0; padding: 0; cursor: pointer; color: inherit; }
  :focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
  .stack { display: grid; gap: 8px; align-content: start; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px;
    display: grid; gap: 6px; align-content: start;
  }
  /* An option: a whole card that is also a button. Pressed is a colour and a
     ring, never a scale — nothing here pops under the finger. */
  .pick {
    display: grid; gap: 4px; text-align: left; align-content: start;
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px;
    transition: border-color 200ms var(--settle, cubic-bezier(.22, 1, .36, 1)), background-color 200ms var(--settle, cubic-bezier(.22, 1, .36, 1)), box-shadow 200ms var(--settle, cubic-bezier(.22, 1, .36, 1));
  }
  .pick:hover { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); }
  .pick:active { background: var(--paper-2); }
  .pick[aria-pressed="true"] {
    border-color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent) 10%, var(--card));
    box-shadow: inset 0 0 0 1px var(--accent-ink);
  }
  .pick > b { font-weight: 500; }
  .pill {
    display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 0 10px;
    font-size: .75rem; font-weight: 500; border: 1px solid var(--line); border-radius: 999px;
    transition: background-color 110ms var(--snap, cubic-bezier(.4, 0, .2, 1)), border-color 200ms var(--settle, cubic-bezier(.22, 1, .36, 1));
  }
  .pill:hover { background: var(--paper-2); }
  .pill[aria-pressed="true"] { border-color: var(--accent-ink); color: var(--accent-ink); background: var(--accent-soft); }
  .send {
    /* A filled pill is the loudest thing on a page: it is spent once, and it
       is never the width of the card. */
    display: inline-flex; width: fit-content; align-items: center; min-height: 30px; padding: 0 14px; border-radius: 999px;
    font-size: .8rem; font-weight: 500; background: var(--ink); color: var(--paper);
    transition: background-color 110ms var(--snap, cubic-bezier(.4, 0, .2, 1));
  }
  .send:hover { background: color-mix(in srgb, var(--ink) 84%, var(--paper)); }
  :root[data-answered] .send { background: var(--paper-3); color: var(--muted); }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

// The bridge. It measures, it carries a click back as a reply, and it takes a
// new palette when the page changes one. It is the only script the host writes.
const BRIDGE = `
  (() => {
    const fit = document.querySelector('.marble-fit');
    const post = (message) => { try { parent.postMessage({ marbleVisual: true, ...message }, '*'); } catch {} };
    let last = -1;
    const measure = () => {
      const height = Math.ceil(fit.getBoundingClientRect().height);
      if (height > 0 && height !== last) { last = height; post({ what: 'size', height }); }
    };
    const send = (what, text) => post({ what, text: String(text == null ? '' : text) });
    window.marble = {
      answer: (text) => send('answer', text),
      draft: (text) => send('draft', text),
      resize: measure,
    };
    new ResizeObserver(measure).observe(fit);
    addEventListener('load', measure);
    addEventListener('click', (event) => {
      const el = event.target && event.target.closest && event.target.closest('[data-answer], [data-draft]');
      if (!el) return;
      // aria-pressed is opt-in: an author who writes it gets the chosen look
      // and its siblings cleared, and one who does not is left alone.
      if (el.hasAttribute('aria-pressed') && el.parentElement) {
        for (const other of el.parentElement.querySelectorAll('[aria-pressed]')) other.setAttribute('aria-pressed', 'false');
        el.setAttribute('aria-pressed', 'true');
      }
      if (el.hasAttribute('data-answer')) send('answer', el.getAttribute('data-answer'));
      else send('draft', el.getAttribute('data-draft'));
    });
    addEventListener('message', (event) => {
      if (event.source !== parent || !event.data || event.data.marbleHost !== true) return;
      if (event.data.what === 'theme' && typeof event.data.css === 'string') {
        document.getElementById('marble-theme').textContent = ':root { ' + event.data.css + ' }';
        if (typeof event.data.dark === 'boolean') document.documentElement.style.colorScheme = event.data.dark ? 'dark' : 'light';
      }
      if (event.data.what === 'answered') document.documentElement.dataset.answered = '';
    });
    requestAnimationFrame(measure);
    setTimeout(measure, 120);
  })();
`;

/** The whole document a visual runs in. The fragment is written in as-is: this
 *  string never reaches the page, only the frame's own parser. */
export function visualDocument({ source = '', tokens = {}, dark = false } = {}) {
  return `<!doctype html>
<html lang="en" style="color-scheme: ${dark ? 'dark' : 'light'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style id="marble-theme">:root { ${declarations(tokens)} }</style>
<style>${BASE}</style>
</head>
<body><div class="marble-fit">${source}</div>
<script>${BRIDGE}</script>
</body></html>`;
}

/** A message from a frame, or null. Shape and size are checked here so the
 *  caller only ever sees something it can act on. */
export function readVisualMessage(data) {
  if (!data || data.marbleVisual !== true) return null;
  if (data.what === 'size') {
    const height = Number(data.height);
    if (!Number.isFinite(height) || height < 0) return null;
    return { what: 'size', height: Math.min(Math.round(height), 20_000) };
  }
  if (data.what === 'answer' || data.what === 'draft') {
    const text = String(data.text ?? '').trim().slice(0, LIMITS.answer);
    if (!text) return null;
    return { what: data.what, text };
  }
  return null;
}

// ------------------------------------------------------------------ the card

export const VISUAL_CSS = `
  .visual { display: block; margin: 6px 0 12px; }
  .visual-head { display: flex; align-items: center; gap: 8px; min-height: 18px; margin: 0 2px 5px; font-size: 11.5px; color: var(--faint); }
  .visual-title { color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .visual-sent { color: var(--accent-ink); font-weight: 500; }
  .visual-sent[hidden] { display: none; }
  .visual-acts { margin-left: auto; display: flex; gap: 2px; flex: none; }
  .visual-act {
    font: inherit; font-size: 11px; color: var(--faint); background: none; border: 0; border-radius: 6px;
    padding: 2px 6px; cursor: pointer;
    transition: background-color 200ms var(--settle), color 200ms var(--settle);
  }
  .visual-act:hover, .visual-act:focus-visible { background: var(--paper-2); color: var(--ink); outline: none; }
  .visual-act[aria-pressed="true"] { color: var(--accent-ink); }
  .visual-act[hidden] { display: none; }
  .visual-frame {
    display: block; width: 100%; height: 108px; border: 1px solid var(--line); border-radius: 12px;
    /* Paper, not card: what a visual puts on it — an option, a node, a field —
       is the card, and a card on a card is two things saying one. */
    background: var(--paper); color-scheme: normal; max-height: min(70vh, 560px);
    transition: height 300ms var(--settle);
  }
  .visual[data-wide] .visual-frame { max-height: 85vh; }
  .visual-code {
    display: none; margin: 6px 0 0; max-height: 320px; overflow: auto;
    background: var(--paper-2); border-radius: 8px; padding: 10px 12px;
    font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .visual[data-code] .visual-code { display: block; }
  .visual-pending {
    height: 108px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper);
    display: grid; place-items: center; font-size: 11.5px; color: var(--faint);
  }
  .visual-pending::after { content: "Drawing…"; animation: visual-breathe 1.6s ease-in-out infinite; }
  @keyframes visual-breathe { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }
  @media (prefers-reduced-motion: reduce) {
    .visual-frame { transition: none; }
    .visual-pending::after { animation: none; }
  }
`;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const tokensOf = (view) => {
  const style = getComputedStyle(view);
  const out = {};
  for (const name of TOKEN_NAMES) {
    const value = style.getPropertyValue(`--${name}`).trim();
    if (value) out[name] = value;
  }
  const log = view?.shadowRoot?.querySelector('.log');
  if (log) out['visual-font-size'] = getComputedStyle(log).fontSize;
  return out;
};

/** Re-send the palette to every frame in a view. Called when the page the
 *  chrome is copying changes colour; nothing reloads. */
export function paintVisuals(view) {
  const frames = view?.shadowRoot?.querySelectorAll('.visual-frame');
  if (!frames?.length) return;
  const tokens = tokensOf(view);
  const message = { marbleHost: true, what: 'theme', css: declarations(tokens), dark: isDark(tokens.paper) };
  for (const frame of frames) frame.contentWindow?.postMessage(message, '*');
}

// One listener for every card on the page, pruning itself as cards leave. A
// listener per card would outlive the transcript it was rendered into, and the
// transcript is rebuilt whole on every load.
const live = new Set();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  addEventListener('message', (event) => {
    for (const entry of [...live]) {
      if (!entry.card.isConnected) {
        live.delete(entry);
        continue;
      }
      if (event.source && event.source === entry.frame.contentWindow) {
        entry.handle(event.data);
        return;
      }
    }
  });
}

/** Fill the shell the transcript made: a caption, the frame, the code behind
 *  it, and the wires between the frame and the composer. `view` is the
 *  <marble-conversation> the card is in. */
export function mountVisual(card, { info = '', body = '', view = null } = {}) {
  if (!card || card.dataset.mounted) return;
  card.dataset.mounted = '';
  const read = readVisualInfo(info);
  const pending = card.querySelector('.visual-pending');
  const source = String(body ?? '');

  // Not a visual after all, or a visual the size of a file: show the code.
  if (!read || source.length > LIMITS.source) {
    const pre = el('pre', 'visual-code');
    pre.append(el('code', '', source));
    card.dataset.code = '';
    pending?.replaceWith(pre);
    return;
  }

  const caption = read.caption || 'Visual';
  card.setAttribute('aria-label', caption);
  const head = el('div', 'visual-head');
  const sent = el('span', 'visual-sent', 'Sent');
  sent.hidden = true;
  const acts = el('div', 'visual-acts');
  head.append(el('span', 'visual-title', read.caption), sent, acts);
  card.prepend(head);

  const frame = document.createElement('iframe');
  frame.className = 'visual-frame';
  // allow-scripts, and nothing else. No allow-same-origin: the frame must not
  // be able to reach back through this document.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', caption);
  const tokens = tokensOf(view ?? card);
  frame.srcdoc = visualDocument({ source, tokens, dark: isDark(tokens.paper) });

  const act = (label, title) => {
    const button = el('button', 'visual-act', label);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-pressed', 'false');
    return button;
  };
  const expand = act('Expand', 'Show the whole visual');
  expand.hidden = true;
  const showCode = act('Code', 'Show the markup behind this');
  acts.append(expand, showCode);

  // The one honest reason to offer Expand is that the card is holding
  // something back. That is the cap against the content's height, and not the
  // height the frame happens to be at — it is still easing towards it.
  let tall = 0;
  const syncExpand = () => {
    const cap = Number.parseFloat(getComputedStyle(frame).maxHeight);
    const over = Number.isFinite(cap) && tall > cap + 1;
    expand.hidden = !over && !card.hasAttribute('data-wide');
  };

  expand.addEventListener('click', () => {
    const wide = card.hasAttribute('data-wide');
    card.toggleAttribute('data-wide', !wide);
    expand.setAttribute('aria-pressed', String(!wide));
    expand.textContent = wide ? 'Expand' : 'Collapse';
    syncExpand();
  });
  showCode.addEventListener('click', () => {
    const open = card.hasAttribute('data-code');
    // Written the first time it is asked for. A <pre> nobody has opened is
    // still text in the log — it would land in the callout's one line, and in
    // anything else that reads a message back.
    if (!open && !card.querySelector('.visual-code')) {
      const pre = el('pre', 'visual-code');
      pre.append(el('code', '', source));
      card.append(pre);
    }
    card.toggleAttribute('data-code', !open);
    showCode.setAttribute('aria-pressed', String(!open));
  });

  let sends = 0;
  let lastSend = 0;
  let drafting = 0;
  // A slider drafts on every input event, and filling the composer rebuilds
  // its editor. One fill a frame, with the latest words. The caret is never
  // taken: the person is looking at the widget, not at the box.
  const draft = (text) => {
    if (drafting) cancelAnimationFrame(drafting);
    drafting = requestAnimationFrame(() => {
      drafting = 0;
      view.input.value = text;
      view.autosize?.();
      view.updateSendable?.();
    });
  };

  const answer = async (text, send) => {
    if (!view?.input) return;
    if (!send) {
      draft(text);
      return;
    }
    const now = Date.now();
    if (sends >= LIMITS.sends || now - lastSend < LIMITS.gapMs) return;
    sends += 1;
    lastSend = now;
    if (drafting) {
      cancelAnimationFrame(drafting);
      drafting = 0;
    }
    view.input.value = text;
    sent.hidden = false;
    card.dataset.answered = '';
    frame.contentWindow?.postMessage({ marbleHost: true, what: 'answered' }, '*');
    await view.submit?.();
  };

  // A frame reports the height of its content; the box that holds it may be
  // measured with its border in or out. Asking for the wrong one crops the
  // last two pixels of every visual and makes it scroll.
  const chrome = () => {
    const style = getComputedStyle(frame);
    if (style.boxSizing !== 'border-box') return 0;
    return (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
  };

  const handle = (data) => {
    const message = readVisualMessage(data);
    if (!message) return;
    if (message.what === 'size') {
      tall = message.height;
      frame.style.height = `${message.height + chrome()}px`;
      syncExpand();
      return;
    }
    answer(message.text, message.what === 'answer');
  };

  pending?.replaceWith(frame);
  live.add({ card, frame, handle });
  listen();
}
