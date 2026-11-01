// Saves that are idempotent, honest and paced (Marble Sync, step 1):
//
//   - a batch sent twice with the same id lands once;
//   - /ops answers 4xx only for what a retry could not fix, 5xx otherwise;
//   - the host knows its own save however late its watcher looks;
//   - an outside write is taken in inside the document's queue, even when a
//     batch reads the file before the watcher does;
//   - restore points come at a human pace, and op logs in segments.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-sync-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';
delete process.env.MARBLE_HISTORY_MIN_INTERVAL_MS;
delete process.env.MARBLE_OPLOG_SEGMENT_BYTES;

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { timelineOf } = await import('../server/build/history.js');

const said = [];
const log = { log: (m) => said.push(String(m)), error: (m) => said.push(String(m)) };
const drive = await createDrive(loadConfig(), { log, agents: false });
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;

const items = (n) => Array.from({ length: n }, (_, i) => `    <li data-marble-id="i${i}">Item ${i}</li>`).join('\n');
const SOURCE = `<!doctype html>
<html data-marble-id="root"><head><title>Sync</title></head>
<body data-marble-id="b0">
  <h1 data-marble-id="h1">Title</h1>
  <p data-marble-id="p1">Words</p>
  <ul data-marble-id="l1">
${items(30)}
  </ul>
</body></html>
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = (doc, body, { client = 'tab', batch = null, raw = false } = {}) =>
  fetch(`${base}/ops?app=${encodeURIComponent(doc)}&client=${client}${batch ? `&batch=${batch}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
const file = (doc) => fsp.readFile(path.join(ROOT, `${doc}.mrbl`), 'utf8');
const count = (text, needle) => text.split(needle).length - 1;
const insert = (text) => [{ type: 'insert', parentId: 'l1', beforeId: null, html: `<li>${text}</li>` }];

// ----------------------------------------------------------- 1. idempotent

test('the same batch id twice lands once, and the second answer says it is a replay', async () => {
  await drive.createDocument('idem', SOURCE, { label: 'test' });
  const first = await post('idem', insert('Once only'), { batch: 'b-0001' });
  assert.equal(first.status, 200);
  const one = await first.json();
  for (const field of ['sha', 'bytes', 'applied', 'forks']) assert.ok(field in one, field);
  assert.equal(one.applied, 1);
  assert.equal(one.replay, undefined);

  const second = await post('idem', insert('Once only'), { batch: 'b-0001' });
  assert.equal(second.status, 200);
  const two = await second.json();
  assert.equal(two.replay, true);
  assert.equal(two.applied, 1);
  assert.equal(two.sha, one.sha);
  assert.equal(two.bytes, one.bytes);
  assert.deepEqual(two.forks, []);
  assert.equal(count(await file('idem'), 'Once only'), 1);

  // The op log carries the id; the replay filed nothing.
  const lines = await drive.oplog.since('idem');
  assert.deepEqual(lines.map((l) => l.batch), ['b-0001']);
});

test('without a batch id a repeat applies again, as it always has', async () => {
  await drive.createDocument('plain', SOURCE, { label: 'test' });
  assert.equal((await post('plain', insert('Twice'))).status, 200);
  assert.equal((await post('plain', insert('Twice'))).status, 200);
  assert.equal(count(await file('plain'), 'Twice'), 2);
});

test('a batch id is per client: another tab with the same id is its own batch', async () => {
  await drive.createDocument('per-client', SOURCE, { label: 'test' });
  await post('per-client', insert('From A'), { client: 'tabA', batch: 'same' });
  const other = await (await post('per-client', insert('From B'), { client: 'tabB', batch: 'same' })).json();
  assert.equal(other.replay, undefined);
  assert.match(await file('per-client'), /From A[\s\S]*From B/);
});

test('a retry that arrives while the first is still queued is still applied once', async () => {
  await drive.createDocument('inflight', SOURCE, { label: 'test' });
  const [a, b] = await Promise.all([
    post('inflight', insert('Racing'), { batch: 'race-1' }),
    post('inflight', insert('Racing'), { batch: 'race-1' }),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  const answers = [await a.json(), await b.json()];
  assert.equal(answers.filter((r) => r.replay).length, 1);
  assert.equal(count(await file('inflight'), 'Racing'), 1);
});

test('a failed write is not remembered, so its retry lands', async () => {
  await drive.createDocument('flaky', SOURCE, { label: 'test' });
  const write = drive.store.write;
  drive.store.write = async () => {
    throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
  };
  try {
    const failed = await post('flaky', insert('Retried'), { batch: 'f-1' });
    assert.equal(failed.status, 503, 'out of disk is worth a retry');
    assert.equal((await failed.json()).reason, 'internal');
    drive.store.write = async () => {
      throw new Error('a bug in the host');
    };
    const crashed = await post('flaky', insert('Retried'), { batch: 'f-1' });
    assert.equal(crashed.status, 500);
  } finally {
    drive.store.write = write;
  }
  const retried = await (await post('flaky', insert('Retried'), { batch: 'f-1' })).json();
  assert.equal(retried.applied, 1);
  assert.equal(retried.replay, undefined);
  assert.equal(count(await file('flaky'), 'Retried'), 1);
});

test('a restarted host still knows the batches in the active op log', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-sync-restart-'));
  const env = { ...process.env, MARBLE_DRIVE_ROOT: root };
  try {
    const first = await createDrive(loadConfig(env), { log: { log() {}, error() {} }, agents: false });
    await first.createDocument('kept', SOURCE, { label: 'test' });
    const landed = await first.writeOps('kept', insert('Before restart'), { client: 'tab', batch: 'r-1' });
    assert.equal(landed.applied, 1);
    await first.close();

    const again = await createDrive(loadConfig(env), { log: { log() {}, error() {} }, agents: false });
    try {
      const replayed = await again.writeOps('kept', insert('Before restart'), { client: 'tab', batch: 'r-1' });
      assert.equal(replayed.replay, true);
      assert.equal(replayed.applied, 1);
      assert.equal(replayed.sha, landed.sha);
      assert.equal(count(await again.store.read('kept'), 'Before restart'), 1);
    } finally {
      await again.close();
    }
  } finally {
    process.env.MARBLE_APPS = ROOT;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------ 2. statuses

test('refusals are 4xx with a reason; a batch id that is not one is refused', async () => {
  await drive.createDocument('codes', SOURCE, { label: 'test' });
  const cases = [
    [post('codes', '{not json', { raw: true }), 422, 'bad-json'],
    [post('codes', { type: 'setText' }), 422, 'not-a-list'],
    [post('codes', [{ type: 'setText', id: 'gone', text: 'x' }]), 409, 'unresolvable'],
    [post('codes', [{ type: 'explode', id: 'h1' }]), 422, 'refused'],
    [post('codes', [{ type: 'setText', id: 'h1', text: 'x' }], { batch: 'has spaces' }), 422, 'bad-batch'],
  ];
  for (const [pending, status, reason] of cases) {
    const res = await pending;
    const body = await res.json();
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(body.reason, reason);
    assert.ok(body.error);
  }
  assert.equal((await post('nowhere', [{ type: 'setText', id: 'h1', text: 'x' }])).status, 404);
  assert.equal(await file('codes'), SOURCE, 'nothing refused was written');
});

// --------------------------------------------- 3. own writes without a clock

test('a host blocked for longer than 5 s still knows its own save: no false fork', async () => {
  await drive.createDocument('blocked', SOURCE, { label: 'test' });
  const ids = ['i3', 'i4', 'i5', 'i6', 'i7'];
  said.length = 0;
  // Write A: the person types into five items.
  await drive.writeOps('blocked', ids.map((id) => ({ type: 'setText', id, text: `A ${id}` })), { client: 'tabA' });
  // Its rename event is on its way; the watcher waits 80 ms for it to settle.
  await sleep(30);
  // Write B holds the event loop for six seconds before it lands — what a
  // merge on a 2 MB page did — so A's settle check runs only afterwards.
  const b = await drive.writeOps('blocked', ids.map((id) => ({ type: 'setText', id, text: `B ${id}` })), {
    client: 'tabA',
    prepare: (source) => {
      const until = Date.now() + 6000;
      while (Date.now() < until) { /* the host is busy */ }
      return { ops: ids.map((id) => ({ type: 'setText', id, text: `B ${id}` })) };
    },
  });
  assert.equal(b.applied, ids.length);
  await sleep(400);
  const after = await file('blocked');
  assert.doesNotMatch(after, /<marble-alt/, 'the host forked against its own save');
  for (const id of ids) assert.match(after, new RegExp(`>B ${id}<`));
  assert.ok(!said.some((m) => /blocked changed outside/.test(m)), said.join('\n'));
});

// -------------------------------------------------- 4. the watcher's queue

test('an outside write a batch reads before the watcher does is still taken in as one', async () => {
  await drive.createDocument('diverge', SOURCE, { label: 'test' });
  const before = (await drive.store.history('diverge')).length;
  // A tool rewrites the file; a batch arrives before the watcher has looked.
  await fsp.writeFile(path.join(ROOT, 'diverge.mrbl'), SOURCE.replace('>Words<', '>Words from a tool<'));
  const res = await post('diverge', [{ type: 'setText', id: 'h1', text: 'Typed title' }], { client: 'tab' });
  assert.equal(res.status, 200);
  await sleep(300);
  const after = await file('diverge');
  assert.match(after, />Words from a tool</, 'the outside change stays');
  assert.match(after, />Typed title</, 'the batch landed on top of it');
  const history = await drive.store.history('diverge');
  assert.ok(history.length > before);
  assert.ok(history.some((h) => h.label === 'pre-external'), 'a restore point from before the outside write');
  // And what that restore point holds is the document before the tool touched it.
  const pre = history.find((h) => h.label === 'pre-external');
  assert.equal(await drive.store.snapshot('diverge', pre.sha), SOURCE);
});

test('an outside write that lands while a batch is queued is merged after it, not over it', async () => {
  await drive.createDocument('queued', SOURCE, { label: 'test' });
  const slow = drive.writeOps('queued', [{ type: 'setText', id: 'h1', text: 'Slow title' }], {
    client: 'tab',
    prepare: async () => {
      await sleep(300);
      return { ops: [{ type: 'setText', id: 'h1', text: 'Slow title' }] };
    },
  });
  await sleep(20);
  // While the batch is still deciding, a tool rewrites another part.
  const disk = await file('queued');
  await fsp.writeFile(path.join(ROOT, 'queued.mrbl'), disk.replace('>Words<', '>Tool words<'));
  await slow;
  await sleep(400);
  const after = await file('queued');
  assert.match(after, /Tool words/);
  assert.match(after, /Slow title/);
});

test('a move waits for the batch already deciding, so the old name is not written back', async () => {
  await drive.createDocument('moving', SOURCE, { label: 'test' });
  const slow = drive.writeOps('moving', [{ type: 'setText', id: 'h1', text: 'Landed first' }], {
    client: 'tab',
    prepare: async () => {
      await sleep(200);
      return { ops: [{ type: 'setText', id: 'h1', text: 'Landed first' }] };
    },
  });
  await sleep(20);
  const moved = await fetch(`${base}/drive/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'moving', to: 'moved-away' }),
  });
  assert.equal(moved.status, 200);
  assert.equal((await slow).applied, 1);
  assert.equal(await drive.store.has('moving'), false, 'nothing written back under the old name');
  assert.match(await drive.store.read('moved-away'), /Landed first/);
});

test('a watcher that fails says so, with the document', async () => {
  await drive.createDocument('loud', SOURCE, { label: 'test' });
  const mark = drive.store.mark;
  drive.store.mark = async () => {
    throw new Error('history disk unplugged');
  };
  said.length = 0;
  try {
    await fsp.writeFile(path.join(ROOT, 'loud.mrbl'), SOURCE.replace('Title', 'Edited'));
    for (let i = 0; i < 40 && !said.some((m) => /unplugged/.test(m)); i += 1) await sleep(50);
  } finally {
    drive.store.mark = mark;
  }
  assert.ok(said.some((m) => /loud/.test(m) && /unplugged/.test(m)), said.join('\n'));
});

// ------------------------------------------------- 5. restore points' pace

test('fifty quick edits keep at most two restore points; a labelled write always keeps one', async () => {
  await drive.createDocument('paced', SOURCE, { label: 'test' });
  const start = (await drive.store.history('paced')).length;
  for (let i = 0; i < 50; i += 1) {
    const res = await post('paced', [{ type: 'setText', id: `i${i % 30}`, text: `Edit ${i}` }], { client: 'typist' });
    assert.equal(res.status, 200);
  }
  const made = (await drive.store.history('paced')).length - start;
  assert.ok(made >= 1 && made <= 2, `${made} restore points for 50 edits`);

  // Someone else starting to write keeps one of what they start from.
  await post('paced', [{ type: 'setText', id: 'h1', text: 'Other hand' }], { client: 'other' });
  assert.equal((await drive.store.history('paced')).length, start + made + 1);

  // A restore is labelled, so it keeps one; and it still works.
  const [newest] = await drive.store.history('paced');
  const res = await fetch(`${base}/restore?app=paced&sha=${newest.sha}`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(await file('paced'), await drive.store.snapshot('paced', newest.sha));
  const after = await drive.store.history('paced');
  assert.equal(after[0].label, 'before-restore');
});

test('build mode history still finds the restore point before each edit session', async () => {
  await drive.createDocument('timeline', SOURCE, { label: 'test' });
  for (let i = 0; i < 10; i += 1) await post('timeline', [{ type: 'setText', id: 'p1', text: `Draft ${i}` }], { client: 'writer' });
  await post('timeline', [{ type: 'setText', id: 'h1', text: 'By another' }], { client: 'second' });
  const entries = timelineOf({
    lines: await drive.oplog.since('timeline', { limit: 4000 }),
    checkpoints: await drive.store.history('timeline'),
  });
  const edits = entries.filter((e) => e.kind === 'edit');
  assert.equal(edits.length, 2);
  for (const edit of edits) {
    assert.ok(edit.before, `${edit.said} has a way back`);
    assert.ok(await drive.store.snapshot('timeline', edit.before));
  }
});

test('MARBLE_HISTORY_MIN_INTERVAL_MS sets the pace', async () => {
  await drive.createDocument('every', SOURCE, { label: 'test' });
  process.env.MARBLE_HISTORY_MIN_INTERVAL_MS = '0';
  try {
    for (let i = 0; i < 5; i += 1) await post('every', [{ type: 'setText', id: 'p1', text: `Each ${i}` }], { client: 'typist' });
  } finally {
    delete process.env.MARBLE_HISTORY_MIN_INTERVAL_MS;
  }
  assert.equal((await drive.store.history('every')).length, 5);
});

// ------------------------------------------------------ 6. op log segments

test('the op log rotates into sealed segments that follow a move, and replays still work', async () => {
  await drive.createDocument('logged', SOURCE, { label: 'test' });
  process.env.MARBLE_OPLOG_SEGMENT_BYTES = '1500';
  try {
    for (let i = 0; i < 25; i += 1) {
      const res = await post('logged', [{ type: 'setText', id: `i${i}`, text: `Logged ${i} ${'z'.repeat(40)}` }], { batch: `log-${i}` });
      assert.equal(res.status, 200);
    }
  } finally {
    delete process.env.MARBLE_OPLOG_SEGMENT_BYTES;
  }
  const marble = path.join(ROOT, '.marble');
  const sealed = (await fsp.readdir(marble)).filter((n) => /^logged@\d+-\d+(-\d+)?\.ops\.jsonl$/.test(n));
  assert.ok(sealed.length >= 2, `sealed: ${sealed}`);
  assert.ok((await fsp.stat(path.join(marble, 'logged.ops.jsonl'))).size < 1500 + 400);
  assert.equal((await drive.oplog.since('logged', { limit: 4000 })).length, 25);

  const replay = await (await post('logged', [{ type: 'setText', id: 'i24', text: 'again' }], { batch: 'log-24' })).json();
  assert.equal(replay.replay, true);

  const moved = await fetch(`${base}/drive/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'logged', to: 'archive/logged' }),
  });
  assert.equal(moved.status, 200);
  const left = (await fsp.readdir(marble)).filter((n) => n.startsWith('logged@'));
  assert.deepEqual(left, [], 'no segment left under the old name');
  assert.equal((await drive.oplog.since('archive/logged', { limit: 4000 })).length, 25);
  await post('archive/logged', [{ type: 'setText', id: 'h1', text: 'After the move' }]);
  assert.equal((await drive.oplog.since('archive/logged', { limit: 4000 })).length, 26);
});

test.after(async () => {
  await drive.close();
  await fsp.rm(ROOT, { recursive: true, force: true });
});
