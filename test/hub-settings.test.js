import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { holdPath, loadHubSettings, parseEnvFile } from '../server/hub/settings.js';

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hub-settings-'));
const write = async (name, text) => {
  const file = path.join(dir, name);
  await fsp.writeFile(file, text);
  return file;
};
const BASE = 'HUB_DRIVE=bryan\nHUB_MACHINE=mac\nHUB_PASSPHRASE=p\nHUB_SALT=s\nLEASE_URL=https://l\nLEASE_TOKEN=t\n';

test('KEY=value lines, comments and quotes', () => {
  assert.deepEqual(parseEnvFile('# c\nA=1\nB="two words"\n  C = 3 \nbad line\n'), { A: '1', B: 'two words', C: '3' });
});

test('no file named: the hub is off', async () => {
  assert.equal(loadHubSettings(null), null);
  assert.equal(loadHubSettings(''), null);
  assert.equal(loadHubSettings(undefined), null);
});

test('a file named but not there is an error that names it, never "no hub"', async () => {
  const missing = path.join(dir, 'nope.env');
  assert.throws(() => loadHubSettings(missing), (err) => err.message.includes(missing));
});

test('the hold file sits beside the settings, one per drive', async () => {
  assert.equal(holdPath({ file: '/h/.config/marble-drive/hub-bryan.env', HUB_DRIVE: 'bryan' }), '/h/.config/marble-drive/hold-bryan');
  assert.equal(holdPath({ file: '/h/.config/marble-drive/hub.env', HUB_DRIVE: 't-bryan' }), '/h/.config/marble-drive/hold-t-bryan');
});

test('a file missing keys says which', async () => {
  const file = await write('short.env', 'HUB_DRIVE=bryan\n');
  assert.throws(() => loadHubSettings(file), /missing HUB_MACHINE/);
});

test('R2 keys are needed unless the backend is local', async () => {
  const r2 = await write('r2.env', BASE);
  assert.throws(() => loadHubSettings(r2), /R2_ACCOUNT_ID/);
  const local = loadHubSettings(await write('local.env', `${BASE}HUB_BACKEND=local\nHUB_LOCAL_DIR=/tmp/x\n`));
  assert.equal(local.HUB_DRIVE, 'bryan');
  assert.equal(local.file, path.join(dir, 'local.env'));
});

test('the machine is mac or fly, and the drive a plain name', async () => {
  const bad = await write('bad.env', BASE.replace('HUB_MACHINE=mac', 'HUB_MACHINE=pc') + 'HUB_BACKEND=local\nHUB_LOCAL_DIR=/x\n');
  assert.throws(() => loadHubSettings(bad), /mac or fly/);
  const odd = await write('odd.env', BASE.replace('HUB_DRIVE=bryan', 'HUB_DRIVE=../x') + 'HUB_BACKEND=local\nHUB_LOCAL_DIR=/x\n');
  assert.throws(() => loadHubSettings(odd), /HUB_DRIVE/);
});
