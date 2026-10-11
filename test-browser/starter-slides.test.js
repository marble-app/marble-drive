// The Slides starter, driven the way somebody builds a talk in it.
//
// Two questions run through all of it. The first is what reaches the file: a
// slide, its notes and its order are content and are filed; which slide you are
// looking at, whether you are presenting at all, and how far the type had to
// step down to fit are the page's and must leave the bytes alone. The second is
// whether the number is still a CSS counter — reorder the deck and every slide
// renumbers with nothing written down, which is this starter's whole point.

import assert from 'node:assert/strict';
import test from 'node:test';

import { build } from '../server/gallery.js';
import { startDrive } from './harness.js';

const demo = await build('slides', { name: 'Demo' });
const host = await startDrive({ agents: false, documents: { demo } });
test.after(() => host.close());

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async ({ width = 1280, height = 900, reducedMotion = 'no-preference', touch = false } = {}) => {
  await closePages();
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width, height }, reducedMotion, hasTouch: touch, isMobile: touch });
  pages.push(page);
  await page.goto(`${host.base}/a/demo`);
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(200);
  return { page, errors };
};

/** What the file says, once everything queued has reached it. */
const filed = async (page) => {
  await page.evaluate(() => window.marble.flush());
  const answer = await fetch(`${host.base}/a/demo`, { headers: { accept: 'text/html' } });
  return answer.text();
};

/** The deck as the file addresses it: one entry per slide, in order. */
const deck = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.slides > .slide')].map((slide) => ({
      id: slide.getAttribute('data-marble-id'),
      kind: slide.getAttribute('data-kind'),
      head: slide.querySelector('h2').textContent,
      notes: slide.querySelector('.notes').textContent,
    })),
  );

/** The markup, with everything that only talks about it taken out. */
const markup = (source) => source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
const stylesheet = (source) => source.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The number each slide is actually drawing, by the heading above it. A CSS
 * counter has no value anywhere in the DOM to ask for — getComputedStyle hands
 * back `counter(slide)` — so this reads what was rendered, out of the
 * accessibility tree, which is the only place the browser says it out loud.
 */
const drawn = async (page) => {
  const heads = await page.evaluate(() => [...document.querySelectorAll('.slides h2')].map((el) => el.textContent));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const said = nodes.filter((node) => node.role?.value === 'StaticText').map((node) => node.name?.value ?? '');
  const out = {};
  let head = null;
  for (const text of said) {
    if (heads.includes(text)) head = text;
    else if (head && /^\d+$/.test(text)) { out[head] = text; head = null; }
  }
  await cdp.detach();
  return out;
};

test('a deck of three, every slide addressed and numbered by CSS alone', async () => {
  const { page, errors } = await open();
  const all = await deck(page);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((slide) => slide.kind), ['title', 'point', 'point']);
  assert.equal(new Set(all.map((slide) => slide.id)).size, 3);
  assert.equal(await page.textContent('.count'), '3 slides');

  const source = await filed(page);
  // The number is drawn from the list's position, so nothing in the file says
  // what it is — and the rule that draws it is in the file rather than a script.
  assert.match(source, /counter-increment: slide/);
  assert.match(source, /content: counter\(slide\)/);
  assert.ok(!/data-(number|index|at)=/.test(source), 'no slide stores its own number');
  assert.deepEqual(await drawn(page), { Demo: '1', 'The point': '2', 'What follows from it': '3' });

  // Every width answer is asked of the root, not the window.
  assert.match(source, /html \{ container: doc \/ inline-size; \}/);
  assert.match(stylesheet(source), /@container doc \(max-width/);
  assert.ok(!/@media \(max-width/.test(stylesheet(source)), 'no width is asked of the window');
  assert.deepEqual(errors, []);
});

test('present mode is entered, advanced and left, and the file never hears about it', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.click('.play');
  await page.waitForTimeout(500);
  const shown = await page.evaluate(() => {
    const face = document.querySelector('.slide.marble-at .face');
    return {
      present: document.body.hasAttribute('data-present'),
      at: document.querySelector('.slide.marble-at')?.getAttribute('data-marble-id'),
      pos: document.querySelector('.pos').textContent,
      fills: face.getBoundingClientRect().width === innerWidth && face.getBoundingClientRect().height === innerHeight,
    };
  });
  assert.equal(shown.present, true);
  assert.equal(shown.pos, '1 / 3');
  assert.equal(shown.fills, true, 'the slide fills the screen');

  // Forward on a key, back on a key, and a click on the right half.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(450);
  assert.equal(await page.textContent('.pos'), '2 / 3');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(450);
  assert.equal(await page.textContent('.pos'), '1 / 3');
  await page.mouse.click(1100, 450);
  await page.waitForTimeout(450);
  assert.equal(await page.textContent('.pos'), '2 / 3');
  await page.mouse.click(120, 450);
  await page.waitForTimeout(450);
  assert.equal(await page.textContent('.pos'), '1 / 3');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-present')), false);

  // Everything above happened in the page and nowhere else.
  assert.equal(await filed(page), before, 'the file is byte-identical');
  assert.ok(!/data-present|marble-at/.test(markup(await filed(page))), 'nothing about presenting is in the markup');
  assert.deepEqual(errors, []);
});

test('the speaker notes are in the file and never on the screen while presenting', async () => {
  const { page, errors } = await open();
  const note = 'Ask the room who has tried it.';
  await page.click('.slides > .slide:nth-child(1) .notes');
  await page.keyboard.type(note);
  await page.waitForTimeout(200);
  assert.ok((await filed(page)).includes(note), 'a note is content, so it is filed');
  assert.equal(await page.isVisible('.slides > .slide:nth-child(1) .notes'), true);

  await page.click('.play');
  await page.waitForTimeout(500);
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('.notes')].every((el) => getComputedStyle(el).visibility === 'hidden'),
  );
  assert.equal(hidden, true, 'the room never sees the notes');
  assert.equal(await page.isVisible('.slides > .slide:nth-child(1) .notes'), false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await page.isVisible('.slides > .slide:nth-child(1) .notes'), true);
  assert.deepEqual(errors, []);
});

test('under reduced motion the move is a cross-fade and nothing travels', async () => {
  const { page, errors } = await open({ reducedMotion: 'reduce' });
  await page.click('.play');
  await page.waitForTimeout(120);
  const playing = await page.evaluate(() =>
    document.querySelector('.slide.marble-at .face').getAnimations()
      .map((animation) => [...animation.effect.getKeyframes()].map((frame) => frame.transform ?? 'none')),
  );
  assert.ok(playing.length, 'something is still animating');
  assert.ok(playing.flat().every((transform) => transform === 'none'), `travelled: ${JSON.stringify(playing)}`);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-present')), true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
});

test('a slide that will not fit shrinks twice and then says so', async () => {
  const { page, errors } = await open();
  const slide = '.slides > .slide:nth-child(2)';
  assert.equal(await page.evaluate((sel) => document.querySelector(sel).className, slide), 'slide marble-item');

  const grew = async (words) => {
    await page.click(`${slide} .face p`);
    await page.keyboard.press('End');
    await page.keyboard.insertText(' And then rather more about it than the sentence had.'.repeat(words));
    await page.waitForTimeout(400);
    return page.evaluate((sel) => [...document.querySelector(sel).classList], slide);
  };
  // A little too much shrinks the type; far too much stops shrinking and says so.
  const some = await grew(9);
  assert.ok(some.some((name) => name.startsWith('marble-fit-')), `no step down: ${some}`);
  assert.ok(!some.includes('marble-over'), 'and at that size it still fits');
  const far = await grew(10);
  assert.ok(far.includes('marble-fit-3'), `the ladder stopped at ${far}`);
  assert.ok(far.includes('marble-over'), 'and the slide says it is over-full');

  const shown = await page.evaluate((sel) => ({
    clip: getComputedStyle(document.querySelector(`${sel} .face`)).overflow,
    // Drawn on the frame, which neither clips nor scrolls under a caret.
    says: getComputedStyle(document.querySelector(`${sel} .frame`), '::after').content,
  }), slide);
  assert.equal(shown.clip, 'hidden', 'nothing spills out of the card');
  assert.match(shown.says, /Doesn’t fit/);

  // The reading is the page's, never the file's.
  assert.ok(!/marble-fit|marble-over/.test(markup(await filed(page))));
  assert.deepEqual(errors, []);
});

test('a real paste into a slide lands as plain text', async () => {
  const { page, errors } = await open();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  // The affordance says plaintext-only rather than filtering a paste itself, so
  // the thing to confirm is that the browser is really in that mode.
  const mode = await page.evaluate(() => document.querySelector('.face h2').contentEditable);
  assert.equal(mode, 'plaintext-only');

  await page.evaluate(async () => {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob(['<b style="color:red">So</b> <i>what now</i>'], { type: 'text/html' }),
      'text/plain': new Blob(['So what now'], { type: 'text/plain' }),
    })]);
  });
  const head = '.slides > .slide:nth-child(3) h2';
  await page.click(head);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+v');
  await page.waitForTimeout(300);

  assert.equal(await page.innerHTML(head), 'So what now', 'no markup came with it');
  const source = await filed(page);
  assert.ok(source.includes('So what now'));
  assert.ok(!source.includes('color:red'));
  assert.deepEqual(errors, []);
});

test('a slide goes in the middle, and undo takes it back out', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.hover('.slides > .slide:nth-child(2)');
  await page.click('.slides > .slide:nth-child(2) .seam');
  await page.waitForTimeout(300);

  let all = await deck(page);
  assert.equal(all.length, 4);
  assert.equal(all[1].head, 'New slide', 'it went above the slide whose seam was pressed');
  assert.equal(all[2].head, 'The point');
  assert.ok(all.every((slide) => slide.id), 'and it arrived named');
  assert.equal(await page.textContent('.count'), '4 slides');
  // A slide put in the middle and one put on the end are the same slide.
  assert.ok((await filed(page)).includes('data-ph="Speaker notes'));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(350);
  assert.equal((await deck(page)).length, 3);
  assert.equal(await filed(page), before, 'undone back to the byte');

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(350);
  assert.equal((await deck(page)).length, 4, 'and redone');
  assert.deepEqual(errors, []);
});

test('the adder at the end undoes, redoes, and survives a reload', async () => {
  const { page, errors } = await open();
  const before = await filed(page);

  await page.click('.add');
  await page.waitForTimeout(350);
  assert.equal((await deck(page)).length, 4);
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(400);
  assert.equal((await deck(page)).length, 3);
  assert.equal(await filed(page), before, 'adding a slide undoes to the byte');

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(400);
  assert.equal((await deck(page)).length, 4, 'and redoes');

  await page.click('.slides > .slide:nth-child(4) h2');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Thank you');
  await page.waitForTimeout(250);
  assert.ok((await filed(page)).includes('Thank you'));

  // Nothing that matters lives only in the page.
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble));
  await page.waitForTimeout(300);
  const all = await deck(page);
  assert.equal(all.length, 4, 'a reload shows the same deck');
  assert.equal(all[3].head, 'Thank you');
  assert.equal(await page.textContent('.count'), '4 slides');

  // Serializing a slide strips its transient children, so a slide that arrived
  // after the file was written has to be handed its chrome the same way the one
  // in the file is — or it comes back without a seam, a pill or a grip.
  const dressed = await page.evaluate(() =>
    [...document.querySelectorAll('.slides > .slide')].map((slide) =>
      ['.seam', '.kind', '.marble-handle', '.marble-remove'].every((sel) => slide.querySelector(sel))),
  );
  assert.deepEqual(dressed, [true, true, true, true]);
  assert.deepEqual(errors, []);
});

test('deleting a slide undoes to the byte, and it comes back whole', async () => {
  const { page, errors } = await open();
  const before = await filed(page);
  await page.hover('.slides > .slide:nth-child(2)');
  await page.click('.slides > .slide:nth-child(2) .marble-remove');
  await page.waitForTimeout(350);
  assert.equal((await deck(page)).length, 2);
  assert.ok(!(await filed(page)).includes('The point'));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(400);
  const all = await deck(page);
  assert.equal(all.length, 3);
  assert.equal(all[1].head, 'The point');
  assert.match(all[1].notes, /Slow down here/, 'and its notes came back with it');
  assert.equal(await filed(page), before, 'byte-identical to where it started');
  assert.deepEqual(errors, []);
});

test('reordering renumbers every slide without writing a number down', async () => {
  const { page, errors } = await open();
  const before = await filed(page);
  assert.deepEqual(await drawn(page), { Demo: '1', 'The point': '2', 'What follows from it': '3' });

  // The same move a pointer makes, from the keyboard: the grip is the only way
  // in for anyone not using a mouse.
  await page.hover('.slides > .slide:nth-child(1)');
  await page.focus('.slides > .slide:nth-child(1) .marble-handle');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(450);

  const all = await deck(page);
  assert.deepEqual(all.map((slide) => slide.head), ['The point', 'Demo', 'What follows from it']);
  // Every slide renumbered, and the only thing the file heard was the move.
  assert.deepEqual(await drawn(page), { 'The point': '1', Demo: '2', 'What follows from it': '3' });
  const source = await filed(page);
  assert.ok(!/>\s*[123]\s*</.test(markup(source)), 'no number was written down');
  const order = [...markup(source).matchAll(/<li class="slide" data-marble-id="([^"]+)"/g)].map((hit) => hit[1]);
  assert.deepEqual(order, all.map((slide) => slide.id), 'the file holds the new order and nothing else');

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(450);
  assert.equal(await filed(page), before, 'and the move undoes to the byte');
  assert.deepEqual(await drawn(page), { Demo: '1', 'The point': '2', 'What follows from it': '3' });
  assert.deepEqual(errors, []);
});

test('the title pill is a filed, undoable fact about the slide', async () => {
  const { page, errors } = await open();
  const pill = '.slides > .slide:nth-child(2) .kind';
  assert.equal(await page.getAttribute(pill, 'aria-pressed'), 'false');

  await page.click(pill);
  await page.waitForTimeout(250);
  assert.equal(await page.getAttribute(pill, 'aria-pressed'), 'true');
  assert.equal((await deck(page))[1].kind, 'title');
  assert.match(await filed(page), /data-kind="title"[\s\S]*data-kind="title"/);
  // aria-pressed is the page's reading of that one attribute, not a second copy.
  assert.ok(!markup(await filed(page)).includes('aria-pressed'));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  assert.equal((await deck(page))[1].kind, 'point');
  assert.equal(await page.getAttribute(pill, 'aria-pressed'), 'false', 'the pill followed the undo');
  assert.deepEqual(errors, []);
});

test('an emptied deck draws its own floor, and says how to start again', async () => {
  const { page, errors } = await open();
  for (const _ of [0, 1, 2]) {
    await page.hover('.slides > .slide:nth-child(1)');
    await page.click('.slides > .slide:nth-child(1) .marble-remove');
    await page.waitForTimeout(250);
  }
  const empty = await page.evaluate(() => {
    const list = document.querySelector('.slides');
    return {
      slides: list.children.length,
      height: list.getBoundingClientRect().height,
      says: getComputedStyle(list, '::after').content,
      play: document.querySelector('.play').getAttribute('aria-disabled'),
      count: document.querySelector('.count').textContent,
    };
  });
  assert.equal(empty.slides, 0);
  assert.ok(empty.height > 100, `the deck collapsed to ${empty.height}px`);
  assert.match(empty.says, /add the first one/i);
  assert.equal(empty.play, 'true', 'and there is nothing to present');
  assert.equal(empty.count, '0 slides');

  // Pressing Present with an empty deck must do nothing rather than throw.
  await page.evaluate(() => document.querySelector('.play').click());
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.body.hasAttribute('data-present')), false);

  await page.click('.add');
  await page.waitForTimeout(300);
  assert.equal((await deck(page)).length, 1);
  assert.deepEqual(errors, []);
});

test('three widths, one deck, no console error', async () => {
  for (const width of [390, 740, 1280]) {
    const { page, errors } = await open({ width, height: 844 });
    const shape = await page.evaluate(() => {
      const face = document.querySelector('.face');
      const box = face.getBoundingClientRect();
      return {
        ratio: box.width / box.height,
        inside: box.left >= 30,                       // the drag grip has its gutter
        head: parseFloat(getComputedStyle(face.querySelector('h2')).fontSize),
        add: document.querySelector('.add').getBoundingClientRect().height,
      };
    });
    assert.ok(Math.abs(shape.ratio - 16 / 9) < 0.02, `${width}: a slide is 16:9 everywhere, got ${shape.ratio}`);
    assert.ok(shape.inside, `${width}: the grip would hang off the edge`);
    assert.ok(shape.head > 18, `${width}: the heading came out at ${shape.head}px`);
    assert.ok(shape.add >= 40, `${width}: the adder is ${shape.add}px tall`);
    assert.deepEqual(errors, [], `${width} logged ${errors}`);
  }
});

test('under a finger, every control this deck draws is 44 across', async () => {
  const { page, errors } = await open({ width: 390, height: 844, touch: true });
  await page.click('.play');
  await page.waitForTimeout(500);
  const sizes = await page.evaluate(() =>
    ['.play', '.leave', '.add', '.slides > .slide .seam', '.slides > .slide .kind'].map((sel) => {
      const box = document.querySelector(sel).getBoundingClientRect();
      return { sel, w: Math.round(box.width), h: Math.round(box.height) };
    }),
  );
  for (const { sel, w, h } of sizes) {
    assert.ok(h >= 44, `${sel} is ${h}px tall`);
    assert.ok(w >= 44, `${sel} is ${w}px wide`);
  }
  // Nothing hides behind a hover where there is no hover to hide behind.
  const seen = await page.evaluate(() =>
    ['.seam', '.kind'].map((sel) => Number(getComputedStyle(document.querySelector(`.slides > .slide ${sel}`)).opacity)),
  );
  assert.ok(seen.every((opacity) => opacity > 0.5), `hidden at ${seen}`);
  assert.deepEqual(errors, []);
});
