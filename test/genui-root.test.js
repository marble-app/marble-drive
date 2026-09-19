import assert from 'node:assert/strict';
import test from 'node:test';

import { loadAtlas } from '../server/genui/atlas.js';
import { ROOT_PATTERNS, buildRootQuestion, decideRoot, rootOptions } from '../server/genui/root.js';

const atlas = await loadAtlas(new URL('./fixtures/genui/atlas.mini.json', import.meta.url));

test('rootOptions is the Wave 3 set filtered to what the Atlas has, with the definition as the gloss', () => {
  const options = rootOptions(atlas);
  // The mini atlas carries five of the thirteen.
  assert.deepEqual(options.map((o) => o.id), ['overview-detail', 'inbox', 'dashboard', 'chart', 'form', 'wizard'].filter((id) => ROOT_PATTERNS.includes(id) && atlas.has(id)));
  const dash = options.find((o) => o.id === 'dashboard');
  assert.equal(dash.name, 'Dashboard');
  assert.match(dash.def, /metrics/i);
});

test('buildRootQuestion asks one Choice whose criteria are exactly the available roots', () => {
  const { questions, state } = buildRootQuestion(atlas, { request: 'a dashboard for the on-call engineer', context: { viewport: 'desktop' } });
  assert.deepEqual(Object.keys(questions), ['root']);
  assert.equal(questions.root.type, 'choice');
  assert.deepEqual(Object.keys(questions.root.criteria), rootOptions(atlas).map((o) => o.id));
  assert.match(questions.root.criteria.dashboard, /^Dashboard: /);
  assert.equal(state.request, 'a dashboard for the on-call engineer');
  assert.deepEqual(state.context, { viewport: 'desktop' });
  assert.doesNotMatch(JSON.stringify(questions.root.instructions), /typesafe|confidence/i);
});

test('decideRoot returns the chosen pattern with its name, confidence and distribution', async () => {
  const seen = [];
  const ask = async (req) => {
    seen.push(req);
    return { answers: { root: { type: 'choice', choice: 'dashboard', confidence: 0.81, probabilities: { dashboard: 0.81, 'overview-detail': 0.1, chart: 0.09 } } }, usage: { input_tokens: 3, output_tokens: 1 } };
  };
  const out = await decideRoot({ atlas, apiKey: 'tsk', request: 'error rate, p95, incidents', ask });
  assert.equal(seen.length, 1);
  assert.equal(out.choice, 'dashboard');
  assert.equal(out.name, 'Dashboard');
  assert.equal(out.confidence, 0.81);
  assert.equal(out.probabilities.chart, 0.09);
  assert.ok(out.options.some((o) => o.id === 'wizard'));
  assert.equal(typeof out.elapsedMs, 'number');
});

test('decideRoot refuses an off-menu pattern, a bad confidence, and an empty request', async () => {
  await assert.rejects(() => decideRoot({ atlas, apiKey: 'tsk', request: 'x', ask: async () => ({ answers: { root: { choice: 'carousel', confidence: 0.9 } } }) }), (e) => e.status === 502 && /carousel/.test(e.message));
  await assert.rejects(() => decideRoot({ atlas, apiKey: 'tsk', request: 'x', ask: async () => ({ answers: { root: { choice: 'dashboard' } } }) }), (e) => e.status === 502 && /confidence/.test(e.message));
  await assert.rejects(() => decideRoot({ atlas, apiKey: 'tsk', request: '   ', ask: async () => ({}) }), (e) => e.status === 400);
});
