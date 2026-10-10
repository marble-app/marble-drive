import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlive, isDue, parseSchedule, runTitle, triggersIn } from '../server/alive.js';

const ZONE = 'America/Los_Angeles';
const HOUR = 3_600_000;
// 2026-10-07 07:30 in Los Angeles (UTC-7).
const AT_730 = Date.UTC(2026, 9, 7, 14, 30);

test('a schedule is one of a few plain phrases, and nothing runs more than hourly', () => {
  assert.deepEqual(parseSchedule('hourly'), { every: HOUR });
  assert.deepEqual(parseSchedule('every 6h'), { every: 6 * HOUR });
  assert.deepEqual(parseSchedule('Every 2 days'), { every: 48 * HOUR });
  assert.deepEqual(parseSchedule('daily 07:00'), { at: 420 });
  assert.deepEqual(parseSchedule('weekly Monday 9:15'), { at: 555, day: 1 });
  for (const no of ['press', '', 'every 0h', 'every 30m', 'daily 25:00', 'sometimes']) assert.equal(parseSchedule(no), null, no);
});

test('a document\'s scheduled triggers are read from its source; a press is not one', () => {
  const html = `<p data-marble-id="p">Notes</p>
    <button data-marble-id="t1" data-marble-run="Gather what is new &amp; update &quot;Progress&quot; > all of it" data-marble-scope="p" data-marble-on="daily 07:00">Update now</button>
    <button data-marble-id="t2" data-marble-run="Fill it" data-marble-on="press">Fill</button>
    <button data-marble-id="t3" data-marble-run="Look again" data-marble-on="every 6h" data-marble-paused>Update now</button>`;
  const found = triggersIn(html);
  assert.deepEqual(found.map((t) => t.id), ['t1', 't3']);
  assert.equal(found[0].brief, 'Gather what is new & update "Progress" > all of it');
  assert.equal(found[0].scope, 'p');
  assert.equal(found[0].paused, false);
  assert.equal(found[1].paused, true);
  assert.deepEqual(triggersIn('<p>nothing</p>'), []);
});

test('daily is due once its hour has passed and nothing ran since; every N hours counts from the last run', () => {
  const daily = parseSchedule('daily 07:00');
  assert.equal(isDue(daily, AT_730 - 24 * HOUR, AT_730, ZONE), true, 'yesterday\'s run, past seven');
  assert.equal(isDue(daily, AT_730 - 10 * 60_000, AT_730, ZONE), false, 'ran at 7:20 today');
  assert.equal(isDue(daily, AT_730 - 24 * HOUR, AT_730 - HOUR, ZONE), false, 'before seven');
  const six = parseSchedule('every 6h');
  assert.equal(isDue(six, AT_730 - 5 * HOUR, AT_730, ZONE), false);
  assert.equal(isDue(six, AT_730 - 6 * HOUR, AT_730, ZONE), true);
  const weekly = parseSchedule('weekly wed 07:00');
  assert.equal(isDue(weekly, AT_730 - 7 * 24 * HOUR, AT_730, ZONE), true, 'Oct 7 2026 is a Wednesday');
  assert.equal(isDue(parseSchedule('weekly thu 07:00'), AT_730 - 7 * 24 * HOUR, AT_730, ZONE), false);
});

test('the host runs a due trigger on its document and element, once, and holds a paused one', async () => {
  let t = AT_730;
  let source = `<section data-marble-id="s">…</section>
    <button data-marble-id="go" data-marble-run="Gather the Ai2 notes from Bryan's Days/today" data-marble-scope="s" data-marble-on="every 6h">Update now</button>`;
  const store = {
    list: async () => [{ kind: 'doc', path: 'Ai2/Notes', modified: source.length }, { kind: 'folder', path: 'Ai2' }],
    read: async () => source,
  };
  const convos = [];
  const started = [];
  const alive = createAlive({
    store,
    zone: ZONE,
    now: () => t,
    scanMs: 0,
    schedule: null,
    log: { log() {}, error() {} },
    conversations: async () => convos,
    start: async (run) => {
      started.push(run);
      convos.push({ title: run.title, createdAt: t });
      return { id: `c${started.length}` };
    },
  });
  assert.deepEqual(await alive.check(), [], 'just made alive: it counts from now, not from never');
  t += 6 * HOUR;
  assert.deepEqual(await alive.check(), ['c1']);
  assert.equal(started[0].target, 'Ai2/Notes');
  assert.deepEqual(started[0].selection, ['s']);
  assert.equal(started[0].title, runTitle('Ai2/Notes', 'go'));
  assert.match(started[0].prompt, /scheduled run \(every 6h\)/);
  assert.match(started[0].prompt, /Gather the Ai2 notes from Bryan's Days\/today/);
  t += HOUR;
  assert.deepEqual(await alive.check(), [], 'ran an hour ago');
  t += 6 * HOUR;
  source = source.replace('data-marble-on', 'data-marble-paused data-marble-on');
  assert.deepEqual(await alive.check(), [], 'paused');
  source = source.replace('data-marble-paused ', '');
  assert.deepEqual(await alive.check(), ['c2'], 'let go again');
});

test('a run that will not start is tried again after a while, not every minute', async () => {
  let t = AT_730;
  let tries = 0;
  const alive = createAlive({
    store: { list: async () => [{ kind: 'doc', path: 'n', modified: 1 }], read: async () => '<b data-marble-id="x" data-marble-run="Go" data-marble-on="hourly">Go</b>' },
    zone: ZONE, now: () => t, scanMs: 0, schedule: null, log: { log() {}, error() {} },
    conversations: async () => [],
    start: async () => { tries += 1; throw new Error('no agent'); },
  });
  await alive.check();
  t += HOUR;
  await alive.check();
  t += 60_000;
  await alive.check();
  assert.equal(tries, 1);
  t += 15 * 60_000;
  await alive.check();
  assert.equal(tries, 2);
});

// A host whose documents and conversations a test can change.
function rig({ files, zone = ZONE, t0 = AT_730 } = {}) {
  const clock = { t: t0 };
  const convos = [];
  const started = [];
  const store = {
    list: async () => Object.entries(files).map(([path, source]) => ({ kind: 'doc', path, modified: source.length })),
    read: async (p) => files[p] ?? null,
  };
  const alive = createAlive({
    store,
    zone,
    now: () => clock.t,
    scanMs: 0,
    schedule: null,
    log: { log() {}, error() {} },
    conversations: async () => convos,
    start: async (run) => {
      started.push(run);
      convos.push({ title: run.title, target: run.target, createdAt: clock.t, running: false });
      return { id: `c${started.length}` };
    },
  });
  return { alive, clock, convos, started, files };
}

const hourly = (id = 'go') => `<button data-marble-id="${id}" data-marble-run="Look again" data-marble-on="hourly">Update now</button>`;

test('a restart remembers the last run from the conversations, aimed at the right document', async () => {
  const files = { 'Work/Plan': hourly(), 'Archive/Plan': hourly() };
  const { alive, clock, convos, started } = rig({ files });
  // Both ran 59 minutes ago, before this host started: neither is due yet.
  convos.push({ title: runTitle('Work/Plan', 'go'), target: 'Work/Plan', createdAt: clock.t - 59 * 60_000 });
  convos.push({ title: runTitle('Archive/Plan', 'go'), target: 'Archive/Plan', createdAt: clock.t - 59 * 60_000 });
  assert.deepEqual(await alive.check(), []);
  clock.t += 60_000;
  assert.equal((await alive.check()).length, 2, 'two documents of one name are two triggers');
  assert.deepEqual(started.map((r) => r.target).sort(), ['Archive/Plan', 'Work/Plan']);
  clock.t += 30 * 60_000;
  assert.deepEqual(await alive.check(), []);
});

test('a run still going holds the next one, and a deleted conversation does not start another at once', async () => {
  const { alive, clock, convos, started } = rig({ files: { n: hourly() } });
  await alive.check();
  clock.t += HOUR;
  assert.equal((await alive.check()).length, 1);
  convos[0].running = true;
  clock.t += HOUR;
  assert.deepEqual(await alive.check(), [], 'the last run is still at work');
  convos[0].running = false;
  clock.t += 60_000;
  assert.equal((await alive.check()).length, 1, 'and runs once it is done');
  convos.length = 0; // the person deleted the chats
  clock.t += 10 * 60_000;
  assert.deepEqual(await alive.check(), [], 'counted from when this host started it');
  clock.t += HOUR;
  assert.equal((await alive.check()).length, 1);
  assert.equal(started.length, 3);
});

test('a pause made since the last scan wins, and at most three run at once across the drive', async () => {
  const files = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((n) => [n, hourly()]));
  const convos = [];
  let t = AT_730;
  // Scans once in ten hours, so the pause below is in the file, not the scan.
  const alive = createAlive({
    store: { list: async () => Object.keys(files).map((path) => ({ kind: 'doc', path, modified: 1 })), read: async (p) => files[p] },
    zone: ZONE, now: () => t, scanMs: 10 * HOUR, schedule: null, log: { log() {}, error() {} },
    conversations: async () => convos,
    start: async (run) => {
      convos.push({ title: run.title, target: run.target, createdAt: t, running: true });
      return { id: run.target };
    },
  });
  await alive.check();
  files.a = files.a.replace('data-marble-on', 'data-marble-paused data-marble-on');
  t += HOUR;
  assert.deepEqual(await alive.check(), ['b', 'c', 'd'], 'a is paused in the file; three at once');
  for (const c of convos) c.running = false;
  t += 60_000;
  assert.deepEqual(await alive.check(), ['e']);
});

test('nudges on every request look at the drive at most every so often', async () => {
  let lists = 0;
  let t = AT_730;
  const alive = createAlive({
    store: { list: async () => { lists += 1; return []; }, read: async () => null },
    zone: ZONE, now: () => t, scanMs: 0, schedule: null, log: { log() {}, error() {} },
    conversations: async () => [], start: async () => ({ id: 'x' }),
  });
  await alive.nudge();
  await alive.nudge();
  t += 5_000;
  await alive.nudge();
  assert.equal(lists, 1);
  t += 20_000;
  await alive.nudge();
  assert.equal(lists, 2);
});
