// The Console's dashboard in a browser, against a fake fleet with a week of
// ledgers: it opens on the dashboard, draws every drive's state over time and
// what it cost, answers a hover, switches range, shows any chart as a table,
// takes a pasted bill, puts a drive's own use in its detail, and fits a phone.

import assert from 'node:assert/strict';
import test from 'node:test';

import { consoleWorld } from './console-world.js';

const H = 60 * 60 * 1000;
const now = Date.now();
/** Awake stretches, as ledger minutes: [[hoursAgoStart, hoursAgoEnd, wake]]. */
function ledger(stretches, { mem = 2, looking = 1, turns = 0 } = {}) {
  const out = [];
  for (const [a, b, wake] of stretches) {
    let first = true;
    for (let t = now - a * H + 60_000; t <= now - b * H; t += 60_000) {
      out.push({ t: Math.floor(t / 1000), dt: 60, cpu: 3, mem, used: mem / 2, disk: 4, why: { tabs: 1, looking, work: looking ? 0 : 1, asks: 0 }, turns: first ? turns : 0, opens: first ? 2 : 0, wake: first ? wake : null });
      first = false;
    }
  }
  return out;
}

const world = await consoleWorld();
test.after(() => world.host.close());
await world.fleet.set({ ledger: {
  't-sam': ledger([[50, 47, 'cold'], [26, 25, 'warm'], [3, 0, 'warm']], { mem: 1.5, turns: 3 }),
  't-irene': ledger([[30, 28, 'cold'], [6, 5, 'warm']], { looking: 0 }),
  't-bryan': ledger([[100, 99, 'cold']]),
} });
for (const name of ['t-sam', 't-irene', 't-bryan']) await world.host.drive.console.usage.pull(name);

test('the Console opens on the dashboard: numbers, every drive\'s state, cost, and no drive woken', async () => {
  const execs = async () => (await world.fleet.calls()).filter((c) => c[0] === 'exec').map((c) => c[c.indexOf('-s') + 1]);
  const before = (await execs()).length;
  const { page, errors } = await world.open({ view: 'dashboard' });
  await page.waitForSelector('.cx-view[data-view="dashboard"] .chart.timeline');
  assert.equal(await page.getAttribute('.cx-bar .seg [data-view="dashboard"]', 'aria-selected'), 'true');
  const tiles = await page.$$eval('.tile .tile-label', (els) => els.map((e) => e.textContent));
  assert.deepEqual(tiles.slice(0, 3), ['This month so far', 'By the end of the month', 'Awake now']);
  assert.match(await page.textContent('.tile:nth-child(3) .tile-value'), /2 of 6/);
  const lanes = await page.$$eval('.chart.timeline .lane-label', (els) => els.map((e) => e.dataset.name));
  assert.equal(lanes[0], 'admin-p1', 'yours first');
  assert.equal(lanes.length, 6);
  assert.ok(await page.$('.chart.timeline .seg.st-running'));
  assert.ok(await page.$('.chart.timeline .seg.st-warm'));
  await page.waitForSelector('[data-card="cost"] .chart.hbars');
  const costLabels = await page.$$eval('[data-card="cost"] .chart .label', (els) => els.map((e) => e.textContent));
  assert.equal(costLabels[0], 't-sam', 'the costliest first');
  for (const id of ['why', 'spend', 'daily', 'heat', 'mem', 'cpu', 'activity']) assert.ok(await page.$(`[data-card="${id}"] .chart, [data-card="${id}"] .chart-empty, [data-card="${id}"] .act-grid`), id);
  const woken = (await execs()).slice(before).filter((n) => ['t-bryan', 't-irene', 't-peiling', 't-sangho'].includes(n));
  assert.deepEqual(woken, [], 'drawing the dashboard woke nobody');
  assert.deepEqual(errors, []);
  await page.close();
});

test('hovering a stretch says what it was, and a range switch reads again', async () => {
  const { page, errors } = await world.open({ view: 'dashboard' });
  await page.waitForSelector('.chart.timeline .seg.st-running');
  const box = await page.evaluate(() => {
    const svg = document.querySelector('[data-card="state"] .chart.timeline');
    const label = svg.querySelector('.lane-label[data-name="t-sam"] circle');
    const cy = Number(label.getAttribute('cy'));
    const seg = [...svg.querySelectorAll('.seg.st-running')].filter((r) => Math.abs(Number(r.getAttribute('y')) + Number(r.getAttribute('height')) / 2 - cy) < 1).sort((a, b) => b.getAttribute('width') - a.getAttribute('width'))[0];
    const r = seg.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.waitForSelector('.cx-tip:popover-open');
  assert.match(await page.textContent('.cx-tip'), /t-sam · Running/);
  assert.match(await page.textContent('.cx-tip'), /Cost/);

  const asked = page.waitForRequest((r) => r.url().includes('/console/api/usage?range=24h'));
  await page.click('.dash-bar .seg button:text("24 h")');
  await asked;
  await page.waitForFunction(() => document.querySelector('.dash-bar .seg [aria-pressed="true"]')?.textContent === '24 h' && !!document.querySelector('.chart.timeline'));
  await page.click('.dash-bar .seg button:text("7 days")');
  assert.deepEqual(errors, []);
  await page.close();
});

test('any chart becomes a table, and a pasted bill calibrates the estimates', async () => {
  const { page, errors } = await world.open({ view: 'dashboard' });
  await page.waitForSelector('[data-card="cost"] .chart');
  await page.click('[data-card="cost"] .card-head button:text("Table")');
  await page.waitForSelector('[data-card="cost"] table.chart-table');
  const rows = await page.$$eval('[data-card="cost"] table tbody tr', (els) => els.length);
  assert.ok(rows >= 3);
  await page.click('[data-card="cost"] .card-head button:text("Chart")');
  await page.waitForSelector('[data-card="cost"] .chart');

  await page.click('.dash-bar button:text("Paste a bill")');
  await page.fill('.pop:popover-open textarea', 'nothing I can read $4');
  await page.click('.pop:popover-open .btn.primary');
  await page.waitForFunction(() => /dollar amount/.test(document.querySelector('.pop:popover-open .error')?.textContent ?? ''));
  const today = new Date();
  const mmdd = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  await page.fill('.pop:popover-open textarea', `From:\n${mmdd(new Date(today - 3 * 24 * H))}\nTo:\n${mmdd(today)}\nTotal Spend\n$2.00\nSprites: RAM    $1.80\nSprites: CPU    $0.20`);
  await page.click('.pop:popover-open .btn.primary');
  await page.waitForFunction(() => /calibrated to your bill/.test(document.querySelector('.tile')?.textContent ?? ''));
  assert.ok(await page.$('.dash-bar button:text("New bill")'));
  assert.deepEqual(errors.filter((e) => !/status of 400/.test(e)), [], 'only the refused bill');
  await page.close();
});

test('a drive\'s detail shows its own use', async () => {
  const { page, errors } = await world.open();
  await page.click('.row[data-name="t-sam"]');
  await page.waitForSelector('.detail .use-strip .chart.timeline');
  const use = await page.textContent('.detail .sec:has(.use-strip)');
  assert.match(use, /This month/);
  assert.match(use, /awake/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('on a phone the dashboard is one column with nothing off the side, in dark too', async () => {
  const { page, errors } = await world.open({ width: 390, height: 844, hasTouch: true, isMobile: true, view: 'dashboard', colorScheme: 'dark' });
  await page.waitForSelector('.chart.timeline');
  await page.waitForTimeout(300);
  const over = await page.evaluate(() => {
    const view = document.querySelector('.cx-view[data-view="dashboard"] .page');
    return { scroll: view.scrollWidth - view.clientWidth, doc: document.documentElement.scrollWidth - innerWidth };
  });
  assert.ok(over.scroll <= 1, `the dashboard scrolls sideways by ${over.scroll}px`);
  assert.ok(over.doc <= 1, `the page scrolls sideways by ${over.doc}px`);
  assert.deepEqual(errors, []);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/dash-phone-dark.png`, fullPage: true });
  await page.close();
});

test('screenshots, when asked for', { skip: !process.env.SHOTS }, async () => {
  for (const colorScheme of ['light', 'dark']) {
    const { page } = await world.open({ view: 'dashboard', colorScheme, width: 1360, height: 1900 });
    await page.waitForSelector('.chart.timeline');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${process.env.SHOTS}/dash-${colorScheme}.png`, fullPage: true });
    await page.close();
  }
});
