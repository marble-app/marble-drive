// The agent surface over HTTP. Two doors with different locks:
//
//   - `/agent/tools/*` is for the MCP bridge a turn's process started. It
//     answers only this machine, and only the token of a turn that is running
//     right now. It sits in front of the gate, because the bridge has the
//     turn's token and not the drive's secret — which is the point.
//     "This machine" means a loopback socket with no proxy in front of it:
//     behind Tailscale Serve every peer arrives from 127.0.0.1, and only the
//     forwarding headers tell them apart.
//   - everything else is for the person, behind the gate like every other
//     route, and a change also has to come from this origin. A host with no
//     gate also has to be addressed as itself — localhost — or a page on any
//     name that rebinds to 127.0.0.1 would count as this origin too.

import { json, readJson } from '../http.js';
import { parsePath } from '../paths.js';
import { sameOrigin } from '../sessions.js';
import { summarize } from './store.js';
import { undoTurn } from './undo.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORWARDED = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host'];
const DETECT_TIMEOUT = 5_000;
const DETECT_CACHE = 60_000;

export const isLoopback = (req) => LOOPBACK.has(req.socket?.remoteAddress);
export const isProxied = (req) => FORWARDED.some((name) => req.headers[name] !== undefined);

/** The Host header's name, without its port. */
const hostnameOf = (req) => {
  try {
    return new URL(`http://${req.headers.host ?? ''}`).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
const CONVERSATION = /^\/agent\/conversations\/([0-9a-f]{12})(\/turns)?$/;
const TURN = /^\/agent\/turns\/([0-9a-f]{12}-t\d+)(\/cancel|\/undo)?$/;
const TOOL = /^\/agent\/tools\/([a-z_]+)$/;

export function createAgentRoutes({ store, runner, tools, hub, providers, writeOps, maxBody, gated = false, keys = null, skills = [] }) {
  let detected = null;
  // Turns being undone right now. The undoneAt check alone lets two requests
  // that arrive together both pass it before either has written.
  const undoing = new Set();

  const publicSettings = async () => ({
    ...(await store.settings()),
    keys: keys ? await keys.flags() : { anthropic: false, cursor: false },
  });

  async function detectAll() {
    if (detected && Date.now() - detected.at < DETECT_CACHE) return detected.list;
    const list = await Promise.all(
      [...providers.values()].map(async (provider) => {
        const timeout = new Promise((resolve) =>
          setTimeout(() => resolve({ installed: false, signedIn: false, detail: 'detection timed out' }), DETECT_TIMEOUT).unref?.(),
        );
        const found = await Promise.race([provider.detect().catch((err) => ({ installed: false, signedIn: false, detail: err.message })), timeout]);
        const models = typeof provider.listModels === 'function'
          ? await provider.listModels().catch(() => [])
          : Array.isArray(provider.models) ? provider.models : [];
        const efforts = Array.isArray(provider.efforts) ? provider.efforts : [];
        return { id: provider.id, label: provider.label, defaultModel: provider.defaultModel ?? null, models, efforts, ...found };
      }),
    );
    detected = { at: Date.now(), list };
    return list;
  }

  async function handleTools(req, res, url) {
    if (!isLoopback(req) || isProxied(req)) return json(res, 403, { error: 'agent tools answer only on this machine' });
    const token = bearer(req);
    if (!runner.turnForToken(token)) return json(res, 401, { error: 'no running turn holds that token' });

    if (url.pathname === '/agent/tools' && req.method === 'GET') return json(res, 200, { tools: tools.schemas });
    const match = TOOL.exec(url.pathname);
    if (match && req.method === 'POST') {
      const body = await readJson(req, maxBody);
      const result = await runner.callTool(token, match[1], body.arguments ?? {});
      return json(res, 200, result ?? { error: 'the turn ended' });
    }
    return json(res, 404, { error: 'not found' });
  }

  async function publishSummary(conversationId, event) {
    hub.publish(conversationId, event, await store.summary(conversationId));
  }

  /** Replay a conversation's transcript, then follow it live, with no event
   *  lost or repeated at the seam. Subscribing first means anything published
   *  while the transcript is read is held rather than missed; an event both
   *  read and then published (appended just before the read, published just
   *  after) is recognised by its seq and sent once. A reconnecting
   *  EventSource says where it got to in `Last-Event-ID`. */
  async function streamConversation(req, res, id, url) {
    const resumeFrom = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
    let last = Number.isFinite(resumeFrom) ? resumeFrom : 0;
    let held = [];
    const seqOf = (payload) => Number(/^id: (\d+)$/m.exec(payload)?.[1] ?? NaN);
    const pass = (payload) => {
      const seq = seqOf(payload);
      if (Number.isFinite(seq)) {
        if (seq <= last) return;
        last = seq;
      }
      res.write(payload);
    };
    const listener = {
      write(payload) {
        if (held) held.push(payload);
        else pass(payload);
      },
    };
    const off = hub.subscribe(id, listener);
    res.on('close', off);

    const replay = await store.events(id, { after: last });
    if (res.destroyed || res.writableEnded) return off();
    for (const event of replay) pass(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    const pending = held;
    held = null;
    for (const payload of pending) pass(payload);
    return undefined;
  }

  async function handle(req, res, url) {
    const route = url.pathname;
    const method = req.method;
    if (!gated && !LOCAL_NAMES.has(hostnameOf(req))) {
      return json(res, 403, { error: 'an ungated drive answers agent routes only as localhost' });
    }
    if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'a change has to come from this drive' });

    if (route === '/agent/providers' && method === 'GET') {
      const { defaultProvider } = await store.settings();
      return json(res, 200, (await detectAll()).map((p) => ({ ...p, default: p.id === defaultProvider })));
    }

    if (route === '/agent/skills' && method === 'GET') {
      const list = typeof skills === 'function' ? await skills() : skills;
      return json(res, 200, list.map(({ id, name, description }) => ({ id, name: name ?? id, description: description ?? '' })));
    }

    if (route === '/agent/settings') {
      if (method === 'GET') return json(res, 200, await publicSettings());
      if (method === 'PUT') {
        const body = await readJson(req, maxBody);
        const patch = {};
        if (typeof body.defaultProvider === 'string') patch.defaultProvider = body.defaultProvider;
        if (body.models && typeof body.models === 'object') {
          const models = { ...(await store.settings()).models };
          for (const [id, model] of Object.entries(body.models)) {
            if (typeof model !== 'string' || !model.trim()) delete models[id];
            else models[id] = model.trim();
          }
          patch.models = models;
        }
        if (body.efforts && typeof body.efforts === 'object') {
          const efforts = { ...(await store.settings()).efforts };
          for (const [id, effort] of Object.entries(body.efforts)) {
            if (typeof effort !== 'string' || !effort.trim()) delete efforts[id];
            else efforts[id] = effort.trim();
          }
          patch.efforts = efforts;
        }
        // Read when the host starts; a change applies after a restart.
        if (Number.isInteger(body.maxRunning) && body.maxRunning > 0) patch.maxRunning = body.maxRunning;
        if (Object.keys(patch).length) await store.saveSettings(patch);
        if (keys && body.keys && typeof body.keys === 'object') {
          await keys.write(body.keys);
          detected = null;
        }
        return json(res, 200, await publicSettings());
      }
    }

    if (route === '/agent/conversations') {
      if (method === 'GET') {
        return json(res, 200, await store.conversations({ archived: url.searchParams.get('archived') === '1' }));
      }
      if (method === 'POST') {
        const body = await readJson(req, maxBody);
        if (!providers.has(body.provider)) return json(res, 400, { error: `no provider "${body.provider}"` });
        const from = body.handoffFrom ? await store.conversation(body.handoffFrom) : null;
        if (body.handoffFrom && !from) return json(res, 404, { error: `no conversation "${body.handoffFrom}"` });
        const { models, efforts } = await store.settings();
        const meta = await store.createConversation({
          provider: body.provider,
          model: body.model ?? models[body.provider] ?? null,
          effort: body.effort ?? efforts?.[body.provider] ?? null,
          handoffFrom: from?.id ?? null,
        });
        if (from) {
          await store.updateConversation(from.id, { handoffTo: meta.id });
          await publishSummary(from.id, await store.appendEvent(from.id, { type: 'handoff', to: meta.id, provider: meta.provider }));
          await publishSummary(meta.id, await store.appendEvent(meta.id, { type: 'handoff', from: from.id, provider: from.provider }));
        }
        return json(res, 201, summarize(await store.conversation(meta.id)));
      }
    }

    const conversation = CONVERSATION.exec(route);
    if (conversation) {
      const [, id, turns] = conversation;
      const meta = await store.conversation(id);
      if (!meta) return json(res, 404, { error: `no conversation "${id}"` });

      if (turns && method === 'POST') {
        const body = await readJson(req, maxBody);
        if (!body.context?.target) return json(res, 400, { error: 'a turn needs context.target' });
        const context = {
          viewing: body.context.viewing ? parsePath(String(body.context.viewing)) : null,
          target: parsePath(String(body.context.target), { allowRoot: false }),
          selection: Array.isArray(body.context.selection) ? body.context.selection.map(String) : [],
        };
        return json(res, 202, await runner.send(id, { prompt: String(body.prompt ?? ''), context }));
      }
      if (!turns && method === 'GET') {
        return json(res, 200, {
          meta: await store.summary(id),
          turns: await store.turns(id),
          events: await store.events(id, { after: Number(url.searchParams.get('after') ?? 0) }),
        });
      }
      if (!turns && method === 'PATCH') {
        const body = await readJson(req, maxBody);
        const patch = {};
        if (typeof body.archived === 'boolean') patch.archived = body.archived;
        if (body.reviewed === true) patch.lastReviewedAt = Date.now();
        if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 120);
        if (typeof body.model === 'string') patch.model = body.model.trim() || null;
        if (typeof body.effort === 'string') patch.effort = body.effort.trim() || null;
        await store.updateConversation(id, patch);
        const next = await store.summary(id);
        hub.publish(id, { type: 'meta' }, next);
        return json(res, 200, next);
      }
    }

    const turnRoute = TURN.exec(route);
    if (turnRoute) {
      const [, turnId, action] = turnRoute;
      if (!action && method === 'DELETE') return json(res, 200, { removed: await runner.dequeue(turnId) });
      if (action === '/cancel' && method === 'POST') return json(res, 200, { cancelled: await runner.cancel(turnId) });
      if (action === '/undo' && method === 'POST') {
        const turn = await store.turn(turnId);
        if (!turn) return json(res, 404, { error: `no turn "${turnId}"` });
        if (turn.status === 'queued' || turn.status === 'running') return json(res, 409, { error: 'the turn is still running' });
        if (turn.status === 'removed') return json(res, 409, { error: 'this turn was removed before it ran' });
        if (turn.undoneAt) return json(res, 409, { error: 'this turn was already undone' });
        if (undoing.has(turnId)) return json(res, 409, { error: 'this turn is being undone' });
        undoing.add(turnId);
        try {
          const result = await undoTurn({
            records: (await store.undoRecords(turnId)) ?? [],
            writeOps,
            client: `agent-undo:${turn.conversationId}`,
          });
          await store.updateTurn(turnId, { undoneAt: Date.now() });
          await publishSummary(
            turn.conversationId,
            await store.appendEvent(turn.conversationId, { type: 'turn.undone', turn: turnId, reverted: result.reverted, kept: result.kept }),
          );
          return json(res, 200, result);
        } finally {
          undoing.delete(turnId);
        }
      }
    }

    if (route === '/agent/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      const id = url.searchParams.get('conversation');
      if (id && /^[0-9a-f]{12}$/.test(id)) {
        await streamConversation(req, res, id, url);
      } else {
        res.on('close', hub.subscribe('*', res));
      }
      return undefined;
    }

    return json(res, 404, { error: 'not found' });
  }

  return { handle, handleTools };
}
