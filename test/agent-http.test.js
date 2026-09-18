import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-agents-http-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-agents-work-'));
const KEYS = path.join(WORK, 'agent-keys.local');
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';
process.env.MARBLE_DRIVE_AGENT_KEYS = KEYS;

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
  // The two timing tests below work in their own document so the garden
  // stays as the undo tests expect it.
  orchard: [
    { call: 'read_document', args: { path: 'orchard' } },
    { call: 'apply_ops', args: { path: 'orchard', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
  orchardLate: [
    { sleep: 600 },
    { call: 'read_document', args: { path: 'orchard' } },
    { call: 'apply_ops', args: { path: 'orchard', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed late.' },
  ],
  wait: [{ sleep: 2500 }, { say: 'waited' }],
  hold: [{ silent: 20_000 }],
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
};

const config = loadConfig({
  ...process.env,
  MARBLE_DRIVE_AGENTS: '1',
  MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
  MARBLE_DRIVE_AGENT_WORKDIR: WORK,
  MARBLE_DRIVE_AGENT_KEYS: KEYS,
});
const USAGE = {
  meters: [{
    id: 'claude-subscription',
    label: 'Claude',
    used: 23,
    left: 77,
    window: '5h',
    resetsAt: '2026-09-17T22:30:00Z',
    detail: '5h 23% used · week 41% used',
  }],
};
const drive = await createDrive(config, {
  log: quiet,
  agentProviders: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
  usage: async () => USAGE,
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
  assert.deepEqual(body, [{
    id: 'fake',
    label: 'Fake',
    defaultModel: null,
    models: [{ id: 'fake', label: 'Fake' }, { id: 'alt', label: 'Alt' }],
    efforts: ['low', 'high'],
    modes: [{ id: 'default', label: 'Default' }, { id: 'plan', label: 'Plan' }],
    installed: true,
    signedIn: true,
    detail: 'scripted',
    default: true,
  }]);
});

test('the workspace where-line is the drive path and git branch', async () => {
  const { status, body } = await api('GET', '/agent/workspace');
  assert.equal(status, 200);
  assert.equal(typeof body.path, 'string');
  assert.ok(body.path.length > 1);
  assert.ok(body.branch === null || typeof body.branch === 'string');
});

test('usage is used percent per signed-in agent, never a secret', async () => {
  const { status, body } = await api('GET', '/agent/usage');
  assert.equal(status, 200);
  assert.deepEqual(body, USAGE);
  assert.equal(JSON.stringify(body).includes('sk-'), false);
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
  const framesSeen = await heard;
  assert.ok(framesSeen.includes('changed'));
  const presence = framesSeen.flatMap((s) => {
    try {
      const payload = JSON.parse(s);
      return payload?.client ? [payload] : [];
    } catch {
      return [];
    }
  });
  assert.ok(presence.some((p) => p.phase === 'writing' && p.ids?.includes('h')), 'apply_ops tapes the heading');
  assert.ok(presence.some((p) => p.phase === 'reading' || p.phase === 'working'), 'the turn announced itself before the write');
});

const freshOrchard = () => drive.store.write('orchard', SOURCE.replace('Garden', 'Orchard'), { label: 'test' });

const personWrites = (ops, client = 'you') =>
  fetch(`${base}/ops?app=orchard&client=${client}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ops),
  });

test('an edit you made before the turn began does not fork the agent’s rewrite', async () => {
  await freshOrchard();
  assert.equal((await personWrites([{ type: 'setText', id: 'h', text: 'Mine' }])).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const run = await start('script:orchard\nRename the heading', 'orchard');
  const { turn } = await finished(run.conversationId, run.turnId);
  assert.equal(turn.status, 'completed');

  const after = await drive.store.read('orchard');
  assert.doesNotMatch(after, /<marble-alt/, 'the agent read your version before writing; that is not a conflict');
  assert.match(after, />Backlog</);
});

test('an edit you made while the turn ran forks the agent’s rewrite', async () => {
  await freshOrchard();
  const run = await start('script:orchardLate\nRename the heading', 'orchard');
  await until(async () => {
    const { body } = await api('GET', `/agent/conversations/${run.conversationId}`);
    return body.turns.find((t) => t.id === run.turnId)?.status === 'running' ? true : null;
  });
  assert.equal((await personWrites([{ type: 'setText', id: 'h', text: 'Mine' }])).status, 200);

  const { turn } = await finished(run.conversationId, run.turnId);
  assert.equal(turn.status, 'completed');

  const after = await drive.store.read('orchard');
  assert.match(after, /<marble-alt data-marble-id="h"/, 'both of you changed it during the turn');
  assert.match(after, /Mine/);
  assert.match(after, /Backlog/);
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
  assert.equal(listed.body.tools.length, 9);
  assert.ok(listed.body.tools.some((tool) => tool.name === 'check_document'));

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

test('a turn keeps other documents that were also in view', async () => {
  const conversation = await api('POST', '/agent/conversations', { provider: 'fake' });
  const id = conversation.body.id;
  const sent = await api('POST', `/agent/conversations/${id}/turns`, {
    prompt: 'script:edit',
    context: { target: 'garden', viewing: 'garden', selection: [], also: ['watched', 'garden'] },
  });
  assert.equal(sent.status, 202);
  const { body } = await finished(id, sent.body.turnId);
  const user = body.events.find((e) => e.type === 'user');
  assert.deepEqual(user.context.also, ['watched']);
});

test('settings are read and saved', async () => {
  const saved = await api('PUT', '/agent/settings', { models: { fake: 'm1' }, efforts: { fake: 'high' } });
  assert.equal(saved.body.models.fake, 'm1');
  assert.equal(saved.body.efforts.fake, 'high');
  assert.equal((await api('GET', '/agent/settings')).body.defaultProvider, 'fake');
  assert.deepEqual((await api('GET', '/agent/settings')).body.keys, { anthropic: false, cursor: false });
});

test('a new conversation can name its effort, and a later patch changes model and effort', async () => {
  const created = await api('POST', '/agent/conversations', { provider: 'fake', model: 'm-start', effort: 'high' });
  assert.equal(created.body.effort, 'high');
  assert.equal(created.body.model, 'm-start');
  const patched = await api('PATCH', `/agent/conversations/${created.body.id}`, { model: 'm-later', effort: 'low' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.model, 'm-later');
  assert.equal(patched.body.effort, 'low');
});

test('a conversation can name and later change its CLI mode', async () => {
  const created = await api('POST', '/agent/conversations', { provider: 'fake', mode: 'plan' });
  assert.equal(created.body.mode, 'plan');
  const patched = await api('PATCH', `/agent/conversations/${created.body.id}`, { mode: 'default' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.mode, 'default');
});

test('a conversation can change its CLI', async () => {
  const created = await api('POST', '/agent/conversations', { provider: 'fake', model: 'm-start' });
  const patched = await api('PATCH', `/agent/conversations/${created.body.id}`, { provider: 'fake', model: 'alt' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.provider, 'fake');
  assert.equal(patched.body.model, 'alt');
  const nope = await api('PATCH', `/agent/conversations/${created.body.id}`, { provider: 'nope' });
  assert.equal(nope.status, 400);
});

test('a conversation title can be renamed', async () => {
  const created = await api('POST', '/agent/conversations', { provider: 'fake' });
  const patched = await api('PATCH', `/agent/conversations/${created.body.id}`, { title: '  Backlog pass  ' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.title, 'Backlog pass');
});

test('skills are listed without their bodies', async () => {
  const { status, body } = await api('GET', '/agent/skills');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  for (const skill of body) {
    assert.equal(typeof skill.id, 'string');
    assert.ok(!JSON.stringify(skill).includes('---\n'));
  }
});

test('an API key is stored outside the drive and never returned', async () => {
  const secret = 'sk-ant-test-secret-do-not-echo';
  const saved = await api('PUT', '/agent/settings', { keys: { anthropic: secret }, defaultProvider: 'fake' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.keys.anthropic, true);
  assert.equal(JSON.stringify(saved.body).includes(secret), false);
  const got = await api('GET', '/agent/settings');
  assert.equal(got.body.keys.anthropic, true);
  assert.equal(got.body.defaultProvider, 'fake');
  assert.equal(JSON.stringify(got.body).includes(secret), false);
  assert.match(await fsp.readFile(KEYS, 'utf8'), /sk-ant-test-secret-do-not-echo/);
  const underDrive = await fsp.readdir(ROOT, { recursive: true });
  assert.equal(
    underDrive.some((name) => String(name).includes('sk-ant-test-secret')),
    false,
    'the secret must not land under the drive root',
  );
});

test('when agents are allowed, and when not', () => {
  const base = { agents: true, multiTenant: false, secret: null, host: '127.0.0.1', root: '/data/drive', agentWorkdir: '/cache/agents' };
  assert.equal(agentsAllowed(base).ok, true);
  assert.match(agentsAllowed({ ...base, agents: false }).why, /MARBLE_DRIVE_AGENTS/);
  assert.match(agentsAllowed({ ...base, multiTenant: true }).why, /multi-tenant/);
  assert.equal(agentsAllowed({ ...base, host: '0.0.0.0' }).ok, false);
  assert.equal(agentsAllowed({ ...base, host: '0.0.0.0', secret: 'x' }).ok, true);
  assert.match(agentsAllowed({ ...base, agentWorkdir: '/data/drive/.work' }).why, /inside the drive/);
  assert.match(agentsAllowed({ ...base, agentKeysFile: '/data/drive/.agent-keys.local' }).why, /inside the drive/);
  assert.equal(agentsAllowed({ ...base, agentKeysFile: '/cache/agent-keys.local' }).ok, true);
});

test('a workdir named like a parent is still inside the drive; a host bound where loopback cannot reach is refused', () => {
  const base = { agents: true, multiTenant: false, secret: 'x', host: '127.0.0.1', root: '/data/drive', agentWorkdir: '/cache/agents' };
  assert.match(agentsAllowed({ ...base, agentWorkdir: '/data/drive/..work' }).why, /inside the drive/);
  assert.equal(agentsAllowed({ ...base, agentWorkdir: '/data/drive-work' }).ok, true);
  assert.equal(agentsAllowed({ ...base, host: '::' }).ok, true);
  assert.equal(agentsAllowed({ ...base, host: '::1' }).ok, true);
  assert.equal(agentsAllowed({ ...base, host: 'localhost' }).ok, true);
  assert.match(agentsAllowed({ ...base, host: '100.108.111.56' }).why ?? '', /loopback/);
});

test('a host with agents off answers 404 to all of it', async () => {
  const off = await createDrive(loadConfig({ ...process.env, MARBLE_DRIVE_AGENTS: '' }), { log: quiet });
  const offPort = await new Promise((resolve) => off.server.listen(0, '127.0.0.1', () => resolve(off.server.address().port)));
  assert.equal(off.agents, null);
  assert.equal((await fetch(`http://127.0.0.1:${offPort}/agent/providers`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${offPort}/agent/tools`)).status, 404);
  await off.createDocument('plain', SOURCE);
  const plain = await (await fetch(`http://127.0.0.1:${offPort}/a/plain`)).text();
  assert.ok(!plain.includes('/runtime/agent'), 'no agent scripts when agents are off');
  await off.close();
});

test('a document changed outside Marble during a turn is flagged, with a way back', async () => {
  const running = await start('script:wait', 'watched');
  await until(() => drive.agents.runner.running().some((turn) => turn.id === running.turnId));

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

// --- Final review: who counts as this machine, and which host a page came from. ---

/** A raw request, for the headers fetch will not let a caller set. */
const raw = (method, route, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: route, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

test('a tool call that came through a proxy is refused, even with a live token', async () => {
  const held = await start('script:hold');
  const token = await until(() => drive.agents.runner.running().find((t) => t.id === held.turnId)?.token);
  assert.equal(await raw('GET', '/agent/tools', { Authorization: `Bearer ${token}` }), 200);
  for (const header of ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host']) {
    assert.equal(await raw('GET', '/agent/tools', { Authorization: `Bearer ${token}`, [header]: '100.108.111.56' }), 403, header);
  }
  await api('POST', `/agent/turns/${held.turnId}/cancel`);
  await finished(held.conversationId, held.turnId);
});

test('an ungated host answers the agent routes only to a page served as localhost', async () => {
  assert.equal(await raw('GET', '/agent/settings', { Host: 'evil.example' }), 403);
  assert.equal(await raw('GET', '/agent/settings', { Host: `evil.example:${port}` }), 403);
  assert.equal(await raw('GET', '/agent/events', { Host: 'evil.example' }), 403);
  assert.equal(await raw('GET', '/agent/settings', { Host: `127.0.0.1:${port}` }), 200);
  assert.equal(await raw('GET', '/agent/settings', { Host: `localhost:${port}` }), 200);
  assert.equal(await raw('GET', '/agent/settings', { Host: `[::1]:${port}` }), 200);
});

test('two undos of the same turn at once: one runs, the other is refused', async () => {
  // An earlier test leaves the heading at Backlog; a rename to Backlog then
  // changes nothing, records no undo step, and there is nothing to revert.
  await drive.store.write('garden', SOURCE, { label: 'test' });
  const again = await start('script:edit\nRename the heading');
  assert.equal((await finished(again.conversationId, again.turnId)).turn.status, 'completed');
  const [a, b] = await Promise.all([
    api('POST', `/agent/turns/${again.turnId}/undo`),
    api('POST', `/agent/turns/${again.turnId}/undo`),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.match(await drive.store.read('garden'), />Research Garden</);
  const { body } = await api('GET', `/agent/conversations/${again.conversationId}`);
  assert.equal(body.events.filter((e) => e.type === 'turn.undone').length, 1);
});

test('folders can be created, listed, joined, and dissolved over HTTP', async () => {
  const a = await api('POST', '/agent/conversations', { provider: 'fake' });
  const b = await api('POST', '/agent/conversations', { provider: 'fake' });
  await api('PATCH', `/agent/conversations/${a.body.id}`, { title: 'A' });
  const created = await api('POST', '/agent/folders', { conversationIds: [a.body.id, b.body.id], name: 'CHI', color: 'fun' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'CHI');
  const listed = await api('GET', '/agent/folders');
  assert.equal(listed.body.folders.length, 1);
  const moved = await api('PATCH', `/agent/conversations/${a.body.id}`, { folderId: null });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.folderId, null);
});

test('PATCH rejects an unknown folderId', async () => {
  const created = await api('POST', '/agent/conversations', { provider: 'fake' });
  const nope = await api('PATCH', `/agent/conversations/${created.body.id}`, { folderId: 'ffffffffffff' });
  assert.equal(nope.status, 400);
});

test('a removed turn cannot be undone', async () => {
  const running = await start('script:wait');
  const queued = await api('POST', `/agent/conversations/${running.conversationId}/turns`, {
    prompt: 'script:hello', context: { target: 'garden', selection: [] },
  });
  assert.equal((await api('DELETE', `/agent/turns/${queued.body.turnId}`)).body.removed, true);
  assert.equal((await api('POST', `/agent/turns/${queued.body.turnId}/undo`)).status, 409);
  await finished(running.conversationId, running.turnId);
});

test("a document is served with the agent scripts after the Drive's, when agents are on", async () => {
  const page = await (await fetch(`${base}/a/garden`)).text();
  const drive = page.indexOf('/runtime/drive.js');
  const api = page.indexOf('<script src="/runtime/agent.js" data-marble-transient></script>');
  const ui = page.indexOf('<script src="/runtime/agent-ui.js" data-marble-transient></script>');
  assert.ok(drive > 0 && api > drive && ui > api, 'drive.js, then agent.js, then agent-ui.js');
  for (const file of ['agent.js', 'agent-ui.js']) {
    const response = await fetch(`${base}/runtime/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
});

test('a document that presents agents itself gets the API and the conversation element, not a second drawer script skip', async () => {
  await drive.createDocument('custom-agents', SOURCE.replace('<title>', '<meta name="marble-agent" content="custom"><title>'));
  const page = await (await fetch(`${base}/a/custom-agents`)).text();
  assert.ok(page.includes('/runtime/agent.js'));
  assert.ok(page.includes('/runtime/agent-ui.js'), 'custom chrome still needs <marble-conversation>');
  assert.ok(page.includes('/runtime/agent-folders.js'), 'custom chrome still needs folder helpers');
});

test('providers say which model they use unless told otherwise', async () => {
  const { body } = await api('GET', '/agent/providers');
  assert.equal(body[0].defaultModel, null, 'the fake provider has none');
});

test.after(() => drive.close());

test('projects: the drive is listed first, a directory can be added once and removed, and the drive cannot', async () => {
  const repo = await fsp.mkdtemp(path.join(WORK, 'repo-'));
  const listed = await api('GET', '/agent/projects');
  assert.equal(listed.status, 200);
  assert.equal(listed.body[0].id, 'drive');
  assert.equal(listed.body[0].path, ROOT);

  const added = await api('POST', '/agent/projects', { name: 'Repo', path: repo });
  assert.equal(added.status, 201);
  assert.match(added.body.id, /^[0-9a-f]{12}$/);
  assert.equal(added.body.path, repo);
  const again = await api('POST', '/agent/projects', { name: 'Other name', path: `${repo}/` });
  assert.equal(again.status, 200, 'the same path is the same project');
  assert.equal(again.body.id, added.body.id);

  assert.equal((await api('POST', '/agent/projects', { name: 'x', path: 'relative' })).status, 400);
  assert.equal((await api('POST', '/agent/projects', { name: 'x', path: ROOT })).status, 400);

  const conv = await api('POST', '/agent/conversations', { provider: 'fake', project: added.body.id });
  assert.equal(conv.status, 201);
  assert.equal(conv.body.project, added.body.id);
  assert.equal((await api('POST', '/agent/conversations', { provider: 'fake', project: 'nope' })).status, 400);
  assert.equal((await api('POST', '/agent/conversations', { provider: 'fake' })).body.project, 'drive');

  assert.equal((await api('DELETE', '/agent/projects/drive')).status, 400);
  assert.equal((await api('DELETE', `/agent/projects/${added.body.id}`)).status, 200);
  assert.equal((await api('DELETE', `/agent/projects/${added.body.id}`)).status, 404);
  assert.equal((await api('GET', '/agent/projects')).body.length, 1);
});

test('POST /agent/turns/:id/answer answers an open ask once', async () => {
  const conv = (await api('POST', '/agent/conversations', { provider: 'fake' })).body;
  await api('POST', `/agent/conversations/${conv.id}/turns`, { prompt: 'script:permission', context: { target: 'garden' } });
  const ask = await until(async () => (await drive.agents.store.events(conv.id)).find((e) => e.type === 'ask'));
  assert.equal((await api('GET', `/agent/conversations/${conv.id}`)).body.meta.asking, true);
  assert.equal((await api('POST', `/agent/turns/${conv.id}-t1/answer`, { requestId: 'nope', response: {} })).status, 404);
  const ok = await api('POST', `/agent/turns/${conv.id}-t1/answer`, { requestId: ask.requestId, response: { behavior: 'allow' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { answered: true });
  assert.equal((await api('POST', `/agent/turns/${conv.id}-t1/answer`, { requestId: ask.requestId, response: { behavior: 'allow' } })).status, 409);
  assert.equal((await api('POST', `/agent/turns/${conv.id}-t9/answer`, { requestId: 'x', response: {} })).status, 409);
});

test('GET /agent/skills prefers what the CLI reported for that provider', async () => {
  await drive.agents.store.saveSettings({ skills: { fake: [{ id: 'superpowers:brainstorming', name: 'superpowers:brainstorming', description: 'Design first' }] } });
  const forFake = await api('GET', '/agent/skills?provider=fake');
  assert.deepEqual(forFake.body, [{ id: 'superpowers:brainstorming', name: 'superpowers:brainstorming', description: 'Design first' }]);
  const plain = await api('GET', '/agent/skills');
  assert.equal(plain.status, 200);
  assert.ok(Array.isArray(plain.body));
});
