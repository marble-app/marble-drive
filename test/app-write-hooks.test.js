import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-hooks-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const engine = await import('../server/engine.js');
const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const quiet = { log() {}, error() {} };
const drive = await createDrive(loadConfig(), { log: quiet });

const SOURCE = `<!doctype html>
<html><head><title>Hooks</title></head>
<body data-marble-id="b0">
  <h1 data-marble-id="h1">Title</h1>
  <ul data-marble-id="l1">
    <li data-marble-id="i1">One</li>
    <li data-marble-id="i2">Two</li>
  </ul>
</body></html>
`;

test('the engine exposes what the agent tools need', () => {
  for (const name of ['parseSource', 'indexIds', 'sliceOf', 'applyOp', 'collectSlices', 'repairOps', 'validateOps']) {
    assert.equal(typeof engine[name], 'function', name);
  }
});

test('prepare can refuse a batch, and nothing is written', async () => {
  await drive.createDocument('hooks-refuse', SOURCE, { label: 'test' });
  const result = await drive.writeOps('hooks-refuse', [], {
    client: 'agent:x',
    prepare: async () => ({ refused: { reason: 'stale' } }),
  });
  assert.deepEqual(result.refused, { reason: 'stale' });
  assert.equal(result.applied, 0);
  assert.equal(await drive.store.read('hooks-refuse'), SOURCE);
});

test('prepare can replace the ops, and after sees the source on both sides', async () => {
  await drive.createDocument('hooks-apply', SOURCE, { label: 'test' });
  let seen = null;
  const result = await drive.writeOps('hooks-apply', [], {
    client: 'agent:x',
    prepare: async (source) => {
      assert.equal(source, SOURCE);
      return { ops: [{ type: 'setText', id: 'h1', text: 'Renamed' }] };
    },
    after: (before, next) => {
      seen = { before, next };
    },
  });
  assert.equal(result.applied, 1);
  assert.equal(seen.before, SOURCE);
  assert.match(seen.next, />Renamed</);
  assert.match(await drive.store.read('hooks-apply'), />Renamed</);
});

test('a gesture without hooks still writes the way it always did', async () => {
  await drive.createDocument('hooks-plain', SOURCE, { label: 'test' });
  const result = await drive.writeOps('hooks-plain', [{ type: 'setText', id: 'i1', text: 'Uno' }], { client: 'tab' });
  assert.equal(result.applied, 1);
  assert.match(await drive.store.read('hooks-plain'), />Uno</);
});

test.after(() => drive.close());
