import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fileURLToPath } from 'node:url';

import { installSkills, listSkills } from '../server/agent/skills.js';

const REPO_AGENT_SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.agents', 'skills');

const skillDir = async (root, name, body) => {
  const dir = path.join(root, name);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'SKILL.md'), body);
  return dir;
};

test('listSkills reads name and description from each SKILL.md, and skips folders without one', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-skills-'));
  await skillDir(root, 'my-day', '---\nname: my-day\ndescription: Compose Bryan\'s Days\n---\n\nDo the day.\n');
  await skillDir(root, 'empty-name', 'just a body, no frontmatter\n');
  await fsp.mkdir(path.join(root, 'not-a-skill'));
  const listed = await listSkills([root]);
  assert.equal(listed.length, 2);
  assert.equal(listed.find((s) => s.id === 'my-day').description, "Compose Bryan's Days");
  assert.equal(listed.find((s) => s.id === 'empty-name').description, '');
});

test('the drive ships growing-the-open-page so every agent workspace can load it', async () => {
  const listed = await listSkills([REPO_AGENT_SKILLS]);
  const grow = listed.find((s) => s.id === 'growing-the-open-page');
  assert.ok(grow, 'repo .agents/skills/growing-the-open-page must exist');
  assert.match(grow.description, /^Use when /);
  const body = await fsp.readFile(path.join(grow.dir, 'SKILL.md'), 'utf8');
  assert.match(body, /read_guide/);
  assert.match(body, /Growing the open page/);
  assert.doesNotMatch(body, /under construction/i);
});

test('installSkills copies each skill into the conversation workspace', async () => {
  const src = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-skills-src-'));
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-skills-ws-'));
  await skillDir(src, 'my-day', '---\nname: my-day\ndescription: day\n---\nbody\n');
  const skills = await listSkills([src]);
  await installSkills(workspace, skills);
  const copied = path.join(workspace, '.claude', 'skills', 'my-day', 'SKILL.md');
  assert.match(await fsp.readFile(copied, 'utf8'), /body/);
});
