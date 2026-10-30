// The agent surface over HTTP. Two doors with different locks:
//
//   - `/agent/tools/*` is for the MCP bridge a turn's process started. It
//     answers only this machine, and only the token of a turn that is running
//     right now. It sits in front of the gate, because the bridge has the
//     turn's token and not the drive's secret — which is the point.
//     "This machine" means a loopback socket with no proxy in front of it:
//     behind Tailscale Serve every peer arrives from 127.0.0.1, and only the
//     forwarding headers tell them apart. Loopback is all of 127/8: a drive
//     the PC hosts listens on an address of its own, and its bridge calls
//     back from there.
//   - everything else is for the person, behind the gate like every other
//     route, and a change also has to come from this origin. A host with no
//     gate also has to be addressed as itself — localhost — or a page on any
//     name that rebinds to 127.0.0.1 would count as this origin too.

import crypto from 'node:crypto';

import { conversationHasReview, listReview } from '../change/review.js';
import { sliceOf } from '../engine.js';
import { isLoopbackAddress } from '../gate.js';
import { json, readJson, send } from '../http.js';
import { parsePath } from '../paths.js';
import { sameOrigin } from '../sessions.js';
import { driveWhere, pickCursorPickerModels, sortProviders } from './catalog.js';
import { creditView } from './credit.js';
import { createClaudeSignIn } from './claude-signin.js';
import { createCodexSignIn } from './codex-signin.js';
import { PERSONAL, describeLogin, listClaudeAccounts, publicAccount, sharesSessions } from './claude-accounts.js';
import { pickEnv } from './env.js';
import { runCommand } from './providers/exec.js';
import { checkAnthropicKey, checkOpenAIKey } from './key-check.js';
import { findProject, listProjects, validateProjectPath } from './projects.js';
import { summarize } from './store.js';
import { sliceTurns } from './slice.js';
import { normalizeUndo, undoTurn } from './undo.js';
import { BRIEF_MAX } from './marble-way.js';
import { speakable } from './voice/speakable.js';
import { VOICES, VoiceError, baseType } from './voice/openai.js';
import { patchVoice, voiceSettings } from './voice/settings.js';

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

export const isLoopback = (req) => isLoopbackAddress(req.socket?.remoteAddress);
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
const FAILOVER = /^\/agent\/conversations\/([0-9a-f]{12})\/failover$/;
const USAGE_LEFT = /^\/agent\/conversations\/([0-9a-f]{12})\/usage-left$/;
const TURN = /^\/agent\/turns\/([0-9a-f]{12}-t\d+)(\/cancel|\/undo|\/redo|\/keep|\/answer|\/speech)?$/;
const DISPATCH = new Set(['queue', 'steer', 'interrupt']);
const FOLDER = /^\/agent\/folders\/([0-9a-f]{12})$/;
const UPLOAD = /^\/agent\/uploads\/([0-9a-f]{16}\.(?:png|jpg|gif|webp))$/;
const PROJECT = /^\/agent\/projects\/([0-9a-f]{12}|drive)$/;
const TOOL = /^\/agent\/tools\/([a-z_]+)$/;
const INTENTS_AT_ONCE = 2;   // words read as one rule at a time
const INTENT_BODY = 64 * 1024; // bytes a page's words and outline come in, at most
// Voice (docs/superpowers/specs/2026-10-10-voice-design.md): a clip is at most
// 4 MB, the kinds a browser records (webm on Chrome, mp4 on Safari) and two
// plain ones; a spoken reply at most 2,000 characters.
const CLIP_MAX_BYTES = 4 * 1024 * 1024;
const CLIP_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav']);
const SPOKEN_MAX_CHARS = 2000;
const TURN_ENDS = new Set(['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted']);
const KEYWORDS_MAX = 40;
const SAMPLE = 'This is how replies will sound. Talk, and I will answer like this.';
const CLIP_TOO_LONG = 'That was too long to send. Keep a clip under two minutes.';

const publicWindow = (window) => ({
  id: String(window?.id ?? ''),
  label: String(window?.label ?? ''),
  used: Number(window?.used) || 0,
  left: Number(window?.left) || 0,
  resetsAt: window?.resetsAt ?? null,
  kind: window?.kind === 'share' ? 'share' : 'quota',
});

// `available` has to survive the trip. Coercing `used` to 0 and dropping the
// flag made "the host could not read your quota" arrive at the page as a
// confident 0% used — full quota, blue bar — which is the opposite of what
// happened. A meter nobody could read carries nulls and says so.
const publicMeter = (meter) => {
  const available = meter?.available !== false && meter?.used != null && Number.isFinite(Number(meter.used));
  const out = {
    id: String(meter?.id ?? ''),
    label: String(meter?.label ?? ''),
    available,
    used: available ? Number(meter.used) : null,
    left: available ? (Number(meter?.left) || 0) : null,
    window: meter?.window == null ? '' : String(meter.window),
    resetsAt: meter?.resetsAt ?? null,
    detail: String(meter?.detail ?? ''),
  };
  if (meter?.reason) out.reason = String(meter.reason);
  // Whose limits these are, when the drive has more than one Claude login.
  if (meter?.account) {
    out.account = String(meter.account);
    out.accountLabel = String(meter.accountLabel ?? '');
  }
  // A remembered reading and the moment it was true, so the page can show the
  // number it last knew instead of nothing.
  if (meter?.stale) {
    out.stale = true;
    out.at = meter.at ?? null;
  }
  if (Array.isArray(meter?.windows) && meter.windows.length) {
    out.windows = meter.windows.map(publicWindow).filter((item) => item.id);
  }
  return out;
};

// Who a login is signed in as changes rarely, and asking spawns the CLI.
const LOGIN_TTL_MS = 10 * 60_000;

export function createAgentRoutes({ store, runner, tools, hub, providers, writeOps, restore, maxBody, gated = false, keys = null, credit = null, anthropicBase = 'https://api.anthropic.com', openaiBase = 'https://api.openai.com', skills = [], usage = null, usageHistory = null, root = null, streams = null, offer = null, intent = null, readSource = null, onLook = null, voice = null, voiceUsage = null, voiceTitles = null, voiceMaxSeconds = 120, claudeSignIn = null, codexSignIn = null, hostOwner = null, guest = false, onAgentsChanged = null, log = console }) {
  const loginCache = new Map();
  let detected = null;
  // What can run changed (a key, a sign-in, a sign-out): the next look at the
  // agents asks again, and so do the side jobs (side-model.js).
  const changed = () => {
    detected = null;
    onAgentsChanged?.();
  };
  // The person's own Claude and ChatGPT, each through its CLI's own sign-in,
  // one at a time (claude-signin.js, codex-signin.js). Made on first use.
  let signIn = claudeSignIn;
  const claudeSignInRun = () => (signIn ??= createClaudeSignIn({ log }));
  // ChatGPT's is made by `codexSignIn(options)` when given (the host's, with
  // its wait), so the routes can say what happens when its login lands.
  let chatgpt = null;
  const codexSignInRun = () => (chatgpt ??= (codexSignIn ?? createCodexSignIn)({ onSignedIn: () => codexSignedIn(), log }));
  // Turns being undone right now. The undoneAt check alone lets two requests
  // that arrive together both pass it before either has written.
  const undoing = new Set();
  // Offers already written, by element and content (POST /agent/offer).
  const offers = new Map();
  // Words being read as one rule now (POST /agent/change-intent).
  let intentsRunning = 0;
  // Build mode's routes, once the builds exist (server/agent/index.js).
  let buildRoutes = null;

  // One Claude, signed in one of three ways: the Claude login
  // (claude-subscription), an API key (claude-api), or starter credit
  // (claude-credit, only on a drive the door gave credit to). `claudeAuth`
  // says which. Until someone sets it, the drive's default agent does; and a
  // drive with credit and nothing of its own, no key and no login, is on
  // credit, so a new drive's agent works before anyone brings a key.
  const CLAUDE = { login: 'claude-subscription', api: 'claude-api', credit: 'claude-credit' };
  const hasCredit = () => providers.has(CLAUDE.credit);
  async function claudeAuth(settings) {
    const chosen = settings.claudeAuth;
    if (chosen === 'api' || chosen === 'login') return chosen;
    if (chosen === 'credit' && hasCredit()) return 'credit';
    const fallback = settings.defaultProvider === CLAUDE.api ? 'api' : 'login';
    if (!hasCredit() || chosen === 'credit') return fallback;
    if (settings.defaultProvider === CLAUDE.credit) return 'credit';
    if (keys && (await keys.flags()).anthropic) return fallback;
    if (fallback === 'login' && (await detectAll()).find((p) => p.id === CLAUDE.login)?.signedIn) return 'login';
    return 'credit';
  }
  const activeClaude = async (settings) => CLAUDE[await claudeAuth(settings)];
  const isClaude = (id) => id === CLAUDE.login || id === CLAUDE.api || id === CLAUDE.credit;
  /** This drive's starter credit, for a page: null on a drive without it. */
  async function creditState(settings, { fresh = false } = {}) {
    if (!hasCredit() || !credit?.available) return null;
    const active = (await claudeAuth(settings)) === 'credit';
    return creditView(await credit.read({ fresh }), { active });
  }
  // Codex is one agent either way: its key, when set, is what it runs on.
  const CODEX = 'codex';
  const NO_KEYS = { anthropic: false, claude: false, cursor: false, openai: false };

  /** The agent new chats start on: the saved default when it can run, else
   *  the first that can, in the picker's order. A drive that signed Codex in
   *  by its login, or put a key in Settings, would otherwise start every Run
   *  button and the day on a Claude that is not signed in. With nothing that
   *  can run, the saved choice stands. */
  async function runnableDefault(settings) {
    const active = await activeClaude(settings);
    const saved = isClaude(settings.defaultProvider) ? active : settings.defaultProvider;
    const list = await detectAll();
    if (list.find((p) => p.id === saved)?.signedIn) return saved;
    const ready = list.find((p) => p.signedIn && (!isClaude(p.id) || p.id === active));
    return ready?.id ?? saved;
  }

  const publicSettings = async () => {
    const settings = await store.settings();
    const flags = keys ? await keys.flags() : NO_KEYS;
    // Which of the person's own plans are signed in, for Settings' lines.
    const found = await detectAll();
    const codexFound = found.find((p) => p.id === CODEX);
    return {
      ...settings,
      defaultProvider: await runnableDefault(settings),
      claudeAuth: await claudeAuth(settings),
      keys: flags,
      credit: await creditState(settings),
      voice: voiceSettings(settings.voice),
      // Whether Disconnect is offered: it runs the CLI's own logout, so only
      // for a login this drive made (or a token an older Connect kept), or on
      // a drive hosted for someone else, whose CLI is only theirs. On the
      // owner's machine the CLI's login is also the terminal's.
      signOut: {
        claude: Boolean(flags.claude || guest || settings.claudeLoginHere),
        codex: Boolean(guest || settings.codexLoginHere),
      },
      logins: {
        claude: Boolean(found.find((p) => p.id === CLAUDE.login)?.signedIn),
        chatgpt: Boolean(codexFound?.signedIn && /chatgpt/i.test(String(codexFound.detail ?? ''))),
      },
    };
  };

  // Whether this drive can run an agent at all: Claude on its login or a key,
  // or Codex on the ChatGPT login or a key. A page asks once a visit and, when
  // none, offers a key field for each agent there is (runtime/agent-ui.js,
  // <marble-agent-setup>). A drive with neither agent has nothing to set up.
  const setupState = async () => {
    const settings = await store.settings();
    const hasClaude = providers.has(CLAUDE.login) || providers.has(CLAUDE.api) || hasCredit();
    const hasCodex = providers.has(CODEX);
    const flags = keys ? await keys.flags() : NO_KEYS;
    const key = Boolean(flags.anthropic);
    const openai = Boolean(flags.openai);
    // Agents this sheet does not connect (Cursor): one that runs is still an
    // agent that works, for Start here's first row and its Make it.
    const others = [...providers.keys()].filter((id) => !isClaude(id) && id !== CODEX);
    // The CLIs are only asked about when it matters: the probe runs them.
    const found = (!key && !openai && (hasClaude || hasCodex)) || others.length ? await detectAll() : [];
    const login = hasClaude && !key && providers.has(CLAUDE.login)
      ? Boolean(found.find((p) => p.id === CLAUDE.login)?.signedIn)
      : false;
    const codexFound = found.find((p) => p.id === CODEX);
    const codex = {
      installed: hasCodex && (openai || Boolean(codexFound?.installed)),
      signedIn: hasCodex && (openai || Boolean(codexFound?.signedIn)),
      key: openai,
    };
    const offers = [...(hasClaude ? ['claude'] : []), ...(codex.installed ? ['codex'] : [])];
    // Which of them sign in on their own company's page (the connect sheet's
    // Claude and ChatGPT); either can take a key instead.
    const signIns = [...(providers.has(CLAUDE.login) ? ['claude'] : []), ...(codex.installed ? ['codex'] : [])];
    // Starter credit runs Claude until it is used up; a reading that could
    // not be made is not used up.
    const onCredit = await creditState(settings);
    const creditRuns = Boolean(onCredit?.active && !onCredit.usedUp);
    const connected = Boolean((hasClaude && (key || login || creditRuns)) || codex.signedIn);
    const ready = connected || found.some((p) => others.includes(p.id) && p.signedIn);
    // `later`: someone on this drive said Not now to the first-visit popup.
    // Kept for the drive, so a new tab or another device does not ask again;
    // the popup still opens when someone asks for it (runtime/agent-ui.js).
    // `host`: whose machine the drive runs on, when that is someone else's
    // (MARBLE_HOST_OWNER on a drive hosted for a person), for "Bryan never
    // sees your password".
    return { needed: offers.length > 0 && !connected, ready, later: Boolean(settings.setupLater), login, key, claudeAuth: await claudeAuth(settings), offers, signIns, codex, host: hostOwner || null, ...(onCredit ? { credit: onCredit } : {}) };
  };

  /** The ChatGPT login landed (codex-signin.js): the next look at the agents
   *  is fresh, the first visit stops asking, and Codex becomes the agent new
   *  chats start on when the one they start on now cannot run. */
  async function codexSignedIn() {
    changed();
    const settings = await store.settings();
    const current = isClaude(settings.defaultProvider) ? await activeClaude(settings) : settings.defaultProvider;
    const runs = (await detectAll()).find((p) => p.id === current)?.signedIn;
    await store.saveSettings({ setupLater: null, codexLoginHere: new Date().toISOString(), ...(runs ? {} : { defaultProvider: CODEX }) });
  }

  /** POST /agent/setup for Codex: the key checked with OpenAI and kept, and
   *  Codex made the agent new chats start on when the one they start on now
   *  cannot run. Answers `[status, body]`. */
  async function connectCodex(key) {
    if (!providers.has(CODEX)) return [400, { error: "This drive doesn't have Codex." }];
    if (!key || /\s/.test(key)) return [400, { error: 'Paste the whole key. It starts with sk-.' }];
    if (key.startsWith('sk-ant-')) return [400, { error: "That's an Anthropic key. Choose Claude to use it." }];
    const verdict = await checkOpenAIKey(key, { baseURL: openaiBase });
    if (verdict === 'rejected') return [400, { error: "OpenAI didn't accept that key. Check that it was copied whole." }];
    // Kept even when OpenAI could not be asked, as a Claude key is.
    await keys.write({ openai: key });
    changed();
    const settings = await store.settings();
    const current = isClaude(settings.defaultProvider) ? await activeClaude(settings) : settings.defaultProvider;
    const runs = (await detectAll()).find((p) => p.id === current)?.signedIn;
    await store.saveSettings({ setupLater: null, ...(runs ? {} : { defaultProvider: CODEX }) });
    return [200, { ...(await setupState()), checked: verdict === 'ok' }];
  }

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

  /** A new conversation, as POST /agent/conversations makes one. Returns
   *  `{ summary }`, or `{ status, error }` for a request that cannot be met. */
  async function startConversation(body) {
    // Asked for Claude either way, a new conversation gets the Claude the
    // switch chose; one already started keeps the back-end it began on.
    if (isClaude(body.provider)) body.provider = await activeClaude(await store.settings());
    if (!providers.has(body.provider)) return { status: 400, error: `no provider "${body.provider}"` };
    const from = body.handoffFrom ? await store.conversation(body.handoffFrom) : null;
    if (body.handoffFrom && !from) return { status: 404, error: `no conversation "${body.handoffFrom}"` };
    const settings = await store.settings();
    const { models, efforts, modes } = settings;
    const projectId = typeof body.project === 'string' && body.project.trim() ? body.project.trim() : settings.defaultProject || 'drive';
    const project = findProject({ settings, root }, projectId);
    if (!project) return { status: 400, error: `no project "${projectId}"` };
    // A login picked by hand must be one the drive has; a handoff keeps its chat's.
    let account = typeof body.account === 'string' && body.account ? body.account : (from?.account ?? null);
    if (account && !listClaudeAccounts(settings.claudeAccounts).some((item) => item.id === account && item.present)) {
      if (body.account) return { status: 400, error: `no Claude account "${account}"` };
      account = null;
    }
    const meta = await store.createConversation({
      account,
      provider: body.provider,
      model: body.model ?? models[body.provider] ?? null,
      effort: body.effort ?? efforts?.[body.provider] ?? null,
      mode: typeof body.mode === 'string' && body.mode.trim() ? body.mode.trim() : modes?.[body.provider] ?? null,
      handoffFrom: from?.id ?? null,
      project: project.id,
      failover: body.failover === 'pause' ? 'pause' : 'auto',
    });
    if (from) {
      await store.updateConversation(from.id, { handoffTo: meta.id });
      await publishSummary(from.id, await store.appendEvent(from.id, { type: 'handoff', to: meta.id, provider: meta.provider }));
      await publishSummary(meta.id, await store.appendEvent(meta.id, { type: 'handoff', from: from.id, provider: from.provider }));
    }
    return { summary: summarize(await store.conversation(meta.id)) };
  }

  /** What the day button does, without a page: a conversation on the drive's
   *  default agent, named, and sent one prompt aimed at `target`. For work the
   *  host starts on its own (server/daily.js, server/alive.js), which may
   *  aim it at elements of the target as a selection would. */
  async function startRun({ prompt, target, title = null, project = null, selection = [], surface = null }) {
    const settings = await store.settings();
    const made = await startConversation({ provider: await runnableDefault(settings), project });
    if (made.error) throw Object.assign(new Error(made.error), { status: made.status });
    const { id } = made.summary;
    if (title) {
      await store.updateConversation(id, { title, titleAuto: false });
      hub.publish(id, { type: 'meta' }, await store.summary(id));
    }
    const turn = await runner.send(id, {
      prompt,
      context: {
        viewing: null,
        target: parsePath(target, { allowRoot: false }),
        selection: selection.map(String),
        also: [],
        // Asked rather than aimed at a document (server/connector): answered
        // the way the Chat app's questions are.
        ...(surface === 'chat' ? { surface } : {}),
      },
    });
    return { id, turn };
  }

  /** A failure of voice's, as the page shows it. */
  const voiceFailed = (res, err) => {
    if (err instanceof VoiceError) return json(res, err.status, { error: err.message });
    throw err;
  };

  /** Stream OpenAI's audio for `text` to the page. The page going away stops
   *  OpenAI's request; nothing is cached. */
  async function speakInto(res, text, chosenVoice) {
    if (!voice) return json(res, 409, { error: 'Voice needs an OpenAI key on this drive. Add one in Settings › Voice.' });
    const words = String(text).slice(0, SPOKEN_MAX_CHARS);
    const stop = new AbortController();
    const gone = () => { if (!res.writableEnded) stop.abort(); };
    res.on('close', gone);
    let response;
    try {
      response = await voice.speak({ text: words, voice: chosenVoice, signal: stop.signal });
    } catch (err) {
      res.off('close', gone);
      if (stop.signal.aborted) return undefined;
      return voiceFailed(res, err);
    }
    await voiceUsage?.add({ spokenChars: words.length });
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    try {
      for await (const chunk of response.body) {
        if (stop.signal.aborted) break;
        if (!res.write(chunk)) await new Promise((resolve) => { res.once('drain', resolve); res.once('close', resolve); });
      }
    } catch {
      // The page went, or OpenAI stopped mid-stream: what was sent is what it hears.
    } finally {
      res.off('close', gone);
      if (stop.signal.aborted) await response.body?.cancel?.().catch?.(() => {});
      res.end();
    }
    return undefined;
  }

  /** The words a turn ended on, spoken: its last reply, or that it failed,
   *  stopped, or is waiting on an OK. A turn still working has nothing to say. */
  async function speakTurn(res, turnId) {
    const turn = await store.turn(turnId);
    if (!turn) return json(res, 404, { error: `no turn "${turnId}"` });
    const asked = runner.openAsks().some((ask) => ask.turn === turnId);
    const events = (await store.events(turn.conversationId)).filter((event) => event.turn === turnId);
    // The page asks the moment it hears the turn end, which can be a breath
    // before the stored turn says so: the closing event is the answer then.
    const ending = [...events].reverse().find((event) => TURN_ENDS.has(event.type));
    const running = (turn.status === 'queued' || turn.status === 'running') && !ending;
    if (running && !asked) return json(res, 409, { error: 'the turn is still running' });
    const last = [...events].reverse().find((event) => event.type === 'text');
    const status = asked && running ? 'running' : ending ? ending.type.slice('turn.'.length) : turn.status;
    const text = status === 'failed' ? String(ending?.error ?? turn.error ?? '') : String(last?.text ?? '');
    const words = speakable(text, { status, asked: asked && running }).slice(0, SPOKEN_MAX_CHARS);
    return speakInto(res, words, voiceSettings((await store.settings()).voice).voice);
  }

  async function transcribeClip(req, res, url) {
    const type = baseType(req.headers['content-type']);
    if (!CLIP_TYPES.has(type)) return json(res, 415, { error: 'That is not a recording this drive can send.' });
    const can = voice ? voice.available() : { ok: false };
    if (!can.ok) return json(res, 409, { error: 'Voice needs an OpenAI key on this drive. Add one in Settings › Voice.' });
    // Refused on what it says it is before a byte is read, and on what it
    // turns out to be while reading: OpenAI never sees a clip over the cap.
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > CLIP_MAX_BYTES) {
      res.setHeader('Connection', 'close');
      return json(res, 413, { error: CLIP_TOO_LONG });
    }
    const stop = new AbortController();
    const gone = () => { if (!res.writableEnded) stop.abort(); };
    res.on('close', gone);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > CLIP_MAX_BYTES) {
          res.setHeader('Connection', 'close');
          return json(res, 413, { error: CLIP_TOO_LONG });
        }
        chunks.push(chunk);
      }
      if (!size) return json(res, 422, { error: "Didn't catch anything. Try again a little closer." });
      const audio = Buffer.concat(chunks);
      chunks.length = 0;
      const doc = url.searchParams.get('doc');
      const keywords = voiceTitles ? (await voiceTitles(doc).catch(() => [])).slice(0, KEYWORDS_MAX) : [];
      const { text } = await voice.transcribe({ audio, type, keywords, signal: stop.signal });
      const seconds = Math.min(Math.max(Number(url.searchParams.get('seconds')) || 0, 0), voiceMaxSeconds);
      await voiceUsage?.add({ heardSeconds: seconds });
      return json(res, 200, { text });
    } catch (err) {
      if (stop.signal.aborted || err?.name === 'AbortError') return undefined;
      return voiceFailed(res, err);
    } finally {
      res.off('close', gone);
    }
  }

  async function handle(req, res, url) {
    const route = url.pathname;
    const method = req.method;
    if (!gated && !LOCAL_NAMES.has(hostnameOf(req))) {
      return json(res, 403, { error: 'an ungated drive answers agent routes only as localhost' });
    }
    if (method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'a change has to come from this drive' });

    if (buildRoutes && (route.startsWith('/agent/builds') || route.startsWith('/agent/pieces'))) {
      const answered = await buildRoutes.handle(req, res, url);
      if (answered !== null) return answered;
    }

    if (route === '/agent/providers' && method === 'GET') {
      const settings = await store.settings();
      const active = await activeClaude(settings);
      const defaultId = isClaude(settings.defaultProvider) ? active : settings.defaultProvider;
      return json(res, 200, (await detectAll())
        .filter((p) => !isClaude(p.id) || p.id === active)
        .map((p) => ({ ...p, default: p.id === defaultId })));
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

    // The Claude logins this drive runs on: who each is signed in as, which
    // folders use it without being asked, and its limits. A drive hosted for
    // someone else has only its one login, and is not asked about it here.
    if (route === '/agent/accounts' && method === 'GET') {
      const settings = (await store.settings?.().catch(() => null)) ?? {};
      const accounts = listClaudeAccounts(guest ? [] : settings.claudeAccounts);
      let meters = [];
      if (!guest && typeof usage === 'function') {
        try {
          meters = ((await usage())?.meters ?? []).map(publicMeter);
        } catch { /* no limits to show */ }
      }
      const now = Date.now();
      const out = await Promise.all(accounts.map(async (account) => {
        let who = loginCache.get(account.id);
        if (!guest && (!who || now - who.at > LOGIN_TTL_MS)) {
          const value = await describeLogin(account, { exec: runCommand, env: pickEnv(process.env) });
          // A check that could not be made is asked again next time, and the
          // last answer that could be made stands in for it meanwhile.
          if (value.signedIn !== null) {
            who = { at: now, value };
            loginCache.set(account.id, who);
          } else if (!who) {
            who = { at: 0, value };
          }
        }
        const meter = account.id === PERSONAL
          ? meters.find((item) => item.id === 'claude-subscription') ?? null
          : meters.find((item) => item.account === account.id) ?? null;
        return { ...publicAccount(account), ...(who?.value ?? {}), meter };
      }));
      return json(res, 200, { accounts: out });
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

    // What a turn of an agent's still stands to be reviewed, for one
    // document: each turn that touched it, newest first, with the parts of
    // it that are still there to Keep, Undo or Redo.
    if (route === '/agent/review' && method === 'GET') {
      const docPath = url.searchParams.get('path') ?? '';
      if (!docPath) return json(res, 400, { error: 'path is required' });
      // `now` is the host's clock, so a page can tell what finished before or
      // after its own last edit (⌘Z) whatever its clock says.
      if (!readSource) return json(res, 200, { turns: [], now: Date.now() });
      return json(res, 200, { ...(await listReview({ store, docPath, read: readSource })), now: Date.now() });
    }

    // Every chat's turns since a time, in one request, so the day's lanes and
    // the pages two chats changed at once are not asked for chat by chat.
    // `paths=1` adds the pages each turn changed. `now` is the host's clock.
    if (route === '/agent/turns' && method === 'GET') {
      const since = Number(url.searchParams.get('since'));
      if (!url.searchParams.get('since') || !Number.isFinite(since)) return json(res, 400, { error: 'since is required, in milliseconds' });
      const turns = await store.turnsSince(since, { paths: url.searchParams.get('paths') === '1' });
      return json(res, 200, { turns, now: Date.now() });
    }

    if (route === '/agent/setup' && method === 'GET') return json(res, 200, await setupState());
    if (route === '/agent/setup/later' && method === 'POST') {
      await store.saveSettings({ setupLater: new Date().toISOString() });
      return json(res, 200, await setupState());
    }
    // Starter credit, read fresh when a page asks after a turn ended.
    if (route === '/agent/credit' && method === 'GET') {
      const state = await creditState(await store.settings(), { fresh: url.searchParams.get('fresh') === '1' });
      return json(res, 200, state ?? { available: false });
    }
    if (route === '/agent/setup' && method === 'POST') {
      if (!keys) return json(res, 409, { error: 'this drive keeps no keys' });
      const body = await readJson(req, maxBody);
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      if (body.provider === CODEX) return json(res, ...(await connectCodex(key)));
      if (!key || /\s/.test(key)) return json(res, 400, { error: 'Paste the whole key. It starts with sk-ant-.' });
      const verdict = await checkAnthropicKey(key, { baseURL: anthropicBase });
      if (verdict === 'rejected') {
        return json(res, 400, { error: "Anthropic didn't accept that key. Check that it was copied whole." });
      }
      // Kept even when Anthropic could not be asked: an outage is not a
      // wrong key, and the page says it went unchecked.
      await keys.write({ anthropic: key });
      changed();
      const current = (await store.settings()).defaultProvider;
      // Connected: should it ever stop running, the first visit asks again.
      await store.saveSettings({ claudeAuth: 'api', setupLater: null, ...(isClaude(current) ? { defaultProvider: CLAUDE.api } : {}) });
      return json(res, 200, { ...(await setupState()), checked: verdict === 'ok' });
    }

    // Signing in to the person's own Claude or ChatGPT (the connect sheet in
    // runtime/agent-ui.js), through each CLI's own sign-in: Claude Code's
    // `claude auth login` and Codex's `codex login --device-auth`
    // (claude-signin.js, codex-signin.js). The login is the CLI's, kept under
    // the drive's home; these routes start the command, hand Claude its code,
    // say how a sign-in stands, end one, and sign out with the CLI's own
    // logout. None of them reads or answers a token. Like every /agent route
    // they are the owner's: the gate is in front of them, a share link never
    // reaches them, and a change has to come from this drive's own pages.
    if (route === '/agent/claude/sign-in') {
      if (method === 'DELETE') {
        signIn?.cancel();
        return json(res, 200, { ok: true });
      }
      if (!providers.has(CLAUDE.login)) return json(res, 400, { error: "This drive doesn't have Claude." });
      if (method === 'GET') {
        const status = await claudeSignInRun().status();
        return json(res, 200, { waiting: claudeSignInRun().waiting(), signedIn: status.signedIn });
      }
      if (method === 'POST') {
        try {
          return json(res, 200, await claudeSignInRun().start());
        } catch (err) {
          return json(res, err.status ?? 500, { error: err.message });
        }
      }
    }
    if (route === '/agent/claude/sign-in/code' && method === 'POST') {
      const body = await readJson(req, maxBody);
      try {
        await claudeSignInRun().finish(body.code);
      } catch (err) {
        return json(res, err.status ?? 500, { error: err.message, ...(err.retry ? { retry: true } : {}) });
      }
      // Claude runs on the plan now: the switch goes to the login, and a
      // default of Claude (on a key or on credit) follows it. A token an
      // older Connect kept would win over the CLI's own login, so it goes.
      if (keys) await keys.write({ claude: '' });
      changed();
      const current = (await store.settings()).defaultProvider;
      const claudeDefault = !current || String(current).startsWith('claude');
      await store.saveSettings({ claudeAuth: 'login', setupLater: null, claudeLoginHere: new Date().toISOString(), ...(claudeDefault ? { defaultProvider: CLAUDE.login } : {}) });
      return json(res, 200, { ...(await setupState()), connected: true });
    }
    // Disconnect: Claude Code's own `claude auth logout`, and a token an
    // older Connect kept, both gone.
    if (route === '/agent/claude/sign-out' && method === 'POST') {
      if (!providers.has(CLAUDE.login)) return json(res, 400, { error: "This drive doesn't have Claude." });
      const out = await claudeSignInRun().signOut();
      if (keys) await keys.write({ claude: '' });
      await store.saveSettings({ claudeLoginHere: null });
      changed();
      if (!out.ok && !out.missing) {
        log.error?.(`[claude sign-in] logout failed: ${out.detail}`);
        return json(res, 500, { error: "Claude Code couldn't sign out. Try again." });
      }
      return json(res, 200, await setupState());
    }

    if (route === '/agent/codex/sign-in') {
      if (method === 'DELETE') {
        chatgpt?.cancel();
        return json(res, 200, { ok: true });
      }
      if (!providers.has(CODEX)) return json(res, 400, { error: "This drive doesn't have Codex." });
      if (method === 'GET') {
        const status = codexSignInRun().status();
        return json(res, 200, status.state === 'signed-in' ? { ...status, ...(await setupState()), connected: true } : status);
      }
      if (method === 'POST') {
        try {
          return json(res, 200, { state: 'waiting', ...(await codexSignInRun().start()) });
        } catch (err) {
          return json(res, err.status ?? 500, { error: err.message });
        }
      }
    }
    // Disconnect: Codex's own `codex logout`. A key kept for Codex is the key
    // field's to clear.
    if (route === '/agent/codex/sign-out' && method === 'POST') {
      if (!providers.has(CODEX)) return json(res, 400, { error: "This drive doesn't have Codex." });
      const out = await codexSignInRun().signOut();
      await store.saveSettings({ codexLoginHere: null });
      changed();
      if (!out.ok && !out.missing) {
        log.error?.(`[codex sign-in] logout failed: ${out.detail}`);
        return json(res, 500, { error: "Codex couldn't sign out. Try again." });
      }
      return json(res, 200, await setupState());
    }

    if (route === '/agent/settings') {
      if (method === 'GET') return json(res, 200, await publicSettings());
      if (method === 'PUT') {
        const body = await readJson(req, maxBody);
        const patch = {};
        if (typeof body.defaultProvider === 'string') patch.defaultProvider = body.defaultProvider;
        if (body.claudeAuth === 'login' || body.claudeAuth === 'api' || (body.claudeAuth === 'credit' && hasCredit())) {
          patch.claudeAuth = body.claudeAuth;
          // A default of "Claude" follows the switch to whichever pays.
          const current = patch.defaultProvider ?? (await store.settings()).defaultProvider;
          if (isClaude(current)) patch.defaultProvider = CLAUDE[body.claudeAuth];
        }
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
        // A permission mode is a standing choice, not a per-conversation one:
        // someone who works in Accept edits wants every new conversation to
        // start there, the way the model and the effort already do. Without
        // this every conversation started in Auto and had to be cycled.
        if (body.modes && typeof body.modes === 'object') {
          const modes = { ...(await store.settings()).modes };
          for (const [id, mode] of Object.entries(body.modes)) {
            if (typeof mode !== 'string' || !mode.trim()) delete modes[id];
            else modes[id] = mode.trim();
          }
          patch.modes = modes;
        }
        if (body.voice && typeof body.voice === 'object') patch.voice = patchVoice((await store.settings()).voice, body.voice);
        if (Object.keys(patch).length) await store.saveSettings(patch);
        if (keys && body.keys && typeof body.keys === 'object') {
          await keys.write(body.keys);
          changed();
        }
        return json(res, 200, await publicSettings());
      }
    }

    // What a fresh callout card offers for one element: suggestions written
    // for it, read from the stored document rather than the page's copy. 204
    // when this host writes none (no model, a document it cannot read, no
    // answer); the card keeps its plain defaults. One answer per element and
    // content, for a while, so reopening a card does not ask again.
    if (route === '/agent/offer' && method === 'POST') {
      const body = await readJson(req, maxBody);
      const docPath = typeof body.path === 'string' ? body.path : '';
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => typeof id === 'string' && id).slice(0, 8);
      const words = typeof body.words === 'string' ? body.words.slice(0, 400) : '';
      if (!offer || !readSource || !docPath || !ids.length) { res.writeHead(204); return res.end(); }
      const source = await readSource(docPath).catch(() => null);
      if (!source) { res.writeHead(204); return res.end(); }
      const html = ids.map((id) => { try { return sliceOf(source, id).html; } catch { return ''; } }).join('\n');
      const key = crypto.createHash('sha1').update(`${docPath}\0${ids.join(',')}\0${words}\0${html}`).digest('hex');
      let written = offers.get(key);
      if (written === undefined) {
        const title = /<title[^>]*>([^<]*)<\/title>/i.exec(source)?.[1]?.trim() ?? '';
        written = await offer({ title, html, words }).catch(() => null);
        offers.set(key, written);
        if (offers.size > 200) offers.delete(offers.keys().next().value);
      }
      if (!written) { res.writeHead(204); return res.end(); }
      return json(res, 200, written);
    }

    // A few words about the look of the page, as one rule (change-line.js
    // asks before it sends words that sound like a look): a small model reads
    // them beside the page's outline and answers one selector and a few
    // declarations, or none. No rule — no model here, no words, no answer, a
    // failure — is `{ rule: null }`, and the words go to the agent as asked.
    //
    // At most two are read at once (a third is no rule at once), what is
    // sent is cut to size, and a page that stops waiting lets the model go.
    if (route === '/agent/change-intent' && method === 'POST') {
      const body = await readJson(req, Math.min(maxBody, INTENT_BODY));
      const words = typeof body.words === 'string' ? body.words.trim().slice(0, 300) : '';
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter((id) => typeof id === 'string' && id).slice(0, 20).map((id) => id.slice(0, 40));
      const field = (value) => (typeof value === 'string' ? value.slice(0, 120) : '');
      const outline = (Array.isArray(body.outline) ? body.outline : []).filter((o) => o && typeof o === 'object').slice(0, 40).map((o) => ({
        selector: field(o.selector), count: Math.max(0, Math.min(Number(o.count) || 0, 10_000)),
        radius: field(o.radius), padding: field(o.padding), fontSize: field(o.fontSize), color: field(o.color), background: field(o.background),
      }));
      if (!intent || !words || intentsRunning >= INTENTS_AT_ONCE) return json(res, 200, { rule: null });
      const stop = new AbortController();
      const gone = () => { if (!res.writableEnded) stop.abort(); };
      res.on?.('close', gone);
      intentsRunning += 1;
      let rule = null;
      try {
        rule = await Promise.resolve().then(() => intent({ words, ids, outline, signal: stop.signal })).catch(() => null);
      } finally {
        intentsRunning -= 1;
        res.off?.('close', gone);
      }
      if (stop.signal.aborted) return undefined;
      return json(res, 200, { rule: rule ?? null });
    }

    if (route === '/agent/voice' && method === 'GET') {
      const chosen = voiceSettings((await store.settings()).voice);
      const can = voice ? voice.available() : { ok: false, why: 'no-key' };
      return json(res, 200, {
        available: can.ok,
        ...(can.ok ? {} : { why: can.why }),
        on: chosen.on,
        voice: chosen.voice,
        readAloud: chosen.readAloud,
        sendWhenStop: chosen.sendWhenStop,
        whileRunning: chosen.whileRunning,
        maxSeconds: voiceMaxSeconds,
        voices: VOICES,
        usage: voiceUsage ? await voiceUsage.read() : null,
      });
    }

    // A clip in, its words out. The clip is the raw body, held in memory for
    // this request only and forwarded to OpenAI; nothing of it is written.
    if (route === '/agent/voice/transcribe' && method === 'POST') return transcribeClip(req, res, url);

    // The OpenAI key, given in Settings › Voice: checked as Codex's is, and
    // kept in the same place, because it is the same key.
    if (route === '/agent/voice/key' && method === 'POST') {
      if (!keys) return json(res, 409, { error: 'this drive keeps no keys' });
      const body = await readJson(req, maxBody);
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      if (!key || /\s/.test(key)) return json(res, 400, { error: 'Paste the whole key. It starts with sk-.' });
      if (key.startsWith('sk-ant-')) return json(res, 400, { error: "That's an Anthropic key. Voice needs an OpenAI one." });
      const verdict = await checkOpenAIKey(key, { baseURL: openaiBase });
      if (verdict === 'rejected') return json(res, 400, { error: "OpenAI didn't accept that key. Check that it was copied whole." });
      await keys.write({ openai: key });
      changed();
      return json(res, 200, { checked: verdict === 'ok', available: true });
    }

    // A fixed sentence in the voice asked for, for Settings › Voice.
    if (route === '/agent/voice/sample' && method === 'POST') {
      const body = await readJson(req, maxBody);
      const chosen = voiceSettings((await store.settings()).voice);
      return speakInto(res, SAMPLE, VOICES.includes(body.voice) ? body.voice : chosen.voice);
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
        const made = await startConversation(await readJson(req, maxBody));
        return made.error ? json(res, made.status, { error: made.error }) : json(res, 201, made.summary);
      }
    }

    const usageLeft = USAGE_LEFT.exec(route);
    if (usageLeft && method === 'POST') {
      const id = usageLeft[1];
      const meta = await store.conversation(id);
      if (!meta) return json(res, 404, { error: `no conversation "${id}"` });
      const body = await readJson(req, maxBody);
      const turn = String(body.turn ?? '');
      if (!turn) return json(res, 400, { error: 'turn is required' });
      const event = await store.appendEvent(id, { type: 'usage.left', turn });
      await publishSummary(id, event);
      return json(res, 200, event);
    }
    const failover = FAILOVER.exec(route);
    if (failover && method === 'POST') {
      const id = failover[1];
      if (!(await store.conversation(id))) return json(res, 404, { error: `no conversation "${id}"` });
      try {
        return json(res, 200, await runner.handoffUsage(id));
      } catch (err) {
        if (err.status) return json(res, err.status, { error: err.message });
        throw err;
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
        // Where the words were typed, when that is not a document being worked
        // on: the Chat app sends `chat`, so the agent answers rather than edits.
        if (body.context.surface === 'chat') context.surface = 'chat';
        // Said aloud, and to be heard: the agent is asked for a reply that
        // sounds right spoken (runner.js), and the chat marks the prompt.
        if (body.context.spoken === true) context.spoken = true;
        // What the page adds to the ask without showing it in the chat: the
        // callout's four actions say how to build here (agent-offer.js). It
        // rides in the prompt the agent reads, never in the message.
        if (typeof body.context.brief === 'string' && body.context.brief.trim()) {
          context.brief = body.context.brief.trim().slice(0, BRIEF_MAX);
        }
        return json(res, 202, await runner.send(id, {
          prompt: String(body.prompt ?? ''),
          context,
          dispatch: body.dispatch,
        }));
      }
      if (!turns && method === 'GET') {
        const events = await store.events(id, { after: Number(url.searchParams.get('after') ?? 0) });
        const body = { meta: await store.summary(id), turns: await store.turns(id) };
        // `turns=N`: only the last N turns (or the N before `before`), for a
        // page that draws the end of a long chat first. Without it, all.
        const last = url.searchParams.get('turns');
        if (last === null) body.events = events;
        else Object.assign(body, sliceTurns(events, { last: Number(last), before: url.searchParams.get('before') }));
        return json(res, 200, body);
      }
      /** A chat that was started and never used, discarded rather than
       *  filed: pressing the close button on a brand-new pane should leave
       *  the drive as if the chat had never been created. Nothing is thrown
       *  away silently — a chat with a title, an event, a turn or a running
       *  agent is refused here, whatever the page believes, because only the
       *  disk knows what it holds. */
      if (!turns && method === 'DELETE') {
        const [turnRecords, events] = await Promise.all([store.turns(id), store.events(id)]);
        if (meta.title || meta.running || turnRecords.length || events.length) {
          return json(res, 409, { error: 'this conversation has something in it' });
        }
        await store.discardConversation(id);
        // The summary says only that the chat is gone: there is no meta left
        // to send, and every list that was holding it has to drop it.
        hub.publish(id, { type: 'removed' }, { id, removed: true });
        return json(res, 200, { removed: true });
      }
      if (!turns && method === 'PATCH') {
        const body = await readJson(req, maxBody);
        const patch = {};
        if (typeof body.archived === 'boolean') patch.archived = body.archived;
        if (body.reviewed === true) patch.lastReviewedAt = Date.now();
        // A name someone typed is theirs. Clearing `titleAuto` is what stops
        // the namer from writing over it after the next turn.
        if (typeof body.title === 'string' && body.title.trim()) {
          patch.title = body.title.trim().slice(0, 120);
          patch.titleAuto = false;
        }
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
        if (patch.provider || (patch.model && patch.model !== meta.model)) patch.usageLane = null;
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
        // The Claude login this chat runs on: null goes back to the folder's.
        // A login whose sessions live elsewhere cannot resume this chat's, so
        // the next turn starts a fresh session there.
        if ('account' in body) {
          const settings = (await store.settings?.().catch(() => null)) ?? {};
          const accounts = listClaudeAccounts(settings.claudeAccounts);
          const next = body.account === null || body.account === '' ? null : String(body.account);
          if (next !== null && !accounts.some((account) => account.id === next && account.present)) {
            return json(res, 400, { error: `no Claude account "${next}"` });
          }
          if (next !== (meta.account ?? null)) {
            patch.account = next;
            const was = accounts.find((account) => account.id === (meta.accountUsed ?? PERSONAL)) ?? accounts[0];
            const will = next ? accounts.find((account) => account.id === next) : null;
            if (will && meta.providerSession && !sharesSessions(was.configDir, will.configDir)) patch.providerSession = null;
          }
        }
        if (body.failover !== undefined) {
          if (body.failover !== 'auto' && body.failover !== 'pause') {
            return json(res, 400, { error: 'failover must be auto or pause' });
          }
          patch.failover = body.failover;
        }
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
      if (action === '/speech' && method === 'GET') return speakTurn(res, turnId);
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
      // An undo's looks are over when the undo is: each path it wrote to
      // gets an empty look, so a tab that opens later is not told an undo
      // is still standing on the document (/presence keeps the last look).
      const endUndoLooks = (saved, client, turnIdOfUndo) => {
        if (!onLook) return;
        for (const docPath of new Set(saved.steps.map((record) => record?.path).filter(Boolean))) {
          onLook(docPath, [], client, { stage: 'end', turn: turnIdOfUndo });
        }
      };
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
          const client = `agent-undo:${turn.conversationId}`;
          const result = await undoTurn({
            records: saved.steps,
            restores: saved.restores,
            writeOps,
            restore,
            client,
            turn: turn.id,
            look: onLook ? (docPath, ids, extra) => onLook(docPath, ids, client, extra) : null,
            saveRedo: (id, record) => store.saveRedo(id, record),
            dropRedo: (id) => store.deleteRedo(id),
            log,
          }).finally(() => endUndoLooks(saved, client, turn.id));
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
      if (action === '/redo' && method === 'POST') {
        const turn = await store.turn(turnId);
        if (!turn) return json(res, 404, { error: `no turn "${turnId}"` });
        if (!turn.undoneAt) return json(res, 409, { error: 'this turn was not undone' });
        if (undoing.has(turnId)) return json(res, 409, { error: 'this turn is being undone' });
        undoing.add(turnId);
        try {
          // No record, or one with no steps (left by an undo that only
          // restored), is nothing to redo.
          const saved = normalizeUndo(await store.redoRecords(turnId));
          if (!saved.steps.length && !saved.restores.length) return json(res, 409, { error: 'there is nothing to redo' });
          const client = `agent-undo:${turn.conversationId}`;
          const result = await undoTurn({
            records: saved.steps,
            restores: saved.restores,
            writeOps,
            restore,
            client,
            turn: turn.id,
            look: onLook ? (docPath, ids, extra) => onLook(docPath, ids, client, extra) : null,
          }).finally(() => endUndoLooks(saved, client, turn.id));
          await store.updateTurn(turnId, { undoneAt: null });
          await store.deleteRedo(turnId);
          await publishSummary(
            turn.conversationId,
            await store.appendEvent(turn.conversationId, { type: 'turn.redone', turn: turnId, reverted: result.reverted, kept: result.kept }),
          );
          return json(res, 200, { reverted: result.reverted, kept: result.kept });
        } finally {
          undoing.delete(turnId);
        }
      }
      if (action === '/keep' && method === 'POST') {
        const turn = await store.turn(turnId);
        if (!turn) return json(res, 404, { error: `no turn "${turnId}"` });
        await store.updateTurn(turnId, { keptAt: Date.now() });
        const stillNeedsReview = readSource
          ? await conversationHasReview({ store, read: readSource, conversationId: turn.conversationId, excludeTurnId: turnId })
          : true;
        if (!stillNeedsReview) await store.updateConversation(turn.conversationId, { lastReviewedAt: Date.now() });
        hub.publish(turn.conversationId, { type: 'meta' }, await store.summary(turn.conversationId));
        return json(res, 200, { ok: true });
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
      // A forgotten tab's reconnect is told to stop (server/streams.js).
      if (streams && !streams.admit(req, url)) {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        return res.end();
      }
      streams?.track(req, res, url);
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

  return {
    handle,
    handleTools,
    startRun,
    startConversation,
    defaultProvider: async () => runnableDefault(await store.settings()),
    /** Build mode's routes (server/build/routes.js), behind these same checks. */
    useBuilds(routes) { buildRoutes = routes; },
    /** Ends a Claude sign-in still waiting for its code. */
    close() { signIn?.close(); chatgpt?.close(); },
  };
}
