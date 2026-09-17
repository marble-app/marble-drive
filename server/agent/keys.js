// API keys the person set in the Agents settings panel.
//
// They are not conversation data and they are not in the drive: backups copy
// `.marble/`, and a key in settings.json would ride along. This file lives
// next to the host (`.agent-keys.local`, gitignored) or wherever
// `MARBLE_DRIVE_AGENT_KEYS` points. GET never returns the values, only whether
// a key is set. Mode 600 so a shared machine does not leak them as a world-readable file.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const FIELDS = {
  anthropic: 'ANTHROPIC_API_KEY',
  cursor: 'CURSOR_API_KEY',
};

const empty = () => ({ anthropic: undefined, cursor: undefined });

const readFile = (file) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      anthropic: typeof parsed.anthropic === 'string' ? parsed.anthropic : undefined,
      cursor: typeof parsed.cursor === 'string' ? parsed.cursor : undefined,
    };
  } catch (err) {
    if (err.code === 'ENOENT') return empty();
    throw err;
  }
};

export function createKeyStore({ file }) {
  let cache = null;

  const current = () => {
    if (!cache) cache = readFile(file);
    return cache;
  };

  async function write(patch) {
    const next = { ...current() };
    for (const name of Object.keys(FIELDS)) {
      if (!Object.hasOwn(patch, name)) continue;
      const value = typeof patch[name] === 'string' ? patch[name].trim() : '';
      if (value) next[name] = value;
      else delete next[name];
    }
    cache = next;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const body = `${JSON.stringify({ anthropic: next.anthropic, cursor: next.cursor }, null, 2)}\n`;
    await fsp.writeFile(tmp, body, { mode: 0o600 });
    await fsp.rename(tmp, file);
    await fsp.chmod(file, 0o600);
  }

  const flags = async () => {
    const data = current();
    return { anthropic: Boolean(data.anthropic), cursor: Boolean(data.cursor) };
  };

  const asEnv = () => {
    const data = current();
    const env = {};
    for (const [name, envName] of Object.entries(FIELDS)) {
      if (data[name]) env[envName] = data[name];
    }
    return env;
  };

  return { write, flags, asEnv, file };
}
