/** Discarding a conversation: the one way a chat stops existing rather than
 *  being filed. Only ever for a chat with nothing in it — the host decides
 *  that, not the page — and when it goes, the lists watching hear so.
 *
 *  Its own file rather than a test appended to agent-http.test.js, which
 *  other conversations rewrite wholesale.
 */
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-discard-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-discard-work-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';
process.env.MARBLE_DRIVE_AGENT_KEYS = path.join(WORK, 'agent-keys.local');

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const quiet = { log() {}, error() {} };

const SOURCE = `<!doctype html>
<html><head><title>Garden</title></head>
<body data-marble-id="b"><h1 data-marble-id="h">Research Garden</h1></body></html>
`;

const config = loadConfig({
  ...process.env,
  MARBLE_DRIVE_AGENTS: '1',
  MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
  MARBLE_DRIVE_AGENT_WORKDIR: WORK,
});
const drive = await createDrive(config, {
  log: quiet,
  agentProviders: new Map([['fake', createFakeProvider({ scripts: { hold: [{ silent: 20_000 }] } })]]),
});
await drive.createDocument('garden', SOURCE);
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;
test.after(() => drive.close?.());

const api = async (method, route, body) => {
  const response = await fetch(base + route, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const newChat = async () => (await api('POST', '/agent/conversations', { provider: 'fake' })).body.id;

test('a chat with nothing in it is discarded, and the summary stream says it is gone', async () => {
  const id = await newChat();
  const controller = new AbortController();
  const stream = await fetch(`${base}/agent/events?all=1`, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();

  const gone = await api('DELETE', `/agent/conversations/${id}`);
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body, { removed: true });

  let text = '';
  while (!text.includes('"removed":true')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  controller.abort();
  assert.match(text, new RegExp(`"id":"${id}"[^\\n]*"removed":true`), 'the listeners are told which chat went');

  assert.equal((await api('GET', `/agent/conversations/${id}`)).status, 404, 'it is not there any more');
  assert.equal((await api('GET', '/agent/conversations')).body.length, 0, 'and no list still holds it');
  await assert.rejects(fsp.stat(path.join(ROOT, '.marble', 'agents', id)), 'nothing is left on disk');
});

test('a chat that has been used is refused rather than discarded', async () => {
  const id = await newChat();
  await api('POST', `/agent/conversations/${id}/turns`, {
    prompt: 'script:hold',
    context: { target: 'garden', viewing: 'garden', selection: [] },
  });

  const refused = await api('DELETE', `/agent/conversations/${id}`);
  assert.equal(refused.status, 409, 'a chat with a turn in it is not thrown away');
  assert.equal((await api('GET', `/agent/conversations/${id}`)).status, 200, 'and it is still there');
});

test('a chat somebody named is refused too', async () => {
  const id = await newChat();
  await api('PATCH', `/agent/conversations/${id}`, { title: 'kept' });
  assert.equal((await api('DELETE', `/agent/conversations/${id}`)).status, 409);
  assert.equal((await api('GET', `/agent/conversations/${id}`)).body.meta.title, 'kept');
});

test('discarding the only chat in a group dissolves the group', async () => {
  const id = await newChat();
  const folder = await api('POST', '/agent/folders', { conversationIds: [id], name: 'just this' });
  assert.equal(folder.status, 201, JSON.stringify(folder.body));

  assert.equal((await api('DELETE', `/agent/conversations/${id}`)).status, 200);
  const { body } = await api('GET', '/agent/folders');
  assert.deepEqual(body.folders.filter((row) => row.id === folder.body.id), [], 'the empty group goes with it');
});
