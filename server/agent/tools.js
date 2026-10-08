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

import { collectSlices, guardOps, idsOfOps, OP, repairOps, validateOps } from '../engine.js';
import { IDS_MAX, MODELS, SHARDS_MAX, SHARDS_MIN, runFanOut, targetsOf } from '../change/fanout.js';
import { anchorsOf, MARKS_MAX, marksOf, mergeMarks, PLACES, SHAPES, STATES } from '../change/marks.js';
import { partsOf, parseStep } from '../change/parts.js';
import { parsePath, splitPath } from '../paths.js';
import { inverseSteps } from './inverse.js';
import { MAX_HOP, MAX_SENDS, MAX_TEXT, WAIT_DEFAULT, WAIT_MAX, WAIT_MIN } from './messages.js';
import { hashesOf, idsIn, indexOf, topLevelIds } from './source.js';

const READ_BUDGET = 24_000;
const REFUSAL_BUDGET = 12_000;
const INNER_LIMIT = 12_000;
const REACH_MAX = 200;

// What a change draws while it runs, in the words and tools of the thing it
// changes (server/change/marks.js). Never filed: it is drawn on every open tab
// of the document and lifts when the change ends.
const MARKS = {
  type: 'object',
  description:
    'How the page shows this change while it runs, in the thing\'s own terms — drawn, never saved. ' +
    'verb and unit name the work on the tag ("Picking", ["station","stations"]); measure replaces the count when it is not parts ' +
    '({now:15, of:24, unit:"px"}); draw anchors marks to parts by id: the tool where the work is now (as "now"), what is still to ' +
    'come in its own form (as "ahead"), what was there before (as "before"). A draw given replaces the last one; [] clears it. ' +
    'Use the marble-drive:drawing-the-change skill to decide what to draw.',
  properties: {
    verb: { type: 'string', maxLength: 32, description: 'What the change is doing, in the thing\'s own words: Picking, Transposing, Redlining.' },
    unit: {
      type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2,
      description: 'What the count counts, one and many: ["bar","bars"], ["well","wells"].',
    },
    measure: {
      type: 'object',
      description: 'A measure in place of the count of parts: how far along, toward what.',
      properties: { now: { type: 'number' }, of: { type: 'number' }, unit: { type: 'string', maxLength: 12 } },
      required: ['now'],
    },
    draw: {
      type: 'array',
      maxItems: MARKS_MAX,
      items: {
        type: 'object',
        required: ['at'],
        properties: {
          at: { type: 'string', description: 'The data-marble-id of the part the mark stands on.' },
          on: { type: 'string', enum: PLACES, description: 'Over the part (default), or just above, below, before or after it.' },
          as: { type: 'string', enum: STATES, description: 'now: the tool at work (solid ink). ahead: still to come (dashed, faint). before: what was there (a faint ghost; its words struck).' },
          shape: { type: 'string', enum: SHAPES, description: 'ring hugs the part; line runs along the side named by on (over: a vertical line at x); dot sits at x,y; fill washes the part.' },
          x: { type: 'number', minimum: 0, maximum: 100, description: 'Across the part, in percent: where a dot, an over line or words sit.' },
          y: { type: 'number', minimum: 0, maximum: 100, description: 'Down the part, in percent.' },
          text: { type: 'string', maxLength: 48, description: 'A few words or a number set small in the ink: "+24 px", "Dm7", "C3".' },
          svg: { type: 'string', maxLength: 2400, description: 'SVG shapes (path, line, polyline, polygon, rect, circle, ellipse, g) in a 0–100 box stretched over the part; strokes keep their width. class may be ahead, before, fill, solid or thin.' },
          key: { type: 'string', maxLength: 24, description: 'The same key on the next call glides this mark to its new place (a cursor moving on).' },
        },
      },
    },
  },
};

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
      'rebuild your edit against that and call again. Inserted elements get ids minted for you. ' +
      'With no ops, reach, total and marks are drawn ahead of the first edit, and nothing is written. ' +
      'Example op: {"type":"setText","id":"h1","text":"New title"}.',
    inputSchema: {
      type: 'object',
      required: ['path', 'note', 'ops'],
      properties: {
        path: { type: 'string' },
        note: { type: 'string', description: 'One sentence: what this change does.' },
        ops: { type: 'array', items: OP, maxItems: 24 },
        reach: {
          type: 'array',
          items: { type: 'string' },
          maxItems: REACH_MAX,
          description: 'Ids this step will touch, sent with its first batch, so the page can show the whole reach before anything changes.',
        },
        total: {
          type: 'integer',
          minimum: 1,
          description: 'How many parts the whole change will touch, when you know it (e.g. 15 stills). The page counts toward it.',
        },
        marks: MARKS,
      },
    },
  },
  {
    name: 'fan_out',
    description:
      'Change many parts that each need their own judgment (a label per row, an icon per item, a rewrite per paragraph) ' +
      'by running one worker per shard in parallel. Every worker gets the same plan and only its shard\'s elements, ' +
      'returns edits that are checked before they land, and lands as soon as it is done. A shard that fails leaves its ' +
      'parts as they were and says why. Use it for six or more parts; for a few, use apply_ops.',
    inputSchema: {
      type: 'object',
      required: ['path', 'note', 'plan', 'shards'],
      properties: {
        path: { type: 'string' },
        note: { type: 'string', description: 'One sentence: what this change does.' },
        plan: { type: 'string', description: 'What every part should become: the one instruction every worker follows.' },
        shards: {
          type: 'array',
          minItems: SHARDS_MIN,
          maxItems: SHARDS_MAX,
          description: 'The parts, split into groups of ids that do not overlap. A worker may change only its ids and what is inside them.',
          items: {
            type: 'object',
            required: ['ids'],
            properties: {
              ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: IDS_MAX },
              brief: { type: 'string', description: 'What only this shard\'s worker needs to know.' },
            },
          },
        },
        model: { type: 'string', enum: MODELS, description: 'The workers\' model: sonnet unless the change is simple.' },
        marks: MARKS,
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
  {
    name: 'check_document',
    description:
      'Check a document against the format\'s own invariants — the ids and structure Marble needs to address it, ' +
      'affordance markers no script wires, and scripts that change the page without saving it. ' +
      'Call this after rewriting a document with your own tools. No findings means it is well formed.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
  },
  {
    name: 'affordance_script',
    description:
      'The script that makes affordance markers work, composed the way starters are. Name every affordance the ' +
      'document uses (editable, sortable, canvas, resizable, removable, add, toggle, choose, expand, step, note, ' +
      'alternatives, status); history is always included. It is one closure: put it whole in one <script> before ' +
      '</body>, and to add an affordance later, call again with the full list and replace that script.',
    inputSchema: {
      type: 'object',
      required: ['affords'],
      properties: { affords: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'build_plan',
    description:
      'Build mode only: say the plan of the build you are running, and keep it current. The page draws it as the build\'s status: ' +
      'each part with a few words, which one you are making now, which have landed. Call it before your first edit, and again ' +
      '(with every part) whenever a part starts or lands. Give `title` when the app is still called Untitled, and `folder` ' +
      'when a folder in the drive is plainly where it belongs.',
    inputSchema: {
      type: 'object',
      required: ['parts'],
      properties: {
        parts: {
          type: 'array',
          maxItems: 24,
          items: {
            type: 'object',
            required: ['title'],
            properties: {
              title: { type: 'string', maxLength: 80, description: 'The part, in a few words: "Invitations list".' },
              detail: { type: 'string', maxLength: 120, description: 'Optional: how, in a few words: "one row per invitation", "reads Bryan\'s Days".' },
              state: { type: 'string', enum: ['ahead', 'now', 'done'], description: 'ahead: still to come. now: being made. done: landed.' },
              ids: { type: 'array', items: { type: 'string' }, description: 'Optional: the data-marble-ids of the part on the page, once it is there.' },
            },
          },
        },
        title: { type: 'string', maxLength: 80, description: 'A short name for the app, when it is still Untitled.' },
        folder: { type: 'string', maxLength: 300, description: 'A folder of the drive the app belongs in, as a path.' },
      },
    },
  },
  {
    name: 'list_agents',
    description:
      'List the other agent conversations working in this project: id, title, provider, the document each works on, ' +
      'and its status (idle, queued, running, waiting for a reply, asking the person). Use an id with send_message.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_message',
    description:
      'Send a message to another agent conversation in this project. If it is idle, this starts its turn; if it is busy, ' +
      `it reads the message when its current turn ends or when it calls wait_for_reply. At most ${MAX_SENDS} messages per turn; ` +
      `a thread of replies stops after ${MAX_HOP}. Returns the message id and how it was delivered. To answer a message, pass its id as inReplyTo.`,
    inputSchema: {
      type: 'object',
      required: ['to', 'text'],
      properties: {
        to: { type: 'string', description: 'The conversation id, from list_agents or from the message you are answering.' },
        text: { type: 'string', maxLength: MAX_TEXT },
        about: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } },
          description: 'The document, and optionally the elements, this message is about.',
        },
        inReplyTo: { type: 'string', description: 'The id of the message you are answering.' },
      },
    },
  },
  {
    name: 'wait_for_reply',
    description:
      `Wait up to \`seconds\` (default ${WAIT_DEFAULT}, at most ${WAIT_MAX}) for messages from other agents. Returns them as soon as one arrives. ` +
      'A timeout means nothing has arrived yet: call again if you are still waiting, or move on.',
    inputSchema: {
      type: 'object',
      properties: { seconds: { type: 'integer', minimum: WAIT_MIN, maximum: WAIT_MAX } },
    },
  },
];

// The five small interactions are one part of the library, `state`; an agent
// names them by the attribute it wrote, not by where they are kept.
const STATE_KINDS = new Set(['toggle', 'choose', 'expand', 'step', 'note']);

export function createTools({ store, writeOps, createDocument, buildStarter, composeAffordances, guidePath, examine, onLook, messaging = null, building = null, exec, log = console }) {
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

  /** What a turn has done so far, for the page: the parts it has touched,
   *  added and removed, the size of the change and the reach of its step.
   *  A turn that fans out also keeps the groups that failed (`lost`, each
   *  with the ids it has yet to land), how many of those are still failed
   *  (`failed`), and the fan out the page was told of last (`fanout`). */
  const tallyOf = (turn) => {
    turn.v5 ??= { parts: new Set(), added: new Set(), removed: new Set(), total: null, reach: null, failed: 0, lost: [], fanout: null, marks: null };
    return turn.v5;
  };

  // Every count of groups the page is told is numbered, across all turns, so
  // a frame that crossed a newer one on the way is known for older; a new
  // fan out is a new `call`, counted from nothing.
  let fanCalls = 0;
  let groupSeq = 0;
  /** The groups of the fan out the page heard of last, as the page is told
   *  them: done and still failed, of how many. */
  const groupsOf = (v5) => {
    const fan = v5.fanout;
    if (!fan) return undefined;
    const failed = v5.lost.filter((group) => group.call === fan.call && group.left.size).length;
    return { call: fan.call, of: fan.of, done: fan.done, failed, seq: ++groupSeq };
  };
  /** A failed group whose every part has since landed, in any batch of the
   *  turn, is not failed any more. A part lands when an op names it or
   *  something inside it: changes, removes or moves it, or inserts into it.
   *  An op beside it (`beforeId`) or on what holds it is not about it. The
   *  page holds to the same rule (runtime/change-marks.js, `recover`). */
  const settleLost = (v5, ops) => {
    if (!v5.lost.length) return;
    const touched = new Set(ops.map((op) => (op.type === 'insert' ? op.parentId : op.id)).filter(Boolean));
    for (const group of v5.lost) {
      for (const id of group.left) {
        if ([...group.inside.get(id)].some((part) => touched.has(part))) group.left.delete(id);
      }
    }
    v5.failed = v5.lost.filter((group) => group.left.size).length;
  };

  /**
   * One batch of an agent's ops, landed the way every agent write lands —
   * apply_ops, and each shard of a fan out. Inside the document's queue
   * (`prepare`/`after`): repaired and validated against the document as it
   * is, refused whole if an element it edits is not what `known` says the
   * writer saw (`refusal(source, { stale, unread, gone, error })` says how —
   * `gone` are elements it saw that are no longer there), refused if the
   * write itself would refuse it, tallied for the page, and said on it
   * before and after the write; then recorded for undo, one record per
   * batch. Nothing is said or counted for a batch that will not land.
   *
   * `known` is the conversation's ledger when the agent wrote the ops itself,
   * and `learn` is that ledger again, brought up to date after the write: the
   * agent knows what it wrote. A worker's ops are checked against what the
   * worker was shown, and teach the agent nothing; it has not seen them.
   * `signal`: a batch still waiting in the queue when it aborts is refused.
   * `group`: the fan out this batch is one landed group of.
   */
  async function writeBatch(turn, docPath, { ops: given, note, step = parseStep(note), known, refusal, learn = null, total, reach, marks = null, signal = null, group = null }) {
    const client = `agent:${turn.conversationId}`;
    let steps = null;
    let introduced = [];

    const options = { client, note };
    options.prepare = async (source) => {
      if (signal?.aborted) return { refused: { reason: 'stopped', current: [], stopped: true } };
      // One parse of the document for every question this batch asks of
      // it: tags, hashes, parts, reach.
      const doc = indexOf(source);
      let ops;
      try {
        // repairOps only knows a setInner payload's own tag — and so only
        // mints ids into markup it is confident is markup — when it is
        // handed the same slices validateOps checks against.
        const slices = doc.tags();
        ops = repairOps(given, source, { slices }).ops;
        ops = validateOps(ops, source, { slices, innerLimit: INNER_LIMIT });
      } catch (err) {
        // An element the writer saw that has gone since is a change under
        // it, whatever the check that tripped over its absence.
        const gone = (Array.isArray(given) ? given : []).flatMap(targetsOf).filter((id) => known.has(id) && !doc.has(id));
        if (gone.length) return { refused: refusal(source, { stale: [], unread: [], gone: [...new Set(gone)], error: err.message }) };
        return { refused: { reason: err.message, current: [] } };
      }

      const current = doc.hashes();
      const unread = [];
      const stale = [];
      for (const op of ops) {
        if (op.type === 'insert' || !op.id) continue;
        const seen = known.get(op.id);
        if (seen === undefined) unread.push(op.id);
        else if (seen !== current.get(op.id)) stale.push(op.id);
      }
      if (stale.length || unread.length) return { refused: refusal(source, { stale, unread, gone: [] }) };

      // The write's own check, run here so that a batch it would refuse is
      // refused before anything is counted or said; the write uses its
      // result.
      let html;
      try {
        html = guardOps(source, ops);
      } catch (err) {
        return { refused: { reason: err.message, current: [] } };
      }
      // A batch that changes nothing lands nothing: nothing to count or say.
      if (html === source) {
        if (group) group.done += 1;
        return { ops, html };
      }

      // Which parts this batch touches, the step it says it is (if its note
      // names one), a running count of distinct parts this turn has
      // touched so far, and the two things an agent only has to say once —
      // `total`, the size of the whole change, and `reach`, the ids a
      // multi-batch step is about to touch — repeated here on every later
      // batch of the same turn so the page never has to remember them on
      // its own.
      const { parts, inserts, removes, moves, kind } = partsOf(source, ops, { index: doc });
      const v5 = tallyOf(turn);
      for (const id of parts) v5.parts.add(id);
      for (const entry of inserts) for (const id of entry.ids) v5.added.add(id);
      for (const id of removes) v5.removed.add(id);
      // A whole number of parts, one or more, or nothing: a wrong total is
      // never the one the page counts toward.
      if (Number.isInteger(total) && total >= 1 && v5.total === null) v5.total = total;
      if (Array.isArray(reach)) {
        v5.reach = reach.map(String).filter((id) => doc.has(id)).slice(0, REACH_MAX);
      }
      // What the change draws (v6): anchored to parts of the document, or to
      // parts this batch puts in. Given once, repeated on every later batch.
      if (marks) {
        const fresh = new Set(inserts.flatMap((entry) => entry.ids));
        v5.marks = mergeMarks(v5.marks, marksOf(marks, { has: (id) => doc.has(id) || fresh.has(id) }));
      }
      settleLost(v5, ops);
      if (group) v5.fanout = group;
      const before = groupsOf(v5);
      if (group) group.done += 1;
      const after = groupsOf(v5);

      const presence = {
        phase: 'writing',
        note,
        turn: turn.id,
        parts,
        inserts,
        removes,
        moves,
        kind,
        step,
        count: v5.parts.size,
        total: v5.total,
        reach: v5.reach,
        ...(v5.marks ? { marks: v5.marks } : {}),
      };

      steps = inverseSteps(source, ops, { index: doc });
      introduced = ops.filter((op) => op.type === 'insert').flatMap((op) => idsIn(op.html));
      onLook?.(docPath, idsOfOps(ops), client, { ...presence, ...(before ? { groups: before } : {}), stage: 'before' });
      options.presence = { ...presence, ...(after ? { groups: after } : {}), stage: 'after' };
      return { ops, html };
    };
    if (learn) {
      options.after = (_before, next) => {
        const ids = [...learn.keys(), ...introduced];
        const now = hashesOf(next, ids);
        for (const id of ids) {
          if (now.has(id)) learn.set(id, now.get(id));
          else learn.delete(id);
        }
      };
    }

    const result = await writeOps(docPath, [], options);

    if (result.refused) {
      // A stop is the turn ending, not something refused.
      if (!result.refused.stopped) turn.onEvent({ type: 'ops.refused', path: docPath, reason: result.refused.reason });
      return { refused: result.refused };
    }
    if (steps && result.applied) {
      turn.undo.push({ path: docPath, steps });
      turn.onEvent({ type: 'ops.applied', path: docPath, count: result.applied });
    }
    return { applied: result.applied, introduced };
  }

  /** A step's reach, the size of the change and its marks, said ahead of
   *  its first edit (`apply_ops` with no ops): the page tints the reach and
   *  draws the marks before anything moves. Nothing is written, recorded or
   *  counted as changed. */
  async function markAhead(turn, docPath, input) {
    const source = await store.read(docPath);
    if (source === null) return { error: `no document "${docPath}"` };
    const doc = indexOf(source);
    const v5 = tallyOf(turn);
    if (Number.isInteger(input.total) && input.total >= 1 && v5.total === null) v5.total = input.total;
    if (Array.isArray(input.reach)) v5.reach = input.reach.map(String).filter((id) => doc.has(id)).slice(0, REACH_MAX);
    if (input.marks) v5.marks = mergeMarks(v5.marks, marksOf(input.marks, { has: (id) => doc.has(id) }));
    const note = String(input.note ?? '').trim();
    const ids = [...new Set([...(v5.reach ?? []), ...anchorsOf(v5.marks)])];
    onLook?.(docPath, ids, `agent:${turn.conversationId}`, {
      phase: 'writing',
      stage: 'mark',
      note,
      turn: turn.id,
      step: parseStep(note),
      count: v5.parts.size,
      total: v5.total,
      reach: v5.reach,
      ...(v5.marks ? { marks: v5.marks } : {}),
    });
    return { applied: 0, marked: { reach: v5.reach?.length ?? 0, draw: v5.marks?.draw?.length ?? 0 } };
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
      const client = turn?.conversationId ? `agent:${turn.conversationId}` : 'agent';

      // Small enough to hand over whole, which is also the one read that makes
      // every element in the document known.
      if (!ids && source.length <= READ_BUDGET) {
        const known = hashesOf(source);
        for (const [id, h] of known) ledger.set(id, h);
        onLook?.(docPath, [...known.keys()], client, { phase: 'reading', turn: turn.id });
        return { path: docPath, whole: true, source };
      }

      const slices = collectSlices(source, ids ?? topLevelIds(source), { budget: READ_BUDGET });
      remember(ledger, source, slices);
      onLook?.(docPath, slices.map((slice) => slice.id), client, { phase: 'reading', turn: turn.id });
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
      // No ops: the reach, the size and the marks of what comes next, drawn
      // before anything moves. Nothing is written or recorded.
      if (Array.isArray(input.ops) && input.ops.length === 0 && (input.marks || input.reach || input.total)) {
        return markAhead(turn, docPath, input);
      }
      const ledger = ledgerFor(turn.conversationId, docPath);
      const landed = await writeBatch(turn, docPath, {
        ops: input.ops,
        note: input.note,
        known: ledger,
        learn: ledger,
        total: input.total,
        reach: input.reach,
        marks: input.marks,
        refusal: (source, { stale, unread, gone, error }) => {
          // Gone since it was read: what the checks said, as before.
          if (gone.length) return { reason: error, current: [] };
          const blocked = [...new Set([...stale, ...unread])];
          const reason = stale.length
            ? `${stale.map((id) => `"${id}"`).join(', ')} changed since you read ${stale.length === 1 ? 'it' : 'them'} — nothing was applied. Here is the current source; rebuild the edit against it.`
            : `read ${unread.map((id) => `"${id}"`).join(', ')} before editing — nothing was applied. Here is the current source.`;
          const shown = collectSlices(source, blocked, { budget: REFUSAL_BUDGET });
          // The refusal is a read of what it shows in full, and only that: an
          // element cut to an outline, or left out for budget, is still unread.
          remember(ledger, source, shown);
          return { reason, current: shown.map(({ id, tag, html, shape }) => ({ id, tag, html, outline: Boolean(shape) })) };
        },
      });
      if (landed.refused) return { refused: true, ...landed.refused };
      return { applied: landed.applied, introduced: landed.introduced };
    },

    // Many parts that each need their own judgment (server/change/fanout.js):
    // a worker per shard, and each shard landed through `writeBatch` as its
    // own batch the moment its worker is done — checked against what that
    // worker was shown, said on the page as one part of n, undone with the
    // rest of the turn. A shard that fails is said on the page too, so its
    // parts keep their marks.
    async fan_out(input, turn) {
      const docPath = parsePath(String(input.path ?? ''), { allowRoot: false });
      if (!turn.writable.has(docPath)) {
        return { error: `"${docPath}" is not writable in this turn — the target is "${turn.target}"` };
      }
      const source = await store.read(docPath);
      if (source === null) return { error: `no document "${docPath}"` };
      const client = `agent:${turn.conversationId}`;
      const note = String(input.note ?? '').trim() || 'Change each part.';
      const step = parseStep(note);
      const shards = Array.isArray(input.shards) ? input.shards : [];
      const all = [...new Set(shards.flatMap((shard) => (Array.isArray(shard?.ids) ? shard.ids.map(String) : [])))];
      // This fan out's groups: how many have landed, of how many. Its failed
      // ones are kept on the turn (`lost`), where a later batch can land them.
      const fan = { call: ++fanCalls, of: shards.length, done: 0 };
      const signal = turn.abort?.signal;
      // What the fan out draws while its workers run (v6): the words of its
      // tag, and marks on the parts as they stand now. Every group's frame
      // carries them.
      if (input.marks) {
        const doc = indexOf(source);
        const v5 = tallyOf(turn);
        v5.marks = mergeMarks(v5.marks, marksOf(input.marks, { has: (id) => doc.has(id) }));
      }

      const result = await runFanOut({
        source,
        docPath,
        plan: input.plan,
        note,
        shards: input.shards,
        model: input.model,
        exec,
        signal,
        log,
        apply: async (k, ops, { known }) => {
          if (!ops.length) {
            fan.done += 1;
            return { applied: 0 };
          }
          const landed = await writeBatch(turn, docPath, {
            ops,
            note: `${note} · part ${k + 1} of ${shards.length}`,
            step,
            known,
            total: all.length,
            reach: all,
            signal,
            group: fan,
            refusal: (_source, { stale, gone }) => ({
              reason: stale.length || gone.length ? 'changed while it worked' : 'edited a part it was not shown whole',
              current: [],
            }),
          });
          return landed.refused ? { error: landed.refused.reason } : { applied: landed.applied };
        },
        onFailed: (_k, ids, _error, { inside }) => {
          const v5 = tallyOf(turn);
          v5.fanout = fan;
          v5.lost.push({ call: fan.call, ids, left: new Set(ids), inside });
          v5.failed = v5.lost.filter((group) => group.left.size).length;
          v5.total ??= all.length;
          onLook?.(docPath, ids, client, {
            phase: 'writing',
            note,
            turn: turn.id,
            stage: 'after',
            failed: ids,
            count: v5.parts.size,
            total: v5.total,
            reach: v5.reach ?? all.slice(0, REACH_MAX),
            groups: groupsOf(v5),
            ...(v5.marks ? { marks: v5.marks } : {}),
          });
        },
      });

      if (result.error) return { error: result.error };
      if (result.missing && !result.applied) {
        return { error: 'the claude CLI is not installed on this host, so no workers can run: make these edits yourself with apply_ops' };
      }
      return { applied: result.applied, shards: result.shards };
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

    async check_document(input) {
      const { docPath, source } = await readable(input);
      // The same question `app.js` asks of a document arriving from outside,
      // asked on demand — a full agent rewriting a file is a document arriving
      // from outside, it just happens to be one we started.
      return { path: docPath, findings: examine(`${splitPath(docPath).name}.mrbl`, source) ?? [] };
    },

    // A document written from scratch has markers and nothing reading them,
    // because the host ships no affordances. This is the starters' own
    // composition, Drive overrides included, handed over as text: the parts are
    // pieces of one closure, so copying one out of lib/affordances.js by hand is
    // how a document ends up with a syntax error instead of a checkbox.
    async affordance_script(input) {
      if (!composeAffordances) return { error: 'this host cannot compose affordances' };
      const affords = (Array.isArray(input.affords) ? input.affords : []).map(String);
      const parts = [...new Set(['history', ...affords.map((a) => (STATE_KINDS.has(a) ? 'state' : a))])];
      const script = await composeAffordances(parts);
      return {
        affords,
        script: `// Affordances: ${parts.join(', ')} — composed from Marble's lib/affordances.js. One closure: replace it whole.\n${script}`,
      };
    },

    // Messaging lives on the runner, which is created after the tools; the
    // host fills `messaging` in once it exists. Until then, and on a host
    // without agents, these answer plainly.
    async list_agents(_input, turn) {
      if (!messaging?.peers) return { error: 'messaging is not available on this host' };
      return messaging.peers(turn);
    },

    async send_message(input, turn) {
      if (!messaging?.deliver) return { error: 'messaging is not available on this host' };
      return messaging.deliver(turn, {
        to: input.to,
        text: input.text,
        about: input.about ?? null,
        inReplyTo: input.inReplyTo ?? null,
      });
    },

    // Build mode's plan (server/build): bound once the builds exist.
    async build_plan(input, turn) {
      if (!building?.plan) return { error: 'Build mode is not available on this host' };
      return building.plan(turn, input);
    },

    async wait_for_reply(input, turn) {
      if (!messaging?.wait) return { error: 'messaging is not available on this host' };
      return messaging.wait(turn, input.seconds);
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
