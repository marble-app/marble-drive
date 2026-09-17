// Everything agents need, put together for the host. `app.js` asks two
// questions of this file — may agents run here, and what handles their routes —
// and nothing else in the host knows how any of it works.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { enginePath } from '../engine.js';
import { build as buildStarter } from '../gallery.js';
import { createHub } from './hub.js';
import { createAgentRoutes } from './routes.js';
import { createRunner } from './runner.js';
import { createAgentStore } from './store.js';
import { createTools } from './tools.js';

const BRIDGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'marble-mcp.js');
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function agentsAllowed(config) {
  if (!config.agents) return { ok: false, why: 'MARBLE_DRIVE_AGENTS is not set' };
  if (config.multiTenant) return { ok: false, why: 'agents are for one owner, and this host is multi-tenant' };
  if (!config.secret && !LOOPBACK_HOSTS.has(config.host)) {
    return { ok: false, why: `an ungated host on ${config.host} would let anyone who reaches it run agents on this machine` };
  }
  const inside = path.relative(config.root, config.agentWorkdir);
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    return { ok: false, why: `MARBLE_DRIVE_AGENT_WORKDIR is inside the drive (${config.agentWorkdir}); put it where an agent's own tools find nothing` };
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

export async function createAgents({ config, store, writeOps, createDocument, origin, providers, log = console }) {
  const dir = path.join(store.marbleDir, 'agents');
  const lock = await claimHost(dir);
  if (!lock.release) {
    const why = lock.held
      ? `another host (pid ${lock.held}) is running agents on this drive`
      : lock.why;
    throw Object.assign(new Error(why), { code: 'EAGENTSHELD' });
  }
  try {
    return await boot({ config, store, writeOps, createDocument, origin, providers, log, dir, lock });
  } catch (err) {
    await lock.release();
    throw err;
  }
}

async function boot({ config, store, writeOps, createDocument, origin, providers, log, dir, lock }) {
  const agentStore = createAgentStore({ dir, defaultProvider: config.agentProvider, log });
  await agentStore.ready();
  const settings = await agentStore.settings();
  const hub = createHub();
  const tools = createTools({
    store,
    writeOps,
    createDocument,
    buildStarter,
    guidePath: enginePath('skills/build-in-marble/SKILL.md'),
  });
  const runner = createRunner({
    store: agentStore,
    tools,
    providers,
    workdir: config.agentWorkdir,
    origin,
    bridgePath: BRIDGE,
    readDocument: (docPath) => store.read(docPath),
    publish: hub.publish,
    limits: {
      maxRunning: settings.maxRunning,
      stallMs: config.agentStallMinutes * 60_000,
      maxMs: config.agentMaxMinutes * 60_000,
      killGraceMs: 3_000,
    },
    log,
  });
  await runner.boot();

  const routes = createAgentRoutes({ store: agentStore, runner, tools, hub, providers, writeOps, maxBody: config.maxBodyBytes });

  return {
    handle: routes.handle,
    handleTools: routes.handleTools,
    watchdog: (docPath, sha) => runner.watchdog(docPath, sha),
    store: agentStore,
    runner,
    async close() {
      await runner.close();
      hub.close();
      await lock.release();
    },
  };
}
