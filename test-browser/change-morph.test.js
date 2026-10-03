// The engine (v5, Notes and Sketches/Ask at Anything, "End states in, motion
// out" and "Scales, not a queue"): nothing that writes to a page animates it.
// The page snapshots what was before a batch lands and plays it to what is,
// in loose batches spread over the page, and the marks lift as each part's
// motion ends. These tests call `window.marbleMorph` straight on a served
// page, and drive one followed turn through it end to end.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const CARDS = `<!doctype html>
<html><head><meta charset="utf-8"><title>Cards</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; }
  .grid { display: grid; grid-template-columns: repeat(3, 200px); gap: 16px; }
  .card { padding: 16px; background-color: #ffffff; border: 1px solid #dddddd; }
  .card.round { border-radius: 16px; background-color: #dbe8f5; }
  .card.alert { background-color: #ff0000; }
  ul { padding: 0; margin: 24px 0 0; list-style: none; width: 400px; }
  li { padding: 6px 0; }
  p { width: 520px; }
</style>
<style data-marble-id="look">.card { border-radius: 0; }</style>
</head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Cards</h1>
  <div class="grid" data-marble-id="g">
    <div class="card" data-marble-id="c1">One</div>
    <div class="card" data-marble-id="c2">Two</div>
    <div class="card" data-marble-id="c3">Three</div>
    <div class="card" data-marble-id="c4" contenteditable="true">Four</div>
    <div class="card" data-marble-id="c5">Five</div>
    <div class="card" data-marble-id="c6">Six</div>
  </div>
  <p data-marble-id="p">Open questions we keep coming back to.</p>
  <ul data-marble-id="l">
    <li data-marble-id="l1">Why do people stop using a tool?</li>
    <li data-marble-id="l2">What makes an interface feel alive?</li>
    <li data-marble-id="l3">Who is the page for?</li>
  </ul>
</body></html>
`;

const MANY = `<!doctype html>
<html><head><meta charset="utf-8"><title>Many</title>
<style>body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; } li { padding: 2px 0; }</style></head>
<body data-marble-id="b">
  <ul data-marble-id="u">${Array.from({ length: 80 }, (_, i) => `<li data-marble-id="m${i}">Paper ${i + 1}</li>`).join('')}</ul>
</body></html>
`;

const CARD_IDS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

const SCRIPTS = {
  restyle: [
    { call: 'read_document', args: { path: 'cards' } },
    {
      call: 'apply_ops',
      args: { path: 'cards', note: 'Round the cards.', ops: CARD_IDS.map((id) => ({ type: 'setAttr', id, name: 'class', value: 'card round' })) },
    },
    { say: 'Done.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { cards: CARDS, many: MANY } });
test.after(() => host.close());

const pages = [];
const closePages = async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); };
test.after(closePages);

const api = async (method, url, body) => {
  const response = await fetch(`${host.base}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
};

const open = async ({ doc = 'cards', ...options } = {}) => {
  await closePages();
  const { page, errors } = await host.newPage(options);
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.apply && window.marbleMorph));
  return { page, errors };
};

// Every motion this engine started is tagged, so it cancels only its own.
const OURS = 'marble-morph';

// ------------------------------------------------------------ the dealer

test('choreograph deals 30 parts in batches of 2–6, far from the batch before, all started within 600 ms', async () => {
  const { page } = await open();
  const runs = await page.evaluate(() => {
    // A seeded random, so every run of this test sees the same deals.
    const seeded = (seed) => () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `x${i}`, rect: { left: (i % 6) * 200, top: Math.floor(i / 6) * 120, width: 180, height: 100 },
    }));
    const out = [];
    for (let seed = 1; seed <= 40; seed += 1) {
      const dealt = window.marbleMorph.choreograph(items, { random: seeded(seed) });
      out.push(dealt.map(({ item, delay, duration, batch }) => ({ id: item.id, delay, duration, batch })));
    }
    out.push(window.marbleMorph.choreograph(items).map(({ item, delay, duration, batch }) => ({ id: item.id, delay, duration, batch })));
    return { out, items };
  });
  const centre = new Map(runs.items.map((it) => [it.id, { x: it.rect.left + 90, y: it.rect.top + 50 }]));
  const distances = [];
  const all = [...centre.values()];
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) distances.push(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y));
  distances.sort((a, b) => a - b);
  const median = distances[Math.floor(distances.length / 2)];
  for (const dealt of runs.out) {
    assert.equal(dealt.length, 30, 'every part is dealt once');
    assert.equal(new Set(dealt.map((d) => d.id)).size, 30);
    for (const { delay, duration } of dealt) {
      assert.ok(delay >= 0 && delay <= 600, `delay ${delay}`);
      assert.ok(duration >= 380 && duration <= 460, `duration ${duration}`);
    }
    const batches = new Map();
    for (const d of dealt) (batches.get(d.batch) ?? batches.set(d.batch, []).get(d.batch)).push(d);
    const order = [...batches.keys()].sort((a, b) => a - b);
    for (const k of order) {
      const members = batches.get(k);
      assert.ok(members.length >= 2 && members.length <= 6, `a batch of ${members.length}`);
      assert.equal(new Set(members.map((m) => m.delay)).size, 1, 'a batch starts together');
    }
    const starts = order.map((k) => batches.get(k)[0].delay);
    for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] > starts[i - 1], 'batches start one after another');
    const centroids = order.map((k) => {
      const members = batches.get(k).map((m) => centre.get(m.id));
      return { x: members.reduce((s, p) => s + p.x, 0) / members.length, y: members.reduce((s, p) => s + p.y, 0) / members.length };
    });
    for (let i = 1; i < centroids.length; i += 1) {
      const apart = Math.hypot(centroids[i].x - centroids[i - 1].x, centroids[i].y - centroids[i - 1].y);
      assert.ok(apart > median, `consecutive batches ${Math.round(apart)}px apart, median pair ${Math.round(median)}px`);
    }
  }
  // About 60 ms apart, give or take 30; a deal that would run past 600 ms is
  // squeezed into it instead.
  const gaps = [];
  let squeezed = 0;
  for (const dealt of runs.out) {
    const starts = [...new Set(dealt.map((d) => d.delay))].sort((a, b) => a - b);
    const these = starts.slice(1).map((s, i) => s - starts[i]);
    if (starts.at(-1) === 600) squeezed += 1;
    else gaps.push(...these);
  }
  assert.ok(gaps.length > 100, 'most deals of 30 fit in the window as they are');
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  assert.ok(mean > 50 && mean < 70, `mean gap ${mean}`);
  assert.ok(gaps.every((g) => g >= 29 && g <= 91), `each gap is 60 ms, give or take 30 (${Math.min(...gaps)}–${Math.max(...gaps)})`);
  assert.ok(squeezed < runs.out.length / 2, `${squeezed} deals squeezed`);
});

// ------------------------------------------------------------ motions, one by one

test('a sheet that rounds six cards plays each card’s corners from 0 to 16px, and nothing is left running after', async () => {
  const { page, errors } = await open();
  const seen = await page.evaluate(async (ours) => {
    const phases = [];
    const snap = window.marbleMorph.capture(['look'], { kind: 'look' });
    window.marble.apply({ type: 'setInner', id: 'look', html: '.card { border-radius: 16px; }' });
    const played = window.marbleMorph.play(snap, { onPart: (id, phase) => phases.push([id, phase]) });
    const cards = [...document.querySelectorAll('.card')];
    const rounded = cards.filter((card) => card.getAnimations().some((a) => a.id === ours
      && a.effect.getKeyframes().some((k) => 'borderTopLeftRadius' in k))).length;
    const first = cards[0].getAnimations().find((a) => a.id === ours && a.effect.getKeyframes().some((k) => 'borderTopLeftRadius' in k));
    const keys = first?.effect.getKeyframes().map((k) => k.borderTopLeftRadius);
    const easing = first?.effect.getTiming().easing;
    const fill = first?.effect.getTiming().fill;
    const delays = cards.map((card) => card.getAnimations().find((a) => a.id === ours)?.effect.getTiming().delay ?? null);
    await played;
    return {
      rounded, keys, easing, fill, delays, phases,
      radius: getComputedStyle(cards[0]).borderTopLeftRadius,
      left: document.getAnimations().filter((a) => a.id === ours).length,
    };
  }, OURS);
  assert.equal(seen.rounded, 6, 'every card’s corners move');
  assert.deepEqual(seen.keys, ['0px', '16px']);
  assert.equal(seen.easing, 'cubic-bezier(0.22, 1, 0.36, 1)');
  assert.equal(seen.fill, 'backwards', 'the corners hold what was until their batch starts');
  assert.ok(new Set(seen.delays).size > 1, `the cards start in batches, not all at once (${seen.delays})`);
  assert.ok(seen.delays.every((d) => d >= 0 && d <= 600));
  assert.equal(seen.radius, '16px');
  assert.equal(seen.left, 0, 'no motion of the engine’s is left on the page');
  assert.deepEqual(seen.phases.filter(([, phase]) => phase === 'end'), [['look', 'end']]);
  assert.deepEqual(errors, []);
});

test('a colour moves through OKLCH', async () => {
  const { page } = await open();
  const seen = await page.evaluate(async (ours) => {
    const snap = window.marbleMorph.capture(['c1'], { kind: 'look' });
    window.marble.apply({ type: 'setAttr', id: 'c1', name: 'class', value: 'card alert' });
    const played = window.marbleMorph.play(snap, {});
    const card = document.querySelector('[data-marble-id="c1"]');
    const colour = card.getAnimations().find((a) => a.id === ours && a.effect.getKeyframes().some((k) => 'backgroundColor' in k));
    const keys = colour?.effect.getKeyframes().map((k) => k.backgroundColor) ?? [];
    const timing = colour?.effect.getTiming();
    await played;
    return { keys, duration: timing?.duration, easing: timing?.easing, after: getComputedStyle(card).backgroundColor };
  }, OURS);
  assert.ok(seen.keys.length >= 2, 'a colour animation on the card');
  assert.ok(seen.keys.every((k) => k.startsWith('oklch(')), `keyframes ${JSON.stringify(seen.keys)}`);
  const [L0, C0] = seen.keys[0].match(/[\d.]+/g).map(Number);
  assert.ok(Math.abs(L0 - 1) < 0.005 && C0 < 0.005, `white is oklch(1 0 h): ${seen.keys[0]}`);
  const [L1, C1, H1] = seen.keys.at(-1).match(/[\d.]+/g).map(Number);
  assert.ok(Math.abs(L1 - 0.628) < 0.005 && Math.abs(C1 - 0.2577) < 0.005 && Math.abs(H1 - 29.23) < 0.5, `red is oklch(.628 .258 29.2): ${seen.keys.at(-1)}`);
  assert.equal(seen.duration, 300);
  assert.equal(seen.easing, 'cubic-bezier(0.22, 0.61, 0.36, 1)');
  assert.equal(seen.after, 'rgb(255, 0, 0)');
});

test('a row put in rises from nothing, and the rows below it make room', async () => {
  const { page } = await open();
  const seen = await page.evaluate(async (ours) => {
    const inserts = [{ parentId: 'l', beforeId: 'l2', ids: ['l9'] }];
    const snap = window.marbleMorph.capture(['l9'], { kind: 'structure', inserts });
    window.marble.apply({ type: 'insert', parentId: 'l', beforeId: 'l2', html: '<li data-marble-id="l9">What is a part?</li>' });
    const phases = [];
    const played = window.marbleMorph.play(snap, { onPart: (id, phase) => phases.push([id, phase]) });
    const row = document.querySelector('[data-marble-id="l9"]');
    const rise = row.getAnimations().find((a) => a.id === ours);
    const keys = rise?.effect.getKeyframes().map((k) => ({ opacity: k.opacity, transform: k.transform }));
    const below = document.querySelector('[data-marble-id="l3"]').getAnimations()
      .some((a) => a.id === ours && a.effect.getKeyframes().some((k) => /translate/.test(k.transform ?? '')));
    await played;
    return { keys, duration: rise?.effect.getTiming().duration, below, phases };
  }, OURS);
  assert.deepEqual(seen.keys, [{ opacity: '0', transform: 'translateY(3px) scale(0.98)' }, { opacity: '1', transform: 'none' }]);
  assert.equal(seen.duration, 340);
  assert.equal(seen.below, true, 'the row below moved down to make room');
  assert.deepEqual(seen.phases.map((p) => p.join(':')), ['l9:start', 'l9:end']);
});

test('a row taken out leaves a ghost that fades where it stood, and the row below closes the gap', async () => {
  const { page } = await open();
  const seen = await page.evaluate(async (ours) => {
    const snap = window.marbleMorph.capture(['l2'], { kind: 'structure', removes: ['l2'] });
    window.marble.apply({ type: 'remove', id: 'l2' });
    const played = window.marbleMorph.play(snap, {});
    const layer = document.querySelector('.marble-morph-layer');
    const ghost = layer?.firstElementChild;
    const was = ghost && {
      transient: ghost.hasAttribute('data-marble-transient'),
      text: ghost.textContent.trim(),
      ids: ghost.querySelectorAll('[data-marble-id]').length + (ghost.hasAttribute('data-marble-id') ? 1 : 0),
      pointer: getComputedStyle(ghost).pointerEvents,
      position: getComputedStyle(ghost).position,
      outside: !document.body.contains(ghost),
    };
    const closes = document.querySelector('[data-marble-id="l3"]').getAnimations()
      .some((a) => a.id === ours && a.effect.getKeyframes().some((k) => /translate/.test(k.transform ?? '')));
    await played;
    return { was, closes, after: layer?.children.length ?? 0, gone: !document.querySelector('[data-marble-id="l2"]') };
  }, OURS);
  assert.deepEqual(seen.was, {
    transient: true, text: 'What makes an interface feel alive?', ids: 0, pointer: 'none', position: 'fixed', outside: true,
  });
  assert.equal(seen.closes, true, 'the row below moved up into the gap');
  assert.equal(seen.after, 0, 'the ghost is gone once it has faded');
  assert.equal(seen.gone, true);
});

test('new words are written in after the old ones fade, and nothing of it is left after', async () => {
  const { page } = await open();
  const words = 'Open questions we keep returning to, and why they matter.';
  const seen = await page.evaluate(async ([text]) => {
    const snap = window.marbleMorph.capture(['p'], { kind: 'words', client: 'agent:someone' });
    window.marble.apply({ type: 'setText', id: 'p', text });
    const played = window.marbleMorph.play(snap, {});
    const hidden = CSS.highlights.has('marble-morph-unwritten');
    const ghost = document.querySelector('.marble-morph-layer')?.textContent ?? '';
    await new Promise((resolve) => setTimeout(resolve, 260));
    const mid = CSS.highlights.has('marble-morph-unwritten');
    const t0 = performance.now();
    await played;
    return {
      hidden, ghost, mid, waited: performance.now() - t0,
      after: CSS.highlights.has('marble-morph-unwritten'),
      layer: document.querySelector('.marble-morph-layer')?.children.length ?? 0,
      text: document.querySelector('[data-marble-id="p"]').textContent,
    };
  }, [words]);
  assert.equal(seen.hidden, true, 'the new words wait unwritten');
  assert.match(seen.ghost, /coming back to\./, 'the old words are drawn where they stood');
  assert.equal(seen.mid, true, 'still being written mid-way');
  assert.ok(seen.waited > 50, 'the words take a while to write');
  assert.equal(seen.after, false);
  assert.equal(seen.layer, 0);
  assert.equal(seen.text, words);
});

test('a frame that names no inserts or removes, as an undo’s does, still plays a row put back and a row taken out', async () => {
  const { page } = await open();
  const seen = await page.evaluate(async (ours) => {
    // An undo's frame says only which parts it touches.
    let snap = window.marbleMorph.capture(['l2'], {});
    window.marble.apply({ type: 'remove', id: 'l2' });
    let played = window.marbleMorph.play(snap, {});
    const ghost = document.querySelector('.marble-morph-layer')?.textContent.trim() ?? '';
    await played;
    const gone = document.querySelector('.marble-morph-layer')?.children.length ?? 0;
    snap = window.marbleMorph.capture(['l2'], {});
    window.marble.apply({ type: 'insert', parentId: 'l', beforeId: 'l3', html: '<li data-marble-id="l2">What makes an interface feel alive?</li>' });
    played = window.marbleMorph.play(snap, {});
    const back = document.querySelector('[data-marble-id="l2"]').getAnimations().find((a) => a.id === ours);
    const rise = back?.effect.getKeyframes()[0].opacity ?? null;
    await played;
    return { ghost, gone, rise };
  }, OURS);
  assert.equal(seen.ghost, 'What makes an interface feel alive?', 'the row taken out fades where it stood');
  assert.equal(seen.gone, 0);
  assert.equal(seen.rise, '0', 'the row put back rises from nothing');
});

// ------------------------------------------------------------ budget and the hand

test('past 60 parts nothing moves, and every part is let go at once', async () => {
  const { page } = await open({ doc: 'many' });
  const seen = await page.evaluate(async (ours) => {
    const ids = Array.from({ length: 80 }, (_, i) => `m${i}`);
    const ends = [];
    const snap = window.marbleMorph.capture(ids, { kind: 'words' });
    for (const id of ids) window.marble.apply({ type: 'setText', id, text: `Read ${id}` });
    const t0 = performance.now();
    await window.marbleMorph.play(snap, { onPart: (id, phase) => { if (phase === 'end') ends.push(id); } });
    return {
      took: performance.now() - t0,
      ends: ends.length,
      distinct: new Set(ends).size,
      animations: document.getAnimations().filter((a) => a.id === ours).length,
      marked: CSS.highlights.has('marble-morph-unwritten'),
    };
  }, OURS);
  assert.equal(seen.animations, 0);
  assert.equal(seen.marked, false);
  assert.equal(seen.ends, 80);
  assert.equal(seen.distinct, 80);
  assert.ok(seen.took < 50, `let go at once (${seen.took} ms)`);
});

test('the part the person’s caret is in does not move', async () => {
  const { page } = await open();
  await page.locator('[data-marble-id="c4"]').click();
  const seen = await page.evaluate(async (ours) => {
    const ends = [];
    const snap = window.marbleMorph.capture(['look'], { kind: 'look' });
    window.marble.apply({ type: 'setInner', id: 'look', html: '.card { border-radius: 16px; }' });
    const played = window.marbleMorph.play(snap, { onPart: (id, phase) => ends.push([id, phase]) });
    const moving = (id) => document.querySelector(`[data-marble-id="${id}"]`).getAnimations().filter((a) => a.id === ours).length;
    const held = moving('c4');
    const other = moving('c1');
    await played;
    return { held, other, active: document.activeElement.getAttribute('data-marble-id') };
  }, OURS);
  assert.equal(seen.held, 0, 'the card being typed in is left still');
  assert.ok(seen.other > 0, 'the others move');
  assert.equal(seen.active, 'c4', 'and the caret stays');
});

test('with reduced motion every change is one 150 ms crossfade, all at once', async () => {
  const { page } = await open({ reducedMotion: 'reduce' });
  const seen = await page.evaluate(async (ours) => {
    const found = [];
    const note = () => {
      for (const a of document.getAnimations()) {
        if (a.id !== ours) continue;
        const keys = a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((name) => !['offset', 'computedOffset', 'easing', 'composite'].includes(name)));
        found.push({ keys: [...new Set(keys)], delay: a.effect.getTiming().delay, duration: a.effect.getTiming().duration, from: a.effect.getKeyframes()[0].opacity });
      }
    };
    const inserts = [{ parentId: 'l', beforeId: 'l2', ids: ['l9'] }];
    const snap = window.marbleMorph.capture(['look', 'p', 'l9', 'l3'], { kind: 'mixed', inserts, removes: ['l3'] });
    window.marble.apply({ type: 'setInner', id: 'look', html: '.card { border-radius: 16px; background-color: #dbe8f5; }' });
    window.marble.apply({ type: 'setText', id: 'p', text: 'Open questions, and why they matter.' });
    window.marble.apply({ type: 'insert', parentId: 'l', beforeId: 'l2', html: '<li data-marble-id="l9">What is a part?</li>' });
    window.marble.apply({ type: 'remove', id: 'l3' });
    const played = window.marbleMorph.play(snap, {});
    note();
    const marked = CSS.highlights.has('marble-morph-unwritten');
    await played;
    return { found, marked, layer: document.querySelector('.marble-morph-layer')?.children.length ?? 0 };
  }, OURS);
  assert.ok(seen.found.length >= 8, `the cards, the words and the new row each crossfade (${seen.found.length})`);
  for (const a of seen.found) {
    assert.deepEqual(a.keys, ['opacity']);
    assert.equal(a.delay, 0);
    assert.equal(a.duration, 150);
    assert.equal(a.from, '0.35');
  }
  assert.equal(seen.marked, false, 'no words are written in');
  assert.equal(seen.layer, 0, 'nothing is drawn over the page');
});

// ------------------------------------------------------------ with the marks

test('a batch past the engine’s budget, landing before anything is painted, still shows its parts landing', async () => {
  const { page } = await open({ doc: 'many', attending: ['c1'] });
  await page.waitForFunction(() => Boolean(window.marbleChange && document.querySelector('.marble-change-layer')));
  const seen = await page.evaluate(async () => {
    const ids = Array.from({ length: 70 }, (_, i) => `m${i}`);
    const ops = ids.map((id) => ({ type: 'setText', id, text: `Read ${id}` }));
    // The frame and its ops in one task: no paint comes between them.
    document.dispatchEvent(new CustomEvent('marble:presence', {
      detail: {
        client: 'agent:c1', ids, phase: 'writing', note: 'Mark them read.', turn: 'c1-t1', stage: 'before', parts: ids,
        inserts: [], removes: [], moves: [], kind: 'words', step: null, count: 70, total: null, reach: null,
      },
    }));
    for (const op of ops) window.marble.apply(op);
    document.dispatchEvent(new CustomEvent('marble:ops', { detail: { client: 'agent:c1', ops } }));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return {
      now: document.querySelectorAll('.marble-change-tint[data-state="now"]').length,
      moving: document.getAnimations().filter((a) => a.id === 'marble-morph').length,
    };
  });
  assert.equal(seen.moving, 0, 'nothing moves past the budget');
  assert.ok(seen.now > 0, 'the parts are drawn landing before they lift');
});

// ------------------------------------------------------------ through a turn

test('a followed turn that restyles six cards lifts each card’s tint only once its motion has ended', async () => {
  const id = (await api('POST', '/agent/conversations', { provider: 'fake' })).id;
  const { page, errors } = await open({ attending: [id] });
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleChange && document.querySelector('.marble-change-layer')));
  await page.evaluate((ours) => {
    window.__ends = {};
    window.__lifts = {};
    window.__played = [];
    window.__landed = [];
    window.__moved = new Set();
    const play = window.marbleMorph.play;
    window.marbleMorph.play = (snapshot, opts) => {
      const played = play(snapshot, opts);
      for (const a of document.getAnimations()) {
        if (a.id !== ours) continue;
        const card = a.effect.target?.getAttribute?.('data-marble-id');
        if (!card) continue;
        window.__moved.add(card);
        a.finished.then(() => { window.__ends[card] = Math.max(window.__ends[card] ?? 0, performance.now()); }, () => {});
      }
      played.then(() => window.__played.push(performance.now()));
      return played;
    };
    document.addEventListener('marble-change:landed', () => window.__landed.push(performance.now()));
    new MutationObserver(() => {
      for (const tint of document.querySelectorAll('.marble-change-tint[data-state="lift"]')) {
        window.__lifts[tint.dataset.id] ??= performance.now();
      }
    }).observe(document.querySelector('.marble-change-layer'), { subtree: true, childList: true, attributes: true });
  }, OURS);
  await page.waitForTimeout(200);
  await api('POST', `/agent/conversations/${id}/turns`, {
    prompt: 'script:restyle Round the cards', context: { target: 'cards', viewing: 'cards', selection: [], also: [] },
  });
  await page.waitForFunction(() => window.__landed.length > 0, null, { timeout: 15_000 });
  await page.waitForFunction((ids) => ids.every((card) => window.__lifts[card]), CARD_IDS, { timeout: 5000 });
  const seen = await page.evaluate(() => ({
    ends: window.__ends, lifts: window.__lifts, played: window.__played, landed: window.__landed, moved: [...window.__moved],
    radius: getComputedStyle(document.querySelector('[data-marble-id="c1"]')).borderTopLeftRadius,
  }));
  assert.deepEqual(seen.moved.filter((card) => CARD_IDS.includes(card)).sort(), CARD_IDS, 'every card moved');
  for (const card of CARD_IDS) {
    assert.ok(seen.ends[card] > 0, `${card}'s motion ended`);
    assert.ok(seen.lifts[card] >= seen.ends[card], `${card}'s tint lifted at ${seen.lifts[card]}, after its motion ended at ${seen.ends[card]}`);
  }
  assert.equal(seen.played.length, 1);
  assert.ok(seen.landed[0] >= seen.played[0], 'the batch lands once it has played');
  assert.equal(seen.radius, '16px');
  // Nothing the engine did was filed: the file holds the agent's change and nothing of the motion.
  const source = await host.drive.store.read('cards');
  assert.match(source, /class="card round" data-marble-id="c1"|data-marble-id="c1"[^>]*class="card round"/);
  assert.doesNotMatch(source, /marble-morph|marble-change/);
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
  await host.reset();
});
