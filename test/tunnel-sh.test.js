// test/tunnel-sh.test.js
// macos/launchd/tunnel.sh never puts an ungated drive on the internet: it
// will not start a tunnel unless the drive's settings file sets a passphrase
// (as node reads it) and the drive answering on its port asks for it.
// Everything here stops before launchd or cloudflared is touched.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const script = path.resolve(import.meta.dirname, '../macos/launchd/tunnel.sh');
const zsh = spawnSync('zsh', ['-c', 'true']).status === 0;
const skip = !zsh && 'no zsh';
const SETTINGS = '.config/marble-drive/mac-bryan.env';
const CONFIG = '.cloudflared/marble-bryan.yml';

// Async, so a server in this process can answer the script's curl.
function run(args, files = {}, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-home-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.writeFileSync(path.join(home, rel), text);
  }
  return new Promise((resolve) => {
    execFile('zsh', [script, ...args], { env: { ...process.env, MARBLE_DRIVE_SECRET: '', ...env, HOME: home }, encoding: 'utf8' }, (error, stdout, stderr) => {
      fs.rmSync(home, { recursive: true, force: true });
      resolve({ status: error ? error.code : 0, stdout, stderr });
    });
  });
}

// A stand-in for the drive's host on a free loopback port.
async function host(answer) {
  const server = http.createServer(answer);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: String(server.address().port), close: () => new Promise((r) => server.close(r)) };
}

test('the script parses', { skip }, () => {
  const res = spawnSync('zsh', ['-n', script], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});

test('no passphrase, no tunnel: install, start and restart refuse and say why', { skip }, async () => {
  const cases = [
    {},
    { [SETTINGS]: 'MARBLE_HUB_ENV=x\n' },
    { [SETTINGS]: 'MARBLE_DRIVE_SECRET=\n' },
    { [SETTINGS]: 'MARBLE_DRIVE_SECRET=""\n' },
    { [SETTINGS]: '# MARBLE_DRIVE_SECRET=old\n' },
    { [SETTINGS]: 'MARBLE_DRIVE_SECRET= # none\n' }, // node reads ""
    { [SETTINGS]: 'MARBLE_DRIVE_SECRET=old\nMARBLE_DRIVE_SECRET=\n' }, // node takes the last
  ];
  for (const files of cases) {
    for (const verb of ['install', 'start', 'restart', 'check']) {
      const res = await run([verb, 'bryan'], files);
      assert.notEqual(res.status, 0, `${verb} with ${JSON.stringify(files)}`);
      assert.match(res.stderr, /MARBLE_DRIVE_SECRET/);
      assert.match(res.stderr, /mac-bryan\.env/);
      assert.match(res.stderr, /ungated/);
    }
  }
});

test('with a passphrase set, it still needs setup first (and says so) before touching launchd', { skip }, async () => {
  for (const line of ['MARBLE_DRIVE_SECRET=pw-1234\n', 'export MARBLE_DRIVE_SECRET="pw 1234"\n', 'MARBLE_DRIVE_SECRET=\nMARBLE_DRIVE_SECRET=pw-1234\n']) {
    const res = await run(['install', 'bryan'], { [SETTINGS]: line });
    assert.notEqual(res.status, 0);
    assert.doesNotMatch(res.stderr, /MARBLE_DRIVE_SECRET/);
    assert.match(res.stderr, /tunnel\.sh setup bryan/);
    assert.doesNotMatch(res.stdout + res.stderr, /pw.1234/, 'the passphrase is never printed');
  }
});

test('the drive answering now must ask for its passphrase', { skip }, async () => {
  const files = { [SETTINGS]: 'MARBLE_DRIVE_SECRET=pw-1234\n', [CONFIG]: 'tunnel: x\n' };
  const answers = {
    open: [(req, res) => res.end('<!doctype html>the drive'), false],
    gated: [(req, res) => { res.writeHead(302, { location: `/gate?to=${encodeURIComponent(req.url)}` }); res.end(); }, true],
    closed: [(req, res) => { res.writeHead(401); res.end(); }, true],
    elsewhere: [(req, res) => { res.writeHead(302, { location: '/somewhere' }); res.end(); }, false],
    standby: [(req, res) => {
      if (req.url === '/health') return res.end(JSON.stringify({ ok: true, standby: true, home: 'fly', working: 0 }));
      res.writeHead(503); res.end('This drive is on Fly right now');
    }, true],
    broken: [(req, res) => { res.writeHead(503); res.end('{"ok":true}'); }, false],
  };
  for (const [kind, [answer, allowed]] of Object.entries(answers)) {
    const h = await host(answer);
    try {
      const res = await run(['check', 'bryan'], files, { MARBLE_TUNNEL_PORT: h.port });
      if (allowed) {
        assert.equal(res.status, 0, `${kind}: ${res.stderr}`);
        assert.match(res.stdout, /may run/);
      } else {
        assert.notEqual(res.status, 0, kind);
        assert.match(res.stderr, /answers without its passphrase/, kind);
        assert.match(res.stderr, /home\.sh restart bryan/, kind);
      }
      if (!allowed) {
        const install = await run(['install', 'bryan'], files, { MARBLE_TUNNEL_PORT: h.port });
        assert.notEqual(install.status, 0, `${kind}: install`);
        assert.match(install.stderr, /answers without its passphrase/);
      }
    } finally {
      await h.close();
    }
  }
  const nobody = await host(() => {});
  const port = nobody.port;
  await nobody.close();
  const res = await run(['start', 'bryan'], files, { MARBLE_TUNNEL_PORT: port });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /nothing answers/);
});

test('setup takes only a tunnel name of its own under marbledrive.app', { skip }, async () => {
  for (const name of ['bryan.marbledrive.app', 'www.marbledrive.app', 'marbledrive.app']) {
    const res = await run(['setup', 'bryan', name]);
    assert.equal(res.status, 2, name);
    assert.match(res.stderr, /routed through the front door Worker/, name);
  }
  for (const name of ['evil.example', 'a.b.marbledrive.app', 'mac-bryan.marbledrive.app.evil.example']) {
    const res = await run(['setup', 'bryan', name]);
    assert.equal(res.status, 2, name);
    assert.match(res.stderr, /one label under marbledrive\.app/, name);
  }
  const fine = await run(['setup', 'bryan', 'mac-bryan.marbledrive.app']);
  assert.doesNotMatch(fine.stderr, /routed through|one label/);
});

test('an unknown verb is a usage error', { skip }, async () => {
  const res = await run(['fly', 'bryan']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage/);
});
