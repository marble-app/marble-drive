// Looking inside a drive. This is the one read that wakes a sprite, so it is
// asked for (Look now), or done for a drive that is awake anyway.
//
// What the probe prints is split in two. What may be shown — release, versions,
// health, which settings exist and the values of the ones that are not secret —
// is cached on admin-p1's disk with when it was seen, so an asleep drive still
// says what it looked like. What may not — the passphrase, any key — is held in
// memory, for the console to act with, and is gone with the process.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSecret } from './envfile.js';

export const PROBE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'probe.mjs');
const REMOTE = '/tmp/marble-console-probe.mjs';

export function createInspector({ sprites, dir }) {
  const secrets = new Map(); // name → { KEY: value }
  const file = (name) => path.join(dir, `${name}.json`);

  async function look(name) {
    const { stdout } = await sprites.exec(name, ['node', REMOTE], { files: [[PROBE, REMOTE]], timeout: 90_000 });
    const raw = JSON.parse(stdout.slice(stdout.indexOf('{')));
    const hidden = {};
    const env = (raw.env ?? []).map(({ key, value }) => {
      if (!isSecret(key)) return { key, value };
      hidden[key] = value;
      return { key, secret: true };
    });
    secrets.set(name, hidden);
    const shown = { ...raw, env, lookedAt: new Date().toISOString() };
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file(name), JSON.stringify(shown));
    return shown;
  }

  async function cached(name) {
    try {
      return JSON.parse(await fsp.readFile(file(name), 'utf8'));
    } catch {
      return null;
    }
  }

  return {
    look,
    cached,
    /** A secret seen at the last look in this process, or null. */
    secret: (name, key) => secrets.get(name)?.[key] ?? null,
    forget: (name) => secrets.delete(name),
  };
}
