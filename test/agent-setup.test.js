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

const drives = [];
/** A drive of its own per test: detection is cached, so a login that changes
 *  mid-test would not be seen, and each test wants its own key file. */
async function makeDrive({ login = false, claude = true } = {}) {
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
  });
  const providers = new Map([['fake', createFakeProvider()]]);
  if (claude) {
    const subscription = createFakeProvider({ id: 'claude-subscription' });
    subscription.detect = async () => ({ installed: true, signedIn: login, detail: login ? 'signed in' : 'run `claude` once to sign in' });
    providers.set('claude-subscription', subscription);
    providers.set('claude-api', createFakeProvider({ id: 'claude-api' }));
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
