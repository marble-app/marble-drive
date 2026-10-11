#!/usr/bin/env node
// Grade a staged build. Replays a JSON list of apply_ops batches against a
// document through the same repair → validate → apply path the agent tool
// uses, and checks what "Growing the open page" promises:
//
//   whole      every batch leaves the document clean under `examine`
//   continuous every id a batch introduced is still in the final document,
//              and no batch removes an element the build itself introduced
//   named      every note names its stage ("Stage 2 of 4: …")
//   no filler  the final document carries no marker words
//   staged     three or more batches
//
//   node tools/stage-audit.mjs <document.mrbl> <batches.json>
//
// batches.json: [{ "note": "Stage 1 of 3: …", "ops": [ …apply_ops ops… ] }, …]
// Exit 1 on any failed check. Import `audit` to use it from a test.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyOps, examine, knownIds, repairOps, validateOps } from '../server/engine.js';
import { tagsOf } from '../server/agent/source.js';

const MARKERS = /\b(loading|coming soon|placeholder|todo|tbd|lorem ipsum|under construction|work in progress|stage \d+ of \d+|stage \d+\b)/i;
const STAGE = /\bstage\s+\d+\s+of\s+\d+\b/i;
// A stage may plant filler to stay whole, and owes its removal to a later stage.
// The ops cannot tell that removal from a cut — both are a `remove` of something
// this build introduced — so the note is what tells them apart. The guide asks
// the retiring stage to say so; this is that sentence, read back.
const RETIRES = /\b(retir\w*|replac\w*|swap\w*|in place of|instead of|no longer|stand-?in|placeholder|filler|empty state)\b/i;

/** Text a person reads: markup without tags, style and script. */
const readable = (source) =>
  source.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');

// The format's own reader, not a regex over the bytes: a document is free to
// write data-marble-id='x' in single quotes, and a pattern that assumed double
// ones saw a build of twenty elements as a build of one.
const idsOf = (source) => new Set(knownIds(source));

export function audit(source, batches, { name = 'document.mrbl' } = {}) {
  const checks = [];
  const fail = (check, detail) => checks.push({ check, ok: false, detail });
  const pass = (check, detail = '') => checks.push({ check, ok: true, detail });

  if (!Array.isArray(batches) || batches.length === 0) {
    fail('staged', 'no batches');
    return { ok: false, checks, stages: 0 };
  }

  let current = source;
  const before = idsOf(source);
  // What the document was already saying before this build started. A finding
  // that is standing rather than new belongs to the batch that introduced it,
  // and blaming every later batch for it buries the one that did.
  let standing = new Set((examine(name, source) ?? []).filter((f) => f.level === 'error').map((f) => f.message));
  const introduced = new Map(); // id → batch index that introduced it
  let broken = false;

  batches.forEach((batch, index) => {
    const label = `batch ${index + 1}`;
    const note = String(batch.note ?? '').trim();
    if (STAGE.test(note)) pass('named', `${label}: "${note}"`);
    else fail('named', `${label}: note does not name a stage — "${note}"`);

    // A cut: removing what this build introduced. A stage refines in place —
    // unless what it removes is filler, and its note says that is what it is.
    const retiring = RETIRES.test(note);
    for (const op of batch.ops ?? []) {
      if (op.type !== 'remove' || !introduced.has(op.id)) continue;
      const from = introduced.get(op.id) + 1;
      if (retiring) pass('continuous', `${label} retires "${op.id}" from batch ${from}, and its note says so`);
      else fail('continuous', `${label} removes "${op.id}", introduced by batch ${from} — refine it in place, or say in the note that it was filler`);
    }

    let next;
    try {
      const slices = tagsOf(current);
      const ops = validateOps(repairOps(batch.ops ?? [], current, { slices }).ops, current, { slices });
      next = applyOps(current, ops);
      const ids = idsOf(next);
      for (const id of ids) if (!before.has(id) && !introduced.has(id)) introduced.set(id, index);
      // An addressed element that vanished inside this batch without a `remove`
      // was overwritten by a setInner on its parent — the same cut by another op.
      // Either way it is gone, so it leaves the ledger: leaving it in reported
      // one disappearance again on every later batch.
      const removedHere = new Set((batch.ops ?? []).filter((op) => op.type === 'remove').map((op) => op.id));
      for (const [id, at] of [...introduced]) {
        if (at >= index || ids.has(id)) continue;
        if (!removedHere.has(id)) fail('continuous', `${label} overwrote "${id}" (introduced by batch ${at + 1}) without removing it`);
        introduced.delete(id);
      }
    } catch (err) {
      fail('whole', `${label} refused: ${err.message}`);
      broken = true;
      return;
    }
    const errors = (examine(name, next) ?? []).filter((f) => f.level === 'error').map((f) => f.message);
    const fresh = errors.filter((message) => !standing.has(message));
    standing = new Set(errors);
    if (fresh.length) fail('whole', `${label}: ${fresh.join('; ')}`);
    else pass('whole', `${label} clean`);
    current = next;
  });

  if (!broken) {
    const finalIds = idsOf(current);
    const lost = [...introduced].filter(([id]) => !finalIds.has(id));
    if (lost.length) fail('continuous', `lost by the end: ${lost.map(([id, at]) => `"${id}" (batch ${at + 1})`).join(', ')}`);
    else pass('continuous', `${introduced.size} introduced element(s) all survive`);

    const marker = readable(current).match(MARKERS);
    if (marker) fail('no filler', `final document reads "${marker[0]}"`);
    else pass('no filler', 'no marker words in the final document');
  }

  if (batches.length >= 3) pass('staged', `${batches.length} stages`);
  else fail('staged', `${batches.length} batch(es); a build shows its progress in three or more`);

  return { ok: checks.every((c) => c.ok), checks, stages: batches.length, source: current };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [docPath, batchesPath] = process.argv.slice(2);
  if (!docPath || !batchesPath) {
    console.error('usage: node tools/stage-audit.mjs <document.mrbl> <batches.json>');
    process.exit(2);
  }
  const source = await fsp.readFile(docPath, 'utf8');
  const batches = JSON.parse(await fsp.readFile(batchesPath, 'utf8'));
  const result = audit(source, batches, { name: path.basename(docPath) });
  for (const c of result.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.check.padEnd(11)} ${c.detail}`);
  console.log(result.ok ? `\npassed — ${result.stages} stages` : '\nfailed');
  process.exit(result.ok ? 0 : 1);
}
