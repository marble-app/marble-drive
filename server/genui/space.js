// The app-space contract, read back off a document. One fact, one place: the
// current position of every decision is the attribute CSS reads; which
// variations this app implements is one declaration line the validator holds
// honest against the stylesheet. A generated document is plain web UI: its
// options are CSS keyed on the fact, never Marble components.

import { parseSource } from '../engine.js';
import { camel, slug } from './atlas.js';

const GENUI = 'data-genui';
const ID = 'data-marble-id';
const META = new Set(['data-genui-about', 'data-genui-request', 'data-genui-pin', 'data-genui-excludes']);

const isElement = (node) => typeof node?.tagName === 'string';
// A caller that already parsed the document (decideDocument validates and
// extracts in one breath) hands the tree in; a string is parsed here.
const treeOf = (source) => (typeof source === 'string' ? parseSource(source) : source ?? parseSource(''));
const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value ?? null;

function* walk(node, ancestors = []) {
  if (isElement(node)) yield { node, ancestors };
  const next = isElement(node) ? [...ancestors, node] : ancestors;
  for (const child of node.childNodes ?? []) yield* walk(child, next);
}

const textOf = (node) => (node.childNodes ?? []).map((c) => (c.nodeName === '#text' ? c.value : textOf(c))).join('');

export function parseDeclaration(value) {
  return String(value ?? '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const cut = part.indexOf(':');
      if (cut < 0) return { slug: slug(part), gloss: null };
      const gloss = part.slice(cut + 1).trim();
      return { slug: slug(part.slice(0, cut)), gloss: gloss || null };
    });
}

function roots(tree) {
  const out = [];
  for (const { node, ancestors } of walk(tree)) {
    const value = attr(node, GENUI);
    if (value === null) continue;
    const parentRoot = [...ancestors].reverse().find((a) => attr(a, GENUI) !== null) ?? null;
    out.push({ node, value, parentRoot });
  }
  return out;
}

function decisionsOf(node) {
  const out = [];
  for (const a of node.attrs ?? []) {
    if (!a.name.startsWith('data-genui-') || META.has(a.name)) continue;
    const kebabKey = a.name.slice('data-genui-'.length);
    const factAttr = `data-${kebabKey}`;
    out.push({ key: camel(kebabKey), attr: factAttr, current: attr(node, factAttr), options: parseDeclaration(a.value) });
  }
  return out;
}

// "open-in:new-page + overview-type:table | presentation:modal + density:grouped-questions"
export function parseExcludes(value) {
  return String(value ?? '')
    .split('|')
    .map((pair) => pair.split('+').map((side) => side.trim()).filter(Boolean))
    .filter((sides) => sides.length === 2)
    .map((sides) => sides.map((side) => {
      const cut = side.indexOf(':');
      const kebabKey = cut < 0 ? side : side.slice(0, cut);
      return { key: camel(kebabKey.trim()), slug: cut < 0 ? '' : slug(side.slice(cut + 1)) };
    }));
}

export const parsePins = (value) => String(value ?? '').split(/[\s,]+/).map((k) => k.trim()).filter(Boolean).map((k) => camel(k));

export function extractSpace(source) {
  const tree = treeOf(source);
  let request = null;
  for (const { node } of walk(tree)) {
    if (node.tagName === 'body') {
      request = attr(node, 'data-genui-request');
      break;
    }
  }
  const instances = roots(tree).map(({ node, value, parentRoot }) => {
    const [pattern, name = ''] = value.split('#');
    return {
      name: name.trim(),
      marbleId: attr(node, ID),
      pattern: pattern.trim(),
      about: attr(node, 'data-genui-about'),
      parent: parentRoot ? (attr(parentRoot, GENUI).split('#')[1] ?? '').trim() || null : null,
      decisions: decisionsOf(node),
      pins: parsePins(attr(node, 'data-genui-pin')),
      excludes: parseExcludes(attr(node, 'data-genui-excludes')),
    };
  });
  return { request: request?.trim() || null, instances };
}

function cssImplemented(tree) {
  // Every `[data-<key>="<value>"]` any stylesheet selects, keyed "attr=value"
  // with the value exactly as written: an attribute selector matches bytes,
  // so a rule spelled "Pop Up" never matches the slug "pop-up" Jev writes.
  const found = new Set();
  const re = /\[\s*(data-[a-z0-9-]+)\s*=\s*["']([^"']*)["']\s*\]/g;
  for (const { node } of walk(tree)) {
    if (node.tagName !== 'style') continue;
    for (const m of textOf(node).matchAll(re)) found.add(`${m[1]}=${m[2]}`);
  }
  return found;
}


export function validateSpace(source, atlas) {
  const tree = treeOf(source);
  const issues = [];
  const push = (instance, key, kind, message) => issues.push({ instance, key, kind, message });
  const found = roots(tree);
  if (!found.length) push(null, null, 'no-instances', 'no element carries data-genui');
  const css = cssImplemented(tree);
  const names = new Map();

  for (const { node, value } of found) {
    const [patternRaw, nameRaw] = value.split('#');
    const pattern = (patternRaw ?? '').trim();
    const name = (nameRaw ?? '').trim();
    const marbleId = attr(node, ID);
    if (!pattern || !name) {
      push(name || null, null, 'bad-root', `data-genui must be "<atlas-id>#<instance-name>", got "${value}"`);
      continue;
    }
    if (!marbleId) push(name, null, 'missing-marble-id', `instance "${name}" has no data-marble-id`);
    if (names.has(name)) push(name, null, 'duplicate-instance', `instance name "${name}" is used twice`);
    names.set(name, true);
    if (!atlas.has(pattern)) {
      push(name, null, 'unknown-pattern', `"${pattern}" is not an Atlas entry`);
      continue;
    }
    for (const decision of decisionsOf(node)) {
      const { key, attr: factAttr, current, options } = decision;
      const sub = atlas.sub(pattern, key);
      if (!sub) {
        push(name, key, 'unknown-key', `"${key}" is not a sub-dimension of ${pattern}`);
        continue;
      }
      if (options.length < 2) push(name, key, 'too-few-options', `${factAttr} declares ${options.length} option(s); two or more make a decision`);
      for (const option of options) {
        if (option.gloss === null && !sub.vars.has(option.slug)) {
          push(name, key, 'missing-gloss', `"${option.slug}" is not an Atlas variation of ${key}; a preset needs "slug: gloss"`);
        }
        if (!css.has(`${factAttr}=${option.slug}`)) {
          push(name, key, 'unimplemented-option', `no [${factAttr}="${option.slug}"] rule implements it`);
        }
      }
      if (current === null || !options.some((o) => o.slug === slug(current))) {
        push(name, key, 'current-not-declared', `${factAttr}="${current}" is not one of: ${options.map((o) => o.slug).join(', ')}`);
      }
    }
    const decisions = decisionsOf(node);
    const byKey = new Map(decisions.map((d) => [d.key, d]));
    for (const key of parsePins(attr(node, 'data-genui-pin'))) {
      if (!byKey.has(key)) push(name, key, 'unknown-pin', `data-genui-pin names "${key}", which is not a declared decision here`);
    }
    for (const pair of parseExcludes(attr(node, 'data-genui-excludes'))) {
      const bad = pair.find((side) => !byKey.has(side.key) || !byKey.get(side.key).options.some((o) => o.slug === side.slug));
      if (bad) {
        push(name, bad.key, 'unknown-exclude', `data-genui-excludes names ${bad.key}:${bad.slug}, which is not a declared option here`);
        continue;
      }
      if (pair.every((side) => slug(byKey.get(side.key).current ?? '') === side.slug)) {
        push(name, pair[0].key, 'excluded-default', `the authored defaults already hold ${pair.map((p) => `${p.key}:${p.slug}`).join(' + ')}, which data-genui-excludes forbids`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
