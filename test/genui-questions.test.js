import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { loadAtlas } from '../server/genui/atlas.js';
import { buildQuestions, questionId } from '../server/genui/questions.js';
import { extractSpace } from '../server/genui/space.js';

const FIXTURE = await fsp.readFile(new URL('./fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const atlas = await loadAtlas(new URL('./fixtures/genui/atlas.mini.json', import.meta.url));
const space = extractSpace(FIXTURE);

test('one Choice per decision, ids are instance.key', () => {
  const { questions } = buildQuestions(space, atlas, { context: {} });
  assert.deepEqual(Object.keys(questions), [
    'games.openIn', 'games.overviewType', 'games.detailMultiplicity', 'games.attributePlacement',
    'game-card.shape', 'game-card.media', 'game-card.actions', 'game-card.target',
  ]);
  for (const q of Object.values(questions)) assert.equal(q.type, 'choice');
  assert.equal(questionId(space.instances[1], space.instances[1].decisions[0]), 'game-card.shape');
});

test('criteria are exactly the declared slugs in declared order; Atlas gloss when the slug matches, authored gloss otherwise', () => {
  const { questions } = buildQuestions(space, atlas, { context: {} });
  const vars = atlas.sub('overview-detail', 'openIn').vars;
  assert.deepEqual(questions['games.openIn'].criteria, {
    'side-by-side': vars.get('side-by-side').gloss,
    'pop-up': vars.get('pop-up').gloss,
    'new-page': vars.get('new-page').gloss,
  });
  assert.deepEqual(Object.keys(questions['games.attributePlacement'].criteria), ['identity', 'identity-record', 'everything']);
  assert.equal(questions['games.attributePlacement'].criteria['identity-record'], 'opponent, date, and the series record on the card');
});

test('instructions carry the instance, the Atlas question and sub-dimension name, and never mention TypeSafe or confidence', () => {
  const { questions } = buildQuestions(space, atlas, { context: {} });
  const q = questions['games.openIn'];
  assert.equal(q.instructions.instance, 'games');
  assert.equal(q.instructions.pattern, 'Overview–detail');
  assert.match(q.instructions.about, /^Upcoming and recent/);
  assert.equal(q.instructions.dimension, atlas.sub('overview-detail', 'openIn').dim.q);
  assert.equal(q.instructions.subdimension, 'Overview–detail arrangement');
  assert.match(q.instructions.ask, /first show/);
  const text = JSON.stringify(q.instructions);
  assert.doesNotMatch(text, /typesafe|confidence/i);
});

test('state carries the request (call wins over document), the context verbatim, and instance summaries with children', () => {
  const { state } = buildQuestions(space, atlas, { context: { viewport: 'phone', items: 6 } });
  assert.match(state.request, /49ers games/);
  assert.deepEqual(state.context, { viewport: 'phone', items: 6 });
  assert.deepEqual(state.instances, [
    { name: 'games', pattern: 'Overview–detail', about: space.instances[0].about, children: ['game-card'] },
    { name: 'game-card', pattern: 'Card', about: space.instances[1].about, children: [] },
  ]);
  const override = buildQuestions(space, atlas, { request: 'Show only home games', context: {} });
  assert.equal(override.state.request, 'Show only home games');
});

test('a key the Atlas does not know is skipped, not asked', () => {
  const bad = { request: null, instances: [{ name: 'x', marbleId: 'x', pattern: 'card', about: null, parent: null,
    decisions: [{ key: 'colour', attr: 'data-colour', current: 'red', options: [{ slug: 'red', gloss: 'r' }, { slug: 'blue', gloss: 'b' }] }] }] };
  const { questions } = buildQuestions(bad, atlas, { context: {} });
  assert.deepEqual(questions, {});
});

test('the wizard fixture asks form\'s labels question through specializes, with form\'s wording', async () => {
  const source = await fsp.readFile(new URL('./fixtures/genui/signup.mrbl', import.meta.url), 'utf8');
  const { questions } = buildQuestions(extractSpace(source), atlas, { context: {} });
  const q = questions['signup.labels'];
  assert.ok(q);
  assert.equal(q.instructions.pattern, 'Wizard');
  assert.equal(q.instructions.dimension, atlas.sub('form', 'labels').dim.q);
  assert.deepEqual(Object.keys(q.criteria), ['top-aligned', 'left-aligned', 'floating-label']);
  assert.ok(questions['steps.labels'], 'the stepper has its own labels question');
  assert.notEqual(questions['steps.labels'].instructions.dimension, q.instructions.dimension);
});
