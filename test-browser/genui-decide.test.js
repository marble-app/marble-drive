// Jev decides; the host writes; the open page moves. No reload, no script in
// the document — the attribute the CSS reads is the fact that changed.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { startDrive } from './harness.js';

const FIXTURE = await fsp.readFile(new URL('../test/fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const METRICS = await fsp.readFile(new URL('../test/fixtures/genui/metrics.mrbl', import.meta.url), 'utf8');
const ATLAS = new URL('../test/fixtures/genui/atlas.mini.json', import.meta.url).pathname;
process.env.MARBLE_DRIVE_GENUI_ATLAS = ATLAS;
process.env.TYPESAFE_API_KEY = 'tsk_browser_test';

// The fake gate reads the context the way a real one would: a phone wants the
// detail as a pop-up and the cards as a list; a desktop wants side-by-side.
const answer = (choice) => ({ type: 'choice', choice, confidence: 0.92, probabilities: { [choice]: 0.92 } });
const ask = async ({ state, questions }) => {
  const phone = state.context?.viewport === 'phone';
  const pick = (id, q) => {
    if (id === 'games.openIn') return phone ? 'pop-up' : 'side-by-side';
    if (id === 'games.overviewType') return phone ? 'list' : 'grid';
    if (id === 'game-card.shape') return phone ? 'horizontal' : 'vertical';
    if (id === 'ops.arrangement') return phone ? 'single-scrolling-column' : 'fixed-grid';
    return Object.keys(q.criteria)[0];
  };
  return { model: 'fake', answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, answer(pick(id, q))])) };
};

const host = await startDrive({ agents: false, documents: { 'Spaces/49ers': FIXTURE, 'Spaces/metrics': METRICS }, genui: { ask } });
test.after(() => host.close());

const decide = (doc, context) =>
  fetch(`${host.base}/genui/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc, context }),
  }).then((r) => r.json());

test('a decide moves the open page without a reload, and a re-decide moves it back', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${encodeURIComponent('Spaces/49ers')}`);
  await page.waitForFunction(() => Boolean(window.marble));
  const games = page.locator('#games');
  assert.equal(await games.getAttribute('data-open-in'), 'side-by-side');
  assert.equal(await games.getAttribute('data-overview-type'), 'grid');
  await page.evaluate(() => { window.__notReloaded = true; });

  const phone = await decide('Spaces/49ers', { viewport: 'phone', items: 6 });
  const moved = (res, id) => res.decisions.find((d) => d.id === id)?.applied === true;
  assert.ok(moved(phone, 'games.openIn') && moved(phone, 'games.overviewType'), 'the two context-driven decisions moved');
  await page.waitForFunction(() => document.querySelector('#games')?.getAttribute('data-open-in') === 'pop-up');
  assert.equal(await games.getAttribute('data-overview-type'), 'list');
  assert.equal(await page.evaluate(() => window.__notReloaded === true), true, 'the page did not reload');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#games .detail')).position), 'fixed');
  // The card role moved every card, not the first one: the fact lives on the
  // container and each stamped card derives from it.
  const columnsPerCard = () => page.evaluate(() => [...document.querySelectorAll('#games .card')].map((c) => getComputedStyle(c).gridTemplateColumns.split(' ').length));
  assert.deepEqual(await columnsPerCard(), [2, 2, 2, 2, 2, 2]);

  const desktop = await decide('Spaces/49ers', { viewport: 'desktop', items: 6 });
  assert.ok(moved(desktop, 'games.openIn') && moved(desktop, 'games.overviewType'), 'and moved back');
  await page.waitForFunction(() => document.querySelector('#games')?.getAttribute('data-open-in') === 'side-by-side');
  assert.equal(await games.getAttribute('data-overview-type'), 'grid');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#games .detail')).position), 'sticky');
  assert.deepEqual(await columnsPerCard(), [1, 1, 1, 1, 1, 1]);

  const again = await decide('Spaces/49ers', { viewport: 'desktop', items: 6 });
  assert.equal(again.applied, 0, 'nothing to change is nothing written');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('the same path moves a dashboard — not an overview–detail-only trick', async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${encodeURIComponent('Spaces/metrics')}`);
  await page.waitForFunction(() => Boolean(window.marble));
  const ops = page.locator('#ops');
  assert.equal(await ops.getAttribute('data-arrangement'), 'fixed-grid');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ops .tiles')).gridTemplateColumns.split(' ').length), 4);

  const res = await decide('Spaces/metrics', { viewport: 'phone' });
  assert.ok(res.applied >= 1);
  await page.waitForFunction(() => document.querySelector('#ops')?.getAttribute('data-arrangement') === 'single-scrolling-column');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ops .tiles')).gridTemplateColumns.split(' ').length), 1);
  assert.deepEqual(errors, []);
  await page.context().close();
});
