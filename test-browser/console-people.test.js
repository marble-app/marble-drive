// The Console's people on the PC in a browser, against a fake door and a fake
// marble-host (test/fixtures/console-pc.js): the People group draws its rows,
// dots and header line as the plan's figure does, beside the testers on Fly; a
// person's pane has their sign-up, study, health and release, with no Open
// drive and the updater's reason in words; an invite shows its link once;
// a restart is a job on the drive; and Activity's People list says the
// door's log in words.

import assert from 'node:assert/strict';
import test from 'node:test';

import { consoleWorld } from './console-world.js';

const world = await consoleWorld({ pc: true });
test.after(async () => {
  await world.host.close();
  await world.pc.close();
});

const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());
// What a person reads: a label and its value apart, as the page lays them out.
const words = (page, sel) => page.innerText(sel).then((t) => t.replace(/\s+/g, ' ').trim());
const state = (page, name) => page.getAttribute(`.row[data-name="${name}"] .dot`, 'data-state');

test('the People group: the PC’s drives beside the testers, with the figure’s dots, rows and line', async () => {
  const { page, errors } = await world.open();
  await page.waitForSelector('.row[data-name="pc:ana"]');
  assert.deepEqual(await page.$$eval('.group', (els) => els.map((e) => e.textContent)), ['Yours1', 'People11']);
  assert.equal(await text(page, '.group-line'), '4 drives on the PC · 1 working now · 1 invite not opened');
  // Filled while working, the caution ring when stalled, an empty ring for an
  // invite nobody has opened.
  assert.equal(await state(page, 'pc:ana'), 'awake');
  assert.equal(await state(page, 'pc:cho'), 'warn');
  assert.equal(await state(page, 'pc:invite:inv-dee'), 'asleep');
  assert.equal(await state(page, 'pc:ben'), 'asleep');
  // Drive, agent, last active, today.
  assert.equal(await text(page, '.row[data-name="pc:ana"] .row-title'), 'anaClaude');
  assert.equal(await text(page, '.row[data-name="pc:ana"] .row-age'), 'working');
  assert.equal(await text(page, '.row[data-name="pc:ana"] .row-meta'), '12 turns today');
  assert.equal(await text(page, '.row[data-name="pc:ben"] .row-title .who'), 'ChatGPT');
  assert.equal(await text(page, '.row[data-name="pc:ben"] .row-meta'), '3 turns today');
  assert.equal(await text(page, '.row[data-name="pc:cho"] .row-title .who'), 'None yet');
  assert.equal(await text(page, '.row[data-name="pc:cho"] .row-meta'), 'Drive ready, no agent');
  assert.equal(await text(page, '.row[data-name="pc:invite:inv-dee"] .row-title'), 'DeeJoining');
  assert.equal(await text(page, '.row[data-name="pc:invite:inv-dee"] .row-meta'), 'Link not opened');
  assert.equal(await text(page, '.row[data-name="pc:invite:inv-gus"] .row-meta'), 'Signed in, consent not answered');
  assert.equal(await page.$('.row[data-name="pc:eve"]'), null, 'a drive on Fly is the fleet’s');
  assert.ok(await page.$('.row[data-name="t-sam"]'), 'the testers stay');
  assert.equal(await text(page, '.cx-primary .btn.primary'), 'Invite someone', 'the view’s one action');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a person’s pane: sign-up, study, health and release, never an Open drive', async () => {
  const { page, errors } = await world.open();
  await page.click('.row[data-name="pc:ana"]');
  await page.waitForSelector('.detail .d-name:text("ana")');
  const pane = await words(page, '.detail');
  assert.equal(await page.$('.detail a.btn'), null, 'no Open drive');
  assert.match(await text(page, '.detail .d-sub'), /^Ana · in the study · 12 turns today$/);
  assert.deepEqual(await page.$$eval('.detail .sec > h3', (els) => els.map((e) => e.firstChild.textContent)), ['Sign-up', 'Study', 'Health', 'Release', 'Remove']);
  assert.match(pane, /Invited.*Signed in.*Agreed to the study.*Named the drive.*Drive ready.*Agent connected.*First document/);
  assert.match(pane, /4 hours from invite to first document/);
  assert.match(pane, /Form 2026-11-irb-v1/);
  assert.match(pane, /Prompts 41/);
  assert.match(pane, /Memory 412 MB/);
  assert.match(pane, /Restarts 2/);
  assert.match(pane, /Last backup 20m ago/);
  assert.match(pane, /Held back 1 page/);
  assert.match(pane, /because they changed it: Start here\./);
  // The updater's routes, unavailable, and why in words.
  assert.equal(await page.locator('.detail button:text("Move to canary")').isDisabled(), true);
  assert.equal(await page.locator('.detail button:text("Roll back")').isDisabled(), true);
  assert.match(pane, /Both are unavailable: the updater isn't built yet\./);
  assert.equal(await page.locator('.detail button:text("Withdraw")').isDisabled(), true);
  assert.match(pane, /Withdraw is unavailable: the door can't take someone out of the study yet\./);
  assert.equal(await page.locator('.detail button:text("Export study data")').isDisabled(), false);
  // Not in the study: no Export, no Study section.
  await page.click('.row[data-name="pc:ben"]');
  await page.waitForSelector('.detail .d-name:text("ben")');
  assert.equal(await page.$('.detail button:text("Export study data")'), null);
  assert.match(await words(page, '.detail'), /The last backup failed 15m ago: R2 could not be reached\. The last good one was 3h ago\./);
  // An invite nobody has opened: only how far it got.
  await page.click('.row[data-name="pc:invite:inv-dee"]');
  await page.waitForSelector('.detail .d-name:text("Dee")');
  assert.deepEqual(await page.$$eval('.detail .sec > h3', (els) => els.map((e) => e.firstChild.textContent)), ['Sign-up', 'Study']);
  assert.match(await words(page, '.detail'), /The link works until \w{3} \d{1,2}, for one person\./);
  assert.deepEqual(errors, []);
  await page.close();
});

test('an invite asks for a name and the study, then shows its link once, with Copy', async () => {
  const { page, errors } = await world.open();
  await page.click('.cx-primary .btn.primary');
  const make = page.locator('.pop:popover-open .btn.primary');
  assert.equal(await make.isDisabled(), true, 'nothing to make without a name');
  await page.fill('.pop:popover-open input', 'Ivy');
  await page.click('.pop:popover-open .seg button:text("In the study")');
  assert.match(await text(page, '.pop:popover-open'), /answer the consent form/);
  await make.click();
  await page.waitForSelector('.pop:popover-open h4:text("A link for Ivy")');
  const { code } = world.pc.door.state.invites.at(-1);
  assert.equal(await text(page, '.pop:popover-open .code span'), `https://marbledrive.app/join/${code}`);
  assert.deepEqual(world.pc.door.calls.find((c) => c.url === '/_door/invite').body, { note: 'Ivy', uses: 1, days: 14, study: true });
  // A click beside it doesn't lose it; Done does.
  await page.mouse.click(30, 400);
  assert.ok(await page.$('.pop:popover-open .code'), 'still shown');
  await page.click('.pop:popover-open button:text("Done")');
  assert.equal(await page.$('.pop:popover-open'), null);
  await page.click('.seg [data-view="activity"]');
  await page.waitForSelector('.cx-view[data-view="activity"] .row .row-title:text("Invite Ivy into the study")');
  await page.click('.cx-view[data-view="activity"] .row:has-text("Invite Ivy into the study")');
  await page.waitForFunction(() => /It was shown once/.test(document.querySelector('.log')?.textContent ?? ''));
  assert.ok(!(await page.content()).includes(code), 'the code is on no page but the one that made it');
  assert.deepEqual(errors, []);
  await page.close();
});

test('Restart is a job on the drive, and Activity’s People list says the door’s log', async () => {
  const { page, errors } = await world.open();
  await page.click('.row[data-name="pc:ben"]');
  await page.click('.detail button:text("Restart")');
  for (let i = 0; i < 50 && !world.pc.host.calls.some((c) => c.method === 'POST' && c.url === '/drives/ben/restart'); i += 1) await page.waitForTimeout(100);
  assert.ok(world.pc.host.calls.some((c) => c.method === 'POST' && c.url === '/drives/ben/restart'), 'marble-host was asked');
  await page.click('.seg [data-view="activity"]');
  await page.waitForSelector('.cx-view[data-view="activity"] .row-title:text("Restart ben")');
  await page.click('.cx-view[data-view="activity"] .pane-head .seg button:text("People")');
  await page.waitForSelector('.cx-view[data-view="activity"] .well[data-people]');
  const said = await page.$$eval('.cx-view[data-view="activity"] .row .row-title', (els) => els.map((e) => e.textContent));
  assert.deepEqual(said.slice(0, 7), [
    'ana made their first document',
    'ana signed in',
    'ben connected ChatGPT',
    'ana moved to a new release',
    'Dee was invited to the study',
    'cho signed in for the first time',
    'ana agreed to take part in the study',
  ]);
  // A line opens its person in Drives.
  await page.click('.cx-view[data-view="activity"] .row:has-text("ben connected ChatGPT")');
  await page.waitForSelector('.cx-view[data-view="drives"] .detail .d-name:text("ben")');
  assert.deepEqual(errors, []);
  await page.close();
});

test('on a phone a person’s pane slides in, and nothing runs off the side', async () => {
  const { page, errors } = await world.open({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await page.tap('.row[data-name="pc:ana"]');
  await page.waitForFunction(() => document.querySelector('.cx-view[data-view="drives"] .well').hasAttribute('data-open'));
  await page.waitForTimeout(700);
  const wide = await page.evaluate(() => {
    const pane = document.querySelector('.cx-view[data-view="drives"] .pane.detail');
    return [...pane.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).map((el) => el.className);
  });
  assert.deepEqual(wide, [], 'nothing in the open pane is wider than the phone');
  assert.deepEqual(errors, []);
  await page.close();
});

test('screenshots, when asked for', { skip: !process.env.SHOTS }, async () => {
  for (const colorScheme of ['light', 'dark']) {
    const desk = await world.open({ colorScheme });
    await desk.page.click('.row[data-name="pc:ana"]');
    await desk.page.waitForTimeout(600);
    await desk.page.screenshot({ path: `${process.env.SHOTS}/people-desk-${colorScheme}.png` });
    await desk.page.click('.row[data-name="pc:cho"]');
    await desk.page.waitForTimeout(500);
    await desk.page.screenshot({ path: `${process.env.SHOTS}/people-desk-stalled-${colorScheme}.png` });
    await desk.page.click('.cx-primary .btn.primary');
    await desk.page.fill('.pop:popover-open input', 'Kai');
    await desk.page.click('.pop:popover-open .seg button:text("In the study")');
    await desk.page.waitForTimeout(300);
    await desk.page.screenshot({ path: `${process.env.SHOTS}/people-invite-${colorScheme}.png` });
    await desk.page.click('.pop:popover-open .btn.primary');
    await desk.page.waitForSelector('.pop:popover-open .code');
    await desk.page.waitForTimeout(300);
    await desk.page.screenshot({ path: `${process.env.SHOTS}/people-link-${colorScheme}.png` });
    await desk.page.click('.pop:popover-open button:text("Done")');
    await desk.page.click('.seg [data-view="activity"]');
    await desk.page.click('.cx-view[data-view="activity"] .pane-head .seg button:text("People")');
    await desk.page.waitForTimeout(500);
    await desk.page.screenshot({ path: `${process.env.SHOTS}/people-activity-${colorScheme}.png` });
    await desk.page.click('.cx-view[data-view="activity"] .pane-head .seg button:text("The console")');
    await desk.page.close();

    const phone = await world.open({ width: 390, height: 844, hasTouch: true, isMobile: true, colorScheme });
    await phone.page.waitForTimeout(400);
    await phone.page.screenshot({ path: `${process.env.SHOTS}/people-phone-list-${colorScheme}.png` });
    await phone.page.tap('.row[data-name="pc:ana"]');
    await phone.page.waitForTimeout(800);
    await phone.page.screenshot({ path: `${process.env.SHOTS}/people-phone-${colorScheme}.png` });
    await phone.page.evaluate(() => { document.querySelector('.cx-view[data-view="drives"] .pane.detail .pane-scroll').scrollTop = 10_000; });
    await phone.page.waitForTimeout(300);
    await phone.page.screenshot({ path: `${process.env.SHOTS}/people-phone-end-${colorScheme}.png` });
    await phone.page.close();
  }
});
