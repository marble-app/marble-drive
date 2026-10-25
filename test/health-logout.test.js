// POST /health/logout: what marble-host asks a drive on the PC for before it
// removes it. Both CLIs' own logout, as Settings' Disconnect runs it, under
// the drive's home and with no key in the environment, and an answer that
// says what is true after. The `claude` and `codex` here are the fakes from
// test/fixtures (or a stand-in that will not sign out), first on PATH, and
// HOME is a scratch folder, so nothing of this machine's own logins is read
// or touched. Only marble-host may ask: on this machine, with the passphrase.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';
const HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'health-logout-home-'));
process.env.HOME = HOME;
// Keys the host's own environment may hold; none may reach a logout.
process.env.ANTHROPIC_API_KEY = 'sk-ant-never-handed-over';
process.env.OPENAI_API_KEY = 'sk-never-handed-over';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { signOutClis } = await import('../server/health-logout.js');

const CLAUDE_FAKE = fileURLToPath(new URL('./fixtures/fake-claude-auth.mjs', import.meta.url));
const CODEX_FAKE = fileURLToPath(new URL('./fixtures/fake-codex-login.mjs', import.meta.url));
const bin = await fsp.mkdtemp(path.join(os.tmpdir(), 'health-logout-bin-'));
const fakeLog = path.join(bin, 'log');
await fsp.writeFile(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${CLAUDE_FAKE}" "$@" --log "${fakeLog}"\n`, { mode: 0o755 });
await fsp.writeFile(path.join(bin, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "${CODEX_FAKE}" "$@" --log "${fakeLog}"\n`, { mode: 0o755 });
// A Claude Code whose logout does not take, and no Codex at all.
const stuck = await fsp.mkdtemp(path.join(os.tmpdir(), 'health-logout-stuck-'));
await fsp.writeFile(path.join(stuck, 'claude'), '#!/bin/sh\nif [ "$2" = status ]; then echo \'{"loggedIn": true, "authMethod": "claude.ai"}\'; exit 0; fi\necho "could not reach the server" >&2\nexit 1\n', { mode: 0o755 });
const nothing = await fsp.mkdtemp(path.join(os.tmpdir(), 'health-logout-none-'));
const PATH = process.env.PATH;
process.env.PATH = `${bin}:${PATH}`;

const claudeLogin = path.join(HOME, '.claude', 'fake-login.json');
const codexLogin = path.join(HOME, '.codex', 'fake-login.json');
const signIn = async () => {
  for (const file of [claudeLogin, codexLogin]) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '{"fake":true}');
  }
};
const logged = () => (fs.existsSync(fakeLog) ? fs.readFileSync(fakeLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const drives = [];
test.after(async () => {
  for (const drive of drives) await drive.close();
  for (const dir of [HOME, bin, stuck, nothing]) await fsp.rm(dir, { recursive: true, force: true });
});
test.beforeEach(async () => {
  process.env.PATH = `${bin}:${PATH}`;
  await fsp.rm(claudeLogin, { force: true });
  await fsp.rm(codexLogin, { force: true });
  await fsp.rm(fakeLog, { force: true });
});

const SECRET = 'pw-ana-1234';
async function served(env = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'health-logout-drive-'));
  const config = loadConfig({ ...process.env, MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: SECRET, MARBLE_GUEST: '1', MARBLE_DRIVE_AGENT_KEYS: path.join(root, '..', `${path.basename(root)}-keys`), ...env });
  const drive = await createDrive(config, { log: { log() {}, error() {}, info() {} }, agents: false });
  drives.push(drive);
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  // As marble-host asks: a plain POST, with no Origin and nothing a browser adds.
  const ask = ({ headers = { authorization: `Bearer ${SECRET}` }, method = 'POST' } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/health/logout', method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
  return { ask };
}

test('signed in to both: each CLI\'s own logout runs, under the drive\'s home with no key, and both are signed out', async () => {
  const { ask } = await served();
  await signIn();
  const res = await ask();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { claude: 'signed-out', codex: 'signed-out' });
  assert.ok(!fs.existsSync(claudeLogin), 'Claude Code forgot its login');
  assert.ok(!fs.existsSync(codexLogin), 'Codex forgot its login');
  const runs = logged();
  assert.deepEqual(runs.map((r) => r.args.join(' ')), ['auth status --json', 'auth logout', 'auth status --json']);
  for (const run of runs) assert.deepEqual(run.keys, [], 'no key and no passphrase reach the CLI');
});

test('signed in to neither: nothing is signed out, and no logout runs', async () => {
  const { ask } = await served();
  const res = await ask();
  assert.deepEqual(res.body, { claude: 'was-not-signed-in', codex: 'was-not-signed-in' });
  assert.deepEqual(logged().map((r) => r.args.join(' ')), ['auth status --json']);
});

test('a logout that does not take is a failure; a CLI that is not here was not signed in', async () => {
  const { ask } = await served();
  process.env.PATH = stuck;
  assert.deepEqual((await ask()).body, { claude: 'failed', codex: 'was-not-signed-in' });
  process.env.PATH = nothing;
  assert.deepEqual((await ask()).body, { claude: 'was-not-signed-in', codex: 'was-not-signed-in' });
  process.env.PATH = `${bin}:${PATH}`;
  await signIn();
  assert.deepEqual(await signOutClis({ env: { ...process.env, PATH: nothing } }), { claude: 'was-not-signed-in', codex: 'was-not-signed-in' });
  assert.ok(fs.existsSync(claudeLogin), 'nothing ran');
});

test('only marble-host may ask, on this machine with the drive\'s own passphrase; anyone else signs nobody out', async () => {
  const { ask } = await served();
  await signIn();
  const refused = [
    ['without the passphrase', {}],
    ["with another drive's passphrase", { authorization: 'Bearer pw-bob-5678' }],
    ['through the edge', { authorization: `Bearer ${SECRET}`, 'x-forwarded-host': 'ana.marbledrive.app' }],
    ['through marble-host\'s router', { authorization: `Bearer ${SECRET}`, 'x-forwarded-for': '203.0.113.9' }],
    ['through the tunnel', { authorization: `Bearer ${SECRET}`, 'cf-ray': 'abc' }],
  ];
  for (const [why, headers] of refused) {
    const res = await ask({ headers });
    assert.equal(res.status, 404, why);
    assert.deepEqual(res.body, { error: 'not found' }, why);
  }
  assert.equal((await ask({ method: 'GET' })).status, 404, 'a GET signs nobody out');
  // A page on another drive is turned away by the origin check before that.
  assert.equal((await ask({ headers: { origin: 'https://bob.marbledrive.app' } })).status, 403);
  assert.ok(fs.existsSync(claudeLogin) && fs.existsSync(codexLogin), 'nobody was signed out');
  assert.deepEqual(logged(), [], 'no CLI ran');
});

test('on a drive that is not someone else\'s, there is no logout to ask for', async () => {
  const { ask } = await served({ MARBLE_GUEST: '' });
  await signIn();
  const res = await ask();
  assert.equal(res.status, 404);
  assert.ok(fs.existsSync(claudeLogin), 'the owner\'s own login is the terminal\'s too, and stays');
});
