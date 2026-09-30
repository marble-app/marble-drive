// test/tunnel-sh.test.js
// macos/launchd/tunnel.sh never puts an ungated drive on the internet: it
// will not start a tunnel unless the drive's settings file sets a passphrase.
// Everything here stops before launchd or cloudflared is touched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.resolve(import.meta.dirname, '../macos/launchd/tunnel.sh');
const zsh = spawnSync('zsh', ['-c', 'true']).status === 0;

function run(args, files = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-home-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text);
  }
  const res = spawnSync('zsh', [script, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  fs.rmSync(home, { recursive: true, force: true });
  return res;
}

test('the script parses', { skip: !zsh && 'no zsh' }, () => {
  const res = spawnSync('zsh', ['-n', script], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});

test('no passphrase, no tunnel: install, start and restart refuse and say why', { skip: !zsh && 'no zsh' }, () => {
  const cases = [
    {},
    { '.config/marble-drive/mac-bryan.env': 'MARBLE_HUB_ENV=x\n' },
    { '.config/marble-drive/mac-bryan.env': 'MARBLE_DRIVE_SECRET=\n' },
    { '.config/marble-drive/mac-bryan.env': 'MARBLE_DRIVE_SECRET=""\n' },
    { '.config/marble-drive/mac-bryan.env': '# MARBLE_DRIVE_SECRET=old\n' },
  ];
  for (const files of cases) {
    for (const verb of ['install', 'start', 'restart']) {
      const res = run([verb, 'bryan'], files);
      assert.notEqual(res.status, 0, `${verb} with ${JSON.stringify(files)}`);
      assert.match(res.stderr, /MARBLE_DRIVE_SECRET/);
      assert.match(res.stderr, /mac-bryan\.env/);
      assert.match(res.stderr, /ungated|passphrase/i);
    }
  }
});

test('with a passphrase set, it still needs setup first (and says so) before touching launchd', { skip: !zsh && 'no zsh' }, () => {
  for (const line of ['MARBLE_DRIVE_SECRET=pw-1234\n', 'export MARBLE_DRIVE_SECRET="pw 1234"\n']) {
    const res = run(['install', 'bryan'], { '.config/marble-drive/mac-bryan.env': line });
    assert.notEqual(res.status, 0);
    assert.doesNotMatch(res.stderr, /MARBLE_DRIVE_SECRET/);
    assert.match(res.stderr, /tunnel\.sh setup bryan/);
    assert.doesNotMatch(res.stdout + res.stderr, /pw.1234/, 'the passphrase is never printed');
  }
});

test('an unknown verb is a usage error', { skip: !zsh && 'no zsh' }, () => {
  const res = run(['fly', 'bryan']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage/);
});
