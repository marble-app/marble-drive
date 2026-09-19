import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-cap-root-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-cap-work-'));
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const quiet = { log() {}, error() {} };
const SOURCE = '<!doctype html>\n<html><body data-marble-id="b"><h1 data-marble-id="h">Hi</h1></body></html>\n';

const until = async (check, ms = 5_000) => {
  for (let waited = 0; waited < ms; waited += 40) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timed out');
};

/** A host with one fake provider, watched so the test can see how it was spawned. */
async function hostWith({ capability, power = '', sandbox = null } = {}) {
  const root = await fsp.mkdtemp(path.join(ROOT, 'd-'));
  const seen = [];
  const prepared = [];
  const scripts = { noop: [{ say: 'done' }] };
  const provider = createFakeProvider({ scripts });
  if (capability === null) delete provider.capability;
  else if (capability) provider.capability = capability;
  const spawn = provider.spawn.bind(provider);
  provider.spawn = (opts) => {
    seen.push({ capability: opts.capability, cwd: opts.cwd });
    const spec = spawn(opts);
    return opts.capability === 'full' && opts.cwd ? { ...spec, cwd: opts.cwd } : spec;
  };
  provider.prepare = async (opts) => {
    prepared.push({ capability: opts.capability, browser: opts.browser ?? null });
  };

  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
    MARBLE_DRIVE_AGENT_WORKDIR: await fsp.mkdtemp(path.join(WORK, 'w-')),
    MARBLE_DRIVE_AGENT_POWER: power,
  });
  const drive = await createDrive(config, {
    log: quiet,
    agentProviders: new Map([['fake', provider]]),
    agentSandbox: sandbox,
  });
  await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', resolve));
  await drive.createDocument('notes', SOURCE);
  return { drive, config, seen, prepared, root, scripts, port: drive.server.address().port };
}

/** Run one turn and wait for it to leave the runner. */
async function runTurn(drive, prompt = 'script:noop') {
  const conversation = await drive.agents.store.createConversation({ provider: 'fake' });
  const { turnId } = await drive.agents.runner.send(conversation.id, {
    prompt,
    context: { target: 'notes', viewing: 'notes', selection: [] },
  });
  await until(async () => {
    const turn = await drive.agents.store.turn(turnId);
    return turn && !['queued', 'running'].includes(turn.status) ? turn : null;
  });
  return { conversationId: conversation.id, turnId };
}

async function runTurnWithScript(drive, scripts, script) {
  const name = `s${Math.random().toString(36).slice(2, 10)}`;
  scripts[name] = script;
  return runTurn(drive, `script:${name}`);
}

test('a full turn hands prepare a browser MCP spec; documents does not', async () => {
  const full = await hostWith({ capability: 'full' });
  try {
    await runTurn(full.drive);
    assert.equal(full.prepared.length, 1);
    assert.equal(full.prepared[0].capability, 'full');
    assert.equal(full.prepared[0].browser.command, process.execPath);
    assert.match(full.prepared[0].browser.args[0], /marble-browser-mcp\.js$/);
    assert.match(full.prepared[0].browser.env.MARBLE_BROWSER_PROFILE, /browser-profile$/);
  } finally {
    await full.drive.close();
  }

  const docs = await hostWith({ capability: 'documents' });
  try {
    await runTurn(docs.drive);
    assert.equal(docs.prepared[0].capability, 'documents');
    assert.equal(docs.prepared[0].browser, null);
  } finally {
    await docs.drive.close();
  }
});

test('a later full turn wipes cookies left in the conversation browser profile', async () => {
  const full = await hostWith({ capability: 'full' });
  try {
    const conversation = await full.drive.agents.store.createConversation({ provider: 'fake' });
    const send = () => full.drive.agents.runner.send(conversation.id, {
      prompt: 'script:noop',
      context: { target: 'notes', viewing: 'notes', selection: [] },
    });
    const wait = async (turnId) => until(async () => {
      const turn = await full.drive.agents.store.turn(turnId);
      return turn && !['queued', 'running'].includes(turn.status) ? turn : null;
    });
    await wait((await send()).turnId);
    const profile = path.join(full.config.agentWorkdir, conversation.id, 'browser-profile');
    await fsp.mkdir(profile, { recursive: true });
    await fsp.writeFile(path.join(profile, 'Cookies'), 'stale');
    await wait((await send()).turnId);
    await assert.rejects(fsp.stat(path.join(profile, 'Cookies')), { code: 'ENOENT' });
  } finally {
    await full.drive.close();
  }
});

test('a full provider is spawned rooted at the drive', async () => {
  const { drive, config, seen } = await hostWith({ capability: 'full' });
  try {
    await runTurn(drive);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].capability, 'full');
    assert.equal(seen[0].cwd, config.root, 'a full turn is rooted at the drive');
  } finally {
    await drive.close();
  }
});

test('a documents provider keeps its empty workspace', async () => {
  const { drive, seen } = await hostWith({ capability: 'documents' });
  try {
    await runTurn(drive);
    assert.equal(seen[0].capability, 'documents');
    assert.equal(seen[0].cwd, null, 'no drive cwd is offered to a documents turn');
  } finally {
    await drive.close();
  }
});

test('an adapter that names no capability is spawned at the drive', async () => {
  const { drive, config, seen } = await hostWith({ capability: null });
  try {
    await runTurn(drive);
    assert.equal(seen[0].capability, 'full');
    assert.equal(seen[0].cwd, config.root);
  } finally {
    await drive.close();
  }
});

test('MARBLE_DRIVE_AGENT_POWER=documents holds a full provider down', async () => {
  const { drive, seen } = await hostWith({ capability: 'full', power: 'documents' });
  try {
    await runTurn(drive);
    assert.equal(seen[0].capability, 'documents');
    assert.equal(seen[0].cwd, null);
  } finally {
    await drive.close();
  }
});

test('the sandbox seam sees the spawn and may rewrite it', async () => {
  const wrapped = [];
  const sandbox = ({ command, args, cwd }) => {
    wrapped.push({ command, cwd });
    return { command, args };
  };
  const { drive, config } = await hostWith({ capability: 'full', sandbox });
  try {
    await runTurn(drive);
    assert.equal(wrapped.length, 1, 'the seam saw the spawn');
    assert.equal(wrapped[0].cwd, config.root, 'and is told where it will run');
  } finally {
    await drive.close();
  }
});

test('a document a full turn writes itself is its work, not an intrusion', async () => {
  const { drive, root, scripts } = await hostWith({ capability: 'full' });
  try {
    const file = path.join(root, 'notes.mrbl');
    const { conversationId } = await runTurnWithScript(drive, scripts, [
      { write: { file, text: SOURCE.replace('Hi', 'Rewritten by the agent') } },
      { sleep: 400 },
    ]);
    const events = await drive.agents.store.events(conversationId);
    const kinds = events.map((e) => e.type);

    assert.ok(kinds.includes('document.changed'), 'the turn recorded what it touched');
    assert.ok(!kinds.includes('watchdog'), 'and was not flagged for its own writing');
    const changed = events.find((e) => e.type === 'document.changed');
    assert.equal(changed.path, 'notes');
    assert.ok(changed.sha, 'the restore point taken just before the write travels with it');
  } finally {
    await drive.close();
  }
});

test('a documents turn is still flagged when a document changes under it', async () => {
  const { drive, root, scripts } = await hostWith({ capability: 'documents' });
  try {
    const file = path.join(root, 'notes.mrbl');
    const running = runTurnWithScript(drive, scripts, [{ sleep: 1200 }]);
    await until(() => drive.agents.runner.running().length === 1);
    await fsp.writeFile(file, SOURCE.replace('Hi', 'Scribbled from outside'));

    const { conversationId } = await running;
    const events = await drive.agents.store.events(conversationId);
    assert.ok(events.some((e) => e.type === 'watchdog'), 'a documents turn writes only ops, so this is an intrusion');
    assert.ok(!events.some((e) => e.type === 'document.changed'));
  } finally {
    await drive.close();
  }
});

async function undoOverHttp(port, turnId) {
  const response = await fetch(`http://127.0.0.1:${port}/agent/turns/${turnId}/undo`, { method: 'POST' });
  return { status: response.status, body: await response.json().catch(() => null) };
}

test('undo restores a document the turn rewrote with its own tools', async () => {
  const { drive, root, scripts, port } = await hostWith({ capability: 'full' });
  try {
    const before = await drive.store.read('notes');
    const file = path.join(root, 'notes.mrbl');
    const { turnId } = await runTurnWithScript(drive, scripts, [
      { write: { file, text: SOURCE.replace('Hi', 'Rewritten by the agent') } },
      { sleep: 400 },
    ]);
    assert.notEqual(await drive.store.read('notes'), before, 'the turn really changed it');

    const result = await undoOverHttp(port, turnId);
    assert.equal(result.status, 200);
    assert.equal(await drive.store.read('notes'), before, 'undo put it back');
    assert.ok(result.body.reverted >= 1);
  } finally {
    await drive.close();
  }
});

test('undo of a turn that both wrote and filed ops lands on the pre-turn state', async () => {
  const { drive, root, scripts, port } = await hostWith({ capability: 'full' });
  try {
    const before = await drive.store.read('notes');
    const file = path.join(root, 'notes.mrbl');
    const { turnId } = await runTurnWithScript(drive, scripts, [
      { call: 'read_document', args: { path: 'notes' } },
      { call: 'apply_ops', args: { path: 'notes', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Via ops' }] } },
      { sleep: 200 },
      { write: { file, text: SOURCE.replace('Hi', 'Then rewritten wholesale') } },
      { sleep: 400 },
    ]);

    await undoOverHttp(port, turnId);
    assert.equal(await drive.store.read('notes'), before, 'one undo, not two, and it lands on the start');
  } finally {
    await drive.close();
  }
});

