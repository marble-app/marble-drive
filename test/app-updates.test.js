import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appById, buildApp, lineage } from '../server/app-lineage.js';
import { planCopy, readManifest, updateApps } from '../server/app-updates.js';
import { createStore } from '../server/store/index.js';

const drive = appById('drive');
const config = { home: 'drive', console: false };
const quiet = { log() {} };

async function tempDrive() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'app-updates-'));
  return { root, store: createStore({ root }) };
}

/** A Drive as a person has it after living in it: seeded from an older
 *  template, then a pin added, a heading renamed and the view switched — the
 *  kinds of edit the page files as ops. */
async function livedInDrive(version) {
  let source = await buildApp(drive, version.source, { title: 'My Drive' });
  source = source.replace(/(<body class="drive" data-marble-id="[^"]+") data-view="grid"/, '$1 data-view="list"');
  source = source.replace(/(<h2 data-marble-id="[^"]+" data-marble-editable>)Pinned(<\/h2>)/, '$1Favourites$2');
  source = source.replace(
    /(<ul class="pins" id="pins" data-marble-id="[^"]+" data-marble-sortable="pins">\n)/,
    '$1      <li class="pin" data-marble-id="mypin001" data-href="/a/Plans"><span data-marble-id="mypin002" data-marble-editable>Plans</span></li>\n',
  );
  return source;
}

const versions = lineage(drive);
const target = versions.at(-1);
// The newest version before today's that differs from it: what a drive seeded
// a release ago carries.
const previous = [...versions].reverse().find((v) => v.id !== target.id && v.date);

test('the lineage has today’s Drive as its last version', () => {
  assert.ok(versions.length > 1);
  assert.ok(previous, 'an older version of the Drive to update from');
});

test('a lived-in Drive from an older release comes forward and keeps what its owner did', async () => {
  const { store } = await tempDrive();
  const ours = await livedInDrive(previous);
  await store.write('drive', ours, { label: 'seeded' });

  const report = await updateApps({ store, config, log: quiet });
  const line = report.find((r) => r.path === 'drive');
  assert.equal(line.status, 'update', JSON.stringify(line));
  assert.equal(line.from, previous.id);
  assert.equal(line.to, target.id);

  const after = await store.read('drive');
  assert.ok(/data-marble-id="mypin001"/.test(after), 'the pin they added');
  assert.ok(/>Favourites<\/h2>/.test(after), 'the heading they renamed');
  assert.ok(/<body class="drive" data-marble-id="[^"]+" data-view="list"/.test(after), 'the view they chose');

  // Every line of today's template that carries no id or title is in the result.
  const fresh = (await buildApp(drive, target.source, { title: 'My Drive' })).split('\n');
  const have = new Set(after.split('\n'));
  const missing = fresh.filter((l) => !/data-marble-id|My Drive|<link rel="icon"/.test(l) && !have.has(l));
  assert.ok(missing.length <= 3, `today's template lines missing from the update:\n${missing.slice(0, 5).join('\n')}`);

  // Ids stay unique.
  const ids = [...after.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);

  // The copy before the update is a restore point.
  const history = await store.history('drive');
  assert.ok(history.some((h) => h.label === 'app-update'));

  const manifest = await readManifest(store.marbleDir);
  assert.equal(manifest.docs.drive.version, target.id);

  // A second start has nothing to do.
  const again = await updateApps({ store, config, log: quiet });
  assert.equal(again.filter((r) => r.path === 'drive').length, 0);
  assert.equal(await store.read('drive'), after);
});

test('a Drive its owner rebuilt is left exactly as it is, and not retried', async () => {
  const { store } = await tempDrive();
  const built = await buildApp(drive, previous.source, { title: 'My Drive' });
  // Half the page rewritten by hand.
  const lines = built.split('\n');
  const rebuilt = lines.map((l, i) => (i % 2 && !l.includes('data-marble-id') ? `${l} /* mine */` : l)).join('\n');
  await store.write('drive', rebuilt, { label: 'seeded' });

  const [line] = await updateApps({ store, config, log: quiet });
  assert.equal(line.status, 'held');
  assert.equal(line.reason, 'customized');
  assert.equal(await store.read('drive'), rebuilt);
  const [again] = await updateApps({ store, config, log: quiet });
  assert.equal(again.again, true);
});

test('where the owner and the template changed the same lines, nothing is written', async () => {
  const base = await buildApp(drive, previous.source, { title: 'My Drive' });
  const theirs = target.source.split('\n');
  const old = previous.source.split('\n');
  // A line today's template changed, changed by the owner too.
  const changed = old.find((l) => l.length > 30 && !l.includes('__') && !theirs.includes(l));
  assert.ok(changed, 'a line the template has since changed');
  const ours = base.replace(changed, `${changed} /* the owner's version */`);
  const plan = await planCopy(drive, ours, { known: previous.id });
  assert.equal(plan.status, 'held');
  assert.equal(plan.reason, 'conflicts');
});

test('a note made from an older starter picks up the starter’s fixes and keeps its writing', async (t) => {
  const note = appById('note');
  const notes = lineage(note);
  const older = [...notes].reverse().find((v) => v.id !== notes.at(-1).id && v.date);
  if (!older) return t.skip('only one version of the Note starter');
  const { store } = await tempDrive();
  let source = await buildApp(note, notes.at(-2).source, { title: 'Trip' });
  const writing = 'Pack the tent and the good stove.';
  source = source.replace(/(<\/h1>|<\/p>)/, `$1\n<p data-marble-id="mynote01">${writing}</p>`);
  await store.write('Trip', source, { label: 'created' });

  const report = await updateApps({ store, config, log: quiet });
  const line = report.find((r) => r.path === 'Trip');
  assert.ok(line, 'the note is recognised as made from the starter');
  if (line.status === 'held') return t.skip(`held: ${line.reason}`);
  assert.equal(line.status, 'update');
  const after = await store.read('Trip');
  assert.ok(after.includes(writing));
});

test('nothing is written on a dry run', async () => {
  const { store } = await tempDrive();
  const ours = await livedInDrive(previous);
  await store.write('drive', ours, { label: 'seeded' });
  const [line] = await updateApps({ store, config, log: quiet, dryRun: true });
  assert.equal(line.status, 'update');
  assert.equal(await store.read('drive'), ours);
  assert.deepEqual(await readManifest(store.marbleDir), { seeded: {}, docs: {} });
});

test('an app seeded once is not seeded again after its owner moves it', async () => {
  const { seedConsole } = await import('../server/seed.js');
  const { store } = await tempDrive();
  assert.equal((await seedConsole(store)).seeded, true);
  const manifest = await readManifest(store.marbleDir);
  assert.equal(manifest.seeded.console, 'Console');
  assert.ok(manifest.docs.Console.version, 'the version it was built from');
  await store.move('Console', 'Admin/Console');
  assert.equal((await seedConsole(store)).seeded, false);
  assert.equal(await store.has('Console'), false, 'no second Console at the top');
});

test('a drive from before the manifest keeps what it has and is not seeded twice', async () => {
  const { seedChat } = await import('../server/seed.js');
  const { store } = await tempDrive();
  await store.write('Chat', '<!doctype html><title>Mine</title>', { label: 'created' });
  assert.equal((await seedChat(store)).seeded, false);
  assert.equal(await store.read('Chat'), '<!doctype html><title>Mine</title>');
  assert.equal((await readManifest(store.marbleDir)).seeded.chat, 'Chat');
});
