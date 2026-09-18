// Where an agent works. The drive is always a project; anything else is a
// directory the owner registered once in the settings panel. A conversation
// names its project by id and the runner resolves the path at turn start, so
// a project removed later fails the next turn plainly instead of silently
// running somewhere else.

import fsp from 'node:fs/promises';
import path from 'node:path';

export const DRIVE_PROJECT_ID = 'drive';

export const driveProject = (root) => ({ id: DRIVE_PROJECT_ID, name: 'Drive', path: root, builtIn: true });

const registered = (settings) => (Array.isArray(settings?.projects) ? settings.projects : [])
  .filter((p) => p && typeof p.id === 'string' && typeof p.path === 'string')
  .map((p) => ({ id: p.id, name: String(p.name || path.basename(p.path)), path: p.path, builtIn: false }));

export function listProjects({ settings, root }) {
  return [driveProject(root), ...registered(settings).sort((a, b) => a.name.localeCompare(b.name))];
}

export function findProject({ settings, root }, id) {
  if (id === undefined || id === null || id === '' || id === DRIVE_PROJECT_ID) return driveProject(root);
  return registered(settings).find((p) => p.id === id) ?? null;
}

const bad = (message) => Object.assign(new Error(message), { status: 400 });

const within = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The absolute, normalised path, or a 400 saying why not. */
export async function validateProjectPath(candidate, { root }) {
  const raw = String(candidate ?? '').trim();
  if (!raw || !path.isAbsolute(raw)) throw bad('a project path must be absolute');
  const resolved = path.resolve(raw);
  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    throw bad(`no directory at ${resolved}`);
  }
  if (!stat.isDirectory()) throw bad(`${resolved} is not a directory`);
  if (resolved === path.resolve(root)) throw bad('the drive is already a project');
  if (within(resolved, path.join(path.resolve(root), '.marble'))) throw bad('a project cannot live inside the drive\'s .marble');
  return resolved;
}
