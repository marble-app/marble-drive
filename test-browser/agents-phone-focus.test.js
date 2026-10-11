// Focus on a phone, after the polish pass (spec §4, D1–D10): the pile at each
// end rather than ruled paper, a track that says where in the stack you are,
// a Full slot with something in it, the card as the pane's header, the
// keyboard demoting from below, the leading rule on every tier, and something
// to read when nothing is pinned. 393 × 852, touch.

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

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const PHONE = { width: 393, height: 852 };

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: PHONE, hasTouch: true, isMobile: true, ...options });
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
    localStorage.clear();
  });
  return { page, errors };
};

const seedTwelve = async (page) => {
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const out = [];
    for (let i = 0; i < 12; i += 1) out.push(await agent.start({ provider: 'fake' }));
    return out;
  });
  for (const [i, id] of ids.entries()) {
    await host.drive.agents.store.updateConversation(id, { title: `Chat ${i}`, target: `Research/${i}.mrbl`, activity: 'reading the draft', createdAt: 1000 + i });
  }
  return ids;
};

const openPhoneFocus = async (page) => {
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 12);
  await page.waitForFunction(() => !document.querySelector('.focus').hasAttribute('data-settling'));
};

/** Every card, in the order the column puts them in. */
const column = (page) => page.evaluate(() => [...document.querySelectorAll('.focus-card')]
  .map((c) => ({ id: c.dataset.id, lod: c.dataset.lod, top: parseFloat(c.style.top), height: parseFloat(c.style.height) }))
  .sort((a, b) => a.top - b.top));

/** The stack's own scalar, walked to by tapping: only a chip or a digest is
 *  on the screen to tap, so the focal steps at most two cards at a time. */
const focalTo = async (page, index) => {
  for (let n = 0; n < 24; n += 1) {
    const cards = await column(page);
    const at = cards.findIndex((c) => c.lod === 'full');
    if (at === index) return;
    const want = at < index ? Math.min(index, at + 2) : Math.max(index, at - 2);
    const box = await page.locator(`.focus-card[data-id="${cards[want].id}"]`).boundingBox();
    await page.mouse.click(200, box.y + Math.min(20, box.height / 2));
    await page.waitForFunction(() => !document.querySelector('.focus').hasAttribute('data-settling'));
  }
  throw new Error(`the focal never reached ${index}`);
};

/** Hold the card below the Full and carry it up until the pane has faded. */
const dragOffTheFull = async (page) => {
  const cards = await column(page);
  const at = cards.findIndex((c) => c.lod === 'full');
  const box = await page.locator(`.focus-card[data-id="${cards[at + 1].id}"]`).boundingBox();
  await page.mouse.move(200, box.y + 20);
  await page.mouse.down();
  for (let n = 1; n <= 14; n += 1) {
    await page.mouse.move(200, box.y + 20 - n * 20);
    const faded = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.pane')).opacity) < 0.3);
    if (faded && n >= 3) return;
  }
};

// ---------------------------------------------------------------- D1, the pile

test('phone Focus: a run of slivers is one pile per end, the cards under it are hidden, and a run deeper than three says how deep', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  // Focal 5 of 12 leaves a run at each end: three above, four below.
  await focalTo(page, 5);
  assert.equal(await page.locator('.focus-pile').count(), 2);
  const sides = await page.evaluate(() => [...document.querySelectorAll('.focus-pile')].map((p) => p.dataset.side).sort());
  assert.deepEqual(sides, ['bottom', 'top']);
  // The slivers keep their boxes — the layout is still the fisheye's — and go
  // invisible; the pile is what you see.
  const slivers = await page.evaluate(() => [...document.querySelectorAll('.focus-card[data-lod="sliver"]')]
    .map((c) => [getComputedStyle(c).visibility, parseFloat(c.style.height)]));
  assert.ok(slivers.length >= 6, `only ${slivers.length} slivers`);
  assert.ok(slivers.every(([v]) => v === 'hidden'), JSON.stringify(slivers));
  assert.ok(slivers.every(([, h]) => h > 0), JSON.stringify(slivers));
  // Three steps at most, each inset 4px more than the last.
  const steps = await page.evaluate(() => [...document.querySelectorAll('.focus-pile')]
    .map((p) => [...p.querySelectorAll('.focus-pile-step')].map((s) => parseFloat(s.style.left))));
  assert.ok(steps.every((run) => run.length > 0 && run.length <= 3), JSON.stringify(steps));
  assert.ok(steps.every((run) => run.every((left, i) => left === i * 4)), JSON.stringify(steps));
  // The deeper run counts itself; the three-deep one does not need to.
  const counts = await page.evaluate(() => [...document.querySelectorAll('.focus-pile')]
    .map((p) => [p.dataset.side, p.querySelector('.focus-pile-count')?.textContent ?? null]));
  const shown = counts.filter(([, text]) => text);
  assert.ok(shown.length >= 1, JSON.stringify(counts));
  for (const [, text] of shown) assert.match(text, /^\+\d+$/);
  assert.ok(shown.some(([, text]) => Number(text.slice(1)) > 3), JSON.stringify(counts));
});

// ------------------------------------------------ D2, position and affordance

test('phone Focus: the track says where in the stack you are, shows under the hand and goes after the stack lands', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  const visible = () => page.evaluate(() => {
    const track = document.querySelector('.focus-track');
    if (!track) return null;
    const style = getComputedStyle(track);
    return { opacity: Number(style.opacity), visibility: style.visibility };
  });
  // At rest it is not on the screen at all.
  assert.deepEqual(await visible(), { opacity: 0, visibility: 'hidden' });
  const thumbTop = () => page.evaluate(() => parseFloat(document.querySelector('.focus-thumb').style.top));
  await focalTo(page, 1);
  const near = await thumbTop();
  await focalTo(page, 10);
  const far = await thumbTop();
  assert.ok(far > near + 100, `thumb ${near} → ${far}`);
  // `focal / (n − 1)` of the travel: card 10 of 12 is most of the way down.
  const travel = await page.evaluate(() => {
    const track = document.querySelector('.focus-track');
    return track.clientHeight - parseFloat(document.querySelector('.focus-thumb').style.height);
  });
  assert.ok(Math.abs(far / travel - 10 / 11) < 0.05, `thumb at ${far}/${travel}`);
  // Under the hand: on the way down, before anything has moved.
  const card = page.locator('.focus-card[data-lod="digest"]').last();
  const box = await card.boundingBox();
  await page.mouse.move(200, box.y + 20);
  await page.mouse.down();
  const down = await visible();
  assert.equal(down.visibility, 'visible');
  for (let y = box.y + 20; y > box.y - 140; y -= 20) await page.mouse.move(200, y);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.focus').hasAttribute('data-settling'));
  await page.waitForTimeout(1000);
  assert.equal((await visible()).visibility, 'hidden');
});

test('phone Focus: chips and digests carry a chevron, and the hint is said once', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  const chevrons = await page.evaluate(() => [...document.querySelectorAll('.focus-card')]
    .filter((c) => c.dataset.lod === 'chip' || c.dataset.lod === 'digest')
    .map((c) => getComputedStyle(c.querySelector('.focus-card-head'), '::after').maskImage));
  assert.ok(chevrons.length >= 2, `${chevrons.length} middle tiers`);
  assert.ok(chevrons.every((m) => m && m !== 'none'), JSON.stringify(chevrons));
  const hint = page.locator('.focus-hint');
  await hint.waitFor();
  assert.match(await hint.textContent(), /Drag the stack/);
  // A hand answers the question the hint asks, and it is not asked again.
  const card = page.locator('.focus-card[data-lod="digest"]').last();
  const box = await card.boundingBox();
  await page.mouse.move(200, box.y + 20);
  await page.mouse.down();
  for (let y = box.y + 20; y > box.y - 120; y -= 20) await page.mouse.move(200, y);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.focus').hasAttribute('data-settling'));
  assert.equal(await page.evaluate(() => localStorage.getItem('marble-agents:phone-focus-hint')), 'seen');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.focus[data-phone] .focus-card').length === 12);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.focus-hint').count(), 0);
});

// --------------------------------------------------- D3, the Full has content

test('phone Focus: the Full slot is the digest at Full size, so a drag never uncovers a blank card', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  await focalTo(page, 5);
  await dragOffTheFull(page);
  // Mid-drag the pane is gone and what is under it has to read.
  const mid = await page.evaluate(() => {
    const pane = document.querySelector('.pane');
    const full = document.querySelector('.focus-card[data-lod="full"]');
    const body = full.querySelector('.focus-card-body');
    return {
      paneOpacity: Number(getComputedStyle(pane).opacity),
      text: body.textContent.trim(),
      display: getComputedStyle(body).display,
      opacity: Number(getComputedStyle(body).opacity),
      title: getComputedStyle(full.querySelector('.focus-card-title')).fontSize,
      height: body.getBoundingClientRect().height,
    };
  });
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.focus').hasAttribute('data-settling'));
  assert.ok(mid.paneOpacity < 0.5, `pane at ${mid.paneOpacity}`);
  assert.notEqual(mid.display, 'none');
  assert.equal(mid.opacity, 1);
  assert.ok(mid.height > 20, `body is ${mid.height}px`);
  assert.ok(mid.text.length > 0, `body says "${mid.text}"`);
  assert.match(mid.text, /Research/);
  assert.equal(mid.title, '20px');
});

// ------------------------------------------------- D4, the card is the header

test('phone Focus: no dock bar over the stack; the pane starts below the Full card head', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  const bar = page.locator('.pane > .dock-bar');
  assert.equal(await bar.isVisible(), false);
  const full = await page.locator('.focus-card[data-lod="full"]').boundingBox();
  const head = await page.locator('.focus-card[data-lod="full"] .focus-card-head').boundingBox();
  const pane = await page.locator('.pane').boundingBox();
  assert.ok(pane.y - full.y >= 40, `pane ${pane.y} vs full ${full.y}`);
  // The head is above the pane, whole, so the name never leaves the screen.
  assert.ok(head.y + head.height <= pane.y + 1, `head ends ${head.y + head.height}, pane starts ${pane.y}`);
  assert.ok(head.height >= 44, `head is ${head.height}`);
  const title = await page.locator('.focus-card[data-lod="full"] .focus-card-title').textContent();
  assert.match(title, /Chat \d+/);
});

// ------------------------------------------- D6, the keyboard demotes below first

test('phone Focus: with the keyboard up the cards below the Full give their height first', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  await focalTo(page, 5);
  const neighbours = async () => {
    const cards = await column(page);
    const at = cards.findIndex((c) => c.lod === 'full');
    return { above: cards[at - 1], below: cards[at + 1], full: cards[at], cards };
  };
  const before = await neighbours();
  // Without a keyboard the fisheye is symmetric: a digest either side.
  assert.equal(Math.round(before.above.height), Math.round(before.below.height));
  // The keyboard is the strip of the layout viewport the visual viewport stops
  // covering; `syncViewport` turns that into `--kb` and re-lays the column.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { value: 516, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--kb') === '336px');
  await page.waitForTimeout(80);
  const after = await neighbours();
  assert.ok(after.below.height < after.above.height - 1, `below ${after.below.height} vs above ${after.above.height}`);
  // The composer keeps its transcript: the Full never drops under a digest.
  assert.ok(after.full.height >= 112, `full is ${after.full.height}`);
  // And the stack still ends inside the room.
  const last = after.cards[after.cards.length - 1];
  assert.ok(last.top + last.height <= 516 - 44 + 1, `column ends at ${last.top + last.height}`);
});

// ------------------------------------ D7/D8, one surface and the leading rule

test('phone Focus: every tier wears the folder rule and no digest is cut in half by a hairline', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  const rules = await page.evaluate(() => [...document.querySelectorAll('.focus-card')]
    .map((c) => [c.dataset.lod, parseFloat(getComputedStyle(c).borderLeftWidth)]));
  const tiers = new Set(rules.map(([lod]) => lod));
  assert.ok(tiers.has('full') && tiers.has('digest') && tiers.has('chip') && tiers.has('sliver'), [...tiers].join(','));
  assert.deepEqual(rules.filter(([, w]) => !(w >= 3)), []);
  const heads = await page.evaluate(() => [...document.querySelectorAll('.focus-card .focus-card-head')]
    .map((h) => parseFloat(getComputedStyle(h).borderBottomWidth)));
  assert.deepEqual(heads.filter((w) => w > 0), []);
});

// ------------------------------------------------------- D9, the safe area

test('phone Focus: the column stops at the safe area, not under the home indicator', async () => {
  const { page } = await openAgents();
  await seedTwelve(page);
  await openPhoneFocus(page);
  const room = await page.evaluate(() => {
    const el = document.querySelector('.focus');
    el.style.paddingBottom = '34px';
    document.querySelector('.focus-card[data-lod="full"]').click();
    return { client: el.clientHeight };
  });
  // Re-lay the column with the inset in place and read where it ends.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { value: window.innerHeight, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(80);
  const cards = await column(page);
  const last = cards[cards.length - 1];
  assert.ok(last.top + last.height <= room.client - 34 + 1, `column ends at ${last.top + last.height} in ${room.client} less 34`);
});

// --------------------------------------------------------- D10, nothing pinned

test('phone Focus with nothing in it says so, and offers the way out', async () => {
  const { page } = await openAgents();
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'focus'));
  await page.reload();
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'focus');
  const empty = page.locator('.focus-phone-empty');
  await empty.waitFor();
  assert.match(await empty.textContent(), /Nothing pinned/);
  const start = empty.locator('button');
  assert.match(await start.textContent(), /New conversation/);
  assert.ok((await start.boundingBox()).height >= 44);
  await start.click();
  await page.locator('.sheet[data-kind="new"] .sheet-prompt').waitFor();
  assert.equal(await page.locator('.sheet[data-kind="new"]').isVisible(), true);
});
