import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { INSTRUCTIONS } from '../server/agent/instructions.js';
import { createClaudeProvider, parseClaudeLine } from '../server/agent/providers/claude.js';

const instructionsModule = await import('../server/agent/instructions.js');

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'providers');
const stream = (name) => fs.readFileSync(path.join(FIXTURES, `${name}.jsonl`), 'utf8').trim().split('\n');
const parseAll = (name) => stream(name).flatMap((line) => parseClaudeLine(line));
const brief = (events) =>
  events
    .filter((e) => e.type !== 'text.delta')
    .map((e) =>
      e.type === 'tool.call' ? `call:${e.name}` : e.type === 'tool.result' ? `result:${e.ok}` : e.type === 'text' ? `text:${e.text}` : e.type === 'done' ? `done:${e.ok}` : e.type,
    );

test('a recorded turn with two tool calls reads as the runner expects', () => {
  const events = parseAll('claude-1');
  assert.deepEqual(brief(events), [
    'session',
    'call:read_document',
    'result:true',
    'call:apply_ops',
    'result:true',
    'text:Renamed the heading from "Research Garden" to "Backlog".',
    'usage',
    'done:true',
  ]);
  assert.equal(events[0].id, '3df910ef-8170-4799-b459-af7b781e4d3b');
  const apply = events.find((e) => e.name === 'apply_ops');
  assert.deepEqual(apply.input, { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] });
  const results = events.filter((e) => e.type === 'tool.result');
  assert.equal(results[0].callId, events.find((e) => e.name === 'read_document').callId);
  assert.match(results[0].summary, /Research Garden/);
  assert.deepEqual(events.find((e) => e.type === 'usage'), { type: 'usage', costUsd: 0.0205657, inputTokens: 25, outputTokens: 437 });
});

test('the live deltas spell out the final text', () => {
  const events = parseAll('claude-1');
  const deltas = events.filter((e) => e.type === 'text.delta').map((e) => e.text).join('');
  assert.equal(deltas, events.find((e) => e.type === 'text').text);
});

test('a resumed turn keeps its session', () => {
  assert.deepEqual(brief(parseAll('claude-2')), ['session', 'text:resumed', 'usage', 'done:true']);
  assert.equal(parseAll('claude-2')[0].id, parseAll('claude-1')[0].id);
});

test('an error result ends the turn with Claude\'s own words', () => {
  const events = parseClaudeLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Claude AI usage limit reached|1789624200' }));
  assert.deepEqual(events.at(-1), { type: 'done', ok: false, error: 'Claude AI usage limit reached|1789624200' });
});

const toolResult = (text) => JSON.stringify({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text }] }] },
});

test('a failed tool result is not ok', () => {
  assert.deepEqual(parseClaudeLine(toolResult('no document "x"')), [
    { type: 'tool.result', callId: 't1', ok: false, denied: false, summary: 'no document "x"' },
  ]);
});

// A command that exited 1 and a command somebody refused arrive identically —
// `is_error: true` — and the drawer used to call both "Blocked". Only one of
// them is a decision, and only that one gets the word.
test('a command that merely failed is not a refusal', () => {
  for (const text of [
    'Exit code 1\n(eval):1: === not found',
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'",
    '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>',
    'Exit code 1\nnpm test failed: 2 tests failed',
  ]) {
    assert.equal(parseClaudeLine(toolResult(text))[0].denied, false, text);
  }
});

test('a refusal is marked denied, whoever made the call', () => {
  for (const text of [
    'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Credential Exploration].',
    'Permission to use Bash was denied',
    'Claude requested permissions to use Bash, but the user denied',
    'Operation not permitted by hook',
  ]) {
    const event = parseClaudeLine(toolResult(text))[0];
    assert.equal(event.denied, true, text);
    assert.equal(event.ok, false, text);
  }
});

test('a result that succeeded is never denied, whatever it says', () => {
  const line = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'permission was denied by the Claude Code auto mode classifier' }] }] },
  });
  const event = parseClaudeLine(line)[0];
  assert.equal(event.ok, true);
  assert.equal(event.denied, false);
});

test('mcp__browser__ and mcp__marble__ prefixes both drop so the UI sees the tool name', () => {
  const browser = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__browser__browser_navigate', input: { url: 'https://example.com/' } }] },
  });
  const marble = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't2', name: 'mcp__marble__read_document', input: { path: 'garden' } }] },
  });
  const native = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't3', name: 'WebSearch', input: { query: 'x' } }] },
  });
  assert.equal(parseClaudeLine(browser)[0].name, 'browser_navigate');
  assert.equal(parseClaudeLine(marble)[0].name, 'read_document');
  assert.equal(parseClaudeLine(native)[0].name, 'WebSearch');
});

test('ids, labels, catalog, and the documents spawn', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  const api = createClaudeProvider({ auth: 'api', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  assert.equal(sub.id, 'claude-subscription');
  assert.equal(sub.label, 'Claude');
  assert.equal(api.id, 'claude-api');
  assert.equal(api.label, 'KIXLAB API');

  const spec = sub.spawn({ workspace: '/w', prompt: 'Rename it', resume: 'sess-1', model: 'claude-haiku-4-5', effort: 'high', env: { PATH: '/bin' } });
  assert.equal(spec.command, 'claude');
  assert.equal(spec.stdin, 'Rename it');
  assert.ok(!spec.stdinOpen, 'a documents turn closes stdin after the prompt as before');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--mcp-config', path.join('/w', 'mcp.json'),
    '--allowedTools', 'mcp__marble', '--setting-sources', 'project',
    '--append-system-prompt', INSTRUCTIONS, '--model', 'claude-haiku-4-5', '--effort', 'high', '--resume', 'sess-1',
  ]);
  assert.deepEqual(spec.env, {}, 'the subscription never gets the API key');
  assert.deepEqual(api.spawn({ workspace: '/w', prompt: 'x', env: {} }).env, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.ok(!sub.spawn({ workspace: '/w', prompt: 'x', env: {} }).args.includes('--resume'));
  assert.deepEqual(sub.models.map((m) => m.id), ['haiku', 'sonnet', 'opus', 'fable']);
  assert.deepEqual(sub.models.map((m) => m.label), ['Haiku 4.5', 'Sonnet 5', 'Opus 5.5', 'Fable 5.1']);
  const oldCli = createClaudeProvider({ version: '2.1.278' });
  const pinned = oldCli.spawn({ workspace: '/w', prompt: 'x', model: 'opus', env: {} });
  assert.equal(pinned.args[pinned.args.indexOf('--model') + 1], 'opus', '2.1.278 rejects claude-opus-5-5; the bare alias is the one it runs');
  const current = createClaudeProvider({ version: '2.1.280' });
  const opus = current.spawn({ workspace: '/w', prompt: 'x', model: 'opus', env: {} });
  assert.equal(opus.args[opus.args.indexOf('--model') + 1], 'claude-opus-5-5[1m]', '2.1.280 and newer can pin Opus 5.5');
  assert.deepEqual(sub.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(sub.modes.map((m) => m.id), ['auto', 'acceptEdits', 'plan', 'manual', 'bypassPermissions']);
});

test('prepare writes the MCP config privately, with the turn\'s bridge', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-claude-ws-'));
  const mcp = { command: '/usr/bin/node', args: ['/repo/bin/marble-mcp.js'], env: { MARBLE_DRIVE_URL: 'http://127.0.0.1:1', MARBLE_AGENT_TOKEN: 'tok' } };
  await createClaudeProvider().prepare({ workspace, mcp, meta: {} });
  const file = path.join(workspace, 'mcp.json');
  assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), { mcpServers: { marble: mcp } });
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
});

test('detect: signed in, signed out, not installed, and the API key', async () => {
  const calls = [];
  const exec = (answer) => async (command, args, options) => {
    calls.push({ command, args, env: options?.env });
    return answer;
  };
  const signedIn = createClaudeProvider({ exec: exec({ code: 0, stdout: '{"loggedIn": true, "authMethod": "claude.ai"}', stderr: '', missing: false }), env: { ANTHROPIC_API_KEY: 'k', PATH: '/bin' } });
  assert.deepEqual(await signedIn.detect(), { installed: true, signedIn: true, detail: 'signed in (claude.ai)' });
  const auth = calls.find((call) => call.args[0] === 'auth');
  assert.equal(auth.command, 'claude');
  assert.deepEqual(auth.args, ['auth', 'status']);
  assert.equal(auth.env.ANTHROPIC_API_KEY, undefined, 'probing the subscription without the key');

  const signedOut = createClaudeProvider({ exec: exec({ code: 1, stdout: '{"loggedIn": false}', stderr: '', missing: false }), env: {} });
  assert.equal((await signedOut.detect()).signedIn, false);

  const missing = createClaudeProvider({ exec: exec({ code: null, stdout: '', stderr: '', missing: true }), env: {} });
  assert.deepEqual(await missing.detect(), { installed: false, signedIn: false, detail: 'claude is not installed' });

  const installed = exec({ code: 0, stdout: '{}', stderr: '', missing: false });
  assert.equal((await createClaudeProvider({ auth: 'api', exec: installed, env: { ANTHROPIC_API_KEY: 'k' } }).detect()).signedIn, true);
  assert.equal((await createClaudeProvider({ auth: 'api', exec: installed, env: {} }).detect()).signedIn, false);

  let key = null;
  const late = createClaudeProvider({
    auth: 'api',
    exec: installed,
    env: {},
    secrets: () => (key ? { ANTHROPIC_API_KEY: key } : {}),
  });
  assert.equal((await late.detect()).signedIn, false);
  key = 'sk-from-file';
  assert.equal((await late.detect()).signedIn, true);
  assert.equal(late.spawn({ workspace: '/w', prompt: 'x' }).env.ANTHROPIC_API_KEY, 'sk-from-file');
});

test('detection probes get the allowlisted environment, never the drive secret', async () => {
  const { ENV_ALLOWLIST } = await import('../server/agent/env.js');
  const host = { PATH: '/bin', HOME: '/h', MARBLE_DRIVE_SECRET: 's3cret', ANTHROPIC_API_KEY: 'k', GITHUB_TOKEN: 'g', NODE_OPTIONS: '--x' };
  const seen = [];
  const exec = async (command, args, options) => {
    if (args[0] === 'auth') seen.push(options?.env);
    return { code: 0, stdout: '{"loggedIn": true}', stderr: '', missing: false };
  };
  await createClaudeProvider({ auth: 'subscription', exec, env: host }).detect();
  await createClaudeProvider({ auth: 'api', exec, env: host }).detect();
  await createClaudeProvider({ auth: 'api', exec, env: { PATH: '/bin' } }).detect();
  assert.deepEqual(seen[0], { PATH: '/bin', HOME: '/h' });
  assert.deepEqual(seen[1], { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual(seen[2], { PATH: '/bin' });
  for (const env of seen) {
    for (const key of Object.keys(env)) assert.ok(ENV_ALLOWLIST.includes(key) || key === 'ANTHROPIC_API_KEY', key);
  }
});

test('a lost session is recognised by what the CLI says', () => {
  const provider = createClaudeProvider({ env: {} });
  assert.equal(provider.lostSession('No conversation found with session ID: 3df910ef'), true);
  assert.equal(provider.lostSession('Claude AI usage limit reached|1789624200'), false);
});

test('Claude (API key) with no key refuses to start rather than use the login', () => {
  const api = createClaudeProvider({ auth: 'api', env: { PATH: '/bin' } });
  assert.throws(() => api.spawn({ workspace: '/w', prompt: 'x', env: {} }), {
    message: 'ANTHROPIC_API_KEY is not set, so KIXLAB API cannot run — set it or choose Claude',
  });
  assert.deepEqual(createClaudeProvider({ auth: 'subscription', env: {} }).spawn({ workspace: '/w', prompt: 'x', env: {} }).env, {});
});

test('a result that is not a success ends the turn failed, even without is_error', () => {
  const events = parseClaudeLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: false }));
  assert.deepEqual(events.at(-1), { type: 'done', ok: false, error: 'error_max_turns' });
  assert.deepEqual(parseClaudeLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })).at(-1), { type: 'done', ok: true });
});

// What the CLI prints when it resumes a session holding a notification it
// never delivered: the notification, then a result with no model turns behind
// it, and only then does it read the prompt it was given.
test('a result with no model turns behind it is not the end of a turn', () => {
  const flush = { type: 'result', subtype: 'success', is_error: false, num_turns: 0, result: '', total_cost_usd: 14.5 };
  assert.deepEqual(parseClaudeLine(JSON.stringify(flush)), []);
  // The same line with a turn behind it is an answer, and still ends the turn.
  assert.deepEqual(parseClaudeLine(JSON.stringify({ ...flush, num_turns: 1, result: 'done' })).at(-1), { type: 'done', ok: true });
});

test('background work is counted from the CLI\'s own task lifecycle', () => {
  const state = {};
  const line = (value) => parseClaudeLine(JSON.stringify(value), state);
  const started = (id) => line({ type: 'system', subtype: 'task_started', task_id: id, description: id });
  const ended = (id, status) => line({ type: 'system', subtype: 'task_notification', task_id: id, status });
  assert.deepEqual(started('a'), [{ type: 'background', pending: 1 }]);
  assert.deepEqual(started('b'), [{ type: 'background', pending: 2 }]);
  assert.deepEqual(ended('a', 'completed'), [{ type: 'background', pending: 1 }]);
  assert.deepEqual(ended('b', 'stopped'), [{ type: 'background', pending: 0 }]);
  // A notification for work this process never started — a task orphaned by an
  // earlier session — counts for nothing.
  assert.deepEqual(ended('gone', 'stopped'), [{ type: 'background', pending: 0 }]);
});

test('a subagent\'s deltas and tool results are not the turn\'s', () => {
  const delta = { type: 'stream_event', parent_tool_use_id: 'toolu_1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'inner' } } };
  const result = { type: 'user', parent_tool_use_id: 'toolu_1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', content: 'inner' }] } };
  assert.deepEqual(parseClaudeLine(JSON.stringify(delta)), []);
  assert.deepEqual(parseClaudeLine(JSON.stringify(result)), []);
  assert.equal(parseClaudeLine(JSON.stringify({ ...delta, parent_tool_use_id: null })).length, 1);
  assert.equal(parseClaudeLine(JSON.stringify({ ...result, parent_tool_use_id: null })).length, 1);
});

test('each capability and project kind gets its own instructions', () => {
  const { instructionsFor, INSTRUCTIONS: DOCS, DRIVE_INSTRUCTIONS, PROJECT_INSTRUCTIONS } = instructionsModule;
  assert.equal(instructionsFor('documents'), DOCS);
  assert.equal(instructionsFor('documents', 'project'), DOCS, 'a documents agent never sees a project');
  assert.match(DOCS, /There are no file or shell tools/);

  assert.equal(instructionsFor('full'), DRIVE_INSTRUCTIONS);
  assert.equal(instructionsFor('full', 'drive'), DRIVE_INSTRUCTIONS);
  assert.doesNotMatch(DRIVE_INSTRUCTIONS, /reach nothing outside/);
  assert.match(DRIVE_INSTRUCTIONS, /data-marble-id/);
  assert.match(DRIVE_INSTRUCTIONS, /apply_ops/);
  assert.match(DRIVE_INSTRUCTIONS, /Grep/);
  assert.match(DRIVE_INSTRUCTIONS, /check_document/);

  assert.equal(instructionsFor('full', 'project'), PROJECT_INSTRUCTIONS);
  assert.match(PROJECT_INSTRUCTIONS, /usual coding agent/);
  assert.match(PROJECT_INSTRUCTIONS, /apply_ops/);
  assert.ok(PROJECT_INSTRUCTIONS.length < DRIVE_INSTRUCTIONS.length, 'a project agent needs less telling');
});

test('prepare replaces an existing, looser MCP config with a private one, and leaves nothing beside it', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-claude-ws-'));
  const file = path.join(workspace, 'mcp.json');
  await fsp.writeFile(file, '{"old": true}', { mode: 0o644 });
  await fsp.chmod(file, 0o644);
  const mcp = { command: '/usr/bin/node', args: [], env: { MARBLE_AGENT_TOKEN: 'tok2' } };
  await createClaudeProvider().prepare({ workspace, mcp, meta: {} });
  assert.equal((await fsp.stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fsp.readFile(file, 'utf8')).mcpServers.marble.env.MARBLE_AGENT_TOKEN, 'tok2');
  assert.deepEqual(await fsp.readdir(workspace), ['mcp.json']);
});

test('a full-capability spawn is the terminal\'s, with Marble added and prompts routed to stdin', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  const { DRIVE_INSTRUCTIONS, PROJECT_INSTRUCTIONS } = instructionsModule;
  const spec = sub.spawn({ workspace: '/w', prompt: 'Rewrite it', capability: 'full', kind: 'drive', cwd: '/drive', env: { PATH: '/bin' } });
  assert.equal(spec.cwd, '/drive');
  assert.equal(spec.stdinOpen, true);
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'auto',
    '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio',
    '--mcp-config', path.join('/w', 'mcp.json'),
    '--append-system-prompt', DRIVE_INSTRUCTIONS,
  ]);
  for (const gone of ['--restricted', '--tools', '--settings', '--strict-mcp-config', '--setting-sources', '--model', '--effort']) {
    assert.ok(!spec.args.includes(gone), `${gone} must not be passed`);
  }
  const lines = spec.stdin.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines[0], { type: 'control_request', request_id: 'marble-init', request: { subtype: 'initialize', hooks: {} } });
  assert.deepEqual(lines[1], { type: 'user', message: { role: 'user', content: 'Rewrite it' } });

  const project = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'full', kind: 'project', cwd: '/repo', model: 'fable', effort: 'high', resume: 's1', mode: 'manual', env: {} });
  assert.equal(project.args[project.args.indexOf('--append-system-prompt') + 1], PROJECT_INSTRUCTIONS);
  assert.equal(project.args[project.args.indexOf('--permission-mode') + 1], 'manual');
  assert.deepEqual(project.args.slice(-6), ['--model', 'fable', '--effort', 'high', '--resume', 's1']);

  const legacy = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'full', kind: 'drive', cwd: '/drive', mode: 'default', env: {} });
  assert.equal(legacy.args[legacy.args.indexOf('--permission-mode') + 1], 'auto', 'a stored default mode runs as auto');
  const bypass = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'full', kind: 'drive', cwd: '/drive', mode: 'bypassPermissions', env: {} });
  assert.ok(bypass.args.includes('--allow-dangerously-skip-permissions'));
});

test('a documents-capability spawn is exactly what it was before', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  const before = sub.spawn({ workspace: '/w', prompt: 'x', env: {} });
  const asked = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'documents', kind: 'drive', cwd: '/drive', env: {} });
  assert.deepEqual(asked.args, before.args, 'the old boundary is untouched by the new one');
  assert.ok(asked.args.includes('--tools') && asked.args[asked.args.indexOf('--tools') + 1] === '');
  assert.equal(asked.cwd, undefined, 'a documents agent still runs in its empty workspace');
});

test('a full-capability prepare writes only a private mcp.json, with the browser server, and no settings file', async () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-claude-full-'));
  const mcp = { command: 'node', args: ['/bridge.js'], env: { MARBLE_AGENT_TOKEN: 't' } };
  const browser = { command: 'node', args: ['/browser.js'], env: { MARBLE_BROWSER_PROFILE: '/p' } };
  await sub.prepare({ workspace, mcp, browser, capability: 'full', kind: 'drive' });
  const mcpFile = JSON.parse(await fsp.readFile(path.join(workspace, 'mcp.json'), 'utf8'));
  assert.deepEqual(mcpFile.mcpServers.marble, mcp);
  assert.deepEqual(mcpFile.mcpServers.browser, browser);
  assert.equal((await fsp.stat(path.join(workspace, 'mcp.json'))).mode & 0o777, 0o600);
  await assert.rejects(fsp.stat(path.join(workspace, 'settings.json')), { code: 'ENOENT' });
});

test('a permission prompt on stdout becomes an ask, the initialize reply becomes a catalog, and init lists skills', () => {
  const ask = parseClaudeLine(JSON.stringify({
    type: 'control_request', request_id: 'r1',
    request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', display_name: 'AskUserQuestion', input: { questions: [] }, tool_use_id: 'tu1', requires_user_interaction: true },
  }));
  assert.deepEqual(ask, [{ type: 'ask', requestId: 'r1', tool: 'AskUserQuestion', displayName: 'AskUserQuestion', input: { questions: [] }, interactive: true }]);

  const bash = parseClaudeLine(JSON.stringify({
    type: 'control_request', request_id: 'r2',
    request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tu2' },
  }));
  assert.equal(bash[0].displayName, 'Bash');
  assert.equal(bash[0].interactive, false);

  const catalog = parseClaudeLine(JSON.stringify({
    type: 'control_response',
    response: { subtype: 'success', request_id: 'marble-init', response: { commands: [{ name: 'apple-design', description: 'Apple UI' }, { name: 'superpowers:brainstorming', description: 'Design first' }] } },
  }));
  assert.deepEqual(catalog, [{ type: 'catalog', skills: [{ id: 'apple-design', name: 'apple-design', description: 'Apple UI' }, { id: 'superpowers:brainstorming', name: 'superpowers:brainstorming', description: 'Design first' }] }]);
  assert.deepEqual(parseClaudeLine(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'other' } })), []);

  const init = parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', slash_commands: ['compact', 'apple-design'], agents: ['Explore'] }));
  assert.deepEqual(init, [
    { type: 'session', id: 's' },
    { type: 'catalog', skills: [{ id: 'compact', name: 'compact', description: '' }, { id: 'apple-design', name: 'apple-design', description: '' }], agents: ['Explore'] },
  ]);
});
