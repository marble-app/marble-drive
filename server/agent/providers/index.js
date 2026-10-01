// The agent CLIs this host knows how to run. Each is an adapter to the
// runner's contract (see server/agent/runner.js and docs/AGENTS.md); which of
// them is usable on this machine is `detect()`'s answer, not this list's.

import { createClaudeProvider } from './claude.js';
import { createCodexProvider } from './codex.js';
import { createCursorProvider } from './cursor.js';

export const builtInProviders = ({ env = process.env, secrets } = {}) =>
  new Map([
    ['claude-subscription', createClaudeProvider({ auth: 'subscription', env, secrets })],
    ['claude-api', createClaudeProvider({ auth: 'api', env, secrets })],
    ['codex', createCodexProvider({ env, secrets })],
    ['cursor', createCursorProvider({ env, secrets })],
  ]);
