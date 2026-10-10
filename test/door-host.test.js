// test/door-host.test.js
// The host lets the door's pass in beside the passphrase (server/app.js).
// With no door settings nothing changes; with them, a pass opens the drive,
// a browser without one is sent to marbledrive.app, and `tools` mode keeps the
// passphrase for scripts and the desk only.
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { importSigningKey, sign } from '../worker/src/door/tokens.js';

const quiet = { log() {}, error() {}, info() {}, warn() {} };
const OWNER = 'a1b2c3d4e5f60718';
const SECRET = 'hunter2-passphrase';
const DOC = '<!doctype html><html><head><title>Notes</title></head><body data-marble-id="b"><p data-marble-id="p">hi</p></body></html>';

const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519');
const PKCS8 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const SPKI = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

async function passFor(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(await importSigningKey(PKCS8), 'k1', { typ: 'pass', drv: 'ana', acct: OWNER, sid: 'h', role: 'owner', iat: now, exp: now + 3600, ...over });
  return `__Host-md_pass=${token}`;
}

async function host(env = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'door-host-'));
  await fsp.writeFile(path.join(root, 'Notes.mrbl'), DOC);
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: SECRET, MARBLE_DRIVE_APP_UPDATES: '0', ...env }), { log: quiet, agents: false });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const call = (route, { headers = {}, ...init } = {}) => fetch(`${base}${route}`, { redirect: 'manual', ...init, headers });
  return {
    drive,
    base,
    call,
    async close() {
      await drive.close();
      await fsp.rm(root, { recursive: true, force: true });
    },
  };
}

const DOOR = { MARBLE_DOOR_KEYS: `k1:${SPKI}`, MARBLE_DOOR_NAME: 'ana', MARBLE_DOOR_OWNER: OWNER };
const html = { Accept: 'text/html' };
const viaEdge = { 'X-Forwarded-Host': 'ana.marbledrive.app' };
const viaTunnel = { 'Cf-Ray': '8c1234567890-SJC' };

async function gateCookie(h) {
  const res = await h.call('/gate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) });
  assert.equal(res.status, 200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function opensEvents(h, headers) {
  const ctrl = new AbortController();
  const res = await h.call('/events?client=t', { headers, signal: ctrl.signal });
  const status = res.status;
  ctrl.abort();
  await res.body?.cancel().catch(() => {});
  return status;
}

test('with door settings, a pass opens the drive: a document, /docs, /ops and /events', async (t) => {
  const h = await host(DOOR);
  t.after(() => h.close());
  const cookie = await passFor();
  for (const headers of [{}, viaEdge, viaTunnel]) {
    assert.equal((await h.call('/a/Notes', { headers: { cookie, ...html, ...headers } })).status, 200);
    assert.equal((await h.call('/docs', { headers: { cookie, ...headers } })).status, 200);
    assert.notEqual(await opensEvents(h, { cookie, ...headers }), 401);
  }
  const ops = await h.call('/ops?app=Notes&client=t', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: h.base }, body: '[]' });
  assert.equal(ops.status, 200);
});

test('a pass for another drive or another owner is not the owner', async (t) => {
  const h = await host(DOOR);
  t.after(() => h.close());
  for (const cookie of [await passFor({ drv: 'bob' }), await passFor({ acct: 'ffffffffffffffff' })]) {
    assert.equal((await h.call('/docs', { headers: { cookie } })).status, 401);
  }
});

test('without a pass, a browser through a tunnel or the edge is sent to the door; at the desk, to the passphrase', async (t) => {
  const h = await host(DOOR);
  t.after(() => h.close());
  for (const headers of [viaEdge, viaTunnel]) {
    const res = await h.call('/a/Notes?x=1', { headers: { ...html, ...headers } });
    assert.equal(res.status, 302);
    const to = new URL(res.headers.get('location'));
    assert.equal(to.origin, 'https://marbledrive.app');
    assert.equal(to.pathname, '/enter');
    assert.equal(to.searchParams.get('drive'), 'ana');
    assert.equal(to.searchParams.get('to'), '/a/Notes?x=1');
  }
  const desk = await h.call('/a/Notes', { headers: html });
  assert.equal(desk.status, 302);
  assert.match(desk.headers.get('location'), /^\/gate\?to=/);
  const evil = await h.call('//evil.example/x', { headers: { ...html, ...viaEdge } });
  if (evil.status === 302 && evil.headers.get('location').startsWith('https://marbledrive.app')) {
    assert.equal(new URL(evil.headers.get('location')).searchParams.get('to'), '/');
  }
});

test('the passphrase still works with the gate on: the form, its cookie, and a bearer', async (t) => {
  const h = await host(DOOR);
  t.after(() => h.close());
  const cookie = await gateCookie(h);
  assert.equal((await h.call('/docs', { headers: { cookie, ...viaEdge } })).status, 200);
  assert.equal((await h.call('/docs', { headers: { authorization: `Bearer ${SECRET}`, ...viaTunnel } })).status, 200);
  const page = await (await h.call('/gate', { headers: { ...html, ...viaEdge } })).text();
  assert.match(page, /Sign in with Marble Drive/);
  assert.match(page, /https:\/\/marbledrive\.app\/enter\?drive=ana/);
  assert.match(page, /name="secret"/);
});

test('tools mode: the form and its cookie are refused through a tunnel or the edge, and still work at the desk and as a bearer', async (t) => {
  const h = await host({ ...DOOR, MARBLE_DRIVE_GATE: 'tools' });
  t.after(() => h.close());
  for (const headers of [viaEdge, viaTunnel, { 'X-Forwarded-For': '203.0.113.9' }]) {
    assert.equal((await h.call('/gate', { headers: { ...html, ...headers } })).status, 403);
    const post = await h.call('/gate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ secret: SECRET }) });
    assert.equal(post.status, 403);
    assert.equal(post.headers.get('set-cookie'), null);
  }
  const cookie = await gateCookie(h); // at the desk
  assert.equal((await h.call('/docs', { headers: { cookie } })).status, 200, 'the cookie at the desk');
  assert.equal((await h.call('/docs', { headers: { cookie, ...viaEdge } })).status, 401, 'the same cookie through the edge');
  const browser = await h.call('/a/Notes', { headers: { cookie, ...html, ...viaTunnel } });
  assert.equal(browser.status, 302);
  assert.match(browser.headers.get('location'), /^https:\/\/marbledrive\.app\/enter\?/);
  assert.equal((await h.call('/docs', { headers: { authorization: `Bearer ${SECRET}`, ...viaEdge } })).status, 200, 'a bearer through the edge');
  assert.equal((await h.call('/docs', { headers: { cookie: await passFor(), ...viaEdge } })).status, 200, 'the door');
  const desk = await h.call('/a/Notes', { headers: html });
  assert.match(desk.headers.get('location'), /^https:\/\/marbledrive\.app\/enter\?/, 'tools mode sends even the desk browser to the door');
});

test("tools mode: the agent's browser pass still opens the drive at 127.0.0.1", async (t) => {
  const h = await host({ ...DOOR, MARBLE_DRIVE_GATE: 'tools' });
  t.after(() => h.close());
  const pass = `${h.drive.gate.cookieName}=${h.drive.gate.issue(60_000)}`;
  assert.equal((await h.call('/a/Notes', { headers: { cookie: pass, ...html } })).status, 200);
});

test('no door settings: no door on the gate page, and a browser goes to /gate as before', async (t) => {
  const h = await host({ MARBLE_DRIVE_GATE: 'tools' });
  t.after(() => h.close());
  const res = await h.call('/a/Notes', { headers: { ...html, ...viaEdge } });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/gate\?to=/);
  const page = await (await h.call('/gate', { headers: { ...html, ...viaEdge } })).text();
  assert.doesNotMatch(page, /Marble Drive<\/a>|marbledrive\.app\/enter/);
  assert.match(page, /name="secret"/);
  const cookie = await gateCookie(h);
  assert.equal((await h.call('/docs', { headers: { cookie, ...viaEdge } })).status, 200, 'tools mode means nothing without a door');
  assert.equal((await h.call('/docs', { headers: { cookie: await passFor(), ...viaEdge } })).status, 401, 'no keys, no pass');
});

test('a share link through the edge still reaches its page', async (t) => {
  const h = await host({ ...DOOR, MARBLE_DRIVE_GATE: 'tools' });
  t.after(() => h.close());
  const made = await h.call('/drive/shares', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', Origin: h.base },
    body: JSON.stringify({ path: 'Notes', role: 'view' }),
  });
  assert.equal(made.status, 200);
  const href = (await made.json()).link.href;
  const opened = await h.call(href, { headers: { ...html, ...viaEdge } });
  assert.equal(opened.status, 302);
  const share = (opened.headers.get('set-cookie') ?? '').split(';')[0];
  assert.match(share, /^marble_share=/);
  assert.equal((await h.call(opened.headers.get('location'), { headers: { cookie: share, ...html, ...viaEdge } })).status, 200);
});
