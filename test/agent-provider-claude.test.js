import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { INSTRUCTIONS } from '../server/agent/instructions.js';
import { createClaudeProvider, parseClaudeLine } from '../server/agent/providers/claude.js';

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

test('a failed tool result is not ok', () => {
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'no document "x"' }] }] } });
  assert.deepEqual(parseClaudeLine(line), [{ type: 'tool.result', callId: 't1', ok: false, summary: 'no document "x"' }]);
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

test('ids, labels, and the spawn verified by the spike', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  const api = createClaudeProvider({ auth: 'api', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  assert.equal(sub.id, 'claude-subscription');
  assert.equal(sub.label, 'Claude');
  assert.equal(api.id, 'claude-api');
  assert.equal(api.label, 'KIXLAB API');

  const spec = sub.spawn({ workspace: '/w', prompt: 'Rename it', resume: 'sess-1', model: 'claude-haiku-4-5', effort: 'high', env: { PATH: '/bin' } });
  assert.equal(spec.command, 'claude');
  assert.equal(spec.stdin, 'Rename it');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--mcp-config', path.join('/w', 'mcp.json'),
    '--allowedTools', 'mcp__marble', '--setting-sources', 'project',
    '--append-system-prompt', INSTRUCTIONS, '--model', 'claude-haiku-4-5', '--effort', 'high', '--resume', 'sess-1',
  ]);
  assert.ok(!spec.args.includes('--bare'));
  assert.ok(!spec.args.includes('--disable-slash-commands'), 'skills and /compact need slash commands on');
  assert.deepEqual(spec.env, {}, 'the subscription never gets the API key');
  assert.deepEqual(api.spawn({ workspace: '/w', prompt: 'x', env: {} }).env, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.ok(!sub.spawn({ workspace: '/w', prompt: 'x', env: {} }).args.includes('--resume'));
  assert.ok(!sub.spawn({ workspace: '/w', prompt: 'x', env: {} }).args.includes('--effort'));
  assert.deepEqual(sub.models.map((m) => m.id), ['haiku', 'sonnet', 'opus', 'fable']);
  assert.deepEqual(sub.models.map((m) => m.label), ['Haiku 4.5', 'Sonnet 4.5', 'Opus 4.1', 'Fable 5']);
  assert.deepEqual(sub.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(sub.modes.map((m) => m.id), ['default', 'acceptEdits', 'plan', 'bypassPermissions']);

  const planned = sub.spawn({ workspace: '/w', prompt: 'x', mode: 'plan', env: {} });
  assert.ok(planned.args.includes('--permission-mode'));
  assert.equal(planned.args[planned.args.indexOf('--permission-mode') + 1], 'plan');
  const bypass = sub.spawn({ workspace: '/w', prompt: 'x', mode: 'bypassPermissions', env: {} });
  assert.ok(bypass.args.includes('--permission-mode'));
  assert.ok(bypass.args.includes('--allow-dangerously-skip-permissions'));
  assert.ok(!sub.spawn({ workspace: '/w', prompt: 'x', env: {} }).args.includes('--permission-mode'));
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
  assert.equal(calls.at(-1).command, 'claude');
  assert.deepEqual(calls.at(-1).args, ['auth', 'status']);
  assert.equal(calls.at(-1).env.ANTHROPIC_API_KEY, undefined, 'probing the subscription without the key');

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
    seen.push(options?.env);
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

test('a subagent\'s deltas and tool results are not the turn\'s', () => {
  const delta = { type: 'stream_event', parent_tool_use_id: 'toolu_1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'inner' } } };
  const result = { type: 'user', parent_tool_use_id: 'toolu_1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', content: 'inner' }] } };
  assert.deepEqual(parseClaudeLine(JSON.stringify(delta)), []);
  assert.deepEqual(parseClaudeLine(JSON.stringify(result)), []);
  assert.equal(parseClaudeLine(JSON.stringify({ ...delta, parent_tool_use_id: null })).length, 1);
  assert.equal(parseClaudeLine(JSON.stringify({ ...result, parent_tool_use_id: null })).length, 1);
});

test('each capability is told the truth about its own tools', async () => {
  const { instructionsFor, INSTRUCTIONS } = await import('../server/agent/instructions.js');

  assert.equal(instructionsFor('documents'), INSTRUCTIONS);
  assert.match(instructionsFor('documents'), /There are no file or shell tools/);

  const full = instructionsFor('full');
  assert.doesNotMatch(full, /There are no file or shell tools/);
  assert.match(full, /data-marble-id/, 'a full agent still has to keep ids');
  assert.match(full, /apply_ops/, 'ops are still the right tool for a live document');
  assert.match(full, /Grep/, 'it must be steered off Read on a 3 MB document');
  assert.match(full, /check_document/);
  assert.match(full, /WebSearch/);
  assert.match(full, /browser_navigate/);
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

test('a full-capability spawn is confined, tooled, and prompt-free', async () => {
  const { instructionsFor } = await import('../server/agent/instructions.js');
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  assert.equal(sub.capability, 'full');

  const spec = sub.spawn({
    workspace: '/w', prompt: 'Rewrite it', capability: 'full', cwd: '/drive', env: { PATH: '/bin' },
  });

  assert.equal(spec.cwd, '/drive', 'a full agent runs in the drive, not the workspace');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--restricted',
    '--tools', 'Bash,Read,Write,Edit,Glob,Grep,TodoWrite,WebSearch,WebFetch',
    '--settings', path.join('/w', 'settings.json'),
    '--permission-prompts', 'none',
    '--strict-mcp-config', '--mcp-config', path.join('/w', 'mcp.json'),
    '--append-system-prompt', instructionsFor('full'),
  ]);
  assert.ok(!spec.args.includes('--setting-sources'), '--restricted already sheds this machine settings');
  assert.ok(!spec.args.includes('--dangerously-skip-permissions'));
});

test('a documents-capability spawn is exactly what it was before', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: {} });
  const before = sub.spawn({ workspace: '/w', prompt: 'x', env: {} });
  const asked = sub.spawn({ workspace: '/w', prompt: 'x', capability: 'documents', cwd: '/drive', env: {} });
  assert.deepEqual(asked.args, before.args, 'the old boundary is untouched by the new one');
  assert.ok(asked.args.includes('--tools') && asked.args[asked.args.indexOf('--tools') + 1] === '');
  assert.equal(asked.cwd, undefined, 'a documents agent still runs in its empty workspace');
});

test('a full-capability prepare writes the browser MCP server and private settings', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-full-'));
  const mcp = { command: 'node', args: ['/bridge.js'], env: { MARBLE_AGENT_TOKEN: 't' } };
  const browser = { command: 'node', args: ['/browser.js'], env: { MARBLE_BROWSER_PROFILE: '/w/browser-profile' } };

  await createClaudeProvider().prepare({ workspace, mcp, browser, meta: {}, capability: 'full' });
  const file = path.join(workspace, 'settings.json');
  const stat = await fsp.stat(file);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')), {
    permissions: { allow: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'WebSearch', 'WebFetch', 'mcp__browser'] },
  });
  const mcpFile = JSON.parse(await fsp.readFile(path.join(workspace, 'mcp.json'), 'utf8'));
  assert.deepEqual(mcpFile.mcpServers.marble, mcp);
  assert.deepEqual(mcpFile.mcpServers.browser, browser);

  const other = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-docs-'));
  await createClaudeProvider().prepare({ workspace: other, mcp, browser, meta: {}, capability: 'documents' });
  await assert.rejects(fsp.stat(path.join(other, 'settings.json')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await fsp.readFile(path.join(other, 'mcp.json'), 'utf8')), { mcpServers: { marble: mcp } });
});
