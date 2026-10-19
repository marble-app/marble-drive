// Marks stay on their parts, and only where a part can be seen (sight.js):
// not on a slide switched away, not past the edge of the box a part scrolls
// in though that edge is within the window, not over the page's own header,
// not on a panel faded out, and following a part that moves with no event
// to say so.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const DECK = `<!doctype html>
<html><head><meta charset="utf-8"><title>Deck</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; }
  .bar { position: sticky; top: 0; height: 60px; background: #eee; z-index: 5; }
  .slide { display: none; padding: 40px; }
  .slide.on { display: block; }
  .view { width: 400px; height: 200px; overflow: hidden; margin: 20px 40px; }
  .track { display: flex; width: 800px; transition: transform 300ms linear; }
  .track > div { width: 400px; height: 200px; flex: none; }
  .box { height: 120px; width: 300px; overflow: auto; margin: 20px 40px; border: 1px solid #ccc; }
  .box > p { height: 60px; margin: 0; }
  .fade { opacity: 1; margin: 20px 40px; }
  .fade.out { opacity: 0; }
  .spacer { height: 1600px; }
</style></head>
<body data-marble-id="b">
  <div class="bar" data-marble-id="bar">Header</div>
  <section class="slide on" data-marble-id="s1"><h2 data-marble-id="s1h">One</h2></section>
  <section class="slide" data-marble-id="s2"><h2 data-marble-id="s2h">Two</h2></section>
  <div class="view" data-marble-id="view"><div class="track" data-marble-id="track">
    <div data-marble-id="t1">First</div><div data-marble-id="t2">Second</div>
  </div></div>
  <div class="box" data-marble-id="box">
    <p data-marble-id="p1">One</p><p data-marble-id="p2">Two</p><p data-marble-id="p3">Three</p><p data-marble-id="p4">Four</p>
  </div>
  <div class="fade" data-marble-id="fade"><p data-marble-id="fp">Faded</p></div>
  <p data-marble-id="mover" style="margin: 20px 40px; width: 200px">Moves</p>
  <div class="spacer" data-marble-id="spacer"></div>
</body></html>
`;

const host = await startDrive({ documents: { deck: DECK } });
test.after(() => host.close());

const open = async () => {
  const { page } = await host.newPage({ attending: ['c1'] });
  await page.goto(`${host.base}/a/deck`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleChange && window.marbleSight && document.querySelector('.marble-change-layer')));
  await page.waitForTimeout(200);
  return page;
};
const frame = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
}, detail);
// A step whose reach is these parts: each gets its light tint, all at once.
const reach = (page, ids) => frame(page, {
  client: 'agent:c1', ids: [ids[0]], phase: 'writing', note: 'Mark them.', turn: 'c1-t1', stage: 'before',
  parts: [ids[0]], reach: ids, inserts: [], removes: [], moves: [], kind: 'attr', step: null, count: 1, total: ids.length,
});
const paints = (page, n = 3) => page.evaluate(async (k) => { for (let i = 0; i < k; i += 1) await new Promise(requestAnimationFrame); }, n);
/** A tint, as seen: whether it is shown, how far it is from its part, and its clip. */
const tint = (page, id) => page.evaluate((i) => {
  const el = document.querySelector(`.marble-change-tint[data-id="${i}"]`);
  if (!el) return null;
  const part = document.querySelector(`[data-marble-id="${i}"]`).getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const shown = !el.hidden && getComputedStyle(el).display !== 'none';
  return { shown, off: Math.round(Math.max(Math.abs(r.top - part.top), Math.abs(r.left - part.left))), clip: el.style.clipPath };
}, id);

test('a part on a slide switched away loses its tint, and has it back, in place, when the slide is', async () => {
  const page = await open();
  await reach(page, ['s1h', 's2h']);
  await page.locator('.marble-change-tint[data-id="s1h"]').waitFor();
  assert.equal((await tint(page, 's1h')).shown, true);
  assert.equal(await tint(page, 's2h'), null, 'nothing is drawn for a part on a slide not shown');
  await page.evaluate(() => {
    document.querySelector('[data-marble-id="s1"]').classList.remove('on');
    document.querySelector('[data-marble-id="s2"]').classList.add('on');
  });
  await paints(page);
  assert.equal((await tint(page, 's1h')).shown, false, 'the tint left behind is not left where the part was');
  const two = await tint(page, 's2h');
  assert.equal(two.shown, true);
  assert.ok(two.off <= 8, `on its part (${two.off}px off)`);
  await page.evaluate(() => {
    document.querySelector('[data-marble-id="s2"]').classList.remove('on');
    document.querySelector('[data-marble-id="s1"]').classList.add('on');
  });
  await paints(page);
  const one = await tint(page, 's1h');
  assert.equal(one.shown, true);
  assert.ok(one.off <= 8, `back on its part (${one.off}px off)`);
  await page.context().close();
});

test('a part slid out of the box it is shown in, though still in the window, is not drawn; one sliding is followed', async () => {
  const page = await open();
  await reach(page, ['t1', 't2']);
  await page.locator('.marble-change-tint[data-id="t1"]').waitFor();
  assert.equal((await tint(page, 't1')).shown, true);
  assert.equal(await tint(page, 't2'), null, 'the second card is clipped by its view');
  await page.evaluate(() => { document.querySelector('[data-marble-id="track"]').style.transform = 'translateX(-400px)'; });
  // Mid-slide, with no event between: the tint keeps to its card.
  await page.waitForTimeout(150);
  await paints(page, 2);
  const mid = await tint(page, 't2');
  assert.ok(mid?.shown, 'the incoming card is drawn as it slides in');
  assert.ok(mid.off <= 30, `and kept to it mid-slide (${mid.off}px off)`);
  assert.notEqual(mid.clip, '', 'cut where the view cuts it');
  await page.waitForTimeout(400);
  await paints(page);
  assert.equal((await tint(page, 't1')).shown, false, 'the card slid away is not drawn');
  const done = await tint(page, 't2');
  assert.ok(done.shown && done.off <= 8, `the card slid in is drawn on it (${done.off}px off)`);
  await page.context().close();
});

test('a row scrolled out of its box is not drawn, and one half out is cut at the box’s edge', async () => {
  const page = await open();
  await reach(page, ['p1', 'p2', 'p3']);
  await page.locator('.marble-change-tint[data-id="p1"]').waitFor();
  await page.evaluate(() => { document.querySelector('[data-marble-id="box"]').scrollTop = 90; });
  await paints(page);
  assert.equal((await tint(page, 'p1')).shown, false, 'scrolled out of the box, though within the window');
  const half = await tint(page, 'p2');
  assert.equal(half.shown, true);
  assert.match(half.clip, /polygon/, 'cut at the top of the box');
  assert.equal((await tint(page, 'p3')).clip, '', 'a row wholly in the box is not cut');
  await page.context().close();
});

test('a part scrolled under the page’s own header is cut by it, and hidden once wholly under it', async () => {
  const page = await open();
  await reach(page, ['s1h', 'p4']);
  await page.locator('.marble-change-tint[data-id="s1h"]').waitFor();
  const top = await page.evaluate(() => document.querySelector('[data-marble-id="s1h"]').getBoundingClientRect().top);
  // Half under the 60px bar, then wholly.
  await page.evaluate((y) => scrollTo(0, y - 60 + 12), top);
  await paints(page);
  const half = await tint(page, 's1h');
  assert.equal(half.shown, true);
  assert.match(half.clip, /polygon/, 'cut along the bottom of the header');
  await page.evaluate((y) => scrollTo(0, y - 10), top);
  await paints(page);
  assert.equal((await tint(page, 's1h')).shown, false, 'wholly under the header, not drawn over it');
  await page.context().close();
});

test('a part faded out is not drawn; a part moved by an animation is followed', async () => {
  const page = await open();
  await reach(page, ['fp', 'mover']);
  await page.locator('.marble-change-tint[data-id="fp"]').waitFor();
  await page.evaluate(() => document.querySelector('[data-marble-id="fade"]').classList.add('out'));
  await paints(page);
  assert.equal((await tint(page, 'fp')).shown, false);
  await page.evaluate(() => {
    document.querySelector('[data-marble-id="mover"]').animate([{ transform: 'none' }, { transform: 'translateX(300px)' }], { duration: 400, fill: 'forwards' });
  });
  await page.waitForTimeout(550);
  await paints(page);
  const moved = await tint(page, 'mover');
  assert.ok(moved.shown && moved.off <= 8, `on the part where the animation left it (${moved.off}px off)`);
  await page.context().close();
});

test('the tag goes with its part when the part goes out of sight, and never hangs where it was', async () => {
  const page = await open();
  await reach(page, ['s1h', 'fp']);
  await page.locator('.marble-change-tag').waitFor();
  const near = (id) => page.evaluate((i) => {
    const tag = document.querySelector('.marble-change-tag')?.getBoundingClientRect();
    const part = document.querySelector(`[data-marble-id="${i}"]`).getBoundingClientRect();
    return tag ? Math.abs(tag.bottom - part.top) < 40 : null;
  }, id);
  assert.equal(await near('s1h'), true, 'it hangs from the part changing now');
  await page.evaluate(() => document.querySelector('[data-marble-id="s1"]').classList.remove('on'));
  await paints(page);
  await page.waitForTimeout(500); // it glides there
  assert.equal(await near('fp'), true, 'its slide switched away, it moves to a part still seen');
  await page.evaluate(() => document.querySelector('[data-marble-id="fade"]').classList.add('out'));
  await paints(page);
  assert.equal(await page.locator('.marble-change-tag').count(), 0, 'with nothing of the change seen, no tag');
  await page.evaluate(() => document.querySelector('[data-marble-id="s1"]').classList.add('on'));
  await paints(page);
  assert.equal(await page.locator('.marble-change-tag').count(), 1, 'back with the slide');
  await page.context().close();
});

test('zooming the page keeps each tint on its part', async () => {
  const page = await open();
  await reach(page, ['s1h', 't1']);
  await page.locator('.marble-change-tint[data-id="t1"]').waitFor();
  await page.evaluate(() => { document.body.style.zoom = '1.4'; });
  await paints(page);
  for (const id of ['s1h', 't1']) {
    const zoomed = await tint(page, id);
    assert.ok(zoomed.shown && zoomed.off <= 8, `zoomed in, ${id} is on its part (${zoomed.off}px off)`);
  }
  await page.setViewportSize({ width: 700, height: 600 });
  await paints(page);
  const narrow = await tint(page, 's1h');
  assert.ok(narrow.shown && narrow.off <= 8, `in a narrower window, on its part (${narrow.off}px off)`);
  await page.context().close();
});
