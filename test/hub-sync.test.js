import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EXCLUDES, down, looksWrong, rclone, rcloneEnv, scan, trashPrefix, up } from '../server/hub/sync.js';

let hasRclone = true;
try { execFileSync('rclone', ['version'], { stdio: 'ignore' }); } catch { hasRclone = false; }
const needsRclone = { skip: hasRclone ? false : 'rclone is not installed' };

const tmp = (name) => fsp.mkdtemp(path.join(os.tmpdir(), `hub-${name}-`));
async function put(root, rel, text) {
  await fsp.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fsp.writeFile(path.join(root, rel), text);
}
async function tree(root) {
  const out = {};
  const walk = async (dir, rel) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out[r] = await fsp.readFile(path.join(dir, e.name), 'utf8');
    }
  };
  await walk(root, '');
  return out;
}
async function fixture() {
  const root = await tmp('drive');
  await put(root, 'notes.mrbl', '<html>notes</html>');
  await put(root, "Bryan's Days/Café — today.mrbl", '<html>day</html>');
  await put(root, "Design Don'ts.mrbl", '<html>donts</html>');
  await put(root, '.marble/notes.history.jsonl', '{"v":1}\n');
  await put(root, '.marble/agents/host.lock', '12345\n');
  await put(root, '.marble/usage/2026-09-30.jsonl', '{}\n');
  await put(root, '.marble/console/backups/admin-p2.json', '{}');
  return root;
}
async function settings() {
  return {
    HUB_DRIVE: 'bryan', HUB_MACHINE: 'mac', HUB_PASSPHRASE: 'correct horse', HUB_SALT: 'battery staple',
    HUB_BACKEND: 'local', HUB_LOCAL_DIR: await tmp('hub'), LEASE_URL: 'https://l', LEASE_TOKEN: 't',
  };
}
const at = (iso) => () => new Date(iso);

test('scan counts files and documents, and skips what is left out', async () => {
  const root = await fixture();
  const counts = await scan(root);
  assert.equal(counts.files, 4); // 3 documents + the history line
  assert.equal(counts.documents, 3);
  assert.ok(counts.newest > 0);
  assert.deepEqual(EXCLUDES, ['/.marble/agents/host.lock', '/.marble/usage/**', '/.marble/console/backups/**']);
});

test('looksWrong: no documents, or under half the files, is refused', () => {
  assert.match(looksWrong({ files: 10, documents: 0 }, null), /no documents/);
  assert.match(looksWrong({ files: 40, documents: 3 }, { files: 100 }), /under half/);
  assert.equal(looksWrong({ files: 60, documents: 3 }, { files: 100 }), null);
  assert.equal(looksWrong({ files: 1, documents: 1 }, null), null);
});

test('round trip keeps odd names, and leaves the excluded files out', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  const result = await up({ root, settings: s, epoch: 3, now: at('2026-09-30T10:00:00Z') });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, { home: 'mac', epoch: 3, seq: 1, at: '2026-09-30T10:00:00.000Z', files: 4, documents: 3 });

  const other = await tmp('other');
  const back = await down({ root: other, settings: s, trashRoot: await tmp('trash') });
  assert.equal(back.ok, true);
  assert.equal(back.matches, true);
  assert.deepEqual(await tree(other), {
    'notes.mrbl': '<html>notes</html>',
    "Bryan's Days/Café — today.mrbl": '<html>day</html>',
    "Design Don'ts.mrbl": '<html>donts</html>',
    '.marble/notes.history.jsonl': '{"v":1}\n',
  });
});

test('the hub holds no readable names or contents', needsRclone, async () => {
  const s = await settings();
  await up({ root: await fixture(), settings: s, epoch: 0 });
  const raw = await tree(path.join(s.HUB_LOCAL_DIR, 'bryan', 'data'));
  const text = JSON.stringify(raw);
  for (const secret of ['Bryan', 'notes', 'Café', '<html>']) assert.ok(!text.includes(secret), `hub shows "${secret}"`);
});

test('a download keeps what the other machine left out, and sets aside what it replaces', needsRclone, async () => {
  const s = await settings();
  await up({ root: await fixture(), settings: s, epoch: 0 });
  const here = await tmp('here');
  await put(here, '.marble/agents/host.lock', 'mine\n');
  await put(here, '.marble/usage/2026-09-30.jsonl', 'mine\n');
  await put(here, 'notes.mrbl', '<html>old notes</html>');
  const trashRoot = await tmp('trash');
  await down({ root: here, settings: s, trashRoot, now: at('2026-09-30T11:00:00Z') });
  const after = await tree(here);
  assert.equal(after['.marble/agents/host.lock'], 'mine\n');
  assert.equal(after['.marble/usage/2026-09-30.jsonl'], 'mine\n');
  assert.equal(after['notes.mrbl'], '<html>notes</html>');
  assert.deepEqual(await tree(trashRoot), { '20260930T110000Z/notes.mrbl': '<html>old notes</html>' });
});

test('a second upload puts what it deleted in the hub trash, and counts on', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0 });
  await fsp.rm(path.join(root, "Design Don'ts.mrbl"));
  const second = await up({ root, settings: s, epoch: 0, now: at('2026-09-30T12:00:00Z') });
  assert.equal(second.state.seq, 2);
  const env = await rcloneEnv(s);
  const trash = (await rclone(['lsf', '-R', 'hub:trash'], env)).stdout;
  assert.match(trash, /20260930T120000Z\/Design Don'ts\.mrbl/);
});

test('refuses to upload an empty drive', needsRclone, async () => {
  const s = await settings();
  await up({ root: await fixture(), settings: s, epoch: 0 });
  const empty = await tmp('empty');
  const result = await up({ root: empty, settings: s, epoch: 0 });
  assert.equal(result.ok, false);
  assert.match(result.why, /no documents/);
  const other = await tmp('other');
  await down({ root: other, settings: s, trashRoot: await tmp('trash') });
  assert.equal((await tree(other))['notes.mrbl'], '<html>notes</html>');
});

test('refuses to download from an empty hub', needsRclone, async () => {
  const s = await settings();
  const here = await fixture();
  const result = await down({ root: here, settings: s, trashRoot: await tmp('trash') });
  assert.equal(result.ok, false);
  assert.match(result.why, /no upload yet/);
  assert.equal((await tree(here))['notes.mrbl'], '<html>notes</html>');
});

test('trashPrefix names the encrypted folder the trash lands in', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0 });
  await fsp.rm(path.join(root, "Design Don'ts.mrbl"));
  await up({ root, settings: s, epoch: 0 });
  const prefix = await trashPrefix({ settings: s });
  assert.match(prefix, /^bryan\/data\/[a-z0-9]+\/$/);
  const [, , folder] = prefix.split('/');
  const inside = await fsp.readdir(path.join(s.HUB_LOCAL_DIR, 'bryan', 'data', folder));
  assert.equal(inside.length, 1); // the one upload stamp
});
