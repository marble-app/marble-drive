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

test('narrow Focus is the phone column and does not add extra panes', async () => {
  const { page } = await openAgents({ viewport: { width: 500, height: 800 } });
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    await agent.start({ provider: 'fake' });
    await agent.start({ provider: 'fake' });
  });
  // The view bar is behind ⋯ at this width; the stored view opens Focus.
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 2);
  assert.equal(await page.locator('.focus[data-phone]').count(), 1);
  assert.equal(await page.locator('.focus[data-stack]').count(), 0);
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
  // It used to be taller than wide here too, but only because a dead New-group
  // column stood in the leftover width and kept it narrow. That column is gone
  // — it is drawn as a rail while a card is in the air now — so with a single
  // pin and one loose chat the pane takes the slack it leaves, which is what
  // "Focus fills the screen" asks for. What matters is that it is a column of
  // the field's own height, checked above and beside it, checked below.
  assert.ok(shape.full.w < shape.canvasH * 1.2, `Full ${shape.full.w} is a band, not a column`);
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
  // Aim at the basin as it stands once the card is in the air. The field no
  // longer moves when you lift one, so this is the same rect either way — but
  // the loose region joins the canvas for the drag and takes the foot of a
  // column, so the bottom edge is no longer Two's to give.
  const box = await page.locator(`.focus-card[data-id="${ids.move}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 16, box.y + 26, { steps: 3 });
  await page.waitForTimeout(200);
  const target = await middleOf(page, `.focus-basin[data-folder-id="${ids.to}"]`);
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.move(target.x, target.y);
  const release = async () => { await page.mouse.up(); };
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
  // The pin springs the card into the stage; press it once it has landed.
  await page.waitForTimeout(500);

  // A pin is a pane now, so it leaves the stage by its bar: dragged into the
  // field, it is unpinned where it lands.
  const bar = await page.locator('.pane .dock-bar[data-key="P"]').boundingBox();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2 + 30, bar.y + 40, { steps: 3 });
  const loose = await middleOf(page, '.focus-basin[data-folder-id="ungrouped"]');
  await page.mouse.move(loose.x, loose.box.y + loose.box.height - 10, { steps: 8 });
  await page.mouse.up();
  await until(page, async () => (await metaOf(page, ids.a))?.pinned === false, 'the card to unpin');
});

test('there is no New group column, at rest, under a selection or on a lift', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [
    { key: 'a', title: 'alpha' },
    { key: 'b', title: 'beta' },
  ]);
  // At rest it was a column that could not be pressed and cost the field its
  // width; raised only for a drag it moved the whole canvas the moment you
  // lifted a card. Folders are made by dropping one card squarely on another
  // (covered above) or from "Save as folder" on a card's menu.
  assert.equal(await page.locator('.focus-newgroup').count(), 0, 'at rest');
  await page.locator(`.focus-card[data-id="${ids.a}"]`).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.focus-newgroup').count(), 0, 'under a selection');

  const box = await page.locator(`.focus-card[data-id="${ids.a}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 16, box.y + 26, { steps: 3 });
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.focus-newgroup').count(), 0, 'on a lift');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.ok(ids.b, 'seeded');
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

test('a digest shows the same pills a row does; a chip keeps its dot and hides the rest', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, title: `card ${i}` })));
  await page.locator(`.focus-card[data-id="${ids.c0}"]`).click();
  await page.waitForFunction((id) => document.querySelector(`.focus-card[data-id="${id}"]`)?.dataset.lod === 'digest', ids.c0);
  const digest = page.locator(`.focus-card[data-id="${ids.c0}"]`);
  assert.ok(await digest.locator('.tags .tag').count() >= 1, 'a digest carries pills');
  const pill = await digest.locator('.tags .tag').first().evaluate((el) => getComputedStyle(el).borderRadius);
  const rowPill = await page.evaluate(() => getComputedStyle(document.querySelector('#list .conv .tags .tag')).borderRadius);
  assert.equal(pill, rowPill, 'same pill everywhere');
  await page.waitForFunction(() => [...document.querySelectorAll('.focus-card')].some((el) => el.dataset.lod === 'chip'));
  const chip = page.locator('.focus-card[data-lod="chip"]').first();
  assert.equal(await chip.locator('.dot').evaluate((el) => getComputedStyle(el).display !== 'none'), true, 'a chip keeps its dot');
  assert.equal(await chip.locator('.tags .tag').evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).length), 0, 'a chip hides the pills');
});

test('hovering a chip lifts it without resizing it or moving its neighbours', async () => {
  const { page } = await openAgents();
  await seedFocus(page, Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, title: `card ${i}` })));
  await page.waitForFunction(() => [...document.querySelectorAll('.focus-card')].some((el) => el.dataset.lod === 'chip'));
  await page.waitForTimeout(500);
  const chip = page.locator('.focus-card[data-lod="chip"]').first();
  const before = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((el) => [el.dataset.id, Math.round(el.getBoundingClientRect().top), Math.round(el.getBoundingClientRect().height)]));
  await chip.hover();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((el) => [el.dataset.id, Math.round(el.getBoundingClientRect().top), Math.round(el.getBoundingClientRect().height)]));
  assert.deepEqual(after, before, 'nothing moved or grew');
  assert.equal(await chip.getAttribute('data-lod'), 'chip');
});

test('selecting a chip grows it with an animation, not a snap', async () => {
  const { page } = await openAgents();
  await seedFocus(page, Array.from({ length: 7 }, (_, i) => ({ key: `c${i}`, title: `card ${i}` })));
  await page.waitForFunction(() => [...document.querySelectorAll('.focus-card')].some((el) => el.dataset.lod === 'chip'));
  await page.waitForTimeout(500);
  const chip = page.locator('.focus-card[data-lod="chip"]').first();
  const id = await chip.getAttribute('data-id');
  const grew = page.evaluate((cid) => new Promise((resolve, reject) => {
    const el = document.querySelector(`.focus-card[data-id="${cid}"]`);
    const start = performance.now();
    const tick = () => {
      const anim = el.getAnimations().find((a) => a.effect?.getKeyframes?.().some((k) => 'height' in k));
      if (anim) resolve(anim.effect.getTiming().duration);
      else if (performance.now() - start > 4000) reject(new Error('no size animation'));
      else requestAnimationFrame(tick);
    };
    tick();
  }), id);
  await chip.click();
  const duration = await grew;
  assert.ok(duration >= 200 && duration <= 400, `height animates (${duration}ms)`);
});

test('a drop springs home before the PATCH round trip completes', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [{ key: 'a', title: 'first' }, { key: 'b', title: 'second' }, { key: 'c', title: 'third' }]);
  await page.evaluate(() => {
    const agent = window.marble.agent;
    const real = agent.update.bind(agent);
    window.__slow = [];
    agent.update = (id, body) => new Promise((resolve) => { window.__slow.push(() => resolve(real(id, body))); });
  });
  const target = await page.locator(`.focus-card[data-id="${ids.a}"]`).boundingBox();
  const release = await dragTo(page, ids.c, { x: target.x + target.width / 2, y: target.y + 6 });
  await release();
  await page.waitForTimeout(600);
  const order = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].sort((p, q) => p.getBoundingClientRect().top - q.getBoundingClientRect().top).map((el) => el.dataset.id));
  assert.equal(order[0], ids.c, 'the card is in its slot while the PATCH is still pending');
  await page.evaluate(() => { for (const go of window.__slow) go(); });
});

test('two two-card folders share a field column, one above the other', async () => {
  // Two two-digest regions are ~360px each; a 720px viewport cannot stack them.
  const { page } = await openAgents({ viewport: { width: 1280, height: 1000 } });
  const ids = await seedFocus(page, [
    { key: 'a1', title: 'a one' }, { key: 'a2', title: 'a two' },
    { key: 'b1', title: 'b one' }, { key: 'b2', title: 'b two' },
  ]);
  await page.evaluate(async (seeded) => {
    await window.marble.agent.createFolder({ conversationIds: [seeded.a1, seeded.a2], name: 'A' });
    await window.marble.agent.createFolder({ conversationIds: [seeded.b1, seeded.b2], name: 'B' });
  }, ids);
  await page.waitForFunction(() => document.querySelectorAll('.focus-basin[data-folder-id]:not([data-loose])').length === 2);
  await page.waitForTimeout(500);
  const basins = await page.evaluate(() => [...document.querySelectorAll('.focus-basin:not([data-loose])')].map((b) => { const r = b.getBoundingClientRect(); return { id: b.dataset.folderId, x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }; }));
  assert.equal(basins[0].x, basins[1].x, 'same column: ' + JSON.stringify(basins));
  assert.ok(basins[1].y >= basins[0].y + basins[0].h, 'stacked');
  // And a drop into the lower basin still joins that folder.
  const lower = basins[1];
  const release = await dragTo(page, ids.a1, { x: lower.x + 60, y: lower.y + lower.h - 30 });
  await page.locator(`.focus-basin[data-folder-id="${lower.id}"][data-drop="into"]`).waitFor();
  await release();
  await until(page, async () => (await metaOf(page, ids.a1))?.folderId === (await metaOf(page, ids.b1))?.folderId, 'a1 to join B');
});

test('pinning makes a pane in the stage, and a second pin sits beside it by default', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [{ key: 'a', title: 'first' }, { key: 'b', title: 'second' }, { key: 'c', title: 'loose' }]);
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dblclick();
  await page.locator(`.pane marble-conversation[conversation="${ids.a}"]`).waitFor();
  await page.waitForTimeout(500);
  await page.locator(`.focus-card[data-id="${ids.b}"]`).dblclick({ modifiers: ['Shift'] });
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)').length === 2);
  await page.waitForTimeout(700);
  const frames = await page.evaluate(() => [...document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)')].map((f) => { const r = f.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }; }));
  assert.equal(frames[0].y, frames[1].y, 'side by side: ' + JSON.stringify(frames));
  assert.ok(frames[0].h > 400, 'a conversation is a tall thing');
  assert.equal(await page.locator('.pane .dock-frame[data-focused]').count(), 1);
});

test('dropping a card on the bottom band of a stage pane stacks it under', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [{ key: 'a', title: 'first' }, { key: 'b', title: 'second' }]);
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dblclick();
  await page.locator(`.pane marble-conversation[conversation="${ids.a}"]`).waitFor();
  await page.waitForTimeout(500);
  const paneBox = await page.locator('.pane').boundingBox();
  const widthBefore = paneBox.width;
  const release = await dragTo(page, ids.b, { x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height * 0.92 });
  await page.locator('.pane .dock-ghost').waitFor();
  await release();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost):not(.marble-leaving)').length === 2);
  await page.waitForTimeout(700);
  const frames = await page.evaluate(() => [...document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)')].map((f) => { const r = f.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
  assert.equal(frames[0].x, frames[1].x, 'one column: ' + JSON.stringify(frames));
  assert.notEqual(frames[0].y, frames[1].y, 'stacked');
  await until(page, async () => (await metaOf(page, ids.b))?.pinned === true, 'b to be pinned');
  // Stacked, the two pins are one column, and with no field left that column
  // is the whole canvas: the stage fills what the field does not take.
  const { stageW, canvasW, margin } = await page.evaluate(() => ({
    stageW: document.querySelector('.pane').getBoundingClientRect().width,
    canvasW: document.querySelector('.focus').clientWidth,
    // The canvas margin belongs to the layout module, not to this file.
    margin: window.marbleAgentFolders?.MARGIN ?? 8,
  }));
  assert.ok(stageW > widthBefore, `the stage grew into the room the field gave up (${stageW} vs ${widthBefore})`);
  assert.ok(
    Math.abs(stageW - (canvasW - 2 * margin)) < 2,
    `one column fills the canvas (${stageW} of ${canvasW}, margin ${margin})`,
  );
});

test('the Focus arrangement and the List arrangement do not overwrite each other', async () => {
  const { page } = await openAgents();
  const ids = await seedFocus(page, [{ key: 'a', title: 'first' }, { key: 'b', title: 'second' }]);
  await page.locator(`.focus-card[data-id="${ids.a}"]`).dblclick();
  await page.locator(`.pane marble-conversation[conversation="${ids.a}"]`).waitFor();
  await page.waitForTimeout(500);
  await page.locator(`.focus-card[data-id="${ids.b}"]`).dblclick({ modifiers: ['Shift'] });
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)').length === 2);
  await page.locator('.views [data-view="library"]').click();
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.pane .dock-frame:not(.dock-ghost):not(.marble-leaving)').count(), 0, 'List is one pane');
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.pane .dock-frame:not(.dock-ghost)').length === 2);
});

// ---------------------------------------------------------- holding a target

/** The pane's bounding box was a cliff: room opened for a split, and two pixels
 *  past the edge — an edge nothing paints — `resolveDrop` fell out of bounds and
 *  the room vanished. Aiming "at the bottom" lands exactly there. */
test('room opened for a split survives the pointer drifting past the pane edge', async () => {
  // Pinned: the bands are fractions of the pane, so the geometry is the test.
  const { page } = await openAgents({ viewport: { width: 1440, height: 900 } });
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const made = [];
    for (const title of ['one', 'two', 'three']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      made.push(id);
    }
    await agent.update(made[0], { pinned: true });
    await agent.update(made[1], { pinned: true });
    return { dragged: made[2] };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.dragged}"]`).waitFor();
  await page.waitForTimeout(700);

  const from = await page.locator(`.focus-card[data-id="${ids.dragged}"]`).boundingBox();
  const pane = await page.locator('.pane').boundingBox();
  const bottom = pane.y + pane.height;
  const ghosts = () => page.evaluate(() => document.querySelectorAll('.dock-ghost:not(.marble-leaving)').length);

  await page.mouse.move(from.x + from.width / 2, from.y + 14);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 24, from.y + 30, { steps: 4 });
  await page.mouse.move(pane.x + pane.width * 0.5, bottom - 6, { steps: 12 });
  await page.waitForTimeout(350);
  assert.equal(await ghosts(), 1, 'no room opened inside the bottom band');

  // Outward, past the pane's own border, the way a hand aiming at the very
  // bottom of the screen does.
  const held = [];
  for (const dy of [2, 6, 12, 20]) {
    await page.mouse.move(pane.x + pane.width * 0.5, bottom + dy);
    await page.waitForTimeout(180);
    held.push({ dy, ghosts: await ghosts() });
  }
  // Far enough out is a different intention, and there the room should go.
  await page.mouse.move(pane.x + pane.width * 0.5, bottom + 160);
  await page.waitForTimeout(300);
  const farOut = await ghosts();
  await page.mouse.up();
  await page.waitForTimeout(400);

  assert.deepEqual(
    held.filter((row) => row.ghosts !== 1),
    [],
    `the room folded while the pointer was still at the pane's edge: ${JSON.stringify(held)}`,
  );
  assert.equal(farOut, 0, 'the room stayed open with the pointer well away from the pane');
});

/** The reaction was wired but imperceptible: a 6% background shift and a 1px
 *  border tint on a region hundreds of pixels across reads as nothing at all. */
test('a region being aimed at changes in a way you can actually see', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const made = [];
    for (const title of ['a', 'b', 'c', 'd']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      made.push(id);
    }
    await agent.createFolder({ conversationIds: [made[0], made[1]], name: 'Grouped' });
    return { dragged: made[3] };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.dragged}"]`).waitFor();
  await page.waitForTimeout(700);

  const reaction = await page.evaluate(() => {
    const read = (b) => {
      const s = getComputedStyle(b);
      return { ring: s.boxShadow, width: parseFloat(s.borderTopWidth), bg: s.backgroundColor };
    };
    const out = {};
    for (const basin of document.querySelectorAll('.focus-basin')) {
      const key = basin.hasAttribute('data-loose') ? 'loose' : 'folder';
      const was = basin.dataset.drop ?? null;
      delete basin.dataset.drop;
      const off = read(basin);
      basin.dataset.drop = 'into';
      const on = read(basin);
      if (was) basin.dataset.drop = was; else delete basin.dataset.drop;
      out[key] = { off, on };
    }
    return out;
  });

  for (const [which, { off, on }] of Object.entries(reaction)) {
    assert.ok(
      on.ring !== off.ring && on.ring !== 'none',
      `the ${which} region gains no ring when aimed at (${off.ring} → ${on.ring})`,
    );
  }
});
/** The bands a pane splits along are aimed at, not looked at. Painting them
 *  was tried twice on 2026-09-18 and taken back both times — as four
 *  full-edge rectangles ("the glowing indicator ... i don't want to see
 *  this"), then in their true wedge shape, which was honest about the corners
 *  but read as sharp ("that angular view feels way too sharp and harsh").
 *  What previews a drop is the room. Nothing else is drawn over the panes
 *  while a card is in the air. */
test('a drag over a pane paints no bands over it', async () => {
  const { page } = await openAgents({ viewport: { width: 1440, height: 900 } });
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const made = [];
    for (const title of ['one', 'two', 'three']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
      made.push(id);
    }
    await agent.update(made[0], { pinned: true });
    await agent.update(made[1], { pinned: true });
    return { dragged: made[2] };
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator(`.focus-card[data-id="${ids.dragged}"]`).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.dock-ghost)').length === 2);
  await page.waitForTimeout(700);

  // The leftmost leaf, in the pane's own coordinates — the space the drop
  // resolver hit-tests in.
  const geom = await page.evaluate(() => {
    const p = document.querySelector('.pane').getBoundingClientRect();
    return { x: p.x, y: p.y, w: p.width, h: p.height };
  });
  const leaf = { x: geom.x, y: geom.y, w: geom.w / 2, h: geom.h };
  const painted = () => page.evaluate(() => document.querySelectorAll('.dock-zones, .dock-zone').length);

  const from = await page.locator(`.focus-card[data-id="${ids.dragged}"]`).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 14);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 24, from.y + 30, { steps: 4 });
  await page.mouse.move(leaf.x + leaf.w * 0.5, leaf.y + leaf.h * 0.5, { steps: 12 });
  await page.waitForTimeout(400);
  assert.equal(await painted(), 0, "bands were painted over a pane's middle");

  // Just inside the leaf's right edge: the drop that would split it. The room
  // is the preview, and it is the only one.
  await page.mouse.move(leaf.x + leaf.w - 24, leaf.y + leaf.h * 0.5, { steps: 10 });
  await page.waitForTimeout(500);
  assert.equal(await painted(), 0, 'bands were painted for a split');
  assert.equal(await page.locator('.dock-ghost').count(), 1, 'the room did not open');

  await page.mouse.up();
  await page.waitForTimeout(400);
});
