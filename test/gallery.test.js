import assert from 'node:assert/strict';
import test from 'node:test';

import { STARTERS, build, composeScript, list } from '../server/gallery.js';
import { createBlobs } from '../server/store/blobs.js';
import { extract, flatten } from '../server/flatten.js';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';


test('seven starters, each with a blurb somebody could choose from', () => {
  assert.deepEqual(list().map((s) => s.id), ['doc', 'sheet', 'slides', 'board', 'canvas', 'paper', 'latex']);
  for (const starter of list()) {
    assert.ok(starter.title && starter.blurb && starter.accent);
  }
});

test('the affordances are composed out of the Marble package, not copied', async () => {
  const script = await composeScript(['editable']);
  assert.match(script, /window\.marble/);
  assert.match(script, /marble:ready/);
  // `shared` opens the closure and `tail` closes it; neither is optional.
  assert.match(script, /^\(\(\) => \{/);
  assert.match(script.trimEnd(), /\}\)\(\);$/);
});

test('the drive overrides Marble\'s sortable with one a finger can use', async () => {
  const script = await composeScript(['sortable']);
  assert.match(script, /pointerdown/);
  assert.match(script, /touch-action: none/);
  // And no trace of the drag-and-drop path it replaces.
  assert.ok(!script.includes('dragstart'));
});

test('an unknown part is a build error, not a silently empty document', async () => {
  await assert.rejects(() => composeScript(['telekinesis']), /no affordance/);
});

for (const starter of STARTERS) {
  test(`the ${starter.id} starter builds into a document that holds up`, async () => {
    const source = await build(starter.id, { name: 'my thing' });

    assert.match(source, /^<!doctype html>/);
    assert.match(source, /<html lang="en" data-marble="1">/);
    assert.match(source, /<title>My thing<\/title>/);
    assert.ok(!source.includes('__ID__'), 'every placeholder id was minted');
    assert.ok(!source.includes('__SCRIPT__'), 'the affordances were spliced in');
    assert.ok(!source.includes('__TITLE__'));

    // Ids are a fact about the markup, so the question is asked of the markup:
    // a document whose script composes an element writes the attribute in its
    // own source too, and that is a template rather than a second element.
    const markup = source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
    // No id may appear twice — the doctor's first check, and the one that makes
    // every op after this one addressable.
    const ids = [...markup.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    assert.ok(ids.length > 5, 'the document is actually addressable');

    // A starter that names a route would be a document that only opens here.
    assert.ok(!/\/(ops|intent|docs|events|drive)\?/.test(source), 'names no route');

    // Every script in it parses, including the affordance copy.
    for (const [, body] of source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      new Function(body);
    }
  });
}

test('a starter built from a folder of parts includes every one of them', async () => {
  const [paper, latex] = await Promise.all([build('paper', { name: 'p' }), build('latex', { name: 'l' })]);

  // The paper starter is the LaTeX one with a different project in it, so
  // everything but the project has to be there — and byte for byte the same,
  // because it is the same file included rather than a copy of it.
  for (const marker of ['id="logpill"', 'id="pdfframe"', 'id="grabber"', 'id="menu"', 'T.metrics = {', 'ACM_FORMATS']) {
    assert.ok(paper.includes(marker), `the paper starter is missing ${marker}`);
    assert.ok(latex.includes(marker), `the latex starter is missing ${marker}`);
  }
  assert.ok(!paper.includes('<!-- include:'), 'every include was expanded');
  assert.ok(!paper.includes('<!-- file:'), 'every carried file was read in');

  // And the project really is different.
  assert.ok(paper.includes('sigconf'), 'the paper is set in the conference format');
  assert.ok(paper.includes('Source/Files/1-Introduction.tex'), 'the paper has folders');
  assert.ok(!latex.includes('Source/Files/1-Introduction.tex'), 'the latex starter does not');

  // The class and the bibliography style travel with the paper, as files in it
  // rather than as a dependency on anything here.
  assert.match(paper, /data-kind="cls"[\s\S]*?ProvidesClass\{acmart\}/, 'acmart.cls is a file in the project');
  assert.match(paper, /data-kind="bst"/, 'the bibliography style is too');
  assert.ok(paper.length > 400_000, `the paper carries them: ${paper.length} bytes`);
  assert.ok(!latex.includes('ProvidesClass'), 'the latex starter carries neither');
});

test('a heavy document goes out to blobs and comes back byte-identical', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-blobs-'));
  const blobs = createBlobs({ dir });
  await blobs.ready();

  const payload = Buffer.from(Array.from({ length: 120_000 }, (_, i) => i % 251));
  const source =
    `<!doctype html><html data-marble="1"><head><title>Photo</title></head><body>` +
    `<img data-marble-id="p" src="data:image/png;base64,${payload.toString('base64')}">` +
    `</body></html>`;

  const out = await extract(source, blobs, { min: 1024 });
  assert.equal(out.extracted.length, 1);
  assert.ok(out.source.length < source.length / 100, 'the document got much smaller');
  assert.match(out.source, /data-marble-blob="[0-9a-f]{64}"/);
  // The element kept its identity, which is the whole reason this is safe.
  assert.match(out.source, /data-marble-id="p"/);

  const back = await flatten(out.source, blobs);
  assert.equal(back.inlined, 1);
  assert.equal(back.source, source, 'the round trip is byte-exact');

  // A blob that is gone is named rather than silently dropped.
  const orphan = await flatten(out.source, { get: async () => null });
  assert.equal(orphan.inlined, 0);
  assert.equal(orphan.missing.length, 1);

  await fsp.rm(dir, { recursive: true, force: true });
});

test('small data urls are left alone — a hash for an icon is a worse document', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-blobs2-'));
  const blobs = createBlobs({ dir });
  await blobs.ready();
  const source = `<img data-marble-id="i" src="data:image/gif;base64,${Buffer.alloc(300).toString('base64')}">`;
  const out = await extract(source, blobs, { min: 64 * 1024 });
  assert.equal(out.extracted.length, 0);
  assert.equal(out.source, source);
  await fsp.rm(dir, { recursive: true, force: true });
});
