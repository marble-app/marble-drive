import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { loadAtlas } from '../server/genui/atlas.js';
import { answersToOps, decideDocument } from '../server/genui/decide.js';
import { extractSpace } from '../server/genui/space.js';

const FIXTURE = await fsp.readFile(new URL('./fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const atlas = await loadAtlas(new URL('./fixtures/genui/atlas.mini.json', import.meta.url));
const space = extractSpace(FIXTURE);

const answer = (choice, confidence) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });

test('an applied decision is one setAttr on the instance root with the slug', () => {
  const { ops, decisions } = answersToOps(space, { 'games.openIn': answer('pop-up', 0.9) }, { stop: 0.75 });
  assert.deepEqual(ops, [{ type: 'setAttr', id: 'games', name: 'data-open-in', value: 'pop-up' }]);
  const d = decisions.find((x) => x.id === 'games.openIn');
  assert.equal(d.applied, true);
  assert.equal(d.reason, 'applied');
  assert.equal(d.current, 'side-by-side');
  assert.equal(d.instance, 'games');
  assert.equal(d.key, 'openIn');
  assert.equal(d.probabilities['pop-up'], 0.9);
  assert.deepEqual(d.options, ['side-by-side', 'pop-up', 'new-page']);
});

test('below the stop threshold keeps the authored default', () => {
  const { ops, decisions } = answersToOps(space, { 'games.openIn': answer('pop-up', 0.6) }, { stop: 0.75 });
  assert.deepEqual(ops, []);
  assert.equal(decisions.find((x) => x.id === 'games.openIn').reason, 'kept-low-confidence');
});

test('choosing the current value is kept-unchanged, not an op', () => {
  const { ops, decisions } = answersToOps(space, { 'games.openIn': answer('side-by-side', 0.95) }, { stop: 0.75 });
  assert.deepEqual(ops, []);
  assert.equal(decisions.find((x) => x.id === 'games.openIn').reason, 'kept-unchanged');
});

test('a decision with no answer is reported, not applied; stop is per call', () => {
  const { decisions } = answersToOps(space, {}, { stop: 0.5 });
  assert.equal(decisions.length, 8);
  assert.ok(decisions.every((d) => d.reason === 'no-answer' && d.applied === false));
  const low = answersToOps(space, { 'game-card.shape': answer('horizontal', 0.55) }, { stop: 0.5 });
  assert.equal(low.ops.length, 1);
});

test('an off-menu choice throws — a wrong-shaped answer is a bug, not data', () => {
  assert.throws(() => answersToOps(space, { 'games.openIn': answer('tooltip', 0.99) }), (err) => err.status === 502 && /tooltip/.test(err.message));
});

test('decideDocument runs the whole fast path with a fake gate and never imports the LLM module', async () => {
  const seen = [];
  const ask = async ({ state, questions }) => {
    seen.push({ state, questions });
    return {
      model: 'fake',
      usage: { input_tokens: 10, output_tokens: 1 },
      answers: Object.fromEntries(Object.keys(questions).map((id) => [id, answer(id === 'games.openIn' ? 'pop-up' : Object.keys(questions[id].criteria)[0], 0.9)])),
    };
  };
  const result = await decideDocument({ source: FIXTURE, atlas, apiKey: 'tsk', context: { viewport: 'phone' }, ask });
  assert.equal(seen.length, 1, 'one request');
  assert.equal(Object.keys(seen[0].questions).length, 8);
  assert.deepEqual(seen[0].state.context, { viewport: 'phone' });
  assert.equal(result.validation.ok, true);
  assert.ok(result.ops.some((op) => op.name === 'data-open-in' && op.value === 'pop-up'));
  assert.equal(typeof result.elapsedMs, 'number');
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 1 });
  const src = await fsp.readFile(new URL('../server/genui/decide.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /typesafe\/llm\.js/, 'decide.js must not import llm.js');
  for (const file of ['atlas.js', 'space.js', 'questions.js']) {
    const other = await fsp.readFile(new URL(`../server/genui/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(other, /typesafe\/llm\.js/, `${file} must not import llm.js`);
  }
});

test('decideDocument refuses an invalid space with 422 and the issues', async () => {
  // The first "side-by-side" in the file is a CSS selector; the fact is the
  // attribute line on the section, so target that line.
  const broken = FIXTURE.replace(/\n  data-open-in="side-by-side"/, '\n  data-open-in="tooltip"');
  await assert.rejects(
    () => decideDocument({ source: broken, atlas, apiKey: 'tsk', ask: async () => ({ answers: {} }) }),
    (err) => err.status === 422 && err.issues.some((i) => i.kind === 'current-not-declared'),
  );
});

test('decideDocument on the dashboard fixture: nine decisions across three instances, one request', async () => {
  const source = await fsp.readFile(new URL('./fixtures/genui/metrics.mrbl', import.meta.url), 'utf8');
  let asked = 0;
  const ask = async ({ questions }) => {
    asked += 1;
    return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, answer(Object.keys(questions[id].criteria).at(-1), 0.8)])) };
  };
  const result = await decideDocument({ source, atlas, apiKey: 'tsk', ask });
  assert.equal(asked, 1);
  assert.equal(result.decisions.length, 9);
  assert.deepEqual([...new Set(result.decisions.map((d) => d.instance))], ['ops', 'kpi', 'trend']);
  assert.ok(result.ops.some((op) => op.id === 'ops' && op.name === 'data-arrangement' && op.value === 'story-layout'));
  assert.ok(result.ops.some((op) => op.id === 'tiles' && op.name === 'data-drill'), 'the tile role writes to the container that holds every tile');
  assert.ok(result.ops.some((op) => op.id === 'trend' && op.name === 'data-mark-type' && op.value === 'areas'));
});
