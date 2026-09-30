// server/hub/sync.js
// The hub: an encrypted copy of a drive in R2, kept by whichever machine is
// home (docs/superpowers/specs/2026-09-29-mac-home-drive-design.md, piece 1).
//
//   <bucket>/<drive>/state.json   the last upload: who, epoch, seq, counts. Plain; no content.
//   <bucket>/<drive>/data/…       rclone crypt: drive/, trash/<utc>/ and manifest.json, names and contents encrypted
//
// manifest.json lists every file the hub's drive/ holds, [size, mtimeMs] by
// path, as the last upload saw them. R2 takes up to seconds a request and a
// plain `rclone sync` asks once per file (a no-change sync of 57 files took
// 95 s), so each side compares against the list and moves only what differs:
// requests scale with what changed, not with the drive.
//
// rclone is configured through the environment only, so no config file holds
// a key. The passphrase and salt are obscured by rclone itself at call time,
// handed to it on stdin.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const EXCLUDES = ['/.marble/agents/host.lock', '/.marble/usage/**', '/.marble/console/backups/**'];
const excluded = (rel) =>
  rel === '.marble/agents/host.lock' || rel.startsWith('.marble/usage/') || rel.startsWith('.marble/console/backups/');
const filters = () => EXCLUDES.flatMap((pattern) => ['--exclude', pattern]);
const stampOf = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** What is in a drive, counted the way both machines count it, and each
 *  file's [size, mtimeMs] by its path (`byPath`). */
export async function scan(root) {
  let files = 0;
  let documents = 0;
  let newest = 0;
  const byPath = {};
  const walk = async (dir, rel) => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!excluded(`${r}/`)) await walk(path.join(dir, entry.name), r);
        continue;
      }
      if (!entry.isFile() || excluded(r)) continue;
      files += 1;
      if (r.endsWith('.mrbl') && !r.startsWith('.marble/')) documents += 1;
      const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null);
      if (!stat) continue;
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      byPath[r] = [stat.size, Math.round(stat.mtimeMs)];
    }
  };
  await walk(root, '');
  return { files, documents, newest, byPath };
}

// rclone keeps mtimes to the nanosecond on the local backend, but the s3
// backend stores them as a float of seconds, which can land a rounded
// millisecond one either side. One millisecond, never more.
const same = (a, b) => Boolean(a && b) && a[0] === b[0] && Math.abs(a[1] - b[1]) <= 1;

/** The paths in `want` that `have` lacks or holds differently, and the paths
 *  `have` holds that `want` does not. Left-out paths are never either. */
export function compare(want, have) {
  const differ = Object.keys(want).filter((rel) => !excluded(rel) && !same(want[rel], have[rel]));
  const extra = Object.keys(have).filter((rel) => !excluded(rel) && !(rel in want));
  return { differ: differ.sort(), extra: extra.sort() };
}

/** Why an upload of this drive would do harm, or null. */
export function looksWrong(counts, last) {
  if (counts.documents === 0) return 'the drive has no documents';
  if (last?.files > 0 && counts.files < last.files * 0.5) {
    return `the drive has ${counts.files} files, under half of the ${last.files} last uploaded`;
  }
  return null;
}

export function rclone(args, env, { input = '' } = {}) {
  const bin = process.env.MARBLE_RCLONE || 'rclone';
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, RCLONE_CONFIG: '/dev/null', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`rclone ${args[0]} failed (${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`), { stderr }));
    });
    child.stdin.end(input);
  });
}

const rawBase = (s) =>
  s.HUB_BACKEND === 'local' ? `hubraw:${path.join(s.HUB_LOCAL_DIR, s.HUB_DRIVE)}` : `hubraw:${s.R2_BUCKET}/${s.HUB_DRIVE}`;

export async function rcloneEnv(s, run = rclone) {
  // On stdin, not argv: argv shows in `ps`, and a value starting with '-' would
  // be read as a flag (and echoed back in rclone's error).
  const obscure = async (value) => (await run(['obscure', '-'], {}, { input: value })).stdout.trim();
  const env = {
    RCLONE_CONFIG_HUB_TYPE: 'crypt',
    RCLONE_CONFIG_HUB_REMOTE: `${rawBase(s)}/data`,
    RCLONE_CONFIG_HUB_PASSWORD: await obscure(s.HUB_PASSPHRASE),
    RCLONE_CONFIG_HUB_PASSWORD2: await obscure(s.HUB_SALT),
  };
  if (s.HUB_BACKEND === 'local') return { ...env, RCLONE_CONFIG_HUBRAW_TYPE: 'local' };
  return {
    ...env,
    RCLONE_CONFIG_HUBRAW_TYPE: 's3',
    RCLONE_CONFIG_HUBRAW_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_HUBRAW_ACCESS_KEY_ID: s.R2_ACCESS_KEY_ID,
    RCLONE_CONFIG_HUBRAW_SECRET_ACCESS_KEY: s.R2_SECRET_ACCESS_KEY,
    RCLONE_CONFIG_HUBRAW_ENDPOINT: `https://${s.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    RCLONE_CONFIG_HUBRAW_NO_CHECK_BUCKET: 'true',
  };
}

async function readJson(target, env, run) {
  try {
    // R2 answers a missing object with exit 0 and nothing; the local backend errors.
    const { stdout } = await run(['cat', target], env);
    return stdout.trim() ? JSON.parse(stdout) : null;
  } catch (err) {
    if (/not found|no such file|doesn't exist/i.test(err.stderr ?? err.message)) return null;
    throw err;
  }
}

export const readState = ({ settings, env, run = rclone }) => readJson(`${rawBase(settings)}/state.json`, env, run);
const readManifest = ({ env, run }) => readJson('hub:manifest.json', env, run);

/** Runs `fn` with a file listing `paths`, one per line, removed after.
 *  rclone reads it with --files-from-raw: plain --files-from skips a line
 *  that starts with # or ; and trims spaces, so it would pass over a file
 *  named "#ideas.mrbl" and still report success. */
async function withList(paths, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-hub-'));
  const file = path.join(dir, 'files');
  try {
    await fsp.writeFile(file, paths.map((p) => `${p}\n`).join(''));
    return await fn(file);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Why the hub's file list cannot be used for this pass, or null. Only a
 *  list written by the same upload as state.json (the same seq) is used. One
 *  behind was left by an upload that wrote no list (a release from before
 *  the list, a rollback, the other machine on an older release): diffing
 *  against it would miss that upload's changes. One ahead was left by an
 *  upload cut off between its two writes, and an older release could then
 *  write that seq's state.json without a list, making a stale list look
 *  current. Either costs one full pass. */
function untrusted(manifest, seq) {
  if (!manifest) return 'the hub has no file list';
  if (manifest.seq !== seq) return `the file list (seq ${manifest.seq}) does not match the last upload (seq ${seq})`;
  return null;
}
// A list file is one path a line: a name holding a line break cannot be said.
const unlistable = (paths) => (paths.some((rel) => /[\r\n]/.test(rel)) ? 'a file name holds a line break' : null);

// Data, then the list, then state.json: an upload cut off part way leaves the
// old list, and the next one diffs against it and moves the rest.
export async function up({ root, settings, epoch, force = false, run = rclone, now = () => new Date() }) {
  const env = await rcloneEnv(settings, run);
  const { byPath, ...counts } = await scan(root);
  const last = await readState({ settings, env, run });
  const wrong = looksWrong(counts, last);
  if (wrong && !force) return { ok: false, why: wrong, counts };
  const manifest = await readManifest({ env, run });
  const when = now();
  const trash = `hub:trash/${stampOf(when)}`;
  let full = untrusted(manifest, last?.seq ?? 0);
  const { differ, extra } = full ? { differ: [], extra: [] } : compare(byPath, manifest.files ?? {});
  full ??= unlistable([...differ, ...extra]);
  let changed = differ.length;
  let deleted = extra.length;
  if (full) {
    await run(['sync', root, 'hub:drive', '--backup-dir', trash, ...filters(), '--fast-list', '--transfers', '8'], env);
    changed = counts.files;
    deleted = 0;
  } else {
    // Deletions first, as a download sets extras aside first: on a store that
    // folds case, moving "notes.mrbl" away after copying "Notes.mrbl" would
    // take the fresh copy with it.
    if (extra.length) {
      await withList(extra, (list) => run(['move', 'hub:drive', trash, '--files-from-raw', list, '--no-traverse', '--transfers', '8'], env));
    }
    if (differ.length) {
      await withList(differ, (list) =>
        run(['copy', root, 'hub:drive', '--files-from-raw', list, '--no-traverse', '--ignore-times', '--backup-dir', trash, '--transfers', '8'], env));
    }
  }
  const seq = (last?.seq ?? 0) + 1;
  await run(['rcat', 'hub:manifest.json'], env, { input: JSON.stringify({ seq, at: when.toISOString(), files: byPath }) });
  const state = {
    home: settings.HUB_MACHINE,
    epoch,
    seq,
    at: when.toISOString(),
    files: counts.files,
    documents: counts.documents,
  };
  await run(['rcat', `${rawBase(settings)}/state.json`], env, { input: JSON.stringify(state) });
  return { ok: true, state, counts, changed, deleted, ...(full && { full }) };
}

async function pruneTrash(dir, keepDays, now) {
  const cutoff = now.getTime() - keepDays * 86_400_000;
  for (const name of await fsp.readdir(dir).catch(() => [])) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(name);
    if (!match) continue;
    const when = Date.UTC(+match[1], match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
    if (when < cutoff) await fsp.rm(path.join(dir, name), { recursive: true, force: true });
  }
}

export async function down({
  root,
  settings,
  run = rclone,
  now = () => new Date(),
  trashRoot = path.join(os.homedir(), '.cache', 'marble-drive', 'hub-trash', settings.HUB_DRIVE),
  keepDays = 7,
}) {
  const env = await rcloneEnv(settings, run);
  const state = await readState({ settings, env, run });
  if (!state) return { ok: false, why: 'the hub has no upload yet' };
  const manifest = await readManifest({ env, run });
  const when = now();
  const trash = path.join(trashRoot, stampOf(when));
  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(trashRoot, { recursive: true });
  let full = untrusted(manifest, state.seq);
  const want = full ? null : manifest.files ?? {};
  const { differ: fetch, extra: remove } = full ? { differ: [], extra: [] } : compare(want, (await scan(root)).byPath);
  full ??= unlistable([...fetch, ...remove]);
  if (full) {
    await run(['sync', 'hub:drive', root, '--backup-dir', trash, ...filters(), '--fast-list', '--transfers', '8'], env);
  } else {
    // Extras first: on a case-insensitive disk "notes.mrbl" set aside after
    // "Notes.mrbl" was fetched would take the fetched file with it.
    for (const rel of remove) await setAside(path.join(root, rel), path.join(trash, rel));
    if (fetch.length) {
      // rclone sets each file's mtime from the hub's, so afterwards it matches the list.
      await withList(fetch, (list) =>
        run(['copy', 'hub:drive', root, '--files-from-raw', list, '--no-traverse', '--ignore-times', '--backup-dir', trash, '--transfers', '8'], env));
    }
  }
  await pruneTrash(trashRoot, keepDays, when);
  const { byPath, ...counts } = await scan(root);
  let matches;
  if (want) {
    const after = compare(want, byPath);
    matches = after.differ.length === 0 && after.extra.length === 0;
  } else {
    matches = counts.files === state.files && counts.documents === state.documents;
  }
  return {
    ok: true,
    state,
    counts,
    matches,
    ...(full ? { full } : { fetched: fetch.length, removed: remove.length }),
  };
}

/** Moves a file the hub does not hold into the local trash; never deletes it. */
async function setAside(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    // The trash is on another disk: copy it there first, then let this one go.
    await fsp.copyFile(from, to);
    await fsp.rm(from);
  }
}

/** The raw R2 prefix the encrypted trash/ lands under, for the bucket's
 *  7-day lifecycle rule. */
export async function trashPrefix({ settings, run = rclone }) {
  const env = await rcloneEnv(settings, run);
  const encoded = (await run(['backend', 'encode', 'hub:', 'trash'], env)).stdout.trim().split('\n')[0].trim();
  return `${settings.HUB_DRIVE}/data/${encoded}/`;
}
