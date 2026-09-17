// The environment an agent CLI gets from this host: enough to find itself, its
// home and its login, and nothing else. A turn and a detection probe both start
// from it, so a CLI answers `status` the way it will run, and neither ever sees
// the drive's secret or whatever other tokens this host happens to hold.

export const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR'];

export const pickEnv = (env) => Object.fromEntries(ENV_ALLOWLIST.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
