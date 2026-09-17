import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_SCHEMAS } from '../server/agent/tools.js';
import { INSTRUCTIONS } from '../server/agent/instructions.js';
import { runCommand } from '../server/agent/providers/exec.js';

test('the instructions name every tool and the rules the tools enforce', () => {
  for (const { name } of TOOL_SCHEMAS) assert.ok(INSTRUCTIONS.includes(name), name);
  assert.match(INSTRUCTIONS, /read .* before/i);
  assert.match(INSTRUCTIONS, /refused/i);
  assert.match(INSTRUCTIONS, /data-marble-id/);
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

test('a probe gets exactly the environment it is given', async () => {
  const result = await runCommand(process.execPath, ['-e', 'console.log(process.env.MARBLE_PROBE ?? "unset")'], {
    env: { PATH: process.env.PATH, MARBLE_PROBE: 'seen' },
  });
  assert.equal(result.stdout.trim(), 'seen');
});
