/** The idle cut: the slider that hides chats nobody has touched in a while.
 *
 *  Its own file rather than an appendix to agents-page.test.js on purpose —
 *  that file is rewritten wholesale by other conversations and a test appended
 *  to its tail has been silently dropped before. The helpers below are
 *  duplicated from it for the same reason.
 */
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

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleAgentIdle));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) {
        await window.marble.agent.archive(row.id, true);
      }
    } catch { /* fresh agent */ }
  });
  return { page, errors };
};

const openFilters = async (page) => {
  if (await page.locator('.filterbox[data-open]').count() === 0) await page.locator('.filter-toggle').click();
  await page.locator('.filter-pop').waitFor({ state: 'visible' });
};

/** The store stamps `updatedAt` on every write, so a chat can only be made old
 *  underneath it — by editing the meta the listing reads. A turn that has just
 *  stopped running still has one write left in it (the runner records how it
 *  ended after the summary says idle), so this writes and then checks that the
 *  write is still there rather than trusting the first one. */
const backdate = async (id, minutes) => {
  const file = path.join(host.drive.store.marbleDir, 'agents', id, 'meta.json');
  const at = Date.now() - minutes * 60_000;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const meta = JSON.parse(await fsp.readFile(file, 'utf8'));
    await fsp.writeFile(file, `${JSON.stringify({ ...meta, createdAt: at, updatedAt: at, lastInteractedAt: at, lastFinishedAt: at }, null, 2)}\n`);
    await new Promise((done) => { setTimeout(done, 150); });
    if (JSON.parse(await fsp.readFile(file, 'utf8')).updatedAt === at) return;
  }
  throw new Error(`could not keep ${id} backdated — the store kept writing over it`);
};

/** A conversation with nothing in it never reaches the list, so each of these
 *  takes one scripted turn from the fake provider. */
const startChats = async (page, n) => {
  const ids = await page.evaluate(async (count) => {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const id = await window.marble.agent.start({ provider: 'fake' });
      await window.marble.agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
      out.push(id);
    }
    return out;
  }, n);
  for (const id of ids) await page.locator(`.conv[data-id="${id}"]`).waitFor();
  // A turn still running is live work, which the cut spares on purpose.
  await page.waitForFunction(async (rows) => {
    const summaries = await window.marble.agent.conversations();
    return rows.every((id) => {
      const row = summaries.find((s) => s.id === id);
      return row && !row.running && !row.queued;
    });
  }, ids);
  return ids;
};

const rowHidden = (page, id) => page.evaluate((row) => {
  const el = document.querySelector(`.conv[data-id="${row}"]`);
  return el ? el.hidden : 'missing';
}, id);

// ------------------------------------------------------------------ the scale

test('the scale is logistic over log-duration, centred on five hours', async () => {
  const { page } = await openAgents();
  const scale = await page.evaluate(() => {
    const idle = window.marbleAgentIdle;
    return {
      min: idle.MIN,
      max: idle.MAX,
      left: idle.minutesAt(0),
      middle: idle.minutesAt(0.5),
      right: idle.minutesAt(1),
      quarters: [0.25, 0.75].map((t) => idle.minutesAt(t)),
      roundTrip: [5, 60, 300, 1440, 18000].map((m) => idle.positionOf(m)),
      labels: [null, 5, 300, 1440].map((m) => idle.label(m)),
    };
  });
  // The middle of the track is the default, exactly.
  assert.equal(Math.round(scale.middle), 300);
  assert.equal(scale.right, 5);
  assert.equal(Math.round(scale.left), 18000);
  // As far above the middle in log-duration as the right end is below it.
  assert.equal(scale.max, (300 * 300) / 5);
  // The logistic buys the hours the middle of the track: a linear log scale
  // would put 0.25 at 15.5 hours and 0.75 at 1.6 hours, the sigmoid pushes
  // them out to roughly a day and roughly an hour.
  assert.ok(scale.quarters[0] > 1000 && scale.quarters[0] < 1300, `quarter was ${scale.quarters[0]}`);
  assert.ok(scale.quarters[1] > 70 && scale.quarters[1] < 90, `three quarters was ${scale.quarters[1]}`);
  // Monotone right-to-left, and an exact inverse of minutesAt.
  const [atMin, atHour, atMid, atDay, atMax] = scale.roundTrip;
  assert.ok(atMin > atHour && atHour > atMid && atMid > atDay && atDay > atMax);
  assert.equal(atMin, 1);
  assert.equal(atMax, 0);
  assert.ok(Math.abs(atMid - 0.5) < 1e-9);
  assert.deepEqual(scale.labels, ['All chats', '5 min', '5 hr', '1 day']);
});

test('every named stop sits on its own patch of track, and snapping takes it', async () => {
  const { page } = await openAgents();
  const { positions, snapped } = await page.evaluate(() => {
    const idle = window.marbleAgentIdle;
    return {
      positions: idle.STOPS.map((m) => idle.positionOf(m)),
      // A drag that lands a hair off a stop takes the stop; one that lands
      // well away from every stop is left where it was put.
      snapped: [idle.snap(302), idle.snap(1430), idle.snap(200)],
    };
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] < positions[i - 1], 'stops must fall left as the duration grows');
    assert.ok(positions[i - 1] - positions[i] > 0.024, 'two stops must not share a snap zone');
  }
  assert.deepEqual(snapped, [300, 1440, 200]);
});

// ------------------------------------------------------------------- the rule

test('the cut spares live work, the open chat and anything already filed', async () => {
  const { page } = await openAgents();
  const verdicts = await page.evaluate(() => {
    const { hides } = window.marbleAgentIdle;
    const now = Date.now();
    const old = now - 6 * 3600_000;
    const stale = { id: 'a', updatedAt: old };
    return {
      stale: hides(stale, 300, now),
      fresh: hides({ id: 'b', updatedAt: now - 60_000 }, 300, now),
      running: hides({ id: 'c', updatedAt: old, running: true }, 300, now),
      queued: hides({ id: 'd', updatedAt: old, queued: true }, 300, now),
      asking: hides({ id: 'e', updatedAt: old, asking: true }, 300, now),
      archived: hides({ id: 'f', updatedAt: old, archived: true }, 300, now),
      noCut: hides(stale, null, now),
      untouched: hides({ id: 'g' }, 300, now),
      // Anything an agent finished for you counts as touching it.
      finished: hides({ id: 'h', updatedAt: old, lastFinishedAt: now - 60_000 }, 300, now),
    };
  });
  assert.deepEqual(verdicts, {
    stale: true,
    fresh: false,
    running: false,
    queued: false,
    asking: false,
    archived: false,
    noCut: false,
    untouched: false,
    finished: false,
  });
});

// ---------------------------------------------------------------- the control

test('the slider opens on five hours, reads itself, and draws the chats behind it', async () => {
  const { page, errors } = await openAgents();
  const ids = await startChats(page, 3);
  await backdate(ids[0], 8 * 60);
  await backdate(ids[1], 30 * 60);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleAgentIdle));
  await openFilters(page);

  const range = page.locator('.filter-pop .idle-range');
  await range.waitFor();
  assert.equal(await range.inputValue(), '500', 'the default is the middle of the track');
  assert.match(await page.locator('.filter-pop .idle-read').textContent(), /hidden after 5 hr/);
  assert.equal(await page.locator('.filter-pop .idle-scale > span').first().textContent(), 'All chats');
  assert.equal(await page.locator('.filter-pop .idle-scale > span').last().textContent(), '5 min');

  // One bar per bucket, and the bars left of the thumb are the ones going.
  const bars = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.idle-hist > i')];
    return {
      count: all.length,
      cut: all.filter((bar) => bar.hasAttribute('data-cut')).length,
      filled: all.filter((bar) => !bar.hasAttribute('data-empty')).length,
    };
  });
  assert.equal(bars.count, 32);
  assert.equal(bars.cut, 16, 'the thumb at the middle cuts half the track');
  assert.equal(bars.filled, 3, 'one bucket per chat, and the three are far apart');
  assert.deepEqual(errors, []);
});

test('a chat idle past the cut is hidden, and All chats brings it back', async () => {
  const { page } = await openAgents();
  const ids = await startChats(page, 2);
  await backdate(ids[0], 8 * 60);
  await page.reload();
  await page.waitForFunction((id) => Boolean(document.querySelector(`.conv[data-id="${id}"]`)), ids[1]);
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"]`)?.hidden === true, ids[0]);
  assert.equal(await rowHidden(page, ids[1]), false, 'the fresh chat stays');

  // The button is marked, not counted — a filter you cannot see must still
  // say it is hiding rows, but it should not ask to be cleared.
  assert.equal(await page.locator('.filter-toggle .filter-count').isVisible(), true);
  assert.match(await page.locator('.filter-toggle').getAttribute('title'), /idle hidden/);

  await openFilters(page);
  await page.locator('.filter-pop .idle-range').fill('0');
  await page.locator('.filter-pop .idle-range').dispatchEvent('input');
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"]`)?.hidden === false, ids[0]);
  assert.match(await page.locator('.filter-pop .idle-read').textContent(), /never hidden/);
  assert.equal(await page.locator('.filter-toggle .filter-count').isVisible(), false);
});

test('the cut survives a reload, and Clear filters opens it all the way up', async () => {
  const { page } = await openAgents();
  const ids = await startChats(page, 1);
  await backdate(ids[0], 8 * 60);
  await page.reload();
  await openFilters(page);

  // End is the tightest cut the track holds.
  await page.locator('.filter-pop .idle-range').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => window.marbleAgentIdle.cut() === 5);
  await page.reload();
  await page.waitForFunction(() => window.marbleAgentIdle?.cut() === 5, null, { timeout: 5000 });

  await openFilters(page);
  await page.locator('.filter-clear').click();
  await page.waitForFunction(() => window.marbleAgentIdle.cut() === null);
  await page.reload();
  await page.waitForFunction(() => window.marbleAgentIdle?.cut() === null, null, { timeout: 5000 });
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"]`)?.hidden === false, ids[0]);
});

test('arrow keys walk the named stops rather than the thousand steps under them', async () => {
  const { page } = await openAgents();
  await openFilters(page);
  const range = page.locator('.filter-pop .idle-range');
  await range.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => window.marbleAgentIdle.cut()), 480, 'one notch left is eight hours');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.marbleAgentIdle.cut()), 180, 'and right is three');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => window.marbleAgentIdle.cut()), null, 'Home is All chats');
});

test('the cut is a filter, not a filing: nothing is archived by the clock', async () => {
  const { page } = await openAgents();
  const ids = await startChats(page, 1);
  await backdate(ids[0], 8 * 60);
  await page.reload();
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"]`)?.hidden === true, ids[0]);
  const meta = await page.evaluate(async (id) => (await window.marble.agent.conversation(id)).meta, ids[0]);
  assert.equal(meta.archived, false, 'the store must not have been written to');
  // And the Archived view is still empty, because nothing was filed.
  await openFilters(page);
  await page.locator('.filter[data-filter="archived"]').click();
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"]`)?.hidden === true, ids[0]);
});
