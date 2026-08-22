import assert from 'node:assert/strict';
import test from 'node:test';

import { docKey, isInside, joinPath, parsePath, resolveUnder, splitPath, unKey } from '../server/paths.js';

test('a flat name still parses, so nothing Marble accepted stops working', () => {
  assert.equal(parsePath('paper'), 'paper');
  assert.equal(parsePath('weekly-notes.v2'), 'weekly-notes.v2');
});

test('slashes are folders now, and the edges are trimmed', () => {
  assert.equal(parsePath('work/q3/notes'), 'work/q3/notes');
  assert.equal(parsePath('/work/q3/'), 'work/q3');
  assert.equal(parsePath('  work/q3  '), 'work/q3');
});

test('the root is a legal path and the empty name is not', () => {
  assert.equal(parsePath(''), '');
  assert.throws(() => parsePath('', { allowRoot: false }), /required/);
});

test('traversal is refused in every spelling', () => {
  for (const bad of ['../secrets', 'work/../../etc', '..', 'work/..', 'a/./b']) {
    assert.throws(() => parsePath(bad), /not a folder|usable/, bad);
  }
});

test('the shapes that break on some filesystem or other are refused here', () => {
  assert.throws(() => parsePath('work//notes'), /empty segment/);
  assert.throws(() => parsePath('work\\notes'), /separator/);
  assert.throws(() => parsePath('work/notes.'), /dot or a space/);
  // The whole string is trimmed first, so this is about a segment that ends in
  // a space *inside* the path, which is the one a rename can actually produce.
  assert.throws(() => parsePath('work /notes'), /dot or a space/);
  assert.equal(parsePath('work/notes '), 'work/notes');
  // A leading dot never passes the segment grammar, so the bookkeeping folder
  // is unreachable twice over — by shape here, and by name in RESERVED.
  assert.throws(() => parsePath('.marble/x'), /usable|reserved/);
  assert.throws(() => parsePath('a/'.repeat(20) + 'b'), /deep/);
  assert.throws(() => parsePath(`work/${'x'.repeat(65)}`), /longer than/);
});

test('resolveUnder refuses to leave the drive even if the grammar were bypassed', () => {
  assert.equal(resolveUnder('/drive', 'work/notes'), '/drive/work/notes');
  assert.throws(() => resolveUnder('/drive', '../etc/passwd'), /outside the drive/);
});

test('splitting, joining and containment', () => {
  assert.deepEqual(splitPath('work/q3/notes'), { parent: 'work/q3', name: 'notes' });
  assert.deepEqual(splitPath('notes'), { parent: '', name: 'notes' });
  assert.equal(joinPath('', 'work', 'notes'), 'work/notes');
  assert.equal(isInside('work/notes', 'work'), true);
  assert.equal(isInside('workshop/notes', 'work'), false);
  assert.equal(isInside('notes', ''), true);
  assert.equal(isInside('work', 'work'), false);
});

test('the history key is flat and reversible', () => {
  assert.equal(docKey('work/q3/notes'), 'work%2Fq3%2Fnotes');
  assert.equal(unKey(docKey('work/q3/notes')), 'work/q3/notes');
  assert.ok(!docKey('work/q3/notes').includes('/'));
});
