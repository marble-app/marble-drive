// What a brand new drive has in it.
//
// Exactly one document, and it is the Drive itself. Not because a drive should
// arrive full, but because the alternative is a host that serves a folder with
// nothing in it and an address that 404s — and because the Drive being an
// ordinary document in the drive is the claim this whole repo is making. You
// can rename it, edit it, or throw it away; the host falls back to whatever
// else is there.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeScript } from './gallery.js';
import { titleize } from './paths.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const newId = () => Math.random().toString(36).slice(2, 10);

/** The Drive document, composed the same way a starter is: markup from this
 *  repo, affordances from the Marble package, ids minted at build time. */
export async function buildDrive({ name = 'drive', title = 'My Drive' } = {}) {
  const [template, script] = await Promise.all([
    fsp.readFile(path.join(REPO, 'templates', 'drive.mrbl'), 'utf8'),
    composeScript(['editable', 'sortable', 'removable', 'status']),
  ]);

  return template
    .replaceAll('__TITLE__', title || titleize(name))
    .replace(/__ID__/g, () => newId())
    .replace('__SCRIPT__', `<script>\n${script}\n</script>`);
}

/** Written only if it is not there. A drive that rewrote its own Drive on every
 *  boot would be a drive you cannot change. */
export async function seedDrive(store, { name = 'drive', title = 'My Drive' } = {}) {
  if (await store.has(name)) return { seeded: false, path: name };
  await store.write(name, await buildDrive({ name, title }), { label: 'seeded' });
  return { seeded: true, path: name };
}
