// The Drive host.
//
// It serves a .mrbl document as the page, applies ops to it, and tells every
// other browser on that document that it moved. That loop is Marble's, and this
// is it with a network in the middle and folders underneath — which is the
// whole of G0 and most of G1.
//
// What it does *not* do is ship an interface. The Drive you see is
// `drive.mrbl`, an ordinary document in the drive, which asks the carrier what
// exists and writes what it thinks of the answer into its own markup. If this
// file had an HTML index in it the claim would already be broken.
//
// Nothing below reaches the filesystem. Every read and every write goes through
// the store, which is the seam the next four generations hang off.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentsAllowed, createAgents } from './agent/index.js';
import { backupNow, scheduleBackups } from './backup.js';
import { bytesOf, chooseProvider, enginePath, examine, guardOps, idsOfOps, mergeOps, mergeWrite, shaOf } from './engine.js';
import { dataUri as iconUri, svg as iconSvg } from './favicon.js';
import { blobsIn, extract, flatten } from './flatten.js';
import { createTouched } from './touched.js';
import { createGate } from './gate.js';
import { escapeHtml, html, json, readBody, readJson, send, text } from './http.js';
import { createIntents } from './intent-routes.js';
import { createOpLog } from './oplog.js';
import { createPendingWrites } from './pending-writes.js';
import { PathError, joinPath, parsePath, safePath, safeSegment, splitPath, withoutDocExt } from './paths.js';
import { build as buildStarter, list as listStarters, preview as starterPreview } from './gallery.js';
import { createChannels } from './sse.js';
import { createStore } from './store/index.js';
import { readDriveSettings } from './drive-settings.js';
import { createAwakeClock, createProgress } from './awake.js';
import { createHold } from './hold.js';
import { createKeepAwake } from './keep-awake.js';
import { createLedger } from './ledger.js';
import { createStreams } from './streams.js';
import { consoleAllowed, createConsole } from './console/index.js';
import { createStems } from './stems/index.js';
import { cleanFileName, createUploads } from './uploads.js';
import { DRAWN_MAX_BYTES, createThumbs } from './thumbs.js';
import { createTypesafeHandler } from './typesafe/routes.js';
import { createGenuiHandler } from './genui/routes.js';
import { watchDrive } from './watch.js';
import { createDaily } from './daily.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// What a file in the drive is allowed to be *rendered* as. An allowlist rather
// than a table of every extension, because a drive holds whatever somebody put
// in it and the default has to be the safe one: everything missing from here is
// served as bytes to download. Text is `text/plain` even when it is code, so a
// `.js` in a folder is something you read rather than something that runs.
const INLINE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  json: 'text/plain; charset=utf-8',
  jsonl: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  tsv: 'text/plain; charset=utf-8',
  bib: 'text/plain; charset=utf-8',
  tex: 'text/plain; charset=utf-8',
  yml: 'text/plain; charset=utf-8',
  yaml: 'text/plain; charset=utf-8',
  toml: 'text/plain; charset=utf-8',
  ini: 'text/plain; charset=utf-8',
  js: 'text/plain; charset=utf-8',
  mjs: 'text/plain; charset=utf-8',
  cjs: 'text/plain; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  py: 'text/plain; charset=utf-8',
  sh: 'text/plain; charset=utf-8',
  css: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  bak: 'text/plain; charset=utf-8',
};

const RUNTIME = {
  // Marble's carrier, served from the package. Not copied into this repo: two
  // copies of the contract is how two hosts stop rendering a file the same way.
  'marble.js': () => enginePath('runtime/marble.js'),
  // The vocabulary reader: what an element affords, and the op each gesture
  // would file. A reader, not an affordance — it wires nothing.
  'affords.js': () => enginePath('runtime/affords.js'),
  // The Drive's extension to it. Everything a Drive needs that a single
  // document does not — see docs/CARRIER-DRIVE.md.
  'drive.js': () => path.join(REPO, 'runtime', 'drive.js'),
  // Runs first on every page: lets a tab nobody is using close its streams,
  // so its sprite can sleep (server/streams.js).
  'tab-rest.js': () => path.join(REPO, 'runtime', 'tab-rest.js'),
  'console.js': () => path.join(REPO, 'runtime', 'console.js'),
  'console.css': () => path.join(REPO, 'runtime', 'console.css'),
  'console-charts.js': () => path.join(REPO, 'runtime', 'console-charts.js'),
  // Agents, when they are on: the client for /agent/* and the drawer that
  // uses it. Served to every document; injected only when agents run here.
  'agent.js': () => path.join(REPO, 'runtime', 'agent.js'),
  'agent-ui.js': () => path.join(REPO, 'runtime', 'agent-ui.js'),
  'agent-folders.js': () => path.join(REPO, 'runtime', 'agent-folders.js'),
  'agent-phone.js': () => path.join(REPO, 'runtime', 'agent-phone.js'),
  'choice-question.js': () => path.join(REPO, 'runtime', 'choice-question.js'),
  // The card a ```marble-visual block becomes in the transcript: a sandboxed
  // frame wearing the page's own palette. Imported by agent-ui.js on the first
  // visual, never injected — most conversations never hold one.
  'chat-visual.js': () => path.join(REPO, 'runtime', 'chat-visual.js'),
  'agent-usage-charts.js': () => path.join(REPO, 'runtime', 'agent-usage-charts.js'),
  'collab.js': () => path.join(REPO, 'runtime', 'collab.js'),
  // The callout: a conversation drawn at the region of a document it is about.
  'agent-callout.js': () => path.join(REPO, 'runtime', 'agent-callout.js'),
  // Marks: Select and Sketch, the tray's two tools for briefing an agent
  // about a region. Geometry first; the layer reads it off globalThis.
  'agent-marks-geometry.js': () => path.join(REPO, 'runtime', 'agent-marks-geometry.js'),
  'agent-marks.js': () => path.join(REPO, 'runtime', 'agent-marks.js'),
  // Variations: the version pill and the compare surface for a <marble-alt>.
  'agent-variations.js': () => path.join(REPO, 'runtime', 'agent-variations.js'),
};

// A runtime file's version is a hash of its bytes. A page asks for each one at
// `?v=<version>`, which the browser keeps until the file changes, so moving
// between documents downloads only the document. Remembered against the
// file's size and mtime, because the runtime is re-read on every request and a
// page names all of it.
const hashOf = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
const runtimeVersions = new Map();
const runtimeVersion = (file) => {
  try {
    const where = RUNTIME[file]();
    const stat = fs.statSync(where);
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const known = runtimeVersions.get(file);
    if (known?.stamp === stamp) return known.version;
    const version = hashOf(fs.readFileSync(where));
    runtimeVersions.set(file, { stamp, version });
    return version;
  } catch {
    return null;
  }
};
const runtimeUrl = (file) => {
  const version = runtimeVersion(file);
  return version ? `/runtime/${file}?v=${version}` : `/runtime/${file}`;
};

/** The ids a document's html, head and body carry. */
const rootIds = (source) => {
  const ids = new Set();
  for (const m of String(source ?? '').matchAll(/<(?:html|head|body)\b[^>]*\sdata-marble-id="([^"]+)"/g)) ids.add(m[1]);
  return ids;
};

/** True when `ops` would take a document's html, head or body out of a page.
 *  Defence in depth: marble's diff matches those three by tag since b9c1045,
 *  so a regeneration with fresh ids diffs as their children; a host on an
 *  older marble still gets a reload here rather than an emptied tab. */
export const rootRemoved = (priorSource, ops) => {
  const roots = rootIds(priorSource);
  return roots.size > 0 && (ops ?? []).some((op) => op?.type === 'remove' && roots.has(op.id));
};

export async function createDrive(config, { log = console, agentProviders = null, agents: withAgents = true, usage = null, usageHistory = null, typesafe: typesafeOpts = null, genui: genuiOpts = null, agentSandbox = null } = {}) {
  const store = createStore({ root: config.root });
  await store.ready();

  const channels = createChannels();
  const oplog = createOpLog({ dir: store.marbleDir });
  const thumbs = createThumbs({ dir: path.join(store.marbleDir, 'thumbs'), ...(config.quicklook === false ? { platform: 'none' } : {}) });
  const gate = createGate({
    secret: config.secret,
    cookieName: config.cookieName,
    days: config.sessionDays,
    secure: config.secureCookie,
  });
  const intents = createIntents({ store, log });
  const stems = createStems({ store, channels, log });
  const uploads = createUploads({
    store,
    maxBytes: config.maxFileBytes,
    chunkBytes: config.uploadChunkBytes,
    marginBytes: config.uploadMarginBytes,
    freePath: (wanted) => freeFilePath(wanted),
  });
  // A session nobody came back for is dropped after a day: at boot, then hourly.
  uploads.sweep().catch(() => {});
  const uploadSweep = setInterval(() => uploads.sweep().catch(() => {}), 60 * 60 * 1000);
  uploadSweep.unref?.();
  // On a sprite: stay awake while a turn or a split is getting somewhere, even
  // with no tab open (server/keep-awake.js), within the limits in server/hold.js.
  // Time is awake time, so a night frozen adds nothing. Inert off a sprite.
  const awake = createAwakeClock();
  const progress = createProgress();
  const hold = createHold({
    clock: awake,
    progress,
    limits: {
      pausedMs: config.askHoldMinutes * 60_000,
      noProgressMs: config.noProgressMinutes * 60_000,
      maxMs: config.awakeMaxHours * 60 * 60_000,
    },
  });
  const work = () => [
    ...(agents?.runner?.running?.() ?? []).map((turn) => ({
      key: `turn:${turn.id}`,
      lastProgress: turn.lastProgress,
      pausedSince: turn.pausedSince,
    })),
    ...stems.work(),
  ];
  // A forgotten tab's streams would keep the sprite awake too: they close once
  // the tab goes unused (server/streams.js, runtime/tab-rest.js).
  const unusedMs = config.streamUnusedMinutes * 60_000;
  const streams = createStreams({ unusedMs, checkMs: Math.max(50, Math.min(60_000, Math.floor(unusedMs / 4))) });
  const keepAwake = createKeepAwake({
    socket: config.spriteSocket,
    busy: () => hold.holds(work()),
    log,
  });
  keepAwake.start();
  // One line a minute while awake: what the machine used and why it was up,
  // for the Console to draw state and cost over time (server/ledger.js).
  const seenTurns = new Set();
  const ledger = createLedger({
    dir: path.join(store.marbleDir, 'usage'),
    log,
    why: () => {
      const items = work();
      for (const item of items) {
        if (item.key.startsWith('turn:') && !seenTurns.has(item.key)) {
          seenTurns.add(item.key);
          ledger.count('turns');
        }
      }
      const live = new Set(items.map((i) => i.key));
      for (const key of seenTurns) if (!live.has(key)) seenTurns.delete(key);
      const asks = items.filter((i) => i.pausedSince !== null && i.pausedSince !== undefined).length;
      return { tabs: streams.count, looking: streams.looking(60_000), work: items.length - asks, asks };
    },
  });
  const typesafe = createTypesafeHandler({
    apiKey: config.typesafeApiKey,
    maxBodyBytes: config.maxBodyBytes,
    ...(typesafeOpts ?? {}),
  });

  // Writes are serialized per document. `lastKnown` holds the last content this
  // host is sure about and which client put it there, and it answers what the
  // document said *before* an edit from outside. Whether a change on disk is
  // one of ours is a separate question — `pendingWrites` answers it, because a
  // single "last" slot is the wrong shape once two of our own writes to the
  // same document can be in flight at once.
  const queues = new Map();
  const lastKnown = new Map();
  const pendingWrites = createPendingWrites();
  const sessionTouched = createTouched();

  // The construction zones standing right now, per document and agent client.
  // Presence is a broadcast, so it only ever reached the tabs that were already
  // listening; this is what a tab joining mid-turn is caught up with. A frame
  // with no ids is not a zone, so it is a removal.
  const looking = new Map();
  const rememberLook = (docPath, frame) => {
    const here = looking.get(docPath) ?? new Map();
    if (frame.ids.length) here.set(frame.client, frame);
    else here.delete(frame.client);
    if (here.size) looking.set(docPath, here);
    else looking.delete(docPath);
  };

  // A person's edits are concurrent with an agent's write only if they landed
  // after that agent's turn began: the turn read the document as its base,
  // and anything before the base is history it has already seen.
  const sinceFor = (client) => {
    const conv = typeof client === 'string' && client.startsWith('agent:') ? client.slice('agent:'.length) : null;
    if (!conv) return undefined;
    const turn = agents?.running?.().find((t) => t.conversationId === conv);
    return turn?.startedAt;
  };

  const enqueue = (docPath, task) => {
    const next = (queues.get(docPath) ?? Promise.resolve()).then(task, task);
    queues.set(docPath, next.catch(() => {}));
    return next;
  };

  // ------------------------------------------------------------------ serving

  const injectCarrier = (source, docPath) => {
    // tab-rest.js first: it stands in for EventSource before any stream opens.
    let tags =
      `<script src="${runtimeUrl('tab-rest.js')}" data-hidden-ms="${config.tabHiddenSeconds * 1000}" data-idle-ms="${config.tabIdleMinutes * 60_000}" data-marble-transient></script>\n` +
      `<script src="${runtimeUrl('marble.js')}" data-marble-app="${escapeHtml(docPath)}" data-marble-transient></script>\n` +
      `<script src="${runtimeUrl('drive.js')}" data-marble-transient></script>\n` +
      `<script src="${runtimeUrl('affords.js')}" data-marble-transient></script>`;
    if (agents) {
      tags += `\n<script src="${runtimeUrl('agent.js')}" data-marble-transient></script>`;
      // Custom meta skips the drawer mount in runtime/agent-ui.js, not this script —
      // Agents.mrbl still needs <marble-conversation> without a second launcher.
      tags += `\n<script src="${runtimeUrl('agent-ui.js')}" data-marble-transient></script>`;
      tags += `\n<script src="${runtimeUrl('agent-folders.js')}" data-marble-transient></script>`;
      tags += `\n<script src="${runtimeUrl('agent-phone.js')}" data-marble-transient></script>`;
      tags += `\n<script src="${runtimeUrl('agent-usage-charts.js')}" data-marble-transient></script>`;
    }
    tags += `\n<script src="${runtimeUrl('collab.js')}" data-marble-transient></script>`;
    // The Console's own look and behaviour, only on the Console, only where
    // the console is on (server/console).
    if (consoleApp && /<meta\s+name="marble-console"/i.test(source)) {
      tags += `\n<link rel="stylesheet" href="${runtimeUrl('console.css')}" data-marble-transient>`;
      tags += `\n<script src="${runtimeUrl('console-charts.js')}" data-marble-transient></script>`;
      tags += `\n<script src="${runtimeUrl('console.js')}" data-marble-transient></script>`;
    }
    // After collab.js: the callout hangs its card with the zone's own geometry.
    if (agents) tags += `\n<script src="${runtimeUrl('agent-callout.js')}" data-marble-transient></script>`;
    // After the callout, whose handle both tools hand their ids to, and after
    // agent-ui.js, whose tray is the only place these tools are reachable from
    // — a register nobody answers takes the layer back down.
    if (agents) {
      tags += `\n<script src="${runtimeUrl('agent-marks-geometry.js')}" data-marble-transient></script>`;
      tags += `\n<script src="${runtimeUrl('agent-marks.js')}" data-marble-transient></script>`;
      tags += `\n<script src="${runtimeUrl('agent-variations.js')}" data-marble-transient></script>`;
    }
    return source.includes('</body>')
      ? source.replace(/<\/body>/i, () => `${tags}\n</body>`)
      : source + tags;
  };

  /** Every document the Drive can see, flat — the shape Marble's carrier
   *  already expects from `/docs`, with `path` and `folder` added. A document
   *  written for a flat host still works; one written for this one gets
   *  folders. */
  const listDocs = async () => (await store.list({ recursive: true })).filter((e) => e.kind === 'doc');

  // ------------------------------------------------------------------ writing

  /** The one write path. Ops are checked against the document as it actually
   *  is and refused as a batch, a restore point is taken of what is being
   *  replaced, and only then do the bytes move.
   *
   *  `prepare` and `after` are for a writer that has to decide against the
   *  document *as it is inside the queue* — an agent's precondition, and the
   *  undo record it keeps. Nothing can land between them and the write. A
   *  gesture passes neither. */
  async function applyOps(docPath, ops, { client = null, prepare = null, after = null } = {}) {
    return enqueue(docPath, async () => {
      const source = await store.read(docPath);
      if (source === null) throw Object.assign(new Error(`no document "${docPath}"`), { status: 404 });

      if (prepare) {
        const planned = await prepare(source);
        if (planned.refused) {
          return { applied: 0, refused: planned.refused, bytes: bytesOf(source), sha: shaOf(source) };
        }
        ops = planned.ops;
      }

      // `after` is bookkeeping for a writer that has already won; it must not
      // turn a write that landed (or a batch that changed nothing) into an
      // error. A throw is logged, and the result stands.
      const settle = (before, now) => {
        try {
          after?.(before, now);
        } catch (err) {
          log.error(`[drive] after-write hook for ${docPath} failed: ${err.message}`);
        }
      };

      // An undo is a retraction, not a write of its own: each of its steps runs
      // only if the element is still what the agent left (undo.js), which is
      // the conflict check it needs. So it neither forks nor claims — and it
      // happens after the turn that would have forgotten its claim has ended.
      const isUndo = typeof client === 'string' && client.startsWith('agent-undo:');

      const next = (() => {
        // A person's write can only conflict with an agent's: another tab of
        // theirs that touched the same id is not a second author.
        const isAgentWrite = typeof client === 'string' && client.startsWith('agent:');
        const others = isUndo
          ? []
          : sessionTouched.except(docPath, client, { since: sinceFor(client), agentsOnly: !isAgentWrite });
        if (others.length) {
          const merged = mergeOps(source, ops, {
            touchedIds: others,
            agent: typeof client === 'string' && client.startsWith('agent:') ? client : 'agent',
          });
          if (merged.forks.length) return { html: merged.source, ops: merged.ops, forks: merged.forks };
        }
        return { html: guardOps(source, ops), ops, forks: [] };
      })();

      if (next.html === source) {
        settle(source, source);
        return { applied: 0, bytes: bytesOf(source), sha: shaOf(source), ops: [], forks: [] };
      }

      lastKnown.set(docPath, { source: next.html, client });
      pendingWrites.mark(docPath, shaOf(next.html));
      const written = await store.write(docPath, next.html, { label: 'ops', ops: next.ops });
      await oplog.append(docPath, next.ops, { client: client ?? 'anon' });
      if (!isUndo) sessionTouched.note(docPath, client, idsOfOps(ops));
      settle(source, next.html);
      return { applied: next.ops.length, ops: next.ops, forks: next.forks, ...written };
    });
  }

  /** Apply, then tell everybody else. The route and the agent tools both come
   *  through here, so the echo rule lives in one place. */
  async function writeOps(docPath, ops, options = {}) {
    const result = await applyOps(docPath, ops, options);
    if (result.applied) {
      const except = result.forks?.length ? null : (options.client ?? null);
      channels.toDocument(docPath, 'changed', {
        except,
        ops: result.ops,
        client: options.client ?? null,
      });
      channels.toDrive('changed', { path: docPath, bytes: result.bytes }, { except: options.client ?? null });
      const ids = idsOfOps(result.ops ?? []);
      if (ids.length) {
        const client = options.client ?? 'anon';
        const payload = { client, ids, label: options.client ?? undefined };
        if (String(client).startsWith('agent')) {
          payload.phase = 'writing';
          if (options.note) payload.note = options.note;
        }
        channels.toPresence(docPath, payload, { except });
      }
    }
    return result;
  }

  // Fast GenUI: Jev positions a document inside the space its author wrote.
  // Created here rather than beside `typesafe` because it writes, and the one
  // write path is defined just above.
  const genui = createGenuiHandler({
    store,
    atlasFile: config.genuiAtlas,
    apiKey: config.typesafeApiKey,
    writeOps,
    marbleDir: store.marbleDir,
    ask: genuiOpts?.ask,
    log,
    maxBodyBytes: config.maxBodyBytes,
  });

  /** A document arriving from anywhere other than an op — created, restored,
   *  flattened. Same serialization, same restore point, same echo. */
  async function putDocument(docPath, source, { label, client = null, event = 'created' } = {}) {
    const result = await enqueue(docPath, async () => {
      lastKnown.set(docPath, { source, client: null });
      pendingWrites.mark(docPath, shaOf(source));
      return store.write(docPath, source, { label });
    });
    channels.toDocument(docPath, 'changed', { except: client });
    channels.toDrive(event, { path: docPath }, { except: client });
    return result;
  }

  // Named once, and used both here and by the agents: a document arriving
  // from outside an op, always through the same restore point and echo.
  const createDocument = (docPath, source, { label = 'created' } = {}) => putDocument(docPath, source, { label });

  async function restoreDocument(docPath, sha, { client = null } = {}) {
    const wanted = await store.snapshot(docPath, sha);
    if (wanted === null) {
      throw Object.assign(new Error(`no checkpoint ${String(sha).slice(0, 12)}`), { status: 404 });
    }
    const current = await store.read(docPath);
    if (wanted === current) return { ok: true, sha, restored: false };
    await putDocument(docPath, wanted, { label: 'before-restore', event: 'changed', client });
    return { ok: true, sha, restored: true, bytes: bytesOf(wanted) };
  }

  // ------------------------------------------------------------------- routes

  // Set once the server exists, because the agents need to know where to tell
  // their MCP bridge to call back. Null when agents are not allowed here.
  let agents = null;
  // The run the host starts once a day (server/daily.js), once agents are up.
  let daily = null;
  // The console (server/console): on only where MARBLE_DRIVE_CONSOLE says so.
  let consoleApp = null;
  // Why `agents` is null, when it is — for the boot line.
  let agentsWhy = withAgents ? agentsAllowed(config).why : 'not started for this command';

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const route = url.pathname;
    // Any request may be the one that woke a paused sprite, and the only
    // chance to start a day that came due while it slept: the sprite pauses
    // again before a minute timer would fire.
    daily?.nudge();

    try {
      // The gate, and the two things that have to be reachable through it: the
      // form itself, and a health check a load balancer runs before anybody has
      // a cookie.
      if (route === '/health') return json(res, 200, { ok: true, docs: channels.counts, streams: streams.count });
      // The mark, for the two pages that cannot carry it in their own head: a
      // document written before this host had one, and the gate. Everything
      // made here has it inline and never asks — which is why this is a
      // fallback rather than the mechanism. In front of the gate on purpose: it
      // is a drawing, and a closed drive that will not draw its own icon is a
      // browser retrying a 302 it cannot follow.
      if (route === '/favicon.svg') {
        return send(res, 200, iconSvg('doc'), {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        });
      }
      if (route === '/favicon.ico') return send(res, 302, '', { Location: '/favicon.svg' });
      if (route === '/gate') return gateRoute(req, res, url);
      // In front of the gate: the MCP bridge carries a turn's token, not the
      // drive's secret, and the tool routes check that token themselves.
      if (route === '/agent/tools' || route.startsWith('/agent/tools/')) {
        // Awaited, so a refusal thrown inside reaches the catch below as a status.
        return agents ? await agents.handleTools(req, res, url) : text(res, 404, 'not found');
      }
      if (!gate.allows(req)) {
        if ((req.headers.accept ?? '').includes('text/html')) {
          return send(res, 302, '', { Location: `/gate?to=${encodeURIComponent(req.url)}` });
        }
        return json(res, 401, { error: 'this drive is closed', hint: 'POST /gate with the secret' });
      }
      if (route.startsWith('/agent/')) {
        return agents ? await agents.handle(req, res, url) : text(res, 404, 'not found');
      }
      if (route.startsWith('/console/')) {
        return consoleApp ? await consoleApp.handle(req, res, url, route) : text(res, 404, 'not found');
      }
      if (await typesafe.handle(req, res, url)) return;
      if (await genui.handle(req, res, url)) return;

      if (route === '/') {
        // Land on the Drive if it is there. It is an ordinary document with no
        // standing, so deleting it falls back to whatever exists.
        const landing = (await store.has(config.home))
          ? config.home
          : (await listDocs())[0]?.path;
        if (landing) return send(res, 302, '', { Location: `/a/${encodeURIComponent(landing)}` });
        return text(res, 404, `no documents in ${config.root}\n\nmake one:  marble-drive new <name>\n`);
      }

      if (route === '/today') {
        // One address, bookmarked once, that always opens whatever a
        // recurring skill built most recently — the skill's job is to keep
        // `latest` mirrored, not to hand out a fresh URL each day. The
        // environment wins, then the drive's own settings, then the newest.
        const latest = config.latestDoc ?? (await readDriveSettings(store.marbleDir)).latest;
        const landing = latest && (await store.has(latest))
          ? latest
          : (await listDocs())[0]?.path;
        if (landing) return send(res, 302, '', { Location: `/a/${encodeURIComponent(landing)}` });
        return text(res, 404, `no documents in ${config.root}\n\nmake one:  marble-drive new <name>\n`);
      }

      if (route.startsWith('/runtime/')) {
        const file = route.slice('/runtime/'.length);
        const resolve = Object.hasOwn(RUNTIME, file) ? RUNTIME[file] : null;
        if (!resolve) return text(res, 404, `no runtime module "${file}"`);
        const js = await fsp.readFile(resolve(), 'utf8').catch(() => null);
        if (js === null) return text(res, 404, `no runtime module "${file}"`);
        const type = file.endsWith('.css') ? 'text/css' : 'text/javascript';
        // Kept for good at the address a page names (runtimeUrl), because a new
        // version is a new address. Any other address — an import() inside
        // the runtime, a stale version — is asked about each time, and a
        // browser that already has these bytes is told so.
        const version = hashOf(js);
        const headers = {
          'Content-Type': `${type}; charset=utf-8`,
          ETag: `"${version}"`,
          'Cache-Control': url.searchParams.get('v') === version ? 'private, max-age=31536000, immutable' : 'no-cache',
        };
        if (req.headers['if-none-match'] === headers.ETag) return send(res, 304, '', headers);
        return send(res, 200, js, headers);
      }

      if (route.startsWith('/a/')) {
        const docPath = parsePath(decodeURIComponent(route.slice(3)), { allowRoot: false });
        const source = await store.read(docPath);
        if (source === null) return text(res, 404, `no document "${docPath}"`);
        // Serving is the first thing that happens to a document this session, so
        // it is where the baseline comes from: an edit from outside now has a
        // state to be measured against, and a restore point that predates it.
        if (!lastKnown.has(docPath)) {
          lastKnown.set(docPath, { source, client: null });
          await store.mark(docPath, source, 'opened');
        }
        // A visit, not a preview: the Drive draws live pages in iframes.
        const dest = req.headers['sec-fetch-dest'];
        if (!dest || dest === 'document') ledger.count('opens');
        return html(res, 200, injectCarrier(source, docPath));
      }

      // ------------------------------------------------- the carrier's surface

      if (route === '/docs' && req.method === 'GET') {
        if (url.searchParams.get('tree')) {
          return json(res, 200, await store.tree({ folder: url.searchParams.get('folder') ?? '' }));
        }
        // `name` is what Marble's carrier calls a document, and here that name
        // is its whole path — so `marble.href(doc.name)` still opens it.
        const docs = await listDocs();
        return json(res, 200, docs.map((doc) => ({ ...doc, name: doc.path })));
      }

      // A tab says someone is using it: its streams stay open, and a day of
      // unattended work starts again (server/streams.js, server/hold.js).
      // This drive's ledger since a moment (unix seconds): what it used, minute
      // by minute, while awake (server/ledger.js).
      if (route === '/usage' && req.method === 'GET') {
        return json(res, 200, { lines: await ledger.read(Number(url.searchParams.get('since')) || 0) });
      }

      if (route === '/tab/alive' && req.method === 'POST') {
        const body = await readJson(req, 1024).catch(() => ({}));
        streams.alive(body?.tab);
        hold.used();
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        return res.end();
      }

      if (route === '/events') {
        if (!streams.admit(req, url)) {
          res.writeHead(204, { 'Cache-Control': 'no-store' });
          return res.end();
        }
        streams.track(req, res, url);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        const client = { id: url.searchParams.get('client'), res };

        const off = url.searchParams.get('drive')
          ? channels.subscribeDrive(client)
          : channels.subscribeDoc(parsePath(url.searchParams.get('app'), { allowRoot: false }), client);
        req.on('close', () => {
          off();
          if (!url.searchParams.get('drive') && client.id) {
            try {
              sessionTouched.drop(parsePath(url.searchParams.get('app'), { allowRoot: false }), client.id);
            } catch {
              // A malformed app on a closing socket is not worth a 500.
            }
          }
        });
        return;
      }

      // What zones are standing on this document right now. A presence frame is
      // broadcast once, to whoever was listening at the time, and a tab loads
      // its runtime in several script tags — so a tab that opens mid-turn, which
      // is exactly what a conversation's "take me to the work" does, cannot
      // catch one by listening. It asks instead.
      if (route === '/presence' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        return json(res, 200, { frames: [...(looking.get(docPath)?.values() ?? [])] });
      }

      if (route === '/presence' && req.method === 'POST') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const client = url.searchParams.get('client');
        const body = JSON.parse((await readBody(req, config.maxBodyBytes)).toString('utf8'));
        const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
        // Where a person is looking is not a claim on it. The frame is for the
        // wash other tabs draw; conflicts come from writes (see applyOps).
        channels.toPresence(docPath, { client, ids }, { except: client });
        return json(res, 200, { ok: true });
      }

      if (route === '/ops' && req.method === 'POST') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const client = url.searchParams.get('client');
        const ops = JSON.parse((await readBody(req, config.maxBodyBytes)).toString('utf8'));
        if (!Array.isArray(ops)) return json(res, 400, { error: 'expected an array of ops' });

        // The echo is for the other tabs, the other devices, the other people,
        // and the agent — never for whoever filed it.
        const result = await writeOps(docPath, ops, { client });
        return json(res, 200, { ok: true, ...result });
      }

      if (route === '/history' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        return json(res, 200, await store.history(docPath));
      }

      if (route === '/restore' && req.method === 'POST') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const sha = url.searchParams.get('sha');
        if (!/^[0-9a-f]{64}$/.test(sha ?? '')) return json(res, 400, { error: 'bad checkpoint' });
        return json(res, 200, await restoreDocument(docPath, sha));
      }

      if (route === '/intents' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const entry = await intents.lookup(docPath, url.searchParams.get('id'));
        if (!entry) return json(res, 404, { error: 'no record of that intent' });
        return json(res, 200, entry);
      }

      if ((route === '/intent' || route === '/zoom') && req.method === 'POST') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const request = await readJson(req, config.maxBodyBytes);
        const run = route === '/intent' ? intents.ask : intents.zoom;

        if (!(req.headers.accept ?? '').includes('text/event-stream')) {
          return json(res, 200, await run(docPath, request));
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        // Past this point the status line is already sent, so a failure is an
        // `error` event rather than a 400. A closed connection stops the work
        // rather than only stopping the writing about it.
        let gone = false;
        const withdrawn = new AbortController();
        req.on('close', () => {
          gone = true;
          withdrawn.abort();
        });
        const emit = (event, data) => {
          if (!gone) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        try {
          emit('done', await run(docPath, request, ({ type, ...rest }) => emit(type, rest), withdrawn.signal));
        } catch (err) {
          if (!withdrawn.signal.aborted) emit('error', { error: err.message });
        }
        return res.end();
      }

      // ---------------------------------------------------------- drive verbs

      if (route === '/drive/starters' && req.method === 'GET') {
        return json(res, 200, listStarters());
      }

      // A picture of a starter, so the gallery can show the document instead of
      // describing it. Deliberately not under /a/: there is no document here and
      // none is made by asking. What comes back has had every script taken out of
      // it, and the page mounts it in an empty sandbox on top of that — a preview
      // is a picture, not a second live copy.
      const previewing = /^\/drive\/starters\/([\w-]+)\/preview$/.exec(route);
      if (previewing && req.method === 'GET') {
        try {
          const source = await starterPreview(previewing[1]);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'private, max-age=300',
          });
          return res.end(source);
        } catch (err) {
          return json(res, err.status ?? 500, { error: err.message });
        }
      }

      // The drive's own choices (server/drive-settings.js): which folders wear
      // a realm, which document /today opens. Empty for a drive with none.
      if (route === '/drive/settings' && req.method === 'GET') {
        return json(res, 200, await readDriveSettings(store.marbleDir));
      }

      if (route === '/drive/tree' && req.method === 'GET') {
        return json(res, 200, await store.tree({ folder: url.searchParams.get('folder') ?? '' }));
      }

      if (route === '/drive/new' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const docPath = await freePath(parsePath(body.path, { allowRoot: false }));
        const source = body.from
          ? await buildStarter(body.from, { name: splitPath(docPath).name })
          : await copyOf(body.copy, docPath);
        await putDocument(docPath, source, { label: 'created', client: body.client ?? null });
        return json(res, 200, { ok: true, path: docPath, href: `/a/${encodeURIComponent(docPath)}` });
      }

      // A document arriving from outside the drive — dropped onto the page, or
      // posted by anything else that has one. Deliberately shaped like `/ops`
      // rather than like the other drive verbs: the body is the document, not
      // JSON with a document inside it, so a 4 MB file is 4 MB on the wire
      // instead of a JSON string quoting every byte of it.
      //
      // Where it lands is two strings — the folder, and the name the file had
      // on the other machine — because those are the two things a drop knows.
      // Both are sanitised rather than refused: `Q3 Résumé (final).mrbl` is an
      // ordinary filename and three separate refusals in this repo's grammar.
      if (route === '/drive/upload' && req.method === 'POST') {
        const folder = parsePath(safePath(url.searchParams.get('folder') ?? ''));
        const name = safeSegment(withoutDocExt(url.searchParams.get('name') ?? ''));
        const client = url.searchParams.get('client');
        const source = (await readBody(req, config.maxBodyBytes)).toString('utf8');

        const verdict = inspect(name, source);
        if (verdict.error) return json(res, 400, verdict);

        const docPath = await freePath(joinPath(folder, name));
        await putDocument(docPath, source, { label: 'uploaded', client });
        return json(res, 200, {
          ok: true,
          path: docPath,
          href: `/a/${encodeURIComponent(docPath)}`,
          bytes: bytesOf(source),
          warnings: verdict.warnings,
        });
      }

      // A file that is not a document, arriving the same way — the mp3 dropped
      // into the folder beside the mashup that plays it. The body is the bytes
      // and is streamed to disk as it comes, so it has its own ceiling rather
      // than the one sized for documents held in memory. A document never comes
      // in through here: the page sends those to `/drive/upload`, and a .mrbl or
      // .html that arrives anyway is refused rather than stored as a file that
      // would open as its own source.
      if (route === '/drive/upload-file' && req.method === 'POST') {
        const folder = parsePath(safePath(url.searchParams.get('folder') ?? ''));
        const name = cleanFileName(url.searchParams.get('name') ?? '');
        // A size the client declares is checked before a byte is read: above
        // the cap, or more than the disk has room for, is refused now.
        const declared = Number(req.headers['content-length']);
        if (Number.isSafeInteger(declared)) await uploads.room(declared);
        const filePath = await freeFilePath(joinPath(folder, name));
        // Silence, not length, ends an upload (the server has no whole-request
        // deadline, see below). Cutting the socket fails the pipe, and putFile
        // takes its half-written part away.
        req.setTimeout(config.uploadIdleSeconds * 1000, () => req.destroy(new Error('the upload stopped sending')));
        const put = await store.putFile(filePath, req, { limit: config.maxFileBytes });
        channels.toDrive('created', { path: put.path, kind: 'file' }, { except: url.searchParams.get('client') });
        return json(res, 200, {
          ok: true,
          path: put.path,
          href: `/drive/file?path=${encodeURIComponent(put.path)}`,
          bytes: put.bytes,
        });
      }

      if (route === '/drive/mkdir' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const made = await store.mkdir(body.path);
        channels.toDrive('created', { path: made.path, kind: 'folder' });
        return json(res, 200, { ok: true, ...made });
      }

      if (route === '/drive/move' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const moved = await store.move(body.from, body.to);
        // The name is the address, so a move is a change of identity. The
        // bookkeeping this host holds in memory has to follow it or the next
        // write is measured against the wrong baseline.
        if (lastKnown.has(moved.from)) {
          lastKnown.set(moved.to, lastKnown.get(moved.from));
          lastKnown.delete(moved.from);
        }
        pendingWrites.move(moved.from, moved.to);
        channels.toDrive('moved', moved);
        return json(res, 200, { ok: true, ...moved });
      }

      if (route === '/drive/trash' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const entry = await store.trash(body.path);
        lastKnown.delete(entry.path);
        channels.toDrive('trashed', entry);
        return json(res, 200, { ok: true, ...entry });
      }

      if (route === '/drive/trash' && req.method === 'GET') {
        return json(res, 200, await store.listTrash());
      }

      if (route === '/drive/untrash' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const entry = await store.untrash(body.id, { to: body.to ?? null });
        channels.toDrive('restored', entry);
        return json(res, 200, { ok: true, ...entry });
      }

      // A file in the drive that is not a document — the bibliography beside
      // the paper, the cover image, the JSON a script reads. The Drive lists
      // these quietly rather than hiding them, and a thing you can see and
      // cannot open is worse than one you cannot see.
      if (route === '/drive/file' && req.method === 'GET') {
        const file = await store.readRaw(url.searchParams.get('path') ?? '');
        if (!file) return text(res, 404, `no file "${url.searchParams.get('path')}"`);
        const type = INLINE_TYPES[file.ext] ?? null;
        const headers = {
          'Cache-Control': 'no-store',
          'Content-Type': type ?? 'application/octet-stream',
          // Two headers doing one job, because getting this wrong is a script
          // running on the drive's own origin with the drive's own cookie.
          // `nosniff` stops the browser deciding for itself that a .txt is
          // HTML, and the sandbox policy makes it inert even if it decides
          // anyway.
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          // Anything not on the allowlist is downloaded rather than rendered.
          // The list is short on purpose: `.svg` is missing from it because an
          // SVG can carry script, and it looks like a picture right up until
          // it is one.
          'Content-Disposition':
            `${type ? 'inline' : 'attachment'}; filename="${file.name.replace(/["\\]/g, '')}"`,
          // A song is played by seeking into it. Without this a browser will
          // play one from the top and refuse to move the playhead anywhere.
          'Accept-Ranges': 'bytes',
        };
        // A PDF is the one exception to the sandbox. The browser's viewer is a
        // plugin, and it refuses to draw inside a sandboxed page (or under a
        // policy that forbids objects) — so a PDF under the header above opens
        // as a blank tab. The viewer runs its own document, not script on
        // this origin, so the file has nothing to reach even without it.
        if (file.ext === 'pdf') delete headers['Content-Security-Policy'];

        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        if (range && file.bytes > 0 && (range[1] || range[2])) {
          // `bytes=500-` is from 500 on, `bytes=-500` is the last 500.
          let start = range[1] ? Number(range[1]) : Math.max(0, file.bytes - Number(range[2]));
          let end = range[1] && range[2] ? Math.min(Number(range[2]), file.bytes - 1) : file.bytes - 1;
          if (start > end || start >= file.bytes) {
            res.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.bytes}` });
            return res.end();
          }
          res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${file.bytes}`,
            'Content-Length': end - start + 1,
          });
          return file.open({ start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, 'Content-Length': file.bytes });
        return file.open().pipe(res);
      }

      // A picture of a file, for the tile it sits in: a PDF's first page, a
      // slide, a photo the browser cannot decode. Made by the system's own
      // thumbnailer and kept; a 404 means "draw it yourself", which is always
      // allowed. Cacheable, because the address names the file's version.
      if (route === '/drive/thumb' && req.method === 'GET') {
        const file = await store.readRaw(url.searchParams.get('path') ?? '');
        if (!file) return text(res, 404, `no file "${url.searchParams.get('path')}"`);
        const made = await thumbs.get(file, url.searchParams.get('w'));
        if (!made) return text(res, 404, `no picture of "${file.name}"`);
        const bytes = await fsp.readFile(made);
        return send(res, 200, bytes, {
          'Content-Type': made.endsWith('.webp') ? 'image/webp' : 'image/png',
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        });
      }

      // ------------------------------------------------------- upload sessions
      //
      // A big file, in chunks (server/uploads.js). Start, send each chunk at
      // the offset the host has, finish; a chunk that lands in the wrong
      // place is a 409 that says where the host is, so a retry never
      // duplicates a byte and a reload can carry on.
      if (route === '/drive/uploads' && req.method === 'POST') {
        const body = await readJson(req, 64 * 1024);
        return json(res, 200, await uploads.start(body));
      }
      const session = /^\/drive\/uploads\/([^/]+)(\/finish)?$/.exec(route);
      if (session) {
        const [, id, finishing] = session;
        if (finishing && req.method === 'POST') {
          const put = await uploads.finish(id);
          channels.toDrive('created', { path: put.path, kind: 'file' }, { except: url.searchParams.get('client') });
          return json(res, 200, {
            ok: true,
            path: put.path,
            href: `/drive/file?path=${encodeURIComponent(put.path)}`,
            bytes: put.bytes,
          });
        }
        if (!finishing && req.method === 'PUT') {
          req.setTimeout(config.uploadIdleSeconds * 1000, () => req.destroy(new Error('the upload stopped sending')));
          try {
            return json(res, 200, await uploads.append(id, url.searchParams.get('offset'), req));
          } catch (err) {
            if (err.status === 409) return json(res, 409, { error: err.message, received: err.received });
            throw err;
          }
        }
        if (!finishing && req.method === 'GET') return json(res, 200, await uploads.status(id));
        if (!finishing && req.method === 'DELETE') return json(res, 200, await uploads.cancel(id));
      }

      // A picture the page drew, because this host could not: the first page
      // of a PDF, a frame of a video. Kept beside QuickLook's, for this version
      // of the file, and served before QuickLook is asked. Small PNG or WebP
      // only (server/thumbs.js).
      if (route === '/drive/thumb' && req.method === 'PUT') {
        const file = await store.readRaw(url.searchParams.get('path') ?? '');
        if (!file) return text(res, 404, `no file "${url.searchParams.get('path')}"`);
        await thumbs.put(file, await readBody(req, DRAWN_MAX_BYTES));
        return json(res, 200, { ok: true });
      }

      // ---------------------------------------------------------------- stems

      // A song, split on this machine into its voice and its band, the pair
      // written beside it (server/stems). Asking answers at once with a job;
      // the page watches it by asking again.
      if (route === '/stems' && req.method === 'GET') {
        const folder = url.searchParams.has('folder') ? parsePath(url.searchParams.get('folder') ?? '') : null;
        return json(res, 200, stems.list({ folder }));
      }

      if (route === '/stems/split' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const job = await stems.split(body.path ?? '');
        keepAwake.nudge();
        return json(res, 200, { ok: true, job });
      }

      if (route === '/stems/cancel' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const job = stems.cancel(body.id ?? '');
        if (!job) return json(res, 404, { error: 'no such job' });
        return json(res, 200, { ok: true, job });
      }

      // ---------------------------------------------------------------- blobs

      if (route.startsWith('/blob/') && req.method === 'GET') {
        const blob = await store.blobs.get(route.slice('/blob/'.length));
        if (!blob) return text(res, 404, 'no such blob');
        // Content-addressed, so the bytes behind a hash never change and this is
        // the one thing in the whole host that is safe to cache forever.
        return send(res, 200, blob.data, {
          'Content-Type': blob.type,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
      }

      if (route === '/blob' && req.method === 'POST') {
        const bytes = await readBody(req, config.maxBlobBytes);
        const put = await store.blobs.put(bytes, { type: req.headers['content-type'] });
        return json(res, 200, { ok: true, ...put, href: `/blob/${put.hash}` });
      }

      if (route === '/drive/extract' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const docPath = parsePath(body.path, { allowRoot: false });
        const source = await store.read(docPath);
        if (source === null) return json(res, 404, { error: `no document "${docPath}"` });

        const result = await extract(source, store.blobs, { min: body.min ?? undefined });
        if (!result.extracted.length) return json(res, 200, { ok: true, extracted: 0, bytes: bytesOf(source) });
        await putDocument(docPath, result.source, { label: 'extract', event: 'changed' });
        return json(res, 200, {
          ok: true,
          extracted: result.extracted.length,
          was: bytesOf(source),
          bytes: bytesOf(result.source),
        });
      }

      // The escape hatch that makes blobs safe to take: any document, back to
      // one self-contained file you can hand to somebody.
      if (route === '/drive/download' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('path'), { allowRoot: false });
        const source = await store.read(docPath);
        if (source === null) return text(res, 404, `no document "${docPath}"`);
        const whole = url.searchParams.get('flatten') === '0'
          ? { source, inlined: 0 }
          : await flatten(source, store.blobs);
        const { name } = splitPath(docPath);
        return send(res, 200, whole.source, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}.mrbl"`,
          'X-Marble-Blobs-Inlined': String(whole.inlined),
        });
      }

      if (route === '/drive/weigh' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('path'), { allowRoot: false });
        const source = await store.read(docPath);
        if (source === null) return json(res, 404, { error: `no document "${docPath}"` });
        return json(res, 200, weigh(docPath, source));
      }

      return text(res, 404, 'not found');
    } catch (err) {
      if (!(err instanceof PathError)) log.error(`[drive] ${req.method} ${route} — ${err.message}`);
      // A refusal explains itself; a crash needs the stack to be found.
      if (!(err instanceof PathError) && !err.status && err.stack) log.error(err.stack);
      if (res.headersSent) return res.end();
      return json(res, err.status ?? 400, {
        error: err.message,
        ...(err.hint ? { hint: err.hint } : {}),
      });
    }
  });

  // Node's default gives a whole request five minutes, which capped a dropped
  // file at what the link could carry in five minutes — ~600 MB at 2 MB/s,
  // whatever MARBLE_DRIVE_MAX_FILE said. The deadline cannot be lifted for one
  // route, so it is lifted here and the upload route times silence instead.
  // Headers still have to arrive within `headersTimeout`.
  server.requestTimeout = 0;

  if (!agentsWhy) {
    agents = await createAgents({
      config,
      store,
      awake,
      progress,
      streams,
      onActivity: () => keepAwake.nudge(),
      writeOps,
      createDocument,
      restore: restoreDocument,
      // An agent's turn ending is the end of its claim on what it touched. Kept
      // for the life of the process, a turn's touches forked every later edit
      // near them — the person against an agent that finished an hour ago.
      forgetWriter: (client) => sessionTouched.forget?.(client),
      // Where the bridge calls back: this server, on loopback, whatever port it
      // ended up on.
      origin: () => {
        const address = server.address();
        const loopback = address.family === 'IPv6' ? '[::1]' : '127.0.0.1';
        return `http://${loopback}:${address.port}`;
      },
      // An agent's browser is a fresh Chromium, and this host's own gate would
      // turn it away from the drive it is working on. A pass is the gate's own
      // cookie, good for a day, planted for this host only (server/agent/browser.js).
      browserPass: gate.open ? null : () => `${gate.cookieName}=${gate.issue(24 * 60 * 60 * 1000)}`,
      providers: agentProviders ?? null,
      log,
      usage,
      usageHistory,
      sandbox: agentSandbox ?? null,
      onLook: (docPath, ids, client, extra = {}) => {
        if (!client) return;
        const frame = {
          client,
          ids: Array.isArray(ids) ? ids : [],
          label: extra.label ?? client,
          ...(extra.phase ? { phase: extra.phase } : {}),
          ...(extra.note ? { note: extra.note } : {}),
        };
        rememberLook(docPath, frame);
        channels.toPresence(docPath, frame);
      },
    }).catch((err) => {
      if (err.code !== 'EAGENTSHELD') throw err;
      agentsWhy = err.message;
      return null;
    });
  }

  if (agents) {
    daily = createDaily({
      at: config.dayAt,
      zone: config.dayZone,
      prompt: config.dayPrompt,
      target: config.dayTarget,
      start: agents.startRun,
      conversations: async () => [
        ...(await agents.store.conversations()),
        ...(await agents.store.conversations({ archived: true })),
      ],
      log,
    });
  }

  const consoleWhy = consoleAllowed(config);
  if (consoleWhy.ok) {
    consoleApp = await createConsole({ config, store, streams, ledger, log, json, readJson, text });
  } else if (config.console) {
    log.error?.(`[console] not started: ${consoleWhy.why}`);
  }

  // ------------------------------------------------------------------ helpers

  function gateRoute(req, res, url) {
    if (gate.open) return send(res, 302, '', { Location: '/' });

    if (req.method === 'POST') {
      return readJson(req, 4096)
        .then((body) => {
          if (!gate.accepts(body.secret)) return json(res, 401, { error: 'that is not the secret' });
          return json(res, 200, { ok: true }, { 'Set-Cookie': gate.cookieHeader(req) });
        })
        .catch(() => json(res, 400, { error: 'expected {"secret":"…"}' }));
    }

    // The only HTML this host ships, and it is one form. Anything more would be
    // the host having an interface, which is the thing the Drive exists not to
    // need — but a door has to be openable before there is a document to open.
    const to = escapeHtml(url.searchParams.get('to') ?? '/');
    return html(res, 200, `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Marble Drive</title>
<link rel="icon" href="${iconUri('drive')}">
<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#fafaf7;color:#111111}
form{display:flex;gap:.5rem}input,button{font:inherit;padding:.6rem .8rem;border:1px solid #ddd9cf;border-radius:8px}
button{background:#738698;color:#fafaf7;border-color:#738698;cursor:pointer}p{color:#5a5a5a}</style>
<div><p>This drive is closed.</p>
<form onsubmit="event.preventDefault();fetch('/gate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:this.secret.value})}).then(r=>r.ok?location.replace('${to}'):this.secret.select())">
<input name="secret" type="password" placeholder="Secret" autofocus><button>Open</button></form></div>`);
  }

  /** A name that is not taken. Drive appends "(1)" and so does this, because
   *  refusing a click that could have worked is worse than a number. */
  async function freePath(wanted) {
    if (!(await store.has(wanted)) && !(await store.hasFolder(wanted))) return wanted;
    const { parent, name } = splitPath(wanted);
    for (let n = 1; n < 500; n += 1) {
      const candidate = [parent, `${name} ${n}`].filter(Boolean).join('/');
      if (!(await store.has(candidate)) && !(await store.hasFolder(candidate))) return candidate;
    }
    throw new PathError(`too many documents called "${name}"`);
  }

  /** The same, for a file: the number goes before the extension, the way a
   *  desktop does it, so `song.mp3` is followed by `song 1.mp3` and still
   *  plays. Checked against every kind, because a file called `Notes` with no
   *  extension and a document called `Notes` would be one name twice. */
  async function freeFilePath(wanted) {
    const taken = async (candidate) =>
      (await store.hasFile(candidate)) ||
      (await store.hasFolder(candidate)) ||
      (await store.has(candidate));
    if (!(await taken(wanted))) return wanted;
    const { parent, name } = splitPath(wanted);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; n < 500; n += 1) {
      const candidate = [parent, `${stem} ${n}${ext}`].filter(Boolean).join('/');
      if (!(await taken(candidate))) return candidate;
    }
    throw new PathError(`too many files called "${name}"`);
  }

  /** What the drive thinks of a document somebody just handed it: `{error}`,
   *  or `{warnings}` and it goes in.
   *
   *  Two questions decide it, and only two. Is it a document at all — because a
   *  drive that will serve anything as a page is a drive that will serve the
   *  404 page somebody dropped by accident. And does it still address, which is
   *  the one invariant the format has: two nodes under one id means every op
   *  naming it edits the wrong one, silently, from then on.
   *
   *  Everything else the doctor notices comes back as a warning and does not
   *  stop the write. A drive that refuses to hold a document it merely has a
   *  note about is a drive you cannot move your work into.
   */
  function inspect(name, source) {
    if (!source.trim()) return { error: `"${name}" is empty` };
    if (!/<html[\s>]/i.test(source) && !/<!doctype\s+html/i.test(source)) {
      return {
        error: `"${name}" is not a document`,
        hint: 'a .mrbl is an HTML file, and this one has no <html> in it',
      };
    }

    const findings = examine(`${name}.mrbl`, source);
    const errors = findings.filter((finding) => finding.level === 'error');
    if (errors.length) {
      return {
        error: `"${name}" is not addressable — ${errors[0].message}`,
        hint:
          errors.length > 1
            ? `line ${errors[0].line}, and ${errors.length - 1} more like it`
            : `line ${errors[0].line}`,
      };
    }
    return {
      warnings: findings.map((finding) => `line ${finding.line}: ${finding.message}`),
    };
  }

  /** Fork on edit's other half: a copy is a copy of the bytes, because a
   *  document is one file. Nothing else has to happen for it to be yours. */
  async function copyOf(from, to) {
    const source = await store.read(parsePath(from, { allowRoot: false }));
    if (source === null) throw Object.assign(new Error(`no document "${from}"`), { status: 404 });
    return source.replace(/<title>([^<]*)<\/title>/i, () => `<title>${escapeHtml(splitPath(to).name)}</title>`);
  }

  /** What a document weighs, in the terms that decide whether blobs are a
   *  nicety or a blocker: total bytes, how many of them are base64, and how
   *  much of it a hand or a model can actually address. */
  function weigh(docPath, source) {
    const inline = [...source.matchAll(/;base64,([A-Za-z0-9+/=\s]+)"/g)]
      .map((match) => Math.floor(match[1].replace(/\s+/g, '').length * 0.75));
    const heavy = inline.reduce((sum, n) => sum + n, 0);
    const bytes = bytesOf(source);
    return {
      path: docPath,
      bytes,
      nodes: (source.match(/data-marble-id="/g) ?? []).length,
      inlineBlobs: inline.length,
      inlineBytes: heavy,
      // The number the decision actually turns on. Over a phone connection a
      // document that is 90% pixels is not a document, it is a download.
      share: bytes ? Number((heavy / bytes).toFixed(3)) : 0,
      blobs: blobsIn(source).length,
    };
  }

  // ----------------------------------------------------------------- watching

  const watcher = watchDrive(store, async (docPath) => {
    const current = await store.read(docPath);
    const prior = lastKnown.get(docPath);

    if (current === null) {
      // Gone. Either the trash route moved it, in which case the Drive already
      // heard, or somebody deleted the file by hand.
      if (prior) {
        lastKnown.delete(docPath);
        channels.toDrive('removed', { path: docPath });
      }
      return;
    }

    if (prior?.source === current) {
      // Nothing changed. A save can wake a busy watcher twice with the second
      // wake landing after the first has settled and used up the write's mark —
      // macOS does this under load — and the bytes are still the ones this
      // host knows about. Announcing it would reconcile the tab that made the
      // save against its own save. An outside edit that leaves the bytes as
      // they were is not an edit either.
      return;
    }

    if (pendingWrites.take(docPath, shaOf(current))) {
      // Our own save, and it has already been announced — synchronously, by the
      // route that made it, which is both faster than this and certain to
      // happen. Marble's host broadcasts from here instead, because its write
      // path does not; doing both is how every other tab hears one edit twice.
      //
      // Matched by content rather than by "is this the *last* thing we wrote",
      // because a document written to fast enough can have a second save start
      // — and update what "last" means — before this settle check for the
      // first one ever runs. Comparing against a single slot would call that
      // race an edit from outside and reconcile the very tab that is still
      // typing against a version of the file that predates its own keystrokes.
      //
      // Nothing is dropped by returning: a rename can wake this watcher several
      // times for one save, and every one of those wakes is this branch.
      return;
    }

    log.log(`[drive] ${docPath} changed outside the host — patching clients`);
    // What the document said before the edit, which is the state you want back
    // when the edit is an agent rewriting more of the file than it meant to.
    // There is no way to capture this as it happens: an external write is only
    // ever observed after the fact.
    if (prior) {
      await store.mark(docPath, prior.source, 'pre-external');
      // A full agent writes with its own file tools, so an agent's own work
      // reaches this branch constantly and a running turn claims it (spec §6).
      // What nobody claims is what this branch was written for: you, in an
      // editor, while a turn happens to be running.
      const claimed = agents?.documentTouched(docPath, shaOf(prior.source));
      if (!claimed) agents?.watchdog(docPath, shaOf(prior.source));

      const conv = typeof claimed === 'string' ? claimed : null;
      // The claiming turn's own earlier ops are not another writer's work:
      // counted, an agent that inserted a block by op and then rewrote it
      // with its file tools forked against itself.
      const merged = mergeWrite(prior.source, current, {
        touchedIds: conv
          ? sessionTouched.except(docPath, `agent:${conv}`, { since: sinceFor(`agent:${conv}`) })
          : sessionTouched.all(docPath),
        agent: conv ? `agent:${conv}` : 'agent',
      });
      // A remove of the document's own root is never sent as an op: applied
      // by an open tab it empties the page, and the tab's write-back then
      // puts a head-only file on disk (seen 2026-09-18). It is a reload.
      const ops = rootRemoved(prior.source, merged.ops) ? null : merged.ops;
      if (merged.source !== current) {
        lastKnown.set(docPath, { source: merged.source, client: null });
        pendingWrites.mark(docPath, shaOf(merged.source));
        await store.write(docPath, merged.source, { label: 'merge' });
        await store.thinHistory(docPath).catch(() => {});
        channels.toDocument(docPath, 'changed', { ops });
        channels.toDrive('changed', { path: docPath });
        const ids = idsOfOps(merged.ops);
        if (ids.length) {
          channels.toPresence(docPath, {
            client: conv ? `agent:${conv}` : 'agent',
            ids,
            phase: 'writing',
          });
        }
        return;
      }

      lastKnown.set(docPath, { source: current, client: null });
      await store.thinHistory(docPath).catch(() => {});
      channels.toDocument(docPath, 'changed', { ops: ops?.length ? ops : null });
      channels.toDrive('changed', { path: docPath });
      const ids = idsOfOps(merged.ops);
      if (ids.length) {
        const client = conv ? `agent:${conv}` : 'outside';
        channels.toPresence(docPath, {
          client,
          ids,
          ...(client.startsWith('agent') ? { phase: 'writing' } : {}),
        });
      }
      return;
    }

    lastKnown.set(docPath, { source: current, client: null });
    await store.thinHistory(docPath).catch(() => {});
    channels.toDocument(docPath, 'changed');
    channels.toDrive('created', { path: docPath });
  });

  /** What every document said before this host was watching it. Reading the
   *  drive once at boot is what makes "every write is preceded by a snapshot"
   *  true of the first write as well — including a write by an agent that
   *  reaches a document no browser has opened. */
  async function seed() {
    for (const doc of await listDocs()) {
      if (lastKnown.has(doc.path)) continue;
      const source = await store.read(doc.path);
      if (source === null) continue;
      lastKnown.set(doc.path, { source, client: null });
      await store.mark(doc.path, source, 'seen');
    }
  }

  const stopBackups = scheduleBackups({
    root: config.root,
    dir: config.backupDir,
    command: config.backupCommand,
    keep: config.backupKeep,
    everyMinutes: config.backupEveryMinutes,
    log: log.log,
  });

  return {
    server,
    store,
    uploads,
    keepAwake,
    ledger,
    channels,
    gate,
    oplog,
    writeOps,
    genui,
    agents,
    agentsWhy,
    console: consoleApp,
    createDocument,
    config,
    seed,
    weigh,
    backupNow: () =>
      backupNow({
        root: config.root,
        dir: config.backupDir,
        command: config.backupCommand,
        keep: config.backupKeep,
      }),
    provider: () => {
      try {
        return chooseProvider();
      } catch {
        return null;
      }
    },
    async close() {
      await agents?.close();
      stems.close();
      clearInterval(uploadSweep);
      await keepAwake.stop();
      await ledger.stop();
      awake.stop();
      streams.close();
      consoleApp?.close();
      stopBackups();
      daily?.stop();
      watcher.close();
      channels.close();
      // Event streams are open by design and keep-alive sockets are open by
      // default, so `close()` alone waits for a client that has no reason to go
      // first. Cut them, then wait for the listener itself.
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
