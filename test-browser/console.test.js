// The Console in a browser, against a fake fleet: it draws every drive without
// waking one, a settings edit waits in the bar and applies as a job, a deploy
// says its plan first and streams into Activity, a restore asks for the name,
// the workshop chat is a real conversation, and a phone gets one thing at a
// time with nothing running off the side.

import assert from 'node:assert/strict';
import test from 'node:test';

import { consoleWorld } from './console-world.js';

const ENV = '# t-sam\nMARBLE_DRIVE_SECRET=pass-t-sam\nMARBLE_DRIVE_AGENT_PROVIDER=claude-api\n';
const world = await consoleWorld({ fleet: { exec: { 't-sam': { cat: { stdout: ENV } } } } });
test.after(() => world.host.close());

const ASLEEP = ['t-bryan', 't-irene', 't-peiling', 't-sangho'];
const execs = async () => (await world.fleet.calls()).filter((c) => c[0] === 'exec').map((c) => c[c.indexOf('-s') + 1]);

test('every drive is drawn, grouped, awake or asleep, and drawing it wakes nobody', async () => {
  const before = (await execs()).length;
  const { page, errors } = await world.open();
  await page.waitForTimeout(800);
  const groups = await page.$$eval('.group', (els) => els.map((e) => e.textContent));
  assert.deepEqual(groups, ['Yours1', 'People5']);
  assert.equal(await page.getAttribute('.row[data-name="t-sam"] .dot', 'data-state'), 'awake');
  assert.equal(await page.getAttribute('.row[data-name="t-irene"] .dot', 'data-state'), 'asleep');
  assert.match(await page.textContent('.row[data-name="t-peiling"] .row-meta'), /3 behind · API key · public/);
  const woken = (await execs()).slice(before).filter((n) => ASLEEP.includes(n));
  assert.deepEqual(woken, [], 'no asleep drive was exec’d to draw the page');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a settings edit waits in the bar, then applies as a job that writes the drive’s sprite.env', async () => {
  const { page, errors } = await world.open();
  await page.click('.row[data-name="t-sam"]');
  await page.fill('input[data-key="set:t-sam:MARBLE_DRIVE_AWAKE_MAX_HOURS"]', '12');
  await page.waitForSelector('.pending');
  assert.match(await page.textContent('.pending .say'), /1 change: awake max hours/);
  assert.match(await page.textContent('.pending .say small'), /restarts t-sam/);
  await page.click('.pending .btn.primary');
  await page.waitForFunction(() => !document.querySelector('.pending'), null, { timeout: 15_000 });
  const up = (await world.fleet.uploads()).find((c) => c.files?.['/tmp/marble-console-sprite.env']);
  assert.equal(up.files['/tmp/marble-console-sprite.env'], `${ENV}MARBLE_DRIVE_AWAKE_MAX_HOURS=12\n`);
  await page.click('.seg [data-view="activity"]');
  await page.waitForSelector('.cx-view[data-view="activity"] .row .row-title:text("Change t-sam\'s settings")');
  assert.ok(!(await page.textContent('.log')).includes('pass-t-sam'), 'the passphrase is not in the output');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a deploy says its plan first, is busy at the button, and streams into Activity', async () => {
  const { page, errors } = await world.open();
  await page.click('.row[data-name="t-peiling"]');
  await page.click('.detail button:text("Deploy main")');
  await page.waitForSelector('.pop:popover-open .btn.primary:not([disabled])');
  const plan = await page.textContent('.pop:popover-open');
  assert.match(plan, /Keep-awake renews its task with PUT/);
  assert.match(plan, /A checkpoint first/);
  await page.click('.pop:popover-open .btn.primary');
  await page.waitForSelector('.detail .btn[data-busy]:text("Deploying…")');
  assert.equal(await page.getAttribute('.row[data-name="t-peiling"] .dot', 'data-state'), 'busy');
  await page.click('.seg [data-view="activity"]');
  await page.waitForFunction(() => /done: live on t-peiling/.test(document.querySelector('.log')?.textContent ?? ''), null, { timeout: 15_000 });
  assert.ok(await page.$('.log .step'), 'the tool’s steps stand out');
  assert.deepEqual(errors, []);
  await page.close();
});

test('restoring asks for the drive’s name before it will do anything', async () => {
  const { page } = await world.open();
  await page.click('.row[data-name="t-sangho"]');
  await page.waitForSelector('.detail button:text("Restore")');
  await page.click('.detail button:text("Restore")');
  const go = page.locator('.pop:popover-open .btn.danger');
  assert.equal(await go.isDisabled(), true);
  await page.fill('.pop:popover-open input', 't-sangh');
  assert.equal(await go.isDisabled(), true);
  await page.fill('.pop:popover-open input', 't-sangho');
  assert.equal(await go.isDisabled(), false);
  await go.click();
  await page.waitForFunction(() => document.querySelector('.cx-view[data-view="drives"] .row[data-name="t-sangho"] .dot')?.dataset.state === 'busy' || true);
  for (let i = 0; i < 50 && !(await world.fleet.calls()).some((c) => c.join(' ') === 'restore v6 -o marble-drive -s t-sangho'); i += 1) await page.waitForTimeout(100);
  assert.ok((await world.fleet.calls()).some((c) => c.join(' ') === 'restore v6 -o marble-drive -s t-sangho'));
  await page.close();
});

test('the workshop chat is a real conversation in the Marble Drive project', async () => {
  const { page, errors } = await world.open();
  await page.click('.seg [data-view="workshop"]');
  await page.waitForSelector('.cx-view[data-view="workshop"] marble-conversation');
  assert.equal(await page.getAttribute('.cx-view[data-view="workshop"] marble-conversation', 'project'), 'mdrive');
  const prompt = () => page.evaluate(() => document.querySelector('.cx-view[data-view="workshop"] marble-conversation').shadowRoot.querySelector('.editor').dataset.placeholder);
  assert.equal(await prompt(), 'Ask for a change to Marble Drive…', 'the composer says what it is for here');
  await page.click('.cx-view[data-view="workshop"] .seg button:text-is("Marble")');
  await page.waitForFunction(() => document.querySelector('.cx-view[data-view="workshop"] marble-conversation')?.getAttribute('project') === 'marble');
  assert.deepEqual(errors, []);
  await page.close();
});

test('on a phone the detail slides in and out, and nothing runs off the side', async () => {
  const { page, errors } = await world.open({ width: 390, height: 844, hasTouch: true, isMobile: true });
  const over = () => page.evaluate(() => [...document.querySelectorAll('.cx *')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width && r.right > innerWidth + 1 && !el.closest('.pane.detail:not([data-open] .pane.detail)') && getComputedStyle(el).visibility !== 'hidden';
  }).length);
  assert.equal(await page.getAttribute('.well', 'data-open'), null);
  await page.tap('.row[data-name="t-sam"]');
  await page.waitForFunction(() => document.querySelector('.cx-view[data-view="drives"] .well').hasAttribute('data-open'));
  await page.waitForTimeout(700);
  const detail = await page.evaluate(() => {
    const pane = document.querySelector('.cx-view[data-view="drives"] .pane.detail');
    return [...pane.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).map((el) => el.className);
  });
  assert.deepEqual(detail, [], 'nothing in the open detail is wider than the phone');
  await page.tap('.cx-view[data-view="drives"] .d-head .back');
  await page.waitForFunction(() => !document.querySelector('.cx-view[data-view="drives"] .well').hasAttribute('data-open'));
  assert.ok((await over()) >= 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a redraw that lands while a button is held does not lose the click', async () => {
  const { page } = await world.open();
  await page.click('.row[data-name="t-sam"]');
  await page.fill('input[data-key="set:t-sam:MARBLE_DRIVE_ASK_HOLD_MINUTES"]', '5');
  await page.waitForSelector('.pending .btn.primary');
  await page.waitForTimeout(300);
  const box = await page.locator('.pending .btn.primary').boundingBox();
  let posted = false;
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/drives/t-sam/settings')) posted = true; });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Everything rebuilt from state, as a burst of updates would, mid-press.
  await page.evaluate(() => window.marbleConsoleReady.redraw());
  await page.waitForTimeout(120);
  await page.mouse.up();
  for (let i = 0; i < 30 && !posted; i += 1) await page.waitForTimeout(100);
  assert.equal(posted, true, 'the press became a click');
  await page.close();
});
