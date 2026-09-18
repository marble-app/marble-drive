import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    // The drive is shared across this file's tests; only this test's three
    // conversations should be on screen.
    try {
      for (const row of await agent.conversations()) await agent.archive(row.id, true);
    } catch { /* fresh agent */ }
    const out = [];
    for (const title of ['one', 'two', 'three']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      out.push(id);
    }
    return out;
  });
  await page.waitForFunction((n) => document.querySelectorAll('#list .conv:not([hidden])').length === n, ids.length);
  return { page, ids };
};

/** Switch, and read the page the moment the switch is under way. */
const switchAndCatch = async (page, view) => {
  await page.evaluate((v) => { document.querySelector(`.views [data-view="${v}"]`).click(); }, view);
  return page.evaluate(() => new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      if (document.body.hasAttribute('data-crossfade')) {
        resolve({
          frozen: [...document.querySelectorAll('.marble-vt-out')].map((el) => el.id || el.className.split(' ')[0]),
          snapshots: document.querySelectorAll('.vt-layer .vt-snapshot').length,
          perCard: document.querySelectorAll('.vt-layer [data-id], .vt-ghost').length,
          flying: [...document.querySelectorAll('.conv, .focus-card, .folder-tab')].filter((el) => el.getAnimations().length || el.classList.contains('marble-flip')).length,
        });
      } else if (performance.now() - start > 3000) reject(new Error('no crossfade started'));
      else requestAnimationFrame(tick);
    };
    tick();
  }));
};

const settled = (page) => page.waitForFunction(() => !document.body.hasAttribute('data-crossfade') && !document.querySelector('.vt-layer, .marble-vt-out'), null, { timeout: 4000 });

test('List to Focus fades the list out and the canvas in; no row or card flies', async () => {
  const { page } = await openAgents();
  const caught = await switchAndCatch(page, 'focus');
  assert.ok(caught.frozen.includes('list'), `the list is held where it stood: ${caught.frozen}`);
  assert.equal(caught.perCard, 0, 'no ghost per conversation');
  assert.equal(caught.flying, 0, 'no row or card animates on its own');
  await settled(page);
  const landed = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((el) => getComputedStyle(el).opacity));
  assert.equal(landed.length, 3);
  assert.ok(landed.every((o) => o === '1'), `cards land opaque: ${landed}`);
});

test('List to Board leaves as a snapshot of the list, and the rows themselves do not fly', async () => {
  const { page } = await openAgents();
  const caught = await switchAndCatch(page, 'board');
  assert.equal(caught.snapshots, 1, 'one snapshot, of the list');
  assert.equal(caught.flying, 0, 'rows are placed, not flown');
  await settled(page);
  assert.equal(await page.locator('.column .conv').count(), 3);
  assert.equal(await page.locator('.vt-snapshot').count(), 0);
});

test('a switch mid-switch leaves no layer and no frozen shell behind', async () => {
  const { page } = await openAgents();
  await page.locator('.views [data-view="focus"]').click();
  await settled(page);
  await switchAndCatch(page, 'folders');
  await page.evaluate(() => document.querySelector('.views [data-view="board"]').click());
  await settled(page);
  assert.equal(await page.locator('.column .conv').count(), 3);
  assert.equal(await page.locator('.marble-vt-out, .vt-layer').count(), 0);
});

test('reduced motion crossfades without a layer', async () => {
  const { page } = await openAgents();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.querySelector('.views [data-view="focus"]').click());
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'focus');
  assert.equal(await page.locator('.vt-layer').count(), 0);
});
