// test/drive-origin.test.js
// Every change to a drive comes from its own pages (server/sessions.js,
// fromOwnPage, asked in front of every route in server/app.js). Until
// marbledrive.app is on the Public Suffix List a page on bob.marbledrive.app
// is same-site with ana's, so its posts carry ana's cookie. Each family of
// routes that changes something is asked here the way such a page would ask
// it, through the edge and with ana's cookie, and must be refused before
// anything changes; ana's own pages, a share link's page, a script's bearer,
// curl and the agent's browser at 127.0.0.1 go on as before. The passphrase
// cookie there is __Host-, so a drive can't plant one for another either.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const quiet = { log() {}, error() {}, info() {}, warn() {} };
const SECRET = 'hunter2-passphrase';
const doc = (title) => `<!doctype html><html><head><title>${title}</title></head><body data-marble-id="b"><p data-marble-id="p">hi</p></body></html>`;

const EDGE = { 'X-Forwarded-Host': 'ana.marbledrive.app', 'X-Forwarded-Proto': 'https' };
const OWN = 'https://ana.marbledrive.app';
const BOB = 'https://bob.marbledrive.app';

const host = await (async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'drive-origin-'));
  for (const name of ['Notes', 'Moveme', 'Trashme', 'Shared']) await fsp.writeFile(path.join(root, `${name}.mrbl`), doc(name));
  await fsp.writeFile(path.join(root, 'song.txt'), 'la la');
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: SECRET, MARBLE_DRIVE_APP_UPDATES: '0', MARBLE_DRIVE_CONNECTOR: '1' }), { log: quiet, agents: false });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  return {
    drive,
    root,
    base,
    call: (route, { headers = {}, ...init } = {}) => fetch(`${base}${route}`, { redirect: 'manual', ...init, headers }),
    has: (name) => fsp.stat(path.join(root, name)).then(() => true, () => false),
    read: (name) => fsp.readFile(path.join(root, name), 'utf8'),
  };
})();
test.after(async () => {
  await host.drive.close();
  await fsp.rm(host.root, { recursive: true, force: true });
});

// Ana signs in through the edge, over https: her cookie is the __Host- one.
const signIn = await host.call('/gate', { method: 'POST', headers: { ...EDGE, Origin: OWN, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) });
const ANA = (signIn.headers.get('set-cookie') ?? '').split(';')[0];

/** A request as ana's browser sends it through the edge: her cookie, and
 *  whatever says where the page asking is. */
const asAna = (route, { method = 'POST', body, type = 'application/json', from = {} } = {}) =>
  host.call(route, { method, headers: { ...EDGE, cookie: ANA, ...(body !== undefined ? { 'Content-Type': type } : {}), ...from }, body });

const fromBob = { Origin: BOB };
const fromOwn = { Origin: OWN };
const ops = (text) => JSON.stringify([{ type: 'setText', id: 'p', text }]);

// Every family of routes that changes something: the carrier's, the drive
// verbs, uploads, blobs, stems, the agents', the console's, the apps' and
// the connector's owner routes, and the gate's own form.
const FAMILIES = [
  ['POST', '/ops?app=Notes&client=t', ops('from elsewhere')],
  ['POST', '/restore?app=Notes&sha=' + 'a'.repeat(64)],
  ['POST', '/presence?app=Notes&client=t', '{"ids":[]}'],
  ['POST', '/tab/alive', '{"tab":"t"}'],
  ['POST', '/intent?app=Notes', '{}'],
  ['POST', '/zoom?app=Notes', '{}'],
  ['POST', '/drive/new', JSON.stringify({ path: 'Planted', copy: 'Notes' })],
  ['POST', '/drive/upload?folder=&name=Planted', doc('Planted')],
  ['POST', '/drive/upload-file?folder=&name=planted.txt', 'bytes'],
  ['POST', '/drive/slides-from', '{"path":"song.txt"}'],
  ['POST', '/drive/mkdir', '{"path":"Planted folder"}'],
  ['POST', '/drive/move', '{"from":"Moveme","to":"Taken"}'],
  ['POST', '/drive/trash', '{"path":"Trashme"}'],
  ['POST', '/drive/untrash', '{"id":"x"}'],
  ['POST', '/drive/shares', '{"path":"Notes","role":"modify"}'],
  ['POST', '/drive/shares/off', '{"id":"x"}'],
  ['POST', '/drive/git/publish', '{"path":"x"}'],
  ['POST', '/drive/uploads', '{"name":"big.bin","bytes":5}'],
  ['PUT', '/drive/uploads/abc?offset=0', 'bytes'],
  ['DELETE', '/drive/uploads/abc'],
  ['POST', '/drive/uploads/abc/finish'],
  ['PUT', '/drive/thumb?path=song.txt', 'png'],
  ['POST', '/drive/extract', '{"path":"Notes"}'],
  ['POST', '/blob', 'blob bytes'],
  ['POST', '/stems/split', '{"path":"song.txt"}'],
  ['POST', '/stems/cancel', '{"id":"x"}'],
  ['POST', '/agent/conversations', '{}'],
  ['PUT', '/agent/settings', '{}'],
  ['POST', '/console/api/drives/t-sam/look', '{}'],
  ['POST', '/typesafe/run', '{}'],
  ['POST', '/genui/root', '{}'],
  ['POST', '/genui/pin', '{}'],
  ['POST', '/genui/decide', '{}'],
  ['DELETE', '/connector/grants/abc'],
  ['POST', '/oauth/authorize', 'client_id=x'],
  ['POST', '/gate', JSON.stringify({ secret: SECRET })],
];

test('ana signed in through the edge with the __Host- cookie', () => {
  assert.equal(signIn.status, 200);
  assert.match(ANA, /^__Host-marble_drive=/);
  assert.match(signIn.headers.get('set-cookie'), /; Secure/);
});

test('every changing route refuses a page on another drive, a page with no origin, and a same-site fetch with no Origin, and changes nothing', async () => {
  const before = await host.read('Notes.mrbl');
  for (const [method, route, body] of FAMILIES) {
    for (const from of [fromBob, { Origin: 'null' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'http://ana.marbledrive.app.evil.example' }]) {
      const res = await asAna(route, { method, body, from });
      assert.equal(res.status, 403, `${method} ${route} from ${JSON.stringify(from)}`);
      assert.match((await res.json()).error, /has to come from this drive’s own pages/);
    }
  }
  assert.equal(await host.read('Notes.mrbl'), before);
  for (const name of ['Planted.mrbl', 'planted.txt', 'Planted folder', 'Taken.mrbl']) assert.equal(await host.has(name), false, name);
  assert.equal(await host.has('Moveme.mrbl'), true);
  assert.equal(await host.has('Trashme.mrbl'), true);
});

test('the same routes from ana’s own page get past the check (each then answers for itself)', async () => {
  for (const [method, route, body] of FAMILIES) {
    if (route.startsWith('/drive/move') || route.startsWith('/drive/trash')) continue; // below, with what they change
    const res = await asAna(route, { method, body, from: fromOwn });
    const said = await res.text();
    assert.ok(res.status !== 403 || !said.includes('own pages'), `${method} ${route}: ${res.status} ${said.slice(0, 120)}`);
  }
});

test('ana’s own page writes, moves, trashes, uploads and keeps a blob, as before', async () => {
  const written = await asAna('/ops?app=Notes&client=t', { body: ops('from her own page'), from: fromOwn });
  assert.equal(written.status, 200);
  assert.match(await host.read('Notes.mrbl'), /from her own page/);
  assert.equal((await asAna('/drive/move', { body: '{"from":"Moveme","to":"Moved"}', from: fromOwn })).status, 200);
  assert.equal(await host.has('Moved.mrbl'), true);
  assert.equal((await asAna('/drive/trash', { body: '{"path":"Trashme"}', from: fromOwn })).status, 200);
  assert.equal(await host.has('Trashme.mrbl'), false);
  assert.equal((await asAna('/drive/upload?folder=&name=Dropped', { body: doc('Dropped'), type: 'text/html', from: fromOwn })).status, 200);
  assert.equal(await host.has('Dropped.mrbl'), true);
  const blob = await asAna('/blob', { body: 'png bytes', type: 'image/png', from: fromOwn });
  assert.equal(blob.status, 200);
  assert.match((await blob.json()).hash, /^[0-9a-f]{64}$/);
  // A fetch with no Origin but Sec-Fetch-Site: same-origin is its own page too.
  assert.equal((await asAna('/drive/mkdir', { body: '{"path":"Kept"}', from: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});

test('a script’s bearer from anywhere, and curl with neither header, go on as before', async () => {
  const bearer = await host.call('/ops?app=Notes&client=s', { method: 'POST', headers: { ...EDGE, Origin: BOB, authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }, body: ops('from a script') });
  assert.equal(bearer.status, 200);
  const curl = await host.call('/drive/mkdir', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }, body: '{"path":"By curl"}' });
  assert.equal(curl.status, 200);
  const cookieOnly = await host.call('/drive/mkdir', { method: 'POST', headers: { cookie: (await deskCookie()), 'Content-Type': 'application/json' }, body: '{"path":"By node"}' });
  assert.equal(cookieOnly.status, 200, 'node’s fetch sends no Origin and no Sec-Fetch-Site');
});

test('Claude’s and ChatGPT’s doors stay open to any origin: they judge their own tokens', async () => {
  const registered = await host.call('/oauth/register', { method: 'POST', headers: { Origin: 'https://claude.ai', 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' }) });
  assert.notEqual(registered.status, 403);
  const mcp = await host.call('/mcp', { method: 'POST', headers: { Origin: 'https://claude.ai', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(mcp.status, 401, 'no token, so the connector itself says no');
});

test('a share link writes from its own page, and not from another drive’s', async () => {
  const made = await host.call('/drive/shares', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'Shared', role: 'modify' }) });
  const { link } = await made.json();
  const opened = await host.call(link.href, { headers: { ...EDGE, Accept: 'text/html' } });
  assert.equal(opened.status, 302);
  const share = (opened.headers.get('set-cookie') ?? '').split(';')[0];
  assert.match(share, /^marble_share=/);
  const visit = (from, text) => host.call('/ops?app=Shared&client=v', { method: 'POST', headers: { ...EDGE, cookie: share, 'Content-Type': 'application/json', ...from }, body: ops(text) });
  assert.equal((await visit(fromBob, 'planted by bob')).status, 403);
  assert.doesNotMatch(await host.read('Shared.mrbl'), /planted by bob/);
  assert.equal((await visit(fromOwn, 'written by the visitor')).status, 200);
  assert.match(await host.read('Shared.mrbl'), /written by the visitor/);
});

test('the agent’s browser at 127.0.0.1 writes with the pass planted for it; localhost is another origin', async () => {
  const pass = `${host.drive.gate.cookieName}=${host.drive.gate.issue(60_000)}`;
  const at = (origin) => host.call('/ops?app=Notes&client=agentb', { method: 'POST', headers: { cookie: pass, Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: ops(`from ${origin}`) });
  assert.equal((await at(host.base)).status, 200);
  assert.match(await host.read('Notes.mrbl'), new RegExp(`from ${host.base.replace(/[.:/]/g, '\\$&')}`));
  assert.equal((await at(host.base.replace('127.0.0.1', 'localhost'))).status, 403);
});

test('an edge or proxy that adds its own name after the browser’s still reads the browser’s first', async () => {
  const res = await host.call('/drive/mkdir', { method: 'POST', headers: { ...EDGE, 'X-Forwarded-Host': 'ana.marbledrive.app, pc-host.marbledrive.app', cookie: ANA, Origin: OWN, 'Content-Type': 'application/json' }, body: '{"path":"Through two"}' });
  assert.equal(res.status, 200);
});

test('reading is never refused for where it came from', async () => {
  for (const route of ['/docs', '/a/Notes', '/history?app=Notes', '/drive/tree']) {
    const res = await host.call(route, { headers: { ...EDGE, cookie: ANA, Origin: BOB, 'Sec-Fetch-Site': 'cross-site', Accept: 'text/html' } });
    assert.equal(res.status, 200, route);
  }
});

test('a passphrase cookie under the plain name, as another drive could plant it, is not read through the edge', async () => {
  const value = ANA.slice('__Host-marble_drive='.length);
  const planted = await host.call('/docs', { headers: { ...EDGE, cookie: `marble_drive=${value}` } });
  assert.equal(planted.status, 401);
  assert.equal((await host.call('/docs', { headers: { ...EDGE, cookie: ANA } })).status, 200);
  assert.equal((await host.call('/docs', { headers: { cookie: `marble_drive=${value}` } })).status, 200, 'at the desk, over plain http, the plain name is the one');
  assert.equal((await host.call('/docs', { headers: { cookie: ANA } })).status, 401, 'and a __Host- one is not read there');
});

async function deskCookie() {
  const res = await host.call('/gate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: SECRET }) });
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}
