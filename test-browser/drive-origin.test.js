// The own-page check on changes (server/sessions.js, fromOwnPage), with the
// headers a real Chromium sends. A page on another drive under the same site
// posts to ana's drive with ana's cookie riding along, as SameSite=Lax allows
// between same-site names, and is refused; ana's own page and the agent's
// browser at 127.0.0.1 (its pass planted as server/agent/browser.js plants it)
// write as before.
//
// Two names on one site: Chromium resolves *.marbledrive.test to this
// machine, and marbledrive.test is the site of both ana. and bob.

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { passCookies } from '../server/agent/browser.js';
import { startDrive } from './harness.js';

const SECRET = 'hunter2';
const NOTES = `<!doctype html>
<html><head><meta charset="utf-8"><title>Notes</title></head>
<body data-marble-id="b"><p data-marble-id="p">as it was</p></body></html>
`;

const host = await startDrive({
  agents: false,
  documents: { notes: NOTES },
  env: { MARBLE_DRIVE_SECRET: SECRET },
  launchOptions: { args: ['--host-resolver-rules=MAP *.marbledrive.test 127.0.0.1'] },
});
const port = new URL(host.base).port;
const ANA = `http://ana.marbledrive.test:${port}`;

// Bob's drive: a page that posts to ana's, as a page on any drive could.
const bob = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Bob</title><script>
fetch(${JSON.stringify(`${ANA}/ops?app=notes&client=bobpage`)}, {
  method: 'POST', mode: 'no-cors', credentials: 'include',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify([{ type: 'setText', id: 'p', text: 'planted by bob' }]),
}).finally(() => { document.title = 'sent'; });
</script>`);
});
await new Promise((r) => bob.listen(0, '127.0.0.1', r));
const BOB = `http://bob.marbledrive.test:${bob.address().port}`;

// What reached ana's drive, and what it answered.
const seen = [];
host.drive.server.on('request', (req, res) => {
  if (!req.url.startsWith('/ops')) return;
  const entry = { client: new URL(req.url, 'http://x').searchParams.get('client'), origin: req.headers.origin ?? null, site: req.headers['sec-fetch-site'] ?? null, cookie: req.headers.cookie ?? '' };
  res.on('finish', () => {
    entry.status = res.statusCode;
  });
  seen.push(entry);
});

test.after(async () => {
  bob.close();
  await host.close();
});

const settled = async (client) => {
  for (let i = 0; i < 100; i += 1) {
    const hit = seen.find((s) => s.client === client && s.status);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`no request from ${client}`);
};
const text = () => host.drive.store.read('notes');
const write = (page, client, words) =>
  page.evaluate(([c, w]) => fetch(`/ops?app=notes&client=${c}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ type: 'setText', id: 'p', text: w }]) }).then((r) => r.status), [client, words]);

test('ana signs in with her passphrase and writes from her own page', async () => {
  const { page } = await host.newPage({ shell: false });
  await page.goto(`${ANA}/gate?to=%2Fa%2Fnotes`);
  await page.fill('input[name="secret"]', SECRET);
  await Promise.all([page.waitForURL(`${ANA}/a/notes`), page.click('button')]);
  assert.equal(await write(page, 'anapage', 'written by ana'), 200);
  const hit = await settled('anapage');
  assert.equal(hit.origin, ANA);
  assert.match(await text(), /written by ana/);

  // Bob's page, same site, sends ana's cookie along with its post: refused.
  await page.goto(`${BOB}/`);
  await page.waitForFunction(() => document.title === 'sent');
  const attack = await settled('bobpage');
  assert.equal(attack.origin, BOB);
  assert.match(attack.cookie, /marble_drive=/, 'Lax let ana’s cookie ride along');
  assert.equal(attack.status, 403);
  assert.doesNotMatch(await text(), /planted by bob/);
  await page.context().close();
});

test('the agent’s browser at 127.0.0.1, with the pass planted for it, opens the drive and writes', async () => {
  const { page } = await host.newPage({ shell: false });
  await page.context().addCookies(passCookies({ origin: host.base, cookie: `${host.drive.gate.cookieName}=${host.drive.gate.issue(60_000)}` }));
  const opened = await page.goto(`${host.base}/a/notes`);
  assert.equal(opened.status(), 200);
  assert.equal(new URL(page.url()).pathname, '/a/notes', 'not sent to the gate');
  assert.equal(await write(page, 'agentpage', 'written by the agent’s browser'), 200);
  const hit = await settled('agentpage');
  assert.equal(hit.origin, host.base);
  assert.match(await text(), /written by the agent’s browser/);

  // The same browser at localhost is the same pass, and its own origin there.
  await page.goto(`${host.base.replace('127.0.0.1', 'localhost')}/a/notes`);
  assert.equal(await write(page, 'agentlocal', 'written at localhost'), 200);
  await page.context().close();
});
