// The Agents document on a phone: Deck, the fisheye Focus, the chrome and
// the sheets, all at 393 × 852 with a touch context.

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

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { say: 'Read it.' },
  ],
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
};

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true, ...options });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    localStorage.clear();
  });
  return { page, errors };
};

test('at phone width, Deck is the default view; a stored view wins', async () => {
  const { page } = await openAgents();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-view')), 'deck');
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-phone')), true);
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'library'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-view')), 'library');
});

test('V cycles through five views and comes back', async () => {
  const { page } = await openAgents({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('v');
    seen.push(await page.evaluate(() => document.body.getAttribute('data-view')));
  }
  assert.deepEqual(seen, ['board', 'folders', 'focus', 'deck', 'library']);
});

test('Deck: an asking conversation is a card in NEEDS YOU with a peek; Allow answers it optimistically', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  const card = page.locator('.deck [data-band="asks"] .deck-ask');
  await card.waitFor();
  assert.match(await card.locator('.deck-ask-title').textContent(), /script:permission|Untitled/);
  assert.match(await card.locator('.deck-peek').textContent(), /rm -rf build/);
  assert.match(await page.locator('.deck [data-band="asks"] .band-count').textContent(), /1/);
  await card.locator('button.allow').click();
  // Gone on tap, before the answer lands.
  assert.equal(await page.locator('.deck-ask').count(), 0);
  await page.locator(`.deck [data-band]:not([data-band="asks"]) .conv[data-id="${id}"]`).waitFor();
});

test('Deck: running, review and idle rows land in their bands with counts', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    return [await agent.start({ provider: 'fake' }), await agent.start({ provider: 'fake' })];
  });
  await host.drive.agents.store.updateConversation(ids[0], { running: true, activity: 'reading' });
  await host.drive.agents.store.updateConversation(ids[1], { lastOutcome: 'failed', lastFinishedAt: Date.now(), activity: 'boom' });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.deck .conv').length >= 2);
  assert.equal(await page.locator(`[data-band="running"] .conv[data-id="${ids[0]}"]`).count(), 1);
  assert.equal(await page.locator(`[data-band="review"] .conv[data-id="${ids[1]}"]`).count(), 1);
  assert.equal((await page.locator('[data-band="running"] .band-count').textContent()).trim(), '1');
  assert.equal(await page.evaluate(() => document.querySelector('[data-band="idle"]').hasAttribute('data-collapsed')), true);
});

test('a REVIEW row swiped right is marked reviewed; swiped left it reveals Undo and does not undo', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, { lastOutcome: 'changes', lastFinishedAt: Date.now(), activity: 'done' });
  await page.reload();
  const row = page.locator(`[data-band="review"] .conv[data-id="${id}"]`);
  await row.waitFor();
  const box = await row.boundingBox();
  const y = box.y + box.height / 2;
  // Left: reveal only.
  await page.mouse.move(box.x + 300, y);
  await page.mouse.down();
  for (let x = 300; x > 140; x -= 20) await page.mouse.move(box.x + x, y);
  await page.mouse.up();
  await page.locator(`.conv[data-id="${id}"] .swipe-undo`).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate((id) => document.querySelector(`.conv[data-id="${id}"]`).closest('.band').dataset.band, id), 'review');
  // Right: reviewed.
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  for (let x = 40; x < 260; x += 20) await page.mouse.move(box.x + x, y);
  await page.mouse.up();
  // Idle starts collapsed, so the row is attached there, not shown.
  await page.locator(`[data-band="idle"] .conv[data-id="${id}"]`).waitFor({ state: 'attached' });
});

test('long-press on a row opens the actions sheet; dragging it down closes it', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, { running: true, activity: 'busy' });
  await page.reload();
  const row = page.locator(`.deck .conv[data-id="${id}"]`);
  await row.waitFor();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 100, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(520);
  await page.mouse.up();
  const sheet = page.locator('.sheet[data-kind="actions"]');
  await sheet.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.body.getAttribute('data-sheet') === 'actions');
  assert.ok(await sheet.locator('button', { hasText: 'Archive' }).count());
  assert.ok(await sheet.locator('button', { hasText: 'Stop' }).count());
  const sb = await sheet.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 10);
  await page.mouse.down();
  for (let y = 10; y < 300; y += 24) await page.mouse.move(sb.x + sb.width / 2, sb.y + y);
  await page.mouse.up();
  await page.waitForFunction(() => !document.body.hasAttribute('data-sheet'));
});

test('the new-conversation sheet starts a conversation and opens it', async () => {
  const { page } = await openAgents();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.locator('.thumb-new').click();
  const sheet = page.locator('.sheet[data-kind="new"]');
  await sheet.waitFor({ state: 'visible' });
  await sheet.locator('.sheet-prompt').fill('script:rename');
  await sheet.locator('button.sheet-start').click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  await page.waitForFunction(() => document.querySelectorAll('.deck .conv').length === 1);
});

test('phone chrome: a one-row topbar, a thumb bar at the sill, 44pt controls, --vv-h, and install meta', async () => {
  const { page } = await openAgents();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  const top = await page.locator('.topbar').boundingBox();
  assert.ok(top.height <= 60, `topbar ${top.height}`);
  assert.equal(await page.locator('.topbar .more').isVisible(), true);
  assert.equal(await page.locator('.topbar .toggles').isVisible(), false);
  const thumb = await page.locator('.thumb').boundingBox();
  assert.ok(thumb.y + thumb.height >= 852 - 1, `thumb ends at ${thumb.y + thumb.height}`);
  for (const sel of ['.thumb-new', '.thumb-field', '.band[data-band="running"] .band-toggle', '.topbar .more']) {
    const box = await page.locator(sel).first().boundingBox();
    assert.ok(box && box.height >= 44, `${sel} is ${box?.height}`);
  }
  const vv = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vv-h').trim());
  assert.match(vv, /^\d+px$/);
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content), 'yes');
  assert.match(await page.evaluate(() => document.querySelector('meta[name="viewport"]').content), /viewport-fit=cover/);
  // The usage ring reads the worst meter.
  await page.locator('.topbar .usage-dot:not([hidden])').waitFor();
  assert.match(await page.locator('.topbar .usage-dot').getAttribute('title'), /\d+%/);
  // ⋯ lists the views.
  await page.locator('.topbar .more').click();
  await page.locator('.sheet[data-kind="more"] button', { hasText: 'Focus' }).waitFor({ state: 'visible' });
});

test('tapping a Deck row opens the conversation full screen at the phone density; an edge swipe goes back', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, { running: true, activity: 'busy' });
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  await page.waitForTimeout(350);
  const pane = await page.locator('.pane').boundingBox();
  assert.ok(pane.width >= 392 && pane.height >= 700, `pane ${pane.width}x${pane.height}`);
  assert.equal(await page.evaluate(() => document.querySelector('marble-conversation').getAttribute('data-chrome')), 'phone');
  assert.equal(await page.locator('.deck').isVisible(), false);
  await page.mouse.move(6, 400);
  await page.mouse.down();
  for (let x = 6; x < 220; x += 16) await page.mouse.move(x, 400);
  await page.mouse.up();
  await page.waitForFunction(() => !document.body.hasAttribute('data-open'));
  assert.equal(await page.locator('.deck').isVisible(), true);
});

const seedTwelve = async (page) => {
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const out = [];
    for (let i = 0; i < 12; i += 1) out.push(await agent.start({ provider: 'fake' }));
    return out;
  });
  for (const [i, id] of ids.entries()) {
    await host.drive.agents.store.updateConversation(id, { title: `Chat ${i}`, target: `Research/${i}.mrbl`, activity: 'idle', createdAt: 1000 + i });
  }
  return ids;
};

const openPhoneFocus = async (page) => {
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 12);
  await page.waitForFunction(() => !document.querySelector('.focus').hasAttribute('data-settling'));
};

test('phone Focus: one Full, digests beside it, chips beyond, slivers at the ends; the pane overlays the Full', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  const lods = await page.evaluate(() => [...document.querySelectorAll('.focus-card')].map((c) => c.dataset.lod));
  assert.equal(lods.filter((l) => l === 'full').length, 1, lods.join(','));
  assert.ok(lods.includes('digest') && lods.includes('chip') && lods.includes('sliver'), lods.join(','));
  const full = await page.locator('.focus-card[data-lod="full"]').boundingBox();
  const pane = await page.locator('.pane').boundingBox();
  assert.ok(Math.abs(full.y - pane.y) < 2 && Math.abs(full.height - pane.height) < 2, `pane ${pane.y}/${pane.height} vs full ${full.y}/${full.height}`);
  assert.ok(full.height > 300, `full is ${full.height}`);
});

test('phone Focus: dragging the stack keeps the grabbed card under the pointer, and a release snaps to one Full', async () => {
  const { page } = await openAgents();
  const ids = await seedTwelve(page);
  await openPhoneFocus(page);
  const before = await page.evaluate(() => document.querySelector('.focus-card[data-lod="full"]').dataset.id);
  const digest = page.locator('.focus-card[data-lod="digest"]').last();
  const grabbedId = await digest.getAttribute('data-id');
  const box = await digest.boundingBox();
  const offset = 20;
  const grabY = box.y + offset;
  await page.mouse.move(200, grabY);
  await page.mouse.down();
  const drift = [];
  for (let y = grabY; y > grabY - 220; y -= 20) {
    await page.mouse.move(200, y);
    const top = (await page.locator(`.focus-card[data-id="${grabbedId}"]`).boundingBox()).y;
    drift.push(Math.abs((y - offset) - top));
  }
  assert.ok(Math.max(...drift.slice(1)) < 4, `card drifted ${Math.max(...drift)}px`);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.focus-card[data-lod="full"]').length === 1 && !document.querySelector('.focus').hasAttribute('data-settling'));
  const after = await page.evaluate(() => document.querySelector('.focus-card[data-lod="full"]').dataset.id);
  assert.notEqual(after, before);
  assert.ok(ids.includes(after));
  assert.equal(await page.evaluate(() => document.querySelector('marble-conversation').getAttribute('conversation')), after);
});

test('phone Focus: less room demotes the neighbours and keeps the Full', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  const tall = await page.evaluate(() => document.querySelectorAll('.focus-card[data-lod="digest"]').length);
  await page.setViewportSize({ width: 393, height: 500 });
  await page.waitForTimeout(150);
  const short = await page.evaluate(() => document.querySelectorAll('.focus-card[data-lod="digest"]').length);
  assert.ok(short <= tall);
  const full = await page.locator('.focus-card[data-lod="full"]').boundingBox();
  assert.ok(full.height >= 112, `full is ${full.height}`);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.focus-card[data-lod="full"]').length), 1);
});

test('going hidden closes the streams; coming back reopens them and resyncs', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, { running: true, activity: 'busy' });
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"]`).waitFor();
  assert.ok((await page.evaluate(() => window.marble.agent.streamsOpen())) >= 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(() => window.marble.agent.streamsOpen()), 0);
  await host.drive.agents.store.updateConversation(id, { title: 'Renamed while away' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"] .title`)?.textContent === 'Renamed while away', id);
  assert.ok((await page.evaluate(() => window.marble.agent.streamsOpen())) >= 1);
});
