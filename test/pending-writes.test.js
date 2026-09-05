import assert from 'node:assert/strict';
import test from 'node:test';

import { createPendingWrites } from '../server/pending-writes.js';

test('a mark is taken exactly once', () => {
  const pending = createPendingWrites();
  pending.mark('doc', 'sha-a');

  assert.equal(pending.take('doc', 'sha-a'), true);
  assert.equal(pending.take('doc', 'sha-a'), false, 'a second look does not find the same mark twice');
});

test('an unmarked hash is a stranger, never mistaken for our own', () => {
  const pending = createPendingWrites();
  assert.equal(pending.take('doc', 'never-written'), false);
});

// The whole reason this exists: a second write's bookkeeping must never erase
// the first's. Two marks for the same document, in the order two overlapping
// saves would file them, and the settle check for the *first* one arrives last
// — exactly what happens when its own save was the slow one.
test('two of our own writes in flight at once are both still recognised, in either order', () => {
  const pending = createPendingWrites();
  pending.mark('doc', 'sha-a');
  pending.mark('doc', 'sha-b');

  // The second write's rename settles first — it was the faster one.
  assert.equal(pending.take('doc', 'sha-b'), true);
  // The first write's settle check runs after, against what is now a doc that
  // has already moved on twice. It must still be recognised as ours.
  assert.equal(pending.take('doc', 'sha-a'), true);
});

test('identical content written twice is accounted for once per write, not merged', () => {
  const pending = createPendingWrites();
  pending.mark('doc', 'same-sha');
  pending.mark('doc', 'same-sha');

  assert.equal(pending.take('doc', 'same-sha'), true);
  assert.equal(pending.take('doc', 'same-sha'), true, 'the second identical write is still ours');
  assert.equal(pending.take('doc', 'same-sha'), false, 'nothing is left to claim a third time');
});

test('documents do not share a namespace', () => {
  const pending = createPendingWrites();
  pending.mark('doc-a', 'sha-x');

  assert.equal(pending.take('doc-b', 'sha-x'), false, 'the same bytes in a different document are not ours');
  assert.equal(pending.take('doc-a', 'sha-x'), true);
});

test('a mark follows a document across a move, the way lastKnown does', () => {
  const pending = createPendingWrites();
  pending.mark('scratch', 'sha-a');

  pending.move('scratch', 'archive/scratch');

  assert.equal(pending.take('scratch', 'sha-a'), false, 'the old address no longer holds it');
  assert.equal(pending.take('archive/scratch', 'sha-a'), true, 'the new address does');
});

test('moving a document with nothing pending is a no-op', () => {
  const pending = createPendingWrites();
  assert.doesNotThrow(() => pending.move('nowhere', 'elsewhere'));
});

test('a mark nobody ever confirms expires rather than shadowing a later coincidence forever', async () => {
  const pending = createPendingWrites({ ttl: 20 });
  pending.mark('doc', 'sha-a');

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(pending.take('doc', 'sha-a'), false, 'the stale registration has expired');
});
