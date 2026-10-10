// What a share link may change in the one page it opens.
//
// Three levels, and the line between each is a kind of change, not a list of
// people:
//
//   view    reads the page and hears it change. Files nothing.
//   edit    changes what the page offers to change: text in an editable, a
//           box ticked, a row added, moved or taken away. Anywhere under an
//           element that carries an affordance marker, and nowhere else.
//   modify  changes the page itself: any element, any structure, its look.
//
// Under all three, the page's code stays its owner's. A document's scripts run
// with whatever the person reading it can do, and the owner reads it with the
// whole drive in hand — agents that run commands, every other page. So no op
// from a link may add a script, a handler, an embed, a `javascript:` address
// or an automation an agent would run, and none may touch an element that
// holds a script. That holds at every level, which is what makes `modify`
// safe to hand out at all.
//
// The check is on the op's own text, not on a parse of it in context. An
// insert is spliced into the file and parsed where it lands, but the open tabs
// parse it in a <template>, and the two can disagree (CDATA in an <svg>, a
// tag in a <style>). So any tag-shaped run anywhere in the markup counts,
// comments and all. That refuses a few harmless strings to refuse every
// harmful one.

import { applyOp, indexIds, parseSource } from './engine.js';

export const ROLES = ['view', 'edit', 'modify'];

/** Every marker an affordance in lib/affordances.js answers to. An element
 *  under one of these is a part of the page made for changing. */
const MARKERS = [
  'data-marble-editable', 'data-marble-toggle', 'data-marble-choose', 'data-marble-step',
  'data-marble-value', 'data-marble-expand', 'data-marble-sortable', 'data-marble-add',
  'data-marble-removable', 'data-marble-resizable', 'data-marble-alt', 'data-marble-active',
  'data-marble-note', 'data-marble-note-body', 'data-marble-canvas', 'data-marble-into',
];
/** The controls that set an attribute on an ancestor (`data-marble-of`), so the
 *  element they point at is fair game for a setAttr even with no marker of its own. */
const CONTROLS = ['data-marble-toggle', 'data-marble-choose', 'data-marble-step', 'data-marble-value', 'data-marble-expand', 'data-marble-of'];

/** Elements that run, embed, redirect or reach outside the page. */
const BLOCKED_TAGS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'fencedframe',
  'base', 'meta', 'link', 'plaintext', 'xmp', 'noembed', 'noframes', 'noscript',
  // SVG's own ways to set an attribute (to a `javascript:` href) or run.
  'animate', 'set', 'animatemotion', 'animatetransform', 'handler', 'listener', 'foreignobject',
]);
/** Raw text: unclosed, it would swallow the rest of the file. */
const RAW_TAGS = new Set(['style', 'textarea', 'title']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param', 'keygen']);

/** Attributes whose value the browser follows as an address. */
const URL_ATTRS = new Set([
  'href', 'src', 'xlink:href', 'poster', 'background', 'cite', 'data', 'longdesc', 'ping',
  'codebase', 'manifest', 'lowsrc', 'dynsrc', 'srcset', 'imagesrcset',
]);
/** Attributes refused outright, whatever their value. */
const BLOCKED_ATTRS = new Set([
  'srcdoc', 'action', 'formaction', 'http-equiv', 'is',
  // An automation: pressing it starts one of the owner's agents with its brief,
  // and one on a schedule starts them by itself unless it is held.
  'data-marble-run', 'data-marble-scope', 'data-marble-on', 'data-marble-paused',
  // Identity is the file's to give (assignId), never an attribute to rewrite.
  'data-marble-id',
]);
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const ATTR_NAME = /^[a-z_:][a-z0-9_:.-]*$/i;
const ID_VALUE = /^[A-Za-z0-9_-]{1,64}$/;

// Words the person sees when a change is refused: what they cannot do, in
// terms of the page, not of ops.
export const SAYS = {
  read: 'This link can only read the page',
  code: 'The page’s code stays with its owner',
  region: 'This link can change only the parts of the page made for editing',
  style: 'Restyling the page needs a link that can modify it',
  markup: 'That change has markup a shared link can’t add',
  address: 'That link goes somewhere a shared link can’t point',
};

const tagOf = (node) => String(node?.tagName ?? '').toLowerCase();
const attr = (node, name) => node?.attrs?.find((a) => a.name === name)?.value ?? null;
const hasAny = (node, names) => Boolean(node?.attrs?.some((a) => names.includes(a.name)));

function* ancestry(node) {
  for (let n = node; n && n.tagName; n = n.parentNode) yield n;
}

function holdsScript(node) {
  if (tagOf(node) === 'script') return true;
  for (const child of node?.childNodes ?? []) if (child.tagName && holdsScript(child)) return true;
  return false;
}

/** Does `node` match a simple selector list (`li`, `.row`, `tr[data-k]`,
 *  `#x`, comma-separated)? `null` for anything with a combinator or a
 *  pseudo-class, which this does not try to read. */
function matches(node, selector) {
  const one = (part) => {
    const m = /^([a-z][a-z0-9-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/i.exec(part.trim());
    if (!m) return null;
    if (m[1] && m[1].toLowerCase() !== tagOf(node)) return false;
    for (const [, kind, name] of m[2].replace(/\[[^\]]*\]/g, '').matchAll(/([.#])([\w-]+)/g)) {
      if (kind === '.' && !String(attr(node, 'class') ?? '').split(/\s+/).includes(name)) return false;
      if (kind === '#' && attr(node, 'id') !== name) return false;
    }
    for (const [, name, value] of m[2].matchAll(/\[\s*([\w:-]+)\s*(?:=\s*["']?([^"'\]]*)["']?)?\s*\]/g)) {
      const have = attr(node, name.toLowerCase());
      if (have === null || (value !== undefined && have !== value)) return false;
    }
    return true;
  };
  const results = String(selector).split(',').map(one);
  if (results.includes(null)) return null;
  return results.includes(true);
}

/** The element a control sets its attribute on: `closest(data-marble-of)`,
 *  or itself (lib/affordances.js, resolve). */
function targetOf(control) {
  const selector = attr(control, 'data-marble-of');
  if (!selector) return control;
  for (const n of ancestry(control)) {
    const hit = matches(n, selector);
    if (hit === null) return null;
    if (hit) return n;
  }
  return null;
}

/** Is `node` the element one of the page's own controls points at? */
function pointedAt(node, below = node) {
  for (const child of below?.childNodes ?? []) {
    if (!child.tagName) continue;
    if (hasAny(child, CONTROLS) && targetOf(child) === node) return true;
    if (pointedAt(node, child)) return true;
  }
  return false;
}

/** Is this element in a part of the page that invites changing? */
const invites = (node) => [...ancestry(node)].some((n) => hasAny(n, MARKERS));

// ------------------------------------------------------------ attribute values

const NAMED = { colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', period: '.', semi: ';', num: '#' };

/** The value as the browser hands it to the URL parser: character references
 *  decoded, and the whitespace and controls it would drop taken out. A named
 *  reference we do not know is refused rather than guessed at. */
function urlText(value) {
  let unknown = false;
  const decoded = String(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Math.min(Number(dec), 0x10ffff)))
    .replace(/&([a-z]+);?/gi, (m, name) => {
      const known = NAMED[name.toLowerCase()];
      if (known === undefined) unknown = true;
      return known ?? m;
    });
  return unknown ? null : decoded.replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
}

function safeUrl(value) {
  const text = urlText(value);
  if (text === null) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(text)?.[1];
  if (!scheme) return true; // relative, a fragment, or a path on this host
  if (SAFE_SCHEMES.has(scheme)) return true;
  return scheme === 'data' && text.startsWith('data:image/');
}

function safeSrcset(value) {
  return String(value).split(',').every((part) => safeUrl(part.trim().split(/\s+/)[0] ?? ''));
}

/** Why this attribute may not be set, or null. Shared by setAttr and by every
 *  tag in inserted markup. */
function attrRefusal(name, value) {
  const lower = String(name).toLowerCase();
  if (!ATTR_NAME.test(lower) || lower.startsWith('on') || BLOCKED_ATTRS.has(lower)) return SAYS.markup;
  if (value === null || value === undefined) return null;
  if (lower === 'srcset' || lower === 'imagesrcset') return safeSrcset(value) ? null : SAYS.address;
  if (URL_ATTRS.has(lower)) return safeUrl(value) ? null : SAYS.address;
  return null;
}

// ------------------------------------------------------------------- markup

const SPACE = /[\t\n\f\r ]/;
const ALPHA = /[a-z]/i;

/** Every tag a browser could find in this text, in any context, the way its
 *  tokenizer reads them: names, and attributes with quoted or bare values.
 *  `null` when the markup is unfinished (an open quote, tag or comment), which
 *  spliced into a file would swallow what follows it. */
export function tagsIn(html) {
  const tags = [];
  const s = String(html);
  let i = 0;
  while ((i = s.indexOf('<', i)) >= 0) {
    const next = s[i + 1];
    if (next === '!') {
      if (s.startsWith('<!--', i)) {
        const end = s.indexOf('-->', i + 4);
        if (end < 0) return null;
        // Inside a comment is not skipped: in a <style> or an <svg> the same
        // bytes are not a comment at all.
        i += 4;
        continue;
      }
      return { refused: SAYS.markup }; // <![CDATA[, <!doctype, and the bogus comments
    }
    if (next === '?') return { refused: SAYS.markup };
    const closing = next === '/';
    const start = closing ? i + 2 : i + 1;
    if (!ALPHA.test(s[start] ?? '')) { i += 1; continue; }
    let j = start;
    while (j < s.length && !SPACE.test(s[j]) && s[j] !== '/' && s[j] !== '>') j += 1;
    const tag = { name: s.slice(start, j).toLowerCase(), closing, attrs: [] };
    let done = false;
    while (j < s.length && !done) {
      const c = s[j];
      if (SPACE.test(c) || c === '/') { j += 1; continue; }
      if (c === '>') { done = true; j += 1; break; }
      // An attribute name. A leading `=` is part of it, as the tokenizer has it.
      let k = j + 1;
      while (k < s.length && !SPACE.test(s[k]) && s[k] !== '/' && s[k] !== '>' && s[k] !== '=') k += 1;
      const name = s.slice(j, k).toLowerCase();
      j = k;
      while (j < s.length && SPACE.test(s[j])) j += 1;
      let value = '';
      if (s[j] === '=') {
        j += 1;
        while (j < s.length && SPACE.test(s[j])) j += 1;
        const q = s[j];
        if (q === '"' || q === "'") {
          const end = s.indexOf(q, j + 1);
          if (end < 0) return null;
          value = s.slice(j + 1, end);
          j = end + 1;
        } else {
          let e = j;
          while (e < s.length && !SPACE.test(s[e]) && s[e] !== '>') e += 1;
          value = s.slice(j, e);
          j = e;
        }
      }
      tag.attrs.push({ name, value });
    }
    if (!done) return null;
    tags.push(tag);
    i = j;
  }
  return { tags };
}

/** Why this markup may not go in, or null. `ids` are the ids the file already
 *  has: an inserted element may not take one. */
export function markupRefusal(html, role, ids = new Set()) {
  const read = tagsIn(html);
  if (!read) return SAYS.markup;
  if (read.refused) return read.refused;
  const open = [];
  const minted = new Set();
  for (const tag of read.tags) {
    if (BLOCKED_TAGS.has(tag.name) || tag.name.startsWith('marble-')) return SAYS.markup;
    for (const { name, value } of tag.attrs) {
      if (name === 'data-marble-id') {
        if (!ID_VALUE.test(value) || ids.has(value) || minted.has(value)) return SAYS.markup;
        minted.add(value);
        continue;
      }
      const why = attrRefusal(name, value);
      if (why) return why;
    }
    if (role === 'edit' && tag.name === 'style') return SAYS.style;
    if (tag.closing) {
      // An end tag closes only what this markup opened, never the elements
      // around the place it lands.
      const at = open.lastIndexOf(tag.name);
      if (at < 0) return SAYS.markup;
      open.length = at;
    } else if (!VOID_TAGS.has(tag.name)) {
      open.push(tag.name);
    }
  }
  if (open.some((name) => RAW_TAGS.has(name))) return SAYS.markup;
  return null;
}

// ---------------------------------------------------------------------- ops

function opRefusal(tree, op, role) {
  const byId = indexIds(tree);
  const node = op.id ? byId.get(op.id) : null;
  const parent = op.parentId ? byId.get(op.parentId) : null;
  // An id the file does not have is the guard's to refuse, in its own words.
  if (op.id && !node && op.type !== 'assignId') return null;
  if (op.parentId && !parent) return null;
  const ids = new Set(byId.keys());

  switch (op.type) {
    case 'assignId':
      return ID_VALUE.test(String(op.id ?? '')) ? null : SAYS.markup;

    case 'setText':
      if (holdsScript(node)) return SAYS.code;
      if (role === 'edit' && !invites(node)) return SAYS.region;
      return null;

    case 'setInner':
      if (holdsScript(node)) return SAYS.code;
      if (role === 'edit' && !invites(node)) return SAYS.region;
      return markupRefusal(op.html ?? '', role, ids);

    case 'setAttr': {
      if (BLOCKED_TAGS.has(tagOf(node))) return SAYS.code;
      if (role === 'edit' && !invites(node) && !pointedAt(node)) return SAYS.region;
      return attrRefusal(op.name, op.value);
    }

    case 'insert':
      if (BLOCKED_TAGS.has(tagOf(parent))) return SAYS.code;
      if (role === 'edit' && !invites(parent)) return SAYS.region;
      return markupRefusal(op.html ?? '', role, ids);

    case 'remove':
      if (holdsScript(node)) return SAYS.code;
      if (role === 'edit' && !invites(node)) return SAYS.region;
      return null;

    case 'move':
      if (holdsScript(node) || BLOCKED_TAGS.has(tagOf(parent))) return SAYS.code;
      if (role === 'edit' && !(invites(node) && invites(parent))) return SAYS.region;
      return null;

    default:
      return SAYS.markup;
  }
}

/** Why a share link at `role` may not file this batch against `source`, or
 *  null if it may. Each op is judged against the document as the ops before
 *  it left it, so a row added and then typed into in one batch is judged as
 *  the row it is. */
export function shareRefusal(source, ops, role) {
  if (!ROLES.includes(role)) return SAYS.read;
  if (role === 'view') return SAYS.read;
  let current = source;
  for (const op of ops) {
    if (!op || typeof op !== 'object') return SAYS.markup;
    const why = opRefusal(parseSource(current), op, role);
    if (why) return why;
    try {
      current = applyOp(current, op);
    } catch {
      // The patcher will throw the same thing for the guard, which says it
      // better. Nothing after an op that does not resolve can be judged.
      return null;
    }
  }
  return null;
}
