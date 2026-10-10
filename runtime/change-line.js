// The line (v5, Notes and Sketches/Ask at Anything, "Asking, flush with the
// thing"): what ⌘J opens.
//
// Until v5, ⌘J opened a card wider than the thing it was about, with a head,
// tools and doors, and after a send the card stayed on the work as a folded
// chat. Now the thing takes a light tint and one line grows under it, as wide
// as it is: no head, no tools, no chat. The line is the only place words go
// in and the only place words come back.
//
//   - ⏎ folds the line back into the thing. What answers is the thing
//     changing, marked part by part (change-marks.js), and this layer's tint
//     steps aside the moment those marks arrive. A change that landed
//     reopens nothing: rest on it to review it. Words that sound like a look
//     are tried first as one rule the page makes itself (change-rules.js);
//     only what is not one goes to the agent.
//   - A question comes back as its answer, in the line, with the line under
//     it for the next one, in the same conversation.
//   - A change that could not be made gives the words back, with why above
//     them, so it can be said another way.
//   - A question back from the work opens the line with its choices; a press
//     answers it and the work carries on.
//   - On a drive with nothing set up to make changes, ⏎ keeps the line open
//     and says so, with Set up beside it (the drive's own Connect, agent-ui.js)
//     rather than folding into a send that can only fail.
//   - While words are being written, a quiet row under them offers what the
//     thing could become, as the card's offer did (agent-offer.js): two
//     suggestions written for it, and the six actions. A suggestion fills
//     the line; an action drafts its words; nothing is sent until ⏎. Lent
//     to Describe mode, the line keeps the actions for what is marked.
//   - ⇧⏎ (or ⌥⏎) breaks the line. Esc puts the line away and keeps its words
//     for the next ⌘J on the same thing. A click away keeps them as a note on
//     the thing (agent-notes.js) instead. Esc while a change runs stops it,
//     when the page has the keys.
//
// The line, its tint and its chips arrive the way the card did: up out of
// nothing, on the house curve, and leave the same way back.
//
// With nothing under the pointer or the caret, ⌘J is about the page, and the
// line sits at the foot of the window. Nothing of the conversation (bubbles,
// status, Undo) is drawn here; the chat holds it, a ⌘⇧J away. Everything is
// transient chrome in one top-layer host; nothing here is filed as an op.
//
// agent-callout.js decides what ⌘J is about and calls `marbleLine.open`.
// Describe mode (agent-marks.js) borrows this same line as its composer with
// `marbleLine.lend`: one way to ask on a page, one look, not a second card.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const GAP = 10;          // px the line hangs under its thing
  const OUT = 6;           // px the thing's tint stands out past it
  const INSIDE = 8;        // px the line keeps inside the window
  const NARROW = 320;      // px, the least a line is wide
  const WIDE = 720;        // px, the most
  const PAGE = 560;        // px, the page's line
  const FOOT = 16;         // px from the foot of the window, for the page's line
  const FADE = 120;        // ms the words take to go on ⏎
  const ARRIVE = 180;      // ms the line and its tint take to arrive or leave, as the card did
  const RISE = 6;          // px the line travels as it arrives
  const CASCADE = 240;     // ms each chip takes to arrive
  const STEP = 30;         // ms between one chip and the next
  const CLOSE = 220;       // ms the line takes to close into its thing
  const STILL = 150;       // ms, the one crossfade reduced motion keeps
  const LONG = 280;        // characters of an answer before it offers the chat
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';    // arriving and settling
  const COLOUR = 'cubic-bezier(.22, .61, .36, 1)'; // colour only
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  // A question is one that ends with a question mark or opens with a
  // question word; "Do the same to the others" is a change (ruling R17).
  const QUESTION = /^(what|why|how|when|who|which|where)\b/i;
  // Words that sound like a look: they may be one rule the page can make
  // itself (change-rules.js), asked before any agent is. Plurals and
  // comparatives too: "corners", "borders", "squarer", "spacing out".
  const LOOK = /\b(round(ed|er|ing)?|squar(e|ed|er)|corners?|radius|radii|padd(ing|ed)|spac(e|es|ed|ing|ier)|tight(er|en)?|loose(r|n)?|roomier|bigger|smaller|larger|wider|narrower|text size|font size|bold(er)?|light(er|en)?|dark(er|en)?|colou?rs?|backgrounds?|borders?|margins?|gaps?|calm(er)?|quiet(er)?|soft(er|en)?)\b/i;
  const ENDS = new Set(['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted', 'turn.removed']);

  // The parts' own unit, named the way the marks count them (change-marks.js).
  const unitOf = (el) => window.marbleChange?.unitOf?.(el) ?? ['part', 'parts'];

  const STYLE = `
    .marble-line-host {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none; color: inherit;
      --line-accent: var(--accent, light-dark(#9bb6cf, #7fa8c9));
      --line-ink: var(--accent-ink, light-dark(#738698, #9dc0dc));
      --line-card: var(--card, var(--paper, light-dark(#fff, #1f2023)));
      --line-text: var(--ink, light-dark(#1d1d1f, #ececee));
      --line-muted: var(--muted, light-dark(#5f6267, #a6a9ae));
      --line-faint: var(--faint, light-dark(#8b8e93, #7e8187));
      --line-rule: var(--line, color-mix(in srgb, var(--line-text) 14%, transparent));
      --line-soft: var(--accent-soft, color-mix(in srgb, var(--line-accent) 22%, transparent));
      --line-well: var(--paper-3, var(--well, color-mix(in srgb, var(--line-text) 7%, transparent)));
      --line-lift: var(--shadow-lift, 0 2px 6px rgba(0, 0, 0, .08), 0 10px 26px rgba(0, 0, 0, .12));
      --line-font: var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif));
      font: 14px/1.45 var(--line-font);
    }
    .marble-line-host:popover-open { position: fixed; inset: 0; }
    /* While pointing (agent-callout.js), the pointer names what is under the
       line, so the line lets it through. */
    html.marble-callout-latched .marble-line-host * { pointer-events: none !important; }
    .marble-line-aloud { position: fixed; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
      clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

    /* What the line is about: a fill out past its edge, the way a selection
       is shown. Never a border down one side. */
    .marble-line-scope { position: fixed; left: 0; top: 0; box-sizing: border-box; border-radius: 12px; pointer-events: none;
      background-color: color-mix(in srgb, var(--line-accent) 14%, transparent);
      opacity: 1; transition: opacity ${ARRIVE}ms ${EASE}; }
    .marble-line-scope[hidden] { display: none; }

    /* The line is the composer's field, floating: a card a shade of glass,
       rounded like a popover, lifted by its shadow with one hairline round
       it, and no capsules inside it (Design System, "What was rejected":
       capsules in the composer; the bar is words). While it has the caret
       it wears the field's focus, a 1px accent ring in a soft halo, not a
       dark rule. */
    .marble-line { position: fixed; left: 0; top: 0; box-sizing: border-box; pointer-events: auto;
      display: grid; gap: 6px; padding: 6px 6px 6px 14px; border-radius: 14px;
      background: color-mix(in srgb, var(--line-card) 90%, transparent);
      -webkit-backdrop-filter: blur(24px) saturate(1.4); backdrop-filter: blur(24px) saturate(1.4);
      color: var(--line-text);
      box-shadow: 0 0 0 1px var(--line-rule), var(--line-lift);
      transform-origin: 50% 0; opacity: 1; transform: none;
      transition: opacity ${ARRIVE}ms ${EASE}, transform ${ARRIVE}ms ${EASE}, box-shadow ${ARRIVE}ms ${COLOUR}; }
    .marble-line:focus-within { box-shadow: 0 0 0 1px var(--line-accent), 0 0 0 4px var(--line-soft), var(--line-lift); }
    .marble-line[data-flip], .marble-line[data-scope="page"] { transform-origin: 50% 100%; }
    .marble-line[hidden] { display: none; }
    .marble-line button { font: inherit; font-family: var(--line-font); }
    .marble-line button:focus-visible { outline: 2px solid var(--line-accent); outline-offset: 1px; }
    @media (prefers-reduced-transparency: reduce) {
      .marble-line { background: var(--line-card); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }

    .marble-line-row { display: flex; align-items: flex-end; gap: 8px; min-width: 0; }
    .marble-line-input { flex: 1; min-width: 0; margin: 0; padding: 4px 0; outline: none;
      font-family: var(--line-font); font-size: 14px; font-weight: 400; line-height: 1.45; color: var(--line-text);
      white-space: pre-wrap; overflow-wrap: anywhere; max-height: calc(3 * 1.45em + 8px); overflow-y: auto;
      caret-color: var(--line-ink); }
    /* The line goes into any document, and a document's own rules for its
       editable text (a focus ring, a hover tint, a border) must not draw a
       box inside it: the line's own ring is the focus. */
    .marble-line .marble-line-input, .marble-line .marble-line-input:is(:hover, :focus, :focus-visible) {
      outline: none !important; border: 0 !important; box-shadow: none !important; background: none !important; border-radius: 0 !important; }
    .marble-line-input:empty::before { content: attr(data-placeholder); color: var(--placeholder, var(--line-faint)); pointer-events: none; }
    /* Send: an outline until there is something to send, when it fills to
       ink; the fill is the affordance (Design System, the composer). */
    .marble-line-send { position: relative; flex: none; appearance: none; box-sizing: border-box; display: grid; place-items: center;
      width: 28px; height: 28px; margin: 0; padding: 0; border-radius: 999px; border: 1px solid var(--line-rule);
      background: none; color: var(--line-faint); cursor: default;
      transition: background-color 120ms ${COLOUR}, border-color 120ms ${COLOUR}, color 120ms ${COLOUR}; }
    .marble-line-send svg { width: 15px; height: 15px; }
    .marble-line-send[data-ready] { background: var(--line-ink); border-color: var(--line-ink); color: var(--line-card); cursor: pointer; }
    .marble-line-send[data-ready]:active { background: color-mix(in srgb, var(--line-ink) 88%, #000); }

    /* A tip for a control with no word: what a press does, and its key,
       after a rest; at once for the keyboard; never for a finger. */
    .marble-line [data-tip]:is(:hover, :focus-visible)::after { content: attr(data-tip); position: absolute; z-index: 1; right: -2px; bottom: calc(100% + 8px);
      padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line-rule); background: var(--line-card);
      box-shadow: var(--shadow-rest, 0 1px 2px rgba(0, 0, 0, .06), 0 2px 6px rgba(0, 0, 0, .05));
      color: var(--line-text); font: 400 12.5px/1.35 var(--line-font); white-space: nowrap; pointer-events: none;
      animation: marble-line-tip 140ms ${EASE} 750ms both; }
    .marble-line [data-tip]:focus-visible::after { animation-delay: 0ms; }
    .marble-line[data-flip] [data-tip]::after { bottom: auto; top: calc(100% + 8px); }
    @keyframes marble-line-tip { from { opacity: 0; translate: 0 3px; } to { opacity: 1; translate: 0 0; } }
    @media (hover: none) { .marble-line [data-tip]::after { display: none; } }

    /* Why nothing changed, over the words given back. */
    .marble-line-said { margin: 0; font-size: 13px; line-height: 1.4; color: var(--line-muted); overflow-wrap: anywhere; }
    .marble-line[data-failed] .marble-line-said { color: var(--danger, var(--line-muted)); }

    /* An answer: a sentence or two, six lines at most before it scrolls, and
       the line for the next question under a rule. */
    .marble-line-answer { margin: 0; padding-right: 4px; line-height: 1.45; color: var(--line-text);
      white-space: pre-wrap; overflow-wrap: anywhere; max-height: calc(6 * 1.45em); overflow-y: auto; }
    .marble-line-open { justify-self: start; appearance: none; margin: -2px 0 0 -6px; padding: 2px 6px; border: 0; border-radius: 6px;
      background: none; color: var(--line-ink); font-size: 12.5px; font-weight: 500; line-height: 1.4; cursor: pointer;
      transition: background-color 120ms ${COLOUR}; }
    .marble-line-open:hover { background: color-mix(in srgb, var(--line-accent) 14%, transparent); }
    .marble-line-more { padding-top: 6px; border-top: 1px solid var(--line-rule); }
    /* Why nothing can be sent yet, and the way to set it up, on one line. */
    .marble-line-setup { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .marble-line-setup .marble-line-open { flex: none; margin: -2px -2px 0 0; }

    /* A question back: what it asks, and a press for each choice. */
    .marble-line-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .marble-line-question { flex: 1 1 12ch; min-width: 0; font-weight: 500; color: var(--line-text); overflow-wrap: anywhere; }
    .marble-line-opts { display: flex; flex-wrap: wrap; gap: 6px; }
    .marble-line-opt { appearance: none; margin: 0; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--line-rule);
      background: var(--line-card); color: var(--line-text); font-size: 12.5px; font-weight: 500; line-height: 1.4; cursor: pointer;
      transition: background-color 120ms ${COLOUR}, border-color 120ms ${COLOUR}; }
    .marble-line-opt:hover { background: color-mix(in srgb, var(--line-accent) 14%, var(--line-card));
      border-color: color-mix(in srgb, var(--line-ink) 40%, transparent); }
    .marble-line-opt:active { background: color-mix(in srgb, var(--line-accent) 26%, var(--line-card)); }
    .marble-line-opt:disabled { opacity: .55; cursor: default; }

    /* What the thing could become, while words are written: the words it
       could be told on the left, each led by the drawn corner arrow, and the
       six actions on the right as icon and word. All are bare text until
       reached for, as context is: a hover lays a well under one, a press
       deepens it, nothing has a border. Two rows at most (fitChips). */
    .marble-line-offer { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; min-width: 0; margin: 0 0 0 -8px; }
    .marble-line-chip { position: relative; appearance: none; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
      min-width: 0; max-width: 100%; height: 28px; margin: 0; padding: 0 8px; border: 0; border-radius: 8px;
      background: none; color: var(--line-muted); font-size: 12.5px; font-weight: 400; line-height: 1; white-space: nowrap; cursor: pointer;
      transition: background-color 120ms ${COLOUR}, color 120ms ${COLOUR}; }
    .marble-line-chip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; padding: 2px 0; }
    .marble-line-chip svg { flex: none; width: 15px; height: 15px; color: var(--line-faint); transition: color 120ms ${COLOUR}; }
    .marble-line-chip[data-sug] { color: var(--line-text); }
    .marble-line-chip[data-sug] svg { color: var(--line-ink); }
    .marble-line-chip:is(:hover, :focus-visible) { background: var(--line-well); color: var(--line-text); }
    .marble-line-chip:is(:hover, :focus-visible) svg { color: var(--line-text); }
    .marble-line-chip[data-sug]:is(:hover, :focus-visible) svg { color: var(--line-ink); }
    .marble-line-chip:active { background: color-mix(in srgb, var(--line-text) 12%, transparent); }
    /* The actions are one group at the right, after the suggestions; when
       they cannot share a row with them they move down together, still at
       the right, under the send. */
    .marble-line-acts { display: flex; gap: 2px; margin-left: auto; min-width: 0; }
    .marble-line-chip[aria-pressed="true"] { color: var(--line-ink); background: var(--line-soft); }
    .marble-line-chip[aria-pressed="true"] svg { color: var(--line-ink); }
    .marble-line-chip[hidden] { display: none; }
    /* When the words and the actions will not share one row, the actions
       keep their icons and let their words go to a tip, so the suggestions
       keep their room (fitChips measures it). A finger has no hover to see a
       tip with, so on touch the words stay and the actions take a row. */
    .marble-line-chip[data-act][data-tip]::after { content: none; }
    @media (hover: hover) {
      .marble-line-offer[data-compact] .marble-line-chip[data-act] { width: 28px; padding: 0; justify-content: center; }
      .marble-line-offer[data-compact] .marble-line-chip[data-act] > span { display: none; }
      .marble-line-offer[data-compact] .marble-line-chip[data-act][data-tip]:is(:hover, :focus-visible)::after { content: attr(data-tip); }
    }
    /* A finger needs room to land. */
    @media (pointer: coarse) {
      .marble-line-chip { height: 36px; font-size: 13.5px; }
      .marble-line-send { width: 36px; height: 36px; }
      .marble-line-input { font-size: 16px; padding: 6px 0; }
    }
    .marble-line-input.is-previewing:empty::before { color: color-mix(in srgb, var(--line-ink) 70%, var(--line-faint)); }
    /* A preview keeps to one line: were it to wrap, the chips would move out
       from under the pointer showing it, and it would flicker. */
    .marble-line-input.is-previewing:empty::before { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* The words a line is about, when it is about words. */
    ::highlight(marble-line-words) { background-color: color-mix(in srgb, var(--accent, light-dark(#9bb6cf, #7fa8c9)) 34%, transparent); }

    @media (prefers-reduced-motion: reduce) {
      .marble-line { transition: opacity ${STILL}ms linear; }
      .marble-line-scope { transition: opacity ${STILL}ms linear; }
      .marble-line-open, .marble-line-opt, .marble-line-chip, .marble-line-send, .marble-line-chip svg { transition: none; }
      .marble-line [data-tip]::after { animation: none; }
    }
  `;

  const boot = (marble) => {
    const agent = marble?.agent;
    if (!agent || !marble.app) return;
    // The Agents page hosts its own conversation UI.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (document.querySelector('.marble-line-host')) return;
    const app = marble.app;

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);

    // In the top layer, so a document's own stacking contexts cannot cover it.
    const host = document.createElement('div');
    host.className = 'marble-line-host';
    host.setAttribute(TRANSIENT, '');
    host.setAttribute('popover', 'manual');
    document.documentElement.append(host);
    try { host.showPopover(); } catch { /* no popover here: fixed positioning still stands */ }
    // Over Describe mode's layer, which is shown later and would paint later.
    const raise = () => { try { host.hidePopover(); host.showPopover(); } catch { /* not a popover here */ } };
    addEventListener('marble-callout:raise', raise);
    // What the line says when it comes back on its own (an answer, why
    // nothing changed, a question) is read out, whether or not it has the keys.
    const aloud = document.createElement('div');
    aloud.className = 'marble-line-aloud';
    aloud.setAttribute('role', 'status');
    aloud.setAttribute('aria-atomic', 'true');
    host.append(aloud);

    const byId = (id) => {
      const el = id ? (marble.byId?.(id) ?? document.querySelector(`[data-marble-id="${CSS.escape(id)}"]`)) : null;
      return el && el.isConnected && !el.closest(`[${TRANSIENT}]`) ? el : null;
    };
    const elementsOf = (ids) => (ids ?? []).map(byId).filter(Boolean);
    const said = (node) => (node?.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    const viewW = () => document.documentElement.clientWidth || innerWidth;
    const viewH = () => document.documentElement.clientHeight || innerHeight;
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));

    // ------------------------------------------------------------ motion
    // Arriving and leaving are the card's small move run in opposite
    // directions: out of the thing (or up from the foot) and back into it.
    // Reduced motion keeps a short fade and nothing else.

    const still = () => stillness.matches;
    const motion = (el, frames, timing) => {
      try { return el.animate(frames, timing); } catch { return null; }
    };
    const riseOf = (el) => (el.hasAttribute('data-flip') || el.dataset.scope === 'page' ? RISE : -RISE);
    const away = (el) => `translateY(${riseOf(el)}px) scale(0.98)`;
    function arrive(el) {
      if (still()) return motion(el, [{ opacity: 0 }, { opacity: 1 }], { duration: STILL, easing: 'linear' });
      return motion(el, [{ opacity: 0, transform: away(el) }, { opacity: 1, transform: 'none' }], { duration: ARRIVE, easing: EASE });
    }
    function depart(el) {
      if (still()) return motion(el, [{ opacity: 1 }, { opacity: 0 }], { duration: STILL, easing: 'linear', fill: 'forwards' });
      return motion(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: away(el) }], { duration: ARRIVE, easing: EASE, fill: 'forwards' });
    }
    function fadeIn(el) {
      return motion(el, [{ opacity: 0 }, { opacity: 1 }], still() ? { duration: STILL, easing: 'linear' } : { duration: ARRIVE, easing: EASE });
    }
    function cascade(chips, after = 60) {
      chips.forEach((chip, i) => {
        if (still()) motion(chip, [{ opacity: 0 }, { opacity: 1 }], { duration: STILL, easing: 'linear', fill: 'backwards' });
        else motion(chip, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: CASCADE, delay: after + i * STEP, easing: EASE, fill: 'backwards' });
      });
    }

    // ------------------------------------------------------------ drafts
    // Words put away with Esc wait, per thing, for this tab's next ⌘J on it.

    const DRAFTS = `marble-line-drafts:${app}`;
    const drafts = () => {
      try { return JSON.parse(sessionStorage.getItem(DRAFTS) || '{}') ?? {}; } catch { return {}; }
    };
    const keepDraft = (key, text) => {
      const all = drafts();
      if (text) all[key] = text;
      else delete all[key];
      try { sessionStorage.setItem(DRAFTS, JSON.stringify(all)); } catch { /* private mode: the words go with the line */ }
    };

    // ------------------------------------------------------------ sessions
    // One session per thing asked about: its scope, its conversation once
    // there is one, and the turn it is waiting on. One line is on screen at
    // a time; a session whose change still runs keeps its tint, and comes
    // back to the line when its work has something to say.

    const sessions = new Set();
    let shown = null;

    const keyOf = (s) => (s.page ? 'page' : s.words ? `words:${s.words.text}` : s.ids.join(','));

    function placeholderOf(s) {
      if (s.lent) return s.lent.label || 'Describe the change';
      if (s.page) return 'Change this page';
      if (s.words) return 'Change these words';
      const els = elementsOf(s.ids);
      if (els.length > 1) {
        const units = [...new Set(els.map((el) => unitOf(el)[1]))];
        return `Change these ${els.length} ${units.length === 1 ? units[0] : 'parts'}`;
      }
      return `Change this ${unitOf(els[0])[0]}`;
    }

    function makeSession({ ids, scope, from, conversation }) {
      const page = !ids.length;
      const range = !page && scope && typeof scope === 'object' && scope.words ? scope.range : null;
      const words = range && !range.collapsed
        ? { range: range.cloneRange(), text: range.toString().replace(/\s+/g, ' ').trim() }
        : null;
      let chain = !page && scope && Array.isArray(scope.chain) ? scope.chain.filter(Boolean) : [];
      let index = Number(scope?.index) || 0;
      if (ids.length === 1) {
        const el = byId(ids[0]);
        if (!chain.length && el) { chain = globalThis.marbleScope?.chainFrom(el) ?? [el]; index = 0; }
        const at = chain.indexOf(el);
        if (at >= 0) index = at;
      }
      return {
        ids: [...ids], page, words, chain, index, from,
        action: null, conversation: conversation ?? null, convo: null, off: null, after: 0,
        turn: null, awaiting: false, asked: '', texts: [], ask: null,
        state: null, el: null, input: null, tint: null, handed: false, failed: false,
        answer: '', said: '', returnTo: null, stop: false, tried: false,
        offer: null, chips: null, drafted: null, lent: null,
      };
    }

    const running = () => {
      let found = null;
      for (const s of sessions) if (s.conversation && s.turn) found = s;
      return found ? { conversation: found.conversation, turn: found.turn } : null;
    };
    const busy = (s) => Boolean(s.turn || s.awaiting);

    /** Done with a session: its line, its tint, its stream and its hidden
     *  conversation go. */
    function drop(s) {
      sessions.delete(s);
      if (s.conversation) document.dispatchEvent(new CustomEvent('marble-line:done', { detail: { conversation: s.conversation } }));
      if (shown === s) shown = null;
      s.off?.();
      s.off = null;
      s.convo?.remove();
      s.convo = null;
      if (s.el) { const el = s.el; s.el = null; s.input = null; leave(el); }
      handOff(s);
      schedule();
    }

    // ------------------------------------------------------------ the tint

    function paintScope(s) {
      const want = !s.page && !s.words && !s.handed && !s.lent && sessions.has(s);
      if (want && !s.tint) {
        const tint = document.createElement('i');
        tint.className = 'marble-line-scope';
        tint.setAttribute(TRANSIENT, '');
        tint.setAttribute('aria-hidden', 'true');
        host.prepend(tint);
        s.tint = tint;
        fadeIn(tint);
      } else if (!want && s.tint) {
        const tint = s.tint;
        s.tint = null;
        tint.dataset.state = 'out';
        for (const a of tint.getAnimations()) a.cancel();
        const gone = () => tint.remove();
        const out = motion(tint, [{ opacity: 1 }, { opacity: 0 }], still() ? { duration: STILL, easing: 'linear', fill: 'forwards' } : { duration: ARRIVE, easing: EASE, fill: 'forwards' });
        if (out) out.finished.then(gone, gone);
        else gone();
      }
      paintWords();
    }

    function paintWords() {
      if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return;
      const ranges = [...sessions].filter((s) => s.words && !s.handed).map((s) => s.words.range);
      if (ranges.length) CSS.highlights.set('marble-line-words', new Highlight(...ranges));
      else CSS.highlights.delete('marble-line-words');
    }

    /** The marks have the change now (or it is over): this layer's tint
     *  gives way to theirs. */
    function handOff(s) {
      if (s.handed && !s.tint) return;
      s.handed = true;
      paintScope(s);
    }
    const claimed = (s) => {
      const client = `agent:${s.conversation}`;
      return Boolean(window.marbleChange?.claims?.(client) || window.marbleText?.claims?.(client));
    };
    const checkClaims = () => {
      for (const s of sessions) if (s.conversation && !s.handed && busy(s) && s.state !== 'edit' && claimed(s)) handOff(s);
    };
    addEventListener('marble-change:claims', checkClaims);
    addEventListener('marble-text:claims', checkClaims);
    // After the marks have read the frame (they listen in capture).
    document.addEventListener('marble:presence', () => queueMicrotask(checkClaims));

    // ------------------------------------------------------------ geometry

    function rectOf(els) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
      }
      return left === Infinity ? null : { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    function placeLine(s, r) {
      const el = s.el;
      const vw = viewW();
      // Describe mode's toolbar is the floor of a line lent to it.
      const vh = Math.min(viewH(), s.lent?.floor?.() ?? Infinity);
      if (!r) {
        const width = Math.min(PAGE, vw - 32);
        el.style.width = `${Math.round(width)}px`;
        fitChips(s);
        const h = el.offsetHeight;
        Object.assign(el.style, { left: `${Math.round((vw - width) / 2)}px`, top: `${Math.round(vh - FOOT - h)}px` });
        el.toggleAttribute('data-flip', false);
        return;
      }
      const width = Math.min(Math.max(r.width, NARROW), WIDE, vw - INSIDE * 2);
      // Flush with its thing; centred on it when the thing is narrower than a
      // line can be.
      const left = clamp(r.width >= NARROW ? r.left : r.left + r.width / 2 - width / 2, INSIDE, vw - INSIDE - width);
      el.style.width = `${Math.round(width)}px`;
      fitChips(s);
      const h = el.offsetHeight;
      let top = r.bottom + GAP;
      let flip = false;
      if (top + h > vh - INSIDE && r.top - GAP - h >= INSIDE) { top = r.top - GAP - h; flip = true; }
      top = clamp(top, INSIDE, Math.max(INSIDE, vh - INSIDE - h));
      Object.assign(el.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
      el.toggleAttribute('data-flip', flip);
    }

    const observed = new Set();
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
    const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    function watch(els) {
      if (!resized) return;
      const want = new Set(els);
      for (const el of observed) if (!want.has(el)) { resized.unobserve(el); observed.delete(el); }
      for (const el of want) if (!observed.has(el)) { resized.observe(el); observed.add(el); }
    }

    function place() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const watching = [];
      for (const s of [...sessions]) {
        // Lent to Describe mode: it hangs under the marks, where the mode says.
        if (s.lent) {
          if (s === shown && s.el && !s.el.hidden && s.lent.span) { placeLine(s, s.lent.span); watching.push(s.el); }
          continue;
        }
        const els = s.page ? [] : elementsOf(s.ids);
        watching.push(...els);
        // The thing went: a line still being written goes with it, and keeps
        // its words. One with something to say says it at the foot instead.
        if (s === shown && s.el && !s.page && !els.length && s.state === 'edit') { put(s, { keep: true }); continue; }
        const r = els.length ? rectOf(els) : null;
        if (s.tint) {
          s.tint.hidden = !r;
          if (r) {
            Object.assign(s.tint.style, {
              left: `${Math.round(r.left - OUT)}px`, top: `${Math.round(r.top - OUT)}px`,
              width: `${Math.round(r.width + OUT * 2)}px`, height: `${Math.round(r.height + OUT * 2)}px`,
            });
          }
        }
        if (s === shown && s.el) {
          if (s.page || r || !els.length) placeLine(s, s.page ? null : r);
          watching.push(s.el);
        }
      }
      watch(watching);
    }
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('marble:ops', schedule);

    // ------------------------------------------------------------ drawing

    const h = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };

    function makeInput(s, label, text = '') {
      const input = h('div', 'marble-line-input');
      input.setAttribute('contenteditable', 'plaintext-only');
      if (input.contentEditable !== 'plaintext-only') input.setAttribute('contenteditable', 'true');
      input.setAttribute('role', 'textbox');
      input.setAttribute('aria-multiline', 'true');
      input.setAttribute('aria-label', label);
      input.dataset.placeholder = label;
      input.spellcheck = true;
      input.textContent = text;
      input.addEventListener('keydown', (event) => onKey(s, event));
      input.addEventListener('input', () => {
        // An emptied line holds a stray break, which would hide its placeholder.
        if (!input.textContent) input.replaceChildren();
        // Clearing the line lets an action's draft go.
        if (!said(input) && s.action) { s.action = null; s.drafted = null; paintActs(s); }
        schedule();
      });
      // A paste is words, not somebody else's markup.
      input.addEventListener('paste', (event) => {
        const plain = event.clipboardData?.getData('text/plain');
        if (plain == null) return;
        event.preventDefault();
        document.execCommand('insertText', false, plain);
      });
      return input;
    }
    /** In Describe mode the marks can say it all: ⏎ with no words sends them. */
    const MARKS_ONLY = 'Make the change these marks describe.';
    const marksOnly = (s) => (s.lent && s.state === 'edit' && s.lent.brief?.() ? MARKS_ONLY : '');

    /** Send: the press that ⏎ is. It fills once there are words to send,
     *  and a press must not take the caret out of them. */
    const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
    function sendButton(s, input, label = 'Send') {
      const b = h('button', 'marble-line-send');
      b.type = 'button';
      b.innerHTML = globalThis.marbleOffer?.ICONS?.send ?? SEND_ICON;
      b.setAttribute('aria-label', label);
      b.dataset.tip = `${label} ⏎`;
      // ⏎ is the keyboard's send, so Tab goes from the words to what they could become.
      b.tabIndex = -1;
      b.addEventListener('pointerdown', (event) => event.preventDefault());
      b.addEventListener('click', () => {
        const text = said(input) || marksOnly(s);
        if (!text || s.input !== input) return;
        if (s.state === 'ask') reply(s, text);
        else send(s, text);
      });
      const sync = () => b.toggleAttribute('data-ready', !!(said(input) || marksOnly(s)));
      new MutationObserver(sync).observe(input, { childList: true, characterData: true, subtree: true });
      s.syncSend = sync;
      sync();
      return b;
    }

    // ------------------------------------------------------------ the offer
    // What the thing could become, under the words while they are written:
    // its kind's two suggestions (then the ones the host writes for it), and
    // the six actions, each as the card's offer had them (agent-offer.js).

    const offering = () => globalThis.marbleOffer;

    function kindOf(s, els = elementsOf(s.ids)) {
      const kinds = [...new Set(els.map((el) => globalThis.marbleScope?.kindOf(el) ?? 'part'))];
      return s.words ? 'words' : els.length > 1 ? (kinds.length === 1 ? kinds[0] : 'part') : kinds[0] ?? 'part';
    }

    /** The page's own line has nothing it could sensibly suggest. Describe
     *  mode's line is about whatever is marked, which changes as the marks
     *  do: it offers the actions for what is marked, and no suggestions,
     *  which are written for one thing. */
    function offerOf(s) {
      if (!offering()?.offerFor) return null;
      if (s.lent) return { ...offering().offerFor({ kind: 'part' }), gaps: null, thisWhat: 'what is marked' };
      if (s.page) return null;
      const els = elementsOf(s.ids);
      if (!els.length) return null;
      return offering().offerFor({ kind: kindOf(s, els), count: els.length, element: els[0] });
    }

    /** Ask the host to write suggestions for this thing; they take the
     *  defaults' place when they come. */
    function askOffer(s) {
      const o = offering();
      const asked = s.offer;
      if (!asked || s.lent || !o?.fetchOffer || !o.takeWritten) return;
      o.fetchOffer({ path: app, ids: [...s.ids], words: s.words?.text ?? '' }).then((written) => {
        if (!sessions.has(s) || s.offer !== asked) return;
        if (o.takeWritten(asked.offer, written, asked.gaps) && s.state === 'edit' && s.chips?.isConnected) paintSugs(s, { arriving: true });
      }, () => { /* the defaults stand */ });
    }

    const wordsFor = (s, id) => offering().actionWords(id, s.offer.thisWhat, s.offer.offer);

    function chip(text, icon = null) {
      const b = h('button', 'marble-line-chip');
      b.type = 'button';
      if (icon) b.innerHTML = icon;
      b.append(h('span', '', text));
      // A press must not take the caret out of the words it is drafting into.
      b.addEventListener('pointerdown', (event) => event.preventDefault());
      return b;
    }

    function chipRow(s) {
      const row = h('div', 'marble-line-offer');
      row.setAttribute(TRANSIENT, '');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Suggestions');
      row.addEventListener('keydown', (event) => {
        if ((event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') || event.altKey || event.metaKey || event.ctrlKey) return;
        const list = [...row.querySelectorAll('.marble-line-chip:not([hidden])')];
        const at = list.indexOf(document.activeElement);
        if (at < 0) return;
        event.preventDefault();
        list[(at + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length].focus();
      });
      const icons = offering().ICONS ?? {};
      const acts = h('div', 'marble-line-acts');
      row.append(acts);
      for (const [id, name] of offering().ACTIONS ?? []) {
        // In Describe mode already: its own tools are the sketch.
        if (id === 'sketch' && s.lent) continue;
        const b = chip(name, icons[id]);
        b.dataset.act = id;
        b.dataset.tip = name;
        b.setAttribute('aria-label', name);
        b.setAttribute('aria-pressed', 'false');
        // Pointing at an action shows, in an empty line, what it would ask.
        b.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch') preview(s, id, true); });
        b.addEventListener('pointerleave', () => preview(s, id, false));
        b.addEventListener('focus', () => preview(s, id, true));
        b.addEventListener('blur', () => preview(s, id, false));
        b.addEventListener('click', () => pick(s, id));
        acts.append(b);
      }
      s.chips = row;
      paintSugs(s);
      paintActs(s);
      return row;
    }

    function paintSugs(s, { arriving = false } = {}) {
      const row = s.chips;
      if (!row || !s.offer) return;
      for (const old of row.querySelectorAll('[data-sug]')) old.remove();
      const before = row.querySelector('.marble-line-acts');
      const made = (s.lent ? [] : s.offer.offer.sugs.slice(0, 2)).map((text) => {
        const b = chip(text, offering().ICONS?.suggest ?? null);
        b.dataset.sug = '';
        b.addEventListener('click', () => suggest(s, text));
        row.insertBefore(b, before);
        return b;
      });
      row.fitted = null;
      if (arriving) { cascade(made, 0); schedule(); }
    }

    const paintActs = (s) => {
      for (const b of s.chips?.querySelectorAll('[data-act]') ?? []) b.setAttribute('aria-pressed', String(b.dataset.act === s.action?.mode));
    };

    /** At most two rows of chips inside the line: past that, the second
     *  suggestion goes first, then the actions from the last, then the first
     *  suggestion. Measured again only when the line's width or chips change. */
    function fitChips(s) {
      const row = s.chips;
      if (!row?.isConnected) return;
      const all = [...row.querySelectorAll('.marble-line-chip')];
      const key = `${s.el?.style.width}|${all.map((c) => c.textContent).join('|')}`;
      if (row.fitted === key) return;
      row.fitted = key;
      for (const c of all) c.hidden = false;
      row.removeAttribute('data-compact');
      const rows = () => new Set(all.filter((c) => !c.hidden).map((c) => c.offsetTop)).size;
      // One row if the actions can give up their words for it (not on touch).
      if (rows() > 1 && matchMedia('(hover: hover)').matches) row.setAttribute('data-compact', '');
      if (rows() <= 2) return;
      const sugs = all.filter((c) => c.hasAttribute('data-sug'));
      const act = (id) => all.find((c) => c.dataset.act === id);
      const order = [...sugs.slice(1).reverse(), act('sketch'), act('visual'), act('interactive'), act('alive'), act('automate'), sugs[0], act('variations')];
      for (const c of order.filter(Boolean)) {
        if (rows() <= 2) break;
        c.hidden = true;
      }
    }

    /** A suggestion fills the line with its words, the caret at the end. */
    function suggest(s, text) {
      if (!s.input) return;
      s.input.textContent = text;
      s.action = null;
      s.drafted = null;
      paintActs(s);
      caretAt(s.input);
      schedule();
    }

    function preview(s, id, on) {
      const input = s.input;
      if (!input || !s.offer) return;
      if (on && !input.textContent) {
        const a = wordsFor(s, id);
        input.dataset.placeholder = id === 'sketch' ? a.line : a.lead + a.idea;
        input.classList.add('is-previewing');
      } else {
        input.dataset.placeholder = placeholderOf(s);
        input.classList.remove('is-previewing');
      }
    }

    /** An action, as the card's were: Sketch it hands the thing to Describe
     *  mode; the others draft their words for it. On an empty line, or one
     *  still holding an untouched draft, the draft replaces it, with the idea
     *  after the lead selected to type over; over words the person typed, the
     *  action only frames them. Pressing it again clears its own draft. */
    function pick(s, id) {
      const input = s.input;
      if (!input || !s.offer) return;
      if (id === 'sketch') {
        const ids = [...s.ids];
        put(s, { keep: true, restore: false });
        dispatchEvent(new CustomEvent('marble-marks:toggle', { detail: { on: true, ids } }));
        return;
      }
      const a = wordsFor(s, id);
      const t = said(input);
      const untouched = !t || t === s.drafted;
      if (s.action?.mode === id && untouched) {
        input.replaceChildren();
        s.action = null;
        s.drafted = null;
        paintActs(s);
        caretAt(input);
        schedule();
        return;
      }
      const leads = (offering().ACTIONS ?? []).map(([other]) => wordsFor(s, other).lead).filter(Boolean);
      const had = leads.find((lead) => input.textContent.startsWith(lead));
      const rest = untouched ? a.idea : had ? input.textContent.slice(had.length) : t;
      input.textContent = a.lead + rest;
      input.classList.remove('is-previewing');
      input.dataset.placeholder = placeholderOf(s);
      s.action = { mode: id, lead: a.lead.trim() };
      s.drafted = said(input);
      if (untouched && a.idea) caretAt(input, a.lead.length, a.lead.length + a.idea.length);
      else caretAt(input);
      paintActs(s);
      schedule();
    }

    function caretAt(input, from = null, to = null) {
      input.focus({ preventScroll: true });
      const range = document.createRange();
      const node = input.firstChild;
      if (node?.nodeType === 3 && from != null) {
        range.setStart(node, Math.min(from, node.length));
        range.setEnd(node, Math.min(to ?? node.length, node.length));
      } else {
        range.selectNodeContents(input);
        range.collapse(false);
      }
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    /** Where the keys were before the line took them: the element, and the
     *  caret when it was in something editable. */
    function keysNow() {
      let a = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      if (!a || a === document.body || a === document.documentElement || host.contains(a)) return null;
      const sel = getSelection();
      const range = a.isContentEditable && sel?.rangeCount && a.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
      return { el: a, range };
    }
    function giveBack(to) {
      if (!to?.el?.isConnected) return;
      to.el.focus({ preventScroll: true });
      if (to.range && to.el.contains(to.range.startContainer)) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(to.range);
      }
    }
    const holdsKeys = (s) => Boolean(s.el && s.el.contains(document.activeElement));

    // A line coming back on its own takes the keys only from nobody.
    const mayTakeFocus = () => {
      const a = document.activeElement;
      return !a || a === document.body || a === document.documentElement || host.contains(a);
    };

    /** Draw `s` in the line, in `state`. */
    function show(s, state, { text = '', focus = true } = {}) {
      // A line taking the place of one that had the keys gives them back,
      // when it goes, to where that one would have.
      const inherited = shown && shown !== s && holdsKeys(shown) ? shown.returnTo : null;
      if (shown && shown !== s) put(shown, { keep: true, restore: false });
      shown = s;
      s.state = state;
      let el = s.el;
      // New, or coming back while it was still folding away: it arrives.
      const arriving = !el || el.dataset.state === 'sent';
      if (!el) {
        el = h('div', 'marble-line');
        el.setAttribute(TRANSIENT, '');
        // Esc anywhere in the line, its words or its buttons, puts it away.
        el.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape' || event.isComposing || s.el !== el) return;
          event.preventDefault();
          event.stopPropagation();
          put(s, { keep: true });
        });
        host.append(el);
        s.el = el;
      }
      for (const a of el.getAnimations({ subtree: true })) a.cancel();
      el.style.pointerEvents = '';
      el.dataset.state = state;
      if (s.page) el.dataset.scope = 'page';
      else delete el.dataset.scope;
      el.toggleAttribute('data-failed', state === 'cant' && s.failed);
      el.replaceChildren();
      s.chips = null;
      let input = null;
      if (state === 'edit' || state === 'cant' || state === 'setup') {
        const label = placeholderOf(s);
        if (state === 'cant') el.append(h('p', 'marble-line-said', s.said));
        if (state === 'setup') {
          const why = h('div', 'marble-line-setup');
          const go = h('button', 'marble-line-open', 'Set up');
          go.type = 'button';
          go.addEventListener('click', () => openSetup());
          why.append(h('p', 'marble-line-said', s.said), go);
          el.append(why);
        }
        input = makeInput(s, label, text);
        const row = h('div', 'marble-line-row');
        row.append(input, sendButton(s, input));
        el.append(row);
        if (state === 'edit' && s.offer && offering()?.actionWords) el.append(chipRow(s));
      } else if (state === 'answer') {
        const answer = h('p', 'marble-line-answer', s.answer);
        el.append(answer);
        if (s.answer.length > LONG && s.conversation) {
          const open = h('button', 'marble-line-open', 'Open in chat');
          open.type = 'button';
          open.addEventListener('click', () => {
            const id = s.conversation;
            put(s, { keep: false, restore: false });
            agent.open?.(id);
          });
          el.append(open);
        }
        input = makeInput(s, 'Ask more');
        const row = h('div', 'marble-line-row marble-line-more');
        row.append(input, sendButton(s, input, 'Ask'));
        el.append(row);
      } else if (state === 'ask') {
        const q = s.ask?.input?.questions?.[0] ?? {};
        const ask = h('div', 'marble-line-ask');
        const opts = h('div', 'marble-line-opts');
        opts.setAttribute('role', 'group');
        opts.setAttribute('aria-label', q.question ?? '');
        for (const option of q.options ?? []) {
          const b = h('button', 'marble-line-opt', option.label);
          b.type = 'button';
          if (option.description) b.title = option.description;
          b.addEventListener('click', () => reply(s, option.label));
          opts.append(b);
        }
        ask.append(h('span', 'marble-line-question', q.question ?? ''), opts);
        el.append(ask);
        input = makeInput(s, 'Type an answer');
        const row = h('div', 'marble-line-row');
        row.append(input, sendButton(s, input, 'Answer'));
        el.append(row);
      }
      s.input = input;
      paintScope(s);
      place();
      if (arriving) arrive(el);
      if (s.chips) cascade([...s.chips.querySelectorAll('.marble-line-chip')].filter((c) => !c.hidden));
      if (state === 'answer' || state === 'cant' || state === 'ask' || state === 'setup') {
        aloud.textContent = state === 'answer' ? s.answer : state === 'cant' || state === 'setup' ? s.said : (s.ask?.input?.questions?.[0]?.question ?? '');
      } else aloud.textContent = '';
      if (input && focus) {
        if (!holdsKeys(s)) s.returnTo = keysNow() ?? inherited;
        caretAt(input);
        // Again once it has its place, in case something took the keys back
        // while it was drawn.
        requestAnimationFrame(() => { if (s.input === input && document.activeElement !== input && mayTakeFocus()) caretAt(input); });
      }
    }

    /** A line leaving: the way it came, back, then gone. One already
     *  folding into its thing finishes folding instead. */
    function leave(el) {
      el.style.pointerEvents = 'none';
      // No longer the line: nothing should take it for the one on screen.
      el.setAttribute('data-leaving', '');
      el.inert = true;
      const gone = () => el.remove();
      if (el.dataset.state === 'sent') {
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).then(gone, gone);
        return;
      }
      for (const a of el.getAnimations({ subtree: true })) a.cancel();
      const out = depart(el);
      if (out) out.finished.then(gone, gone);
      else gone();
    }

    /** Put the line away, keeping its words (or not) for this thing, and
     *  give the keys back to where they were if the line had them: at once
     *  (`restore: true`), or after a press outside if that press did not take
     *  them itself (`'press'`). */
    function put(s, { keep = true, restore = true } = {}) {
      if (!s) return;
      const was = s.state;
      // Put away before it sent: the mode that lent it hangs a fresh one.
      if (s.lent && was !== 'sent') { const closed = s.lent.onClose; s.lent = null; closed?.(); }
      const had = holdsKeys(s);
      const to = s.returnTo;
      // Words typed in any of its inputs (an ask, more to an answer, a draft)
      // wait for the next ⌘J on the same thing.
      if (s.input) {
        const words = said(s.input);
        if (keep && words) keepDraft(keyOf(s), words);
        else if (!keep || was === 'edit' || was === 'cant' || was === 'setup') keepDraft(keyOf(s), '');
      }
      if (shown === s) shown = null;
      aloud.textContent = '';
      if (s.el) { const el = s.el; s.el = null; s.input = null; leave(el); }
      if (had && restore === true) giveBack(to);
      else if (had && restore === 'press') {
        // Wait for the press to land: one that focused something has
        // decided where the keys go. A press cancelled lands nowhere, and
        // the next one is not this one.
        const heard = new AbortController();
        const listening = { capture: true, signal: heard.signal };
        addEventListener('pointerup', () => {
          heard.abort();
          setTimeout(() => {
            const a = document.activeElement;
            if (!a || a === document.body || a === document.documentElement) giveBack(to);
          }, 0);
        }, listening);
        addEventListener('pointercancel', () => heard.abort(), listening);
      }
      if (busy(s)) {
        // Its change still runs: the line goes, the session stays for what
        // the work says next.
        s.state = 'sent';
      } else {
        s.state = null;
        drop(s);
      }
      if (was === 'edit' || was === 'setup') agent.select(null);
      document.dispatchEvent(new CustomEvent('marble-line:closed'));
    }

    /** ⏎: the words go and the line closes its height into the thing. The
     *  keys go back where they were, unless that was inside the thing being
     *  changed: a caret there would hold the change off its own part (the
     *  engine and the marks leave a part with a hand in it alone). */
    function fold(s) {
      if (shown === s) shown = null;
      s.state = 'sent';
      aloud.textContent = '';
      const el = s.el;
      if (!el) return;
      el.dataset.state = 'sent';
      el.style.pointerEvents = 'none';
      if (s.input) {
        const had = holdsKeys(s);
        s.input.setAttribute('contenteditable', 'false');
        if (document.activeElement === s.input) s.input.blur();
        const to = s.returnTo;
        const inThing = to && elementsOf(s.ids).some((part) => part.contains(to.el) || to.el.contains(part));
        if (had && to && !inThing) giveBack(to);
      }
      // A line that came back before it finished closing is not this one's.
      const gone = () => {
        if (s.el !== el || s.state !== 'sent') return;
        s.el = null;
        s.input = null;
        el.remove();
        document.dispatchEvent(new CustomEvent('marble-line:closed'));
      };
      try {
        if (stillness.matches) {
          el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: STILL, fill: 'forwards' }).finished.then(gone, gone);
          return;
        }
        for (const child of el.children) child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE, easing: EASE, fill: 'forwards' });
        el.animate([{ transform: 'scaleY(1)', opacity: 1 }, { transform: 'scaleY(0)', opacity: 0 }], { duration: CLOSE, delay: FADE - 20, easing: EASE, fill: 'forwards' })
          .finished.then(gone, gone);
      } catch { gone(); }
    }

    // ------------------------------------------------------------ keys

    function onKey(s, event) {
      if (event.isComposing) return;
      const input = s.input;
      if (event.key === 'Enter') {
        event.preventDefault();
        // ⇧⏎ (and ⌥⏎) break the line; the input grows to three lines, then scrolls.
        if (event.shiftKey || event.altKey) { document.execCommand('insertLineBreak'); return; }
        const text = said(input) || marksOnly(s);
        if (!text) return;
        if (s.state === 'ask') reply(s, text);
        else send(s, text);
        return;
      }
      // [ takes in the containing element, ] steps back in, while the line
      // has nothing in it to type them into.
      if ((event.key === '[' || event.key === ']') && !event.altKey && !event.metaKey && !event.ctrlKey
        && s.state === 'edit' && !input?.textContent && s.ids.length === 1) {
        const next = s.index + (event.key === '[' ? 1 : -1);
        const el = s.chain[next];
        if (!el?.isConnected) return;
        event.preventDefault();
        s.index = next;
        s.ids = [el.getAttribute('data-marble-id')];
        s.words = null;
        agent.select(s.ids);
        const label = placeholderOf(s);
        input.dataset.placeholder = label;
        input.setAttribute('aria-label', label);
        // What it could become is for the new thing now.
        s.offer = offerOf(s);
        if (s.offer && s.chips) { paintSugs(s, { arriving: true }); askOffer(s); }
        paintScope(s);
        place();
      }
    }

    // A click away from words being written: the ask waits as a note on its
    // thing (agent-notes.js), not also as a draft, and the line goes, so the
    // next thing can be pointed at. False when there is nowhere to keep it
    // (the page's own line, a page without notes).
    function stash(s, text, { restore = true } = {}) {
      const notes = window.marbleNotes;
      if (!notes || !text || s.page || !s.ids.length) return false;
      const mode = s.action && text.startsWith(s.action.lead) ? s.action.mode : 'main';
      notes.add({ ids: [...s.ids], text, brief: globalThis.marbleOffer?.briefFor?.(mode, s.ids) ?? '', name: window.marbleCallout?.nameFor?.(s.ids) ?? '' });
      put(s, { keep: false, restore });
      agent.select(null);
      return true;
    }

    // ------------------------------------------------------------ sending

    /** What rides beside the words, unseen: where they were asked, and how
     *  the answer comes back. */
    function briefFor(s) {
      const at = s.ids.map((id) => `[data-marble-id="${id}"]`).join(', ');
      const where = s.lent
        ? 'Asked in Describe mode, in a line under marks the person drew on the page; what they marked follows.'
        : s.page
        ? 'Asked in a line at the foot of the page the person is looking at, about the whole page.'
        : s.words
          ? `Asked in a line under the words "${s.words.text.slice(0, 300)}" in ${at}, on the page the person is looking at.`
          : `Asked in a line under ${at}, on the page the person is looking at.`;
      return [
        where,
        'Change it in place: the page changing is the answer, and the person watches it change.',
        'If the words ask a question, answer in a sentence or two in that line and change nothing.',
        'If nothing can be changed, say why in one sentence.',
      ].join(' ');
    }

    function convoFor(s) {
      if (s.convo?.isConnected) return s.convo;
      // A real conversation, kept out of sight: the line is its composer.
      const convo = document.createElement('marble-conversation');
      convo.setAttribute(TRANSIENT, '');
      convo.dataset.chrome = 'callout';
      convo.setAttribute('project', 'drive');
      convo.setAttribute('data-folded', '');
      convo.style.display = 'none';
      convo.addEventListener('conversation', (event) => {
        const id = event.detail?.id ?? null;
        if (!id || id === s.conversation) return;
        s.conversation = id;
        agent.attend?.(id);
        follow(s, id);
      });
      host.append(convo);
      // The attribute after the append: the component only loads once connected.
      if (s.conversation) convo.setAttribute('conversation', s.conversation);
      s.convo = convo;
      return convo;
    }

    async function follow(s, id, { baseline = false } = {}) {
      s.off?.();
      s.off = null;
      s.after = 0;
      // A conversation that already has turns: only what happens from here
      // on is this line's.
      if (baseline) {
        try { s.after = Number((await agent.conversation(id, { turns: 0 }))?.seq) || 0; } catch { s.after = 0; }
      }
      if (!sessions.has(s)) return;
      s.off = agent.on(id, (event) => onEvent(s, event), { after: s.after });
    }

    /** Whether these words are tried as one rule first: the first send of a
     *  new ask in the line (not more to an answer, not a change more, not a
     *  send again after one that could not be made), about parts rather than
     *  words in a sentence, no question and no drafted action, and sounding
     *  like a look. */
    function oneRule(s, text, { brief, keepWords }) {
      return typeof window.marbleRules?.fromWords === 'function' && !s.tried && s.state === 'edit'
        && !s.conversation && !brief && !keepWords && !s.words
        && !(s.action && text.startsWith(s.action.lead)) && !isQuestion(text) && LOOK.test(text);
    }

    async function send(s, text, { brief = null, keepWords = false } = {}) {
      // Lent to Describe mode, what is marked is read as it is sent: the
      // marks may have changed since the line was lent.
      if (s.lent?.ids) s.ids = s.lent.ids().filter((id) => byId(id));
      const ids = [...s.ids];
      // The marks say more than words can: a Describe brief is not one rule.
      const rule = s.lent ? null : oneRule(s, text, { brief, keepWords });
      // Nothing here can take it, as already known (asked when the line
      // opened): the line stays as it is and says so, rather than folding
      // into a send that can only fail. A rule needs nobody, so it is tried
      // first all the same.
      if (!rule && readyNow() === false) { unready(s, text); return; }
      s.tried = true;
      // Words tried as one rule wait in the drafts until they are the page,
      // or on their way to the agent: a reload meanwhile keeps them.
      if (rule) keepDraft(keyOf(s), text);
      else if (!keepWords) keepDraft(keyOf(s), '');
      s.asked = text;
      s.texts = [];
      s.turn = null;
      s.awaiting = true;
      s.stop = false;
      s.ask = null;
      s.failed = false;
      s.handed = false;
      if (rule) {
        // The line folds in as for any send; the page marks what it will
        // change (and the line's tint gives way to those marks), then changes
        // it. Esc before it lands stops it, and nothing goes anywhere.
        fold(s);
        paintScope(s);
        let took = false;
        try {
          took = await window.marbleRules.fromWords({
            words: text, ids, onMarks: () => handOff(s), stopped: () => s.stop || !sessions.has(s),
          });
        } catch {
          took = false;
        }
        if (took || s.stop || !sessions.has(s)) {
          // Stopped, the words stay for the next ⌘J on the same thing.
          if (took && !s.stop) keepDraft(keyOf(s), '');
          s.awaiting = false;
          s.stop = false;
          agent.select(null);
          if (sessions.has(s)) drop(s);
          return;
        }
        // Not one rule: the agent is asked, exactly as it would have been.
        if (!keepWords) keepDraft(keyOf(s), '');
      }
      const mode = s.action && text.startsWith(s.action.lead) ? s.action.mode : 'main';
      const meaning = mode === 'main' ? '' : (globalThis.marbleOffer?.briefFor?.(mode, ids) ?? '');
      const hidden = [briefFor(s), meaning, brief, s.lent?.brief?.()].filter(Boolean).join('\n\n');
      if (mode === 'variations') dispatchEvent(new CustomEvent('marble-variations:watch', { detail: { ids } }));
      if (!rule) fold(s);
      paintScope(s);
      // Not known yet whether anything can take it: asked now, and a no
      // brings the line back with the words, before anything is sent. (Esc
      // meanwhile stops it, as for any send without a turn yet.)
      if (readyNow() !== true && (await ready()) === false) {
        s.awaiting = false;
        s.stop = false;
        if (sessions.has(s)) unready(s, text);
        return;
      }
      if (s.conversation && !s.off) await follow(s, s.conversation, { baseline: true });
      const convo = convoFor(s);
      // Pinned for the send, so the brief carries what the line is about,
      // and let go after it: the next selection is the person's again.
      agent.select(ids.length ? ids : null);
      agent.brief?.(hidden);
      if (s.words?.range) dispatchEvent(new CustomEvent('marble-text:words', { detail: { range: s.words.range } }));
      try {
        await convo.sendNow(text);
      } finally {
        agent.select(null);
      }
      // A send the host refused leaves the words in the composer, and the
      // reason in its log.
      const stuck = String(convo.input?.value ?? '').trim() || !convo.getAttribute('conversation');
      if (stuck) {
        // The host's own words are for the console; the page says it plainly.
        const why = [...(convo.shadowRoot?.querySelectorAll('.system.error') ?? [])].at(-1)?.textContent?.trim();
        if (why) console.warn(`marble-line: the send was refused: ${why}`);
        try { convo.input.value = ''; } catch { /* nothing to clear */ }
        s.awaiting = false;
        s.stop = false;
        s.failed = true;
        s.said = "Couldn't send. Try again.";
        handOff(s);
        reopen(s, 'cant', { text });
        return;
      }
      document.dispatchEvent(new CustomEvent('marble-line:sent', { detail: { conversation: s.conversation, ids } }));
      // Describe mode lent it: the brief is the agent's now.
      s.lent?.onSent?.({ id: s.conversation });
    }

    // ------------------------------------------------------------ set up

    // Whether anything on this drive can make a change: some way to run an
    // agent, there and signed in, as the chat's own picker asks. A yes holds
    // for the tab; a no for a moment, and not past a setup saved here, so
    // setting one up is seen at the next ⏎. A host that cannot say is no
    // answer: the send goes as it always did. Neither can one provider whose
    // detection did not finish in time — a sprite just booted, a CLI probed
    // against its own clock — so it is unknown, not "not set up".
    const NO_FOR = 5000;
    let readiness = null;         // { at, value: true | false | undefined while asked, answer }
    const fresh = (r) => r.value !== false || Date.now() - r.at < NO_FOR;
    // Detection that could not finish in time says so in its detail rather
    // than with a definite installed/signedIn — the race in
    // server/agent/routes.js (detectAll) and a CLI's own probe past its
    // clock (claude.js, codex.js, cursor.js) all end in some "... timed out".
    const TIMED_OUT = /timed out/i;
    const unknown = (p) => TIMED_OUT.test(String(p?.detail ?? ''));
    /** true: a provider is there and signed in. false: every provider is
     *  definitely not — known, not timed out. null: at least one could not
     *  be determined, so there is no "not set up" to say yet. */
    function verdict(list) {
      if (!Array.isArray(list)) return null;
      if (list.some((p) => p?.installed && p?.signedIn)) return true;
      return list.some(unknown) ? null : false;
    }
    function ready() {
      if (readiness && fresh(readiness)) return readiness.answer;
      const entry = { at: Date.now(), value: undefined, answer: null };
      entry.answer = Promise.resolve()
        .then(() => agent.providers())
        .then(verdict, () => null)
        .then((ok) => {
          entry.value = ok;
          if (ok === null && readiness === entry) readiness = null;
          return ok;
        });
      readiness = entry;
      return entry.answer;
    }
    /** What is known now, without asking: true, false, or not yet. */
    const readyNow = () => (readiness && fresh(readiness) ? readiness.value : undefined);
    addEventListener('marble:agent-settings-saved', () => { readiness = null; });

    /** The line, open still, saying changes need setting up first, with the
     *  words as they were. */
    function unready(s, text) {
      s.failed = false;
      s.said = 'Changes need setting up first.';
      const back = s.returnTo;
      show(s, 'setup', { text, focus: holdsKeys(s) || mayTakeFocus() });
      if (back) s.returnTo = back;
    }

    /** Set up: the drive's own Connect when the host says one is needed,
     *  else the settings where the way changes are made is chosen. */
    async function openSetup() {
      const sheet = document.querySelector('marble-agent-setup');
      try {
        if (typeof sheet?.offer === 'function' && await sheet.offer()) return;
      } catch { /* the settings, then */ }
      agent.openSettings?.('settings');
    }

    // ------------------------------------------------------------ the work

    function onEvent(s, event) {
      if (!event || typeof event !== 'object' || !sessions.has(s)) return;
      if (event.seq != null && event.seq <= s.after) return;
      const type = event.type;
      if (type === 'turn.started') {
        if (!s.awaiting) return;
        s.awaiting = false;
        s.turn = event.turn;
        s.texts = [];
        // Esc came before the turn had an id: it stops now.
        if (s.stop) { s.stop = false; agent.cancel(s.turn).catch(() => { /* already over */ }); }
        return;
      }
      if (!s.turn || event.turn !== s.turn) return;
      if (type === 'text' && event.text) s.texts.push(String(event.text));
      else if (type === 'ask') asked(s, event);
      else if ((type === 'ask.answered' || type === 'ask.void') && s.ask?.requestId === event.requestId) {
        s.ask = null;
        if (shown === s && s.state === 'ask') fold(s);
      } else if (ENDS.has(type)) ended(s, event);
    }

    // A question with choices comes to the line; anything else it asks (a
    // permission, several questions at once) is the chat's to show.
    function asked(s, event) {
      const questions = event.kind === 'question' ? event.input?.questions : null;
      if (!Array.isArray(questions) || questions.length !== 1 || !questions[0]?.question) {
        agent.open?.(s.conversation);
        return;
      }
      s.ask = event;
      reopen(s, 'ask');
    }

    /** An answer to a question back, pressed or typed, in the shape the chat
     *  sends (agent-ui.js, askResponse). */
    async function reply(s, label) {
      const ask = s.ask;
      if (!ask || !s.turn) return;
      const q = ask.input.questions[0];
      const picks = new Map([[q.question, new Set([label])]]);
      const response = window.marbleAgentUI?.askResponse?.('question', ask.input, picks)
        ?? { behavior: 'allow', updatedInput: { ...ask.input, answers: { [q.question]: label } } };
      const buttons = [...(s.el?.querySelectorAll('button') ?? [])];
      for (const b of buttons) b.disabled = true;
      try {
        await agent.answer(s.turn, ask.requestId, response);
      } catch {
        for (const b of buttons) b.disabled = false;
        return;
      }
      if (s.ask === ask) s.ask = null;
      if (shown === s && s.state === 'ask') fold(s);
    }

    const firstSentences = (text, n) => {
      const parts = String(text ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
      return parts.slice(0, n).join(' ');
    };
    // What the agent wrote, as words: no emphasis marks or code ticks.
    const plain = (text) => String(text ?? '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
    const isQuestion = (text) => /\?\s*$/.test(text) || QUESTION.test(String(text).trim());

    function ended(s, event) {
      s.turn = null;
      s.awaiting = false;
      s.stop = false;
      s.ask = null;
      handOff(s);
      const applied = Number(event.applied) || 0;
      // It changed something, or the person stopped it: the page says the
      // rest, and review takes over.
      if (applied > 0 || event.type === 'turn.cancelled' || event.type === 'turn.removed') {
        if (shown === s) put(s, { keep: false });
        else if (sessions.has(s)) drop(s);
        return;
      }
      const last = plain(s.texts.at(-1));
      if (isQuestion(s.asked) && event.type === 'turn.completed') {
        s.answer = last || 'No answer came back.';
        reopen(s, 'answer');
        return;
      }
      s.failed = event.type !== 'turn.completed';
      // One that did not finish says so, and only that: what the work said
      // last was on its way somewhere, not why, and the host's own words (a
      // provider's id, a stall) are for the console.
      if (s.failed && event.error) console.warn(`marble-line: the change did not finish: ${event.error}`);
      s.said = s.failed ? "Didn't finish. Try again." : firstSentences(last, 2) || 'Nothing changed.';
      reopen(s, 'cant', { text: s.asked });
    }

    /** The work has something to say: the line comes back on its thing,
     *  putting away (and keeping) whatever line was there. */
    function reopen(s, state, { text = '' } = {}) {
      if (!sessions.has(s)) return;
      show(s, state, { text, focus: mayTakeFocus() });
      // The line speaks for this change now; the marks need not (ruling R16).
      if (s.conversation) document.dispatchEvent(new CustomEvent('marble-line:speaks', { detail: { conversation: s.conversation, state } }));
    }

    // ------------------------------------------------------------ leaving

    // A line is put away by looking elsewhere: a press outside it and outside
    // its thing (and the tint round it). Words being written there are kept
    // as a note on the thing; anything else typed waits as a draft.
    addEventListener('pointerdown', (event) => {
      const s = shown;
      if (!s?.el || s.state === 'sent') return;
      // Lent to Describe mode, a press on the page is a mark being drawn.
      if (s.lent) return;
      // Pointing (agent-callout.js) is not looking away: ⇧-click adds to it.
      if (document.documentElement.classList.contains('marble-callout-latched')) return;
      if (host.contains(event.target)) return;
      // The chat, and the drive's own setup and settings (Set up opens
      // them over the line), are not looking away either.
      if (event.composedPath().some((n) => ['marble-agent-drawer', 'marble-agent-setup', 'marble-agent-settings'].includes(n?.localName))) return;
      if (!s.page && elementsOf(s.ids).some((el) => el.contains(event.target))) return;
      if (s.tint && !s.tint.hidden) {
        const r = s.tint.getBoundingClientRect();
        if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) return;
      }
      const words = s.input ? said(s.input) : '';
      if (words && (s.state === 'edit' || s.state === 'cant' || s.state === 'setup') && stash(s, words, { restore: 'press' })) return;
      put(s, { keep: true, restore: 'press' });
    }, true);

    // Esc while a change from the line runs stops it, but only when the page
    // itself had the key. Where it came from is read off the event's path,
    // not off the focus at the end: the chat hands the keys back to the page
    // on Esc without taking the key, and a panel that closes on Esc leaves
    // nothing open by the time the key bubbles. So it is judged in capture,
    // before anything acts on it, and never from a field, an editable, a
    // component (the chat), the drive's own chrome, a dialog, a popover or a
    // menu, nor while the variations panel, the tour of a change, Describe
    // mode or pointing is open.
    function anotherOverlay() {
      const html = document.documentElement;
      if (html.classList.contains('marble-callout-latched')) return true;
      const marks = document.querySelector('.marble-marks-layer');
      if (marks && (marks.dataset.mode || marks.hasAttribute('data-describing'))) return true;
      if (document.querySelector('.marble-variations-panel:not([hidden])')) return true;
      if (document.querySelector('marble-work')?.shadowRoot?.querySelector('.tour:not([hidden])')) return true;
      try {
        if (document.querySelector('[popover]:not([popover="manual"]):popover-open, dialog:modal')) return true;
      } catch { /* an older engine: the path test below still stands */ }
      return false;
    }
    const MENUS = 'dialog, [role="dialog"], [role="alertdialog"], [popover], [role="menu"], [role="menubar"], [role="listbox"], [role="combobox"]';
    function pageHadKey(event) {
      if (anotherOverlay()) return false;
      for (const node of event.composedPath()) {
        if (node === document.body || node === document.documentElement || node === document || node === window) break;
        // Inside a component with its own keys: the chat, the drive's tree.
        if (node instanceof ShadowRoot) return false;
        if (!(node instanceof Element)) continue;
        if (node.hasAttribute(TRANSIENT)) return false;
        if (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) return false;
        if (node.matches(MENUS)) return false;
      }
      return true;
    }
    const judged = new WeakSet();
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.isComposing && pageHadKey(event)) judged.add(event);
    }, true);
    addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !judged.has(event)) return;
      let s = null;
      for (const one of sessions) if (busy(one)) s = one;
      if (!s) return;
      event.preventDefault();
      // Sent, but the turn has no id yet: it stops the moment it has one.
      if (!s.turn) { s.stop = true; return; }
      agent.cancel(s.turn).catch(() => { /* already over */ });
    });

    // ------------------------------------------------------------ opening

    /**
     * Open the line on `ids` (none: the page).
     * @param {object} o
     * @param {string[]} [o.ids]
     * @param {object|'page'} [o.scope]   `{ words, range, chain, index }` from the callout
     * @param {string} [o.from]           'key', 'point', 'note', 'nudge', 'review'
     * @param {string} [o.draft]          words to open with
     * @param {string} [o.conversation]   carry on this conversation
     * @param {string} [o.action]         one of the offer's actions, drafted for this thing
     * @param {boolean} [o.send]          send the draft at once, with `o.brief` beside it
     */
    function open({ ids = [], scope = null, from = null, draft = null, conversation = null, action = null, send: now = false, brief = null } = {}) {
      const asked = scope === 'page' ? [] : (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
      const present = asked.filter((id) => byId(id));
      if (asked.length && !present.length) return false;
      const s = makeSession({ ids: present, scope, from, conversation });
      // Already open on the same thing and still being written: that line.
      if (shown && shown.state === 'edit' && !conversation && draft == null && !now && keyOf(shown) === keyOf(s)) {
        if (shown.input) caretAt(shown.input);
        return true;
      }
      // Words carried on to the new line (⇧-click adds a thing to it) moved
      // with it: they are not kept under the old thing as well.
      const carried = Boolean(shown?.input) && draft != null && said(shown.input) === String(draft).trim();
      if (shown) put(shown, { keep: !carried, restore: false });
      sessions.add(s);
      let text = draft ?? drafts()[keyOf(s)] ?? '';
      let idea = null;
      // An action drafted for this thing (an offer after an edit): its words,
      // with the idea after the lead selected so typing replaces it, and its
      // meaning beside them while they still lead.
      if (action && action !== 'sketch' && draft == null && globalThis.marbleOffer?.draftFor) {
        const els = elementsOf(s.ids);
        const d = globalThis.marbleOffer.draftFor(action, { kind: kindOf(s, els), count: els.length, element: els[0] ?? null });
        if (d?.lead) {
          s.action = { mode: action, lead: d.lead.trim() };
          text = d.lead + (d.idea ?? '');
          s.drafted = text.trim();
          if (d.idea) idea = [d.lead.length, text.length];
        }
      }
      if (!now) s.offer = offerOf(s);
      agent.select(s.ids.length ? s.ids : null);
      show(s, 'edit', { text });
      if (idea && s.input) caretAt(s.input, idea[0], idea[1]);
      // The conversation's composer, loading while the words are written,
      // and whether anything can take them, asked meanwhile too.
      convoFor(s);
      ready();
      askOffer(s);
      if (now) send(s, text, { brief, keepWords: true });
      return true;
    }

    /**
     * Lend the line to Describe mode as its composer (agent-marks.js): the
     * same line, its words, its send and its conversation, hung under the
     * marks rather than under a thing, with what the marks say as its
     * placeholder and their reading sent unseen ahead of the words.
     * @returns {{el: HTMLElement, label(text: string): void, show(on: boolean): void,
     *   hang(span: object|null): void, focus(): boolean, release(ids?: string[]): void, discard(): void}}
     */
    function lend({ ids = () => [], label = '', brief = null, onSent = null, onClose = null, floor = null } = {}) {
      const marked = () => (typeof ids === 'function' ? ids() : ids).map(String);
      const present = marked().filter((id) => byId(id));
      if (shown) put(shown, { keep: true, restore: false });
      const s = makeSession({ ids: present, scope: null, from: 'describe', conversation: null });
      s.lent = { label, brief, onSent, onClose, floor, span: null, ids: marked };
      s.offer = offerOf(s);
      // The mode draws what is marked; the line adds no tint of its own.
      s.handed = true;
      sessions.add(s);
      raise();
      show(s, 'edit', { text: '', focus: false });
      if (s.el) s.el.hidden = true;
      convoFor(s);
      ready();
      return {
        get el() { return s.el; },
        label(text) {
          if (!s.lent) return;
          s.lent.label = text;
          if (s.input && s.state === 'edit') {
            const words = placeholderOf(s);
            s.input.dataset.placeholder = words;
            s.input.setAttribute('aria-label', words);
          }
          s.syncSend?.();
        },
        show(on) {
          if (!s.el || shown !== s) return;
          s.el.hidden = !on;
          if (on) schedule();
        },
        hang(span) {
          if (!s.lent) return;
          s.lent.span = span ? { left: span.left, top: span.top, width: span.width, height: span.height, right: span.left + span.width, bottom: span.top + span.height } : null;
          if (s.el && shown === s) s.el.hidden = !span;
          place();
        },
        focus() {
          if (!s.input || shown !== s) return false;
          s.el.hidden = false;
          if (!holdsKeys(s)) s.returnTo = keysNow();
          caretAt(s.input);
          return true;
        },
        /** Send these words from the line, as ⏎ would (Explore's ask). */
        send: (text) => send(s, text),
        /** Sent: an ordinary line now, about what was marked. */
        release(about = []) {
          const kept = about.map(String).filter((id) => byId(id));
          s.ids = kept;
          s.page = !kept.length;
          s.lent = null;
          s.offer = offerOf(s);
          schedule();
        },
        discard() { if (sessions.has(s)) { s.lent = null; put(s, { keep: false, restore: false }); } },
      };
    }

    window.marbleLine = {
      open,
      lend,
      close: ({ keep = true } = {}) => { if (shown) put(shown, { keep }); },
      running,
      /** The line on screen: what it is about, what it holds, whose
       *  conversation it speaks for, and whether it has the keys. */
      current: () => (shown ? {
        ids: [...shown.ids], words: Boolean(shown.words), page: shown.page, state: shown.state,
        text: shown.input ? said(shown.input) : '', conversation: shown.conversation, focused: holdsKeys(shown),
      } : null),
      /** Give the keys to the line on screen (⌘J, for one that came back on
       *  its own), the caret at the end of its words. */
      focus() {
        if (!shown?.input) return false;
        if (!holdsKeys(shown)) shown.returnTo = keysNow();
        caretAt(shown.input);
        return true;
      },
      /** Whether this conversation was asked from the line, so the line
       *  speaks for how it ends (change-marks.js asks). */
      owns: (conversation) => Boolean(conversation) && [...sessions].some((one) => one.conversation === conversation),
    };
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
