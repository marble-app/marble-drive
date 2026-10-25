// A drive's check (server/host/check.js): within the minute, /health names
// the release, the first page answers below 500, and /health/deep shows both
// agent CLIs' versions. The probe asks the way a person's browser never does:
// on loopback, with no forwarded headers, and the drive's passphrase.
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDrive, createProbe } from '../server/host/check.js';
import { listen } from './fixtures/host.js';

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

test('the probe asks on loopback, sends the passphrase to /health/deep only, and follows no redirect', async (t) => {
  const seen = [];
  const drive = await listen((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization ?? null, forwarded: req.headers['x-forwarded-for'] ?? req.headers['x-forwarded-host'] ?? null, accept: req.headers.accept });
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, working: 0, release: RELEASE }));
    if (req.url === '/health/deep') return res.end(JSON.stringify({ ok: req.headers.authorization === 'Bearer pass', claude: { version: '1' }, codex: { version: '2' } }));
    res.writeHead(302, { location: 'https://marbledrive.app/enter?drive=ana' });
    res.end();
  });
  t.after(() => drive.close());
  const p = createProbe();
  assert.equal((await p.health(drive.port)).release, RELEASE);
  assert.equal((await p.deep(drive.port, 'pass')).claude.version, '1');
  assert.equal(await p.deep(drive.port, 'wrong'), null);
  assert.equal(await p.page(drive.port), 302);
  assert.deepEqual(seen.map((s) => [s.url, s.auth]), [['/health', null], ['/health/deep', 'Bearer pass'], ['/health/deep', 'Bearer wrong'], ['/', null]]);
  assert.ok(seen.every((s) => s.forwarded === null), 'no forwarded header, so the drive answers it as local');
  assert.equal(seen[3].accept, 'text/html');
  await drive.close();
  assert.equal(await p.health(drive.port), null, 'nothing listening is no answer');
});
