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

test('ids, labels, and the spawn verified by the spike', () => {
  const sub = createClaudeProvider({ auth: 'subscription', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  const api = createClaudeProvider({ auth: 'api', env: { ANTHROPIC_API_KEY: 'sk-test' } });
  assert.equal(sub.id, 'claude-subscription');
  assert.equal(sub.label, 'Claude');
  assert.equal(api.id, 'claude-api');
  assert.equal(api.label, 'Claude (API key)');

  const spec = sub.spawn({ workspace: '/w', prompt: 'Rename it', resume: 'sess-1', model: 'claude-haiku-4-5', env: { PATH: '/bin' } });
  assert.equal(spec.command, 'claude');
  assert.equal(spec.stdin, 'Rename it');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--mcp-config', path.join('/w', 'mcp.json'),
    '--allowedTools', 'mcp__marble', '--setting-sources', 'project', '--disable-slash-commands',
    '--append-system-prompt', INSTRUCTIONS, '--model', 'claude-haiku-4-5', '--resume', 'sess-1',
  ]);
  assert.ok(!spec.args.includes('--bare'));
  assert.deepEqual(spec.env, {}, 'the subscription never gets the API key');
  assert.deepEqual(api.spawn({ workspace: '/w', prompt: 'x', env: {} }).env, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.ok(!sub.spawn({ workspace: '/w', prompt: 'x', env: {} }).args.includes('--resume'));
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
