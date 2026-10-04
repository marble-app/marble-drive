// Taking back one turn of an agent's work without taking back yours.
//
// Two mechanisms behind one button. Ops writes keep exact inverse-op undo:
// each step only runs if the element is still exactly what the agent left, so
// an element somebody edited afterwards is theirs now. File writes undo by
// restore point: the document goes back to where it started, in one move, and
// its inverse ops are then skipped so they cannot undo a second time.
//
// The on-disk record used to be a bare array of `{ path, steps }`. New records
// are `{ steps, restores }`. `normalizeUndo` reads both.

import { applyOp } from '../engine.js';
import { stepsOf } from './inverse.js';
import { indexOf, topLevelIds } from './source.js';

export function normalizeUndo(saved) {
  if (!saved) return { steps: [], restores: [] };
  if (Array.isArray(saved)) return { steps: saved, restores: [] };
  return {
    steps: Array.isArray(saved.steps) ? saved.steps : [],
    restores: Array.isArray(saved.restores) ? saved.restores : [],
  };
}

/** Take back one turn: restore what it rewrote whole, run the inverse of
 *  every op it made, and keep anything a person changed since. `saveRedo(turn,
 *  record)` hears what would do it all again when there is something to do;
 *  when there is not (nothing ran, or the turn was only restored), the
 *  turn's old redo is dropped (`dropRedo(turn)`) instead, so there is
 *  nothing to redo. Neither failing fails the undo: it is said in `log`. */
export async function undoTurn({ records, restores = [], writeOps, restore, client, turn = null, look = null, saveRedo = null, dropRedo = null, log = console }) {
  const restored = new Set();
  let reverted = 0;
  let kept = 0;
  const errors = [];
  // The other direction, built as this one runs: for every inverse actually
  // applied, the inverse of *that* — read from the page right before and
  // right after it ran, the same parses the undo makes to check each step —
  // is what would do it again. One entry per path, same shape as an undo
  // record, so a later redo is just this fed back in.
  const redoByPath = [];

  // A document the agent rewrote with its own tools goes back to where it
  // started, in one move. Its inverse ops are then skipped: the restore has
  // already taken them back, and replaying them would undo a second time.
  for (const { path: docPath, sha } of restores) {
    try {
      await restore(docPath, sha, { client });
      restored.add(docPath);
      reverted += 1;
    } catch (err) {
      errors.push(`${docPath}: ${err.message}`);
    }
  }

  const byPath = new Map();
  for (const record of records) {
    if (restored.has(record.path)) continue;
    byPath.set(record.path, [...(byPath.get(record.path) ?? []), ...record.steps]);
  }

  for (const [docPath, steps] of [...byPath].reverse()) {
    let skipped = 0;
    let redoSteps = [];
    const options = { client };
    options.prepare = async (source) => {
      let current = source;
      const ops = [];
      const ids = [];
      skipped = 0;
      redoSteps = [];
      // One parse of each state of the page, made when a step first asks
      // of it. The parse that checks a step is the parse right after the
      // step before it, which is when that step's redo is finished.
      let doc = null;
      let ran = null; // the last inverse applied, and the parse right before it
      const now = () => {
        if (!doc) {
          doc = indexOf(current);
          if (ran) redoSteps.push(...stepsOf(ran.op, ran.before, doc));
          ran = null;
        }
        return doc;
      };
      for (const step of steps.slice().reverse()) {
        if (!step.inverse) {
          skipped += 1;
          continue;
        }
        const before = now();
        const moved = step.absent && before.hashOf(step.absent) !== undefined;
        const edited = step.id && step.expect && before.hashOf(step.id) !== step.expect;
        if (moved || edited) {
          skipped += 1;
          continue;
        }
        try {
          current = applyOp(current, step.inverse);
          ops.push(step.inverse);
          ran = { op: step.inverse, before };
          doc = null;
          // Undoing a `remove` reinserts the element: its inverse is an
          // `insert` addressed by `parentId`/`beforeId`, with no top-level
          // `.id` of its own — the id is inside `html`, the same place
          // `partsOf` reads a fresh insert's roots from.
          if (step.inverse.type === 'insert') ids.push(...topLevelIds(step.inverse.html));
          else if (step.inverse.id) ids.push(step.inverse.id);
        } catch {
          skipped += 1;
        }
      }
      if (ran) now();
      look?.(docPath, ids, { stage: 'before', turn, parts: ids });
      options.presence = { stage: 'after', turn, parts: ids };
      return { ops };
    };
    try {
      const result = await writeOps(docPath, [], options);
      reverted += result.applied;
      kept += skipped;
      if (redoSteps.length) redoByPath.push({ path: docPath, steps: redoSteps });
    } catch (err) {
      kept += steps.length;
      errors.push(`${docPath}: ${err.message}`);
    }
  }

  // A record with nothing in it would make Redo look possible when there is
  // nothing to redo: an undo that ran nothing (or only restored) leaves none.
  if (turn) {
    try {
      if (redoByPath.length) await saveRedo?.(turn, { steps: redoByPath, restores: [] });
      else await dropRedo?.(turn);
    } catch (err) {
      log.error?.(`[agents] could not keep the redo of ${turn}: ${err.message}`);
    }
  }

  return { reverted, kept, errors };
}
