import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
  hold: [{ silent: 20_000 }],
};

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, reading: GARDEN.replace('Research Garden', 'Reading List').replace('<title>Garden', '<title>Reading') },
});
test.after(() => host.close());

async function visit(path = 'garden', options = {}) {
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/${path}`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  const drawer = page.locator('marble-agent-drawer');
  return { page, errors, drawer, panel: drawer.locator('aside.panel'), view: drawer.locator('marble-conversation') };
}

const opened = (panel) => panel.locator('xpath=self::*[@data-open="true"]').waitFor();

test('the drawer is on the page and not in the document', async () => {
  await host.reset();
  const { page, drawer, panel, errors } = await visit();
  assert.equal(await drawer.getAttribute('data-marble-transient'), '');
  assert.equal(await panel.getAttribute('data-open'), 'false');
  const served = await (await fetch(`${host.base}/a/garden`)).text();
  assert.ok(!served.includes('<marble-agent-drawer'), 'never written into the document');
  await drawer.locator('.launcher').click();
  await opened(panel);
  assert.equal(await page.locator('marble-agent-drawer').count(), 1);
  assert.equal(await host.drive.store.read('garden'), GARDEN, 'the file is untouched by opening the drawer');
  assert.deepEqual(errors, []);
});

test('⌘J and Ctrl+J toggle it, Escape closes it, and opening focuses the composer', async () => {
  const { page, panel, view } = await visit();
  await page.keyboard.press('Meta+j');
  await opened(panel);
  await page.waitForFunction(() => {
    const view = document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation');
    return view.shadowRoot.activeElement?.tagName === 'TEXTAREA';
  });
  await view.locator('textarea').press('Escape');
  await panel.locator('xpath=self::*[@data-open="false"]').waitFor();
  await page.keyboard.press('Control+j');
  await opened(panel);
  await page.keyboard.press('Control+j');
  await panel.locator('xpath=self::*[@data-open="false"]').waitFor();
});

test('a conversation from the drawer edits the page, and follows you to the next page', async () => {
  await host.reset();
  const { page, drawer, panel, view } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await view.locator('textarea').fill('script:rename');
  await view.locator('textarea').press('Enter');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await page.locator('h1', { hasText: 'Backlog' }).waitFor();
  await drawer.locator('.title-text', { hasText: 'script:rename' }).waitFor();

  await page.goto(`${host.base}/a/reading`);
  const again = page.locator('marble-agent-drawer');
  await again.locator('aside.panel[data-open="true"]').waitFor();
  await again.locator('marble-conversation .turn-footer[data-status="completed"]').waitFor();
  assert.equal(await again.locator('marble-conversation .msg.me').count(), 1);
});

test('the header names the file being edited when you are looking at another page', async () => {
  await host.reset();
  const { page, drawer, panel, view } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await drawer.locator('button.new').click();
  await view.locator('textarea').fill('script:hold');
  await view.locator('textarea').press('Enter');
  await view.locator('button.stop').waitFor({ state: 'visible' });

  await page.goto(`${host.base}/a/reading`);
  const again = page.locator('marble-agent-drawer');
  await again.locator('.where').waitFor({ state: 'visible' });
  assert.match(await again.locator('.where').textContent(), /Viewing reading · editing garden/);
  await again.locator('marble-conversation button.stop').click();
  await again.locator('marble-conversation .turn-footer[data-status="cancelled"]').waitFor();
  await again.locator('.where').waitFor({ state: 'hidden' });
});

test('overlay leaves the page’s layout alone; pinning docks it, and it stays transient', async () => {
  await host.reset();
  const { page, drawer, panel } = await visit();
  const widthBefore = await page.evaluate(() => document.documentElement.clientWidth);
  await drawer.locator('.launcher').click();
  await opened(panel);
  assert.equal(await page.evaluate(() => document.documentElement.clientWidth), widthBefore, 'overlay does not reflow');

  await drawer.locator('button.pin').click();
  await panel.locator('xpath=self::*[@data-pinned="true"]').waitFor();
  const dock = page.locator('head > style#marble-agent-dock');
  assert.equal(await dock.getAttribute('data-marble-transient'), '');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).marginRight), '420px');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('style')), null);

  await page.reload();
  await page.locator('marble-agent-drawer aside.panel[data-pinned="true"][data-open="true"]').waitFor();
  await page.locator('marble-agent-drawer button.close').click();
  await page.locator('head > style#marble-agent-dock').waitFor({ state: 'detached' });
  assert.equal(await host.drive.store.read('garden'), GARDEN);
});

test('on a phone the drawer is a full-screen sheet, and pinning is not offered', async () => {
  const { page, drawer, panel } = await visit('garden', { viewport: { width: 390, height: 844 } });
  await drawer.locator('.launcher').click();
  await opened(panel);
  const box = await panel.boundingBox();
  assert.ok(Math.abs(box.width - 390) < 2 && Math.abs(box.height - 844) < 2, JSON.stringify(box));
  assert.equal(await drawer.locator('button.pin').isVisible(), false);
});

test('dragging the header away past halfway dismisses it; a small drag springs back', async () => {
  const { page, drawer, panel } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await page.waitForTimeout(500);
  const spacer = await drawer.locator('header.bar .spacer').boundingBox();
  const startX = spacer.x + spacer.width / 2;
  const y = spacer.y + spacer.height / 2;

  // Slowly: a small drag with little velocity projects short of halfway.
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let dx = 10; dx <= 40; dx += 10) {
    await page.mouse.move(startX + dx, y);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(600);
  assert.equal(await panel.getAttribute('data-open'), 'true', 'a small, slow drag springs back');

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 300, y, { steps: 6 });
  await page.mouse.up();
  await panel.locator('xpath=self::*[@data-open="false"]').waitFor();
});

test('reduced motion opens without sliding', async () => {
  const { page, drawer, panel } = await visit('garden', { reducedMotion: 'reduce' });
  await drawer.locator('.launcher').click();
  await opened(panel);
  const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
  assert.ok(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)', transform);
});

test('the launcher shows a dot for work nobody has looked at, until you open it', async () => {
  await host.reset();
  const { page, drawer, panel, view } = await visit();
  await page.evaluate(async () => {
    for (const summary of await window.marble.agent.conversations()) await window.marble.agent.markReviewed(summary.id);
  });
  await drawer.locator('.launcher').click();
  await drawer.locator('button.new').click();
  await view.locator('textarea').fill('script:rename');
  await view.locator('textarea').press('Enter');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await drawer.locator('button.close').click();

  // Another tab, which never saw that turn, is told it needs review.
  const other = await visit('reading');
  await other.drawer.locator('.launcher-dot').waitFor({ state: 'visible' });
  await other.drawer.locator('.launcher').click();
  await other.panel.locator('xpath=self::*[@data-open="true"]').waitFor();
  await other.drawer.locator('button.title').click();
  await other.drawer.locator('.menu.recent [role="menuitem"]', { hasText: 'script:rename' }).first().click();
  await other.drawer.locator('.launcher-dot').waitFor({ state: 'hidden' });
  void panel;
});

test('the recent menu switches conversations; new starts one; continue-in hands off', async () => {
  const { drawer, panel, view } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await drawer.locator('button.new').click();
  assert.equal(await view.getAttribute('conversation'), null);
  await drawer.locator('button.title').click();
  const items = drawer.locator('.menu.recent [role="menuitem"]');
  await items.first().waitFor();
  assert.ok((await items.count()) >= 1);
  await items.first().click();
  assert.match(await view.getAttribute('conversation'), /^[0-9a-f]{12}$/);

  await drawer.locator('button.more').click();
  await drawer.locator('.menu.actions').waitFor({ state: 'visible' });
  assert.equal(await drawer.locator('.menu.actions [role="menuitem"]', { hasText: 'Open Agents' }).count(), 0, 'no Agents document in this drive');
  assert.equal(await drawer.locator('.menu.actions [role="menuitem"]', { hasText: 'Archive' }).count(), 1);
});

test('Settings in the drawer saves the default model for new conversations', async () => {
  await host.reset();
  const { page, drawer, panel, view } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await drawer.locator('button.more').click();
  await drawer.locator('.menu.actions [role="menuitem"]', { hasText: 'Settings' }).click();
  const settings = page.locator('marble-agent-settings');
  await settings.locator('h2', { hasText: 'Agent settings' }).waitFor();
  await settings.locator('select[name="model-fake"]').selectOption('alt');
  await settings.locator('select[name="effort-fake"]').selectOption('high');
  await settings.locator('button.save').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-settings')?.getAttribute('data-open') === 'false');
  await drawer.locator('button.new').click();
  const started = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-agent-drawer').shadowRoot.querySelector('marble-conversation')
      .addEventListener('conversation', (e) => resolve(e.detail.id), { once: true });
  }));
  await view.locator('textarea').fill('script:rename');
  await view.locator('textarea').press('Enter');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const meta = await page.evaluate(async (conversation) => (await window.marble.agent.conversation(conversation)).meta, id);
  assert.equal(meta.model, 'alt');
  assert.equal(meta.effort, 'high');
});

test('a document that draws its own agent interface gets no drawer', async () => {
  await host.drive.createDocument('custom', GARDEN.replace('<title>', '<meta name="marble-agent" content="custom"><title>'));
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/custom`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('marble-agent-drawer').count(), 0);
});
