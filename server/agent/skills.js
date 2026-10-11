// Skills the composer `/` menu can name before a turn has reported the CLI's
// own list. Three places, three owners:
//
//   <drive>/.claude/skills, <drive>/.agents/skills   the person's own, which
//       travel with their drive and are never in this repository;
//   agent-plugin/skills                              the app's own, passed to
//       every full Claude turn with --plugin-dir, so they reach an agent
//       wherever the drive is (listed as `marble-drive:<name>`);
//   ~/.claude/skills, ~/.agents/skills               the machine's.
//
// The repository's own .claude/skills is for developing the app, and is never
// offered to a drive.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_NAME = 'marble-drive';
export const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'agent-plugin');

const descriptionOf = (text) => {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return '';
  const line = /^description:\s*(.*)$/m.exec(block[1]);
  if (!line) return '';
  return line[1].trim().replace(/^['"]|['"]$/g, '');
};

/** `dirs` are folders of skills, each a path or `{ dir, prefix }` — a plugin's
 *  skills are named with its prefix, the way the CLI names them. */
export async function listSkills(dirs) {
  const found = [];
  const seen = new Set();
  for (const where of dirs) {
    const root = typeof where === 'string' ? where : where.dir;
    const prefix = typeof where === 'string' ? '' : where.prefix ?? '';
    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = prefix + entry.name;
      if (seen.has(id)) continue;
      const file = path.join(root, entry.name, 'SKILL.md');
      let text;
      try {
        text = await fsp.readFile(file, 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      seen.add(id);
      found.push({ id, name: id, description: descriptionOf(text), dir: path.join(root, entry.name) });
    }
  }
  return found;
}

export function skillDirs({ home = process.env.HOME, root = null, plugin = PLUGIN_DIR } = {}) {
  const dirs = [];
  if (root) {
    dirs.push(path.join(root, '.claude', 'skills'));
    dirs.push(path.join(root, '.agents', 'skills'));
  }
  if (plugin) dirs.push({ dir: path.join(plugin, 'skills'), prefix: `${PLUGIN_NAME}:` });
  if (home) {
    dirs.push(path.join(home, '.claude', 'skills'));
    dirs.push(path.join(home, '.agents', 'skills'));
  }
  return dirs;
}
