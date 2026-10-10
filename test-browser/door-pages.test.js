// The door's pages at marbledrive.app (worker/src/door/pages.js), in a real
// Chromium: at a phone's width and a desk's, in both schemes. Nothing scrolls
// sideways, a page spends at most one filled button, a key lands on a visible
// ring, and no text is under 4.5:1 against what is behind it.
//
// Set DOOR_SHOTS=<dir> to keep a screenshot of each.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';

import * as pages from '../worker/src/door/pages.js';

const PLAYWRIGHT = new URL('node_modules/playwright/index.mjs', import.meta.resolve('@bdhmin/marble/package.json'));
const { chromium } = await import(PLAYWRIGHT.href);

const both = { google: true, github: true };
const SAMPLES = {
  'sign-in': () => pages.signIn({ providers: both }),
  'sign-in-to-drive': () => pages.signIn({ providers: both, to: '/enter?drive=ana&to=%2F', drive: 'ana' }),
  join: () => pages.join({ providers: both, invite: 'a'.repeat(32) }),
  'join-claim': () => pages.join({ providers: both, invite: 'a'.repeat(32), drive: 'irene' }),
  'join-spent': () => pages.join({ providers: both, why: 'spent' }),
  'not-invited': () => pages.notInvited({ name: 'Ana Lima', email: 'ana.lima@example.com' }),
  asked: () => pages.notInvited({ asked: true }),
  name: () => pages.nameDrive({}),
  'name-taken': () => pages.nameDrive({ value: 'garden', said: 'garden is taken.', ok: false, status: 409 }),
  'name-free': () => pages.nameDrive({ value: 'ana', said: 'ana is free.', ok: true }),
  'making-now': () => pages.making({ drive: { name: 'ana', state: 'making', steps: { machine: 'done', install: 'now' } } }),
  'making-failed': () => pages.making({ drive: { name: 'ana', state: 'failed', failed: 'install', steps: { machine: 'done', install: 'failed' } } }),
  'making-ready': () => pages.making({ drive: { name: 'ana', state: 'ready', steps: {} } }),
  account: () => pages.account({
    account: { name: 'Ana', email: 'ana@example.com', methods: [{ provider: 'google', email: 'ana.lima.longer.address@example.com' }] },
    drives: [{ name: 'ana-lima-research-notes', state: 'ready' }],
  }),
  'account-empty': () => pages.account({ account: { name: 'Ana', email: 'ana@example.com', methods: [{ provider: 'github', email: 'ana@example.com' }] }, drives: [] }),
  'not-yours': () => pages.notYours({ email: 'bob@example.com' }),
  problem: () => pages.problem({ title: 'Couldn’t sign you in', text: 'That sign-in took too long, or started in another browser. Start again.' }),
  privacy: () => pages.privacy(),
  terms: () => pages.terms(),
};

const server = http.createServer(async (req, res) => {
  const name = req.url.slice(1).split('?')[0];
  if (name === 'name/check') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, said: 'ana is free.' }));
  }
  const make = SAMPLES[name];
  if (!make) {
    res.writeHead(404);
    return res.end();
  }
  const r = make();
  const headers = Object.fromEntries(r.headers);
  delete headers['content-security-policy']; // its form-action names the real host
  res.writeHead(200, headers);
  res.end(await r.text());
});
const base = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const browser = await chromium.launch();
const shots = process.env.DOOR_SHOTS || null;
if (shots) await fsp.mkdir(shots, { recursive: true });

test.after(async () => {
  await browser.close();
  server.close();
});

// Every element with its own text: its colour against the first opaque
// background behind it, as WCAG measures it.
function measure() {
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return c;
    }
    return [255, 255, 255];
  };
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    if (el.closest('[aria-disabled="true"], :disabled')) continue;
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color);
    const bg = bgOf(el);
    const a = lum(fg);
    const b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    out.push({ text: el.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100 });
  }
  return out;
}

for (const name of Object.keys(SAMPLES)) {
  test(`${name}: phone and desk, light and dark`, async () => {
    for (const scheme of ['light', 'dark']) {
      for (const width of [360, 1100]) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await page.goto(`${base}/${name}`);
        const where = `${name} ${scheme} ${width}`;
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(sideways <= 0, `${where}: scrolls sideways by ${sideways}px`);
        const filled = await page.locator('.btn.one').count();
        assert.ok(filled <= 1, `${where}: ${filled} filled buttons`);
        const low = (await page.evaluate(measure)).filter((t) => t.ratio < 4.5);
        assert.deepEqual(low, [], `${where}: text under 4.5:1`);
        const focusable = await page.locator('a[href], button:not(:disabled), input').count();
        if (focusable) {
          await page.keyboard.press('Tab');
          const ring = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return 'nothing focused';
            const cs = getComputedStyle(el);
            const field = el.closest('.field');
            const shadow = field ? getComputedStyle(field).boxShadow : cs.boxShadow;
            return shadow !== 'none' || cs.outlineStyle !== 'none' ? 'ok' : `${el.tagName} has no ring`;
          });
          assert.equal(ring, 'ok', `${where}: focus ring`);
          await page.evaluate(() => document.activeElement?.blur());
        }
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-${scheme}-${width}.png`), fullPage: true });
        await context.close();
      }
    }
  });
}
