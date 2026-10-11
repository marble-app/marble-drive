// One Claude, signed in either way. The Claude login and an API key are two
// back-ends (claude-subscription, claude-api), but a person sees one "Claude"
// and a switch in Agents settings that says which one pays. New conversations
// start on the chosen one; a conversation already started keeps its own.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');
const { createClaudeProvider } = await import('../server/agent/providers/claude.js');

async function host(env = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-auth-'));
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_WORKDIR: path.join(root, '..', `${path.basename(root)}-work`),
    MARBLE_DRIVE_AGENT_KEYS: path.join(root, '..', `${path.basename(root)}-keys`),
    ...env,
  });
  const drive = await createDrive(config, {
    log: { log() {}, error() {} },
    agentProviders: new Map([
      ['claude-subscription', createFakeProvider({ id: 'claude-subscription' })],
      ['claude-api', createFakeProvider({ id: 'claude-api' })],
      ['cursor', createFakeProvider({ id: 'cursor' })],
    ]),
  });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const api = async (method, route, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };
  return { api, close: () => drive.close() };
}

const claudes = (list) => list.filter((p) => p.id.startsWith('claude')).map((p) => p.id);

test('the agent list has one Claude: the login unless the sprite was made for an API key', async (t) => {
  const plain = await host({ MARBLE_DRIVE_AGENT_PROVIDER: 'claude-subscription' });
  t.after(plain.close);
  assert.deepEqual(claudes(await plain.api('GET', '/agent/providers')), ['claude-subscription']);
  assert.equal((await plain.api('GET', '/agent/settings')).claudeAuth, 'login');

  const keyed = await host({ MARBLE_DRIVE_AGENT_PROVIDER: 'claude-api' });
  t.after(keyed.close);
  assert.deepEqual(claudes(await keyed.api('GET', '/agent/providers')), ['claude-api']);
  assert.equal((await keyed.api('GET', '/agent/settings')).claudeAuth, 'api');
});

test('the switch decides which Claude a new conversation runs on; an old one keeps its own', async (t) => {
  const h = await host({ MARBLE_DRIVE_AGENT_PROVIDER: 'claude-subscription' });
  t.after(h.close);
  const before = await h.api('POST', '/agent/conversations', { provider: 'claude-subscription' });
  assert.equal(before.provider, 'claude-subscription');

  const saved = await h.api('PUT', '/agent/settings', { claudeAuth: 'api' });
  assert.equal(saved.claudeAuth, 'api');
  const list = await h.api('GET', '/agent/providers');
  assert.deepEqual(claudes(list), ['claude-api']);
  assert.ok(list.find((p) => p.id === 'claude-api').default, 'the switched Claude is still the default agent');

  // A page that still asks for the login gets the Claude the switch chose.
  const after = await h.api('POST', '/agent/conversations', { provider: 'claude-subscription' });
  assert.equal(after.provider, 'claude-api');
  assert.equal((await h.api('GET', `/agent/conversations/${before.id}`)).provider ?? before.provider, 'claude-subscription');

  assert.equal((await h.api('PUT', '/agent/settings', { claudeAuth: 'nonsense' })).claudeAuth, 'api', 'only login or api');
  const cursor = await h.api('POST', '/agent/conversations', { provider: 'cursor' });
  assert.equal(cursor.provider, 'cursor', 'other agents are untouched');
});

test('both back-ends are called Claude', () => {
  assert.equal(createClaudeProvider({ auth: 'api', env: {} }).label, 'Claude');
  assert.equal(createClaudeProvider({ auth: 'subscription', env: {} }).label, 'Claude');
});
