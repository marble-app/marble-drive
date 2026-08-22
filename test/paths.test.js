import assert from 'node:assert/strict';
import test from 'node:test';

import {
  docKey,
  isInside,
  joinPath,
  parsePath,
  resolveUnder,
  safePath,
  safeSegment,
  splitPath,
  unKey,
  withoutDocExt,
} from '../server/paths.js';

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

// ------------------------------------------------- names from another grammar

test('a filename off a filesystem becomes a name this grammar accepts', () => {
  // Every one of these is an ordinary name where it came from and a refusal
  // here, and that is the whole reason `safeSegment` exists: turning a drop
  // away would be the drive refusing work somebody already has.
  assert.equal(safeSegment('Q3 Resume (final)'), 'Q3 Resume final');
  assert.equal(safeSegment('notes: draft #2'), 'notes draft 2');
  assert.equal(safeSegment('  spaced  out  '), 'spaced out');
  assert.equal(safeSegment('trailing dot.'), 'trailing dot');
  assert.equal(safeSegment('x'.repeat(200)).length, 64);
});

test('an accent is flattened rather than thrown away', () => {
  // The bytes of a name are not what a person means by it, and a folder of
  // documents off a Mac is mostly this one case.
  assert.equal(safeSegment('Résumé'), 'Resume');
  assert.equal(safeSegment('Ünterlagen'), 'Unterlagen');
});

test('a name cannot sanitise its way into the bookkeeping folder', () => {
  // Twice over: the leading dot is stripped, and the answer is run back through
  // the grammar, which would refuse `.marble` by name as well as by shape.
  assert.equal(safeSegment('.marble'), 'marble');
  assert.equal(safeSegment('..'), 'document');
  assert.equal(safeSegment('日本語'), 'document');
  assert.equal(safeSegment(''), 'document');
  for (const name of ['.marble', '../../etc', '', null]) {
    assert.equal(parsePath(safeSegment(name), { allowRoot: false }), safeSegment(name));
  }
});

test('a folder dragged in off a desktop is sanitised segment by segment', () => {
  assert.equal(safePath('Photos & Notes/Q3 Resume/'), 'Photos Notes/Q3 Resume');
  // An empty segment is dropped rather than becoming a folder nobody asked for.
  assert.equal(safePath('work//q3'), 'work/q3');
  assert.equal(safePath(''), '');
  // A path that was already legal comes back untouched, so the route can put
  // everything through it without a special case for what the Drive sends.
  assert.equal(safePath('work/q3/notes'), 'work/q3/notes');
});

test('a .mrbl and a .html are the same document under two names', () => {
  assert.equal(withoutDocExt('Notes.mrbl'), 'Notes');
  assert.equal(withoutDocExt('Notes.HTML'), 'Notes');
  assert.equal(withoutDocExt('Notes.htm'), 'Notes');
  // Not every dot is an extension.
  assert.equal(withoutDocExt('weekly-notes.v2'), 'weekly-notes.v2');
});
