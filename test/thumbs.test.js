import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createThumbs, thumbSize } from '../server/thumbs.js';

const DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-thumbs-'));
const SRC = path.join(DIR, 'paper.pdf');
await fsp.writeFile(SRC, '%PDF');
const file = (over = {}) => ({ path: 'a/paper.pdf', ext: 'pdf', modified: 1, bytes: 4, at: SRC, ...over });

// Stands in for QuickLook: writes `<name>.png` into the folder it is given.
function fake({ fail = false } = {}) {
  const calls = [];
  const make = async (at, size, out) => {
    calls.push(size);
    await new Promise((r) => setTimeout(r, 20));
    if (fail) return false;
    await fsp.writeFile(path.join(out, path.basename(at) + '.png'), `png ${size}`);
    return true;
  };
  return { make, calls };
}

test('sizes are bucketed so a resize does not make every picture again', () => {
  assert.equal(thumbSize(10), 320);
  assert.equal(thumbSize(321), 640);
  assert.equal(thumbSize(5000), 1280);
  assert.equal(thumbSize('junk'), 320);
});

test('a picture is made once, kept, and asked for twice at once is made once', async () => {
  const { make, calls } = fake();
  const thumbs = createThumbs({ dir: path.join(DIR, 'one'), make });
  const [a, b] = await Promise.all([thumbs.get(file(), 300), thumbs.get(file(), 300)]);
  assert.equal(a, b);
  assert.equal(await fsp.readFile(a, 'utf8'), 'png 320');
  assert.equal(await thumbs.get(file(), 300), a);
  assert.deepEqual(calls, [320]);
  // A new version of the file is a new picture.
  const edited = await thumbs.get(file({ modified: 2 }), 300);
  assert.notEqual(edited, a);
  assert.equal(calls.length, 2);
});

test('no picture is null, and so is a kind nobody can draw', async () => {
  const thumbs = createThumbs({ dir: path.join(DIR, 'two'), make: fake({ fail: true }).make });
  assert.equal(await thumbs.get(file(), 300), null);
  const any = createThumbs({ dir: path.join(DIR, 'three'), make: fake().make });
  assert.equal(await any.get(file({ ext: 'mp3', path: 'a/song.mp3' }), 300), null);
  // Its scratch folders are cleaned up either way.
  const left = await fsp.readdir(path.join(DIR, 'two'));
  assert.deepEqual(left.filter((n) => n.startsWith('.work-')), []);
});

test('only so many are made at once', async () => {
  let now = 0;
  let peak = 0;
  const make = async (at, size, out) => {
    now += 1;
    peak = Math.max(peak, now);
    await new Promise((r) => setTimeout(r, 15));
    now -= 1;
    await fsp.writeFile(path.join(out, path.basename(at) + '.png'), 'x');
    return true;
  };
  const thumbs = createThumbs({ dir: path.join(DIR, 'four'), make, most: 2 });
  await Promise.all([1, 2, 3, 4, 5].map((m) => thumbs.get(file({ modified: m }), 300)));
  assert.equal(peak, 2);
});

test('on a Mac, QuickLook really draws a picture', { skip: process.platform !== 'darwin' }, async () => {
  const thumbs = createThumbs({ dir: path.join(DIR, 'ql') });
  const png = path.join(DIR, 'dot.png');
  // A 1x1 PNG, which QuickLook will picture without complaint.
  await fsp.writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
  const out = await thumbs.get({ path: 'dot.png', ext: 'png', modified: 1, bytes: 70, at: png }, 320);
  assert.ok(out, 'QuickLook made nothing');
  const head = (await fsp.readFile(out)).subarray(1, 4).toString();
  assert.equal(head, 'PNG');
});
