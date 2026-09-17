// The agent CLIs this host knows how to run. Each is an adapter to the
// runner's contract (see server/agent/runner.js and docs/AGENTS.md); which of
// them is usable on this machine is `detect()`'s answer, not this list's.
//
// Codex is not here yet: its plan was at its usage limit until 2026-10-15, so
// its adapter could not be verified against a real run (Plan 5).

import { createClaudeProvider } from './claude.js';
import { createCursorProvider } from './cursor.js';

export const builtInProviders = ({ env = process.env } = {}) =>
  new Map([
    ['claude-subscription', createClaudeProvider({ auth: 'subscription', env })],
    ['claude-api', createClaudeProvider({ auth: 'api', env })],
    ['cursor', createCursorProvider({ env })],
  ]);
