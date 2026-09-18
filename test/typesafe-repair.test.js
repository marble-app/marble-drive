import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTypesafeDetail } from '../server/typesafe/client.js';
import { gateWithRepair, normalizeQuestion, repairTargets } from '../server/typesafe/repair.js';

test('formatTypesafeDetail reads FastAPI loc/msg entries', () => {
  const text = formatTypesafeDetail({
    detail: [
      { loc: ['body', 'questions', 'n7', 'criteria'], msg: 'Input should be a valid dictionary' },
      { loc: ['body', 'questions', 'n8', 'type'], msg: 'Input should be choice, noul, or score' },
    ],
  });
  assert.match(text, /n7\.criteria/);
  assert.match(text, /valid dictionary/);
  assert.match(text, /n8\.type/);
});

test('normalizeQuestion lowercases type and turns Choice arrays into option maps', () => {
  const choice = normalizeQuestion({
    type: 'Choice',
    text: 'Which layout?',
    criteria: ['Timeline of games', 'Cards per opponent', 'A table'],
  });
  assert.equal(choice.type, 'choice');
  assert.equal(typeof choice.criteria, 'object');
  assert.ok(!Array.isArray(choice.criteria));
  assert.ok(Object.keys(choice.criteria).length >= 3);

  const score = normalizeQuestion({
    type: 'SCORE',
    text: 'How much history?',
    criteria: { a: 'This season', b: 'Last two seasons', c: 'All-time' },
  });
  assert.equal(score.type, 'score');
  assert.ok(Array.isArray(score.criteria));
  assert.equal(score.criteria.length, 3);
});

test('repairTargets picks question ids out of a 422 body', () => {
  const nodes = [{ id: 'n7' }, { id: 'n8' }, { id: 'n9' }];
  const hit = repairTargets(nodes, {
    detail: [{ loc: ['body', 'questions', 'n8', 'criteria'], msg: 'bad' }],
  });
  assert.deepEqual(hit.map((node) => node.id), ['n8']);
});

test('gateWithRepair normalizes before the first ask', async () => {
  const nodes = [
    { id: 'n1', type: 'Choice', text: 'Which layout?', criteria: ['A', 'B', 'C'], origin: 'widget' },
  ];
  let sent;
  const answers = await gateWithRepair({
    nodes,
    ask: async (batch) => {
      sent = batch[0];
      return { n1: { type: 'choice', choice: 'a', confidence: 0.9 } };
    },
  });
  assert.equal(sent.type, 'choice');
  assert.equal(typeof sent.criteria, 'object');
  assert.equal(answers.n1.confidence, 0.9);
});

test('gateWithRepair asks Grok to rewrite only the invalid question, then retries', async () => {
  const nodes = [
    { id: 'n7', type: 'choice', text: 'Which facts?', criteria: ['score'], origin: 'widget', instructions: 'Which facts?' },
    { id: 'n8', type: 'noul', text: 'Is it upcoming?', origin: 'widget', instructions: 'Is it upcoming?' },
  ];
  const asks = [];
  const repaired = [];
  const log = [];
  const answers = await gateWithRepair({
    nodes,
    maxPasses: 2,
    onEvent: (event) => log.push(event.message),
    ask: async (batch) => {
      asks.push(JSON.parse(JSON.stringify(batch.map((node) => ({ id: node.id, criteria: node.criteria })))));
      if (asks.length === 1) {
        const err = new Error('TypeSafe HTTP 422');
        err.status = 422;
        err.body = {
          detail: [{ loc: ['body', 'questions', 'n7', 'criteria'], msg: 'Input should be a valid dictionary' }],
        };
        throw err;
      }
      return {
        n7: { type: 'choice', choice: 'score', confidence: 0.8 },
        n8: { type: 'noul', noul: 0.9 },
      };
    },
    repair: async (batch, detail) => {
      repaired.push({ ids: batch.map((node) => node.id), detail });
      return [
        {
          type: 'choice',
          text: 'Which facts should each upcoming game show?',
          criteria: { score: 'final score', record: 'team record', no_match: 'none of these' },
        },
      ];
    },
  });
  assert.equal(asks.length, 2);
  assert.deepEqual(repaired[0].ids, ['n7']);
  assert.match(repaired[0].detail, /dictionary/);
  assert.equal(nodes[0].criteria.score, 'final score');
  assert.equal(answers.n7.choice, 'score');
  assert.match(log[0], /fixing/i);
});

test('gateWithRepair does not rewrite on 429', async () => {
  let repaired = 0;
  await assert.rejects(
    () =>
      gateWithRepair({
        nodes: [{ id: 'n1', type: 'noul', text: 'x', origin: 'y' }],
        ask: async () => {
          const err = new Error('Too Many Requests');
          err.status = 429;
          throw err;
        },
        repair: async () => {
          repaired += 1;
          return [];
        },
      }),
    (err) => err.status === 429 && repaired === 0,
  );
});

test('gateWithRepair gives up after two repair passes', async () => {
  let asks = 0;
  let repairs = 0;
  await assert.rejects(
    () =>
      gateWithRepair({
        nodes: [{ id: 'n1', type: 'choice', text: 'x', criteria: { a: 'a' }, origin: 'y' }],
        maxPasses: 2,
        ask: async () => {
          asks += 1;
          const err = new Error('TypeSafe HTTP 422');
          err.status = 422;
          err.body = { detail: [{ loc: ['body', 'questions', 'n1'], msg: 'malformed' }] };
          throw err;
        },
        repair: async () => {
          repairs += 1;
          return [{ type: 'noul', text: 'Is it x?', criteria: { true: 'yes', false: 'no' } }];
        },
      }),
    (err) => err.status === 422 && /malformed/.test(err.message),
  );
  assert.equal(asks, 3);
  assert.equal(repairs, 2);
});
