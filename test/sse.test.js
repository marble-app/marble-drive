import assert from 'node:assert/strict';
import test from 'node:test';

import { createChannels, forVisitor, lookFrame } from '../server/sse.js';

test('a look\'s client and ids are its own, whatever the caller hands in', () => {
  const frame = lookFrame('agent:c1', ['a'], { client: 'agent:someone-else', ids: ['b'], stage: 'before', parts: ['a'] });
  assert.equal(frame.client, 'agent:c1');
  assert.deepEqual(frame.ids, ['a']);
  assert.equal(frame.label, 'agent:c1', 'the label defaults to the client');
  assert.equal(frame.stage, 'before');
  assert.deepEqual(frame.parts, ['a']);
  assert.deepEqual(lookFrame('agent:c1', null, { label: 'Ana' }), { client: 'agent:c1', ids: [], label: 'Ana' });
});

test('a visitor\'s frame keeps where and how far, and drops the words', () => {
  const frame = {
    client: 'agent:c1', ids: ['a'], label: 'agent:c1', stage: 'before', turn: 'c1-t1', parts: ['a'], count: 1, total: 4,
    prompt: 'my words', note: 'Stage 2 of 4: the agent\'s words', step: { n: 2, of: 4, text: 'the agent\'s words' },
  };
  assert.deepEqual(forVisitor(frame), {
    client: 'agent:c1', ids: ['a'], label: 'agent:c1', stage: 'before', turn: 'c1-t1', parts: ['a'], count: 1, total: 4, step: { n: 2, of: 4 },
  });
  assert.deepEqual(forVisitor({ client: 'x', ids: [], step: null }), { client: 'x', ids: [], step: null });
  assert.equal(frame.prompt, 'my words', 'the frame itself is left whole for everyone else');
});

test('presence reaches a visitor\'s listener without the words, and everyone else\'s with them', () => {
  const channels = createChannels();
  const heard = (visitor) => {
    const listener = { id: visitor ? 'vis' : 'own', visitor, written: [], res: { write: (text) => listener.written.push(text) } };
    return listener;
  };
  const owner = heard(false);
  const visitor = heard(true);
  const off = [channels.subscribeDoc('doc', owner), channels.subscribeDoc('doc', visitor)];
  channels.toPresence('doc', { client: 'agent:c1', ids: ['a'], prompt: 'secret', note: 'noted', step: { n: 1, of: 2, text: 'stepped' } });
  const read = (listener) => JSON.parse(listener.written.at(-1).match(/^data: (.*)$/m)[1]);
  assert.deepEqual(read(owner), { client: 'agent:c1', ids: ['a'], prompt: 'secret', note: 'noted', step: { n: 1, of: 2, text: 'stepped' } });
  assert.deepEqual(read(visitor), { client: 'agent:c1', ids: ['a'], step: { n: 1, of: 2 } });
  for (const stop of off) stop();
  channels.close();
});
