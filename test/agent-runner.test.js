import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRunner } from '../server/agent/runner.js';
import { createAgentStore } from '../server/agent/store.js';
import { createFakeProvider } from './fixtures/fake-provider.js';

const SCRIPTS = {
  hello: [{ say: 'Hello from the fake agent' }],
  slow: [{ sleep: 600 }, { say: 'done sleeping' }],
  stall: [{ silent: 5_000 }],
  stubborn: [{ ignoreTerm: true }, { silent: 5_000 }],
  broken: [{ fail: 'You have hit your usage limit' }],
  forgetful: [{ lostWhenResumed: 'No conversation found with session ID: x' }, { say: 'fresh' }],
  noop: [{ say: 'done' }],
};

async function setup({ limits = {}, tools, onLook, capability, projects = null } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const store = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'fake' });
  await store.ready();
  const driveRoot = path.join(dir, 'drive');
  await fsp.mkdir(driveRoot, { recursive: true });
  const published = [];
  const toolCalls = [];
  const provider = createFakeProvider({ scripts: SCRIPTS });
  if (capability) provider.capability = capability;
  const spawned = [];
  const spawn = provider.spawn.bind(provider);
  provider.spawn = (opts) => {
    spawned.push(opts);
    return spawn(opts);
  };
  const runner = createRunner({
    store,
    tools: tools ?? { call: async (name, input, turn) => { toolCalls.push({ name, input, turn: turn.id }); return { ok: true }; } },
    providers: new Map([['fake', provider]]),
    workdir: path.join(dir, 'work'),
    driveRoot,
    projects: projects ?? { find: async (id) => (!id || id === 'drive' ? { id: 'drive', name: 'Drive', path: driveRoot, builtIn: true } : null) },
    origin: () => 'http://127.0.0.1:1',
    bridgePath: '/nonexistent/marble-mcp.js',
    readDocument: async () => '<html><body data-marble-id="b"><p data-marble-id="p">hi</p></body></html>',
    publish: (conversationId, event) => published.push({ conversationId, event }),
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200, ...limits },
    log: { log() {}, error() {} },
    onLook,
  });
  await runner.boot();
  return { store, runner, published, toolCalls, spawned };
}

const until = async (check, ms = 5_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out');
};

const finished = (store, turnId) =>
  until(async () => {
    const turn = await store.turn(turnId);
    return turn && !['queued', 'running'].includes(turn.status) ? turn : null;
  });

test('a turn runs, streams into the transcript, and completes', async () => {
  const { store, runner, published } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello\nsay hi', context: { target: 'doc', selection: ['p'] } });
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'completed');

  const types = (await store.events(id)).map((e) => e.type);
  assert.deepEqual(types, ['user', 'turn.queued', 'turn.started', 'text', 'text', 'turn.completed']);
  const texts = (await store.events(id)).filter((e) => e.type === 'text').map((e) => e.text);
  assert.equal(texts[0], 'prompt:script:hello', 'the prompt reached the agent on stdin');
  assert.ok(published.some((p) => p.event.type === 'text.delta'), 'deltas are published live');
  assert.ok(!(await store.events(id)).some((e) => e.type === 'text.delta'), 'and never stored');
  assert.match((await store.conversation(id)).providerSession, /^fake-/);
  await runner.close();
});

test('a turn tapes off the selection while it runs, then clears it', async () => {
  const looks = [];
  const { store, runner } = await setup({
    onLook: (doc, ids, client, extra) => looks.push({ doc, ids, client, extra }),
  });
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello', context: { target: 'notes', selection: ['p'] } });
  await until(() => looks.some((look) => look.extra?.phase === 'working'));
  const start = looks.find((look) => look.extra?.phase === 'working');
  assert.equal(start.doc, 'notes');
  assert.deepEqual(start.ids, ['p']);
  assert.equal(start.client, `agent:${id}`);
  await finished(store, turnId);
  assert.ok(looks.some((look) => look.ids.length === 0 && !look.extra?.phase), 'turn end clears the zone');
  await runner.close();
});

test('the prompt carries the target and the selected source', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello', context: { target: 'notes', viewing: 'reading', selection: ['p'] } });
  await finished(store, turnId);
  const turn = await store.turn(turnId);
  assert.match(turn.context.selectionSource, /<p data-marble-id="p">hi<\/p>/);
  await runner.close();
});

test('the next turn resumes the provider session', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  await finished(store, (await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } })).turnId);
  const session = (await store.conversation(id)).providerSession;
  await finished(store, (await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } })).turnId);
  assert.equal((await store.conversation(id)).providerSession, session);
  await runner.close();
});

test('one conversation runs one turn at a time; the next waits its turn', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const second = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  assert.equal(first.status, 'running');
  assert.equal(second.status, 'queued');
  const a = await finished(store, first.turnId);
  const b = await finished(store, second.turnId);
  assert.ok(b.startedAt >= a.finishedAt);
  await runner.close();
});

test('maxRunning caps turns across conversations', async () => {
  const { store, runner } = await setup({ limits: { maxRunning: 1 } });
  const one = await store.createConversation({ provider: 'fake' });
  const two = await store.createConversation({ provider: 'fake' });
  const a = await runner.send(one.id, { prompt: 'script:slow', context: { target: 'd' } });
  const b = await runner.send(two.id, { prompt: 'script:hello', context: { target: 'd' } });
  assert.equal(b.status, 'queued');
  await finished(store, a.turnId);
  assert.equal((await finished(store, b.turnId)).status, 'completed');
  await runner.close();
});

test('a queued turn can be removed before it starts', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const running = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const queued = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  assert.equal(await runner.dequeue(queued.turnId), true);
  assert.equal((await store.turn(queued.turnId)).status, 'removed');
  await finished(store, running.turnId);
  await runner.close();
});

test('cancel stops the process and ends the turn cancelled', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  assert.equal(await runner.cancel(turnId), true);
  assert.equal((await finished(store, turnId)).status, 'cancelled');
  await runner.close();
});

test('a process that ignores SIGTERM is killed after the grace period', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stubborn', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await runner.cancel(turnId);
  assert.equal((await finished(store, turnId)).status, 'cancelled');
  await runner.close();
});

test('silence past the stall limit fails the turn', async () => {
  const { store, runner } = await setup({ limits: { stallMs: 300 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'failed');
  assert.match(turn.error, /stalled/);
  await runner.close();
});

test('a provider error reaches the person verbatim', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:broken', context: { target: 'd' } });
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'failed');
  assert.equal(turn.error, 'You have hit your usage limit');
  assert.equal((await store.conversation(id)).lastOutcome, 'failed');
  await runner.close();
});

test('a tool call is accepted only with a running turn’s token', async () => {
  const { store, runner, toolCalls } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  // The token is minted a moment after the turn starts running.
  const live = await until(() => (runner.running()[0]?.token ? runner.running()[0] : null));
  assert.match(live.token, /^[0-9a-f]{64}$/);
  assert.deepEqual(await runner.callTool(live.token, 'read_document', { path: 'd' }), { ok: true });
  assert.equal(toolCalls[0].turn, turnId);
  assert.equal(await runner.callTool('nope', 'read_document', {}), null);
  await runner.cancel(turnId);
  await finished(store, turnId);
  assert.equal(await runner.callTool(live.token, 'read_document', {}), null, 'the token died with the turn');
  await runner.close();
});

test('the watchdog flags every running turn and marks it for review', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  runner.watchdog('d', 'a'.repeat(64));
  await finished(store, turnId);
  const flagged = (await store.events(id)).find((e) => e.type === 'watchdog');
  assert.equal(flagged.path, 'd');
  assert.equal(flagged.sha, 'a'.repeat(64));
  assert.equal((await store.conversation(id)).lastOutcome, 'watchdog');
  await runner.close();
});

test('an unknown provider fails the turn instead of throwing', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'gone' });
  const { turnId } = await runner.send(id, { prompt: 'x', context: { target: 'd' } });
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'failed');
  assert.match(turn.error, /no provider "gone"/);
  await runner.close();
});

// --- Fix round 1: four review findings, each with its own test. ---

test('an in-flight tool call finishes — with its undo record — before cancel ends the turn', async () => {
  const { store, runner } = await setup({
    tools: {
      call: async (name, input, turn) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        turn.undo.push({ path: 'd', kind: 'test' });
        turn.onEvent({ type: 'ops.applied', path: 'd', count: 1 });
        return { ok: true };
      },
    },
  });
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  const live = await until(() => (runner.running()[0]?.token ? runner.running()[0] : null));
  runner.callTool(live.token, 'apply_ops', {}); // deliberately not awaited — cancel races it
  assert.equal(await runner.cancel(turnId), true);
  const turn = await finished(store, turnId);
  assert.equal(turn.status, 'cancelled');
  assert.equal(turn.applied, 1, 'the in-flight call is allowed to finish and record what it applied');
  assert.ok(await store.undoRecords(turnId), 'its undo record was saved');
  const types = (await store.events(id)).map((e) => e.type);
  assert.ok(types.indexOf('ops.applied') < types.indexOf('turn.cancelled'), 'the undo landed before the turn closed out');
  await runner.close();
});

test('cancelling while the process is still starting up never spawns it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const store = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'slow-prepare' });
  await store.ready();
  let spawnCalled = false;
  const provider = {
    id: 'slow-prepare',
    label: 'Slow',
    detect: async () => ({ installed: true, signedIn: true, detail: '' }),
    prepare: () => new Promise((resolve) => setTimeout(resolve, 300)),
    spawn() {
      spawnCalled = true;
      return { command: process.execPath, args: ['-e', 'process.exit(0)'], env: {}, stdin: '' };
    },
    parse: () => [],
  };
  const runner = createRunner({
    store,
    tools: { call: async () => ({ ok: true }) },
    providers: new Map([['slow-prepare', provider]]),
    workdir: path.join(dir, 'work'),
    origin: () => 'http://127.0.0.1:1',
    bridgePath: '/nonexistent/marble-mcp.js',
    readDocument: async () => null,
    publish: () => {},
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200 },
    log: { log() {}, error() {} },
  });
  await runner.boot();
  const { id } = await store.createConversation({ provider: 'slow-prepare' });
  // `send` doesn't return until `start` does, and `start` doesn't return
  // until `prepare` does — so cancel has to race it, not follow it.
  const sending = runner.send(id, { prompt: 'x', context: { target: 'd' } });
  const live = await until(() => (runner.running()[0] ? runner.running()[0] : null));
  assert.equal(await runner.cancel(live.id), true);
  await sending;
  const turn = await finished(store, live.id);
  assert.equal(turn.status, 'cancelled');
  assert.equal(spawnCalled, false, 'provider.spawn must never run once the turn is cancelled');
  await runner.close();
});

test('a store error while starting fails only that turn; another conversation still runs', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const realStore = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'fake' });
  await realStore.ready();
  const bad = await realStore.createConversation({ provider: 'fake' });
  const good = await realStore.createConversation({ provider: 'fake' });

  let armed = true;
  const store = {
    ...realStore,
    async updateConversation(convId, patch) {
      if (armed && convId === bad.id) {
        armed = false;
        throw new Error('synthetic store failure');
      }
      return realStore.updateConversation(convId, patch);
    },
  };

  const runner = createRunner({
    store,
    tools: { call: async () => ({ ok: true }) },
    providers: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
    workdir: path.join(dir, 'work'),
    origin: () => 'http://127.0.0.1:1',
    bridgePath: '/nonexistent/marble-mcp.js',
    readDocument: async () => null,
    publish: () => {},
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200 },
    log: { log() {}, error() {} },
  });
  await runner.boot();

  const badSend = await runner.send(bad.id, { prompt: 'script:hello', context: { target: 'd' } });
  const goodSend = await runner.send(good.id, { prompt: 'script:hello', context: { target: 'd' } });

  await finished(realStore, goodSend.turnId);
  assert.equal((await realStore.turn(goodSend.turnId)).status, 'completed');
  assert.ok(!runner.running().some((t) => t.id === badSend.turnId), 'the failed turn is no longer live');
  await runner.close();
});

test('published events land in call order, deltas included', async () => {
  const { store, runner, published } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  await finished(store, turnId);
  const mine = published.filter((p) => p.conversationId === id);
  const seqs = mine.map((p) => p.event.seq).filter((s) => s !== undefined);
  for (let i = 1; i < seqs.length; i += 1) {
    assert.ok(seqs[i] > seqs[i - 1], `seq ${seqs[i]} did not follow ${seqs[i - 1]}`);
  }
  const promptIdx = mine.findIndex((p) => p.event.type === 'text' && p.event.text === 'prompt:script:hello');
  const deltaIdx = mine.findIndex((p) => p.event.type === 'text.delta');
  assert.ok(promptIdx !== -1 && deltaIdx !== -1, 'both events were published');
  assert.ok(deltaIdx > promptIdx, 'the delta arrived after the prompt echo that preceded it');
  await runner.close();
});

// --- Fix round 2: a finishing turn must keep occupying its slot. ---

test('a finishing turn keeps its place until its own cleanup is actually done', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { store, runner } = await setup({
    tools: {
      call: async (name, input, turn) => {
        await gate;
        turn.undo.push({ path: 'd', kind: 'test' });
        turn.onEvent({ type: 'ops.applied', path: 'd', count: 1 });
        return { ok: true };
      },
    },
  });
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  const live = await until(() => (runner.running()[0]?.token ? runner.running()[0] : null));
  runner.callTool(live.token, 'apply_ops', {}); // not awaited; blocked on the gate
  assert.equal(await runner.cancel(first.turnId), true);

  // Turn 1 is cancelled but still draining that call — it must still be
  // occupying its conversation's slot, so turn 2 has to queue, not start.
  const second = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  assert.equal(second.status, 'queued', 'turn 2 must wait for turn 1 to actually finish, not just look cancelled');

  release();
  const t1 = await finished(store, first.turnId);
  const t2 = await finished(store, second.turnId);
  assert.equal(t1.status, 'cancelled');
  assert.equal(t2.status, 'completed');
  assert.ok(t2.startedAt >= t1.finishedAt, "turn 2 only started once turn 1's cleanup actually finished");
  assert.equal((await store.conversation(id)).lastOutcome, 'done', "turn 2's outcome is the one left standing, not turn 1's stale one");
  await runner.close();
});

// --- Fix round 3: a turn must leave the runner even when the store fails. ---

test('a turn leaves the runner even when the store fails while finishing it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const realStore = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'fake' });
  await realStore.ready();
  const { id } = await realStore.createConversation({ provider: 'fake' });

  let failedOnce = false;
  const store = {
    ...realStore,
    async updateTurn(turnId, patch) {
      if (!failedOnce && patch.finishedAt) {
        failedOnce = true;
        throw new Error('synthetic store failure');
      }
      return realStore.updateTurn(turnId, patch);
    },
  };

  const runner = createRunner({
    store,
    tools: { call: async () => ({ ok: true }) },
    providers: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
    workdir: path.join(dir, 'work'),
    origin: () => 'http://127.0.0.1:1',
    bridgePath: '/nonexistent/marble-mcp.js',
    readDocument: async () => null,
    publish: () => {},
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200 },
    log: { log() {}, error() {} },
  });
  await runner.boot();

  await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  // The store write that would normally end the turn threw. It must not
  // stay parked in the runner forever, holding its conversation (and a
  // maxRunning slot) hostage.
  await until(() => runner.running().length === 0);

  const second = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  assert.equal(second.status, 'running', "the conversation's slot must be free for the next turn");
  const t2 = await finished(realStore, second.turnId);
  assert.equal(t2.status, 'completed');
  await runner.close();
});

// --- Fix round 4: a turn's terminal status is the last thing written. ---

test('once a turn reads as finished, its outcome and closing event are already stored', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const realStore = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'fake' });
  await realStore.ready();
  const { id } = await realStore.createConversation({ provider: 'fake' });

  // The instant the runner writes a terminal status, record what a poller
  // that saw that status would be able to read.
  const snapshots = [];
  const store = {
    ...realStore,
    async updateTurn(turnId, patch) {
      if (patch.status && !['queued', 'running'].includes(patch.status)) {
        snapshots.push({
          status: patch.status,
          types: (await realStore.events(id)).map((e) => e.type),
          conversation: await realStore.conversation(id),
          undo: await realStore.undoRecords(turnId),
        });
      }
      return realStore.updateTurn(turnId, patch);
    },
  };

  const runner = createRunner({
    store,
    tools: {
      call: async (name, input, turn) => {
        turn.undo.push({ path: 'd', kind: 'test' });
        turn.onEvent({ type: 'ops.applied', path: 'd', count: 1 });
        return { ok: true };
      },
    },
    providers: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
    workdir: path.join(dir, 'work'),
    origin: () => 'http://127.0.0.1:1',
    bridgePath: '/nonexistent/marble-mcp.js',
    readDocument: async () => null,
    publish: () => {},
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200 },
    log: { log() {}, error() {} },
  });
  await runner.boot();

  // A completed turn, flagged by the watchdog.
  const first = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  runner.watchdog('d', 'a'.repeat(64));
  await finished(realStore, first.turnId);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].status, 'completed');
  assert.equal(snapshots[0].types.at(-1), 'turn.completed', 'the closing event was stored before the status');
  assert.equal(snapshots[0].conversation.lastOutcome, 'watchdog', 'the outcome was stored before the status');
  assert.equal(snapshots[0].conversation.running, false);

  // A cancelled turn whose tool call applied something.
  const second = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  const live = await until(() => (runner.running()[0]?.token ? runner.running()[0] : null));
  await runner.callTool(live.token, 'apply_ops', {});
  await runner.cancel(second.turnId);
  await finished(realStore, second.turnId);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1].status, 'cancelled');
  assert.equal(snapshots[1].types.at(-1), 'turn.cancelled');
  assert.equal(snapshots[1].conversation.lastOutcome, 'cancelled');
  assert.ok(snapshots[1].undo, 'the undo record was saved before the status');
  await runner.close();
});

// --- Final review: applied work stays undoable if the host goes away. ---

const applyingTools = {
  call: async (name, input, turn) => {
    turn.undo.push({ path: 'd', steps: [{ inverse: null, id: null, expect: null, absent: null }] });
    turn.onEvent({ type: 'ops.applied', path: 'd', count: 1 });
    return { ok: true };
  },
};

test('an undo record is on disk as soon as a batch applies, while the turn is still running', async () => {
  const { store, runner } = await setup({ tools: applyingTools });
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  const live = await until(() => (runner.running()[0]?.token ? runner.running()[0] : null));
  await runner.callTool(live.token, 'apply_ops', {});
  await runner.callTool(live.token, 'apply_ops', {});
  const records = await until(async () => {
    const saved = await store.undoRecords(turnId);
    const steps = Array.isArray(saved) ? saved : saved?.steps;
    return steps?.length === 2 ? saved : null;
  }, 2_000);
  const steps = Array.isArray(records) ? records : records.steps;
  assert.equal(steps.length, 2);
  assert.equal((await store.turn(turnId)).status, 'running', 'saved before the turn ended');
  await runner.close();
});

test('close() ends a running turn as cancelled before it resolves', async () => {
  const { store, runner } = await setup({ tools: applyingTools });
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:stall', context: { target: 'd' } });
  const live = await until(() => (runner.running()[0]?.token ? runner.running()[0] : null));
  await runner.callTool(live.token, 'apply_ops', {});
  await runner.close();
  const turn = await store.turn(turnId);
  assert.equal(turn.status, 'cancelled', 'not left reading running for the next boot to call interrupted');
  assert.equal(turn.error, 'host closing');
  assert.equal(turn.applied, 1);
  assert.ok(await store.undoRecords(turnId), 'its undo record was kept');
  assert.equal((await store.conversation(id)).running, false);
});

test('cancel works on a queued turn when called without the runner as `this`', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const running = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const queued = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  const { cancel } = runner;
  assert.equal(await cancel(queued.turnId), true);
  assert.equal((await store.turn(queued.turnId)).status, 'removed');
  await finished(store, running.turnId);
  await runner.close();
});

// --- Final review: the child's environment is the runner's to build. ---

test('the process gets the allowlisted environment plus what the provider adds, and never the drive secret', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const store = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'bare' });
  await store.ready();
  const printEnv = (id, env) => ({
    id,
    label: id,
    detect: async () => ({ installed: true, signedIn: true, detail: '' }),
    spawn: () => ({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(JSON.stringify(process.env) + "\\n")'],
      ...(env ? { env } : {}),
      stdin: '',
    }),
    parse: (line) => [{ type: 'text', text: line }],
  });
  const runner = createRunner({
    store,
    tools: { call: async () => ({ ok: true }) },
    providers: new Map([['bare', printEnv('bare', null)], ['extra', printEnv('extra', { MARBLE_DRIVE_SECRET: 'x', FOO: 'y' })]]),
    workdir: path.join(dir, 'work'),
    origin: () => 'http://127.0.0.1:1',
    bridgePath: '/nonexistent/marble-mcp.js',
    readDocument: async () => null,
    publish: () => {},
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200 },
    log: { log() {}, error() {} },
  });
  await runner.boot();

  const saved = { secret: process.env.MARBLE_DRIVE_SECRET, foo: process.env.FOO, key: process.env.SOME_API_KEY };
  process.env.MARBLE_DRIVE_SECRET = 'hunter2';
  process.env.FOO = 'inherited';
  process.env.SOME_API_KEY = 'sk-inherited';
  const envOf = async (provider) => {
    const { id } = await store.createConversation({ provider });
    const { turnId } = await runner.send(id, { prompt: 'x', context: { target: 'd' } });
    await finished(store, turnId);
    return JSON.parse((await store.events(id)).find((e) => e.type === 'text').text);
  };
  try {
    const bare = await envOf('bare');
    assert.equal(bare.MARBLE_DRIVE_SECRET, undefined);
    assert.equal(bare.FOO, undefined, 'nothing is inherited past the allowlist');
    assert.equal(bare.SOME_API_KEY, undefined);
    assert.equal(bare.PATH, process.env.PATH);
    assert.equal(bare.MARBLE_AGENT_TOKEN.length, 64, 'the bridge still gets its token');

    const extra = await envOf('extra');
    assert.equal(extra.MARBLE_DRIVE_SECRET, undefined, 'not even when the provider asks for it');
    assert.equal(extra.FOO, 'y');
    assert.equal(extra.SOME_API_KEY, undefined);
  } finally {
    for (const [name, value] of [['MARBLE_DRIVE_SECRET', saved.secret], ['FOO', saved.foo], ['SOME_API_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await runner.close();
  }
});

test('a session the provider has lost is dropped, so the next turn starts a new one', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const send = async () => finished(store, (await runner.send(id, { prompt: 'script:forgetful', context: { target: 'd' } })).turnId);

  assert.equal((await send()).status, 'completed');
  const lost = (await store.conversation(id)).providerSession;
  assert.match(lost, /^fake-/);

  const failed = await send();
  assert.equal(failed.status, 'failed');
  assert.equal(
    failed.error,
    'No conversation found with session ID: x — the provider no longer has this conversation\'s session; the next message starts a new one',
  );
  assert.equal((await store.conversation(id)).providerSession, null);

  const next = await send();
  assert.equal(next.status, 'completed', 'the next turn is not resumed, so it runs');
  const fresh = (await store.conversation(id)).providerSession;
  assert.match(fresh, /^fake-/);
  assert.notEqual(fresh, lost);
  await runner.close();
});

test('an ordinary failure on a resumed turn keeps the session', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  await finished(store, (await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } })).turnId);
  const session = (await store.conversation(id)).providerSession;
  const failed = await finished(store, (await runner.send(id, { prompt: 'script:broken', context: { target: 'd' } })).turnId);
  assert.equal(failed.error, 'You have hit your usage limit');
  assert.equal((await store.conversation(id)).providerSession, session);
  await runner.close();
});

test('a full turn\'s disk write is not recorded on a sibling full turn', async () => {
  const sha = 'a'.repeat(64);
  const { store, runner } = await setup({ capability: 'full' });
  const notes = await store.createConversation({ provider: 'fake' });
  const garden = await store.createConversation({ provider: 'fake' });
  await runner.send(notes.id, { prompt: 'script:slow', context: { target: 'notes' } });
  await runner.send(garden.id, { prompt: 'script:slow', context: { target: 'garden' } });
  await until(() => runner.running().length === 2);

  const claimed = runner.documentTouched('notes', sha);
  assert.equal(claimed, notes.id);

  await until(async () => (await store.events(notes.id)).some((e) => e.type === 'document.changed'));
  const onNotes = (await store.events(notes.id)).filter((e) => e.type === 'document.changed');
  const onGarden = (await store.events(garden.id)).filter((e) => e.type === 'document.changed' || e.type === 'watchdog');
  assert.equal(onNotes.length, 1);
  assert.equal(onNotes[0].path, 'notes');
  assert.equal(onGarden.length, 0, 'the other conversation must not wear this write');

  for (const turn of runner.running()) await runner.cancel(turn.id);
  await runner.close();
});

test('an outside write flags only the documents turn that owns that path', async () => {
  const sha = 'b'.repeat(64);
  const { store, runner } = await setup();
  const watched = await store.createConversation({ provider: 'fake' });
  const other = await store.createConversation({ provider: 'fake' });
  await runner.send(watched.id, { prompt: 'script:slow', context: { target: 'watched' } });
  await runner.send(other.id, { prompt: 'script:slow', context: { target: 'garden' } });
  await until(() => runner.running().length === 2);

  runner.watchdog('watched', sha);

  await until(async () => (await store.events(watched.id)).some((e) => e.type === 'watchdog'));
  assert.ok((await store.events(watched.id)).some((e) => e.type === 'watchdog' && e.path === 'watched'));
  assert.equal((await store.events(other.id)).some((e) => e.type === 'watchdog'), false);

  for (const turn of runner.running()) await runner.cancel(turn.id);
  await runner.close();
});

test('the composed prompt names other documents that are also in view', async () => {
  const { store, runner, spawned } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  await finished(store, (await runner.send(id, {
    prompt: 'script:hello',
    context: { target: 'notes', viewing: 'reading', also: ['garden', 'board'] },
  })).turnId);
  const prompt = spawned[0]?.prompt ?? '';
  assert.match(prompt, /The person is viewing: reading/);
  assert.match(prompt, /The document you may edit: notes/);
  assert.match(prompt, /Also in view: garden, board/);
  await runner.close();
});

test('a full turn runs in its project, and is told about the document only as context', async () => {
  const repo = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-repo-'));
  const projects = { find: async (id) => (id === 'p1' ? { id: 'p1', name: 'Repo', path: repo, builtIn: false } : id === 'drive' || !id ? { id: 'drive', name: 'Drive', path: '/drive', builtIn: true } : null) };
  const { store, runner, spawned } = await setup({ capability: 'full', projects });
  const { id } = await store.createConversation({ provider: 'fake', project: 'p1' });
  await runner.send(id, { prompt: 'script:noop', context: { target: 'garden', viewing: 'garden' } });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  const spawn = spawned.at(-1);
  assert.equal(spawn.cwd, repo);
  assert.equal(spawn.kind, 'project');
  assert.equal(spawn.project.id, 'p1');
  assert.match(spawn.prompt, /Sent from Marble Drive\. The person was viewing the document "garden"/);
  assert.doesNotMatch(spawn.prompt, /The document you may edit/);
  await runner.close();
});

test('a drive turn keeps the document context block', async () => {
  const { store, runner, spawned } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:noop', context: { target: 'garden', viewing: 'garden' } });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  assert.equal(spawned.at(-1).kind, 'drive');
  assert.match(spawned.at(-1).prompt, /The document you may edit: garden/);
  await runner.close();
});

test('a conversation whose project is gone fails its turn plainly', async () => {
  const { store, runner } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake', project: 'gone' });
  await runner.send(id, { prompt: 'script:noop', context: { target: 'garden' } });
  const turn = await until(async () => { const t = await store.turn(`${id}-t1`); return t.status === 'failed' ? t : null; });
  assert.match(turn.error, /project "gone" is not registered/);
  await runner.close();
});

test('a turn is told how many other conversations are running in its project, and not about other projects', async () => {
  const { store, runner, spawned } = await setup({ capability: 'full' });
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await runner.send(a.id, { prompt: 'script:slow', context: { target: 'one' } });
  await until(() => runner.running().length === 1);
  await runner.send(b.id, { prompt: 'script:noop', context: { target: 'two' } });
  await until(() => spawned.length === 2);
  assert.match(spawned[1].prompt, /1 other agent conversation\(s\) are running in this project right now/);
  assert.doesNotMatch(spawned[0].prompt, /other agent conversation/);
  for (const turn of runner.running()) await runner.cancel(turn.id);
  await runner.close();
});

test('maxMs of zero never caps a turn', async () => {
  const { store, runner } = await setup({ limits: { maxMs: 0 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:slow', context: { target: 'garden' } });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed', 8_000);
  assert.equal((await store.turn(`${id}-t1`)).error, null);
  await runner.close();
});
