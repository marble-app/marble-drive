// Does a sprite sleep when nobody needs it, and stay up while work runs?
//   node tools/sprite/check-sleep.mjs t-<person> tab    a hidden tab lets it pause
//   node tools/sprite/check-sleep.mjs t-<person> quiet  a silent 5-minute command,
//                                                        no tab open, still finishes
// Signs in with the passphrase from the roster (never printed). Reads whether
// the sprite is running from the Sprites API, which does not wake it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from 'playwright';

const [sprite, step] = process.argv.slice(2);
const entry = JSON.parse(fs.readFileSync(`${os.homedir()}/.config/marble-drive/testers.json`, 'utf8'))[sprite];
const base = entry.url;
const stamp = () => new Date().toISOString().slice(11, 19);
const say = (...parts) => console.log(stamp(), ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const status = () => {
  try {
    const out = execFileSync('sprite', ['api', '-o', 'marble-drive', `/v1/sprites/${sprite}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out.slice(out.indexOf('{'))).data.status;
  } catch {
    return 'unknown';
  }
};
async function untilPaused(minutes) {
  const end = Date.now() + minutes * 60_000;
  let last = '';
  while (Date.now() < end) {
    const now = status();
    if (now !== last) say('sprite:', now);
    last = now;
    if (now === 'warm' || now === 'cold') return true;
    await sleep(15_000);
  }
  return false;
}

const login = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: entry.passphrase }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (!cookie) throw new Error(`gate login failed: ${login.status}`);
const call = (route, init = {}) => fetch(base + route, { ...init, headers: { ...(init.headers || {}), cookie, 'Content-Type': 'application/json' } });

if (step === 'tab') {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, url: base }]);
  const page = await ctx.newPage();
  await page.goto(`${base}/a/drive`);
  await page.waitForFunction(() => Boolean(window.marbleTabRest));
  say('streams with the tab shown:', (await (await call('/health')).json()).streams);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  say('tab hidden; waiting 75 s for it to rest');
  await sleep(75_000);
  say('streams after the rest:', (await (await call('/health')).json()).streams, '(this request wakes it for ~30 s)');
  say('paused with the tab still open:', await untilPaused(4));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => !window.marbleTabRest.resting);
  await sleep(3_000);
  say('streams once shown again:', (await (await call('/health')).json()).streams);
  await browser.close();
}

if (step === 'quiet') {
  const settings = await (await call('/agent/settings')).json();
  const provider = settings.claudeAuth === 'api' ? 'claude-api' : 'claude-subscription';
  const { id } = await (await call('/agent/conversations', { method: 'POST', body: JSON.stringify({ provider }) })).json();
  const prompt = 'Run exactly this one shell command with the Bash tool, with a 400000 ms timeout, and nothing else: `sleep 300 && echo slept`. Then reply with just the word done.';
  const sent = await call(`/agent/conversations/${id}/turns`, {
    method: 'POST',
    body: JSON.stringify({ prompt, context: { target: null, viewing: null, selection: [], also: [] } }),
  });
  say('turn sent:', sent.status, 'conversation', id, '— no tab open from here on');
  const started = Date.now();
  let running = 0;
  for (let i = 0; i < 26; i += 1) {
    await sleep(15_000);
    if (status() === 'running') running += 1;
  }
  say(`sprite running at ${running} of 26 checks over 6.5 min (from the API; nothing connected)`);
  const events = await (await call(`/agent/conversations/${id}`)).json();
  const list = events.events ?? events.transcript ?? [];
  const done = list.find?.((e) => e.type === 'turn.completed' || e.type === 'turn.failed');
  const stamped = done?.at ?? done?.ts ?? done?.time;
  say('turn ended:', done?.type ?? 'not yet', stamped ? `after ${Math.round((Date.parse(stamped) - started) / 1000)} s` : '', '· status', events.turns?.at(-1)?.status);
  say('its last words:', JSON.stringify(list.filter((e) => e.type === 'text').at(-1)?.text ?? '').slice(0, 80));
  say('paused once the work was done:', await untilPaused(4));
}
