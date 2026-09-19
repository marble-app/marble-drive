import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/agent-phone.js';

const P = () => globalThis.marbleAgentPhone;

test('bandOf puts every summary in exactly one band, asking first', () => {
  assert.equal(P().bandOf({ asking: true, running: true }), 'asks');
  assert.equal(P().bandOf({ running: true }), 'running');
  assert.equal(P().bandOf({ queued: true }), 'running');
  assert.equal(P().bandOf({ needsReview: true }), 'review');
  assert.equal(P().bandOf({ lastOutcome: 'changes' }), 'idle');
  assert.equal(P().bandOf({}), 'idle');
  assert.equal(P().bandOf({ archived: true, asking: true }), null);
});

test('bandCompare: asks oldest first, the rest most recent first', () => {
  const a = { updatedAt: 1 };
  const b = { updatedAt: 2 };
  assert.ok(P().bandCompare('asks')(a, b) < 0);
  assert.ok(P().bandCompare('running')(a, b) > 0);
  assert.ok(P().bandCompare('review')({ lastFinishedAt: 5, updatedAt: 1 }, { lastFinishedAt: 3, updatedAt: 9 }) < 0);
  assert.ok(P().bandCompare('idle')(a, b) > 0);
});

test('askLead is the last two text or tool.call events before the ask', () => {
  const events = [
    { seq: 1, type: 'user', text: 'go' },
    { seq: 2, type: 'text', text: 'Reading the file' },
    { seq: 3, type: 'tool.call', name: 'Read', input: { file_path: 'a.js' } },
    { seq: 4, type: 'tool.result', ok: true },
    { seq: 5, type: 'text', text: 'Now I will build' },
    { seq: 6, type: 'ask', requestId: 'r1' },
    { seq: 7, type: 'text', text: 'after' },
  ];
  assert.deepEqual(P().askLead(events, 6), [
    { type: 'tool.call', name: 'Read', input: { file_path: 'a.js' } },
    { type: 'text', text: 'Now I will build' },
  ]);
  assert.deepEqual(P().askLead(events, 2), []);
});

test('peekOf shows a command, a path with new lines, or the tool', () => {
  assert.deepEqual(P().peekOf({ kind: 'permission', tool: 'Bash', input: { command: 'latexmk -pdf' } }), {
    title: 'Bash', detail: 'latexmk -pdf', lines: [],
  });
  const edit = P().peekOf({ kind: 'permission', tool: 'Edit', input: { file_path: 'runtime/x.js', old_string: 'a', new_string: '1\n2\n3\n4\n5\n6\n7\n8' } });
  assert.equal(edit.title, 'Edit');
  assert.equal(edit.detail, 'runtime/x.js');
  assert.deepEqual(edit.lines, ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(P().peekOf({ kind: 'permission', tool: 'WebFetch', input: { url: 'https://x' } }), { title: 'WebFetch', detail: 'https://x', lines: [] });
  assert.equal(P().peekOf({ kind: 'question', tool: 'AskUserQuestion', input: { questions: [{ question: 'A or B?' }] } }).title, 'A or B?');
});

test('fisheye: heights fill the room, one full at an integer focal, continuous in focal', () => {
  const { fisheye } = P();
  const room = 700;
  for (const focal of [0, 1, 2.5, 5, 11]) {
    const cards = fisheye(12, focal, room);
    assert.equal(cards.length, 12);
    const total = cards[cards.length - 1].top + cards[cards.length - 1].height;
    assert.ok(Math.abs(total - room) < 0.01, `focal ${focal}: ${total}`);
  }
  const atFive = fisheye(12, 5, room);
  assert.equal(atFive.filter((c) => c.lod === 'full').length, 1);
  assert.equal(atFive[5].lod, 'full');
  assert.equal(atFive[4].lod, 'digest');
  assert.equal(atFive[3].lod, 'chip');
  assert.equal(atFive[2].lod, 'sliver');
  assert.equal(atFive[4].height, 112);
  assert.equal(atFive[3].height, 44);
  const a = fisheye(12, 5, room);
  const b = fisheye(12, 5.02, room);
  // 0.02 of a card's travel hands over ~4px of the Full's share plus what
  // the neighbours give up: continuous, not small.
  for (let i = 0; i < 12; i += 1) assert.ok(Math.abs(a[i].top - b[i].top) < 8, `card ${i} jumped`);
  const small = fisheye(12, 5, 400);
  for (let i = 0; i < 12; i += 1) if (i !== 5) assert.ok(small[i].height <= atFive[i].height + 0.01);
});

test('fisheye: one card fills the room; slivers overlap', () => {
  const one = P().fisheye(1, 0, 500);
  assert.equal(one[0].height, 500);
  const many = P().fisheye(20, 10, 700);
  assert.ok(many[0].height === 10 && many[1].top === 8, 'slivers stack 2px over');
});

test('fisheye anchor bottom: the keyboard demotes below the Full first', () => {
  const { fisheye, TIERS } = P();
  const room = 700;
  const kb = 336;
  const roomy = fisheye(12, 5, room);
  const cramped = fisheye(12, 5, room - kb, { anchor: 'bottom' });
  // Everything above the Full is where it was; the Full keeps a digest.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(cramped[i].top, roomy[i].top, `card ${i} moved`);
    assert.equal(cramped[i].height, roomy[i].height, `card ${i} resized`);
    assert.equal(cramped[i].lod, roomy[i].lod, `card ${i} changed tier`);
  }
  assert.ok(cramped[5].height >= TIERS.digest, `full ${cramped[5].height}`);
  assert.equal(cramped[5].lod, 'full');
  // Everything below the Full folds to a sliver: the composer has to sit on
  // the keyboard, and a card between them is one the thumb reaches past.
  for (let i = 6; i < 12; i += 1) assert.equal(cramped[i].lod, 'sliver', `card ${i} is ${cramped[i].lod}`);
  for (let i = 6; i < 12; i += 1) assert.ok(cramped[i].height <= roomy[i].height + 0.01, `card ${i} grew`);
  const total = cramped[11].top + cramped[11].height;
  assert.ok(Math.abs(total - (room - kb)) < 0.01, `total ${total}`);
  // Without the hint the same room takes it out of the Full instead.
  assert.ok(fisheye(12, 5, room - kb)[5].height < TIERS.digest);
});

test('fisheye anchor bottom stays continuous in focal and folds below even in a roomy stack', () => {
  const { fisheye } = P();
  const roomy = fisheye(12, 5, 700);
  const anchored = fisheye(12, 5, 700, { anchor: 'bottom' });
  for (let i = 0; i < 5; i += 1) assert.equal(anchored[i].height, roomy[i].height, `card ${i} resized`);
  for (let i = 6; i < 12; i += 1) assert.equal(anchored[i].lod, 'sliver', `card ${i} is ${anchored[i].lod}`);
  assert.ok(anchored[5].height > roomy[5].height, 'the Full takes what the cards below gave up');
  const room = 364;
  for (const focal of [0, 4.98, 5, 5.02, 8.5, 11]) {
    const cards = fisheye(12, focal, room, { anchor: 'bottom' });
    const total = cards[11].top + cards[11].height;
    assert.ok(Math.abs(total - room) < 0.01, `focal ${focal}: ${total}`);
  }
  const a = fisheye(12, 5, room, { anchor: 'bottom' });
  const b = fisheye(12, 5.02, room, { anchor: 'bottom' });
  for (let i = 0; i < 12; i += 1) assert.ok(Math.abs(a[i].top - b[i].top) < 8, `card ${i} jumped`);
});

test('pileRuns is one run per end of the column', () => {
  const { fisheye, pileRuns } = P();
  const cards = fisheye(12, 5, 700);
  const runs = pileRuns(cards);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((run) => run.side), ['top', 'bottom']);
  assert.deepEqual(runs.map((run) => run.count), [3, 4]);
  assert.equal(runs[0].top, cards[0].top);
  assert.equal(runs[0].height, cards[2].top + cards[2].height - cards[0].top);
  assert.equal(runs[1].top, cards[8].top);
  assert.equal(runs[1].height, cards[11].top + cards[11].height - cards[8].top);
  // At the top of the stack only the tail is folded, and a short stack has
  // no pile at all.
  assert.deepEqual(pileRuns(fisheye(12, 0, 700)).map((run) => run.side), ['bottom']);
  assert.deepEqual(pileRuns(fisheye(3, 1, 700)), []);
  assert.deepEqual(pileRuns([]), []);
});

test('focalFor is the inverse of fisheye', () => {
  const { fisheye, focalFor } = P();
  const room = 700;
  for (const i of [0, 3, 6, 11]) {
    for (const top of [0, 40, 120, 300, 520]) {
      const focal = focalFor(i, top, 12, room);
      const placed = fisheye(12, focal, room)[i].top;
      assert.ok(Math.abs(placed - top) < 0.5 || focal < 1e-6 || focal > 11 - 1e-6, `card ${i} wanted ${top} got ${placed} (focal ${focal})`);
    }
  }
});

test('stepSpring settles; damping .8 overshoots and damping 1 does not', () => {
  const { stepSpring } = P();
  const run = (damping) => {
    let s = { x: 0, v: 8 };
    let max = 0;
    for (let t = 0; t < 400 && !s.settled; t += 1) {
      s = stepSpring(s, 1, 1 / 120, { damping, response: 0.4 });
      max = Math.max(max, s.x);
    }
    return { s, max };
  };
  const crit = run(1);
  assert.ok(crit.s.settled && Math.abs(crit.s.x - 1) < 0.001);
  assert.ok(crit.max <= 1.003, `critical overshoot ${crit.max}`);
  const bouncy = run(0.8);
  assert.ok(bouncy.s.settled && bouncy.max > crit.max + 0.003, `bouncy max ${bouncy.max} vs ${crit.max}`);
});

test('project is zero at rest and follows the sign of velocity', () => {
  assert.equal(P().project(0), 0);
  assert.ok(P().project(300) > 0 && P().project(-300) < 0);
});
