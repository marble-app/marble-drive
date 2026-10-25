// The releases on this PC a drive can run: <opt>/releases/<name>/marble-drive,
// each a copy of one of the owner's (tools/home-release.sh), read by every
// guest and written by none.
//
// Putting a release there, and moving drives from one to another, is the
// updater's work, which the owner is writing himself (docs/HOSTING.md,
// "marble-host and the sandbox"). This only reads what is there: a new drive
// is made on the release the registry names for everyone, which only the
// updater sets, and otherwise on the newest folder in <opt>/releases.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { RELEASE } from './settings.js';

export const releaseDir = (opt, release) => path.join(opt, 'releases', release, 'marble-drive');

/** Whether a drive could start from this release: its folder holds the host. */
export const onDisk = (opt, release) =>
  RELEASE.test(release ?? '') &&
  fsp.access(path.join(releaseDir(opt, release), 'bin', 'marble-drive.js')).then(() => true, () => false);

/** Every release in <opt>/releases a drive could start from, newest first.
 *  A release's name starts with the UTC time it was made
 *  (20261025T161133Z-4b2103a), so newest is last by name. */
export async function releasesOnDisk(opt) {
  let names;
  try {
    names = await fsp.readdir(path.join(opt, 'releases'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const usable = [];
  for (const name of names) if (await onDisk(opt, name)) usable.push(name);
  return usable.sort().reverse();
}

/** The release a new drive is made on, and why: `registry` (the one the
 *  registry names for everyone) or `newest` (the newest on disk). Null when
 *  there is none. */
export async function releaseForNewDrives({ registry, opt }) {
  const named = registry.channels().everyone;
  if (named) return { release: named, from: 'registry' };
  const [newest = null] = await releasesOnDisk(opt);
  return { release: newest, from: newest ? 'newest' : null };
}
