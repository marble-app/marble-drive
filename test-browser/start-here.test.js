// Start here, as a new person meets it: / opens it, each of its four rows
// ticks itself when it is done (the first, an agent that works, at once on a
// drive that has one), and the ticks are in the file, so they come back on
// reload and / goes back to the Drive once all four are done. A drive with no
// agent keeps the first row open, and Make it waits and says why.

import assert from 'node:assert/strict';
import test from 'node:test';

import { seedAgents, seedBoard, seedChat, seedDesignDonts, seedDesignSystem, seedDrive, seedStartHere } from '../server/seed.js';
import { startDrive } from './harness.js';

const host = await startDrive({ documents: {} });
const { store } = host.drive;
await seedStartHere(store);
await seedDrive(store);
await seedAgents(store);
await seedChat(store);
await seedBoard(store);
await seedDesignSystem(store);
await seedDesignDonts(store);
const pristine = await store.read('start-here');

const pages = [];
test.after(async () => {
  for (const page of pages) await page.context().close().catch(() => {});
  await host.close();
});

async function open(options = {}) {
  const opened = await host.newPage(options);
  pages.push(opened.page);
  return opened;
}

const done = (page, step) => page.locator(`[data-step="${step}"]`).getAttribute('data-done');
const fileSays = async (step) => new RegExp(`data-step="${step}"[^>]*data-done="yes"|data-done="yes"[^>]*data-step="${step}"`).test(await store.read('start-here'));
const ready = (page) => page.waitForFunction(() => Boolean(window.marble?.id && document.querySelector('[data-marble-id="sh-steps"]')));

test('/ opens Start here, and the Drive is one press away', async () => {
  const { page, errors } = await open();
  await page.goto(`${host.base}/`);
  await page.waitForURL(/\/a\/start-here$/);
  await page.locator('h1', { hasText: 'Start here' }).waitFor();
  assert.equal(await page.locator('[data-step]').count(), 4);
  // Opens as a page to use: not in Describe.
  await ready(page);
  assert.equal(await page.evaluate(() => Boolean(document.querySelector('.marble-marks-layer[data-describing]'))), false);
  // The Drive, from here: the visit comes from a page of the drive.
  await page.evaluate(() => { location.href = '/'; });
  await page.waitForURL(/\/a\/drive$/);
  // The Drive's live previews are sandboxed frames, and say so; that is the Drive's.
  assert.deepEqual(errors.filter((e) => !/favicon|404|Blocked script execution/.test(e)), []);
});

test('the rows tick themselves, and the ticks are in the file', async () => {
  await host.drive.putDocument('start-here', pristine, { label: 'reset', event: 'changed' });
  const { page } = await open();
  await page.goto(`${host.base}/a/start-here`);
  await ready(page);
  for (const step of ['write', 'ask', 'keep']) assert.equal(await done(page, step), null, `${step} starts open`);

  // 1: this drive's agent works already, so its row ticks at once, in the
  // file, and has nothing left to press.
  await page.waitForFunction(() => document.querySelector('[data-step="connect"]').getAttribute('data-done') === 'yes');
  await page.waitForFunction(async () => /data-step="connect"[^>]*data-done="yes"/.test(await (await fetch('/a/start-here', { cache: 'no-store' })).text()));
  assert.equal(await page.locator('[data-marble-id="sh-connect-go"]').isVisible(), false);
  assert.equal(await page.locator('.needs').count(), 0, 'Make it has nothing to wait for');

  // 2: typing in the box.
  await page.locator('[data-marble-id="sh-box"]').click();
  await page.keyboard.type('Trying this out between classes');
  await page.waitForFunction(() => document.querySelector('[data-step="write"]').getAttribute('data-done') === 'yes');
  await page.waitForFunction(async () => /data-step="write"[^>]*data-done="yes"/.test(await (await fetch('/a/start-here', { cache: 'no-store' })).text()));
  assert.equal(await fileSays('write'), true);
  assert.equal(await done(page, 'ask'), null, 'typing is not asking Claude');

  // A chip starts the answer; the person's own words are never replaced.
  await page.locator('.chip', { hasText: 'A class' }).click();
  assert.equal(await page.locator('[data-marble-id="sh-answer"]').textContent(), 'A class: ');
  await page.keyboard.type('COGS 120, the design lab');
  await page.locator('.chip', { hasText: 'A trip' }).click();
  assert.equal(await page.locator('[data-marble-id="sh-answer"]').textContent(), 'A class: COGS 120, the design lab');
  assert.equal(await done(page, 'ask'), null, 'choosing is not asking Claude');

  // 3: an agent's op landing on the list, the way "put these three in a row" would.
  const before = await store.read('start-here');
  await host.drive.writeOps('start-here', [{ type: 'setAttr', id: 'sh-steps', name: 'style', value: 'display: grid; grid-template-columns: repeat(3, 1fr)' }], { client: 'agent-test' });
  await page.waitForFunction(() => document.querySelector('[data-step="ask"]').getAttribute('data-done') === 'yes');
  await page.waitForFunction(async () => /data-step="ask"[^>]*data-done="yes"/.test(await (await fetch('/a/start-here', { cache: 'no-store' })).text()));
  assert.notEqual(before, await store.read('start-here'));

  // Not done yet: / still opens Start here.
  const still = await fetch(`${host.base}/`, { redirect: 'manual' });
  assert.equal(still.headers.get('location'), '/a/start-here');

  // 4: the agent Make it starts ticks its row when the document exists.
  await host.drive.writeOps('start-here', [{ type: 'setAttr', id: 'sh-keep', name: 'data-done', value: 'yes' }], { client: 'agent-test' });
  await page.waitForFunction(() => document.querySelector('[data-step="keep"]').getAttribute('data-done') === 'yes');

  // A reload, or a new tab, finds all four ticked.
  const { page: again } = await open();
  await again.goto(`${host.base}/a/start-here`);
  await ready(again);
  for (const step of ['connect', 'write', 'ask', 'keep']) assert.equal(await done(again, step), 'yes', `${step} stays ticked`);
  assert.equal(await again.locator('[data-marble-id="sh-box"]').textContent(), 'Trying this out between classes');

  // And / is the Drive again.
  const after = await fetch(`${host.base}/`, { redirect: 'manual' });
  assert.equal(after.headers.get('location'), '/a/drive');
});

test('Make it with nothing to make from puts the caret in the answer instead', async () => {
  await host.drive.putDocument('start-here', pristine, { label: 'reset', event: 'changed' });
  const { page } = await open();
  await page.goto(`${host.base}/a/start-here`);
  await ready(page);
  await page.waitForFunction(() => Boolean(window.marbleRun));
  const chats = async () => (await (await fetch(`${host.base}/agent/conversations`)).json()).length;
  const count = await chats();
  await page.locator('[data-marble-id="sh-make"]').click();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-marble-id')), 'sh-answer');
  // A chip alone is a start, not an answer.
  await page.locator('.chip', { hasText: 'A trip' }).click();
  await page.locator('[data-marble-id="sh-make"]').click();
  await page.waitForTimeout(300);
  assert.equal(await chats(), count, 'no agent started');

  // With an answer, it starts one, aimed at the row.
  await page.keyboard.type('Lisbon in March');
  await page.locator('[data-marble-id="sh-make"]').click();
  await page.waitForFunction(() => window.marbleRun.running().has('sh-keep') || document.querySelector('[data-marble-id="sh-make"]').getAttribute('aria-busy') === 'true');
  await (async () => { for (let i = 0; i < 50 && (await chats()) === count; i++) await new Promise((r) => setTimeout(r, 100)); })();
  assert.equal(await chats(), count + 1);
  // The page's own goings-on (a chip, typing, the press, the agent starting)
  // are not Claude changing it.
  await page.waitForTimeout(500);
  assert.equal(await done(page, 'ask'), null);
  assert.equal(await done(page, 'write'), null);
});

test('the page holds up at phone and desk widths, in both schemes', async () => {
  await host.drive.putDocument('start-here', pristine, { label: 'reset', event: 'changed' });
  for (const colorScheme of ['light', 'dark']) {
    for (const [name, viewport, touch] of [['desk', { width: 1280, height: 860 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      const { page, errors } = await open({ viewport, colorScheme, hasTouch: touch, isMobile: touch });
      await page.goto(`${host.base}/a/start-here`);
      await ready(page);
      await page.waitForTimeout(300);
      // Nothing runs off the side.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${name} ${colorScheme}: ${overflow}px wider than the window`);
      // Make it sits on the right of the answer at a desk, under it on a phone.
      const answer = await page.locator('[data-marble-id="sh-answer"]').boundingBox();
      const make = await page.locator('[data-marble-id="sh-make"]').boundingBox();
      if (name === 'desk') assert.ok(make.x > answer.x + answer.width - 1, 'beside');
      else assert.ok(make.y >= answer.y + answer.height - 1, 'under');
      // A thumb can press the controls.
      if (touch) {
        const tall = await page.evaluate(() => [...document.querySelectorAll('[data-marble-id="sh-make"], .chip')].map((el) => parseFloat(getComputedStyle(el).minHeight)));
        const coarse = await page.evaluate(() => [matchMedia("(pointer: coarse)").matches, matchMedia("(hover: none)").matches, navigator.maxTouchPoints]);
        assert.ok(tall.every((h) => h >= 44), `controls ${tall.join(", ")}px tall; ${coarse}`);
      }
      // The page is drawn in the scheme it was asked for.
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.equal(bg, colorScheme === 'dark' ? 'rgb(28, 31, 34)' : 'rgb(255, 255, 255)');
      assert.deepEqual(errors.filter((e) => !/favicon|404/.test(e)), [], `${name} ${colorScheme}`);
      // Last: a full-page shot resizes the window under the page.
      if (process.env.START_HERE_SHOTS) await page.screenshot({ path: `${process.env.START_HERE_SHOTS}/start-here-${name}-${colorScheme}.png`, fullPage: true });
    }
  }
});

// A drive where nothing can run yet: the connect sheet opens over Start here,
// the first row stays open, its Connect opens the sheet again, and Make it
// waits and says why under it until an agent works.
test('with no agent that works, the first row waits, Connect opens the sheet, and Make it says why', async () => {
  let signedIn = false;
  const bare = await startDrive({
    documents: {},
    providers: ['claude-subscription'],
    signedOut: ['fake'],
    detect: { 'claude-subscription': async () => ({ installed: true, signedIn, detail: signedIn ? 'signed in (claude.ai)' : 'run `claude` once to sign in' }) },
  });
  try {
    await seedStartHere(bare.drive.store);
    const opened = await bare.newPage();
    const { page, errors } = opened;
    await page.goto(`${bare.base}/a/start-here`);
    await ready(page);
    // The sheet opens over the page, as it does on any first visit.
    await page.waitForFunction(() => document.querySelector('marble-agent-setup')?.shadowRoot.querySelector('dialog')?.open);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('marble-agent-setup').shadowRoot.querySelector('dialog').open);

    assert.equal(await done(page, 'connect'), null);
    const why = page.locator('.needs');
    await why.waitFor();
    assert.equal(await why.textContent(), 'Make it runs on your Claude or ChatGPT. Connect one above first.');
    assert.equal(await page.locator('[data-marble-id="sh-make"]').getAttribute('aria-disabled'), 'true');
    assert.equal(await page.locator('.needs').getAttribute('data-marble-transient'), '', 'drawn, never written');

    // Make it, with an answer, starts nothing.
    const chats = async () => (await (await fetch(`${bare.base}/agent/conversations`)).json()).length;
    const count = await chats();
    await page.locator('[data-marble-id="sh-answer"]').click();
    await page.keyboard.type('A trip: Lisbon in March');
    // aria-disabled, not disabled: a press still lands, and says why.
    await page.locator('[data-marble-id="sh-make"]').click({ force: true });
    await page.waitForTimeout(300);
    assert.equal(await chats(), count, 'no agent started');
    assert.equal(await why.count(), 1, 'the reason stays, once');

    // Connect opens the sheet, on its choice.
    await page.locator('[data-marble-id="sh-connect-go"]').click();
    await page.waitForFunction(() => document.querySelector('marble-agent-setup')?.shadowRoot.querySelector('dialog')?.open);
    assert.equal(await page.locator('marble-agent-setup h2').textContent(), 'Connect an agent');
    await page.keyboard.press('Escape');

    // An agent that works: the sheet says it saved something, and the row ticks.
    signedIn = true;
    await fetch(`${bare.base}/agent/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: bare.base }, body: JSON.stringify({ keys: { cursor: '' } }) });
    await page.evaluate(() => dispatchEvent(new CustomEvent('marble:agent-settings-saved')));
    await page.waitForFunction(() => document.querySelector('[data-step="connect"]').getAttribute('data-done') === 'yes');
    await why.waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-marble-id="sh-make"]').getAttribute('aria-disabled'), null);
    await page.waitForFunction(async () => /data-step="connect"[^>]*data-done="yes"/.test(await (await fetch('/a/start-here', { cache: 'no-store' })).text()));
    assert.deepEqual(errors.filter((e) => !/favicon|404/.test(e)), []);
  } finally {
    await bare.close();
  }
});
