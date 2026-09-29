// test/standby.test.js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStandby } from '../server/standby.js';

async function listen(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health says standby and where home is; everything else waits', async () => {
  const server = createStandby({ home: 'mac', since: '2026-09-30T10:00:00.000Z' });
  const base = await listen(server);
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, standby: true, home: 'mac', working: 0 });
    const page = await fetch(`${base}/a/Agents`);
    assert.equal(page.status, 503);
    assert.equal(page.headers.get('retry-after'), '30');
    assert.match(await page.text(), /on the Mac right now/);
  } finally {
    server.close();
  }
});

test('the standby command touches nothing in the drive', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'standby-drive-'));
  await fsp.writeFile(path.join(root, 'notes.mrbl'), '<html>notes</html>');
  const before = await fsp.readdir(root, { recursive: true });
  const child = spawn(process.execPath, ['bin/marble-drive.js', 'standby'], {
    env: { ...process.env, MARBLE_DRIVE_ROOT: root, PORT: '4497', HOST: '127.0.0.1', MARBLE_HUB_ENV: '' },
    stdio: 'ignore',
  });
  try {
    let ok = false;
    for (let i = 0; i < 40 && !ok; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      ok = await fetch('http://127.0.0.1:4497/health').then((r) => r.ok, () => false);
    }
    assert.ok(ok, 'standby answered /health');
    await fetch('http://127.0.0.1:4497/notes.mrbl');
    assert.deepEqual(await fsp.readdir(root, { recursive: true }), before);
  } finally {
    child.kill('SIGTERM');
  }
});
