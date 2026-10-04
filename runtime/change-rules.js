// Find, mark, commit (v5, Notes and Sketches/Ask at Anything, "Round the
// corners", "From a hand, not a sentence" and "How a change runs").
//
// A change of look is not work for an agent: "round the corners" is one value
// on every part of one kind. So the page does it itself, the same way however
// it is asked:
//
//   - Find: the parts like the one in hand (`likes`): the same tag and the
//     same classes (the page's own `marble-*` classes aside), or, for a part
//     with no class, the same tag under parents like its own.
//   - Mark: all of them at once, with the marks' own tints and tag
//     (change-marks.js, `begin`), before anything moves. A press on a mark
//     leaves that part out: a dashed ring, no fill.
//   - Commit: one rule in a style element of its own, keyed by what it is for
//     (`data-marble-rule="<selector>|<property>"`), as the body's last child;
//     a second change of the same kind rewrites the same element. A part the
//     rule cannot reach (its own style attribute, an id rule) gets the value
//     on its style attribute in the same step. It is filed as ops and one
//     entry in the person's own history, so one ⌘Z takes all of it back.
//
// Two ways in. Reshape (a toggle in the chat button's menu) puts two grips on
// the part under the pointer: a dot in its corner for the radius and a bar
// inside its right edge for the padding. Resting on either marks every part
// like it; dragging changes them all one to one, with nothing easing under the
// hand, and letting go commits. ⇧ at the press changes only that one. The
// keys have the same: in Reshape Tab walks the page's stops and its parts (a
// ring round each part, its grips after what is inside it), the arrows on a
// ring move to the next part, on a grip they step a pixel (⇧ four), Enter
// commits and Esc puts it back. Esc with nothing in hand leaves Reshape.
// ⌘Z and ⇧⌘Z play a rule out and back in through the engine.
//
// Or a few words in the line (change-line.js): words that sound like a look
// are read by a small model beside an outline of the page (`/agent/change-
// intent`), and a rule that holds up here — a selector that parses, reaches
// between 1 and 400 of the document's own parts, stays inside what the line is
// about, and sets only a few plain properties to values that parse — is
// marked, and committed half a second later with the engine (change-morph.js)
// playing it in. Anything else goes to the agent as it was asked.
//
// Everything drawn here is transient chrome in one top-layer host; only the
// rule and its fallbacks are ever filed.

(() => {
  const TRANSIENT = 'data-marble-transient';
  const ID = 'data-marble-id';
  const RULE = 'data-marble-rule';
  const DRAGGING = 'data-marble-dragging';
  // Nothing here arrives or settles: the grips answer at once, and the
  // engine (change-morph.js) owns every motion a rule makes.
  const COLOUR = 'cubic-bezier(.22, .61, .36, 1)';  // colour only
  const SMALLEST = 24;      // px a part is wide and tall, at least, to be reshaped
  const MOST = 400;         // parts one rule from words may reach
  const MOST_OUT = 200;     // parts one rule may leave out by name
  const SCAN = 3000;        // parts the outline reads
  const OUTLINE = 40;       // kinds of part the outline lists
  const LOOK_AT = 500;      // ms the marks are seen before a rule from words lands
  const ASK = 6000;         // ms the page waits for the words' rule (the host gives up at 6 s too)
  const SWITCH = 300;       // ms on a part of another kind before the marks let go of these
  const LEAVE = 250;        // ms off any part before the grips go
  const LEAVE_MARKED = 1200; // ms off any part before marks shown for a grip go
  const TIP = 750;          // ms of rest before a grip's tip
  const INSIDE = 8;         // px a tip keeps inside the window
  const MOST_PADDING = 96;  // px a drag pads a part, at most
  const SKIP = new Set(['HTML', 'HEAD', 'BODY', 'STYLE', 'SCRIPT', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'NOSCRIPT', 'BR', 'WBR', 'SOURCE', 'TRACK']);

  // What a rule may set: a look the engine can turn, nothing that loads,
  // lays a page out anew or hides a part (server/change/intent.js says the
  // same to the model).
  const SIDES = '(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?';
  const ALLOWED = new RegExp(`^(?:border-radius|padding${SIDES}|margin${SIDES}|gap|row-gap|column-gap|font-size|font-weight|line-height|letter-spacing|color|background-color|border-color|opacity)$`);
  const BREAKS = /[;{}<>!\\]|\/\*|@/;
  const SELECTOR_BREAKS = /[;{}<&]|\/\*|@|\n/;
  const LOADS = /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|@import/i;
  // The longhands a declaration on a style attribute outvotes, so the one
  // written last is the one that holds.
  const LONGHANDS = {
    'border-radius': /^border-(?:top|bottom|start|end)-(?:left|right|start|end)-radius$/,
    padding: /^padding-/,
    margin: /^margin-/,
    gap: /^(?:row|column)-gap$/,
    'border-color': /^border-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?-color$/,
  };
  // What a few words' verb has done, for the tag's last word.
  const PAST = {
    rounding: 'rounded', squaring: 'squared', spacing: 'spaced', padding: 'padded', tightening: 'tightened',
    loosening: 'loosened', resizing: 'resized', enlarging: 'enlarged', shrinking: 'shrunk', recolouring: 'recoloured',
    recoloring: 'recolored', softening: 'softened', darkening: 'darkened', lightening: 'lightened', bolding: 'bolded',
    calming: 'calmed', quieting: 'quieted', restyling: 'restyled', changing: 'changed', fading: 'faded', growing: 'grown',
    weighting: 'weighted',
  };
  // The tag's verb, from what a rule sets: never a word of the model's
  // (server/change/intent.js says the same of the host's reply).
  function familyOf(prop) {
    if (prop === 'border-radius') return 'Rounding';
    if (/^(?:padding|margin|gap|row-gap|column-gap|line-height|letter-spacing)/.test(prop)) return 'Spacing';
    if (prop === 'font-size') return 'Resizing';
    if (prop === 'font-weight') return 'Weighting';
    if (/color$/.test(prop)) return 'Recolouring';
    if (prop === 'opacity') return 'Fading';
    return 'Restyling';
  }

  const STYLE = `
    .marble-rules-host {
      position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0;
      background: none; overflow: visible; pointer-events: none; color: inherit;
      --rules-accent: var(--accent, light-dark(#9bb6cf, #7fa8c9));
      --rules-ink: var(--accent-ink, light-dark(#738698, #9dc0dc));
      --rules-card: var(--card, var(--paper, light-dark(#fff, #1f2023)));
      --rules-text: var(--ink, light-dark(#1d1d1f, #ececee));
      --rules-line: var(--line, color-mix(in srgb, var(--rules-text) 14%, transparent));
      --rules-font: var(--ui-font, var(--sans, system-ui, -apple-system, "Segoe UI", sans-serif));
      font: 13px/1.35 var(--rules-font);
    }
    .marble-rules-host:popover-open { position: fixed; inset: 0; }
    .marble-rules-aloud { position: fixed; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap; border: 0; }

    /* The grips: a dot in the part's corner, riding its curve, and a bar
       inside its right edge where its words begin. A ring of the accent all
       the way round on the page's own card; a press fills it. */
    .marble-rules-grip { position: fixed; left: 0; top: 0; box-sizing: border-box; margin: 0; padding: 0; appearance: none;
      border: 1.5px solid var(--rules-ink); background: var(--rules-card); color: inherit; font: inherit;
      pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent;
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--rules-card) 70%, transparent);
      transition: background-color 110ms ${COLOUR}; }
    .marble-rules-grip[data-grip="corner"] { width: 12px; height: 12px; border-radius: 50%; cursor: nwse-resize; }
    .marble-rules-grip[data-grip="padding"] { width: 6px; height: 20px; border-radius: 3px; cursor: ew-resize; }
    /* A little more room for the pointer than the mark itself. */
    .marble-rules-grip::after { content: ""; position: absolute; left: 50%; top: 50%; width: 24px; height: 24px; translate: -50% -50%; }
    .marble-rules-grip:hover { background: color-mix(in srgb, var(--rules-accent) 34%, var(--rules-card)); }
    .marble-rules-grip:active, .marble-rules-grip[data-held] { background: var(--rules-ink); }
    .marble-rules-grip:focus-visible { outline: 2px solid var(--rules-ink); outline-offset: 2px; }
    .marble-rules-grip[hidden] { display: none; }
    /* While a grip is held the whole page shows the grip's own cursor. */
    html.marble-rules-held-corner, html.marble-rules-held-corner * { cursor: nwse-resize !important; user-select: none !important; }
    html.marble-rules-held-padding, html.marble-rules-held-padding * { cursor: ew-resize !important; user-select: none !important; }

    /* The keys' way to a part: a ring round it, drawn only while it has
       them. It takes no press; the pointer has the grips. */
    .marble-rules-ring { position: fixed; left: 0; top: 0; box-sizing: border-box; margin: 0; padding: 0; appearance: none;
      border: 0; background: none; color: inherit; font: inherit; pointer-events: none; outline: none; }
    .marble-rules-ring:focus { outline: 2px solid var(--rules-ink); outline-offset: 2px; }
    .marble-rules-ring[hidden] { display: none; }

    /* A finger has no hover: the grips are always drawn on the part it
       chose, as big as a fingertip needs to see, with 44px to land on. */
    @media (hover: none) {
      .marble-rules-grip[data-grip="corner"] { width: 22px; height: 22px; }
      .marble-rules-grip[data-grip="padding"] { width: 10px; height: 28px; border-radius: 5px; }
      .marble-rules-grip::after { width: 44px; height: 44px; }
    }

    /* A word for a grip, whose mark does not say what a drag does. */
    .marble-rules-tip { position: fixed; left: 0; top: 0; margin: 0; padding: 6px 10px; box-sizing: border-box;
      max-width: 16rem; border-radius: 8px; border: 1px solid var(--rules-line); background: var(--rules-card);
      color: var(--rules-text); box-shadow: var(--shadow, 0 1px 3px rgba(0, 0, 0, .12));
      font: 400 12.5px/1.35 var(--rules-font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      pointer-events: none; opacity: 1; transition: opacity 140ms ${COLOUR}; }
    @starting-style { .marble-rules-tip { opacity: 0; } }
    .marble-rules-tip[hidden] { display: none; }

    @media (prefers-reduced-motion: reduce) {
      .marble-rules-grip, .marble-rules-tip { transition: none; }
    }
  `;

  const RESHAPE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19v-7a7 7 0 0 1 7-7h7"/><circle cx="9.6" cy="9.6" r="1.7" fill="currentColor" stroke="none"/></svg>';

  const boot = (marble) => {
    if (!marble?.apply || !marble.op || !marble.record || !marble.app) return;
    // A page with its own conversation UI (the Agents page) is not a page to reshape.
    if (document.querySelector('meta[name="marble-agent"][content="custom"]')) return;
    if (window.marbleRules) return;
    // What a hand marks on a part while it drags is the page's, never the file's.
    marble.pageOnly?.(DRAGGING);

    const style = document.createElement('style');
    style.setAttribute(TRANSIENT, '');
    style.textContent = STYLE;
    document.head.append(style);
    const host = document.createElement('div');
    host.className = 'marble-rules-host';
    host.setAttribute(TRANSIENT, '');
    host.setAttribute('popover', 'manual');
    document.documentElement.append(host);
    try { host.showPopover(); } catch { /* no popover here: fixed positioning still stands */ }
    const aloud = document.createElement('div');
    aloud.className = 'marble-rules-aloud';
    aloud.setAttribute('role', 'status');
    aloud.setAttribute('aria-atomic', 'true');
    host.append(aloud);
    let sayTimer = 0;
    const announce = (text, { soon = false } = {}) => {
      clearTimeout(sayTimer);
      if (soon) sayTimer = setTimeout(() => { aloud.textContent = text; }, 400);
      else aloud.textContent = text;
    };

    // ------------------------------------------------------------ the page's own parts

    const byId = (id) => (id ? (marble.byId?.(id) ?? document.querySelector(`[${ID}="${CSS.escape(id)}"]`)) : null);
    const idOf = (el) => el?.getAttribute?.(ID) ?? null;
    /** One of the document's own parts: addressed, in the page itself (not a
     *  component's insides), and not chrome — not a mark, a line, the drive's
     *  shell or a chat. */
    function own(el) {
      if (!el || el.nodeType !== 1 || !el.isConnected || SKIP.has(el.tagName)) return false;
      if (!el.hasAttribute(ID) || el.getRootNode() !== document) return false;
      if (el.closest(`[${TRANSIENT}]`)) return false;
      return Boolean(document.body?.contains(el));
    }
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    };
    const opaque = (colour) => Boolean(colour) && colour !== 'transparent' && !/rgba?\([^)]*,\s*0\)$/.test(colour) && !/\/\s*0\)$/.test(colour);
    const classesOf = (el) => [...(el?.classList ?? [])].filter((c) => !c.startsWith('marble-')).sort();
    const sigOf = (el) => (el ? `${el.localName}|${classesOf(el).join(' ')}` : '');
    const sameKind = (a, b) => {
      if (a.localName !== b.localName) return false;
      const cls = classesOf(a);
      if (cls.length) return sigOf(a) === sigOf(b);
      return !classesOf(b).length && Boolean(a.parentElement && b.parentElement) && sigOf(a.parentElement) === sigOf(b.parentElement);
    };
    const unitOf = (el) => window.marbleChange?.unitOf?.(el) ?? ['part', 'parts'];

    /** The parts like `el`, in the page's order: the same tag and classes,
     *  or (no class) the same tag under parents like its own. Only the ones
     *  on the page; `only` (⇧) is just `el`. */
    function likes(el, { only = false } = {}) {
      if (!own(el)) return [];
      if (only) return [el];
      const out = [];
      for (const other of document.body.querySelectorAll(`${CSS.escape(el.localName)}[${ID}]`)) {
        if (other === el || (own(other) && shown(other) && sameKind(el, other))) out.push(other);
      }
      return out;
    }

    /** A selector for `el`'s kind, as `likes` finds it. */
    function selectorOf(el) {
      const part = (node) => `${CSS.escape(node.localName)}${classesOf(node).map((c) => `.${CSS.escape(c)}`).join('')}`;
      if (classesOf(el).length || !el.parentElement) return part(el);
      return `${part(el.parentElement)} > ${part(el)}`;
    }

    // ------------------------------------------------------------ checking a rule

    const attr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const cssString = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const supports = (prop, value) => {
      try { return CSS.supports(prop, value); } catch { return false; }
    };
    /** Whether a selector is a list, which the rule wraps in :is(). */
    function listed(selector) {
      let depth = 0;
      let quote = '';
      for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(' || ch === '[') depth += 1;
        else if (ch === ')' || ch === ']') depth -= 1;
        else if (ch === ',' && depth === 0) return true;
      }
      return false;
    }
    const query = (selector) => {
      try { return [...document.querySelectorAll(selector)]; } catch { return null; }
    };
    /** The selector's own list items, split where a comma is not inside
     *  brackets or quotes. */
    function itemsOf(selector) {
      const items = [];
      let depth = 0;
      let quote = '';
      let from = 0;
      for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(' || ch === '[') depth += 1;
        else if (ch === ')' || ch === ']') depth -= 1;
        else if (ch === ',' && depth === 0) { items.push(selector.slice(from, i)); from = i + 1; }
      }
      items.push(selector.slice(from));
      return items.map((item) => item.trim());
    }
    /** A rule is written under `html` already: a selector that starts at
     *  the root (`html .card`, `:root .card`) is read without it. */
    function normalised(selector) {
      const items = itemsOf(selector).map((item) => item.replace(/^(?:html|:root)(?=$|[\s>+~])\s*(?:>\s*)?/i, '').trim());
      return items.every(Boolean) ? items.join(', ') : '';
    }

    /** Declarations a rule may carry, or null: only the few properties, and
     *  values that parse as CSS for them and load or break out of nothing. */
    function declarationsOf(given) {
      if (!given || typeof given !== 'object' || Array.isArray(given)) return null;
      const entries = Object.entries(given);
      if (!entries.length || entries.length > 6) return null;
      const out = {};
      for (const [name, raw] of entries) {
        const prop = String(name).trim().toLowerCase();
        const value = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
        if (!ALLOWED.test(prop) || !value || value.length > 120 || BREAKS.test(value) || LOADS.test(value) || !supports(prop, value)) return null;
        out[prop] = value;
      }
      return out;
    }

    /** A rule from words, checked against what is really here: the parts it
     *  would change, or null. Every part it reaches must be one of the
     *  document's own (none of the chrome, the shell, a chat), 1 to 400 of
     *  them, inside the scope when there is one. */
    function plan(rule, scope = []) {
      if (!rule || typeof rule !== 'object') return null;
      const given = typeof rule.selector === 'string' ? rule.selector.replace(/\s+/g, ' ').trim() : '';
      if (!given || given.length > 300 || SELECTOR_BREAKS.test(given)) return null;
      const selector = normalised(given);
      if (!selector) return null;
      const declarations = declarationsOf(rule.declarations);
      if (!declarations) return null;
      const reached = query(selector);
      if (!reached || !reached.length || reached.length > MOST) return null;
      if (!reached.every(own)) return null;
      const within = scope.filter(Boolean);
      if (within.length && !reached.every((el) => within.some((s) => s === el || s.contains(el)))) return null;
      return { selector, declarations, targets: reached };
    }

    // ------------------------------------------------------------ committing

    // A value set under the hand, or put back, must not set the page's own
    // transitions going: each part is held still while its value moves.
    const FROZEN = 'transition: none !important';
    const frozen = (attrValue) => (attrValue && attrValue.trim() ? `${attrValue.trim().replace(/;?\s*$/, '; ')}${FROZEN}` : FROZEN);
    const setStyle = (el, value) => (value == null ? el.removeAttribute('style') : el.setAttribute('style', value));
    const read = (el, prop) => getComputedStyle(el).getPropertyValue(prop).trim();
    /** A style attribute with `prop` set last, and anything it outvotes gone. */
    function withProp(attrValue, prop, value) {
      const over = LONGHANDS[prop];
      const kept = String(attrValue ?? '').split(';').map((d) => d.trim()).filter(Boolean).filter((d) => {
        const name = d.slice(0, d.indexOf(':')).trim().toLowerCase();
        return name !== prop && !(over && over.test(name));
      });
      return [...kept, `${prop}: ${value}`].join('; ');
    }
    function bodyId() {
      if (!idOf(document.body)) marble.address?.([document.body]);
      return idOf(document.body);
    }
    const rulesFor = (key) => [...document.querySelectorAll(`style[${RULE}]`)]
      .filter((el) => el.getAttribute(RULE) === key && el.hasAttribute(ID) && !el.closest(`[${TRANSIENT}]`));
    // Parts carrying a hand's values now, with their own style from before:
    // what is read as a part's style is always its own, never this page's
    // values under a hand.
    const handHeld = new Map();
    const ownStyle = (el) => (handHeld.has(el) ? handHeld.get(el) : el.getAttribute('style'));

    /**
     * Commit one rule: `selector` (the kind) with `declarations` reaches
     * `targets` and leaves `exclude` as they are. One style element per
     * property, keyed `<selector>|<property>`; parts the rule cannot reach
     * get the value on their own style attribute in the same step. Filed as
     * one entry in the person's history. `originals` are the style
     * attributes from before a hand changed them; `play` plays it in with
     * the engine, moving `marks` on as each part lands. `strict` (words):
     * a rule no part takes is a failure, not a change made all by fallbacks.
     *
     * The change itself is made at once, in the task that asks for it: only
     * its playing-in is waited for.
     */
    async function commit(options) {
      const done = applyRule(options);
      if (done.snap && typeof window.marbleMorph?.play === 'function') {
        try {
          await window.marbleMorph.play(done.snap, {
            onPart: (id, phase) => { if (phase === 'start') options.marks?.now([id]); else options.marks?.land([id]); },
          });
        } catch { /* it has landed all the same */ }
      }
      options.marks?.land(done.ids);
      return done.result;
    }

    /** One rule's ops, made and checked on the page: throws, with nothing
     *  left behind, when it cannot be one rule. */
    function applyRule({ selector, declarations, targets = [], exclude = [], originals = null, play = false, strict = false } = {}) {
      const base = String(selector ?? '').replace(/\s+/g, ' ').trim();
      if (!base || SELECTOR_BREAKS.test(base)) throw new Error('that is not a selector a rule can use');
      const props = Object.entries(declarationsOf(declarations) ?? {});
      if (!props.length) throw new Error('a rule sets at least one look');
      const aimed = [...new Set(targets)].filter(own);
      if (!aimed.length) throw new Error('nothing to change');
      const left = [...new Set(exclude)].filter((el) => own(el) && !aimed.includes(el));
      const reached = query(base);
      if (!reached) throw new Error('that is not a selector a rule can use');
      if (aimed.some((el) => !reached.includes(el))) throw new Error('the rule does not reach every part');
      // What the selector also reaches is left out by name; the drive's own
      // chrome, now or later, is left out by being chrome.
      const others = reached.filter((el) => !aimed.includes(el) && !left.includes(el));
      const named = [...left, ...others.filter(own)];
      if (named.length > MOST_OUT) throw new Error('too many parts to leave out');
      const nots = named.map((el) => `:not([${ID}="${cssString(idOf(el))}"])`).join('');
      const ruleSelector = `html ${listed(base) ? `:is(${base})` : base}${nots}:not([${TRANSIENT}], [${TRANSIENT}] *)`;
      if (!query(ruleSelector)) throw new Error('that is not a selector a rule can use');
      const parent = bodyId();
      if (!parent) throw new Error('the page has no place for a rule');

      const ops = [];
      for (const [prop, value] of props) {
        const key = `${base}|${prop}`;
        const text = `${ruleSelector} { ${prop}: ${value}; }`;
        const [kept, ...twins] = rulesFor(key);
        if (kept) ops.push({ type: 'setInner', id: idOf(kept), html: text, rule: true });
        else ops.push({ type: 'insert', parentId: parent, beforeId: null, html: `<style ${ID}="${marble.newId()}" ${RULE}="${attr(key)}">${text}</style>`, rule: true });
        // One rule per kind and property, however it came to be two.
        for (const twin of twins) ops.push({ type: 'remove', id: idOf(twin) });
      }
      // A part changed on its own before (⇧) is one of the kind again: its
      // own rule for these properties goes, and the kind's holds it.
      const mine = new Set(aimed.map((el) => `[${ID}="${cssString(idOf(el))}"]`));
      const setting = new Set(props.map(([prop]) => prop));
      for (const el of document.querySelectorAll(`style[${RULE}]`)) {
        const key = el.getAttribute(RULE) ?? '';
        const cut = key.lastIndexOf('|');
        const sel = key.slice(0, cut);
        const alone = /\[data-marble-id="[^"]*"\]$/.exec(sel)?.[0];
        if (cut < 0 || !alone || !mine.has(alone) || !setting.has(key.slice(cut + 1)) || sel === base) continue;
        if (!el.hasAttribute(ID) || el.closest(`[${TRANSIENT}]`)) continue;
        ops.push({ type: 'remove', id: idOf(el) });
      }

      // Every part this touches is held still: what it looked like before is
      // read, a hand's own values come off, and the rule lands in the same
      // task, so nothing is painted in between.
      const held = [...aimed, ...left];
      const saved = new Map(held.map((el) => [el, originals?.has(el) ? originals.get(el) : ownStyle(el)]));
      const snap = play && typeof window.marbleMorph?.capture === 'function'
        ? (() => { try { return window.marbleMorph.capture(aimed.length <= 60 ? aimed.map(idOf) : [], { kind: 'look', scope: 'page' }); } catch { return null; } })()
        : null;
      for (const el of held) setStyle(el, frozen(saved.get(el)));
      const kept = left.map((el) => props.map(([prop]) => read(el, prop)));
      const applied = [];
      const undoAll = () => {
        for (const { inverse } of [...applied].reverse()) { try { if (inverse) marble.apply(inverse); } catch { /* as far back as it goes */ } }
        applied.length = 0;
      };
      const letGo = () => {
        for (const el of held) setStyle(el, saved.get(el));
        for (const el of held) handHeld.delete(el);
        watcher.takeRecords();
      };
      const run = (op) => {
        const inverse = marble.invert(op);
        marble.apply(op);
        applied.push({ op, inverse });
      };
      try {
        for (const { rule, ...op } of ops) run(op);
      } catch (err) {
        undoAll();
        letGo();
        throw err;
      }
      // The rule must be one the page's sheet holds and that reaches what it
      // is for: a selector the page closed for itself (`[a="b`) is no rule.
      const sheetOk = ops.filter((op) => op.rule).every((op) => {
        const el = op.type === 'setInner' ? byId(op.id) : byId(/data-marble-id="([^"]+)"/.exec(op.html)?.[1]);
        const rules = el?.sheet?.cssRules;
        const only = rules?.length === 1 ? rules[0] : null;
        if (!only || typeof only.selectorText !== 'string') return false;
        try { return aimed.every((t) => t.matches(only.selectorText)); } catch { return false; }
      });
      if (!sheetOk) {
        undoAll();
        letGo();
        throw new Error('the rule does not hold in the page\'s sheet');
      }

      // Each part ends where the rule says, or keeps what it had: what the
      // rule cannot reach gets it on its own style attribute.
      const reads = () => aimed.map((el) => props.map(([prop]) => read(el, prop)));
      const now = reads();
      aimed.forEach((el) => setStyle(el, `${frozen(saved.get(el))}; ${props.map(([p, v]) => `${p}: ${v} !important`).join('; ')}`));
      const wanted = reads();
      aimed.forEach((el) => setStyle(el, frozen(saved.get(el))));
      const short = aimed.map((el, i) => props.some((_, j) => now[i][j] !== wanted[i][j]));
      let ruled = true;
      if (short.every(Boolean)) {
        // No part takes the rule: from words it is no rule at all; under a
        // hand, the parts keep the value on their own style, and no rule
        // that reaches nothing is filed.
        undoAll();
        if (strict) {
          letGo();
          throw new Error('no part takes the rule');
        }
        ruled = false;
      }
      const leftNow = left.map((el) => props.map(([prop]) => read(el, prop)));
      const fixes = [];
      aimed.forEach((el, i) => {
        let value = saved.get(el);
        props.forEach(([prop, v], j) => { if (now[i][j] !== wanted[i][j]) value = withProp(value, prop, v); });
        if (value !== saved.get(el)) fixes.push({ el, value });
      });
      if (ruled) {
        left.forEach((el, i) => {
          let value = saved.get(el);
          props.forEach(([prop], j) => { if (leftNow[i][j] !== kept[i][j]) value = withProp(value, prop, kept[i][j]); });
          if (value !== saved.get(el)) fixes.push({ el, value });
        });
      }
      for (const { el, value } of fixes) {
        const op = { type: 'setAttr', id: idOf(el), name: 'style', value };
        setStyle(el, frozen(value));
        applied.push({ op, inverse: { type: 'setAttr', id: idOf(el), name: 'style', value: saved.get(el) } });
      }
      // Read once more while still held, so letting go changes no value and
      // starts no transition of the page's own.
      for (const el of held) getComputedStyle(el).getPropertyValue('border-radius');
      const fixed = new Map(fixes.map(({ el, value }) => [el, value]));
      for (const el of held) setStyle(el, fixed.has(el) ? fixed.get(el) : saved.get(el));
      for (const el of held) handHeld.delete(el);
      // This page's own change is not one to play back (the watcher below).
      watcher.takeRecords();
      if (!applied.length) throw new Error('nothing changed');

      // Filed, as one step the person can take back.
      for (const { op } of applied) marble.op(op);
      marble.record({ redo: applied.map(({ op }) => op), undo: applied.map(({ inverse }) => inverse).filter(Boolean).reverse() });
      document.dispatchEvent(new CustomEvent('marble-rules:commit', { detail: { ids: aimed.map(idOf) } }));
      Promise.resolve(marble.flush?.()).catch(() => { /* the carrier says so itself */ });
      return {
        snap: ruled ? snap : null,
        ids: aimed.map(idOf),
        result: {
          id: ruled ? idOf(rulesFor(`${base}|${props[0][0]}`)[0]) : null,
          ops: applied.map(({ op }) => op),
          undo: applied.map(({ inverse }) => inverse).filter(Boolean).reverse(),
        },
      };
    }

    // ------------------------------------------------------------ a few words

    /** The page's kinds of part, for the model: a selector each, how many,
     *  and how the first looks. Inside the scope when there is one. */
    function outlineOf(scope = []) {
      const roots = scope.length ? scope : [document.body];
      const kinds = new Map();
      let looked = 0;
      for (const root of roots) {
        for (const el of [root, ...root.querySelectorAll(`[${ID}]`)]) {
          if (looked >= SCAN) break;
          if (!own(el)) continue;
          looked += 1;
          if (!shown(el)) continue;
          const selector = selectorOf(el);
          const kind = kinds.get(selector) ?? (kinds.size < 400 ? kinds.set(selector, { el, count: 0, at: kinds.size }).get(selector) : null);
          if (kind) kind.count += 1;
        }
      }
      return [...kinds.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[1].at - b[1].at)
        .slice(0, OUTLINE)
        .map(([selector, { el, count }]) => {
          const css = getComputedStyle(el);
          return { selector, count, radius: css.borderRadius, padding: css.padding, fontSize: css.fontSize, color: css.color, background: css.backgroundColor };
        });
    }

    let wordsRun = 0;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pastOf = (verb) => PAST[String(verb).toLowerCase()] ?? 'changed';
    /** What the page is doing, said from what the rule sets: a radius that
     *  goes down is Squaring. */
    function verbOf(declarations, first) {
      const verbs = new Set(Object.keys(declarations).map(familyOf));
      const verb = verbs.size === 1 ? [...verbs][0] : 'Restyling';
      if (verb !== 'Rounding' || !first) return verb;
      const to = /^(-?[\d.]+)(px)?$/.exec(String(declarations['border-radius']).trim());
      const from = shapeOf('corner', first)?.value;
      return to && from != null && Number(to[1]) < from ? 'Squaring' : 'Rounding';
    }

    /**
     * Words from the line (change-line.js). Resolves true when the page took
     * them as one rule (or they were stopped before it landed), false when
     * they are the agent's after all: no rule came back, it did not hold up
     * here, or it could not be filed.
     */
    async function fromWords({ words = '', ids = [], onMarks = null, stopped = () => false } = {}) {
      const text = String(words).trim();
      if (!text) return false;
      const scope = (Array.isArray(ids) ? ids : []).map((id) => byId(String(id))).filter(own);
      let rule = null;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), ASK);
      try {
        const res = await fetch('/agent/change-intent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: marble.app, words: text, ids: scope.map(idOf), outline: outlineOf(scope) }),
          signal: ctl.signal,
        });
        rule = res.ok ? ((await res.json())?.rule ?? null) : null;
      } catch {
        rule = null;
      } finally {
        clearTimeout(timer);
      }
      if (!rule || stopped()) return Boolean(rule) && stopped();
      const found = plan(rule, scope);
      if (!found) return false;
      const n = found.targets.length;
      const [one, many] = unitOf(found.targets[0]);
      const said = typeof rule.unit === 'string' && /^[a-z][a-z -]{0,23}$/i.test(rule.unit) ? rule.unit.toLowerCase() : null;
      const unit = one !== 'part' || !said ? (n === 1 ? one : many) : (n === 1 ? said.replace(/s$/, '') : said);
      const verb = verbOf(found.declarations, found.targets[0]);
      const inView = found.targets.find((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && (r.width || r.height); });
      wordsRun += 1;
      const marks = window.marbleChange?.begin?.({
        key: `words-${wordsRun}`, ids: found.targets.map(idOf), hang: idOf(inView ?? found.targets[0]), say: [[verb, n, unit]],
      }) ?? null;
      onMarks?.();
      announce(`${verb} ${n} ${unit}`);
      // Marks before motion: the reach is seen, then it moves.
      await wait(LOOK_AT);
      if (stopped()) { marks?.clear(); return true; }
      try {
        await commit({ selector: found.selector, declarations: found.declarations, targets: found.targets, play: true, strict: true, marks });
      } catch (err) {
        console.warn(`marble-rules: the rule was not filed: ${err?.message ?? err}`);
        marks?.clear();
        return false;
      }
      const done = `${n} ${unit} ${pastOf(verb)}`;
      marks?.end([[n, unit, pastOf(verb)]]);
      announce(done);
      return true;
    }

    // ------------------------------------------------------------ Reshape

    let on = false;
    let part = null;        // the part the grips are on
    let pinned = false;     // a grip has the keys: the grips stay where they are
    let armed = null;       // { part, likes, out: Set, marks, grip }
    let hand = null;        // a drag, or the keys, changing a value now
    let pointer = null;     // where the pointer last was
    let switchTimer = 0;
    let leaveTimer = 0;
    let swallow = null;

    const tip = document.createElement('div');
    tip.className = 'marble-rules-tip';
    tip.setAttribute('role', 'tooltip');
    tip.id = `marble-rules-tip-${Math.random().toString(36).slice(2, 9)}`;
    tip.hidden = true;
    host.append(tip);
    let tipTimer = 0;
    const viewW = () => document.documentElement.clientWidth || innerWidth;
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));
    function showTip(grip) {
      clearTimeout(tipTimer);
      if (!grip.isConnected || grip.hidden || hand) return;
      tip.textContent = tipFor(grip.dataset.grip);
      tip.hidden = false;
      const r = grip.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let top = r.top - 8 - h;
      if (top < INSIDE) top = r.bottom + 8;
      tip.style.left = `${Math.round(clamp(r.left + r.width / 2 - w / 2, INSIDE, viewW() - INSIDE - w))}px`;
      tip.style.top = `${Math.round(top)}px`;
    }
    function hideTip() {
      clearTimeout(tipTimer);
      tip.hidden = true;
    }

    const grips = { corner: makeGrip('corner'), padding: makeGrip('padding') };
    // The keys' way to a part with nothing of its own to focus: a ring round
    // it. The arrows move it to the next part, Tab goes on to its grips.
    const ringHint = document.createElement('div');
    ringHint.id = `marble-rules-ring-hint-${Math.random().toString(36).slice(2, 9)}`;
    ringHint.hidden = true;
    ringHint.textContent = 'Arrow keys move to another part. Tab reaches its corner and its edge.';
    host.append(ringHint);
    const ring = document.createElement('button');
    ring.type = 'button';
    ring.className = 'marble-rules-ring';
    ring.hidden = true;
    ring.setAttribute('aria-describedby', ringHint.id);
    ring.addEventListener('focus', () => { pinned = true; });
    ring.addEventListener('blur', (event) => { if (!host.contains(event.relatedTarget)) pinned = false; });
    ring.addEventListener('click', (event) => event.preventDefault());
    ring.addEventListener('keydown', (event) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (dir && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        const rings = walk().filter((step) => step.ring);
        const i = rings.findIndex((step) => step.ring === part);
        const next = rings[i + dir];
        if (next) { setPart(next.ring); announce(ringLabel(next.ring)); }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        const first = Object.values(grips).find((g) => !g.hidden);
        first?.focus();
      }
    });
    host.append(ring);
    const PROP = { corner: 'border-radius', padding: 'padding' };
    const NAME = { corner: 'Corner radius', padding: 'Padding' };

    /** The values a grip moves, read off a part: its four corners or sides,
     *  and the one the grip shows. Null when it has none in pixels. */
    function shapeOf(kind, el) {
      const css = getComputedStyle(el);
      if (kind === 'corner') {
        const corners = [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomRightRadius, css.borderBottomLeftRadius];
        if (corners.some((c) => c.includes('%'))) return null;
        const px = corners.map((c) => parseFloat(c) || 0);
        return { sides: px, value: Math.round(Math.max(...px)), at: px[0] };
      }
      const px = [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft].map((p) => parseFloat(p) || 0);
      return { sides: px, value: Math.round(px[1]), at: px[1] };
    }
    /** The declaration a value makes, keeping the part's own shape: each
     *  corner or side moves by as much (a square corner of a part that has
     *  round ones stays square). */
    function cssValue(kind, shape, value) {
      const d = value - shape.value;
      const sides = shape.sides.map((s) => (kind === 'corner' && s === 0 && shape.value > 0 ? 0 : Math.max(0, Math.round(s + d))));
      return sides.every((s) => s === sides[0]) ? `${sides[0]}px` : sides.map((s) => `${s}px`).join(' ');
    }
    const most = (kind, el) => {
      const r = el.getBoundingClientRect();
      return kind === 'corner' ? Math.max(0, Math.round(Math.min(r.width, r.height) / 2)) : MOST_PADDING;
    };

    const included = () => (armed ? armed.likes.filter((el) => !armed.out.has(el)) : []);
    function countWords() {
      const total = armed?.likes.length ?? 1;
      const n = hand ? hand.included.length : included().length;
      const [one, many] = unitOf(part);
      return { n, total, one, many, word: (k) => (k === 1 ? one : many) };
    }
    function tagFor(kind) {
      const { n, total, word } = countWords();
      const value = hand?.value ?? (part ? shapeOf(kind, part)?.value : null);
      const verb = kind === 'padding' ? 'Padding' : hand && hand.value < hand.start ? 'Squaring' : 'Rounding';
      const count = n === total ? [verb, n, word(n)] : [verb, n, 'of', total, word(total)];
      return value == null ? [count] : [count, [value, 'px']];
    }
    const said = (pieces) => pieces.map((bit) => bit.join(' ')).join(' · ');
    function tipFor(kind) {
      const all = armed?.part === part ? armed.likes.length : likes(part).length;
      const [one, many] = unitOf(part);
      const what = kind === 'corner' ? 'round' : 'pad';
      return all > 1 ? `Drag to ${what} all ${all} ${many} · ⇧ this one` : `Drag to ${what} this ${one}`;
    }
    function label() {
      for (const [kind, grip] of Object.entries(grips)) {
        const value = hand?.kind === kind ? hand.value : part ? shapeOf(kind, part)?.value : null;
        grip.setAttribute('aria-label', `${NAME[kind]}, ${value ?? 0} px`);
      }
    }
    function speak(kind) {
      if (!armed?.marks) return;
      armed.marks.say(tagFor(kind));
    }

    function makeGrip(kind) {
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'marble-rules-grip';
      grip.dataset.grip = kind;
      grip.hidden = true;
      grip.tabIndex = 0;
      grip.setAttribute('aria-describedby', tip.id);
      grip.addEventListener('pointerenter', (event) => {
        if (!part || hand) return;
        arm(kind);
        if (event.pointerType === 'mouse') { clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(grip), TIP); }
      });
      grip.addEventListener('pointerleave', hideTip);
      grip.addEventListener('focus', () => {
        pinned = true;
        if (!part) return;
        arm(kind);
        if (grip.matches(':focus-visible')) showTip(grip);
      });
      grip.addEventListener('blur', (event) => {
        hideTip();
        if (hand?.by === 'keys' && hand.grip === grip) finish();
        if (!host.contains(event.relatedTarget)) pinned = false;
      });
      grip.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || hand || !part) return;
        event.preventDefault();
        event.stopPropagation();
        hideTip();
        try { grip.setPointerCapture(event.pointerId); } catch { /* the drag still reads the window */ }
        arm(kind);
        start(kind, grip, { by: 'pointer', only: event.shiftKey, x: event.clientX, y: event.clientY, pointerId: event.pointerId });
      });
      grip.addEventListener('pointermove', (event) => {
        if (!hand || hand.pointerId !== event.pointerId) return;
        const dx = event.clientX - hand.x;
        const dy = event.clientY - hand.y;
        const d = kind === 'corner' ? (dx + dy) / 2 : -dx;
        set(clamp(Math.round(hand.start + d), 0, hand.most));
      });
      const release = (event) => { if (hand && hand.pointerId === event.pointerId) finish(); };
      grip.addEventListener('pointerup', release);
      grip.addEventListener('pointercancel', (event) => { if (hand && hand.pointerId === event.pointerId) putBack(); });
      grip.addEventListener('lostpointercapture', (event) => { if (hand && hand.pointerId === event.pointerId) finish(); });
      grip.addEventListener('click', (event) => event.preventDefault());
      grip.addEventListener('keydown', (event) => {
        const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
        if (dir && !event.altKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          event.stopPropagation();
          if (!part) return;
          if (!hand) { arm(kind); start(kind, grip, { by: 'keys' }); }
          if (!hand || hand.kind !== kind) return;
          set(clamp(hand.value + dir * (event.shiftKey ? 4 : 1), 0, hand.most));
          announce(said(tagFor(kind)), { soon: true });
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          if (hand?.by === 'keys') finish();
        }
      });
      host.append(grip);
      return grip;
    }

    // Marks: every part like the one in hand, the moment a grip is reached.
    function arm(kind) {
      if (!part) return;
      if (armed && armed.part !== part) disarm();
      if (!armed) armed = { part, likes: [], out: new Set(), marks: null, grip: kind };
      armed.grip = kind;
      if (!armed.marks?.live) {
        // Marked again (after a change, or a while away): the parts like it
        // as they are now, and the ones left out still left out.
        armed.likes = likes(part);
        for (const el of armed.out) if (!armed.likes.includes(el)) armed.out.delete(el);
        armed.marks = window.marbleChange?.begin?.({ key: 'reshape', ids: armed.likes.map(idOf), hang: idOf(part), say: tagFor(kind) }) ?? null;
        if (armed.out.size) armed.marks?.out([...armed.out].map(idOf));
      }
      speak(kind);
      label();
    }
    function disarm() {
      clearTimeout(switchTimer);
      switchTimer = 0;
      if (!armed) return;
      armed.marks?.clear();
      armed = null;
    }
    /** A press on a marked part leaves it out of the change, or puts it back. */
    function toggle(el) {
      if (!armed || el === armed.part) return;
      const id = idOf(el);
      if (armed.out.has(el)) { armed.out.delete(el); armed.marks?.soon([id]); } else { armed.out.add(el); armed.marks?.out([id]); }
      speak(armed.grip);
      announce(said(tagFor(armed.grip)));
    }

    function start(kind, grip, { by, only = false, x = 0, y = 0, pointerId = null }) {
      const held = part;
      if (!held || !armed || !own(held)) return;
      const others = armed.likes.filter((el) => el !== held);
      const moving = only ? [held] : included();
      if (!moving.includes(held)) moving.unshift(held);
      // A part the engine is still playing in is let go where it is going,
      // so the hand starts from what is, not from a frame of the motion.
      for (const el of moving) {
        for (const a of el.getAnimations()) if (a.id === 'marble-morph') { try { a.finish(); } catch { a.cancel(); } }
      }
      const shape = shapeOf(kind, held);
      if (!shape) return;
      const originals = new Map(moving.map((el) => [el, ownStyle(el)]));
      for (const [el, value] of originals) handHeld.set(el, value);
      hand = {
        kind, grip, by, only, x, y, pointerId, shape, part: held,
        start: shape.value, value: shape.value, most: Math.max(shape.value, most(kind, held)),
        included: moving,
        originals,
      };
      // ⇧: the others are left out of this one.
      if (only) armed.marks?.out(others.filter((el) => !armed.out.has(el)).map(idOf));
      for (const el of moving) {
        el.setAttribute(DRAGGING, '');
        el.style.setProperty('transition', 'none', 'important');
      }
      grip.toggleAttribute('data-held', true);
      if (by === 'pointer') document.documentElement.classList.add(`marble-rules-held-${kind}`);
      hideTip();
      speak(kind);
    }

    /** Under the hand nothing eases: every part takes the value at once. */
    function set(value) {
      if (!hand) return;
      // The part in hand left the page: everything goes back.
      if (!own(hand.part)) { putBack(); return; }
      hand.value = value;
      const css = cssValue(hand.kind, hand.shape, value);
      for (const el of hand.included) el.style.setProperty(PROP[hand.kind], css, 'important');
      armed?.marks?.refresh();
      speak(hand.kind);
      label();
      schedule();
    }

    function letGo(h) {
      h.grip.removeAttribute('data-held');
      document.documentElement.classList.remove('marble-rules-held-corner', 'marble-rules-held-padding');
      for (const el of h.included) el.removeAttribute(DRAGGING);
      if (h.only && armed) armed.marks?.soon(armed.likes.filter((el) => el !== h.part && !armed.out.has(el)).map(idOf));
    }

    /** Back to how it was; nothing filed. */
    function putBack() {
      const h = hand;
      if (!h) return;
      hand = null;
      // Held still while the old values come back, so the page's own
      // transitions do not play them.
      for (const el of h.included) setStyle(el, frozen(h.originals.get(el)));
      for (const el of h.included) if (el.isConnected) getComputedStyle(el).getPropertyValue(PROP[h.kind]);
      for (const el of h.included) setStyle(el, h.originals.get(el));
      for (const el of h.included) handHeld.delete(el);
      letGo(h);
      armed?.marks?.refresh();
      speak(h.kind);
      label();
      schedule();
    }

    /** Letting go: one rule for every part that moved. */
    async function finish() {
      const h = hand;
      if (!h) return;
      // Nothing moved, or the part in hand has left the page: back as it was.
      if (h.value === h.start || !own(h.part)) { putBack(); return; }
      hand = null;
      const held = h.part;
      const was = armed;
      const marks = armed?.marks ?? null;
      const n = h.included.length;
      const [one, many] = unitOf(held);
      let failed = null;
      try {
        // ⇧: a rule for this one part, of its own, which outranks its kind's.
        // Otherwise the kind's: what its selector reaches that is not of this
        // kind (another class as well), and what was left out, keep their
        // own; a part of the kind that is hidden now changes with the rest.
        const kindSelector = h.only ? `${selectorOf(held)}[${ID}="${cssString(idOf(held))}"]` : selectorOf(held);
        const reached = query(kindSelector) ?? [];
        const same = reached.filter((el) => own(el) && sameKind(held, el));
        const targets = h.only ? [held] : [...new Set([...h.included.filter(own), ...same.filter((el) => !was?.likes.includes(el))])];
        const exclude = reached.filter((el) => own(el) && !targets.includes(el));
        const value = cssValue(h.kind, h.shape, h.value);
        await commit({ selector: kindSelector, declarations: { [PROP[h.kind]]: value }, targets, exclude, originals: h.originals, marks });
      } catch (err) {
        failed = err;
      }
      letGo(h);
      if (failed) {
        console.warn(`marble-rules: the change was not filed: ${failed?.message ?? failed}`);
        hand = h;
        putBack();
        announce("Couldn't change them. Try again.");
        return;
      }
      // The marks lift, and a press on a part is the page's again; the next
      // reach of a grip marks them afresh.
      marks?.end();
      if (armed === was) armed = null;
      announce(`${n} ${n === 1 ? one : many} ${h.kind === 'corner' ? (h.value < h.start ? 'squared' : 'rounded') : 'padded'} to ${h.value} px`);
      label();
      schedule();
    }

    // ------------------------------------------------------------ where the grips are

    /** The part a pointer or the keys are on: the nearest of the page's own
     *  parts round it that shows a box of its own (a border, a background, a
     *  radius or a shadow) and is at least 24px each way. */
    function partAt(node) {
      let el = node?.nodeType === 1 ? node : node?.parentElement;
      el = el?.closest?.(`[${ID}]`) ?? null;
      while (el && el !== document.body) {
        if (reshapable(el)) return el;
        el = el.parentElement?.closest(`[${ID}]`) ?? null;
      }
      return null;
    }
    function reshapable(el) {
      if (!own(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < SMALLEST || r.height < SMALLEST) return false;
      const css = getComputedStyle(el);
      const edged = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(css[`border${side}Width`]) > 0
        && css[`border${side}Style`] !== 'none' && opaque(css[`border${side}Color`]));
      return edged || opaque(css.backgroundColor) || parseFloat(css.borderTopLeftRadius) > 0 || (css.boxShadow && css.boxShadow !== 'none');
    }

    function setPart(el) {
      clearTimeout(switchTimer);
      clearTimeout(leaveTimer);
      switchTimer = 0;
      leaveTimer = 0;
      if (el === part) return;
      if (armed && armed.part !== el) disarm();
      part = el;
      hideTip();
      watchPart();
      label();
      place();
    }

    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
    function place() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      // The part in hand left the page: what the hand changed goes back.
      if (hand && !own(hand.part)) putBack();
      const live = on && part?.isConnected && own(part);
      if (on && part && !live) { part = null; disarm(); }
      if (!live) {
        if (document.activeElement === ring) ring.blur();
        ring.hidden = true;
      } else {
        const r = part.getBoundingClientRect();
        ring.hidden = false;
        Object.assign(ring.style, {
          left: `${Math.round(r.left)}px`, top: `${Math.round(r.top)}px`,
          width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px`,
          borderRadius: getComputedStyle(part).borderRadius,
        });
        ring.setAttribute('aria-label', ringLabel(part));
      }
      for (const [kind, grip] of Object.entries(grips)) {
        const shape = live ? shapeOf(kind, part) : null;
        if (!shape) {
          if (!grip.hidden) { if (document.activeElement === grip) grip.blur(); grip.hidden = true; }
          continue;
        }
        if (grip.hidden) grip.hidden = false;
        const r = part.getBoundingClientRect();
        const w = grip.offsetWidth;
        const h = grip.offsetHeight;
        let x;
        let y;
        if (kind === 'corner') {
          // Inside the corner, on its curve.
          const radius = Math.min(shape.at, Math.min(r.width, r.height) / 2);
          x = r.left + radius * 0.293 - w / 2;
          y = r.top + radius * 0.293 - h / 2;
        } else {
          // Inside the right edge, where the words begin.
          x = clamp(r.right - shape.sides[1] - w / 2, r.left + r.width / 2, r.right - w - 3);
          y = r.top + r.height / 2 - h / 2;
        }
        grip.style.left = `${Math.round(x)}px`;
        grip.style.top = `${Math.round(y)}px`;
      }
    }
    const sized = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    let watched = null;
    function watchPart() {
      if (watched === part) return;
      if (watched) sized?.unobserve(watched);
      watched = part;
      if (part) sized?.observe(part);
    }

    addEventListener('pointermove', (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (!on || hand || event.pointerType === 'touch') return;
      const target = event.target;
      if (host.contains(target)) { clearTimeout(switchTimer); clearTimeout(leaveTimer); switchTimer = 0; leaveTimer = 0; return; }
      if (pinned) return;
      const next = partAt(target);
      if (armed) {
        // Marked: the pointer may cross to any of them, and the gaps
        // between, to leave one out; the marks let go once it rests on a
        // part of another kind, or a while away from all of them.
        if (next === part || armed.likes.some((el) => el.contains(target))) {
          clearTimeout(switchTimer); switchTimer = 0;
          clearTimeout(leaveTimer); leaveTimer = 0;
          return;
        }
        if (!next) {
          clearTimeout(switchTimer); switchTimer = 0;
          if (!leaveTimer) leaveTimer = setTimeout(() => { leaveTimer = 0; if (!pinned && !hand) setPart(null); }, LEAVE_MARKED);
          return;
        }
        clearTimeout(leaveTimer); leaveTimer = 0;
        if (!switchTimer) switchTimer = setTimeout(() => { switchTimer = 0; if (!pinned && !hand) setPart(partAt(document.elementFromPoint(pointer.x, pointer.y))); }, SWITCH);
        return;
      }
      if (next) { setPart(next); return; }
      if (part && !leaveTimer) leaveTimer = setTimeout(() => { leaveTimer = 0; if (!armed && !pinned && !hand) setPart(null); }, LEAVE);
    }, { capture: true, passive: true });

    // A press on a marked part leaves it out (or puts it back). A finger has
    // no hover, so its press chooses the part.
    addEventListener('pointerdown', (event) => {
      if (!on || hand || host.contains(event.target)) return;
      const like = armed?.marks?.live ? armed.likes.find((el) => el !== armed.part && el.contains(event.target)) ?? null : null;
      if (like && event.button === 0) {
        event.preventDefault();
        event.stopPropagation();
        swallowClick();
        toggle(like);
        return;
      }
      if (event.pointerType !== 'mouse') {
        const next = partAt(event.target);
        if (next && next !== part) {
          setPart(next);
          swallowClick();
        }
      }
    }, true);
    function swallowClick() {
      if (swallow) removeEventListener('click', swallow, true);
      swallow = (event) => { event.preventDefault(); event.stopPropagation(); };
      addEventListener('click', swallow, true);
      setTimeout(() => { if (swallow) { removeEventListener('click', swallow, true); swallow = null; } }, 600);
    }

    // The keys: a part that takes focus gets the grips.
    document.addEventListener('focusin', (event) => {
      if (!on || hand || host.contains(event.target)) return;
      const next = partAt(event.target);
      if (next) setPart(next);
    });

    // The stops of the page, as Tab would find them.
    const TABBABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, summary, audio[controls], video[controls], [contenteditable], [tabindex]';
    const tabbable = (el) => el.matches(TABBABLE) && !el.closest(`[${TRANSIENT}]`) && !el.closest('[inert]') && !el.disabled
      && (el.isContentEditable && !el.hasAttribute('tabindex') ? 0 : el.tabIndex) >= 0
      && !(el.isContentEditable && el.parentElement?.isContentEditable)
      && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true }));

    /** The keys' way through the page in Reshape: its own stops and its
     *  parts, in its order; each part is a ring first, and its grips come
     *  after everything inside it. */
    function walk() {
      const out = [];
      let looked = 0;
      const visit = (el) => {
        if (looked >= SCAN || el.hasAttribute(TRANSIENT)) return;
        looked += 1;
        const isPart = el.hasAttribute(ID) && reshapable(el);
        if (isPart) out.push({ ring: el });
        if (tabbable(el)) out.push({ stop: el });
        if (el.localName !== 'svg') for (const child of el.children) visit(child);
        if (isPart) {
          if (shapeOf('corner', el)) out.push({ grip: 'corner', el });
          out.push({ grip: 'padding', el });
        }
      };
      for (const child of document.body?.children ?? []) visit(child);
      return out;
    }
    /** Where the keys are in that walk. */
    function whereIn(steps, a) {
      if (a === ring) return steps.findIndex((s) => s.ring === part);
      if (host.contains(a)) return steps.findIndex((s) => s.grip === a.dataset.grip && s.el === part);
      return steps.findIndex((s) => s.stop && (s.stop === a || s.stop.contains(a)));
    }
    function go(step) {
      if (step.stop) { step.stop.focus(); return; }
      if (part !== (step.ring ?? step.el)) setPart(step.ring ?? step.el);
      place();
      if (step.ring) ring.focus();
      else grips[step.grip].focus();
    }
    const ringLabel = (el) => {
      const [one] = unitOf(el);
      const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return `${one.charAt(0).toUpperCase()}${one.slice(1)}${words ? `: ${words}` : ''}`;
    };

    /** Whether a key is the page's to take: not a field's, a chat's, a
     *  menu's, or another layer's of the drive. */
    function pageHasKey(event) {
      for (const node of event.composedPath()) {
        if (node === document.body || node === document.documentElement || node === document || node === window) break;
        if (node instanceof ShadowRoot) return false;
        if (!(node instanceof Element)) continue;
        if (host.contains(node)) continue;
        if (node.hasAttribute(TRANSIENT)) return false;
        if (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) return false;
        if (node.matches('dialog, [role="dialog"], [role="alertdialog"], [popover], [role="menu"], [role="listbox"], [role="combobox"]')) return false;
      }
      return true;
    }

    addEventListener('keydown', (event) => {
      if (!on || event.isComposing) return;
      if (event.key === 'Escape') {
        // A value in hand goes back; with nothing in hand, Reshape ends.
        if (hand) {
          event.preventDefault();
          event.stopPropagation();
          putBack();
          return;
        }
        if (!pageHasKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
        reshape(false);
        return;
      }
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      // Tab walks the page's stops and its parts; past either end it goes
      // where Tab would. Keys in another layer (the line, a chat) are its own.
      let a = document.activeElement;
      if (a && a !== document.body && a.closest?.(`[${TRANSIENT}]`) && !host.contains(a)) return;
      if (a?.shadowRoot && !pageHasKey(event)) return;
      if (hand) finish();
      const steps = walk();
      if (!steps.length) return;
      const nowhere = !a || a === document.body || a === document.documentElement;
      let at = nowhere ? -1 : whereIn(steps, a);
      let next;
      if (nowhere && !event.shiftKey && part) next = steps.find((s) => s.ring === part) ?? steps[0];
      else if (at < 0 && !nowhere) return;
      else next = steps[at + (event.shiftKey ? -1 : 1)] ?? (nowhere && event.shiftKey ? steps.at(-1) : null);
      if (!next) { pinned = false; return; }
      event.preventDefault();
      go(next);
    }, true);

    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    document.addEventListener('marble:ops', schedule);

    // ------------------------------------------------------------ undo and redo
    //
    // One change, one undo, and ⌘Z plays the same motion backwards: the
    // person's history (the carrier's ring) takes a rule out, or puts it
    // back, in one go. What that did is read off the page the moment it is
    // done: it is wound back to read what was, wound forward again, and the
    // engine plays the difference, every part held still meanwhile so the
    // page's own transitions do not play it too. A host's ops (an agent, an
    // agent's undo) are the marks' to play, and this page's own commits are
    // played as they are made.

    const isRule = (node) => node?.nodeType === 1 && node.tagName === 'STYLE' && node.hasAttribute(RULE);
    let fromHost = false;
    document.addEventListener('marble:ops', () => { fromHost = true; queueMicrotask(() => { fromHost = false; }); }, true);
    const watcher = new MutationObserver((records) => {
      if (fromHost) return;
      try { playBack(records); } catch (err) { console.warn(`marble-rules: could not play that back: ${err?.message ?? err}`); }
    });
    if (document.body) {
      watcher.observe(document.body, {
        subtree: true, childList: true, characterData: true, characterDataOldValue: true,
        attributes: true, attributeFilter: ['style'], attributeOldValue: true,
      });
    }

    function playBack(records) {
      const ruled = records.filter((r) => isRule(r.target) || (r.type === 'characterData' && isRule(r.target.parentNode))
        || (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some(isRule)));
      if (!ruled.length || hand || typeof window.marbleMorph?.capture !== 'function') return;
      const mine = records.filter((r) => ruled.includes(r) || (r.type === 'attributes' && own(r.target)));
      // What the rules reach, as they were and as they are.
      const texts = new Set();
      for (const r of mine) {
        for (const node of [r.target, r.target.parentNode, ...(r.addedNodes ?? []), ...(r.removedNodes ?? [])]) {
          if (isRule(node)) texts.add(node.textContent);
        }
        if (r.type === 'childList' && isRule(r.target)) texts.add([...r.removedNodes].map((n) => n.textContent).join(''));
        if (r.type === 'characterData' && isRule(r.target.parentNode)) texts.add(r.oldValue ?? '');
      }
      const parts = new Set();
      for (const text of texts) {
        const cut = text.indexOf('{');
        for (const el of (cut > 0 ? query(text.slice(0, cut).trim()) : null) ?? []) if (own(el)) parts.add(el);
      }
      for (const r of mine) if (r.type === 'attributes') parts.add(r.target);
      const els = [...parts].filter((el) => el.isConnected);
      if (!els.length) return;

      // Back to how it was.
      const forward = new Map();
      for (const r of [...mine].reverse()) {
        if (r.type === 'attributes') {
          forward.set(r, r.target.getAttribute(r.attributeName));
          if (r.oldValue == null) r.target.removeAttribute(r.attributeName);
          else r.target.setAttribute(r.attributeName, r.oldValue);
        } else if (r.type === 'characterData') {
          forward.set(r, r.target.data);
          r.target.data = r.oldValue ?? '';
        } else {
          for (const node of r.addedNodes) if (node.parentNode === r.target) node.remove();
          const at = r.nextSibling?.parentNode === r.target ? r.nextSibling : null;
          for (const node of r.removedNodes) r.target.insertBefore(node, at);
        }
      }
      const was = els.map((el) => el.getAttribute('style'));
      els.forEach((el, i) => setStyle(el, frozen(was[i])));
      let snap = null;
      try { snap = window.marbleMorph.capture(els.length <= 60 ? els.map(idOf) : [], { kind: 'look', scope: 'page' }); } catch { snap = null; }
      els.forEach((el, i) => setStyle(el, was[i]));
      // And forward again, to how it is, without a frame in between.
      for (const r of mine) {
        if (r.type === 'attributes') {
          const value = forward.get(r);
          if (value == null) r.target.removeAttribute(r.attributeName);
          else r.target.setAttribute(r.attributeName, value);
        } else if (r.type === 'characterData') {
          r.target.data = forward.get(r);
        } else {
          for (const node of r.removedNodes) if (node.parentNode === r.target) node.remove();
          const at = r.nextSibling?.parentNode === r.target ? r.nextSibling : null;
          for (const node of r.addedNodes) r.target.insertBefore(node, at);
        }
      }
      const now = els.map((el) => el.getAttribute('style'));
      els.forEach((el, i) => setStyle(el, frozen(now[i])));
      for (const el of els) getComputedStyle(el).getPropertyValue('border-radius');
      els.forEach((el, i) => setStyle(el, now[i]));
      watcher.takeRecords();
      if (snap) Promise.resolve(window.marbleMorph.play(snap)).catch(() => { /* it is there all the same */ });
    }

    // ------------------------------------------------------------ on and off

    function reshape(next = !on) {
      next = Boolean(next);
      if (next === on) return on;
      on = next;
      if (!on) {
        putBack();
        disarm();
        part = null;
        pinned = false;
        hideTip();
        if (host.contains(document.activeElement)) document.activeElement.blur();
      } else if (pointer) {
        const under = partAt(document.elementFromPoint(pointer.x, pointer.y));
        if (under) part = under;
        watchPart();
      }
      document.documentElement.classList.toggle('marble-reshaping', on);
      offerTray();
      label();
      place();
      announce(on ? 'Reshape is on. Drag a part\'s corner or edge and every part like it follows. Esc to leave.' : 'Reshape is off.');
      return on;
    }

    // Where the keys were on the page before a menu took them: a mode turned
    // on from the menu leaves them there, so the page's own keys (Esc, Tab)
    // reach it.
    let pageFocus = null;
    document.addEventListener('focusin', (event) => {
      const t = event.target;
      if (t && t !== document.body && t.getRootNode?.() === document && !t.closest?.(`[${TRANSIENT}]`)) pageFocus = t;
    }, true);
    function keysBack() {
      setTimeout(() => {
        let a = document.activeElement;
        if (!a || a === document.body || host.contains(a)) return;
        if (pageFocus?.isConnected && pageFocus !== a) { pageFocus.focus({ preventScroll: true }); return; }
        while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
        a?.blur?.();
        document.activeElement?.blur?.();
      }, 0);
    }

    let trayHeld = false;
    function offerTray() {
      // `always`: on a touch screen the tray shows only contextual tools, so
      // Reshape by hand is a pointer-and-keys feature; a phone asks in words.
      const spec = { id: 'reshape', order: 9, label: 'Reshape', icon: RESHAPE, always: true, active: on, onSelect: () => { reshape(!on); keysBack(); } };
      if (!trayHeld) {
        trayHeld = !dispatchEvent(new CustomEvent('marble-tray:register', { cancelable: true, detail: spec }));
        return;
      }
      dispatchEvent(new CustomEvent('marble-tray:update', { detail: spec }));
    }
    addEventListener('marble-tray:ready', () => { trayHeld = false; offerTray(); });
    offerTray();

    window.marbleRules = {
      likes,
      commit,
      reshape,
      fromWords,
      /** A rule from words, checked against the page: how many parts it
       *  would change and which, or null. */
      check(rule, scopeIds = []) {
        const found = plan(rule, (scopeIds ?? []).map((id) => byId(String(id))).filter(own));
        return found ? { targets: found.targets.length, ids: found.targets.map(idOf), declarations: found.declarations } : null;
      },
      get on() { return on; },
      /** The part the grips (and the keys' ring) are on now. */
      get part() { return part; },
    };
  };

  if (window.marble?.agent) boot(window.marble);
  else addEventListener('marble:agent', () => boot(window.marble), { once: true });
})();
