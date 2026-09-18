import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_HOP, MAX_SENDS, MAX_TEXT, WAIT_DEFAULT, WAIT_MAX, WAIT_MIN,
  clampSeconds, pickTarget, renderMessages, validateText,
} from '../server/agent/messages.js';
import { MESSAGING_INSTRUCTIONS } from '../server/agent/instructions.js';

test('the limits are the spec\'s numbers', () => {
  assert.deepEqual([MAX_TEXT, MAX_SENDS, MAX_HOP, WAIT_DEFAULT, WAIT_MIN, WAIT_MAX], [4000, 12, 8, 120, 5, 300]);
});

test('text must be a non-empty string within the cap', () => {
  assert.equal(validateText('hello'), null);
  assert.match(validateText(''), /empty/);
  assert.match(validateText('   '), /empty/);
  assert.match(validateText(42), /text/);
  assert.match(validateText('x'.repeat(4001)), /4000/);
  assert.equal(validateText('x'.repeat(4000)), null);
});

test('seconds clamp to [5, 300] and default to 120', () => {
  assert.equal(clampSeconds(undefined), 120);
  assert.equal(clampSeconds('abc'), 120);
  assert.equal(clampSeconds(1), 5);
  assert.equal(clampSeconds(9000), 300);
  assert.equal(clampSeconds(42.7), 42);
});

test('a delivery turn targets the receiver\'s document, then the message\'s, then the sender\'s', () => {
  assert.equal(pickTarget({ receiver: { target: 'theirs' }, about: { path: 'about' }, senderTarget: 'mine' }), 'theirs');
  assert.equal(pickTarget({ receiver: { target: null }, about: { path: 'about' }, senderTarget: 'mine' }), 'about');
  assert.equal(pickTarget({ receiver: {}, about: null, senderTarget: 'mine' }), 'mine');
  assert.equal(pickTarget({ receiver: {}, about: null, senderTarget: null }), null);
});

test('messages render with who sent them, what they are about, and how to reply', () => {
  const titles = new Map([['aaaaaaaaaaaa', { title: 'Bibliography', provider: 'claude-subscription' }]]);
  const text = renderMessages([
    { id: 'm1m1m1m1m1m1', from: 'aaaaaaaaaaaa', to: 'b', text: 'Is the bib clean?', about: { path: 'Research/CHI', ids: ['h1', 'p2'] }, hop: 0 },
    { id: 'm2m2m2m2m2m2', from: 'zzzzzzzzzzzz', to: 'b', text: 'Second note', about: null, hop: 0 },
  ], titles);
  assert.match(text, /Message from the conversation "Bibliography" \(aaaaaaaaaaaa, claude-subscription\):/);
  assert.match(text, /Is the bib clean\?/);
  assert.match(text, /About: Research\/CHI — h1, p2/);
  assert.match(text, /Reply with send_message to "aaaaaaaaaaaa" and inReplyTo "m1m1m1m1m1m1"\./);
  assert.match(text, /Message from the conversation "zzzzzzzzzzzz" \(zzzzzzzzzzzz, unknown\):/, 'an unknown sender is named by id');
  assert.match(text, /Second note/);
  assert.equal(text.split('Message from the conversation').length - 1, 2);
});

test('the messaging paragraph names the three tools and points shared state at documents', () => {
  for (const name of ['list_agents', 'send_message', 'wait_for_reply']) assert.match(MESSAGING_INSTRUCTIONS, new RegExp(name));
  assert.match(MESSAGING_INSTRUCTIONS, /document/);
});
