// The shell: ⌘J opens the drive around the open document — the tree, the bar,
// and the chat where it already was. What it has to get right is that the
// document is still the document: Fit moves it with a transient stylesheet and
// nothing else, Float leaves it where it was, and closing takes every trace of
// the shell off the page but a pill that only rises when the pointer asks.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const NOTES = GARDEN.replace('Research Garden', 'Field notes').replace('<title>Garden</title>', '<title>Field notes</title>');

const host = await startDrive({
  documents: { garden: GARDEN, 'Research/Specs/Field notes': NOTES, 'Travel/plans': GARDEN, drive: GARDEN },
});
test.after(() => host.close());

async function visit(path = 'Research/Specs/Field notes', options) {
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/${path.split('/').map(encodeURIComponent).join('/')}`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot && document.querySelector('marble-agent-drawer')?.shadowRoot);
  const shell = page.locator('marble-shell');
  const panel = page.locator('marble-agent-drawer').locator('.panel');
  return { page, errors, shell, panel };
}

// The page eases into the room it is given; read it once it has arrived —
// the motion off the dock stylesheet, and the chat's spring at rest.
const margins = async (page) => {
  await page.waitForFunction(() => !document.getElementById('marble-shell-dock')?.textContent.includes('transition')
    && !document.querySelector('marble-agent-drawer')?.cancelMotion);
  return page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { top: s.marginTop, left: s.marginLeft, right: s.marginRight };
  });
};
const isOpen = (page) => page.evaluate(() => document.querySelector('marble-shell').hasAttribute('data-open'));

test('closed, the page is the page: no bar, no tree, no margin, and a pill only on the way to the corner', async () => {
  const { page, shell, errors } = await visit();
  await page.mouse.move(640, 400);
  assert.equal(await isOpen(page), false);
  assert.deepEqual(await margins(page), { top: '0px', left: '0px', right: '0px' });
  assert.equal(await shell.locator('.bar').isVisible(), false);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-shell').shadowRoot.querySelector('.pill')).opacity === '0');
  // The corner strip raises it; the pill names the document by its name in the folder.
  await page.mouse.move(40, 3);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-shell').shadowRoot.querySelector('.pill')).opacity === '1');
  assert.equal(await shell.locator('.pill b').innerText(), 'Field notes');
  await shell.locator('.pill').click();
  assert.equal(await isOpen(page), true);
  const served = await (await fetch(`${host.base}/a/garden`)).text();
  assert.ok(!served.includes('<marble-shell'), 'never written into a document');
  assert.equal(await host.drive.store.read('Research/Specs/Field notes'), NOTES, 'the file is untouched');
  assert.deepEqual(errors.filter((m) => !/favicon/.test(m)), []);
});

test('⌘J opens Fit: the page gives up the top, the left and the right, and the chat sits under the bar', async () => {
  const { page, shell, panel } = await visit();
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === true);
  assert.equal(await isOpen(page), true);
  const m = await margins(page);
  assert.equal(m.top, '44px');
  assert.equal(m.left, '260px');
  assert.equal(m.right, `${await page.evaluate(() => document.querySelector('marble-agent-drawer').width)}px`, 'the drawer docks on the right');
  assert.equal(await panel.evaluate((el) => el.getBoundingClientRect().top), 44);
  assert.equal(await panel.getAttribute('data-shell'), 'fit');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--marble-shell-top')), '44px');
  // Where you are: the folders, then the document, which opens its menu.
  assert.deepEqual(await shell.locator('.crumbs a').allInnerTexts(), ['Drive', 'Research', 'Specs']);
  assert.equal(await shell.locator('.crumbs .here').innerText(), 'Field notes');
  assert.equal(await shell.locator('.crumbs a').nth(2).getAttribute('href'), `/#/${encodeURIComponent('Research/Specs')}`);

  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === false);
  assert.equal(await isOpen(page), false);
  assert.deepEqual(await margins(page), { top: '0px', left: '0px', right: '0px' });
});

test('Float lays the sidebars over the page; the bar stays docked above it', async () => {
  const { page, shell, panel } = await visit();
  await page.keyboard.press('Control+j');
  await shell.locator('[data-act="float"]').click();
  assert.deepEqual(await margins(page), { top: '44px', left: '0px', right: '0px' });
  assert.equal(await panel.getAttribute('data-shell'), 'float');
  assert.deepEqual(await shell.locator('.bar').evaluate((el) => { const r = el.getBoundingClientRect(); return [r.top, r.left, r.width]; }), [0, 0, 1280]);
  // The cards sit just under the bar; the chat's glides from Fit's place.
  assert.equal(await shell.locator('.nav').evaluate((el) => el.getBoundingClientRect().top), 44 + 8);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.panel').getBoundingClientRect().top === 44 + 8);
  assert.equal(await shell.locator('[data-act="float"]').getAttribute('aria-pressed'), 'true');
  await shell.locator('[data-act="fit"]').click();
  assert.equal((await margins(page)).top, '44px');
});

test('the tree and the chat each put away on their own, and the choice follows you to the next page', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+j');
  await shell.locator('[data-act="chat"]').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === false);
  assert.equal(await isOpen(page), true, 'the shell stays');
  assert.equal((await margins(page)).right, '0px');
  await page.keyboard.press('Control+\\');
  assert.equal((await margins(page)).left, '0px');
  await shell.locator('.nav').waitFor({ state: 'hidden' });

  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.hasAttribute('data-open'));
  assert.equal((await margins(page)).top, '44px', 'still open on the next document');
  assert.equal((await margins(page)).left, '0px', 'still without the tree');
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer').isOpen), false, 'still without the chat');
  assert.equal(await shell.locator('.crumbs .here').innerText(), 'garden');
});

test('the tree unfolds to where you are, marks it, and opens what you pick', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+j');
  const current = shell.locator('.sec[data-sec="drive"] [aria-current="page"]');
  await current.waitFor();
  assert.equal(await current.innerText(), 'Field notes');
  assert.equal(await shell.locator('button.row[data-folder="Travel"]').getAttribute('aria-expanded'), 'false');
  await shell.locator('button.row[data-folder="Travel"]').click();
  await shell.locator('.sec[data-sec="drive"] a.row[title="Travel/plans"]').click();
  await page.waitForURL(/\/a\/Travel(%2F|\/)plans$/);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.hasAttribute('data-open'));
  assert.equal(await page.locator('marble-shell').locator('button.row[data-folder="Travel"]').getAttribute('aria-expanded'), 'true', 'the folder you opened stays open');
});

test('⌘K searches the drive by name and Enter opens the first match', async () => {
  const { page, shell } = await visit('garden');
  await page.keyboard.press('Control+k');
  assert.equal(await isOpen(page), true, '⌘K opens the shell to search');
  await page.keyboard.type('field');
  await shell.locator('.scroll a.row').first().waitFor();
  assert.deepEqual(await shell.locator('.scroll a.row > span:first-of-type').allInnerTexts(), ['Field notes']);
  await page.keyboard.press('Enter');
  await page.waitForURL(/Field%20notes$/);
});

test('Share hands you the document\'s link', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+j');
  await shell.locator('[data-act="share"]').click();
  const input = shell.locator('.sharing input');
  await input.waitFor();
  assert.equal(await input.inputValue(), `${host.base}${await page.evaluate(() => window.marble.href(window.marble.app))}`);
  await page.keyboard.press('Escape');
  assert.equal(await shell.locator('.sharing').isVisible(), false);
});

test('at phone width there is no shell to open: ⌘J is the drawer\'s, as before', async () => {
  const { page } = await visit('garden', { viewport: { width: 393, height: 700 } });
  await page.keyboard.press('Control+j');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === true);
  assert.equal(await isOpen(page), false);
  assert.equal((await margins(page)).top, '0px');
});

test('the page glides into the room the shell makes, and back out of it', async () => {
  const { page } = await visit();
  await page.mouse.move(640, 400);
  // Sample the page's left edge every frame while the shell opens and closes.
  const track = (key) => page.evaluate(async (key) => {
    const seen = [];
    const t0 = performance.now();
    dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
    await new Promise((done) => {
      const tick = () => {
        seen.push(parseFloat(getComputedStyle(document.documentElement).marginLeft));
        if (performance.now() - t0 < 600) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    return seen;
  }, key);
  const opening = await track('j');
  assert.ok(opening.some((x) => x > 20 && x < 240), `passes through the middle: ${opening.join(' ')}`);
  assert.equal(opening.at(-1), 260);
  assert.ok(opening.every((x, i) => i === 0 || x >= opening[i - 1]), 'never backs up');
  const closing = await track('j');
  assert.ok(closing.some((x) => x > 20 && x < 240), 'and on the way out');
  assert.equal(closing.at(-1), 0);
  assert.equal(await page.evaluate(() => document.getElementById('marble-shell-dock')), null, 'gone once it has arrived');
});

test('asked for less motion, the page moves at once', async () => {
  const { page } = await visit('garden', { reducedMotion: 'reduce' });
  await page.keyboard.press('Control+j');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).marginLeft), '260px');
});

test('on the Drive itself the bar says Drive, not the name of its file', async () => {
  const { page, shell } = await visit('drive');
  await page.keyboard.press('Control+j');
  assert.deepEqual(await shell.locator('.crumbs > *').allInnerTexts(), ['Drive']);
  assert.equal(await shell.locator('.crumbs a').getAttribute('aria-current'), 'page');
});

test('the tree\'s edge drags wider and narrower, the page follows, and the width follows you', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+j');
  await margins(page);
  const edge = shell.locator('.edge');
  const box = await edge.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 300, { steps: 6 });
  // Under the hand it follows at once: no easing to trail the pointer.
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).marginLeft), '340px');
  await page.mouse.up();
  assert.equal(await shell.locator('.nav').evaluate((el) => el.getBoundingClientRect().width), 340);
  assert.equal(await edge.getAttribute('aria-valuenow'), '340');

  // Too narrow is as narrow as it goes.
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x - 400, box.y + 300, { steps: 4 });
  await page.mouse.up();
  assert.equal((await margins(page)).left, '200px');

  await edge.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await margins(page)).left, '216px');

  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.hasAttribute('data-open'));
  assert.equal((await margins(page)).left, '216px', 'the next document opens with the same tree');
  await page.locator('marble-shell').locator('.edge').dblclick();
  assert.equal((await margins(page)).left, '260px', 'double-click puts it back');
});

test('the chat\'s edge drags too inside the shell, and never takes the page from the tree', async () => {
  const { page } = await visit();
  await page.keyboard.press('Control+j');
  const before = await margins(page);
  const handle = page.locator('marble-agent-drawer').locator('.resize');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + 300, { steps: 6 });
  await page.mouse.up();
  const after = await margins(page);
  assert.equal(parseFloat(after.right), parseFloat(before.right) + 100);
  // All the way left: the page keeps its share beside the tree.
  await page.mouse.move(box.x - 100 + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(0, box.y + 300, { steps: 6 });
  await page.mouse.up();
  const most = await margins(page);
  assert.ok(1280 - parseFloat(most.left) - parseFloat(most.right) >= 200, `page keeps room: ${JSON.stringify(most)}`);
});
