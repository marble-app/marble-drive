// The environment an agent CLI is started with: the allowlist, and nothing
// else this host holds. A guest drive's git identity and its auto-updater
// switch pass (its env file and run-guest set them); keys and the drive's
// secret do not.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ENV_ALLOWLIST, pickEnv } from '../server/agent/env.js';

const GUEST = {
  PATH: '/opt/marble/releases/r1/marble-drive/node_modules/.bin:/usr/bin:/bin',
  HOME: '/var/lib/marble-guests/ana/home',
  GIT_AUTHOR_NAME: 'ana',
  GIT_AUTHOR_EMAIL: 'ana@users.marbledrive.app',
  GIT_COMMITTER_NAME: 'ana',
  GIT_COMMITTER_EMAIL: 'ana@users.marbledrive.app',
  DISABLE_AUTOUPDATER: '1',
  // What must stay behind.
  MARBLE_DRIVE_SECRET: 'hush',
  MARBLE_DOOR_KEYS: 'k1:abc',
  ANTHROPIC_API_KEY: 'sk-ant-api03-x',
  CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x',
  CODEX_API_KEY: 'sk-proj-x',
  OPENAI_API_KEY: 'sk-x',
  GITHUB_TOKEN: 'ghp_x',
  NODE_OPTIONS: '--require /tmp/x.js',
  MARBLE_GUEST: '1',
};

test('a guest\'s git identity and its auto-updater switch reach the agent', () => {
  const env = pickEnv(GUEST);
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'DISABLE_AUTOUPDATER']) {
    assert.equal(env[key], GUEST[key], key);
    assert.ok(ENV_ALLOWLIST.includes(key), key);
  }
  assert.equal(env.HOME, GUEST.HOME);
  assert.equal(env.PATH, GUEST.PATH);
});

test('nothing else of the host does: no key, no token, no secret', () => {
  const env = pickEnv(GUEST);
  for (const key of ['MARBLE_DRIVE_SECRET', 'MARBLE_DOOR_KEYS', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'MARBLE_GUEST']) {
    assert.equal(key in env, false, key);
  }
  assert.deepEqual(Object.keys(env).sort(), Object.keys(env).filter((key) => ENV_ALLOWLIST.includes(key)).sort());
});

test('a variable that is not set is not invented', () => {
  assert.deepEqual(pickEnv({ PATH: '/bin' }), { PATH: '/bin' });
});
