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

// ---------------------------------------------------------------- flat, now

test('the mark is flat: shapes and colours, nothing that shades', () => {
  for (const kind of ['doc', 'drive']) {
    const source = svg(kind);
    assert.doesNotMatch(source, /Gradient|clipPath|filter|url\(/, `${kind} mark draws with a gradient or a clip`);
    // Every colour is one hex, so the family reads the same at any size.
    for (const fill of source.match(/fill='[^']*'/g)) assert.match(fill, /fill='(#[0-9a-f]{3,6}|none)'/);
  }
});

test('a page that still carries the glass marble is served the flat one, and only that changes', async () => {
  const { HOST_MARKS, refreshed } = await import('../server/favicon.js');
  // The glass marble as every document made before this carries it.
  const glass = [...HOST_MARKS].find((uri) => uri.includes('radialGradient') && !uri.includes('%3Crect'));
  const glassDrive = [...HOST_MARKS].find((uri) => uri.includes('radialGradient') && uri.includes('%3Crect'));
  assert.ok(glass && glassDrive, 'the glass marks are still known');
  const page = (href) => `<!doctype html>\n<html><head><title>Old</title>\n<link rel="icon" href="${href}">\n</head><body><p>${href}</p></body></html>`;

  const served = refreshed(page(glass));
  assert.ok(served.includes(link('doc')), 'the flat marble in the head');
  assert.ok(served.endsWith(`<p>${glass}</p></body></html>`), 'the body is not the head');
  assert.ok(refreshed(page(glassDrive)).includes(link('drive')), 'the Drive keeps its tile');

  // A mark somebody chose, and a document already flat, go out as they are.
  const mine = page("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E");
  assert.equal(refreshed(mine), mine);
  assert.equal(refreshed(page(dataUri('doc'))), page(dataUri('doc')));
});

// -------------------------------------------------------- a drive's own space

const space = await import('../server/favicon-space.js');
const { linkFor, markFor, spaceIn } = await import('../server/favicon.js');

test('the space is drawn by a file that imports nothing, so a page can carry it', async () => {
  const text = await fsp.readFile(new URL('../server/favicon-space.js', import.meta.url), 'utf8');
  // The code, without the comments, which are free to talk about documents.
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /^\s*import\b|\brequire\(|\bimport\(/m);
  assert.doesNotMatch(source, /\b(document|window|process|globalThis)\b/, 'touches nothing but its arguments');
});

test('one path, one mark; and every mark stays inside its space', () => {
  const wide = {
    hue: { lo: 300, hi: 60 }, chroma: { lo: 0.04, hi: 0.09 }, light: { lo: 0.5, hi: 0.7 },
    angle: { lo: -60, hi: 10, steps: 4 }, bend: { lo: -0.5, hi: 0.8 }, form: ['wave', 'split'], glint: ['dot', 'arc'],
  };
  const tidy = space.tidy(wide);
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const seed = `Research/app ${i}`;
    const genes = space.genome(wide, seed);
    assert.deepEqual(space.genome(wide, seed), genes, 'the same path draws the same mark');
    const around = (genes.hue - 300 + 360) % 360;
    assert.ok(around <= 120 + 1e-9, `hue ${genes.hue} left 300°–60°`);
    for (const key of ['chroma', 'light', 'bend']) {
      assert.ok(genes[key] >= tidy[key].lo - 1e-9 && genes[key] <= tidy[key].hi + 1e-9, `${key} ${genes[key]}`);
    }
    assert.ok([-60, -36.666666666666664, -13.333333333333336, 10].some((v) => Math.abs(v - genes.angle) < 1e-9), `angle ${genes.angle} is on a step`);
    assert.ok(['wave', 'split'].includes(genes.form));
    seen.add(space.mark(wide, seed));
  }
  assert.ok(seen.size > 190, `${seen.size} different marks for 200 apps`);
});

test('widening one range moves only its own gene', () => {
  const before = { hue: { lo: 200, hi: 220 } };
  const after = { hue: { lo: 120, hi: 300 } };
  for (let i = 0; i < 40; i += 1) {
    const a = space.genome(before, `doc ${i}`);
    const b = space.genome(after, `doc ${i}`);
    for (const key of Object.keys(a)) if (key !== 'hue') assert.equal(b[key], a[key], key);
  }
});

const studio = (spaces, use, { meta = true, order = 'normal' } = {}) => `<!doctype html>
<html><head><title>Favicon Studio</title>${meta ? '\n<meta name="marble-favicons" content="spaces">' : ''}</head>
<body data-marble-id="b">
<section class="spaces" ${order === 'normal' ? `data-marble-id="s" data-favicon-spaces data-use="${use}"` : `data-use="${use}" data-marble-id="s" data-favicon-spaces`}>
${Object.entries(spaces).map(([id, s]) => `<article data-marble-id="a-${id}"><h2 data-marble-id="n-${id}">${id}</h2><script ${order === 'normal' ? `type="application/json" data-marble-id="${id}"` : `data-marble-id="${id}" type="application/json"`}>${JSON.stringify(s)}</script></article>`).join('\n')}
</section></body></html>`;

test('a studio page says which space new apps are drawn from, wherever its attributes sit', () => {
  const blue = { hue: { lo: 240, hi: 240 }, form: ['split'] };
  const warm = { hue: { lo: 20, hi: 60 } };
  for (const order of ['normal', 'moved']) {
    assert.deepEqual(spaceIn(studio({ blue, warm }, 'warm', { order })), space.tidy(warm), order);
    assert.deepEqual(spaceIn(studio({ blue, warm }, 'blue', { order })), space.tidy(blue), order);
  }
  assert.equal(spaceIn(studio({ blue }, 'blue', { meta: false })), null, 'a page that does not say so is not a studio');
  assert.equal(spaceIn(studio({ blue }, 'gone')), null, 'a space that is not there');
  assert.equal(spaceIn(studio({ blue }, '')), null, 'none in use');
  assert.equal(spaceIn(studio({ blue }, 'blue').replace(JSON.stringify(blue), '{not json')), null);
});

test('a new document is drawn from the space its drive keeps, by its path', async () => {
  const { createStore } = await import('../server/store/index.js');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-marks-'));
  const store = createStore({ root });
  await store.ready();

  // No studio: its own point in the family every drive starts with.
  const first = await markFor(store, 'Notes/plan');
  assert.equal(first, linkFor(space.DEFAULTS, 'Notes/plan'));
  assert.notEqual(first, link('doc'));
  assert.notEqual(await markFor(store, 'Notes/other'), first, 'siblings, not twins');

  const warm = { hue: { lo: 20, hi: 60 }, form: ['split'] };
  await store.write('System/Favicon Studio', studio({ warm }, 'warm'));
  const made = await markFor(store, 'Notes/plan');
  assert.equal(made, linkFor(space.tidy(warm), 'Notes/plan'));
  assert.notEqual(made, link('doc'));
  assert.notEqual(await markFor(store, 'Notes/other'), made, 'another path, another mark');
  assert.ok(Buffer.byteLength(made) < 1024);

  // The one changed last is the one somebody is tuning.
  const cool = { hue: { lo: 180, hi: 200 } };
  await new Promise((resolve) => setTimeout(resolve, 20));
  await store.write('Copy of studio', studio({ cool }, 'cool'));
  assert.equal(await markFor(store, 'Notes/plan'), linkFor(space.tidy(cool), 'Notes/plan'));

  await fsp.rm(root, { recursive: true, force: true });
});
