import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MAX_HOP } from '../server/agent/messages.js';
import { createRunner, clipFailure } from '../server/agent/runner.js';
import { createAgentStore } from '../server/agent/store.js';
import { createTools } from '../server/agent/tools.js';
import { createFakeProvider } from './fixtures/fake-provider.js';
import { STAY } from '../server/agent/usage-failover.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('a Cursor model-list dump keeps the sentence and drops the catalog', () => {
  assert.equal(
    clipFailure('Cannot use this model: opus-high. Available models: auto, grok-4.7-high, claude-opus-4-8-medium'),
    'Cannot use this model: opus-high',
  );
});

const SCRIPTS = {
  hello: [{ say: 'Hello from the fake agent' }],
  slow: [{ sleep: 600 }, { say: 'done sleeping' }],
  stall: [{ silent: 5_000 }],
  hold: [{ silent: 20_000 }],
  stubborn: [{ ignoreTerm: true }, { silent: 5_000 }],
  broken: [{ fail: 'You have hit your usage limit' }],
  forgetful: [{ lostWhenResumed: 'No conversation found with session ID: x' }, { say: 'fresh' }],
  noop: [{ say: 'done' }],
  linger: [{ say: 'done' }, { lingerUntilEof: true }],
  // A message sent while a subagent is still working: the result comes first,
  // the subagent finishes after it, and the turn is over only then.
  background: [
    { say: 'dispatched' },
    { bg: 'start', id: 'sub' },
    { done: true },
    { sleep: 700 },
    { bg: 'end', id: 'sub' },
    { say: 'the subagent finished' },
    { lingerUntilEof: true },
  ],
  // A result, and then a process that neither reads its stdin nor takes SIGTERM.
  stubbornResult: [{ ignoreTerm: true }, { say: 'answer' }, { done: true }, { hang: true }],
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
  question: [{ ask: { tool: 'AskUserQuestion', input: { questions: [{ question: 'A or B?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] } } }],
  // Sends one message to whoever is in $to (the test rewrites the script), then ends.
  sendone: [
    { call: 'list_agents', args: {}, as: 'peers' },
    { call: 'send_message', args: { to: { $ref: 'peers.agents.0.id' }, text: 'ping from a' }, as: 'sent' },
    { say: 'sent' },
  ],
  // Sends, then waits up to 5 s for a reply, then reports whether one came.
  sendwait: [
    { call: 'list_agents', args: {}, as: 'peers' },
    { call: 'send_message', args: { to: { $ref: 'peers.agents.0.id' }, text: 'question' }, as: 'sent' },
    { call: 'wait_for_reply', args: { seconds: 5 }, as: 'reply' },
    { say: 'waited' },
  ],
  // The receiver: replies to the first message in its prompt. The fake cannot
  // parse its prompt, so it lists peers and answers the first one it sees.
  replyfirst: [
    { call: 'list_agents', args: {}, as: 'peers' },
    { call: 'send_message', args: { to: { $ref: 'peers.agents.0.id' }, text: 'answer' }, as: 'sent' },
    { say: 'replied' },
  ],
  // Long enough to still be running when a message arrives.
  linger2: [{ sleep: 1500 }, { say: 'done lingering' }],
};

async function setup({ limits = {}, tools, realTools = null, onLook, capability, projects = null, onFinish = null, publishAsk = undefined, onPublish = null, nameConversation = null, origin = () => 'http://127.0.0.1:1', providerMap = null } = {}) {
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
    tools: tools ?? realTools ?? { call: async (name, input, turn) => { toolCalls.push({ name, input, turn: turn.id }); return { ok: true }; } },
    workdir: path.join(dir, 'work'),
    driveRoot,
    projects: projects ?? { find: async (id) => (!id || id === 'drive' ? { id: 'drive', name: 'Drive', path: driveRoot, builtIn: true } : null) },
    origin,
    bridgePath: path.join(HERE, '..', 'bin', 'marble-mcp.js'),
    readDocument: async () => '<html><body data-marble-id="b"><p data-marble-id="p">hi</p></body></html>',
    // `onPublish` is how a test makes the host fail underneath a turn: a
    // throw here reaches `send` through `emit`, which is the one unguarded
    // await in the path a delivery turn takes.
    providers: providerMap ?? new Map([['fake', provider]]),
    publish: (conversationId, event, summary = null) => {
      published.push({ conversationId, event, summary });
      onPublish?.(conversationId, event);
    },
    publishAsk,
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200, ...limits },
    log: { log() {}, error() {} },
    onLook,
    onFinish,
    nameConversation,
  });
  await runner.boot();
  return { store, runner, published, toolCalls, spawned };
}

// A message script runs a *real* MCP bridge subprocess (bin/marble-mcp.js),
// which reaches the drive over HTTP — the same path a real CLI's bridge
// takes. `setup()`'s dummy origin (nobody listens on port 1) is fine for
// every other test, whose scripts never call a tool through it; a messaging
// test's script does, so it needs a real, if minimal, host behind that
// origin: the one route the bridge calls, forwarding straight to
// `runner.callTool`.
function serveBridge(runner, tools) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      const answer = (status, value) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!runner.turnForToken(token)) return answer(401, { error: 'no running turn holds that token' });
      if (req.url === '/agent/tools' && req.method === 'GET') return answer(200, { tools: tools.schemas });
      const match = /^\/agent\/tools\/([a-z_]+)$/.exec(req.url);
      if (match && req.method === 'POST') {
        const args = body ? (JSON.parse(body).arguments ?? {}) : {};
        return answer(200, (await runner.callTool(token, match[1], args)) ?? { error: 'the turn ended' });
      }
      answer(404, { error: 'not found' });
    });
  });
  return {
    async listen() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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

const finished = (store, turnId, ms = 5_000) =>
  until(async () => {
    const turn = await store.turn(turnId);
    return turn && !['queued', 'running'].includes(turn.status) ? turn : null;
  }, ms);

// Real tools whose messaging surface is bound to the runner after creation,
// the way index.js does it. Document tools are not exercised here.
async function setupMessaging(options = {}) {
  const messaging = {};
  const realTools = createTools({
    store: { read: async () => null, list: async () => [] },
    writeOps: async () => ({ applied: 0 }),
    createDocument: async () => {},
    buildStarter: async () => '',
    guidePath: '/nonexistent',
    examine: () => [],
    messaging,
  });
  // `origin()` is only read once a turn actually starts, so the real address
  // can be filled in below, once the runner (and so the bridge server that
  // forwards to it) exists.
  const originHolder = { url: 'http://127.0.0.1:1' };
  const made = await setup({ ...options, realTools, origin: () => originHolder.url });
  Object.assign(messaging, {
    peers: (turn) => made.runner.peers(turn),
    deliver: (turn, input) => made.runner.deliver(turn, input),
    wait: (turn, seconds) => made.runner.wait(turn, seconds),
  });
  const bridge = serveBridge(made.runner, realTools);
  originHolder.url = await bridge.listen();
  const closeRunner = made.runner.close.bind(made.runner);
  made.runner.close = async () => {
    await closeRunner();
    await bridge.close();
  };
  return made;
}

async function setupMessagingWithStore(store) {
  const messaging = {};
  const realTools = createTools({
    store: { read: async () => null, list: async () => [] },
    writeOps: async () => ({ applied: 0 }),
    createDocument: async () => {},
    buildStarter: async () => '',
    guidePath: '/nonexistent',
    examine: () => [],
    messaging,
  });
  const provider = createFakeProvider({ scripts: SCRIPTS });
  const originHolder = { url: 'http://127.0.0.1:1' };
  const runner = createRunner({
    store,
    tools: realTools,
    providers: new Map([['fake', provider]]),
    workdir: path.join(os.tmpdir(), `marble-runner-again-${Date.now()}`),
    driveRoot: os.tmpdir(),
    projects: { find: async (id) => (!id || id === 'drive' ? { id: 'drive', name: 'Drive', path: os.tmpdir(), builtIn: true } : null) },
    origin: () => originHolder.url,
    bridgePath: path.join(HERE, '..', 'bin', 'marble-mcp.js'),
    readDocument: async () => '<html><body data-marble-id="b"><p data-marble-id="p">hi</p></body></html>',
    publish: () => {},
    limits: { maxRunning: 3, stallMs: 60_000, maxMs: 60_000, killGraceMs: 200 },
    log: { log() {}, error() {} },
  });
  Object.assign(messaging, {
    peers: (turn) => runner.peers(turn),
    deliver: (turn, input) => runner.deliver(turn, input),
    wait: (turn, seconds) => runner.wait(turn, seconds),
  });
  const bridge = serveBridge(runner, realTools);
  originHolder.url = await bridge.listen();
  const closeRunner = runner.close.bind(runner);
  runner.close = async () => {
    await closeRunner();
    await bridge.close();
  };
  await runner.boot();
  return { runner };
}

test('a message to an idle conversation starts its turn, and both transcripts say so', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(b.id, { title: 'Bee', target: 'bees' });
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendone', context: { target: 'd' } });
  await finished(store, turnId);
  const bTurn = await until(async () => (await store.turns(b.id))[0] ?? null);
  await finished(store, bTurn.id);

  const sent = (await store.events(a.id)).find((e) => e.type === 'message.sent');
  assert.equal(sent.to, b.id);
  assert.equal(sent.toTitle, 'Bee');
  assert.equal(sent.text, 'ping from a');
  assert.equal(sent.delivered, 'turn');

  const user = (await store.events(b.id)).find((e) => e.type === 'user');
  assert.equal(user.from.conversation, a.id);
  assert.equal(user.from.provider, 'fake');
  assert.match(user.text, /ping from a/);
  assert.match(user.text, /Reply with send_message to "/);
  assert.equal(user.context.target, 'bees', 'the receiver keeps its own document');
  assert.match((await store.conversation(b.id)).activity, /^Message from|^Answered|^Changed/);
  await runner.close();
});

test('a message to a running conversation lands in its inbox and a delivery turn follows', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const bFirst = await runner.send(b.id, { prompt: 'script:linger2', context: { target: 'd' } });
  await until(() => runner.running().some((t) => t.conversationId === b.id));
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendone', context: { target: 'd' } });
  await finished(store, turnId);
  const sent = (await store.events(a.id)).find((e) => e.type === 'message.sent');
  assert.equal(sent.delivered, 'inbox');
  await finished(store, bFirst.turnId);
  const second = await until(async () => (await store.turns(b.id))[1] ?? null);
  await finished(store, second.id);
  const user = (await store.events(b.id)).filter((e) => e.type === 'user')[1];
  assert.match(user.text, /ping from a/);
  assert.equal(user.from.conversation, a.id);
  assert.deepEqual(await store.inbox(b.id), []);
  await runner.close();
});

test('a waiting turn receives a message live and wait_for_reply returns it', async () => {
  const { store, runner } = await setupMessaging({ limits: { maxRunning: 3 } });
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendwait', context: { target: 'd' } });
  // a's message starts a delivery turn on b, whose prompt is the rendered
  // message, not a script — so b's fake agent just ends. Reply as b by hand,
  // through the runner surface, with a synthetic turn: what matters here is
  // that a is parked and receives the reply live.
  await until(() => runner.running().find((t) => t.conversationId === a.id && t.waiter) ?? null);
  const asB = { conversationId: b.id, target: 'd', sent: 0, project: { id: 'drive' } };
  const result = await runner.deliver(asB, { to: a.id, text: 'answer' });
  assert.equal(result.delivered, 'live');
  await finished(store, turnId);
  const events = await store.events(a.id);
  const got = events.find((e) => e.type === 'message' && e.delivered === 'live');
  assert.equal(got.text, 'answer');
  assert.equal(got.from, b.id);
  assert.ok(events.some((e) => e.type === 'tool.result' && /answer/.test(e.summary ?? '')), 'the tool result carried the reply');
  await runner.close();
});

test('wait_for_reply times out with a plain answer and the turn goes on', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendwait', context: { target: 'd' } });
  const turn = await finished(store, turnId, 20_000);
  assert.equal(turn.status, 'completed');
  const results = (await store.events(a.id)).filter((e) => e.type === 'tool.result').map((e) => e.summary);
  // The bridge answers with pretty-printed JSON (bin/marble-mcp.js), so the
  // key and its value are a space apart, not run together.
  assert.ok(results.some((s) => /"timeout":\s*true/.test(s)), 'the wait reported a timeout');
  await runner.close();
});

test('send_message refuses self, strangers, other projects, archived, empty and oversize text, and the caps', async () => {
  const { store, runner } = await setupMessaging({
    projects: { find: async (id) => (id === 'other' ? { id: 'other', name: 'Other', path: '/tmp', builtIn: false } : { id: 'drive', name: 'Drive', path: '/tmp', builtIn: true }) },
  });
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const elsewhere = await store.createConversation({ provider: 'fake', project: 'other' });
  const gone = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(gone.id, { archived: true });
  const turn = { conversationId: a.id, target: 'd', sent: 0, project: { id: 'drive' } };

  assert.match((await runner.deliver(turn, { to: a.id, text: 'me' })).error, /yourself/);
  assert.match((await runner.deliver(turn, { to: 'nope', text: 'x' })).error, /no conversation/);
  assert.match((await runner.deliver(turn, { to: elsewhere.id, text: 'x' })).error, /project/);
  assert.match((await runner.deliver(turn, { to: gone.id, text: 'x' })).error, /archived/);
  assert.match((await runner.deliver(turn, { to: b.id, text: '' })).error, /empty/);
  assert.match((await runner.deliver(turn, { to: b.id, text: 'x'.repeat(4001) })).error, /4000/);

  let last;
  for (let i = 0; i < 12; i++) last = await runner.deliver(turn, { to: b.id, text: `n${i}` });
  assert.ok(last.messageId, 'twelve sends are allowed');
  assert.match((await runner.deliver(turn, { to: b.id, text: 'thirteen' })).error, /12/);

  const deep = { conversationId: b.id, target: 'd', sent: 0, project: { id: 'drive' } };
  let parent = last.messageId;
  for (let hop = 1; hop <= 8; hop++) {
    const r = await runner.deliver(hop % 2 ? deep : { ...turn, sent: 0 }, { to: hop % 2 ? a.id : b.id, text: `hop ${hop}`, inReplyTo: parent });
    assert.ok(r.messageId, `hop ${hop} is allowed`);
    parent = r.messageId;
  }
  assert.match((await runner.deliver(deep, { to: a.id, text: 'too deep', inReplyTo: parent })).error, /8/);
  await runner.close();
});

test('list_agents shows the other conversations in the project with an honest status', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const c = await store.createConversation({ provider: 'fake' });
  await store.createConversation({ provider: 'fake', project: 'other' });
  await store.updateConversation(b.id, { title: 'Bee', target: 'bees' });
  await runner.send(c.id, { prompt: 'script:linger2', context: { target: 'd' } });
  await until(() => runner.running().some((t) => t.conversationId === c.id));
  const turn = { conversationId: a.id, target: 'd', project: { id: 'drive' } };
  const { agents } = await runner.peers(turn);
  assert.deepEqual(agents.map((x) => x.id).sort(), [b.id, c.id].sort());
  const bee = agents.find((x) => x.id === b.id);
  assert.equal(bee.title, 'Bee');
  assert.equal(bee.target, 'bees');
  assert.equal(bee.status, 'idle');
  assert.equal(agents.find((x) => x.id === c.id).status, 'running');
  await runner.close();
});

test('a pending inbox at boot becomes a delivery turn', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(b.id, { target: 'bees' });
  await store.appendInbox(b.id, store.createMessage({ from: a.id, to: b.id, text: 'left over' }));
  await runner.close();
  const { runner: again } = await setupMessagingWithStore(store);
  const turn = await until(async () => (await store.turns(b.id))[0] ?? null);
  await finished(store, turn.id);
  assert.match((await store.events(b.id)).find((e) => e.type === 'user').text, /left over/);
  assert.deepEqual(await store.inbox(b.id), []);
  await again.close();
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

test('a finished turn tells the host to forget what that writer touched', async () => {
  const released = [];
  const { store, runner } = await setup({ onFinish: (conversationId) => released.push(conversationId) });
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello', context: { target: 'notes', selection: ['p'] } });
  await finished(store, turnId);
  assert.deepEqual(released, [id]);
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

test('with no cap every conversation runs at once', async () => {
  const { store, runner } = await setup({ limits: { maxRunning: 0 } });
  const ids = [];
  for (let i = 0; i < 6; i += 1) ids.push((await store.createConversation({ provider: 'fake' })).id);
  const sent = [];
  for (const id of ids) sent.push(await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } }));
  assert.deepEqual(sent.map((t) => t.status), sent.map(() => 'running'));
  assert.equal(runner.running().length, 6);
  for (const t of sent) assert.equal((await finished(store, t.turnId)).status, 'completed');
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

test('an ask is stored, marks the conversation asking, and an answer reaches the process', async () => {
  const { store, runner } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  assert.equal(ask.kind, 'permission');
  assert.equal(ask.tool, 'Bash');
  assert.deepEqual(ask.input, { command: 'rm -rf build' });
  assert.equal((await store.summary(id)).asking, true);

  await runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow' });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  const events = await store.events(id);
  assert.ok(events.some((e) => e.type === 'ask.answered' && e.requestId === ask.requestId));
  assert.ok(events.some((e) => e.type === 'text' && e.text === 'answered:allow'));
  assert.equal((await store.summary(id)).asking, false);
  await assert.rejects(runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow' }), { status: 409 });
  await runner.close();
});

test('a question is an ask of kind question and its answer carries the chosen labels', async () => {
  const { store, runner } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:question', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  assert.equal(ask.kind, 'question');
  await runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow', updatedInput: { ...ask.input, answers: { 'A or B?': 'B' } } });
  await until(async () => (await store.events(id)).some((e) => e.type === 'text' && e.text === 'answered:allow:B'));
  await runner.close();
});

test('a turn waiting on an ask is not a stall', async () => {
  const { store, runner } = await setup({ capability: 'full', limits: { stallMs: 400 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  await new Promise((r) => setTimeout(r, 900));
  assert.equal((await store.turn(`${id}-t1`)).status, 'running', 'still waiting for the person');
  await runner.answer(`${id}-t1`, ask.requestId, { behavior: 'deny', message: 'no' });
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  await runner.close();
});

test('cancelling a turn denies its open ask and voids it', async () => {
  const { store, runner } = await setup({ capability: 'full' });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  await runner.cancel(`${id}-t1`);
  await until(async () => (await store.turn(`${id}-t1`)).status === 'cancelled');
  const voided = (await store.events(id)).find((e) => e.type === 'ask.void');
  assert.equal(voided.requestId, ask.requestId);
  assert.equal(voided.why, 'cancelled');
  assert.equal((await store.summary(id)).asking, false);
  await assert.rejects(runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow' }), { status: 409 });
  await runner.close();
});

test('a process that waits for more input after its result is ended by the runner', async () => {
  const { store, runner } = await setup({ capability: 'full', limits: { stallMs: 60_000 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:linger', context: { target: 'garden' } });
  const turn = await finished(store, `${id}-t1`);
  assert.equal(turn.status, 'completed');
  assert.equal(turn.error, null);
  await runner.close();
});

test('a result while background work is outstanding is not the end of the turn', async () => {
  const { store, runner } = await setup({ capability: 'full', limits: { settleMs: 50, killGraceMs: 50, backgroundSettleMs: 5_000 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:background', context: { target: 'garden' } });
  const turn = await finished(store, `${id}-t1`);
  assert.equal(turn.status, 'completed');
  assert.equal(turn.error, null);
  const said = (await store.events(id)).filter((e) => e.type === 'text').map((e) => e.text);
  assert.ok(said.includes('the subagent finished'), said.join(' | '));
  await runner.close();
});

test('a process the runner had to stop after its result still succeeded', async () => {
  const { store, runner } = await setup({ capability: 'full', limits: { settleMs: 50, killGraceMs: 50 } });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:stubbornResult', context: { target: 'garden' } });
  const turn = await finished(store, `${id}-t1`);
  assert.equal(turn.status, 'completed', `error: ${turn.error}`);
  assert.equal(turn.error, null);
  await runner.close();
});

test('a steer that waited wraps the model prompt, not the user event', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const second = await runner.send(id, { prompt: 'script:hello\nkeep going', context: { target: 'd' }, dispatch: 'steer' });
  assert.equal((await store.turn(second.turnId)).dispatch, 'steer');
  assert.equal((await store.turn(second.turnId)).behind, true);
  await finished(store, first.turnId);
  await finished(store, second.turnId);
  const user = (await store.events(id)).find((e) => e.turn === second.turnId && e.type === 'user');
  assert.equal(user.text, 'script:hello\nkeep going');
  const echoed = (await store.events(id)).find((e) => e.turn === second.turnId && e.type === 'text');
  assert.match(echoed.text, /^prompt:While you were working I added this note/);
  await runner.close();
});

test('idle steer does not wrap', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' }, dispatch: 'steer' });
  await finished(store, turnId);
  assert.equal((await store.turn(turnId)).behind, false);
  const echoed = (await store.events(id)).find((e) => e.type === 'text');
  assert.equal(echoed.text, 'prompt:script:hello');
  await runner.close();
});

test('interrupt cancels the running turn then starts the next', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:hold', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  const second = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' }, dispatch: 'interrupt' });
  await finished(store, first.turnId);
  await finished(store, second.turnId);
  assert.equal((await store.turn(first.turnId)).status, 'cancelled');
  assert.equal((await store.turn(second.turnId)).status, 'completed');
  await runner.close();
});

test('queueCombine merges queued prompts onto the first turn', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(id, { queueCombine: true });
  const first = await runner.send(id, { prompt: 'script:slow', context: { target: 'd' } });
  const a = await runner.send(id, { prompt: 'alpha note', context: { target: 'd' } });
  const b = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' } });
  await finished(store, first.turnId);
  await finished(store, a.turnId);
  assert.equal((await store.turn(b.turnId)).status, 'combined');
  assert.deepEqual((await store.turn(a.turnId)).bundle, ['alpha note', 'script:hello']);
  const echoed = (await store.events(id)).find((e) => e.turn === a.turnId && e.type === 'text');
  assert.equal(echoed.text, 'prompt:1. alpha note');
  assert.ok((await store.events(id)).some((e) => e.type === 'turn.combined' && e.turn === b.turnId));
  const userA = (await store.events(id)).find((e) => e.turn === a.turnId && e.type === 'user');
  const userB = (await store.events(id)).find((e) => e.turn === b.turnId && e.type === 'user');
  assert.equal(userA.text, 'alpha note');
  assert.equal(userB.text, 'script:hello');
  await runner.close();
});

test('combined interrupt cancels running and does not steer-wrap', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(id, { queueCombine: true });
  const first = await runner.send(id, { prompt: 'script:hold', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  const a = await runner.send(id, { prompt: 'one', context: { target: 'd' } });
  const b = await runner.send(id, { prompt: 'script:hello', context: { target: 'd' }, dispatch: 'interrupt' });
  await finished(store, first.turnId);
  await finished(store, a.turnId);
  assert.equal((await store.turn(first.turnId)).status, 'cancelled');
  assert.equal((await store.turn(b.turnId)).status, 'combined');
  const echoed = (await store.events(id)).find((e) => e.turn === a.turnId && e.type === 'text');
  assert.equal(echoed.text, 'prompt:1. one');
  await runner.close();
});

test('patchQueued edits a waiting prompt and cycles dispatch', async () => {
  const { store, runner } = await setup();
  const { id } = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(id, { prompt: 'script:hold', context: { target: 'd' } });
  await until(() => runner.running().length === 1);
  const second = await runner.send(id, { prompt: 'later', context: { target: 'd' } });
  await runner.patchQueued(second.turnId, { prompt: 'script:hello' });
  assert.equal((await store.turn(second.turnId)).prompt, 'script:hello');
  assert.ok((await store.events(id)).some((e) => e.type === 'user.edited' && e.text === 'script:hello'));
  const steered = await runner.patchQueued(second.turnId, { dispatch: 'steer' });
  assert.equal(steered.dispatch, 'steer');
  assert.equal((await store.turn(second.turnId)).dispatch, 'steer');
  await runner.cancel(first.turnId);
  await finished(store, first.turnId);
  await finished(store, second.turnId);
  await runner.close();
});

// --- Fix round 1 (task 3 review): a message is delivered exactly once and never lost. ---

test('two messages delivered to the same idle conversation at once start exactly one turn', async () => {
  const { store, runner } = await setupMessaging();
  const a1 = await store.createConversation({ provider: 'fake' });
  const a2 = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const turnA1 = { conversationId: a1.id, target: 'd', sent: 0, project: { id: 'drive' } };
  const turnA2 = { conversationId: a2.id, target: 'd', sent: 0, project: { id: 'drive' } };
  // Both calls see `b` idle and race for it, the same way finish()'s
  // fire-and-forget inbox check and a concurrent deliver do in production.
  // `startDelivery`'s takeInbox is serialized per conversation, so exactly
  // one of the two calls actually starts a turn; the loser must not fall
  // back to the single message it was handed, or `b` gets two turns for one
  // delivery.
  const [r1, r2] = await Promise.all([
    runner.deliver(turnA1, { to: b.id, text: 'first message' }),
    runner.deliver(turnA2, { to: b.id, text: 'second message' }),
  ]);
  assert.ok(!r1.error, r1.error);
  assert.ok(!r2.error, r2.error);
  const bTurns = await store.turns(b.id);
  assert.equal(bTurns.length, 1, 'exactly one turn was started on b, not two');
  await finished(store, bTurns[0].id);
  const user = (await store.events(b.id)).find((e) => e.type === 'user');
  assert.match(user.text, /first message/);
  assert.match(user.text, /second message/);
  await runner.close();
});

test('a turn cancelled before its process spawns hands its taken inbox back rather than losing it', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-runner-'));
  const store = createAgentStore({ dir: path.join(dir, 'agents'), defaultProvider: 'slow-prepare' });
  await store.ready();
  const provider = {
    id: 'slow-prepare',
    label: 'Slow',
    detect: async () => ({ installed: true, signedIn: true, detail: '' }),
    prepare: () => new Promise((resolve) => setTimeout(resolve, 300)),
    spawn() {
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
  await store.appendInbox(id, store.createMessage({ from: 'somebody', to: id, text: 'left waiting' }));

  // `send` doesn't return until `start` does, and `start` doesn't return until
  // `prepare` does (300ms) — so cancel lands well before composePrompt() even
  // runs, and composePrompt() runs (taking the inbox) before `start` next
  // checks `turn.cancelled`. That is exactly the window the fix covers: the
  // turn took the messages in composePrompt() but is cancelled before any
  // process — and so any chance to act on them — exists.
  const sending = runner.send(id, { prompt: 'x', context: { target: 'd' } });
  const live = await until(() => (runner.running()[0] ? runner.running()[0] : null));
  assert.equal(await runner.cancel(live.id), true);
  await sending;
  const turn = await finished(store, live.id);
  assert.equal(turn.status, 'cancelled');

  // The message must not be lost: finish() hands it back to the inbox, and
  // the pending-inbox check right after queues a delivery turn for it.
  const delivery = await until(async () => (await store.turns(id))[1] ?? null);
  await finished(store, delivery.id);
  const user = (await store.events(id)).filter((e) => e.type === 'user')[1];
  assert.match(user.text, /left waiting/);
  assert.deepEqual(await store.inbox(id), []);
  await runner.close();
});

// --- Fix round 2 (whole-branch review): every taker of the inbox hands back
// what it cannot act on, and a thread's hop follows the turn. ---

test('a wait woken by the end of its turn hands its messages back instead of eating them', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  // Parked through the runner's own surface rather than by a scripted agent:
  // the window this covers is the one finish() opens between `turn.waiter?.()`
  // and its own inbox check, and a real process cannot be made to reach it on
  // a schedule — the agent's MCP bridge holds its stdio open until the wait
  // answers, so the child never closes while a wait is parked. What is left to
  // pin down is the contract, and the turn below is the turn finish() hands to
  // it: finishing, with a wait still parked on it.
  const turn = { id: null, conversationId: a.id, target: 'd', sent: 0, project: { id: 'drive' }, waiter: null, finishing: false };
  const parked = runner.wait(turn, 60);
  await until(() => Boolean(turn.waiter));
  await store.appendInbox(a.id, store.createMessage({ from: b.id, to: a.id, text: 'landed as the turn died' }));
  // finish()'s order exactly: the turn is finishing, and then the wait wakes.
  // Before the fix that wait took the message and answered a process already
  // dying, so finish()'s inbox check found nothing and nobody ever read it.
  turn.finishing = true;
  turn.waiter();
  assert.deepEqual(await parked, { timeout: true }, 'a dying turn is told nothing arrived');
  assert.deepEqual(
    (await store.inbox(a.id)).map((m) => m.text),
    ['landed as the turn died'],
    'the message is back in the inbox, for the delivery turn finish() queues next',
  );
  await runner.close();
});

test('removing the queued turn that would have carried the inbox still delivers it', async () => {
  const { store, runner } = await setupMessaging({ limits: { maxRunning: 1 } });
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const hog = await store.createConversation({ provider: 'fake' });
  const busy = await runner.send(hog.id, { prompt: 'script:linger2', context: { target: 'd' } });
  await until(() => runner.running().some((t) => t.conversationId === hog.id));
  // The one slot is taken, so b's turn is queued and nothing of b's is
  // running: that queued turn is the only thing that would have carried b's
  // inbox in at start, and removing it used to strand the message forever.
  const queued = await runner.send(b.id, { prompt: 'script:noop', context: { target: 'd' } });
  assert.equal(queued.status, 'queued');
  const asA = { conversationId: a.id, target: 'd', sent: 0, project: { id: 'drive' } };
  assert.equal((await runner.deliver(asA, { to: b.id, text: 'do not strand me' })).delivered, 'inbox');
  assert.equal(await runner.dequeue(queued.turnId), true);
  await finished(store, busy.turnId);

  const delivery = await until(async () => (await store.turns(b.id)).find((t) => t.id !== queued.turnId) ?? null);
  await finished(store, delivery.id);
  const carried = (await store.events(b.id)).filter((e) => e.type === 'user').find((e) => /do not strand me/.test(e.text));
  assert.ok(carried, 'the removed turn did not take the message with it');
  assert.equal((await store.turns(b.id)).length, 2, 'exactly one further turn');
  assert.deepEqual(await store.inbox(b.id), []);
  await runner.close();
});

test('a reply that never passes inReplyTo still counts against the hop cap', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const asTurn = (conversationId, from = null) => ({ conversationId, target: 'd', sent: 0, project: { id: 'drive' }, from });
  // a opens the thread with no parent at all: hop 0.
  const opening = await runner.deliver(asTurn(a.id), { to: b.id, text: 'opening' });
  assert.ok(opening.messageId, opening.error);
  // From here on each side answers the message its own turn was started by,
  // and never names it: the thread is carried on the turn (`turn.from`), so
  // the count keeps going instead of restarting at 0 on every reply.
  let parent = { conversation: a.id, messageId: opening.messageId, hop: 0 };
  let me = b.id;
  let to = a.id;
  for (let hop = 1; hop <= MAX_HOP; hop++) {
    const reply = await runner.deliver(asTurn(me, parent), { to, text: `reply ${hop}` });
    assert.ok(reply.messageId, `hop ${hop} is allowed (${reply.error})`);
    parent = { conversation: me, messageId: reply.messageId, hop };
    [me, to] = [to, me];
  }
  const refused = await runner.deliver(asTurn(me, parent), { to, text: 'one too many' });
  assert.match(refused.error, new RegExp(`${MAX_HOP} replies deep`));
  await runner.close();
});

test('a conversation a message wakes for the first time is named after the sender', async () => {
  const { store, runner } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(a.id, { title: 'Ay' });
  await store.updateConversation(b.id, { target: 'bees' });
  const { turnId } = await runner.send(a.id, { prompt: 'script:sendone', context: { target: 'd' } });
  await finished(store, turnId);
  const bTurn = await until(async () => (await store.turns(b.id))[0] ?? null);
  await finished(store, bTurn.id);
  // Without this the store names the conversation after the first 60
  // characters of the rendered message, which reads as a quotation of itself.
  assert.equal((await store.conversation(b.id)).title, 'Message from Ay');
  await runner.close();
});

test('a delivery turn that throws while starting leaves the message in the inbox', async () => {
  const failing = { id: null };
  const { store, runner } = await setupMessaging({
    onPublish: (conversationId) => {
      if (conversationId === failing.id) throw new Error('the host fell over mid-send');
    },
  });
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(b.id, { target: 'bees' });
  failing.id = b.id; // every event written for b now throws, so `send` does
  const asA = { conversationId: a.id, target: 'd', sent: 0, project: { id: 'drive' } };
  const result = await runner.deliver(asA, { to: b.id, text: 'still queued' });
  assert.ok(result.messageId, result.error);
  assert.equal(result.delivered, 'inbox', 'the sender is told it was queued, not handed a failure');
  assert.deepEqual((await store.inbox(b.id)).map((m) => m.text), ['still queued'], 'the message is back in the inbox');
  await runner.close();
});

test('a message for a conversation with a turn queued rides in on that turn', async () => {
  const { store, runner, spawned } = await setupMessaging();
  const a = await store.createConversation({ provider: 'fake' });
  const b = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(b.id, { prompt: 'script:linger2', context: { target: 'd' } });
  await until(() => runner.running().some((t) => t.conversationId === b.id));
  const second = await runner.send(b.id, { prompt: 'script:noop', context: { target: 'd' } });
  assert.equal(second.status, 'queued');
  const asA = { conversationId: a.id, target: 'd', sent: 0, project: { id: 'drive' } };
  assert.equal((await runner.deliver(asA, { to: b.id, text: 'read me when you get there' })).delivered, 'inbox');
  await finished(store, first.turnId);
  assert.equal((await finished(store, second.turnId, 20_000)).status, 'completed');

  const message = (await store.events(b.id)).find((e) => e.type === 'message' && e.turn === second.turnId);
  assert.equal(message.delivered, 'inbox');
  assert.equal(message.text, 'read me when you get there');
  const prompt = spawned.map((o) => o.prompt).find((p) => /read me when you get there/.test(p));
  assert.match(prompt, /Messages that arrived while you were away/);
  assert.equal((await store.turns(b.id)).length, 2, 'the queued turn carried it; no third turn');
  assert.deepEqual(await store.inbox(b.id), []);
  await runner.close();
});

test('openAsks lists an open ask with its request, and forgets it once answered', async () => {
  const asks = [];
  const { store, runner } = await setup({ capability: 'full', publishAsk: (kind, payload) => asks.push({ kind, ...payload }) });
  const { id } = await store.createConversation({ provider: 'fake' });
  await runner.send(id, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await store.events(id)).find((e) => e.type === 'ask'));
  await until(() => asks.length);
  const open = runner.openAsks();
  assert.equal(open.length, 1);
  assert.equal(open[0].conversation, id);
  assert.equal(open[0].turn, `${id}-t1`);
  assert.equal(open[0].requestId, ask.requestId);
  assert.equal(open[0].request.tool, 'Bash');
  assert.equal(open[0].request.kind, 'permission');
  assert.ok(open[0].since > 0);
  assert.deepEqual(asks.map((a) => a.kind), ['ask']);
  await runner.answer(`${id}-t1`, ask.requestId, { behavior: 'allow' });
  assert.equal(runner.openAsks().length, 0);
  assert.deepEqual(asks.map((a) => a.kind), ['ask', 'ask.resolved']);
  await until(async () => (await store.turn(`${id}-t1`)).status === 'completed');
  await runner.close();
});

// ---------------------------------------------------------------- naming

test('a chat is named by a model once its first turn is over', async () => {
  const asked = [];
  const { store, runner, published } = await setup({
    nameConversation: async (input) => {
      asked.push(input);
      return 'Fake Agent Says Hello';
    },
  });
  const chat = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(chat.id, { prompt: 'script:hello', context: { target: 'd' } });
  await finished(store, turnId);

  // The placeholder is there the moment the prompt is stored.
  const named = await until(async () => {
    const meta = await store.conversation(chat.id);
    return meta.title !== 'script:hello' ? meta : null;
  });
  assert.equal(named.title, 'Fake Agent Says Hello');
  assert.equal(named.titleAuto, false, 'a name the model wrote is not replaced again');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].prompt, 'script:hello');
  assert.match(asked[0].reply, /Hello from the fake agent/);

  // Lists hear about it without asking.
  const meta = published.find((p) => p.conversationId === chat.id && p.event.type === 'meta');
  assert.equal(meta.summary.title, 'Fake Agent Says Hello');
  await runner.close();
});

test('a title the person typed is never written over', async () => {
  let asked = 0;
  const { store, runner } = await setup({
    nameConversation: async () => { asked += 1; return 'A Model Name'; },
  });
  const chat = await store.createConversation({ provider: 'fake' });
  await store.updateConversation(chat.id, { title: 'Mine', titleAuto: false });
  const { turnId } = await runner.send(chat.id, { prompt: 'script:hello', context: { target: 'd' } });
  await finished(store, turnId);
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal((await store.conversation(chat.id)).title, 'Mine');
  assert.equal(asked, 0, 'a named chat is not worth a model call');
  await runner.close();
});

test('a chat whose name could not be got keeps its placeholder, and is asked for once', async () => {
  let asked = 0;
  const { store, runner } = await setup({
    nameConversation: async () => { asked += 1; return null; },
  });
  const chat = await store.createConversation({ provider: 'fake' });
  const first = await runner.send(chat.id, { prompt: 'script:hello', context: { target: 'd' } });
  await finished(store, first.turnId);
  await until(async () => asked === 1);
  const second = await runner.send(chat.id, { prompt: 'script:hello', context: { target: 'd' } });
  await finished(store, second.turnId);
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(asked, 1, 'asked once per conversation, not once per turn');
  const meta = await store.conversation(chat.id);
  assert.equal(meta.title, 'script:hello');
  assert.equal(meta.titleAuto, true);
  await runner.close();
});

test('a host with no namer leaves the placeholder alone', async () => {
  const { store, runner } = await setup();
  const chat = await store.createConversation({ provider: 'fake' });
  const { turnId } = await runner.send(chat.id, { prompt: 'script:hello', context: { target: 'd' } });
  await finished(store, turnId);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await store.conversation(chat.id)).title, 'script:hello');
  await runner.close();
});

const GROK_MODELS = [
  { id: 'auto', label: 'Auto' },
  { id: 'grok-4.6-high', label: 'Grok 4.6 High' },
  { id: 'grok-4.7-high', label: 'Grok 4.7 High' },
  { id: 'grok-4.7-xhigh', label: 'Grok 4.7 Extra High' },
];

const CLAUDE_AND_GROK = [
  { id: 'auto', label: 'Auto' },
  { id: 'claude-fable-5-1-high', label: 'Claude Fable 5.1 1M' },
  { id: 'claude-opus-5-thinking-high', label: 'Claude Opus 5 1M Thinking' },
  { id: 'claude-opus-4-8-high', label: 'Claude Opus 4.8 1M' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 1M High' },
  { id: 'claude-opus-5-5-xhigh', label: 'Claude Opus 5.5 1M Extra High' },
  { id: 'claude-sonnet-5-high', label: 'Claude Sonnet 5 1M' },
  { id: 'grok-4.7-high', label: 'Grok 4.7 High' },
  { id: 'grok-4.7-xhigh', label: 'Grok 4.7 Extra High' },
];

/** Claude is the scripted provider. Cursor is a second one whose model list the handoff reads. */
async function setupFailover({
  signedIn = true,
  models = GROK_MODELS,
  listModels = null,
  failover = 'auto',
  model = 'opus',
  cursorScripts = { hello: [{ say: 'picked up' }] },
  cursorPrompt = null,
} = {}) {
  const spawned = [];
  const claude = createFakeProvider({
    id: 'claude-subscription',
    scripts: {
      spent: [{ fail: 'You have hit your limit' }],
      retry: [{ fail: 'Rate limit — try again shortly' }],
      crash: [{ fail: 'exited with 1' }],
      hello: [{ say: 'done' }],
    },
  });
  const cursor = createFakeProvider({ id: 'cursor', scripts: cursorScripts });
  const claudeSpawn = claude.spawn.bind(claude);
  claude.spawn = (opts) => {
    spawned.push({ provider: 'claude-subscription', ...opts });
    return claudeSpawn(opts);
  };
  const cursorSpawn = cursor.spawn.bind(cursor);
  cursor.spawn = (opts) => {
    spawned.push({ provider: 'cursor', ...opts });
    const script = cursorPrompt ? cursorPrompt(spawned) : 'script:hello';
    return cursorSpawn({ ...opts, prompt: `${script}\n${opts.prompt}` });
  };
  cursor.detect = async () => ({ installed: true, signedIn });
  cursor.listModels = listModels ?? (async () => models);
  const made = await setup({
    providerMap: new Map([['claude-subscription', claude], ['cursor', cursor]]),
  });
  const chat = await made.store.createConversation({ provider: 'claude-subscription', model, effort: 'high', failover });
  await made.store.updateConversation(chat.id, { providerSession: 'claude-session' });
  return { ...made, spawned, chat };
}

test('a spent Claude window switches the chat to the newest Grok and continues', async () => {
  const { store, runner, spawned, chat, published } = await setupFailover();
  const { turnId } = await runner.send(chat.id, { prompt: 'script:spent', context: { target: 'd' } });
  const failed = await finished(store, turnId);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /hit your limit/);
  await until(async () => (await store.conversation(chat.id)).provider === 'cursor');
  const meta = await store.conversation(chat.id);
  assert.equal(meta.provider, 'cursor');
  assert.equal(meta.model, 'grok-4.7');
  assert.equal(meta.effort, 'high');
  assert.equal(meta.providerSession, null);
  const turns = await store.turns(chat.id);
  const cont = turns.find((turn) => turn.prompt === 'Continue');
  assert.ok(cont);
  assert.equal(cont.usageHandoff, true);
  await finished(store, cont.id);
  const handoff = spawned.find((item) => item.provider === 'cursor');
  assert.match(handoff.prompt, /Finish the work it started/);
  assert.match(handoff.prompt, /Person: script:spent/);
  assert.match(handoff.prompt, /\nContinue\n/);
  assert.equal(published.some((item) => item.event.type === 'usage.continued' && item.event.label === 'Grok 4.7 High'), true);
  const again = await runner.handoffUsage(chat.id);
  assert.equal(again.turnId, cont.id);
  await runner.close();
});

test('Continue runs ahead of a prompt that was already queued', async () => {
  const { store, runner, spawned, chat } = await setupFailover();
  const first = await runner.send(chat.id, { prompt: 'script:spent', context: { target: 'd' } });
  const queued = await runner.send(chat.id, { prompt: 'script:hello\nplease also fix the tests', context: { target: 'd' } });
  await finished(store, first.turnId);
  await until(async () => (await store.turns(chat.id)).some((turn) => turn.prompt === 'Continue'));
  await finished(store, queued.turnId);
  const cont = (await store.turns(chat.id)).find((turn) => turn.prompt === 'Continue');
  await finished(store, cont.id);
  const cursorSpawns = spawned.filter((item) => item.provider === 'cursor');
  assert.match(cursorSpawns[0].prompt, /Finish the work it started/);
  assert.match(cursorSpawns[1].prompt, /please also fix the tests/);
  assert.equal(cursorSpawns[1].prompt.includes('Finish the work it started'), false);
  await runner.close();
});

test('a crash or a short retry does not switch off Claude', async () => {
  for (const prompt of ['script:crash', 'script:retry']) {
    const { store, runner, chat } = await setupFailover();
    const { turnId } = await runner.send(chat.id, { prompt, context: { target: 'd' } });
    await finished(store, turnId);
    assert.equal((await store.conversation(chat.id)).provider, 'claude-subscription');
    assert.equal((await store.turns(chat.id)).some((turn) => turn.prompt === 'Continue'), false);
    await runner.close();
  }
});

test('Pause asks instead of continuing, and records whether Cursor can take the chat', async () => {
  const asking = await setupFailover({ failover: 'pause' });
  const sent = await asking.runner.send(asking.chat.id, { prompt: 'script:spent', context: { target: 'd' } });
  const failed = await finished(asking.store, sent.turnId);
  assert.equal(failed.usageStopped, true);
  assert.equal(failed.canSwitch, true);
  assert.equal((await asking.store.conversation(asking.chat.id)).provider, 'claude-subscription');
  assert.equal(asking.published.some((item) => item.event.type === 'turn.failed' && item.event.usageStopped && item.event.canSwitch), true);
  await asking.runner.close();

  const blocked = await setupFailover({ failover: 'pause', signedIn: false });
  const stopped = await blocked.runner.send(blocked.chat.id, { prompt: 'script:spent', context: { target: 'd' } });
  const stayed = await finished(blocked.store, stopped.turnId);
  assert.equal(stayed.canSwitch, false);
  assert.match(stayed.error, new RegExp(STAY.signedOut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await blocked.runner.close();
});

test('a spent Claude window continues on Cursor with the same model, and Fable continues on Opus', async () => {
  const { store, runner, spawned, chat, published } = await setupFailover({ models: CLAUDE_AND_GROK, model: 'fable' });
  const { turnId } = await runner.send(chat.id, { prompt: 'script:spent', context: { target: 'd' } });
  await finished(store, turnId);
  await until(async () => (await store.conversation(chat.id)).provider === 'cursor');
  const meta = await store.conversation(chat.id);
  assert.equal(meta.model, 'claude-opus-5-5');
  assert.equal(meta.effort, 'high');
  assert.equal(meta.usageLane, 'model');
  assert.equal(meta.providerSession, null);
  const cont = (await store.turns(chat.id)).find((turn) => turn.prompt === 'Continue');
  await finished(store, cont.id);
  const handoff = spawned.find((item) => item.provider === 'cursor');
  assert.equal(handoff.model, 'claude-opus-5-5');
  assert.equal(handoff.effort, 'high');
  assert.match(handoff.prompt, /Finish the work it started/);
  assert.equal(published.some((item) => item.event.type === 'usage.continued' && item.event.label === 'Claude Opus 5.5 1M High'), true);
  assert.equal((await store.conversation(chat.id)).model, 'claude-opus-5-5');
  await runner.close();
});

test('a session limit on that Cursor model continues once more on Grok', async () => {
  const { store, runner, spawned, chat } = await setupFailover({
    models: CLAUDE_AND_GROK,
    model: 'opus',
    cursorScripts: {
      spent: [{ fail: "You've hit your session limit" }],
      hello: [{ say: 'picked up' }],
    },
    cursorPrompt: (spawned) => (spawned.filter((item) => item.provider === 'cursor').length === 1 ? 'script:spent' : 'script:hello'),
  });
  const { turnId } = await runner.send(chat.id, { prompt: 'script:spent', context: { target: 'd' } });
  await finished(store, turnId);
  await until(async () => (await store.conversation(chat.id)).model === 'claude-opus-5-5');
  const first = (await store.turns(chat.id)).find((turn) => turn.prompt === 'Continue');
  const failed = await finished(store, first.id);
  assert.match(failed.error, /session limit/);
  await until(async () => (await store.conversation(chat.id)).model === 'grok-4.7');
  const meta = await store.conversation(chat.id);
  assert.equal(meta.provider, 'cursor');
  assert.equal(meta.usageLane, 'grok');
  assert.equal(meta.effort, 'high');
  const continues = (await store.turns(chat.id)).filter((turn) => turn.prompt === 'Continue');
  assert.equal(continues.length, 2);
  await finished(store, continues[1].id);
  const grok = spawned.filter((item) => item.provider === 'cursor').at(-1);
  assert.equal(grok.model, 'grok-4.7');
  assert.match(grok.prompt, /The Cursor model stopped because its usage was used up/);
  const third = await runner.handoffUsage(chat.id);
  assert.equal(third.turnId, continues[1].id);
  await runner.close();
});

test('a signed-out Cursor, an unreadable list, or no Grok leaves the chat on Claude', async () => {
  const cases = [
    [{ signedIn: false }, STAY.signedOut],
    [{ listModels: async () => { throw new Error('nope'); } }, STAY.unreadable],
    [{ models: [{ id: 'auto', label: 'Auto' }, { id: 'composer-2.5', label: 'Composer 2.5' }] }, STAY.noGrok],
  ];
  for (const [options, suffix] of cases) {
    const { store, runner, chat } = await setupFailover(options);
    const { turnId } = await runner.send(chat.id, { prompt: 'script:spent', context: { target: 'd' } });
    const failed = await finished(store, turnId);
    assert.equal((await store.conversation(chat.id)).provider, 'claude-subscription');
    assert.match(failed.error, new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await runner.close();
  }
});
