import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-agents-http-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-agents-work-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { agentsAllowed } = await import('../server/agent/index.js');
const { isLoopback } = await import('../server/agent/routes.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const quiet = { log() {}, error() {} };

const SOURCE = `<!doctype html>
<html><head><title>Garden</title></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Research Garden</h1>
  <ul data-marble-id="q">
    <li data-marble-id="q1">Why?</li>
  </ul>
</body></html>
`;

const SCRIPTS = {
  edit: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
  wait: [{ sleep: 2500 }, { say: 'waited' }],
  hold: [{ silent: 20_000 }],
};

const config = loadConfig({
  ...process.env,
  MARBLE_DRIVE_AGENTS: '1',
  MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
  MARBLE_DRIVE_AGENT_WORKDIR: WORK,
});
const drive = await createDrive(config, {
  log: quiet,
  agentProviders: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
});
await drive.createDocument('garden', SOURCE);
await drive.createDocument('watched', SOURCE);

const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;

const api = async (method, route, body, headers = {}) => {
  const response = await fetch(base + route, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const until = async (check, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('timed out');
};

const finished = (conversationId, turnId) =>
  until(async () => {
    const { body } = await api('GET', `/agent/conversations/${conversationId}`);
    const turn = body.turns.find((t) => t.id === turnId);
    return turn && !['queued', 'running'].includes(turn.status) ? { turn, body } : null;
  });

/** Frames from an SSE route, until `stop(frames)` or the deadline. */
async function frames(route, stop, ms = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const seen = [];
  try {
    const response = await fetch(base + route, { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!stop(seen)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const data = part.match(/^data: (.*)$/m)?.[1];
        if (data !== undefined) seen.push(data);
      }
    }
  } catch {
    // aborted
  }
  clearTimeout(timer);
  controller.abort();
  return seen;
}

const start = async (prompt, target = 'garden', extra = {}) => {
  const conversation = await api('POST', '/agent/conversations', { provider: 'fake', ...extra });
  const turn = await api('POST', `/agent/conversations/${conversation.body.id}/turns`, {
    prompt,
    context: { target, viewing: target, selection: [] },
  });
  return { conversationId: conversation.body.id, turnId: turn.body.turnId, status: turn.status };
};

let edited = null;

test('providers are listed, with the default marked', async () => {
  const { status, body } = await api('GET', '/agent/providers');
  assert.equal(status, 200);
  assert.deepEqual(body, [{ id: 'fake', label: 'Fake', installed: true, signedIn: true, detail: 'scripted', default: true }]);
});

test('an agent edits a document through the bridge, and the open tab hears it', async () => {
  const heard = frames('/events?app=garden&client=tab1', (seen) => seen.includes('changed'));
  edited = await start('script:edit\nRename the heading');
  assert.equal(edited.status, 202);
  const { turn, body } = await finished(edited.conversationId, edited.turnId);

  assert.equal(turn.status, 'completed');
  assert.equal(turn.applied, 1);
  assert.match(await drive.store.read('garden'), />Backlog</);
  const types = body.events.map((e) => e.type);
  for (const type of ['user', 'turn.started', 'tool.call', 'tool.result', 'ops.applied', 'text', 'turn.completed']) {
    assert.ok(types.includes(type), type);
  }
  assert.equal(body.meta.needsReview, true);
  assert.ok((await heard).includes('changed'));
});

test('the conversation stream replays what happened and follows what happens next', async () => {
  const { conversationId, turnId } = await start('script:wait');
  const seen = await frames(`/agent/events?conversation=${conversationId}&after=0`, (s) =>
    s.some((d) => d.includes('"turn.completed"')),
  );
  const events = seen.map((d) => JSON.parse(d));
  assert.equal(events[0].type, 'user', 'replayed from the start');
  assert.ok(events.some((e) => e.type === 'text.delta'), 'live deltas arrive');
  assert.ok(events.some((e) => e.type === 'turn.completed'));
  const seqs = events.map((e) => e.seq).filter((seq) => seq !== undefined);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1), 'every stored event exactly once, in order');
  await finished(conversationId, turnId);
});

test('undo over HTTP puts the heading back, once', async () => {
  const first = await api('POST', `/agent/turns/${edited.turnId}/undo`);
  assert.deepEqual(first.body, { reverted: 1, kept: 0, errors: [] });
  assert.match(await drive.store.read('garden'), />Research Garden</);
  const again = await api('POST', `/agent/turns/${edited.turnId}/undo`);
  assert.equal(again.status, 409);
  const { body } = await api('GET', `/agent/conversations/${edited.conversationId}`);
  assert.equal(body.events.at(-1).type, 'turn.undone');
});

test('reviewed and archived', async () => {
  const reviewed = await api('PATCH', `/agent/conversations/${edited.conversationId}`, { reviewed: true });
  assert.equal(reviewed.body.needsReview, false);
  await api('PATCH', `/agent/conversations/${edited.conversationId}`, { archived: true });
  const listed = await api('GET', '/agent/conversations');
  assert.ok(!listed.body.some((c) => c.id === edited.conversationId));
  const archived = await api('GET', '/agent/conversations?archived=1');
  assert.ok(archived.body.some((c) => c.id === edited.conversationId));
});

test('a handoff links both conversations and briefs the next agent', async () => {
  const next = await start('Carry on', 'garden', { handoffFrom: edited.conversationId });
  const { body } = await finished(next.conversationId, next.turnId);
  assert.equal(body.meta.handoffFrom, edited.conversationId);
  assert.match(body.events.find((e) => e.type === 'text').text, /^prompt:This continues an earlier conversation/);
  const old = await api('GET', `/agent/conversations/${edited.conversationId}`);
  assert.equal(old.body.meta.handoffTo, next.conversationId);
});

test('tools answer only a running turn’s token, and the token dies with the turn', async () => {
  assert.equal((await api('GET', '/agent/tools')).status, 401);
  assert.equal((await api('POST', '/agent/tools/read_document', { arguments: {} }, { Authorization: 'Bearer nope' })).status, 401);

  const held = await start('script:hold');
  const token = await until(() => drive.agents.runner.running()[0]?.token);
  const listed = await api('GET', '/agent/tools', null, { Authorization: `Bearer ${token}` });
  assert.equal(listed.body.tools.length, 5);

  const cancelled = await api('POST', `/agent/turns/${held.turnId}/cancel`);
  assert.deepEqual(cancelled.body, { cancelled: true });
  assert.equal((await finished(held.conversationId, held.turnId)).turn.status, 'cancelled');
  assert.equal((await api('GET', '/agent/tools', null, { Authorization: `Bearer ${token}` })).status, 401);
});

test('only loopback is loopback', () => {
  assert.equal(isLoopback({ socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), true);
  assert.equal(isLoopback({ socket: { remoteAddress: '100.108.111.56' } }), false);
});

test('a mutation from another origin is refused', async () => {
  const { status } = await api('POST', '/agent/conversations', { provider: 'fake' }, { Origin: 'http://evil.example' });
  assert.equal(status, 403);
});

test('an unknown provider and a turn with no target are refused up front', async () => {
  assert.equal((await api('POST', '/agent/conversations', { provider: 'nope' })).status, 400);
  const { body } = await api('POST', '/agent/conversations', { provider: 'fake' });
  assert.equal((await api('POST', `/agent/conversations/${body.id}/turns`, { prompt: 'x', context: {} })).status, 400);
});

test('settings are read and saved', async () => {
  const saved = await api('PUT', '/agent/settings', { models: { fake: 'm1' } });
  assert.equal(saved.body.models.fake, 'm1');
  assert.equal((await api('GET', '/agent/settings')).body.defaultProvider, 'fake');
});

test('when agents are allowed, and when not', () => {
  const base = { agents: true, multiTenant: false, secret: null, host: '127.0.0.1', root: '/data/drive', agentWorkdir: '/cache/agents' };
  assert.equal(agentsAllowed(base).ok, true);
  assert.match(agentsAllowed({ ...base, agents: false }).why, /MARBLE_DRIVE_AGENTS/);
  assert.match(agentsAllowed({ ...base, multiTenant: true }).why, /multi-tenant/);
  assert.equal(agentsAllowed({ ...base, host: '0.0.0.0' }).ok, false);
  assert.equal(agentsAllowed({ ...base, host: '0.0.0.0', secret: 'x' }).ok, true);
  assert.match(agentsAllowed({ ...base, agentWorkdir: '/data/drive/.work' }).why, /inside the drive/);
});

test('a host with agents off answers 404 to all of it', async () => {
  const off = await createDrive(loadConfig({ ...process.env, MARBLE_DRIVE_AGENTS: '' }), { log: quiet });
  const offPort = await new Promise((resolve) => off.server.listen(0, '127.0.0.1', () => resolve(off.server.address().port)));
  assert.equal(off.agents, null);
  assert.equal((await fetch(`http://127.0.0.1:${offPort}/agent/providers`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${offPort}/agent/tools`)).status, 404);
  await off.close();
});

test('a document changed outside Marble during a turn is flagged, with a way back', async () => {
  const running = await start('script:wait', 'watched');
  await until(() => drive.agents.runner.running().length === 1);

  const file = path.join(ROOT, 'watched.mrbl');
  const before = await fsp.readFile(file, 'utf8');
  await fsp.writeFile(file, before.replace('Research Garden', 'Scribbled from outside'));

  const { body } = await finished(running.conversationId, running.turnId);
  const flagged = body.events.find((e) => e.type === 'watchdog');
  assert.ok(flagged, 'the turn was flagged');
  assert.equal(flagged.path, 'watched');
  assert.equal(body.meta.lastOutcome, 'watchdog');
  assert.equal(body.meta.needsReview, true);

  const restored = await fetch(`${base}/restore?app=watched&sha=${flagged.sha}`, { method: 'POST' });
  assert.equal(restored.status, 200);
  assert.match(await drive.store.read('watched'), />Research Garden</);
});

// --- Final review: one host runs agents on a drive; nothing else touches its turns. ---

test('a second host on the same drive leaves the first one’s running turn alone, and runs no agents', async () => {
  const held = await start('script:hold');
  await until(() => drive.agents.runner.running().some((t) => t.id === held.turnId));

  const second = await createDrive(config, {
    log: quiet,
    agentProviders: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
  });
  assert.equal(second.agents, null);
  assert.match(second.agentsWhy, new RegExp(`another host \\(pid ${process.pid}\\)`));
  await second.close();

  const utility = await createDrive(config, { log: quiet, agents: false });
  assert.equal(utility.agents, null, 'a utility command never starts agents');
  await utility.close();

  const { body } = await api('GET', `/agent/conversations/${held.conversationId}`);
  assert.equal(body.turns.find((t) => t.id === held.turnId).status, 'running', 'not marked interrupted');
  assert.ok(!body.events.some((e) => e.type === 'turn.interrupted'));
  assert.ok(await fsp.stat(path.join(ROOT, '.marble', 'agents', 'host.lock')), 'the first host still holds the drive');

  await api('POST', `/agent/turns/${held.turnId}/cancel`);
  await finished(held.conversationId, held.turnId);
});

test('a lock left by a host that is no longer running does not keep agents off', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-agents-stale-'));
  const { spawnSync } = await import('node:child_process');
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
  await fsp.mkdir(path.join(root, '.marble', 'agents'), { recursive: true });
  await fsp.writeFile(path.join(root, '.marble', 'agents', 'host.lock'), `${gone}\n`);
  const other = await createDrive(loadConfig({ ...process.env, MARBLE_DRIVE_ROOT: root, MARBLE_DRIVE_AGENTS: '1', MARBLE_DRIVE_AGENT_WORKDIR: WORK }), {
    log: quiet,
    agentProviders: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
  });
  assert.ok(other.agents, 'the stale lock was taken over');
  await other.close();
  await assert.rejects(fsp.stat(path.join(root, '.marble', 'agents', 'host.lock')), { code: 'ENOENT' }, 'released on close');
});

test.after(() => drive.close());
