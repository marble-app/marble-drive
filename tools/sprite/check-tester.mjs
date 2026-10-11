// Sign in to a tester's sprite with the passphrase from the roster and check it:
//   node tools/sprite/check-tester.mjs t-<person> [save-key]
// The gate lets the passphrase in and nothing else; the saved-key flag; the
// API agent's name; the Drive's views; the Drive page folded into materials.
// save-key stores a dummy Anthropic key, to prove a redeploy keeps keys.
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from 'playwright';
const [sprite, step] = process.argv.slice(2);
const entry = JSON.parse(fs.readFileSync(`${os.homedir()}/.config/marble-drive/testers.json`, 'utf8'))[sprite];
const base = entry.url;
const login = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: entry.passphrase }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
console.log('gate login:', login.status, cookie ? 'cookie set' : 'no cookie');
const wrong = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'not-it' }) });
console.log('wrong passphrase:', wrong.status);
const call = (route, init = {}) => fetch(base + route, { ...init, headers: { ...(init.headers || {}), cookie, 'Content-Type': 'application/json' } }).then((r) => r.json());
if (step === 'save-key') {
  await call('/agent/settings', { method: 'PUT', body: JSON.stringify({ keys: { anthropic: 'sk-ant-dummy-for-a-test-only' } }) });
}
console.log('key saved:', (await call('/agent/settings')).keys);
const providers = await call('/agent/providers');
console.log('api agent is called:', (providers.providers ?? providers).find?.((p) => p.id === 'claude-api')?.label);
const browser = await chromium.launch();
const ctx = await browser.newContext();
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: base }]);
const page = await ctx.newPage();
await page.goto(`${base}/a/drive`);
await page.locator('#items .item').first().waitFor();
console.log('views:', await page.$$eval('[data-set-view]', (els) => els.map((e) => e.dataset.setView).join(',')));
console.log('drive listed as material:', await page.locator('#items .item[data-path="drive"]').getAttribute('data-material'));
await browser.close();
