// test/hub-home-mode.test.js
// tools/home-mode.mjs, the question tools/sprite/serve.sh asks before every
// start: serve or standby.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const homeMode = async (hubEnv) => {
  const env = { ...process.env };
  if (hubEnv === undefined) delete env.MARBLE_HUB_ENV;
  else env.MARBLE_HUB_ENV = hubEnv;
  const { stdout, stderr } = await run(process.execPath, ['tools/home-mode.mjs'], { env });
  return { mode: stdout.trim(), why: stderr };
};
const SETTINGS = 'HUB_DRIVE=bryan\nHUB_MACHINE=mac\nHUB_PASSPHRASE=p\nHUB_SALT=s\nLEASE_URL=http://127.0.0.1:1\nLEASE_TOKEN=t\nHUB_BACKEND=local\nHUB_LOCAL_DIR=/nowhere\n';

test('no MARBLE_HUB_ENV, or an empty one: serve', async () => {
  assert.equal((await homeMode(undefined)).mode, 'serve');
  assert.equal((await homeMode('')).mode, 'serve');
});

test('MARBLE_HUB_ENV naming a file that is not there: standby, and the reason names it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'home-mode-'));
  const missing = path.join(dir, 'hub-bryan.env');
  const { mode, why } = await homeMode(missing);
  assert.equal(mode, 'standby');
  assert.ok(why.includes(missing), why);
});

test('a hold file beside the settings: standby, whatever the lease says', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'home-mode-'));
  const file = path.join(dir, 'hub-bryan.env');
  await fsp.writeFile(file, SETTINGS);
  // A remembered lease naming this machine: without the hold it would serve.
  await fsp.writeFile(path.join(dir, 'lease-bryan.json'), JSON.stringify({ home: 'mac', epoch: 4 }));
  assert.equal((await homeMode(file)).mode, 'serve');
  await fsp.writeFile(path.join(dir, 'hold-bryan'), '');
  const { mode, why } = await homeMode(file);
  assert.equal(mode, 'standby');
  assert.match(why, /held by drive-home/);
});
