// A drive's own settings: `<drive>/.marble/drive.json`.
//
// Choices that belong to one drive rather than to the machine it runs on (that
// is the environment) or to one document in it (that is the document): which
// top-level folders wear a realm's colour, and which document `/today` opens.
// They travel with the drive and are backed up with it, and a fresh drive has
// none — which is how a new install starts with its own space instead of the
// owner's.
//
// Optional, and never able to break the host by being wrong: a missing file, a
// file that is not JSON, or an entry of the wrong shape is simply not a setting.

import fsp from 'node:fs/promises';
import path from 'node:path';

export async function readDriveSettings(marbleDir) {
  let raw = null;
  try {
    raw = JSON.parse(await fsp.readFile(path.join(marbleDir, 'drive.json'), 'utf8'));
  } catch {
    raw = null;
  }
  const settings = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const realms = {};
  if (settings.realms && typeof settings.realms === 'object' && !Array.isArray(settings.realms)) {
    for (const [folder, realm] of Object.entries(settings.realms)) {
      if (folder && typeof realm === 'string' && realm) realms[folder] = realm;
    }
  }
  const latest = typeof settings.latest === 'string' && settings.latest ? settings.latest : null;
  return { realms, latest };
}
