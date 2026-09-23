// Pictures on any host. With no QuickLook (every host but a Mac, and a Mac with
// MARBLE_DRIVE_QUICKLOOK=0), the page draws a picture of an image, a PDF's
// first page or a video's frame itself, hands it to the host, and every later
// visit gets it from the host without drawing again.

import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

process.env.MARBLE_DRIVE_QUICKLOOK = '0';

/** A real, decodable PNG of one colour. */
function png(w, h, rgb = [40, 110, 200]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF with a blue block on it. pdf.js recovers the missing xref. */
const PDF = Buffer.from([
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 280]/Contents 4 0 R>>endobj',
  '4 0 obj<</Length 34>>stream',
  '0.2 0.4 0.8 rg 20 20 160 240 re f',
  'endstream endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n'));

const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
test.after(() => host.close());
const put = (name, bytes) => host.drive.store.putFile(`Media/${name}`, (async function* () { yield bytes; })());
await host.drive.store.mkdir('Media');
await host.drive.createDocument('Media/Notes', GARDEN, { label: 'test' });
await put('photo.png', png(900, 600));
await put('paper.pdf', PDF);
await put('mystery.xyz', Buffer.from('nothing a browser can draw'));

async function openMedia() {
  const { page, errors } = await host.newPage();
  const puts = [];
  page.on('response', (r) => {
    const q = r.request();
    if (q.method() === 'PUT' && q.url().includes('/drive/thumb')) {
      if (process.env.DEBUG_THUMBS) console.log('PUT', r.status(), q.url());
      puts.push(new URL(q.url()).searchParams.get('path'));
    }
  });
  await page.goto(`${host.base}/a/drive#/Media`);
  await page.locator('.fp[data-path="Media/photo.png"]').waitFor();
  return { page, errors, puts };
}

const thumbType = async (p) => {
  const r = await fetch(`${host.base}/drive/thumb?path=${encodeURIComponent(p)}&w=640`);
  return r.ok ? r.headers.get('content-type') : r.status;
};

test('an image and a PDF already in the drive are drawn once, kept by the host, and not drawn again', async () => {
  const first = await openMedia();
  await first.page.locator('.fp[data-path="Media/photo.png"] .fp-img').waitFor({ timeout: 20_000 });
  await first.page.locator('.fp[data-path="Media/paper.pdf"] .fp-img').waitFor({ timeout: 30_000 });
  for (let waited = 0; first.puts.length < 2 && waited < 5000; waited += 50) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual([...first.puts].sort(), ['Media/paper.pdf', 'Media/photo.png']);
  assert.match(String(await thumbType('Media/paper.pdf')), /^image\/(webp|png)$/);
  assert.match(String(await thumbType('Media/photo.png')), /^image\/(webp|png)$/);
  await first.page.context().close();

  const second = await openMedia();
  await second.page.locator('.fp[data-path="Media/paper.pdf"] .fp-img').waitFor();
  await second.page.locator('.fp[data-path="Media/photo.png"] .fp-img').waitFor();
  assert.deepEqual(second.puts, [], 'the second visit drew nothing');
  await second.page.context().close();
});

test('a file no browser can draw is never drawn, and nothing is handed over for it', async () => {
  const { page, puts } = await openMedia();
  const drawn = await page.evaluate(() => window.marble.drive.drawThumb({ path: 'Media/mystery.xyz', ext: 'xyz' }));
  assert.equal(drawn, null);
  await page.waitForTimeout(800);
  assert.ok(!puts.includes('Media/mystery.xyz'));
  assert.equal(await thumbType('Media/mystery.xyz'), 404);
  await page.context().close();
});

test('a video uploaded from the page is drawn from the file it still holds', async () => {
  const { page, puts } = await openMedia();
  await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
    const g = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const stopped = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start();
    const until = performance.now() + 1500;
    while (performance.now() < until) {
      g.fillStyle = `hsl(${(performance.now() / 5) % 360} 70% 50%)`;
      g.fillRect(0, 0, 320, 180);
      await new Promise((r) => requestAnimationFrame(r));
    }
    rec.stop();
    await stopped;
    const file = new File(parts, 'clip.webm', { type: 'video/webm' });
    await window.marble.drive.uploadFile({ folder: 'Media', name: 'clip.webm', file });
  });
  await page.waitForFunction(() => true);
  const deadline = Date.now() + 20_000;
  while (!puts.includes('Media/clip.webm') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.ok(puts.includes('Media/clip.webm'), 'the uploaded video was drawn');
  assert.match(String(await thumbType('Media/clip.webm')), /^image\/(webp|png)$/);
  await page.context().close();
});
