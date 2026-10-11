import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gateConfidence,
  questionHash,
  runPipeline,
} from '../server/typesafe/pipeline.js';

test('Noul gate confidence is how concentrated yes-vs-no is, not the yes probability', () => {
  assert.equal(gateConfidence({ type: 'noul', noul: 0.91 }), 0.91);
  assert.equal(gateConfidence({ type: 'noul', noul: 0.09 }), 0.91);
  assert.equal(gateConfidence({ type: 'noul', noul: 0.5 }), 0.5);
});

test('Choice and Score use the confidence TypeSafe already computed', () => {
  assert.equal(gateConfidence({ type: 'choice', choice: 'stepper', confidence: 0.41 }), 0.41);
  assert.equal(gateConfidence({ type: 'score', score: 1.2, confidence: 0.78 }), 0.78);
});

test('a high-confidence root is an answer and never calls decompose', async () => {
  let decomposed = 0;
  const result = await runPipeline({
    prompt: 'Is this a quantity field?',
    stop: 0.75,
    shape: async () => ({
      type: 'noul',
      text: 'Is this a quantity field?',
    }),
    gate: async (nodes) => ({
      [nodes[0].id]: { type: 'noul', noul: 0.92 },
    }),
    decompose: async () => {
      decomposed += 1;
      return [{ type: 'noul', text: 'should not run' }];
    },
  });
  assert.equal(decomposed, 0);
  assert.equal(result.root.fate, 'answer');
  assert.equal(result.root.confidence, 0.92);
  assert.deepEqual(result.root.children, []);
});

test('a low-confidence root splits, and its children are gated in one batch', async () => {
  const gateSizes = [];
  const result = await runPipeline({
    prompt: 'What control should this quantity field be?',
    stop: 0.75,
    shape: async () => ({
      type: 'choice',
      text: 'What control should this quantity field be?',
      criteria: { stepper: null, 'free text': null, slider: null, 'no match': null },
    }),
    gate: async (nodes) => {
      gateSizes.push(nodes.length);
      return Object.fromEntries(
        nodes.map((node) => [
          node.id,
          node.depth === 0
            ? { type: 'choice', choice: 'stepper', confidence: 0.41 }
            : { type: 'noul', noul: 0.88 },
        ]),
      );
    },
    decompose: async () => [
      { type: 'noul', text: 'Is the typical value a small discrete count, 1 to 12?' },
      { type: 'noul', text: 'Does the user need to compare nearby values?' },
    ],
  });
  assert.deepEqual(gateSizes, [1, 2]);
  assert.equal(result.root.fate, 'split');
  assert.equal(result.root.children.length, 2);
  assert.ok(result.root.children.every((child) => child.fate === 'answer'));
  assert.equal(result.root.children[0].origin, 'What control should this quantity field be?');
});

test('identical subquestions are gated once and share the answer', async () => {
  const gatedTexts = [];
  const result = await runPipeline({
    prompt: 'root',
    stop: 0.75,
    shape: async () => ({ type: 'noul', text: 'root' }),
    gate: async (nodes) => {
      for (const node of nodes) gatedTexts.push(node.text);
      return Object.fromEntries(
        nodes.map((node) => [
          node.id,
          node.depth === 0 ? { type: 'noul', noul: 0.4 } : { type: 'noul', noul: 0.9 },
        ]),
      );
    },
    decompose: async () => [
      { type: 'noul', text: 'Is the pointing device a finger on a small screen?' },
      { type: 'noul', text: 'Is the pointing device a finger on a small screen?' },
    ],
  });
  assert.deepEqual(
    gatedTexts,
    ['root', 'Is the pointing device a finger on a small screen?'],
  );
  assert.equal(result.root.children.length, 2);
  assert.equal(result.root.children[0].answer.noul, 0.9);
  assert.equal(result.root.children[1].answer.noul, 0.9);
  assert.equal(
    questionHash(result.root.children[0]),
    questionHash(result.root.children[1]),
  );
});

test('depth cap answers a low-confidence node instead of splitting further', async () => {
  let decomposes = 0;
  const result = await runPipeline({
    prompt: 'root',
    stop: 0.75,
    maxDepth: 1,
    shape: async () => ({ type: 'noul', text: 'root' }),
    gate: async (nodes) =>
      Object.fromEntries(nodes.map((node) => [node.id, { type: 'noul', noul: 0.4 }])),
    decompose: async (node) => {
      decomposes += 1;
      return [{ type: 'noul', text: `child of ${node.text}` }];
    },
  });
  assert.equal(decomposes, 1);
  assert.equal(result.root.fate, 'split');
  assert.equal(result.root.children[0].fate, 'cap');
  assert.equal(result.root.children[0].depth, 1);
});

test('width cap keeps only the first N children of a split', async () => {
  const result = await runPipeline({
    prompt: 'root',
    stop: 0.9,
    maxWidth: 2,
    shape: async () => ({ type: 'noul', text: 'root' }),
    gate: async (nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          node.id,
          node.depth === 0 ? { type: 'noul', noul: 0.4 } : { type: 'noul', noul: 0.95 },
        ]),
      ),
    decompose: async () => [
      { type: 'noul', text: 'a' },
      { type: 'noul', text: 'b' },
      { type: 'noul', text: 'c' },
    ],
  });
  assert.deepEqual(
    result.root.children.map((child) => child.text),
    ['a', 'b'],
  );
});

test('decompose runs at most llmCap calls at once', async () => {
  let inflight = 0;
  let peak = 0;
  const result = await runPipeline({
    prompt: 'root',
    stop: 0.9,
    llmCap: 2,
    shape: async () => ({ type: 'choice', text: 'root', criteria: { a: null, b: null } }),
    gate: async (nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          node.id,
          node.depth === 0
            ? { type: 'choice', choice: 'a', confidence: 0.2 }
            : { type: 'noul', noul: 0.95 },
        ]),
      ),
    decompose: async () => {
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inflight -= 1;
      return [{ type: 'noul', text: 'leaf' }];
    },
  });
  // One root split only — peak 1. Widen: make root emit 4 children that all split.
  assert.ok(result.root);
  assert.ok(peak <= 2);
});

test('decompose concurrency cap holds when several nodes split on the same frontier', async () => {
  let inflight = 0;
  let peak = 0;
  await runPipeline({
    prompt: 'root',
    stop: 0.9,
    llmCap: 2,
    maxDepth: 2,
    shape: async () => ({ type: 'noul', text: 'root' }),
    gate: async (nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          node.id,
          node.depth < 2 ? { type: 'noul', noul: 0.4 } : { type: 'noul', noul: 0.95 },
        ]),
      ),
    decompose: async (node) => {
      if (node.depth === 0) {
        return [
          { type: 'noul', text: 'a' },
          { type: 'noul', text: 'b' },
          { type: 'noul', text: 'c' },
          { type: 'noul', text: 'd' },
        ];
      }
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inflight -= 1;
      return [{ type: 'noul', text: `leaf-${node.text}` }];
    },
  });
  assert.equal(peak, 2);
});

test('onEvent sees the root as soon as it is shaped, then after the gate', async () => {
  const phases = [];
  await runPipeline({
    prompt: 'Is this a quantity field?',
    stop: 0.75,
    onEvent: (event) => {
      phases.push(event.phase);
    },
    shape: async () => ({ type: 'noul', text: 'Is this a quantity field?' }),
    gate: async (nodes) => ({ [nodes[0].id]: { type: 'noul', noul: 0.92 } }),
    decompose: async () => {
      throw new Error('should not decompose a high-confidence root');
    },
  });
  assert.equal(phases[0], 'shape');
  assert.ok(phases.includes('gate'));
  assert.equal(phases.at(-1), 'done');
  assert.ok(phases.indexOf('shape') < phases.indexOf('gate'));
});

test('a split appears on the tree before its children are gated', async () => {
  const events = [];
  await runPipeline({
    prompt: 'What control should this quantity field be?',
    stop: 0.75,
    onEvent: (event) => events.push(event),
    shape: async () => ({
      type: 'choice',
      text: 'What control should this quantity field be?',
      criteria: { stepper: null, 'free text': null },
    }),
    gate: async (nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          node.id,
          node.depth === 0
            ? { type: 'choice', choice: 'stepper', confidence: 0.41 }
            : { type: 'noul', noul: 0.88 },
        ]),
      ),
    decompose: async () => [
      { type: 'noul', text: 'Is the typical value a small discrete count, 1 to 12?' },
    ],
  });
  const split = events.find((event) => event.phase === 'split' && event.root?.children?.length === 1);
  assert.ok(split, 'expected a split event that already has the child');
  assert.equal(split.root.children[0].text, 'Is the typical value a small discrete count, 1 to 12?');
  assert.equal(split.root.children[0].fate, null);
});

test('a finished gate event carries the SOM answers for the theater', async () => {
  const events = [];
  await runPipeline({
    prompt: 'Is this a quantity field?',
    stop: 0.75,
    onEvent: (event) => events.push(event),
    shape: async () => ({ type: 'noul', text: 'Is this a quantity field?' }),
    gate: async (nodes) => ({ [nodes[0].id]: { type: 'noul', noul: 0.92 } }),
    decompose: async () => {
      throw new Error('should not decompose');
    },
  });
  const som = events.find((event) => event.som?.nodes?.length);
  assert.ok(som);
  assert.equal(som.phase, 'gate');
  assert.equal(som.som.stop, 0.75);
  assert.equal(som.som.nodes[0].fate, 'answer');
  assert.equal(som.som.nodes[0].confidence, 0.92);
});

test('aborting a hanging gate cancels without decomposing', async () => {
  const ac = new AbortController();
  let releaseGate;
  const hang = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let decomposed = 0;
  const running = runPipeline({
    prompt: 'root',
    stop: 0.75,
    signal: ac.signal,
    shape: async () => ({ type: 'noul', text: 'root' }),
    gate: async () => hang,
    decompose: async () => {
      decomposed += 1;
      return [{ type: 'noul', text: 'child' }];
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  ac.abort();
  await assert.rejects(running, (err) => err.code === 'CANCELLED' && /cancelled/i.test(err.message));
  assert.equal(decomposed, 0);
  releaseGate({ n1: { type: 'noul', noul: 0.4 } });
});
