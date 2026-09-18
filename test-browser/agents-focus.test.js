import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const host = await startDrive({
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
  });
  return { page, errors };
};

test('click selects a Focus card; double-click pins Full and demotes the previous Full to digest', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'first', pinned: true });
    await agent.update(b, { title: 'second' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  const second = page.locator(`.focus-card[data-id="${ids.b}"]`);
  await second.click();
  assert.equal(await second.getAttribute('data-selected'), 'true');
  assert.equal(await second.getAttribute('data-lod'), 'digest');
  await second.dblclick();
  await page.waitForFunction((id) => {
    const el = document.querySelector(`.focus-card[data-id="${id}"]`);
    return el?.getAttribute('data-lod') === 'full';
  }, ids.b);
  assert.equal(await page.locator(`.focus-card[data-id="${ids.a}"]`).getAttribute('data-lod'), 'digest');
  const stillInPane = await page.evaluate(() => Boolean(document.querySelector('.pane > marble-conversation:not([data-marble-transient])')));
  assert.equal(stillInPane, true);
});

test('arrows move Focus selection; Space previews without pinning', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'left-card' });
    await agent.update(b, { title: 'right-card' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.a}"]`).click();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.focus-card[data-selected="true"]')?.textContent.includes('right-card')
    || document.querySelector('.focus-card[data-selected="true"]')?.dataset.id);
  await page.keyboard.press('Space');
  await page.locator('.focus-look').waitFor();
  const pinned = await page.evaluate((id) => window.marble.agent.conversation(id), ids.b);
  assert.equal((await pinned).meta.pinned, false);
  await page.keyboard.press('Enter');
  await page.waitForFunction((id) => document.querySelector(`.focus-card[data-id="${id}"]`)?.getAttribute('data-lod') === 'full', ids.b);
});

test('Focus folder chip can ungroup a card', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    for (const row of await agent.conversations()) {
      if (row.pinned) await agent.update(row.id, { pinned: false });
    }
    await agent.createFolder({ conversationIds: [a, b], name: 'CHI', color: 'fun' });
    return { a };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.a}"] .focus-folder`).click();
  await page.locator('.focus-folder-menu [data-action="ungroup"]').click();
  await page.waitForFunction((id) => {
    const card = document.querySelector(`.focus-card[data-id="${id}"]`);
    return Boolean(card) && !card.dataset.color;
  }, ids.a);
});

test('dropping a card on another ungrouped card forms a basin', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'a' });
    await agent.update(b, { title: 'b' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dragTo(page.locator(`.focus-card[data-id="${ids.b}"]`));
  await page.locator('.focus-basin').waitFor();
});

test('narrow Focus is a stack and does not add extra panes', async () => {
  const { page } = await openAgents({ viewport: { width: 500, height: 800 } });
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    await agent.start({ provider: 'fake' });
    await agent.start({ provider: 'fake' });
  });
  await page.locator('.views [data-view="focus"]').click();
  assert.equal(await page.locator('.focus[data-stack]').count(), 1);
  assert.equal(await page.locator('.pane marble-conversation[data-marble-transient]').count(), 0);
});

test('reduced motion pins without transform travel', async () => {
  const { page } = await openAgents({ reducedMotion: 'reduce' });
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'first' });
    await agent.update(b, { title: 'second' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.b}"]`).dblclick();
  await page.waitForFunction((id) => {
    const el = document.querySelector(`.focus-card[data-id="${id}"]`);
    return el?.getAttribute('data-lod') === 'full';
  }, ids.b);
  const traveling = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].some((card) => {
    const transform = getComputedStyle(card).transform;
    if (!transform || transform === 'none') return false;
    return [...card.getAnimations()].some((anim) => {
      const keyframes = anim.effect?.getKeyframes?.() ?? [];
      return keyframes.some((frame) => frame.transform && frame.transform !== 'none');
    });
  }));
  assert.equal(traveling, false);
});

test('with nothing pinned, Focus has no stage band and hides the live pane', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const row of await agent.conversations()) {
      if (row.pinned) await agent.update(row.id, { pinned: false });
    }
    for (const title of ['alpha', 'beta', 'gamma']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
    }
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.focus-card').length >= 3);
  const shape = await page.evaluate(() => {
    const canvas = document.querySelector('.focus');
    const tops = [...document.querySelectorAll('.focus-card')].map((card) => card.offsetTop);
    return {
      height: canvas.clientHeight,
      top: Math.min(...tops),
      paneShown: getComputedStyle(document.querySelector('.pane')).display !== 'none',
    };
  });
  // A Full-sized band used to be reserved whether or not anything was pinned,
  // which left the whole upper half of the canvas empty.
  assert.ok(shape.top < shape.height * 0.25, `topmost card at ${shape.top} of ${shape.height}`);
  assert.equal(shape.paneShown, false, 'the composer must not lie across an unpinned canvas');
});

test('Focus basins are regions that never overlap or leave the canvas', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const row of await agent.conversations()) {
      if (row.pinned) await agent.update(row.id, { pinned: false });
    }
    const mk = async (title, target) => {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      return id;
    };
    await agent.createFolder({ conversationIds: [await mk('a'), await mk('b')], name: 'One', color: 'research' });
    await agent.createFolder({ conversationIds: [await mk('c'), await mk('d')], name: 'Two', color: 'fun' });
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.focus-basin').length >= 2);
  const basins = await page.evaluate(() => [...document.querySelectorAll('.focus-basin')].map((b) => ({
    x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight,
  })));
  for (const basin of basins) {
    assert.ok(basin.x >= 0 && basin.y >= 0, `basin off-canvas at ${basin.x},${basin.y}`);
  }
  for (let i = 0; i < basins.length; i += 1) {
    for (let j = i + 1; j < basins.length; j += 1) {
      const a = basins[i];
      const b = basins[j];
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(hit, false, 'two folders must not own the same pixels');
    }
  }
});

test('switching view eases out instead of the Web Animations linear default', async () => {
  const { page } = await openAgents();
  const easings = await page.evaluate(async () => {
    const shells = () => [...document.querySelectorAll('.library, .board, .folders, .focus')];
    document.querySelector('.views [data-view="folders"]').click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return shells().flatMap((el) => el.getAnimations().map((anim) => anim.effect.getTiming().easing));
  });
  assert.ok(easings.length > 0, 'expected the view switch to animate');
  assert.equal(easings.includes('linear'), false, `view switch still linear: ${easings.join(', ')}`);
});
