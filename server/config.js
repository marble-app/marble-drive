// Every knob, read once, with the default written next to it.
//
// A deployment is configured by environment because a container is, and the
// alternative — a config file inside the drive root — would be a document the
// Drive can see and edit, which is a lovely idea and a terrible way to hold the
// secret that guards it.

import os from 'node:os';
import path from 'node:path';

export function loadConfig(env = process.env) {
  // Read off the env that was handed in, not off `process.env` — a test that
  // builds a second configuration to check the gate has to be able to say so
  // without editing the environment of the whole process.
  const str = (name, fallback) => {
    const value = env[name];
    return value === undefined || value === '' ? fallback : value;
  };

  const num = (name, fallback) => {
    const value = Number(env[name]);
    return Number.isFinite(value) ? value : fallback;
  };

  const bool = (name, fallback) => {
    const value = str(name, null);
    if (value === null) return fallback;
    return /^(1|true|yes|on)$/i.test(value);
  };

  // The drive root is the only path anything needs to know. Documents live
  // under it; so does the single `.marble/` that holds the history and the op
  // log. One tree, decided here, so that a deployment cannot end up with the
  // two this checkout's ancestor had.
  const root = path.resolve(str('MARBLE_DRIVE_ROOT', path.join(process.cwd(), 'drive')));

  // G2's switch. Unset is G0/G1 unchanged: one drive at `root`, the gate in
  // front of it. Set it and the host is multi-tenant — every account and every
  // person's drive lives under here, and `MARBLE_DRIVE_ROOT` is ignored. See
  // docs/ACCOUNTS.md.
  //
  //   <data>/accounts/     the identity log — not under any drive root
  //   <data>/users/<id>/   one person's drive, exactly what `root` is today
  const dataDir = str('MARBLE_DRIVE_DATA', null);
  const dataResolved = dataDir ? path.resolve(dataDir) : null;

  // Marble's history module resolves its own directory from MARBLE_APPS, and it
  // reads it when it is called rather than when it is imported. Pointing it at
  // the drive root is what makes `<root>/.marble/` the one history tree — the
  // two this checkout's ancestor had were a `npm run dev` tree and a
  // `marble <path>` tree, and a deployment can only have one.
  //
  // Set on the real environment as well as the one handed in, because the code
  // that reads it lives in another package and only ever sees `process.env`.
  env.MARBLE_APPS = root;
  process.env.MARBLE_APPS = root;

  return {
    root,
    port: num('PORT', 4400),
    portIsExplicit: Boolean(str('PORT', null)),
    // Loopback. The way in from another device is a proxy on this machine —
    // Tailscale Serve, see docs/DEPLOY.md — and a container, which has to
    // listen on every interface to be reached at all, says so in its image.
    host: str('HOST', '127.0.0.1'),

    // The document the Drive lands on. An ordinary document with no standing —
    // delete it and `/` falls back to whatever exists.
    home: str('MARBLE_DRIVE_HOME', 'drive'),

    // `/today`'s bookmark: a stable address for whichever document a
    // recurring skill keeps mirroring the latest run into. Same fallback as
    // `/` — missing, it lands on whatever's newest instead of 404ing.
    latestDoc: str('MARBLE_DRIVE_LATEST_DOC', "Bryan's Days/today"),

    // G0's gate. Unset means an open host, which is right for a laptop and
    // wrong for anything with a domain in front of it — so it says so, loudly,
    // once, at boot. On a multi-tenant host this same value is the session
    // signing key rather than a password, and it is required: an unsigned
    // multi-tenant session is every account at once.
    secret: str('MARBLE_DRIVE_SECRET', null),
    cookieName: str('MARBLE_DRIVE_COOKIE', 'marble_drive'),
    sessionCookie: str('MARBLE_DRIVE_SESSION_COOKIE', 'marble_session'),
    sessionDays: num('MARBLE_DRIVE_SESSION_DAYS', 30),
    secureCookie: bool('MARBLE_DRIVE_SECURE_COOKIE', str('NODE_ENV', '') === 'production'),

    // Multi-tenant, or not, and where its data lives. `accountsDir` is
    // deliberately not under any drive root — a file the Drive can see is a
    // file it can edit, and a password hash is not content.
    multiTenant: Boolean(dataResolved),
    dataDir: dataResolved,
    accountsDir: dataResolved ? path.join(dataResolved, 'accounts') : null,
    usersDir: dataResolved ? path.join(dataResolved, 'users') : null,

    // Per account, once there is more than one: a document ceiling and a byte
    // ceiling, checked against what `marble-drive weigh` already computes.
    quotaDocs: num('MARBLE_DRIVE_QUOTA_DOCS', 500),
    quotaBytes: num('MARBLE_DRIVE_QUOTA_BYTES', 512 * 1024 * 1024),

    // Backups off the box. A directory is the honest default: a bind mount, a
    // network share, or a path something else syncs to object storage. A
    // command is the escape hatch for the object storage case proper.
    backupDir: str('MARBLE_DRIVE_BACKUP_DIR', null),
    backupCommand: str('MARBLE_DRIVE_BACKUP_CMD', null),
    backupEveryMinutes: num('MARBLE_DRIVE_BACKUP_MINUTES', 60),
    backupKeep: num('MARBLE_DRIVE_BACKUP_KEEP', 24),

    // A document that carries megabytes of base64 is the case blobs exist for,
    // and `marble-drive weigh` is how you find out before deciding.
    maxBodyBytes: num('MARBLE_DRIVE_MAX_BODY', 16 * 1024 * 1024),
    maxBlobBytes: num('MARBLE_DRIVE_MAX_BLOB', 64 * 1024 * 1024),

    open: bool('MARBLE_DRIVE_OPEN', false),

    // Agents: Claude, Cursor or Codex running on this machine and editing the
    // drive through Marble's tools. Off unless asked for, because it is a
    // process on this machine acting for whoever got through the gate. See
    // docs/AGENTS.md.
    agents: bool('MARBLE_DRIVE_AGENTS', false),
    agentProvider: str('MARBLE_DRIVE_AGENT_PROVIDER', 'claude-subscription'),
    // One switch that holds every provider down to the 2026-09-16 boundary,
    // whatever each adapter declares. The rollback, if a full turn goes wrong.
    agentPower: str('MARBLE_DRIVE_AGENT_POWER', ''),
    // Each conversation's scratch workspace. Deliberately not under the drive
    // root: an agent's own tools should find nothing there worth touching.
    agentWorkdir: path.resolve(str('MARBLE_DRIVE_AGENT_WORKDIR', path.join(os.homedir(), '.cache', 'marble-drive', 'agents'))),
    agentStallMinutes: num('MARBLE_DRIVE_AGENT_STALL_MINUTES', 30),
    // 0 is no cap: a person stops a turn, a timer does not.
    agentMaxMinutes: num('MARBLE_DRIVE_AGENT_MAX_MINUTES', 0),
    // API keys the settings panel writes. Gitignored, and not under the drive
    // root, so a backup of `.marble/` does not take them.
    agentKeysFile: path.resolve(str('MARBLE_DRIVE_AGENT_KEYS', path.join(process.cwd(), '.agent-keys.local'))),

    // Recursive Subquestions on Monitor. The key never lives in a document.
    typesafeApiKey: str('TYPESAFE_API_KEY', null),

    // Fast GenUI: where Space₀ lives. Read-only to the host. Defaults to the
    // Atlas the Design Pattern Generation build writes into the drive.
    genuiAtlas: path.resolve(str('MARBLE_DRIVE_GENUI_ATLAS', path.join(root, 'Research', 'Design Pattern Generation', 'atlas.json'))),
  };
}

export const config = loadConfig();
