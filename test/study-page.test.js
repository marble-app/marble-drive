// The Study page: a drive in the probe study (MARBLE_STUDY=1) is given a page
// called "Taking part in the study", once, saying what is recorded, what is
// never recorded, what the host sees, where things are kept, where prompts go
// and how to leave. A page its person changed or deleted stays as they left
// it, and a drive outside the study never has one.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createStore } = await import('../server/store/index.js');
const { readManifest } = await import('../server/app-updates.js');
const { buildStudy, seedStartHere, seedStudy, STUDY_PAGE } = await import('../server/seed.js');
const { madeDocs } = await import('../server/health-deep.js');
const { examine } = await import('../server/engine.js');

const made = [];
test.after(async () => {
  for (const dir of made) await fsp.rm(dir, { recursive: true, force: true });
});
const fresh = async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-study-page-'));
  made.push(root);
  const store = createStore({ root });
  await store.ready();
  return { root, store };
};
const STUDY = { study: true, host: 'Bryan', publicUrl: 'https://ana.marbledrive.app' };
const visible = (source) => source.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('a study drive gets the page, at its top, saying what the study records and how to leave', async () => {
  const { store } = await fresh();
  assert.deepEqual(await seedStudy(store, STUDY), { seeded: true, path: 'Taking part in the study' });
  assert.equal(STUDY_PAGE, 'Taking part in the study');
  const source = await store.read(STUDY_PAGE);
  assert.match(source, /<title>Taking part in the study<\/title>/);
  assert.doesNotMatch(source, /__[A-Z_]+__/, 'every placeholder filled');
  const words = visible(source);
  for (const said of [
    'Bryan is studying how people make their own tools by asking an AI.',
    'What is recorded', 'the pages you open', 'what you ask the agent, and what it does to answer', 'what the agent makes',
    'What is never recorded', 'Your Claude or ChatGPT password.', 'Anything outside this drive.',
    'What Bryan sees', 'Counts and states, in Bryan’s Console', 'Never what you wrote.',
    'only when Bryan exports them for the study, and only while your consent is on file',
    'Where things are kept', 'Where your prompts go', 'goes to Anthropic or OpenAI under your account',
    'How to leave', 'choose Leave the study',
  ]) assert.ok(words.includes(said), `the page says "${said}"`);
  assert.match(source, /<a href="https:\/\/marbledrive\.app\/account" data-marble-id="st-leave-a">marbledrive\.app\/account<\/a>/);
  // Opens as a page to read, not in Build mode, and names no webfont.
  assert.match(source, /<meta name="marble-build" content="off">/);
  assert.doesNotMatch(source, /fonts\.googleapis|@import/);
  // Every element in it can be addressed, each by an id of its own.
  const body = source.slice(source.indexOf('<body'));
  const tags = [...body.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)];
  assert.ok(tags.length > 40);
  assert.deepEqual(tags.filter(([, , attrs]) => !/\sdata-marble-id="[^"]+"/.test(attrs)).map(([tag]) => tag), []);
  const ids = [...source.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(examine('Taking part in the study.mrbl', source).filter((f) => f.level === 'error'), []);
  // The host's own page about the study, not one the person made.
  assert.equal((await readManifest(store.marbleDir)).seeded.study, STUDY_PAGE);
  assert.equal(await madeDocs(store), 0);
});

test('written once: a page its person changed stays changed, and one they deleted stays gone', async () => {
  const { store } = await fresh();
  await seedStudy(store, STUDY);
  const theirs = (await store.read(STUDY_PAGE)).replace('How to leave', 'How to leave (I asked Bryan about this)');
  await store.write(STUDY_PAGE, theirs);
  assert.deepEqual(await seedStudy(store, STUDY), { seeded: false, path: STUDY_PAGE });
  assert.equal(await store.read(STUDY_PAGE), theirs);
  await store.trash(STUDY_PAGE);
  assert.deepEqual(await seedStudy(store, STUDY), { seeded: false, path: STUDY_PAGE });
  assert.equal(await store.has(STUDY_PAGE), false);
});

test('a drive outside the study never gets one, until it joins', async () => {
  const { store } = await fresh();
  for (let i = 0; i < 2; i += 1) assert.deepEqual(await seedStudy(store, { ...STUDY, study: false }), { seeded: false, path: null });
  assert.equal(await store.has(STUDY_PAGE), false);
  assert.ok(!Object.hasOwn((await readManifest(store.marbleDir)).seeded, 'study'), 'nothing remembered, so joining later still writes it');
  assert.equal((await seedStudy(store, STUDY)).seeded, true);
});

test('a new study drive still opens on Start here, and a lost manifest does not mean a second page', async () => {
  const { store } = await fresh();
  assert.equal((await seedStartHere(store)).seeded, true);
  assert.equal((await seedStudy(store, STUDY)).seeded, true);
  // .marble/apps.json gone: the page there is the one written before.
  await fsp.rm(path.join(store.marbleDir, 'apps.json'));
  const before = await store.read(STUDY_PAGE);
  assert.deepEqual(await seedStudy(store, STUDY), { seeded: false, path: STUDY_PAGE });
  assert.equal(await store.read(STUDY_PAGE), before);
});

test('who hosts the drive is named as the setting says, and only safely', async () => {
  const unnamed = visible(await buildStudy({}));
  assert.ok(unnamed.includes('The researcher is studying'));
  assert.ok(unnamed.includes('What the researcher sees'));
  assert.ok(!unnamed.includes('Bryan'));
  const odd = await buildStudy({ host: "Ana O'Brien", publicUrl: 'https://ana.example.org' });
  assert.ok(odd.includes('Ana O&#39;Brien is studying'));
  assert.match(odd, /href="https:\/\/example\.org\/account"/);
});

test('marble-drive serve writes it for a study drive and for no other', async () => {
  const serve = async (env) => {
    const { root } = await fresh();
    const free = http.createServer();
    await new Promise((resolve) => free.listen(0, '127.0.0.1', resolve));
    const port = String(free.address().port);
    await new Promise((resolve) => free.close(resolve));
    const child = spawn(process.execPath, ['bin/marble-drive.js', 'serve'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env, MARBLE_DRIVE_ROOT: root, PORT: port, HOST: '127.0.0.1', MARBLE_DRIVE_AGENTS: '0', MARBLE_DRIVE_APP_UPDATES: '0',
        MARBLE_DRIVE_SECRET: '', MARBLE_HUB_ENV: '', MARBLE_DRIVE_BACKUP_DIR: '', MARBLE_DRIVE_BACKUP_CMD: '', MARBLE_STUDY: '', ...env,
      },
      stdio: 'ignore',
    });
    try {
      let up = false;
      for (let i = 0; i < 100 && !up; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        up = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok, () => false);
      }
      assert.ok(up, 'the drive answered');
      return root;
    } finally {
      child.kill('SIGTERM');
    }
  };
  const study = await serve({ MARBLE_STUDY: '1', MARBLE_HOST_OWNER: 'Bryan', MARBLE_DRIVE_PUBLIC_URL: 'https://ana.marbledrive.app' });
  const page = await fsp.readFile(path.join(study, `${STUDY_PAGE}.mrbl`), 'utf8');
  assert.ok(visible(page).includes('What Bryan sees'));
  const plain = await serve({});
  await assert.rejects(fsp.access(path.join(plain, `${STUDY_PAGE}.mrbl`)));
  assert.ok(await fsp.access(path.join(plain, 'start-here.mrbl')).then(() => true), 'the plain drive was seeded as usual');
});
