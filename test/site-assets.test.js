// A document that is also a website names its pictures the way a website does:
// `/thumbnails/a.png`, from the root of wherever it is published. In the Drive
// the document is at `/a/Site%2Fpage` and there is no such root, so the host
// answers those paths from the folder of the document that asked — and from
// that folder's `public/`, which is where a site keeps what is served at its
// root.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const DOC = `<!doctype html>
<html data-marble-id="h"><head data-marble-id="hd"><title data-marble-id="t">Page</title></head>
<body data-marble-id="b"><img data-marble-id="pic" src="/thumbnails/a.png" alt=""></body></html>
`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

async function boot(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'site-assets-'));
  await fsp.mkdir(path.join(root, 'Site/thumbnails'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Site/public/papers'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Site/public/thumbnails'), { recursive: true });
  await fsp.writeFile(path.join(root, 'Site/page.mrbl'), DOC);
  await fsp.writeFile(path.join(root, 'Site/thumbnails/a.png'), PNG);
  await fsp.writeFile(path.join(root, 'Site/public/thumbnails/a.png'), 'the shadowed one');
  await fsp.writeFile(path.join(root, 'Site/public/papers/p.pdf'), '%PDF-1.4');
  await fsp.writeFile(path.join(root, 'Site/public/notes.txt'), 'plain');
  await fsp.writeFile(path.join(root, 'top.mrbl'), DOC);
  await fsp.writeFile(path.join(root, 'top.png'), PNG);
  await fsp.writeFile(path.join(root, 'secret.txt'), 'not beside Site');

  const drive = await createDrive(
    loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: 'hunter2' }),
    { log: { log() {}, error() {}, info() {}, warn() {} }, agents: false },
  );
  t.after(async () => {
    await drive.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const origin = `http://127.0.0.1:${port}`;
  const signIn = await fetch(`${origin}/gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'hunter2' }),
  });
  const owner = signIn.headers.get('set-cookie').split(';')[0];
  const get = (p, { from = null, cookie = owner } = {}) => fetch(`${origin}${p}`, {
    redirect: 'manual',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(from ? { Referer: from.startsWith('http') ? from : `${origin}${from}` } : {}),
    },
  });
  return { origin, owner, get };
}

test('a root-absolute path resolves beside the document that asked for it', async (t) => {
  const { get } = await boot(t);
  const res = await get('/thumbnails/a.png', { from: '/a/Site%2Fpage' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  // The folder's own file wins over the one in its public/.
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
});

test('the document may be addressed with its slashes unencoded', async (t) => {
  const { get } = await boot(t);
  const res = await get('/thumbnails/a.png', { from: '/a/Site/page' });
  assert.equal(res.status, 200);
});

test("a folder's public/ is served at its root", async (t) => {
  const { get } = await boot(t);
  const pdf = await get('/papers/p.pdf', { from: '/a/Site%2Fpage' });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const txt = await get('/notes.txt', { from: '/a/Site%2Fpage' });
  assert.equal(txt.status, 200);
  // Served the way /drive/file serves it: inert, never rendered as a page.
  assert.equal(txt.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await txt.text(), 'plain');
});

test('a document at the root resolves against the root', async (t) => {
  const { get } = await boot(t);
  assert.equal((await get('/top.png', { from: '/a/top' })).status, 200);
});

test('nothing resolves without a document to resolve it against', async (t) => {
  const { get, origin } = await boot(t);
  assert.equal((await get('/thumbnails/a.png')).status, 404);
  assert.equal((await get('/thumbnails/a.png', { from: '/drive/tree' })).status, 404);
  // Another site naming this drive's document is not this drive's document.
  assert.equal((await get('/thumbnails/a.png', { from: 'http://elsewhere.test/a/Site%2Fpage' })).status, 404);
  assert.ok(origin);
});

test('a path cannot climb out of the folder or open a document as a file', async (t) => {
  const { get } = await boot(t);
  assert.equal((await get('/..%2Fsecret.txt', { from: '/a/Site%2Fpage' })).status, 404);
  assert.equal((await get('/%2E%2E/secret.txt', { from: '/a/Site%2Fpage' })).status, 404);
  assert.equal((await get('/page.mrbl', { from: '/a/Site%2Fpage' })).status, 404);
  assert.equal((await get('/missing.png', { from: '/a/Site%2Fpage' })).status, 404);
});

test('the host keeps its own routes', async (t) => {
  const { get } = await boot(t);
  const icon = await get('/favicon.ico', { from: '/a/Site%2Fpage' });
  assert.equal(icon.status, 302);
});

test('someone without the passphrase gets none of it', async (t) => {
  const { get } = await boot(t);
  const res = await get('/thumbnails/a.png', { from: '/a/Site%2Fpage', cookie: '' });
  assert.notEqual(res.status, 200);
});
