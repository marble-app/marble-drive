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
};

async function setup({ limits = {}, tools } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const store = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'fake' });
  await store.ready();
  const published = [];
  const toolCalls = [];
  const runner = createRunner({
    store,
    tools: tools ?? { call: async (name, input, turn) => { toolCalls.push({ name, input, turn: turn.id }); return { ok: true }; } },
    providers: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
    workdir: path.join(dir, 'work'),
    origin: () => 'http://127.0.0.1:1',
    bridgePath: '/nonexistent/marble-mcp.js',
    readDocument: async () => '<html><body data-marble-id="b"><p data-marble-id="p">hi</p></body></html>',
    publish: (conversationId, event) => published.push({ conversationId, event }),
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200, ...limits },
    log: { log() {}, error() {} },
  });
  await runner.boot();
  return { store, runner, published, toolCalls };
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
