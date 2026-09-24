// A tab nobody is using closes its streams, so its sprite can sleep, and a tab
// used again catches up on what it missed (runtime/tab-rest.js). Limits are
// shortened: hidden half a second, idle 1.2 seconds.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  first: [{ say: 'The first reply.' }],
  second: [{ say: 'The reply sent while the tab rested.' }],
};

const host = await startDrive({
  scripts: SCRIPTS,
  env: { MARBLE_DRIVE_TAB_HIDDEN_SECONDS: '0.5', MARBLE_DRIVE_TAB_IDLE_MINUTES: '0.02' },
});
test.after(() => host.close());

const pages = [];
test.after(async () => {
  for (const page of pages) await page.close().catch(() => {});
});

const streams = async () => (await (await fetch(`${host.base}/health`)).json()).streams;
const until = async (fn, what, ms = 8_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

async function open() {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
  await host.reset();
  await until(async () => (await streams()) === 0, 'the last test\'s streams to close');
  const { page, errors } = await host.newPage();
  pages.push(page);
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleTabRest));
  await until(async () => (await streams()) > 0, 'the page\'s streams');
  return { page, errors };
}

test('a tab left idle closes every stream, and a change made meanwhile shows once it is used', async () => {
  const { page, errors } = await open();
  await until(async () => (await streams()) === 0, 'an idle tab to close its streams');
  assert.equal(await page.evaluate(() => window.marbleTabRest.resting), true);

  await host.drive.createDocument('garden', GARDEN.replace('Research Garden', 'Changed While Resting'), { label: 'test' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.locator('h1').textContent(), 'Research Garden', 'a resting tab hears nothing');

  await page.mouse.move(200, 200);
  await page.mouse.move(220, 210);
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Changed While Resting');
  assert.ok((await streams()) > 0, 'its streams are back');
  assert.deepEqual(errors, []);
});

test('a hidden tab rests, and wakes when shown', async () => {
  const { page } = await open();
  await page.mouse.move(10, 10);
  const setVisibility = (state) => page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  await setVisibility('hidden');
  await until(async () => (await streams()) === 0, 'a hidden tab to close its streams');
  await setVisibility('visible');
  await until(async () => (await streams()) > 0, 'the streams to reopen when shown');
});

test('an agent conversation that ran while the tab rested is replayed, once each', async () => {
  const { page } = await open();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    window.__seen = [];
    agent.on(id, (event) => window.__seen.push(event));
    await agent.send(id, { prompt: 'script:first' });
    return id;
  });
  await page.waitForFunction(() => window.__seen.some((e) => e.type === 'turn.completed'));
  await page.waitForFunction(() => window.marbleTabRest.resting, null, { timeout: 8_000 });

  // Sent by another device while this tab rests.
  const sent = await fetch(`${host.base}/agent/conversations/${id}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'script:second', context: { target: 'garden', viewing: 'garden', selection: [], also: [] } }),
  });
  assert.equal(sent.status < 300, true, `sent: ${sent.status}`);
  await until(async () => {
    const events = await host.drive.agents.store.events(id);
    return events.filter((e) => e.type === 'turn.completed').length === 2;
  }, 'the second turn to finish');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await page.evaluate(() => window.__seen.filter((e) => e.type === 'turn.completed').length), 1);

  await page.mouse.move(300, 300);
  await page.waitForFunction(() => window.__seen.filter((e) => e.type === 'turn.completed').length === 2);
  const seqs = await page.evaluate(() => window.__seen.filter((e) => e.seq).map((e) => e.seq));
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'every stored event once, in order');
});

test('a stream the page closes itself stays closed through a rest', async () => {
  const { page } = await open();
  await page.evaluate(() => {
    window.__mine = new EventSource('/events?drive=1');
    window.__mine.close();
  });
  await page.waitForFunction(() => window.marbleTabRest.resting, null, { timeout: 8_000 });
  await page.mouse.move(40, 40);
  await until(async () => (await streams()) > 0, 'the page\'s own streams to reopen');
  assert.equal(await page.evaluate(() => window.__mine.readyState), 2);
});

test('a tab the host gave up on (it looked forgotten) gets its streams back when used', async () => {
  // The host forgets a tab after 300 ms; the tab itself never rests. As after
  // a laptop sleeps: the page's timers froze, the host closed its streams, and
  // the browser's own reconnect was refused.
  const strict = await startDrive({
    agents: false,
    env: { MARBLE_DRIVE_STREAM_UNUSED_MINUTES: '0.005', MARBLE_DRIVE_TAB_IDLE_MINUTES: '10' },
  });
  try {
    const { page } = await strict.newPage();
    await page.goto(`${strict.base}/a/garden`);
    await page.waitForFunction(() => Boolean(window.marbleTabRest));
    const count = async () => (await (await fetch(`${strict.base}/health`)).json()).streams;
    await until(count.bind(null), 'the page\'s streams', 8_000).catch(() => {});
    await until(async () => (await count()) === 0, 'the host to close the streams of a tab it thinks is forgotten');
    // The browser's reconnect (a few seconds later) is refused with 204.
    await page.waitForFunction(() => {
      const probe = window.__probe ??= new EventSource('/events?drive=1');
      return probe.readyState === 2;
    }, null, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => window.marbleTabRest.resting), false);
    await page.mouse.move(50, 60);
    await page.mouse.move(70, 80);
    await until(async () => (await count()) > 0, 'the streams to come back once the tab is used');
  } finally {
    await strict.close();
  }
});
