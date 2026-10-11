// The keyboard under an open conversation. A phone browser does not only
// shrink the visual viewport when the keyboard comes up — it slides the visual
// viewport down the layout viewport so the caret is visible. Everything the
// page fixes to the layout viewport then sits that much too high: the composer
// floats above the keyboard and the topbar walks off the top of the screen.
// These tests pin the chrome to the visual viewport instead. 393 × 852.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };
/** A 336pt keyboard, and a browser that has slid the visual viewport all the
 *  way down to keep the caret above it — the worst of the two cases. */
const KB = 336;

const openAgents = async () => {
  await host.reset();
  const { page } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) await window.marble.agent.archive(row.id, true);
    } catch { /* fresh agent */ }
    localStorage.clear();
    localStorage.setItem('marble-agents:view', 'deck');
  });
  return page;
};

const openConversation = async (page) => {
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, { title: 'Rebuild the site', target: 'Marble/site.mrbl', running: true, activity: 'busy' });
  await page.reload();
  await page.locator(`.deck .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  await page.waitForTimeout(400);
  return id;
};

/** What the browser does when the caret goes under the keyboard: the visual
 *  viewport both shrinks and slides. `offsetTop` is how far down the layout
 *  viewport it now starts. */
const raiseKeyboard = async (page, kb = KB, offsetTop = KB) => {
  await page.evaluate(({ kb: k, offsetTop: top }) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { value: window.innerHeight - k, configurable: true });
    Object.defineProperty(vv, 'offsetTop', { value: top, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  }, { kb, offsetTop });
  await page.waitForTimeout(120);
};

/** The strip of the layout viewport the person can actually see. */
const seen = async (page) => page.evaluate(() => {
  const vv = window.visualViewport;
  const convo = document.querySelector('.pane marble-conversation[conversation]');
  const composer = convo?.shadowRoot?.querySelector('.composer')?.getBoundingClientRect();
  const pane = document.querySelector('.pane').getBoundingClientRect();
  const topbar = document.querySelector('.topbar').getBoundingClientRect();
  return {
    top: Math.round(vv.offsetTop),
    bottom: Math.round(vv.offsetTop + vv.height),
    composer: composer ? { top: Math.round(composer.top), bottom: Math.round(composer.bottom) } : null,
    pane: { top: Math.round(pane.top), bottom: Math.round(pane.bottom) },
    topbar: { top: Math.round(topbar.top), bottom: Math.round(topbar.bottom) },
  };
});

test('with the keyboard up in an open conversation, the composer stands on it rather than above it', async () => {
  const page = await openAgents();
  await openConversation(page);
  await raiseKeyboard(page);
  const s = await seen(page);
  assert.ok(s.composer, 'no composer in the open pane');
  assert.ok(s.composer.bottom <= s.bottom + 1, `the composer ends at ${s.composer.bottom}, under a keyboard that starts at ${s.bottom}`);
  assert.ok(s.composer.bottom >= s.bottom - 2, `the composer ends at ${s.composer.bottom}, ${s.bottom - s.composer.bottom}px above the keyboard at ${s.bottom}`);
});

test('with the keyboard up, the conversation header stays on the screen', async () => {
  const page = await openAgents();
  await openConversation(page);
  await raiseKeyboard(page);
  const s = await seen(page);
  assert.ok(s.topbar.top >= s.top - 1, `the topbar starts at ${s.topbar.top}, above the screen's top edge at ${s.top}`);
  assert.ok(s.topbar.bottom <= s.pane.top + 1, `the topbar ends at ${s.topbar.bottom}, over a pane that starts at ${s.pane.top}`);
  assert.ok(s.pane.top >= s.top - 1, `the pane starts at ${s.pane.top}, above the screen's top edge at ${s.top}`);
});

test('a keyboard the browser answers by shrinking alone still leaves the composer on the sill', async () => {
  const page = await openAgents();
  await openConversation(page);
  // Chrome with `interactive-widget=resizes-content`, and any browser that has
  // not had to slide the page: the visual viewport shrinks, nothing moves.
  await raiseKeyboard(page, KB, 0);
  const s = await seen(page);
  assert.ok(s.composer.bottom <= s.bottom + 1 && s.composer.bottom >= s.bottom - 2, `the composer ends at ${s.composer.bottom}, not on a sill at ${s.bottom}`);
  assert.equal(s.topbar.top, 0, 'the topbar left the top of the screen with nothing asking it to');
});

test('the keyboard going away puts everything back', async () => {
  const page = await openAgents();
  await openConversation(page);
  await raiseKeyboard(page);
  await raiseKeyboard(page, 0, 0);
  const s = await seen(page);
  assert.equal(s.topbar.top, 0, 'the topbar did not come back to the top');
  assert.ok(s.composer.bottom >= 852 - 2, `the composer ends at ${s.composer.bottom}, not at the foot of the screen`);
});

test('phone Focus rides down with the visual viewport too, and keeps its pane under the header', async () => {
  const page = await openAgents();
  const ids = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 4; i += 1) out.push(await window.marble.agent.start({ provider: 'fake' }));
    return out;
  });
  for (const [i, id] of ids.entries()) {
    await host.drive.agents.store.updateConversation(id, { title: `Chat ${i}`, target: `Research/${i}.mrbl`, createdAt: 1000 + i });
  }
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 4);
  await page.waitForFunction(() => !document.querySelector('.focus').hasAttribute('data-settling'));
  await raiseKeyboard(page);
  const s = await page.evaluate(() => {
    const vv = window.visualViewport;
    const box = (sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null;
    };
    return {
      top: Math.round(vv.offsetTop),
      bottom: Math.round(vv.offsetTop + vv.height),
      focus: box('.focus'),
      topbar: box('.topbar'),
      pane: box('.pane'),
    };
  });
  assert.ok(s.focus.top >= s.top - 1, `the column starts at ${s.focus.top}, above the screen's top edge at ${s.top}`);
  assert.ok(s.focus.bottom <= s.bottom + 1, `the column ends at ${s.focus.bottom}, under a keyboard that starts at ${s.bottom}`);
  assert.ok(s.focus.top >= s.topbar.bottom - 1, `the column starts at ${s.focus.top}, under a topbar that ends at ${s.topbar.bottom}`);
  assert.ok(s.pane.top >= s.topbar.bottom - 1 && s.pane.bottom <= s.bottom + 1, `the pane runs ${s.pane.top}–${s.pane.bottom}, outside ${s.topbar.bottom}–${s.bottom}`);
});
