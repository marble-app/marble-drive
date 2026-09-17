import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { INSTRUCTIONS } from '../server/agent/instructions.js';
import { createCursorProvider, parseCursorLine } from '../server/agent/providers/cursor.js';
import { TOOL_SCHEMAS } from '../server/agent/tools.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'providers');
const HOOK = path.join(HERE, '..', 'bin', 'marble-cursor-hook.js');

const parseAll = (name) => {
  const state = {};
  return fs.readFileSync(path.join(FIXTURES, `${name}.jsonl`), 'utf8').trim().split('\n').flatMap((line) => parseCursorLine(line, state));
};
const brief = (events) =>
  events
    .filter((e) => e.type !== 'text.delta')
    .map((e) =>
      e.type === 'tool.call' ? `call:${e.name}` : e.type === 'tool.result' ? `result:${e.ok}` : e.type === 'text' ? `text:${e.text}` : e.type === 'done' ? `done:${e.ok}` : e.type,
    );

test('a recorded turn with two tool calls reads as the runner expects, each message once', () => {
  const events = parseAll('cursor-1');
  assert.deepEqual(brief(events), [
    'session',
    'text:I\'ll use the Marble tools as specified — first checking their schemas, then calling `read_document` and `apply_ops` on "garden".\n',
    'call:read_document',
    'result:true',
    'call:apply_ops',
    'result:true',
    'text:Renamed the garden document heading from "Research Garden" to "Backlog".',
    'usage',
    'done:true',
  ]);
  assert.equal(events[0].id, '248a44d2-e14c-463e-9779-7ad64c3beb2a');
  assert.deepEqual(events.find((e) => e.name === 'apply_ops').input, {
    path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }],
  });
  assert.match(events.find((e) => e.type === 'tool.result').summary, /Research Garden/);
  assert.deepEqual(events.find((e) => e.type === 'usage'), { type: 'usage', inputTokens: 13009, outputTokens: 342 });
});

test('the fragments spell out exactly the messages', () => {
  const events = parseAll('cursor-1');
  const deltas = events.filter((e) => e.type === 'text.delta').map((e) => e.text).join('');
  assert.equal(deltas, events.filter((e) => e.type === 'text').map((e) => e.text).join(''));
});

test('a resumed turn keeps its session', () => {
  assert.deepEqual(brief(parseAll('cursor-2')), ['session', 'text:resumed', 'usage', 'done:true']);
});

test('fragments with no closing message are still stored before the result', () => {
  const state = {};
  const lines = [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Half' }] }, timestamp_ms: 1000 },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ' done' }] }, timestamp_ms: 1001 },
    { type: 'result', subtype: 'success', is_error: false, result: 'Half done', usage: { inputTokens: 1, outputTokens: 2 } },
  ];
  const events = lines.flatMap((l) => parseCursorLine(JSON.stringify(l), state));
  assert.deepEqual(brief(events), ['text:Half done', 'usage', 'done:true']);
});

test('fragments Yes+Yes with whole message YesYes: deltas then one text', () => {
  const state = {};
  const lines = [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Yes' }] }, timestamp_ms: 1789616074003 },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Yes' }] }, timestamp_ms: 1789616074004 },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'YesYes' }] }, model_call_id: 'mid-1', timestamp_ms: 1789616074005 },
  ];
  const events = lines.flatMap((l) => parseCursorLine(JSON.stringify(l), state));
  const deltas = events.filter((e) => e.type === 'text.delta').map((e) => e.text);
  const texts = events.filter((e) => e.type === 'text').map((e) => e.text);
  assert.deepEqual(deltas, ['Yes', 'Yes']);
  assert.deepEqual(texts, ['YesYes']);
  assert.equal(deltas.join(''), 'YesYes');
  assert.equal(texts.join(''), 'YesYes');
});

test('a whole message with no preceding fragments: one text', () => {
  const state = {};
  const line = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }, model_call_id: 'mid-1', timestamp_ms: 1789616074005 };
  const events = parseCursorLine(JSON.stringify(line), state);
  assert.deepEqual(brief(events), ['text:Hello']);
});

test('two consecutive identical whole messages: two text events', () => {
  const state = {};
  const line = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Same' }] }, model_call_id: 'mid-1', timestamp_ms: 1789616074005 };
  const line2 = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Same' }] }, model_call_id: 'mid-2', timestamp_ms: 1789616074006 };
  const events1 = parseCursorLine(JSON.stringify(line), state);
  const events2 = parseCursorLine(JSON.stringify(line2), state);
  assert.deepEqual(brief(events1.concat(events2)), ['text:Same', 'text:Same']);
});

test('a tool the hook blocked shows up as a failed call, with the reason', () => {
  const state = {};
  const started = { type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: { editToolCall: { args: { path: '/tmp/x.mrbl' } } } };
  const completed = { type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { editToolCall: { args: { path: '/tmp/x.mrbl' }, result: { rejected: { path: '', reason: 'Marble agents can only use Marble tools' } } } } };
  const events = [started, completed].flatMap((l) => parseCursorLine(JSON.stringify(l), state));
  assert.deepEqual(events, [
    { type: 'tool.call', name: 'edit', input: { path: '/tmp/x.mrbl' }, callId: 'c1' },
    { type: 'tool.result', callId: 'c1', ok: false, summary: 'Marble agents can only use Marble tools' },
  ]);
});

test('an error result ends the turn with Cursor\'s own words', () => {
  const events = parseCursorLine(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'You\'ve hit your usage limit' }), {});
  assert.deepEqual(events.at(-1), { type: 'done', ok: false, error: 'You\'ve hit your usage limit' });
});

test('spawn is the verified invocation, with the default model and the prompt last', () => {
  const provider = createCursorProvider({ env: {} });
  assert.equal(provider.id, 'cursor');
  assert.equal(provider.label, 'Cursor');
  const spec = provider.spawn({ workspace: '/w', prompt: 'Rename it', resume: 'chat-1', model: null, env: {} });
  assert.equal(spec.command, 'cursor-agent');
  assert.deepEqual(spec.args, [
    '-p', '--output-format', 'stream-json', '--stream-partial-output', '--approve-mcps', '--trust',
    '--workspace', '/w', '--model', 'composer-2.5', '--resume', 'chat-1', '--', 'Rename it',
  ]);
  assert.deepEqual(spec.env, {});
  assert.equal(provider.spawn({ workspace: '/w', prompt: 'p', model: 'gpt-5.2', env: {} }).args.at(-3), 'gpt-5.2');
  assert.equal(provider.spawn({ workspace: '/w', prompt: 'p', model: 'gpt-5.2', env: {} }).args.at(-1), 'p');
  assert.deepEqual(createCursorProvider({ env: { CURSOR_API_KEY: 'ck' } }).spawn({ workspace: '/w', prompt: 'p', env: {} }).env, { CURSOR_API_KEY: 'ck' });
});

test('a prompt starting with - comes after -- to avoid being parsed as an option', () => {
  const provider = createCursorProvider({ env: {} });
  const spec = provider.spawn({ workspace: '/w', prompt: '-1 reply with only the word ok', env: {} });
  assert.equal(spec.args.at(-2), '--');
  assert.equal(spec.args.at(-1), '-1 reply with only the word ok');
});

test('prepare writes the MCP config privately, the fail-closed hook, and the instructions', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-cursor-ws-'));
  const mcp = { command: '/usr/bin/node', args: ['/repo/bin/marble-mcp.js'], env: { MARBLE_DRIVE_URL: 'http://127.0.0.1:1', MARBLE_AGENT_TOKEN: 'tok' } };
  await createCursorProvider({ hookPath: '/repo/bin/marble-cursor-hook.js' }).prepare({ workspace, mcp, meta: {} });

  const mcpFile = path.join(workspace, '.cursor', 'mcp.json');
  assert.deepEqual(JSON.parse(await fsp.readFile(mcpFile, 'utf8')), { mcpServers: { marble: mcp } });
  assert.equal((await fsp.stat(mcpFile)).mode & 0o777, 0o600);

  const hooks = JSON.parse(await fsp.readFile(path.join(workspace, '.cursor', 'hooks.json'), 'utf8'));
  assert.equal(hooks.version, 1);
  assert.equal(hooks.hooks.preToolUse.length, 1);
  assert.equal(hooks.hooks.preToolUse[0].failClosed, true);
  assert.match(hooks.hooks.preToolUse[0].command, /marble-cursor-hook\.js/);

  assert.equal(await fsp.readFile(path.join(workspace, 'AGENTS.md'), 'utf8'), INSTRUCTIONS);
});

test('detect: signed in, signed out, not installed', async () => {
  const exec = (answer) => async () => answer;
  assert.deepEqual(
    await createCursorProvider({ exec: exec({ code: 0, stdout: '✓ Logged in as someone@example.com\n', stderr: '', missing: false }) }).detect(),
    { installed: true, signedIn: true, detail: 'signed in as someone@example.com' },
  );
  assert.equal((await createCursorProvider({ exec: exec({ code: 1, stdout: 'Not logged in', stderr: '', missing: false }) }).detect()).signedIn, false);
  assert.deepEqual(
    await createCursorProvider({ exec: exec({ code: null, stdout: '', stderr: '', missing: true }) }).detect(),
    { installed: false, signedIn: false, detail: 'cursor-agent is not installed' },
  );
});

const askHook = (input) => {
  const run = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  return { code: run.status, answer: JSON.parse(run.stdout) };
};

test('the hook allows exactly Marble\'s tools', () => {
  for (const { name } of TOOL_SCHEMAS) {
    assert.deepEqual(askHook(JSON.stringify({ tool_name: `MCP:${name}`, tool_input: {} })).answer, { permission: 'allow' }, name);
  }
});

test('the hook denies everything else, including other MCP servers and nonsense', () => {
  for (const input of [
    JSON.stringify({ tool_name: 'Shell', tool_input: { command: 'rm -rf /' } }),
    JSON.stringify({ tool_name: 'Write', tool_input: {} }),
    JSON.stringify({ tool_name: 'Read', tool_input: {} }),
    JSON.stringify({ tool_name: 'MCP:github_create_issue', tool_input: {} }),
    JSON.stringify({}),
    'not json',
  ]) {
    const { code, answer } = askHook(input);
    assert.equal(code, 0);
    assert.equal(answer.permission, 'deny', input);
    assert.ok(answer.agent_message);
  }
});

test('the hook edge cases: trailing space, case sensitivity, near misses, junk', () => {
  // Trailing space in tool name
  let { code, answer } = askHook(JSON.stringify({ tool_name: 'MCP:read_document ', tool_input: {} }));
  assert.equal(code, 0);
  assert.equal(answer.permission, 'deny', 'trailing space should be denied');
  assert.ok(answer.agent_message);

  // Case sensitivity - lowercase should be denied
  ({ code, answer } = askHook(JSON.stringify({ tool_name: 'mcp:read_document', tool_input: {} })));
  assert.equal(code, 0);
  assert.equal(answer.permission, 'deny', 'lowercase should be denied');
  assert.ok(answer.agent_message);

  // Near miss - extra suffix
  ({ code, answer } = askHook(JSON.stringify({ tool_name: 'MCP:read_document_extra', tool_input: {} })));
  assert.equal(code, 0);
  assert.equal(answer.permission, 'deny', 'near miss should be denied');
  assert.ok(answer.agent_message);

  // ~1 MB junk stdin
  const junk = JSON.stringify({ tool_name: 'x'.repeat(1024 * 1024), tool_input: {} });
  ({ code, answer } = askHook(junk));
  assert.equal(code, 0);
  assert.equal(answer.permission, 'deny', 'large junk input should be denied');
  assert.ok(answer.agent_message);
});
