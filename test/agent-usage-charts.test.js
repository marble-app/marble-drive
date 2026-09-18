import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-usage-charts.js';

const C = () => globalThis.marbleUsageCharts;

const DAY_MS = 86_400_000;
// 2026-09-18 is a Friday. `list` is oldest-first and ends on that day.
const build = (values, { end = '2026-09-18', models = {} } = {}) => {
  const last = Date.parse(`${end}T00:00:00Z`);
  return values.map((messages, i) => {
    const date = new Date(last - (values.length - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    const byModel = models[i] ?? (messages ? { opus: { messages, tokens: messages * 100 } } : {});
    return { date, messages, tokens: messages * 100, cacheRead: 0, byModel };
  });
};

test('value reads tokens or messages, for all models or one', () => {
  const day = { date: 'd', messages: 4, tokens: 900, cacheRead: 0, byModel: { fable: { messages: 1, tokens: 300 }, opus: { messages: 3, tokens: 600 } } };
  assert.equal(C().value(day, { metric: 'tokens', model: 'all' }), 900);
  assert.equal(C().value(day, { metric: 'messages', model: 'all' }), 4);
  assert.equal(C().value(day, { metric: 'tokens', model: 'fable' }), 300);
  assert.equal(C().value(day, { metric: 'messages', model: 'sonnet' }), 0);
  assert.equal(C().value(day), 900, 'tokens across all models is the default');
});

test('levelFn is empty for zero, monotone across quartiles of the non-zero values, and safe on flat data', () => {
  const level = C().levelFn([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(level), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const flat = C().levelFn([0, 5, 5, 5]);
  assert.equal(flat(0), 0);
  assert.equal(flat(5), 4, 'identical values must not all read as the palest step');
  const none = C().levelFn([]);
  assert.equal(none(0), 0);
  assert.equal(none(7), 4);
});

test('grid is Sunday-first, padded with nulls, and trimmed to the first active week', () => {
  // 60 days ending Fri 2026-09-18; activity starts 20 days back.
  const values = [...Array(40).fill(0), ...Array(20).fill(3)];
  const { weeks } = C().grid(build(values), { minWeeks: 4 });
  assert.equal(weeks.every((col) => col.length === 7), true);
  // Friday is index 5 of Sun..Sat, so the last column has null for Saturday.
  assert.equal(weeks.at(-1)[5].date, '2026-09-18');
  assert.equal(weeks.at(-1)[6], null);
  // First column starts on a Sunday and holds the first active day.
  const firstCell = weeks[0].find(Boolean);
  assert.equal(new Date(`${weeks[0].find(Boolean).date}T00:00:00Z`).getUTCDay() >= 0, true);
  assert.equal(weeks[0][0] === null || new Date(`${weeks[0][0].date}T00:00:00Z`).getUTCDay() === 0, true);
  assert.ok(weeks.flat().filter(Boolean).some((cell) => cell.date === '2026-08-30'), `${firstCell.date} onward covers the first active day`);
  // 20 active days is under 4 weeks of padding room, so it spans 4-5 columns.
  assert.ok(weeks.length >= 4 && weeks.length <= 5, `got ${weeks.length} columns`);
});

test('grid never shows fewer than minWeeks columns, even for a single active day', () => {
  const { weeks } = C().grid(build([...Array(180).fill(0), 9]), { minWeeks: 12 });
  assert.ok(weeks.length >= 12 && weeks.length <= 13, `got ${weeks.length}`);
  const none = C().grid(build(Array(180).fill(0)), { minWeeks: 12 });
  assert.ok(none.weeks.length >= 12 && none.weeks.length <= 13);
});

test('grid labels the first column of each month and drops a label that would collide', () => {
  const { months } = C().grid(build(Array(100).fill(1)), { minWeeks: 12 });
  const labels = months.map((m) => m.label);
  assert.equal(new Set(labels).size, labels.length, 'no month labelled twice');
  assert.ok(labels.includes('Sep') && labels.includes('Aug'));
  for (let i = 1; i < months.length; i += 1) assert.ok(months[i].col - months[i - 1].col >= 2, 'labels are at least two columns apart');
});

test('summary: last 7 vs the 7 before, busiest day, active days and streaks', () => {
  // 14 days ending today: previous week 1 a day, last week 2 a day, one zero mid-week.
  const values = [...Array(7).fill(1), 2, 2, 0, 2, 2, 2, 2];
  const s = C().summary(build(values));
  assert.equal(s.prev7, 700, 'tokens: 7 days of 1 message at 100 tokens');
  assert.equal(s.last7, 1200);
  assert.ok(Math.abs(s.delta - (1200 - 700) / 700) < 1e-9);
  assert.deepEqual(s.busiest, { date: '2026-09-18', value: 200 });
  assert.equal(s.activeDays, 13);
  assert.equal(s.totalDays, 14);
  assert.equal(s.streak, 4, 'current streak stops at the zero day');
  assert.equal(s.longest, 9, 'longest run is the 7 quiet-but-active days plus two');
  assert.equal(s.avgActive, (7 * 100 + 12 * 100) / 13);
});

test('summary: streak survives an idle today, and an empty history is all zeros with no delta', () => {
  assert.equal(C().summary(build([1, 1, 1, 0])).streak, 3, 'today has not happened yet; yesterday still counts');
  assert.equal(C().summary(build([1, 1, 0, 0])).streak, 0, 'two idle days end it');
  const zero = C().summary(build(Array(10).fill(0)));
  assert.deepEqual([zero.last7, zero.prev7, zero.delta, zero.busiest, zero.activeDays, zero.streak, zero.longest, zero.avgActive], [0, 0, null, null, 0, 0, 0, 0]);
  assert.equal(C().summary(build([0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5])).delta, null, 'nothing last week: no percentage');
});

test('summary respects the model filter', () => {
  const days = build([1, 1, 1], { models: { 1: { fable: { messages: 1, tokens: 700 } } } });
  const s = C().summary(days, { model: 'fable' });
  assert.equal(s.activeDays, 1);
  assert.equal(s.last7, 700);
});

test('weekly sums whole weeks by model and matches the overall total', () => {
  const days = build(Array(21).fill(2), { models: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i, { opus: { messages: 1, tokens: 100 }, fable: { messages: 1, tokens: 100 } }])) });
  const weeks = C().weekly(days, { weeks: 12 });
  assert.equal(weeks.reduce((sum, w) => sum + w.total, 0), 21 * 200);
  for (const w of weeks) {
    assert.equal(new Date(`${w.start}T00:00:00Z`).getUTCDay(), 0, 'weeks start on Sunday');
    assert.equal(w.byModel.opus + w.byModel.fable + w.byModel.sonnet + w.byModel.haiku + w.byModel.other, w.total);
  }
  assert.ok(weeks.length <= 12);
  assert.equal(C().weekly(days, { weeks: 2 }).length, 2);
});

test('share is each family\'s slice of the range, in a fixed order, summing to 1', () => {
  const days = build([1, 1], { models: { 0: { fable: { messages: 1, tokens: 100 } }, 1: { opus: { messages: 3, tokens: 300 } } } });
  const share = C().share(days);
  assert.deepEqual(share.map((s) => s.family), ['opus', 'fable'], 'opus before fable, zeros omitted');
  assert.equal(share.reduce((sum, s) => sum + s.share, 0), 1);
  assert.equal(share[0].share, 0.75);
  assert.deepEqual(C().share(build([0, 0])), []);
});

test('compact prints counts the way a person reads them', () => {
  const f = (n) => C().compact(n);
  assert.deepEqual([0, 7, 999, 1_000, 12_340, 999_999, 1_600_000, 12_000_000, 2_500_000_000].map(f), ['0', '7', '999', '1k', '12.3k', '1M', '1.6M', '12M', '2.5B']);
});
