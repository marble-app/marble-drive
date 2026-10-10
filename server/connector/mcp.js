// The drive as an MCP server, for Claude and ChatGPT.
//
// Streamable HTTP at its plainest: every message is a POST to /mcp, and every
// answer is one JSON body (no stream, no session). The tools are the owner's
// two reasons to come in from outside: to read what is in the drive, and to
// run its agents — start a chat on a document, steer it, read what it said,
// answer what it asks, stop it. A change to a document is made by a chat,
// not here: the chat has the ledger, the undo, the live patching and the
// check, and keeping one copy of those rules is the point (server/agent).
//
// A chat started from here is an ordinary chat. It shows in the drawer and
// the Chat app beside the ones the owner typed, runs with the same power, and
// can be picked up at the desk where it was left.

import { parsePath } from '../paths.js';

export const PROTOCOL = '2025-06-18';
const WAIT_DEFAULT = 45;
const WAIT_MAX = 240;
const POLL_MS = 750;
const REPLY_MAX = 24_000;
const OPEN = new Set(['queued', 'running']);

const SCHEMAS = [
  {
    name: 'list_documents',
    description: 'List the documents (apps, notes, pages) in the Marble drive, optionally under one folder.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'A folder path such as "Research".' } } },
  },
  {
    name: 'read_document',
    description:
      'Read a Marble document. Each is one HTML file whose elements carry data-marble-id. Without ids: the whole document, ' +
      'or an outline when it is large. With ids: the full source of those elements.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'The document path without .mrbl, e.g. "Life/Mail".' },
        ids: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'list_chats',
    description: 'List the Marble agent chats, newest first: what each is about, which document it works on, and whether it is running.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        running: { type: 'boolean', description: 'Only the chats working right now.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'How many (default 20).' },
      },
    },
  },
  {
    name: 'read_chat',
    description: 'Read a Marble chat: its last turns (what was asked and what the agent answered), whether it is still working, and any question it is waiting on.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      required: ['chat'],
      properties: {
        chat: { type: 'string', description: 'The chat id from list_chats or start_chat.' },
        turns: { type: 'integer', minimum: 1, maximum: 20, description: 'How many recent turns (default 3).' },
      },
    },
  },
  {
    name: 'start_chat',
    description:
      'Start a Marble agent chat. It runs on the drive\'s computer with Marble\'s document tools and the owner\'s own setup, so it can ' +
      'read and change documents and apps, build new ones, and run commands. Give a document to work on it; leave it out to just ask. ' +
      'Waits up to wait_seconds for the reply; a longer job keeps running, and read_chat picks it up.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'What to ask or have done, as you would type it in Marble.' },
        document: { type: 'string', description: 'The document path to work on (from list_documents).' },
        title: { type: 'string', description: 'A name for the chat in Marble.' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: WAIT_MAX, description: `How long to wait for the answer (default ${WAIT_DEFAULT}; 0 returns at once).` },
      },
    },
  },
  {
    name: 'send_to_chat',
    description:
      'Send a follow-up to a Marble chat. By default it waits its turn behind any running work; "steer" folds it into the running turn, ' +
      '"interrupt" stops that turn and starts this one.',
    inputSchema: {
      type: 'object',
      required: ['chat', 'prompt'],
      properties: {
        chat: { type: 'string' },
        prompt: { type: 'string' },
        document: { type: 'string', description: 'Work on this document instead of the chat\'s current one.' },
        dispatch: { type: 'string', enum: ['queue', 'steer', 'interrupt'] },
        wait_seconds: { type: 'integer', minimum: 0, maximum: WAIT_MAX },
      },
    },
  },
  {
    name: 'answer_question',
    description:
      'Answer what a running Marble chat is waiting on (read_chat lists it under waiting_on). For a permission, allow or deny it; ' +
      'for a question with options, give answers as {"<question>": "<chosen label or your own words>"}.',
    inputSchema: {
      type: 'object',
      required: ['chat', 'question_id'],
      properties: {
        chat: { type: 'string' },
        question_id: { type: 'string' },
        allow: { type: 'boolean', description: 'For a permission: true to let it run, false to refuse (default true).' },
        answers: { type: 'object', additionalProperties: { type: 'string' } },
        wait_seconds: { type: 'integer', minimum: 0, maximum: WAIT_MAX },
      },
    },
  },
  {
    name: 'stop_chat',
    description: 'Stop a Marble chat\'s running turn. What it already changed stays, with Undo in Marble.',
    annotations: { destructiveHint: true },
    inputSchema: { type: 'object', required: ['chat'], properties: { chat: { type: 'string' } } },
  },
];

const INSTRUCTIONS =
  'Marble Drive is the owner\'s drive of documents that are also apps (one HTML file each). Read with list_documents and ' +
  'read_document. To change anything, start_chat with the document: a Marble agent makes the change with its own tools, undo ' +
  'and history, and the owner sees it live. Each result carries a link to open the document or chat in Marble.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clampWait = (value, fallback = WAIT_DEFAULT) => {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? Math.max(0, Math.min(WAIT_MAX, Math.round(n))) : fallback;
};
const docLink = (origin, docPath) => (origin && docPath ? `${origin}/a/${docPath.split('/').map(encodeURIComponent).join('/')}` : null);
/** The chat on the Agents page, which opens the one `open` names. */
const chatLink = (origin, id) => (origin ? `${origin}/a/Agents?open=${id}` : null);

export function createMcp({ agents, read, hasDocument, log = console }) {
  const { store, runner } = agents ?? {};

  /** The turn's own words: what it was asked, what it said, and what it is
   *  waiting on, from the transcript. */
  function turnOf(record, events) {
    const mine = events.filter((e) => e.turn === record.id);
    const settled = new Set(mine.filter((e) => e.type === 'ask.answered' || e.type === 'ask.void').map((e) => e.requestId));
    const reply = mine.filter((e) => e.type === 'text').map((e) => e.text).join('\n\n');
    const waiting = OPEN.has(record.status)
      ? mine.filter((e) => e.type === 'ask' && !settled.has(e.requestId)).map((e) => ({
        question_id: e.requestId,
        kind: e.tool === 'AskUserQuestion' ? 'question' : 'permission',
        tool: e.displayName ?? e.tool,
        ...(e.tool === 'AskUserQuestion'
          ? { questions: (e.input?.questions ?? []).map((q) => ({ question: q.question, options: (q.options ?? []).map((o) => o.label) })) }
          : { input: e.input }),
      }))
      : [];
    return {
      turn: record.id,
      status: record.status,
      prompt: String(record.prompt ?? '').slice(0, 4000),
      reply: reply.length > REPLY_MAX ? `…${reply.slice(-REPLY_MAX)}` : reply,
      ...(record.error ? { error: record.error } : {}),
      ...(waiting.length ? { waiting_on: waiting } : {}),
    };
  }

  async function chatOf(id, { turns = 3 } = {}, origin) {
    const meta = await store.summary(id);
    if (!meta) return null;
    const [records, events] = await Promise.all([store.turns(id), store.events(id)]);
    return {
      chat: id,
      title: meta.title ?? null,
      document: meta.target ?? null,
      running: Boolean(meta.running),
      activity: meta.activity ?? null,
      link: chatLink(origin, id),
      document_link: docLink(origin, meta.target),
      turns: records.slice(-turns).map((record) => turnOf(record, events)),
    };
  }

  /** Until the turn ends, it asks something, or the wait is up. */
  async function settle(turnId, seconds) {
    const until = Date.now() + seconds * 1000;
    for (;;) {
      const record = await store.turn(turnId);
      if (!record || !OPEN.has(record.status)) return;
      if (Date.now() >= until) return;
      const events = await store.events(record.conversationId);
      if (turnOf(record, events).waiting_on) return;
      await sleep(POLL_MS);
    }
  }

  async function report(conversationId, turnId, origin) {
    const chat = await chatOf(conversationId, { turns: 1 }, origin);
    const last = chat.turns.find((t) => t.turn === turnId) ?? chat.turns.at(-1);
    return {
      ...chat,
      turns: undefined,
      ...last,
      ...(last && OPEN.has(last.status) && !last.waiting_on ? { note: 'Still working. read_chat shows where it got to.' } : {}),
    };
  }

  const docPathOf = (value) => parsePath(String(value).replace(/\.mrbl$/, ''), { allowRoot: false });

  const handlers = {
    list_documents: (input) => read('list_documents', input),

    async read_document(input, { origin }) {
      const result = await read('read_document', { ...input, path: input.path ? docPathOf(input.path) : input.path });
      return result.error ? result : { ...result, link: docLink(origin, result.path) };
    },

    async list_chats(input, { origin }) {
      const limit = Math.max(1, Math.min(100, Number(input.limit) || 20));
      let list = await store.conversations();
      if (input.running) list = list.filter((c) => c.running);
      return {
        chats: list
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
          .slice(0, limit)
          .map((c) => ({
            chat: c.id,
            title: c.title ?? null,
            document: c.target ?? null,
            running: Boolean(c.running),
            activity: c.activity ?? null,
            outcome: c.lastOutcome ?? null,
            updated: c.updatedAt ? new Date(c.updatedAt).toISOString() : null,
            link: chatLink(origin, c.id),
          })),
      };
    },

    async read_chat(input, { origin }) {
      const chat = await chatOf(String(input.chat ?? ''), { turns: Math.max(1, Math.min(20, Number(input.turns) || 3)) }, origin);
      return chat ?? { error: `no chat "${input.chat}"` };
    },

    async start_chat(input, { origin }) {
      const prompt = String(input.prompt ?? '').trim();
      if (!prompt) return { error: 'a prompt is required' };
      const target = input.document ? docPathOf(input.document) : 'Chat';
      if (input.document && !(await hasDocument(target))) return { error: `no document "${target}"` };
      const title = String(input.title ?? '').trim().slice(0, 80) || null;
      const { id, turn } = await agents.startRun({ prompt, target, title, surface: input.document ? null : 'chat' });
      await settle(turn.turnId, clampWait(input.wait_seconds));
      return report(id, turn.turnId, origin);
    },

    async send_to_chat(input, { origin }) {
      const id = String(input.chat ?? '');
      const meta = await store.conversation(id);
      if (!meta) return { error: `no chat "${id}"` };
      const prompt = String(input.prompt ?? '').trim();
      if (!prompt) return { error: 'a prompt is required' };
      const target = input.document ? docPathOf(input.document) : meta.target ?? 'Chat';
      const context = { viewing: null, target, selection: [], also: [] };
      if (target === 'Chat') context.surface = 'chat';
      const { turnId } = await runner.send(id, { prompt, context, dispatch: input.dispatch });
      await settle(turnId, clampWait(input.wait_seconds));
      return report(id, turnId, origin);
    },

    async answer_question(input, { origin, client }) {
      const id = String(input.chat ?? '');
      const records = await store.turns(id);
      const events = await store.events(id);
      const ask = events.find((e) => e.type === 'ask' && e.requestId === input.question_id);
      if (!ask) return { error: `chat "${id}" is not waiting on "${input.question_id}"` };
      const record = records.find((r) => r.id === ask.turn);
      if (!record || !turnOf(record, events).waiting_on?.some((w) => w.question_id === ask.requestId)) {
        return { error: 'that question has already been answered or has gone' };
      }
      let response;
      if (ask.tool === 'AskUserQuestion') {
        const answers = input.answers && typeof input.answers === 'object' ? input.answers : null;
        if (!answers) return { error: 'this one is a question: give answers as {"<question>": "<answer>"}' };
        response = { behavior: 'allow', updatedInput: { ...ask.input, answers } };
      } else {
        response = input.allow === false ? { behavior: 'deny', message: `Refused from ${client}` } : { behavior: 'allow' };
      }
      await runner.answer(record.id, ask.requestId, response);
      await settle(record.id, clampWait(input.wait_seconds));
      return report(id, record.id, origin);
    },

    async stop_chat(input) {
      const id = String(input.chat ?? '');
      const running = (await store.turns(id)).filter((t) => OPEN.has(t.status));
      if (!running.length) return { stopped: false, note: 'nothing was running' };
      for (const turn of running.reverse()) await runner.cancel(turn.id);
      return { stopped: true };
    },
  };

  const CHAT_TOOLS = new Set(['list_chats', 'read_chat', 'start_chat', 'send_to_chat', 'answer_question', 'stop_chat']);
  const schemas = agents ? SCHEMAS : SCHEMAS.filter((s) => !CHAT_TOOLS.has(s.name));

  async function callTool(name, input, ctx) {
    const handler = Object.hasOwn(handlers, name) && schemas.some((s) => s.name === name) ? handlers[name] : null;
    if (!handler) return { error: `no tool "${name}"` };
    try {
      return await handler(input ?? {}, ctx);
    } catch (err) {
      log.error?.(`[connector] ${name}: ${err.message}`);
      return { error: err.message };
    }
  }

  /** One JSON-RPC message in, its answer out (null for a notification). */
  async function answer(message, ctx) {
    const { id, method, params } = message ?? {};
    const reply = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, text) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: text } });
    if (!message || message.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'not a JSON-RPC 2.0 request');
    if (id === undefined || id === null) return null;
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'marble-drive', title: 'Marble Drive', version: '0.1.0' },
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: schemas });
      case 'tools/call': {
        const result = await callTool(String(params?.name ?? ''), params?.arguments, ctx);
        return reply({
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: Boolean(result?.error),
        });
      }
      default:
        return fail(-32601, `no method "${method}"`);
    }
  }

  /** A body is one message or, from an older client, a batch of them. */
  async function handle(body, ctx) {
    if (!Array.isArray(body)) return answer(body, ctx);
    const answers = (await Promise.all(body.map((m) => answer(m, ctx)))).filter(Boolean);
    return answers.length ? answers : null;
  }

  return { handle, schemas };
}
