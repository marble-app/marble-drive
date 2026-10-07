// The shell: ⌘J opens the drive around the open document — the tree, the bar,
// and the chat where it already was. What it has to get right is that the
// document is still the document: a pinned side moves it with a transient
// stylesheet and nothing else, a side on hover leaves it where it was, and
// closing takes every trace of the shell off the page but a pill that only
// rises when the pointer asks.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const NOTES = GARDEN.replace('Research Garden', 'Field notes').replace('<title>Garden</title>', '<title>Field notes</title>');
// A document that draws its own icon, and one that keeps the marble.
const OWN_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23222'/%3E%3C/svg%3E";
const BOARD = GARDEN.replace('</title>', `</title>\n<link rel="icon" href="${OWN_ICON}">`);

const host = await startDrive({
  documents: { garden: GARDEN, 'Research/Specs/Field notes': NOTES, 'Travel/plans': GARDEN, 'Travel/Board': BOARD, drive: GARDEN },
});
// Research wears a realm's colour, as its tile does on the Drive.
await fsp.writeFile(path.join(host.drive.store.marbleDir, 'drive.json'), JSON.stringify({ realms: { Research: 'research' } }));
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
  // Crossing the corner's strip raises nothing; resting in it does. The pill
  // names the document by its name in the folder.
  await page.mouse.move(40, 3);
  await page.mouse.move(40, 30);
  await page.waitForTimeout(400);
  assert.equal(await shell.locator('.pill').evaluate((el) => getComputedStyle(el).opacity), '0', 'a pass through the strip is not a request');
  await page.mouse.move(40, 3);
  await page.mouse.move(44, 4);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-shell').shadowRoot.querySelector('.pill')).opacity === '1');
  assert.equal(await shell.locator('.pill b').innerText(), 'Field notes');
  await shell.locator('.pill').click();
  assert.equal(await isOpen(page), true);
  const served = await (await fetch(`${host.base}/a/garden`)).text();
  assert.ok(!served.includes('<marble-shell'), 'never written into a document');
  assert.equal(await host.drive.store.read('Research/Specs/Field notes'), NOTES, 'the file is untouched');
  assert.deepEqual(errors.filter((m) => !/favicon/.test(m)), []);
});

test('⌘\\ opens with both sides pinned: the page gives up the top, the left and the right, and the chat sits under the bar', async () => {
  const { page, shell, panel } = await visit();
  await page.keyboard.press('Control+\\');
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

  await page.keyboard.press('Control+\\');
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === false);
  assert.equal(await isOpen(page), false);
  assert.deepEqual(await margins(page), { top: '0px', left: '0px', right: '0px' });
});

// Each side's own button, at its end of the bar, pins it or sets it on hover.
const unpin = async (shell, ...sides) => {
  for (const side of sides) {
    const button = shell.locator(`[data-act="${side}"]`);
    if (await button.getAttribute('aria-pressed') === 'true') await button.click();
  }
};

test('a side on hover lies over the page as a card when it comes out; the bar stays docked above it', async () => {
  const { page, shell, panel } = await visit();
  await page.keyboard.press('Control+\\');
  await margins(page);
  await unpin(shell, 'nav', 'chat');
  assert.deepEqual(await margins(page), { top: '44px', left: '0px', right: '0px' });
  assert.equal(await shell.locator('[data-act="nav"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await shell.locator('[data-act="chat"]').getAttribute('aria-label'), 'Pin the chat');
  assert.deepEqual(await shell.locator('.bar').evaluate((el) => { const r = el.getBoundingClientRect(); return [r.top, r.left, r.width]; }), [0, 0, 1280]);
  // Reached for, the cards sit just under the bar, over the page.
  await page.mouse.move(640, 420);
  await page.mouse.move(3, 420);
  await page.waitForFunction(() => !document.querySelector('marble-shell').hasAttribute('data-hide-nav'));
  assert.equal(await shell.locator('.nav').evaluate((el) => el.getBoundingClientRect().top), 44 + 8);
  assert.equal((await margins(page)).left, '0px', 'the page stays where it was');
  await page.mouse.move(1277, 420);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.panel').getBoundingClientRect().top === 44 + 8);
  assert.equal(await panel.getAttribute('data-shell'), 'float');
  await page.mouse.move(640, 420);
  await shell.locator('[data-act="nav"]').click();
  await shell.locator('[data-act="chat"]').click();
  assert.equal((await margins(page)).left, '260px', 'pinned again, the tree takes its column');
  assert.equal(await panel.getAttribute('data-shell'), 'fit');
});

test('the tree and the chat pin on their own, and the choice follows you to the next page', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+\\');
  await margins(page);
  await unpin(shell, 'chat');
  await page.mouse.move(640, 420);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen === false);
  assert.equal(await isOpen(page), true, 'the shell stays');
  assert.equal((await margins(page)).right, '0px');
  assert.equal((await margins(page)).left, '260px', 'the tree is still pinned');
  await page.keyboard.press('Control+Shift+\\');
  assert.equal((await margins(page)).left, '0px', '⌘\\ unpins the tree');
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-hide-nav'));

  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.hasAttribute('data-open'));
  await page.mouse.move(640, 420);
  assert.equal((await margins(page)).top, '44px', 'still open on the next document');
  assert.equal((await margins(page)).left, '0px', 'the tree still on hover');
  assert.equal(await page.evaluate(() => document.querySelector('marble-agent-drawer').isOpen), false, 'the chat still on hover');
  assert.equal(await shell.locator('.crumbs .here').innerText(), 'garden');
  await page.keyboard.press('Control+Shift+\\');
  assert.equal((await margins(page)).left, '260px', 'and ⌘\\ pins it back');
});

test('a row wears its folder\'s colour, and a document with its own favicon shows it', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+\\');
  const research = shell.locator('button.row[data-folder="Research"]');
  await research.waitFor();
  assert.equal(await research.getAttribute('data-realm'), 'research');
  assert.equal(await research.locator('.i:not(.car)').evaluate((el) => getComputedStyle(el).color), 'rgb(47, 111, 91)');
  // A document takes the folder it is in; one outside any realm stays grey.
  const notes = shell.locator('.sec[data-sec="drive"] a.row[title="Research/Specs/Field notes"]');
  assert.equal(await notes.getAttribute('data-realm'), 'research');
  assert.equal(await shell.locator('.sec[data-sec="drive"] a.row[title="garden"]').getAttribute('data-realm'), null);
  await shell.locator('button.row[data-folder="Travel"]').click();
  const board = shell.locator('.sec[data-sec="drive"] a.row[title="Travel/Board"]');
  assert.equal(await board.locator('img.i').getAttribute('src'), OWN_ICON);
  // The marble every document starts with is not an icon of its own.
  assert.equal(await shell.locator('.sec[data-sec="drive"] a.row[title="Travel/plans"] img').count(), 0);
});

test('the tree unfolds to where you are, marks it, and opens what you pick', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+\\');
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

test('Share: choose a level, copy its link in one press, see which are on, turn one off', async () => {
  const { page, shell, errors } = await visit();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: host.base });
  await page.keyboard.press('Control+\\');
  await shell.locator('[data-act="share"]').click();
  const pop = shell.locator('.sharing');
  await pop.waitFor();
  const chosen = () => pop.locator('.level[aria-checked="true"]').getAttribute('data-role');
  assert.deepEqual(await pop.locator('.level .lv-name').allInnerTexts(), ['Read only', 'Read & write', 'Read, write & modify']);
  // Read only to begin with, and nothing out yet: no address, nothing to turn off.
  assert.equal(await chosen(), 'view');
  assert.equal(await pop.locator('.url').inputValue(), '');
  assert.equal(await pop.locator('.off').isVisible(), false);
  assert.equal(await pop.locator('.lv-on:visible').count(), 0);
  // Opened at 127.0.0.1 with no public address, so it says where the link works.
  assert.match(await pop.locator('.warn').innerText(), /only on this computer/);
  // The arrows choose inside the group; one press makes the link and copies it.
  await pop.locator('.level[data-role="view"]').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await chosen(), 'edit');
  await pop.locator('.copy').click();
  await page.waitForFunction(() => document.querySelector('marble-shell').shadowRoot.querySelector('.sharing .url').value);
  const href = await pop.locator('.url').inputValue();
  assert.match(href, new RegExp(`^${host.base}/s/[A-Za-z0-9_-]{38}$`));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), href);
  assert.equal(await pop.locator('.level[data-role="edit"] .lv-on').isVisible(), true);
  assert.equal(await pop.locator('.level[data-role="view"] .lv-on').isVisible(), false);
  assert.equal(await pop.locator('.meta > span').innerText(), 'Made just now · not opened yet');
  // Read only has no link of its own: choosing it shows none.
  await pop.locator('.level[data-role="view"]').click();
  assert.equal(await pop.locator('.url').inputValue(), '');
  assert.equal(await pop.locator('.url').getAttribute('placeholder'), 'No Read only link yet');
  // Opened again, it comes back to the link that is out.
  await page.keyboard.press('Escape');
  await shell.locator('[data-act="share"]').click();
  await page.waitForFunction(() => document.querySelector('marble-shell').shadowRoot.querySelector('.sharing .url').value);
  assert.equal(await chosen(), 'edit');
  assert.equal(await pop.locator('.url').inputValue(), href);
  // Two presses: the first asks.
  await pop.locator('.off').click();
  assert.equal(await pop.locator('.off').innerText(), 'Yes, turn off');
  await pop.locator('.off').click();
  await pop.locator('.off').waitFor({ state: 'hidden' });
  assert.equal(await pop.locator('.url').inputValue(), '');
  assert.equal(await pop.locator('.lv-on:visible').count(), 0);
  assert.deepEqual(errors, []);
  // (The 404 below is the point, and the console logs it.)
  const gone = await page.evaluate((path) => fetch(path, { redirect: 'manual' }).then((res) => res.status), new URL(href).pathname);
  assert.equal(gone, 404, 'the link opens nothing once it is off');
  await page.keyboard.press('Escape');
  // A popover fades out where it was rather than vanishing.
  await pop.waitFor({ state: 'hidden', timeout: 1000 });
  assert.equal(await pop.isVisible(), false);
});

test('at phone width there is no shell to open: ⌘J opens the drawer, as before', async () => {
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
  const opening = await track('\\');
  assert.ok(opening.some((x) => x > 20 && x < 240), `passes through the middle: ${opening.join(' ')}`);
  assert.equal(opening.at(-1), 260);
  assert.ok(opening.every((x, i) => i === 0 || x >= opening[i - 1]), 'never backs up');
  const closing = await track('\\');
  assert.ok(closing.some((x) => x > 20 && x < 240), 'and on the way out');
  assert.equal(closing.at(-1), 0);
  assert.equal(await page.evaluate(() => document.getElementById('marble-shell-dock')), null, 'gone once it has arrived');
});

test('asked for less motion, the page moves at once', async () => {
  const { page } = await visit('garden', { reducedMotion: 'reduce' });
  await page.keyboard.press('Control+\\');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).marginLeft), '260px');
});

test('on the Drive itself the bar says Drive, not the name of its file', async () => {
  const { page, shell } = await visit('drive');
  await page.keyboard.press('Control+\\');
  assert.deepEqual(await shell.locator('.crumbs > *').allInnerTexts(), ['Drive']);
  assert.equal(await shell.locator('.crumbs a').getAttribute('aria-current'), 'page');
});

test('the tree\'s edge drags wider and narrower, the page follows, and the width follows you', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+\\');
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
  await page.keyboard.press('Control+\\');
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

test('a page that loads under a pointer resting in the corner keeps its corner', async () => {
  const { page } = await visit('garden');
  // Playwright's pointer starts at the very corner; nothing has moved it.
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.querySelector('marble-shell').hasAttribute('data-peek')), false);
});

// On hover: a side waits at its edge, and comes out when reached for.
const navOut = (page) => page.evaluate(() => !document.querySelector('marble-shell').hasAttribute('data-hide-nav'));
const chatOut = (page) => page.evaluate(() => document.querySelector('marble-agent-drawer').isOpen);

test('opening onto sides on hover shows them once, and puts them away at the first thing done on the page', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+\\');
  await margins(page);
  await unpin(shell, 'nav', 'chat');
  await page.keyboard.press('Control+\\');
  await page.keyboard.press('Control+\\');
  assert.equal(await navOut(page), true, 'the tree, so it is plain it is there');
  assert.equal(await chatOut(page), true, 'and the chat');
  await page.mouse.click(640, 420);
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-hide-nav') && !document.querySelector('marble-agent-drawer').isOpen);
  // A mark on each edge says where they went.
  await page.waitForFunction(() => ['nav', 'chat'].every((side) => getComputedStyle(document.querySelector('marble-shell').shadowRoot.querySelector(`.hint[data-side="${side}"]`)).opacity === '1'));
});

test('on hover the pointer at an edge brings that side out, and leaving puts it back; typing in it keeps it', async () => {
  const { page } = await visit();
  await page.keyboard.press('Control+\\');
  await margins(page);
  await unpin(page.locator('marble-shell'), 'nav', 'chat');
  await page.mouse.click(640, 420);
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-hide-nav'));

  await page.mouse.move(3, 420);
  await page.waitForFunction(() => !document.querySelector('marble-shell').hasAttribute('data-hide-nav'));
  await page.mouse.move(120, 420, { steps: 4 });
  await page.waitForTimeout(600);
  assert.equal(await navOut(page), true, 'over it, it stays');
  await page.mouse.move(640, 420, { steps: 4 });
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-hide-nav'));

  await page.mouse.move(1277, 420);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen);
  assert.notEqual(await page.evaluate(() => document.activeElement?.localName), 'marble-agent-drawer', 'a passing pointer does not take the caret');
  const editor = page.locator('marble-agent-drawer').locator('marble-conversation').locator('.editor');
  await editor.click();
  await page.keyboard.type('hello');
  await page.mouse.move(640, 420, { steps: 4 });
  await page.waitForTimeout(700);
  assert.equal(await chatOut(page), true, 'typing in it keeps it out');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('marble-agent-drawer').isOpen);
});

test('a page opened with the sides on hover starts with them away, and ⌘K brings the tree out to search', async () => {
  const { page } = await visit();
  await page.keyboard.press('Control+\\');
  await margins(page);
  await unpin(page.locator('marble-shell'), 'nav', 'chat');
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.hasAttribute('data-open') && document.querySelector('marble-agent-drawer'));
  await page.mouse.move(640, 420);
  assert.equal(await navOut(page), false);
  assert.equal(await chatOut(page), false);
  await page.keyboard.press('Control+k');
  assert.equal(await navOut(page), true);
  await page.keyboard.type('field');
  await page.waitForTimeout(600);
  assert.equal(await navOut(page), true, 'searching keeps it out');
});

test('the side\'s own button in the bar reaches for it too, once the hand that unpinned it has left', async () => {
  const { page, shell } = await visit();
  await page.keyboard.press('Control+\\');
  await margins(page);
  await unpin(shell, 'nav');
  await page.waitForTimeout(500);
  assert.equal(await navOut(page), false, 'unpinned under the hand, it goes to its edge');
  await page.mouse.move(640, 420);
  const b = await shell.locator('[data-act="nav"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForFunction(() => !document.querySelector('marble-shell').hasAttribute('data-hide-nav'));
  await page.mouse.move(640, 420, { steps: 4 });
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-hide-nav'));
});

test('on hover a side goes as soon as the hand leaves it, and a click in it does not hold it there', async () => {
  const { page } = await visit();
  await page.keyboard.press('Control+\\');
  await margins(page);
  await unpin(page.locator('marble-shell'), 'nav', 'chat');
  await page.mouse.click(640, 420);
  await page.waitForFunction(() => document.querySelector('marble-shell').hasAttribute('data-hide-nav'));

  await page.mouse.move(3, 420);
  await page.waitForFunction(() => !document.querySelector('marble-shell').hasAttribute('data-hide-nav'));
  await page.mouse.move(640, 420, { steps: 4 });
  await page.waitForTimeout(250);
  assert.equal(await navOut(page), false, 'the tree is on its way within a quarter second');

  await page.mouse.move(1277, 420);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen);
  const panel = page.locator('marble-agent-drawer').locator('.panel');
  const r = await panel.boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + 80);
  await page.mouse.move(640, 420, { steps: 4 });
  await page.waitForTimeout(250);
  assert.equal(await chatOut(page), false, 'a click, then leaving, is leaving');
});

test('on hover the launcher is gone while the chat is out, and comes back without raising anything under a still hand', async () => {
  const { page } = await visit();
  await page.keyboard.press('Control+\\');
  await margins(page);
  await unpin(page.locator('marble-shell'), 'nav', 'chat');
  await page.mouse.click(640, 420);
  await page.waitForFunction(() => !document.querySelector('marble-agent-drawer').isOpen);
  const tray = page.locator('marble-agent-drawer').locator('.tray');
  const back = () => page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray').dataset.away === 'false');
  await back();
  // Unpinned, it slides from the page's corner beside the column to the window's.
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher').getBoundingClientRect().right === innerWidth - 20);
  const b = await page.locator('marble-agent-drawer').locator('.launcher').boundingBox();

  await page.mouse.move(1277, 420);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen);
  assert.equal(await tray.evaluate((el) => el.dataset.away), 'true', 'nothing beside the card to reach for');

  // Over the card where the launcher waits, put the chat away (its close
  // button, a key): the launcher comes back under the hand, and the hand
  // resting there raises nothing.
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.evaluate(() => document.querySelector('marble-agent-drawer').close());
  await page.waitForFunction(() => !document.querySelector('marble-agent-drawer').isOpen);
  await back();
  await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2);
  await page.waitForTimeout(300);
  assert.equal(await tray.evaluate((el) => el.dataset.open), 'false', 'a launcher that came back under the pointer waits');
  assert.equal(await chatOut(page), false);

  // Leave it and come back, and it is a launcher again.
  await page.mouse.move(640, 420, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray').dataset.open === 'true');

  // Running past it into the edge beside it is not a reach for the panel.
  await page.mouse.move(1279, b.y + b.height / 2, { steps: 3 });
  await page.waitForTimeout(250);
  assert.equal(await chatOut(page), false, 'the edge beside the launcher is the launcher\'s');
  await page.mouse.move(1279, 300);
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer').isOpen);
});
