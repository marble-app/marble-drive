// tools/sprite-deploy.sh decides what to deploy before it touches a sprite, and
// --print-plan says what that is and stops. Stubs stand in for the machine: a
// `claude` that is old (as the Sprites image's is), an `npm` that has every
// version, a `sprite` that fails loudly if anything reaches for a real sprite,
// and a `hostname` that says which machine this is.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'tools', 'sprite-deploy.sh');
const PIN = (await fsp.readFile(path.join(REPO, 'tools', 'sprite', 'claude-version'), 'utf8')).trim();

async function plan(args, { host = 'my-laptop' } = {}) {
  const bin = await fsp.mkdtemp(path.join(os.tmpdir(), 'deploy-plan-'));
  const stub = (name, body) => fsp.writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  await stub('claude', 'echo "2.1.1 (Claude Code)"');
  await stub('npm', 'exit 0');
  await stub('sprite', 'echo "sprite was called: $*" >&2; exit 9');
  await stub('hostname', `echo ${host}`);
  return spawnSync('bash', [SCRIPT, ...args, '--print-plan'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
}

test('the Claude version comes from the repo pin, not from whatever claude this machine has', async () => {
  assert.match(PIN, /^\d+\.\d+\.\d+$/);
  const run = await plan(['t-someone', '--local']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`claude: ${PIN.replace(/\./g, '\\.')}\\b`));
  assert.doesNotMatch(run.stdout, /claude: 2\.1\.1\b/);
  assert.doesNotMatch(run.stderr, /sprite was called/);
});

test('--claude still overrides the pin', async () => {
  const run = await plan(['t-someone', '--local', '--claude', '9.9.9']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /claude: 9\.9\.9\b/);
});
