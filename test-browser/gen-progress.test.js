// The page taking shape while an agent builds it (runtime/gen-progress.js):
// the line at the foot of the window says the step the turn is on, the
// sections the agent says are coming are drawn as placeholders where they
// will go, and what lands rises into place. One followed turn is driven end
// to end through the scripted provider, so every word and block here comes
// from the turn's own events; the rest dispatch frames straight at the page.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const BLANK = `<!doctype html>
<html><head><meta charset="utf-8"><title>Plan</title>
<style>body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; } .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .card { padding: 16px; border: 1px solid #ddd; border-radius: 12px; } ul { padding: 0; list-style: none; } footer { color: #777; }</style>
</head>
<body data-marble-id="b">
  <main data-marble-id="m"></main>
  <footer data-marble-id="f">Kept in Marble</footer>
</body></html>
`;

const HEADER = '<header><h1>Week plan</h1><p>What the team is doing this week.</p></header>';
const CARDS = '<div class="grid"><div class="card">Design</div><div class="card">Build</div><div class="card">Ship</div></div>';
const ROWS = '<ul><li>Monday: review</li><li>Friday: demo</li></ul>';

const SCRIPTS = {
  build: [
    { call: 'read_document', args: { path: 'plan' } },
    { sleep: 500 },
    {
      call: 'apply_ops',
      args: {
        path: 'plan', note: 'Stage 1 of 3: the outline.', ops: [],
        outline: { parentId: 'm', blocks: [{ shape: 'header' }, { shape: 'cards', count: 3 }, { shape: 'rows', count: 2 }] },
      },
    },
    { sleep: 700 },
    { call: 'apply_ops', args: { path: 'plan', note: 'Stage 2 of 3: the header.', ops: [{ type: 'insert', parentId: 'm', html: HEADER }] } },
    { sleep: 700 },
    { call: 'apply_ops', args: { path: 'plan', note: 'Stage 3 of 3: cards and rows.', ops: [{ type: 'insert', parentId: 'm', html: CARDS }, { type: 'insert', parentId: 'm', html: ROWS }] } },
    { sleep: 600 },
    { call: 'apply_ops', args: { path: 'plan', note: 'Quiet the footer.', ops: [{ type: 'setAttr', id: 'f', name: 'style', value: 'color: #999' }] } },
    { sleep: 400 },
    { say: 'Built.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { plan: BLANK } });
test.after(() => host.close());

const api = async (method, url, body) => {
  const response = await fetch(`${host.base}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response.json();
};

const open = async ({ attending = ['c1'], reduced = false } = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage({ attending });
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${host.base}/a/plan`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleGen?.stats && window.marbleChange));
  return { page, errors };
};

const frame = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
}, detail);

const lineOf = (page) => page.evaluate(() => {
  const line = document.querySelector('marble-gen-line')?.shadowRoot?.querySelector('.line');
  const text = line?.querySelector('.text:not([data-state="out"])');
  return line ? { hidden: line.hidden, state: line.dataset.state, text: text?.dataset.text ?? null, shimmer: text ? getComputedStyle(text, '::before').animationName : null } : null;
});

test('a followed turn builds the page in view: its steps said, its sections drawn ahead, each resolving as it lands', async () => {
  const id = (await api('POST', '/agent/conversations', { provider: 'fake' })).id;
  const { page, errors } = await open({ attending: [id] });
  // Everything the page shows over the turn, as it shows it.
  await page.evaluate(() => {
    window.__said = [];
    window.__blocks = [];
    window.__rose = [];
    const seen = new WeakSet();
    const look = () => {
      const s = window.marbleGen.stats();
      if (s.said && window.__said.at(-1) !== s.said) window.__said.push(s.said);
      const blocks = document.querySelectorAll('.marble-gen-skel .marble-gen-block').length;
      if (window.__blocks.at(-1) !== blocks) window.__blocks.push(blocks);
      for (const a of document.getAnimations()) {
        if (seen.has(a) || a.id !== 'marble-morph') continue;
        seen.add(a);
        const k = a.effect.getKeyframes()[0] ?? {};
        if (k.translate && /blur/.test(k.filter ?? '')) window.__rose.push({ tag: a.effect.target.tagName, delay: a.effect.getTiming().delay, duration: a.effect.getTiming().duration });
      }
      requestAnimationFrame(look);
    };
    look();
  });
  await page.waitForTimeout(150);
  await api('POST', `/agent/conversations/${id}/turns`, {
    prompt: 'script:build Make a week plan', context: { target: 'plan', viewing: 'plan', selection: [], also: [] },
  });

  // The outline, said ahead: three blocks where the sections will go, above
  // what the page already had, and the line shimmering.
  await page.waitForFunction(() => document.querySelectorAll('.marble-gen-skel .marble-gen-block').length === 3, null, { timeout: 10_000 });
  const ahead = await page.evaluate(() => {
    const skel = document.querySelector('.marble-gen-skel');
    return { parent: skel.parentElement.getAttribute('data-marble-id'), bones: skel.querySelectorAll('.marble-gen-bone').length, shapes: [...skel.children].map((b) => b.dataset.shape) };
  });
  assert.equal(ahead.parent, 'm', 'drawn where the sections will be inserted');
  assert.deepEqual(ahead.shapes, ['header', 'cards', 'rows']);
  assert.equal(ahead.bones, 2 + 3 + 2);
  const working = await lineOf(page);
  assert.equal(working.hidden, false);
  assert.equal(working.state, 'working');
  assert.equal(working.shimmer, 'shimmer');

  // Done, then gone.
  await page.waitForFunction(() => window.__said.includes('Done'), null, { timeout: 15_000 });
  const seen = await page.evaluate(() => ({ said: window.__said, blocks: window.__blocks, rose: window.__rose }));
  for (const words of ['Reading document', 'Laying out sections', 'Styling', 'Done']) assert.ok(seen.said.includes(words), `the line said "${words}" (${seen.said.join(' → ')})`);
  assert.ok(seen.said.indexOf('Reading document') < seen.said.indexOf('Laying out sections'), 'in the order the turn did them');
  assert.deepEqual(seen.blocks.filter((n) => n > 0), [3, 2], 'each section took its block: the header one, then the cards and rows the other two');
  assert.equal(seen.blocks.at(-1), 0);
  // What landed rose in, its parts one after another.
  const cards = seen.rose.filter((r) => r.tag === 'DIV' && r.duration === 500);
  assert.ok(cards.length >= 3, `the three cards rose in (${JSON.stringify(seen.rose)})`);
  const delays = cards.slice(0, 3).map((r) => r.delay);
  assert.ok(delays[1] - delays[0] >= 39 && delays[2] - delays[1] >= 39, `40 ms between one card and the next (${delays})`);
  const done = await lineOf(page);
  assert.equal(done.state, 'done');
  assert.equal(done.shimmer, 'none', 'the shimmer stops');
  await page.waitForFunction(() => document.querySelector('marble-gen-line').shadowRoot.querySelector('.line').hidden, null, { timeout: 5000 });

  // The page is the agent's change and nothing of the drawing.
  assert.equal(await page.locator('.marble-gen-skel').count(), 0);
  const source = await host.drive.store.read('plan');
  assert.match(source, /Week plan/);
  assert.match(source, /Friday: demo/);
  assert.doesNotMatch(source, /marble-gen/);
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('with reduced motion nothing shimmers, washes or rises: the words change, and the outline stands still', async () => {
  const { page } = await open({ reduced: true });
  await frame(page, { client: 'agent:c1', ids: [], phase: 'working', stage: 'start', turn: 'c1-t1' });
  await frame(page, {
    client: 'agent:c1', ids: ['m'], phase: 'writing', stage: 'mark', turn: 'c1-t1', note: '',
    outline: { parentId: 'm', beforeId: null, blocks: [{ shape: 'text' }, { shape: 'media' }], landed: 0 },
  });
  const seen = await page.evaluate(() => {
    const text = document.querySelector('marble-gen-line').shadowRoot.querySelector('.text');
    const bone = document.querySelector('.marble-gen-bone');
    return {
      said: window.marbleGen.stats().said,
      shimmer: getComputedStyle(text, '::before').animationName,
      wash: getComputedStyle(bone, '::after').animationName,
      reveal: window.marbleGen.reveal(document.querySelector('[data-marble-id="f"]'), { client: 'agent:c1' }),
    };
  });
  assert.equal(seen.said, 'Laying out sections');
  assert.equal(seen.shimmer, 'none');
  assert.equal(seen.wash, 'none');
  assert.equal(seen.reveal, null, 'what arrives is the engine’s one crossfade');
});

test('a stopped turn says so plainly, lets go of its outline and keeps what landed', async () => {
  const { page } = await open();
  await frame(page, { client: 'agent:c1', ids: [], phase: 'working', stage: 'start', turn: 'c1-t1' });
  await frame(page, {
    client: 'agent:c1', ids: ['m'], phase: 'writing', stage: 'mark', turn: 'c1-t1', note: '',
    outline: { parentId: 'm', beforeId: null, blocks: [{ shape: 'header' }, { shape: 'rows', count: 3 }], landed: 0 },
  });
  await page.evaluate((html) => {
    document.dispatchEvent(new CustomEvent('marble:presence', { detail: {
      client: 'agent:c1', ids: [], phase: 'writing', stage: 'before', turn: 'c1-t1', kind: 'structure',
      parts: ['h'], inserts: [{ parentId: 'm', beforeId: null, ids: ['h'] }], removes: [], moves: [],
      outline: { parentId: 'm', beforeId: null, blocks: [{ shape: 'header' }, { shape: 'rows', count: 3 }], landed: 1 },
    } }));
    const op = { type: 'insert', parentId: 'm', html: html.replace('<header>', '<header data-marble-id="h">') };
    window.marble.apply(op);
    document.dispatchEvent(new CustomEvent('marble:ops', { detail: { client: 'agent:c1', ops: [op] } }));
  }, HEADER);
  const mid = await page.evaluate(() => ({
    blocks: document.querySelectorAll('.marble-gen-skel .marble-gen-block').length,
    order: [...document.querySelector('[data-marble-id="m"]').children].map((el) => el.className || el.tagName),
  }));
  assert.equal(mid.blocks, 1, 'the header took its block');
  assert.deepEqual(mid.order, ['HEADER', 'marble-gen-skel'], 'what landed stands above what is still to come');
  await frame(page, { client: 'agent:c1', ids: [], stage: 'end', turn: 'c1-t1', done: { status: 'cancelled', changed: 0, added: 1, removed: 0 } });
  const line = await lineOf(page);
  assert.equal(line.state, 'quiet');
  assert.equal(line.text, 'Stopped. What was made is kept.');
  assert.equal(line.shimmer, 'none');
  await page.waitForFunction(() => !document.querySelector('.marble-gen-skel'), null, { timeout: 3000 });
  assert.equal(await page.locator('[data-marble-id="h"] h1').innerText(), 'Week plan');
});

test('a chat this tab does not follow draws nothing here', async () => {
  const { page } = await open({ attending: [] });
  await frame(page, { client: 'agent:c9', ids: [], phase: 'working', stage: 'start', turn: 'c9-t1' });
  await frame(page, {
    client: 'agent:c9', ids: ['m'], phase: 'writing', stage: 'mark', turn: 'c9-t1', note: '',
    outline: { parentId: 'm', beforeId: null, blocks: [{ shape: 'header' }], landed: 0 },
  });
  assert.equal(await page.locator('.marble-gen-skel').count(), 0);
  assert.equal((await lineOf(page))?.hidden ?? true, true);
});
