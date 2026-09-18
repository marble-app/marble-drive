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
import { hashesOf } from './source.js';

export function normalizeUndo(saved) {
  if (!saved) return { steps: [], restores: [] };
  if (Array.isArray(saved)) return { steps: saved, restores: [] };
  return {
    steps: Array.isArray(saved.steps) ? saved.steps : [],
    restores: Array.isArray(saved.restores) ? saved.restores : [],
  };
}

export async function undoTurn({ records, restores = [], writeOps, restore, client }) {
  const restored = new Set();
  let reverted = 0;
  let kept = 0;
  const errors = [];

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
    try {
      const result = await writeOps(docPath, [], {
        client,
        prepare: async (source) => {
          let current = source;
          const ops = [];
          skipped = 0;
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
              current = applyOp(current, step.inverse);
              ops.push(step.inverse);
            } catch {
              skipped += 1;
            }
          }
          return { ops };
        },
      });
      reverted += result.applied;
      kept += skipped;
    } catch (err) {
      kept += steps.length;
      errors.push(`${docPath}: ${err.message}`);
    }
  }

  return { reverted, kept, errors };
}
