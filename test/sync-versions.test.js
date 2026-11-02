// Every document has a version, and every edit names the one it was made on
// (Marble Sync, step 2, the host's half):
//
//   1. versions: one per accepted batch, durable in the op log, rebuilt on
//      start, served in the page and in a header; restores, creates and
//      outside writes are batches;
//   2. writes: a batch is rebased over what its sender had not seen, with
//      the document's engine kept open between batches; the answer says what
//      merged, forked and dropped, and `stale` when the ring cannot reach;
//   3. frames: `event: batch` with `id: v` to everyone but the sender,
//      catch-up by `GET /ops?since`, replay by Last-Event-ID;
//   4. agents: a read records the version, apply_ops names it, a stale base
//      is rebased rather than refused;
//   5. one socket per tab: every stream over GET /sync/ws, with the same auth.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket } from 'ws';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-versions-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';
delete process.env.MARBLE_OPLOG_SEGMENT_BYTES;

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createTools } = await import('../server/agent/tools.js');
const { useCore, hasCore } = await import('../server/rebase.js');
const { guardOps } = await import('../server/engine.js');

const quiet = { log() {}, error() {}, info() {}, warn() {} };
const boot = async (env = {}) => {
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: ROOT, ...env }), { log: quiet, agents: false });
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  return { drive, port, base: `http://127.0.0.1:${port}` };
};
let { drive, port, base } = await boot();
test.after(async () => {
  await drive.close();
  await fsp.rm(ROOT, { recursive: true, force: true });
});

const SOURCE = `<!doctype html>
<html data-marble-id="root"><head><title>Versions</title></head>
<body data-marble-id="b0">
  <h1 data-marble-id="h1">Title</h1>
  <p data-marble-id="p1">The quick brown fox</p>
  <p data-marble-id="p2">Second</p>
  <ul data-marble-id="l1">
    <li data-marble-id="i1">One</li>
    <li data-marble-id="i2">Two</li>
  </ul>
</body></html>
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = async (doc, ops, { client = 'tab', batch = null, base: at = null } = {}) => {
  const q = new URLSearchParams({ app: doc, client });
  if (batch) q.set('batch', batch);
  if (at !== null) q.set('base', String(at));
  const res = await fetch(`${base}/ops?${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ops) });
  return { status: res.status, header: res.headers.get('x-marble-version'), body: await res.json() };
};
const file = (doc) => fsp.readFile(path.join(ROOT, `${doc}.mrbl`), 'utf8');
const logLines = async (doc) =>
  (await fsp.readFile(path.join(ROOT, '.marble', `${doc}.ops.jsonl`), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const text = (id, words) => ({ type: 'setText', id, text: words });

/** An SSE reader: every event as { id, event, data }, until close(). */
function listen(url, headers = {}) {
  const controller = new AbortController();
  const events = [];
  const ready = fetch(`${base}${url}`, { signal: controller.signal, headers: { Accept: 'text/event-stream', ...headers } }).then(async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let at;
          while ((at = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const ev = { id: null, event: 'message', data: null };
            for (const line of block.split('\n')) {
              if (line.startsWith('id: ')) ev.id = line.slice(4);
              else if (line.startsWith('event: ')) ev.event = line.slice(7);
              else if (line.startsWith('data: ')) ev.data = line.slice(6);
            }
            if (ev.data !== null) events.push(ev);
          }
        }
      } catch {
        // aborted
      }
    })();
    return res;
  });
  return { events, ready, close: () => controller.abort() };
}
const until = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(20);
  }
  return check();
};

// ---------------------------------------------------------------- 1. versions

test('a create is version 1, every batch one more, and a batch that changes nothing none', async () => {
  await drive.createDocument('v-count', SOURCE, { label: 'test' });
  assert.equal(await drive.versions.current('v-count'), 1);
  const one = await post('v-count', [text('p1', 'One')], { batch: 'c1', base: 1 });
  assert.equal(one.status, 200);
  assert.equal(one.body.v, 2);
  assert.equal(one.header, '2');
  for (const field of ['ok', 'v', 'sha', 'bytes', 'applied', 'ops', 'forks', 'dropped', 'fixes']) assert.ok(field in one.body, field);
  assert.deepEqual(one.body.fixes, []);
  const two = await post('v-count', [text('p2', 'Two')], { batch: 'c2', base: 2 });
  assert.equal(two.body.v, 3);
  const same = await post('v-count', [text('p2', 'Two')], { batch: 'c3', base: 3 });
  assert.equal(same.body.applied, 0);
  assert.equal(same.body.v, 3, 'nothing changed, so no new version');
  const replay = await post('v-count', [text('p2', 'Two')], { batch: 'c2', base: 2 });
  assert.equal(replay.body.replay, true);
  assert.equal(replay.body.v, 3, 'a replay is told the version its batch made');
  assert.equal(await drive.versions.current('v-count'), 3);
});

test('every op-log line of a batch carries its version; a create is a marker line', async () => {
  await drive.createDocument('v-log', SOURCE, { label: 'test' });
  await post('v-log', [text('p1', 'A'), text('p2', 'B')], { batch: 'l1', base: 1 });
  const lines = await logLines('v-log');
  assert.deepEqual(lines.map((l) => [l.v, l.type, l.by]), [[1, 'reset', 'person'], [2, 'setText', 'person'], [2, 'setText', 'person']]);
  // History and anything else reading `since` never sees the markers.
  assert.deepEqual((await drive.oplog.since('v-log')).map((l) => l.type), ['setText', 'setText']);
});

test('a page is served with its version in a meta tag and a header, never in the file', async () => {
  await drive.createDocument('v-serve', SOURCE, { label: 'test' });
  await post('v-serve', [text('h1', 'Served')], { base: 1 });
  const res = await fetch(`${base}/a/v-serve`);
  assert.equal(res.headers.get('x-marble-version'), '2');
  const page = await res.text();
  assert.match(page, /<meta name="marble-version" content="2"/);
  assert.doesNotMatch(await file('v-serve'), /marble-version/);
});

test('the version survives a restart, rebuilt from the newest op-log line (sealed segments too)', async () => {
  await drive.createDocument('v-restart', SOURCE, { label: 'test' });
  for (let i = 0; i < 4; i += 1) await post('v-restart', [text('p1', `n${i}`)], { base: 1 + i });
  assert.equal(await drive.versions.current('v-restart'), 5);
  // Seal the active segment, the way a long log is cut.
  const dir = path.join(ROOT, '.marble');
  await fsp.rename(path.join(dir, 'v-restart.ops.jsonl'), path.join(dir, 'v-restart@1-2.ops.jsonl'));
  await drive.close();
  ({ drive, port, base } = await boot());
  assert.equal(await drive.versions.current('v-restart'), 5);
  const page = await fetch(`${base}/a/v-restart`);
  assert.equal(page.headers.get('x-marble-version'), '5');
  const next = await post('v-restart', [text('p1', 'after')], { base: 5 });
  assert.equal(next.body.v, 6);
});

test('a restore is a batch: the version goes up and the log says so', async () => {
  await drive.createDocument('v-restore', SOURCE, { label: 'test' });
  await post('v-restore', [text('p1', 'changed')], { base: 1 });
  const history = await drive.store.history('v-restore');
  const back = history.find((h) => h.label === 'test' || h.label === 'created') ?? history[0];
  const res = await fetch(`${base}/restore?app=v-restore&sha=${back.sha}`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(await drive.versions.current('v-restore'), 3);
  const last = (await logLines('v-restore')).at(-1);
  assert.equal(last.type, 'reset');
  assert.equal(last.by, 'restore');
  assert.equal(last.v, 3);
});

test('an outside write is a batch of its own, with the ops that say it', async () => {
  await drive.createDocument('v-outside', SOURCE, { label: 'test' });
  await drive.snapshot('v-outside');
  const sse = listen('/events?app=v-outside&client=watcher&since=1');
  await sse.ready;
  await fsp.writeFile(path.join(ROOT, 'v-outside.mrbl'), SOURCE.replace('Second', 'Second, edited by hand'));
  assert.ok(await until(() => sse.events.some((e) => e.event === 'batch'), 5000), 'heard the outside batch');
  sse.close();
  const frame = JSON.parse(sse.events.find((e) => e.event === 'batch').data);
  assert.equal(frame.v, 2);
  assert.equal(frame.by, 'outside');
  assert.equal(frame.client, 'outside');
  assert.ok(frame.ops.some((op) => op.type === 'setText' && op.id === 'p2'));
  const line = (await logLines('v-outside')).at(-1);
  assert.equal(line.v, 2);
  assert.equal(line.client, 'outside');
});

// ------------------------------------------------------------------ 2. writes

test('the engine stays open between batches while the file is still the one this host wrote', async () => {
  await drive.createDocument('v-engine', SOURCE, { label: 'test' });
  await post('v-engine', [text('p1', 'first')], { base: 1 });
  const state = await drive.versions.stateOf('v-engine');
  const doc = state.doc;
  assert.ok(doc, 'an open engine');
  await post('v-engine', [text('p1', 'second')], { base: 2 });
  assert.equal(state.doc, doc, 'the same engine, moved on');
  assert.equal(doc.source, await file('v-engine'));
  // A file changed under it is taken in first, and the batch lands on top.
  await fsp.writeFile(path.join(ROOT, 'v-engine.mrbl'), (await file('v-engine')).replace('Title', 'Retitled outside'));
  const after = await post('v-engine', [text('p2', 'third')], { base: 3 });
  assert.equal(after.body.v, 5, 'the outside write was version 4');
  const now = await file('v-engine');
  assert.match(now, /Retitled outside/);
  assert.match(now, /third/);
});

test('a batch is rebased over exactly the batches after its base from other clients', async () => {
  const seen = [];
  const was = useCore({
    rebaseBatch(doc, ops, options) {
      seen.push({ ops, concurrent: options.concurrent, client: options.client, by: options.by });
      const source = guardOps(doc, ops);
      return { ops, forks: [], dropped: [], fixIds: [], record: { client: options.client, by: options.by, changes: ops.map((op) => ({ op: op.type, id: op.id, kind: 'text' })) }, source };
    },
  });
  try {
    await drive.createDocument('v-window', SOURCE, { label: 'test' });
    await post('v-window', [text('p1', 'a')], { client: 'a', base: 1 }); // v2
    await post('v-window', [text('p2', 'b')], { client: 'b', base: 2 }); // v3
    await post('v-window', [text('h1', 'a again')], { client: 'a', base: 2 }); // v4
    seen.length = 0;
    await post('v-window', [text('i1', 'c')], { client: 'c', base: 1 });
    assert.deepEqual(seen[0].concurrent.map((r) => r.client), ['a', 'b', 'a']);
    seen.length = 0;
    await post('v-window', [text('i2', 'a3')], { client: 'a', base: 2 });
    assert.deepEqual(seen[0].concurrent.map((r) => r.client), ['b', 'c'], 'its own batches are not concurrent with it');
    seen.length = 0;
    await post('v-window', [text('i2', 'now')], { client: 'b' });
    assert.deepEqual(seen[0].concurrent, [], 'no base: made on the current version');
  } finally {
    useCore(was);
  }
});

test('what the core forked, dropped and fixed comes back to the sender as forks, dropped and fixes', async () => {
  const was = useCore({
    rebaseBatch(doc, ops, options) {
      if (!options.concurrent.length) {
        return { ops, forks: [], dropped: [], fixIds: [], record: { client: options.client, changes: [] }, source: guardOps(doc, ops) };
      }
      // Stand-in rule: wrap p1 in a fresh-id <marble-alt> and drop op 1.
      const canonical = [{ type: 'insert', parentId: 'b0', beforeId: 'p1', html: '<marble-alt data-marble-id="w1"></marble-alt>' }, { type: 'move', id: 'p1', parentId: 'w1', beforeId: null }];
      const source = guardOps(doc, canonical);
      return { ops: canonical, forks: [{ id: 'p1', wrapper: 'w1' }], dropped: [{ index: 1, reason: 'removed' }], fixIds: ['b0'], record: { client: options.client, changes: [] }, source };
    },
  });
  try {
    await drive.createDocument('v-fixes', SOURCE, { label: 'test' });
    await post('v-fixes', [text('p1', 'theirs')], { client: 'a', base: 1 });
    const res = await post('v-fixes', [text('p1', 'mine'), text('gone', 'x')], { client: 'b', base: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.forks, [{ id: 'p1', wrapper: 'w1' }]);
    assert.deepEqual(res.body.dropped, [{ index: 1, reason: 'removed' }]);
    assert.equal(res.body.fixes.length, 1);
    assert.equal(res.body.fixes[0].id, 'b0');
    assert.match(res.body.fixes[0].html, /^<body data-marble-id="b0">[\s\S]*<marble-alt data-marble-id="w1">\s*<p data-marble-id="p1">theirs<\/p>\s*<\/marble-alt>[\s\S]*<\/body>$/, 'the fixed element, as it now is');
  } finally {
    useCore(was);
  }
});

test('a base older than the ring is rebased over nothing and answered stale', async () => {
  await drive.close();
  ({ drive, port, base } = await boot());
  process.env.MARBLE_SYNC_RING_BATCHES = '3';
  try {
    await drive.createDocument('v-stale', SOURCE, { label: 'test' });
    for (let i = 0; i < 5; i += 1) await post('v-stale', [text('p2', `x${i}`)], { client: 'a', base: 1 + i });
    const res = await post('v-stale', [text('h1', 'late')], { client: 'b', base: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.stale, true);
    assert.equal(res.body.applied, 1);
    const fresh = await post('v-stale', [text('h1', 'later')], { client: 'b', base: res.body.v });
    assert.equal(fresh.body.stale, undefined);
  } finally {
    delete process.env.MARBLE_SYNC_RING_BATCHES;
  }
});

test(`two writers on different elements of one version both land, with no fork (${hasCore() ? 'the sync core' : 'the step-1 fallback'})`, async () => {
  await drive.createDocument('v-two', SOURCE, { label: 'test' });
  const [a, b] = await Promise.all([
    post('v-two', [text('p1', 'from a')], { client: 'a', base: 1 }),
    post('v-two', [text('p2', 'from b')], { client: 'b', base: 1 }),
  ]);
  assert.deepEqual([a.body.forks, b.body.forks], [[], []]);
  const now = await file('v-two');
  assert.match(now, /from a/);
  assert.match(now, /from b/);
  assert.doesNotMatch(now, /marble-alt/);
});

// ------------------------------------------------------------------ 3. frames

test('a batch is a frame with id v to every versioned listener but its sender; legacy listeners hear ops and changed', async () => {
  await drive.createDocument('v-frames', SOURCE, { label: 'test' });
  const sender = listen('/events?app=v-frames&client=s&since=1');
  const other = listen('/events?app=v-frames&client=o&since=1');
  const legacy = listen('/events?app=v-frames&client=l');
  await Promise.all([sender.ready, other.ready, legacy.ready]);
  await post('v-frames', [text('p1', 'framed')], { client: 's', batch: 'f1', base: 1 });
  assert.ok(await until(() => other.events.some((e) => e.event === 'batch') && legacy.events.some((e) => e.data === 'changed')));
  await sleep(100);
  const frame = other.events.find((e) => e.event === 'batch');
  assert.equal(frame.id, '2');
  assert.deepEqual(JSON.parse(frame.data), { v: 2, client: 's', batch: 'f1', ops: [text('p1', 'framed')], by: 'person' });
  assert.ok(!sender.events.some((e) => e.event === 'batch'), 'the sender learns from its answer');
  assert.ok(!other.events.some((e) => e.event === 'ops' || e.data === 'changed'), 'no legacy frames to a versioned listener');
  assert.ok(legacy.events.some((e) => e.event === 'ops'));
  assert.ok(!legacy.events.some((e) => e.event === 'batch'));
  for (const s of [sender, other, legacy]) s.close();
});

test('catch-up: GET /ops?since says every batch after it, oldest first; a reset when it cannot', async () => {
  await drive.createDocument('v-catch', SOURCE, { label: 'test' });
  await post('v-catch', [text('p1', 'one')], { client: 'a', batch: 'k1', base: 1 });
  await post('v-catch', [text('p2', 'two')], { client: 'b', batch: 'k2', base: 2 });
  const res = await fetch(`${base}/ops?app=v-catch&since=1`);
  assert.equal(res.headers.get('x-marble-version'), '3');
  assert.deepEqual(await res.json(), {
    v: 3,
    batches: [
      { v: 2, client: 'a', batch: 'k1', by: 'person', ops: [text('p1', 'one')] },
      { v: 3, client: 'b', batch: 'k2', by: 'person', ops: [text('p2', 'two')] },
    ],
  });
  assert.deepEqual(await (await fetch(`${base}/ops?app=v-catch&since=3`)).json(), { v: 3, batches: [] });
  assert.deepEqual(await (await fetch(`${base}/ops?app=v-catch&since=0`)).json(), { v: 3, reset: true }, 'version 1 was a whole document');
  assert.deepEqual(await (await fetch(`${base}/ops?app=v-catch&since=9`)).json(), { v: 3, reset: true });
  assert.equal((await fetch(`${base}/ops?app=v-catch&since=x`)).status, 400);
  // After a restart, from the op log.
  await drive.close();
  ({ drive, port, base } = await boot());
  const again = await (await fetch(`${base}/ops?app=v-catch&since=1`)).json();
  assert.deepEqual(again.batches.map((b) => [b.v, b.batch]), [[2, 'k1'], [3, 'k2']]);
});

test('a subscription with Last-Event-ID (or since) hears what it missed first, then live ones', async () => {
  await drive.createDocument('v-replay', SOURCE, { label: 'test' });
  await post('v-replay', [text('p1', 'missed 1')], { client: 'a', base: 1 });
  await post('v-replay', [text('p2', 'missed 2')], { client: 'a', base: 2 });
  const back = listen('/events?app=v-replay&client=r', { 'Last-Event-ID': '1' });
  await back.ready;
  assert.ok(await until(() => back.events.filter((e) => e.event === 'batch').length >= 2));
  await post('v-replay', [text('h1', 'live')], { client: 'a', base: 3 });
  assert.ok(await until(() => back.events.filter((e) => e.event === 'batch').length >= 3));
  assert.deepEqual(back.events.filter((e) => e.event === 'batch').map((e) => e.id), ['2', '3', '4']);
  back.close();
});

// ------------------------------------------------------------------ 4. agents

test('an agent edit on a stale base is rebased, not refused, and says what became of it', async () => {
  await drive.createDocument('v-agent', SOURCE, { label: 'test' });
  const tools = createTools({ store: drive.store, writeOps: drive.writeOps, snapshot: drive.snapshot, createDocument: drive.createDocument, onLook: () => {} });
  const turn = { id: 't1', conversationId: 'c0ffee000001', writable: new Set(['v-agent']), undo: [], onEvent() {}, quiet: false };
  const read = await tools.call('read_document', { path: 'v-agent' }, turn);
  assert.equal(read.whole, true);
  assert.equal(tools.readBase('c0ffee000001', 'v-agent'), 1, 'the read recorded its version');
  // A person changes the page after the agent read it.
  await post('v-agent', [text('p2', 'the person typed here')], { client: 'tab', base: 1 });
  await post('v-agent', [{ type: 'remove', id: 'i2' }], { client: 'tab', base: 2 });
  // The agent edits another element, and one the person removed, on its old base.
  const answer = await tools.call('apply_ops', { path: 'v-agent', note: 'Retitle', ops: [text('h1', 'Agent title'), text('i2', 'gone now')] }, turn);
  assert.equal(answer.refused, undefined, JSON.stringify(answer));
  assert.equal(answer.applied, 1);
  assert.deepEqual(answer.dropped, [{ index: 1, op: 'setText', id: 'i2', reason: 'removed' }]);
  const now = await file('v-agent');
  assert.match(now, /Agent title/);
  assert.match(now, /the person typed here/, 'the person kept their words');
  // Never read: still asked to read first.
  const unread = await tools.call('apply_ops', { path: 'v-agent', note: 'x', ops: [text('nope', 'x')] }, turn);
  assert.ok(unread.error || unread.refused);
});

test('an agent that edits what a person also changed since its read is merged or forked, never refused', async () => {
  await drive.createDocument('v-agent2', SOURCE, { label: 'test' });
  const tools = createTools({ store: drive.store, writeOps: drive.writeOps, snapshot: drive.snapshot, createDocument: drive.createDocument, onLook: () => {} });
  const turn = { id: 't2', conversationId: 'c0ffee000002', writable: new Set(['v-agent2']), undo: [], onEvent() {}, quiet: false };
  await tools.call('read_document', { path: 'v-agent2' }, turn);
  await post('v-agent2', [text('p1', 'The quick brown fox jumps')], { client: 'tab', base: 1 });
  const answer = await tools.call('apply_ops', { path: 'v-agent2', note: 'Edit', ops: [text('p1', 'A quick brown fox')] }, turn);
  assert.equal(answer.refused, undefined, JSON.stringify(answer));
  assert.ok(answer.applied >= 1);
  assert.ok(answer.merged || answer.forked, 'the answer says what became of it');
  const now = await file('v-agent2');
  assert.match(now, /jumps/, "the person's words are still there");
});

// --------------------------------------------------------- 5. one socket per tab

const socket = (headers = { Origin: base }, url = '/sync/ws') =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${url}`, { headers });
    const frames = [];
    ws.on('message', (m) => frames.push(JSON.parse(String(m))));
    ws.on('open', () => resolve({ ws, frames }));
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode }));
    ws.on('error', () => resolve({ status: 0 }));
  });

test('five streams in one tab share one socket, and each hears what its SSE route says', async () => {
  await drive.createDocument('v-ws', SOURCE, { label: 'test' });
  const before = drive.sockets.counts.upgrades;
  const { ws, frames } = await socket();
  const urls = ['/events?app=v-ws&client=t1&since=1', '/events?drive=1&client=t1', '/events?app=v-count&client=t1&since=3', '/events?app=v-log&client=t1', '/events?app=v-serve&client=t1&since=2'];
  urls.forEach((url, i) => ws.send(JSON.stringify({ t: 'sub', id: `s${i}`, url })));
  assert.ok(await until(() => frames.filter((f) => f.t === 'open').length === 5));
  assert.equal(drive.sockets.counts.upgrades - before, 1, 'one upgrade');
  assert.equal(drive.sockets.counts.streams, 5);
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.sockets.open, 1);
  await post('v-ws', [text('p1', 'over the socket')], { client: 'elsewhere', base: 1 });
  assert.ok(await until(() => frames.some((f) => f.t === 'ev' && f.event === 'batch')));
  const ev = frames.find((f) => f.t === 'ev' && f.event === 'batch');
  assert.equal(ev.id, 's0');
  assert.equal(ev.lastEventId, '2');
  assert.equal(JSON.parse(ev.data).v, 2);
  ws.send(JSON.stringify({ t: 'ping' }));
  assert.ok(await until(() => frames.some((f) => f.t === 'pong')));
  ws.send(JSON.stringify({ t: 'unsub', id: 's0' }));
  assert.ok(await until(() => drive.sockets.counts.streams === 4));
  ws.send(JSON.stringify({ t: 'sub', id: 'bad', url: 'https://elsewhere.example/events' }));
  ws.send(JSON.stringify({ t: 'sub', id: 'none', url: '/not-a-stream' }));
  assert.ok(await until(() => frames.some((f) => f.t === 'err' && f.id === 'bad' && f.status === 400) && frames.some((f) => f.t === 'err' && f.id === 'none' && f.status === 404)));
  ws.close();
  await once(ws, 'close');
  assert.ok(await until(() => drive.sockets.counts.open === 0 && drive.sockets.counts.streams === 0));
});

test('a stream over the socket replays from its lastEventId, as Last-Event-ID does', async () => {
  await drive.createDocument('v-ws-replay', SOURCE, { label: 'test' });
  await post('v-ws-replay', [text('p1', 'a')], { client: 'x', base: 1 });
  await post('v-ws-replay', [text('p1', 'b')], { client: 'x', base: 2 });
  const { ws, frames } = await socket();
  ws.send(JSON.stringify({ t: 'sub', id: 1, url: '/events?app=v-ws-replay&client=y', lastEventId: '1' }));
  assert.ok(await until(() => frames.filter((f) => f.event === 'batch').length === 2));
  assert.deepEqual(frames.filter((f) => f.event === 'batch').map((f) => f.lastEventId), ['2', '3']);
  ws.close();
});

test('the socket is refused from another site, and on a closed drive without a pass; each stream keeps its own auth', async () => {
  assert.equal((await socket({ Origin: 'https://elsewhere.example' })).status, 403);
  await drive.close();
  ({ drive, port, base } = await boot({ MARBLE_DRIVE_SECRET: 'hunter2' }));
  assert.equal((await socket()).status, 401);
  const withBearer = await socket({ Origin: base, Authorization: 'Bearer hunter2' });
  assert.ok(withBearer.ws, 'the passphrase as a bearer opens it');
  withBearer.ws.close();
  const signIn = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'hunter2' }) });
  const cookie = signIn.headers.get('set-cookie').split(';')[0];
  const owner = await socket({ Origin: base, Cookie: cookie });
  assert.ok(owner.ws);
  owner.ws.send(JSON.stringify({ t: 'sub', id: 'd', url: '/events?drive=1&client=o' }));
  assert.ok(await until(() => owner.frames.some((f) => f.t === 'open' && f.id === 'd')));
  owner.ws.close();
  await drive.close();
  ({ drive, port, base } = await boot());
});

test('a share link reads its own page over the socket and nothing else', async () => {
  await drive.close();
  ({ drive, port, base } = await boot({ MARBLE_DRIVE_SECRET: 'hunter2' }));
  await drive.createDocument('Shared', SOURCE, { label: 'test' });
  await drive.createDocument('Private', SOURCE, { label: 'test' });
  const signIn = await fetch(`${base}/gate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'hunter2' }) });
  const owner = signIn.headers.get('set-cookie').split(';')[0];
  const made = await (await fetch(`${base}/drive/shares`, { method: 'POST', headers: { Cookie: owner, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'Shared', role: 'view' }) })).json();
  const opened = await fetch(`${base}${made.link.href}`, { redirect: 'manual', headers: { Accept: 'text/html' } });
  const visitor = opened.headers.get('set-cookie').split(';')[0];
  const { ws, frames } = await socket({ Origin: base, Cookie: visitor });
  assert.ok(ws, 'a reading link opens a socket');
  ws.send(JSON.stringify({ t: 'sub', id: 'mine', url: '/events?app=Shared&client=v1&since=1' }));
  ws.send(JSON.stringify({ t: 'sub', id: 'theirs', url: '/events?app=Private&client=v1' }));
  ws.send(JSON.stringify({ t: 'sub', id: 'drive', url: '/events?drive=1&client=v1' }));
  assert.ok(await until(() => frames.some((f) => f.t === 'open' && f.id === 'mine') && frames.filter((f) => f.t === 'err').length === 2));
  assert.deepEqual(frames.filter((f) => f.t === 'err').map((f) => [f.id, f.status]).sort(), [['drive', 403], ['theirs', 403]]);
  ws.close();
  await drive.close();
  ({ drive, port, base } = await boot());
});

test('the idle sweep closes a stream over the socket as it closes an EventSource', async () => {
  await drive.close();
  ({ drive, port, base } = await boot({ MARBLE_DRIVE_STREAM_UNUSED_MINUTES: '0.005' }));
  await drive.createDocument('v-sweep', SOURCE, { label: 'test' });
  const { ws, frames } = await socket();
  // Its tab is named by another stream on the same socket.
  ws.send(JSON.stringify({ t: 'sub', id: 'a', url: '/events?app=v-sweep&client=z&tab=tabA&since=1' }));
  ws.send(JSON.stringify({ t: 'sub', id: 'b', url: '/events?app=v-sweep&client=z&since=1' }));
  assert.ok(await until(() => frames.filter((f) => f.t === 'open').length === 2));
  assert.ok(await until(() => frames.filter((f) => f.t === 'end').length === 2, 5000), JSON.stringify(frames));
  // Unused, its tab is told to stop until it says it is used (a 204).
  ws.send(JSON.stringify({ t: 'sub', id: 'c', url: '/events?app=v-sweep&client=z&tab=tabA&since=1' }));
  assert.ok(await until(() => frames.some((f) => f.t === 'err' && f.id === 'c' && f.status === 204)));
  ws.close();
  await drive.close();
  ({ drive, port, base } = await boot());
});

test('a version follows its document when it moves', async () => {
  await drive.createDocument('v-move', SOURCE, { label: 'test' });
  await post('v-move', [text('p1', 'moved')], { base: 1 });
  const res = await fetch(`${base}/drive/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'v-move', to: 'v-moved' }) });
  assert.equal(res.status, 200);
  // The rename retitles the page: a batch of its own.
  assert.equal(await drive.versions.current('v-moved'), 3);
  assert.equal((await post('v-moved', [text('p2', 'after the move')], { base: 3 })).body.v, 4);
  assert.equal(await drive.versions.current('v-move'), 0, 'nothing left under the old name');
});

test('a page ahead of the host (its log lost a line) is gone on from, never handed a version twice', async () => {
  await drive.createDocument('v-ahead', SOURCE, { label: 'test' });
  const res = await post('v-ahead', [text('p1', 'ahead')], { client: 'a', base: 4 });
  assert.equal(res.body.v, 5);
  assert.deepEqual(await (await fetch(`${base}/ops?app=v-ahead&since=2`)).json(), { v: 5, reset: true }, 'the versions skipped cannot be replayed');
  assert.equal((await post('v-ahead', [text('p1', 'way ahead')], { client: 'a', base: 999_999 })).body.v, 6, 'but not past all reason');
});

test('fixes: a forked element is answered under its own id with its whole wrapper, outermost only; a gone one is empty', async () => {
  const { fixesOf } = await import('../server/rebase.js');
  const { openDocument } = await import('../server/engine.js');
  const doc = openDocument(`<!doctype html><html><head></head><body data-marble-id="b"><div data-marble-id="d"><marble-alt data-marble-id="w"><p data-marble-id="x">a</p><p data-marble-id="y">b</p></marble-alt></div><p data-marble-id="z">z</p></body></html>`);
  assert.deepEqual(fixesOf(doc, [], [{ id: 'x', wrapper: 'w' }]), [{ id: 'x', html: '<marble-alt data-marble-id="w"><p data-marble-id="x">a</p><p data-marble-id="y">b</p></marble-alt>' }]);
  assert.deepEqual(fixesOf(doc, ['d', 'y'], [{ id: 'x', wrapper: 'w' }]).map((f) => f.id), ['d'], 'inside d, so d says it');
  assert.deepEqual(fixesOf(doc, ['gone', 'z'], []), [{ id: 'gone', html: '' }, { id: 'z', html: '<p data-marble-id="z">z</p>' }]);
});
