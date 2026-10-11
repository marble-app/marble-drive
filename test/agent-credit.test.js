// Starter credit on the drive (server/agent/credit.js, the claude-credit
// provider, and the routes that choose it): a drive with the credit settings
// and nothing of its own runs Claude on credit, says whose credit and how much
// is used, and marks a turn the proxy refused as Starter credit used up.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');
const { builtInProviders } = await import('../server/agent/providers/index.js');
const { createClaudeProvider, creditUsedUp } = await import('../server/agent/providers/claude.js');
const { createCreditReader, creditView } = await import('../server/agent/credit.js');

const quiet = { log() {}, error() {} };
const TOKEN = `mdc_${'5e'.repeat(24)}`;
const REFUSED = 'API Error: 402 {"type":"error","error":{"type":"billing_error","message":"Starter credit used up. Connect your Claude to keep going."}}';

// The credit proxy's balance route, answering this drive's token.
const proxy = { cap: 5, spent: 3.9, asked: [] };
const server = http.createServer((req, res) => {
  proxy.asked.push({ url: req.url, key: req.headers['x-api-key'] });
  if (req.url !== '/_credit/balance' || req.headers['x-api-key'] !== TOKEN) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end('{}');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ cap: proxy.cap, spent: proxy.spent, left: Math.max(0, proxy.cap - proxy.spent), by: 'Bryan' }));
});
const proxyBase = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/_credit`)));

const drives = [];
async function makeDrive({ credit = true, login = false, provider = 'claude-api' } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-credit-'));
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-credit-work-'));
  await fsp.writeFile(path.join(root, 'garden.mrbl'), '<!doctype html><html><head><title>Garden</title></head><body><p id="a">Hi</p></body></html>');
  const keys = path.join(work, 'agent-keys.local');
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_APPS: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_PROVIDER: provider,
    MARBLE_DRIVE_AGENT_WORKDIR: work,
    MARBLE_DRIVE_AGENT_KEYS: keys,
    MARBLE_DRIVE_ANTHROPIC_BASE: 'http://127.0.0.1:9',
    ...(credit ? { MARBLE_CREDIT_URL: proxyBase, MARBLE_CREDIT_TOKEN: TOKEN } : {}),
  });
  const subscription = createFakeProvider({ id: 'claude-subscription' });
  subscription.detect = async () => ({ installed: true, signedIn: login, detail: login ? 'signed in' : 'run `claude` once to sign in' });
  const api = createFakeProvider({ id: 'claude-api' });
  api.detect = async () => ({ installed: true, signedIn: false, detail: 'set ANTHROPIC_API_KEY' });
  const providers = new Map([['claude-subscription', subscription], ['claude-api', api]]);
  if (credit) {
    const onCredit = createFakeProvider({ id: 'claude-credit', scripts: { out: [{ fail: REFUSED }], hello: [{ say: 'done' }] } });
    onCredit.detect = async () => ({ installed: true, signedIn: true, detail: 'on starter credit' });
    onCredit.creditUsedUp = creditUsedUp;
    providers.set('claude-credit', onCredit);
  }
  const drive = await createDrive(config, { log: quiet, agentProviders: providers });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  drives.push(drive);
  const call = async (method, route, body) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: base },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  return { call, keys };
}

test.after(async () => {
  for (const drive of drives) await drive.close();
  server.closeAllConnections();
  server.close();
});

test('claude-credit is a provider only on a drive with both credit settings', () => {
  assert.equal(builtInProviders({ env: {} }).has('claude-credit'), false);
  assert.equal(builtInProviders({ env: { MARBLE_CREDIT_URL: 'https://marbledrive.app/_credit' } }).has('claude-credit'), false);
  const providers = builtInProviders({ env: { MARBLE_CREDIT_URL: 'https://marbledrive.app/_credit', MARBLE_CREDIT_TOKEN: TOKEN } });
  assert.equal(providers.get('claude-credit').id, 'claude-credit');
  assert.equal(providers.get('claude-credit').label, 'Claude');
});

test('claude-credit runs Claude Code exactly as claude-api does, pointed at the proxy with the drive token', () => {
  const env = { MARBLE_CREDIT_URL: 'https://marbledrive.app/_credit/', MARBLE_CREDIT_TOKEN: TOKEN, ANTHROPIC_API_KEY: 'sk-ant-not-this-one' };
  const onCredit = createClaudeProvider({ auth: 'credit', env }).spawn({ workspace: '/w', prompt: 'hi', capability: 'full', cwd: '/p' });
  const onKey = createClaudeProvider({ auth: 'api', env }).spawn({ workspace: '/w', prompt: 'hi', capability: 'full', cwd: '/p' });
  assert.deepEqual(onCredit.args, onKey.args);
  assert.equal(onCredit.env.ANTHROPIC_BASE_URL, 'https://marbledrive.app/_credit');
  assert.equal(onCredit.env.ANTHROPIC_API_KEY, TOKEN);
  assert.equal(onKey.env.ANTHROPIC_BASE_URL, undefined);
  assert.throws(() => createClaudeProvider({ auth: 'credit', env: {} }).spawn({ workspace: '/w', prompt: 'hi' }), /no starter credit/);
});

test('claude-credit is signed in when the drive has its settings, and knows the proxy refusal', async () => {
  const exec = async () => ({ code: 0, stdout: '{"loggedIn": false}', stderr: '', missing: false });
  const on = await createClaudeProvider({ auth: 'credit', exec, env: { MARBLE_CREDIT_URL: 'https://x/_credit', MARBLE_CREDIT_TOKEN: TOKEN } }).detect();
  assert.deepEqual(on, { installed: true, signedIn: true, detail: 'on starter credit' });
  assert.equal((await createClaudeProvider({ auth: 'credit', exec, env: {} }).detect()).signedIn, false);
  assert.equal(creditUsedUp(REFUSED), true);
  assert.equal(creditUsedUp('API Error: 402 billing_error'), true);
  assert.equal(creditUsedUp('Starter credit used up.'), true);
  assert.equal(creditUsedUp('API Error: 529 overloaded_error'), false);
  assert.equal(creditUsedUp("You've hit your limit"), false);
});

test('the reader asks with the token, keeps a reading half a minute, and is fresh on request', async () => {
  proxy.asked.length = 0;
  let t = 0;
  const reader = createCreditReader({ url: `${proxyBase}/`, token: TOKEN, now: () => t });
  assert.equal(reader.available, true);
  const first = await reader.read();
  assert.deepEqual(first, { cap: 5, spent: 3.9, left: 5 - 3.9, by: 'Bryan' });
  t = 10_000;
  await reader.read();
  assert.equal(proxy.asked.length, 1);
  await reader.read({ fresh: true });
  assert.equal(proxy.asked.length, 2);
  assert.equal(proxy.asked[0].key, TOKEN);
  assert.equal(createCreditReader({}).available, false);
  assert.equal(await createCreditReader({}).read(), null);
  assert.deepEqual(creditView(null, { active: true }), { available: true, active: true, known: false });
  assert.equal(creditView({ cap: 5, spent: 4.5, left: 0.5, by: null }).low, true);
  assert.equal(creditView({ cap: 5, spent: 5, left: 0, by: null }).usedUp, true);
});

test('a drive with credit and no key or login is on credit: the default, no key popup, and its line', async () => {
  proxy.spent = 3.9;
  const { call } = await makeDrive();
  const settings = (await call('GET', '/agent/settings')).body;
  assert.equal(settings.claudeAuth, 'credit');
  assert.equal(settings.defaultProvider, 'claude-credit');
  assert.equal(settings.credit.active, true);
  assert.equal(settings.credit.by, 'Bryan');
  assert.equal(settings.credit.cap, 5);
  assert.equal(settings.credit.spent, 3.9);
  assert.ok(!JSON.stringify(settings).includes(TOKEN), 'the token never reaches a page');
  const providers = (await call('GET', '/agent/providers')).body;
  const claude = providers.filter((p) => p.id.startsWith('claude'));
  assert.deepEqual(claude.map((p) => [p.id, p.default]), [['claude-credit', true]]);
  const setup = (await call('GET', '/agent/setup')).body;
  assert.equal(setup.needed, false, 'the key popup stays away');
  assert.equal(setup.credit.usedUp, false);
});

test('a drive whose credit is used up asks again, and says so', async () => {
  proxy.spent = 5;
  try {
    const { call } = await makeDrive();
    const setup = (await call('GET', '/agent/setup')).body;
    assert.equal(setup.needed, true);
    assert.equal(setup.credit.usedUp, true);
    const credit = (await call('GET', '/agent/credit?fresh=1')).body;
    assert.equal(credit.usedUp, true);
    assert.equal(credit.left, 0);
  } finally {
    proxy.spent = 3.9;
  }
});

test('a drive with its own login or key stays on it; credit is still there to choose', async () => {
  const signedIn = await makeDrive({ login: true, provider: 'claude-subscription' });
  const s = (await signedIn.call('GET', '/agent/settings')).body;
  assert.equal(s.claudeAuth, 'login');
  assert.equal(s.credit.active, false);

  const keyed = await makeDrive();
  await fsp.writeFile(keyed.keys, JSON.stringify({ anthropic: 'sk-ant-api03-mine' }), { mode: 0o600 });
  // The key store reads its file once; a save through the page is what a person does.
  await keyed.call('PUT', '/agent/settings', { keys: { anthropic: 'sk-ant-api03-mine' } });
  assert.equal((await keyed.call('GET', '/agent/settings')).body.claudeAuth, 'api');

  const chosen = await signedIn.call('PUT', '/agent/settings', { claudeAuth: 'credit', defaultProvider: 'claude-subscription' });
  assert.equal(chosen.body.claudeAuth, 'credit');
  assert.equal(chosen.body.defaultProvider, 'claude-credit');
  assert.equal((await signedIn.call('PUT', '/agent/settings', { claudeAuth: 'login' })).body.claudeAuth, 'login');
});

test('a drive without the credit settings is exactly as before', async () => {
  const { call } = await makeDrive({ credit: false });
  const settings = (await call('GET', '/agent/settings')).body;
  assert.equal(settings.claudeAuth, 'api');
  assert.equal(settings.credit, null);
  assert.equal((await call('GET', '/agent/credit')).body.available, false);
  assert.equal((await call('PUT', '/agent/settings', { claudeAuth: 'credit' })).body.claudeAuth, 'api', 'credit cannot be chosen');
  assert.equal((await call('GET', '/agent/setup')).body.credit, undefined);
});

test('a turn the proxy refused ends as Starter credit used up, marked for the page', async () => {
  const { call } = await makeDrive();
  const made = await call('POST', '/agent/conversations', { provider: 'claude-api' });
  assert.equal(made.status, 201);
  assert.equal(made.body.provider, 'claude-credit', 'a new Claude chat starts on the Claude that runs');
  const sent = await call('POST', `/agent/conversations/${made.body.id}/turns`, { prompt: 'script:out', context: { target: 'garden', viewing: 'garden', selection: [] } });
  const deadline = Date.now() + 8_000;
  let turn = null;
  while (Date.now() < deadline) {
    const { body } = await call('GET', `/agent/conversations/${made.body.id}`);
    turn = body.turns?.find((t) => t.id === sent.body.turnId);
    if (turn && !['queued', 'running'].includes(turn.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(turn.status, 'failed');
  assert.equal(turn.error, 'Starter credit used up.');
  assert.equal(turn.creditUsedUp, true);
  assert.equal(turn.usageStopped, undefined, 'not a usage window: nothing is handed off');
});
