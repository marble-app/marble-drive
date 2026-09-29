import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLeaseClient, decideMode } from '../server/hub/lease-client.js';
import { handle, Lease } from '../worker/src/index.js';

// The real Worker code behind a local HTTP server.
async function worker() {
  const objects = new Map();
  const env = {
    LEASE_TOKEN: 'tok',
    LEASE: {
      idFromName: (n) => n,
      get: (id) => {
        if (!objects.has(id)) {
          const m = new Map();
          objects.set(id, new Lease({ storage: { get: async (k) => m.get(k), put: async (k, v) => m.set(k, v) } }));
        }
        return objects.get(id);
      },
    },
  };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const headers = { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' };
    const response = await handle(new Request(`http://x${req.url}`, { method: req.method, headers, body: body || undefined }), env);
    res.writeHead(response.status, { 'content-type': 'application/json' });
    res.end(await response.text());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
async function settingsFor(url, machine = 'mac') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lease-client-'));
  return { HUB_DRIVE: 'bryan', HUB_MACHINE: machine, LEASE_URL: url, LEASE_TOKEN: 'tok', file: path.join(dir, 'hub.env') };
}

test('no hub settings: the drive has one home, so serve', async () => {
  assert.deepEqual(await decideMode({ settings: null, client: null }), { mode: 'serve', why: 'no hub settings: this drive has one home' });
});

test('the lease decides, and is remembered', async () => {
  const w = await worker();
  try {
    const s = await settingsFor(w.url, 'mac');
    const client = createLeaseClient({ settings: s });
    assert.equal((await decideMode({ settings: s, client })).mode, 'standby'); // Fly is home at first
    await client.move('mac', 0);
    assert.equal((await decideMode({ settings: s, client })).mode, 'serve');
    assert.equal((await client.cached()).home, 'mac');
  } finally {
    w.close();
  }
});

test('a move from a stale epoch throws with the status and the lease', async () => {
  const w = await worker();
  try {
    const client = createLeaseClient({ settings: await settingsFor(w.url) });
    await client.move('mac', 0);
    await assert.rejects(client.move('fly', 0), (err) => err.status === 409 && err.lease.home === 'mac');
  } finally {
    w.close();
  }
});

test('offline, the last lease decides', async () => {
  const w = await worker();
  const s = await settingsFor(w.url, 'mac');
  const online = createLeaseClient({ settings: s });
  await online.move('mac', 0);
  w.close();
  const offline = createLeaseClient({ settings: { ...s, LEASE_URL: 'http://127.0.0.1:1' }, cacheFile: path.join(path.dirname(s.file), 'lease-bryan.json'), timeoutMs: 500 });
  const decided = await decideMode({ settings: s, client: offline });
  assert.equal(decided.mode, 'serve');
  assert.match(decided.why, /unreachable.*last one seen/);
});

test('offline with no lease ever seen: standby', async () => {
  const s = await settingsFor('http://127.0.0.1:1', 'mac');
  const decided = await decideMode({ settings: s, client: createLeaseClient({ settings: s, timeoutMs: 500 }) });
  assert.equal(decided.mode, 'standby');
  assert.match(decided.why, /none remembered/);
});
