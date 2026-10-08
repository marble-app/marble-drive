// Pieces: parts of interfaces worth having again.
//
// A piece is kept as its source (document and id), its markup and the styles
// and scripts it needs as they were when it was taken, and one line on what it
// does — so it still works if its source changes or goes away. Three places
// they come from: the ones a person saved (the build store), parts of the
// drive's other apps (read here, from the documents), and the small model's
// picks for the app open now (`suggestPieces`).

import { parseSource, indexIds } from '../engine.js';
import { pickEnv } from '../agent/env.js';
import { runCommand } from '../agent/providers/exec.js';
import { scratch } from '../agent/namer.js';
import { shaOf } from './store.js';

const ID = 'data-marble-id';
const TRANSIENT = 'data-marble-transient';
const PIECE_MIN = 160;
const PIECE_MAX = 90_000;
const PER_DOC = 6;
const DOCS_MAX = 40;
const CSS_MAX = 60_000;
const SCRIPT_MAX = 80_000;
// The drive's own pages are the frame apps sit in, not apps to take from.
const SYSTEM = new Set(['Drive', 'drive', 'Agents', 'Chat', 'Board', 'Console', 'Design System', "Design Don'ts"]);
const REGION_TAGS = new Set(['section', 'aside', 'article', 'table', 'form', 'figure', 'nav', 'details', 'fieldset']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'legend', 'caption', 'summary', 'figcaption']);

const attr = (node, name) => node?.attrs?.find((a) => a.name === name)?.value ?? null;
const elementsOf = (node) => (node?.childNodes ?? []).filter((child) => child.tagName);

/** The words in a node, as a reader would say them. */
export function textOf(node, max = 400) {
  let out = '';
  const walk = (n) => {
    if (out.length >= max) return;
    if (n.nodeName === '#text') out += n.value;
    if (n.tagName === 'script' || n.tagName === 'style' || n.tagName === 'template') return;
    for (const child of n.childNodes ?? []) walk(child);
  };
  walk(node);
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

const outerOf = (source, node) => {
  const loc = node?.sourceCodeLocation;
  return loc ? source.slice(loc.startOffset, loc.endOffset) : '';
};

/** A region's name: its own label, or the heading it opens with. */
function nameOf(node) {
  const label = attr(node, 'aria-label') || attr(node, 'title');
  if (label) return label.trim().slice(0, 80);
  const first = elementsOf(node).slice(0, 3);
  for (const child of first) {
    if (HEADINGS.has(child.tagName)) return textOf(child, 80);
    // A header row that holds the heading.
    if (child.tagName === 'header' || child.tagName === 'div') {
      const inner = elementsOf(child).find((c) => HEADINGS.has(c.tagName) || c.tagName === 'b' || c.tagName === 'strong');
      if (inner) return textOf(inner, 80);
    }
    if (child.tagName === 'p' && /^(b|strong)$/.test(elementsOf(child)[0]?.tagName ?? '')) return textOf(elementsOf(child)[0], 80);
  }
  return null;
}

/** What kind of piece a region is, in the gallery's words. */
export function kindOf(html) {
  if (/data-marble-run=/.test(html)) return 'Automation';
  if (/data-marble-(sortable|toggle|choose|removable|add)\b|draggable="true"/.test(html)) return 'Interaction';
  if (html.length < 6_000 || /<(svg|canvas)\b/.test(html)) return 'Widget';
  return 'Layout';
}

/** The styles and scripts a document carries, which its parts need to look
 *  and behave as they do. Transient ones are the host's, not the app's. */
function carriedBy(root, source) {
  const css = [];
  const js = [];
  const walk = (node) => {
    if (node.tagName === 'style' && attr(node, TRANSIENT) === null) {
      css.push(outerOf(source, node).replace(/^<style[^>]*>|<\/style>$/gi, ''));
    }
    if (node.tagName === 'script' && attr(node, TRANSIENT) === null && !attr(node, 'src')) {
      const type = attr(node, 'type');
      if (!type || /javascript|module/.test(type)) js.push(outerOf(source, node).replace(/^<script[^>]*>|<\/script>$/gi, ''));
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(root);
  return { css: css.join('\n').slice(0, CSS_MAX), script: js.join('\n;\n').slice(0, SCRIPT_MAX) };
}

/** One element of a document, taken as a piece. */
export function pieceFrom(source, id, { path: docPath = '' } = {}) {
  const root = parseSource(source);
  const node = indexIds(root).get(id);
  if (!node?.sourceCodeLocation) return null;
  const html = outerOf(source, node);
  const { css, script } = carriedBy(root, source);
  return {
    title: nameOf(node) || textOf(node, 48) || 'A piece',
    kind: kindOf(html),
    line: '',
    source: { path: docPath, id },
    html,
    css,
    script,
  };
}

/** The named regions of one document, outermost first, a few at most. */
export function regionsOf(source, docPath) {
  const root = parseSource(source);
  const out = [];
  const walk = (node, inside) => {
    if (out.length >= PER_DOC) return;
    const id = attr(node, ID);
    let taken = false;
    if (id && node.tagName && node.tagName !== 'body' && node.tagName !== 'main' && attr(node, TRANSIENT) === null && !inside) {
      const named = nameOf(node);
      const region = REGION_TAGS.has(node.tagName) || (node.tagName === 'div' && named);
      if (region && named) {
        const html = outerOf(source, node);
        if (html.length >= PIECE_MIN && html.length <= PIECE_MAX) {
          out.push({ id: `${docPath}#${id}`, title: named, kind: kindOf(html), doc: docPath, source: { path: docPath, id } });
          taken = true;
        }
      }
    }
    for (const child of node.childNodes ?? []) walk(child, inside || taken);
  };
  walk(root, false);
  return out;
}

/** A page a sandboxed frame can draw a piece in: its markup and styles, no
 *  scripts (the frame would not run them), at its own size. */
export function previewOf(piece) {
  const html = String(piece?.html ?? '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const css = String(piece?.css ?? '').replace(/<\/style/gi, '');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>`
    + '<style>html,body{margin:0;padding:10px;background:transparent;overflow:hidden;pointer-events:none}body>*{margin:0!important;max-width:100%}</style>'
    + `</head><body>${html}</body></html>`;
}

/**
 * The drive's documents read for regions, the most recent first, with a cache
 * by content so the same page is not parsed twice.
 */
export function createDriveIndex({ store }) {
  const cache = new Map();
  return async function driveRegions({ exclude = null } = {}) {
    const entries = (await store.list({ folder: '', recursive: true }))
      .filter((e) => e.kind === 'doc' && e.path !== exclude && !SYSTEM.has(e.path) && !e.path.startsWith('.'))
      .sort((a, b) => (Number(b.mtime ?? b.modified ?? 0) - Number(a.mtime ?? a.modified ?? 0)))
      .slice(0, DOCS_MAX);
    const out = [];
    for (const entry of entries) {
      const source = await store.read(entry.path).catch(() => null);
      if (!source) continue;
      const sha = shaOf(source);
      let regions = cache.get(entry.path);
      if (!regions || regions.sha !== sha) {
        try {
          regions = { sha, list: regionsOf(source, entry.path) };
        } catch {
          regions = { sha, list: [] };
        }
        cache.set(entry.path, regions);
      }
      out.push(...regions.list);
    }
    return out;
  };
}

// ------------------------------------------------------------- suggestions

const OUTLINE_MAX = 3_000;

export function suggestPrompt({ title, outline, marks, candidates }) {
  return [
    'Someone is building an app in Marble Drive by marking it up. Pick up to three parts of their other apps that would be worth bringing into this one.',
    '',
    `The app: ${title || '(untitled)'}`,
    'What is on it now:',
    '"""',
    String(outline || '(empty)').slice(0, OUTLINE_MAX),
    '"""',
    ...(marks ? ['What they have asked for on it:', '"""', marks.slice(0, 1_500), '"""'] : []),
    '',
    'Parts they could bring in (id · kind · name · from):',
    ...candidates.slice(0, 80).map((c) => `${c.id} · ${c.kind} · ${c.title} · ${c.doc ?? c.source?.path ?? ''}`),
    '',
    'Reply with ONLY a JSON object, no prose and no code fence:',
    '{"picks": [{"id": "…", "why": "…"}]}',
    '- id: exactly one of the ids above. Pick none rather than a poor fit.',
    '- why: under 50 characters, what it would do for this app, in plain words (e.g. "Your deadlines, on a line").',
  ].join('\n');
}

export function readPicks(raw, candidates) {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return (Array.isArray(value?.picks) ? value.picks : [])
    .map((pick) => {
      const found = byId.get(String(pick?.id ?? ''));
      const why = String(pick?.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
      return found ? { ...found, line: why } : null;
    })
    .filter(Boolean)
    .slice(0, 3);
}

/** Ask the installed CLI for picks. Returns [] — never throws — without one. */
export async function suggestPieces({ title, outline, marks, candidates, model = 'haiku', exec = runCommand, env = process.env, timeout = 25_000, log = console }) {
  if (!candidates?.length) return [];
  const ask = suggestPrompt({ title, outline, marks, candidates });
  const cwd = await scratch();
  const result = await exec('claude', ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--output-format', 'text', '--', ask], {
    timeout, env: pickEnv(env), cwd,
  });
  if (result.aborted || result.missing) return [];
  if (result.timedOut || result.code) {
    log.error?.(`[builds] suggestions failed: ${result.timedOut ? 'timed out' : result.stderr?.trim() || `exit ${result.code}`}`);
    return [];
  }
  return readPicks(result.stdout, candidates);
}

/** An outline of a page for a model: its headings and the words of its
 *  addressed parts, short. */
export function outlineOf(source, max = OUTLINE_MAX) {
  const root = parseSource(source);
  const lines = [];
  const walk = (node, depth) => {
    if (lines.join('\n').length > max) return;
    if (node.tagName === 'script' || node.tagName === 'style' || attr(node, TRANSIENT) !== null) return;
    const id = attr(node, ID);
    if (id && node.tagName && (HEADINGS.has(node.tagName) || REGION_TAGS.has(node.tagName) || node.tagName === 'li' || node.tagName === 'button')) {
      const words = textOf(node, 90);
      if (words) lines.push(`${'  '.repeat(Math.min(depth, 6))}${node.tagName}#${id}: ${words}`);
    }
    for (const child of node.childNodes ?? []) walk(child, depth + (id ? 1 : 0));
  };
  walk(root, 0);
  return lines.join('\n').slice(0, max);
}
