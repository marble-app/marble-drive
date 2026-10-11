// Answers become positions. A Choice above the stop threshold that differs
// from the authored default is one setAttr on the instance root; everything
// else keeps what the author wrote. An answer outside the offered criteria is
// refused outright — the same posture as json-render's evaluator and this
// repo's gateWithRepair: a wrong-shaped answer is a bug to see, not data to
// smooth over. No LLM is imported here, on purpose.

import { parseSource } from '../engine.js';
import { askSystemOne } from '../typesafe/client.js';
import { slug } from './atlas.js';
import { buildQuestions, questionId, requestedId } from './questions.js';
import { extractSpace, validateSpace } from './space.js';

const readChoice = (id, answer, options) => {
  const choice = String(answer.choice ?? '');
  if (!options.includes(choice)) {
    const err = new Error(`TypeSafe chose "${choice}" for ${id}, which is not one of: ${options.join(', ')}`);
    err.status = 502;
    throw err;
  }
  const confidence = Number(answer.confidence);
  if (typeof answer.confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    // Same posture as an off-menu choice: a confidence that is missing or
    // not a probability is the API contract changing under us, not a
    // low-confidence answer to smooth into "kept".
    const err = new Error(`TypeSafe answered ${id} with confidence ${JSON.stringify(answer.confidence)}; expected a number in [0, 1]`);
    err.status = 502;
    throw err;
  }
  return { choice, confidence, probabilities: answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : null };
};

export function answersToOps(space, answers, { stop = 0.75 } = {}) {
  const ops = [];
  const decisions = [];
  for (const instance of space.instances) {
    const rows = [];
    for (const decision of instance.decisions) {
      const id = questionId(instance, decision);
      const slugs = decision.options.map((o) => o.slug);
      const current = decision.current === null ? null : slug(decision.current);
      const row = { id, instance: instance.name, key: decision.key, current, options: slugs, choice: null, confidence: null, probabilities: null, requested: null, applied: false, reason: 'no-answer' };
      rows.push(row);
      const answer = answers?.[id];
      if (!answer) continue;
      const read = readChoice(id, answer, slugs);
      row.choice = read.choice;
      row.confidence = read.confidence;
      row.probabilities = read.probabilities;
      // What the person asked for, if anything, outranks what would be best.
      const asked = answers?.[requestedId(instance, decision)];
      if (asked) {
        const r = readChoice(requestedId(instance, decision), asked, ['none', ...slugs]);
        if (r.choice !== 'none' && r.confidence >= stop) row.requested = r.choice;
      }
      if ((instance.pins ?? []).includes(decision.key)) {
        row.reason = 'pinned';
        continue;
      }
      const target = row.requested ?? row.choice;
      if (target === current) row.reason = row.requested ? 'kept-requested' : 'kept-unchanged';
      else if (row.requested) { row.reason = 'requested'; row.applied = true; }
      else if (row.confidence < stop) row.reason = 'kept-low-confidence';
      else { row.reason = 'applied'; row.applied = true; }
    }
    // Two options across dimensions that cannot both hold: keep the more
    // confident move, drop the other. A pair the defaults already satisfy
    // is the author's problem (the validator says so).
    const value = (row) => (row.applied ? (row.requested ?? row.choice) : row.current);
    for (const pair of instance.excludes ?? []) {
      const sides = pair.map((side) => rows.find((r) => r.key === side.key));
      if (sides.some((r) => !r)) continue;
      if (!sides.every((r, i) => value(r) === pair[i].slug)) continue;
      const moved = sides.filter((r) => r.applied);
      if (!moved.length) continue;
      const weakest = [...moved].sort((a, b) => (a.requested ? 2 : a.confidence) - (b.requested ? 2 : b.confidence))[0];
      weakest.applied = false;
      weakest.reason = 'excluded';
    }
    for (const row of rows) {
      if (row.applied) ops.push({ type: 'setAttr', id: instance.marbleId, name: instance.decisions.find((x) => x.key === row.key).attr, value: row.requested ?? row.choice });
      decisions.push(row);
    }
  }
  return { ops, decisions };
}

export async function decideDocument({
  source,
  atlas,
  apiKey,
  request = null,
  context = {},
  stop = 0.75,
  signal,
  ask = askSystemOne,
} = {}) {
  const started = performance.now();
  // Parse once; validate and extract walk the same tree.
  const tree = parseSource(String(source ?? ''));
  const validation = validateSpace(tree, atlas);
  if (!validation.ok) {
    const err = new Error(`the document is not a valid app space (${validation.issues.length} issue(s))`);
    err.status = 422;
    err.issues = validation.issues;
    throw err;
  }
  const space = extractSpace(tree);
  const { state, questions } = buildQuestions(space, atlas, { request, context });
  const response = await ask({ apiKey, state, questions, signal });
  const answers = response?.answers ?? {};
  const { ops, decisions } = answersToOps(space, answers, { stop });
  return {
    validation,
    space,
    state,
    questions,
    answers,
    decisions,
    ops,
    elapsedMs: Math.round(performance.now() - started),
    usage: response?.usage ?? null,
  };
}
