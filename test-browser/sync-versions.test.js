// Marble Sync step 2, end to end: real tabs on a scratch drive, the real
// carrier (@bdhmin/marble's runtime/marble.js, 0.2.6), the host's versions,
// rebase, catch-up and one socket per tab.
//
//   - two tabs typing in one paragraph at once both keep their words, and
//     both tabs end up showing what the file says;
//   - an agent's edit made on an old version is rebased, not refused;
//   - a tab whose socket went away hears what it missed and converges;
//   - five streams in one tab ride one WebSocket;
//   - with /sync/ws refused, the tab carries on over EventSource;
//   - 20 rapid edits on a 2 MB page land with no fork, and the step-1 false
//     fork (an agent-touched 2 MB page, a 20-op batch) stays fixed.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTools } from '../server/agent/tools.js';
import { hasCore } from '../server/rebase.js';
import { startDrive } from './harness.js';

// Every contenteditable files its words as setText, the way a page's own
// script does.
const TYPES = `<script data-marble-id="typing">
addEventListener('input', (e) => {
  const el = e.target.closest?.('[data-marble-id][contenteditable]');
  if (el && window.marble) marble.op({ type: 'setText', id: el.getAttribute('data-marble-id'), text: el.textContent });
});
</script>`;

const PAD = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pad</title>
<style>body { font: 16px/1.5 Georgia, serif; margin: 40px; } p { min-height: 1.5em; }</style>
</head>
<body data-marble-id="b">
  <h1 data-marble-id="h">Pad</h1>
  <p data-marble-id="p1" contenteditable="true">The middle of the sentence</p>
  <p data-marble-id="p2" contenteditable="true">Second paragraph</p>
  <p data-marble-id="p3" contenteditable="true">Third paragraph</p>
  ${TYPES}
</body></html>
`;

// About 2 MB: a style, a script, and thousands of addressed paragraphs.
function big(bytes = 2_000_000) {
  let body = '';
  let i = 0;
  while (body.length < bytes * 0.8) {
    body += `  <section data-marble-id="s${i}"><h2 data-marble-id="s${i}h">Section ${i}</h2>`;
    for (let k = 0; k < 8; k += 1) body += `<p data-marble-id="s${i}p${k}" contenteditable="true">Paragraph ${k} of section ${i}, with enough words to be a paragraph.</p>`;
    body += '</section>\n';
    i += 1;
  }
  const css = Array.from({ length: 2000 }, (_, n) => `.c${n} { padding: ${n % 16}px; }`).join('\n');
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>Big</title><style data-marble-id="css">${css}</style></head>\n<body data-marble-id="b">\n${body}${TYPES}\n</body></html>\n`;
}
const BIG = big(2_600_000);

// Forks as the sync core makes them (rule 8): a wrapper with a fresh id, the
// version that was in the document under its own id, each version naming its
// writer's client; a removal that met an edit is an empty, marked version.
const FORKED = `<!doctype html>
<html><head><meta charset="utf-8"><title>Forked</title></head>
<body data-marble-id="b">
  <marble-alt data-marble-id="w1" data-marble-active="person:tabA">
    <p data-marble-id="p1" data-marble-alt="person:tabA" data-marble-by="person" data-marble-client="tabA">First words</p>
    <p data-marble-id="x9" data-marble-alt="person:tabB" data-marble-by="person" data-marble-client="tabB">Second words</p>
  </marble-alt>
  <marble-alt data-marble-id="w2" data-marble-active="person:tabA">
    <p data-marble-id="p2" data-marble-alt="person:tabA" data-marble-by="person" data-marble-client="tabA">Edited while removed</p>
    <p data-marble-id="x8" data-marble-alt="agent:agent:c1" data-marble-by="agent" data-marble-client="agent:c1" data-marble-removed=""></p>
  </marble-alt>
  <p data-marble-id="p3">Not forked</p>
</body></html>
`;

const host = await startDrive({ agents: false, documents: { pad: PAD, race: PAD, agent: PAD, missed: PAD, five: PAD, refused: PAD, big: BIG, forked: FORKED } });
test.after(() => host.close());

const until = async (fn, what, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const file = (doc) => host.drive.store.read(doc);
const hostV = (doc) => host.drive.versions.current(doc);

/** A tab on a document, its socket instances counted. */
async function tab(doc, { blockable = false } = {}) {
  const { page, errors } = await host.newPage();
  await page.context().addInitScript((block) => {
    const W = window.WebSocket;
    window.__sockets = [];
    window.__blockSockets = false;
    window.WebSocket = class extends W {
      constructor(url, ...rest) {
        super(block && window.__blockSockets ? 'ws://127.0.0.1:9/blocked' : url, ...rest);
        window.__sockets.push(this);
      }
    };
  }, blockable);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.stream && Number.isInteger(window.marble.status?.v)));
  return { page, errors };
}

/** What a tab shows, as its text nodes in order (whitespace between
 *  elements is layout, not content), with the page's chrome left out. */
const shown = (page) =>
  page.evaluate(() => {
    const body = document.body.cloneNode(true);
    for (const el of body.querySelectorAll('[data-marble-transient], script, .marble-fork')) el.remove();
    const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const out = [];
    while (walk.nextNode()) if (walk.currentNode.nodeValue.trim()) out.push(walk.currentNode.nodeValue.replace(/\s+/g, ' ').trim());
    return out.join(' | ');
  });
/** What the file says, the same way. */
const said = (page, doc) =>
  page.evaluate(async (d) => {
    const html = await (await fetch(`/a/${encodeURIComponent(d)}`, { cache: 'no-store' })).text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const el of parsed.body.querySelectorAll('[data-marble-transient], script')) el.remove();
    const walk = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
    const out = [];
    while (walk.nextNode()) if (walk.currentNode.nodeValue.trim()) out.push(walk.currentNode.nodeValue.replace(/\s+/g, ' ').trim());
    return out.join(' | ');
  }, doc);
const settled = async (pages, doc) => {
  await until(async () => {
    const v = await hostV(doc);
    for (const page of pages) {
      const status = await page.evaluate(() => window.marble.status);
      if (status.pending || status.v !== v) return false;
    }
    return true;
  }, `every tab at the host's version of ${doc}`);
};
const converged = async (pages, doc) => {
  await settled(pages, doc);
  const truth = await said(pages[0], doc);
  await until(async () => {
    for (const page of pages) if ((await shown(page)) !== truth) return false;
    return true;
  }, `every tab showing what ${doc} says`, 8000);
  return truth;
};
const endOf = async (page, id) => {
  await page.click(`[data-marble-id="${id}"]`);
  await page.keyboard.press('End');
};
const startOf = async (page, id) => {
  await page.click(`[data-marble-id="${id}"]`);
  await page.keyboard.press('Home');
};

test('two tabs typing in the same paragraph at once both keep their words, and both tabs converge', async () => {
  const a = await tab('race');
  const b = await tab('race');
  await until(async () => (await a.page.evaluate(() => marble.stream.transport)) === 'socket', 'tab a on its socket');
  await endOf(a.page, 'p1');
  await startOf(b.page, 'p1');
  await Promise.all([
    a.page.keyboard.type(' typed at the end', { delay: 25 }),
    b.page.keyboard.type('Typed at the start: ', { delay: 25 }),
  ]);
  const truth = await converged([a.page, b.page], 'race');
  assert.match(truth, /typed at the end/);
  assert.match(truth, /Typed at the start:/);
  const now = await file('race');
  assert.match(now, /typed at the end/);
  assert.match(now, /Typed at the start:/);
  if (hasCore()) assert.doesNotMatch(now, /<marble-alt/, 'words in different places merge');
  assert.deepEqual([...a.errors, ...b.errors].filter((e) => !/favicon/.test(e)), []);
  await a.page.context().close();
  await b.page.context().close();
});

test("an agent's edit made on an old version is rebased, not refused, and the tab converges", async () => {
  const a = await tab('agent');
  const tools = createTools({ store: host.drive.store, writeOps: host.drive.writeOps, snapshot: host.drive.snapshot, createDocument: host.drive.createDocument, onLook: () => {} });
  const turn = { id: 'e2e-1', conversationId: 'e2e000000001', writable: new Set(['agent']), undo: [], onEvent() {}, quiet: false };
  await tools.call('read_document', { path: 'agent' }, turn);
  // The person types after the agent read the page.
  await endOf(a.page, 'p2');
  await a.page.keyboard.type(' and more', { delay: 10 });
  await settled([a.page], 'agent');
  const answer = await tools.call('apply_ops', { path: 'agent', note: 'Retitle and reword', ops: [{ type: 'setText', id: 'h', text: 'Agent pad' }, { type: 'setText', id: 'p2', text: 'Second paragraph, reworded' }] }, turn);
  assert.equal(answer.refused, undefined, JSON.stringify(answer));
  assert.ok(answer.applied >= 2, JSON.stringify(answer));
  const truth = await converged([a.page], 'agent');
  assert.match(truth, /Agent pad/);
  assert.match(truth, /and more/, "the person's words are kept");
  await a.page.context().close();
});

test('a tab whose socket went away hears what it missed and converges', async () => {
  const a = await tab('missed');
  const b = await tab('missed', { blockable: true });
  await until(async () => (await b.page.evaluate(() => marble.stream.transport)) === 'socket', 'tab b on its socket');
  // Tab b loses its socket, and cannot get it back for a while, nor reach
  // the host any other way.
  const cut = (route) => route.abort();
  await b.page.route('**/events?**', cut);
  await b.page.route('**/ops?**', cut);
  await b.page.evaluate(() => {
    window.__blockSockets = true;
    for (const ws of window.__sockets) ws.close();
  });
  for (const [i, words] of ['one', 'two', 'three'].entries()) {
    await endOf(a.page, `p${i + 1}`);
    await a.page.keyboard.type(` missed ${words}`, { delay: 5 });
    await settled([a.page], 'missed');
  }
  const behind = await b.page.evaluate(() => marble.status.v);
  assert.ok(behind < (await hostV('missed')), 'tab b missed those batches');
  await b.page.unroute('**/events?**', cut);
  await b.page.unroute('**/ops?**', cut);
  await b.page.evaluate(() => {
    window.__blockSockets = false;
  });
  const truth = await converged([a.page, b.page], 'missed');
  for (const words of ['one', 'two', 'three']) assert.match(truth, new RegExp(`missed ${words}`));
  await a.page.context().close();
  await b.page.context().close();
});

test('five streams in one tab ride one WebSocket', async () => {
  const before = host.drive.sockets.counts.upgrades;
  const a = await tab('five');
  await until(async () => (await a.page.evaluate(() => marble.stream.transport)) === 'socket' && host.drive.sockets.counts.streams >= 1, 'the carrier on its socket');
  await a.page.evaluate(() => {
    window.__extra = ['/events?drive=1&client=e2e', '/events?app=pad&client=e2e', '/events?app=race&client=e2e', '/events?app=agent&client=e2e'].map((url) => new EventSource(url));
  });
  await until(async () => host.drive.sockets.counts.streams >= 5, 'five streams');
  assert.equal(host.drive.sockets.counts.upgrades - before, 1, 'one upgrade for the tab');
  assert.equal(await a.page.evaluate(() => window.__sockets.length), 1, 'the page opened one socket');
  assert.equal(await a.page.evaluate(() => marble.stream.sockets), 1);
  // A write elsewhere reaches the tab's other stream over the same socket.
  const heard = a.page.evaluate(() => new Promise((resolve) => window.__extra[0].addEventListener('changed', (e) => resolve(e.data), { once: true })));
  await host.drive.writeOps('pad', [{ type: 'setText', id: 'h', text: 'Pad, again' }], { client: 'someone' });
  assert.match(await heard, /"path":"pad"/);
  await a.page.evaluate(() => window.__extra.forEach((s) => s.close()));
  await a.page.context().close();
});

test('with /sync/ws refused, everything still works over EventSource', async () => {
  const listeners = host.drive.server.listeners('upgrade');
  const upgrades = host.drive.sockets.counts.upgrades;
  host.drive.server.removeAllListeners('upgrade');
  host.drive.server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 503 Service Unavailable\r\nconnection: close\r\ncontent-length: 0\r\n\r\n'));
  try {
    const a = await tab('refused');
    const b = await tab('refused');
    await until(async () => (await a.page.evaluate(() => marble.stream.transport)) === 'eventsource' && (await b.page.evaluate(() => marble.stream.transport)) === 'eventsource', 'both tabs on EventSource');
    await endOf(a.page, 'p1');
    await a.page.keyboard.type(' over EventSource', { delay: 10 });
    await endOf(b.page, 'p3');
    await b.page.keyboard.type(' and back', { delay: 10 });
    const truth = await converged([a.page, b.page], 'refused');
    assert.match(truth, /over EventSource/);
    assert.match(truth, /and back/);
    assert.equal(host.drive.sockets.counts.upgrades, upgrades, 'no socket opened');
    await a.page.context().close();
    await b.page.context().close();
  } finally {
    host.drive.server.removeAllListeners('upgrade');
    for (const listener of listeners) host.drive.server.on('upgrade', listener);
  }
});

test('20 rapid edits on a 2 MB page, from two tabs at once, land with no fork', async () => {
  const a = await tab('big');
  const b = await tab('big');
  const start = Date.now();
  await endOf(a.page, 's10p1');
  await endOf(b.page, 's200p3');
  await Promise.all([
    (async () => {
      for (let i = 0; i < 10; i += 1) await a.page.keyboard.type(` a${i}`, { delay: 0 });
    })(),
    (async () => {
      for (let i = 0; i < 10; i += 1) await b.page.keyboard.type(` b${i}`, { delay: 0 });
    })(),
  ]);
  await settled([a.page, b.page], 'big');
  const took = Date.now() - start;
  const now = await file('big');
  assert.doesNotMatch(now, /<marble-alt/, 'no fork');
  assert.match(now, /Paragraph 1 of section 10[^<]* a0 a1 a2 a3 a4 a5 a6 a7 a8 a9</);
  assert.match(now, /Paragraph 3 of section 200[^<]* b0 b1 b2 b3 b4 b5 b6 b7 b8 b9</);
  console.log(`# 20 rapid edits on ${(BIG.length / 1e6).toFixed(1)} MB from two tabs settled in ${took} ms`);
  await a.page.context().close();
  await b.page.context().close();
});

test('the step-1 false fork stays fixed: an agent-touched 2 MB page and a 20-op batch fork nothing', async () => {
  const post = async (client, ops, extra = '') => {
    const res = await fetch(`${host.base}/ops?app=big&client=${client}${extra}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ops) });
    return res.json();
  };
  const mk = (n, tag) => Array.from({ length: n }, (_, i) => ({ type: 'setText', id: `s${300 + i}p0`, text: `${tag}${i}` }));
  const v = await hostV('big');
  assert.deepEqual((await post('tabA', mk(1, 'a'), `&base=${v}`)).forks, []);
  assert.deepEqual((await post('tabA', mk(20, 'b'), `&base=${v}`)).forks, [], 'its own earlier batch is not concurrent with it');
  assert.deepEqual((await post('agent:sim', [{ type: 'setAttr', id: 's0', name: 'data-state', value: 'agent' }])).forks, []);
  assert.deepEqual((await post('tabA', mk(1, 'c'), `&base=${v}`)).forks, [], 'an agent far away is not in the way');
  const last = await post('tabA', mk(20, 'd'), `&base=${await hostV('big')}`);
  assert.deepEqual(last.forks, []);
  await new Promise((r) => setTimeout(r, 1500)); // any watcher wake lands
  const now = await file('big');
  assert.doesNotMatch(now, /<marble-alt/);
  assert.ok(mk(20, 'd').every((o) => now.includes(`data-marble-id="${o.id}" contenteditable="true">${o.text}<`)));
});

test("Keep this on a fork from the sync core keeps that version under its own id and takes the wrapper away", async () => {
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/forked`);
  const bar = page.locator('marble-alt[data-marble-id="w1"] > .marble-fork');
  await bar.waitFor();
  assert.deepEqual(await bar.locator('.marble-fork-seg button').allTextContents(), ['First edit', 'Second edit']);
  await bar.getByRole('button', { name: 'Second edit', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-marble-id="w1"] > .marble-alt-shown')?.textContent === 'Second words');
  await bar.getByRole('button', { name: 'Keep this' }).click();
  await until(async () => !(await file('forked')).includes('data-marble-id="w1"'), 'the wrapper to go');
  const now = await file('forked');
  assert.match(now, /<p data-marble-id="x9">Second words<\/p>/, 'the kept version, plain, under its own id');
  assert.doesNotMatch(now, /First words/);

  // A removal that met an edit: keeping the removal removes it.
  const removal = page.locator('marble-alt[data-marble-id="w2"] > .marble-fork');
  assert.deepEqual(await removal.locator('.marble-fork-seg button').allTextContents(), ['Yours', 'Removed']);
  await removal.getByRole('button', { name: 'Removed', exact: true }).click();
  await removal.getByRole('button', { name: 'Keep this' }).click();
  await until(async () => !(await file('forked')).includes('data-marble-id="w2"'), 'the removal to land');
  const after = await file('forked');
  assert.doesNotMatch(after, /Edited while removed/);
  assert.doesNotMatch(after, /<marble-alt/);
  assert.match(after, /Not forked/);
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
  await page.context().close();
});
