// The template gallery.
//
// "New sheet" is a clone, and the clone is yours to reshape — which is the part
// Drive cannot offer. That sentence is the whole feature, and it is also why
// there is no upgrade path: a fix to the sheet starter never reaches the sheets
// already made from it. That cost is not an oversight, it is the thesis. Your
// spreadsheet is yours, including its bugs.
//
// A starter is markup in `starters/` plus a list of the affordance parts it
// needs. The parts come out of Marble's `lib/affordances.js` at build time,
// with `lib/affordances.drive.js` overriding by name — so a document leaves
// here carrying its own copy of every behaviour it has, and no starter is a
// dependency on this host.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { enginePath, readParts } from './engine.js';
import { link as iconLink } from './favicon.js';
import { titleize } from './paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// `shared` opens the closure and `tail` closes it, so neither is optional;
// `grip` draws the handle that `sortable` and `removable` hang gestures on.
const ALWAYS = ['shared', 'tail'];
const NEEDS = { sortable: ['grip'], removable: ['grip'] };

/**
 * The starters. Each is a different answer to "what is a document", which is
 * the point of shipping several rather than one good one — and the first five
 * are small enough to read in a sitting, because the first thing anyone does
 * with a starter is change it. The sixth is not, and says why where it stands.
 */
export const STARTERS = [
  {
    id: 'doc',
    title: 'Document',
    blurb: 'Notes on a page. Select words and the toolbar acts on them; the toolbar is in the file.',
    // No sortable, no removable, no adder: neither a word processor nor a
    // notebook has a drag handle beside every paragraph and a button at the
    // bottom that makes one. Enter and Backspace do that work, bound by the
    // document's own script.
    //
    // `editable` is here for the name in the chrome and the widget's labels —
    // plain text, edited with setText. The paragraphs are not: they carry
    // inline markup, so the document defines its own data-marble-rich and
    // edits them with setInner, which is the whole reason that attribute
    // exists rather than reusing this one.
    parts: ['editable', 'history', 'status'],
    accent: '#738698',
  },
  {
    id: 'sheet',
    title: 'Sheet',
    blurb: 'A grid of cells. Rows and columns are markup, so both are yours to change.',
    parts: ['editable', 'sortable', 'removable', 'add', 'status'],
    accent: '#738698',
  },
  {
    id: 'slides',
    title: 'Slides',
    blurb: 'One section per slide, reordered by dragging, presented as it stands.',
    parts: ['editable', 'sortable', 'removable', 'add', 'status'],
    accent: '#738698',
  },
  {
    id: 'board',
    title: 'Board',
    blurb: 'Columns of cards. A card’s column is where it sits and nothing else.',
    parts: ['editable', 'sortable', 'removable', 'add', 'status'],
    accent: '#738698',
  },
  {
    id: 'canvas',
    title: 'Canvas',
    blurb: 'Notes placed anywhere. The position is an inline style on the note.',
    parts: ['editable', 'canvas', 'removable', 'add', 'status'],
    accent: '#738698',
  },
  {
    id: 'latex',
    title: 'LaTeX',
    blurb: 'A LaTeX project that typesets itself. Sources, engine and PDF, with nothing behind them.',
    // The odd one out, and deliberately: the other five are small enough to
    // read in a sitting, and this one carries a typesetter. It is here because
    // it is the strongest answer this format has to "what is a document" — the
    // paper, the thing that made the paper, and the editor you made it in, all
    // addressable, all in one file you can mail to somebody.
    //
    // No sortable and no removable: a file list is derived from the sections
    // and gets its own delete, and the code panes are a `data-marble-code` this
    // document defines itself, because Marble's editable ends a line on Enter
    // and a source file needs Enter to mean a new line.
    parts: ['editable', 'history', 'status'],
    accent: '#738698',
  },
];

const byId = new Map(STARTERS.map((starter) => [starter.id, starter]));

// The same shape the carrier's newId() makes, so an id written at build time and
// an id written by a gesture are not two kinds of thing.
const newId = () => crypto.randomBytes(5).toString('hex').slice(0, 8);

let cache = null;

async function parts() {
  if (cache) return cache;
  const [base, overrides] = await Promise.all([
    fsp.readFile(enginePath('lib/affordances.js'), 'utf8'),
    fsp.readFile(path.join(REPO, 'lib', 'affordances.drive.js'), 'utf8'),
  ]);

  const merged = new Map();
  for (const part of readParts(base)) merged.set(part.name, part);
  // By name, and in the base file's order: the segments are pieces of one
  // closure, so an override that landed at the end would be a syntax error.
  for (const part of readParts(overrides)) {
    if (!merged.has(part.name)) {
      throw new Error(`lib/affordances.drive.js overrides "${part.name}", which Marble has no part for`);
    }
    merged.set(part.name, { ...part, overridden: true });
  }
  cache = merged;
  return merged;
}

export async function composeScript(wanted) {
  const available = await parts();

  const chosen = new Set(wanted);
  for (const name of ALWAYS) chosen.add(name);
  for (const [name, needs] of Object.entries(NEEDS)) {
    if (chosen.has(name)) for (const need of needs) chosen.add(need);
  }
  for (const name of chosen) {
    if (!available.has(name)) {
      throw new Error(`no affordance "${name}" — there is ${[...available.keys()].join(', ')}`);
    }
  }

  return [...available.values()]
    .filter((part) => chosen.has(part.name))
    .map((part) => part.text.replace(/^\n+|\n+$/g, ''))
    .join('\n\n');
}

export const list = () =>
  STARTERS.map(({ id, title, blurb, accent }) => ({ id, title, blurb, accent }));

/**
 * A starter, built into a document. `name` is the last segment of the path it
 * is about to be written to — it becomes the title, because a document called
 * "Untitled" is a document nobody names.
 */
export async function build(id, { name = id } = {}) {
  const starter = byId.get(id);
  if (!starter) throw Object.assign(new Error(`no starter "${id}"`), { status: 404 });

  const [template, script] = await Promise.all([
    fsp.readFile(path.join(REPO, 'starters', `${id}.mrbl`), 'utf8'),
    composeScript(starter.parts),
  ]);

  return template
    .replaceAll('__TITLE__', titleize(name))
    // The mark, inline. Spliced here rather than written into each starter
    // so there is one drawing rather than six copies of it — and inline rather
    // than a URL because a document that leaves this drive still has a tab.
    .replace('__ICON__', () => iconLink('doc'))
    // Each placeholder gets its own id. One pass rather than a global replace is
    // what keeps them distinct — no id may appear twice in a document.
    .replace(/__ID__/g, () => newId())
    .replace('__SCRIPT__', `<script>\n${script}\n</script>`);
}
