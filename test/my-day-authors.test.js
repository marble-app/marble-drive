import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auSlug,
  harvestKnownAuthors,
  knownAuthorSet,
  rAuthors,
} from '../.claude/skills/my-day/lib/authors.mjs';

const mint = (() => {
  let n = 0;
  return () => `au${++n}`;
});

test('author names are separated by a real comma and space, not jammed together', () => {
  const html = rAuthors(
    ['Panagiotis Kourtesis', 'Katerina Denaxa', 'Lydia Asimakopoulou'],
    new Set(),
    mint(),
  );
  assert.match(html, /Panagiotis Kourtesis<\/button>,\s*<button /);
  assert.match(html, /Katerina Denaxa<\/button>,\s*<button /);
  assert.match(html, /Lydia Asimakopoulou<\/button>/);
  assert.doesNotMatch(html, /Lydia Asimakopoulou<\/button>,/);
});

test('each name is a real file control: marble id, no transient', () => {
  const html = rAuthors(['Ada Lovelace'], new Set(), mint());
  assert.match(html, /<button class="au tip" type="button" data-marble-id="au\d+" data-au="ada-lovelace"/);
  assert.doesNotMatch(html, /data-marble-transient/);
});

test('a known author stored under their display name still lights up on a slug lookup', () => {
  const known = knownAuthorSet({
    'Caroline Berger': { markedOn: '2026-09-10', via: 'feedback' },
  });
  assert.equal(known.has('caroline-berger'), true);

  const html = rAuthors(['Caroline Berger', 'Someone Else'], known, mint());
  assert.match(html, /data-au="caroline-berger"[^>]*\bdata-known\b/);
  assert.doesNotMatch(html, /data-au="someone-else"[^>]*\bdata-known\b/);
});

test('clicking a name on day one harvests them so day two renders them already known', () => {
  const day1 = rAuthors(['Ada Lovelace', 'Alan Turing'], new Set(), mint());
  const clicked = day1.replace(
    'data-au="ada-lovelace"',
    'data-au="ada-lovelace" data-known',
  );

  const harvested = harvestKnownAuthors(clicked, { known: {} }, { today: '2026-09-18' });
  assert.equal(harvested.known['ada-lovelace'].name, 'Ada Lovelace');
  assert.equal(harvested.known['ada-lovelace'].markedOn, '2026-09-18');
  assert.equal(harvested.known['alan-turing'], undefined);

  const day2 = rAuthors(['Ada Lovelace', 'Alan Turing'], knownAuthorSet(harvested.known), mint());
  assert.match(day2, /data-au="ada-lovelace"[^>]*\bdata-known\b/);
  assert.doesNotMatch(day2, /data-au="alan-turing"[^>]*\bdata-known\b/);
});

test('harvest keeps already-known people whose name was stored as the key, not a slug', () => {
  const html = rAuthors(['Caroline Berger'], new Set(), mint())
    .replace('data-au="caroline-berger"', 'data-au="caroline-berger" data-known');
  const harvested = harvestKnownAuthors(html, {
    known: {
      'Caroline Berger': { markedOn: '2026-09-10', via: 'feedback' },
    },
  }, { today: '2026-09-18' });

  assert.equal(harvested.known['caroline-berger'].name, 'Caroline Berger');
  assert.equal(harvested.known['caroline-berger'].markedOn, '2026-09-10');
  assert.equal(harvested.known['Caroline Berger'], undefined);
});
