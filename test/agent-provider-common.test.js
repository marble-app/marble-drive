import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_SCHEMAS } from '../server/agent/tools.js';
import { INSTRUCTIONS, instructionsFor } from '../server/agent/instructions.js';
import { runCommand } from '../server/agent/providers/exec.js';

test('the instructions name every tool and the rules the tools enforce', () => {
  for (const { name } of TOOL_SCHEMAS) {
    const text = name === 'check_document' ? instructionsFor('full') : INSTRUCTIONS;
    assert.ok(text.includes(name), name);
  }
  assert.match(INSTRUCTIONS, /read before you edit/i);
  assert.match(INSTRUCTIONS, /refused/i);
  assert.match(INSTRUCTIONS, /data-marble-id/);
  assert.ok(INSTRUCTIONS.includes('"type":"setText"'));
});

test('a documents agent is told to insert a stub that matches the surrounding UI, then fill it', () => {
  assert.match(INSTRUCTIONS, /insert a stub/i);
  assert.match(INSTRUCTIONS, /surrounding/i);
  assert.match(INSTRUCTIONS, /fill it/i);
});

test('a full agent grows a document the person is viewing instead of Writing the finished subtree', () => {
  const full = instructionsFor('full');
  assert.match(full, /person is viewing/i);
  assert.match(full, /do not Write the finished/i);
});

test('a probe reports what the command printed and how it exited', async () => {
  const result = await runCommand(process.execPath, ['-e', 'console.log("hi"); console.error("there"); process.exit(3)']);
  assert.equal(result.code, 3);
  assert.equal(result.stdout, 'hi\n');
  assert.equal(result.stderr, 'there\n');
  assert.equal(result.missing, false);
});

test('a command that is not installed is missing, not an error', async () => {
  const result = await runCommand('marble-definitely-not-a-command', ['--version']);
  assert.equal(result.missing, true);
  assert.equal(result.code, null);
});

test('a probe that hangs is stopped at its timeout', async () => {
  const started = Date.now();
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 200 });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 2000);
});

test('an aborted command kills the child and reports aborted', async () => {
  const ac = new AbortController();
  const started = Date.now();
  const running = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
    timeout: 2000,
    signal: ac.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  ac.abort();
  const result = await running;
  assert.equal(result.aborted, true);
  assert.ok(Date.now() - started < 2000);
});

test('onStdout sees each chunk as the child writes', async () => {
  const chunks = [];
  const result = await runCommand(
    process.execPath,
    ['-e', 'process.stdout.write("hello"); process.stdout.write(" "); process.stdout.write("there");'],
    { onStdout: (chunk) => chunks.push(String(chunk)) },
  );
  assert.equal(result.stdout, 'hello there');
  assert.ok(chunks.join('').includes('hello'));
  assert.ok(chunks.length >= 1);
});

test('a probe gets exactly the environment it is given', async () => {
  const result = await runCommand(process.execPath, ['-e', 'console.log(process.env.MARBLE_PROBE ?? "unset")'], {
    env: { PATH: process.env.PATH, MARBLE_PROBE: 'seen' },
  });
  assert.equal(result.stdout.trim(), 'seen');
});
