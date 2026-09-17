// The MCP config a provider writes carries the turn's token. Writing it in
// place would leave it, for a moment, under whatever mode the old file had, or
// the umask's, so it is written to a fresh 0600 file beside it and renamed over.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';

export async function writePrivateFile(file, text) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(temp, text, { mode: 0o600, flag: 'wx' });
    await fsp.chmod(temp, 0o600);
    await fsp.rename(temp, file);
  } catch (err) {
    await fsp.rm(temp, { force: true });
    throw err;
  }
}
