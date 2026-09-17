import assert from 'node:assert/strict';
import test from 'node:test';

const { builtInProviders } = await import('../server/agent/providers/index.js');
const { tryProvider } = await import('../server/agent/try.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

test('the built-in providers are Claude on either billing, and Cursor', () => {
  const providers = builtInProviders({ env: {} });
  assert.deepEqual([...providers.keys()], ['claude-subscription', 'claude-api', 'cursor']);
  for (const provider of providers.values()) {
    for (const member of ['detect', 'prepare', 'spawn', 'parse']) assert.equal(typeof provider[member], 'function', `${provider.id}.${member}`);
  }
});

test('a try runs one real turn against a scratch drive and reports what it did', async () => {
  const scripts = {
    rename: [
      { call: 'read_document', args: { path: 'garden' } },
      { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
      { say: 'Renamed the heading.' },
    ],
  };
  const result = await tryProvider({
    providerId: 'fake',
    providers: new Map([['fake', createFakeProvider({ scripts })]]),
    prompt: 'script:rename',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.applied, 1);
  assert.equal(result.heading, 'Backlog');
  assert.ok(result.events.includes('tool.call'));
  assert.ok(result.events.includes('ops.applied'));
});

test('a try that fails says why', async () => {
  const result = await tryProvider({
    providerId: 'fake',
    providers: new Map([['fake', createFakeProvider({ scripts: { broken: [{ fail: 'You have hit your usage limit' }] } })]]),
    prompt: 'script:broken',
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'You have hit your usage limit');
  assert.equal(result.heading, 'Research Garden');
});

test('an unknown provider is refused before anything starts', async () => {
  await assert.rejects(tryProvider({ providerId: 'nope', providers: new Map() }), /no provider "nope"/);
});
