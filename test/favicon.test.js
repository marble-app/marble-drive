// The mark, and the two claims it makes.
//
// That it is one drawing rather than six, and that a document carries it — so a
// .mrbl opened from a file:// URL, with no host anywhere, still has a tab icon.
// Everything here is a check on one of those two.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DRIVE, MARBLE, dataUri, link, stamp, stamped, svg } from '../server/favicon.js';
import { STARTERS, build } from '../server/gallery.js';
import { buildDrive } from '../server/seed.js';

test('the mark is one drawing in two settings, not two drawings', () => {
  // The sphere, the ribbon, the highlight — the same three shapes in both, and
  // the tile is the only thing the Drive's version adds.
  for (const source of [svg('doc'), svg('drive')]) {
    assert.match(source, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 32 32'>/);
    assert.match(source, /<\/svg>$/);
    assert.match(source, /<circle /, 'the marble');
    assert.match(source, /<path /, 'the ribbon');
  }
  assert.match(svg('drive'), /<rect /, 'and the Drive sits in a tile');
  assert.ok(!svg('doc').includes('<rect'), 'a document does not');
  assert.notEqual(MARBLE, DRIVE);
  // An unknown kind is the document mark rather than nothing: a missing icon is
  // worse than the wrong one, and there is only one wrong one.
  assert.equal(svg('nonsense'), svg('doc'));
});

test('the data URI survives being an HTML attribute', () => {
  for (const kind of ['doc', 'drive']) {
    const uri = dataUri(kind);
    assert.match(uri, /^data:image\/svg\+xml,/);
    // The three characters that would end the attribute, end the tag, or start
    // a fragment and throw the rest of the drawing away.
    for (const c of ['"', '<', '>', '#']) {
      assert.ok(!uri.includes(c), `an unencoded ${c} in the ${kind} mark`);
    }
    // And it is still the drawing rather than base64 of it, which is the whole
    // reason for encoding by hand.
    assert.ok(!uri.includes(';base64,'));
    assert.equal(decodeURIComponent(uri.slice('data:image/svg+xml,'.length)), svg(kind));
  }
});

test('the mark costs less than the request it replaces', () => {
  // A favicon fetch is a round trip; this is under a kilobyte, once, in a file
  // that was going to be sent anyway.
  for (const kind of ['doc', 'drive']) {
    assert.ok(Buffer.byteLength(link(kind)) < 1024, `${kind} mark is over a kilobyte`);
  }
});

for (const starter of STARTERS) {
  test(`a ${starter.id} carries the mark in its own head`, async () => {
    const source = await build(starter.id, { name: 'my thing' });
    assert.ok(!source.includes('__ICON__'), 'the placeholder was filled');
    assert.ok(source.includes(link('doc')), 'and filled with the document mark');
    // In the head, where a browser looks, and before the document's own markup.
    assert.ok(source.indexOf('<link rel="icon"') < source.indexOf('</head>'));
    // Inline: a document that had to ask a host for its icon would be a
    // document that only has one here.
    assert.ok(!/<link rel="icon" href="\//.test(source), 'names no route');
  });
}

test('the Drive wears the tiled mark, and no document does', async () => {
  const source = await buildDrive();
  assert.ok(!source.includes('__ICON__'));
  assert.ok(source.includes(link('drive')));
  const doc = await build('doc', { name: 'a doc' });
  assert.ok(!doc.includes(link('drive')));
});

test('a document already in a drive can be given the mark, once', async () => {
  const before = '<!doctype html>\n<html lang="en" data-marble="1">\n<head>\n<title>Old</title>\n</head>\n<body>hi</body>\n</html>';
  const after = stamp(before);

  assert.ok(stamped(after));
  assert.ok(!stamped(before));
  assert.ok(after.includes(`<title>Old</title>\n${link('doc')}`), 'straight after the title');
  assert.ok(after.includes('<body>hi</body>'), 'and nothing else moved');
  // Twice is once: running the command again is not two icons.
  assert.equal(stamp(after), after);
});

test('an icon somebody chose is not replaced by the one that came with the host', () => {
  const mine = '<!doctype html><head><title>Mine</title><link rel="icon" href="/mine.png"></head>';
  assert.equal(stamp(mine), mine);
  assert.equal(stamp(mine.replace('rel="icon"', "rel='shortcut icon'")), mine.replace('rel="icon"', "rel='shortcut icon'"));
});

test('a head-less document still gets a mark rather than a crash', () => {
  assert.ok(stamped(stamp('<html><body>no head at all</body></html>')));
  assert.ok(stamped(stamp('just some markup')));
});

test('the mark comes back out of a document that has been downloaded', async () => {
  // Flattening is what a download does. The icon is a data URI already, so it
  // has to come through untouched — including through the blob extractor,
  // which is the one thing in the repo that goes looking for data URIs.
  const { createBlobs } = await import('../server/store/blobs.js');
  const { extract, flatten } = await import('../server/flatten.js');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-icon-'));
  const blobs = createBlobs({ dir: path.join(dir, 'blobs') });
  const source = await build('doc', { name: 'takeaway' });

  const thinned = await extract(source, blobs, { min: 0 });
  assert.ok(thinned.source.includes(link('doc')), 'the icon is not a blob');

  const whole = await flatten(thinned.source, blobs);
  assert.ok(whole.source.includes(link('doc')), 'and it is still there after a round trip');
});
