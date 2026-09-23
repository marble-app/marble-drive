// A big file over a link that drops. The page sends it in chunks through a
// session (server/uploads.js); a cut chunk is retried from what the host has,
// and a reload followed by the same file dropped again carries on.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';
import { liveDriveSource } from './live-drive.js';

process.env.MARBLE_DRIVE_UPLOAD_CHUNK = String(1024 * 1024);
process.env.MARBLE_DRIVE_UPLOAD_MARGIN = '0';

const SIZE = 33 * 1024 * 1024 + 123;
const expected = (size) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 37) % 256));

// MARBLE_TEST_LIVE_DRIVE=1 runs the same checks against the owner's live Drive
// document (MARBLE_DRIVE_DOC, or the drive root's), e.g. after a patch.
const DRIVE_DOC = process.env.MARBLE_TEST_LIVE_DRIVE ? await liveDriveSource() : await buildDrive();
const host = await startDrive({ agents: false, documents: { drive: DRIVE_DOC, garden: GARDEN } });
test.after(() => host.close());
await host.drive.store.mkdir('Video');
await host.drive.createDocument('Video/Notes', GARDEN, { label: 'test' });
await host.drive.store.mkdir('Other');
await host.drive.createDocument('Other/Notes', GARDEN, { label: 'test' });

/** Make the same big file in the page every time: same bytes, name and date. */
const MAKE = `(() => {
  const bytes = new Uint8Array(${SIZE});
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37) % 256;
  return new File([bytes], 'long take.mov', { type: 'video/quicktime', lastModified: 1790000000000 });
})()`;

const offsets = (page) => {
  const seen = [];
  page.on('request', (r) => {
    const m = /\/drive\/uploads\/[0-9a-f]+\?offset=(\d+)/.exec(r.url());
    if (m && r.method() === 'PUT') seen.push(Number(m[1]));
  });
  return seen;
};

const onDisk = async (p) => {
  const raw = await host.drive.store.readRaw(p);
  if (!raw) return null;
  const chunks = [];
  for await (const chunk of raw.open()) chunks.push(chunk);
  return Buffer.concat(chunks);
};

test('a chunk the network drops is retried, the row says so, and the file lands whole', async () => {
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  const folder = '#items .item[data-kind="folder"][data-path="Video"]';
  await page.locator(folder).waitFor();

  let cut = false;
  await page.route(/\/drive\/uploads\/[0-9a-f]+\?offset=/, (route) => {
    if (!cut && /[?&]offset=2097152(&|$)/.test(route.request().url())) {
      cut = true;
      return route.abort('connectionreset');
    }
    return route.continue();
  });

  await page.evaluate((make) => {
    const file = eval(make);
    const data = new DataTransfer();
    data.items.add(file);
    const target = document.querySelector('#items .item[data-kind="folder"][data-path="Video"]');
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }, MAKE);

  await page.waitForFunction(() => /reconnecting/.test(document.querySelector('.uploads')?.innerText ?? ''), null, { timeout: 20_000 });
  await page.waitForFunction(() => /Added Video\//.test(document.body.innerText), null, { timeout: 60_000 });
  assert.ok(cut, 'a chunk was cut');
  assert.deepEqual(await onDisk('Video/long take.mov'), expected(SIZE));
  await page.context().close();
});

test('a reload part way through, and the same file dropped again, carries on from where the host is', async () => {
  const first = await host.newPage();
  const firstOffsets = offsets(first.page);
  await first.page.goto(`${host.base}/a/drive`);
  // Let two chunks through, then hold the third so the page is mid-upload.
  await first.page.route(/\/drive\/uploads\/[0-9a-f]+\?offset=/, (route) => {
    if (/[?&]offset=(0|1048576)(&|$)/.test(route.request().url())) return route.continue();
    return new Promise(() => {});
  });
  // Not awaited: the reload below ends this upload with the page it ran in.
  first.page.evaluate((make) => window.marble.drive.uploadFile({ folder: 'Video', name: 'again.mov', file: eval(make) }).catch(() => {}), MAKE).catch(() => {});
  const deadline = Date.now() + 20_000;
  while (firstOffsets.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(firstOffsets.slice(0, 3), [0, 1048576, 2097152]);

  // The same tab, reloaded: the File is gone, the session is remembered.
  await first.page.unrouteAll({ behavior: 'ignoreErrors' });
  await first.page.reload();
  await first.page.waitForFunction(() => Boolean(window.marble?.drive?.uploadFile));
  const resumed = offsets(first.page);
  const answer = await first.page.evaluate((make) => window.marble.drive.uploadFile({ folder: 'Video', name: 'again.mov', file: eval(make) }), MAKE);
  // Where the host was: at least the two chunks let through (the held third
  // may have landed as the route was lifted), never the start again.
  assert.ok(resumed[0] >= 2 * 1048576, `the second drop carried on (it started at ${resumed[0]})`);
  assert.equal(answer.path, 'Video/again.mov');
  assert.deepEqual(await onDisk('Video/again.mov'), expected(SIZE));

  // The same file into another folder is another upload.
  const elsewhere = offsets(first.page);
  await first.page.evaluate((make) => window.marble.drive.uploadFile({ folder: 'Other', name: 'again.mov', file: eval(make) }), MAKE);
  assert.equal(elsewhere[0], 0);
  await first.page.context().close();
});
