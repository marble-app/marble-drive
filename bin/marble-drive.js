#!/usr/bin/env node
// The command.
//
//   marble-drive serve            serve the drive (the default)
//   marble-drive new <path>       a document from a starter, without a browser
//   marble-drive weigh [path]     what the documents weigh, and how much is base64
//   marble-drive backup           one backup, now
//   marble-drive starters         what you can make
//
// Every one of these goes through the same store the host does, which is the
// point: a command and a request are two callers of one seam, not two
// implementations of one idea.

import { spawn } from 'node:child_process';
import path from 'node:path';

import { createDrive } from '../server/app.js';
import { backupNow } from '../server/backup.js';
import { config } from '../server/config.js';
import { build as buildStarter, list as listStarters } from '../server/gallery.js';
import { splitPath, parsePath } from '../server/paths.js';
import { seedDrive } from '../server/seed.js';
import { createStore } from '../server/store/index.js';

const [command = 'serve', ...rest] = process.argv.slice(2);

const flags = Object.fromEntries(
  rest
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const at = arg.indexOf('=');
      return at < 0 ? [arg.slice(2), true] : [arg.slice(2, at), arg.slice(at + 1)];
    }),
);
const args = rest.filter((arg) => !arg.startsWith('--'));

const fail = (message) => {
  console.error(`[drive] ${message}`);
  process.exit(1);
};

const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(2)} MB`);

switch (command) {
  case 'serve':
    await serve();
    break;
  case 'new':
    await make();
    break;
  case 'weigh':
    await weigh();
    break;
  case 'backup':
    await backup();
    break;
  case 'starters':
    for (const starter of listStarters()) console.log(`${starter.id.padEnd(9)} ${starter.blurb}`);
    break;
  default:
    fail(`no command "${command}" — there is: serve, new, weigh, backup, starters`);
}

// ---------------------------------------------------------------------- serve

async function serve() {
  const drive = await createDrive(config);
  await seedDrive(drive.store, { name: config.home });
  // Not awaited: the host should answer requests while it reads the drive, and
  // a document served before its baseline lands sets its own on the way out.
  drive.seed().catch(() => {});

  let port = Number(flags.port ?? config.port);
  const explicit = Boolean(flags.port) || config.portIsExplicit;
  let attempts = 0;

  drive.server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    if (explicit) fail(`port ${port} is in use — try: marble-drive serve --port ${port + 1}`);
    if (++attempts > 20) fail(`ports ${port - attempts}–${port} are all in use`);
    drive.server.listen(++port, config.host);
  });

  drive.server.listen(port, config.host, () => {
    const url = `http://localhost:${port}/`;
    console.log('[drive] serving at');
    console.log(`\n  ${url}\n`);
    console.log(`[drive] documents in ${config.root}`);
    console.log(`[drive] history and op log in ${path.join(config.root, '.marble')}`);

    if (drive.gate.open) {
      console.log('[drive] no gate — anybody who can reach this port can edit everything.');
      console.log('[drive] set MARBLE_DRIVE_SECRET before putting a domain in front of it.');
    } else {
      console.log('[drive] gated — the secret is exchanged for a cookie at /gate');
    }

    if (!config.backupDir && !config.backupCommand) {
      console.log('[drive] no backups — set MARBLE_DRIVE_BACKUP_DIR or MARBLE_DRIVE_BACKUP_CMD');
    } else {
      console.log(`[drive] backing up every ${config.backupEveryMinutes} min`);
    }

    const provider = drive.provider();
    console.log(
      provider
        ? `[drive] intents via ${provider}`
        : '[drive] no intent provider — direct manipulation works without one.',
    );

    if (config.open || flags.open) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log('\n[drive] stopping');
      drive.close().then(() => process.exit(0));
    });
  }
}

// ------------------------------------------------------------------------ new

async function make() {
  const wanted = args[0];
  if (!wanted) fail('usage: marble-drive new <path> [--from=doc|sheet|slides|board|canvas]');
  const docPath = parsePath(wanted, { allowRoot: false });

  const store = createStore({ root: config.root });
  await store.ready();
  if (await store.has(docPath)) fail(`"${docPath}" already exists`);

  const from = typeof flags.from === 'string' ? flags.from : 'doc';
  const source = await buildStarter(from, { name: splitPath(docPath).name });
  await store.write(docPath, source, { label: 'created' });
  console.log(`${docPath}.mrbl — ${from}`);
  console.log(`\n  marble-drive serve   →   /a/${encodeURIComponent(docPath)}\n`);
}

// ---------------------------------------------------------------------- weigh

async function weigh() {
  const store = createStore({ root: config.root });
  await store.ready();
  const drive = await createDrive(config, { log: { log() {}, error() {} } });

  const wanted = args[0] ? parsePath(args[0], { allowRoot: false }) : null;
  const docs = wanted
    ? [await store.stat(wanted)].filter(Boolean)
    : (await store.list({ recursive: true })).filter((entry) => entry.kind === 'doc');

  if (!docs.length) fail(wanted ? `no document "${wanted}"` : `no documents in ${config.root}`);

  let bytes = 0;
  let heavy = 0;
  console.log('  bytes     base64    nodes   document');
  for (const doc of docs.sort((a, b) => b.bytes - a.bytes)) {
    const source = await store.read(doc.path);
    const report = drive.weigh(doc.path, source);
    bytes += report.bytes;
    heavy += report.inlineBytes;
    console.log(
      `  ${kb(report.bytes).padStart(9)} ${(report.inlineBytes ? `${Math.round(report.share * 100)}%` : '—').padStart(8)}` +
        ` ${String(report.nodes).padStart(7)}   ${doc.path}` +
        (report.blobs ? `  (${report.blobs} blob${report.blobs === 1 ? '' : 's'})` : ''),
    );
  }
  console.log(`\n  ${kb(bytes)} across ${docs.length} document(s); ${Math.round((heavy / (bytes || 1)) * 100)}% of it is inline base64.`);
  console.log('  Over a phone connection that share is what decides whether blobs are a nicety or a blocker.');
  await drive.close();
}

// --------------------------------------------------------------------- backup

async function backup() {
  const result = await backupNow({
    root: config.root,
    dir: typeof flags.to === 'string' ? flags.to : config.backupDir,
    command: config.backupCommand,
    keep: config.backupKeep,
  });
  if (!result.ok) fail(result.why ?? 'the backup command failed');
  console.log(`[drive] backup → ${result.target ?? result.command}${result.dropped ? `, ${result.dropped} swept` : ''}`);
}
