import assert from 'node:assert/strict';
import test from 'node:test';

import { audit } from '../tools/stage-audit.mjs';

const DOC = `<!doctype html>
<html lang="en" data-marble="1">
<head><meta charset="utf-8"><title>t</title></head>
<body>
<main data-marble-id="main">
  <div class="cols" data-marble-id="cols">
    <section class="col" data-marble-id="c1"><h2 data-marble-id="c1h">To do</h2><ol class="cards" data-marble-id="c1l"></ol></section>
  </div>
</main>
</body>
</html>
`;

const col = (id, inner = '') =>
  `<section class="col" data-marble-id="${id}"><h2 data-marble-id="${id}-h">Team</h2><ol class="cards" data-marble-id="${id}-l">${inner}</ol></section>`;

const staged = [
  { note: 'Stage 1 of 3: add the Team column, empty.', ops: [{ type: 'insert', parentId: 'cols', beforeId: null, html: col('t') }] },
  { note: 'Stage 2 of 3: the members, by name.', ops: [{ type: 'insert', parentId: 't-l', beforeId: null, html: '<li class="card" data-marble-id="m1"><h3 data-marble-id="m1h">Ada</h3></li>' }] },
  { note: 'Stage 3 of 3: each member\'s role.', ops: [{ type: 'insert', parentId: 'm1', beforeId: null, html: '<p data-marble-id="m1p">Engineer</p>' }] },
];

const failed = (result, check) => result.checks.filter((c) => !c.ok && c.check === check);

test('a staged build passes: whole at every stop, continuous, named, no filler, three stages', () => {
  const result = audit(DOC, staged);
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => !c.ok)));
  assert.equal(result.stages, 3);
  assert.match(result.source, /Engineer/);
});

test('a one-shot insert fails on staging and naming, not on wholeness', () => {
  const result = audit(DOC, [{ note: 'Add the Team column.', ops: [{ type: 'insert', parentId: 'cols', beforeId: null, html: col('t', '<li data-marble-id="m1">Ada</li>') }] }]);
  assert.equal(result.ok, false);
  assert.equal(failed(result, 'staged').length, 1);
  assert.equal(failed(result, 'named').length, 1);
  assert.equal(failed(result, 'whole').length, 0);
});

test('removing what an earlier stage introduced is a cut', () => {
  const cut = [
    staged[0],
    { note: 'Stage 2 of 3: the column, finished.', ops: [{ type: 'remove', id: 't' }, { type: 'insert', parentId: 'cols', beforeId: null, html: col('t2') }] },
    { note: 'Stage 3 of 3: done.', ops: [] },
  ];
  const result = audit(DOC, cut);
  assert.equal(result.ok, false);
  assert.ok(failed(result, 'continuous').some((c) => /removes "t"/.test(c.detail)));
});

test('a setInner that overwrites addressed children is the same cut by another op', () => {
  const overwrite = [
    staged[0],
    staged[1],
    { note: 'Stage 3 of 3: roles.', ops: [{ type: 'setInner', id: 't-l', html: '<li class="card" data-marble-id="m9"><h3 data-marble-id="m9h">Ada</h3><p data-marble-id="m9p">Engineer</p></li>' }] },
  ];
  const result = audit(DOC, overwrite);
  assert.equal(result.ok, false);
  assert.ok(failed(result, 'continuous').some((c) => /overwrote "m1"/.test(c.detail)));
});

test('a marker left in the page is filler that was never retired', () => {
  const marked = [
    { note: 'Stage 1 of 3: the column.', ops: [{ type: 'insert', parentId: 'cols', beforeId: null, html: col('t', '<li data-marble-id="w">Loading…</li>') }] },
    staged[1],
    staged[2],
  ];
  const result = audit(DOC, marked);
  assert.equal(result.ok, false);
  assert.ok(failed(result, 'no filler').some((c) => /Loading/.test(c.detail)));
});

// Retiring filler and cutting a section are the same `remove` in the ops. The
// note is the only thing that tells them apart, which is why the guide asks the
// retiring stage to say so.
const planted = { note: 'Stage 1 of 3: the column, with the board\'s empty line.', ops: [{ type: 'insert', parentId: 'cols', beforeId: null, html: col('t', '<li data-marble-id="w">No one yet.</li>') }] };
const members = { type: 'insert', parentId: 't-l', beforeId: null, html: '<li class="card" data-marble-id="m1"><h3 data-marble-id="m1h">Ada</h3></li>' };

test('filler retired by a stage whose note says so is not a cut', () => {
  const result = audit(DOC, [
    planted,
    { note: 'Stage 2 of 3: the members, replacing the empty line.', ops: [{ type: 'remove', id: 'w' }, members] },
    staged[2],
  ]);
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter((c) => !c.ok)));
  assert.ok(result.checks.some((c) => c.ok && c.check === 'continuous' && /retires "w"/.test(c.detail)));
});

test('the same removal with a silent note is a cut', () => {
  const result = audit(DOC, [
    planted,
    { note: 'Stage 2 of 3: the members.', ops: [{ type: 'remove', id: 'w' }, members] },
    staged[2],
  ]);
  assert.equal(result.ok, false);
  assert.ok(failed(result, 'continuous').some((c) => /removes "w"/.test(c.detail)));
});

test('one element disappearing is blamed once, not on every later stage', () => {
  const result = audit(DOC, [
    staged[0],
    staged[1],
    { note: 'Stage 3 of 4: rebuild the list.', ops: [{ type: 'setInner', id: 't-l', html: '<li data-marble-id="m9">Ada</li>' }] },
    { note: 'Stage 4 of 4: the caption.', ops: [{ type: 'insert', parentId: 't', beforeId: null, html: '<p data-marble-id="cap">One person.</p>' }] },
  ]);
  const cuts = failed(result, 'continuous').filter((c) => /"m1"/.test(c.detail));
  assert.equal(cuts.length, 1, 'the batch that overwrote it is named once');
  assert.match(cuts[0].detail, /batch 3/);
});

test('a batch the tool would refuse fails wholeness and stops the replay', () => {
  const result = audit(DOC, [
    { note: 'Stage 1 of 3: nothing to hang this on.', ops: [{ type: 'insert', parentId: 'nope', beforeId: null, html: col('t') }] },
    staged[1],
    staged[2],
  ]);
  assert.equal(result.ok, false);
  assert.ok(failed(result, 'whole').some((c) => /refused/.test(c.detail)));
});
