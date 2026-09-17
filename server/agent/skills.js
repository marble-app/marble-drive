// Skills the composer `/` menu can name, and that a Claude turn can load from
// its workspace. They live on the machine (`~/.claude/skills`, this repo's
// `.claude/skills`, …), not in the drive — a skill is how the person talks to
// the agent, not a document.

import fsp from 'node:fs/promises';
import path from 'node:path';

const descriptionOf = (text) => {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return '';
  const line = /^description:\s*(.*)$/m.exec(block[1]);
  if (!line) return '';
  return line[1].trim().replace(/^['"]|['"]$/g, '');
};

export async function listSkills(dirs) {
  const found = [];
  const seen = new Set();
  for (const root of dirs) {
    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      if (seen.has(id)) continue;
      const file = path.join(root, id, 'SKILL.md');
      let text;
      try {
        text = await fsp.readFile(file, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      seen.add(id);
      found.push({ id, name: id, description: descriptionOf(text), dir: path.join(root, id) });
    }
  }
  return found;
}

export async function installSkills(workspace, skills, { into = path.join('.claude', 'skills') } = {}) {
  const destRoot = path.join(workspace, into);
  await fsp.mkdir(destRoot, { recursive: true });
  for (const skill of skills) {
    await fsp.cp(skill.dir, path.join(destRoot, skill.id), { recursive: true });
  }
}

export function skillDirs({ home = process.env.HOME, repo } = {}) {
  const dirs = [];
  if (home) {
    dirs.push(path.join(home, '.claude', 'skills'));
    dirs.push(path.join(home, '.agents', 'skills'));
  }
  if (repo) {
    dirs.push(path.join(repo, '.claude', 'skills'));
    dirs.push(path.join(repo, '.agents', 'skills'));
  }
  return dirs;
}
