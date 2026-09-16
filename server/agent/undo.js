// Taking back one turn of an agent's work without taking back yours.
//
// The records are the inverse steps `apply_ops` kept, oldest first. Undo walks
// them newest first, and each step only runs if the element is still exactly
// what the agent left: an element somebody edited afterwards is theirs now,
// and is counted as kept rather than rolled back over their work. The walk is
// simulated against the source inside the document's queue, so each step is
// checked against what the steps before it produced.

import { applyOp } from '../engine.js';
import { hashesOf } from './source.js';

export async function undoTurn({ records, writeOps, client }) {
  const byPath = new Map();
  for (const record of records) byPath.set(record.path, [...(byPath.get(record.path) ?? []), ...record.steps]);

  let reverted = 0;
  let kept = 0;
  const errors = [];

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
