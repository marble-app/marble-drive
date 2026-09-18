// Answers become positions. A Choice above the stop threshold that differs
// from the authored default is one setAttr on the instance root; everything
// else keeps what the author wrote. An answer outside the offered criteria is
// refused outright — the same posture as json-render's evaluator and this
// repo's gateWithRepair: a wrong-shaped answer is a bug to see, not data to
// smooth over. No LLM is imported here, on purpose.

import { parseSource } from '../engine.js';
import { askSystemOne } from '../typesafe/client.js';
import { slug } from './atlas.js';
import { buildQuestions, questionId } from './questions.js';
import { extractSpace, validateSpace } from './space.js';

export function answersToOps(space, answers, { stop = 0.75 } = {}) {
  const ops = [];
  const decisions = [];
  for (const instance of space.instances) {
    for (const decision of instance.decisions) {
      const id = questionId(instance, decision);
      const answer = answers?.[id];
      const current = decision.current === null ? null : slug(decision.current);
      const row = {
        id,
        instance: instance.name,
        key: decision.key,
        current,
        options: decision.options.map((o) => o.slug),
        choice: null,
        confidence: null,
        probabilities: null,
        applied: false,
        reason: 'no-answer',
      };
      if (!answer) {
        decisions.push(row);
        continue;
      }
      const choice = String(answer.choice ?? '');
      if (!decision.options.some((o) => o.slug === choice)) {
        const err = new Error(`TypeSafe chose "${choice}" for ${id}, which is not one of: ${decision.options.map((o) => o.slug).join(', ')}`);
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
      row.choice = choice;
      row.confidence = confidence;
      row.probabilities = answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : null;
      if (choice === current) row.reason = 'kept-unchanged';
      else if (row.confidence < stop) row.reason = 'kept-low-confidence';
      else {
        row.reason = 'applied';
        row.applied = true;
        ops.push({ type: 'setAttr', id: instance.marbleId, name: decision.attr, value: choice });
      }
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
