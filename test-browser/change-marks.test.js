// The marks (v5, Notes and Sketches/Ask at Anything, "The marks, from reading
// to done"): while a followed change runs, each part it touches is tinted —
// light ahead, deeper while it lands, lifting after — one tag counts in the
// parts' own unit, a rail at the window's edge stands for parts out of view,
// and the zone box steps aside. Nothing of it is left once the change ends.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const LIST = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reading list</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; }
  table { border-collapse: collapse; }
  td { padding: 6px 12px; }
  section { padding: 12px; border: 1px solid #ddd; border-radius: 10px; }
</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Reading list</h1>
  <table data-marble-id="t"><tbody data-marble-id="tb">
    <tr data-marble-id="r1"><td data-marble-id="r1n">Malleable software</td><td data-marble-id="r1s">Unread</td></tr>
    <tr data-marble-id="r2"><td data-marble-id="r2n" contenteditable="true">Local-first</td><td data-marble-id="r2s">Unread</td></tr>
    <tr data-marble-id="r3"><td data-marble-id="r3n">Dynamicland</td><td data-marble-id="r3s">Read</td></tr>
  </tbody></table>
  <section data-marble-id="s"><button data-marble-id="go">Sort</button></section>
  <div data-marble-id="chart" data-marble-kind="chart"><svg width="160" height="40" aria-hidden="true"></svg></div>
</body></html>
`;

const DEEP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Deep list</title>
<style>body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; } td { padding: 6px 12px; }</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Deep list</h1>
  <div data-marble-id="gap" style="height: 1600px"></div>
  <table data-marble-id="t"><tbody data-marble-id="tb">
    <tr data-marble-id="d1"><td>One</td><td>Unread</td></tr>
    <tr data-marble-id="d2"><td>Two</td><td>Unread</td></tr>
    <tr data-marble-id="d3"><td>Three</td><td>Read</td></tr>
  </tbody></table>
  <div data-marble-id="tail" style="height: 600px"></div>
</body></html>
`;

// Three questions, each one line of words: a turn that rewrites all three is a
// change of three parts, not words in one block (ruling R6).
const LINES = `<!doctype html>
<html><head><meta charset="utf-8"><title>Questions</title>
<style>body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; }</style></head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Questions</h1>
  <ul data-marble-id="u">
    <li data-marble-id="w1">Why do people stop using a tool?</li>
    <li data-marble-id="w2">What makes an interface feel alive?</li>
    <li data-marble-id="w3">Who is the page for?</li>
  </ul>
</body></html>
`;

// A long list, for how much painting a big change costs.
const LONG = `<!doctype html>
<html><head><meta charset="utf-8"><title>Long list</title>
<style>body { font: 15px/1.5 system-ui, sans-serif; margin: 40px; } li { padding: 2px 0; }</style></head>
<body data-marble-id="b">
  <ul data-marble-id="u">${Array.from({ length: 150 }, (_, i) => `<li data-marble-id="x${i}"><b>Paper ${i + 1}</b> <button>Unread</button></li>`).join('')}</ul>
</body></html>
`;

const due = (id, value) => ({ type: 'setAttr', id, name: 'data-due', value });
const read = (path = 'list') => ({ call: 'read_document', args: { path } });
const batch = (args, path = 'list') => ({ call: 'apply_ops', args: { path, ...args } });
const row = (n) => `<tr><td>Paper ${n}</td><td>Unread</td></tr>`;

const SCRIPTS = {
  rows: [
    read(),
    batch({ note: 'Add a due date to each row.', reach: ['r1', 'r2', 'r3'], total: 3, ops: [due('r1', 'Oct 9')] }),
    { sleep: 250 },
    batch({ note: 'Add a due date to each row.', ops: [due('r2', 'Oct 14')] }),
    { sleep: 250 },
    batch({ note: 'Add a due date to each row.', ops: [due('r3', 'Oct 21')] }),
    { sleep: 250 },
    { say: 'Done.' },
  ],
  steps: [
    read(),
    batch({ note: 'Stage 1 of 2: mark the unread rows', ops: [{ type: 'setAttr', id: 'r1', name: 'data-mark', value: 'unread' }] }),
    { sleep: 250 },
    batch({ note: 'Stage 2 of 2: date the rows', ops: [due('r2', 'Oct 14')] }),
    { sleep: 1800 },
    { say: 'Done.' },
  ],
  many: [
    read(),
    ...Array.from({ length: 7 }, (_, i) => [
      batch({ note: 'Add the papers.', total: 14, ops: [{ type: 'insert', parentId: 'tb', beforeId: null, html: row(2 * i + 1) + row(2 * i + 2) }] }),
      { sleep: 450 },
    ]).flat(),
    { say: 'Done.' },
  ],
  deep: [
    read('deep'),
    batch({ note: 'Add a due date to each row.', reach: ['d1', 'd2', 'd3'], ops: [due('d1', 'Oct 9')] }, 'deep'),
    { sleep: 700 },
    batch({ note: 'Add a due date to each row.', ops: [due('d2', 'Oct 14')] }, 'deep'),
    { sleep: 700 },
    batch({ note: 'Add a due date to each row.', ops: [due('d3', 'Oct 21')] }, 'deep'),
    { sleep: 1500 },
    { say: 'Done.' },
  ],
  lines: [
    read('lines'),
    batch({ note: 'Make each question shorter.', ops: [{ type: 'setText', id: 'w1', text: 'Why stop using a tool?' }] }, 'lines'),
    { sleep: 400 },
    batch({ note: 'Make each question shorter.', ops: [{ type: 'setText', id: 'w2', text: 'What makes it feel alive?' }] }, 'lines'),
    { sleep: 400 },
    batch({ note: 'Make each question shorter.', ops: [{ type: 'setText', id: 'w3', text: 'Who is it for?' }] }, 'lines'),
    { sleep: 600 },
    { say: 'Done.' },
  ],
  linesKnown: [
    read('lines'),
    batch({ note: 'Make each question shorter.', total: 3, ops: [{ type: 'setText', id: 'w1', text: 'Why stop using a tool?' }] }, 'lines'),
    { sleep: 400 },
    batch({ note: 'Make each question shorter.', ops: [{ type: 'setText', id: 'w2', text: 'What makes it feel alive?' }] }, 'lines'),
    { sleep: 400 },
    batch({ note: 'Make each question shorter.', ops: [{ type: 'setText', id: 'w3', text: 'Who is it for?' }] }, 'lines'),
    { sleep: 600 },
    { say: 'Done.' },
  ],
  slow: [
    read(),
    batch({ note: 'Add a due date to each row.', total: 3, ops: [due('r1', 'Oct 9')] }),
    { sleep: 3500 },
    batch({ note: 'Add a due date to each row.', ops: [due('r2', 'Oct 14')] }),
    { sleep: 250 },
    batch({ note: 'Add a due date to each row.', ops: [due('r3', 'Oct 21')] }),
    { say: 'Done.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { list: LIST, deep: DEEP, garden: GARDEN, lines: LINES, long: LONG } });
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

// Every test starts from the documents as written and no chat still going.
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

// A chat started straight through the host, as the line or another tab
// would: the page follows it only when told to (`attending`).
const newChat = async () => (await api('POST', '/agent/conversations', { provider: 'fake' })).id;
const sendTurn = (id, prompt, target = 'list') => api('POST', `/agent/conversations/${id}/turns`, {
  prompt, context: { target, viewing: target, selection: [], also: [] },
});
const finished = async (id, { timeout = 20_000 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) {
    const turn = (await api('GET', `/agent/conversations/${id}`)).turns?.at(-1);
    if (turn && ['completed', 'failed', 'cancelled'].includes(turn.status)) return turn;
    if (Date.now() > end) throw new Error('the turn did not finish');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const open = async ({ doc = 'list', attending = [], ...options } = {}) => {
  await closePages();
  const { page, errors } = await host.newPage({ attending, ...options });
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleChange && document.querySelector('.marble-change-layer')));
  await page.evaluate(() => {
    window.__ends = [];
    document.addEventListener('marble-change:end', (event) => window.__ends.push(event.detail));
  });
  // The page's stream opens on load; give it a beat before the turn starts.
  await page.waitForTimeout(200);
  return { page, errors };
};

const ended = (page, timeout = 20_000) => page.waitForFunction(() => window.__ends.length > 0, null, { timeout });
const layerEmpty = (page, timeout = 3500) => page.waitForFunction(
  () => document.querySelector('.marble-change-layer').children.length === 0,
  null,
  { timeout },
);
const said = (page) => page.evaluate(() => document.querySelector('.marble-change-tag .marble-change-said')?.textContent ?? null);

// Everything the tag says, and every state each part's tint was in, as it happens.
const record = (page) => page.evaluate(() => {
  const layer = document.querySelector('.marble-change-layer');
  window.__said = [];
  window.__labels = new Set();
  window.__text = new Set();
  window.__states = {};
  window.__most = 0;
  window.__meter = false;
  const look = () => {
    window.__most = Math.max(window.__most, layer.children.length);
    for (const tint of layer.querySelectorAll('.marble-change-tint')) {
      (window.__states[tint.dataset.id] ??= new Set()).add(tint.dataset.state);
    }
    const tag = layer.querySelector('.marble-change-tag');
    if (!tag) return;
    const text = tag.querySelector('.marble-change-said')?.textContent ?? '';
    if (text && window.__said.at(-1) !== text) window.__said.push(text);
    const label = tag.querySelector('button')?.getAttribute('aria-label');
    if (label) window.__labels.add(label);
    window.__text.add(tag.textContent);
    if (/ of 3 /.test(text) && tag.querySelector('.marble-change-meter:not([hidden])')) window.__meter = true;
  };
  new MutationObserver(look).observe(layer, { subtree: true, childList: true, characterData: true, attributes: true });
});
const recorded = (page) => page.evaluate(() => ({
  said: window.__said,
  labels: [...window.__labels],
  text: [...window.__text],
  states: Object.fromEntries(Object.entries(window.__states).map(([id, s]) => [id, [...s]])),
  most: window.__most,
  meter: window.__meter,
}));

// ------------------------------------------------------------ through a turn

test('a step’s reach is tinted at once, the part landing now deepens, no box is drawn, and nothing is left after the end', async () => {
  await settle();
  const id = await newChat();
  const { page, errors } = await open({ attending: [id] });
  await page.evaluate(() => {
    window.__first = null;
    window.__zones = 0;
    new MutationObserver(() => { window.__zones += document.querySelectorAll('.marble-zone').length; })
      .observe(document.documentElement, { subtree: true, childList: true });
    document.addEventListener('marble:presence', (event) => {
      if (event.detail?.stage !== 'before' || window.__first) return;
      window.__first = 'waiting';
      requestAnimationFrame(() => {
        window.__first = [...document.querySelectorAll('.marble-change-tint')]
          .map((t) => `${t.dataset.id}:${t.dataset.state}`).sort();
      });
    });
  });
  await sendTurn(id, 'script:rows Add a due date to each row');
  await page.waitForFunction(() => Array.isArray(window.__first));
  assert.deepEqual(await page.evaluate(() => window.__first), ['r1:now', 'r2:soon', 'r3:soon']);
  await ended(page);
  await layerEmpty(page);
  assert.equal(await page.evaluate(() => window.__zones), 0, 'no zone box over work that is marked part by part');
  assert.deepEqual(await page.evaluate(() => window.marbleChange.runs()), []);
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('one tag counts in the parts’ own unit, with a meter, never says Agent, and ends in numbers', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ attending: [id] });
  await record(page);
  await sendTurn(id, 'script:rows Add a due date to each row');
  await ended(page);
  await page.waitForTimeout(100);
  const seen = await recorded(page);
  assert.ok(seen.said.includes('Changing 1 of 3 rows'), `said ${JSON.stringify(seen.said)}`);
  assert.ok(seen.said.includes('Changing 3 of 3 rows'), `said ${JSON.stringify(seen.said)}`);
  assert.equal(seen.said.at(-1), '3 changed');
  assert.equal(seen.meter, true, 'a meter while the total is known');
  for (const words of [...seen.text, ...seen.labels]) assert.doesNotMatch(words, /agent/i);
  assert.equal(await page.locator('.marble-change-tag').count(), 1, 'one tag for the change');
  await layerEmpty(page);
});

test('stage notes become step tiles, and resting on the tag opens what was asked and the steps', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ attending: [id] });
  const prompt = 'script:steps Mark the unread rows, then give each of them a due date two weeks out from today';
  await sendTurn(id, prompt);
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tag .marble-change-steps > i').length === 2
    && document.querySelector('.marble-change-tag .marble-change-steps > i[data-state="now"]:last-child'));
  assert.deepEqual(
    await page.evaluate(() => [...document.querySelectorAll('.marble-change-steps > i')].map((i) => i.dataset.state)),
    ['done', 'now'],
  );
  await page.waitForTimeout(450);
  const status = page.locator('.marble-change-status');
  assert.equal(await status.isVisible(), false, 'the status waits for a rest');
  await page.locator('.marble-change-tag button').hover();
  await page.waitForFunction(() => document.querySelector('.marble-change-tag')?.hasAttribute('data-open'));
  await status.waitFor({ state: 'visible' });
  const text = await status.innerText();
  assert.ok(text.includes(prompt), 'the ask, whole');
  assert.match(text, /mark the unread rows/i);
  assert.match(text, /date the rows/i);
  assert.match(text, /\d:\d\d/);
  assert.doesNotMatch(text, /agent/i);
  // The rule between the ask and its steps is the page's grey line, not a
  // coloured edge.
  const rule = await page.evaluate(() => {
    const list = document.querySelector('.marble-change-steplist');
    const probe = document.createElement('i');
    probe.style.color = 'var(--change-line)';
    document.querySelector('.marble-change-layer').append(probe);
    const line = getComputedStyle(probe).color;
    probe.remove();
    const css = getComputedStyle(list);
    return { top: css.borderTopColor, line, sides: [css.borderLeftWidth, css.borderRightWidth, css.borderBottomWidth] };
  });
  assert.equal(rule.top, rule.line);
  assert.deepEqual(rule.sides, ['0px', '0px', '0px']);
  await page.mouse.move(5, 5);
  await ended(page);
});

test('past a dozen parts, each gets a dot in the margin and only the batch landing now is tinted', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ attending: [id] });
  await page.evaluate(() => {
    window.__deepest = 0;
    document.addEventListener('marble:ops', () => requestAnimationFrame(() => {
      const now = document.querySelectorAll('.marble-change-tint:not([data-state="lift"])').length;
      window.__deepest = Math.max(window.__deepest, now);
    }));
  });
  await sendTurn(id, 'script:many Add the fourteen papers');
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-dot').length >= 13, null, { timeout: 15_000 });
  assert.ok(await page.evaluate(() => window.__deepest) <= 2, 'at most the batch’s rows are tinted');
  assert.match(await said(page), /^Adding \d+ of 14 rows$/);
  const dot = await page.locator('.marble-change-dot').first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, left: r.left, table: document.querySelector('[data-marble-id="t"]').getBoundingClientRect().left };
  });
  assert.equal(dot.w, 5);
  assert.ok(dot.left < dot.table, 'the dot is in the margin, left of the rows');
  await ended(page);
  await layerEmpty(page);
});

test('a part with the person’s caret in it is not tinted while it is', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ attending: [id] });
  await page.locator('[data-marble-id="r2n"]').click();
  await record(page);
  await page.evaluate(() => {
    window.__shownOnHand = 0;
    new MutationObserver(() => {
      for (const tint of document.querySelectorAll('.marble-change-tint[data-id="r2"]')) {
        if (!tint.hidden && getComputedStyle(tint).display !== 'none') window.__shownOnHand += 1;
      }
    }).observe(document.querySelector('.marble-change-layer'), { subtree: true, childList: true, attributes: true });
  });
  await sendTurn(id, 'script:rows Add a due date to each row');
  await ended(page);
  const seen = await recorded(page);
  assert.ok(seen.states.r1?.includes('now') && seen.states.r3?.includes('now'), 'the other rows were tinted');
  assert.equal(await page.evaluate(() => window.__shownOnHand), 0, 'the row being typed in was not');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-marble-id')), 'r2n', 'and the caret stayed');
});

test('parts below the fold put a rail at the window’s edge and an N below pill; the page never scrolls by itself', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ doc: 'deep', attending: [id] });
  const before = await page.evaluate(() => scrollY);
  await sendTurn(id, 'script:deep Add a due date to each row', 'deep');
  await page.locator('.marble-change-rail .marble-change-tick').first().waitFor({ state: 'attached' });
  const more = page.locator('.marble-change-more');
  await more.waitFor();
  assert.match(await more.innerText(), /^3 below$/);
  assert.equal(await more.locator('svg').count(), 1, 'a drawn chevron');
  const rail = await page.locator('.marble-change-rail').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, right: innerWidth - r.right, ticks: el.querySelectorAll('.marble-change-tick').length };
  });
  assert.equal(rail.width, 2);
  assert.ok(rail.right >= 0 && rail.right < 24, 'inside the right edge of the window');
  assert.equal(rail.ticks, 3, 'a tick per part');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => scrollY), before, 'the page did not scroll by itself');
  await more.click();
  await page.waitForFunction(() => scrollY > 800, null, { timeout: 4000 });
  await ended(page);
});

test('a change this tab is not following draws nothing', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ attending: [] });
  await record(page);
  await sendTurn(id, 'script:rows Add a due date to each row');
  await finished(id);
  await page.waitForTimeout(300);
  assert.equal((await recorded(page)).most, 0, 'no marks, no tag');
  assert.deepEqual(await page.evaluate(() => window.__ends), []);
});

test('a tab opened mid-change is caught up and shows the change’s tag', async () => {
  await settle();
  const id = await newChat();
  await sendTurn(id, 'script:slow Add a due date to each row');
  const deadline = Date.now() + 10_000;
  while (!(await host.drive.store.read('list')).includes('data-due="Oct 9"')) {
    if (Date.now() > deadline) throw new Error('the first batch never landed');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const { page } = await open({ attending: [id] });
  await page.locator('.marble-change-tag').waitFor({ timeout: 2500 });
  assert.equal(await said(page), 'Changing 1 of 3 rows', 'from the frame the host kept, before the next batch');
  await ended(page);
  await layerEmpty(page);
});

test('Hide work hides the marks, and the tray offers it while a change is marked', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  await frame(page, { client: 'agent:c1', ids: [], phase: 'working', stage: 'start', turn: 'c1-t1', prompt: 'Date the rows' });
  await frame(page, before({ parts: ['r1'], reach: ['r1', 'r2'], count: 1 }));
  await page.locator('.marble-change-tint').first().waitFor();
  const tray = page.locator('marble-agent-drawer .tray');
  await tray.locator('.launcher').hover();
  const work = tray.locator('.tool[data-tool="work"]');
  await work.waitFor({ state: 'visible' });
  assert.equal(await work.getAttribute('aria-label'), 'Hide work');
  await work.click();
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-zones-off'));
  assert.equal(await page.locator('.marble-change-layer').evaluate((el) => getComputedStyle(el).display), 'none');
  await tray.locator('.launcher').hover();
  await page.waitForFunction(() => document.querySelector('marble-agent-drawer')?.shadowRoot
    .querySelector('.tool[data-tool="work"]')?.getAttribute('aria-label') === 'Show work');
  await work.click();
  assert.notEqual(await page.locator('.marble-change-layer').evaluate((el) => getComputedStyle(el).display), 'none');
});

test('with reduced motion the tints still appear and lift, and nothing moves by transform', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ attending: [id], reducedMotion: 'reduce' });
  await record(page);
  await page.evaluate(() => {
    window.__moved = [];
    const look = () => {
      for (const animation of document.getAnimations()) {
        const keys = animation.effect?.getKeyframes?.() ?? [];
        if (keys.some((k) => 'transform' in k || 'translate' in k || 'scale' in k)) window.__moved.push(animation.effect?.target?.className ?? '?');
      }
    };
    new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    document.addEventListener('marble:presence', () => requestAnimationFrame(look));
  });
  await sendTurn(id, 'script:rows Add a due date to each row');
  await ended(page);
  await layerEmpty(page);
  const seen = await recorded(page);
  assert.ok(seen.states.r1?.includes('now') && seen.states.r1?.includes('lift'), `r1 went ${seen.states.r1}`);
  assert.deepEqual(await page.evaluate(() => window.__moved), []);
});

// ------------------------------------------------------------ frame by frame
// The host's frames dispatched straight onto the page, as collab.test.js does.

const frame = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
}, detail);
const opsFrom = (page, client, ops) => page.evaluate(([c, o]) => {
  window.marble.apply ? o.forEach((op) => window.marble.apply(op)) : null;
  document.dispatchEvent(new CustomEvent('marble:ops', { detail: { ops: o, client: c } }));
}, [client, ops]);
const before = (extra) => ({
  client: 'agent:c1', ids: extra.parts, phase: 'writing', note: 'Date the rows.', turn: 'c1-t1', stage: 'before',
  inserts: [], removes: [], moves: [], kind: 'attr', step: null, count: 1, total: null, reach: null, ...extra,
});
const tagSaid = async (page) => {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return said(page);
};

test('the verb is the batch’s kind and the unit is the parts’ own', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  const saidBy = async (client) => {
    await page.evaluate(() => new Promise(requestAnimationFrame));
    return page.evaluate((c) => document.querySelector(`.marble-change-tag[data-client="${c}"] .marble-change-said`)?.textContent ?? null, client);
  };
  await frame(page, before({ parts: ['s'], kind: 'look' }));
  assert.equal(await saidBy('agent:c1'), 'Restyling 1 section');
  // A new turn is a new change, and a new tag.
  await frame(page, before({ turn: 'c1-t2', parts: ['r1', 'r2'], kind: 'words', count: 2 }));
  assert.equal(await saidBy('agent:c1'), 'Rewriting 2 rows');
  // (One cell alone would be words in one block: the caret's, not the marks'.)
  await frame(page, before({ turn: 'c1-t2', parts: ['r3', 'r1n'], kind: 'structure', removes: ['r3', 'r1n'], count: 3, total: 9 }));
  assert.equal(await saidBy('agent:c1'), 'Removing 3 of 9 parts', 'rows and a cell together are parts');
  await frame(page, before({ turn: 'c1-t2', parts: ['go'], kind: 'structure', inserts: [{ parentId: 's', beforeId: null, ids: ['go'] }], count: 4 }));
  assert.equal(await saidBy('agent:c1'), 'Adding 4 of 9 parts', 'the total holds for the turn');
  await frame(page, { client: 'agent:c1', ids: ['h', 'r1', 'r2'], phase: 'reading', turn: 'c1-t2' });
  assert.equal(await saidBy('agent:c1'), 'Reading 3 parts');

  // Not followed: no tag of its own until it is.
  await frame(page, before({ client: 'agent:c2', turn: 'c2-t1', parts: ['chart'], kind: 'mixed', count: 1 }));
  assert.equal(await saidBy('agent:c2'), null);
  await page.evaluate(() => window.marble.agent.attend('c2'));
  await frame(page, before({ client: 'agent:c2', turn: 'c2-t1', parts: ['chart'], kind: 'mixed', count: 1 }));
  assert.equal(await saidBy('agent:c2'), 'Changing 1 chart');
  assert.equal(await page.locator('.marble-change-tag').count(), 2, 'one tag for each change');
});

test('the end says what changed in numbers, then every mark goes and the run is forgotten', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  const end = (done, turn = 'c1-t1') => frame(page, { client: 'agent:c1', ids: [], stage: 'end', turn, done });
  await frame(page, before({ parts: ['r1'], count: 2 }));
  await end({ status: 'cancelled', changed: 2, added: 0, removed: 0 });
  assert.equal(await tagSaid(page), 'Stopped · 2 changed');
  assert.deepEqual(await page.evaluate(() => window.__ends.map((e) => [e.client, e.turn, e.done.status])), [['agent:c1', 'c1-t1', 'cancelled']]);
  await layerEmpty(page, 3500);
  assert.equal(await page.evaluate(() => window.marbleChange.claims('agent:c1')), false);

  await frame(page, before({ turn: 'c1-t2', parts: ['r1'] }));
  await end({ status: 'failed', changed: 0, added: 0, removed: 0 }, 'c1-t2');
  assert.equal(await tagSaid(page), 'Didn\'t finish');
  await layerEmpty(page, 3500);

  await frame(page, before({ turn: 'c1-t3', parts: ['r1'] }));
  await end({ status: 'completed', changed: 3, added: 1, removed: 0 }, 'c1-t3');
  assert.equal(await tagSaid(page), '3 changed · 1 added');
});

test('an undo is tinted where it lands, with no tag, and leaves nothing behind', async () => {
  await settle();
  const { page } = await open({ attending: [] });
  await frame(page, { client: 'agent-undo:c1', ids: ['r1', 'r3'], phase: 'writing', stage: 'before', turn: 'c1-t1', parts: ['r1', 'r3'] });
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint[data-state="now"]').length === 2);
  assert.equal(await page.locator('.marble-change-tag').count(), 0);
  assert.equal(await page.evaluate(() => window.marbleChange.tintFor('r1')), 'now');
  await opsFrom(page, 'agent-undo:c1', [due('r1', ''), due('r3', '')]);
  await page.waitForFunction(() => document.querySelectorAll('.marble-change-tint[data-state="lift"]').length === 2);
  await layerEmpty(page, 2500);
  assert.equal(await page.locator('.marble-zone').count(), 0, 'an undo draws no box either');
  assert.deepEqual(await page.evaluate(() => window.marbleChange.runs()), []);
});

test('words in one block stay with the caret: no tints and no tag of the marks’ own', async () => {
  await settle();
  const { page } = await open({ doc: 'garden', attending: ['c1'] });
  await frame(page, { client: 'agent:c1', ids: ['p'], phase: 'working', stage: 'start', turn: 'c1-t1', prompt: 'Say why' });
  await page.locator('.marble-text-caret:not([hidden])').waitFor();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.locator('.marble-change-layer > *').count(), 0);
  assert.equal(await page.evaluate(() => window.marbleChange.claims('agent:c1')), false);
  assert.equal(await page.locator('.marble-zone').count(), 0);
  assert.match(await page.locator('.marble-text-tag').innerText(), /^Reading \d+ words?$/);
});

test('the scope asked about is tinted 6px out until the first part is marked; a press on the tag opens the chat', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  await frame(page, { client: 'agent:c1', ids: ['t'], phase: 'working', stage: 'start', turn: 'c1-t1', prompt: 'Date the rows' });
  const scope = page.locator('.marble-change-tint[data-id="t"]');
  await scope.waitFor();
  const fit = await scope.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const t = document.querySelector('[data-marble-id="t"]').getBoundingClientRect();
    return { left: Math.round(t.left - r.left), top: Math.round(t.top - r.top), right: Math.round(r.right - t.right), radius: el.style.borderRadius };
  });
  assert.deepEqual(fit, { left: 6, top: 6, right: 6, radius: '6px' });
  assert.match(await page.locator('.marble-change-time').innerText(), /^0:0\d$/, 'the tag starts with the time alone');
  assert.equal(await page.locator('.marble-zone').count(), 0);
  await frame(page, before({ parts: ['r1'] }));
  await page.waitForFunction(() => document.querySelector('.marble-change-tint[data-id="t"]')?.dataset.state !== 'soon'
    || !document.querySelector('.marble-change-tint[data-id="t"]'));
  await page.evaluate(() => {
    window.opened = [];
    window.marble.agent.open = (id) => window.opened.push(id);
  });
  await page.locator('.marble-change-tag button').click();
  assert.deepEqual(await page.evaluate(() => window.opened), ['c1']);
});

test('a press stays collab’s ring, and work with nothing of it here draws nothing', async () => {
  await settle();
  const { page } = await open({ attending: ['c1', 'c2'] });
  await frame(page, { client: 'agent:c1', ids: ['go'], phase: 'acting', note: 'Pressing Sort', turn: 'c1-t1' });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.locator('.marble-act').count(), 1);
  assert.equal(await page.locator('.marble-change-layer > *').count(), 0);
  await frame(page, { client: 'agent:c2', ids: ['nowhere'], phase: 'writing', stage: 'before', turn: 'c2-t1', parts: ['nowhere'], kind: 'attr', count: 1 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.locator('.marble-change-layer > *').count(), 0);
});

// ------------------------------------------------------------ fix round 1

const caretUp = (page) => page.evaluate(() => document.querySelectorAll('.marble-text-caret:not([hidden])').length);

test('a turn that rewrites three one-line rows is marked part by part and counted, not typed at a caret', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ doc: 'lines', attending: [id] });
  await record(page);
  await page.evaluate(() => {
    window.__caretLater = 0;
    document.addEventListener('marble:presence', (event) => {
      if (event.detail?.stage !== 'before' || !(event.detail.count > 1)) return;
      requestAnimationFrame(() => { window.__caretLater += document.querySelectorAll('.marble-text-caret:not([hidden])').length; });
    });
  });
  await sendTurn(id, 'script:lines Make each question shorter', 'lines');
  await ended(page);
  const seen = await recorded(page);
  assert.ok(seen.said.includes('Rewriting 2 rows') && seen.said.includes('Rewriting 3 rows'), `said ${JSON.stringify(seen.said)}`);
  assert.equal(seen.said.at(-1), '3 changed');
  assert.ok(seen.states.w2?.includes('now') && seen.states.w3?.includes('now'), 'the later rows were tinted');
  assert.equal(await page.evaluate(() => window.__caretLater), 0, 'once a second row is touched, the caret lets go');
});

test('a turn that says it will touch three rows is marked from its first row, with no caret at all', async () => {
  await settle();
  const id = await newChat();
  const { page } = await open({ doc: 'lines', attending: [id] });
  await record(page);
  await page.evaluate(() => {
    window.__carets = 0;
    new MutationObserver(() => { window.__carets += document.querySelectorAll('.marble-text-caret:not([hidden])').length; })
      .observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  });
  await sendTurn(id, 'script:linesKnown Make each question shorter', 'lines');
  await ended(page);
  const seen = await recorded(page);
  assert.ok(seen.said.includes('Rewriting 1 of 3 rows'), `said ${JSON.stringify(seen.said)}`);
  assert.ok(seen.states.w1?.includes('now'), 'the first row was tinted');
  assert.equal(await page.evaluate(() => window.__carets), 0);
});

test('a change of 150 parts paints once a frame, measuring each part at most once a paint', async () => {
  await settle();
  const { page } = await open({ doc: 'long', attending: ['c1'] });
  const seen = await page.evaluate(async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `x${i}`);
    const fire = (d) => document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
    const before = window.marbleChange.stats();
    fire({ client: 'agent:c1', ids: [], phase: 'working', stage: 'start', turn: 'c1-t1', prompt: 'Date them all' });
    for (let b = 0; b < 15; b += 1) {
      const parts = ids.slice(b * 10, b * 10 + 10);
      const d = {
        client: 'agent:c1', ids: parts, phase: 'writing', note: 'Date them.', turn: 'c1-t1', stage: 'before', parts, reach: ids,
        kind: 'attr', count: (b + 1) * 10, total: 150, step: null, inserts: [], removes: [], moves: [],
      };
      fire(d);
      document.dispatchEvent(new CustomEvent('marble:ops', { detail: { client: 'agent:c1', ops: [] } }));
      fire({ ...d, stage: 'after' });
    }
    const heard = window.marbleChange.stats();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const painted = window.marbleChange.stats();
    return {
      whileHeard: heard.renders - before.renders,
      painted: painted.renders - heard.renders,
      rects: painted.rects - heard.rects,
      styles: painted.styles - before.styles,
      dots: document.querySelectorAll('.marble-change-dot').length,
    };
  });
  assert.equal(seen.whileHeard, 0, 'nothing is painted while the frames are being heard');
  assert.ok(seen.painted >= 1 && seen.painted <= 2, `one paint a frame (${seen.painted})`);
  assert.ok(seen.rects <= seen.painted * 160, `each part measured at most once a paint (${seen.rects} rects in ${seen.painted} paints)`);
  assert.ok(seen.styles <= 160, `what a part looks like is read once (${seen.styles})`);
  assert.equal(seen.dots, 150);
  const start = await page.evaluate(() => window.marbleChange.stats().renders);
  await frame(page, { client: 'agent:c1', ids: [], stage: 'end', turn: 'c1-t1', done: { status: 'completed', changed: 150, added: 0, removed: 0 } });
  await layerEmpty(page, 5000);
  const through = await page.evaluate((n) => window.marbleChange.stats().renders - n, start);
  assert.ok(through <= 40, `landing, lifting and going take a bounded number of paints (${through})`);
});

test('a change put out of mind mid-way still lets go of its marks at its end', async () => {
  await settle();
  const { page } = await open({ attending: ['c1'] });
  await frame(page, before({ parts: ['r1'] }));
  await page.locator('.marble-change-tint[data-id="r1"]').waitFor();
  await page.evaluate(() => sessionStorage.setItem('marble-attending', '[]'));
  await frame(page, { client: 'agent:c1', ids: [], stage: 'end', turn: 'c1-t1', done: { status: 'completed', changed: 1, added: 0, removed: 0 } });
  assert.deepEqual(await page.evaluate(() => window.__ends.map((e) => e.turn)), ['c1-t1']);
  await layerEmpty(page, 3500);

  // And a frame from a chat no longer followed takes its run off the page.
  await page.evaluate(() => sessionStorage.setItem('marble-attending', JSON.stringify(['c1'])));
  await frame(page, before({ turn: 'c1-t2', parts: ['r2'] }));
  await page.locator('.marble-change-tint[data-id="r2"]').waitFor();
  await page.evaluate(() => sessionStorage.setItem('marble-attending', '[]'));
  await frame(page, before({ turn: 'c1-t2', parts: ['r3'], count: 2 }));
  await layerEmpty(page, 1000);
  assert.equal(await page.evaluate(() => window.marbleChange.claims('agent:c1')), false);
});

test('an undo whose last frames never come lifts its marks after a while, and lets go', async () => {
  await settle();
  const { page } = await open({ attending: [] });
  await frame(page, { client: 'agent-undo:c1', ids: ['r1'], phase: 'writing', stage: 'before', turn: 'c1-t1', parts: ['r1'] });
  await page.locator('.marble-change-tint[data-state="now"]').waitFor();
  assert.equal(await page.evaluate(() => window.marbleChange.claims('agent-undo:c1')), true);
  await page.waitForTimeout(4000);
  assert.equal(await page.locator('.marble-change-tint[data-state="now"]').count(), 1, 'it waits a while for the rest of the undo');
  await layerEmpty(page, 8000);
  assert.equal(await page.evaluate(() => window.marbleChange.claims('agent-undo:c1')), false);
  assert.deepEqual(await page.evaluate(() => window.marbleChange.runs()), []);
});
