// Where conversations live: `<drive>/.marble/agents/`, beside the history, so
// the backups that already copy `.marble/` carry them without being told.
//
//   settings.json
//   <conversationId>/meta.json
//   <conversationId>/events.jsonl        the transcript and the audit log, one line per event
//   <conversationId>/turns/<turnId>.json
//   <conversationId>/turns/<turnId>.undo.json
//   <conversationId>/raw/<turnId>.jsonl  the provider's own stream, untouched
//
// A listing reads every meta.json. At the number of conversations one person
// has that is cheaper than keeping an index honest, and there is nothing to
// get out of step.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const REVIEWABLE = new Set(['changes', 'failed', 'interrupted', 'watchdog']);

export const needsReview = (meta) =>
  REVIEWABLE.has(meta.lastOutcome) &&
  (meta.lastReviewedAt === null || meta.lastReviewedAt === undefined || meta.lastReviewedAt < meta.lastFinishedAt);

export const summarize = (meta) => ({
  ...meta,
  status: meta.running ? 'running' : meta.lastOutcome ?? 'new',
  needsReview: needsReview(meta),
});

export const conversationOf = (turnId) => turnId.slice(0, turnId.lastIndexOf('-t'));

const readJson = async (file, fallback = null) => {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
};

/** Written beside and renamed over, so a crash leaves the old file or the new
 *  one and never half of either. */
async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

export function createAgentStore({ dir, defaultProvider = 'claude-subscription' }) {
  const convDir = (id) => path.join(dir, id);
  const metaFile = (id) => path.join(convDir(id), 'meta.json');
  const eventsFile = (id) => path.join(convDir(id), 'events.jsonl');
  const turnFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'turns', `${turnId}.json`);
  const undoFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'turns', `${turnId}.undo.json`);
  const rawFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'raw', `${turnId}.jsonl`);

  // One chain per conversation, so two events appended at once still get
  // consecutive numbers and land in the file in that order.
  const chains = new Map();
  const counters = new Map();
  const serial = (id, task) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(task, task);
    chains.set(id, next.catch(() => {}));
    return next;
  };

  async function events(id, { after = 0 } = {}) {
    let text;
    try {
      text = await fsp.readFile(eventsFile(id), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.seq > after);
  }

  async function conversation(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id))) return null;
    return readJson(metaFile(id));
  }

  async function updateConversation(id, patch) {
    return serial(`meta:${id}`, async () => {
      const meta = await conversation(id);
      if (!meta) throw Object.assign(new Error(`no conversation "${id}"`), { status: 404 });
      const next = { ...meta, ...patch, updatedAt: Date.now() };
      await writeJson(metaFile(id), next);
      return next;
    });
  }

  async function appendEvent(id, event) {
    const stored = await serial(id, async () => {
      if (!counters.has(id)) counters.set(id, (await events(id)).at(-1)?.seq ?? 0);
      const seq = counters.get(id) + 1;
      counters.set(id, seq);
      const line = { seq, t: Date.now(), ...event };
      await fsp.mkdir(convDir(id), { recursive: true });
      await fsp.appendFile(eventsFile(id), `${JSON.stringify(line)}\n`);
      return line;
    });
    if (event.type === 'user') {
      const meta = await conversation(id);
      if (meta && !meta.title) await updateConversation(id, { title: String(event.text ?? '').trim().slice(0, 60) });
    }
    return stored;
  }

  async function turns(id) {
    let names;
    try {
      names = await fsp.readdir(path.join(convDir(id), 'turns'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const records = await Promise.all(
      names.filter((n) => /-t\d+\.json$/.test(n)).map((n) => readJson(path.join(convDir(id), 'turns', n))),
    );
    return records.filter(Boolean).sort((a, b) => a.n - b.n);
  }

  async function ids() {
    try {
      return (await fsp.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && /^[0-9a-f]{12}$/.test(e.name))
        .map((e) => e.name);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async function settings() {
    const saved = (await readJson(path.join(dir, 'settings.json'))) ?? {};
    return { defaultProvider, models: {}, maxRunning: 3, ...saved };
  }

  async function saveSettings(patch) {
    return serial('settings', async () => {
      const next = { ...(await settings()), ...patch };
      await writeJson(path.join(dir, 'settings.json'), next);
      return next;
    });
  }

  async function updateTurn(turnId, patch) {
    return serial(`turn:${turnId}`, async () => {
      const turn = await readJson(turnFile(turnId));
      if (!turn) throw Object.assign(new Error(`no turn "${turnId}"`), { status: 404 });
      const next = { ...turn, ...patch };
      await writeJson(turnFile(turnId), next);
      return next;
    });
  }

  return {
    ready: () => fsp.mkdir(dir, { recursive: true }),

    settings,

    saveSettings,

    async createConversation({ provider, model = null, handoffFrom = null }) {
      const now = Date.now();
      const meta = {
        id: crypto.randomBytes(6).toString('hex'),
        provider,
        model,
        title: null,
        createdAt: now,
        updatedAt: now,
        archived: false,
        handoffFrom,
        handoffTo: null,
        providerSession: null,
        running: false,
        activity: '',
        lastFinishedAt: null,
        lastOutcome: null,
        lastReviewedAt: null,
      };
      await writeJson(metaFile(meta.id), meta);
      return meta;
    },

    conversation,
    updateConversation,

    async conversations({ archived = false } = {}) {
      const metas = (await Promise.all((await ids()).map((id) => conversation(id)))).filter(Boolean);
      return metas
        .filter((meta) => Boolean(meta.archived) === Boolean(archived))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(summarize);
    },

    appendEvent,
    events,

    async createTurn(id, { prompt, context }) {
      return serial(`turns:${id}`, async () => {
        const n = (await turns(id)).length + 1;
        const turn = {
          id: `${id}-t${n}`,
          conversationId: id,
          n,
          status: 'queued',
          prompt,
          context,
          createdAt: Date.now(),
          startedAt: null,
          finishedAt: null,
          error: null,
          applied: 0,
          usage: null,
          undoneAt: null,
        };
        await writeJson(turnFile(turn.id), turn);
        return turn;
      });
    },

    turn: (turnId) => readJson(turnFile(turnId)),

    updateTurn,

    turns,

    saveUndo: (turnId, records) => writeJson(undoFile(turnId), records),
    undoRecords: (turnId) => readJson(undoFile(turnId)),

    async appendRaw(turnId, line) {
      await fsp.mkdir(path.dirname(rawFile(turnId)), { recursive: true });
      await fsp.appendFile(rawFile(turnId), `${line}\n`);
    },

    async interruptUnfinished() {
      const interrupted = [];
      for (const id of await ids()) {
        for (const turn of await turns(id)) {
          if (turn.status !== 'queued' && turn.status !== 'running') continue;
          const finishedAt = Date.now();
          interrupted.push(await updateTurn(turn.id, { status: 'interrupted', finishedAt }));
          await appendEvent(id, { type: 'turn.interrupted', turn: turn.id });
          await updateConversation(id, {
            running: false,
            activity: 'Interrupted when the host stopped',
            lastOutcome: 'interrupted',
            lastFinishedAt: finishedAt,
          });
        }
      }
      return interrupted;
    },
  };
}
