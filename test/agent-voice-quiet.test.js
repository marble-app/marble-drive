// When you have stopped talking (runtime/voice.js quietEnd): speech rose above
// a floor measured from the room, then stayed under it long enough. Pure, so
// it is tested on arrays of levels rather than a microphone.
import assert from 'node:assert/strict';
import test from 'node:test';

import '../runtime/voice.js';

const V = () => globalThis.marbleVoice;
const FRAME = 50;
/** `ms` of one level, as frames. */
const hold = (level, ms) => Array.from({ length: Math.round(ms / FRAME) }, () => level);
const ends = (levels) => V().quietEnd(levels, { frameMs: FRAME });

test('silence alone never ends it: nothing was said', () => {
  assert.equal(ends(hold(0.01, 5000)), false);
});

test('speech, then 1.2 s of quiet, ends it', () => {
  const levels = [...hold(0.01, 300), ...hold(0.3, 1500), ...hold(0.01, 1250)];
  assert.equal(ends(levels), true);
  assert.equal(ends(levels.slice(0, -4)), false, 'not before the 1.2 s are up');
});

test('the pauses inside a sentence do not end it', () => {
  const levels = [...hold(0.01, 300), ...hold(0.3, 800), ...hold(0.01, 800), ...hold(0.3, 800), ...hold(0.01, 800), ...hold(0.3, 400)];
  assert.equal(ends(levels), false);
});

test('a noisy room raises the floor', () => {
  // The same voice and the same murmur after it; only the room differs.
  const after = [...hold(0.5, 600), ...hold(0.15, 1300)];
  assert.equal(ends([...hold(0.01, 300), ...after]), false, 'in a quiet room the murmur is still talk');
  assert.equal(ends([...hold(0.2, 300), ...after]), true, 'in a loud room it is the room');
});

test('a type the browser can record is chosen, webm first, then mp4', () => {
  assert.equal(V().pickType((t) => t === 'audio/webm;codecs=opus' || t === 'audio/mp4'), 'audio/webm;codecs=opus');
  assert.equal(V().pickType((t) => t === 'audio/mp4'), 'audio/mp4');
  assert.equal(V().pickType(() => false), '');
});
