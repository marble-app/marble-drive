// The words and the maths under the agent status widgets: Quiet, a step in
// plain words, a turn's ticks, collisions and pace (runtime/agent-status.js).
import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-status.js';

const S = () => globalThis.marbleAgentStatus;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 1, 15, 0, 0);

test('a working chat is Quiet after the threshold, and not before', () => {
  const { stateOf, QUIET_AFTER_MS } = S();
  const chat = {
    id: 'a', running: true, turnStartedAt: NOW - 20 * MIN,
    lastStep: { t: NOW - QUIET_AFTER_MS, kind: 'run', words: 'Running a command' },
  };
  assert.equal(stateOf(chat, { now: NOW }), 'working', 'exactly at the threshold is still working');
  assert.equal(stateOf(chat, { now: NOW + 1 }), 'quiet');
  assert.equal(stateOf(chat, { now: NOW - 60_000 }), 'working');
  // The person's own threshold, when they set one.
  assert.equal(stateOf(chat, { now: NOW, quietAfterMs: 2 * MIN }), 'quiet');
  assert.equal(stateOf(chat, { now: NOW, quietAfterMs: 10 * MIN }), 'working');
});

test('a turn with no step yet is measured from its start, and a step from an earlier turn does not count', () => {
  const { stateOf } = S();
  const fresh = { running: true, turnStartedAt: NOW - 2 * MIN, lastStep: { t: NOW - 3 * HOUR, kind: 'read' } };
  assert.equal(stateOf(fresh, { now: NOW }), 'working');
  const stuck = { running: true, turnStartedAt: NOW - 9 * MIN, lastStep: null };
  assert.equal(stateOf(stuck, { now: NOW }), 'quiet');
});

test('only a running turn is ever Quiet: a question, the queue and finished chats keep their states', () => {
  const { stateOf } = S();
  const old = { t: NOW - 3 * HOUR };
  assert.equal(stateOf({ running: true, asking: true, turnStartedAt: NOW - HOUR, lastStep: old }, { now: NOW }), 'waiting');
  assert.equal(stateOf({ running: false, queued: true, lastStep: old }, { now: NOW }), 'working');
  assert.equal(stateOf({ running: false, needsReview: true, lastOutcome: 'changes', lastStep: old }, { now: NOW }), 'unseen');
  assert.equal(stateOf({ running: false, needsReview: true, lastOutcome: 'watchdog' }, { now: NOW }), 'failed');
  assert.equal(stateOf({ running: false, needsReview: false, lastStep: old }, { now: NOW }), 'idle');
  // No time to measure from: working, not quiet.
  assert.equal(stateOf({ running: true }, { now: NOW }), 'working');
});

test('a step in plain words, and what a summary keeps of it', () => {
  const { stepWords, stepOf, kindOf } = S();
  assert.equal(stepWords({ type: 'tool.call', name: 'mcp__marble__apply_ops', input: { path: 'Notes/Ai2 Project Notes.mrbl', ops: [] } }), 'Changing Ai2 Project Notes');
  assert.equal(stepWords({ type: 'tool.call', name: 'Bash', input: { command: 'npm test' } }), 'Running a command');
  assert.equal(stepWords({ type: 'tool.call', name: 'Read', input: { file_path: '/drive/Design System.mrbl' } }), 'Reading Design System');
  assert.equal(stepWords({ type: 'tool.call', name: 'mcp__browser__browser_click', input: {} }), 'Looking at the page in the browser');
  assert.equal(stepWords({ type: 'tool.call', name: 'Agent', input: {} }), 'Working with helpers');
  assert.equal(stepWords({ type: 'ask', tool: 'Bash', displayName: 'Bash' }), 'Asking you to allow Bash');
  assert.equal(stepWords({ type: 'ask', tool: 'AskUserQuestion' }), 'Asking you a question');
  assert.equal(stepWords({ type: 'text', text: 'hello' }), null);
  assert.equal(kindOf({ type: 'tool.result' }), null);

  const step = stepOf({ seq: 9, t: NOW, turn: 'abc-t2', type: 'tool.call', name: 'Write', input: { file_path: '/x/Plan.mrbl', content: 'x'.repeat(50_000) } });
  assert.deepEqual(step, { t: NOW, turn: 'abc-t2', kind: 'change', tool: 'Write', words: 'Changing Plan' });
  assert.ok(JSON.stringify(step).length < 200, 'a summary carries none of the input');
  assert.equal(stepOf({ type: 'text', t: NOW }), null);
});

test('a quiet chat says how long, and what it last did', () => {
  const { nowWords } = S();
  const chat = { running: true, turnStartedAt: NOW - 30 * MIN, lastStep: { t: NOW - 12 * MIN, words: 'Running a command' } };
  assert.equal(nowWords(chat, { now: NOW }), 'Quiet for 12 min, last running a command');
  assert.equal(nowWords({ ...chat, lastStep: { t: NOW - MIN, words: 'Changing Plan' } }, { now: NOW }), 'Changing Plan');
  // The last step belongs to an earlier turn: say the activity instead.
  assert.equal(nowWords({ running: true, turnStartedAt: NOW - MIN, activity: 'Working on Plan', lastStep: { t: NOW - HOUR, words: 'Reading' } }, { now: NOW }), 'Working on Plan');
  assert.equal(nowWords({ running: false, queued: true }, { now: NOW }), 'In the queue');
});

test('Glance leads with a question, then work, then results to read', () => {
  const { glance } = S();
  const chats = [
    { id: 'r', title: 'Read me', needsReview: true, lastOutcome: 'changes', lastFinishedAt: NOW - HOUR },
    { id: 'w', title: 'Builder', running: true, turnStartedAt: NOW - MIN, lastStep: { t: NOW - 10_000, words: 'Changing Plan' }, updatedAt: NOW },
    { id: 'q', title: 'Stuck', running: true, turnStartedAt: NOW - HOUR, lastStep: { t: NOW - 40 * MIN, words: 'Running a command' }, updatedAt: NOW - HOUR },
    { id: 'x', title: 'Filed', archived: true, asking: true },
  ];
  let g = glance(chats, { now: NOW });
  assert.equal(g.lead.state, 'working');
  assert.equal(g.lead.count, 2);
  assert.equal(g.lead.chat, 'w');
  assert.equal(g.lead.sub, 'Builder: Changing Plan');
  assert.equal(g.unread.length, 1);

  g = glance([...chats, { id: 'a', title: 'Asker', running: true, asking: true, updatedAt: NOW }], { now: NOW });
  assert.equal(g.lead.state, 'waiting');
  assert.equal(g.lead.words, 'needs you');
  assert.equal(g.lead.sub, 'Asker is waiting for you');

  g = glance([chats[0]], { now: NOW });
  assert.deepEqual([g.lead.state, g.lead.count, g.lead.words, g.lead.chat], ['unseen', 1, 'to read', 'r']);

  g = glance([], { now: NOW });
  assert.deepEqual([g.lead.state, g.lead.words, g.lead.chat], ['idle', 'Nothing working', null]);
});

test('ticks from a fixture turn: one per step, at the moment it was taken', () => {
  const { ticks } = S();
  const start = NOW - 10 * MIN;
  const events = [
    { type: 'turn.started', t: start },
    { type: 'tool.call', name: 'Read', input: {}, t: start + MIN },
    { type: 'tool.result', t: start + MIN + 500 },
    { type: 'text', text: 'Looking', t: start + 2 * MIN },
    { type: 'tool.call', name: 'Bash', input: {}, t: start + 5 * MIN },
    { type: 'tool.call', name: 'apply_ops', input: { path: 'a.mrbl' }, t: start + 9 * MIN },
  ];
  const { ticks: out, counts } = ticks(events, { start, end: NOW });
  assert.deepEqual(out.map((x) => x.kind), ['read', 'run', 'change']);
  assert.deepEqual(out.map((x) => x.at), [0.1, 0.5, 0.9]);
  assert.deepEqual(counts, { read: 1, run: 1, change: 1 });
});

test('a collision from two overlapping turns of two chats that both changed a page', () => {
  const { collisions } = S();
  const page = 'Notes/Ai2 Project Notes.mrbl';
  const a = { id: 'aaaaaaaaaaaa-t1', conversationId: 'aaaaaaaaaaaa', target: page, status: 'completed', applied: 3, startedAt: NOW - 30 * MIN, finishedAt: NOW - 10 * MIN };
  const b = { id: 'bbbbbbbbbbbb-t4', conversationId: 'bbbbbbbbbbbb', target: page, status: 'completed', applied: 1, startedAt: NOW - 20 * MIN, finishedAt: NOW - 5 * MIN };
  const found = collisions([a, b], { now: NOW });
  assert.equal(found.length, 1);
  assert.equal(found[0].path, page);
  assert.deepEqual(found[0].times.map((x) => [x.start, x.end]), [[NOW - 20 * MIN, NOW - 10 * MIN]]);
  assert.deepEqual(found[0].times[0].chats, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);

  // Not a collision: one only answered; they did not overlap; the same chat;
  // or the turn says it changed some other page.
  assert.deepEqual(collisions([a, { ...b, applied: 0 }], { now: NOW }), []);
  assert.deepEqual(collisions([a, { ...b, startedAt: NOW - 10 * MIN }], { now: NOW }), [], 'back to back is not at once');
  assert.deepEqual(collisions([a, { ...b, conversationId: a.conversationId }], { now: NOW }), []);
  assert.deepEqual(collisions([a, { ...b, changed: ['Elsewhere.mrbl'] }], { now: NOW }), []);
  // A running turn on the page counts until its end, which is now.
  const running = { ...b, status: 'running', applied: 0, finishedAt: null };
  assert.deepEqual(collisions([a, running], { now: NOW })[0].times.map((x) => [x.start, x.end]), [[NOW - 20 * MIN, NOW - 10 * MIN]]);
  // A page changed off its own target, by the turn's own list.
  const other = { ...b, target: 'Elsewhere.mrbl', changed: [page, 'Elsewhere.mrbl'] };
  assert.equal(collisions([a, other], { now: NOW })[0].path, page);
});

test('pace with half a window gone', () => {
  const { pace } = S();
  const reset = NOW + 2.5 * HOUR; // a five-hour window, half gone
  const even = pace({ id: '5h', used: 50, resetsAt: new Date(reset).toISOString() }, { now: NOW });
  assert.equal(even.even, 0.5);
  assert.equal(even.lasts, true, 'half used at half time lasts exactly');

  const slow = pace({ id: '5h', used: 30, resetsAt: reset }, { now: NOW });
  assert.equal(slow.lasts, true);
  assert.equal(slow.out, null);

  const fast = pace({ id: '5h', used: 80, resetsAt: Math.round(reset / 1000) }, { now: NOW });
  assert.equal(fast.lasts, false);
  // 80% in 2.5 h: the last 20% goes in another 37.5 minutes.
  assert.equal(fast.out, NOW + 37.5 * MIN);

  assert.equal(pace({ id: 'week', used: 10, resetsAt: NOW + 3.5 * 24 * HOUR }, { now: NOW }).even, 0.5);
  const unknown = pace({ id: '5h', used: 40, resetsAt: null }, { now: NOW });
  assert.deepEqual([unknown.even, unknown.lasts], [null, null]);
});

test('lanes and how many at once', () => {
  const { lanes } = S();
  const turns = [
    { conversationId: 'b', startedAt: NOW - 50 * MIN, finishedAt: NOW - 20 * MIN, status: 'completed' },
    { conversationId: 'a', startedAt: NOW - 60 * MIN, finishedAt: NOW - 40 * MIN, status: 'completed', applied: 2 },
    { conversationId: 'a', startedAt: NOW - 10 * MIN, finishedAt: null, status: 'running' },
  ];
  const out = lanes(turns, { from: NOW - HOUR, now: NOW });
  assert.deepEqual(out.rows.map((r) => r.cid), ['a', 'b']);
  assert.equal(out.rows[0].busy, 30 * MIN);
  assert.equal(out.peak, 2);
  assert.equal(out.peakAt, NOW - 50 * MIN);
  assert.equal(out.now, 1);
});
