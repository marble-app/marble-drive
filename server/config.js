// Every knob, read once, with the default written next to it.
//
// A deployment is configured by environment because a container is, and the
// alternative — a config file inside the drive root — would be a document the
// Drive can see and edit, which is a lovely idea and a terrible way to hold the
// secret that guards it.

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
    host: str('HOST', '0.0.0.0'),

    // The document the Drive lands on. An ordinary document with no standing —
    // delete it and `/` falls back to whatever exists.
    home: str('MARBLE_DRIVE_HOME', 'drive'),

    // G0's gate. Unset means an open host, which is right for a laptop and
    // wrong for anything with a domain in front of it — so it says so, loudly,
    // once, at boot.
    secret: str('MARBLE_DRIVE_SECRET', null),
    cookieName: str('MARBLE_DRIVE_COOKIE', 'marble_drive'),
    sessionDays: num('MARBLE_DRIVE_SESSION_DAYS', 30),
    secureCookie: bool('MARBLE_DRIVE_SECURE_COOKIE', str('NODE_ENV', '') === 'production'),

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
  };
}

export const config = loadConfig();
