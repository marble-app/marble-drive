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
import { inverseSteps } from './inverse.js';
import { hashesOf, topLevelIds } from './source.js';

export function normalizeUndo(saved) {
  if (!saved) return { steps: [], restores: [] };
  if (Array.isArray(saved)) return { steps: saved, restores: [] };
  return {
    steps: Array.isArray(saved.steps) ? saved.steps : [],
    restores: Array.isArray(saved.restores) ? saved.restores : [],
  };
}

export async function undoTurn({ records, restores = [], writeOps, restore, client, turn = null, look = null, saveRedo = null }) {
  const restored = new Set();
  let reverted = 0;
  let kept = 0;
  const errors = [];
  // The other direction, built as this one runs: for every inverse actually
  // applied, the inverse of *that* — computed fresh, from the source right
  // before it ran — is what would do it again. One entry per path, same
  // shape as an undo record, so a later redo is just this fed back in.
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
      for (const step of steps.slice().reverse()) {
        if (!step.inverse) {
          skipped += 1;
          continue;
        }
        const hashes = hashesOf(current, [step.id, step.absent].filter(Boolean));
        const moved = step.absent && hashes.has(step.absent);
        const edited = step.id && step.expect && hashes.get(step.id) !== step.expect;
        if (moved || edited) {
          skipped += 1;
          continue;
        }
        try {
          const before = current;
          current = applyOp(current, step.inverse);
          ops.push(step.inverse);
          redoSteps.push(...inverseSteps(before, [step.inverse]));
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

  if (turn && saveRedo) await saveRedo(turn, { steps: redoByPath, restores: [] });

  return { reverted, kept, errors };
}
