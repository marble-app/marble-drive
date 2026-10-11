/** Reading a conversation a few turns at a time over HTTP: the page opens a
 *  long chat on its last turns, fetches the ones before as it scrolls up, and
 *  a page holding a copy asks only for what came after it.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-slices-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-slices-work-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';
process.env.MARBLE_DRIVE_AGENT_KEYS = path.join(WORK, 'agent-keys.local');

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const config = loadConfig({
  ...process.env,
  MARBLE_DRIVE_AGENTS: '1',
  MARBLE_DRIVE_AGENT_NAMING: '0',
  MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
  MARBLE_DRIVE_AGENT_WORKDIR: WORK,
});
const drive = await createDrive(config, {
  log: { log() {}, error() {} },
  agentProviders: new Map([['fake', createFakeProvider({ scripts: {} })]]),
});
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;
test.after(() => drive.close?.());

const get = async (route) => (await fetch(base + route)).json();

test('a chat is read as its last turns, then the turns before, then what came after', async () => {
  const store = drive.agents.store;
  const { id } = await store.createConversation({ provider: 'fake' });
  for (let i = 1; i <= 7; i += 1) {
    const turn = `${id}-t${i}`;
    await store.appendEvent(id, { type: 'user', turn, text: `ask ${i}` });
    await store.appendEvent(id, { type: 'turn.started', turn });
    await store.appendEvent(id, { type: 'text', turn, text: `answer ${i}` });
    await store.appendEvent(id, { type: 'turn.completed', turn });
  }
  const all = await get(`/agent/conversations/${id}`);
  assert.equal(all.events.length, 28, 'without turns=, everything, as before');
  assert.equal(all.earlier, undefined);

  const tail = await get(`/agent/conversations/${id}?turns=3`);
  assert.equal(tail.meta.id, id);
  assert.deepEqual(tail.events.filter((e) => e.type === 'user').map((e) => e.text), ['ask 5', 'ask 6', 'ask 7']);
  assert.equal(tail.earlier, `${id}-t5`);
  assert.equal(tail.older.length, 4);
  assert.equal(tail.seq, 28);

  const before = await get(`/agent/conversations/${id}?turns=3&before=${tail.earlier}`);
  assert.deepEqual(before.events.filter((e) => e.type === 'user').map((e) => e.text), ['ask 2', 'ask 3', 'ask 4']);
  const top = await get(`/agent/conversations/${id}?turns=3&before=${before.earlier}`);
  assert.deepEqual(top.events.map((e) => e.seq), [1, 2, 3, 4]);
  assert.equal(top.earlier, null);

  const meta = await get(`/agent/conversations/${id}?turns=0`);
  assert.deepEqual(meta.events, []);
  assert.equal(meta.meta.id, id);

  await store.appendEvent(id, { type: 'turn.undone', turn: `${id}-t7`, reverted: 1, kept: 0 });
  const after = await get(`/agent/conversations/${id}?after=${tail.seq}`);
  assert.deepEqual(after.events.map((e) => e.type), ['turn.undone']);
});
