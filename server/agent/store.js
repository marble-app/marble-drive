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

import '../../runtime/agent-folders.js';
import { fallbackTitle } from './namer.js';

const folderLib = () => globalThis.marbleAgentFolders;

const REVIEWABLE = new Set(['changes', 'done', 'failed', 'interrupted', 'watchdog']);

export const needsReview = (meta) =>
  REVIEWABLE.has(meta.lastOutcome) &&
  (meta.lastReviewedAt === null || meta.lastReviewedAt === undefined || meta.lastReviewedAt < meta.lastFinishedAt);

export const summarize = (meta) => ({
  ...meta,
  status: meta.running ? 'running' : meta.lastOutcome ?? 'new',
  needsReview: needsReview(meta),
  // Honest: listings never use status 'queued'. A waiting conversation is
  // `running: false` with `queued: true` when a turn file is still queued.
  queued: Boolean(meta.queued),
  // A running turn is waiting on the person: a permission prompt or a question.
  asking: Boolean(meta.asking),
});

export const conversationOf = (turnId) => turnId.slice(0, turnId.lastIndexOf('-t'));

const clampFocus = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.min(1, Math.max(0, value));
};

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

export function createAgentStore({ dir, defaultProvider = 'claude-subscription', log = console }) {
  const convDir = (id) => path.join(dir, id);
  const metaFile = (id) => path.join(convDir(id), 'meta.json');
  const eventsFile = (id) => path.join(convDir(id), 'events.jsonl');
  const inboxFile = (id) => path.join(convDir(id), 'inbox.jsonl');
  const turnFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'turns', `${turnId}.json`);
  const undoFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'turns', `${turnId}.undo.json`);
  const rawFile = (turnId) => path.join(convDir(conversationOf(turnId)), 'raw', `${turnId}.jsonl`);
  const foldersFile = path.join(dir, 'folders.json');

  const readFolders = async () => (await readJson(foldersFile)) ?? { folders: [], workingSetIds: [] };

  const writeFolders = async (state) => writeJson(foldersFile, state);

  // One chain per conversation, so two events appended at once still get
  // consecutive numbers and land in the file in that order.
  const chains = new Map();
  const counters = new Map();
  const serial = (id, task) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(task, task);
    chains.set(id, next.catch(() => {}));
    return next;
  };

  const eventsText = async (id) => {
    try {
      return await fsp.readFile(eventsFile(id), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return '';
      throw err;
    }
  };

  // A host that dies halfway through an append leaves a line that is not
  // JSON. It is skipped rather than thrown on — otherwise one torn line keeps
  // the host from booting — and said once per conversation, not per read.
  const torn = new Set();
  function parseEvents(id, text) {
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        if (!torn.has(id)) {
          torn.add(id);
          log.error(`[agents] skipped a line of ${eventsFile(id)} that is not whole JSON`);
        }
      }
    }
    return out;
  }

  async function events(id, { after = 0 } = {}) {
    return parseEvents(id, await eventsText(id)).filter((event) => event.seq > after);
  }

  async function conversation(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id))) return null;
    return readJson(metaFile(id));
  }

  async function hasFolderMembers(folderId) {
    for (const cid of await ids()) {
      const meta = await conversation(cid);
      if (meta?.folderId === folderId) return true;
    }
    return false;
  }

  async function maybeDissolveFolder(previousFolderId) {
    if (!previousFolderId) return;
    return serial('folders', async () => {
      if (await hasFolderMembers(previousFolderId)) return;
      const state = await readFolders();
      const dissolved = state.folders.find((folder) => folder.id === previousFolderId);
      const dropIds = new Set(dissolved?.openIds ?? []);
      state.folders = state.folders.filter((folder) => folder.id !== previousFolderId);
      for (const folder of state.folders) {
        folder.openIds = (folder.openIds ?? []).filter((openId) => !dropIds.has(openId));
      }
      await writeFolders(state);
    });
  }

  async function updateConversation(id, patch) {
    const interactionFields = ['folderId', 'pinned', 'focusX', 'focusY'];
    const folderIdPatched = 'folderId' in patch;
    let previousFolderId;

    const next = await serial(`meta:${id}`, async () => {
      const meta = await conversation(id);
      if (!meta) throw Object.assign(new Error(`no conversation "${id}"`), { status: 404 });
      if (folderIdPatched) previousFolderId = meta.folderId;

      const processed = { ...patch };
      if ('focusX' in processed) processed.focusX = clampFocus(processed.focusX);
      if ('focusY' in processed) processed.focusY = clampFocus(processed.focusY);
      if (interactionFields.some((field) => field in patch)) {
        processed.lastInteractedAt = Date.now();
      }

      const updated = { ...meta, ...processed, updatedAt: Date.now() };
      await writeJson(metaFile(id), updated);
      return updated;
    });

    if (folderIdPatched && previousFolderId) {
      await maybeDissolveFolder(previousFolderId);
    }

    return next;
  }

  async function appendEvent(id, event) {
    const stored = await serial(id, async () => {
      let lead = '';
      if (!counters.has(id)) {
        const text = await eventsText(id);
        const seqs = parseEvents(id, text).map((e) => e.seq).filter(Number.isFinite);
        // A fold, not a spread: a long conversation has more events than fit
        // in one call's worth of arguments.
        counters.set(id, seqs.reduce((top, seq) => (seq > top ? seq : top), 0));
        // A torn last line has no newline; start on a fresh one, or this
        // event would be glued onto it and lost with it.
        if (text && !text.endsWith('\n')) lead = '\n';
      }
      const seq = counters.get(id) + 1;
      counters.set(id, seq);
      const line = { seq, t: Date.now(), ...event };
      await fsp.mkdir(convDir(id), { recursive: true });
      await fsp.appendFile(eventsFile(id), `${lead}${JSON.stringify(line)}\n`);
      return line;
    });
    if (event.type === 'user') {
      const meta = await conversation(id);
      if (meta) {
        const patch = {};
        // A placeholder, marked as one: the board needs a row now, and the
        // namer replaces it once the turn has an answer to read.
        if (!meta.title) {
          // A prompt that was nothing but an attachment leaves no quotation
          // worth showing; the row stays "New Chat" until the namer answers.
          patch.title = fallbackTitle(event.text) || null;
          patch.titleAuto = true;
        }
        const target = event.context?.target;
        if (typeof target === 'string' && target && target !== meta.target) patch.target = target;
        if (Object.keys(patch).length) await updateConversation(id, patch);
      }
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
    // `maxRunning` was a cap on how many conversations ran at once. It is
    // retired: a host that wants one sets MARBLE_DRIVE_AGENT_MAX_RUNNING.
    // Dropped on read so the key stops being answered, and dropped from
    // disk the next time anything saves.
    const { maxRunning: _retired, ...saved } = (await readJson(path.join(dir, 'settings.json'))) ?? {};
    return { defaultProvider, models: {}, efforts: {}, modes: {}, projects: [], defaultProject: 'drive', skills: {}, ...saved };
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

  async function summary(id) {
    const meta = await conversation(id);
    if (!meta) return null;
    const queued = (await turns(id)).some((t) => t.status === 'queued');
    return summarize({ ...meta, queued });
  }

  // ------------------------------------------------------------------ uploads
  //
  // An image pasted into a composer has to become a file before an agent can
  // look at it: every provider is a CLI reading the disk, not an API taking
  // base64. They live beside the conversations, under `.marble/`, so the backup
  // that already copies that folder carries them, and so an agent handed the
  // path can read it without being let anywhere new.

  const uploadsDir = path.join(dir, 'uploads');
  const KINDS = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
  ]);

  const uploadPath = (name) => {
    // The name is ours — minted below — so anything else is someone trying a
    // path, and gets nothing.
    if (!/^[0-9a-f]{16}\.(png|jpg|gif|webp)$/.test(String(name))) return null;
    return path.join(uploadsDir, name);
  };

  async function saveUpload({ type, data, name = '' }) {
    const ext = KINDS.get(String(type));
    if (!ext) throw Object.assign(new Error(`${type} is not an image this drive keeps`), { status: 400 });
    const bytes = Buffer.from(String(data ?? ''), 'base64');
    if (!bytes.length) throw Object.assign(new Error('that image arrived empty'), { status: 400 });
    const file = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
    await fsp.mkdir(uploadsDir, { recursive: true });
    await fsp.writeFile(path.join(uploadsDir, file), bytes);
    return {
      file,
      type,
      bytes: bytes.length,
      name: String(name).slice(0, 120),
      path: path.join(uploadsDir, file),
    };
  }

  async function readUpload(name) {
    const file = uploadPath(name);
    if (!file) return null;
    const ext = file.split('.').pop();
    try {
      return {
        bytes: await fsp.readFile(file),
        type: [...KINDS].find(([, kind]) => kind === ext)?.[0] ?? 'application/octet-stream',
      };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async function readInbox(id) {
    let text;
    try {
      text = await fsp.readFile(inboxFile(id), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const messages = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // A torn last line from a crash mid-append. The message it held is
        // lost; the ones before it are not.
      }
    }
    return messages;
  }

  return {
    ready: () => fsp.mkdir(dir, { recursive: true }),

    settings,

    saveUpload,
    readUpload,

    saveSettings,

    async createConversation({ provider, model = null, effort = null, mode = null, handoffFrom = null, project = 'drive' }) {
      const now = Date.now();
      const meta = {
        id: crypto.randomBytes(6).toString('hex'),
        provider,
        model,
        effort,
        mode,
        project,
        title: null,
        titleAuto: false,
        target: null,
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
        folderId: null,
        pinned: false,
        focusX: null,
        focusY: null,
        lastInteractedAt: now,
        queueCombine: false,
      };
      await writeJson(metaFile(meta.id), meta);
      return meta;
    },

    /** A chat taken off the disk rather than filed away. Only ever for one
     *  with nothing in it — the route decides that, because "nothing in it"
     *  is a question about events and turns, not about files — and it is
     *  gone completely: a chat that was opened and closed again unused
     *  should leave no more trace than one that was never started. The
     *  folders it was named in forget it too, and a group it was the last
     *  member of dissolves the same way it would if the chat had moved out.
     */
    async discardConversation(id) {
      const meta = await conversation(id);
      await fsp.rm(convDir(id), { recursive: true, force: true });
      counters.delete(id);
      await serial('folders', async () => {
        const state = await readFolders();
        const before = JSON.stringify(state);
        state.workingSetIds = (state.workingSetIds ?? []).filter((row) => row !== id);
        for (const folder of state.folders ?? []) {
          folder.openIds = (folder.openIds ?? []).filter((openId) => openId !== id);
        }
        if (JSON.stringify(state) !== before) await writeFolders(state);
      });
      await maybeDissolveFolder(meta?.folderId ?? null);
      return { removed: true };
    },

    conversation,
    updateConversation,
    summary,

    listFolders: readFolders,

    async createFolder({ conversationIds, name, color }) {
      const folderId = crypto.randomBytes(6).toString('hex');
      const targets = [];
      for (const cid of conversationIds) {
        const meta = await conversation(cid);
        if (!meta) throw Object.assign(new Error(`no conversation "${cid}"`), { status: 404 });
        if (meta.target) targets.push(meta.target);
      }

      const { suggestName, nextColor, realmOf, FULL_CAP } = folderLib();
      const folder = await serial('folders', async () => {
        const state = await readFolders();
        const existingColors = state.folders.map((row) => row.color);
        let folderName = name;
        if (folderName === undefined || folderName === null) folderName = suggestName(targets);
        let folderColor = color;
        if (folderColor === undefined || folderColor === null) {
          const realm = targets.length ? realmOf(targets[0]) : '';
          const used = new Set(existingColors);
          folderColor = realm && !used.has(realm) ? realm : nextColor(existingColors);
        }
        const maxOrder = state.folders.reduce((max, row) => Math.max(max, row.order ?? 0), -1);
        const row = {
          id: folderId,
          name: folderName,
          color: folderColor,
          openIds: conversationIds.slice(0, FULL_CAP),
          order: maxOrder + 1,
        };
        state.folders.push(row);
        await writeFolders(state);
        return row;
      });

      for (const cid of conversationIds) {
        await updateConversation(cid, { folderId });
      }

      return folder;
    },

    async updateFolder(id, patch) {
      return serial('folders', async () => {
        const state = await readFolders();
        const index = state.folders.findIndex((row) => row.id === id);
        if (index < 0) throw Object.assign(new Error(`no folder "${id}"`), { status: 404 });
        state.folders[index] = { ...state.folders[index], ...patch };
        await writeFolders(state);
        return state.folders[index];
      });
    },

    async deleteFolder(id) {
      await serial('folders', async () => {
        const state = await readFolders();
        state.folders = state.folders.filter((row) => row.id !== id);
        await writeFolders(state);
      });
      // Which chats came loose, so the caller can say so. A folder going away
      // changes every member's meta, and a client that is told only about the
      // folder has a chat filed under a group that no longer exists.
      const freed = [];
      for (const cid of await ids()) {
        const meta = await conversation(cid);
        if (meta?.folderId === id) {
          await updateConversation(cid, { folderId: null });
          freed.push(cid);
        }
      }
      return { ...(await readFolders()), freed };
    },

    async setWorkingSet(conversationIds) {
      return serial('folders', async () => {
        const state = await readFolders();
        const existing = new Set(await ids());
        state.workingSetIds = conversationIds.filter((id) => existing.has(id));
        await writeFolders(state);
        return state;
      });
    },

    async conversations({ archived = false } = {}) {
      const metas = (await Promise.all((await ids()).map((id) => conversation(id)))).filter(Boolean);
      const wanted = metas
        .filter((meta) => Boolean(meta.archived) === Boolean(archived))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return Promise.all(wanted.map((meta) => summary(meta.id)));
    },

    appendEvent,
    events,

    async createTurn(id, { prompt, context, dispatch = 'queue', behind = false, bundle = null }) {
      return serial(`turns:${id}`, async () => {
        const n = (await turns(id)).length + 1;
        const turn = {
          id: `${id}-t${n}`,
          conversationId: id,
          n,
          status: 'queued',
          prompt,
          context,
          dispatch,
          behind,
          bundle,
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

    /** A message between two conversations. Pure: minted here, stored by
     *  appendInbox and by the events each side records. */
    createMessage({ from, to, text, about = null, inReplyTo = null, hop = 0 }) {
      return {
        id: crypto.randomBytes(6).toString('hex'),
        from,
        to,
        text: String(text),
        about: about ?? null,
        inReplyTo: inReplyTo ?? null,
        hop: Number(hop) || 0,
        t: Date.now(),
      };
    },

    // The inbox is the one queue for messages to a conversation. Who empties
    // it — a turn that is waiting, a turn that is starting, or a delivery turn
    // the runner starts — is the runner's business; here it is a file.
    async appendInbox(id, message) {
      await serial(`inbox:${id}`, async () => {
        await fsp.mkdir(convDir(id), { recursive: true });
        await fsp.appendFile(inboxFile(id), `${JSON.stringify(message)}\n`);
      });
    },

    async inbox(id) {
      return serial(`inbox:${id}`, () => readInbox(id));
    },

    async takeInbox(id) {
      return serial(`inbox:${id}`, async () => {
        const messages = await readInbox(id);
        if (messages.length) await fsp.rm(inboxFile(id), { force: true });
        return messages;
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
