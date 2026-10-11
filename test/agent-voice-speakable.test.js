// What a reply sounds like (docs/superpowers/specs/2026-10-10-voice-design.md,
// "What is spoken"): the sentences, without the markup a page draws and a voice
// would read out as symbols.
import assert from 'node:assert/strict';
import test from 'node:test';

import { speakable } from '../server/agent/voice/speakable.js';

test('a plain reply comes back as it was', () => {
  const text = 'I read the Board. There are four cards. Two are due this week.';
  assert.equal(speakable(text), text);
});

test('fenced blocks go, code and visuals alike', () => {
  const text = 'Here it is.\n\n```js\nconst a = 1;\n```\n\nAnd a picture:\n\n```marble-visual\n<div>x</div>\n```\n\nThat is all.';
  assert.equal(speakable(text), 'Here it is. And a picture: That is all.');
});

test('marks go, and list items become sentences', () => {
  assert.equal(speakable('# Board\n\nI found **two** cards:\n\n- Call the dentist\n- Pay rent\n\n1. First thing\n2. Second thing'),
    'Board. I found two cards: Call the dentist. Pay rent. First thing. Second thing.');
  assert.equal(speakable('It is *quite* `small` and __done__.'), 'It is quite small and done.');
});

test('a link says its words, a bare URL is dropped, a path says its file', () => {
  assert.equal(speakable('See [the plan](https://example.com/plan) for more.'), 'See the plan for more.');
  assert.equal(speakable('It is at https://example.com/a/b?c=d now.'), 'It is at now.');
  assert.equal(speakable('I opened Notes and Sketches/Agents and Chat/Voice.mrbl and read it.'), 'I opened Voice and read it.');
  assert.equal(speakable('I changed `server/agent/runner.js` today.'), 'I changed runner today.');
});

test('a table is dropped', () => {
  const text = 'Here are the numbers.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nThat is the lot.';
  assert.equal(speakable(text), 'Here are the numbers. That is the lot.');
});

test('a long reply stops at a sentence end before sixty words, and says where the rest is', () => {
  const sentence = 'This sentence has exactly ten words in it for counting.';
  const text = Array.from({ length: 9 }, () => sentence).join(' ');
  const spoken = speakable(text);
  assert.equal(spoken, `${Array.from({ length: 6 }, () => sentence).join(' ')} The rest is in the chat.`);
  assert.ok(spoken.split(/\s+/).length <= 66);
});

test('a single run-on sentence is cut at the word limit', () => {
  const text = Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ');
  const spoken = speakable(text);
  assert.match(spoken, /^w0 w1 .* w59\. The rest is in the chat\.$/);
});

test('a failed turn says its reason’s first sentence', () => {
  assert.equal(speakable("Couldn't reach OpenAI. The key was refused.", { status: 'failed' }), "That didn't work. Couldn't reach OpenAI.");
  assert.equal(speakable('', { status: 'failed' }), "That didn't work.");
});

test('a stopped turn says so', () => {
  assert.equal(speakable('Half a reply', { status: 'cancelled' }), 'Stopped.');
});

test('a turn that asks says it needs an OK, and nothing it could be approved by', () => {
  assert.equal(speakable('May I run rm -rf build?', { asked: true }), "It needs your OK. It's on the screen.");
});

test('an empty reply on a finished turn says it is done', () => {
  assert.equal(speakable(''), "Done. It's on the screen.");
  assert.equal(speakable('```js\nx\n```'), "Done. It's on the screen.");
});

test('never longer than two thousand characters', () => {
  const long = 'a'.repeat(5000);
  assert.ok(speakable(long, { maxWords: 10_000 }).length <= 2000);
});
