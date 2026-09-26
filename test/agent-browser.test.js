import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { BROWSER_TOOLS, createBrowserSession, playwrightEntry, toMcpResult } from '../server/agent/browser.js';

test('the shipped tools are exactly the eight names, in this order', () => {
  assert.deepEqual(BROWSER_TOOLS, [
    'browser_tabs',
    'browser_navigate',
    'browser_navigate_back',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_take_screenshot',
    'browser_close',
  ]);
});

/** A node_modules with marble in it and Playwright wherever npm put it. */
function fakeInstall(nested) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'marble-pw-')));
  const marble = path.join(root, 'node_modules', '@bdhmin', 'marble');
  const playwright = nested
    ? path.join(marble, 'node_modules', 'playwright')
    : path.join(root, 'node_modules', 'playwright');
  for (const [dir, name] of [[marble, '@bdhmin/marble'], [playwright, 'playwright']]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, exports: { './package.json': './package.json' } }));
  }
  fs.writeFileSync(path.join(playwright, 'index.mjs'), '');
  return { from: pathToFileURL(path.join(marble, 'package.json')).href, entry: pathToFileURL(path.join(playwright, 'index.mjs')).href };
}

test('Playwright is found where npm hoisted it, as on a sprite', () => {
  const { from, entry } = fakeInstall(false);
  assert.equal(playwrightEntry(from).href, entry);
});

test('Playwright is found inside a linked marble checkout, as on the Mac', () => {
  const { from, entry } = fakeInstall(true);
  assert.equal(playwrightEntry(from).href, entry);
});

/** A Chromium stub the session can launch. Pages record what the agent did. */
function fakeChromium() {
  const launched = [];
  const pages = [];
  const cookies = [];
  const addCookies = async (list) => { cookies.push(...list); };

  const makePage = () => {
    const locators = [];
    const page = {
      url: 'about:blank',
      titleText: '',
      snapshot: '- heading "Hi" [ref=e1]',
      png: Buffer.from('PNG'),
      closed: false,
      went: [],
      backs: 0,
      locators,
      async goto(url) {
        this.went.push(url);
        this.url = url;
        this.titleText = 'Hi';
      },
      async goBack() {
        this.backs += 1;
        this.url = this.went.at(-2) ?? this.url;
      },
      async title() {
        return this.titleText;
      },
      async ariaSnapshot(opts) {
        this.lastSnapshotOpts = opts;
        return this.snapshot;
      },
      locator(selector) {
        const loc = {
          selector,
          clicks: 0,
          fills: [],
          presses: [],
          async click() { loc.clicks += 1; },
          async fill(text) { loc.fills.push(text); },
          async press(key) { loc.presses.push(key); },
        };
        locators.push(loc);
        return loc;
      },
      async screenshot() {
        return this.png;
      },
      async close() {
        this.closed = true;
      },
    };
    pages.push(page);
    return page;
  };

  return {
    launched,
    persistent: [],
    pages,
    cookies,
    async launch(opts) {
      launched.push(opts);
      const context = {
        addCookies,
        async newPage() {
          return makePage();
        },
        async close() {},
      };
      return {
        async newContext(opts) {
          this.contextOpts = opts;
          return context;
        },
        async close() {
          this.closed = true;
        },
        closed: false,
        contextOpts: null,
      };
    },
    async launchPersistentContext(dir, opts) {
      this.persistent.push({ dir, opts });
      const context = {
        addCookies,
        pages: () => pages.filter((p) => !p.closed),
        async newPage() {
          return makePage();
        },
        async close() {},
      };
      await context.newPage();
      return context;
    },
  };
}

test('navigate launches headless Chromium and opens the url', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  const result = await session.call('browser_navigate', { url: 'https://example.com/' });
  assert.equal(result.error, undefined);
  assert.equal(result.url, 'https://example.com/');
  assert.equal(result.title, 'Hi');
  assert.equal(chromium.launched.length, 1);
  assert.equal(chromium.launched[0].headless, true);
  assert.equal(chromium.pages[0].went[0], 'https://example.com/');
  await session.close();
});

test('file, javascript and data urls are refused and Chromium is not launched', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi']) {
    const result = await session.call('browser_navigate', { url });
    assert.match(result.error, /http/i, url);
  }
  assert.equal(chromium.launched.length, 0);
  await session.close();
});

test('http localhost is allowed', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  const result = await session.call('browser_navigate', { url: 'http://127.0.0.1:8765/Agents' });
  assert.equal(result.error, undefined);
  assert.equal(result.url, 'http://127.0.0.1:8765/Agents');
  await session.close();
});

test('closing a tab before the selected one keeps the same page selected', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  await session.call('browser_navigate', { url: 'https://a.example/' });
  await session.call('browser_tabs', { action: 'new' });
  await session.call('browser_navigate', { url: 'https://b.example/' });
  await session.call('browser_tabs', { action: 'new' });
  await session.call('browser_navigate', { url: 'https://c.example/' });
  await session.call('browser_tabs', { action: 'select', index: 1 });
  const after = await session.call('browser_tabs', { action: 'close', index: 0 });
  assert.equal(after.tabs.length, 2);
  assert.equal(after.selected, 0);
  assert.equal(after.tabs[0].url, 'https://b.example/');
  await session.close();
});

test('a profile dir uses launchPersistentContext and adopts the blank tab', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium, userDataDir: '/tmp/marble-profile' });
  const result = await session.call('browser_navigate', { url: 'https://example.com/' });
  assert.equal(result.error, undefined);
  assert.equal(chromium.persistent.length, 1);
  assert.equal(chromium.persistent[0].dir, '/tmp/marble-profile');
  assert.equal(chromium.persistent[0].opts.headless, true);
  assert.deepEqual(chromium.persistent[0].opts.viewport, { width: 1280, height: 720 });
  assert.equal(chromium.launched.length, 0);
  assert.equal(chromium.pages.length, 1, 'the blank persistent tab is the one we navigated, not a second page');
  const listed = await session.call('browser_tabs', { action: 'list' });
  assert.equal(listed.tabs.length, 1);
  assert.equal(listed.tabs[0].url, 'https://example.com/');
  await session.close();
});

test('a drive pass signs the browser in to its own host, by either loopback name, and nowhere else', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({
    chromium,
    userDataDir: '/tmp/marble-profile',
    pass: { origin: 'http://127.0.0.1:4400', cookie: 'marble_drive=123.sig' },
  });
  await session.call('browser_navigate', { url: 'http://127.0.0.1:4400/Research/Vision.mrbl' });
  const planted = chromium.cookies.map(({ name, value, domain, path: at, httpOnly }) => ({ name, value, domain, path: at, httpOnly }));
  assert.deepEqual(planted, [
    { name: 'marble_drive', value: '123.sig', domain: '127.0.0.1', path: '/', httpOnly: true },
    { name: 'marble_drive', value: '123.sig', domain: 'localhost', path: '/', httpOnly: true },
  ]);
  // A relaunch is a new context, and gets the pass again.
  await session.call('browser_close', {});
  await session.call('browser_navigate', { url: 'http://localhost:4400/' });
  assert.equal(chromium.cookies.length, 4);
  await session.close();
});

test('a browser without a pass has no cookies', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium, userDataDir: '/tmp/marble-profile' });
  await session.call('browser_navigate', { url: 'http://127.0.0.1:4400/' });
  assert.deepEqual(chromium.cookies, []);
  await session.close();
});

test('tabs list, new, select and close', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  await session.call('browser_navigate', { url: 'https://a.example/' });
  await session.call('browser_tabs', { action: 'new' });
  await session.call('browser_navigate', { url: 'https://b.example/' });
  const listed = await session.call('browser_tabs', { action: 'list' });
  assert.equal(listed.tabs.length, 2);
  assert.equal(listed.selected, 1);
  assert.equal(listed.tabs[0].url, 'https://a.example/');
  assert.equal(listed.tabs[1].url, 'https://b.example/');

  const selected = await session.call('browser_tabs', { action: 'select', index: 0 });
  assert.equal(selected.selected, 0);

  const closed = await session.call('browser_tabs', { action: 'close', index: 1 });
  assert.equal(closed.tabs.length, 1);
  assert.equal(chromium.pages[1].closed, true);
  await session.close();
});

test('snapshot uses Playwright\'s AI aria snapshot, click and type use aria-ref', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  await session.call('browser_navigate', { url: 'https://example.com/' });
  const snap = await session.call('browser_snapshot', {});
  assert.equal(snap.snapshot, '- heading "Hi" [ref=e1]');
  assert.deepEqual(chromium.pages[0].lastSnapshotOpts, { mode: 'ai' });

  await session.call('browser_click', { ref: 'e1' });
  assert.equal(chromium.pages[0].locators[0].selector, 'aria-ref=e1');
  assert.equal(chromium.pages[0].locators[0].clicks, 1);

  await session.call('browser_type', { ref: 'e2', text: 'hello', submit: true });
  const typed = chromium.pages[0].locators[1];
  assert.equal(typed.selector, 'aria-ref=e2');
  assert.deepEqual(typed.fills, ['hello']);
  assert.deepEqual(typed.presses, ['Enter']);
  await session.close();
});

test('screenshot returns a png buffer as image', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  await session.call('browser_navigate', { url: 'https://example.com/' });
  const shot = await session.call('browser_take_screenshot', {});
  assert.equal(shot.error, undefined);
  assert.ok(Buffer.isBuffer(shot.image));
  assert.equal(shot.image.toString(), 'PNG');
  await session.close();
});

test('a Playwright throw becomes an error payload, and the session stays up', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  await session.call('browser_navigate', { url: 'https://example.com/' });
  chromium.pages[0].locator = () => ({
    async click() { throw new Error('No element found'); },
  });
  const result = await session.call('browser_click', { ref: 'missing' });
  assert.match(result.error, /No element found/);
  const listed = await session.call('browser_tabs', { action: 'list' });
  assert.equal(listed.tabs.length, 1);
  await session.close();
});

test('close then navigate relaunches', async () => {
  const chromium = fakeChromium();
  const session = createBrowserSession({ chromium });
  await session.call('browser_navigate', { url: 'https://a.example/' });
  await session.call('browser_close', {});
  assert.equal((await session.call('browser_tabs', { action: 'list' })).tabs.length, 0);
  await session.call('browser_navigate', { url: 'https://b.example/' });
  assert.equal(chromium.launched.length, 2);
  assert.equal((await session.call('browser_tabs', { action: 'list' })).tabs.length, 1);
  await session.close();
});

test('an unknown tool is an error', async () => {
  const session = createBrowserSession({ chromium: fakeChromium() });
  const result = await session.call('browser_evaluate', { expression: '1' });
  assert.match(result.error, /no tool/);
  await session.close();
});

test('MCP results are JSON text, errors are flagged, and a screenshot is an image block', () => {
  const ok = toMcpResult({ url: 'https://example.com/' });
  assert.equal(ok.isError, false);
  assert.deepEqual(JSON.parse(ok.content[0].text), { url: 'https://example.com/' });

  const bad = toMcpResult({ error: 'only http(s) URLs are allowed' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /http/);

  const shot = toMcpResult({ url: 'https://example.com/', image: Buffer.from('PNG') });
  assert.equal(shot.isError, false);
  assert.deepEqual(JSON.parse(shot.content[0].text), { url: 'https://example.com/' });
  assert.equal(shot.content[1].type, 'image');
  assert.equal(shot.content[1].mimeType, 'image/png');
  assert.equal(shot.content[1].data, Buffer.from('PNG').toString('base64'));
});
