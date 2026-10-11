// A document whose stylesheet does not close is a document that still passes
// every other check: the HTML parses, the ids are intact, the doctor is happy.
// Chromium then nests everything after the unclosed rule inside it, and the
// page quietly loses the whole tail of its own design — which is what happened
// to the Drive document on 2026-09-21, when a one-write patch left a second
// `.menu {` above the real one and took the days almanac, the menus and the
// selection bar out with it.
//
// So: every stylesheet this repo ships, and the owner's live Drive document
// when the checkout has one, has to close every rule it opens.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { STARTERS, build } from '../server/gallery.js';
import { buildDrive } from '../server/seed.js';

/** Every <style> in a document, as text, with its line offset kept so a
 *  complaint can point at the file rather than at the fragment. */
const sheets = (source) => {
  const found = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    found.push({ css: m[1], line: source.slice(0, m.index).split('\n').length });
  }
  return found;
};

/** Where the braces stop balancing. Comments are blanked rather than removed so
 *  the line numbers still mean something. */
const unbalanced = ({ css, line }) => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  let depth = 0;
  let at = line;
  let opened = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\n') at += 1;
    else if (ch === '{') {
      depth += 1;
      // The selector this brace belongs to, for the message.
      const head = text.slice(0, i).split(/[{};]/).pop().trim().replace(/\s+/g, ' ');
      opened.push({ at, head });
    } else if (ch === '}') {
      depth -= 1;
      opened.pop();
      if (depth < 0) return `line ${at}: a } with no rule to close`;
    }
  }
  if (depth > 0) {
    const last = opened[0];
    return `line ${last.at}: "${last.head}" is never closed (${depth} open at the end of the sheet)`;
  }
  return null;
};

const closes = (name, source) => {
  const found = sheets(source);
  assert.ok(found.length > 0, `${name} has no stylesheet`);
  for (const sheet of found) {
    const complaint = unbalanced(sheet);
    assert.equal(complaint, null, `${name}: ${complaint}`);
  }
};

for (const starter of STARTERS) {
  test(`the ${starter.id} starter closes every rule it opens`, async () => {
    closes(`${starter.id}.mrbl`, await build(starter.id, { name: starter.id }));
  });
}

test('the Drive template closes every rule it opens', async () => {
  closes('drive.mrbl', await buildDrive());
});

// The live document is the one that actually breaks: it is patched in place,
// by hand and by script, and `drive/` is not tracked by this repo.
const LIVE = new URL('../drive/drive.mrbl', import.meta.url);
const live = await fsp.readFile(LIVE, 'utf8').catch(() => null);
test(
  'the live Drive document closes every rule it opens',
  { skip: live ? false : 'no drive/drive.mrbl in this checkout' },
  () => closes(path.basename(LIVE.pathname), live ?? ''),
);
