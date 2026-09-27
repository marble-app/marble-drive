import assert from 'node:assert/strict';
import test from 'node:test';

import { diffLines, merge3, settleIds, splitLines } from '../server/app-merge.js';

const L = (s) => splitLines(s);
let n = 0;
const newId = () => `new${String(++n).padStart(5, '0')}`;
const run = (base, ours, theirs) => {
  const O = L(ours);
  const m = merge3(L(base), O, L(theirs));
  return { ...m, text: m.conflicts.length ? null : settleIds(m.lines, O, newId).text };
};

test('splitLines keeps every byte', () => {
  for (const s of ['', 'a', 'a\n', 'a\nb', 'a\n\nb\n']) assert.equal(L(s).join(''), s);
});

test('diffLines matches the longest common run', () => {
  const pairs = diffLines(L('a\nb\nc\nd\n'), L('a\nx\nc\nd\ny\n'));
  assert.deepEqual(pairs, [[0, 0], [2, 2], [3, 3]]);
});

test('a template change lands in a document that changed elsewhere', () => {
  const base = '<style>\n.a { color: red; }\n</style>\n<body>\n<ul>\n</ul>\n</body>\n';
  const ours = '<style>\n.a { color: red; }\n</style>\n<body>\n<ul>\n<li data-marble-id="mine0001">pin</li>\n</ul>\n</body>\n';
  const theirs = '<style>\n.a { color: blue; }\n.b { gap: 1px; }\n</style>\n<body>\n<ul>\n</ul>\n</body>\n';
  const r = run(base, ours, theirs);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.text, '<style>\n.a { color: blue; }\n.b { gap: 1px; }\n</style>\n<body>\n<ul>\n<li data-marble-id="mine0001">pin</li>\n</ul>\n</body>\n');
});

test('ids differ between a document and a fresh build, and the document keeps its own', () => {
  const base = '<div data-marble-id="base0001" class="side">\n<p data-marble-id="base0002">x</p>\n</div>\n';
  const ours = '<div data-marble-id="ours0001" class="side">\n<p data-marble-id="ours0002">x</p>\n</div>\n';
  const theirs = '<div data-marble-id="thrs0001" class="side">\n<p data-marble-id="thrs0002">x</p>\n<p data-marble-id="thrs0003">y</p>\n</div>\n';
  const r = run(base, ours, theirs);
  assert.equal(r.text, '<div data-marble-id="ours0001" class="side">\n<p data-marble-id="ours0002">x</p>\n<p data-marble-id="thrs0003">y</p>\n</div>\n');
});

test('an element the template rewrote keeps the id it had', () => {
  const base = '<nav data-marble-id="b1" class="rail">\n<i>a</i>\n</nav>\n';
  const ours = '<nav data-marble-id="o1" class="rail">\n<i>a</i>\n</nav>\n';
  const theirs = '<nav data-marble-id="t1" class="rail" aria-label="Places">\n<i>a</i>\n</nav>\n';
  assert.equal(run(base, ours, theirs).text, '<nav data-marble-id="o1" class="rail" aria-label="Places">\n<i>a</i>\n</nav>\n');
});

test('the same edit on both sides is one edit', () => {
  const r = run('a\nb\nc\n', 'a\nB\nc\n', 'a\nB\nc\n');
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.text, 'a\nB\nc\n');
});

test('different edits to one place conflict, and nothing is written', () => {
  const r = run('a\nb\nc\n', 'a\nmine\nc\n', 'a\ntheirs\nc\n');
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.text, null);
});

test('nothing moved in the template means the document comes back as it was', () => {
  const ours = 'a\n<p data-marble-id="k1">edited</p>\nc\n';
  const r = run('a\n<p data-marble-id="z9">b</p>\nc\n', ours, 'a\n<p data-marble-id="q7">b</p>\nc\n');
  assert.equal(r.changed, 0);
  assert.equal(r.text, ours);
});

test('a fresh id never collides with one the document holds', () => {
  const r = run('a\n', 'a\n<p data-marble-id="dup00001">mine</p>\n', 'a\nz\n<p data-marble-id="dup00001">new</p>\n');
  // Ours appended at the end and theirs inserted after "a": both at the end of
  // base, so they touch — a conflict, which is the careful answer.
  assert.equal(r.conflicts.length, 1);
  const r2 = run('a\nb\nc\n', '<p data-marble-id="dup00001">mine</p>\na\nb\nc\n', 'a\nb\n<p data-marble-id="dup00001">new</p>\nc\n');
  assert.equal(r2.conflicts.length, 0);
  assert.match(r2.text, /data-marble-id="dup00001">mine/);
  assert.doesNotMatch(r2.text, /data-marble-id="dup00001">new/);
});

test('where both reworded the same words on the page, the owner’s words win', () => {
  const base = '<style>\n.a{}\n</style>\n<p data-marble-id="b1" data-marble-rich>Sample text.</p>\n';
  const ours = '<style>\n.a{}\n</style>\n<p data-marble-id="o1" data-marble-rich>Sample text. My trip starts Friday.</p>\n';
  const theirs = '<style>\n.a{ gap: 1px }\n</style>\n<p data-marble-id="t1" data-marble-rich>Better sample text.</p>\n';
  const r = run(base, ours, theirs);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.kept, 1);
  assert.equal(r.text, '<style>\n.a{ gap: 1px }\n</style>\n<p data-marble-id="o1" data-marble-rich>Sample text. My trip starts Friday.</p>\n');
});

test('a disagreement over the app itself still holds the page back', () => {
  const r = run('<script>\nrun(1);\n</script>\n', '<script>\nrun(2);\n</script>\n', '<script>\nrun(3);\n</script>\n');
  assert.equal(r.conflicts.length, 1);
});
