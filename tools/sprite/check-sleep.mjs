// Does a sprite sleep when nobody needs it, and stay up while work runs?
//   node tools/sprite/check-sleep.mjs t-<person> tab    a hidden tab, left open,
//                                                        lets the sprite pause
//   node tools/sprite/check-sleep.mjs t-<person> quiet  a silent 5-minute command,
//                                                        no tab open, still finishes
//
// Whether the sprite was frozen is read from inside it: a heartbeat writes the
// time every second, and a gap is a freeze. (The Sprites API's `status` says
// "warm" even while the sprite answers requests, so it cannot tell.) Nothing
// else touches the sprite while a step waits. Signs in with the passphrase
// from the roster, which is never printed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { chromium } from 'playwright';

const [sprite, step] = process.argv.slice(2);
const entry = JSON.parse(fs.readFileSync(`${os.homedir()}/.config/marble-drive/testers.json`, 'utf8'))[sprite];
const base = entry.url;
const say = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const onSprite = (script) =>
  execFileSync('sprite', ['exec', '-o', 'marble-drive', '-s', sprite, '--', 'bash', '-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const BEAT = '/tmp/marble-check-beat';
const startBeat = () => onSprite(`rm -f ${BEAT}; nohup sh -c "while :; do date +%s >> ${BEAT}; sleep 1; done" >/dev/null 2>&1 &`);
/** Freezes of more than 5 s since the heartbeat started, as [from, to] epoch seconds. */
function freezes() {
  const out = onSprite(`cat ${BEAT}; pkill -f "date +%s >> ${BEAT}" || true`);
  const beats = out.trim().split('\n').map(Number).filter(Number.isFinite);
  const gaps = [];
  for (let i = 1; i < beats.length; i += 1) if (beats[i] - beats[i - 1] > 5) gaps.push([beats[i - 1], beats[i]]);
  return gaps;
}
const at = (s) => new Date(s * 1000).toISOString().slice(11, 19);

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
  startBeat();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  say('tab hidden and left open; touching nothing for 3 min');
  await sleep(180_000);
  say('tab resting:', await page.evaluate(() => window.marbleTabRest.resting));
  for (const [from, to] of freezes()) say(`sprite frozen ${at(from)} → ${at(to)} (${to - from} s)`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
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
  // Not `sleep`: Claude Code refuses a foreground sleep. A timer in node is
  // just as silent, and uses no CPU, so only the hold's 30-minute grace keeps
  // the sprite up.
  const prompt = 'This is a test of a long quiet job. Run exactly this one shell command with the Bash tool, in the foreground, with a 400000 ms timeout, and nothing else: `node -e "setTimeout(() => console.log(\'waited\'), 300000)"`. Then reply with just the word done.';
  startBeat();
  const sent = await call(`/agent/conversations/${id}/turns`, {
    method: 'POST',
    // A turn needs a document; every drive has its Agents page, and the prompt
    // touches nothing.
    body: JSON.stringify({ prompt, context: { target: 'Agents', viewing: 'Agents', selection: [], also: [] } }),
  });
  if (!sent.ok) throw new Error(`the turn was refused: ${sent.status} ${await sent.text()}`);
  say('turn sent:', sent.status, '— no tab open, touching nothing for 7 min');
  await sleep(7 * 60_000);
  const gaps = freezes();
  const { turns = [], events = [] } = await (await call(`/agent/conversations/${id}`)).json();
  const turn = turns.at(-1) ?? {};
  say('turn:', turn.status, turn.startedAt ?? '', '→', turn.finishedAt ?? turn.endedAt ?? '');
  say('its last words:', JSON.stringify(events.filter((e) => e.type === 'text').at(-1)?.text ?? '').slice(0, 80));
  if (!gaps.length) say('sprite never froze');
  for (const [from, to] of gaps) say(`sprite frozen ${at(from)} → ${at(to)} (${to - from} s)`);
}
