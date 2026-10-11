// The Projects page: seeded once beside Agents, its file holds only the
// owner's projects, and the host injects its views into it and nowhere else.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { seedProjects } from '../server/seed.js';

const host = async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-projects-'));
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root }), { log: { log() {}, error() {} }, agents: false });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  return { drive, base: `http://127.0.0.1:${port}`, close: () => drive.close() };
};

test('Projects is seeded once, with no projects, a morning run and unique ids', async (t) => {
  const h = await host();
  t.after(() => h.close());
  const first = await seedProjects(h.drive.store);
  assert.equal(first.seeded, true);
  assert.equal(first.path, 'Projects');
  const source = await h.drive.store.read('Projects');
  assert.doesNotMatch(source, /__(ID|TITLE|ICON|SCRIPT)__/);
  assert.match(source, /<meta name="marble-projects"/);
  assert.doesNotMatch(source, /<article/, 'a new drive starts with no projects');
  // The morning run is aimed at the list it updates, and can be paused.
  assert.match(source, /data-marble-run="[^"]+" data-marble-scope="prj-list" data-marble-on="daily 07:00"/);
  assert.match(source, /data-marble-pause="prj-run"/);
  const ids = [...source.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'every id is its own');

  const edited = source.replace('class="prj-list"></div>', 'class="prj-list"><article data-marble-id="p1" class="project"></article></div>');
  await h.drive.store.write('Projects', edited, { label: 'edit' });
  const second = await seedProjects(h.drive.store);
  assert.equal(second.seeded, false);
  assert.match(await h.drive.store.read('Projects'), /data-marble-id="p1"/);
});

test('the Projects page gets its views; no other document does', async (t) => {
  const h = await host();
  t.after(() => h.close());
  await seedProjects(h.drive.store);
  const page = await (await fetch(`${h.base}/a/Projects`)).text();
  assert.match(page, /\/runtime\/projects\.js/);
  assert.match(page, /\/runtime\/projects\.css/);
  await h.drive.createDocument('plain', '<!doctype html><html><body data-marble-id="b"><p data-marble-id="p">x</p></body></html>', { label: 't' });
  assert.doesNotMatch(await (await fetch(`${h.base}/a/plain`)).text(), /projects\.js/);
  const css = await fetch(`${h.base}/runtime/projects.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await fetch(`${h.base}/runtime/projects.js`);
  assert.equal(js.status, 200);
});
