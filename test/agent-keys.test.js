import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createKeyStore } from '../server/agent/keys.js';

const scratch = async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-agent-keys-'));
  return { dir, file: path.join(dir, 'agent-keys.local') };
};

test('an empty store reports no keys and writes nothing', async () => {
  const { file } = await scratch();
  const keys = createKeyStore({ file });
  assert.deepEqual(await keys.flags(), { anthropic: false, cursor: false });
  assert.deepEqual(keys.asEnv(), {});
  await assert.rejects(fsp.stat(file), { code: 'ENOENT' });
});

test('saving a key is later visible as a flag, never as the secret, and lives only in that file', async () => {
  const { dir, file } = await scratch();
  const keys = createKeyStore({ file });
  const secret = 'sk-ant-test-secret-do-not-echo';
  await keys.write({ anthropic: secret });
  assert.deepEqual(await keys.flags(), { anthropic: true, cursor: false });
  assert.deepEqual(keys.asEnv(), { ANTHROPIC_API_KEY: secret });
  const raw = await fsp.readFile(file, 'utf8');
  assert.match(raw, /sk-ant-test-secret-do-not-echo/);
  const mode = (await fsp.stat(file)).mode & 0o777;
  assert.equal(mode, 0o600);
  const others = await fsp.readdir(dir);
  assert.deepEqual(others, ['agent-keys.local']);
});

test('an empty string clears a key, and env from the file then falls back to nothing', async () => {
  const { file } = await scratch();
  const keys = createKeyStore({ file });
  await keys.write({ anthropic: 'sk-one', cursor: 'ck-one' });
  await keys.write({ anthropic: '' });
  assert.deepEqual(await keys.flags(), { anthropic: false, cursor: true });
  assert.deepEqual(keys.asEnv(), { CURSOR_API_KEY: 'ck-one' });
});
