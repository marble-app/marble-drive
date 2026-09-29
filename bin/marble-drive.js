#!/usr/bin/env node
// The command.
//
//   marble-drive serve            serve the drive (the default)
//   marble-drive standby          the host on a machine that is not this drive's home: writes nothing
//   marble-drive new <path>       a document from a starter, without a browser
//   marble-drive icon [path]      give a document already in the drive its mark
//   marble-drive weigh [path]     what the documents weigh, and how much is base64
//   marble-drive backup           one backup, now
//   marble-drive remote [on|off|status|check]   reach it from your own devices, over Tailscale
//   marble-drive agents providers    which agent CLIs are installed and signed in
//   marble-drive agents try <id>     one real turn against a scratch drive
//   marble-drive starters         what you can make
//   marble-drive genui space <doc>       is this document an app space? every issue, or ok
//   marble-drive genui decide <doc>      let Jev position it — --dry to look without writing, --verbose for the distributions
//
// Every one of these goes through the same store the host does, which is the
// point: a command and a request are two callers of one seam, not two
// implementations of one idea.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createDrive } from '../server/app.js';
import { backupNow } from '../server/backup.js';
import { config } from '../server/config.js';
import { builtInProviders } from '../server/agent/providers/index.js';
import { tryProvider } from '../server/agent/try.js';
import { stamp, stamped } from '../server/favicon.js';
import { build as buildStarter, list as listStarters } from '../server/gallery.js';
import { check as checkRemote, serveOff, serveOn, serveStatus, tailnetUrl } from '../server/remote.js';
import { splitPath, parsePath } from '../server/paths.js';
import { updateApps } from '../server/app-updates.js';
import { seedAgents, seedBoard, seedChat, seedConsole, seedDesignDonts, seedDesignSystem, seedDrive } from '../server/seed.js';
import { createStore } from '../server/store/index.js';
import { createStandby } from '../server/standby.js';
import { createLeaseClient } from '../server/hub/lease-client.js';
import { holdPath, loadHubSettings } from '../server/hub/settings.js';
import { scheduleUploads } from '../server/hub/schedule.js';

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
  case 'standby':
    await standby();
    break;
  case 'new':
    await make();
    break;
  case 'icon':
    await icon();
    break;
  case 'weigh':
    await weigh();
    break;
  case 'backup':
    await backup();
    break;
  case 'remote':
    await remote();
    break;
  case 'starters':
    for (const starter of listStarters()) console.log(`${starter.id.padEnd(9)} ${starter.blurb}`);
    break;
  case 'agents':
    await agentsCommand();
    break;
  case 'genui':
    await genuiCommand();
    break;
  case 'apps':
    await appsCommand();
    break;
  default:
    fail(`no command "${command}" — there is: serve, new, icon, weigh, backup, remote, agents, starters, genui, apps`);
}

// ---------------------------------------------------------------------- serve

async function standby() {
  // A standby must answer /health whatever state the hub settings are in: a
  // host that died here would crash-loop, and fail every deploy's health check.
  let lease = null;
  try {
    const settings = loadHubSettings(config.hubEnv);
    lease = settings ? await createLeaseClient({ settings }).cached() : null;
  } catch (err) {
    console.error(`[drive] standby: ${err.message}; standing by without a remembered lease`);
  }
  const server = createStandby({ home: lease?.home ?? null, since: lease?.since ?? null });
  server.listen(Number(flags.port ?? config.port), config.host, () => {
    console.log(`[drive] standby on ${config.host}:${flags.port ?? config.port}: this drive's home is ${lease?.home ?? 'elsewhere'}`);
  });
}

async function serve() {
  // Two homes (the owner's Mac and Fly): with MARBLE_HUB_ENV set, this host may
  // write only with the hub's settings in hand and no hold on it. Checked
  // before the drive is opened; exit 75 so the keeper (tools/sprite/serve.sh)
  // asks home-mode.mjs again, which says standby for the same reason.
  let hubSettings = null;
  if (config.hubEnv) {
    try {
      hubSettings = loadHubSettings(config.hubEnv);
    } catch (err) {
      console.error(`[drive] hub: ${err.message}; not serving`);
      process.exit(75);
    }
    if (!hubSettings) {
      console.error(`[drive] hub: no settings in ${config.hubEnv}; not serving`);
      process.exit(75);
    }
    if (fs.existsSync(holdPath(hubSettings))) {
      console.error(`[drive] hub: held by drive-home (${holdPath(hubSettings)}); not serving`);
      process.exit(75);
    }
  }
  const drive = await createDrive(config);
  await seedDrive(drive.store, { name: config.home });
  await seedAgents(drive.store);
  await seedChat(drive.store);
  await seedBoard(drive.store);
  await seedDesignSystem(drive.store);
  await seedDesignDonts(drive.store);
  if (drive.console) await seedConsole(drive.store);
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
    // After the host answers, not before: merging is seconds of work on a big
    // drive, and nobody should wait at a blank page for it.
    if (config.appUpdates) {
      updateApps({
        store: drive.store,
        config,
        write: (where, text, { label }) => drive.putDocument(where, text, { label, event: 'changed' }),
      }).catch((err) => console.error('[apps] could not bring app pages forward:', err.message));
    }
    // Two homes (the owner's Mac and Fly): keep the hub current, and step down
    // the moment the lease names the other machine. Exit 75 so the keeper
    // (tools/sprite/serve.sh) starts again, asks home-mode.mjs, and comes back
    // as standby.
    if (hubSettings) {
      scheduleUploads({
        root: config.root,
        settings: hubSettings,
        client: createLeaseClient({ settings: hubSettings }),
        onLost: () => setTimeout(() => process.exit(75), 100),
      });
      console.log(`[drive] hub: uploading ${hubSettings.HUB_DRIVE} from ${hubSettings.HUB_MACHINE} while it is home`);
    }
    const url = `http://localhost:${port}/`;
    console.log('[drive] serving at');
    console.log(`\n  ${url}\n`);
    console.log(`[drive] documents in ${config.root}`);
    console.log(`[drive] history and op log in ${path.join(config.root, '.marble')}`);
    const snapshotDir = process.execArgv.find((arg) => arg.startsWith('--diagnostic-dir='))?.slice('--diagnostic-dir='.length);
    if (snapshotDir) {
      console.log(`[drive] if the process runs out of memory, a heap snapshot is written to ${snapshotDir}`);
    }

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

    console.log(
      drive.agents
        ? `[drive] agents on — conversations in ${path.join(config.root, '.marble', 'agents')}`
        : `[drive] agents off — ${drive.agentsWhy}`,
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

// ----------------------------------------------------------------------- icon

/** The mark, for the documents that were here before there was one.
 *
 *  A document made from a starter carries it already, so this is a one-time
 *  pass over an older drive rather than something to run twice — and it is a
 *  command rather than something the host does on the way past, because a host
 *  that rewrites your documents to add its own branding is a host you cannot
 *  trust with the ones it did not write. */
async function icon() {
  const store = createStore({ root: config.root });
  await store.ready();

  const wanted = args[0] ? parsePath(args[0], { allowRoot: false }) : null;
  const docs = wanted
    ? [await store.stat(wanted)].filter(Boolean)
    : (await store.list({ recursive: true })).filter((entry) => entry.kind === 'doc');
  if (!docs.length) fail(wanted ? `no document "${wanted}"` : `no documents in ${config.root}`);

  let marked = 0;
  for (const doc of docs) {
    const source = await store.read(doc.path);
    if (source === null) continue;
    if (stamped(source)) {
      console.log(`  ${'kept'.padEnd(7)} ${doc.path}  (has an icon already)`);
      continue;
    }
    // The Drive is the interface and everything else is a document, which is
    // the only distinction the mark makes.
    const kind = doc.path === config.home ? 'drive' : 'doc';
    if (flags.dry) {
      console.log(`  ${'would'.padEnd(7)} ${doc.path}  (${kind})`);
      continue;
    }
    // Through the store, so the version without the mark is a restore point
    // rather than something you needed a backup for.
    await store.write(doc.path, stamp(source, kind), { label: 'icon' });
    console.log(`  ${'marked'.padEnd(7)} ${doc.path}  (${kind})`);
    marked += 1;
  }

  console.log(
    flags.dry
      ? `\n  --dry, so nothing was written. Run it again without the flag.`
      : `\n  ${marked} document(s) marked. Every one of them can still be edited back.`,
  );
}

// ----------------------------------------------------------------------- apps

/** `marble-drive apps [--write]`: what bringing this drive's app pages forward
 *  would do (the host does it on start), or do it now with --write. */
async function appsCommand() {
  const store = createStore({ root: config.root });
  await store.ready();
  const report = await updateApps({ store, config, dryRun: !flags.write, log: { log() {} } });
  if (!report.length) console.log('  every app page is current');
  for (const line of report) {
    const why = line.status === 'held' ? ` (${line.reason}${line.conflicts ? `, ${line.conflicts} overlapping` : ''})` : '';
    const what = line.status === 'update' ? ` ${line.from} → ${line.to}, ${line.hunks} changes` : '';
    console.log(`  ${line.status.padEnd(8)} ${line.app.padEnd(10)} ${line.path}${what}${why}`);
  }
  if (!flags.write && report.some((l) => l.status === 'update')) console.log('\n  nothing written — run with --write to apply');
}

// ---------------------------------------------------------------------- weigh

async function weigh() {
  const store = createStore({ root: config.root });
  await store.ready();
  const drive = await createDrive(config, { log: { log() {}, error() {} }, agents: false });

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

// --------------------------------------------------------------------- remote

/** Your own devices, through Tailscale Serve. The host itself is started the
 *  usual way; this only points the tailnet's HTTPS address at it. */
async function remote() {
  const sub = args[0] ?? 'status';

  if (sub === 'on') {
    const result = await serveOn({ config });
    if (result.problems) fail(`not serving yet:\n\n  - ${result.problems.join('\n  - ')}\n`);
    if (result.enable) fail(`Serve is not enabled on this tailnet. An admin enables it once, here:\n\n  ${result.enable}\n`);
    if (!result.ok) fail(result.error);
    console.log(`[drive] on the tailnet at\n\n  ${result.url}\n`);
    console.log(`[drive] forwarding to 127.0.0.1:${config.port} — start the host there if it is not running,`);
    console.log('[drive] then: marble-drive remote check');
    return;
  }

  if (sub === 'off') {
    const result = await serveOff();
    if (result.code !== 0) fail(result.output.trim());
    console.log('[drive] off the tailnet');
    return;
  }

  if (sub === 'status') {
    console.log((await serveStatus()).output.trim());
    return;
  }

  if (sub === 'check') {
    if (!config.secret) fail('MARBLE_DRIVE_SECRET is unset, so there is no gate to check');
    const url = typeof flags.url === 'string' ? flags.url : await tailnetUrl();
    console.log(`[drive] checking ${url}\n`);
    const results = await checkRemote({ url, secret: config.secret });
    for (const c of results) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
    if (results.some((c) => !c.ok)) process.exit(1);
    return;
  }

  fail(`no "remote ${sub}" — there is: on, off, status, check`);
}

// --------------------------------------------------------------------- agents

/** The agent CLIs on this machine, and a way to watch one work before trusting
 *  it with a real drive. `try` spends that provider's quota on one small turn. */
async function agentsCommand() {
  const sub = args[0];

  if (sub === 'providers') {
    for (const provider of builtInProviders().values()) {
      const found = await provider.detect();
      const state = !found.installed ? 'not installed' : found.signedIn ? 'ready' : 'signed out';
      console.log(`  ${provider.id.padEnd(20)} ${state.padEnd(14)} ${found.detail}`);
    }
    return;
  }

  if (sub === 'try') {
    const id = args[1];
    if (!id) fail('usage: marble-drive agents try <provider> [--prompt="…"] [--model=…]');
    // Before the line about quota: a typo spends nothing, so it should not say it will.
    const known = [...builtInProviders().keys()];
    if (!known.includes(id)) fail(`no provider "${id}" — there is: ${known.join(', ')}`);
    console.log(`[drive] one real turn on ${id}, against a scratch drive — this uses that provider's quota\n`);
    let result;
    try {
      result = await tryProvider({
        providerId: id,
        prompt: typeof flags.prompt === 'string' ? flags.prompt : undefined,
        model: typeof flags.model === 'string' ? flags.model : null,
      });
    } catch (err) {
      // An unknown provider, agents unable to start, or a turn that never
      // finished: these are `fail`'s job to report, not a stack trace's.
      fail(err.message);
    }
    console.log(`  status    ${result.status}${result.error ? `  — ${result.error}` : ''}`);
    console.log(`  applied   ${result.applied} op(s)`);
    console.log(`  heading   ${result.heading}`);
    if (result.costUsd !== null) console.log(`  cost      $${result.costUsd.toFixed(4)}`);
    console.log(`  events    ${result.events.join(' → ')}`);
    if (result.status !== 'completed') process.exit(1);
    return;
  }

  fail(`no "agents ${sub ?? ''}" — there is: providers, try`);
}

// ---------------------------------------------------------------------- genui

async function genuiCommand() {
  const [sub, docArg] = args;
  if (!sub || !['space', 'decide'].includes(sub)) fail('genui needs: space <doc> | decide <doc> [--dry] [--verbose] [--stop=N] [--context=JSON] [--request=…]');
  if (!docArg) fail(`genui ${sub} needs a document path inside the drive, like "Research/TypeSafe AI/Spaces/49ers"`);
  const { loadAtlas } = await import('../server/genui/atlas.js');
  const { extractSpace, validateSpace } = await import('../server/genui/space.js');
  const { decideDocument } = await import('../server/genui/decide.js');

  const docPath = parsePath(docArg);
  const atlas = await loadAtlas(config.genuiAtlas).catch((err) => fail(`could not read the Atlas at ${config.genuiAtlas}: ${err.message}`));
  const store = createStore({ root: config.root });
  await store.ready();
  const source = await store.read(docPath);
  if (source === null) fail(`no document "${docPath}" in ${config.root}`);

  if (sub === 'space') {
    const validation = validateSpace(source, atlas);
    const space = extractSpace(source);
    for (const instance of space.instances) {
      console.log(`${instance.pattern}#${instance.name}  (${instance.decisions.length} decisions)`);
      for (const d of instance.decisions) console.log(`  ${d.attr}=${d.current}   [${d.options.map((o) => o.slug).join(' | ')}]`);
    }
    if (validation.ok) console.log('ok');
    else {
      for (const issue of validation.issues) console.error(`${issue.kind}  ${issue.instance ?? '-'}.${issue.key ?? '-'}  ${issue.message}`);
      process.exit(1);
    }
    return;
  }

  let context = {};
  if (flags.context) {
    try {
      context = JSON.parse(String(flags.context));
    } catch (err) {
      fail(`--context must be JSON: ${err.message}`);
    }
  }
  const { readStop } = await import('../server/typesafe/routes.js');
  const stop = readStop(flags.stop);
  const request = typeof flags.request === 'string' ? flags.request : null;
  const dry = Boolean(flags.dry);

  const print = (result) => {
    // A near-uniform distribution is an authoring smell, not a gate problem:
    // the options are indistinguishable from their glosses, or the dimension
    // should not be live. TypeSafe's confidence is how concentrated the
    // distribution is, so "flat" is a low confidence, whatever n is.
    const FLAT = 0.15;
    let flat = 0;
    for (const d of result.decisions) {
      const conf = d.confidence === null ? '  -  ' : d.confidence.toFixed(2);
      const move = d.choice && d.choice !== d.current ? `→ ${d.choice}` : '';
      const isFlat = d.confidence !== null && d.confidence < FLAT;
      if (isFlat) flat += 1;
      console.log(`${d.applied ? '→' : isFlat ? '≈' : ' '} ${conf}  ${d.id.padEnd(32)} ${d.current} ${move}  ${d.reason}${isFlat ? '  · flat' : ''}`);
      if (flags.verbose && d.probabilities) {
        for (const slug of d.options ?? Object.keys(d.probabilities)) {
          const p = Number(d.probabilities[slug] ?? 0);
          console.log(`           ${slug.padEnd(28)} ${'█'.repeat(Math.round(p * 24)).padEnd(24, '·')} ${p.toFixed(2)}`);
        }
      }
    }
    console.log(`${result.ops.length} change(s) in ${result.elapsedMs} ms${result.dry ? ' (dry — nothing written)' : ` · wrote ${result.applied}`}`);
    if (flat) console.log(`${flat} decision(s) near-uniform (confidence < ${FLAT}) — sharpen the glosses, drop an option, or fix the value and remove the declaration.`);
  };

  // A write goes through the host when one is serving this drive: the host
  // owns the write queue and the open tabs, and a disk write from beside it
  // is an outside edit — the page would reload rather than move, and two
  // writers would race the file. Only a dry look is answered locally.
  if (!dry) {
    const base = `http://${config.host}:${config.port}`;
    let response = null;
    try {
      response = await fetch(`${base}/genui/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: docPath, context, stop, request }),
      });
    } catch {
      response = null; // nothing listening: write locally below
    }
    if (response) {
      if (response.status === 404) fail(`the host at ${base} is running code without /genui — restart it on this branch, or use --dry`);
      if (response.status === 401) fail(`the host at ${base} is gated; decide from a document there, or stop the host and run this again`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.issues) for (const issue of body.issues) console.error(`${issue.kind}  ${issue.instance ?? '-'}.${issue.key ?? '-'}  ${issue.message}`);
        fail(body.message || body.error || `host answered HTTP ${response.status}`);
      }
      print(body);
      return;
    }
  }

  if (!config.typesafeApiKey) fail('TYPESAFE_API_KEY is not set. Put it in .env.local.');
  const result = await decideDocument({ source, atlas, apiKey: config.typesafeApiKey, context, stop, request }).catch((err) => {
    if (err.issues) for (const issue of err.issues) console.error(`${issue.kind}  ${issue.instance ?? '-'}.${issue.key ?? '-'}  ${issue.message}`);
    fail(err.message);
  });
  if (dry || !result.ops.length) {
    print({ ...result, dry: true, applied: 0 });
    return;
  }
  // No host is serving: this process is the one writer, so it writes the way
  // the host would — through createDrive's writeOps — and closes.
  const drive = await createDrive(config, { log: { log() {}, error: console.error }, agents: false });
  try {
    const written = await drive.writeOps(docPath, result.ops, { client: 'genui-cli' });
    print({ ...result, dry: false, applied: written.applied ?? 0 });
  } finally {
    await drive.close();
  }
}
