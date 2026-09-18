import assert from 'node:assert/strict';
import test from 'node:test';

import { camel, indexAtlas, kebab, loadAtlas, slug } from '../server/genui/atlas.js';

const MINI = new URL('./fixtures/genui/atlas.mini.json', import.meta.url);

test('slug lowercases and collapses every non-alphanumeric run to one dash', () => {
  assert.equal(slug('Side-by-side'), 'side-by-side');
  assert.equal(slug('Sum or average'), 'sum-or-average');
  assert.equal(slug('Picture-in-picture'), 'picture-in-picture');
  assert.equal(slug('  One at a time!  '), 'one-at-a-time');
  assert.equal(slug('Overview–detail'), 'overview-detail');
});

test('kebab and camel are inverses on Atlas keys', () => {
  assert.equal(kebab('openIn'), 'open-in');
  assert.equal(kebab('detailMultiplicity'), 'detail-multiplicity');
  assert.equal(kebab('media'), 'media');
  assert.equal(camel('open-in'), 'openIn');
  assert.equal(camel('detail-multiplicity'), 'detailMultiplicity');
  for (const key of ['openIn', 'attributePlacement', 'overviewType', 'shape']) assert.equal(camel(kebab(key)), key);
});

test('sub() finds a sub-dimension on its own entry and maps variations by slug with the Atlas gloss', async () => {
  const atlas = await loadAtlas(MINI);
  const hit = atlas.sub('overview-detail', 'openIn');
  assert.ok(hit);
  assert.equal(hit.entry.id, 'overview-detail');
  assert.equal(hit.dim.name, 'Layout');
  assert.equal(hit.sub.name, 'Overview–detail arrangement');
  assert.equal(hit.vars.get('pop-up').name, 'Pop-up');
  assert.ok(hit.vars.get('pop-up').gloss.length > 0, 'the codebook gloss comes along');
  assert.equal(hit.vars.get('side-by-side').name, 'Side-by-side');
});

test('sub() resolves through specializes, nearest entry first, on real chains', async () => {
  const atlas = await loadAtlas(MINI);
  // inbox has its own openIn; it shadows overview-detail's.
  assert.equal(atlas.sub('inbox', 'openIn').entry.id, 'inbox');
  // inbox has no truncation; overview-detail does.
  assert.equal(atlas.sub('inbox', 'truncation').entry.id, 'overview-detail');
  // wizard specializes form: labels is form's.
  assert.equal(atlas.sub('wizard', 'labels').entry.id, 'form');
  assert.equal(atlas.sub('wizard', 'progress').entry.id, 'wizard');
  assert.equal(atlas.sub('inbox', 'nope'), null);
  assert.equal(atlas.sub('missing', 'openIn'), null);
});

test('has() and entry()', async () => {
  const atlas = await loadAtlas(MINI);
  assert.equal(atlas.has('card'), true);
  assert.equal(atlas.has('carousel'), false);
  assert.equal(atlas.entry('card').name, 'Card');
  assert.equal(atlas.entry('carousel'), null);
});

test('indexAtlas tolerates an entry with no dims and a cycle in specializes', () => {
  const atlas = indexAtlas({
    entries: [
      { id: 'a', name: 'A', relations: { specializes: ['b'] } },
      { id: 'b', name: 'B', relations: { specializes: ['a'] }, dims: [{ name: 'D', q: 'Q?', subs: [{ name: 'S', key: 'k', sel: 'one', vars: [['X', 'x', '']] }] }] },
    ],
  });
  assert.equal(atlas.sub('a', 'k').entry.id, 'b');
  assert.equal(atlas.sub('b', 'k').entry.id, 'b');
});
