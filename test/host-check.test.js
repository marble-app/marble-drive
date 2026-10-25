// A drive's check (server/host/check.js): within the minute, /health names
// the release, the first page answers below 500, and /health/deep shows both
// agent CLIs' versions. The probe asks the way a person's browser never does:
// on loopback, at the drive's own address and from 127.0.0.2, with no
// forwarded headers, and the drive's passphrase.
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDrive, createProbe } from '../server/host/check.js';
import { listenGuest } from './fixtures/host.js';

const RELEASE = '20261025T161133Z-4b2103a';

/** A clock that moves only when the check sleeps. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function probe({ health = { ok: true, release: RELEASE }, page = 302, deep = { ok: true, claude: { version: '2.1.281' }, codex: { version: '0.159.3' } }, healthyAfter = 0 } = {}) {
  let asked = 0;
  return {
    health: async () => (asked++ >= healthyAfter ? health : null),
    page: async () => page,
    deep: async () => deep,
    asked: () => asked,
  };
}

test('a drive that answers with its release, its first page and both CLIs passes', async () => {
  const c = clock();
  const r = await checkDrive({ probe: probe({ healthyAfter: 3 }), port: 4500, release: RELEASE, secret: 's', ...c });
  assert.equal(r.ok, true);
  assert.equal(c.now(), 3000, 'it waited for the drive to start');
});

test('each way to fail it says why, once the minute is up', async () => {
  const cases = [
    [{ health: null }, /did not answer \/health/],
    [{ health: { ok: true, release: 'older' } }, /\/health says release older, not 20261025T161133Z-4b2103a/],
    [{ health: { ok: true, release: null } }, /says release none/],
    [{ page: 502 }, /its first page answered 502/],
    [{ page: null }, /its first page answered nothing/],
    [{ deep: null }, /did not answer \/health\/deep/],
    [{ deep: { ok: true, claude: { version: '2.1.281' }, codex: { version: null } } }, /no Codex version/],
    [{ deep: { ok: true, claude: {}, codex: {} } }, /no Claude Code version and no Codex version/],
  ];
  for (const [opts, why] of cases) {
    const c = clock();
    const r = await checkDrive({ probe: probe(opts), port: 4500, release: RELEASE, secret: 's', deadlineMs: 5000, ...c });
    assert.equal(r.ok, false);
    assert.match(r.why, why);
    assert.ok(c.now() <= 5000);
  }
});

test('the probe asks the drive at its own address from 127.0.0.2, sends the passphrase to /health/deep only, and follows no redirect', async (t) => {
  const seen = [];
  const drive = await listenGuest((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization ?? null, forwarded: req.headers['x-forwarded-for'] ?? req.headers['x-forwarded-host'] ?? null, accept: req.headers.accept, remote: req.socket.remoteAddress, local: req.socket.localAddress });
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, working: 0, release: RELEASE }));
    if (req.url === '/health/deep') return res.end(JSON.stringify({ ok: req.headers.authorization === 'Bearer pass', claude: { version: '1' }, codex: { version: '2' } }));
    res.writeHead(302, { location: 'https://marbledrive.app/enter?drive=ana' });
    res.end('a page the probe never reads'.repeat(20_000));
  });
  t.after(() => drive.close());
  const p = createProbe();
  assert.equal((await p.health(drive.port)).release, RELEASE);
  assert.equal((await p.deep(drive.port, 'pass')).claude.version, '1');
  assert.equal(await p.deep(drive.port, 'wrong'), null);
  assert.equal(await p.page(drive.port), 302);
  assert.deepEqual(seen.map((s) => [s.url, s.auth]), [['/health', null], ['/health/deep', 'Bearer pass'], ['/health/deep', 'Bearer wrong'], ['/', null]]);
  assert.ok(seen.every((s) => s.forwarded === null), 'no forwarded header, so the drive answers it as local');
  assert.ok(seen.every((s) => s.remote === '127.0.0.2' && s.local === drive.address), 'from 127.0.0.2 to the drive\'s own address, never 127.0.0.1');
  assert.equal(seen[3].accept, 'text/html');
  assert.equal(await p.health(4600), null, 'a port outside 4500-4599 has no drive\'s address');
  await drive.close();
  assert.equal(await p.health(drive.port), null, 'nothing listening is no answer');
});

test('an answer bigger than any health answer is no answer, and one that never ends is cut off', async (t) => {
  const drive = await listenGuest((req, res) => {
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, pad: 'x'.repeat(300 * 1024) }));
    res.write('{');
  });
  t.after(() => drive.close());
  const p = createProbe({ timeoutMs: 300 });
  assert.equal(await p.health(drive.port), null);
  const started = Date.now();
  assert.equal(await p.get(drive.port, '/slow'), null);
  assert.ok(Date.now() - started < 2000);
});

test('the probe asks /health/study and POST /health/logout with the passphrase; logout\'s words only, and a minute to answer', async (t) => {
  const seen = [];
  const drive = await listenGuest((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, origin: req.headers.origin ?? null, body, remote: req.socket.remoteAddress });
      const ok = req.headers.authorization === 'Bearer pass';
      if (req.url === '/health/study') return res.end(JSON.stringify(ok ? { ok: true, at: '2026-10-25T12:00:00.000Z', days: 2, prompts: 9 } : { error: 'not found' }));
      if (req.url === '/health/logout' && req.method === 'POST') {
        // The CLIs take their time; well past the probe's own limit.
        return setTimeout(() => res.end(JSON.stringify({ claude: 'signed-out', codex: 'something new' })), 400);
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  t.after(() => drive.close());
  const p = createProbe({ timeoutMs: 150 });
  assert.deepEqual(await p.study(drive.port, 'pass'), { ok: true, at: '2026-10-25T12:00:00.000Z', days: 2, prompts: 9 });
  assert.equal(await p.study(drive.port, 'wrong'), null);
  assert.deepEqual(await p.logout(drive.port, 'pass'), { claude: 'signed-out', codex: null });
  assert.deepEqual(seen.map((s) => [s.method, s.url, s.auth]), [['GET', '/health/study', 'Bearer pass'], ['GET', '/health/study', 'Bearer wrong'], ['POST', '/health/logout', 'Bearer pass']]);
  assert.equal(seen[2].body, '{}');
  assert.equal(seen[2].origin, null, 'a script with a bearer, which the drive\'s origin check lets through');
  assert.ok(seen.every((s) => s.remote === '127.0.0.2'));
  await drive.close();
  assert.equal(await p.logout(drive.port, 'pass'), null, 'a drive that does not answer');
});
