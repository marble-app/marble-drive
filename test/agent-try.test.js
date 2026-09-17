import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import test from 'node:test';

const { builtInProviders } = await import('../server/agent/providers/index.js');
const { tryProvider } = await import('../server/agent/try.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');
const { createDrive } = await import('../server/app.js');

const scratchDirs = async () => (await fsp.readdir(os.tmpdir())).filter((name) => /^marble-try-(drive|work)-/.test(name));

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

test('a try cleans up its scratch directories even when the drive fails to close', async () => {
  const before = await scratchDirs();
  const scripts = {
    rename: [
      { call: 'read_document', args: { path: 'garden' } },
      { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
      { say: 'Renamed the heading.' },
    ],
  };
  // The real close still runs (so the host actually shuts down); it just also
  // rejects, the way a close that fails partway through would.
  const flakyClose = async (config, options) => {
    const drive = await createDrive(config, options);
    const realClose = drive.close.bind(drive);
    drive.close = async () => {
      await realClose();
      throw new Error('close boom');
    };
    return drive;
  };

  const result = await tryProvider({
    providerId: 'fake',
    providers: new Map([['fake', createFakeProvider({ scripts })]]),
    prompt: 'script:rename',
    createDriveImpl: flakyClose,
  });
  assert.equal(result.status, 'completed');

  const after = await scratchDirs();
  assert.deepEqual(after.filter((name) => !before.includes(name)), [], 'no marble-try-* directory should survive a failed close');
});

test('a try leaves MARBLE_APPS as it found it, set or unset', async () => {
  const providers = new Map([['fake', createFakeProvider({ scripts: { hello: [{ say: 'hi' }] } })]]);
  const saved = process.env.MARBLE_APPS;
  try {
    process.env.MARBLE_APPS = '/somewhere/apps';
    await tryProvider({ providerId: 'fake', providers, prompt: 'script:hello' });
    assert.equal(process.env.MARBLE_APPS, '/somewhere/apps');

    delete process.env.MARBLE_APPS;
    await tryProvider({ providerId: 'fake', providers, prompt: 'script:hello' });
    assert.equal('MARBLE_APPS' in process.env, false);
  } finally {
    if (saved === undefined) delete process.env.MARBLE_APPS;
    else process.env.MARBLE_APPS = saved;
  }
});
