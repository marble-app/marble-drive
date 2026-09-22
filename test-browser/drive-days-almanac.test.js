// The days folder reading its own issues back: covers, kept, threads, wall.
//
// The almanac lives in the owner's own drive document, and `drive/` is not
// tracked by this repo — so this file tests the document that actually ships
// to the drive (or the one named by MARBLE_DRIVE_DOC), and skips plainly when
// that document is not in the checkout.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { startDrive } from './harness.js';

const DOC = process.env.MARBLE_DRIVE_DOC || new URL('../drive/drive.mrbl', import.meta.url);
const SOURCE = await fsp.readFile(DOC, 'utf8').catch(() => null);

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const back = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const D2 = back(2);
const D1 = back(1);
const short = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

// A 1×1 PNG, standing in for the day's painting.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// A day, in the real shapes the my-day build emits: rows with keys and
// state, cards with marks and notes, the push, the palette, the painting.
const row = (cls, key, title, { done = false, note = '' } = {}) =>
  `<li class="row ${cls}" data-key="${key}"${done ? ' data-done' : ''}>
    <button class="chk" data-act="done"></button>
    <div class="body"><div class="title">${title}</div><div class="why">because</div><div class="note">${note}</div></div>
  </li>`;
const ncard = (key, title, { saved = false, vote = '', note = '' } = {}) =>
  `<div class="ncard" data-key="${key}"${saved ? ' data-saved' : ''}${vote ? ` data-vote="${vote}"` : ''}>
    <div class="nbody"><h4 class="ntitle"><a href="https://example.com/${key}">${title}</a></h4>
    <div class="nmeta"><span>Example Wire</span><span>2026-09-01</span></div>
    <div class="nfoot"><span class="rel rel-3">Core</span></div>
    <div class="note">${note}</div></div>
  </div>`;
const pcard = (key, title, { saved = false, vote = '', note = '' } = {}) =>
  `<div class="pcard" data-key="${key}"${saved ? ' data-saved' : ''}${vote ? ` data-vote="${vote}"` : ''}>
    <h4 class="ptitle"><a href="https://arxiv.org/abs/${key}">${title}</a></h4>
    <div class="pmeta">Ada Lovelace, Alan Turing</div>
    <div class="pfoot"><span class="rel rel-2">Adjacent</span></div>
    <div class="note">${note}</div>
  </div>`;
const dayDoc = ({ key, title, palette, chips, push, rows, cards, road }) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="day:date" content="${key}"><meta name="day:title" content="${title}"><meta name="day:palette" content="${palette}">
<title>${title}</title></head>
<body data-marble-id="b"><main class="page" data-marble-id="m">
<section class="comp card"><div class="chead"><h2>Today's colour</h2></div>
  <div class="art-img"><img src="${PNG}" alt="A Painting, Somebody, 1888"></div>
  <div class="pal"><span class="pal-chips">${chips.map((h) => `<i style="background:${h}"></i>`).join('')}</span><span class="pal-name">${palette}</span></div>
</section>
<section class="comp bare"><div class="chead"><h2>Today, sharply</h2></div><ol class="list">${rows.focus.join('')}</ol></section>
${push ? `<section class="comp tint"><div class="chead"><h2>Push one thing forward</h2></div><h3 class="push-h">${push}</h3><p class="push-b">Body of the push.</p></section>` : ''}
<section class="comp bare"><div class="chead"><h2>To-dos</h2></div><ol class="list">${rows.todos.join('')}</ol></section>
<section class="comp bare"><div class="chead"><h2>Worth your attention</h2></div>${cards.news.join('')}</section>
<section class="comp bare"><div class="chead"><h2>Fresh on arXiv · cs.HC</h2></div><div class="pgrid">${cards.papers.join('')}</div></section>
<section class="comp card"><div class="chead"><h2>The road ahead</h2><span class="n">${road}</span></div><div class="repr"><p>One line about the road.</p></div></section>
</main></body></html>
`;

const DAYS = {
  [`Bryan's Days/${D2}`]: dayDoc({
    key: D2, title: 'The first day', palette: 'Rust & Duck Egg', chips: ['#a85a3c', '#a9c6bf', '#f0ece2', '#322d29'],
    push: 'Draft the intro',
    rows: {
      focus: [row('focus', 'own-book-flights', 'Book flights')],
      todos: [row('todo', 'own-write-grant', 'Write the grant'), row('todo', 'own-reply-alex', 'Reply to Alex')],
    },
    cards: {
      news: [ncard('wire-1', 'A story he starred', { saved: true, note: 'This is really relevant!!!' })],
      papers: [pcard('2609.00001', 'A paper he ignored')],
    },
    road: 'The trellis',
  }),
  [`Bryan's Days/${D1}`]: dayDoc({
    key: D1, title: 'The second day', palette: 'Moss & Buff', chips: ['#4c6b45', '#d8c9a3', '#f3efe4', '#2c2f2a'],
    push: 'Send the email',
    rows: {
      focus: [row('focus', 'own-book-flights', 'Book flights', { note: 'right after the deadline' })],
      todos: [row('todo', 'own-write-grant', 'Write the grant', { done: true }), row('todo', 'own-course-plan', 'Plan the course')],
    },
    cards: {
      news: [],
      papers: [pcard('2609.00002', 'A paper he liked', { vote: 'up' })],
    },
    road: 'Soundings',
  }),
  [`Bryan's Days/${TODAY}`]: dayDoc({
    key: TODAY, title: 'The day itself', palette: 'Peacock & Sand', chips: ['#2f7d78', '#dcc9a4', '#eef1ec', '#2b3330'],
    push: 'Write back to Devina',
    rows: {
      focus: [row('focus', 'own-book-flights', 'Book flights and hotel')],
      todos: [row('todo', 'own-course-plan', 'Plan the course', { note: 'Winter 2027\n50 students' })],
    },
    cards: {
      news: [ncard('wire-2', 'A story he thumbed down', { vote: 'down' })],
      papers: [pcard('2609.00003', 'A paper he saved today', { saved: true, vote: 'up' })],
    },
    road: 'The lending library',
  }),
};

const notSandbox = (errors) => errors.filter((e) => !/sandbox/i.test(e));

if (!SOURCE) {
  test('the days folder reads its issues back', { skip: 'no drive/drive.mrbl in this checkout' }, () => {});
} else {
  const host = await startDrive({ agents: false, documents: { drive: SOURCE, ...DAYS } });
  test.after(async () => {
    await host.close();
  });

  async function openDays() {
    const { page, errors } = await host.newPage();
    await page.goto(`${host.base}/a/drive#/${encodeURIComponent("Bryan's Days")}`);
    await page.locator('.items[data-rep="days"]').waitFor();
    return { page, errors };
  }

  test('covers say what the day knows, not what the file weighs', async () => {
    const { page, errors } = await openDays();
    await page.locator('.days-bar .days-seg [data-days-read="days"][aria-pressed="true"]').waitFor();
    // Three days: today as the hero, two behind it. Every one reads itself.
    await page.locator('.day-card[data-digest="1"]').nth(2).waitFor();
    assert.equal(await page.locator('.day-card').count(), 3);

    const first = page.locator(`.day-card[data-day="${D2}"]`);
    assert.equal(await first.locator('.day-push').textContent(), 'Draft the intro');
    assert.equal(await first.locator('.day-pal i').count(), 4);
    const facts = (await first.locator('.day-facts').textContent()).replace(/\s+/g, ' ').trim();
    assert.match(facts, /★ 1/, 'one saved card');
    assert.match(facts, /✎ 1/, 'one note');
    assert.match(facts, /✓ 0\/3/, 'three to-dos, none done');
    assert.doesNotMatch(facts, /▲/, 'a zero is not shown');

    const second = page.locator(`.day-card[data-day="${D1}"]`);
    assert.match((await second.locator('.day-facts').textContent()).replace(/\s+/g, ' '), /▲ 1.*✓ 1\/3/);

    const hero = page.locator('.day-card.is-today');
    assert.equal(await hero.locator('.day-push').textContent(), 'Write back to Devina');
    await page.locator('.days-bar .days-note', { hasText: '3 days' }).waitFor();
    assert.deepEqual(notSandbox(errors), []);
    await page.close();
  });

  test('kept is every star, thumb and note, in his voice', async () => {
    const { page, errors } = await openDays();
    await page.locator('[data-days-read="kept"]').click();
    assert.equal(await page.locator('body').getAttribute('data-days-read'), 'kept');
    await page.locator('.kept-item').nth(3).waitFor();
    const items = page.locator('.kept-item');
    // Saved paper today; noted to-do today; liked paper yesterday; noted
    // focus yesterday; starred+noted story the day before. Not the thumbed-
    // down story, not the ignored paper.
    assert.equal(await items.count(), 5);
    const titles = await items.locator('.kept-title').allTextContents();
    assert.deepEqual(titles, [
      'A paper he saved today',
      'Plan the course',
      'A paper he liked',
      'Book flights',
      'A story he starred',
    ]);
    const starred = items.last();
    assert.equal(await starred.locator('.kept-note').textContent(), 'This is really relevant!!!');
    assert.equal(await starred.locator('.kept-marks').textContent(), '★');
    assert.equal(await starred.locator('.kept-kind').textContent(), 'Example Wire');
    assert.equal(await starred.locator('.kept-rel').textContent(), 'Core');
    assert.equal(await items.first().locator('.kept-marks').textContent(), '★▲');
    // A note keeps its line breaks.
    assert.equal(await items.nth(1).locator('.kept-note').textContent(), 'Winter 2027\n50 students');
    // The filter narrows.
    await page.locator('[data-kept-filter="saved"]').click();
    assert.equal(await page.locator('.kept-item').count(), 2);
    assert.deepEqual(notSandbox(errors), []);
    await page.close();
  });

  test('threads follow a to-do across days and say what became of it', async () => {
    const { page, errors } = await openDays();
    await page.locator('[data-days-read="threads"]').click();
    await page.locator('.threads tbody tr').nth(3).waitFor();
    const rows = page.locator('.threads tbody tr');
    assert.equal(await rows.count(), 4);
    const read = async (i) => ({
      title: await rows.nth(i).locator('.t-title').textContent(),
      state: await rows.nth(i).locator('td.state').getAttribute('data-s'),
      label: await rows.nth(i).locator('td.state').textContent(),
      cells: await rows.nth(i).locator('td.day a').evaluateAll((els) => els.map((el) => el.className)),
    });
    // Open threads first, longest-carried first; then done; then dropped.
    const flights = await read(0);
    assert.equal(flights.title, 'Book flights and hotel', 'the latest wording wins');
    assert.equal(flights.state, 'open');
    assert.equal(flights.label, 'Open · 3 days');
    assert.deepEqual(flights.cells, ['open', 'open', 'open']);
    const course = await read(1);
    assert.equal(course.state, 'open');
    assert.equal(course.label, 'Open · 2 days');
    const grant = await read(2);
    assert.equal(grant.state, 'done');
    assert.equal(grant.label, `Done ${short(D1)}`);
    assert.deepEqual(grant.cells, ['open', 'done']);
    const alex = await read(3);
    assert.equal(alex.state, 'dropped');
    assert.equal(alex.label, `Dropped after ${short(D2)}`);
    // The note travels with the thread.
    assert.equal(await rows.nth(0).locator('.t-note').textContent(), 'right after the deadline');
    // Today's column is marked, and the pushes run newest first.
    assert.equal(await page.locator('.threads thead th.day.now').count(), 1);
    assert.deepEqual(await page.locator('.pushes a > span:last-child').allTextContents(), [
      'Write back to Devina', 'Send the email', 'Draft the intro',
    ]);
    assert.deepEqual(notSandbox(errors), []);
    await page.close();
  });

  test('the wall is a calendar of paintings, and the reading is remembered', async () => {
    const { page, errors } = await openDays();
    await page.locator('[data-days-read="wall"]').click();
    await page.locator('.wall .day-card.wall-cell[data-digest="1"]').nth(2).waitFor();
    assert.equal(await page.locator('.wall .day-card.wall-cell').count(), 3);
    assert.equal(await page.locator('.wall .day-card.wall-cell.is-now').count(), 1);
    const tile = page.locator(`.wall .day-card[data-day="${D2}"]`);
    assert.equal(await tile.locator('.wt').textContent(), 'The first day');
    assert.equal(await tile.locator('.wp span').textContent(), 'Rust & Duck Egg');
    assert.match(await tile.locator('.pic').evaluate((el) => el.style.backgroundImage), /^url\("data:image\/jpeg/);
    assert.match(await tile.getAttribute('title'), /The lending library|The trellis/);
    // The grid has seven day-of-week labels and a cell for every date.
    assert.equal(await page.locator('.wall').first().locator('.wall-dow').count(), 7);
    // The reading is filed on the body, so a fresh page reopens the wall.
    await page.waitForTimeout(400);
    await page.reload();
    await page.locator('.items[data-rep="days"]').waitFor();
    await page.locator('[data-days-read="wall"][aria-pressed="true"]').waitFor();
    assert.equal(await page.locator('.wall').count() > 0, true);
    // A tile still opens the day.
    await page.locator(`.wall .day-card[data-day="${D2}"]`).click();
    await page.waitForURL(/Bryan/);
    assert.deepEqual(notSandbox(errors), []);
    await page.close();
  });
}
