// What an agent can do to a drive, and nothing else.
//
// Every provider — Claude, Cursor, Codex — reaches these through the same MCP
// bridge, so the rules below are the rules whichever model is running:
//
//   - reads are free, and remembered: each element whose full source an agent
//     was shown is recorded as a hash in this conversation's ledger;
//   - an edit to an element is only accepted if the element is still what the
//     ledger says. Otherwise the batch is refused with the element's current
//     source, which is itself a read, so the retry can succeed. A person's own
//     ops never carry a precondition — they own what they are typing in;
//   - the check, the undo record and the write all happen inside the
//     document's queue (`prepare`/`after`), so nothing lands in between.
//
// The ledger lives in memory. A host restart forgets it, which costs an agent
// one refusal-and-retry per element, and is the honest answer: after a restart
// nobody knows what the agent last saw.

import fsp from 'node:fs/promises';

import { collectSlices, repairOps, validateOps } from '../engine.js';
import { parsePath, splitPath } from '../paths.js';
import { inverseSteps } from './inverse.js';
import { hashesOf, idsIn, tagsOf, topLevelIds } from './source.js';

const READ_BUDGET = 24_000;
const REFUSAL_BUDGET = 12_000;
const INNER_LIMIT = 12_000;

export const TOOL_SCHEMAS = [
  {
    name: 'list_documents',
    description: 'List the Marble documents in the drive, optionally under one folder.',
    inputSchema: { type: 'object', properties: { folder: { type: 'string' } } },
  },
  {
    name: 'read_document',
    description:
      'Read a Marble document. Without ids: the whole document, or an outline of it when it is large. ' +
      'With ids: the full source of those elements. You must have read an element in full before apply_ops can change it.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'apply_ops',
    description:
      'Change a document with Marble ops (setText, setInner, setAttr, insert, move, remove) addressed by data-marble-id. ' +
      'At most 24 ops per call. If an element changed since you read it, nothing applies and you get its current source: ' +
      'rebuild your edit against that and call again. Inserted elements get ids minted for you.',
    inputSchema: {
      type: 'object',
      required: ['path', 'note', 'ops'],
      properties: {
        path: { type: 'string' },
        note: { type: 'string', description: 'One sentence: what this change does.' },
        ops: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'create_document',
    description: 'Create a new document from a starter (doc, sheet, slides, board, canvas). It becomes editable in this turn.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' }, from: { type: 'string' } },
    },
  },
  {
    name: 'read_guide',
    description: 'Read the guide to building in Marble. Without a section: the list of sections.',
    inputSchema: { type: 'object', properties: { section: { type: 'string' } } },
  },
];

export function createTools({ store, writeOps, createDocument, buildStarter, guidePath }) {
  // conversationId → docPath → Map<id, hash>
  const ledgers = new Map();

  const ledgerFor = (conversationId, docPath) => {
    if (!ledgers.has(conversationId)) ledgers.set(conversationId, new Map());
    const docs = ledgers.get(conversationId);
    if (!docs.has(docPath)) docs.set(docPath, new Map());
    return docs.get(docPath);
  };

  /** Everything inside a slice shown whole is now known to this conversation. */
  function remember(ledger, source, slices) {
    const shown = slices.filter((s) => !s.shape).flatMap((s) => idsIn(s.html));
    for (const [id, h] of hashesOf(source, shown)) ledger.set(id, h);
  }

  const readable = async (input) => {
    const docPath = parsePath(String(input.path ?? ''), { allowRoot: false });
    const source = await store.read(docPath);
    if (source === null) throw new Error(`no document "${docPath}"`);
    return { docPath, source };
  };

  const handlers = {
    async list_documents(input) {
      const folder = input.folder ? parsePath(String(input.folder)) : '';
      const entries = await store.list({ folder, recursive: true });
      return {
        documents: entries.filter((e) => e.kind === 'doc').map((e) => ({ path: e.path, title: e.title })),
      };
    },

    async read_document(input, turn) {
      const { docPath, source } = await readable(input);
      const ledger = ledgerFor(turn.conversationId, docPath);
      const ids = Array.isArray(input.ids) && input.ids.length ? input.ids.map(String) : null;

      // Small enough to hand over whole, which is also the one read that makes
      // every element in the document known.
      if (!ids && source.length <= READ_BUDGET) {
        for (const [id, h] of hashesOf(source)) ledger.set(id, h);
        return { path: docPath, whole: true, source };
      }

      const slices = collectSlices(source, ids ?? topLevelIds(source), { budget: READ_BUDGET });
      remember(ledger, source, slices);
      return {
        path: docPath,
        whole: false,
        slices: slices.map(({ id, tag, html, shape }) => ({ id, tag, html, outline: Boolean(shape) })),
        note: slices.some((s) => s.shape)
          ? 'Elements marked outline were shortened. Read them by id before editing anything inside them.'
          : undefined,
      };
    },

    async apply_ops(input, turn) {
      const docPath = parsePath(String(input.path ?? ''), { allowRoot: false });
      if (!turn.writable.has(docPath)) {
        return { error: `"${docPath}" is not writable in this turn — the target is "${turn.target}"` };
      }
      const ledger = ledgerFor(turn.conversationId, docPath);
      let steps = null;
      let introduced = [];

      const result = await writeOps(docPath, [], {
        client: `agent:${turn.conversationId}`,
        prepare: async (source) => {
          let ops;
          try {
            // repairOps only knows a setInner payload's own tag — and so only
            // mints ids into markup it is confident is markup — when it is
            // handed the same slices validateOps checks against.
            const slices = tagsOf(source);
            ops = repairOps(input.ops, source, { slices }).ops;
            ops = validateOps(ops, source, { slices, innerLimit: INNER_LIMIT });
          } catch (err) {
            return { refused: { reason: err.message, current: [] } };
          }

          const current = hashesOf(source);
          const unread = [];
          const stale = [];
          for (const op of ops) {
            if (op.type === 'insert' || !op.id) continue;
            const known = ledger.get(op.id);
            if (known === undefined) unread.push(op.id);
            else if (known !== current.get(op.id)) stale.push(op.id);
          }
          const blocked = [...new Set([...stale, ...unread])];
          if (blocked.length) {
            for (const id of blocked) if (current.has(id)) ledger.set(id, current.get(id));
            const reason = stale.length
              ? `${stale.map((id) => `"${id}"`).join(', ')} changed since you read ${stale.length === 1 ? 'it' : 'them'} — nothing was applied. Here is the current source; rebuild the edit against it.`
              : `read ${unread.map((id) => `"${id}"`).join(', ')} before editing — nothing was applied. Here is the current source.`;
            const shown = collectSlices(source, blocked, { budget: REFUSAL_BUDGET });
            return {
              refused: { reason, current: shown.map(({ id, tag, html }) => ({ id, tag, html })) },
            };
          }

          steps = inverseSteps(source, ops);
          introduced = ops.filter((op) => op.type === 'insert').flatMap((op) => idsIn(op.html));
          return { ops };
        },
        after: (_before, next) => {
          const known = [...ledger.keys(), ...introduced];
          const now = hashesOf(next, known);
          for (const id of known) {
            if (now.has(id)) ledger.set(id, now.get(id));
            else ledger.delete(id);
          }
        },
      });

      if (result.refused) {
        turn.onEvent({ type: 'ops.refused', path: docPath, reason: result.refused.reason });
        return { refused: true, ...result.refused };
      }
      if (steps && result.applied) {
        turn.undo.push({ path: docPath, steps });
        turn.onEvent({ type: 'ops.applied', path: docPath, count: result.applied });
      }
      return { applied: result.applied, introduced };
    },

    async create_document(input, turn) {
      const docPath = parsePath(String(input.path ?? ''), { allowRoot: false });
      if (await store.has(docPath)) return { error: `"${docPath}" already exists` };
      const source = await buildStarter(String(input.from ?? 'doc'), { name: splitPath(docPath).name });
      await createDocument(docPath, source, { label: `agent:${turn.conversationId}` });
      turn.writable.add(docPath);
      return { path: docPath };
    },

    async read_guide(input) {
      const guide = await fsp.readFile(guidePath, 'utf8');
      const parts = guide.split(/^## /m).slice(1).map((part) => {
        const newline = part.indexOf('\n');
        return { title: part.slice(0, newline).trim(), text: `## ${part}` };
      });
      if (!input.section) return { sections: parts.map((p) => p.title) };
      const wanted = String(input.section).toLowerCase();
      const found = parts.find((p) => p.title.toLowerCase().includes(wanted));
      return found ? { section: found.title, text: found.text } : { error: `no section matching "${input.section}"` };
    },
  };

  async function call(name, input, turn) {
    const handler = Object.hasOwn(handlers, name) ? handlers[name] : null;
    if (!handler) return { error: `no tool "${name}"` };
    try {
      return await handler(input ?? {}, turn);
    } catch (err) {
      return { error: err.message };
    }
  }

  return {
    schemas: TOOL_SCHEMAS,
    call,
    forget: (conversationId) => ledgers.delete(conversationId),
  };
}
