import assert from 'node:assert/strict';
import test from 'node:test';

import { parseJsonBlock } from '../server/typesafe/json.js';
import { askSystemOne, explainTypesafeFailure, questionsFromNodes } from '../server/typesafe/client.js';

test('parseJsonBlock reads a fenced array and a bare object', () => {
  assert.deepEqual(
    parseJsonBlock('Sure.\n```json\n[{"type":"noul","text":"Is it small?"}]\n```\n'),
    [{ type: 'noul', text: 'Is it small?' }],
  );
  assert.deepEqual(parseJsonBlock('{"type":"choice","text":"Which widget?"}'), {
    type: 'choice',
    text: 'Which widget?',
  });
});

test('questionsFromNodes uses each node id as the TypeSafe question key', () => {
  const questions = questionsFromNodes([
    { id: 'n1', type: 'noul', instructions: 'Is it small?' },
    {
      id: 'n2',
      type: 'choice',
      instructions: 'Which widget?',
      criteria: { stepper: 'discrete count', 'free text': 'typed' },
    },
  ]);
  assert.equal(questions.n1.type, 'noul');
  assert.equal(questions.n2.criteria.stepper, 'discrete count');
});

test('askSystemOne posts one batched System One request with the bearer key', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'jev-latest',
        answers: { n1: { type: 'noul', noul: 0.88 } },
      }),
    };
  };
  const body = await askSystemOne({
    apiKey: 'tsk_test',
    state: { origin: 'What control?' },
    questions: { n1: { type: 'noul', instructions: 'Is it small?' } },
    fetch: fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tsk_test');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.model, 'jev-latest');
  assert.equal(sent.questions.n1.type, 'noul');
  assert.equal(body.answers.n1.noul, 0.88);
});

test('askSystemOne forwards an AbortSignal to fetch', async () => {
  const ac = new AbortController();
  let seen;
  await askSystemOne({
    apiKey: 'tsk_test',
    state: { origin: 'x' },
    questions: { n1: { type: 'noul', instructions: 'y' } },
    signal: ac.signal,
    fetch: async (_url, init) => {
      seen = init.signal;
      return { ok: true, status: 200, json: async () => ({ answers: {} }) };
    },
  });
  assert.equal(seen, ac.signal);
});

test('askSystemOne surfaces a 401 as a thrown error', async () => {
  await assert.rejects(
    () =>
      askSystemOne({
        apiKey: 'bad',
        state: 'x',
        questions: { n1: { type: 'noul', instructions: 'y' } },
        fetch: async () => ({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        }),
      }),
    (err) => err.status === 401,
  );
});

test('explainTypesafeFailure names quota, auth, overload, and unreachable cases', () => {
  const rate = explainTypesafeFailure({ status: 429, message: 'Too Many Requests' });
  assert.equal(rate.kind, 'rate_limit');
  assert.match(rate.title, /rate limit/i);

  const auth = explainTypesafeFailure({ status: 401, message: 'Unauthorized' });
  assert.equal(auth.kind, 'unauthorized');
  assert.match(auth.title, /can’t access TypeSafe|can't access TypeSafe/i);

  const over = explainTypesafeFailure({ status: 529, message: 'Overloaded' });
  assert.equal(over.kind, 'overloaded');

  const key = explainTypesafeFailure({
    status: 503,
    message: 'TYPESAFE_API_KEY is not set. Put it in .env.local and restart the host.',
  });
  assert.equal(key.kind, 'no_key');

  const net = explainTypesafeFailure(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
  assert.equal(net.kind, 'unreachable');

  const invalid = explainTypesafeFailure({
    status: 422,
    message: 'TypeSafe HTTP 422',
    body: {
      detail: [{ loc: ['body', 'questions', 'n7', 'criteria'], msg: 'Input should be a valid dictionary' }],
    },
  });
  assert.equal(invalid.kind, 'invalid');
  assert.match(invalid.title, /rejected a question/i);
  assert.match(invalid.message, /n7/);
  assert.match(invalid.message, /dictionary/i);
});
