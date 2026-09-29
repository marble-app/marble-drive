// server/hub/sync.js
// The hub: an encrypted copy of a drive in R2, kept by whichever machine is
// home (docs/superpowers/specs/2026-09-29-mac-home-drive-design.md, piece 1).
//
//   <bucket>/<drive>/state.json   the last upload: who, epoch, seq, counts. Plain; no content.
//   <bucket>/<drive>/data/…       rclone crypt: drive/ and trash/<utc>/, names and contents encrypted
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

/** What is in a drive, counted the way both machines count it. */
export async function scan(root) {
  let files = 0;
  let documents = 0;
  let newest = 0;
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
      if (stat && stat.mtimeMs > newest) newest = stat.mtimeMs;
    }
  };
  await walk(root, '');
  return { files, documents, newest };
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

export async function readState({ settings, env, run = rclone }) {
  try {
    return JSON.parse((await run(['cat', `${rawBase(settings)}/state.json`], env)).stdout);
  } catch (err) {
    if (/not found|no such file|doesn't exist/i.test(err.stderr ?? err.message)) return null;
    throw err;
  }
}

export async function up({ root, settings, epoch, force = false, run = rclone, now = () => new Date() }) {
  const env = await rcloneEnv(settings, run);
  const counts = await scan(root);
  const last = await readState({ settings, env, run });
  const wrong = looksWrong(counts, last);
  if (wrong && !force) return { ok: false, why: wrong, counts };
  const when = now();
  await run(['sync', root, 'hub:drive', '--backup-dir', `hub:trash/${stampOf(when)}`, ...filters(), '--fast-list', '--transfers', '8'], env);
  const state = {
    home: settings.HUB_MACHINE,
    epoch,
    seq: (last?.seq ?? 0) + 1,
    at: when.toISOString(),
    files: counts.files,
    documents: counts.documents,
  };
  await run(['rcat', `${rawBase(settings)}/state.json`], env, { input: JSON.stringify(state) });
  return { ok: true, state, counts };
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
  const when = now();
  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(trashRoot, { recursive: true });
  await run(['sync', 'hub:drive', root, '--backup-dir', path.join(trashRoot, stampOf(when)), ...filters(), '--fast-list', '--transfers', '8'], env);
  await pruneTrash(trashRoot, keepDays, when);
  const counts = await scan(root);
  return { ok: true, state, counts, matches: counts.files === state.files && counts.documents === state.documents };
}

/** The raw R2 prefix the encrypted trash/ lands under, for the bucket's
 *  7-day lifecycle rule. */
export async function trashPrefix({ settings, run = rclone }) {
  const env = await rcloneEnv(settings, run);
  const encoded = (await run(['backend', 'encode', 'hub:', 'trash'], env)).stdout.trim().split('\n')[0].trim();
  return `${settings.HUB_DRIVE}/data/${encoded}/`;
}
