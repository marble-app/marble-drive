// The product: a prompt, a decision tree, a living UI. The pattern is decided
// (fake gate), the space is authored (a scripted agent writes a fixture), every
// dimension is decided, the iframe shows it — and a follow-up re-decides it.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startDrive } from './harness.js';

const TEMPLATE = await fsp.readFile(new URL('../templates/genui.mrbl', import.meta.url), 'utf8');
const METRICS = await fsp.readFile(new URL('../test/fixtures/genui/metrics.mrbl', import.meta.url), 'utf8');
const ATLAS = new URL('../test/fixtures/genui/atlas.mini.json', import.meta.url).pathname;
process.env.MARBLE_DRIVE_GENUI_ATLAS = ATLAS;
process.env.TYPESAFE_API_KEY = 'tsk_browser_test';

// The authoring prompt is a fact on <body>; aimed at the scripted agent here.
const PAGE = TEMPLATE.replace(/data-author-prompt="[^"]*"/, 'data-author-prompt="script:author {doc}"');
const PROMPT = 'a dashboard for the on-call engineer: error rate, p95 latency, open incidents';
const SLUG = 'Spaces/a-dashboard-for-the-on-call-engineer';

const answer = (choice, confidence, all) => ({ type: 'choice', choice, confidence, probabilities: all ?? { [choice]: confidence } });
const ask = async ({ state, questions }) => {
  if (questions.root) {
    return { answers: { root: answer('dashboard', 0.81, { dashboard: 0.81, 'overview-detail': 0.1, chart: 0.09 }) } };
  }
  const train = (state.context?.signals ?? []).some((s) => /train|phone/i.test(s));
  const pick = (id, q) => {
    if (id === 'ops.arrangement') return train ? 'single-scrolling-column' : 'fixed-grid';
    if (id === 'ops.density') return 'a-few-glanceable-tiles';
    return Object.keys(q.criteria)[0];
  };
  return { answers: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, answer(pick(id, q), 0.9)])) };
};

const scripts = {};
const host = await startDrive({ documents: { GenUI: PAGE }, genui: { ask }, scripts });
// The scripted "agent" writes the fixture where the page said to.
await fsp.mkdir(path.join(host.drive.config.root, 'Spaces'), { recursive: true });
scripts.author = [{ say: 'Authoring the space', silent: 200 }, { write: { file: path.join(host.drive.config.root, `${SLUG}.mrbl`), text: METRICS } }];
// The page aims the run at the "Marble Drive" project, where the skill lives.
const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-genui-project-'));
const registered = await fetch(`${host.base}/agent/projects`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Marble Drive', path: projectDir }),
});
assert.ok(registered.ok, `project registration: HTTP ${registered.status}`);
test.after(async () => {
  await host.close();
  await fsp.rm(projectDir, { recursive: true, force: true });
});

test('prompt → pattern → authored space → decided → shown; a follow-up re-decides and the UI moves', async () => {
  const { page, errors } = await host.newPage({ viewport: { width: 1400, height: 1000 } });
  const dump = async (why) => console.error('DUMP', why, JSON.stringify(await page.evaluate(() => ({  tree: document.querySelector('#tree')?.textContent.slice(0, 400), root: document.body.dataset.root, run: document.body.dataset.run, space: document.body.dataset.space, ms: document.querySelector('#stage-ms')?.textContent, stage: document.querySelector('#stage-space')?.textContent }))), 'errors', JSON.stringify(errors));
  try {
  await page.goto(`${host.base}/a/GenUI`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));

  const prompt = page.locator('[data-marble-id="prompt"]');
  await prompt.click();
  await page.keyboard.type(PROMPT);
  await page.keyboard.press('Enter');

  // L0 lands first, from Jev, before any agent runs.
  await page.waitForFunction(() => /Pattern · Dashboard/.test(document.querySelector('#tree')?.textContent || ''));
  assert.match(await page.locator('#tree .node').first().locator('.conf').textContent(), /0\.81/);
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-root')), 'dashboard');

  // The authoring node, then the space: the scripted agent wrote it and the
  // page picked it up when the turn ended.
  await page.waitForFunction(() => /Authoring/.test(document.querySelector('#tree')?.textContent || ''));
  await page.waitForFunction(() => /dashboard#ops/.test(document.querySelector('#tree')?.textContent || ''), null, { timeout: 30_000 });
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-space')), SLUG);
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-run')), '');

  // Decided: the L1/L2 rows carry confidences and the stage says how long.
  await page.waitForFunction(() => /\d+ ms/.test(document.querySelector('#stage-ms')?.textContent || ''));
  const rows = page.locator('#tree .row');
  assert.equal(await rows.count(), 9);
  assert.ok((await page.locator('#tree .node h3').allTextContents()).some((t) => /stat-tile#kpi/.test(t)), 'the child instance is a nested node');

  // The UI is the real document, in an iframe, at its authored positions.
  const frame = page.frameLocator('#stage-body iframe');
  await frame.locator('#ops').waitFor();
  assert.equal(await frame.locator('#ops').getAttribute('data-arrangement'), 'fixed-grid');
  assert.match(await page.locator('#stage-space').textContent(), new RegExp(SLUG));

  // A follow-up is a signal: re-decide, the row is marked moved, the iframe moves.
  const signal = page.locator('#signal-new');
  await signal.click();
  await page.keyboard.type("I'm on the train");
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.signals li')].some((li) => /train/.test(li.textContent)));
  await page.waitForFunction(() => document.querySelector('#tree .row[data-moved="yes"] .k')?.textContent === 'arrangement', null, { timeout: 15_000 });
  await frame.locator('#ops[data-arrangement="single-scrolling-column"]').waitFor();
  assert.equal(await page.evaluate(() => document.querySelectorAll('.signals li .x').length), 1, 'the chip grew its ×');

  // The signal is a fact: it survives a reload, and so does the space.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForFunction(() => /dashboard#ops/.test(document.querySelector('#tree')?.textContent || ''));
  assert.equal(await page.evaluate(() => document.querySelectorAll('.signals li').length), 1);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.signals li .x').length), 1, 'the × is derived back after a reload');

  if (process.env.GENUI_SHOT) await page.screenshot({ path: process.env.GENUI_SHOT, fullPage: true });
  assert.deepEqual(errors, []);
  } catch (err) { await dump(err.message.split('\n')[0]); throw err; }
  await page.context().close();
});

test('a pin holds a decision against Jev; a signal with nowhere to land says so and offers Extend', async () => {
  const { page, errors } = await host.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${host.base}/a/GenUI`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await page.waitForFunction(() => /dashboard#ops/.test(document.querySelector('#tree')?.textContent || ''));

  // Pin arrangement where it is (single-scrolling-column after the first test), then
  // remove the train signal: without the pin Jev would move it back to fixed-grid.
  const row = page.locator('#tree .row', { has: page.locator('.k', { hasText: /^arrangement$/ }) }).first();
  await row.locator('.pin').click();
  await page.waitForFunction(() => document.querySelector('#tree .row[data-pinned="yes"] .k')?.textContent === 'arrangement');
  await page.locator('.signals li .x').first().click();
  await page.locator('#redecide').click();
  await page.waitForFunction(() => document.querySelector('#tree .row[data-pinned="yes"]')?.getAttribute('data-reason') === 'pinned');
  const frame = page.frameLocator('#stage-body iframe');
  assert.equal(await frame.locator('#ops').getAttribute('data-arrangement'), 'single-scrolling-column', 'pinned: the page did not move back');

  // A signal the fake ignores changes nothing: the page says so and offers Extend.
  await page.locator('#signal-new').click();
  await page.keyboard.type('mute everything for an hour');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Nothing in this space can express/.test(document.querySelector('#tree')?.textContent || ''));
  assert.ok(await page.locator('#extend').isVisible());

  // Unpin: the next decide moves it again.
  await page.locator('#tree .row[data-pinned="yes"] .pin').click();
  await page.waitForFunction(() => !document.querySelector('#tree .row[data-pinned="yes"]'));
  await page.locator('#redecide').click();
  await frame.locator('#ops[data-arrangement="fixed-grid"]').waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});
