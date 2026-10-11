// L0: which Atlas root pattern serves the request. One Choice over Monitor's
// Wave 3 root set, the Atlas definitions as glosses, the prompt as state.
// The LLM never picks the pattern; it authors the space for the one Jev chose.

import { askSystemOne } from '../typesafe/client.js';

// Monitor.mrbl's Wave 3: high-ubiquity roots, plus overview–detail's coded
// neighborhood. Not all 60 — a checkout prompt must not be forced through
// overview–detail, and sixty near-synonyms make a menu, not a decision.
export const ROOT_PATTERNS = [
  'overview-detail',
  'inbox',
  'kanban-board',
  'search-results',
  'dashboard',
  'chart',
  'form',
  'wizard',
  'settings',
  'ai-chat',
  'calendar',
  'media-player',
  'checkout',
];

const ASK =
  'Choose the design pattern whose job matches what the request asks to make or show. Pick the pattern for the screen as a whole, not a component inside it.';

export function rootOptions(atlas, ids = ROOT_PATTERNS) {
  return ids
    .filter((id) => atlas.has(id))
    .map((id) => {
      const entry = atlas.entry(id);
      return { id, name: entry.name, def: entry.def ?? '' };
    });
}

export function buildRootQuestion(atlas, { request, context = {} } = {}) {
  const options = rootOptions(atlas);
  if (options.length < 2) throw Object.assign(new Error('the Atlas has fewer than two root patterns'), { status: 503 });
  return {
    options,
    state: { request: String(request ?? ''), context: context ?? {} },
    questions: {
      root: {
        type: 'choice',
        instructions: { ask: ASK, request: 'the `request` in state', context: 'the `context` in state, if any' },
        criteria: Object.fromEntries(options.map((o) => [o.id, `${o.name}: ${o.def}`])),
      },
    },
  };
}

export async function decideRoot({ atlas, apiKey, request, context = {}, signal, ask = askSystemOne } = {}) {
  const started = performance.now();
  const req = String(request ?? '').trim();
  if (!req) throw Object.assign(new Error('a root decision needs a request'), { status: 400 });
  const { options, state, questions } = buildRootQuestion(atlas, { request: req, context });
  const response = await ask({ apiKey, state, questions, signal });
  const answer = response?.answers?.root;
  const choice = String(answer?.choice ?? '');
  if (!options.some((o) => o.id === choice)) {
    throw Object.assign(new Error(`TypeSafe chose "${choice}" for the root pattern, which is not one of: ${options.map((o) => o.id).join(', ')}`), { status: 502 });
  }
  const confidence = Number(answer.confidence);
  if (typeof answer.confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw Object.assign(new Error(`TypeSafe answered the root pattern with confidence ${JSON.stringify(answer.confidence)}; expected a number in [0, 1]`), { status: 502 });
  }
  return {
    choice,
    name: options.find((o) => o.id === choice).name,
    confidence,
    probabilities: answer.probabilities && typeof answer.probabilities === 'object' ? answer.probabilities : null,
    options,
    elapsedMs: Math.round(performance.now() - started),
    usage: response?.usage ?? null,
  };
}
