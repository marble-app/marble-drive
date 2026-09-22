import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const FOREST = `<!doctype html>
<html><head><meta charset="utf-8"><title>Forest</title>
<style>
  :root {
    --paper: #1a3a2a; --ink: #e8f0e4; --muted: #a8c4b0; --line: #2f5644;
    --card: #214532; --accent-ink: #8fbf9a;
  }
  body { font: 16px/1.5 Georgia, serif; margin: 40px; background: #1a3a2a; color: #e8f0e4; }
</style>
</head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Forest</h1>
  <p data-marble-id="p">Green.</p>
</body></html>
`;

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
  documents: {
    garden: GARDEN,
    reading: GARDEN.replace('Research Garden', 'Reading List').replace('<title>Garden', '<title>Reading'),
    forest: FOREST,
  },
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

test('a document opened with #chat= arrives with that conversation open', async () => {
  await host.reset();
  const started = await fetch(`${host.base}/agent/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'fake' }),
  });
  const { id } = await started.json();

  const { page, panel, view } = await visit(`garden#chat=${id}`);
  await opened(panel);
  assert.equal(await view.getAttribute('conversation'), id);
  // And it is remembered, so the next document in this tab shows the same chat.
  assert.equal(await page.evaluate(() => window.marble.agent.current()), id);
});

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
    return view.shadowRoot.activeElement?.classList.contains('editor');
  });
  await view.locator('.editor').press('Escape');
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
  await view.locator('.editor').fill('script:rename');
  await view.locator('.editor').press('Enter');
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
  await view.locator('.editor').fill('script:hold');
  await view.locator('.editor').press('Enter');
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

async function dragResize(page, drawer, dx) {
  const handle = drawer.locator('.resize');
  await handle.waitFor({ timeout: 5000 });
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(80, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test('the overlay sidebar can be resized without reflowing the page', async () => {
  const { page, drawer, panel } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await page.waitForTimeout(400);
  const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const before = await panel.evaluate((el) => el.getBoundingClientRect().width);
  await dragResize(page, drawer, -120);
  const after = await panel.evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(after > before + 80, `overlay should grow, ${before} → ${after}`);
  assert.equal(await page.evaluate(() => document.documentElement.clientWidth), pageWidth, 'overlay does not reflow');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).marginRight), '0px');
});

test('a pinned sidebar resize docks the page by the new width', async () => {
  const { page, drawer, panel } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await drawer.locator('button.pin').click();
  await panel.locator('xpath=self::*[@data-pinned="true"]').waitFor();
  await page.waitForTimeout(200);
  await dragResize(page, drawer, -80);
  const width = await panel.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  assert.ok(width > 460, `pinned panel should grow past 420, got ${width}`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).marginRight), `${width}px`);
});

test('overlay and pinned widths are remembered separately', async () => {
  const { page, drawer, panel } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  await page.waitForTimeout(400);
  await dragResize(page, drawer, -100);
  const overlay = await panel.evaluate((el) => Math.round(el.getBoundingClientRect().width));

  await drawer.locator('button.pin').click();
  await panel.locator('xpath=self::*[@data-pinned="true"]').waitFor();
  await page.waitForTimeout(200);
  const afterPin = await panel.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  assert.equal(afterPin, 420, 'pin starts from its own stored width, not the overlay’s');
  await dragResize(page, drawer, 80);
  const pinned = await panel.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  assert.ok(pinned < 400, `pinned should shrink, got ${pinned}`);

  await drawer.locator('button.pin').click();
  await panel.locator('xpath=self::*[@data-pinned="false"]').waitFor();
  await page.waitForTimeout(200);
  assert.equal(await panel.evaluate((el) => Math.round(el.getBoundingClientRect().width)), overlay);

  await drawer.locator('button.pin').click();
  await panel.locator('xpath=self::*[@data-pinned="true"]').waitFor();
  await page.waitForTimeout(200);
  assert.equal(await panel.evaluate((el) => Math.round(el.getBoundingClientRect().width)), pinned);
});

test('on a phone the drawer is a full-screen sheet, and pinning is not offered', async () => {
  const { page, drawer, panel } = await visit('garden', { viewport: { width: 390, height: 844 } });
  await drawer.locator('.launcher').click();
  await opened(panel);
  const box = await panel.boundingBox();
  assert.ok(Math.abs(box.width - 390) < 2 && Math.abs(box.height - 844) < 2, JSON.stringify(box));
  assert.equal(await drawer.locator('button.pin').isVisible(), false);
  assert.equal(await drawer.locator('.resize').isVisible(), false);
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
  await view.locator('.editor').fill('script:rename');
  await view.locator('.editor').press('Enter');
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

test('archiving from the drawer opens another live conversation', async () => {
  await host.reset();
  const { page, drawer, panel, view } = await visit();
  await drawer.locator('.launcher').click();
  await opened(panel);
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const older = await agent.start({ provider: 'fake' });
    await agent.send(older, { prompt: 'script:rename', target: 'garden', viewing: 'garden', selection: [] });
    const newer = await agent.start({ provider: 'fake' });
    await agent.send(newer, { prompt: 'script:rename', target: 'garden', viewing: 'garden', selection: [] });
    return { older, newer };
  });
  await drawer.locator('button.title').click();
  await drawer.locator('.menu.recent [role="menuitem"]').nth(1).waitFor();
  await drawer.locator('.menu.recent [role="menuitem"]').first().click();
  const openedId = await page.waitForFunction((ids) => {
    const view = document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('marble-conversation');
    const id = view?.getAttribute('conversation');
    return id === ids.newer || id === ids.older ? id : null;
  }, ids);
  const current = await openedId.jsonValue();
  const other = current === ids.newer ? ids.older : ids.newer;
  await drawer.locator('button.more').click();
  await drawer.locator('.menu.actions [role="menuitem"]', { hasText: 'Archive' }).click();
  await page.waitForFunction((id) => {
    const view = document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('marble-conversation');
    return view?.getAttribute('conversation') === id;
  }, other);
  assert.equal(await view.getAttribute('conversation'), other);
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
  await view.locator('.editor').fill('script:rename');
  await view.locator('.editor').press('Enter');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const meta = await page.evaluate(async (conversation) => (await window.marble.agent.conversation(conversation)).meta, id);
  assert.equal(meta.model, 'alt');
  assert.equal(meta.effort, 'high');
});

test('the drawer panel wears the document’s paper', async () => {
  const { drawer, panel } = await visit('forest');
  await drawer.locator('.launcher').click();
  await opened(panel);
  const bg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
  const rgb = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  const srgb = bg.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  const [r, g, b] = rgb
    ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    : srgb
      ? [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255]
      : [];
  assert.ok(r != null, `panel background should be a color, got ${bg}`);
  assert.ok(r < 50 && g > 40 && g < 80 && b < 60, `panel should be forest green, got ${bg}`);
  assert.ok(!(r > 200 && g > 200 && b > 200), 'panel must not stay Drive cream');
});

test('… but not the document’s face', async () => {
  const { drawer, panel, view } = await visit('forest');
  await drawer.locator('.launcher').click();
  await opened(panel);
  // Forest is set in Georgia. The chrome is not the document: it keeps the
  // design system's UI stack so a log, a composer and a row of buttons read
  // the same on every page they are opened over.
  for (const el of [panel, view.locator('.editor'), view.locator('.log')]) {
    const family = await el.evaluate((node) => getComputedStyle(node).fontFamily);
    assert.ok(!/georgia/i.test(family), `chrome should not wear the page face, got ${family}`);
    assert.match(family, /Google Sans/);
  }
});

test('a document that draws its own agent interface gets no drawer', async () => {
  await host.drive.createDocument('custom', GARDEN.replace('<title>', '<meta name="marble-agent" content="custom"><title>'));
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/custom`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForTimeout(300);
  assert.equal(await page.locator('marble-agent-drawer').count(), 0);
});
