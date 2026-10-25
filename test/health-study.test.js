// GET /health/study: the probe study's counts of a study drive, from its own
// logs, numbers only. A fixture log with one of each kind of prompt the
// counts tell apart, the ones they leave out, turns that overlap across
// conversations, and lines no count should trip on; then the route, which
// answers only marble-host: on this machine, with the drive's own passphrase.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { countStudy, createStudyHealth, kindOf, marksIn } = await import('../server/health-study.js');
const { buildBrief } = await import('../server/build/brief.js');
const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');

const made = [];
test.after(async () => {
  for (const dir of made) await fsp.rm(dir, { recursive: true, force: true });
});
const tmp = async (prefix) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

const MIN = 60_000;
// 11:00 on 24 October in Los Angeles (18:00 UTC), and 20:00 on the 25th
// there, which is already the 26th in UTC.
const DAY1 = Date.UTC(2026, 9, 24, 18, 0, 0);
const DAY2 = Date.UTC(2026, 9, 26, 3, 0, 0);
const BRIEF = 'Look this paper up by its title and fill "Authors", Venue & Year.\nLeave cells someone typed in alone.';
const SECRETS = ['a typed ask about my thesis', 'my second ask', 'the build note text'];

/** One conversation's events.jsonl, as the agent store writes it. */
async function conversation(root, id, events) {
  const dir = path.join(root, '.marble', 'agents', id);
  await fsp.mkdir(dir, { recursive: true });
  const text = events.map((e, i) => (typeof e === 'string' ? e : JSON.stringify({ seq: i + 1, t: e.t, ...(e.turn ? { turn: e.turn } : {}), ...e }))).join('\n');
  await fsp.writeFile(path.join(dir, 'events.jsonl'), `${text}\n`);
}

const build = buildBrief({
  path: 'Reviews',
  n: 1,
  marks: [
    { type: 'note', anchorId: 'a1', text: 'the build note text\n2. A note on nothing, typed by the person' },
    { type: 'stroke', kind: 'box', ids: ['a2'] },
    { type: 'stroke', kind: 'arrow', from: 'a1', to: 'a3' },
  ],
});
const steer = ['More marks for this build (build 1), made on the app while it runs. Work them into the plan you are on.', '', '1. Ink sketched over #a4', '2. A note on #a5: "bigger"'].join('\n');

/** A drive's logs with one of everything. */
async function fixture(root) {
  await fsp.writeFile(path.join(root, 'Papers.mrbl'), `<!doctype html><html><body data-marble-id="b"><button data-marble-id="f" data-marble-run="Look this paper up by its title and fill &quot;Authors&quot;, Venue &amp; Year.
Leave cells someone typed in alone." data-marble-on="press">Fill</button></body></html>`);
  // A: a typed ask, and its turn of ten minutes.
  await conversation(root, 'aaaaaaaaaaaa', [
    { t: DAY1, type: 'user', turn: 'aaaaaaaaaaaa-t1', text: SECRETS[0], context: { viewing: 'Papers', target: 'Papers', selection: [] } },
    { t: DAY1 + 1000, type: 'turn.queued', turn: 'aaaaaaaaaaaa-t1' },
    { t: DAY1 + 2000, type: 'turn.started', turn: 'aaaaaaaaaaaa-t1' },
    { t: DAY1 + 5 * MIN, type: 'text', turn: 'aaaaaaaaaaaa-t1', text: 'working on it' },
    { t: DAY1 + 10 * MIN, type: 'turn.completed', turn: 'aaaaaaaaaaaa-t1' },
  ]);
  // B: an ask while A worked, and one on the next day, while nothing did.
  await conversation(root, 'bbbbbbbbbbbb', [
    { t: DAY1 + 3 * MIN, type: 'user', turn: 'bbbbbbbbbbbb-t1', text: SECRETS[1] },
    { t: DAY1 + 3 * MIN + 1000, type: 'turn.started', turn: 'bbbbbbbbbbbb-t1' },
    { t: DAY1 + 4 * MIN, type: 'turn.failed', turn: 'bbbbbbbbbbbb-t1', error: 'x' },
    { t: DAY2, type: 'user', turn: 'bbbbbbbbbbbb-t2', text: 'Continue' },
    { t: DAY2 + 1000, type: 'turn.started', turn: 'bbbbbbbbbbbb-t2' },
    { t: DAY2 + MIN, type: 'turn.completed', turn: 'bbbbbbbbbbbb-t2' },
  ]);
  // C: a build of three marks, and two more marks steered into it, while B's
  // second turn ran.
  await conversation(root, 'cccccccccccc', [
    { t: DAY2 + 10_000, type: 'user', turn: 'cccccccccccc-t1', text: build },
    { t: DAY2 + 11_000, type: 'turn.started', turn: 'cccccccccccc-t1' },
    { t: DAY2 + 20_000, type: 'user', turn: 'cccccccccccc-t2', text: steer },
    { t: DAY2 + 30 * MIN, type: 'turn.completed', turn: 'cccccccccccc-t1' },
  ]);
  // D: presses: a button's brief once nothing else ran, a page's own press
  // and an offered action while E's two turns ran, and a build resumed after
  // they had stopped. Its own last turn never says it ended.
  await conversation(root, 'dddddddddddd', [
    { t: DAY2 + 40 * MIN, type: 'user', turn: 'dddddddddddd-t1', text: BRIEF },
    { t: DAY2 + 44.5 * MIN, type: 'user', turn: 'dddddddddddd-t2', text: 'The person pressed "Shuffle" on #deck.' },
    { t: DAY2 + 45.5 * MIN, type: 'user', turn: 'dddddddddddd-t3', text: 'Try 3 variations of this row: denser' },
    { t: DAY2 + 47 * MIN, type: 'user', turn: 'dddddddddddd-t4', text: 'Build mode: build 1 of "Reviews" was paused, and the person has resumed it. Carry on.' },
    { t: DAY2 + 47 * MIN + 1, type: 'turn.started', turn: 'dddddddddddd-t4' },
    { t: DAY2 + 50 * MIN, type: 'tool.call', turn: 'dddddddddddd-t4', name: 'apply_ops' },
  ]);
  // E: what the person never sent: another agent's message, a scheduled
  // run, and the Continue a chat sends itself when its plan runs out. A turn
  // that never ended is cut by the next one, and the last by the last thing
  // its conversation did; the last line is torn.
  await conversation(root, 'eeeeeeeeeeee', [
    { t: DAY2 + 44 * MIN, type: 'user', turn: 'eeeeeeeeeeee-t1', text: 'From the other chat: done', from: { id: 'aaaaaaaaaaaa' } },
    { t: DAY2 + 44 * MIN + 1, type: 'turn.started', turn: 'eeeeeeeeeeee-t1' },
    { t: DAY2 + 45 * MIN, type: 'user', turn: 'eeeeeeeeeeee-t2', text: 'This is a scheduled run (daily 07:00) of the automation on [data-marble-id="f"].' },
    { t: DAY2 + 45 * MIN + 1, type: 'turn.started', turn: 'eeeeeeeeeeee-t2' },
    { t: DAY2 + 46 * MIN, type: 'usage.continued', turn: 'eeeeeeeeeeee-t2', label: 'Sonnet' },
    { t: DAY2 + 46 * MIN + 1, type: 'user', turn: 'eeeeeeeeeeee-t3', text: 'Continue' },
    '{"seq":99,"t":1,"type":"user","text":"torn',
  ]);
  // Neither a conversation nor read: a folder of the agent store's own, and
  // a log that is a link.
  await fsp.mkdir(path.join(root, '.marble', 'agents', 'uploads'), { recursive: true });
  await fsp.writeFile(path.join(root, '.marble', 'agents', 'uploads', 'events.jsonl'), JSON.stringify({ seq: 1, t: DAY1, type: 'user', text: 'not a chat' }));
  await fsp.mkdir(path.join(root, '.marble', 'agents', 'ffffffffffff'));
  await fsp.symlink(path.join(root, '.marble', 'agents', 'aaaaaaaaaaaa', 'events.jsonl'), path.join(root, '.marble', 'agents', 'ffffffffffff', 'events.jsonl'));
}

const EXPECTED = {
  days: 2,
  prompts: 9,
  builds: 1,
  marks: 5,
  buttons: 4,
  conversations: 4,
  singlePromptConversations: 1,
  // B's first while A worked, C's build and steer while B's second ran, and
  // D's press and offer while E's turns ran.
  promptsWhileAnotherWorked: 5,
};

test('the counts: every kind of prompt the person sent, and none they did not', async () => {
  const root = await tmp('study-counts-');
  await fixture(root);
  const counts = await countStudy({ root, zone: 'America/Los_Angeles', now: () => DAY2 + 60 * MIN });
  assert.deepEqual(Object.keys(counts), ['ok', 'at', 'days', 'prompts', 'builds', 'marks', 'buttons', 'conversations', 'singlePromptConversations', 'promptsWhileAnotherWorked']);
  assert.equal(counts.ok, true);
  assert.equal(counts.at, new Date(DAY2 + 60 * MIN).toISOString());
  const { ok: _ok, at: _at, ...rest } = counts;
  assert.deepEqual(rest, EXPECTED);
  // Numbers only, never a word anyone wrote.
  const text = JSON.stringify(counts);
  for (const words of [...SECRETS, 'Continue', 'Shuffle', 'Authors']) assert.ok(!text.includes(words), `the counts hold "${words}"`);
});

test('days are counted in the drive\'s own zone', async () => {
  const root = await tmp('study-zone-');
  // 16:00 and 20:00 on 25 October in Los Angeles: one day there, two in UTC.
  await conversation(root, 'aaaaaaaaaaaa', [
    { t: Date.UTC(2026, 9, 25, 23, 0, 0), type: 'user', turn: 'aaaaaaaaaaaa-t1', text: 'one' },
    { t: Date.UTC(2026, 9, 26, 3, 0, 0), type: 'user', turn: 'aaaaaaaaaaaa-t2', text: 'two' },
  ]);
  assert.equal((await countStudy({ root, zone: 'America/Los_Angeles' })).days, 1);
  assert.equal((await countStudy({ root, zone: 'UTC' })).days, 2);
});

test('a drive with no conversations counts nothing, and says so in numbers', async () => {
  const root = await tmp('study-empty-');
  assert.deepEqual({ ...(await countStudy({ root, now: () => 0 })), at: null }, {
    ok: true, at: null, days: 0, prompts: 0, builds: 0, marks: 0, buttons: 0, conversations: 0, singlePromptConversations: 0, promptsWhileAnotherWorked: 0,
  });
});

test('a build\'s marks are counted by the words brief.js puts each kind in', () => {
  const marks = [
    { type: 'note', anchorId: 'a', first: true, text: 'a tracker' },
    { type: 'note', anchorId: 'a', sent: 'c1', text: 'now' },
    { type: 'note', anchorId: 'a', text: 'a note' },
    { type: 'note', anchorId: 'a', text: '' },
    { type: 'stroke', kind: 'ink', ids: ['a'] },
    { type: 'stroke', kind: 'box', ids: ['a', 'b'] },
    { type: 'stroke', kind: 'arrow', from: 'a', to: 'b' },
    { type: 'move', from: 'a', anchorId: 'b', u: 0.5, v: 0.5 },
    { type: 'comment', anchorId: 'a', thread: [{ who: 'person', text: 'why?' }] },
    { type: 'piece', anchorId: 'a', piece: { id: 'p', title: 'Chart', kind: 'Chart', line: 'a bar chart' } },
  ];
  const pieces = new Map([['p', { html: '<ol>\n1. A note on a list in the markup\n</ol>' }]]);
  const brief = buildBrief({ path: 'App', n: 2, marks, pieces, context: [{ id: 'c9', type: 'comment', anchorId: 'a', thread: [{ who: 'person', text: 'later' }] }] });
  assert.equal(marksIn(brief), marks.length);
  assert.equal(kindOf(brief), 'build');
  assert.equal(kindOf('  Build mode, build 3: change the app'), 'build');
  assert.equal(kindOf('Please make it blue'), 'typed');
  assert.equal(kindOf('Make these words alive: a timer'), 'button');
  assert.equal(kindOf('Automate this row: fill Venue from the title'), 'button');
  assert.equal(kindOf('Merge these two versions of the selected component into a third alternative.'), 'button');
  assert.equal(kindOf('Explore 3 variations of #a in this document.'), 'button');
  assert.equal(kindOf('fill the venues', new Set(['fill the venues'])), 'button');
});

test('the counts are kept five minutes, and counted once when asked twice at once', async () => {
  const root = await tmp('study-kept-');
  await fixture(root);
  let clock = DAY2 + 60 * MIN;
  const health = createStudyHealth({ root, zone: 'America/Los_Angeles', now: () => clock });
  const [first, again] = await Promise.all([health.read(), health.read()]);
  assert.equal(first, again);
  assert.equal(first.prompts, 9);
  await conversation(root, '999999999999', [{ t: clock, type: 'user', turn: '999999999999-t1', text: 'one more' }]);
  clock += 4 * MIN;
  assert.equal((await health.read()).prompts, 9, 'within five minutes, the answer kept');
  clock += 2 * MIN;
  const fresh = await health.read();
  assert.equal(fresh.prompts, 10);
  assert.equal(fresh.at, new Date(clock).toISOString());
});

// ------------------------------------------------------------------ the route

async function served(env = {}) {
  const root = await tmp('study-drive-');
  await fixture(root);
  const config = loadConfig({ MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_SECRET: 'pw-ana-1234', MARBLE_DRIVE_AGENT_KEYS: path.join(root, '..', `${path.basename(root)}-keys`), MARBLE_STUDY: '1', ...env });
  const drive = await createDrive(config, { log: { log() {}, error() {}, info() {} }, agents: false });
  test.after(() => drive.close());
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const ask = (headers = {}, method = 'GET') => fetch(`http://127.0.0.1:${port}/health/study`, { method, headers });
  return { ask };
}

test('/health/study answers marble-host alone: on this machine, with the drive\'s own passphrase', async () => {
  const { ask } = await served();
  const bearer = { authorization: 'Bearer pw-ana-1234' };
  const res = await ask(bearer);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { ok, at, ...rest } = await res.json();
  assert.equal(ok, true);
  assert.match(at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(rest, EXPECTED);

  // Anyone else, another drive on the PC included, finds nothing there.
  const notFound = async (r, why) => {
    assert.equal(r.status, 404, why);
    assert.deepEqual(await r.json(), { error: 'not found' }, why);
  };
  await notFound(await ask(), 'without the passphrase');
  await notFound(await ask({ authorization: 'Bearer pw-bob-5678' }), "with another drive's passphrase");
  await notFound(await ask({ cookie: 'marble_drive=1.x' }), 'with a cookie instead');
  for (const forwarded of [{ 'x-forwarded-for': '203.0.113.9' }, { 'x-forwarded-host': 'ana.marbledrive.app' }, { 'cf-ray': 'abc' }, { forwarded: 'for=203.0.113.9' }]) {
    await notFound(await ask({ ...bearer, ...forwarded }), `through ${Object.keys(forwarded)[0]}`);
  }
  await notFound(await ask(bearer, 'POST'), 'by another method');
});

test('/health/study is not there on a drive outside the study', async () => {
  const { ask } = await served({ MARBLE_STUDY: '' });
  const res = await ask({ authorization: 'Bearer pw-ana-1234' });
  assert.equal(res.status, 404);
});
