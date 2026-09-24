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
    // recurring skill keeps mirroring the latest run into. Unset here, the
    // drive's own `drive.json` names it (server/drive-settings.js); named
    // nowhere, `/today` lands on whatever's newest, like `/`.
    latestDoc: str('MARBLE_DRIVE_LATEST_DOC', null),

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

    // A run the host starts on its own once a day: at `dayAt` (HH:MM) in
    // `dayZone`, `dayPrompt` aimed at `dayTarget`. Off unless both a time and
    // a target are set. A sprite asleep at that hour runs it on waking.
    dayAt: str('MARBLE_DRIVE_DAY_AT', null),
    dayZone: str('MARBLE_DRIVE_DAY_TZ', 'America/Los_Angeles'),
    dayPrompt: str('MARBLE_DRIVE_DAY_PROMPT', '/my-day'),
    dayTarget: str('MARBLE_DRIVE_DAY_TARGET', null),

    // A document that carries megabytes of base64 is the case blobs exist for,
    // and `marble-drive weigh` is how you find out before deciding.
    maxBodyBytes: num('MARBLE_DRIVE_MAX_BODY', 16 * 1024 * 1024),
    maxBlobBytes: num('MARBLE_DRIVE_MAX_BLOB', 64 * 1024 * 1024),
    // A file that is not a document is streamed to disk rather than held, so
    // this is a ceiling on a mistake, not on memory. A long 4K video fits; the
    // disk is checked separately (server/uploads.js).
    maxFileBytes: num('MARBLE_DRIVE_MAX_FILE', 20 * 1024 * 1024 * 1024),
    // A big file goes up in chunks of this size through a session, so a
    // dropped connection costs one chunk and a proxy never sees the whole file.
    uploadChunkBytes: num('MARBLE_DRIVE_UPLOAD_CHUNK', 32 * 1024 * 1024),
    // Room kept back on the drive's disk: an upload that would leave less than
    // this is refused before a byte is sent.
    uploadMarginBytes: num('MARBLE_DRIVE_UPLOAD_MARGIN', 1024 * 1024 * 1024),
    // An upload is timed by silence, not by length: a 2 GB file over a slow
    // link takes as long as it takes, and one that stops sending is cut.
    uploadIdleSeconds: num('MARBLE_DRIVE_UPLOAD_IDLE_SECONDS', 60),
    // macOS's own thumbnailer, for the kinds a page cannot draw itself. On by
    // default where it exists; off makes a Mac behave like any other host.
    quicklook: bool('MARBLE_DRIVE_QUICKLOOK', true),
    // A Fly Sprite's own API. Present only on a sprite; there, the host holds
    // a task on it while work runs so the sprite cannot pause mid-turn.
    spriteSocket: str('MARBLE_DRIVE_SPRITE_SOCKET', '/.sprite/api.sock'),
    // The console: every drive, from one page (server/console). admin-p1 only.
    console: bool('MARBLE_DRIVE_CONSOLE', false),
    consoleOrg: str('MARBLE_DRIVE_CONSOLE_ORG', 'marble-drive'),
    consoleSrc: str('MARBLE_DRIVE_CONSOLE_SRC', '/home/sprite/src'),
    consoleSprite: str('MARBLE_DRIVE_CONSOLE_SPRITE', 'sprite'),
    consoleSelf: str('MARBLE_DRIVE_CONSOLE_SELF', ''),
    // What keeps a sprite awake with no tab open (server/hold.js). A question
    // nobody answers holds it this long; work that has stopped getting anywhere
    // this long; anything at all this long after anyone last used the drive.
    // Letting go freezes the work, it does not end it.
    // A tab rests, closing its streams, once hidden this long or shown with no
    // input this long (runtime/tab-rest.js, which reads them off its tag).
    tabHiddenSeconds: num('MARBLE_DRIVE_TAB_HIDDEN_SECONDS', 60),
    tabIdleMinutes: num('MARBLE_DRIVE_TAB_IDLE_MINUTES', 10),
    // A live stream whose tab has gone this long unused is closed (server/streams.js).
    streamUnusedMinutes: num('MARBLE_DRIVE_STREAM_UNUSED_MINUTES', 15),
    askHoldMinutes: num('MARBLE_DRIVE_ASK_HOLD_MINUTES', 10),
    noProgressMinutes: num('MARBLE_DRIVE_NO_PROGRESS_MINUTES', 30),
    awakeMaxHours: num('MARBLE_DRIVE_AWAKE_MAX_HOURS', 24),

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
    // Whether a new chat gets named by a model once its first turn is over.
    // On, because the alternative is a board of prompt fragments; a switch,
    // because it spawns a CLI of its own and a test host wants none of that.
    agentNaming: bool('MARBLE_DRIVE_AGENT_NAMING', true),
    // Which model writes those names. Small and fast on purpose.
    agentNamingModel: str('MARBLE_DRIVE_AGENT_NAMING_MODEL', 'haiku'),
    agentStallMinutes: num('MARBLE_DRIVE_AGENT_STALL_MINUTES', 30),
    // 0 is no cap: every conversation the person has started runs at once.
    agentMaxRunning: num('MARBLE_DRIVE_AGENT_MAX_RUNNING', 0),
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
