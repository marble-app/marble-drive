import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';
import { liveDriveSource } from './live-drive.js';

// Twenty seconds of a tone that swells, as a WAV — a real song the page can
// decode, made here rather than checked in.
function wav(seconds = 20, rate = 8000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) {
    const swell = i / n;
    buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 20000 * swell), 44 + i * 2);
  }
  return buf;
}

async function stock(host) {
  await host.drive.store.mkdir('Mix');
  await host.drive.createDocument('Mix/Studio', GARDEN, { label: 'test' });
  const put = (name, bytes) => host.drive.store.putFile('Mix/' + name, (async function* () { yield bytes; })());
  await put('beat.wav', wav());
  await put('notes.txt', Buffer.from('first line\nsecond line\n'));
}

test('a song beside a document gets a tile that plays, and the paperwork still folds away', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    await stock(host);
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive#/Mix`);
    const song = page.locator('#items > .item[data-path="Mix/beat.wav"]');
    await song.waitFor();
    // The song is a tile of its own; the text file is a chip under the rule.
    assert.equal(await page.locator('.mats .item[data-path="Mix/beat.wav"]').count(), 0);
    assert.equal(await page.locator('.mats .item[data-path="Mix/notes.txt"]').count(), 1);

    // Its waveform is drawn from the bytes, and it knows how long it is.
    await page.waitForSelector('.fp[data-fk="audio"].marble-is-ready .fp-bars path');
    assert.equal(await song.locator('.fp-time').textContent(), '0:20');

    // Play is a control, not a press on the tile: nothing gets picked.
    await song.locator('.fp-play').click();
    await page.waitForFunction(() => document.querySelector('.fp.marble-is-playing'));
    assert.equal(await page.locator('.item.marble-picked').count(), 0);
    await page.waitForFunction(() => Number(document.querySelector('.fp.marble-is-playing')?.style.getPropertyValue('--p')) > 0);

    // A write elsewhere redraws the listing, and the new tile finds the song
    // still playing rather than stopping it.
    await fetch(`${host.base}/drive/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'Mix/Later' }),
    });
    await page.locator('#items .item[data-path="Mix/Later"]').waitFor();
    assert.equal(await page.locator('.fp.marble-is-playing').count(), 1);

    await song.locator('.fp-play').click();
    await page.waitForFunction(() => !document.querySelector('.fp.marble-is-playing'));
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});

test('a folder of nothing but files shows every one of them, and text shows its first lines', async () => {
  const host = await startDrive({ agents: false, documents: { drive: await buildDrive(), garden: GARDEN } });
  try {
    await host.drive.store.mkdir('Loose');
    await host.drive.store.putFile('Loose/readme.md', (async function* () { yield Buffer.from('# Hello\nworld\n'); })());
    await host.drive.store.putFile('Loose/blob.bin', (async function* () { yield Buffer.alloc(40, 1); })());
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive#/Loose`);
    await page.locator('#items > .item[data-path="Loose/readme.md"]').waitFor();
    assert.equal(await page.locator('.mats').count(), 0);
    await page.waitForSelector('.fp[data-fk="text"].marble-is-ready .fp-text');
    assert.match(await page.locator('.fp-text').textContent(), /# Hello\nworld/);
    // A kind nobody can draw is its glyph and its extension.
    assert.equal(await page.locator('.fp[data-fk="other"] .fp-badge i').textContent(), 'BIN');
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});

test('the live drive draws a song in the map as a waveform that plays', async () => {
  const source = await liveDriveSource();
  if (!source || !source.includes('function tmCell(')) return; // no live drive in this checkout
  const host = await startDrive({ agents: false, documents: { drive: source, garden: GARDEN } });
  try {
    await stock(host);
    const { page, errors } = await host.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${host.base}/a/drive#/Mix`);
    await page.locator('[data-set-view="tiles"]').click();
    const cell = page.locator('.tile-field .tm[data-path="Mix/beat.wav"]');
    await cell.locator('.fp.tm-file[data-fk="audio"].marble-is-ready .fp-bars path').waitFor();
    await cell.locator('.fp-play').click();
    await page.waitForFunction(() => document.querySelector('.tm .fp.marble-is-playing'));
    // An empty folder is not drawn in the map, so the redraw is watched for
    // as a new field rather than a new cell.
    await page.evaluate(() => (document.querySelector('.tile-field').dataset.old = '1'));
    await fetch(`${host.base}/drive/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'Mix/Later' }),
    });
    await page.locator('.tile-field:not([data-old])').waitFor({ state: 'attached' });
    await page.waitForSelector('.tile-field:not([data-old]) .tm[data-path="Mix/beat.wav"] .fp.marble-is-playing');
    assert.deepEqual(errors.filter((e) => !/sandboxed/.test(e)), []);
  } finally {
    await host.close();
  }
});
