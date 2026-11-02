// How a batch made on an older version lands on the current one.
//
// The rules are the package's (`@bdhmin/marble/sync`: applyBatch, rebaseBatch,
// mergeText), so every host that serves Marble documents agrees on what two
// writers' concurrent edits come to. This file is the one place the drive
// reaches for them, and says what it does on a package that does not have
// them yet: the step-1 answer, which forks an element two writers both
// changed and applies everything else as sent.
//
//   rebase(doc, ops, { client, by, concurrent }) →
//     { ops, forks, dropped, fixIds, record, source }
//
// `doc` is an open document (`openDocument`), moved on to the result.
// `concurrent` is the change records of every batch since the sender's base by
// somebody else, oldest first (server/versions.js). With none it is exactly
// applying the batch. Every batch also runs the guard (`guardOps`): an op may
// destroy what it names, and nothing else.

import { guardOps, idsOfOps, mergeOps } from './engine.js';

let core = null;
try {
  core = await import('@bdhmin/marble/sync');
  if (typeof core.rebaseBatch !== 'function') core = null;
} catch {
  core = null; // a package from before step 2: the fallback below
}

/** Whether the package's sync core is here, or this is the step-1 fallback. */
export const hasCore = () => Boolean(core);

/** For tests: run against another implementation of the core. */
export function useCore(next) {
  const was = core;
  core = next;
  return was;
}

const KIND = { setText: 'text', setAttr: 'attr', setInner: 'inner', remove: 'remove', insert: 'insert', move: 'move', assignId: 'attr' };

/** A change record of the contract's shape for ops applied as sent, from the
 *  ops alone (no `before`): what the fallback keeps on the ring. */
function recordOf(ops, { client, by }) {
  return {
    client,
    by,
    changes: ops.map((op) => ({
      op: op.type,
      id: op.type === 'insert' ? op.parentId : op.id,
      kind: op.look ? 'look' : KIND[op.type] ?? 'inner',
      ...(op.type === 'setAttr' ? { name: op.name } : {}),
    })),
  };
}

// The step-1 rule, in the contract's shape: an element some other writer
// changed since the base, which this batch changes too, is forked; an op whose
// target another writer removed is dropped; the rest applies as sent.
function fallback(doc, ops, { client, by, concurrent }) {
  const changed = new Set();
  const removed = new Set();
  for (const record of concurrent) {
    for (const change of record?.changes ?? []) {
      if (change.kind === 'look' || !change.id) continue;
      changed.add(change.id);
      if (change.kind === 'remove') removed.add(change.id);
      for (const id of change.ids ?? []) removed.add(id);
    }
  }
  const dropped = [];
  const live = [];
  ops.forEach((op, index) => {
    const targets = [op?.id, op?.parentId, op?.type === 'move' ? op?.parentId : null].filter((id) => typeof id === 'string' && id);
    const gone = targets.find((id) => removed.has(id) && !doc.has(id));
    if (gone) dropped.push({ index, reason: 'removed', id: gone });
    else live.push(op);
  });
  // A `before` sibling that went: at the end of the parent instead.
  const ready = live.map((op) => (op?.beforeId && removed.has(op.beforeId) && !doc.has(op.beforeId) ? { ...op, beforeId: null } : op));

  const ours = new Set(idsOfOps(ready.filter((op) => !op.look)));
  const overlap = [...ours].filter((id) => changed.has(id));
  if (overlap.length) {
    const merged = mergeOps(doc.source, ready, { touchedIds: [...changed], agent: client });
    if (merged.forks.length) {
      doc.reset(merged.source);
      return {
        ops: merged.ops,
        forks: merged.forks.map((id) => ({ id, wrapper: null })),
        dropped,
        fixIds: [...merged.forks],
        record: recordOf(merged.ops, { client, by }),
        source: merged.source,
      };
    }
  }
  const source = ready.length ? guardOps(doc, ready) : doc.source;
  const fixIds = dropped.length || ready.some((op, i) => op !== live[i]) ? [...new Set(ready.filter((op, i) => op !== live[i]).map((op) => op.parentId))] : [];
  return { ops: ready, forks: [], dropped, fixIds, record: recordOf(ready, { client, by }), source };
}

const outerOf = (doc, id) => {
  try {
    if (typeof doc.outerOf === 'function') return doc.outerOf(id);
    return doc.has(id) ? doc.slice(id).html : null;
  } catch {
    return null;
  }
};

/** The elements a batch's sender has to put right, as they now are:
 *  `[{ id, html }]`, the outerHTML of each of `fixIds` in `doc`, as the
 *  carrier applies them (replace the element with that id by the html):
 *
 *   - a forked element is answered under its own id with the whole
 *     <marble-alt> that now stands where it stood (the wrapper has a fresh
 *     id the sender's copy has never seen);
 *   - only the outermost: a fix inside another one is already in it;
 *   - an element that is no longer there is `html: ""` (remove it). */
export function fixesOf(doc, fixIds, forks = []) {
  const wrapperOf = new Map();
  for (const fork of forks ?? []) if (fork && typeof fork === 'object' && fork.wrapper) wrapperOf.set(fork.id, fork.wrapper);
  const wanted = new Set([...(fixIds ?? []).filter((id) => typeof id === 'string'), ...wrapperOf.keys()]);
  const fixes = [];
  for (const id of wanted) {
    if (wrapperOf.has(id)) {
      const html = outerOf(doc, wrapperOf.get(id));
      if (html != null) {
        fixes.push({ id, html, holds: [id, wrapperOf.get(id)] });
        continue;
      }
    }
    // The fork's wrapper itself is reached through the element it wraps.
    if ([...wrapperOf.values()].includes(id)) continue;
    const html = outerOf(doc, id);
    fixes.push({ id, html: html ?? '', holds: [id] });
  }
  // Outermost only: a fix whose element sits inside another fix's html goes.
  const inside = (outer, inner) => outer !== inner && outer.html && inner.holds.some((id) => outer.html.includes(`data-marble-id="${id}"`));
  return fixes.filter((fix) => !fixes.some((other) => inside(other, fix))).map(({ id, html }) => ({ id, html }));
}

/** One batch onto the document, over what it did not see. `batch` seeds the
 *  ids the rebase mints, so every machine mints the same ones. */
export function rebase(doc, ops, { client = 'anon', by = 'person', batch = null, concurrent = [] } = {}) {
  if (core) {
    const result = core.rebaseBatch(doc, ops, { client, by, batch: batch ?? undefined, concurrent });
    return {
      ops: result.ops ?? [],
      forks: result.forks ?? [],
      dropped: result.dropped ?? [],
      fixIds: result.fixIds ?? [],
      record: result.record ?? recordOf(result.ops ?? [], { client, by }),
      source: result.source ?? doc.source,
    };
  }
  return fallback(doc, ops, { client, by, concurrent });
}
