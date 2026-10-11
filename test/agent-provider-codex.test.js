import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CODEX_MODES } from '../server/agent/catalog.js';
import { DRIVE_INSTRUCTIONS, INSTRUCTIONS } from '../server/agent/instructions.js';
import { createCodexProvider, parseCodexLine, parseCodexModels, tomlString } from '../server/agent/providers/codex.js';
import { builtInProviders } from '../server/agent/providers/index.js';
import { WAIT_MAX } from '../server/agent/messages.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'providers');

const parseAll = (name) => {
  const state = {};
  return fs.readFileSync(path.join(FIXTURES, `${name}.jsonl`), 'utf8').trim().split('\n').flatMap((line) => parseCodexLine(line, state));
};
const brief = (events) =>
  events.map((e) =>
    e.type === 'tool.call' ? `call:${e.name}` : e.type === 'tool.result' ? `result:${e.ok}` : e.type === 'text' ? `text:${e.text}` : e.type === 'done' ? `done:${e.ok}` : e.type,
  );

const MCP = { command: '/usr/bin/node', args: ['/app/bin/marble-mcp.js'], env: { MARBLE_DRIVE_URL: 'http://127.0.0.1:4400', MARBLE_AGENT_TOKEN: 'tok-7f3a91' } };
const BROWSER = { command: '/usr/bin/node', args: ['/app/bin/marble-browser-mcp.js'], env: { MARBLE_BROWSER_PROFILE: '/w/p', MARBLE_BROWSER_ORIGIN: 'http://127.0.0.1:4400', MARBLE_BROWSER_PASS: 'pass-9c1e44' } };
const turn = (over = {}) => ({ workspace: '/w', prompt: 'hello', mcp: MCP, browser: BROWSER, capability: 'full', kind: 'drive', cwd: '/drive', ...over });
// The value of a `-c key=value` pair, or undefined.
const config = (args, key) => {
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === '-c' && args[i + 1].startsWith(`${key}=`)) return args[i + 1].slice(key.length + 1);
  }
  return undefined;
};

test('a recorded turn with a Marble tool, a command and a file edit reads as the runner expects', () => {
  const events = parseAll('codex-1');
  assert.deepEqual(brief(events), [
    'session',
    'text:I’ll perform those three actions in order.\n',
    'call:read_document',
    'result:true',
    'call:Bash',
    'result:true',
    'call:Edit',
    'result:true',
    'text:Read “garden,” ran `echo hi`, and changed “garden” to “backlog” in notes.txt using apply_patch.',
    'usage',
    'done:true',
  ]);
  assert.equal(events[0].id, '01a0f80a-ea49-7401-9738-b5d8394b2f78');
  assert.deepEqual(events.find((e) => e.name === 'read_document').input, { path: 'garden' });
  // The shell's own wrapper is not the command anyone asked for.
  assert.deepEqual(events.find((e) => e.name === 'Bash').input, { command: 'echo hi' });
  assert.equal(events.find((e) => e.name === 'Edit').input.file_path, '/tmp/codex-rec/notes.txt');
  const results = events.filter((e) => e.type === 'tool.result');
  assert.match(results[0].summary, /"path":"garden"/);
  assert.equal(results[1].summary, 'hi\n');
  // Each result answers the call it belongs to.
  const calls = events.filter((e) => e.type === 'tool.call').map((e) => e.callId);
  assert.deepEqual(results.map((e) => e.callId), calls);
  assert.deepEqual(events.find((e) => e.type === 'usage'), { type: 'usage', inputTokens: 99502, outputTokens: 182 });
});

test('a resumed turn keeps its thread', () => {
  const events = parseAll('codex-2');
  assert.deepEqual(brief(events), ['session', 'text:backlog', 'usage', 'done:true']);
  assert.equal(events[0].id, '01a0f80a-ea49-7401-9738-b5d8394b2f78');
});

test('a refused key ends the turn once, in OpenAI\'s words, without the retries or the plumbing', () => {
  const events = parseAll('codex-3');
  assert.deepEqual(brief(events), ['session', 'done:false']);
  const { error } = events.at(-1);
  assert.match(error, /^unexpected status 401 Unauthorized: Incorrect API key provided/);
  assert.doesNotMatch(error, /Reconnecting|cf-ray|request id|url:/);
});

test('a command that exited non-zero is a failed call', () => {
  const state = {};
  const item = { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc \"curl -sS -w '%{http_code}' https://example.com\"" };
  const [call] = parseCodexLine(JSON.stringify({ type: 'item.started', item: { ...item, status: 'in_progress' } }), state);
  assert.deepEqual(call.input, { command: "curl -sS -w '%{http_code}' https://example.com" });
  const [result] = parseCodexLine(JSON.stringify({ type: 'item.completed', item: { ...item, aggregated_output: 'curl: (6) Could not resolve host', exit_code: 6, status: 'failed' } }), state);
  assert.equal(result.ok, false);
  assert.match(result.summary, /Could not resolve host/);
});

test('a call that arrives only completed still gets its call before its result', () => {
  const events = parseCodexLine(JSON.stringify({ type: 'item.completed', item: { id: 'w1', type: 'web_search', query: 'marble drive' } }), {});
  assert.deepEqual(events.map((e) => e.type), ['tool.call', 'tool.result']);
  assert.equal(events[0].name, 'WebSearch');
  assert.deepEqual(events[0].input, { query: 'marble drive' });
});

test('a failed Marble tool call is not ok, and says why', () => {
  const state = {};
  const item = { id: 'm1', type: 'mcp_tool_call', server: 'marble_drive', tool: 'apply_ops', arguments: { path: 'a' } };
  parseCodexLine(JSON.stringify({ type: 'item.started', item: { ...item, status: 'in_progress' } }), state);
  const [result] = parseCodexLine(JSON.stringify({ type: 'item.completed', item: { ...item, result: null, error: { message: 'stale: q1 changed' }, status: 'failed' } }), state);
  assert.equal(result.ok, false);
  assert.equal(result.summary, 'stale: q1 changed');
});

test('reasoning, plans and transport notices are not the turn\'s words', () => {
  const state = {};
  for (const item of [
    { id: 'r', type: 'reasoning', text: 'thinking' },
    { id: 't', type: 'todo_list', items: [{ text: 'a', completed: false }] },
    { id: 'e', type: 'error', message: 'Falling back from WebSockets to HTTPS transport.' },
  ]) {
    assert.deepEqual(parseCodexLine(JSON.stringify({ type: 'item.completed', item }), state), []);
  }
  assert.deepEqual(parseCodexLine(JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5' }), state), []);
  assert.deepEqual(parseCodexLine(JSON.stringify({ type: 'turn.started' }), state), []);
});

test('the catalog keeps the models Codex lists, each with its own efforts', () => {
  const json = JSON.stringify({ models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'ultra' }] },
    { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', supported_reasoning_levels: [{ effort: 'low' }] },
    { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', supported_reasoning_levels: [{ effort: 'xhigh' }] },
  ] });
  assert.deepEqual(parseCodexModels(json), [
    { id: 'gpt-6-astra', label: 'GPT-6-Astra', efforts: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }, { id: 'ultra', label: 'Ultra' }], hasBare: true },
    { id: 'gpt-5.5', label: 'GPT-5.5', efforts: [{ id: 'xhigh', label: 'Extra High' }], hasBare: true },
  ]);
  assert.deepEqual(parseCodexModels('not json'), []);
});

test('ids, labels, modes, and its place among the built-in agents', () => {
  const provider = createCodexProvider({ env: {} });
  assert.equal(provider.id, 'codex');
  assert.equal(provider.label, 'Codex');
  assert.equal(provider.capability, 'full');
  assert.deepEqual(provider.modes, CODEX_MODES);
  assert.deepEqual(CODEX_MODES.map((m) => m.id), ['full', 'workspace', 'read']);
  assert.ok(builtInProviders({ env: {} }).has('codex'));
});

test('a first turn is codex exec --json in the project, prompt on stdin, Marble added by -c', () => {
  const spec = createCodexProvider({ env: {} }).spawn(turn({ model: 'gpt-6-astra', effort: 'high' }));
  assert.equal(spec.command, 'codex');
  assert.deepEqual(spec.args.slice(0, 3), ['exec', '--json', '--skip-git-repo-check']);
  assert.equal(spec.args.at(-1), '-');
  assert.equal(spec.stdin, 'hello');
  assert.equal(spec.cwd, '/drive');
  assert.equal(spec.args[spec.args.indexOf('-C') + 1], '/drive');
  assert.equal(spec.args[spec.args.indexOf('-s') + 1], 'danger-full-access');
  assert.equal(spec.args[spec.args.indexOf('-m') + 1], 'gpt-6-astra');
  assert.equal(config(spec.args, 'model_reasoning_effort'), '"high"');
  assert.ok(!spec.args.includes('resume'));
  assert.ok(!spec.args.includes('--ignore-user-config'), 'a full turn is the terminal\'s own Codex');

  assert.equal(config(spec.args, 'mcp_servers.marble_drive.command'), '"/usr/bin/node"');
  assert.equal(config(spec.args, 'mcp_servers.marble_drive.args'), '["/app/bin/marble-mcp.js"]');
  assert.equal(config(spec.args, 'mcp_servers.marble_drive.env_vars'), '["MARBLE_DRIVE_URL", "MARBLE_AGENT_TOKEN"]');
  assert.equal(config(spec.args, 'mcp_servers.marble_browser.args'), '["/app/bin/marble-browser-mcp.js"]');
  assert.equal(config(spec.args, 'mcp_servers.marble_browser.env_vars'), '["MARBLE_BROWSER_PROFILE", "MARBLE_BROWSER_ORIGIN", "MARBLE_BROWSER_PASS_FILE"]');
  // Marble's tools refuse what their rules forbid. In a sandbox, Codex would
  // otherwise want an approval nobody can give, and refuse every call.
  assert.equal(config(spec.args, 'mcp_servers.marble_drive.default_tools_approval_mode'), '"approve"');
  assert.equal(config(spec.args, 'mcp_servers.marble_browser.default_tools_approval_mode'), '"approve"');
  // Secrets travel in the environment the forward list names, never in argv.
  assert.ok(!spec.args.join(' ').includes('tok-7f3a91'));
  assert.ok(!spec.args.join(' ').includes('pass-9c1e44'));
  assert.equal(spec.env.MARBLE_AGENT_TOKEN, 'tok-7f3a91');
  assert.ok(!('MARBLE_BROWSER_PASS' in spec.env), 'the pass is a file, not the environment');

  const instructions = JSON.parse(config(spec.args, 'developer_instructions'));
  assert.ok(instructions.startsWith(DRIVE_INSTRUCTIONS.slice(0, 80)));
  assert.match(instructions, /marble-drive:visuals-in-chat/);
  assert.match(instructions, /agent-plugin\/skills\/visuals-in-chat\/SKILL\.md/);
  // The person's own Codex may bring a browser of its own; Marble's is the
  // one signed in to this drive.
  assert.match(instructions, /marble_browser/);
});

test('a later turn resumes its thread, with the same flags before resume', () => {
  const { args } = createCodexProvider({ env: {} }).spawn(turn({ resume: '01a0f80a-ea49' }));
  const at = args.indexOf('resume');
  assert.ok(at > args.indexOf('-s'));
  assert.deepEqual(args.slice(at), ['resume', '01a0f80a-ea49', '-']);
});

test('each mode is its sandbox, and a mode another agent left behind is Full access', () => {
  const sandbox = (mode) => {
    const { args } = createCodexProvider({ env: {} }).spawn(turn({ mode }));
    return args[args.indexOf('-s') + 1];
  };
  assert.equal(sandbox(null), 'danger-full-access');
  assert.equal(sandbox('full'), 'danger-full-access');
  assert.equal(sandbox('workspace'), 'workspace-write');
  assert.equal(sandbox('read'), 'read-only');
  assert.equal(sandbox('acceptEdits'), 'danger-full-access');
});

test('a model or effort another agent left behind is not handed to Codex', () => {
  const { args } = createCodexProvider({ env: {} }).spawn(turn({ model: 'opus', effort: 'high-fast' }));
  assert.ok(!args.includes('-m'));
  assert.equal(config(args, 'model_reasoning_effort'), undefined);
  const grok = createCodexProvider({ env: {} }).spawn(turn({ model: 'grok-4.7', effort: 'max' })).args;
  assert.ok(!grok.includes('-m'));
  assert.equal(config(grok, 'model_reasoning_effort'), '"max"');
});

test('the OpenAI key goes in as CODEX_API_KEY, and only when one is set', () => {
  const withKey = createCodexProvider({ env: {}, secrets: () => ({ CODEX_API_KEY: 'sk-proj-k' }) }).spawn(turn());
  assert.equal(withKey.env.CODEX_API_KEY, 'sk-proj-k');
  assert.ok(!withKey.args.join(' ').includes('sk-proj-k'));
  const login = createCodexProvider({ env: {} }).spawn(turn());
  assert.ok(!('CODEX_API_KEY' in login.env));
  // A key someone keeps for other work does not quietly move Codex off the login.
  const other = createCodexProvider({ env: { OPENAI_API_KEY: 'sk-other' } }).spawn(turn());
  assert.ok(!('CODEX_API_KEY' in other.env));
});

test('a documents turn runs read-only in the empty workspace, without the person\'s config or the browser', () => {
  const { args, cwd } = createCodexProvider({ env: {} }).spawn(turn({ capability: 'documents', cwd: null }));
  assert.equal(cwd, undefined);
  assert.equal(args[args.indexOf('-C') + 1], '/w');
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  assert.ok(args.includes('--ignore-user-config'));
  assert.equal(config(args, 'mcp_servers.marble_browser.command'), undefined);
  assert.equal(config(args, 'mcp_servers.marble_drive.default_tools_approval_mode'), '"approve"');
  assert.equal(JSON.parse(config(args, 'developer_instructions')), INSTRUCTIONS);
});

test('TOML strings survive quotes, newlines, backslashes and spaces in paths', () => {
  const tricky = 'a "quoted" path\\with\nnewline\tand \u007f del';
  assert.equal(JSON.parse(tomlString(tricky).replace(/\\u007f/g, '\\u007f')), tricky);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(tomlString(tricky)), 'no raw control characters');
  const spaced = { command: '/Users/me/Library/Application Support/node', args: ['/a b/"q".js'], env: { MARBLE_AGENT_TOKEN: 't' } };
  const { args } = createCodexProvider({ env: {} }).spawn(turn({ mcp: spaced }));
  assert.equal(JSON.parse(config(args, 'mcp_servers.marble_drive.command')), spaced.command);
  assert.deepEqual(JSON.parse(config(args, 'mcp_servers.marble_drive.args')), spaced.args);
});

test('detect: not installed, on a key, on the ChatGPT login, and signed out', async () => {
  const sign = (answer) => ({ installed: answer.installed, signedIn: answer.signedIn, detail: answer.detail });
  const answers = (map) => async (command, args) => map[args.join(' ')] ?? { code: 0, stdout: '', stderr: '', missing: false };
  const missing = createCodexProvider({ exec: async () => ({ code: null, stdout: '', stderr: '', missing: true }), env: {} });
  assert.deepEqual(await missing.detect(), { installed: false, signedIn: false, detail: 'codex is not installed' });

  const seen = [];
  const keyed = createCodexProvider({
    exec: async (command, args, options) => {
      seen.push(options.env);
      return { code: 0, stdout: 'codex-cli 0.159.3', stderr: '', missing: false };
    },
    env: { PATH: '/bin', MARBLE_DRIVE_SECRET: 's' },
    secrets: () => ({ CODEX_API_KEY: 'sk-proj-k' }),
  });
  assert.deepEqual(sign(await keyed.detect()), { installed: true, signedIn: true, detail: 'on an OpenAI API key' });
  assert.ok(seen.every((env) => !('MARBLE_DRIVE_SECRET' in env)));

  const login = createCodexProvider({ exec: answers({ 'login status': { code: 0, stdout: '', stderr: 'Logged in using ChatGPT\n', missing: false } }), env: {} });
  assert.deepEqual(sign(await login.detect()), { installed: true, signedIn: true, detail: 'signed in with ChatGPT' });

  const out = createCodexProvider({ exec: answers({ 'login status': { code: 1, stdout: '', stderr: 'Not logged in\n', missing: false } }), env: {} });
  const answer = await out.detect();
  assert.equal(answer.signedIn, false);
  assert.match(answer.detail, /OpenAI API key|codex login/);
});

test('listModels reads codex debug models, and an answer it cannot read is no models', async () => {
  const json = JSON.stringify({ models: [{ slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', supported_reasoning_levels: [{ effort: 'high' }] }] });
  const ok = createCodexProvider({ exec: async (command, args) => (args.join(' ') === 'debug models' ? { code: 0, stdout: json, stderr: '' } : {}), env: {} });
  assert.deepEqual((await ok.listModels()).map((m) => m.id), ['gpt-6-astra']);
  const broken = createCodexProvider({ exec: async () => ({ code: 1, stdout: '', stderr: 'boom' }), env: {} });
  assert.deepEqual(await broken.listModels(), []);
});

test('a thread Codex no longer has is a lost session, and stderr\'s Error line is the failure', () => {
  const provider = createCodexProvider({ env: {} });
  const stderr = 'Reading additional input from stdin...\n2026-10-01T14:33 ERROR rmcp::transport::worker: worker quit\nError: thread/resume: thread/resume failed: no rollout found for thread id 01a0 (code -32600)\n';
  const failure = provider.failure(stderr);
  assert.equal(failure, 'thread/resume: thread/resume failed: no rollout found for thread id 01a0 (code -32600)');
  assert.equal(provider.lostSession(failure), true);
  assert.equal(provider.lostSession('unexpected status 401 Unauthorized'), false);
  assert.equal(provider.failure('just noise\n'), null);
});

test('a machine whose sandbox cannot start offers only Full access', async () => {
  const probe = (sandboxCode) => {
    const asked = [];
    const exec = async (command, args) => {
      asked.push(args.join(' '));
      if (args[0] === 'sandbox') return { code: sandboxCode, stdout: '', stderr: sandboxCode ? 'bwrap: Unexpected capabilities but not setuid' : '' };
      if (args[0] === 'login') return { code: 0, stdout: '', stderr: 'Logged in using ChatGPT' };
      return { code: 0, stdout: 'codex-cli 0.159.3', stderr: '' };
    };
    return { provider: createCodexProvider({ exec, env: {} }), asked };
  };
  // A sprite: bubblewrap refuses to run there, so Workspace and Read only
  // would fail every command the agent ran.
  const sprite = probe(1);
  const answer = await sprite.provider.detect();
  assert.equal(answer.signedIn, true);
  assert.deepEqual(answer.modes.map((m) => m.id), ['full']);
  await sprite.provider.detect();
  assert.equal(sprite.asked.filter((a) => a.startsWith('sandbox')).length, 1, 'asked once per host, not per detection');
  // A Mac: the sandbox runs, every mode is offered.
  const mac = probe(0);
  assert.deepEqual((await mac.provider.detect()).modes.map((m) => m.id), ['full', 'workspace', 'read']);
  // Not installed: nothing to probe.
  const none = createCodexProvider({ exec: async () => ({ code: null, missing: true, stdout: '', stderr: '' }), env: {} });
  assert.equal((await none.detect()).modes, undefined);
});

test('the browser\'s pass is a private file the server reads, never in the environment a command inherits', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-codex-pass-'));
  const provider = createCodexProvider({ env: {} });
  await provider.prepare({ workspace, mcp: MCP, browser: BROWSER, capability: 'full' });
  const file = path.join(workspace, 'browser-pass');
  assert.equal(await fsp.readFile(file, 'utf8'), 'pass-9c1e44');
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
  const spec = provider.spawn(turn({ workspace }));
  assert.ok(!('MARBLE_BROWSER_PASS' in spec.env), 'Codex hands its env to every command it runs');
  assert.equal(spec.env.MARBLE_BROWSER_PASS_FILE, file);
  assert.equal(config(spec.args, 'mcp_servers.marble_browser.env_vars'), '["MARBLE_BROWSER_PROFILE", "MARBLE_BROWSER_ORIGIN", "MARBLE_BROWSER_PASS_FILE"]');
  assert.ok(!JSON.stringify(spec).includes('pass-9c1e44'));
  // An open drive's browser has no pass, and gets no file.
  const open = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-codex-nopass-'));
  const bare = { ...BROWSER, env: { MARBLE_BROWSER_PROFILE: '/w/p', MARBLE_BROWSER_ORIGIN: 'http://127.0.0.1:4400' } };
  await provider.prepare({ workspace: open, mcp: MCP, browser: bare, capability: 'full' });
  await assert.rejects(fsp.stat(path.join(open, 'browser-pass')), { code: 'ENOENT' });
  assert.ok(!('MARBLE_BROWSER_PASS_FILE' in provider.spawn(turn({ workspace: open, browser: bare })).env));
});

test('a wait for another agent outlasts Codex\'s own tool timeout', () => {
  const { args } = createCodexProvider({ env: {} }).spawn(turn());
  // Codex gives up on an MCP call after 60 s by default; wait_for_reply may
  // block for WAIT_MAX, and a reply that lands after Codex gave up is lost.
  assert.ok(Number(config(args, 'mcp_servers.marble_drive.tool_timeout_sec')) > WAIT_MAX);
  assert.ok(Number(config(args, 'mcp_servers.marble_browser.tool_timeout_sec')) >= 120);
});

// Features are turned off with -c, never --disable: an unknown --disable is a
// hard error, so a Codex that drops a feature would fail every turn.
const featuresOff = (args) => args.flatMap((a, i) => (a === '-c' && /^features\.\w+=false$/.test(args[i + 1]) ? [args[i + 1].slice(9, -6)] : [])).sort();

test('a documents turn has no shell at all, as Claude and Cursor have none there', () => {
  const { args } = createCodexProvider({ env: {} }).spawn(turn({ capability: 'documents', cwd: null }));
  assert.ok(!args.includes('--disable'));
  assert.ok(featuresOff(args).includes('shell_tool'));
  assert.ok(featuresOff(args).includes('unified_exec'));
  const full = createCodexProvider({ env: {} }).spawn(turn()).args;
  assert.ok(!featuresOff(full).includes('shell_tool'), 'a full turn keeps the terminal\'s shell');
});

test('Codex\'s own browser and computer use are off: they cannot work headless, and Marble\'s browser is signed in', () => {
  for (const capability of ['full', 'documents']) {
    const off = featuresOff(createCodexProvider({ env: {} }).spawn(turn({ capability, cwd: capability === 'full' ? '/drive' : null })).args);
    for (const feature of ['browser_use', 'browser_use_external', 'computer_use', 'in_app_browser']) assert.ok(off.includes(feature), `${capability}: ${feature}`);
  }
});

test('a sandboxed mode cannot be escalated out of, whatever reviewer the person\'s own Codex runs', () => {
  // With approvals_reviewer = "auto_review" in ~/.codex, a write in read-only
  // was asked for and approved (2026-10-01); a Marble mode's word has to hold.
  for (const mode of ['workspace', 'read']) {
    assert.equal(config(createCodexProvider({ env: {} }).spawn(turn({ mode })).args, 'approval_policy'), '"never"', mode);
  }
  assert.equal(config(createCodexProvider({ env: {} }).spawn(turn({ capability: 'documents', cwd: null })).args, 'approval_policy'), '"never"');
  // Full access has nothing to escalate to; the person's own policy stands.
  assert.equal(config(createCodexProvider({ env: {} }).spawn(turn({ mode: 'full' })).args, 'approval_policy'), undefined);
});
