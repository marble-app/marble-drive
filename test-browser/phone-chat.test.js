// The chat on a phone: the Chat app, and the conversation every page carries
// in its drawer. What a person on an iPhone met before: tapping the composer
// zoomed the page in and left it there, the keyboard came up over the field,
// the bar slid off the top, and Return sent half a sentence. 393 × 852.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChat } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  hello: [{ say: 'Hello **there**.\n\n- one\n- two\n- three\n- four\n- five\n- six' }],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, Chat: await buildChat() } });
test.after(() => host.close());

const PHONE = { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true };
const KB = 336;

/** What a phone browser does when the caret goes under the keyboard: the
 *  visual viewport shrinks, and (on iOS, the worst case) slides down the
 *  layout viewport by `offsetTop`. */
const raiseKeyboard = async (page, kb = KB, offsetTop = KB) => {
  await page.evaluate(({ kb: k, offsetTop: top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - k, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForTimeout(150);
};

const visible = (page) => page.evaluate(() => {
  const vv = window.visualViewport;
  return { top: Math.round(vv.offsetTop), bottom: Math.round(vv.offsetTop + vv.height) };
});

const noSideways = async (page, where) => {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(scroll <= width, `${where}: the page is ${scroll}px wide in a ${width}px window`);
};

/** Whether a tap `dx` px outside the left edge of an element still lands on it. */
const reaches = (locator, dx) => locator.evaluate((el, d) => {
  const r = el.getBoundingClientRect();
  const root = el.getRootNode();
  const hit = (root.elementFromPoint ? root : document).elementFromPoint(r.left - d, r.top + r.height / 2);
  return hit === el || el.contains(hit);
}, dx);

// ------------------------------------------------------------------ Chat app

async function openChat(hash = '') {
  const { page, errors } = await host.newPage(PHONE);
  await page.goto(`${host.base}/a/Chat${hash}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marblePhone));
  return { page, errors };
}

async function chatWithReply() {
  const seed = await openChat('#new');
  await seed.page.locator('.field textarea').fill('script:hello');
  await seed.page.locator('.field .send').tap();
  await seed.page.locator('.reply .md strong').waitFor();
  const id = await seed.page.evaluate(() => location.hash.slice(1));
  await seed.page.close();
  return id;
}

test('Chat: every field is 16px under a finger, every control 44pt, and nothing scrolls sideways', async () => {
  await host.reset();
  const { page, errors } = await openChat();
  const size = (sel) => page.locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(await size('.find input') >= 16, 'the search field would zoom the page in');
  assert.equal(await page.locator('.find input').getAttribute('enterkeyhint'), 'search');
  await noSideways(page, 'the list');

  await page.goto(`${host.base}/a/Chat#new`);
  await page.waitForFunction(() => Math.abs(document.querySelector('.room').getBoundingClientRect().left) < 1);
  assert.ok(await size('.field textarea') >= 16, 'the message field would zoom the page in');
  for (const sel of ['.room .bar .back', '.room .bar .new']) {
    const box = await page.locator(sel).boundingBox();
    assert.ok(Math.round(box.width) >= 44 && Math.round(box.height) >= 44, `${sel} is ${box.width}×${box.height}`);
  }
  assert.ok(await reaches(page.locator('.field .send'), 3), 'a thumb just off the send button misses it');
  await noSideways(page, 'a fresh chat');
  assert.deepEqual(errors, []);
});

test('Chat: with the keyboard up the field stands on it, the bar stays on screen, and the last reply stays in view', async () => {
  await host.reset();
  const id = await chatWithReply();
  const { page, errors } = await openChat(`#${id}`);
  await page.locator('.reply .md strong').waitFor();
  await page.waitForFunction(() => Math.abs(document.querySelector('.room').getBoundingClientRect().left) < 1);
  await page.locator('.field textarea').focus();

  for (const offsetTop of [KB, 0]) {
    await raiseKeyboard(page, KB, offsetTop);
    assert.equal(await page.evaluate(() => document.body.classList.contains('marble-keys')), true, `keys not seen (offsetTop ${offsetTop})`);
    const seen = await visible(page);
    const field = await page.locator('.field').boundingBox();
    const bar = await page.locator('.room .bar').boundingBox();
    assert.ok(field.y + field.height <= seen.bottom + 1, `the field ends at ${field.y + field.height}, under keys from ${seen.bottom}`);
    assert.ok(field.y + field.height >= seen.bottom - 24, `the field ends at ${field.y + field.height}, floating ${seen.bottom - field.y - field.height}px above the keys`);
    assert.ok(bar.y >= seen.top - 1, `the bar starts at ${bar.y}, above the screen's top at ${seen.top}`);
    const foot = await page.evaluate(() => {
      const log = document.querySelector('.log');
      return log.scrollHeight - log.scrollTop - log.clientHeight;
    });
    assert.ok(foot < 4, `the transcript was left ${foot}px short of its foot when the keys came up`);
    await raiseKeyboard(page, 0, 0);
  }
  assert.equal(await page.evaluate(() => document.body.classList.contains('marble-keys')), false);
  const room = await page.locator('.room').boundingBox();
  assert.equal(Math.round(room.height), 852, 'the keys going put the room back');
  assert.deepEqual(errors, []);
});

test('Chat: on a phone Return is a new line and the button sends', async () => {
  await host.reset();
  const { page, errors } = await openChat('#new');
  await page.waitForFunction(() => Math.abs(document.querySelector('.room').getBoundingClientRect().left) < 1);
  const field = page.locator('.field textarea');
  await field.tap();
  await page.keyboard.type('one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  assert.equal(await field.inputValue(), 'one\ntwo');
  assert.equal(await page.locator('.thread .me').count(), 0, 'Return sent the message');
  assert.deepEqual(errors, []);
});

test('Chat: holding a chat in the list brings out Archive, which a hover used to', async () => {
  await host.reset();
  const id = await chatWithReply();
  const { page, errors } = await openChat();
  const row = page.locator(`.row[data-id="${id}"]`);
  await row.waitFor();
  assert.equal(await row.locator('.drop').isVisible(), false, 'Archive is out before anyone asked');
  const box = await row.locator('.pick').boundingBox();
  const at = { x: box.x + box.width / 3, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  await page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100);
  assert.equal(await row.locator('.drop').isVisible(), true, 'a long press did not bring out Archive');
  assert.equal(await page.evaluate(() => document.body.classList.contains('marble-reading')), false, 'the long press also opened the chat');
  const drop = await row.locator('.drop').boundingBox();
  assert.ok(Math.round(drop.width) >= 44 && Math.round(drop.height) >= 44, `Archive is ${drop.width}×${drop.height}`);
  await row.locator('.drop').tap();
  await page.locator('.toast.marble-shown').waitFor();
  assert.equal(await page.locator(`.row[data-id="${id}"]`).count(), 0);
  assert.deepEqual(errors, []);
});

// ------------------------------------------------------------------ the drawer

async function openDrawer(options = PHONE) {
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').tap();
  await drawer.locator('aside.panel[data-open="true"]').waitFor();
  await page.waitForTimeout(450);
  return { page, errors, drawer, view: drawer.locator('marble-conversation') };
}

test('drawer: on a phone it wears the phone chrome, its fields are 16px and its buttons 44pt', async () => {
  await host.reset();
  const { page, errors, drawer, view } = await openDrawer();
  assert.equal(await view.getAttribute('data-chrome'), 'phone');
  const editor = view.locator('.editor');
  assert.ok(await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)) >= 16, 'the composer would zoom the page in');
  for (const sel of ['.new', '.more', '.close']) {
    const box = await drawer.locator(`header.bar ${sel}`).boundingBox();
    assert.ok(Math.round(box.width) >= 44 && Math.round(box.height) >= 44, `${sel} is ${box.width}×${box.height}`);
  }
  const send = await view.locator('.send').boundingBox();
  assert.ok(Math.round(send.width) >= 44 && Math.round(send.height) >= 44, `send is ${send.width}×${send.height}`);
  await noSideways(page, 'the open drawer');

  // The chat switcher hangs under the bar and stays inside the sheet.
  await drawer.locator('header.bar .title').tap();
  const menu = drawer.locator('.menu.recent');
  await menu.waitFor();
  const [m, bar] = [await menu.boundingBox(), await drawer.locator('header.bar').boundingBox()];
  assert.ok(m.y >= bar.y + bar.height, `the menu starts at ${m.y}, over a bar that ends at ${bar.y + bar.height}`);
  assert.ok(m.x >= 0 && m.x + m.width <= 393, 'the menu hangs off the screen');
  assert.deepEqual(errors, []);
});

test('drawer: with the keyboard up the composer stands on it and the bar stays on screen', async () => {
  await host.reset();
  const { page, errors, drawer, view } = await openDrawer();
  await view.locator('.editor').focus();
  for (const offsetTop of [KB, 0]) {
    await raiseKeyboard(page, KB, offsetTop);
    const seen = await visible(page);
    const composer = await view.locator('.composer').boundingBox();
    const bar = await drawer.locator('header.bar').boundingBox();
    const bottom = composer.y + composer.height;
    assert.ok(bottom <= seen.bottom + 1 && bottom >= seen.bottom - 2, `the composer ends at ${bottom}, not on keys at ${seen.bottom} (offsetTop ${offsetTop})`);
    assert.ok(bar.y >= seen.top - 1, `the bar starts at ${bar.y}, above the screen's top at ${seen.top}`);
    await noSideways(page, `the drawer with the keys up (offsetTop ${offsetTop})`);
  }
  await raiseKeyboard(page, 0, 0);
  const panel = await drawer.locator('aside.panel').boundingBox();
  assert.equal(Math.round(panel.height), 852, 'the keys going put the sheet back');
  assert.deepEqual(errors, []);
});

test('drawer: on a phone Return is a new line, and the send button sends', async () => {
  await host.reset();
  const { errors, view } = await openDrawer();
  const editor = view.locator('.editor');
  assert.equal(await editor.evaluate((el) => el.enterKeyHint), 'enter');
  await editor.tap();
  await editor.press('o');
  await editor.press('Enter');
  await editor.press('k');
  assert.equal(await view.evaluate((el) => el.input.value), 'o\nk');
  assert.equal(await view.locator('.msg.me').count(), 0, 'Return sent the message');
  await view.locator('.send').tap();
  await view.locator('.msg.me').first().waitFor();
  assert.deepEqual(errors, []);
});

test('drawer: typing in the page, the corner button steps out of the way', async () => {
  await host.reset();
  const { page, errors } = await host.newPage(PHONE);
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  const launcher = page.locator('marble-agent-drawer .launcher');
  assert.equal(await launcher.isVisible(), true);
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.setAttribute('data-marble-transient', '');
    field.style.cssText = 'position:fixed;top:10px;left:10px;font-size:16px';
    document.body.append(field);
    field.focus();
  });
  await raiseKeyboard(page, KB, 0);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray')).visibility === 'hidden');
  await raiseKeyboard(page, 0, 0);
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray')).visibility === 'visible');
  assert.deepEqual(errors, []);
});

test('drawer: on a touch tablet the composer is 16px too, and send has a thumb\'s reach', async () => {
  await host.reset();
  const { errors, view } = await openDrawer({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });
  assert.equal(await view.getAttribute('data-chrome'), null, 'a tablet is not a phone');
  assert.ok(await view.locator('.editor').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)) >= 16, 'the composer would zoom the page in');
  assert.equal(await view.locator('.editor').evaluate((el) => el.enterKeyHint), 'send', 'a tablet keeps Return to send');
  const reach = await view.locator('.send').evaluate((el) => {
    const after = getComputedStyle(el, '::after');
    const r = el.getBoundingClientRect();
    return r.width - 2 * parseFloat(after.left);
  });
  assert.ok(reach >= 44, `send reaches ${reach}px`);
  assert.deepEqual(errors, []);
});

test('drawer: on a phone the corner button steps aside while the page has a menu or a modal sheet open', async () => {
  await host.reset();
  const { page, errors } = await host.newPage(PHONE);
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(document.querySelector('marble-agent-drawer')?.shadowRoot?.querySelector('.launcher')));
  const tray = () => page.evaluate(() => getComputedStyle(document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray')).visibility);
  await page.evaluate(() => {
    const menu = document.createElement('div');
    menu.popover = 'auto';
    menu.id = 'page-menu';
    menu.setAttribute('data-marble-transient', '');
    menu.textContent = 'A menu';
    document.body.append(menu);
    menu.showPopover();
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray')).visibility === 'hidden');
  await page.evaluate(() => document.getElementById('page-menu').hidePopover());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray')).visibility === 'visible');

  await page.evaluate(() => {
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('data-marble-transient', '');
    sheet.textContent = 'A sheet';
    document.body.append(sheet);
    document.body.click();
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.tray')).visibility === 'hidden');
  assert.equal(await tray(), 'hidden');
  assert.deepEqual(errors, []);
});
