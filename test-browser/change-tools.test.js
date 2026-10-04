// A change's own tools (v6, Notes and Sketches/Ask at Anything, "The page
// draws its own tools"): an agent says what it is changing in that thing's
// own words and marks — the tag's verb and unit, a measure, the tool where
// the work is now, what is still to come, what was there before — and the
// page draws them in its transient layer, moves a keyed tool from part to
// part, keeps them off the person's hand, and lets them go with the change.
// Nothing of it is ever filed.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const TRACES = `<!doctype html>
<html><head><meta charset="utf-8"><title>Event 2026-10-04</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; }
  .trace { position: relative; height: 48px; margin: 6px 0; border-radius: 6px; background: #f3f4f6; }
  .trace b { position: absolute; left: 8px; top: 14px; font-size: 12px; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Event 2026-10-04 · M4.1</h1>
  <div data-marble-id="stack" class="stack">
    <div data-marble-id="s1" class="trace" tabindex="0"><b>PFO</b></div>
    <div data-marble-id="s2" class="trace"><b>BAR</b></div>
    <div data-marble-id="s3" class="trace"><b>GOR</b></div>
  </div>
</body></html>
`;

// A grid of squares: past a dozen parts, a dot in the margin would sit inside
// the next square, so squares keep their tint.
const SQUARES = `<!doctype html>
<html><head><meta charset="utf-8"><title>Squares</title>
<style>body { margin: 40px; } .grid { display: grid; grid-template-columns: repeat(4, 48px); width: max-content; }
.sq { height: 48px; border: 1px solid #ccc; }</style></head>
<body data-marble-id="b"><div data-marble-id="grid" class="grid">${Array.from({ length: 16 }, (_, i) => `<div class="sq" data-marble-id="sq${i}"></div>`).join('')}</div>
<ul data-marble-id="rows">${Array.from({ length: 14 }, (_, i) => `<li data-marble-id="row${i}">Row ${i}</li>`).join('')}</ul></body></html>
`;

const DAYS = `<!doctype html>
<html><head><meta charset="utf-8"><title>Days</title><style>body { margin: 40px; } td { padding: 6px 10px; }</style></head>
<body data-marble-id="b"><table data-marble-id="plan"><tbody data-marble-id="pb">${[1, 2, 3, 4].map((d) => `<tr data-marble-id="d${d}"><td data-marble-id="d${d}n">${d}</td><td data-marble-id="d${d}f"></td><td data-marble-id="d${d}t"></td></tr>`).join('')}</tbody></table></body></html>
`;

const pick = (id, t) => ({ type: 'setAttr', id, name: 'data-pick', value: String(t) });
const ring = (at, extra = {}) => ({ at, shape: 'ring', ...extra });
const read = () => ({ call: 'read_document', args: { path: 'traces' } });
const batch = (args) => ({ call: 'apply_ops', args: { path: 'traces', ...args } });

const LOOK = { verb: 'Picking', unit: ['station', 'stations'] };

const SCRIPTS = {
  picks: [
    read(),
    batch({
      note: 'Stage 1 of 2: find the first arrivals', total: 3, reach: ['s1', 's2', 's3'], ops: [],
      marks: { ...LOOK, draw: [ring('s1', { as: 'ahead' }), ring('s2', { as: 'ahead' }), ring('s3', { as: 'ahead' }), { at: 'stack', as: 'ahead', svg: '<polyline points="30,10 38,50 46,90"/>' }] },
    }),
    { sleep: 600 },
    batch({
      note: 'Stage 2 of 2: pick each station',
      marks: { draw: [ring('s1', { key: 'cursor' }), { at: 's1', svg: '<path d="M30 0V100"/>', text: 'P 4.21 s', x: 30 }, ring('s2', { as: 'ahead' }), ring('s3', { as: 'ahead' })] },
      ops: [pick('s1', 4.21)],
    }),
    { sleep: 600 },
    batch({
      note: 'Stage 2 of 2: pick each station',
      marks: { draw: [ring('s2', { key: 'cursor' }), { at: 's2', svg: '<path d="M38 0V100"/>', text: 'P 5.02 s', x: 38 }, ring('s3', { as: 'ahead' })] },
      ops: [pick('s2', 5.02)],
    }),
    { sleep: 600 },
    batch({
      note: 'Stage 2 of 2: pick each station',
      marks: { draw: [ring('s3', { key: 'cursor' })] },
      ops: [pick('s3', 5.88)],
    }),
    { sleep: 400 },
    { say: 'Picked all three.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { traces: TRACES, squares: SQUARES, days: DAYS } });
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

const settle = async () => {
  for (const summary of await api('GET', '/agent/conversations')) {
    const detail = await api('GET', `/agent/conversations/${summary.id}`);
    for (const turn of detail.turns ?? []) {
      if (turn.status === 'running') await api('POST', `/agent/turns/${turn.id}/cancel`);
    }
    await api('PATCH', `/agent/conversations/${summary.id}`, { archived: true });
  }
  await host.reset();
};

const newChat = async () => (await api('POST', '/agent/conversations', { provider: 'fake' })).id;
const sendTurn = (id, prompt) => api('POST', `/agent/conversations/${id}/turns`, {
  prompt, context: { target: 'traces', viewing: 'traces', selection: [], also: [] },
});

const open = async ({ attending = [], doc = 'traces', ...options } = {}) => {
  await closePages();
  const { page, errors } = await host.newPage({ attending, ...options });
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleChange && document.querySelector('.marble-change-layer')));
  await page.evaluate(() => {
    window.__ends = [];
    document.addEventListener('marble-change:end', (event) => window.__ends.push(event.detail));
  });
  await page.waitForTimeout(200);
  return { page, errors };
};

const ended = (page, timeout = 20_000) => page.waitForFunction(() => window.__ends.length > 0, null, { timeout });
const layerEmpty = (page, timeout = 4000) => page.waitForFunction(
  () => document.querySelector('.marble-change-layer').children.length === 0,
  null,
  { timeout },
);
const frame = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
}, detail);
const before = (extra) => ({
  client: 'agent:c1', ids: extra.parts, phase: 'writing', note: 'Pick the arrivals.', turn: 'c1-t1', stage: 'before',
  inserts: [], removes: [], moves: [], kind: 'attr', step: null, count: 1, total: null, reach: null, ...extra,
});
const painted = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const said = (page) => page.evaluate(() => document.querySelector('.marble-change-tag .marble-change-said')?.textContent ?? null);
const tools = (page) => page.evaluate(() => [...document.querySelectorAll('.marble-change-draw')].map((el) => ({
  on: el.dataset.on,
  as: el.dataset.as,
  state: el.dataset.state ?? '',
  hidden: el.hidden,
  shape: el.querySelector('.marble-change-shape')?.dataset.shape ?? null,
  words: el.querySelector('.marble-change-words')?.textContent ?? null,
  svg: el.querySelector('svg')?.innerHTML ?? null,
})));

test('a turn draws its tools ahead of its first edit, moves its cursor from part to part, counts in its own unit, and leaves nothing', async () => {
  await settle();
  const id = await newChat();
  const { page, errors } = await open({ attending: [id] });
  await page.evaluate(() => {
    window.__said = [];
    window.__glided = false;
    window.__cursors = new Set();
    const layer = document.querySelector('.marble-change-layer');
    new MutationObserver(() => {
      const text = layer.querySelector('.marble-change-said')?.textContent;
      if (text && window.__said.at(-1) !== text) window.__said.push(text);
      if (layer.querySelector('.marble-change-draw[data-glide]')) window.__glided = true;
      for (const el of layer.querySelectorAll('.marble-change-draw[data-as="now"]')) {
        if (el.querySelector('[data-shape="ring"]')) window.__cursors.add(el);
      }
    }).observe(layer, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  await sendTurn(id, 'script:picks Pick the first arrivals');

  // Ahead of any edit: three dashed rings, a dashed curve over the stack, and
  // a tag that counts from nothing in stations.
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-draw[data-as="ahead"]').length === 4);
  const ahead = await tools(page);
  assert.deepEqual(ahead.filter((t) => t.shape === 'ring').map((t) => t.as), ['ahead', 'ahead', 'ahead']);
  assert.match(ahead.find((t) => t.svg)?.svg ?? '', /<polyline points="30,10 38,50 46,90"/);
  assert.equal(await page.evaluate(() => document.querySelector('[data-marble-id="s1"]').hasAttribute('data-pick')), false, 'nothing has changed yet');
  await page.waitForFunction(() => /Picking 0 of 3 stations/.test(document.querySelector('.marble-change-said')?.textContent ?? ''));

  // The cursor arrives on the first station with its pick, then moves on.
  await page.waitForFunction(() => [...document.querySelectorAll('.marble-change-words')].some((w) => w.textContent === 'P 4.21 s'));
  await page.waitForFunction(() => [...document.querySelectorAll('.marble-change-words')].some((w) => w.textContent === 'P 5.02 s'), null, { timeout: 8000 });
  await ended(page);
  const seen = await page.evaluate(() => ({ said: window.__said, glided: window.__glided, cursors: window.__cursors.size }));
  assert.ok(seen.said.includes('Picking 1 of 3 stations'), JSON.stringify(seen.said));
  assert.ok(seen.said.includes('Picking 3 of 3 stations'), JSON.stringify(seen.said));
  assert.equal(seen.cursors, 1, 'one cursor, moved, not one per station');
  assert.equal(seen.glided, true, 'the cursor glides to the next station');
  for (const words of seen.said) assert.doesNotMatch(words, /agent/i);
  const named = seen.said.slice(seen.said.findIndex((words) => words.startsWith('Picking')));
  for (const words of named) assert.doesNotMatch(words, /\bparts?\b|Changing/, 'once the change has named itself, it keeps its own words');

  await layerEmpty(page);
  const source = await (await fetch(`${host.base}/a/traces.mrbl`)).text().catch(() => '');
  assert.doesNotMatch(source, /marble-change-draw/, 'nothing of the marks is filed');
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('a path is rebuilt from shapes and geometry only: nothing in it runs or links', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  await page.evaluate(() => { window.__ran = 0; });
  await frame(page, before({
    parts: ['s1'],
    marks: {
      verb: 'Picking',
      draw: [
        { at: 's1', svg: '<path d="M10 0V100" onclick="window.__ran++" class="ahead loud"/><script>window.__ran++</script><g><circle cx="50" cy="50" r="4" class="solid" style="fill:red"/></g>' },
        { at: 's2', svg: '<image href="x.png"/><rect x="0" y="0" width="100" height="100" transform="translate(2,2)"/>' },
        { at: 's3', svg: '<path d="M0 0' },
      ],
    },
  }));
  await painted(page);
  const drawn = await tools(page);
  assert.equal(drawn.length, 2, 'a path that does not parse draws nothing');
  assert.equal(drawn[0].svg, '<path d="M10 0V100" class="ahead"></path><g><circle cx="50" cy="50" r="4" class="solid"></circle></g>');
  assert.equal(drawn[1].svg, '<rect x="0" y="0" width="100" height="100" transform="translate(2,2)"></rect>');
  await page.locator('.marble-change-draw path').first().dispatchEvent('click');
  assert.equal(await page.evaluate(() => window.__ran), 0);
});

test('the tag counts in the unit the change names, or a measure toward its own end, with a meter', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  await frame(page, before({ parts: ['s1'], count: 1, total: 3, marks: { verb: 'picking', unit: ['station', 'stations'] } }));
  await painted(page);
  assert.equal(await said(page), 'Picking 1 of 3 stations');
  await frame(page, before({ parts: ['s2'], count: 2, total: 3, marks: { verb: 'Widening', measure: { now: 15, of: 24, unit: 'px' } } }));
  await painted(page);
  assert.equal(await said(page), 'Widening 15 of 24 px');
  const meter = await page.evaluate(() => {
    const m = document.querySelector('.marble-change-tag .marble-change-meter');
    return { hidden: m.hidden, p: m.firstElementChild.style.getPropertyValue('--p') };
  });
  assert.deepEqual(meter, { hidden: false, p: '63%' });
});

test('a tool on the part in the person\'s hand steps aside, and comes back when the hand leaves', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  await frame(page, before({ parts: ['s2'], marks: { verb: 'Picking', draw: [{ at: 's1', shape: 'ring', as: 'ahead' }, { at: 's2', shape: 'ring' }] } }));
  await painted(page);
  assert.deepEqual((await tools(page)).map((t) => t.hidden), [false, false]);
  await page.focus('[data-marble-id="s1"]');
  await painted(page);
  assert.deepEqual((await tools(page)).map((t) => t.hidden), [true, false]);
  await page.evaluate(() => document.activeElement.blur());
  await painted(page);
  assert.deepEqual((await tools(page)).map((t) => t.hidden), [false, false]);
});

test('an empty draw takes the tools away, and the end takes everything', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  await frame(page, before({ parts: ['s1'], marks: { verb: 'Picking', draw: [{ at: 's1', shape: 'dot', x: 30, y: 50 }, { at: 's3', shape: 'line', on: 'below', text: 'next', as: 'ahead' }] } }));
  await painted(page);
  const drawn = await tools(page);
  assert.deepEqual(drawn.map((t) => [t.shape, t.on, t.as]), [['dot', 'over', 'now'], ['line', 'below', 'ahead']]);
  const dot = await page.evaluate(() => {
    const el = document.querySelector('.marble-change-draw [data-shape="dot"]');
    const host = el.parentElement.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: Math.round(((r.left + r.width / 2) - host.left) / host.width * 100), y: Math.round(((r.top + r.height / 2) - host.top) / host.height * 100) };
  });
  assert.deepEqual(dot, { x: 30, y: 50 }, 'a dot sits where it was put, across and down the part');
  await frame(page, before({ parts: ['s2'], count: 2, marks: { draw: [] } }));
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-draw').length === 0);
  await frame(page, before({ parts: ['s3'], count: 3, marks: { draw: [{ at: 's3', shape: 'ring' }] } }));
  await page.locator('.marble-change-draw').waitFor();
  await frame(page, { client: 'agent:c1', ids: [], turn: 'c1-t1', stage: 'end', done: { status: 'completed', changed: 3 } });
  await page.waitForFunction(() => document.querySelector('.marble-change-draw')?.dataset.state === 'gone' || !document.querySelector('.marble-change-draw'));
  await layerEmpty(page, 5000);
});

test('past a dozen parts, rows get a dot in the margin but squares of a grid keep their tint', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'], doc: 'squares' });
  const squares = Array.from({ length: 16 }, (_, i) => `sq${i}`);
  await frame(page, before({ parts: ['sq0'], reach: squares, total: 16, marks: { verb: 'Filling', unit: ['square', 'squares'] } }));
  await painted(page);
  const grid = await page.evaluate(() => ({
    dots: document.querySelectorAll('.marble-change-dot').length,
    tints: [...document.querySelectorAll('.marble-change-tint')].map((t) => t.dataset.id).filter((id) => id.startsWith('sq')).length,
  }));
  assert.deepEqual(grid, { dots: 0, tints: 16 });
  const rows = Array.from({ length: 14 }, (_, i) => `row${i}`);
  await frame(page, before({ client: 'agent:c1', turn: 'c1-t2', parts: ['row0'], reach: rows, total: 14 }));
  await painted(page);
  const list = await page.evaluate(() => ({
    dots: [...document.querySelectorAll('.marble-change-dot')].filter((d) => d.dataset.id.startsWith('row')).length,
    soon: [...document.querySelectorAll('.marble-change-tint[data-state="soon"]')].filter((t) => t.dataset.id.startsWith('row')).length,
  }));
  assert.equal(list.dots, 14, 'a dot for every row');
  assert.equal(list.soon, 0, 'rows ahead are dotted, not tinted');
});

test('a row of the reach holds the cells a batch fills: the row is the part, and the count is of rows', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'], doc: 'days' });
  const days = ['d1', 'd2', 'd3', 'd4'];
  const look = { verb: 'Staging', unit: ['day', 'days'] };
  await frame(page, before({ parts: ['d1f', 'd1t'], count: 2, reach: days, total: 4, marks: look }));
  await painted(page);
  assert.equal(await said(page), 'Staging 1 of 4 days');
  const tints = await page.evaluate(() => [...document.querySelectorAll('.marble-change-tint')].map((t) => `${t.dataset.id}:${t.dataset.state}`).sort());
  assert.deepEqual(tints, ['d1:now', 'd2:soon', 'd3:soon', 'd4:soon'], 'the row is tinted, not the cells inside it');
  await frame(page, before({ parts: ['d2f', 'd2t'], count: 4, reach: days, total: 4, marks: look }));
  await painted(page);
  assert.equal(await said(page), 'Staging 2 of 4 days', 'cells are not counted as days');
  // A reach that also names what holds the rows, and a part it only marks:
  // the row is still the part, and only rows that changed are counted.
  await frame(page, before({ parts: ['d3f'], count: 5, reach: ['plan', ...days, 'b'], total: 4, marks: look }));
  await painted(page);
  assert.equal(await said(page), 'Staging 3 of 4 days');
  assert.equal(await page.evaluate(() => document.querySelector('.marble-change-tint[data-id="d3"]')?.dataset.state), 'now');
});
