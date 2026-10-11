// runtime/phone.js on any page: the viewport it settles, the visible strip it
// publishes, and the keyboard it notices. 393 × 852, touch.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const FORM = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Form</title>
<style>body { font: 14px/1.4 system-ui; margin: 0; } input { font-size: 13px; } .bar { position: fixed; left: 0; right: 0; bottom: var(--kb, 0px); height: 48px; }</style>
</head>
<body data-marble-id="b">
  <p data-marble-id="p">A form.</p>
  <input data-marble-id="i" type="text" aria-label="Name">
  <div class="bar" data-marble-id="bar"></div>
</body></html>
`;

const host = await startDrive({ documents: { garden: GARDEN, form: FORM } });
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };

const open = async (doc, { userAgent = null } = {}) => {
  const { page } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true });
  if (userAgent) await page.addInitScript((ua) => Object.defineProperty(navigator, 'userAgent', { get: () => ua }), userAgent);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marblePhone));
  return page;
};

const raiseKeyboard = async (page, kb = 336, offsetTop = 0) => {
  await page.evaluate(({ kb: k, offsetTop: top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - k - top, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForTimeout(60);
};

test('the viewport reaches the edges and lets the keyboard resize the layout', async () => {
  const page = await open('form');
  const content = await page.evaluate(() => document.querySelector('meta[name="viewport"]').content);
  assert.match(content, /viewport-fit=cover/);
  assert.match(content, /interactive-widget=resizes-content/);
  // Not on Chromium: the cap is only for iOS, where it stops the zoom on
  // focus and still allows a pinch. On Android it would take the pinch away.
  assert.doesNotMatch(content, /maximum-scale/);
  await page.close();
});

test('on iOS the zoom on focus is capped, and a page that chose its own cap keeps it', async () => {
  const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const page = await open('form', { userAgent: ios });
  assert.match(await page.evaluate(() => document.querySelector('meta[name="viewport"]').content), /maximum-scale=1/);
  assert.equal(await page.evaluate(() => window.marblePhone.iOS), true);
  await page.close();
});

test('a page with no viewport of its own is given one', async () => {
  const page = await open('garden');
  const metas = await page.evaluate(() => [...document.querySelectorAll('meta[name="viewport"]')].map((m) => m.content));
  assert.equal(metas.length, 1);
  assert.match(metas[0], /width=device-width/);
  await page.close();
});

test('the visible strip is published, and the keyboard is only up while typing', async () => {
  const page = await open('form');
  const read = () => page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      h: css.getPropertyValue('--vv-h').trim(),
      kb: css.getPropertyValue('--kb').trim(),
      up: document.documentElement.hasAttribute('data-marble-keyboard'),
      bar: Math.round(document.querySelector('.bar').getBoundingClientRect().bottom),
    };
  });
  assert.deepEqual(await read(), { h: '852px', kb: '0px', up: false, bar: 852 });

  // The keys come up over a field: the bar fixed to `bottom: var(--kb)`
  // rides on top of them.
  await page.locator('input[data-marble-id="i"]').focus();
  await raiseKeyboard(page, 336);
  assert.deepEqual(await read(), { h: '516px', kb: '336px', up: true, bar: 516 });

  // The field lets go and the keys go down.
  await page.evaluate(() => document.activeElement.blur());
  await raiseKeyboard(page, 0);
  await page.waitForTimeout(100);
  assert.deepEqual(await read(), { h: '852px', kb: '0px', up: false, bar: 852 });
  await page.close();
});

test('a slid visual viewport is measured from where it now starts', async () => {
  const page = await open('form');
  await page.locator('input[data-marble-id="i"]').focus();
  await raiseKeyboard(page, 336, 120);
  const css = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { top: s.getPropertyValue('--vv-top').trim(), kb: s.getPropertyValue('--kb').trim(), h: s.getPropertyValue('--vv-h').trim() };
  });
  assert.deepEqual(css, { top: '120px', kb: '336px', h: '396px' });
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-marble-keyboard')), true);
  await page.close();
});

test('slid all the way down, the keyboard is still up though --kb is 0', async () => {
  const page = await open('form');
  await page.locator('input[data-marble-id="i"]').focus();
  await page.evaluate(() => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - 336, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: 336, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(60);
  const state = await page.evaluate(() => ({
    kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(),
    up: document.documentElement.hasAttribute('data-marble-keyboard'),
  }));
  assert.deepEqual(state, { kb: '0px', up: true });
  await page.close();
});

test('nothing it adds is saved into the file', async () => {
  const page = await open('form');
  await page.locator('input[data-marble-id="i"]').focus();
  await raiseKeyboard(page, 336);
  await page.waitForTimeout(300);
  // Type something the page files, so the file is written while all of it
  // is on the page.
  await page.evaluate(() => {
    const op = { type: 'setText', id: 'p', text: 'A form, edited.' };
    window.marble.apply?.(op);
    return window.marble.op?.(op);
  });
  let source = '';
  for (let i = 0; i < 50 && !source.includes('edited'); i += 1) {
    await page.waitForTimeout(100);
    source = await host.drive.store.read('form');
  }
  assert.match(source, /A form, edited\./);
  assert.doesNotMatch(source, /marble-phone|data-marble-keyboard|--vv-h|interactive-widget/);
  const transient = await page.evaluate(() => [...document.querySelectorAll('#marble-phone-vars, #marble-phone-base')].every((el) => el.hasAttribute('data-marble-transient')));
  assert.equal(transient, true);
  await page.close();
});
