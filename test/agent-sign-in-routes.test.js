// Signing in to the person's own Claude or ChatGPT, through the drive's
// routes: POST /agent/claude/sign-in answers the address `claude auth login`
// printed and POST …/code types the pasted code into that same run; POST
// /agent/codex/sign-in answers OpenAI's device page and code, and GET says
// when the login has landed. Each CLI keeps its own login under the drive's
// home; Marble's key file gets no token, and an old one goes. Disconnect is
// each CLI's own logout. The `claude` and `codex` here are the fakes from
// test/fixtures, first on PATH, and HOME is a scratch folder, so nothing of
// this machine's own logins is read or touched.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'sign-in-routes-home-'));
process.env.HOME = HOME;

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const CLAUDE_FAKE = fileURLToPath(new URL('./fixtures/fake-claude-auth.mjs', import.meta.url));
const CODEX_FAKE = fileURLToPath(new URL('./fixtures/fake-codex-login.mjs', import.meta.url));

let hasScript = true;
try {
  execFileSync('sh', ['-c', 'command -v script'], { stdio: 'ignore' });
} catch {
  hasScript = false;
}
const needsPty = { skip: hasScript ? false : 'no `script` on this machine' };

// The host runs whatever `claude` and `codex` its PATH finds: the fakes,
// logging here.
const binDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-cli-bin-'));
const fakeLog = path.join(binDir, 'log');
await fsp.writeFile(path.join(binDir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${CLAUDE_FAKE}" "$@" --log "${fakeLog}"\n`, { mode: 0o755 });
await fsp.writeFile(path.join(binDir, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "${CODEX_FAKE}" "$@" --log "${fakeLog}"\n`, { mode: 0o755 });
process.env.PATH = `${binDir}:${process.env.PATH}`;
const logged = () => (fs.existsSync(fakeLog) ? fs.readFileSync(fakeLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const lastPid = (verb) => logged().filter((e) => e.pid && e.args.includes(verb)).at(-1)?.pid;
const claudeLogin = path.join(HOME, '.claude', 'fake-login.json');
const codexLogin = path.join(HOME, '.codex', 'fake-login.json');
const approve = () => fsp.writeFile(path.join(HOME, 'fake-approve'), '');
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
test.beforeEach(async () => {
  await fsp.rm(claudeLogin, { force: true });
  await fsp.rm(codexLogin, { force: true });
  await fsp.rm(path.join(HOME, 'fake-approve'), { force: true });
});

/** A drive whose Claude and Codex are stand-ins for running turns; detection
 *  of the Claude login reads the fake's own login file, as `claude auth
 *  status` would. */
async function host(env = {}, { keys = null, claudeSignedIn = () => fs.existsSync(claudeLogin), codexSignedIn = () => fs.existsSync(codexLogin) } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sign-in-routes-'));
  const keysFile = path.join(root, '..', `${path.basename(root)}-keys`);
  if (keys) await fsp.writeFile(keysFile, JSON.stringify(keys), { mode: 0o600 });
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
  const provider = (id, signedIn) => {
    const it = createFakeProvider({ id });
    it.detect = async () => ({ installed: true, signedIn: signedIn(), detail: '' });
    return it;
  };
  const drive = await createDrive(config, {
    log: { log() {}, error() {}, info() {} },
    agentProviders: new Map([
      ['claude-subscription', provider('claude-subscription', claudeSignedIn)],
      ['claude-api', provider('claude-api', () => false)],
      ['codex', provider('codex', codexSignedIn)],
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

// ---------------------------------------------------------------- Claude

test('Claude: the address is read, the code reaches the command, the CLI keeps the login, and Claude runs on the plan', needsPty, async () => {
  // A drive an older Connect gave a long-lived token: it worked until now.
  const { api, keysFile } = await host({}, { keys: { claude: 'sk-ant-oat01-older-token' } });
  assert.equal((await api('GET', '/agent/settings')).body.keys.claude, true, 'the older token still counts');

  const started = await api('POST', '/agent/claude/sign-in');
  assert.equal(started.status, 200, started.text);
  assert.match(started.body.url, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&.*state=FAKEstate/);
  const pid = lastPid('login');
  assert.ok(alive(pid), 'auth login waits for the code');
  assert.deepEqual(logged().find((e) => e.pid === pid).args, ['auth', 'login', '--claudeai']);
  assert.deepEqual(logged().find((e) => e.pid === pid).keys, [], 'no key and no token is handed to it');
  assert.deepEqual((await api('GET', '/agent/claude/sign-in')).body, { waiting: true, signedIn: false });

  const done = await api('POST', '/agent/claude/sign-in/code', { code: 'good-pasted-code#FAKEstate' });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.connected, true);
  assert.equal(done.body.ready, true);
  assert.equal(logged().filter((e) => e.code).at(-1).code, 'good-pasted-code#FAKEstate');
  assert.ok(await until(() => !alive(pid)), 'nothing left running');
  assert.ok(fs.existsSync(claudeLogin), 'the login is the CLI\'s own, in the drive\'s home');

  // Nothing of it in Marble's key file, and the older token is gone.
  const kept = JSON.parse(await fsp.readFile(keysFile, 'utf8'));
  assert.equal(kept.claude, undefined);
  const settings = (await api('GET', '/agent/settings')).body;
  assert.equal(settings.keys.claude, false);
  assert.equal(settings.claudeAuth, 'login', 'the switch moves to the plan');
  assert.equal(settings.defaultProvider, 'claude-subscription');
  for (const reply of [started, done, { text: JSON.stringify(settings) }]) assert.equal(/sk-ant-oat/.test(reply.text), false, 'no token goes to a page');
  assert.deepEqual((await api('GET', '/agent/claude/sign-in')).body, { waiting: false, signedIn: true });
});

test('Claude: half a code can be pasted again; a refused one changes nothing; a default that is not Claude stays', needsPty, async () => {
  // Codex runs on this drive already, and it is what new chats start on.
  const { api, keysFile } = await host({ MARBLE_DRIVE_AGENT_PROVIDER: 'codex' }, { codexSignedIn: () => true });
  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  const half = await api('POST', '/agent/claude/sign-in/code', { code: 'good-without-state' });
  assert.equal(half.status, 400);
  assert.equal(half.body.retry, true);
  assert.match(half.body.error, /isn't the whole code/);
  const refused = await api('POST', '/agent/claude/sign-in/code', { code: 'wrong-code#state' });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /didn't accept that code/);
  assert.equal(refused.body.retry, undefined);
  assert.equal(fs.existsSync(keysFile), false, 'nothing kept');
  assert.equal(fs.existsSync(claudeLogin), false);

  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  assert.equal((await api('POST', '/agent/claude/sign-in/code', { code: 'good-second-try#s' })).status, 200);
  const settings = (await api('GET', '/agent/settings')).body;
  assert.equal(settings.claudeAuth, 'login');
  assert.equal(settings.defaultProvider, 'codex', 'someone on Codex stays on Codex');
});

test('Claude: a sign-in left without its code times out, its command is killed, and a late code is turned away', needsPty, async () => {
  const { api } = await host({ MARBLE_DRIVE_CLAUDE_SIGNIN_SECONDS: '0.4' });
  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  const pid = lastPid('login');
  assert.ok(await until(() => !alive(pid), 3_000), 'killed after its wait');
  const late = await api('POST', '/agent/claude/sign-in/code', { code: 'good-but-late#s' });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /Open Claude sign-in again/);
});

test('Claude: Cancel ends a waiting sign-in, and the drive closing ends one too', needsPty, async () => {
  const { api, drive } = await host();
  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  const first = lastPid('login');
  assert.equal((await api('DELETE', '/agent/claude/sign-in')).status, 200);
  assert.ok(await until(() => !alive(first)));

  assert.equal((await api('POST', '/agent/claude/sign-in')).status, 200);
  const second = lastPid('login');
  await drive.close();
  drives.splice(drives.indexOf(drive), 1);
  assert.ok(await until(() => !alive(second)), 'closing the drive kills it');
});

test('Claude: Disconnect is `claude auth logout`, and takes an older token with it', async () => {
  await fsp.mkdir(path.dirname(claudeLogin), { recursive: true });
  await fsp.writeFile(claudeLogin, '{}');
  const { api, keysFile } = await host({}, { keys: { claude: 'sk-ant-oat01-older-token', anthropic: 'sk-ant-api03-kept' } });
  const out = await api('POST', '/agent/claude/sign-out');
  assert.equal(out.status, 200, out.text);
  assert.ok(logged().some((e) => e.args?.join(' ') === 'auth logout'), 'the CLI\'s own logout ran');
  assert.equal(fs.existsSync(claudeLogin), false, 'the CLI forgot its login');
  const kept = JSON.parse(await fsp.readFile(keysFile, 'utf8'));
  assert.equal(kept.claude, undefined, 'the older token is gone');
  assert.equal(kept.anthropic, 'sk-ant-api03-kept', 'an API key is the key field\'s to clear');
});

// ---------------------------------------------------------------- ChatGPT

test('ChatGPT: OpenAI\'s page and the code come back, the login lands in the CLI, and Codex becomes the agent', async () => {
  const { api, keysFile } = await host({ MARBLE_DRIVE_AGENT_PROVIDER: 'claude-subscription' });
  const before = (await api('GET', '/agent/setup')).body;
  assert.equal(before.ready, false);
  assert.deepEqual(before.signIns, ['claude', 'codex']);

  const started = await api('POST', '/agent/codex/sign-in');
  assert.equal(started.status, 200, started.text);
  assert.equal(started.body.state, 'waiting');
  assert.equal(started.body.url, 'https://auth.openai.com/codex/device');
  assert.equal(started.body.code, 'FAKE-C0DE7');
  assert.ok(Date.parse(started.body.expiresAt) > Date.now() + 14 * 60_000);
  const pid = lastPid('--device-auth');
  assert.deepEqual(logged().find((e) => e.pid === pid).keys, [], 'no key is handed to it');
  assert.equal((await api('GET', '/agent/codex/sign-in')).body.state, 'waiting');

  // The person types the code on OpenAI's page; OpenAI hands the login to
  // the waiting command. Nothing is sent to the drive.
  await approve();
  let polled = null;
  assert.ok(await until(async () => {
    polled = (await api('GET', '/agent/codex/sign-in')).body;
    return polled.state === 'signed-in';
  }), JSON.stringify(polled));
  assert.equal(polled.connected, true);
  assert.equal(polled.ready, true);
  assert.ok(fs.existsSync(codexLogin), 'the login is Codex\'s own, in the drive\'s home');
  assert.equal(fs.existsSync(keysFile), false, 'nothing is written to Marble\'s key file');
  assert.ok(await until(() => !alive(pid)), 'nothing left running');
  const settings = (await api('GET', '/agent/settings')).body;
  assert.equal(settings.defaultProvider, 'codex', 'the agent new chats start on is one that runs');
  assert.equal(settings.setupLater ?? null, null);
});

test('ChatGPT: Cancel ends it; a second start ends the first; Disconnect is `codex logout`', async () => {
  const { api } = await host();
  assert.equal((await api('POST', '/agent/codex/sign-in')).status, 200);
  const first = lastPid('--device-auth');
  assert.equal((await api('POST', '/agent/codex/sign-in')).status, 200);
  const second = lastPid('--device-auth');
  assert.notEqual(first, second);
  assert.ok(await until(() => !alive(first)), 'the first is gone');
  assert.equal((await api('DELETE', '/agent/codex/sign-in')).status, 200);
  assert.ok(await until(() => !alive(second)), 'the second is gone');
  assert.ok(await until(async () => (await api('GET', '/agent/codex/sign-in')).body.state === 'ended'));

  await fsp.mkdir(path.dirname(codexLogin), { recursive: true });
  await fsp.writeFile(codexLogin, '{}');
  const out = await api('POST', '/agent/codex/sign-out');
  assert.equal(out.status, 200, out.text);
  assert.ok(logged().some((e) => e.args?.join(' ') === 'logout') || !fs.existsSync(codexLogin));
  assert.equal(fs.existsSync(codexLogin), false, 'Codex forgot its login');
});

test('the line about passwords names whoever hosts the drive, and a drive without Codex has no ChatGPT', async () => {
  const hosted = await host({ MARBLE_HOST_OWNER: 'Bryan' });
  assert.equal((await hosted.api('GET', '/agent/setup')).body.host, 'Bryan');
  const own = await host();
  assert.equal((await own.api('GET', '/agent/setup')).body.host, null);

  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sign-in-routes-'));
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_WORKDIR: path.join(root, '..', `${path.basename(root)}-work`),
    MARBLE_DRIVE_AGENT_KEYS: path.join(root, '..', `${path.basename(root)}-keys`),
  });
  const claudeOnly = await createDrive(config, {
    log: { log() {}, error() {}, info() {} },
    agentProviders: new Map([['claude-subscription', createFakeProvider({ id: 'claude-subscription' })]]),
  });
  drives.push(claudeOnly);
  const port = await new Promise((resolve) => claudeOnly.server.listen(0, '127.0.0.1', () => resolve(claudeOnly.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const res = await fetch(`${base}/agent/codex/sign-in`, { method: 'POST', headers: { Origin: base } });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /doesn't have Codex/);
});

test('only the owner: behind the gate, and never from another site', async () => {
  const before = logged().length;
  const gated = await host({ MARBLE_DRIVE_SECRET: 'connect-secret' });
  const routes = [
    ['POST', '/agent/claude/sign-in'], ['GET', '/agent/claude/sign-in'], ['POST', '/agent/claude/sign-in/code'], ['DELETE', '/agent/claude/sign-in'], ['POST', '/agent/claude/sign-out'],
    ['POST', '/agent/codex/sign-in'], ['GET', '/agent/codex/sign-in'], ['DELETE', '/agent/codex/sign-in'], ['POST', '/agent/codex/sign-out'],
  ];
  for (const [method, route] of routes) {
    const res = await gated.api(method, route, method === 'POST' ? { code: 'good-x#s' } : undefined);
    assert.equal(res.status, 401, `${method} ${route}`);
  }
  const open = await host();
  for (const [method, route] of routes.filter(([m]) => m !== 'GET')) {
    const cross = await open.api(method, route, method === 'POST' ? { code: 'good-x#s' } : undefined, { Origin: 'https://evil.example' });
    assert.equal(cross.status, 403, `${method} ${route} from another site`);
  }
  assert.equal(logged().length, before, 'nothing ran');
});
