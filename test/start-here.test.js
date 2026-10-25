// Start here: written first into a new drive and nowhere else, and opened by /
// until it is deleted or all four of its rows are ticked. The Drive stays
// one click away the whole time.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createStore } = await import('../server/store/index.js');
const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { readManifest } = await import('../server/app-updates.js');
const { seedAgents, seedBoard, seedChat, seedDesignDonts, seedDesignSystem, seedDrive, seedStartHere, START_HERE } = await import('../server/seed.js');
const { fromOwnPage, startHereDone } = await import('../server/start-here.js');

const fresh = async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-start-here-'));
  const store = createStore({ root });
  await store.ready();
  return { root, store };
};

/** Every seed, in the order `marble-drive serve` runs them. */
async function seedAll(store) {
  await seedStartHere(store);
  await seedDrive(store);
  await seedAgents(store);
  await seedChat(store);
  await seedBoard(store);
  await seedDesignSystem(store);
  await seedDesignDonts(store);
}

const tick = (source, step) => source.replace(new RegExp(`(data-step="${step}")`), '$1 data-done="yes"');

test('a new drive gets Start here first, with its four rows and what they need', async () => {
  const { store } = await fresh();
  const made = await seedStartHere(store);
  assert.deepEqual(made, { seeded: true, path: START_HERE });
  assert.equal(START_HERE, 'start-here');

  const source = await store.read(START_HERE);
  assert.match(source, /<title>Start here<\/title>/);
  assert.doesNotMatch(source, /__(ID|TITLE|ICON|SCRIPT)__/);
  // The four rows, in one list with its own id.
  assert.deepEqual([...source.matchAll(/<li[^>]*data-step="(\w+)"/g)].map((m) => m[1]), ['connect', 'write', 'ask', 'keep']);
  assert.match(source, /<ol class="steps" data-marble-id="sh-steps">/);
  // 1: an agent to connect, which opens the drive's connect sheet; Make it
  // waits for one and says why.
  assert.match(source, /<h2 data-marble-id="[^"]+">Connect Claude or ChatGPT<\/h2>/);
  assert.match(source, /data-marble-id="sh-connect-go">Connect</);
  assert.match(source, /new CustomEvent\('marble:connect-agent'/);
  assert.match(source, /Make it runs on your Claude or ChatGPT\. Connect one above first\./);
  // The agent is the agent: Claude or ChatGPT's, whichever is connected.
  assert.match(source, /Ask the agent to change this page/);
  assert.doesNotMatch(source.replace(/<script>[\s\S]*?<\/script>/g, ''), /Ask Claude|Claude makes/);
  // 2: a box to write in. 3: the key. 4: chips that choose, and Make it.
  assert.match(source, /data-marble-id="sh-box" data-marble-editable/);
  assert.match(source, /<kbd>⌘J<\/kbd> \(<kbd>Ctrl J<\/kbd> on Windows\)/);
  assert.match(source, /data-marble-choose="data-kind"/);
  for (const chip of ['A class', 'A trip', 'A research project', 'A reading list']) assert.match(source, new RegExp(`data-marble-value="${chip}"`));
  assert.match(source, /data-marble-run="Make this person's first document in their drive from what they wrote in the answer field/);
  assert.match(source, /data-marble-scope="sh-keep"/);
  assert.match(source, /data-marble-on="press">Make it</);
  assert.match(source, /When this page has done its job, delete it; nothing else needs it\./);
  // Composed like a starter: the affordances its markers need are in the file.
  assert.match(source, /const TRANSIENT = 'data-marble-transient';/);
  assert.match(source, /data-marble-choose/);
  // Opens as a page to use, not in Describe.
  assert.match(source, /<meta name="marble-build" content="off">/);
  // Names nobody: no owner, and no credit it may not have.
  assert.doesNotMatch(source, /Bryan/);
  assert.doesNotMatch(source.replace(/<script>[\s\S]*?<\/script>/g, ''), /starter credit/);
  // Unique ids, the fixed ones included.
  const markup = source.replace(/<script>[\s\S]*?<\/script>/g, '');
  const ids = [...markup.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  // Not finished: nothing is ticked yet.
  assert.equal(startHereDone(source), false);

  assert.equal((await readManifest(store.marbleDir)).seeded['start-here'], START_HERE);
  assert.equal((await seedStartHere(store)).seeded, false, 'once');
});

test('a drive that already has documents is not given Start here, then or later', async () => {
  const { store } = await fresh();
  await store.write('Notes', '<!doctype html><title>Notes</title>', { label: 'edit' });
  assert.deepEqual(await seedStartHere(store), { seeded: false, path: null });
  assert.equal(await store.has(START_HERE), false);
  assert.equal((await readManifest(store.marbleDir)).seeded['start-here'], null);

  // Nor a drive the host has seeded before, empty or not.
  const { root: emptied, store: seeded } = await fresh();
  await seedDrive(seeded);
  await fsp.rm(path.join(emptied, 'drive.mrbl'));
  assert.equal((await seedStartHere(seeded)).seeded, false);
  assert.equal(await seeded.has(START_HERE), false);
});

test('deleting Start here is final', async () => {
  const { root, store } = await fresh();
  await seedAll(store);
  await fsp.rm(path.join(root, `${START_HERE}.mrbl`));
  assert.equal((await seedStartHere(store)).seeded, false);
  assert.equal(await store.has(START_HERE), false);
});

test('a new drive keeps Design System and Design Don\'ts in System, and apps.json says where', async () => {
  const { store } = await fresh();
  await seedAll(store);
  assert.equal(await store.has('System/Design System'), true);
  assert.equal(await store.has("System/Design Don'ts"), true);
  assert.equal(await store.has('Design System'), false);
  assert.equal(await store.has("Design Don'ts"), false);
  const { seeded } = await readManifest(store.marbleDir);
  assert.equal(seeded['design-system'], 'System/Design System');
  assert.equal(seeded['design-donts'], "System/Design Don'ts");
  // The rest stay at the top.
  for (const top of ['drive', 'Agents', 'Chat', 'Board', START_HERE]) assert.equal(await store.has(top), true, top);
});

test('an existing drive keeps its design pages at the top and is not moved', async () => {
  const { store } = await fresh();
  // A drive seeded by an earlier release: the pages at the top, the manifest saying so.
  await store.write('drive', '<!doctype html><title>My Drive</title>', { label: 'seeded' });
  await store.write('Design System', '<!doctype html><title>Design system</title>', { label: 'seeded' });
  await store.write("Design Don'ts", "<!doctype html><title>Design don'ts</title>", { label: 'seeded' });
  await seedAll(store);
  assert.equal(await store.has('System/Design System'), false);
  assert.equal(await store.has("System/Design Don'ts"), false);
  const { seeded } = await readManifest(store.marbleDir);
  assert.equal(seeded['design-system'], 'Design System');
  assert.equal(seeded['design-donts'], "Design Don'ts");
  assert.equal(seeded['start-here'], null);
});

test('Start here is done when every row is ticked, or when it has no rows left', () => {
  const page = '<ol><li data-step="write" data-marble-id="a">1</li><li data-marble-id="b" data-step="ask">2</li><li data-step="keep" data-marble-id="c">3</li></ol>';
  assert.equal(startHereDone(page), false);
  assert.equal(startHereDone(tick(tick(page, 'write'), 'ask')), false);
  assert.equal(startHereDone(tick(tick(tick(page, 'write'), 'ask'), 'keep')), true);
  // The attribute can sit anywhere in the tag; an op appends it at the end.
  assert.equal(startHereDone(page.replace(/data-step="(\w+)" data-marble-id="(\w)"/g, 'data-step="$1" data-marble-id="$2" data-done="yes"').replace('data-marble-id="b" data-step="ask"', 'data-marble-id="b" data-step="ask" data-done="yes"')), true);
  assert.equal(startHereDone(page.replace('data-step="keep"', 'data-step="keep" data-done="no"')), false);
  assert.equal(startHereDone('<p>rewritten</p>'), true);
});

test('only a visit from one of the drive\'s own pages counts as going to the Drive on purpose', () => {
  const req = (referer) => ({ headers: { host: 'd.example', ...(referer ? { referer } : {}) } });
  assert.equal(fromOwnPage(req(null)), false);
  assert.equal(fromOwnPage(req('http://d.example/a/start-here')), true);
  assert.equal(fromOwnPage(req('http://d.example/gate?to=%2F')), false, 'the passphrase page is the way in');
  assert.equal(fromOwnPage(req('https://marbledrive.app/a/x')), false, 'another site');
  assert.equal(fromOwnPage(req('not a url')), false);
});

// ------------------------------------------------------------------ the / route

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-start-here-host-'));
const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root }), { log: { log() {}, error() {} }, agents: false });
await seedAll(drive.store);
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;
test.after(() => drive.close());

const landing = async (headers = {}) => {
  const res = await fetch(`${base}/`, { redirect: 'manual', headers });
  assert.equal(res.status, 302);
  return decodeURIComponent(res.headers.get('location'));
};

test('/ opens Start here on a new drive, and the Drive is still there', async () => {
  assert.equal(await landing(), `/a/${START_HERE}`);
  // The Drive's own address opens the Drive.
  const direct = await fetch(`${base}/a/drive`);
  assert.equal(direct.status, 200);
  // And going to / from a page of the drive (the shell's Drive button) is the Drive.
  assert.equal(await landing({ Referer: `${base}/a/${START_HERE}` }), '/a/drive');
  assert.equal(await landing({ Referer: `${base}/a/Chat` }), '/a/drive');
  // Arriving from the passphrase page is arriving.
  assert.equal(await landing({ Referer: `${base}/gate?to=%2F` }), `/a/${START_HERE}`);
});

test('/ goes back to the Drive once all four rows are ticked', async () => {
  const before = await drive.store.read(START_HERE);
  try {
    await drive.putDocument(START_HERE, tick(tick(tick(before, 'write'), 'ask'), 'keep'), { label: 'test' });
    assert.equal(await landing(), `/a/${START_HERE}`, 'three of four is not done: no agent is connected');
    await drive.putDocument(START_HERE, tick(tick(tick(tick(before, 'connect'), 'write'), 'ask'), 'keep'), { label: 'test' });
    assert.equal(await landing(), '/a/drive');
  } finally {
    await drive.putDocument(START_HERE, before, { label: 'test' });
  }
  assert.equal(await landing(), `/a/${START_HERE}`);
});

test('/ goes to the Drive once Start here is deleted', async () => {
  const before = await drive.store.read(START_HERE);
  await fsp.rm(path.join(root, `${START_HERE}.mrbl`));
  try {
    assert.equal(await landing(), '/a/drive');
  } finally {
    await drive.putDocument(START_HERE, before, { label: 'test' });
  }
});

test('a drive that was passed over never lands on a page called start-here', async () => {
  const other = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-start-here-old-'));
  const old = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: other }), { log: { log() {}, error() {} }, agents: false });
  try {
    await seedDrive(old.store);
    await seedStartHere(old.store);
    await old.store.write(START_HERE, '<!doctype html><title>Mine</title><ol><li data-step="x">mine</li></ol>', { label: 'edit' });
    const p = await new Promise((resolve) => old.server.listen(0, '127.0.0.1', () => resolve(old.server.address().port)));
    const res = await fetch(`http://127.0.0.1:${p}/`, { redirect: 'manual' });
    assert.equal(decodeURIComponent(res.headers.get('location')), '/a/drive');
  } finally {
    await old.close();
  }
});
