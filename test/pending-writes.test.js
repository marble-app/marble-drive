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

// A second write's bookkeeping must never erase the first's before the
// watcher has looked. Writes to one document are serialized, so once the
// watcher has seen the second write's bytes, the first's can never be on disk
// again as our save: its mark is superseded and goes too.
test('two of our own writes in flight at once are both recognised until one is seen', () => {
  const pending = createPendingWrites();
  pending.mark('doc', 'sha-a');
  pending.mark('doc', 'sha-b');

  assert.equal(pending.has('doc', 'sha-a'), true);
  assert.equal(pending.has('doc', 'sha-b'), true);
  // The first write's bytes seen first: the second is still ours.
  assert.equal(pending.take('doc', 'sha-a'), true);
  assert.equal(pending.take('doc', 'sha-b'), true);
});

test('seeing a later write of ours supersedes the earlier marks', () => {
  const pending = createPendingWrites();
  pending.mark('doc', 'sha-a');
  pending.mark('doc', 'sha-b');

  assert.equal(pending.take('doc', 'sha-b'), true);
  assert.equal(pending.take('doc', 'sha-a'), false, 'the earlier save has been overwritten by our own later one');
  assert.equal(pending.size('doc'), 0);
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

// The false fork: a batch held the event loop for longer than the old 5 s
// TTL, the mark of the save before it expired, and the watcher took the host's
// own save for an edit from outside. Ours has to stay ours however late the
// watcher gets to look.
test('a mark does not expire with time', async () => {
  const pending = createPendingWrites();
  pending.mark('doc', 'sha-a');

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(pending.take('doc', 'sha-a'), true, 'still ours, however long the host was busy');
});

test('a document keeps only its newest marks', () => {
  const pending = createPendingWrites({ keep: 3 });
  for (const sha of ['a', 'b', 'c', 'd']) pending.mark('doc', sha);

  assert.equal(pending.size('doc'), 3);
  assert.equal(pending.has('doc', 'a'), false, 'the oldest was pushed out');
  assert.equal(pending.take('doc', 'd'), true);
});
