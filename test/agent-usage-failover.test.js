import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIEF_CAP,
  CONTINUE,
  STAY,
  continuedLabel,
  matchEffort,
  pickGrok,
  usageBrief,
  usageStopped,
} from '../server/agent/usage-failover.js';

test('a spent window is a usage stop, and a short retry is not', () => {
  assert.equal(usageStopped('You have hit your limit · resets 7pm'), true);
  assert.equal(usageStopped('usage limit reached'), true);
  assert.equal(usageStopped('You are out of extra usage'), true);
  assert.equal(usageStopped('Extra usage limit reached for this model'), true);
  assert.equal(usageStopped('Rate limit — try again shortly'), false);
  assert.equal(usageStopped('overloaded, please retry'), false);
  assert.equal(usageStopped('Permission for this action was denied'), false);
  assert.equal(usageStopped('stalled — no output for 30 s'), false);
  assert.equal(usageStopped('exited with 1'), false);
  assert.equal(usageStopped(''), false);
  assert.equal(usageStopped(null), false);
});

test('effort keeps the same step, and the nearest higher step on a tie', () => {
  const family = {
    id: 'grok-4.7',
    label: 'Grok 4.7',
    hasBare: false,
    efforts: [
      { id: 'low', label: 'Low' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'Extra High' },
    ],
  };
  assert.equal(matchEffort('high', family), 'high');
  assert.equal(matchEffort('max', family), 'xhigh');
  assert.equal(matchEffort('medium', family), 'high');
  assert.equal(matchEffort('', family), 'high');
  assert.equal(matchEffort(null, { ...family, hasBare: true }), '');
  assert.equal(continuedLabel('Grok 4.7', 'high'), 'Grok 4.7 High');
  assert.equal(continuedLabel('Grok 4.7', ''), 'Grok 4.7');
});

test('the Grok pick is the newest family and never Auto', () => {
  const picked = pickGrok([
    { id: 'auto', label: 'Auto' },
    { id: 'cursor-grok-4.6-high', label: 'Grok 4.6 High' },
    { id: 'grok-4.7-high', label: 'Grok 4.7 High' },
    { id: 'grok-4.7-xhigh', label: 'Grok 4.7 Extra High' },
  ]);
  assert.equal(picked.id, 'grok-4.7');
  assert.equal(picked.label, 'Grok 4.7');
  assert.equal(pickGrok([{ id: 'auto', label: 'Auto' }, { id: 'composer-2.5', label: 'Composer 2.5' }]), null);
});

test('the brief carries the task, the paths, and where Claude stopped', () => {
  const brief = usageBrief([
    { type: 'user', text: 'Rename the heading' },
    { type: 'tool.call', name: 'Read', input: { file_path: 'secret-body-should-not-appear' } },
    { type: 'text', text: 'I renamed it.' },
    { type: 'ops.applied', path: 'garden', count: 1 },
    { type: 'document.changed', path: 'notes.mrbl' },
    { type: 'user', text: 'Continue' },
  ], 'You have hit your limit');
  assert.match(brief, /Finish the work it started/);
  assert.match(brief, /Person: Rename the heading/);
  assert.match(brief, /Person: Continue/);
  assert.match(brief, /garden \(1 element\)/);
  assert.match(brief, /notes\.mrbl/);
  assert.match(brief, /Agent: I renamed it\./);
  assert.match(brief, /Stopped: You have hit your limit/);
  assert.equal(brief.includes('secret-body-should-not-appear'), false);
  assert.equal(CONTINUE, 'Continue');
  assert.match(STAY.signedOut, /Cursor is unavailable/);
});

test('past the cap, older agent text goes and the instruction and file list stay', () => {
  const events = [
    { type: 'user', text: 'Do the first thing' },
    { type: 'user', text: 'Then the second' },
    { type: 'ops.applied', path: 'garden', count: 2 },
    { type: 'text', text: `early ${'a'.repeat(8000)}` },
    { type: 'text', text: `middle ${'b'.repeat(8000)}` },
    { type: 'text', text: `latest ${'c'.repeat(8000)}` },
  ];
  const brief = usageBrief(events, 'hit your limit');
  assert.ok(brief.length <= BRIEF_CAP);
  assert.match(brief, /Finish the work it started/);
  assert.match(brief, /garden \(2 elements\)/);
  assert.match(brief, /latest ccc/);
  assert.equal(brief.includes('early aaa'), false);
});
