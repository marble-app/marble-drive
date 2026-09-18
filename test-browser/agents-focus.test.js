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
    // The drive is shared across this file's tests and `reset` only restores
    // the documents. A canvas is a layout, so what the last test left behind
    // is not noise here — it is a different layout.
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
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
    await agent.update(a, { title: 'upper-card' });
    await agent.update(b, { title: 'lower-card' });
    return { a, b };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.a}"]`).click();
  // Two loose chats share a column, so what separates them is down, not right.
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction((id) => document.querySelector('.focus-card[data-selected="true"]')?.dataset.id === id, ids.b);
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

// ---------------------------------------------------------------- rearranging

/** A real drag: past the 10px that commits it, then a walk to the target so
 *  the canvas can aim, open its gap and light the column on the way. */
const dragTo = async (page, id, to) => {
  const box = await page.locator(`.focus-card[data-id="${id}"]`).boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + 14 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.move(to.x, to.y);
  return async () => {
    await page.mouse.up();
  };
};

/** `page.waitForFunction` takes the Promise an async predicate returns as a
 *  truthy value and resolves immediately, so anything that has to ask the
 *  store is polled from here, where `evaluate` really does await. */
const until = async (page, check, what) => {
  for (let i = 0; i < 80; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const metaOf = async (page, id) => (
  await page.evaluate((row) => window.marble.agent.conversation(row), id)
)?.meta ?? null;

const middleOf = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

const seedFocus = async (page, rows) => {
  const ids = await page.evaluate(async (list) => {
    const agent = window.marble.agent;
    const made = {};
    for (const row of list) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title: row.title });
      made[row.key] = id;
    }
    return made;
  }, rows);
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction((n) => document.querySelectorAll('.focus-card').length >= n, rows.length);
  return ids;
};

test('a pinned conversation is a full-height column beside the field, not a band above it', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [
    { key: 'a', title: 'pinned one' },
    { key: 'b', title: 'loose one' },
  ]);
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dblclick();
  await page.waitForFunction((id) => document.querySelector(`.focus-card[data-id="${id}"]`)?.dataset.lod === 'full', ids.a);
  await page.waitForTimeout(500);
  const shape = await page.evaluate((seeded) => {
    const canvas = document.querySelector('.focus');
    const full = document.querySelector(`.focus-card[data-id="${seeded.a}"]`);
    const other = document.querySelector(`.focus-card[data-id="${seeded.b}"]`);
    return {
      canvasH: canvas.clientHeight,
      full: { x: full.offsetLeft, y: full.offsetTop, w: full.offsetWidth, h: full.offsetHeight },
      other: { x: other.offsetLeft, y: other.offsetTop },
    };
  }, ids);
  // The old stage was min(h * .52, 460) tall and spanned the canvas.
  assert.ok(shape.full.h > shape.canvasH * 0.9, `Full only ${shape.full.h} of ${shape.canvasH}`);
  assert.ok(shape.full.w < shape.canvasH, 'a conversation should be taller than it is wide here');
  // Rank reads across, so the field sits beside the stage and not under it.
  assert.ok(shape.other.x > shape.full.x + shape.full.w - 1, 'the field slid under the stage');
  assert.ok(Math.abs(shape.other.y - shape.full.y) < 60, 'the field started below the stage');
});

test('dragging a card into another folder’s column joins that folder', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const row of await agent.conversations()) {
      if (row.pinned) await agent.update(row.id, { pinned: false });
    }
    const mk = async (title) => {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      return id;
    };
    const one = [await mk('one-a'), await mk('one-b')];
    const two = [await mk('two-a'), await mk('two-b')];
    const a = await agent.createFolder({ conversationIds: one, name: 'One', color: 'research' });
    const b = await agent.createFolder({ conversationIds: two, name: 'Two', color: 'fun' });
    return { move: one[0], from: a.folder?.id ?? a.id, to: b.folder?.id ?? b.id };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.focus-basin').length >= 2);
  const target = await middleOf(page, `.focus-basin[data-folder-id="${ids.to}"]`);
  const release = await dragTo(page, ids.move, { x: target.x, y: target.box.y + target.box.height - 80 });
  assert.equal(await page.locator('.focus-slot').count(), 1, 'the slot it will land in must be drawn');
  assert.equal(await page.locator(`.focus-basin[data-folder-id="${ids.to}"][data-drop="into"]`).count(), 1);
  await release();
  await until(page, async () => (await metaOf(page, ids.move))?.folderId === ids.to, 'the card to join Two');
});

test('dragging a card up its own column reorders it, and files one rank', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [
    { key: 'a', title: 'first' },
    { key: 'b', title: 'second' },
    { key: 'c', title: 'third' },
  ]);
  const before = await page.evaluate(() => [...document.querySelectorAll('.focus-card')]
    .sort((x, y) => x.offsetTop - y.offsetTop).map((el) => el.dataset.id));
  assert.deepEqual(before, [ids.a, ids.b, ids.c], 'seeded oldest first');
  const top = await page.locator(`.focus-card[data-id="${ids.a}"]`).boundingBox();
  const release = await dragTo(page, ids.c, { x: top.x + top.width / 2, y: top.y + 6 });
  await release();
  await page.waitForFunction((seeded) => {
    const order = [...document.querySelectorAll('.focus-card')]
      .sort((x, y) => x.offsetTop - y.offsetTop).map((el) => el.dataset.id);
    return order[0] === seeded.c;
  }, ids);
  // The page moves first and files second, so wait for the ranks to land.
  const ranks = async () => {
    const out = {};
    for (const key of ['a', 'b', 'c']) out[key] = (await metaOf(page, ids[key]))?.focusY ?? null;
    return out;
  };
  await until(page, async () => Object.values(await ranks()).every((v) => typeof v === 'number'), 'the ranks to be filed');
  const ranked = await ranks();
  assert.ok(ranked.c < ranked.a, `c (${ranked.c}) should rank above a (${ranked.a})`);
  assert.ok(ranked.a < ranked.b, `a (${ranked.a}) should rank above b (${ranked.b})`);
});

test('dragging a card to the stage pins it, and dragging it back off unpins it', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [
    { key: 'a', title: 'to pin' },
    { key: 'b', title: 'stays loose' },
  ]);
  const canvas = await page.locator('.focus').boundingBox();
  let release = await dragTo(page, ids.a, { x: canvas.x + 10, y: canvas.y + canvas.height / 2 });
  assert.equal(await page.locator('.focus-pinslot').count(), 1, 'an empty stage must offer a slot to aim at');
  await release();
  await page.waitForFunction((id) => document.querySelector(`.focus-card[data-id="${id}"]`)?.dataset.lod === 'full', ids.a);
  assert.equal(await page.locator('.focus-pinslot').count(), 0, 'and take it away again');

  const loose = await middleOf(page, '.focus-basin[data-folder-id="ungrouped"]');
  release = await dragTo(page, ids.a, { x: loose.x, y: loose.box.y + loose.box.height - 60 });
  await release();
  await until(page, async () => (await metaOf(page, ids.a))?.pinned === false, 'the card to unpin');
});

test('dropping on the New group column makes a folder', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [
    { key: 'a', title: 'alpha' },
    { key: 'b', title: 'beta' },
  ]);
  await page.locator('.focus-newgroup').waitFor();
  const slot = await middleOf(page, '.focus-newgroup');
  const release = await dragTo(page, ids.a, slot);
  assert.equal(await page.locator('.focus-newgroup[data-drop="into"]').count(), 1);
  await release();
  await until(page, async () => Boolean((await metaOf(page, ids.a))?.folderId), 'a folder to be made');
});

test('Escape cancels a drag and files nothing', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const row of await agent.conversations()) {
      if (row.pinned) await agent.update(row.id, { pinned: false });
    }
    const mk = async (title) => {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      return id;
    };
    const keep = await mk('filed');
    const other = await mk('also filed');
    const folder = await agent.createFolder({ conversationIds: [keep, other], name: 'Keep', color: 'research' });
    return { keep, folder: folder.folder?.id ?? folder.id };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator('.focus-basin').first().waitFor();
  const canvas = await page.locator('.focus').boundingBox();
  await dragTo(page, ids.keep, { x: canvas.x + 10, y: canvas.y + canvas.height / 2 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(400);
  const meta = await metaOf(page, ids.keep);
  assert.equal(meta.pinned, false, 'a cancelled drag must not pin');
  assert.equal(meta.folderId, ids.folder, 'nor move the card out of its folder');
  assert.equal(await page.locator('.focus-slot').count(), 0, 'and it takes its slot away with it');
});

test('Alt and an arrow move the card, so arranging is not pointer-only', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [
    { key: 'a', title: 'first' },
    { key: 'b', title: 'second' },
  ]);
  await page.locator(`.focus-card[data-id="${ids.b}"]`).click();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForFunction((seeded) => {
    const order = [...document.querySelectorAll('.focus-card')]
      .sort((x, y) => x.offsetTop - y.offsetTop).map((el) => el.dataset.id);
    return order[0] === seeded.b;
  }, ids);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForFunction((id) => document.querySelector(`.focus-card[data-id="${id}"]`)?.dataset.lod === 'full', ids.b);
});
