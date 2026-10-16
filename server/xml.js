// Just enough XML to read what Office writes.
//
// Office XML is machine-written and regular: no DTDs to expand, no entities
// beyond the five and character references, namespaces always prefixed. So a
// tree of `{ name, attrs, kids }` with the prefixes kept in the names
// (`a:t`, `p:sp`) is all a reader of it needs, and is what this makes. Text is
// kept as strings among the kids, whitespace included, because `<a:t> </a:t>`
// is a space somebody typed.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export const decode = (s) =>
  s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref) => {
        if (ref[0] !== '#') return ENTITIES[ref] ?? whole;
        const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return '';
        }
      });

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** The document's root element. Throws on markup it cannot follow. */
export function parseXml(text) {
  const src = String(text);
  const root = { name: '#document', attrs: {}, kids: [] };
  const stack = [root];
  let at = 0;
  while (at < src.length) {
    const lt = src.indexOf('<', at);
    if (lt < 0) {
      pushText(stack, src.slice(at));
      break;
    }
    if (lt > at) pushText(stack, src.slice(at, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      at = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      const body = src.slice(lt + 9, end < 0 ? src.length : end);
      stack.at(-1).kids.push(body);
      at = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt);
      at = end < 0 ? src.length : end + 1;
      continue;
    }
    const gt = tagEnd(src, lt);
    if (gt < 0) throw new Error('unterminated tag');
    if (src[lt + 1] === '/') {
      const name = src.slice(lt + 2, gt).trim();
      // Close back to the matching open tag; a stray close is ignored.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      at = gt + 1;
      continue;
    }
    const selfClosing = src[gt - 1] === '/';
    const inner = src.slice(lt + 1, selfClosing ? gt - 1 : gt);
    const space = inner.search(/\s/);
    const name = space < 0 ? inner : inner.slice(0, space);
    const attrs = {};
    if (space >= 0) {
      for (const m of inner.slice(space).matchAll(ATTR)) attrs[m[1]] = decode(m[3] ?? m[4] ?? '');
    }
    const el = { name, attrs, kids: [] };
    stack.at(-1).kids.push(el);
    if (!selfClosing) stack.push(el);
    at = gt + 1;
  }
  return root.kids.find((k) => typeof k !== 'string') ?? null;
}

/** The `>` that ends a tag, skipping any inside a quoted attribute. */
function tagEnd(src, from) {
  let quote = null;
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

function pushText(stack, raw) {
  if (stack.length === 1) return;
  stack.at(-1).kids.push(decode(raw));
}

// ------------------------------------------------------------- walking a tree

const elements = (el) => (el?.kids ?? []).filter((k) => typeof k !== 'string');

/** The first child called `name`; `name` may be a list of alternatives. */
export function child(el, name) {
  if (!el) return null;
  const names = Array.isArray(name) ? name : [name];
  return elements(el).find((k) => names.includes(k.name)) ?? null;
}

/** Every child called `name`, or every child at all. */
export const children = (el, name = null) =>
  name === null ? elements(el) : elements(el).filter((k) => k.name === name);

/** Down a path of child names: `path(sp, 'p:spPr', 'a:xfrm', 'a:off')`. */
export function path(el, ...names) {
  let at = el;
  for (const name of names) {
    at = child(at, name);
    if (!at) return null;
  }
  return at;
}

/** The first descendant called `name`, depth first. */
export function find(el, name) {
  for (const k of elements(el)) {
    if (k.name === name) return k;
    const deeper = find(k, name);
    if (deeper) return deeper;
  }
  return null;
}

/** Every descendant called `name`. */
export function findAll(el, name, out = []) {
  for (const k of elements(el)) {
    if (k.name === name) out.push(k);
    findAll(k, name, out);
  }
  return out;
}

/** All the text inside an element, in order. */
export const textOf = (el) =>
  (el?.kids ?? []).map((k) => (typeof k === 'string' ? k : textOf(k))).join('');
