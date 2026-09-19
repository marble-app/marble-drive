// Deck on a phone, after the polish pass: two-line rows, one dot vocabulary,
// headers that stay put, an ask card that says the command once, a swipe that
// answers, and one empty state instead of four. 393 × 852, touch.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const SCRIPTS = {
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
};

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true, ...options });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      // A turn left waiting on an ask keeps that ask open for every test
      // after it, and an open ask is a card on the rail. Cancelling the turn
      // voids it.
      const { asks } = await window.marble.agent.asks();
      for (const open of asks) await window.marble.agent.cancel(open.turn);
    } catch { /* nothing waiting */ }
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    localStorage.clear();
  });
  await page.waitForFunction(async () => (await window.marble.agent.asks()).asks.length === 0);
  return { page, errors };
};

/** Deck is the phone's default view, and a reload is how the seeded rows get
 *  drawn by the page rather than by the test. */
const openDeck = async (page) => {
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'deck'));
  await page.reload();
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'deck');
};

const start = async (page, patch) => {
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await host.drive.agents.store.updateConversation(id, patch);
  return id;
};

const ask = async (page) => page.evaluate(async () => {
  const agent = window.marble.agent;
  const id = await agent.start({ provider: 'fake' });
  await agent.send(id, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
  return id;
});

test('a phone row is two lines in 64px: dot, title, age, and one line under it', async () => {
  const { page } = await openAgents();
  const id = await start(page, { title: 'CHI related work', target: 'Research/CHI2027.mrbl', running: true, activity: 'reading Hollan 1985' });
  await openDeck(page);
  const row = page.locator(`.deck .conv[data-id="${id}"]`);
  await row.waitFor();
  const box = await row.boundingBox();
  assert.ok(box.height <= 64, `row is ${box.height}px`);
  assert.ok(box.height >= 56, `row is ${box.height}px`);
  assert.equal((await row.locator('.title').textContent()).trim(), 'CHI related work');
  assert.equal((await row.locator('.line2').textContent()).trim(), 'reading Hollan 1985');
  assert.ok(await row.locator('.age').textContent());
  // Two lines, and only two: the target line, the tags and the meta line are
  // the desk's way of saying the same things.
  const lines = await page.evaluate((id) => {
    const el = document.querySelector(`.conv[data-id="${id}"]`);
    return [...el.querySelectorAll('.title, .target, .line2, .tags, .meta')]
      .filter((n) => getComputedStyle(n).display !== 'none' && n.textContent.trim())
      .map((n) => n.className);
  }, id);
  assert.deepEqual(lines, ['title', 'line2']);
  // The provider tag is in the header and the actions sheet, not on the row.
  assert.equal(await page.evaluate((id) => {
    const tag = document.querySelector(`.conv[data-id="${id}"] .tag[data-kind="agent"]`);
    return tag ? getComputedStyle(tag.closest('.tags')).display : 'none';
  }, id), 'none');
});

test('a row on the desk keeps its three lines and writes no second line', async () => {
  const { page } = await openAgents({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  const id = await start(page, { title: 'CHI related work', target: 'Research/CHI2027.mrbl', running: true, activity: 'reading Hollan 1985' });
  await page.reload();
  const row = page.locator(`.conv[data-id="${id}"]`);
  await row.waitFor();
  assert.equal(await row.locator('.line2').textContent(), '');
  assert.equal((await row.locator('.target').textContent()).trim(), 'Research/CHI2027');
  assert.ok(await row.locator('.meta').isVisible());
});

test('one dot vocabulary: running breathes in the accent, review is ink, failed is danger, idle is a ring', async () => {
  const { page } = await openAgents();
  const running = await start(page, { title: 'Running', running: true, activity: 'busy' });
  const review = await start(page, { title: 'Review', lastOutcome: 'changes', lastFinishedAt: Date.now(), activity: 'done' });
  const failed = await start(page, { title: 'Failed', lastOutcome: 'failed', lastFinishedAt: Date.now(), activity: 'boom' });
  const idle = await start(page, { title: 'Idle', lastOutcome: null });
  await openDeck(page);
  await page.locator(`.deck .conv[data-id="${running}"]`).waitFor();
  const states = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [
    id, document.querySelector(`.conv[data-id="${id}"] .dot`)?.dataset.state ?? null,
  ])), [running, review, failed, idle]);
  assert.equal(states[running], 'running');
  assert.equal(states[review], 'review');
  assert.equal(states[failed], 'failed');
  assert.equal(states[idle], 'idle');
  // The running dot is drawn in the accent and it moves.
  const look = await page.evaluate((id) => {
    const dot = document.querySelector(`.conv[data-id="${id}"] .dot`);
    const cs = getComputedStyle(dot);
    return { name: cs.animationName, seconds: cs.animationDuration, background: cs.backgroundColor };
  }, running);
  assert.equal(look.name, 'dot-breath');
  assert.equal(look.seconds, '2s');
  assert.equal(look.background, 'rgb(155, 182, 207)');
  // The idle dot is a hairline ring, not a filled disc.
  const ring = await page.evaluate((id) => {
    const cs = getComputedStyle(document.querySelector(`.conv[data-id="${id}"] .dot`));
    return { width: cs.borderTopWidth, background: cs.backgroundColor };
  }, idle);
  assert.equal(ring.width, '1px');
  assert.equal(ring.background, 'rgba(0, 0, 0, 0)');
});

test('a band head stays at the top of the Deck while its rows scroll under it, and counts in a pill', async () => {
  const { page } = await openAgents();
  for (let i = 0; i < 16; i += 1) {
    await start(page, { title: `Review ${i}`, lastOutcome: 'changes', lastFinishedAt: Date.now() - i * 1000, activity: 'done' });
  }
  await openDeck(page);
  await page.waitForFunction(() => document.querySelectorAll('[data-band="review"] .conv').length === 16);
  const head = page.locator('[data-band="review"] .band-head');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-band="review"] .band-head')).position), 'sticky');
  const before = await head.boundingBox();
  const deck = await page.locator('.deck').boundingBox();
  await page.evaluate(() => document.querySelector('.deck').scrollTo(0, 200));
  await page.waitForFunction(() => document.querySelector('.deck').scrollTop > 100);
  const after = await head.boundingBox();
  assert.ok(after.y > before.y - 1, 'the head did not scroll away with its rows');
  assert.ok(Math.abs(after.y - deck.y) < 2, `head at ${after.y}, deck at ${deck.y}`);
  const pill = await page.evaluate(() => {
    const el = document.querySelector('[data-band="review"] .band-count');
    const box = el.getBoundingClientRect();
    return { text: el.textContent, w: Math.round(box.width), h: Math.round(box.height), r: getComputedStyle(el).borderTopLeftRadius };
  });
  assert.equal(pill.text, '16');
  assert.equal(pill.h, 22);
  assert.ok(pill.w >= 22, `pill is ${pill.w} wide`);
  assert.equal(pill.r, '999px');
});

test('collapsing a band folds it rather than cutting it, and the chevron turns', async () => {
  const { page } = await openAgents();
  await start(page, { title: 'Running', running: true, activity: 'busy' });
  await openDeck(page);
  await page.locator('[data-band="running"] .conv').first().waitFor();
  const rows = () => page.evaluate(() => getComputedStyle(document.querySelector('[data-band="running"]')).gridTemplateRows);
  assert.match(await rows(), /^[\d.]+px [\d.]+px$/);
  await page.locator('[data-band="running"] .band-toggle').click();
  await page.waitForFunction(() => document.querySelector('[data-band="running"]').hasAttribute('data-collapsed'));
  await page.waitForTimeout(360);
  assert.match(await rows(), /^[\d.]+px 0px$/);
  // Folded, not cut: the body is still in the tree, with no height and
  // nothing showing through it.
  assert.equal(await page.evaluate(() => {
    const body = document.querySelector('[data-band="running"] .band-body');
    return [Math.round(body.getBoundingClientRect().height), getComputedStyle(body).overflowY];
  }).then((v) => v.join(' ')), '0 hidden');
  // And out of reach: a folded row is not tabbable and not clickable.
  assert.equal(await page.locator('[data-band="running"] .conv').first().isVisible(), false);
});

test('the ask card says the command once, opens the conversation from its head, and asks why only after Deny', async () => {
  const { page } = await openAgents();
  const id = await ask(page);
  await openDeck(page);
  const card = page.locator('.deck-ask');
  await card.waitFor();
  // Once, in the ask's own detail box — not again in the peek above it.
  assert.equal((await card.textContent()).split('rm -rf build').length - 1, 1);
  assert.equal(await card.locator('pre').count(), 1);
  assert.equal(await card.locator('.deck-ask-open').count(), 0);
  // No lead line that is only the request read back.
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.deck-peek .peek-lead')].some((n) => /^prompt:/i.test(n.textContent.trim()))), false);
  // Allow and Deny share the row, at the size of a thumb.
  const allow = await card.locator('button.allow').boundingBox();
  const deny = await card.locator('button.deny').boundingBox();
  assert.ok(allow.height >= 48, `allow is ${allow.height}`);
  assert.ok(deny.height >= 48, `deny is ${deny.height}`);
  assert.ok(Math.abs(allow.width - deny.width) <= 1, `${allow.width} vs ${deny.width}`);
  assert.equal(Math.round(allow.y), Math.round(deny.y));
  // Why not? waits to be asked for.
  assert.equal(await card.locator('.deck-ask-why .deny-note').isVisible(), false);
  await card.locator('button.deny').click();
  await card.locator('.deck-ask-why .deny-note').waitFor({ state: 'visible' });
  assert.equal((await card.locator('button.deny').textContent()).trim(), 'Send');
  const note = await card.locator('.deck-ask-why .deny-note').boundingBox();
  const cardBox = await card.boundingBox();
  assert.ok(note.y > deny.y, 'the reason field is under the row, not in it');
  assert.ok(note.width > cardBox.width * 0.8, `the field is ${note.width} of ${cardBox.width}`);
  // The head is the way in.
  await card.locator('.deck-ask-head').click();
  await page.waitForFunction(() => document.body.hasAttribute('data-open'));
  assert.equal(await page.evaluate(() => localStorage.getItem('marble-agents:open')), id);
});

test('two asks page sideways under two dots, and the dot follows the rail', async () => {
  const { page } = await openAgents();
  await ask(page);
  await ask(page);
  await openDeck(page);
  await page.waitForFunction(() => document.querySelectorAll('.deck-ask').length === 2);
  const dots = page.locator('.deck-ask-dots i');
  await page.waitForFunction(() => document.querySelectorAll('.deck-ask-dots i').length === 2);
  assert.equal(await dots.count(), 2);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.deck-ask-dots i')].findIndex((n) => n.hasAttribute('data-on'))), 0);
  await page.evaluate(() => {
    const rail = document.querySelector('.asks-rail');
    rail.scrollTo({ left: rail.scrollWidth, behavior: 'auto' });
  });
  await page.waitForFunction(() => document.querySelectorAll('.deck-ask-dots i')[1]?.hasAttribute('data-on'));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.deck-ask-dots i')].findIndex((n) => n.hasAttribute('data-on'))), 1);
});

test('one ask needs no dots', async () => {
  const { page } = await openAgents();
  await ask(page);
  await openDeck(page);
  await page.locator('.deck-ask').waitFor();
  assert.equal(await page.locator('.deck-ask-dots').isVisible(), false);
});

test('a review row swiped right collapses and comes back in Idle', async () => {
  const { page } = await openAgents();
  const id = await start(page, { title: 'Figure 3 redraw', lastOutcome: 'changes', lastFinishedAt: Date.now(), activity: 'exported' });
  await openDeck(page);
  const row = page.locator(`[data-band="review"] .conv[data-id="${id}"]`);
  await row.waitFor();
  // The collapse is 260ms of spring; watch for it rather than sampling for it.
  await page.evaluate((id) => {
    const el = document.querySelector(`.conv[data-id="${id}"]`);
    window.__collapsed = false;
    new MutationObserver(() => {
      if (el.hasAttribute('data-collapsing')) window.__collapsed = true;
    }).observe(el, { attributes: true, attributeFilter: ['data-collapsing'] });
  }, id);
  const box = await row.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  for (let x = 40; x < 200; x += 20) await page.mouse.move(box.x + x, y);
  // Held past the threshold: the row has answered before the finger lifts.
  assert.equal(await page.evaluate((id) => document.querySelector(`.conv[data-id="${id}"]`).hasAttribute('data-commit'), id), true);
  const mark = await page.evaluate((id) => {
    const el = document.querySelector(`.conv[data-id="${id}"] .swipe-mark`);
    const inner = el.querySelector('.swipe-mark-in');
    return {
      word: inner.textContent.trim(),
      svg: inner.querySelectorAll('svg').length,
      scale: getComputedStyle(inner).transform,
      background: getComputedStyle(el).backgroundColor,
    };
  }, id);
  assert.equal(mark.word, 'Reviewed');
  assert.equal(mark.svg, 1);
  assert.equal(mark.scale, 'matrix(1, 0, 0, 1, 0, 0)');
  assert.equal(mark.background, 'rgb(241, 245, 248)');
  await page.mouse.up();
  await page.locator(`[data-band="idle"] .conv[data-id="${id}"]`).waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => window.__collapsed), true);
  // And it opens again where it landed, with nothing of the collapse left on it.
  await page.waitForFunction((id) => !document.querySelector(`.conv[data-id="${id}"]`).hasAttribute('data-collapsing'), id);
  assert.equal(await page.evaluate((id) => document.querySelector(`.conv[data-id="${id}"]`).style.height, id), '');
  assert.equal(await page.evaluate((id) => document.querySelector(`.conv[data-id="${id}"]`).hasAttribute('data-swipe'), id), false);
});

test('reduced motion: the dot is still, the fold is a cut, and the row still leaves', async () => {
  const { page } = await openAgents({ reducedMotion: 'reduce' });
  const running = await start(page, { title: 'Running', running: true, activity: 'busy' });
  const review = await start(page, { title: 'Review', lastOutcome: 'changes', lastFinishedAt: Date.now(), activity: 'done' });
  await openDeck(page);
  await page.locator(`.deck .conv[data-id="${running}"]`).waitFor();
  assert.equal(await page.evaluate((id) => getComputedStyle(document.querySelector(`.conv[data-id="${id}"] .dot`)).animationName, running), 'none');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-band="running"]')).transitionProperty), 'none');
  const row = page.locator(`[data-band="review"] .conv[data-id="${review}"]`);
  const box = await row.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  for (let x = 40; x < 200; x += 20) await page.mouse.move(box.x + x, y);
  await page.mouse.up();
  await page.locator(`[data-band="idle"] .conv[data-id="${review}"]`).waitFor({ state: 'attached' });
  assert.equal(await page.evaluate((id) => document.querySelector(`.conv[data-id="${id}"]`).style.height, review), '');
});

test('an empty Deck says so once, and no band says "Nothing here"', async () => {
  const { page } = await openAgents();
  await openDeck(page);
  await page.locator('.deck-empty').waitFor({ state: 'visible' });
  assert.match(await page.locator('.deck-empty').textContent(), /Nothing is running/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.deck .band:not([data-empty])').length), 0);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.deck .band')].some((b) => b.getBoundingClientRect().height > 0)), false);
  assert.equal((await page.locator('.deck').textContent()).includes('Nothing here'), false);
  // One row is enough to bring its band back and put the sentence away.
  const id = await start(page, { title: 'Running', running: true, activity: 'busy' });
  await openDeck(page);
  await page.locator(`.deck .conv[data-id="${id}"]`).waitFor({ state: 'visible' });
  assert.equal(await page.locator('.deck-empty').isVisible(), false);
  assert.equal(await page.evaluate(() => document.querySelector('[data-band="review"]').hasAttribute('data-empty')), true);
});
