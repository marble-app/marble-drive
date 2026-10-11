// A screenshot of a page in a running host, over the Chrome DevTools Protocol.
//
// Not a test and not part of the suite: it is the eyes for a change whose whole
// point is how something looks. Node's own WebSocket drives Chrome for Testing
// directly, because the drive holds an SSE stream open forever and every
// screenshot tool that waits for "load" waits for that instead.
//
//   node tools/shot.mjs <url> <out.png> [--click <selector>] [--eval <expr>] [--wait <ms>]
//
// `out.png` of `-` skips the screenshot, for a run that only wants the eval.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64',
  'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> [--click sel] [--wait ms]');
  process.exit(1);
}
// Order matters: a click then an eval is a different run from an eval then a
// click, so they go in one list rather than two.
const steps = [];
let settle = 2500;
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i] === '--click') steps.push({ click: rest[i + 1] });
  else if (rest[i] === '--eval') steps.push({ eval: rest[i + 1] });
  else if (rest[i] === '--wait') settle = Number(rest[i + 1]);
}

const PORT = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--window-size=1440,980',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  'about:blank',
]);
chrome.stderr.on('data', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is not listening yet.
    }
    await sleep(250);
  }
  throw new Error('chrome never came up');
}

const ws = new WebSocket(await target());
await new Promise((done) => ws.addEventListener('open', done, { once: true }));

let seq = 0;
const waiting = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
});
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = (seq += 1);
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await call('Page.enable');
await call('Runtime.enable');
// Anything the page complains about. A change to a listing that throws on the
// third row still screenshots as a listing.
const noise = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    noise.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    noise.push(`uncaught: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
  }
});
await call('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 980,
  deviceScaleFactor: 2,
  mobile: false,
});
await call('Page.navigate', { url });
await sleep(settle);

const run = async (expression) => {
  const answer = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (answer.result?.exceptionDetails) return `threw: ${answer.result.exceptionDetails.text}`;
  return answer.result?.result?.value;
};

for (const step of steps) {
  if (step.click) {
    const said = await run(
      `(() => { const el = document.querySelector(${JSON.stringify(step.click)});
        if (!el) return 'MISSING ' + ${JSON.stringify(step.click)};
        el.click(); return 'clicked'; })()`,
    );
    console.log(`click ${step.click}: ${said}`);
    await sleep(700);
  } else {
    console.log(JSON.stringify(await run(step.eval), null, 2));
  }
}

if (out !== '-') {
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  if (!shot.result?.data) {
    console.error('no screenshot:', JSON.stringify(shot).slice(0, 300));
    process.exit(1);
  }
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.error(`wrote ${out}`);
}
if (noise.length) console.log(`\nconsole: \n  ${noise.join('\n  ')}`);
ws.close();
chrome.kill();
process.exit(0);
