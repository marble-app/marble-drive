// The environment an agent CLI gets from this host: enough to find itself, its
// home and its login, and nothing else. A turn and a detection probe both start
// from it, so a CLI answers `status` the way it will run, and neither ever sees
// the drive's secret or whatever other tokens this host happens to hold.
//
// Two more kinds of thing pass, because without them the agent works for
// someone it is not. The git identity: a drive hosted for a person on the
// owner's PC (docs/HOSTING.md) names that person in its settings, and a commit
// an agent makes there should be theirs, not git's guess. And
// DISABLE_AUTOUPDATER: such a drive runs the Claude Code its release pins, and
// a CLI that updated itself would no longer be the published one it was
// checked as. Neither is a secret.
//
// CLAUDE_CONFIG_DIR passes too: it is the default login a host chose
// (server/agent/claude-accounts.js, "the CLI's own, or whatever
// CLAUDE_CONFIG_DIR the host started with"). Without it a host set to a second
// login probes and runs the first, and says no agent is ready when that one is
// signed out. It names a folder, not a secret.

export const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
  'DISABLE_AUTOUPDATER',
  'CLAUDE_CONFIG_DIR',
];

export const pickEnv = (env) => Object.fromEntries(ENV_ALLOWLIST.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
