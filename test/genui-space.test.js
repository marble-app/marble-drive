import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { loadAtlas } from '../server/genui/atlas.js';
import * as spaceModule from '../server/genui/space.js';
const { extractSpace, parseDeclaration, validateSpace } = spaceModule;

const FIXTURE = await fsp.readFile(new URL('./fixtures/genui/49ers.mrbl', import.meta.url), 'utf8');
const atlas = await loadAtlas(new URL('./fixtures/genui/atlas.mini.json', import.meta.url));

const doc = (body, style = '') => `<!doctype html><html><head><style>${style}</style></head><body data-marble-id="b">${body}</body></html>`;

test('parseDeclaration splits on | and reads an optional gloss after the first colon', () => {
  assert.deepEqual(parseDeclaration('grid | list | table'), [
    { slug: 'grid', gloss: null }, { slug: 'list', gloss: null }, { slug: 'table', gloss: null },
  ]);
  assert.deepEqual(parseDeclaration('identity: names only | full: everything, incl: colons'), [
    { slug: 'identity', gloss: 'names only' }, { slug: 'full', gloss: 'everything, incl: colons' },
  ]);
  assert.deepEqual(parseDeclaration(' Pop-Up |  '), [{ slug: 'pop-up', gloss: null }]);
});

test('extractSpace reads the request, both instances, their facts, options and nesting', () => {
  const space = extractSpace(FIXTURE);
  assert.match(space.request, /49ers games/);
  assert.equal(space.instances.length, 2);

  const [games, card] = space.instances;
  assert.equal(games.name, 'games');
  assert.equal(games.marbleId, 'games');
  assert.equal(games.pattern, 'overview-detail');
  assert.equal(games.parent, null);
  assert.match(games.about, /^Upcoming and recent/);
  assert.deepEqual(games.decisions.map((d) => d.key), ['openIn', 'overviewType', 'detailMultiplicity', 'attributePlacement']);
  const openIn = games.decisions[0];
  assert.equal(openIn.attr, 'data-open-in');
  assert.equal(openIn.current, 'side-by-side');
  assert.deepEqual(openIn.options.map((o) => o.slug), ['side-by-side', 'pop-up', 'new-page']);
  assert.equal(openIn.options[0].gloss, null);
  const placement = games.decisions[3];
  assert.equal(placement.options[1].slug, 'identity-record');
  assert.equal(placement.options[1].gloss, 'opponent, date, and the series record on the card');

  assert.equal(card.name, 'game-card');
  // A repeated role's root is the container of its stamped items: one fact
  // there, every card derives from it. Never the first card.
  assert.equal(card.marbleId, 'overview');
  assert.equal(card.pattern, 'card');
  assert.equal(card.parent, 'games');
  assert.deepEqual(card.decisions.map((d) => d.key), ['shape', 'media', 'actions', 'target']);
});

test('extractSpace: a document with no instance roots is an empty space with no request', () => {
  const space = extractSpace(doc('<p data-marble-id="p">hi</p>'));
  assert.equal(space.request, null);
  assert.deepEqual(space.instances, []);
});

test('validateSpace passes the fixture', () => {
  const result = validateSpace(FIXTURE, atlas);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

for (const name of ['metrics', 'signup']) {
  test(`validateSpace passes the ${name} fixture — Stage B is not overview–detail-specific`, async () => {
    const source = await fsp.readFile(new URL(`./fixtures/genui/${name}.mrbl`, import.meta.url), 'utf8');
    const result = validateSpace(source, atlas);
    assert.deepEqual(result.issues, []);
    const space = extractSpace(source);
    assert.ok(space.instances.length >= 2);
  });
}

test('signup: labels on the wizard resolves to form through specializes, and the stepper has its own labels', async () => {
  const source = await fsp.readFile(new URL('./fixtures/genui/signup.mrbl', import.meta.url), 'utf8');
  const space = extractSpace(source);
  const wizard = space.instances.find((i) => i.name === 'signup');
  const stepper = space.instances.find((i) => i.name === 'steps');
  assert.ok(wizard.decisions.some((d) => d.key === 'labels'));
  assert.ok(stepper.decisions.some((d) => d.key === 'labels'));
  assert.equal(atlas.sub('wizard', 'labels').entry.id, 'form');
  assert.equal(atlas.sub('stepper', 'labels').entry.id, 'stepper');
});

const kinds = (source) => validateSpace(source, atlas).issues.map((i) => i.kind);

test('validateSpace: no instances', () => {
  assert.deepEqual(kinds(doc('<p data-marble-id="p">hi</p>')), ['no-instances']);
});

test('validateSpace: a root must be pattern#name and carry a marble id', () => {
  assert.ok(kinds(doc('<section data-marble-id="s" data-genui="overview-detail"></section>')).includes('bad-root'));
  assert.ok(kinds(doc('<section data-genui="overview-detail#x"></section>')).includes('missing-marble-id'));
});

test('validateSpace: duplicate instance names and unknown patterns', () => {
  const two = doc('<section data-marble-id="a" data-genui="card#c"></section><section data-marble-id="b" data-genui="card#c"></section>');
  assert.ok(kinds(two).includes('duplicate-instance'));
  assert.ok(kinds(doc('<section data-marble-id="a" data-genui="carousel#c"></section>')).includes('unknown-pattern'));
});

test('validateSpace: a declared key must be a sub-dimension of the entry (or one it specializes)', () => {
  const bad = doc('<section data-marble-id="a" data-genui="card#c" data-colour="red" data-genui-colour="red | blue"></section>', '.x[data-colour="red"]{} .x[data-colour="blue"]{}');
  assert.deepEqual(kinds(bad), ['unknown-key']);
  const inherited = doc('<section data-marble-id="a" data-genui="inbox#i" data-truncation="ellipsis" data-genui-truncation="ellipsis | full-text"></section>', '[data-truncation="ellipsis"]{} [data-truncation="full-text"]{}');
  assert.deepEqual(kinds(inherited), []);
});

test('validateSpace: fewer than two options, a preset without a gloss, an unimplemented option, a current value not declared', () => {
  const one = doc('<section data-marble-id="a" data-genui="card#c" data-shape="vertical" data-genui-shape="vertical"></section>', '[data-shape="vertical"]{}');
  assert.deepEqual(kinds(one), ['too-few-options']);

  const noGloss = doc('<section data-marble-id="a" data-genui="card#c" data-shape="tall" data-genui-shape="tall | vertical"></section>', '[data-shape="tall"]{} [data-shape="vertical"]{}');
  assert.deepEqual(kinds(noGloss), ['missing-gloss']);

  const notImplemented = doc('<section data-marble-id="a" data-genui="card#c" data-shape="vertical" data-genui-shape="vertical | horizontal"></section>', '[data-shape="vertical"]{}');
  assert.deepEqual(kinds(notImplemented), ['unimplemented-option']);

  const wrongCurrent = doc('<section data-marble-id="a" data-genui="card#c" data-shape="round" data-genui-shape="vertical | horizontal"></section>', '[data-shape="vertical"]{} [data-shape="horizontal"]{}');
  assert.deepEqual(kinds(wrongCurrent), ['current-not-declared']);
});

test('validateSpace: a generated document is plain web UI — a <marble-alt> is not an implementation', () => {
  const alt = doc(`<section data-marble-id="a" data-genui="card#c" data-media="none" data-genui-media="none | top-image">
    <marble-alt data-marble-id="m" data-marble-active="none">
      <span data-marble-id="m0" data-marble-alt="none"></span>
      <span data-marble-id="m1" data-marble-alt="top-image"></span>
    </marble-alt></section>`);
  assert.deepEqual(kinds(alt), ['unimplemented-option', 'unimplemented-option']);
});

test('validateSpace: a CSS value is matched exactly — "Pop Up" does not implement pop-up', () => {
  const loose = doc('<section data-marble-id="a" data-genui="overview-detail#o" data-open-in="pop-up" data-genui-open-in="pop-up | popover"></section>', '[data-open-in="Pop Up"]{} [data-open-in="popover"]{}');
  assert.deepEqual(kinds(loose), ['unimplemented-option']);
});


test('extractSpace and validateSpace accept an already-parsed tree', async () => {
  const { parseSource } = await import('../server/engine.js');
  const tree = parseSource(FIXTURE);
  assert.equal(extractSpace(tree).instances.length, 2);
  assert.equal(validateSpace(tree, atlas).ok, true);
});

test('pins and excludes are read off the root and validated against its declarations', () => {
  const { parseExcludes, parsePins } = spaceModule;
  assert.deepEqual(parsePins('open-in overview-type'), ['openIn', 'overviewType']);
  assert.deepEqual(parseExcludes('open-in:new-page + overview-type:table | shape:vertical + media:none'), [
    [{ key: 'openIn', slug: 'new-page' }, { key: 'overviewType', slug: 'table' }],
    [{ key: 'shape', slug: 'vertical' }, { key: 'media', slug: 'none' }],
  ]);
  const pinned = FIXTURE.replace('data-genui="overview-detail#games"', 'data-genui="overview-detail#games" data-genui-pin="open-in" data-genui-excludes="open-in:new-page + overview-type:table"');
  const space = extractSpace(pinned);
  assert.deepEqual(space.instances[0].pins, ['openIn']);
  assert.equal(space.instances[0].excludes.length, 1);
  assert.deepEqual(validateSpace(pinned, atlas).issues, []);

  const badPin = FIXTURE.replace('data-genui="overview-detail#games"', 'data-genui="overview-detail#games" data-genui-pin="colour"');
  assert.deepEqual(kinds(badPin), ['unknown-pin']);
  const badEx = FIXTURE.replace('data-genui="overview-detail#games"', 'data-genui="overview-detail#games" data-genui-excludes="open-in:tooltip + overview-type:table"');
  assert.deepEqual(kinds(badEx), ['unknown-exclude']);
  const defaultEx = FIXTURE.replace('data-genui="overview-detail#games"', 'data-genui="overview-detail#games" data-genui-excludes="open-in:side-by-side + overview-type:grid"');
  assert.deepEqual(kinds(defaultEx), ['excluded-default']);
});
