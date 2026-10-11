import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';
import { liveDriveSource } from './live-drive.js';

// A file off the desktop is a DataTransfer, not a pointer, so the drop is
// built in the page and dispatched at the element a hand would let go over.
// Every byte value goes in, so a text decode anywhere on the way would show.
async function dropFiles(page, selector, files) {
  await page.evaluate(
    ({ selector, files }) => {
      const target = selector ? document.querySelector(selector) : document.body;
      const data = new DataTransfer();
      for (const { name, type, size, text } of files) {
        const bytes = text ?? new Uint8Array(size).map((_, i) => (i * 37) % 256);
        data.items.add(new File([bytes], name, { type }));
      }
      const fire = (type) =>
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      fire('dragenter');
      fire('dragover');
      fire('drop');
    },
    { selector, files },
  );
}

const expected = (size) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 37) % 256));

const MP3 = { name: 'thank u, next (Instrumental).mp3', type: 'audio/mpeg', size: 90000 };
const DS_STORE = { name: '.DS_Store', type: '', size: 12 };

async function studio(host) {
  // A folder with a document in it, so it is drawn as a folder and not folded
  // away with the materials.
  await host.drive.store.mkdir('Song Mashups');
  await host.drive.createDocument('Song Mashups/Studio', GARDEN, { label: 'test' });
}

test('an mp3 dropped on a folder lands in it, byte for byte, and a .DS_Store does not', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    await studio(host);
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive`);
    const folder = '#items .item[data-kind="folder"][data-path="Song Mashups"]';
    await page.locator(folder).waitFor();

    await dropFiles(page, folder, [MP3, DS_STORE]);
    await page.waitForFunction(() => /Added Song Mashups\//.test(document.body.innerText));

    const stored = 'Song Mashups/thank u next Instrumental.mp3';
    assert.ok(await host.drive.store.hasFile(stored), 'the song is in the folder');
    const raw = await host.drive.store.readRaw(stored);
    const chunks = [];
    for await (const chunk of raw.open()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), expected(MP3.size));
    assert.equal(await host.drive.store.hasFile('Song Mashups/.DS_Store'), false);
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});

test('the live drive takes a song and a document from one drop', async () => {
  const source = await liveDriveSource();
  if (!source) return; // the live drive is not in this checkout
  const host = await startDrive({ agents: false, documents: { drive: source, garden: GARDEN } });
  try {
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive`);
    await page.waitForFunction(() => document.querySelector('#status')?.dataset.live === '1' || document.querySelector('[data-live="1"]'));

    // Dropped on nothing in particular, which is the folder you are in.
    await dropFiles(page, null, [
      { name: 'Birds of a Feather (Vocals).wav', type: 'audio/wav', size: 4096 },
      { name: 'Brought.mrbl', type: 'text/html', text: '<!doctype html><html><head><title>Brought</title></head><body><p data-marble-id="br0ught1">hi</p></body></html>' },
    ]);
    await page.waitForFunction(() => /Added 2 files/.test(document.body.innerText));
    assert.ok(await host.drive.store.hasFile('Birds of a Feather Vocals.wav'), 'the song is at the root');
    assert.ok(await host.drive.store.has('Brought'), 'the document went in as a document');
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});

test('a slow upload shows itself moving, and a clean one closes itself', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    await studio(host);
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive`);
    const folder = '#items .item[data-kind="folder"][data-path="Song Mashups"]';
    await page.locator(folder).waitFor();

    // A funnel from another laptop, roughly: 1.5 MB/s up.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 20, downloadThroughput: -1, uploadThroughput: 1.5 * 1024 * 1024,
    });

    await dropFiles(page, folder, [{ name: 'Big Song.mp3', type: 'audio/mpeg', size: 4 * 1024 * 1024 }]);
    const tray = page.locator('.uploads[data-open="1"]');
    await tray.waitFor();
    assert.match(await tray.locator('.up-title').textContent(), /Adding Big Song\.mp3 to Song Mashups/);
    // Somewhere strictly between nothing and everything, so the bar is moving.
    await page.waitForFunction(() => {
      const w = parseFloat(document.querySelector('.up-bar i').style.width);
      return w > 5 && w < 95;
    });
    assert.match(await tray.locator('.up-files li .s').textContent(), /^\d+%$/);

    await page.waitForFunction(() => document.querySelector('.uploads').dataset.state === 'done');
    assert.match(await page.locator('.uploads .up-title').textContent(), /Added Song Mashups\/Big Song\.mp3/);
    await page.waitForFunction(() => !document.querySelector('.uploads').hasAttribute('data-open'), null, { timeout: 5000 });
    assert.ok(await host.drive.store.hasFile('Song Mashups/Big Song.mp3'));
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});

test('a host too old to take files says to restart it, and the card stays up', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    const { page } = await host.newPage();
    await page.route('**/drive/upload-file**', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }),
    );
    await page.goto(`${host.base}/a/drive`);
    await page.locator('#items .item').first().waitFor();

    await dropFiles(page, null, [MP3]);
    await page.waitForFunction(() => document.querySelector('.uploads').dataset.state === 'failed');
    assert.match(await page.locator('.uploads').textContent(), /needs a restart/);
    await page.waitForTimeout(3000);
    assert.equal(await page.locator('.uploads').getAttribute('data-open'), '1', 'a failure is not dismissed for you');
    await page.locator('.uploads .up-foot button', { hasText: 'Close' }).click();
    assert.equal(await page.locator('.uploads').getAttribute('data-open'), null);
  } finally {
    await host.close();
  }
});
