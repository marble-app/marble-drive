// A forgotten tab lets its sprite sleep: the host closes a stream whose tab
// has not been used for MARBLE_DRIVE_STREAM_UNUSED_MINUTES, tells its reconnect
// to stop (204), and lets it back once the tab says it is used (/tab/alive).

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const { createFakeProvider } = await import('./fixtures/fake-provider.js');

async function host({ agents = false } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-tab-alive-'));
  // 0.005 minutes: a tab is forgotten after 300 ms.
  const config = loadConfig({
    ...(agents ? process.env : {}),
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_STREAM_UNUSED_MINUTES: '0.005',
    ...(agents ? {
      MARBLE_DRIVE_AGENTS: '1',
      MARBLE_DRIVE_AGENT_NAMING: '0',
      MARBLE_DRIVE_AGENT_WORKDIR: path.join(root, '..', `${path.basename(root)}-work`),
      MARBLE_DRIVE_AGENT_KEYS: path.join(root, '..', `${path.basename(root)}-keys`),
    } : {}),
  });
  const drive = await createDrive(config, {
    log: { log() {}, error() {}, info() {} },
    ...(agents ? { agentProviders: new Map([['claude-subscription', createFakeProvider({ id: 'claude-subscription' })]]) } : {}),
  });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  return { drive, base };
}

const health = async (base) => (await (await fetch(`${base}/health`)).json()).streams;

test('an unused tab loses its stream, is refused on reconnect, and is let back once used', async (t) => {
  const { drive, base } = await host();
  t.after(() => drive.close());

  const first = await fetch(`${base}/events?drive=1&tab=t1`, { headers: { Accept: 'text/event-stream' } });
  assert.equal(first.status, 200);
  const reader = first.body.getReader();
  await reader.read(); // ': connected'
  assert.equal(await health(base), 1);

  // Nobody reports using the tab: the host closes the stream.
  let ended = false;
  const deadline = Date.now() + 3_000;
  while (!ended && Date.now() < deadline) ended = (await reader.read()).done;
  assert.equal(ended, true, 'the stream was closed');
  assert.equal(await health(base), 0);

  const again = await fetch(`${base}/events?drive=1&tab=t1`);
  assert.equal(again.status, 204, 'EventSource stops reconnecting on 204');

  const alive = await fetch(`${base}/tab/alive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab: 't1' }) });
  assert.equal(alive.status, 204);
  const back = await fetch(`${base}/events?drive=1&tab=t1`);
  assert.equal(back.status, 200);
  await back.body.cancel();
});

test('the agent stream follows the same rule', async (t) => {
  const { drive, base } = await host({ agents: true });
  t.after(() => drive.close());
  const first = await fetch(`${base}/agent/events?all=1&tab=t2`, { headers: { Accept: 'text/event-stream' } });
  assert.equal(first.status, 200);
  const reader = first.body.getReader();
  let ended = false;
  const deadline = Date.now() + 3_000;
  while (!ended && Date.now() < deadline) ended = (await reader.read()).done;
  assert.equal(ended, true, 'the stream was closed');
  assert.equal((await fetch(`${base}/agent/events?all=1&tab=t2`)).status, 204);
});
