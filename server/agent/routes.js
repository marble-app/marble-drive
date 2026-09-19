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

import crypto from 'node:crypto';

import { json, readJson, send } from '../http.js';
import { parsePath } from '../paths.js';
import { sameOrigin } from '../sessions.js';
import { driveWhere, pickCursorPickerModels, sortProviders } from './catalog.js';
import { findProject, listProjects, validateProjectPath } from './projects.js';
import { summarize } from './store.js';
import { normalizeUndo, undoTurn } from './undo.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORWARDED = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host'];
const DETECT_TIMEOUT = 5_000;
const DETECT_CACHE = 60_000;

const LEAD_TYPES = new Set(['text', 'tool.call']);
/** The last two things the agent said or did before it asked. Mirrors
 *  runtime/agent-phone.js askLead: the page has that copy, the route this one,
 *  because the page's helpers are browser scripts and this is a module. */
const askLead = (events, askSeq) => events
  .filter((event) => event.seq < askSeq && LEAD_TYPES.has(event.type))
  .slice(-2)
  .map((event) => (event.type === 'text'
    ? { type: 'text', text: String(event.text ?? '') }
    : { type: 'tool.call', name: event.name, input: event.input ?? {} }));

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
const TURN = /^\/agent\/turns\/([0-9a-f]{12}-t\d+)(\/cancel|\/undo|\/answer)?$/;
const DISPATCH = new Set(['queue', 'steer', 'interrupt']);
const FOLDER = /^\/agent\/folders\/([0-9a-f]{12})$/;
const UPLOAD = /^\/agent\/uploads\/([0-9a-f]{16}\.(?:png|jpg|gif|webp))$/;
const PROJECT = /^\/agent\/projects\/([0-9a-f]{12}|drive)$/;
const TOOL = /^\/agent\/tools\/([a-z_]+)$/;

const publicWindow = (window) => ({
  id: String(window?.id ?? ''),
  label: String(window?.label ?? ''),
  used: Number(window?.used) || 0,
  left: Number(window?.left) || 0,
  resetsAt: window?.resetsAt ?? null,
  kind: window?.kind === 'share' ? 'share' : 'quota',
});

const publicMeter = (meter) => {
  const out = {
    id: String(meter?.id ?? ''),
    label: String(meter?.label ?? ''),
    used: Number(meter?.used) || 0,
    left: Number(meter?.left) || 0,
    window: meter?.window == null ? '' : String(meter.window),
    resetsAt: meter?.resetsAt ?? null,
    detail: String(meter?.detail ?? ''),
  };
  if (Array.isArray(meter?.windows) && meter.windows.length) {
    out.windows = meter.windows.map(publicWindow).filter((item) => item.id);
  }
  return out;
};

export function createAgentRoutes({ store, runner, tools, hub, providers, writeOps, restore, maxBody, gated = false, keys = null, skills = [], usage = null, usageHistory = null, root = null }) {
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
        const listed = typeof provider.listModels === 'function'
          ? await provider.listModels().catch(() => [])
          : Array.isArray(provider.models) ? provider.models : [];
        let models = typeof provider.groupModels === 'function' ? provider.groupModels(listed) : listed;
        if (provider.id === 'cursor') models = pickCursorPickerModels(models);
        const efforts = Array.isArray(provider.efforts) ? provider.efforts : [];
        const modes = Array.isArray(provider.modes) ? provider.modes : [];
        return { id: provider.id, label: provider.label, defaultModel: provider.defaultModel ?? null, models, efforts, modes, ...found };
      }),
    );
    detected = { at: Date.now(), list: sortProviders(list) };
    return detected.list;
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
      // What the CLI itself reported last time it ran beats a directory scan.
      const provider = url.searchParams.get('provider');
      const recorded = provider ? (await store.settings()).skills?.[provider] : null;
      if (Array.isArray(recorded) && recorded.length) return json(res, 200, recorded);
      const list = typeof skills === 'function' ? await skills() : skills;
      return json(res, 200, list.map(({ id, name, description }) => ({ id, name: name ?? id, description: description ?? '' })));
    }

    if (route === '/agent/workspace' && method === 'GET') {
      if (!root) return json(res, 200, { path: '', branch: null });
      try {
        return json(res, 200, await driveWhere(root));
      } catch {
        return json(res, 200, { path: String(root), branch: null });
      }
    }

    if (route === '/agent/usage' && method === 'GET') {
      if (typeof usage !== 'function') return json(res, 200, { meters: [] });
      try {
        const body = await usage();
        const meters = Array.isArray(body?.meters) ? body.meters.map(publicMeter).filter((meter) => meter.id) : [];
        return json(res, 200, { meters });
      } catch {
        return json(res, 200, { meters: [] });
      }
    }

    if (route === '/agent/asks' && method === 'GET') {
      const open = runner.openAsks();
      const asks = await Promise.all(open.map(async (ask) => {
        const [events, meta] = await Promise.all([store.events(ask.conversation), store.conversation(ask.conversation)]);
        const stored = events.find((e) => e.type === 'ask' && e.requestId === ask.requestId);
        return {
          ...ask,
          lead: stored ? askLead(events, stored.seq) : [],
          title: meta?.title ?? '',
          target: meta?.target ?? '',
        };
      }));
      return json(res, 200, { asks });
    }

    if (route === '/agent/usage/history' && method === 'GET') {
      const weeks = Number(url.searchParams.get('weeks'));
      try {
        if (typeof usageHistory !== 'function') throw new Error('no history');
        return json(res, 200, await usageHistory({ weeks: url.searchParams.get('weeks') && Number.isFinite(weeks) ? weeks : undefined }));
      } catch {
        return json(res, 200, { source: null, tz: null, from: null, to: null, days: [] });
      }
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

    // An image pasted or dropped into a composer. It becomes a file because
    // that is the only thing every provider can look at — each one is a CLI
    // reading the disk — and the turn carries its path, not its bytes.
    if (route === '/agent/uploads' && method === 'POST') {
      const body = await readJson(req, maxBody);
      try {
        const saved = await store.saveUpload({ type: body.type, data: body.data, name: body.name });
        return json(res, 201, { ...saved, url: `/agent/uploads/${saved.file}` });
      } catch (err) {
        if (err.status === 400) return json(res, 400, { error: err.message });
        throw err;
      }
    }
    const uploaded = UPLOAD.exec(route);
    if (uploaded && method === 'GET') {
      const found = await store.readUpload(uploaded[1]);
      if (!found) return json(res, 404, { error: 'no such upload' });
      return send(res, 200, found.bytes, { 'Content-Type': found.type });
    }

    if (route === '/agent/projects') {
      if (method === 'GET') return json(res, 200, listProjects({ settings: await store.settings(), root }));
      if (method === 'POST') {
        const body = await readJson(req, maxBody);
        let resolved;
        try {
          resolved = await validateProjectPath(body.path, { root });
        } catch (err) {
          if (err.status === 400) return json(res, 400, { error: err.message });
          throw err;
        }
        const settings = await store.settings();
        const existing = (settings.projects ?? []).find((p) => p.path === resolved);
        if (existing) return json(res, 200, { ...existing, builtIn: false });
        const project = {
          id: crypto.randomBytes(6).toString('hex'),
          name: String(body.name ?? '').trim().slice(0, 80) || resolved.split('/').filter(Boolean).pop(),
          path: resolved,
        };
        await store.saveSettings({ projects: [...(settings.projects ?? []), project] });
        return json(res, 201, { ...project, builtIn: false });
      }
    }
    const projectRoute = PROJECT.exec(route);
    if (projectRoute && method === 'DELETE') {
      const id = projectRoute[1];
      if (id === 'drive') return json(res, 400, { error: 'the drive is always a project' });
      const settings = await store.settings();
      if (!(settings.projects ?? []).some((p) => p.id === id)) return json(res, 404, { error: `no project "${id}"` });
      await store.saveSettings({ projects: settings.projects.filter((p) => p.id !== id) });
      return json(res, 200, { removed: true });
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
        const settings = await store.settings();
        const { models, efforts } = settings;
        const projectId = typeof body.project === 'string' && body.project.trim() ? body.project.trim() : settings.defaultProject || 'drive';
        const project = findProject({ settings, root }, projectId);
        if (!project) return json(res, 400, { error: `no project "${projectId}"` });
        const meta = await store.createConversation({
          provider: body.provider,
          model: body.model ?? models[body.provider] ?? null,
          effort: body.effort ?? efforts?.[body.provider] ?? null,
          mode: typeof body.mode === 'string' && body.mode.trim() ? body.mode.trim() : null,
          handoffFrom: from?.id ?? null,
          project: project.id,
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
        if (body.dispatch !== undefined && !DISPATCH.has(body.dispatch)) {
          return json(res, 400, { error: 'dispatch must be queue, steer, or interrupt' });
        }
        const context = {
          viewing: body.context.viewing ? parsePath(String(body.context.viewing)) : null,
          target: parsePath(String(body.context.target), { allowRoot: false }),
          selection: Array.isArray(body.context.selection) ? body.context.selection.map(String) : [],
          also: Array.isArray(body.context.also)
            ? [...new Set(body.context.also.map((item) => {
              try {
                return parsePath(String(item), { allowRoot: false });
              } catch {
                return '';
              }
            }).filter(Boolean))]
            : [],
        };
        return json(res, 202, await runner.send(id, {
          prompt: String(body.prompt ?? ''),
          context,
          dispatch: body.dispatch,
        }));
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
        if (typeof body.mode === 'string') patch.mode = body.mode.trim() || null;
        if (typeof body.provider === 'string') {
          const next = body.provider.trim();
          if (!providers.has(next)) return json(res, 400, { error: `no provider "${next}"` });
          if (next !== meta.provider) {
            patch.provider = next;
            patch.providerSession = null;
          }
        }
        if ('folderId' in body) {
          if (body.folderId === null) {
            patch.folderId = null;
          } else if (typeof body.folderId === 'string' && /^[0-9a-f]{12}$/.test(body.folderId)) {
            const { folders } = await store.listFolders();
            if (!folders.some((folder) => folder.id === body.folderId)) {
              return json(res, 400, { error: `no folder "${body.folderId}"` });
            }
            patch.folderId = body.folderId;
          } else {
            return json(res, 400, { error: 'folderId must be null or a folder id' });
          }
        }
        if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
        if ('focusX' in body) {
          if (body.focusX !== null && typeof body.focusX !== 'number') {
            return json(res, 400, { error: 'focusX must be a number or null' });
          }
          patch.focusX = body.focusX;
        }
        if ('focusY' in body) {
          if (body.focusY !== null && typeof body.focusY !== 'number') {
            return json(res, 400, { error: 'focusY must be a number or null' });
          }
          patch.focusY = body.focusY;
        }
        if (typeof body.queueCombine === 'boolean') patch.queueCombine = body.queueCombine;
        await store.updateConversation(id, patch);
        if (body.queueCombine === true) await runner.kick(id);
        const next = await store.summary(id);
        hub.publish(id, { type: 'meta', queueCombine: (await store.conversation(id)).queueCombine }, next);
        return json(res, 200, next);
      }
    }

    const turnRoute = TURN.exec(route);
    if (turnRoute) {
      const [, turnId, action] = turnRoute;
      if (!action && method === 'PATCH') {
        const body = await readJson(req, maxBody);
        const turn = await store.turn(turnId);
        if (!turn) return json(res, 404, { error: `no turn "${turnId}"` });
        try {
          return json(res, 200, await runner.patchQueued(turnId, body));
        } catch (err) {
          return json(res, err.status ?? 500, { error: err.message });
        }
      }
      if (!action && method === 'DELETE') return json(res, 200, { removed: await runner.dequeue(turnId) });
      if (action === '/cancel' && method === 'POST') return json(res, 200, { cancelled: await runner.cancel(turnId) });
      if (action === '/answer' && method === 'POST') {
        const body = await readJson(req, maxBody);
        if (typeof body.requestId !== 'string' || !body.requestId) return json(res, 400, { error: 'requestId is required' });
        if (!body.response || typeof body.response !== 'object') return json(res, 400, { error: 'response is required' });
        try {
          await runner.answer(turnId, body.requestId, body.response);
          return json(res, 200, { answered: true });
        } catch (err) {
          if (err.status) return json(res, err.status, { error: err.message });
          throw err;
        }
      }
      if (action === '/undo' && method === 'POST') {
        const turn = await store.turn(turnId);
        if (!turn) return json(res, 404, { error: `no turn "${turnId}"` });
        if (turn.status === 'queued' || turn.status === 'running') return json(res, 409, { error: 'the turn is still running' });
        if (turn.status === 'removed') return json(res, 409, { error: 'this turn was removed before it ran' });
        if (turn.undoneAt) return json(res, 409, { error: 'this turn was already undone' });
        if (undoing.has(turnId)) return json(res, 409, { error: 'this turn is being undone' });
        undoing.add(turnId);
        try {
          const saved = normalizeUndo(await store.undoRecords(turnId));
          const result = await undoTurn({
            records: saved.steps,
            restores: saved.restores,
            writeOps,
            restore,
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

    if (route === '/agent/folders') {
      if (method === 'GET') return json(res, 200, await store.listFolders());
      if (method === 'POST') {
        const body = await readJson(req, maxBody);
        const conversationIds = Array.isArray(body.conversationIds) ? body.conversationIds.map(String) : [];
        try {
          const folder = await store.createFolder({
            conversationIds,
            name: body.name,
            color: body.color,
          });
          hub.publishFolders(await store.listFolders());
          for (const cid of conversationIds) {
            hub.publish(cid, { type: 'meta' }, await store.summary(cid));
          }
          return json(res, 201, folder);
        } catch (err) {
          if (err.status === 404) return json(res, 404, { error: err.message });
          throw err;
        }
      }
    }

    if (route === '/agent/folders/working-set' && method === 'PUT') {
      const body = await readJson(req, maxBody);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      return json(res, 200, await store.setWorkingSet(ids));
    }

    const folderRoute = FOLDER.exec(route);
    if (folderRoute) {
      const [, folderId] = folderRoute;
      if (method === 'PATCH') {
        const body = await readJson(req, maxBody);
        const patch = {};
        if (typeof body.name === 'string') patch.name = body.name;
        if (typeof body.color === 'string') patch.color = body.color;
        if (Number.isInteger(body.order)) patch.order = body.order;
        if (Array.isArray(body.openIds)) patch.openIds = body.openIds.map(String);
        try {
          const updated = await store.updateFolder(folderId, patch);
          hub.publishFolders(await store.listFolders());
          return json(res, 200, updated);
        } catch (err) {
          if (err.status === 404) return json(res, 404, { error: err.message });
          throw err;
        }
      }
      if (method === 'DELETE') {
        try {
          const { freed = [] } = await store.deleteFolder(folderId);
          hub.publishFolders(await store.listFolders());
          for (const cid of freed) hub.publish(cid, { type: 'meta' }, await store.summary(cid));
          return json(res, 200, { removed: true });
        } catch (err) {
          if (err.status === 404) return json(res, 404, { error: err.message });
          throw err;
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
