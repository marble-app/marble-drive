import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOp, applyOps } from '../server/engine.js';
import { inverseSteps } from '../server/agent/inverse.js';
import { watchParses } from '../server/agent/source.js';
import { conversationHasReview, listReview, reviewPartsOf } from '../server/change/review.js';

const DOC = `<!doctype html><html><head></head><body data-marble-id="b">
<h1 data-marble-id="h">Original</h1>
<p data-marble-id="p" class="old">Text</p>
<ul data-marble-id="ul"><li data-marble-id="l1">One</li><li data-marble-id="l2">Two</li></ul>
</body></html>`;

const find = (parts, id) => parts.find((part) => part.id === id);

test('an insert is an added part', () => {
  const op = { type: 'insert', parentId: 'ul', beforeId: null, html: '<li data-marble-id="n1">New</li>' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'n1'), { id: 'n1', kind: 'added' });
});

test('setText is a words part, carrying the old text as before', () => {
  const op = { type: 'setText', id: 'h', text: 'Changed' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'h'), { id: 'h', kind: 'words', before: 'Original' });
});

test('setAttr on class is a look part, carrying the old value', () => {
  const op = { type: 'setAttr', id: 'p', name: 'class', value: 'new' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'p'), { id: 'p', kind: 'look', name: 'class', before: 'old' });
});

test('setAttr on a plain attribute is an attr part', () => {
  const op = { type: 'setAttr', id: 'p', name: 'title', value: 'hi' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'p'), { id: 'p', kind: 'attr', name: 'title', before: null });
});

test('a remove is a removed part, with the html and where it was', () => {
  const op = { type: 'remove', id: 'l1' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'l1'), {
    id: 'l1',
    kind: 'removed',
    html: '<li data-marble-id="l1">One</li>',
    parentId: 'ul',
    beforeId: 'l2',
  });
});

test('a move is a moved part, naming where it was', () => {
  const op = { type: 'move', id: 'l2', parentId: 'b', beforeId: null };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.deepEqual(find(parts, 'l2'), { id: 'l2', kind: 'moved', parentId: 'ul', beforeId: null });
});

test('the first step for an id wins when the turn touched it twice', () => {
  const ops = [
    { type: 'setAttr', id: 'p', name: 'class', value: 'mid' },
    { type: 'setAttr', id: 'p', name: 'class', value: 'new' },
  ];
  const steps = inverseSteps(DOC, ops);
  const after = applyOp(applyOp(DOC, ops[0]), ops[1]);
  const parts = reviewPartsOf({ source: after, steps });
  // The original value ("old") survives, not the mid-turn value ("mid").
  assert.deepEqual(find(parts, 'p'), { id: 'p', kind: 'look', name: 'class', before: 'old' });
});

test('a part is dropped when the person changed it since', () => {
  const op = { type: 'setText', id: 'h', text: 'Changed' };
  const steps = inverseSteps(DOC, [op]);
  const afterTurn = applyOp(DOC, op);
  const afterPerson = applyOp(afterTurn, { type: 'setText', id: 'h', text: 'Mine' });
  const parts = reviewPartsOf({ source: afterPerson, steps });
  assert.equal(find(parts, 'h'), undefined);
});

test('a part is dropped when its element is now absent', () => {
  const op = { type: 'insert', parentId: 'ul', beforeId: null, html: '<li data-marble-id="n1">New</li>' };
  const steps = inverseSteps(DOC, [op]);
  const afterTurn = applyOp(DOC, op);
  const afterPerson = applyOp(afterTurn, { type: 'remove', id: 'n1' });
  const parts = reviewPartsOf({ source: afterPerson, steps });
  assert.equal(find(parts, 'n1'), undefined);
});

test('a removed part survives even though its element is, correctly, gone', () => {
  const op = { type: 'remove', id: 'l1' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.equal(find(parts, 'l1')?.kind, 'removed');
});

test('setInner that leaves addressed children inside is a changed part, not words', () => {
  const op = { type: 'setInner', id: 'ul', html: '<li data-marble-id="l1">One</li><li data-marble-id="l3">Three</li>' };
  const steps = inverseSteps(DOC, [op]);
  const after = applyOp(DOC, op);
  const parts = reviewPartsOf({ source: after, steps });
  assert.equal(find(parts, 'ul')?.kind, 'changed');
});

// A page of twenty rows, every one of them renamed by one turn.
const ROWS = Array.from({ length: 20 }, (_, i) => `<li data-marble-id="r${i}">Row ${i}</li>`).join('\n');
const LONG = `<!doctype html><html><head></head><body data-marble-id="b">\n<ul data-marble-id="rows">\n${ROWS}\n</ul>\n</body></html>`;
const RENAMES = Array.from({ length: 20 }, (_, i) => ({ type: 'setText', id: `r${i}`, text: `Renamed ${i}` }));

/** How many times `run` parses exactly `source`. */
async function parsesOf(source, run) {
  let parses = 0;
  watchParses((text) => {
    if (text === source) parses += 1;
  });
  try {
    await run();
  } finally {
    watchParses(null);
  }
  return parses;
}

test('a turn is read against one parse of the page, however many parts it changed', async () => {
  const steps = inverseSteps(LONG, RENAMES);
  const after = applyOps(LONG, RENAMES);
  let parts;
  const parses = await parsesOf(after, () => {
    parts = reviewPartsOf({ source: after, steps });
  });
  assert.equal(parts.length, 20);
  assert.equal(parses, 1, 'one parse for twenty parts');
});

/** A store with one conversation and `n` finished turns, each the same
 *  renames of `LONG` (`doc`), for the host half of review. */
function storeOf(n, { doc = 'long' } = {}) {
  const now = Date.now();
  const conversation = { id: 'c1', lastReviewedAt: null };
  const turns = Array.from({ length: n }, (_, k) => ({
    id: `c1-t${k}`, conversationId: 'c1', status: 'completed', applied: 20, finishedAt: now - k * 1000,
    prompt: 'rename the rows', context: { target: doc },
  }));
  const record = { steps: [{ path: doc, steps: inverseSteps(LONG, RENAMES) }], restores: [] };
  return {
    conversations: async () => [conversation],
    conversation: async () => conversation,
    turns: async () => turns,
    undoRecords: async () => record,
  };
}

test('every turn listed for a page is read against one parse of it', async () => {
  const after = applyOps(LONG, RENAMES);
  const store = storeOf(3);
  let listed;
  const parses = await parsesOf(after, async () => {
    listed = await listReview({ store, docPath: 'long', read: async () => after });
  });
  assert.equal(listed.turns.length, 3);
  assert.equal(parses, 1, 'one parse for three turns of twenty parts');
});

test('asking whether a conversation has anything left to review parses each page once', async () => {
  const after = applyOps(LONG, RENAMES);
  const store = storeOf(3);
  // Every turn's parts are theirs now: nothing to find, so every turn is asked.
  const theirs = applyOps(after, RENAMES.map((op) => ({ ...op, text: `Mine ${op.id}` })));
  let has;
  const parses = await parsesOf(theirs, async () => {
    has = await conversationHasReview({ store, read: async () => theirs, conversationId: 'c1' });
  });
  assert.equal(has, false);
  assert.equal(parses, 1);
});

test('a page that no turn touched is not parsed at all', async () => {
  const store = storeOf(2, { doc: 'other' });
  const parses = await parsesOf(LONG, async () => {
    assert.deepEqual(await listReview({ store, docPath: 'long', read: async () => LONG }), { turns: [] });
  });
  assert.equal(parses, 0);
});

test('a before too long to send is sent as its words, cut, and says so', () => {
  const big = Array.from({ length: 800 }, (_, i) => `<li data-marble-id="w${i}">Word number ${i} of a long list</li>`).join('');
  const doc = `<!doctype html><html><head></head><body data-marble-id="b"><ul data-marble-id="big">${big}</ul><section data-marble-id="gone" class="card">${big.replaceAll('w', 'g')}</section><p data-marble-id="small">Small</p></body></html>`;
  const ops = [
    { type: 'setInner', id: 'big', html: '<li data-marble-id="only">Only</li>' },
    { type: 'remove', id: 'gone' },
    { type: 'setText', id: 'small', text: 'Still small' },
  ];
  const steps = inverseSteps(doc, ops);
  const parts = reviewPartsOf({ source: applyOps(doc, ops), steps });

  const changed = find(parts, 'big');
  assert.equal(changed.truncated, true);
  assert.ok(changed.before.length <= 20_000, `before is ${changed.before.length} characters`);
  assert.doesNotMatch(changed.before, /</, 'its words, not its markup');
  assert.match(changed.before, /^Word number 0 of a long list/);

  const removed = find(parts, 'gone');
  assert.equal(removed.truncated, true);
  assert.ok(removed.html.length <= 20_200, `html is ${removed.html.length} characters`);
  assert.match(removed.html, /^<section data-marble-id="gone" class="card">Word number 0/, 'it keeps its own tag, so it still has a shape');
  assert.match(removed.html, /<\/section>$/);

  assert.deepEqual(find(parts, 'small'), { id: 'small', kind: 'words', before: 'Small' }, 'a short before is sent whole, unflagged');
  assert.ok(JSON.stringify(parts).length < 45_000);
});
