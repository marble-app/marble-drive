import assert from 'node:assert/strict';
import test from 'node:test';

import { sliceTurns } from '../server/agent/slice.js';

// A conversation of `n` finished turns, t1…tn, each a prompt, a step and an
// answer, with the seq numbers a store would give them.
const conversation = (n, { open = false } = {}) => {
  const events = [];
  const add = (event) => events.push({ seq: events.length + 1, t: 1, ...event });
  for (let i = 1; i <= n; i += 1) {
    const turn = `t${i}`;
    add({ type: 'user', turn, text: `ask ${i}` });
    add({ type: 'turn.queued', turn });
    add({ type: 'turn.started', turn });
    add({ type: 'tool.call', turn, callId: `c${i}`, name: 'Read', input: {} });
    add({ type: 'text', turn, text: `answer ${i}` });
    if (!(open && i === n)) add({ type: 'turn.completed', turn });
  }
  return { events, add };
};
const turnsOf = (events) => [...new Set(events.map((e) => e.turn).filter(Boolean))];

test('the last few turns come whole, with where to ask for the ones before', () => {
  const { events } = conversation(8);
  const tail = sliceTurns(events, { last: 3 });
  assert.deepEqual(turnsOf(tail.events), ['t6', 't7', 't8']);
  assert.equal(tail.events.length, 18);
  assert.equal(tail.earlier, 't6');
  assert.deepEqual(tail.older, ['t1', 't2', 't3', 't4', 't5']);
  assert.equal(tail.seq, events.at(-1).seq);

  const before = sliceTurns(events, { last: 3, before: tail.earlier });
  assert.deepEqual(turnsOf(before.events), ['t3', 't4', 't5']);
  assert.equal(before.earlier, 't3');
  const top = sliceTurns(events, { last: 3, before: before.earlier });
  assert.deepEqual(turnsOf(top.events), ['t1', 't2']);
  assert.equal(top.earlier, null);
  assert.deepEqual(top.older, []);

  // Every event, exactly once, across the slices.
  const seen = [...top.events, ...before.events, ...tail.events].map((e) => e.seq).sort((a, b) => a - b);
  assert.deepEqual(seen, events.map((e) => e.seq));
});

test('a turn written about later travels with its turn, not with where the news landed', () => {
  const { events, add } = conversation(6);
  add({ type: 'turn.undone', turn: 't2', reverted: 3, kept: 0 });
  const tail = sliceTurns(events, { last: 2 });
  assert.ok(!tail.events.some((e) => e.turn === 't2'));
  const rest = sliceTurns(events, { last: 10, before: tail.earlier });
  assert.ok(rest.events.some((e) => e.type === 'turn.undone' && e.turn === 't2'));
  assert.equal(tail.seq, events.at(-1).seq, 'the stream starts after the newest event, wherever it went');
});

test('a turn still going is in the newest slice however far back it began', () => {
  const { events, add } = conversation(3, { open: true });
  // Two more asked while t3 runs: queued behind it.
  for (const turn of ['t4', 't5', 't6']) {
    add({ type: 'user', turn, text: turn });
    add({ type: 'turn.queued', turn });
  }
  const tail = sliceTurns(events, { last: 2 });
  assert.deepEqual(turnsOf(tail.events), ['t3', 't4', 't5', 't6']);
  assert.equal(tail.earlier, 't3');
});

test('events that belong to no turn go with the turns around them', () => {
  const { events, add } = conversation(2);
  add({ type: 'handoff', from: 'abc' });
  add({ type: 'user', turn: 't3', text: 'three' });
  add({ type: 'turn.completed', turn: 't3' });
  const lead = [{ seq: 0, type: 'handoff', to: 'x' }, ...events];
  const tail = sliceTurns(lead, { last: 1 });
  assert.deepEqual(tail.events.map((e) => e.type), ['user', 'turn.completed']);
  const middle = sliceTurns(lead, { last: 1, before: 't3' });
  assert.ok(middle.events.some((e) => e.type === 'handoff' && e.from === 'abc'), 'between t2 and t3, with t2');
  const top = sliceTurns(lead, { last: 1, before: 't2' });
  assert.ok(top.events.some((e) => e.type === 'handoff' && e.to === 'x'), 'before the first turn, with the first');
});

test('no turns asked for is the meta alone, and an empty chat is an empty slice', () => {
  const { events } = conversation(4);
  assert.deepEqual(sliceTurns(events, { last: 0 }), { events: [], earlier: null, older: [], seq: events.at(-1).seq });
  assert.deepEqual(sliceTurns([], { last: 3 }), { events: [], earlier: null, older: [], seq: 0 });
  assert.deepEqual(sliceTurns(events, { last: 3, before: 'nope' }).events, []);
});
