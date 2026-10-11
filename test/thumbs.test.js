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

// ------------------------------------------------------ pictures the page drew
//
// Off a Mac there is no QuickLook, so the page draws pictures itself and hands
// them to the host to keep. Only the header is read: a size is all the host
// needs to know, and it never decodes what a page sent it.

const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const riff = (chunk, body) => {
  const b = Buffer.alloc(20 + body.length);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(12 + body.length, 4);
  b.write('WEBP', 8, 'latin1');
  b.write(chunk, 12, 'latin1');
  b.writeUInt32LE(body.length, 16);
  body.copy(b, 20);
  return b;
};
const vp8 = (w, h) => {
  const body = Buffer.alloc(10);
  body.set([0x9d, 0x01, 0x2a], 3);
  body.writeUInt16LE(w, 6);
  body.writeUInt16LE(h, 8);
  return riff('VP8 ', body);
};
const vp8l = (w, h) => {
  const body = Buffer.alloc(5);
  body[0] = 0x2f;
  const bits = (w - 1) | ((h - 1) << 14);
  body.writeUInt32LE(bits >>> 0, 1);
  return riff('VP8L', body);
};
const vp8x = (w, h) => {
  const body = Buffer.alloc(10);
  body.writeUIntLE(w - 1, 4, 3);
  body.writeUIntLE(h - 1, 7, 3);
  return riff('VP8X', body);
};

test('a picture\'s size is read from its header, for PNG and all three kinds of WebP', async () => {
  const { imageSize } = await import('../server/thumbs.js');
  assert.deepEqual(imageSize(png(640, 480)), { type: 'png', width: 640, height: 480 });
  assert.deepEqual(imageSize(vp8(640, 360)), { type: 'webp', width: 640, height: 360 });
  assert.deepEqual(imageSize(vp8l(640, 905)), { type: 'webp', width: 640, height: 905 });
  assert.deepEqual(imageSize(vp8x(1280, 720)), { type: 'webp', width: 1280, height: 720 });
  assert.equal(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(imageSize(Buffer.alloc(3)), null);
});

test('a drawn picture is kept and served before QuickLook is asked', async () => {
  const { make, calls } = fake();
  const thumbs = createThumbs({ dir: path.join(DIR, 'drawn'), make });
  await thumbs.put(file(), vp8(640, 360));
  const got = await thumbs.get(file(), 300);
  assert.match(got, /\.webp$/);
  assert.deepEqual(await fsp.readFile(got), vp8(640, 360));
  assert.deepEqual(calls, [], 'QuickLook was not asked');
  // A new version of the file is not the old drawing.
  const edited = await thumbs.get(file({ modified: 9 }), 300);
  assert.doesNotMatch(edited ?? '', /\.webp$/);
});

test('a host with no QuickLook still serves what the page drew, for any kind', async () => {
  const thumbs = createThumbs({ dir: path.join(DIR, 'nomac'), platform: 'linux' });
  const song = file({ path: 'b/clip.webm', ext: 'webm' });
  assert.equal(await thumbs.get(song, 640), null);
  await thumbs.put(song, png(640, 360));
  assert.match(await thumbs.get(song, 640), /\.png$/);
});

test('what a page may hand over is small, a real picture, and not huge', async () => {
  const thumbs = createThumbs({ dir: path.join(DIR, 'refuse'), platform: 'linux' });
  const refused = async (bytes) => {
    const err = await thumbs.put(file(), bytes).then(() => null, (e) => e);
    assert.ok(err, 'refused');
    assert.equal(err.status, 400);
  };
  await refused(Buffer.from('<svg/>'));
  await refused(png(4000, 300));
  await refused(Buffer.concat([vp8(640, 360), Buffer.alloc(512 * 1024)]));
  assert.equal(await thumbs.get(file(), 640), null);
});
