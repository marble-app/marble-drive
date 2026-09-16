// Everything agents need, put together for the host. `app.js` asks two
// questions of this file — may agents run here, and what handles their routes —
// and nothing else in the host knows how any of it works.

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

export async function createAgents({ config, store, writeOps, createDocument, origin, providers, log = console }) {
  const agentStore = createAgentStore({ dir: path.join(store.marbleDir, 'agents'), defaultProvider: config.agentProvider });
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
    },
  };
}
