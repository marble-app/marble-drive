// GET /drive/export.zip: the whole drive as one zip to take away. Every
// document flattened as /drive/download gives it, every other file as it is,
// in their folders under one named for the drive, and nothing of .marble/ or
// any other dot-folder; no link followed and no pipe opened. Read back with
// the repo's own reader (server/zip.js), and the writer's zip64 the same way.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { openZip } = await import('../server/zip.js');
const { crc32, zipStream } = await import('../server/zip-write.js');
const { flatten, flattenChunks, PLACEHOLDER } = await import('../server/flatten.js');
const { refreshed } = await import('../server/favicon.js');
const { createBlobs } = await import('../server/store/blobs.js');
const { attachment, exportName } = await import('../server/export.js');
const { PNG } = await import('./fixtures/pptx.js');

const quiet = { log() {}, error() {}, info() {} };
const SECRET = 'pw-export-5150';
const made = [];
test.after(async () => {
  for (const dir of made) await fsp.rm(dir, { recursive: true, force: true });
});
const tmp = async (prefix) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const collect = async (chunks) => {
  const out = [];
  for await (const chunk of chunks) out.push(Buffer.from(chunk));
  return Buffer.concat(out);
};
const doc = (title, body) => `<!doctype html>\n<html><head><title>${title}</title></head><body data-marble-id="b">${body}</body></html>\n`;

/** A drive as a person and their agents leave it. */
async function drive(env = {}) {
  const root = await tmp('marble-export-');
  const outside = await tmp('marble-export-outside-');
  const config = loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: SECRET, MARBLE_DRIVE_AGENT_KEYS: path.join(outside, 'keys'), ...env });
  const it = await createDrive(config, { log: quiet, agents: false });
  test.after(() => it.close());
  const port = await new Promise((resolve) => it.server.listen(0, '127.0.0.1', () => resolve(it.server.address().port)));
  const base = `http://127.0.0.1:${port}`;

  // Documents, one holding a picture as a blob and one naming a blob that is gone.
  const picture = Buffer.concat([PNG, crypto.randomBytes(200_003)]);
  const { hash } = await it.store.blobs.put(picture, { type: 'image/png' });
  const gone = 'f'.repeat(64);
  await it.store.write('Notes/Plain', doc('Plain', '<p data-marble-id="p">Words of my own.</p>'));
  await it.store.write('Notes/With a picture', doc('With a picture', `<img data-marble-id="i" data-marble-blob="${hash}" data-marble-type="image/png" src="${PLACEHOLDER}"><img data-marble-id="j" data-marble-blob="${gone}" data-marble-type="image/png" src="${PLACEHOLDER}">`));
  await it.store.write('Top', doc('Top', '<h1 data-marble-id="h">At the top</h1>'));
  // A document with a name the Drive's grammar refuses is still the person's.
  await fsp.writeFile(path.join(root, 'Notes', 'Café (draft).mrbl'), doc('Café', '<p data-marble-id="c">Brouillon</p>'));
  // Files that are not documents, a big one among them, and an empty folder.
  await fsp.mkdir(path.join(root, 'Pictures'));
  await fsp.writeFile(path.join(root, 'Pictures', 'cat.png'), PNG);
  await fsp.mkdir(path.join(root, 'Media'));
  const clip = crypto.randomBytes(3 * 1024 * 1024 + 7);
  await fsp.writeFile(path.join(root, 'Media', 'clip.mp4'), clip);
  await fsp.writeFile(path.join(root, 'Notes', 'data.csv'), 'a,b\n1,2\n'.repeat(5000));
  await fsp.writeFile(path.join(root, 'Notes', 'empty.txt'), '');
  await fsp.mkdir(path.join(root, 'Empty'));
  // What is never in an export: the host's own folder, any other dot-folder
  // or dot-file, links out of the drive, and a pipe.
  await fsp.mkdir(path.join(root, '.marble', 'agents', '0123456789ab'), { recursive: true });
  await fsp.writeFile(path.join(root, '.marble', 'agents', '0123456789ab', 'events.jsonl'), '{"type":"user","text":"a-prompt-of-mine-2208"}\n');
  await fsp.mkdir(path.join(root, '.secret'));
  await fsp.writeFile(path.join(root, '.secret', 'key.txt'), 'hidden-key-5512\n');
  await fsp.writeFile(path.join(root, 'Notes', '.DS_Store'), 'finder-junk-7731');
  await fsp.mkdir(path.join(outside, '.claude'));
  await fsp.writeFile(path.join(outside, '.claude', '.credentials.json'), 'not-a-real-login-9d2e');
  await fsp.symlink(path.join(outside, '.claude', '.credentials.json'), path.join(root, 'Notes', 'login.json'));
  await fsp.symlink(outside, path.join(root, 'Linked'));
  await fsp.symlink(path.join(root, 'Top.mrbl'), path.join(root, 'Notes', 'Top again.mrbl'));
  if (has('mkfifo')) execFileSync('mkfifo', [path.join(root, 'Notes', 'pipe')]);

  const get = (route, headers = { authorization: `Bearer ${SECRET}` }) => fetch(base + route, { headers });
  return { it, root, base, get, hash, picture, clip };
}

test('the export is every document flattened and every file as it is, under one folder named for the drive', async () => {
  const { it, get, picture, clip } = await drive({ MARBLE_DOOR_NAME: 'ana' });
  const res = await get('/drive/export.zip');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="ana.zip"; filename*=UTF-8\'\'ana.zip');
  assert.equal(res.headers.get('content-length'), null, 'sent as it is made');
  const bytes = Buffer.from(await res.arrayBuffer());
  const zip = await openZip(bytes);
  try {
    assert.deepEqual(zip.names(), [
      'ana/',
      'ana/Empty/',
      'ana/Media/',
      'ana/Media/clip.mp4',
      'ana/Notes/',
      'ana/Notes/Café (draft).mrbl',
      'ana/Notes/Plain.mrbl',
      'ana/Notes/With a picture.mrbl',
      'ana/Notes/data.csv',
      'ana/Notes/empty.txt',
      'ana/Pictures/',
      'ana/Pictures/cat.png',
      'ana/Top.mrbl',
    ]);
    // Each document as /drive/download gives it: flattened, its picture
    // inside it, and the blob it lost still named.
    for (const docPath of ['Notes/Plain', 'Notes/With a picture', 'Top']) {
      const downloaded = Buffer.from(await (await get(`/drive/download?path=${encodeURIComponent(docPath)}`)).arrayBuffer());
      assert.ok((await zip.read(`ana/${docPath}.mrbl`)).equals(downloaded), `${docPath} is as /drive/download sends it`);
    }
    const flat = (await zip.read('ana/Notes/With a picture.mrbl')).toString('utf8');
    assert.ok(flat.includes(`src="data:image/png;base64,${picture.toString('base64')}"`), 'the picture is back inside its document');
    assert.match(flat, /data-marble-blob="f{64}"/, 'a blob that is gone stays named');
    assert.match((await zip.read('ana/Notes/Café (draft).mrbl')).toString('utf8'), /Brouillon/);
    // Every other file, byte for byte.
    assert.ok((await zip.read('ana/Pictures/cat.png')).equals(PNG));
    assert.ok((await zip.read('ana/Media/clip.mp4', { limit: 8 * 1024 * 1024 })).equals(clip));
    assert.equal((await zip.read('ana/Notes/data.csv')).toString('utf8'), 'a,b\n1,2\n'.repeat(5000));
    assert.equal((await zip.read('ana/Notes/empty.txt')).length, 0);
  } finally {
    await zip.close();
  }
  // Nothing of .marble/, the dot-folder, the links or the pipe, in any form.
  // Each word has a hyphen, which no base64 picture in the zip can make.
  for (const word of ['a-prompt-of-mine-2208', 'hidden-key-5512', 'not-a-real-login-9d2e', 'finder-junk-7731']) assert.ok(!bytes.includes(word), `the zip holds "${word}"`);
  // The drive's own copy of the picture was read, not changed.
  assert.ok((await it.store.blobs.get((await it.store.read('Notes/With a picture')).match(/data-marble-blob="([0-9a-f]{64})"/)[1])).data.equals(picture));
});

test('a zip that unzip and Python read too, and a name from the folder when the door names none', { skip: !has('python3') && 'python3 is not installed' }, async () => {
  const { root, get } = await drive();
  const res = await get('/drive/export.zip');
  const name = path.basename(root);
  assert.ok(res.headers.get('content-disposition').startsWith(`attachment; filename="${name}.zip"`));
  const file = path.join(await tmp('marble-export-zip-'), 'drive.zip');
  await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
  const python = spawnSync('python3', ['-c', 'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nprint(z.testzip())\nprint(len(z.namelist()))', file], { encoding: 'utf8' });
  assert.equal(python.status, 0, python.stderr);
  assert.deepEqual(python.stdout.trim().split('\n'), ['None', '13']);
  if (has('unzip')) {
    const unzip = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.equal(unzip.status, 0, unzip.stdout + unzip.stderr);
    assert.match(unzip.stdout, /No errors detected/);
  }
});

test('a drive kept in a linked folder is exported from where the link leads', async () => {
  const { openZip: open } = await import('../server/zip.js');
  const { exportEntries } = await import('../server/export.js');
  const real = await tmp('marble-export-real-');
  await fsp.writeFile(path.join(real, 'Note.mrbl'), doc('Note', '<p data-marble-id="n">here</p>'));
  const linked = path.join(await tmp('marble-export-linked-'), 'Drive');
  await fsp.symlink(real, linked);
  const zip = await open(await collect(zipStream(exportEntries({ root: linked, blobs: createBlobs({ dir: path.join(real, '.marble', 'blobs') }), top: 'Drive' }))));
  try {
    assert.deepEqual(zip.names(), ['Drive/', 'Drive/Note.mrbl']);
  } finally {
    await zip.close();
  }
});

test('the export is the owner\'s, like every other route behind the gate', async () => {
  const { get } = await drive();
  const res = await get('/drive/export.zip', {});
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type'), /json/);
});

test('someone who stops a download part-way leaves the drive answering', async () => {
  const { get, base } = await drive();
  const controller = new AbortController();
  const res = await fetch(`${base}/drive/export.zip`, { headers: { authorization: `Bearer ${SECRET}` }, signal: controller.signal });
  const reader = res.body.getReader();
  await reader.read();
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await get('/health')).status, 200);
  assert.equal((await get('/drive/export.zip')).status, 200);
});

test('the zip writer: stored and deflated, whole and streamed, and zip64 throughout, read back by server/zip.js', async () => {
  const big = crypto.randomBytes(300_001);
  const text = 'Words and more words.\n'.repeat(20_000);
  const entries = () => [
    { name: 'top', folder: true, modified: Date.UTC(2026, 9, 25, 17, 0, 3) },
    { name: 'top/whole.txt', data: text, deflate: true, modified: Date.now() },
    { name: 'top/raw.bin', data: big, modified: Date.now() },
    { name: 'top/streamed.bin', size: big.length, chunks: () => Readable.from([big.subarray(0, 1000), big.subarray(1000)]), modified: Date.now() },
    { name: 'top/streamed.txt', deflate: true, chunks: async function* () { yield Buffer.from(text.slice(0, 7)); yield Buffer.from(text.slice(7)); }, modified: Date.now() },
    { name: 'top/Café ☕.txt', data: 'é', modified: 0 },
  ];
  for (const zip64 of [false, true]) {
    const bytes = await collect(zipStream(entries(), { zip64 }));
    const zip = await openZip(bytes);
    try {
      assert.deepEqual(zip.names(), ['top/', 'top/whole.txt', 'top/raw.bin', 'top/streamed.bin', 'top/streamed.txt', 'top/Café ☕.txt']);
      assert.equal((await zip.read('top/whole.txt')).toString('utf8'), text);
      assert.ok((await zip.read('top/raw.bin')).equals(big));
      assert.ok((await zip.read('top/streamed.bin')).equals(big));
      assert.equal((await zip.read('top/streamed.txt')).toString('utf8'), text);
      assert.equal((await zip.read('top/Café ☕.txt')).toString('utf8'), 'é');
      assert.equal(zip.size('top/streamed.bin'), big.length);
    } finally {
      await zip.close();
    }
    if (has('python3')) {
      const file = path.join(await tmp('marble-zip64-'), 'z.zip');
      await fsp.writeFile(file, bytes);
      // A streamed entry is deflated, so its end can be found reading front to
      // back; one handed over whole and not compressed is stored, sizes first.
      const python = spawnSync('python3', ['-c', [
        'import sys, zipfile',
        'z = zipfile.ZipFile(sys.argv[1])',
        'print(z.testzip())',
        's = z.getinfo("top/streamed.bin"); print(s.file_size, s.compress_type, s.flag_bits & 8)',
        'r = z.getinfo("top/raw.bin"); print(r.compress_type, r.flag_bits & 8)',
      ].join('\n'), file], { encoding: 'utf8' });
      assert.equal(python.status, 0, python.stderr);
      assert.deepEqual(python.stdout.trim().split('\n'), ['None', `${big.length} 8 8`, '0 0'], `zip64 ${zip64}`);
    }
  }
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('flattenChunks is flatten in pieces, byte for byte, with a picture larger than one read', async () => {
  const blobs = createBlobs({ dir: path.join(await tmp('marble-flat-'), 'blobs') });
  const one = await blobs.put(crypto.randomBytes(200_000), { type: 'image/png' });
  const two = await blobs.put(crypto.randomBytes(65_537), { type: 'audio/mpeg' });
  const sources = [
    'no blobs at all',
    doc('Two', `<img data-marble-blob="${one.hash}" data-marble-type="image/png" src="${PLACEHOLDER}"><audio data-marble-blob="${two.hash}" data-marble-type="audio/mpeg" src=""></audio>`),
    doc('Gone', `<img data-marble-blob="${'a'.repeat(64)}" data-marble-type="image/png" src="${PLACEHOLDER}"> and é ☕ after`),
    doc('No src', `<img data-marble-blob="${one.hash}" data-marble-type="image/png" alt="x"><p>after</p>`),
    doc('Twice', `<img data-marble-blob="${one.hash}" data-marble-type="image/png" src="${PLACEHOLDER}"><img data-marble-blob="${one.hash}" data-marble-type="image/png" src="${PLACEHOLDER}">`),
  ];
  for (const source of sources) {
    const whole = (await flatten(refreshed(source), blobs)).source;
    assert.equal((await collect(flattenChunks(refreshed(source), blobs))).toString('utf8'), whole);
  }
});

test('the export is named for the drive, as a file name can be anywhere', () => {
  assert.equal(exportName({ doorName: 'ana', root: '/x/y' }), 'ana');
  assert.equal(exportName({ root: '/home/me/Marble Drive' }), 'Marble Drive');
  assert.equal(exportName({ root: '/home/me/a:b?c' }), 'a b c');
  assert.equal(exportName({ root: '/' }), 'drive');
  assert.equal(attachment('Café drive.zip'), 'attachment; filename="Caf_ drive.zip"; filename*=UTF-8\'\'Caf%C3%A9%20drive.zip');
});
