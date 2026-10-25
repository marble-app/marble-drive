// The router (server/host/router.js), the tunnel's one way in: nothing but a
// 401 without the Worker's key, its two headers taken off before a drive
// sees the request, X-Forwarded-For added so no drive takes it for a local
// one, the Worker's X-Forwarded-Host and -Proto passed on as they came, both
// directions streamed, a browser that leaves cutting the drive's request too,
// and a drive that isn't running answered with the resting page.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import { createRouter, forwardHeaders } from '../server/host/router.js';
import { freePort, listen, quiet } from './fixtures/host.js';

const KEY = 'the-worker-key';

async function rig({ drives = {}, health, onPoke = () => {} } = {}) {
  const router = createRouter({ key: KEY, lookup: (name) => drives[name] ?? null, health, onPoke, log: quiet });
  const port = await router.listen(0);
  return { port, close: () => router.close() };
}

/** One request to the router: resolves { status, headers, body }. */
function ask(port, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

const keyed = (drive, more = {}) => ({ 'x-marble-host-key': KEY, ...(drive ? { 'x-marble-drive': drive } : {}), ...more });

test('without the Worker\'s key, a 401 and nothing forwarded', async (t) => {
  let reached = 0;
  const guest = await listen((req, res) => {
    reached += 1;
    res.end('ok');
  });
  const r = await rig({ drives: { ana: { state: 'running', port: guest.port } } });
  t.after(async () => {
    await r.close();
    await guest.close();
  });
  for (const headers of [{ 'x-marble-drive': 'ana' }, { 'x-marble-drive': 'ana', 'x-marble-host-key': 'wrong' }, { 'x-marble-drive': 'ana', 'x-marble-host-key': '' }, {}]) {
    const res = await ask(r.port, { headers });
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.deepEqual(JSON.parse(res.body), { error: 'unauthorised' });
  }
  const health = await ask(r.port, { path: '/_host/health' });
  assert.equal(health.status, 401, 'its own paths too');
  const upload = await ask(r.port, { method: 'POST', headers: { 'x-marble-drive': 'ana' }, body: 'x'.repeat(100_000) });
  assert.equal(upload.status, 401);
  assert.equal(reached, 0);
});

test('the drive gets the request without the two headers, with X-Forwarded-For, and the Worker\'s forwarded host and proto as they came', async (t) => {
  let seen = null;
  const guest = await listen((req, res) => {
    seen = { url: req.url, method: req.method, headers: req.headers };
    res.writeHead(201, { 'x-from': 'ana', connection: 'keep-alive' });
    res.end('made');
  });
  const r = await rig({ drives: { ana: { state: 'running', port: guest.port } } });
  t.after(async () => {
    await r.close();
    await guest.close();
  });
  const res = await ask(r.port, {
    method: 'POST',
    path: '/a/Notes?x=1',
    headers: keyed('ana', { 'x-forwarded-host': 'ana.marbledrive.app', 'x-forwarded-proto': 'https', cookie: '__Host-marble_drive=c', origin: 'https://ana.marbledrive.app', 'content-type': 'text/plain', connection: 'x-secret-hop', 'x-secret-hop': 'gone', te: 'trailers' }),
    body: 'hello',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body, 'made');
  assert.equal(res.headers['x-from'], 'ana');
  assert.equal(seen.url, '/a/Notes?x=1');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers['x-marble-drive'], undefined);
  assert.equal(seen.headers['x-marble-host-key'], undefined);
  assert.equal(seen.headers['x-forwarded-for'], '127.0.0.1');
  assert.equal(seen.headers['x-forwarded-host'], 'ana.marbledrive.app');
  assert.equal(seen.headers['x-forwarded-proto'], 'https');
  assert.equal(seen.headers.origin, 'https://ana.marbledrive.app');
  assert.equal(seen.headers.cookie, '__Host-marble_drive=c');
  assert.equal(seen.headers['x-secret-hop'], undefined, 'a header Connection names is hop-by-hop');
  assert.equal(seen.headers.te, undefined);

  // One the tunnel already forwarded is added to, never replaced.
  await ask(r.port, { headers: keyed('ana', { 'x-forwarded-for': '203.0.113.9' }) });
  assert.equal(seen.headers['x-forwarded-for'], '203.0.113.9, 127.0.0.1');
  assert.deepEqual(forwardHeaders({ 'x-marble-drive': 'a', 'X-Marble-Host-Key': 'k', host: 'pc-host.marbledrive.app' }, '::1'), { host: 'pc-host.marbledrive.app', 'x-forwarded-for': '::1' });
});

test('a live update stream reaches the browser as the drive writes it', async (t) => {
  let more = null;
  const guest = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write('data: one\n\n');
    more = () => res.end('data: two\n\n');
  });
  const r = await rig({ drives: { ana: { state: 'running', port: guest.port } } });
  t.after(async () => {
    await r.close();
    await guest.close();
  });
  const req = http.request({ host: '127.0.0.1', port: r.port, path: '/events', headers: keyed('ana', { accept: 'text/event-stream' }) });
  req.end();
  const [res] = await once(req, 'response');
  assert.equal(res.headers['content-type'], 'text/event-stream');
  res.setEncoding('utf8');
  const [first] = await once(res, 'data');
  assert.equal(first, 'data: one\n\n', 'the first event, before the drive has written the second');
  more();
  let rest = '';
  res.on('data', (c) => (rest += c));
  await once(res, 'end');
  assert.equal(rest, 'data: two\n\n');
});

test('an upload reaches the drive as the browser sends it', async (t) => {
  let firstPiece = null;
  let all = '';
  const guest = await listen((req, res) => {
    req.setEncoding('utf8');
    req.on('data', (c) => {
      all += c;
      firstPiece?.(c);
      firstPiece = null;
    });
    req.on('end', () => res.end(String(all.length)));
  });
  const r = await rig({ drives: { ana: { state: 'running', port: guest.port } } });
  t.after(async () => {
    await r.close();
    await guest.close();
  });
  const arrived = new Promise((resolve) => (firstPiece = resolve));
  const req = http.request({ host: '127.0.0.1', port: r.port, method: 'PUT', path: '/upload', headers: keyed('ana', { 'content-type': 'application/octet-stream' }) });
  req.write('a'.repeat(1000));
  assert.equal((await arrived).slice(0, 1), 'a', 'the drive has the first piece while the browser is still sending');
  req.end('b'.repeat(1000));
  const [res] = await once(req, 'response');
  let body = '';
  res.on('data', (c) => (body += c));
  await once(res, 'end');
  assert.equal(body, '2000');
});

test('a browser that goes away cuts the drive\'s request too', async (t) => {
  let closed = null;
  const guest = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: hello\n\n');
    req.on('close', () => closed?.());
  });
  const r = await rig({ drives: { ana: { state: 'running', port: guest.port } } });
  t.after(async () => {
    await r.close();
    await guest.close();
  });
  const gone = new Promise((resolve) => (closed = resolve));
  const req = http.request({ host: '127.0.0.1', port: r.port, path: '/stream', headers: keyed('ana') });
  req.end();
  const [res] = await once(req, 'response');
  await once(res, 'data');
  req.destroy();
  await Promise.race([gone, new Promise((_, reject) => setTimeout(() => reject(new Error('the drive\'s request stayed open')), 3000))]);
});

test('a drive that is not running, not here, or not answering is resting: a 503 page that says to try again', async (t) => {
  const down = await freePort();
  const r = await rig({ drives: { ana: { state: 'suspended', port: 4500 }, ben: { state: 'running', port: down }, cho: { state: 'making', port: null } } });
  t.after(() => r.close());
  for (const name of ['ana', 'ben', 'cho', 'nobody', 'Not-A-Name', '../x']) {
    const res = await ask(r.port, { headers: keyed(name, { accept: 'text/html' }) });
    assert.equal(res.status, 503, name);
    assert.equal(res.headers['retry-after'], '30');
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /This drive is resting/);
  }
});

test('its own paths: a poke drains the door\'s queue, and health always says ok while it answers', async (t) => {
  let pokes = 0;
  let broken = false;
  const r = await rig({
    onPoke: () => (pokes += 1),
    health: async () => {
      if (broken) throw new Error('the registry is busy');
      return { drives: 2, running: 1, release: '20261025T161133Z-4b2103a' };
    },
  });
  t.after(() => r.close());
  const poke = await ask(r.port, { method: 'POST', path: '/_host/poke', headers: keyed(null) });
  assert.equal(poke.status, 202);
  assert.equal(pokes, 1);
  const health = await ask(r.port, { path: '/_host/health', headers: keyed(null) });
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { drives: 2, running: 1, release: '20261025T161133Z-4b2103a', ok: true });
  broken = true;
  const still = await ask(r.port, { path: '/_host/health', headers: keyed(null) });
  assert.equal(still.status, 200);
  assert.equal(JSON.parse(still.body).ok, true);
  assert.equal((await ask(r.port, { path: '/_host/other', headers: keyed(null) })).status, 404);
  assert.equal((await ask(r.port, { method: 'GET', path: '/_host/poke', headers: keyed(null) })).status, 404);
});
