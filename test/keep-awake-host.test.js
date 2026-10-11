// The host holds its sprite the moment a turn starts: the request that sends
// a turn is often the last connection, and a sprite pauses about a second
// after that.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

test('sending a turn holds the sprite before the next keep-awake check', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ka-host-'));
  const socket = path.join(root, '..', `${path.basename(root)}.sock`);
  const calls = [];
  const sprite = http.createServer((req, res) => {
    calls.push(req.method);
    req.resume();
    req.on('end', () => res.end('{}'));
  });
  await new Promise((resolve) => sprite.listen(socket, resolve));
  t.after(() => new Promise((resolve) => sprite.close(resolve)));

  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_SPRITE_SOCKET: socket,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_WORKDIR: path.join(root, '..', `${path.basename(root)}-work`),
    MARBLE_DRIVE_AGENT_KEYS: path.join(root, '..', `${path.basename(root)}-keys`),
  });
  const drive = await createDrive(config, {
    log: { log() {}, error() {}, info() {} },
    agentProviders: new Map([['fake', createFakeProvider({ scripts: { wait: [{ silent: 2_000 }, { say: 'done' }] } })]]),
  });
  t.after(() => drive.close());
  await drive.createDocument('garden', '<!doctype html><html><body data-marble-id="b"><p data-marble-id="p">x</p></body></html>', { label: 'test' });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const api = (method, route, body) => fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());

  await new Promise((r) => setTimeout(r, 100)); // the first check has run: nothing to hold
  assert.equal(calls.filter((m) => m === 'POST').length, 0);
  const { id } = await api('POST', '/agent/conversations', { provider: 'fake' });
  await api('POST', `/agent/conversations/${id}/turns`, { prompt: 'script:wait', context: { target: 'garden', viewing: 'garden', selection: [], also: [] } });
  const end = Date.now() + 500;
  while (Date.now() < end && !calls.includes('POST')) await new Promise((r) => setTimeout(r, 10));
  assert.ok(calls.includes('POST'), 'the sprite task was taken within half a second of the turn starting');
});
