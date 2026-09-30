import assert from 'node:assert/strict';
import test from 'node:test';

import { buildsSomething, marbleWay } from '../server/agent/marble-way.js';

test('asks about building are told apart from asks about words', () => {
  for (const ask of [
    'Make this row interactive: click to change its status',
    'turn it into a checklist',
    'Explore 3 variations of this card',
    'add a chart of the numbers',
    'let me drag these to reorder them',
    'visualize the timeline',
    'Make this table automatic: a Fill button that looks up the authors',
    'a kanban board for these',
  ]) assert.equal(buildsSomething(ask), true, ask);
  for (const ask of [
    'Tighten it',
    'what does this column mean?',
    'Say it more plainly',
    'Rephrase this more formally',
    'shorter',
  ]) assert.equal(buildsSomething(ask), false, ask);
});

test('the brief names the skill for a full agent and the guide for a documents agent', () => {
  const full = marbleWay('full');
  assert.match(full, /marble:build-in-marble/);
  assert.match(full, /window\.marble\.op/);
  assert.match(full, /data-marble-editable/);
  assert.match(full, /check_document/);
  const docs = marbleWay('documents');
  assert.match(docs, /read_guide "Persistence" and "Affordances"/);
  assert.doesNotMatch(docs, /check_document|affordance_script/);
});
