// The owner's live Drive document, for the tests that check it: the one named
// by MARBLE_DRIVE_DOC, else `drive.mrbl` at the drive root the host would use
// (MARBLE_DRIVE_ROOT, else `<repo>/drive`). Null when there is none, so a
// checkout without a drive skips those tests rather than failing them.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const liveDrivePath = () =>
  process.env.MARBLE_DRIVE_DOC
  || path.join(process.env.MARBLE_DRIVE_ROOT ? path.resolve(process.env.MARBLE_DRIVE_ROOT) : path.join(REPO, 'drive'), 'drive.mrbl');

export const liveDriveSource = () => fsp.readFile(liveDrivePath(), 'utf8').catch(() => null);
