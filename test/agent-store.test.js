import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { conversationOf, createAgentStore, needsReview, summarize } from '../server/agent/store.js';

const fresh = async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-agents-'));
  const store = createAgentStore({ dir, defaultProvider: 'claude-subscription' });
  await store.ready();
  return { dir, store };
};

test('a conversation is created, read back and listed', async () => {
  const { store } = await fresh();
  const meta = await store.createConversation({ provider: 'cursor', model: 'composer-2.5' });
  assert.match(meta.id, /^[0-9a-f]{12}$/);
  assert.equal((await store.conversation(meta.id)).provider, 'cursor');
  const listed = await store.conversations();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, 'new');
  assert.equal(listed[0].needsReview, false);
  assert.equal(listed[0].queued, false);
});

test('events are numbered in order even when appended at once, and the first message titles the conversation', async () => {
  const { store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  await Promise.all([
    store.appendEvent(id, { type: 'user', text: 'Turn the open questions into a sortable research backlog, please, today' }),
    store.appendEvent(id, { type: 'turn.queued' }),
    store.appendEvent(id, { type: 'text', text: 'ok' }),
  ]);
  const events = await store.events(id);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual((await store.events(id, { after: 2 })).map((e) => e.seq), [3]);
  assert.equal((await store.conversation(id)).title, 'Turn the open questions into a sortable research backlog, pl');
});

test('a user event records the document the conversation is editing', async () => {
  const { store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  await store.appendEvent(id, { type: 'user', text: 'hello', context: { target: 'notes/garden' } });
  assert.equal((await store.conversation(id)).target, 'notes/garden');
  assert.equal((await store.summary(id)).target, 'notes/garden');
  await store.appendEvent(id, { type: 'user', text: 'again', context: { target: 'inbox' } });
  assert.equal((await store.conversation(id)).target, 'inbox');
});

test('turns are numbered per conversation and updated in place', async () => {
  const { store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  const one = await store.createTurn(id, { prompt: 'a', context: { target: 'doc' } });
  const two = await store.createTurn(id, { prompt: 'b', context: { target: 'doc' } });
  assert.equal(one.id, `${id}-t1`);
  assert.equal(two.n, 2);
  assert.equal(conversationOf(two.id), id);
  await store.updateTurn(one.id, { status: 'completed', applied: 3 });
  assert.equal((await store.turn(one.id)).applied, 3);
  assert.deepEqual((await store.turns(id)).map((t) => t.n), [1, 2]);
});

test('undo records and raw lines are kept per turn', async () => {
  const { dir, store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  const turn = await store.createTurn(id, { prompt: 'a', context: {} });
  assert.equal(await store.undoRecords(turn.id), null);
  await store.saveUndo(turn.id, [{ path: 'doc', steps: [] }]);
  assert.deepEqual(await store.undoRecords(turn.id), [{ path: 'doc', steps: [] }]);
  await store.appendRaw(turn.id, '{"a":1}');
  assert.equal(await fsp.readFile(path.join(dir, id, 'raw', `${turn.id}.jsonl`), 'utf8'), '{"a":1}\n');
});

test('a restart turns unfinished work into interrupted work, and says so', async () => {
  const { dir, store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  const running = await store.createTurn(id, { prompt: 'a', context: {} });
  await store.updateTurn(running.id, { status: 'running' });
  await store.updateConversation(id, { running: true });
  const done = await store.createTurn(id, { prompt: 'b', context: {} });
  await store.updateTurn(done.id, { status: 'completed' });

  const again = createAgentStore({ dir, defaultProvider: 'fake' });
  await again.ready();
  const interrupted = await again.interruptUnfinished();
  assert.deepEqual(interrupted.map((t) => t.id), [running.id]);
  const meta = await again.conversation(id);
  assert.equal(meta.running, false);
  assert.equal(meta.lastOutcome, 'interrupted');
  assert.equal((await again.events(id)).at(-1).type, 'turn.interrupted');
  assert.equal((await again.conversations())[0].needsReview, true);
});

test('archived conversations are listed only when asked for', async () => {
  const { store } = await fresh();
  const { id } = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(id, { archived: true });
  assert.equal((await store.conversations()).length, 0);
  assert.equal((await store.conversations({ archived: true })).length, 1);
});

test('a conversation keeps the model and effort it was started with', async () => {
  const { store } = await fresh();
  const meta = await store.createConversation({ provider: 'fake', model: 'm1', effort: 'high' });
  assert.equal((await store.conversation(meta.id)).effort, 'high');
  await store.updateConversation(meta.id, { model: 'm2', effort: 'low' });
  const next = await store.conversation(meta.id);
  assert.equal(next.model, 'm2');
  assert.equal(next.effort, 'low');
});

test('a conversation keeps the CLI mode Shift+Tab picked', async () => {
  const { store } = await fresh();
  const meta = await store.createConversation({ provider: 'cursor', model: 'cursor-grok-4.6', effort: 'xhigh', mode: 'plan' });
  assert.equal((await store.conversation(meta.id)).mode, 'plan');
  await store.updateConversation(meta.id, { mode: 'ask' });
  assert.equal((await store.conversation(meta.id)).mode, 'ask');
  assert.equal((await store.summary(meta.id)).mode, 'ask');
});

test('settings have defaults and keep what was saved', async () => {
  const { store } = await fresh();
  assert.deepEqual(await store.settings(), { defaultProvider: 'claude-subscription', models: {}, efforts: {}, maxRunning: 3 });
  await store.saveSettings({ defaultProvider: 'cursor', models: { cursor: 'composer-2.5' } });
  assert.equal((await store.settings()).models.cursor, 'composer-2.5');
});

test('needs review: changes, failures and interruptions nobody has looked at', () => {
  const base = { lastFinishedAt: 100, lastReviewedAt: null, running: false };
  assert.equal(needsReview({ ...base, lastOutcome: 'changes' }), true);
  assert.equal(needsReview({ ...base, lastOutcome: 'done' }), false);
  assert.equal(needsReview({ ...base, lastOutcome: 'cancelled' }), false);
  assert.equal(needsReview({ ...base, lastOutcome: 'failed', lastReviewedAt: 150 }), false);
  assert.equal(needsReview({ ...base, lastOutcome: 'watchdog', lastReviewedAt: 50 }), true);
  assert.equal(summarize({ ...base, running: true, lastOutcome: 'changes' }).status, 'running');
  assert.equal(summarize({ ...base }).queued, false);
  assert.equal(summarize({ ...base, queued: true }).queued, true);
  assert.equal(summarize({ ...base, queued: true }).status, 'new');
});

test('a conversation with a queued turn is listed as queued, even when it is not running', async () => {
  const { store } = await fresh();
  const running = await store.createConversation({ provider: 'fake' });
  const waiting = await store.createConversation({ provider: 'fake' });
  const active = await store.createTurn(running.id, { prompt: 'a', context: {} });
  await store.updateTurn(active.id, { status: 'running' });
  await store.updateConversation(running.id, { running: true });
  const queued = await store.createTurn(waiting.id, { prompt: 'b', context: {} });
  assert.equal(queued.status, 'queued');

  const listed = await store.conversations();
  const waitingSummary = listed.find((c) => c.id === waiting.id);
  const runningSummary = listed.find((c) => c.id === running.id);
  assert.equal(waitingSummary.running, false);
  assert.equal(waitingSummary.queued, true);
  assert.equal(waitingSummary.status, 'new');
  assert.equal(runningSummary.queued, false);
  assert.equal(runningSummary.status, 'running');
  assert.equal((await store.summary(waiting.id)).queued, true);
});

test('destructured use works without this binding', async () => {
  const { store } = await fresh();
  const { saveSettings, settings, updateTurn, interruptUnfinished } = store;
  await saveSettings({ defaultProvider: 'cursor' });
  assert.equal((await settings()).defaultProvider, 'cursor');
  const { id } = await store.createConversation({ provider: 'fake' });
  const turn = await store.createTurn(id, { prompt: 'a', context: {} });
  await updateTurn(turn.id, { status: 'running' });
  assert.equal((await store.turn(turn.id)).status, 'running');
  await store.updateConversation(id, { running: true });
  const interrupted = await interruptUnfinished();
  assert.equal(interrupted.length, 1);
});

test('concurrent saves both land', async () => {
  const { store } = await fresh();
  await Promise.all([
    store.saveSettings({ defaultProvider: 'cursor' }),
    store.saveSettings({ models: { cursor: 'composer-2.5' } }),
  ]);
  const saved = await store.settings();
  assert.equal(saved.defaultProvider, 'cursor');
  assert.equal(saved.models.cursor, 'composer-2.5');
});

// --- Final review: a crash mid-append must not keep the host from booting. ---

test('a truncated last line in events.jsonl is skipped, and the log carries on after it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-agents-'));
  const logged = [];
  const store = createAgentStore({ dir, defaultProvider: 'fake', log: { log() {}, error: (m) => logged.push(m) } });
  await store.ready();
  const { id } = await store.createConversation({ provider: 'fake' });
  await store.appendEvent(id, { type: 'user', text: 'hi' });
  await store.appendEvent(id, { type: 'turn.queued' });
  const turn = await store.createTurn(id, { prompt: 'hi', context: {} });
  await store.updateTurn(turn.id, { status: 'running' });
  // The host died halfway through writing event 3.
  await fsp.appendFile(path.join(dir, id, 'events.jsonl'), '{"seq":3,"t":1,"type":"te');

  // A fresh store, as a restarted host would make.
  const restarted = createAgentStore({ dir, defaultProvider: 'fake', log: { log() {}, error: (m) => logged.push(m) } });
  const interrupted = await restarted.interruptUnfinished();
  assert.equal(interrupted.length, 1);
  const next = await restarted.appendEvent(id, { type: 'text', text: 'after' });
  assert.equal(next.seq, 4, 'numbering continues from the last valid event');
  const events = await restarted.events(id);
  assert.deepEqual(events.map((e) => e.type), ['user', 'turn.queued', 'turn.interrupted', 'text']);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4]);
  assert.equal(logged.filter((m) => /events\.jsonl/.test(m)).length, 1, 'logged once, not on every read');
});

test('a folder is created with exclusive membership, unused color, and a name from targets', async () => {
  const { store } = await fresh();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(a.id, { target: 'Research/Marble/uist' });
  await store.updateConversation(b.id, { target: 'Research/Marble/notes' });
  const folder = await store.createFolder({ conversationIds: [a.id, b.id] });
  assert.match(folder.id, /^[0-9a-f]{12}$/);
  assert.equal(folder.name, 'Marble');
  assert.equal(folder.color, 'research');
  assert.equal((await store.conversation(a.id)).folderId, folder.id);
  assert.equal((await store.conversation(b.id)).folderId, folder.id);
  assert.deepEqual(folder.openIds, [a.id, b.id]);
});

test('moving the last member out dissolves the folder', async () => {
  const { store } = await fresh();
  const a = await store.createConversation({ provider: 'fake' });
  const folder = await store.createFolder({ conversationIds: [a.id], name: 'Solo', color: 'fun' });
  await store.updateConversation(a.id, { folderId: null });
  assert.equal((await store.listFolders()).folders.find((f) => f.id === folder.id), undefined);
  assert.equal((await store.conversation(a.id)).folderId, null);
});

test('createConversation starts ungrouped and unpinned', async () => {
  const { store } = await fresh();
  const meta = await store.createConversation({ provider: 'fake' });
  assert.equal(meta.folderId, null);
  assert.equal(meta.pinned, false);
  assert.equal(meta.focusX, null);
  assert.equal(meta.lastInteractedAt, meta.createdAt);
});
