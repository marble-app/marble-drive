import assert from 'node:assert/strict';
import test from 'node:test';

import { createDaily, localTime, parseAt, DAY_TITLE } from '../server/daily.js';

const quiet = { log() {}, error() {} };
const ZONE = 'America/Los_Angeles';
// 2026-09-24 in Los Angeles is PDT, UTC-7.
const at = (hhmm, day = '2026-09-24') => Date.parse(`${day}T${hhmm}:00-07:00`);

function harness({ clock = at('06:00'), existing = [], fail = false } = {}) {
  const state = { now: clock, started: [], metas: [...existing] };
  const daily = createDaily({
    at: '06:30',
    zone: ZONE,
    prompt: '/my-day',
    target: "Bryan's Days/today",
    now: () => state.now,
    schedule: null,
    log: quiet,
    conversations: async () => state.metas,
    start: async (run) => {
      if (fail) throw new Error('no agent signed in');
      state.started.push(run);
      state.metas.push({ title: run.title, createdAt: state.now });
      return { id: `c${state.started.length}` };
    },
  });
  return { state, daily };
}

test('HH:MM is read, anything else is not', () => {
  assert.equal(parseAt('06:30'), 390);
  assert.equal(parseAt('6:30'), 390);
  assert.equal(parseAt('24:00'), null);
  assert.equal(parseAt('6.30'), null);
  assert.equal(parseAt(null), null);
});

test('local time is the zone’s, not the machine’s', () => {
  assert.deepEqual(localTime(Date.parse('2026-09-24T13:30:00Z'), ZONE), { date: '2026-09-24', minutes: 390 });
  // Past midnight in UTC is still the evening before in Los Angeles.
  assert.deepEqual(localTime(Date.parse('2026-09-25T02:00:00Z'), ZONE), { date: '2026-09-24', minutes: 19 * 60 });
});

test('nothing starts before the hour, and one run starts at it', async () => {
  const { state, daily } = harness();
  await daily.nudge();
  assert.equal(state.started.length, 0);
  state.now = at('06:30');
  await daily.nudge();
  assert.deepEqual(state.started, [{ prompt: '/my-day', target: "Bryan's Days/today", title: DAY_TITLE }]);
  state.now = at('09:00');
  await daily.nudge();
  assert.equal(state.started.length, 1);
});

test('a sprite asleep at 6:30 starts the day when it wakes', async () => {
  const { state, daily } = harness({ clock: at('11:47') });
  await daily.nudge();
  assert.equal(state.started.length, 1);
});

test('a burst of requests on waking is one run', async () => {
  const { state, daily } = harness({ clock: at('06:31') });
  await Promise.all([daily.nudge(), daily.nudge(), daily.nudge()]);
  assert.equal(state.started.length, 1);
});

test('a day already started from the button is not started again', async () => {
  const { state, daily } = harness({ clock: at('07:00'), existing: [{ title: DAY_TITLE, createdAt: at('05:50') }] });
  await daily.nudge();
  assert.equal(state.started.length, 0);
});

test('yesterday’s run does not count for today', async () => {
  const { state, daily } = harness({ clock: at('06:45'), existing: [{ title: DAY_TITLE, createdAt: at('06:30', '2026-09-23') }] });
  await daily.nudge();
  assert.equal(state.started.length, 1);
});

test('the next day runs again', async () => {
  const { state, daily } = harness({ clock: at('06:30') });
  await daily.nudge();
  state.now = at('06:30', '2026-09-25');
  await daily.nudge();
  assert.equal(state.started.length, 2);
});

test('a failed start is retried, but not on every request', async () => {
  const logged = [];
  let tries = 0;
  const state = { now: at('06:30') };
  const daily = createDaily({
    at: '06:30', zone: ZONE, prompt: '/my-day', target: 'today',
    now: () => state.now, schedule: null,
    log: { log() {}, error: (line) => logged.push(line) },
    conversations: async () => [],
    start: async () => {
      tries += 1;
      throw new Error('no agent signed in');
    },
  });
  await daily.nudge();
  state.now = at('06:31');
  await daily.nudge();
  assert.equal(tries, 1);
  state.now = at('06:46');
  await daily.nudge();
  assert.equal(tries, 2);
  assert.match(logged[0], /no agent signed in/);
});

test('off without a time or a target, and loud about a bad one', async () => {
  const errors = [];
  const log = { log() {}, error: (line) => errors.push(line) };
  const base = { zone: ZONE, prompt: '/my-day', schedule: null, now: () => at('07:00'), conversations: async () => [], start: async () => assert.fail('started') };
  await createDaily({ ...base, at: null, target: 'today', log }).nudge();
  await createDaily({ ...base, at: '06:30', target: null, log }).nudge();
  await createDaily({ ...base, at: 'dawn', target: 'today', log }).nudge();
  await createDaily({ ...base, at: '06:30', zone: 'Mars/Olympus', target: 'today', log }).nudge();
  assert.equal(errors.length, 2);
});
