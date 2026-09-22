import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIEF_CAP,
  CONTINUE,
  STAY,
  continuedLabel,
  handoffModel,
  matchEffort,
  pickGrok,
  pickSameModel,
  usageBrief,
  usageHandoffDue,
  usageStopped,
} from '../server/agent/usage-failover.js';

test('a spent window is a usage stop, and a short retry is not', () => {
  assert.equal(usageStopped('You have hit your limit · resets 7pm'), true);
  assert.equal(usageStopped("You've hit your session limit · resets 1pm (America/Los_Angeles)"), true);
  assert.equal(usageStopped('usage limit reached'), true);
  assert.equal(usageStopped('You are out of extra usage'), true);
  assert.equal(usageStopped('Extra usage limit reached for this model'), true);
  assert.equal(usageStopped('Rate limit — try again shortly'), false);
  assert.equal(usageStopped('overloaded, please retry'), false);
  assert.equal(usageStopped('Permission for this action was denied'), false);
  assert.equal(usageStopped('stalled — no output for 30 s'), false);
  assert.equal(usageStopped('exited with 1'), false);
  assert.equal(usageStopped("You've hit your session limit · resets 1pm"), true);
  assert.equal(usageStopped(''), false);
  assert.equal(usageStopped(null), false);
});

const CURSOR_FAMILIES = [
  { id: 'auto', label: 'Auto' },
  { id: 'claude-fable-5-1-high', label: 'Claude Fable 5.1 1M' },
  { id: 'claude-opus-5-thinking-high', label: 'Claude Opus 5 1M Thinking' },
  { id: 'claude-opus-4-8-high', label: 'Claude Opus 4.8 1M' },
  { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 1M High' },
  { id: 'claude-opus-5-5-xhigh', label: 'Claude Opus 5.5 1M Extra High' },
  { id: 'claude-opus-5-high', label: 'Claude Opus 5 1M' },
  { id: 'claude-sonnet-5-high', label: 'Claude Sonnet 5 1M' },
  { id: 'claude-sonnet-5-thinking-high', label: 'Claude Sonnet 5 1M Thinking' },
  { id: 'claude-4.6-sonnet-medium', label: 'Claude Sonnet 4.6 1M' },
  { id: 'grok-4.7-high', label: 'Grok 4.7 High' },
];

test('the same model on Cursor is the newest plain family, and Fable lands on Opus', () => {
  assert.equal(pickSameModel(CURSOR_FAMILIES, 'opus').id, 'claude-opus-5-5');
  assert.equal(pickSameModel(CURSOR_FAMILIES, 'fable').id, 'claude-opus-5-5');
  assert.equal(pickSameModel(CURSOR_FAMILIES, 'sonnet').id, 'claude-sonnet-5');
  assert.equal(pickSameModel(CURSOR_FAMILIES, 'haiku'), null);
  assert.equal(pickSameModel(CURSOR_FAMILIES, 'opus').id.includes('thinking'), false);
  assert.equal(pickSameModel(CURSOR_FAMILIES, 'opus').id.includes('fable'), false);
});

test('the handoff chain is the same model, then Grok, and Grok is the last stop', () => {
  assert.equal(handoffModel(CURSOR_FAMILIES, { model: 'opus' }).id, 'claude-opus-5-5');
  assert.equal(handoffModel(CURSOR_FAMILIES, { model: 'fable' }).id, 'claude-opus-5-5');
  assert.equal(handoffModel(CURSOR_FAMILIES, { model: 'opus', usageLane: 'model' }).id, 'grok-4.7');
  assert.equal(handoffModel(CURSOR_FAMILIES, { model: 'haiku' }).id, 'grok-4.7');
  assert.equal(handoffModel([{ id: 'auto', label: 'Auto' }], { model: 'opus' }), null);
  assert.equal(handoffModel(CURSOR_FAMILIES, { usageLane: 'grok' }), null);
  assert.equal(usageHandoffDue({ provider: 'claude-subscription', error: 'You have hit your limit' }), true);
  assert.equal(usageHandoffDue({ provider: 'cursor', usageLane: 'model', error: "You've hit your session limit" }), true);
  assert.equal(usageHandoffDue({ provider: 'cursor', usageLane: 'grok', error: "You've hit your session limit" }), false);
  assert.equal(usageHandoffDue({ provider: 'cursor', error: "You've hit your session limit" }), false);
  assert.equal(usageHandoffDue({ provider: 'claude-subscription', error: 'exited with 1' }), false);
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
  const second = usageBrief([
    { type: 'user', text: 'Rename the heading' },
    { type: 'text', text: 'I renamed it.' },
  ], "You've hit your session limit", { afterCursor: true });
  assert.match(second, /The Cursor model stopped because its usage was used up/);
  assert.match(second, /Finish the work it started/);
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
