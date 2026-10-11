// The Console's Features view in a browser: a saved board drawn as lines with
// the drives that have each feature lit, a link that opens one line, a
// correction that outlives the next triage, and a chat listed once with every
// feature it moved.

import assert from 'node:assert/strict';
import test from 'node:test';

import { consoleWorld, SECRET } from './console-world.js';

async function world() {
  const w = await consoleWorld();
  const [, older, , , head] = w.shas;
  await w.host.drive.console.features.save({
    areas: ['Hosting', 'Agents and chat'],
    features: [
      { id: 'hold', name: 'Hold the sprite while it works', area: 'Hosting', commits: [head], chats: [{ id: 'chat000000ab' }] },
      { id: 'settings-test', name: 'Say which document is newest', area: 'Hosting', commits: [older], chats: [{ id: 'chat000000ab' }] },
      { id: 'widgets', name: 'Widgets view in Agents', area: 'Agents and chat', kind: 'drive', at: 'build', docs: ['Agents'], lives: 'In this drive’s Agents page' },
    ],
  });
  return w;
}

async function openFeatures(w, { width = 1280, colorScheme = 'light', link = '' } = {}) {
  const { page, errors } = await w.host.newPage({ viewport: { width, height: 860 }, colorScheme });
  await page.request.post(`${w.host.base}/gate`, { data: { secret: SECRET } });
  await page.goto(`${w.host.base}/a/Console?view=features${link}`);
  await page.waitForSelector('.fx-feat');
  return { page, errors };
}

test('each feature is a line, lit where its commits are', async (t) => {
  const w = await world();
  t.after(() => w.host.close());
  const { page, errors } = await openFeatures(w);
  const names = await page.$$eval('.fx-feat .fx-name', (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ['Hold the sprite while it works', 'Say which document is newest', 'Widgets view in Agents'], 'in the board’s area order');
  // head is on admin-p1, t-irene and t-sangho; the older commit everywhere
  // but t-bryan, whose release is a --local one of head.
  const lit = (id) => page.$$eval(`.fx-feat[data-id="${id}"] .fx-dv.lit`, (els) => els.length);
  assert.equal(await lit('hold'), 3, 'admin-p1, t-irene and t-sangho');
  assert.equal(await page.$$eval('.fx-feat[data-id="hold"] .fx-dv.tried', (els) => els.length), 1, 't-bryan only tried it, with --local');
  assert.equal(await lit('settings-test'), 5, 'every release but the --local one');
  assert.equal(await page.$$eval('.fx-feat[data-id="widgets"] .fx-dv', (els) => els.length), 0, 'a drive-only feature never reaches a drive');
  assert.match(await page.textContent('.fx-feat[data-id="widgets"] .fx-lives'), /Agents page/);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(sideways, false);
  assert.deepEqual(errors, []);
});

test('a link opens one line, and a correction outlives the next triage', async (t) => {
  const w = await world();
  t.after(() => w.host.close());
  const { page } = await openFeatures(w, { link: '&feature=hold' });
  await page.waitForSelector('.fx-feat[data-id="hold"][data-open] .fx-more');
  assert.ok(!page.url().includes('feature='), 'the link is taken off the address');
  const input = page.locator('.fx-feat[data-id="hold"] .fx-field input').nth(1);
  await input.fill('Ship to everyone');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.fx-feat[data-id="hold"] .fx-next')?.textContent === 'Ship to everyone');
  const board = await w.host.drive.console.features.board();
  await w.host.drive.console.features.save({ features: board.features });
  const placed = await w.host.drive.console.features.place();
  assert.equal(placed.features.find((f) => f.id === 'hold').next, 'Ship to everyone');
});

test('Chats lists a chat once, with every feature it moved under it; Drives says what has not arrived', async (t) => {
  const w = await world();
  t.after(() => w.host.close());
  const { page } = await openFeatures(w, { width: 390, colorScheme: 'dark' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'nothing sideways on a phone');
  await page.click('.fx [role=radiogroup] button:has-text("Chats")');
  await page.waitForSelector('.fx-crow');
  assert.equal(await page.$$eval('.fx-crow', (els) => els.length), 1);
  assert.deepEqual(await page.$$eval('.fx-cfeats button > span:first-child', (els) => els.map((e) => e.textContent)), ['Hold the sprite while it works', 'Say which document is newest']);
  await page.click('.fx [role=radiogroup] button:has-text("Drives")');
  await page.waitForSelector('.fx-node');
  const sam = await page.locator('.fx-node', { hasText: 't-sam' }).textContent();
  assert.match(sam, /Not here yet/);
  assert.match(sam, /Hold the sprite while it works/);
  await page.locator('.fx-node', { hasText: 't-sam' }).getByRole('button', { name: 'Hold the sprite while it works' }).click();
  await page.waitForSelector('.fx-feat[data-id="hold"][data-open]');
});
