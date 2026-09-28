// The app pages this repo ships, every version of each, and how a version is
// built into a document. Read by server/app-updates.js to bring a drive's own
// copies forward, and written by tools/app-lineage.mjs from git.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { link as iconLink } from './favicon.js';
import { STARTERS, composeScript } from './gallery.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LINEAGE_DIR = 'templates/lineage';

/**
 * Every app page a drive holds a copy of. `seeded` is the path the host writes
 * it at in a new drive (a function of the config for the Drive, whose name is
 * configurable); `derived` means documents people make from the starter are
 * brought forward too, wherever they are.
 */
export const APPS = [
  { id: 'drive', source: 'templates/drive.mrbl', icon: 'drive', parts: ['editable', 'sortable', 'removable', 'status'], seeded: (config) => config.home },
  { id: 'agents', source: 'templates/agents.mrbl', icon: 'doc', seeded: () => 'Agents' },
  { id: 'console', source: 'templates/console.mrbl', icon: 'doc', seeded: (config) => (config.console ? 'Console' : null) },
  { id: 'chat', source: 'starters/chat.mrbl', icon: 'doc', starter: 'chat', seeded: () => 'Chat', derived: true },
  { id: 'whiteboard', source: 'starters/whiteboard.mrbl', icon: 'doc', starter: 'whiteboard', seeded: () => 'Board', derived: true },
  { id: 'design-system', source: 'templates/design-system.mrbl', icon: 'doc', seeded: () => 'Design System' },
  { id: 'note', source: 'starters/note.mrbl', icon: 'doc', starter: 'note', derived: true },
];

export const appById = (id) => APPS.find((app) => app.id === id) ?? null;

/** A version's name: its bytes, not its commit, so a revert is the same version. */
export const versionId = (source) => crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);

const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

/** The affordance script an app carries, from the Marble package this release has. */
const scripts = new Map();
async function scriptFor(app) {
  const parts = app.parts ?? STARTERS.find((s) => s.id === app.starter)?.parts;
  if (!parts) return null;
  const key = parts.join(',');
  if (!scripts.has(key)) scripts.set(key, composeScript(parts));
  return scripts.get(key);
}

/**
 * One version of an app, built the way the host builds it for a new drive:
 * the title, the mark, a fresh id for every slot, the affordance script.
 * `title` goes in verbatim — for bringing a document forward it is the
 * document's own, so the lines that carry it match.
 */
export async function buildApp(app, source, { title, id = newId } = {}) {
  const script = await scriptFor(app);
  let out = source
    .replaceAll('__TITLE__', () => title)
    .replace('__ICON__', () => iconLink(app.icon))
    .replace(/__ID__/g, () => id());
  if (script !== null) out = out.replace('__SCRIPT__', () => `<script>\n${script}\n</script>`);
  return out;
}

/** Today's source of an app, or null where this release does not have it. */
export function currentSource(app) {
  try {
    return fs.readFileSync(path.join(REPO, app.source), 'utf8');
  } catch {
    return null;
  }
}

const lineages = new Map();
/** Every version of an app, oldest first, the last being today's. */
export function lineage(app) {
  if (lineages.has(app.id)) return lineages.get(app.id);
  let versions = [];
  try {
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(REPO, LINEAGE_DIR, `${app.id}.json.gz`))));
    versions = raw.versions.map((v) => ({ id: v.id, date: v.date, source: v.lines.map((i) => raw.lines[i]).join('') }));
  } catch {
    versions = [];
  }
  // Today's source is always a version, even if the lineage was not rewritten.
  const current = currentSource(app);
  if (current !== null && versions.at(-1)?.id !== versionId(current)) {
    versions = versions.filter((v) => v.id !== versionId(current));
    versions.push({ id: versionId(current), date: null, source: current });
  }
  lineages.set(app.id, versions);
  return versions;
}
