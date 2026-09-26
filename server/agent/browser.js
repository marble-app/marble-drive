// A headless Chromium one agent turn can drive.
//
// The document tools live on the host (`tools.js`) because they share the
// store, the ledger and the op queue. A browser does not: it is a child the
// CLI starts from mcp.json, it holds no turn token, and it dies when the
// turn's process dies. This file is that child — Playwright is the one
// `@bdhmin/marble` depends on, so there is one Chromium build to install.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const BROWSER_TOOLS = [
  'browser_tabs',
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_take_screenshot',
  'browser_close',
];

export const BROWSER_SCHEMAS = [
  {
    name: 'browser_tabs',
    description: 'List, open, close or select tabs in the agent\'s isolated browser.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'new', 'close', 'select'] },
        index: { type: 'number', description: 'Tab index for close or select.' },
      },
    },
  },
  {
    name: 'browser_navigate',
    description: 'Open an http(s) URL in the current tab. file:, javascript: and data: are refused.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string' } },
    },
  },
  {
    name: 'browser_navigate_back',
    description: 'Go back in the current tab.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_snapshot',
    description: 'Accessibility tree of the current tab, with [ref=eN] markers for click and type.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_click',
    description: 'Click the element with this snapshot ref.',
    inputSchema: {
      type: 'object',
      required: ['ref'],
      properties: { ref: { type: 'string' } },
    },
  },
  {
    name: 'browser_type',
    description: 'Type into the element with this snapshot ref. submit presses Enter afterwards.',
    inputSchema: {
      type: 'object',
      required: ['ref', 'text'],
      properties: {
        ref: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
      },
    },
  },
  {
    name: 'browser_take_screenshot',
    description: 'Screenshot of the current tab.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_close',
    description: 'Close the browser. The next navigate relaunches it.',
    inputSchema: { type: 'object', properties: {} },
  },
];

export function toMcpResult(payload) {
  const isError = Boolean(payload?.error);
  if (payload?.image) {
    const { image, ...rest } = payload;
    return {
      content: [
        { type: 'text', text: JSON.stringify(rest, null, 2) },
        {
          type: 'image',
          data: Buffer.isBuffer(image) ? image.toString('base64') : String(image),
          mimeType: 'image/png',
        },
      ],
      isError,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(payload ?? {}, null, 2) }],
    isError,
  };
}

const INSTALL = 'npx playwright install chromium';

/** Playwright's ESM entry, found the way marble itself would find it: inside
 *  marble's own node_modules when marble is a linked checkout (the Mac), or
 *  hoisted beside it when npm installed marble from the registry (a sprite). */
export function playwrightEntry(from = import.meta.resolve('@bdhmin/marble/package.json')) {
  return new URL('index.mjs', pathToFileURL(createRequire(from).resolve('playwright/package.json')));
}

export async function loadChromium() {
  try {
    const { chromium } = await import(playwrightEntry().href);
    return chromium;
  } catch (err) {
    throw new Error(`Playwright is not available (${err.message}). Run \`${INSTALL}\`.`);
  }
}

function httpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw ?? ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

async function info(page) {
  return { url: typeof page.url === 'function' ? page.url() : page.url, title: await page.title() };
}

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost'];

/** The cookies a drive pass plants: its own host's, under both names a page on
 *  it is reached by when that host is loopback. Never any other site's. */
export function passCookies(pass) {
  if (!pass?.origin || !pass?.cookie) return [];
  const at = pass.cookie.indexOf('=');
  if (at < 1) return [];
  const { hostname } = new URL(pass.origin);
  const hosts = LOOPBACK_NAMES.includes(hostname) ? LOOPBACK_NAMES : [hostname];
  return hosts.map((domain) => ({
    name: pass.cookie.slice(0, at),
    value: pass.cookie.slice(at + 1),
    domain,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }));
}

export function createBrowserSession({ chromium, userDataDir, pass } = {}) {
  let browser = null;
  let context = null;
  const tabs = [];
  let selected = 0;

  const current = () => {
    if (!tabs.length) throw new Error('no open tab — navigate or open one first');
    return tabs[selected];
  };

  const list = async () => ({
    tabs: await Promise.all(tabs.map(async (page, index) => ({ index, ...(await info(page)) }))),
    selected: tabs.length ? selected : null,
  });

  async function ensureContext() {
    if (context) return;
    const engine = chromium ?? await loadChromium();
    const viewport = { width: 1280, height: 720 };
    try {
      if (userDataDir && typeof engine.launchPersistentContext === 'function') {
        context = await engine.launchPersistentContext(userDataDir, { headless: true, viewport });
        const persistent = context;
        browser = { close: () => persistent.close() };
        for (const page of persistent.pages?.() ?? []) tabs.push(page);
        selected = 0;
      } else {
        browser = await engine.launch({ headless: true });
        context = await browser.newContext({ viewport });
      }
    } catch (err) {
      throw new Error(`${err.message}. If Chromium is missing, run \`${INSTALL}\`.`);
    }
    const cookies = passCookies(pass);
    if (cookies.length) await context.addCookies(cookies);
  }

  async function openTab() {
    await ensureContext();
    const page = await context.newPage();
    tabs.push(page);
    selected = tabs.length - 1;
    return page;
  }

  async function reset() {
    const closing = browser;
    browser = null;
    context = null;
    tabs.length = 0;
    selected = 0;
    if (closing) await closing.close().catch(() => {});
  }

  const handlers = {
    async browser_tabs(input) {
      const action = String(input.action ?? 'list');
      if (action === 'list') return list();
      if (action === 'new') {
        await openTab();
        return list();
      }
      if (action === 'select') {
        const index = Number(input.index);
        if (!Number.isInteger(index) || index < 0 || index >= tabs.length) {
          throw new Error(`no tab ${input.index}`);
        }
        selected = index;
        return list();
      }
      if (action === 'close') {
        const index = input.index == null ? selected : Number(input.index);
        if (!Number.isInteger(index) || index < 0 || index >= tabs.length) {
          throw new Error(`no tab ${input.index}`);
        }
        const [page] = tabs.splice(index, 1);
        await page.close();
        if (index < selected) selected -= 1;
        if (selected >= tabs.length) selected = Math.max(0, tabs.length - 1);
        return list();
      }
      throw new Error(`unknown tabs action "${action}"`);
    },

    async browser_navigate(input) {
      const url = httpUrl(input.url);
      if (!url) throw new Error('only http(s) URLs are allowed');
      await ensureContext();
      const page = tabs.length ? current() : await openTab();
      await page.goto(url);
      return info(page);
    },

    async browser_navigate_back() {
      const page = current();
      await page.goBack();
      return info(page);
    },

    async browser_snapshot() {
      const page = current();
      return { snapshot: await page.ariaSnapshot({ mode: 'ai' }) };
    },

    async browser_click(input) {
      await current().locator(`aria-ref=${input.ref}`).click();
      return { ok: true };
    },

    async browser_type(input) {
      const loc = current().locator(`aria-ref=${input.ref}`);
      await loc.fill(String(input.text ?? ''));
      if (input.submit) await loc.press('Enter');
      return { ok: true };
    },

    async browser_take_screenshot() {
      const page = current();
      const image = await page.screenshot();
      return { ...(await info(page)), image };
    },

    async browser_close() {
      await reset();
      return { ok: true };
    },
  };

  async function call(name, input = {}) {
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
    if (!handler) return { error: `no tool "${name}"` };
    try {
      return await handler(input);
    } catch (err) {
      return { error: err.message };
    }
  }

  return { schemas: BROWSER_SCHEMAS, call, close: reset };
}
