// What a brand new drive has in it after the host seeds it.
//
// The Drive document, the Agents library, the Chat app, the Board and the
// Design System — each written once, the first time the host sees the drive
// without it.
// Not because a drive should arrive full, but because the alternative is a host
// that serves a folder with nothing in it and an address that 404s — and because
// the Drive being an ordinary document in the drive is the claim this whole repo
// is making. You can rename either, edit it, or throw it away; the host falls
// back to whatever else is there.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appById, currentSource, versionId } from './app-lineage.js';
import { readManifest, writeManifest } from './app-updates.js';
import { link as iconLink } from './favicon.js';
import { build as buildStarter, composeScript, STARTERS } from './gallery.js';
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
    // The Drive wears the tiled mark, because in a tab strip it is the one page
    // here that is the interface rather than something the interface holds.
    .replace('__ICON__', () => iconLink('drive'))
    .replace(/__ID__/g, () => newId())
    .replace('__SCRIPT__', `<script>\n${script}\n</script>`);
}

/**
 * Seed an app page once. Written only if it is not there — a drive that
 * rewrote its own Drive on every boot would be a drive you cannot change —
 * and only the first time: `.marble/apps.json` remembers what was seeded and
 * where, so a Console moved into a folder, or a Chat thrown away, stays where
 * its owner put it instead of coming back at the top on the next start. The
 * version it was built from is remembered too, which is the base
 * server/app-updates.js merges from when the template moves on.
 */
async function seedOnce(store, appId, name, build) {
  const manifest = await readManifest(store.marbleDir);
  const known = manifest.seeded[appId];
  if (known) return { seeded: false, path: known };
  if (!(await store.has(name))) {
    await store.write(name, await build(), { label: 'seeded' });
    const source = currentSource(appById(appId));
    if (source !== null) manifest.docs[name] = { app: appId, version: versionId(source), at: new Date().toISOString() };
    manifest.seeded[appId] = name;
    await writeManifest(store.marbleDir, manifest);
    return { seeded: true, path: name };
  }
  // A drive from before the manifest: what is there is what was seeded.
  manifest.seeded[appId] = name;
  await writeManifest(store.marbleDir, manifest);
  return { seeded: false, path: name };
}

export async function seedDrive(store, { name = 'drive', title = 'My Drive' } = {}) {
  return seedOnce(store, 'drive', name, () => buildDrive({ name, title }));
}

/** The Agents library page — custom chrome, so the drawer does not mount on it. */
export async function buildAgents({ name = 'Agents', title = 'Agents' } = {}) {
  const template = await fsp.readFile(path.join(REPO, 'templates', 'agents.mrbl'), 'utf8');
  return template
    .replaceAll('__TITLE__', title)
    .replace('__ICON__', () => iconLink('doc'))
    .replace(/__ID__/g, () => newId());
}

export async function seedAgents(store, { name = 'Agents', title = 'Agents' } = {}) {
  return seedOnce(store, 'agents', name, () => buildAgents({ name, title }));
}

/** The Chat app — a plain chatbot over the same conversations Agents runs.
 *  It is also a starter in the gallery (`starters/chat.mrbl`), so the one every
 *  drive is seeded with and one made from Templates are the same build. */
export async function buildChat({ name = 'Chat', title = 'Chat' } = {}) {
  return buildStarter('chat', { name: title || name });
}

export async function seedChat(store, { name = 'Chat', title = 'Chat' } = {}) {
  return seedOnce(store, 'chat', name, () => buildChat({ name, title }));
}

/** The Board — the whiteboard where the board is the prompt. The third way to
 *  ask, beside Chat and Agents, and like Chat a gallery starter too. */
export async function seedBoard(store, { name = 'Board' } = {}) {
  if (!STARTERS.some((starter) => starter.id === 'whiteboard')) return { seeded: false, path: null };
  return seedOnce(store, 'whiteboard', name, () => buildStarter('whiteboard', { name }));
}

/** The design system: the tokens, type, motion and parts the drive's own apps
 *  are drawn with, drawn with them. A page to look at, and the page the
 *  marble-drive:design-system skill sends an agent to before it styles
 *  anything — so a drive that changes a token here changes what gets built.
 *  Its script is its own, like the Agents page's, so nothing is composed in. */
export async function buildDesignSystem({ title = 'Design system' } = {}) {
  const template = await fsp.readFile(path.join(REPO, 'templates', 'design-system.mrbl'), 'utf8');
  return template
    .replaceAll('__TITLE__', title)
    .replace('__ICON__', () => iconLink('doc'))
    .replace(/__ID__/g, () => newId());
}

export async function seedDesignSystem(store, { name = 'Design System', title = 'Design system' } = {}) {
  return seedOnce(store, 'design-system', name, () => buildDesignSystem({ title }));
}

/** The Console: every drive, from one page. Only where the console is on
 *  (admin-p2); its code is the host's (runtime/console.js), so the file is a
 *  place, not a program, and never needs patching. */
export async function buildConsole({ title = 'Console' } = {}) {
  const template = await fsp.readFile(path.join(REPO, 'templates', 'console.mrbl'), 'utf8');
  return template
    .replaceAll('__TITLE__', title)
    .replace('__ICON__', () => iconLink('doc'))
    .replace(/__ID__/g, () => newId());
}

export async function seedConsole(store, { name = 'Console', title = 'Console' } = {}) {
  return seedOnce(store, 'console', name, () => buildConsole({ title }));
}
