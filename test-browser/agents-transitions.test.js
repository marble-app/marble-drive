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

/** Switch and catch the layer while it is up. */
const switchAndCatch = async (page, view) => {
  await page.evaluate((v) => { document.querySelector(`.views [data-view="${v}"]`).click(); }, view);
  return page.evaluate(() => new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      const layer = document.querySelector('.vt-layer');
      if (layer && layer.children.length) {
        resolve([...layer.children].map((g) => ({ id: g.dataset.id, anims: g.getAnimations().length })));
      } else if (performance.now() - start > 3000) reject(new Error('no morph layer appeared'));
      else requestAnimationFrame(tick);
    };
    tick();
  }));
};

test('List to Focus morphs each row into its card', async () => {
  const { page, ids } = await openAgents();
  const ghosts = await switchAndCatch(page, 'focus');
  assert.deepEqual(ghosts.map((g) => g.id).sort(), [...ids].sort());
  assert.ok(ghosts.every((g) => g.anims >= 1));
  await page.waitForFunction(() => !document.querySelector('.vt-layer'), null, { timeout: 3000 });
  const landed = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((el) => getComputedStyle(el).opacity));
  assert.ok(landed.every((o) => o === '1'), `cards land opaque: ${landed}`);
});

test('Focus to Folders morphs each card into its tab, and a switch mid-switch leaves no layer', async () => {
  const { page, ids } = await openAgents();
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.focus-card').length === 3 && !document.querySelector('.vt-layer'));
  const ghosts = await switchAndCatch(page, 'folders');
  assert.deepEqual(ghosts.map((g) => g.id).sort(), [...ids].sort());
  await page.evaluate(() => document.querySelector('.views [data-view="board"]').click());
  await page.waitForFunction(() => !document.querySelector('.vt-layer'), null, { timeout: 3000 });
  assert.equal(await page.locator('.vt-ghost').count(), 0);
  assert.equal(await page.locator('.column .conv').count(), 3);
});

test('reduced motion crossfades without ghosts', async () => {
  const { page } = await openAgents();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.querySelector('.views [data-view="focus"]').click());
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'focus');
  assert.equal(await page.locator('.vt-layer').count(), 0);
});
