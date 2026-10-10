// Agent status on the Agents page: Glance on the bar, and Quiet, a working
// chat that has taken no step for five minutes (runtime/agent-status.js).
// The chats are written into the store as a fixture, so their times can be
// set: a step twelve minutes ago is quiet, one ten seconds ago is working.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const MIN = 60_000;
const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());
const store = host.drive.agents.store;

/** A chat in a turn that began `began` ago, whose last step was `stepped` ago. */
const working = async (title, { began, stepped, words }) => {
  const { id } = await store.createConversation({ provider: 'fake' });
  const turn = await store.createTurn(id, { prompt: title, context: { target: 'garden' } });
  const now = Date.now();
  await store.updateTurn(turn.id, { status: 'running', startedAt: now - began });
  await store.updateConversation(id, {
    title, running: true, target: 'garden', activity: 'Working on garden',
    lastStep: { t: now - stepped, turn: turn.id, kind: 'run', tool: 'Bash', words },
  });
  return id;
};

const quietId = await working('Stuck build', { began: 30 * MIN, stepped: 12 * MIN, words: 'Running a command' });
const busyId = await working('Builder', { began: 2 * MIN, stepped: 10_000, words: 'Changing garden' });

const openAgents = async (options = {}) => {
  const { page, errors } = await host.newPage(options);
  if (options.clock) await page.clock.install();
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleAgentStatus));
  await page.locator(`.conv[data-id="${busyId}"]`).waitFor({ state: 'attached' });
  return { page, errors };
};

const dotOf = (page, id) => page.locator(`.conv[data-id="${id}"] > .dot`);

test('Glance on the bar leads with the work going on, and a chat with no step for five minutes is Quiet', async () => {
  const { page, errors } = await openAgents();
  const glance = page.locator('.topbar .glance');
  await page.waitForFunction(() => document.querySelector('.topbar .glance .glance-lead')?.textContent === '2 working');
  assert.equal(await glance.locator('.glance-sub').textContent(), 'Builder: Changing garden');
  assert.equal(await glance.getAttribute('data-lead'), 'working');
  assert.equal(await glance.locator('.dot').getAttribute('data-state'), 'running');
  assert.equal(await glance.isEnabled(), true);
  assert.equal(await glance.isVisible(), true);

  assert.equal(await dotOf(page, quietId).getAttribute('data-state'), 'quiet');
  assert.equal(await dotOf(page, busyId).getAttribute('data-state'), 'running');
  // Working's colour, without the breath.
  const look = (id) => dotOf(page, id).evaluate((el) => {
    const css = getComputedStyle(el);
    return { animation: css.animationName, border: css.borderTopColor, background: css.backgroundColor };
  });
  const quiet = await look(quietId);
  const busy = await look(busyId);
  assert.equal(quiet.animation, 'none');
  assert.notEqual(busy.animation, 'none');
  assert.equal(quiet.border, busy.background, 'the ring is the working dot\'s colour');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a working chat goes Quiet on its own, with nothing arriving to say so', async () => {
  const { page, errors } = await openAgents({ clock: true });
  assert.equal(await dotOf(page, busyId).getAttribute('data-state'), 'running');
  await page.clock.fastForward('06:00');
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"] > .dot`)?.dataset.state === 'quiet', busyId);
  // Both are quiet now; the bar still says two are working, and says how long.
  assert.equal(await page.locator('.topbar .glance .glance-lead').textContent(), '2 working');
  assert.match(await page.locator('.topbar .glance .glance-sub').textContent(), /^Builder: Quiet for \d+ min, last changing garden$/);
  assert.equal(await page.locator('.topbar .glance .dot').getAttribute('data-state'), 'quiet');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a question waiting leads Glance, and a press opens that chat', async () => {
  const { id: askId } = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(askId, { title: 'Needs a yes', running: true, asking: true, target: 'garden' });
  const { page, errors } = await openAgents();
  const glance = page.locator('.topbar .glance');
  await page.waitForFunction(() => document.querySelector('.topbar .glance .glance-lead')?.textContent === '1 needs you');
  assert.equal(await glance.locator('.glance-sub').textContent(), 'Needs a yes is waiting for you');
  assert.equal(await glance.locator('.dot').getAttribute('data-state'), 'asking');
  await glance.click();
  await page.waitForFunction((id) => localStorage.getItem('marble-agents:open') === id, askId);
  assert.ok(await page.locator(`.conv[data-id="${askId}"].marble-open`).count());
  await store.updateConversation(askId, { running: false, asking: false, archived: true });
  assert.deepEqual(errors.filter((e) => !/404|Failed to load resource/.test(e)), []);
  await page.close();
});

test('below desk width the bar keeps the lead and drops the chat\'s line; the phone leaves Glance off its one row', async () => {
  let { page } = await openAgents({ viewport: { width: 900, height: 700 } });
  const glance = page.locator('.topbar .glance');
  await page.waitForFunction(() => document.querySelector('.topbar .glance .glance-lead')?.textContent === '2 working');
  assert.equal(await glance.isVisible(), true);
  assert.equal(await glance.locator('.glance-sub').isVisible(), false);
  assert.match(await glance.getAttribute('title'), /^Builder: Changing garden/);
  // Nothing on the bar runs past its edge.
  const overflow = await page.evaluate(() => {
    const bar = document.querySelector('.topbar');
    return bar.scrollWidth - bar.clientWidth;
  });
  assert.ok(overflow <= 1, `the bar overflows by ${overflow}px`);
  await page.close();

  ({ page } = await openAgents({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }));
  assert.equal(await page.locator('.topbar .glance').isVisible(), false);
  await page.close();
});
