// Taking things out of the drive: a folder as a .zip the page packs itself,
// several things as one .zip, and a document as the HTML file it already is.

import fsp from 'node:fs/promises';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  agents: false,
  documents: {
    drive: await buildDrive(),
    garden: GARDEN,
    'Papers/one': GARDEN,
    'Papers/deep/two': GARDEN,
  },
});
await host.drive.store.putFile('Papers/refs.bib', (async function* () { yield Buffer.from('@article{x, title={Y}}\n'); })());
test.after(() => host.close());

async function openDrive() {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="garden"]').waitFor();
  return { page, errors };
}

const row = (page, path) => page.locator(`#items .item[data-path="${path}"]`);

async function choose(page, path, label) {
  await row(page, path).locator('.name').click({ button: 'right' });
  await page.locator('#menu[data-open="1"]').waitFor();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#menu').getByRole('menuitem', { name: label, exact: true }).click(),
  ]);
  return { name: download.suggestedFilename(), bytes: await fsp.readFile(await download.path()) };
}

// A stored zip, read back through its central directory, every entry's
// bytes checked against the CRC the page wrote for them.
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'an end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const localName = buf.readUInt16LE(local + 26);
    const data = buf.subarray(local + 30 + localName, local + 30 + localName + size);
    assert.equal(zlib.crc32(data), crc, name);
    out.set(name, data.toString('utf8'));
    at += 46 + nameLen;
  }
  return out;
}

test('a folder downloads as a .zip of everything in it, documents as .mrbl and files as themselves', async () => {
  const { page, errors } = await openDrive();
  const { name, bytes } = await choose(page, 'Papers', 'Download as .zip');
  assert.equal(name, 'Papers.zip');
  const files = unzip(bytes);
  assert.deepEqual([...files.keys()].sort(), ['Papers/', 'Papers/deep/', 'Papers/deep/two.mrbl', 'Papers/one.mrbl', 'Papers/refs.bib']);
  assert.match(files.get('Papers/one.mrbl'), /^<!doctype html>/i);
  assert.match(files.get('Papers/one.mrbl'), /Research Garden/);
  assert.equal(files.get('Papers/refs.bib'), '@article{x, title={Y}}\n');
  await page.locator('#toast[data-open="1"]', { hasText: 'Downloaded Papers.zip' }).waitFor();
  assert.deepEqual(errors.filter((e) => !e.includes('sandboxed')), []);
  await page.context().close();
});

test('the .zip of HTML names every document for a browser', async () => {
  const { page } = await openDrive();
  const { name, bytes } = await choose(page, 'Papers', 'Download as .zip of HTML');
  assert.equal(name, 'Papers.zip');
  const names = [...unzip(bytes).keys()].sort();
  assert.deepEqual(names, ['Papers/', 'Papers/deep/', 'Papers/deep/two.html', 'Papers/one.html', 'Papers/refs.bib']);
  await page.context().close();
});

test('a document downloads as HTML, or as the .mrbl it is', async () => {
  const { page } = await openDrive();
  const html = await choose(page, 'garden', 'Download as HTML');
  assert.equal(html.name, 'garden.html');
  assert.match(html.bytes.toString('utf8'), /^<!doctype html>[\s\S]*Research Garden/i);
  await page.keyboard.press('Escape');
  const mrbl = await choose(page, 'garden', 'Download as .mrbl');
  assert.equal(mrbl.name, 'garden.mrbl');
  await page.context().close();
});

test('several picked things download as one .zip named for the folder they are in', async () => {
  const { page } = await openDrive();
  await row(page, 'garden').locator('.name').click();
  await row(page, 'Papers').locator('.name').click({ modifiers: ['Meta'] });
  const { name, bytes } = await choose(page, 'Papers', 'Download 2 as .zip');
  assert.equal(name, 'My Drive.zip');
  const names = [...unzip(bytes).keys()];
  assert.ok(names.includes('garden.mrbl') && names.includes('Papers/deep/two.mrbl'), names.join(', '));
  await page.context().close();
});
