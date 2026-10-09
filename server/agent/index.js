// Everything agents need, put together for the host. `app.js` asks two
// questions of this file — may agents run here, and what handles their routes —
// and nothing else in the host knows how any of it works.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { enginePath, examine } from '../engine.js';
import { build as buildStarter, composeScript } from '../gallery.js';
import { createHub } from './hub.js';
import { createKeyStore } from './keys.js';
import { findProject } from './projects.js';
import { createAgentRoutes } from './routes.js';
import { nameConversation } from './namer.js';
import { drawWithCli } from './drawer.js';
import { writeOffer } from './offer.js';
import { readIntent } from '../change/intent.js';
import { createRunner } from './runner.js';
import { listSkills, skillDirs } from './skills.js';
import { createAgentStore } from './store.js';
import { createTools } from './tools.js';
import { builtInProviders } from './providers/index.js';
import { collectUsage, createUsageReader } from './usage.js';
import { createUsageHistory } from './usage-history.js';
import { createBuilds } from '../build/index.js';
import { createBuildRoutes } from '../build/routes.js';
import { createBuildStore } from '../build/store.js';
import { createDriveIndex, suggestPieces } from '../build/pieces.js';
import { writeReply } from '../build/reply.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.resolve(HERE, '..', '..', 'bin', 'marble-mcp.js');
const BROWSER = path.resolve(HERE, '..', '..', 'bin', 'marble-browser-mcp.js');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const ANY_HOST = new Set(['0.0.0.0', '::']);

export function agentsAllowed(config) {
  if (!config.agents) return { ok: false, why: 'MARBLE_DRIVE_AGENTS is not set' };
  if (config.multiTenant) return { ok: false, why: 'agents are for one owner, and this host is multi-tenant' };
  if (!config.secret && !LOOPBACK_HOSTS.has(config.host)) {
    return { ok: false, why: `an ungated host on ${config.host} would let anyone who reaches it run agents on this machine` };
  }
  // The bridge calls back on loopback. A host bound to one other address
  // never hears it; one bound to every address does.
  if (!LOOPBACK_HOSTS.has(config.host) && !ANY_HOST.has(config.host)) {
    return { ok: false, why: `the agent bridge calls back on loopback, and a host bound only to ${config.host} would not answer it` };
  }
  const inside = path.relative(config.root, config.agentWorkdir);
  const outside = inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside);
  if (!outside) {
    return { ok: false, why: `MARBLE_DRIVE_AGENT_WORKDIR is inside the drive (${config.agentWorkdir}); put it where an agent's own tools find nothing` };
  }
  if (config.agentKeysFile) {
    const keysInside = path.relative(config.root, config.agentKeysFile);
    const keysOutside = keysInside === '..' || keysInside.startsWith(`..${path.sep}`) || path.isAbsolute(keysInside);
    if (!keysOutside) {
      return { ok: false, why: `MARBLE_DRIVE_AGENT_KEYS is inside the drive (${config.agentKeysFile}); put it where a backup of the drive does not take it` };
    }
  }
  return { ok: true, why: null };
}

// Locks this process holds, so a second host made in the same process (which
// shares its pid) still counts the first one's lock as held.
const heldHere = new Set();

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/** One host runs agents on a drive at a time. Booting interrupts every turn
 *  the store says is unfinished, which is only true if nobody else is running
 *  them — so the host that does it holds `host.lock`, with its pid in it. A
 *  lock whose pid is gone is a host that crashed, and is taken over. */
async function claimHost(dir) {
  const file = path.join(dir, 'host.lock');
  const mine = `${process.pid}\n${crypto.randomBytes(8).toString('hex')}\n`;
  await fsp.mkdir(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fsp.writeFile(file, mine, { flag: 'wx' });
      heldHere.add(file);
      return {
        held: null,
        async release() {
          heldHere.delete(file);
          const now = await fsp.readFile(file, 'utf8').catch(() => null);
          if (now === mine) await fsp.unlink(file).catch(() => {});
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const pid = Number.parseInt(await fsp.readFile(file, 'utf8').catch(() => ''), 10);
    const stale = !Number.isInteger(pid) || !alive(pid) || (pid === process.pid && !heldHere.has(file));
    if (!stale) return { held: pid };
    await fsp.unlink(file).catch(() => {});
  }
  return { held: null, release: null, why: 'could not take host.lock' };
}

export async function createAgents({ config, store, oplog = null, writeOps, createDocument, putDocument = null, moveDocument = null, freePath = null, origin, browserPass = null, providers, log = console, usage = null, usageHistory = null, sandbox = null, restore = null, onLook = null, forgetWriter = null, awake, progress, streams = null, onActivity = null }) {
  const dir = path.join(store.marbleDir, 'agents');
  const lock = await claimHost(dir);
  if (!lock.release) {
    const why = lock.held
      ? `another host (pid ${lock.held}) is running agents on this drive`
      : lock.why;
    throw Object.assign(new Error(why), { code: 'EAGENTSHELD' });
  }
  try {
    return await boot({ config, store, oplog, writeOps, createDocument, putDocument, moveDocument, freePath, origin, browserPass, providers, log, dir, lock, usage, usageHistory, sandbox, restore, onLook, forgetWriter, awake, progress, streams, onActivity });
  } catch (err) {
    await lock.release();
    throw err;
  }
}

async function boot({ config, store, oplog = null, writeOps, createDocument, putDocument = null, moveDocument = null, freePath = null, origin, browserPass, providers, log, dir, lock, usage, usageHistory = null, sandbox = null, restore = null, onLook = null, forgetWriter = null, awake, progress, streams = null, onActivity = null }) {
  const agentStore = createAgentStore({ dir, defaultProvider: config.agentProvider, log });
  await agentStore.ready();
  const keys = createKeyStore({ file: config.agentKeysFile });
  const liveProviders = providers ?? builtInProviders({ env: process.env, secrets: () => keys.asEnv() });
  const skills = await listSkills(skillDirs({ home: os.homedir(), root: config.root }));
  const hub = createHub();

  // A look goes two ways. Outward, to the document, it is the construction zone
  // other tabs draw around the element. Inward, to the conversation, it is how a
  // chat being read somewhere else can say where its hands are and offer to take
  // you there. Same frame, one call site, both audiences.
  //
  // Published, never appended: this is live state, not transcript. A page that
  // opens mid-turn has no zone until the next look, and a turn's end already
  // sends `ids: []`, which clears it.
  const look = (docPath, ids, client, extra = {}) => {
    onLook?.(docPath, ids, client, extra);
    const name = String(client ?? '');
    if (!name.startsWith('agent:')) return;
    hub.publish(name.slice('agent:'.length), {
      type: 'zone',
      path: docPath,
      ids: Array.isArray(ids) ? ids.map(String) : [],
      ...(extra.phase ? { phase: extra.phase } : {}),
      ...(extra.note ? { note: extra.note } : {}),
    });
  };

  // Late-bound: the runner needs the tools, and the tools need the runner's
  // messaging. `messaging` is created empty here, handed to the tools, and
  // filled in once the runner exists — see below.
  const messaging = {};
  // The same for Build mode: the build_plan tool hands its plan to the
  // builds, which need the runner to exist first.
  const building = {};
  const tools = createTools({
    store,
    writeOps,
    createDocument,
    buildStarter,
    composeAffordances: composeScript,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
    examine,
    onLook: look,
    messaging,
    building,
    log,
  });
  const projects = { find: async (id) => findProject({ settings: await agentStore.settings(), root: config.root }, id) };
  const runner = createRunner({
    store: agentStore,
    tools,
    providers: liveProviders,
    workdir: config.agentWorkdir,
    driveRoot: config.root,
    projects,
    power: config.agentPower,
    sandbox,
    origin,
    bridgePath: BRIDGE,
    browserPath: BROWSER,
    browserPass,
    readDocument: (docPath) => store.read(docPath),
    // The host's own clock and measure, so the stall rule and keep-awake agree
    // on what "awake" and "progress" mean. Undefined falls to the runner's own.
    awake,
    progress,
    // Every event a turn publishes is a sign of work, and the host's keep-awake
    // looks at once rather than at its next check (server/keep-awake.js).
    publish: (...args) => {
      hub.publish(...args);
      onActivity?.();
      // A build is a turn: Build mode hears it end (server/build).
      building.onEvent?.(args[0], args[1]);
    },
    publishAsk: hub.publishAsk,
    limits: {
      maxRunning: config.agentMaxRunning,
      stallMs: config.agentStallMinutes * 60_000,
      maxMs: config.agentMaxMinutes * 60_000,
      killGraceMs: 3_000,
      // A result stands for half a second before the runner acts on it, and a
      // minute while the CLI still has background work of its own in flight.
      settleMs: 500,
      backgroundSettleMs: 60_000,
    },
    log,
    skills,
    onLook: look,
    // Who names a new chat once its first turn is over. Null switches naming
    // off entirely — a host running fabricated providers should not be
    // spawning a real CLI to write labels.
    // Naming always runs on the login, never on a key: pickEnv hands the CLI
    // the same bare environment a subscription turn gets, so a label can
    // never be billed to somebody's API account.
    nameConversation: config.agentNaming
      ? (input) => nameConversation({ ...input, model: config.agentNamingModel })
      : null,
    // Who draws a turn's progress widget: a small model on the login, told
    // how by the drawing-progress skill. Null switches it off, and the card
    // keeps its own views.
    drawProgress: config.agentDrawing
      ? (input) => drawWithCli({ ...input, model: config.agentDrawingModel, log })
      : null,
    // A turn's ops were filed as `agent:<id>` and its undo as `agent-undo:<id>`;
    // both are that conversation, and both are done when the turn is.
    onFinish: (conversationId) => {
      forgetWriter?.(`agent:${conversationId}`);
      forgetWriter?.(`agent-undo:${conversationId}`);
    },
  });

  // Three functions by name, not the runner itself, so tools stay testable
  // with a stub. Bound before boot, because boot may start delivery turns
  // whose agents call these tools immediately.
  Object.assign(messaging, {
    peers: (turn) => runner.peers(turn),
    deliver: (turn, input) => runner.deliver(turn, input),
    wait: (turn, seconds) => runner.wait(turn, seconds),
  });

  await runner.boot();

  const routes = createAgentRoutes({
    store: agentStore,
    runner,
    tools,
    hub,
    providers: liveProviders,
    writeOps,
    restore,
    maxBody: config.maxBodyBytes,
    gated: Boolean(config.secret),
    keys,
    anthropicBase: config.anthropicBase,
    openaiBase: config.openaiBase,
    skills,
    // Not a plain 60 s cache: the usage API rate-limits, and retrying on that
    // cadence keeps the limit tripped while the sliders read Unavailable. The
    // reader backs off and keeps serving the last good reading, on disk so a
    // restart mid-limit still has numbers.
    usage: usage ?? createUsageReader({
      collect: () => collectUsage(),
      file: path.join(store.marbleDir, 'usage-last.json'),
    }),
    usageHistory: usageHistory ?? createUsageHistory(),
    root: config.root,
    streams,
    // The callout's suggestions for one element, on the same terms as
    // naming: the login's small model, and off where naming is off.
    offer: config.agentNaming ? (input) => writeOffer({ ...input, model: config.agentNamingModel }) : null,
    // A few words about the look of the page, as one rule (change-line.js),
    // on the same terms: the login's small model, off where naming is off.
    intent: config.agentNaming ? (input) => readIntent({ ...input, model: config.agentNamingModel }) : null,
    readSource: (docPath) => store.read(docPath),
    onLook: look,
    log,
  });

  // Build mode (server/build): an app's marks, builds and pieces.
  const builds = createBuilds({
    buildStore: createBuildStore({ dir: path.join(store.marbleDir, 'builds') }),
    store,
    oplog,
    runner,
    agentStore,
    hub,
    startConversation: (body) => routes.startConversation(body),
    defaultProvider: () => routes.defaultProvider(),
    putDocument: putDocument ?? ((docPath, source, options) => createDocument(docPath, source, options)),
    moveDocument,
    freePath,
    // A comment is answered by the quick model, or by the one chosen on the
    // note it was sent from.
    reply: config.agentNaming ? (input) => writeReply({ ...input, model: /claude|opus|sonnet|haiku|fable/i.test(input.model ?? '') ? input.model : config.agentNamingModel, log }) : null,
    suggest: config.agentNaming ? (input) => suggestPieces({ ...input, model: config.agentNamingModel, log }) : null,
    driveRegions: createDriveIndex({ store }),
    log,
  });
  await builds.boot();
  Object.assign(building, {
    plan: (turn, input) => builds.plan(turn, input),
    onEvent: (conversationId, event) => {
      builds.onEvent(conversationId, event).catch((err) => log.error(`[builds] ${err.message}`));
    },
  });
  routes.useBuilds(createBuildRoutes({ builds, hub, maxBody: config.maxBodyBytes }));

  return {
    handle: routes.handle,
    startRun: routes.startRun,
    handleTools: routes.handleTools,
    watchdog: (docPath, sha) => runner.watchdog(docPath, sha),
    documentTouched: (docPath, sha) => runner.documentTouched(docPath, sha),
    running: () => runner.running(),
    store: agentStore,
    runner,
    hub,
    /** A document moved (server/app.js): the conversations aimed at it aim
     *  where it went, so the next turn writes to the document and not to its
     *  old address. `at` maps an old path to its new one, or null. */
    builds,
    async followMove(at) {
      await builds.move(at).catch((err) => log.error(`[builds] ${err.message}`));
      for (const summary of [...await agentStore.conversations(), ...await agentStore.conversations({ archived: true })]) {
        const next = at(summary.target);
        if (!next) continue;
        await agentStore.updateConversation(summary.id, { target: next });
        hub.publish(summary.id, { type: 'meta' }, await agentStore.summary(summary.id));
      }
    },
    async close() {
      await runner.close();
      hub.close();
      await lock.release();
    },
  };
}
