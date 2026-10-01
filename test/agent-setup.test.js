// The first-visit check: can this drive run Claude at all? Signed in to a
// Claude login, or holding an API key. When it can do neither, the page offers
// a key field (runtime/agent-ui.js, <marble-agent-setup>), and POST
// /agent/setup checks the key with Anthropic before it is kept.
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

const quiet = { log() {}, error() {} };
const GOOD = 'sk-ant-api03-good';

// Anthropic, as far as a key check can tell: the model list answers a key it
// knows, refuses one it does not, and can be down.
let anthropicDown = false;
const seen = [];
const anthropic = http.createServer((req, res) => {
  seen.push({ url: req.url, key: req.headers['x-api-key'], version: req.headers['anthropic-version'] });
  if (anthropicDown) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'down' } }));
  }
  if (req.headers['x-api-key'] !== GOOD) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }));
});
const anthropicBase = await new Promise((resolve) => {
  anthropic.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${anthropic.address().port}`));
});

// OpenAI, the same way: the model list, with the key as a bearer token.
const OPENAI_GOOD = 'sk-proj-good';
let openaiDown = false;
const openaiSeen = [];
const openai = http.createServer((req, res) => {
  openaiSeen.push({ url: req.url, authorization: req.headers.authorization });
  if (openaiDown) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'down' } }));
  }
  if (req.headers.authorization !== `Bearer ${OPENAI_GOOD}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ object: 'list', data: [] }));
});
const openaiBase = await new Promise((resolve) => {
  openai.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${openai.address().port}`));
});

const drives = [];
/** A drive of its own per test: detection is cached, so a login that changes
 *  mid-test would not be seen, and each test wants its own key file. */
async function makeDrive({ login = false, claude = true, codex = null } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-setup-'));
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-setup-work-'));
  const keys = path.join(work, 'agent-keys.local');
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_APPS: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_PROVIDER: claude ? 'claude-subscription' : 'fake',
    MARBLE_DRIVE_AGENT_WORKDIR: work,
    MARBLE_DRIVE_AGENT_KEYS: keys,
    MARBLE_DRIVE_ANTHROPIC_BASE: anthropicBase,
    MARBLE_DRIVE_OPENAI_BASE: openaiBase,
  });
  const providers = new Map([['fake', createFakeProvider()]]);
  if (claude) {
    const subscription = createFakeProvider({ id: 'claude-subscription' });
    subscription.detect = async () => ({ installed: true, signedIn: login, detail: login ? 'signed in' : 'run `claude` once to sign in' });
    providers.set('claude-subscription', subscription);
    providers.set('claude-api', createFakeProvider({ id: 'claude-api' }));
  }
  if (codex) {
    // Signed in by its login, or by the key the drive keeps — the real
    // provider's answer, read the same way.
    const agent = createFakeProvider({ id: 'codex' });
    agent.detect = async () => {
      const keyed = JSON.parse(await fsp.readFile(keys, 'utf8').catch(() => '{}')).openai;
      if (!codex.installed) return { installed: false, signedIn: false, detail: 'codex is not installed' };
      return { installed: true, signedIn: Boolean(codex.login || keyed), detail: '' };
    };
    providers.set('codex', agent);
  }
  const drive = await createDrive(config, { log: quiet, agentProviders: providers });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  drives.push(drive);
  const api = async (method, route, body) => {
    const response = await fetch(base + route, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: base },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  return { api, keys };
}

test.after(async () => {
  for (const drive of drives) await drive.close();
  anthropic.closeAllConnections();
  anthropic.close();
  openai.closeAllConnections();
  openai.close();
});

test('a drive with neither a Claude login nor a key asks for one', async () => {
  const { api } = await makeDrive();
  const { status, body } = await api('GET', '/agent/setup');
  assert.equal(status, 200);
  assert.deepEqual({ needed: body.needed, login: body.login, key: body.key }, { needed: true, login: false, key: false });
});

test('a drive signed in to a Claude login asks for nothing', async () => {
  const { api } = await makeDrive({ login: true });
  const { body } = await api('GET', '/agent/setup');
  assert.equal(body.needed, false);
  assert.equal(body.login, true);
});

test('a drive with no Claude agent at all asks for nothing', async () => {
  const { api } = await makeDrive({ claude: false });
  assert.equal((await api('GET', '/agent/setup')).body.needed, false);
});

test('a key Anthropic accepts is kept, and Claude switches to it', async () => {
  const { api, keys } = await makeDrive();
  seen.length = 0;
  const { status, body } = await api('POST', '/agent/setup', { key: `  ${GOOD}\n` });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.checked, true);
  assert.equal(body.needed, false);
  assert.equal(body.key, true);
  // Asked about with the key itself, on the model list, which costs nothing.
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /^\/v1\/models/);
  assert.equal(seen[0].key, GOOD, 'trimmed before it is sent');
  assert.ok(seen[0].version, 'with an anthropic-version');

  const settings = (await api('GET', '/agent/settings')).body;
  assert.equal(settings.claudeAuth, 'api');
  assert.equal(settings.keys.anthropic, true);
  assert.ok((await fsp.readFile(keys, 'utf8')).includes(GOOD));
  // Never handed back to a page.
  assert.ok(!JSON.stringify(body).includes(GOOD));
  assert.ok(!JSON.stringify(settings).includes(GOOD));
});

test('a key Anthropic refuses is not kept, and the page is told why', async () => {
  const { api, keys } = await makeDrive();
  const { status, body } = await api('POST', '/agent/setup', { key: 'sk-ant-api03-wrong' });
  assert.equal(status, 400);
  assert.match(body.error, /didn.t accept/i);
  assert.equal((await api('GET', '/agent/setup')).body.needed, true);
  await assert.rejects(fsp.readFile(keys, 'utf8'), { code: 'ENOENT' });
});

test('a key that cannot be checked is kept anyway, and says it was not checked', async () => {
  const { api } = await makeDrive();
  anthropicDown = true;
  try {
    const { status, body } = await api('POST', '/agent/setup', { key: 'sk-ant-api03-unseen' });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.checked, false);
    assert.equal(body.needed, false);
  } finally {
    anthropicDown = false;
  }
});

test('a blank or broken paste is refused before anyone is asked', async () => {
  const { api } = await makeDrive();
  seen.length = 0;
  for (const key of ['', '   ', 'sk-ant one two', 42]) {
    const { status, body } = await api('POST', '/agent/setup', { key });
    assert.equal(status, 400, `${JSON.stringify(key)} → ${JSON.stringify(body)}`);
  }
  assert.equal(seen.length, 0);
});

test('a drive that has Codex too offers both, and a drive whose Codex is signed in asks nothing', async () => {
  const both = await makeDrive({ codex: { installed: true } });
  const asked = (await both.api('GET', '/agent/setup')).body;
  assert.equal(asked.needed, true);
  assert.deepEqual(asked.offers, ['claude', 'codex']);
  assert.deepEqual(asked.codex, { installed: true, signedIn: false, key: false });

  const ready = await makeDrive({ codex: { installed: true, login: true } });
  const body = (await ready.api('GET', '/agent/setup')).body;
  assert.equal(body.needed, false, 'a ChatGPT login is an agent the drive can run');
  assert.equal(body.codex.signedIn, true);
});

test('a Codex that is not installed is not offered', async () => {
  const { api } = await makeDrive({ codex: { installed: false } });
  const body = (await api('GET', '/agent/setup')).body;
  assert.equal(body.needed, true);
  assert.deepEqual(body.offers, ['claude']);
});

test('a Codex-only drive asks for the key Codex takes', async () => {
  const { api } = await makeDrive({ claude: false, codex: { installed: true } });
  const body = (await api('GET', '/agent/setup')).body;
  assert.equal(body.needed, true);
  assert.deepEqual(body.offers, ['codex']);
});

test('a key OpenAI accepts is kept for Codex, and Codex becomes the agent new chats start on', async () => {
  const { api, keys } = await makeDrive({ codex: { installed: true } });
  openaiSeen.length = 0;
  seen.length = 0;
  const { status, body } = await api('POST', '/agent/setup', { provider: 'codex', key: ` ${OPENAI_GOOD}\n` });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.checked, true);
  assert.equal(body.needed, false);
  assert.equal(body.codex.key, true);
  assert.equal(openaiSeen.length, 1);
  assert.match(openaiSeen[0].url, /^\/v1\/models/);
  assert.equal(openaiSeen[0].authorization, `Bearer ${OPENAI_GOOD}`, 'trimmed before it is sent');
  assert.equal(seen.length, 0, 'Anthropic is not asked about an OpenAI key');

  const settings = (await api('GET', '/agent/settings')).body;
  assert.equal(settings.keys.openai, true);
  assert.equal(settings.keys.anthropic, false);
  assert.equal(settings.defaultProvider, 'codex');
  assert.ok((await fsp.readFile(keys, 'utf8')).includes(OPENAI_GOOD));
  assert.ok(!JSON.stringify(body).includes(OPENAI_GOOD));
  assert.ok(!JSON.stringify(settings).includes(OPENAI_GOOD));
});

test('a Codex key leaves a Claude that can already run as the default', async () => {
  const { api } = await makeDrive({ login: true, codex: { installed: true } });
  const { status } = await api('POST', '/agent/setup', { provider: 'codex', key: OPENAI_GOOD });
  assert.equal(status, 200);
  assert.equal((await api('GET', '/agent/settings')).body.defaultProvider, 'claude-subscription');
});

test('a key OpenAI refuses is not kept, and the page is told why', async () => {
  const { api, keys } = await makeDrive({ codex: { installed: true } });
  const { status, body } = await api('POST', '/agent/setup', { provider: 'codex', key: 'sk-proj-wrong' });
  assert.equal(status, 400);
  assert.match(body.error, /OpenAI didn.t accept/);
  await assert.rejects(fsp.readFile(keys, 'utf8'), { code: 'ENOENT' });
});

test('an OpenAI key that cannot be checked is kept anyway, and says so', async () => {
  const { api } = await makeDrive({ codex: { installed: true } });
  openaiDown = true;
  try {
    const { status, body } = await api('POST', '/agent/setup', { provider: 'codex', key: 'sk-proj-unseen' });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.checked, false);
    assert.equal(body.needed, false);
  } finally {
    openaiDown = false;
  }
});

test('an Anthropic key pasted for Codex, and Codex on a drive without it, are refused before anyone is asked', async () => {
  const { api } = await makeDrive({ codex: { installed: true } });
  openaiSeen.length = 0;
  const wrong = await api('POST', '/agent/setup', { provider: 'codex', key: 'sk-ant-api03-good' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /Anthropic key/);
  const none = await makeDrive();
  assert.equal((await none.api('POST', '/agent/setup', { provider: 'codex', key: OPENAI_GOOD })).status, 400);
  assert.equal(openaiSeen.length, 0);
});
