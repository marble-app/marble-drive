// The shell's third part: keys typed into chrome stay there, Describe has
// doors and a key for every tool, and the document you are in can be moved
// from the bar without leaving anything pointing at where it was.
import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// A page with shortcuts of its own, on the document, the way apps write them.
const KEYED = GARDEN.replace('</body>', `<script>
  window.heard = [];
  document.addEventListener('keydown', (e) => { if (!e.repeat) window.heard.push((e.metaKey || e.ctrlKey ? 'mod+' : '') + e.key.toLowerCase()); });
</script></body>`);

const host = await startDrive({
  documents: { garden: KEYED, 'Research/atlas': GARDEN, 'Travel/plans': GARDEN },
  scripts: { slow: [{ sleep: 60_000 }] },
});
test.after(() => host.close());

async function visit(path = 'garden') {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${path.split('/').map(encodeURIComponent).join('/')}`);
  await page.waitForFunction(() => document.querySelector('marble-shell')?.shadowRoot && document.querySelector('marble-agent-drawer')?.shadowRoot);
  await page.mouse.move(640, 400);
  return { page, errors, shell: page.locator('marble-shell') };
}
const heard = (page) => page.evaluate(() => window.heard.splice(0));

test('typing in the chat or the tree\'s search is typing: the page\'s shortcuts never hear it', async () => {
  const { page, shell } = await visit();
  await page.mouse.click(600, 300);
  await page.keyboard.press('v');
  assert.deepEqual(await heard(page), ['v'], 'on the page, the page\'s keys are the page\'s');

  await page.keyboard.press('Control+\\');
  const editor = page.locator('marble-agent-drawer').locator('marble-conversation').locator('.editor');
  await editor.waitFor();
  await editor.click();
  await heard(page);
  await page.keyboard.type('move v here');
  assert.equal(await editor.innerText(), 'move v here');
  // ⌘Z in the composer is the composer's undo, not the page's.
  await page.keyboard.press('Control+z');
  assert.deepEqual(await heard(page), [], 'nothing typed in the composer reached the page');

  await shell.locator('.search input').click();
  await page.keyboard.type('vat');
  assert.deepEqual(await heard(page), [], 'nor from the search');
  assert.equal(await shell.locator('.search input').inputValue(), 'vat');
});

test('Describe opens from the bar or ⌘⇧D, every tool has a key, and V is the app again', async () => {
  const { page, shell } = await visit('Research/atlas');
  await page.keyboard.press('Control+\\');
  const button = shell.locator('[data-act="describe"]');
  await button.waitFor();
  await button.click();
  const layer = page.locator('.marble-marks-layer');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer')?.hasAttribute('data-describing'));
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  const pressed = () => layer.locator('.marble-marks-tool[aria-pressed="true"]').getAttribute('data-tool');
  await page.keyboard.press('p');
  assert.equal(await pressed(), 'sketch');
  await page.keyboard.press('t');
  assert.equal(await pressed(), 'text');
  await page.keyboard.press('a');
  assert.equal(await pressed(), 'select');
  await page.keyboard.press('v');
  assert.equal(await pressed(), 'use', 'the cursor: the page answers again');
  await page.keyboard.press('m');
  assert.equal(await pressed(), 'use', 'no Move or resize any more');
  assert.equal(await layer.locator('[data-tool="adjust"]').count(), 0);
  // Just the icon; the name and the key are in the tip.
  assert.equal(await layer.locator('[data-tool="sketch"]').getAttribute('aria-label'), 'Sketch (P)');
  await page.keyboard.press('Control+Shift+d');
  await page.waitForFunction(() => !document.querySelector('.marble-marks-layer').hasAttribute('data-describing'));
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Control+Shift+d');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').hasAttribute('data-describing'));
});

test('Move or rename: the document moves, the page opens at its new address where you were, and the old one forwards', async () => {
  const { page, shell } = await visit('Travel/plans');
  const id = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.send(id, { prompt: 'script:slow', target: 'Travel/plans', viewing: 'Travel/plans' });
    return id;
  });
  await page.keyboard.press('Control+\\');
  await shell.locator('.crumbs .here').click();
  await shell.locator('[data-pick="move"]').click();
  const dialog = shell.locator('.moving');
  await dialog.waitFor();
  assert.equal(await dialog.locator('.name').inputValue(), 'plans');
  assert.equal(await dialog.locator('.ok').isDisabled(), true, 'nothing to do until something changes');
  await dialog.locator('.dest[data-dest="Research"]').click();
  assert.equal(await dialog.locator('.ok').innerText(), 'Move');
  await dialog.locator('.name').fill('trip plans');
  await dialog.locator('.ok').click();
  await page.waitForURL(/\/a\/Research(%2F|\/)trip%20plans$/);
  await page.locator('marble-shell').locator('.toast[data-on]').waitFor();
  assert.equal(await page.locator('marble-shell').locator('.toast').innerText(), 'Moved to Research');
  assert.equal(await page.locator('marble-shell').locator('.crumbs .here').innerText(), 'trip plans');

  const old = await fetch(`${host.base}/a/${encodeURIComponent('Travel/plans')}`, { redirect: 'manual' });
  assert.equal(old.status, 302);
  assert.equal(old.headers.get('location'), `/a/${encodeURIComponent('Research/trip plans')}`);
  // The agent aimed at it aims where it went.
  const summary = await page.evaluate(async (id) => (await window.marble.agent.conversations()).find((c) => c.id === id), id);
  assert.equal(summary.target, 'Research/trip plans');
  await page.evaluate((id) => window.marble.agent.archive(id, true), id);
});

test('a name already taken, or one with a slash in it, is refused before anything moves', async () => {
  const { page, shell } = await visit('Research/atlas');
  await page.keyboard.press('Control+\\');
  await shell.locator('.crumbs .here').click();
  await shell.locator('[data-pick="move"]').click();
  const dialog = shell.locator('.moving');
  await dialog.locator('.dests .dest').first().waitFor();
  await dialog.locator('.name').fill('a/b');
  assert.match(await dialog.locator('.note').innerText(), /slash/);
  assert.equal(await dialog.locator('.ok').isDisabled(), true);
  await dialog.locator('.name').fill('trip plans');
  assert.match(await dialog.locator('.note').innerText(), /already there/);
  assert.equal(await dialog.locator('.ok').isDisabled(), true);
  await page.keyboard.press('Escape');
  // A popover fades out where it was rather than vanishing.
  await dialog.waitFor({ state: 'hidden', timeout: 1000 });
  assert.equal(await dialog.isVisible(), false);
});
