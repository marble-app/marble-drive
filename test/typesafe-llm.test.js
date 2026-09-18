import assert from 'node:assert/strict';
import test from 'node:test';

import { complete, resolveGrokHigh, shapePrompt, splitPrompt, textFromCursor } from '../server/typesafe/llm.js';

test('resolveGrokHigh prefers 4.8 high and otherwise takes the newest Grok high', () => {
  assert.equal(
    resolveGrokHigh(['cursor-grok-4.6-high', 'cursor-grok-4.8-high', 'cursor-grok-4.8-high-fast']),
    'cursor-grok-4.8-high',
  );
  assert.equal(
    resolveGrokHigh(['cursor-grok-4.5-high', 'cursor-grok-4.6-high', 'cursor-grok-4.6-xhigh']),
    'cursor-grok-4.6-high',
  );
});

test('textFromCursor reads assistant stream-json and otherwise returns the raw stdout', () => {
  assert.equal(textFromCursor('{"type":"noul","text":"Is it small?"}'), '{"type":"noul","text":"Is it small?"}');
  const line = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: '[{"type":"noul","text":"A"}]' }] },
  });
  assert.equal(textFromCursor(`${line}\n`), '[{"type":"noul","text":"A"}]');
});

test('complete forwards stdout chunks to onChunk', async () => {
  const chunks = [];
  const text = await complete({
    prompt: 'hi',
    exec: async (command, args, opts) => {
      if (args[0] === 'models') {
        return { code: 0, stdout: 'cursor-grok-4.8-high\n', stderr: '', missing: false };
      }
      opts.onStdout?.('Why: it is a count.\n');
      opts.onStdout?.('{"type":"noul","text":"Is it small?"}');
      return {
        code: 0,
        stdout: 'Why: it is a count.\n{"type":"noul","text":"Is it small?"}',
        stderr: '',
        missing: false,
      };
    },
    onChunk: (delta) => chunks.push(delta),
  });
  assert.deepEqual(chunks, ['Why: it is a count.\n', '{"type":"noul","text":"Is it small?"}']);
  assert.match(text, /Is it small/);
});

const WIDGET = 'Create a UI widget that shows San Francisco 49ers games and how they are doing against each opponent.';

test('shapePrompt keeps a make/show task on the user\'s goal, not a domain fact', () => {
  const prompt = shapePrompt(WIDGET);
  assert.match(prompt, /Create a UI widget that shows San Francisco 49ers games/);
  assert.match(prompt, /must still be a decision the original task needs/i);
  assert.match(prompt, /must not replace a make, show, or design task with a domain fact/i);
  assert.match(prompt, /must not drop any part of the task because code can filter, list, or look it up/i);
  assert.match(prompt, /prefer type "choice" when the task is to make, show, or choose an interface/i);
  assert.match(prompt, /if a System One model could answer from world knowledge without deciding the user's goal, rewrite/i);
});

test('splitPrompt cuts independent dimensions of the original task', () => {
  const prompt = splitPrompt({
    origin: WIDGET,
    type: 'score',
    confidence: 0.4,
    text: 'How well are the 49ers doing against this opponent?',
  });
  assert.match(prompt, /Create a UI widget that shows San Francisco 49ers games/);
  assert.match(prompt, /independent dimensions of the original task/i);
  assert.match(prompt, /do not paraphrase the current question/i);
  assert.match(prompt, /if the original task is to make, show, or design an interface, at least one child must be about that interface/i);
  assert.match(prompt, /no child may forget the original task/i);
});
