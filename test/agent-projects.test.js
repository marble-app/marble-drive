import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DRIVE_PROJECT_ID, driveProject, findProject, listProjects, validateProjectPath, mapProjectPath, parsePrefixes } from '../server/agent/projects.js';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-projects-root-'));
await fsp.mkdir(path.join(ROOT, '.marble'), { recursive: true });
const REPO = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-projects-repo-'));

test('the drive is always the first project and cannot be replaced', () => {
  const settings = { projects: [{ id: 'aabbccddeeff', name: 'Repo', path: REPO }] };
  const list = listProjects({ settings, root: ROOT });
  assert.equal(list[0].id, DRIVE_PROJECT_ID);
  assert.equal(list[0].path, ROOT);
  assert.equal(list[0].builtIn, true);
  assert.equal(list[1].name, 'Repo');
  assert.deepEqual(driveProject(ROOT), { id: 'drive', name: 'Drive', path: ROOT, builtIn: true });
});

test('findProject answers the drive, a registered id, and null', () => {
  const settings = { projects: [{ id: 'aabbccddeeff', name: 'Repo', path: REPO }] };
  assert.equal(findProject({ settings, root: ROOT }, 'drive').path, ROOT);
  assert.equal(findProject({ settings, root: ROOT }, 'aabbccddeeff').name, 'Repo');
  assert.equal(findProject({ settings, root: ROOT }, 'nope'), null);
  assert.equal(findProject({ settings, root: ROOT }, undefined).id, 'drive', 'no id means the drive');
});

test('a project path must be absolute, exist, be a directory, and not be the drive or its .marble', async () => {
  assert.equal(await validateProjectPath(REPO, { root: ROOT }), REPO);
  await assert.rejects(validateProjectPath('relative/dir', { root: ROOT }), { status: 400 });
  await assert.rejects(validateProjectPath(path.join(REPO, 'missing'), { root: ROOT }), { status: 400 });
  const file = path.join(REPO, 'file.txt');
  await fsp.writeFile(file, 'x');
  await assert.rejects(validateProjectPath(file, { root: ROOT }), { status: 400 });
  await assert.rejects(validateProjectPath(ROOT, { root: ROOT }), { status: 400 });
  await assert.rejects(validateProjectPath(path.join(ROOT, '.marble'), { root: ROOT }), { status: 400 });
  assert.equal(await validateProjectPath(`${REPO}/`, { root: ROOT }), REPO, 'a trailing slash is normalised away');
});

test('another machine\'s project paths are read as this one\'s', () => {
  const prefixes = parsePrefixes('/home/sprite/src=/Users/b/Dev/3rd,/x=/y');
  assert.deepEqual(prefixes, [['/home/sprite/src', '/Users/b/Dev/3rd'], ['/x', '/y']]);
  assert.equal(mapProjectPath('/home/sprite/src/marble-drive', prefixes), '/Users/b/Dev/3rd/marble-drive');
  assert.equal(mapProjectPath('/home/sprite/src', prefixes), '/Users/b/Dev/3rd');
  assert.equal(mapProjectPath('/home/sprite/srcx', prefixes), '/home/sprite/srcx');
  assert.equal(mapProjectPath('/elsewhere', prefixes), '/elsewhere');
  assert.deepEqual(parsePrefixes(''), []);
});

test('listProjects maps paths through MARBLE_PROJECT_PREFIXES', () => {
  const before = process.env.MARBLE_PROJECT_PREFIXES;
  process.env.MARBLE_PROJECT_PREFIXES = '/home/sprite/src=/Users/b/src';
  try {
    const list = listProjects({ settings: { projects: [{ id: 'md', name: 'MD', path: '/home/sprite/src/marble-drive' }] }, root: '/drive' });
    assert.equal(list.find((p) => p.id === 'md').path, '/Users/b/src/marble-drive');
  } finally {
    if (before === undefined) delete process.env.MARBLE_PROJECT_PREFIXES;
    else process.env.MARBLE_PROJECT_PREFIXES = before;
  }
});
