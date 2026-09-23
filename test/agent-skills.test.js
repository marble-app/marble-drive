import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fileURLToPath } from 'node:url';

import { PLUGIN_DIR, listSkills, skillDirs } from '../server/agent/skills.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const skillDir = async (root, name, body) => {
  const dir = path.join(root, name);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'SKILL.md'), body);
  return dir;
};

test('listSkills reads name and description from each SKILL.md, and skips folders without one', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-skills-'));
  await skillDir(root, 'my-day', '---\nname: my-day\ndescription: Compose the day\n---\n\nDo the day.\n');
  await skillDir(root, 'empty-name', 'just a body, no frontmatter\n');
  await fsp.mkdir(path.join(root, 'not-a-skill'));
  const listed = await listSkills([root]);
  assert.equal(listed.length, 2);
  assert.equal(listed.find((s) => s.id === 'my-day').description, 'Compose the day');
  assert.equal(listed.find((s) => s.id === 'empty-name').description, '');
});

test('the app ships growing-the-open-page in its plugin, so every agent turn can load it', async () => {
  const listed = await listSkills([{ dir: path.join(PLUGIN_DIR, 'skills'), prefix: 'marble-drive:' }]);
  const grow = listed.find((s) => s.id === 'marble-drive:growing-the-open-page');
  assert.ok(grow, 'agent-plugin/skills/growing-the-open-page must exist');
  assert.match(grow.description, /^Use when /);
  const body = await fsp.readFile(path.join(grow.dir, 'SKILL.md'), 'utf8');
  assert.match(body, /read_guide/);
  assert.match(body, /Growing the open page/);
  assert.match(body, /stages/);
  assert.doesNotMatch(body, /under construction/i);
});


// The app's own skills travel with the app, as a plugin every full turn loads;
// the person's own come from their drive. The repository's .claude/skills is for
// developing the app and is never offered to a drive.
test('skills come from the drive, the app\'s plugin and the person\'s home, never the repository', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-skill-drive-'));
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-skill-home-'));
  const dirs = skillDirs({ home, root, plugin: PLUGIN_DIR });
  const where = dirs.map((d) => (typeof d === 'string' ? d : d.dir));
  assert.deepEqual(where, [
    path.join(root, '.claude', 'skills'),
    path.join(root, '.agents', 'skills'),
    path.join(PLUGIN_DIR, 'skills'),
    path.join(home, '.claude', 'skills'),
    path.join(home, '.agents', 'skills'),
  ]);
  assert.ok(!where.some((d) => d.startsWith(path.join(REPO, '.claude')) || d.startsWith(path.join(REPO, '.agents'))));

  await skillDir(path.join(root, '.claude', 'skills'), 'mine', '---\nname: mine\ndescription: The person\'s own\n---\n');
  const ids = (await listSkills(dirs)).map((s) => s.id).sort();
  assert.deepEqual(ids, [
    'marble-drive:genui-author',
    'marble-drive:growing-the-open-page',
    'marble-drive:typesafe-ai',
    'marble-drive:visuals-in-chat',
    'mine',
  ]);
});

test('the plugin says who it is', async () => {
  const manifest = JSON.parse(await fsp.readFile(path.join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'marble-drive');
  assert.equal(PLUGIN_DIR, path.join(REPO, 'agent-plugin'));
});
