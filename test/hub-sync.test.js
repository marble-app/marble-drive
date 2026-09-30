import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EXCLUDES, compare, down, looksWrong, rclone, rcloneEnv, readState, scan, trashPrefix, up } from '../server/hub/sync.js';

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

test('the passphrase and salt reach rclone obscure on stdin, never on argv', async () => {
  const calls = [];
  const run = async (args, env, opts = {}) => { calls.push({ args, input: opts.input }); return { stdout: 'obscured\n' }; };
  const s = { ...(await settings()), HUB_PASSPHRASE: '-starts-with-dash', HUB_SALT: '--salt' };
  const env = await rcloneEnv(s, run);
  assert.equal(env.RCLONE_CONFIG_HUB_PASSWORD, 'obscured');
  assert.deepEqual(calls.map((c) => c.args), [['obscure', '-'], ['obscure', '-']]);
  assert.deepEqual(calls.map((c) => c.input), ['-starts-with-dash', '--salt']);
});

test('a passphrase that starts with a dash round-trips through rclone', needsRclone, async () => {
  const s = { ...(await settings()), HUB_PASSPHRASE: '-p secret', HUB_SALT: '-s' };
  const env = await rcloneEnv(s);
  assert.equal((await rclone(['reveal', env.RCLONE_CONFIG_HUB_PASSWORD], {})).stdout.trim(), '-p secret');
  assert.equal((await rclone(['reveal', env.RCLONE_CONFIG_HUB_PASSWORD2], {})).stdout.trim(), '-s');
  const root = await fixture();
  assert.equal((await up({ root, settings: s, epoch: 0 })).ok, true);
});

// R2 (rclone's s3 backend) answers `cat` of a missing object with exit 0 and
// no output, where the local backend errors. Seen on the first real bucket.
test('an empty answer from the hub means no upload yet, as R2 gives it', async () => {
  const settings = { HUB_DRIVE: 'bryan', HUB_BACKEND: 'local', HUB_LOCAL_DIR: '/x' };
  assert.equal(await readState({ settings, env: {}, run: async () => ({ stdout: '', stderr: '' }) }), null);
  assert.equal(await readState({ settings, env: {}, run: async () => ({ stdout: ' \n', stderr: '' }) }), null);
  assert.deepEqual(await readState({ settings, env: {}, run: async () => ({ stdout: '{"seq":3}', stderr: '' }) }), { seq: 3 });
});

// ------------------------------------------------------------ the file list
// R2 answers each request in up to seconds, and a plain sync asks once per
// file, so the hub keeps an encrypted list of what it holds (hub:manifest.json)
// and each side moves only what differs from it.

/** rclone, counting which subcommands were run. */
function counting(after = async () => {}) {
  const calls = [];
  const run = async (args, env, opts) => {
    calls.push(args[0]);
    const out = await rclone(args, env, opts);
    await after(args);
    return out;
  };
  const moves = () => calls.filter((c) => c === 'copy' || c === 'move' || c === 'sync' || c === 'copyto' || c === 'moveto');
  return { run, calls, moves };
}
const shown = (t) => Object.fromEntries(Object.entries(t).filter(([rel]) => !rel.startsWith('.marble/agents/') && !rel.startsWith('.marble/usage/') && !rel.startsWith('.marble/console/')));
const hubCat = async (s, target) => (await rclone(['cat', target], await rcloneEnv(s))).stdout;

test('scan also lists each file with its size and mtime', async () => {
  const root = await fixture();
  await fsp.utimes(path.join(root, 'notes.mrbl'), 1_700_000_000.25, 1_700_000_000.25);
  const { byPath } = await scan(root);
  assert.deepEqual(Object.keys(byPath).sort(), [".marble/notes.history.jsonl", "Bryan's Days/Café — today.mrbl", "Design Don'ts.mrbl", 'notes.mrbl']);
  assert.deepEqual(byPath['notes.mrbl'], [18, 1_700_000_000_250]);
});

test('compare: what differs, what is extra, and a 1 ms tolerance on mtimes', () => {
  const want = { a: [1, 1000], b: [2, 2000], c: [3, 3000], d: [4, 4000] };
  const have = { a: [1, 1000], b: [2, 2001], c: [3, 3002], e: [5, 5000], '.marble/agents/host.lock': [1, 1] };
  assert.deepEqual(compare(want, have), { differ: ['c', 'd'], extra: ['e'] });
  assert.deepEqual(compare({ a: [1, 1000] }, { a: [2, 1000] }), { differ: ['a'], extra: [] });
  assert.deepEqual(compare({ a: [1, 1000] }, { a: [1, 1000] }), { differ: [], extra: [] });
});

test('an upload with nothing changed moves nothing, and still counts on', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0 });
  const c = counting();
  const second = await up({ root, settings: s, epoch: 0, run: c.run });
  assert.equal(second.ok, true);
  assert.equal(second.state.seq, 2);
  assert.equal(second.changed, 0);
  assert.equal(second.deleted, 0);
  assert.deepEqual(c.moves(), []);
  assert.equal(JSON.parse(await hubCat(s, 'hub:manifest.json')).seq, 2);
});

test('a changed, a new and a deleted file each reach the hub; the old versions go to its trash', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0, now: at('2026-09-30T10:00:00Z') });
  await put(root, 'notes.mrbl', '<html>notes, edited</html>');
  await put(root, 'Ideas/new one.mrbl', '<html>new</html>');
  await put(root, '#tag.mrbl', '<html>hash</html>'); // a line --files-from would read as a comment
  await put(root, ' lead.mrbl', '<html>lead</html>'); // and one it would trim
  await fsp.rm(path.join(root, "Design Don'ts.mrbl"));
  const c = counting();
  const second = await up({ root, settings: s, epoch: 0, run: c.run, now: at('2026-09-30T12:00:00Z') });
  assert.equal(second.ok, true);
  assert.equal(second.changed, 4);
  assert.equal(second.deleted, 1);
  assert.deepEqual(c.moves().sort(), ['copy', 'move']);

  const other = await tmp('other');
  const back = await down({ root: other, settings: s, trashRoot: await tmp('trash') });
  assert.equal(back.matches, true);
  assert.deepEqual(await tree(other), shown(await tree(root)));
  assert.equal(await hubCat(s, 'hub:trash/20260930T120000Z/notes.mrbl'), '<html>notes</html>');
  assert.equal(await hubCat(s, "hub:trash/20260930T120000Z/Design Don'ts.mrbl"), '<html>donts</html>');
});

test('a file replaced by an older copy of different content still uploads', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0 });
  await put(root, 'notes.mrbl', '<html>NOTES</html>'); // the same size
  await fsp.utimes(path.join(root, 'notes.mrbl'), new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
  const second = await up({ root, settings: s, epoch: 0 });
  assert.equal(second.changed, 1);
  const other = await tmp('other');
  await down({ root: other, settings: s, trashRoot: await tmp('trash') });
  assert.equal((await tree(other))['notes.mrbl'], '<html>NOTES</html>');
});

test('a download into a drive that holds most of it fetches only what differs, and sets extras aside', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0 });
  const here = await tmp('here');
  const trashRoot = await tmp('trash');
  await down({ root: here, settings: s, trashRoot, now: at('2026-09-30T10:00:00Z') });
  await put(here, 'notes.mrbl', '<html>changed here</html>');
  await fsp.rm(path.join(here, "Design Don'ts.mrbl"));
  await put(here, 'Stray/stray.mrbl', '<html>stray</html>');
  await put(here, '.marble/agents/host.lock', 'mine\n');

  const c = counting();
  const back = await down({ root: here, settings: s, trashRoot, run: c.run, now: at('2026-09-30T11:00:00Z') });
  assert.equal(back.ok, true);
  assert.equal(back.fetched, 2);
  assert.equal(back.removed, 1);
  assert.equal(back.matches, true);
  assert.deepEqual(c.moves(), ['copy']);
  const after = await tree(here);
  assert.deepEqual(shown(after), shown(await tree(root)));
  assert.equal(after['.marble/agents/host.lock'], 'mine\n');
  assert.deepEqual(await tree(path.join(trashRoot, '20260930T110000Z')), {
    'notes.mrbl': '<html>changed here</html>',
    'Stray/stray.mrbl': '<html>stray</html>',
  });
});

test('a hub uploaded before the file list still downloads, by a full sync', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0 });
  await rclone(['deletefile', 'hub:manifest.json'], await rcloneEnv(s));
  const c = counting();
  const other = await tmp('other');
  const back = await down({ root: other, settings: s, trashRoot: await tmp('trash'), run: c.run });
  assert.equal(back.ok, true);
  assert.equal(back.matches, true);
  assert.deepEqual(c.moves(), ['sync']);
  assert.deepEqual(await tree(other), shown(await tree(root)));
  // and the next upload writes the list again
  const again = await up({ root, settings: s, epoch: 0 });
  assert.equal(again.ok, true);
  assert.equal(JSON.parse(await hubCat(s, 'hub:manifest.json')).seq, 2);
});

test('a download says it does not match when a file differs afterwards', needsRclone, async () => {
  const s = await settings();
  const root = await fixture();
  await up({ root, settings: s, epoch: 0 });
  const other = await tmp('other');
  const c = counting(async (args) => {
    if (args[0] === 'copy') await put(other, 'notes.mrbl', '<html>tampered with</html>');
  });
  const back = await down({ root: other, settings: s, trashRoot: await tmp('trash'), run: c.run });
  assert.equal(back.ok, true);
  assert.equal(back.matches, false);
});
