// Ask at anything, v2: notes kept with ⇧⏎ and sent as one brief, and the
// one moment the page speaks first — right after a hand edit that leaves an
// obvious next step (Notes and Sketches/Ask at Anything).

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const PAPERS = `<!doctype html><html><head><meta charset="utf-8"><title>Reading list</title></head>
<body data-marble-id="b">
<table data-marble-id="t"><thead data-marble-id="th"><tr data-marble-id="hr"><th data-marble-id="k1">Title</th><th data-marble-id="k2">Authors</th><th data-marble-id="k3">Venue</th><th data-marble-id="k4">Year</th><th data-marble-id="k5">Status</th></tr></thead>
<tbody data-marble-id="tb">
<tr data-marble-id="r1"><td data-marble-id="c11">Generative Agents</td><td data-marble-id="c12">Park et al.</td><td data-marble-id="c13">UIST</td><td data-marble-id="c14">2023</td><td data-marble-id="c15">To read</td></tr>
<tr data-marble-id="r2"><td data-marble-id="c21">Reflexion</td><td data-marble-id="c22">Shinn et al.</td><td data-marble-id="c23">NeurIPS</td><td data-marble-id="c24">2023</td><td data-marble-id="c25">To read</td></tr>
<tr data-marble-id="r3"><td data-marble-id="c31">Voyager</td><td data-marble-id="c32">Wang et al.</td><td data-marble-id="c33">TMLR</td><td data-marble-id="c34">2024</td><td data-marble-id="c35">To read</td></tr>
<tr data-marble-id="r4"><td data-marble-id="c41">WebArena</td><td data-marble-id="c42">Zhou et al.</td><td data-marble-id="c43">ICLR</td><td data-marble-id="c44">2024</td><td data-marble-id="c45">To read</td></tr>
<tr data-marble-id="r5"><td data-marble-id="c51"></td><td data-marble-id="c52">—</td><td data-marble-id="c53">—</td><td data-marble-id="c54">—</td><td data-marble-id="c55">To read</td></tr>
</tbody></table>
</body></html>`;

const host = await startDrive({ scripts: {}, documents: { garden: GARDEN, papers: PAPERS } });
test.after(() => host.close());

const pages = [];
test.after(async () => { for (const page of pages.splice(0)) await page.close().catch(() => {}); });

const clearConversations = async () => {
  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  for (const summary of list) {
    await fetch(`${host.base}/agent/conversations/${summary.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
  }
};

const open = async (doc = 'garden') => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
  await host.reset();
  await clearConversations();
  const { page } = await host.newPage();
  pages.push(page);
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleNotes));
  return page;
};

const select = async (page, id) => {
  await page.evaluate((mid) => {
    const el = document.querySelector(`[data-marble-id="${mid}"]`);
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, id);
  await page.waitForFunction((mid) => window.marble.agent.context().selection.includes(mid), id);
};
const handle = (page) => page.locator('.marble-callout-handle:not([hidden])');
const offerInput = (page) => page.locator('.marble-callout[data-offer] .marble-offer-input');

const keep = async (page, id, text) => {
  await select(page, id);
  await handle(page).click();
  await offerInput(page).waitFor();
  await page.keyboard.type(text);
  await page.keyboard.press('Shift+Enter');
  await page.waitForFunction(() => !document.querySelector('.marble-callout[data-offer]'));
};

// A hand edit, as the document's own editable wiring files one.
const edit = (page, id, text) => page.evaluate(({ mid, words }) => {
  const el = document.querySelector(`[data-marble-id="${mid}"]`);
  el.textContent = words;
  window.marble.op({ type: 'setText', id: mid, text: words });
}, { mid: id, words: text });

test('⇧⏎ keeps the ask as a numbered pin, the count sits by the chat button, and notes last a reload', async () => {
  const page = await open();
  await keep(page, 'q1', 'Say it more plainly');
  const pin = page.locator('.marble-note-pin:not([hidden])');
  await pin.first().waitFor();
  assert.equal(await pin.first().textContent(), '1');
  // The card goes, so the next thing can be pointed at.
  await page.waitForFunction(() => document.querySelectorAll('.marble-callout').length === 0);
  await page.waitForTimeout(250); // the pin grows in from its corner
  const [li, dot] = await Promise.all([page.locator('[data-marble-id="q1"]').boundingBox(), pin.first().boundingBox()]);
  assert.ok(Math.abs(dot.y + 10 - li.y) < 4, 'the pin hangs at the thing\'s top corner');

  await keep(page, 'h', 'Shorter');
  await page.locator('.marble-notes-open', { hasText: '2 notes' }).waitFor();
  assert.equal(await pin.count(), 2);
  const [count, launcher] = await Promise.all([
    page.locator('.marble-notes-count').boundingBox(),
    page.locator('marble-agent-drawer').evaluate((el) => el.shadowRoot.querySelector('.launcher').getBoundingClientRect().toJSON()),
  ]);
  assert.ok(count.x + count.width <= launcher.x, 'beside the chat button, to its left');

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marbleNotes));
  await page.locator('.marble-notes-open', { hasText: '2 notes' }).waitFor();
  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  assert.equal(list.length, 0, 'nothing is sent until Send all');
});

test('Send all is one brief to one agent, each note with its thing, and the pins go', async () => {
  const page = await open();
  await keep(page, 'q1', 'Say it more plainly');
  await keep(page, 'p', 'Link it to the reading list');
  await page.locator('.marble-notes-open', { hasText: '2 notes' }).click();
  const list = page.locator('.marble-notes-list:not([hidden])');
  await list.waitFor();
  assert.equal(await list.locator('.marble-notes-row').count(), 2);
  await list.locator('.marble-notes-row').first().hover();
  await page.locator('.marble-note-soft:not([hidden])').waitFor({ state: 'attached' });
  await list.getByRole('button', { name: 'Send all' }).click();
  await page.waitForFunction(() => !document.querySelector('.marble-note-pin'));
  let convos = [];
  for (let i = 0; i < 50 && !convos.length; i += 1) {
    convos = await (await fetch(`${host.base}/agent/conversations`)).json();
    if (!convos.length) await page.waitForTimeout(100);
  }
  assert.equal(convos.length, 1, 'one agent');
  let turns = [];
  for (let i = 0; i < 50 && !turns.length; i += 1) {
    turns = (await (await fetch(`${host.base}/agent/conversations/${convos[0].id}`)).json()).turns ?? [];
    if (!turns.length) await page.waitForTimeout(100);
  }
  assert.equal(turns.length, 1, 'one brief');
  assert.match(turns[0].prompt, /^2 notes on this page/);
  assert.match(turns[0].prompt, /1\. Item · Why do people stop using … \(\[data-marble-id="q1"\]\): Say it more plainly/);
  assert.match(turns[0].prompt, /2\. .*\(\[data-marble-id="p"\]\): Link it to the reading list/);
  assert.deepEqual([...turns[0].context.selection].sort(), ['p', 'q1']);
  assert.equal(await page.evaluate(() => localStorage.getItem('marble-notes:garden')), null, 'sent notes are gone');
});

test('a row finished by hand among filled ones gets one quiet offer, which drafts and never sends', async () => {
  const page = await open('papers');
  await edit(page, 'c51', 'Tree of Thoughts');
  const chip = page.locator('.marble-nudge');
  await chip.waitFor({ timeout: 4000 });
  assert.equal(await chip.locator('.marble-nudge-go').innerText(), 'Fill Authors, Venue and Year');
  const [gap, box] = await Promise.all([page.locator('[data-marble-id="c52"]').boundingBox(), chip.boundingBox()]);
  assert.ok(Math.abs(box.x - (gap.x + 4)) < 3 && Math.abs(box.y + box.height / 2 - (gap.y + gap.height / 2)) < 3, 'it sits where the empty cells are');
  await chip.locator('.marble-nudge-go').click();
  await offerInput(page).waitFor();
  assert.equal(await offerInput(page).textContent(), 'Automate this row: fill Authors, Venue and Year from the title');
  assert.equal(await page.locator('.marble-offer-act[data-act="automate"]').getAttribute('aria-pressed'), 'true');
  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  assert.equal(list.length, 0, 'a suggestion drafts, it never sends');
});

test('the third same change to siblings offers the rest', async () => {
  const page = await open('papers');
  for (const id of ['c15', 'c25', 'c35']) {
    await edit(page, id, 'Read');
    await page.waitForTimeout(1700);
  }
  const chip = page.locator('.marble-nudge');
  await chip.waitFor({ timeout: 4000 });
  assert.equal(await chip.locator('.marble-nudge-go').innerText(), 'Do the other 2');
  await chip.locator('.marble-nudge-go').click();
  await offerInput(page).waitFor();
  assert.match(await offerInput(page).textContent(), /^Do the same to the other 2: set it to “Read”/);
  assert.deepEqual(await page.evaluate(() => window.marble.agent.context().selection), ['t']);
});

test('the chip goes on the next action, and a kind dismissed twice stops; the tray switch turns it off', async () => {
  const page = await open('papers');
  await edit(page, 'c51', 'Tree of Thoughts');
  const chip = page.locator('.marble-nudge:not(.is-out)');
  await chip.waitFor({ timeout: 4000 });
  await page.mouse.click(5, 5);
  await chip.waitFor({ state: 'detached' });

  await edit(page, 'c51', 'Chain of Thought');
  await chip.waitFor({ timeout: 4000 });
  await chip.getByRole('button', { name: 'Not now' }).click();
  await edit(page, 'c51', 'Constitutional AI');
  await chip.waitFor({ timeout: 4000 });
  await chip.getByRole('button', { name: 'Not now' }).click();
  await edit(page, 'c51', 'SWE-agent');
  await page.waitForTimeout(2200);
  assert.equal(await chip.count(), 0, 'dismissed twice: it stops on this document');

  await page.evaluate(() => localStorage.removeItem('marble-nudge:papers'));
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').hover();
  const offers = drawer.locator('.tool[data-tool="offers"]');
  await offers.waitFor();
  assert.equal(await offers.getAttribute('aria-pressed'), 'true');
  await offers.click();
  await edit(page, 'c51', 'Voyager 2');
  await page.waitForTimeout(2200);
  assert.equal(await chip.count(), 0, 'Offers after edits, off');
});
