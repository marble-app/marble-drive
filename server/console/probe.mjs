// Looking inside one drive: run on the sprite by the console (uploaded, then
// `node probe.mjs`), it reads and prints one JSON object and changes nothing.
// Plain Node and nothing else, because it runs outside any release.
//
// It reports which API keys are saved, never what they are. sprite.env is
// printed whole — the console needs the passphrase to act for the owner — and
// the console keeps the secret values in memory only (server/console/inspect.js).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const HOME = process.env.HOME || os.homedir();
const APP = path.join(HOME, 'app');
const CONFIG = path.join(HOME, '.config', 'marble-drive');
const DRIVE = process.env.MARBLE_PROBE_DRIVE || '/drive';
const LOGS = process.env.MARBLE_PROBE_LOGS || '/.sprite/logs/services';
const PORT = Number(process.env.MARBLE_PROBE_PORT || 4400);
const SOCKET = process.env.MARBLE_PROBE_SOCKET || '/.sprite/api.sock';

const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const json = (file) => {
  try {
    return JSON.parse(read(file));
  } catch {
    return null;
  }
};
const tail = (text, n) => (text ?? '').split('\n').filter((l) => l.length).slice(-n);

let release = null;
try {
  release = path.basename(fs.readlinkSync(path.join(APP, 'current')));
} catch {}
const live = path.join(APP, 'current', 'marble-drive', 'node_modules');

const env = [];
for (const line of (read(path.join(CONFIG, 'sprite.env')) ?? '').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
  if (m) env.push({ key: m[1], value: m[2] });
}
const provider = env.find((e) => e.key === 'MARBLE_DRIVE_AGENT_PROVIDER')?.value;
const settings = json(path.join(DRIVE, '.marble', 'agents', 'settings.json')) ?? {};
const saved = json(path.join(CONFIG, 'agent-keys')) ?? {};

// Documents and bytes, walking the drive but not its bookkeeping; capped so a
// huge drive costs a bounded look.
let documents = 0;
let driveBytes = 0;
let files = 0;
const walk = (dir) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (files > 200_000) return;
    if (e.name === '.marble' && dir === DRIVE) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile()) {
      files += 1;
      if (e.name.endsWith('.mrbl')) documents += 1;
      try {
        driveBytes += fs.statSync(full).size;
      } catch {}
    }
  }
};
walk(DRIVE);

let diskFree = null;
try {
  const s = fs.statfsSync(DRIVE);
  diskFree = s.bavail * s.bsize;
} catch {}

const get = (options) => new Promise((resolve) => {
  const req = http.request({ ...options, timeout: 3000 }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      try {
        resolve(res.statusCode === 200 ? JSON.parse(body) : null);
      } catch {
        resolve(null);
      }
    });
  });
  req.on('error', () => resolve(null));
  req.on('timeout', () => req.destroy());
  req.end();
});

const health = await get({ host: '127.0.0.1', port: PORT, path: '/health' });
const tasks = fs.existsSync(SOCKET) ? await get({ socketPath: SOCKET, path: '/v1/tasks' }) : null;

process.stdout.write(JSON.stringify({
  release,
  history: tail(read(path.join(APP, 'history')), 4),
  claudeVersion: json(path.join(live, '@anthropic-ai', 'claude-code', 'package.json'))?.version ?? null,
  marbleVersion: json(path.join(live, '@bdhmin', 'marble', 'package.json'))?.version ?? null,
  health,
  // keep-awake holds this task exactly while a turn or a split is working.
  working: tasks ? (tasks.tasks ?? []).some((t) => t.name === 'marble-drive') : null,
  env,
  claudeAuth: settings.claudeAuth ?? (provider === 'claude-subscription' ? 'login' : provider === 'claude-api' ? 'api' : null),
  keys: Object.entries(saved).filter(([, v]) => typeof v === 'string' && v.length).map(([k]) => k),
  claudeLogin: fs.existsSync(path.join(HOME, '.claude', '.credentials.json')),
  documents,
  driveBytes,
  diskFree,
  log: tail(read(path.join(LOGS, 'marble-drive.log')), 40),
  switchLog: tail(read(path.join(APP, 'switch.log')), 12),
}));
