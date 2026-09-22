// The house rules, read off the starters themselves.
//
// Six starters were brought up to one standard on 2026-09-22
// (docs/superpowers/specs/2026-09-22-starter-quality-design.md). The standard is
// worth about as much as it is enforced: six people working separately, and
// anybody editing one of these later, will each drift a different way. So the
// parts of it that are true of the *source* — not of the rendered page, which is
// what test-browser/starter-*.test.js is for — are asserted here.
//
// Every rule below has a reason, and the reason is in the message. A rule
// nobody can argue with from the failure alone is a rule somebody will delete.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The LaTeX pair is exempt, at Bryan's word: they are already good, and they
// are one document with two projects in it rather than an app you lay out.
const HELD = ['doc', 'note', 'sheet', 'board', 'canvas', 'slides'];

const sources = new Map(
  await Promise.all(
    HELD.map(async (id) => [id, await fsp.readFile(path.join(REPO, 'starters', `${id}.mrbl`), 'utf8')]),
  ),
);

/** The file with its comments taken out. Every rule below is about what the
 *  stylesheet and the script *do*, and a comment saying "a @media (max-width)
 *  here would be wrong" is a file explaining itself, not breaking a rule — which
 *  is exactly how the board first failed this suite. */
const code = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** The `:root` block, where a starter declares its palette. */
function rootBlock(source) {
  const at = source.indexOf(':root {');
  assert.notEqual(at, -1, 'a starter declares its tokens in :root');
  return source.slice(at, source.indexOf('\n  }', at));
}

/** Every line that sets an ordinary CSS property — which is to say, every line
 *  that is not declaring a custom property and not inside a drawing. A colour
 *  belongs in a `--token`; a colour written straight into `color:` is one that
 *  cannot follow the scheme and cannot be retinted. */
function propertyLines(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .filter((line) => !/<svg|data:image|&#\d+;|xmlns/.test(line))
    .filter((line) => /^\s*[a-z-]+\s*:/.test(line));
}

for (const id of HELD) {
  const source = sources.get(id);
  const bare = code(source);

  test(`${id}: one palette, said once`, () => {
    // `light-dark()` says both schemes in one declaration. A second copy of the
    // palette inside a media query is how a token comes to exist in one scheme
    // and not the other.
    assert.match(rootBlock(bare), /light-dark\(/, `${id} declares its tokens with light-dark()`);
    assert.equal(
      /@media[^{]*prefers-color-scheme/.test(bare),
      false,
      `${id} still has a prefers-color-scheme block — light-dark() replaces it`,
    );
  });

  test(`${id}: width is asked of the root, not the window`, () => {
    // A Marble host docks a panel beside the page by shrinking <html>; the
    // viewport never changes. Every @media (max-width) is a layout that is
    // wrong the moment somebody opens the agent drawer next to the document.
    // The container may be named anything — `doc` is what new work uses — but
    // there has to be one, and no width question may go to the window.
    assert.match(bare, /container:\s*[\w-]+\s*\/\s*inline-size/, `${id} declares a container on the root`);
    const widthQueries = [...bare.matchAll(/@media[^{]*\((?:max|min)-width[^)]*\)/g)].map((m) => m[0]);
    assert.deepEqual(widthQueries, [], `${id} asks the window about width instead of the container`);
    assert.match(bare, /@container [\w-]+ \((?:max|min)-width/, `${id} has at least one container breakpoint`);
  });

  test(`${id}: answers a finger and a person who asked for less motion`, () => {
    // 44px is owed to a finger, and it is asked for by the pointer rather than
    // by the width: a narrow window is still a mouse.
    assert.match(bare, /@media \((?:pointer: coarse|hover: none)/, `${id} sizes for a coarse pointer`);
    assert.match(bare, /@media \(prefers-reduced-motion: reduce\)/, `${id} has a reduced-motion block`);
  });

  test(`${id}: a long word is broken rather than carried`, () => {
    // Either keyword breaks the word. They differ where it matters most: only
    // `anywhere` shrinks the intrinsic min-content size, so inside a grid track
    // or a fixed-width column — a sheet cell, a board card — `break-word` lets
    // the track blow out anyway. That the layout really holds is a rendered
    // fact, and each starter's browser test drives a 200-character string at it;
    // this only catches a starter that never thought about it.
    assert.match(bare, /overflow-wrap:\s*(anywhere|break-word)/, `${id} breaks an unbroken string`);
  });

  test(`${id}: colour is a token, never a literal`, () => {
    // One accent does all the accenting. A hex written straight into a property
    // is a colour that cannot follow the scheme and cannot be retinted.
    const loose = propertyLines(bare)
      .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line))
      .map((line) => line.trim());
    assert.deepEqual(loose, [], `${id} writes a colour outside a token`);
  });

  test(`${id}: every addressable element gets a minted id`, () => {
    // `__ID__` is replaced once per occurrence at build time. A literal id
    // written into the template is the same id in every document made from it.
    // An id interpolated by script is `marble.newId()` doing its job.
    const literals = [...bare.matchAll(/data-marble-id="(?!__ID__|\$\{)([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(literals, [], `${id} writes a literal data-marble-id`);
  });

  test(`${id}: a class toggled at runtime says whose it is`, () => {
    // The doctor's rule, asserted at the source so it is caught before a
    // document is made: an unprefixed class toggled by script dies on a
    // reconcile, silently.
    const toggled = [...bare.matchAll(/classList\.(?:toggle|add|remove)\(\s*'([^']+)'/g)].map((m) => m[1]);
    const unprefixed = toggled.filter((name) => !name.startsWith('marble-'));
    assert.deepEqual(unprefixed, [], `${id} toggles a class a reconcile will drop`);
  });
}

test('every starter can undo', async () => {
  // Four of them shipped without `history`, so Mod+Z did nothing while the
  // carrier kept a complete inverse for every gesture.
  const { STARTERS } = await import('../server/gallery.js');
  for (const starter of STARTERS) {
    assert.ok(starter.parts.includes('history'), `${starter.id} binds undo`);
  }
});
