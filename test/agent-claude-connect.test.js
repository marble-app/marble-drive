// Connect your Claude, through the drive's routes: POST /agent/claude/sign-in
// answers the address `claude setup-token` printed, POST …/code hands the
// pasted code to that same run, and the token it prints is kept in the keys
// file the way an API key is. Claude then runs on the person's plan. The
// `claude` here is the fake from test/fixtures, first on PATH.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude-setup-token.mjs', import.meta.url));
const TOKEN = 'sk-ant-oat01-FAKEfakeFAKEfake_0123456789-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-AA';

let hasScript = true;
try {
  execFileSync('sh', ['-c', 'command -v script'], { stdio: 'ignore' });
} catch {
  hasScript = false;
}
const needsPty = { skip: hasScript ? false : 'no `script` on this machine' };

// The host runs whatever `claude` its PATH finds: the fake, logging here.
const binDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-claude-bin-'));
const fakeLog = path.join(binDir, 'log');
await fsp.writeFile(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@" --log "${fakeLog}"\n`, { mode: 0o755 });
process.env.PATH = `${binDir}:${process.env.PATH}`;
const logged = () => (fs.existsSync(fakeLog) ? fs.readFileSync(fakeLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check, ms = 5_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

const drives = [];
test.after(async () => {
  for (const drive of drives) await drive.close();
});

async function host(env = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-connect-'));
  const keysFile = path.join(root, '..', `${path.basename(root)}-keys`);
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_PROVIDER: 'claude-api',
    MARBLE_DRIVE_AGENT_WORKDIR: path.join(root, '..', `${path.basename(root)}-work`),
    MARBLE_DRIVE_AGENT_KEYS: keysFile,
    ...env,
  });
  const drive = await createDrive(config, {
    log: { log() {}, error() {}, info() {} },
    agentProviders: new Map([
      ['claude-subscription', createFakeProvider({ id: 'claude-subscription' })],
      ['claude-api', createFakeProvider({ id: 'claude-api' })],
      ['codex', createFakeProvider({ id: 'codex' })],
    ]),
  });
  drives.push(drive);
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const api = async (method, route, body, headers = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text };
  };
  return { api, keysFile, drive };
}

test('the address is read, the code reaches the command, the token is kept, and Claude runs on the plan', needsPty, async () => {
  const { api, keysFile } = await host();
  assert.equal((await api('GET', '/agent/settings')).body.claudeAuth, 'api', 'starts on an API key');

  const started = await api('POST', '/agent/claude/sign-in');
  assert.equal(started.status, 200, started.text);
  assert.match(started.body.url, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&.*state=FAKEstate/);
  const pid = logged().filter((e) => e.pid).at(-1).pid;
  assert.ok(alive(pid), 'setup-token waits for the code');

  const done = await api('POST', '/agent/claude/sign-in/code', { code: 'good-pasted-code#FAKEstate' });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.connected, true);
  assert.equal(done.text.includes(TOKEN), false, 'the token never goes back to the page');
  assert.equal(logged().filter((e) => e.code).at(-1).code, 'good-pasted-code#FAKEstate');
  assert.ok(await until(() => !alive(pid)), 'nothing left running');

  // Kept where an API key is kept, readable only by the host.
  const kept = JSON.parse(await fsp.readFile(keysFile, 'utf8'));
  assert.equal(kept.claude, TOKEN);
  assert.equal((await fsp.stat(keysFile)).mode & 0o777, 0o600);

  const settings = (await api('GET', '/agent/settings')).body;
  assert.equal(settings.keys.claude, true);
  assert.equal(settings.claudeAuth, 'login', 'the switch moves to the plan');
  assert.equal(settings.defaultProvider, 'claude-subscription');
  assert.equal(JSON.stringify(settings).includes(TOKEN), false);
  const providers = (await api('GET', '/agent/providers')).body.map((p) => p.id);
  assert.ok(providers.includes('claude-subscription') && !providers.includes('claude-api'));
});

test('a default that is not Claude stays; a refused code changes nothing', needsPty, async () => {
  const { api, keysFile } = await host({ MARBLE_DRIVE_AGENT_PROVIDER: 'codex' });
  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  const refused = await api('POST', '/agent/claude/sign-in/code', { code: 'wrong-code' });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /didn't accept that code/);
  assert.equal(fs.existsSync(keysFile), false, 'nothing kept');

  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  assert.equal((await api('POST', '/agent/claude/sign-in/code', { code: 'good-second-try' })).status, 200);
  const settings = (await api('GET', '/agent/settings')).body;
  assert.equal(settings.claudeAuth, 'login');
  assert.equal(settings.defaultProvider, 'codex', 'someone on Codex stays on Codex');
});

test('a sign-in left without its code times out, its command is killed, and a late code is turned away', needsPty, async () => {
  const { api } = await host({ MARBLE_DRIVE_CLAUDE_SIGNIN_SECONDS: '0.4' });
  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  const pid = logged().filter((e) => e.pid).at(-1).pid;
  assert.ok(await until(() => !alive(pid), 3_000), 'killed after its wait');
  const late = await api('POST', '/agent/claude/sign-in/code', { code: 'good-but-late' });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /Open Claude sign-in again/);
});

test('Cancel ends a waiting sign-in; and the drive closing ends one too', needsPty, async () => {
  const { api, drive } = await host();
  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  const first = logged().filter((e) => e.pid).at(-1).pid;
  assert.equal((await api('DELETE', '/agent/claude/sign-in')).status, 200);
  assert.ok(await until(() => !alive(first)));

  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  const second = logged().filter((e) => e.pid).at(-1).pid;
  await drive.close();
  drives.splice(drives.indexOf(drive), 1);
  assert.ok(await until(() => !alive(second)), 'closing the drive kills it');
});

test('only the owner: behind the gate, and never from another site', async () => {
  const before = logged().length;
  const gated = await host({ MARBLE_DRIVE_SECRET: 'connect-claude-secret' });
  for (const [method, route] of [['POST', '/agent/claude/sign-in'], ['POST', '/agent/claude/sign-in/code'], ['DELETE', '/agent/claude/sign-in']]) {
    const res = await gated.api(method, route, method === 'POST' ? { code: 'good-x' } : undefined);
    assert.equal(res.status, 401, `${method} ${route}`);
  }
  const open = await host();
  const cross = await open.api('POST', '/agent/claude/sign-in', undefined, { Origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  assert.equal(logged().length, before, 'nothing ran');
});
