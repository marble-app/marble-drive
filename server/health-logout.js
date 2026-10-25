// POST /health/logout: both agent CLIs signed out of the person's own Claude
// and ChatGPT, which marble-host asks for before it removes a drive on the
// owner's PC (server/app.js; docs/HOSTING.md, "The study on each drive").
// It is the logout Settings' Disconnect runs (POST /agent/claude/sign-out and
// /agent/codex/sign-out): `claude auth logout` and `codex logout`, under the
// drive's own home and with no key in the environment. Each CLI is asked
// whether it is signed in before and again after, so the answer says what is
// true now:
//
//   signed-out          it was signed in, or could not say, and is not now
//   was-not-signed-in   it said it was not, or there is no such CLI here
//   failed              it is still signed in, or still cannot say
//
// The answer holds those words and nothing else: never a token, an email or
// what the CLI printed. A sign-in left waiting on the connect sheet ends when
// marble-host stops the drive, which it does next.

import { claudeLogout, claudeStatus } from './agent/claude-signin.js';
import { codexLogout, codexStatus } from './agent/codex-signin.js';
import { runCommand } from './agent/providers/exec.js';

async function signOutOne({ name, status, logout, log }) {
  const before = await status();
  if (!before.installed || (!before.signedIn && !before.timedOut)) return 'was-not-signed-in';
  const out = await logout();
  const after = await status();
  if (!after.installed || (!after.signedIn && !after.timedOut)) return 'signed-out';
  log.error?.(`[logout] ${name} is still signed in after its own logout${out.ok ? '' : ', which failed'}`);
  return 'failed';
}

/** `{ claude, codex }`, each one of the three words above. */
export async function signOutClis({ env = process.env, exec = runCommand, log = console } = {}) {
  const [claude, codex] = await Promise.all([
    signOutOne({ name: 'Claude Code', status: () => claudeStatus({ env, exec }), logout: () => claudeLogout({ env, exec }), log }),
    signOutOne({ name: 'Codex', status: () => codexStatus({ env, exec }), logout: () => codexLogout({ env, exec }), log }),
  ]);
  return { claude, codex };
}
