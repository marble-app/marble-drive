// The gallery, and the brief.
//
// Two claims are under test and they are the same claim twice: that a template
// can be told apart without being read, and that picking one is the start of
// saying what you want rather than the end of choosing.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({
  documents: {
    drive: await buildDrive(),
    garden: GARDEN,
  },
});
test.after(() => host.close());

async function openTemplates() {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.locator('#items .item[data-path="garden"]').waitFor();
  await page.locator('#nav .nav-item[data-nav="templates"]').click();
  await page.locator('#items .tgrid .tcard[data-id="board"]').waitFor();
  return { page, errors };
}

// A preview frame is a document with an empty sandbox, so Chromium says so on
// every one of them. It is the point of the feature, not a fault in it.
const real = (errors) => errors.filter((message) => !/sandbox/i.test(message));

test('the gallery shows nine documents, not nine descriptions', async () => {
  const { page, errors } = await openTemplates();
  const cards = page.locator('#items .tgrid .tcard');
  assert.equal(await cards.count(), 9);
  assert.deepEqual(
    await cards.evaluateAll((els) => els.map((el) => el.dataset.id)),
    ['doc', 'note', 'chat', 'sheet', 'board', 'canvas', 'slides', 'paper', 'latex'],
  );

  // Each card is a picture of its own starter.
  assert.match(
    await page.locator('.tcard[data-id="sheet"] .tpeek iframe').getAttribute('src'),
    /\/drive\/starters\/sheet\/preview$/,
  );
  // And the picture is really the document: the frame loads and is shown.
  await page.locator('.tcard[data-id="sheet"] .tpeek.marble-is-loaded').waitFor();

  // Nothing on the card has to be read but the name.
  assert.equal((await page.locator('.tcard[data-id="sheet"]').innerText()).trim(), 'Sheet');

  // Eight colours over nine templates — paper and latex are one family and say so.
  const accents = await cards.evaluateAll((els) => els.map((el) => el.dataset.accent));
  assert.equal(new Set(accents).size, 8);
  assert.deepEqual([accents[7], accents[8]], [accents[8], accents[7]]);

  assert.deepEqual(real(errors), []);
});

test('picking a template opens a brief rather than a prompt()', async () => {
  const { page } = await openTemplates();
  // A window.prompt would hang the click; if one opens, this test times out.
  page.on('dialog', (dialog) => dialog.dismiss());

  await page.locator('.tcard[data-id="board"]').click();
  await page.locator('#start[data-open="1"]').waitFor();

  assert.equal(await page.locator('#start-title').innerText(), 'Board');
  assert.match(await page.locator('#start-blurb').innerText(), /Columns of cards/);
  assert.equal(await page.locator('#start-name').inputValue(), 'Board');
  assert.equal(await page.locator('#start-ideas button').count(), 3);
  assert.match(await page.locator('#start-where').innerText(), /My Drive/);
  assert.equal((await page.locator('#start-go').innerText()).trim(), 'Create');

  // The panel grows out of the card that was pressed.
  const origin = await page.locator('#start').evaluate((el) => getComputedStyle(el).transformOrigin);
  assert.ok(!/^\s*0px 0px/.test(origin), `anchored, not at a corner: ${origin}`);

  await page.keyboard.press('Escape');
  await page.locator('#start:not([data-open])').waitFor();
});

test('an idea fills the field, and the button says which thing it will do', async () => {
  const { page } = await openTemplates();
  await page.locator('.tcard[data-id="board"]').click();
  await page.locator('#start[data-open="1"]').waitFor();

  await page.locator('#start-ideas button').first().click();
  assert.ok((await page.locator('#start-prompt').inputValue()).length > 10);
  assert.equal((await page.locator('#start-go').innerText()).trim(), 'Create & build');

  await page.locator('#start-prompt').fill('');
  assert.equal((await page.locator('#start-go').innerText()).trim(), 'Create');
});

test('an empty brief is the clone it always was', async () => {
  const { page } = await openTemplates();
  await page.locator('.tcard[data-id="sheet"]').click();
  await page.locator('#start[data-open="1"]').waitFor();
  await page.locator('#start-name').fill('Readings');
  await page.locator('#start-go').click();

  await page.waitForURL(/\/a\/Readings$/);
  assert.equal(await page.locator('h1').first().innerText(), 'Readings');

  const list = await (await fetch(`${host.base}/agent/conversations`)).json();
  assert.equal(list.length, 0, 'nobody was briefed');
});

test('Enter in the name commits without reaching for the button', async () => {
  const { page } = await openTemplates();
  await page.locator('.tcard[data-id="note"]').click();
  await page.locator('#start[data-open="1"]').waitFor();
  await page.locator('#start-name').fill('Scraps');
  await page.locator('#start-name').press('Enter');
  await page.waitForURL(/\/a\/Scraps$/);
});

test('a brief makes the document, briefs an agent at it, and lands on the chat', async () => {
  const { page } = await openTemplates();
  await page.locator('.tcard[data-id="board"]').click();
  await page.locator('#start[data-open="1"]').waitFor();
  await page.locator('#start-name').fill('Sprint');
  await page.locator('#start-prompt').fill('columns for triage, doing and shipped');
  await page.locator('#start-go').click();

  await page.waitForURL(/\/a\/Sprint#chat=/);
  const conversation = new URL(page.url()).hash.replace('#chat=', '');

  const detail = await (await fetch(`${host.base}/agent/conversations/${conversation}`)).json();
  const turn = detail.turns.at(-1);
  assert.equal(turn.context.target, 'Sprint');
  assert.match(turn.prompt, /columns for triage, doing and shipped/);
  assert.match(turn.prompt, /Board/);
  assert.match(turn.prompt, /fresh clone/);

  // And the document you land on has that conversation open in it.
  await page.waitForFunction(
    (want) => document.querySelector('marble-agent-drawer')?.shadowRoot
      ?.querySelector('marble-conversation')?.getAttribute('conversation') === want,
    conversation,
  );
});

test('the New popover offers the same cards, two at a time', async () => {
  const { page } = await openTemplates();
  await page.locator('#nav .nav-item[data-nav="drive"]').click();
  await page.locator('#new').click();
  await page.locator('#sheet[data-open="1"] .tgrid[data-compact] .tcard').first().waitFor();
  assert.equal(await page.locator('#sheet .tcard').count(), 9);

  // And the way out of the menu into the room it is a corner of.
  assert.equal((await page.locator('#all-templates').innerText()).trim(), 'All templates');

  await page.locator('#sheet .tcard[data-id="canvas"]').click();
  await page.locator('#start[data-open="1"]').waitFor();
  assert.equal(await page.locator('#start-title').innerText(), 'Canvas');
  // Picking one closes the menu it was picked from: two layers of chooser over
  // one choice is one too many.
  assert.equal(await page.locator('#sheet').getAttribute('data-open'), null);
});

test('a brief made in a folder lands in that folder, and says so first', async () => {
  await host.drive.store.mkdir('Work');
  const { page } = await openTemplates();
  // Into the folder by its address rather than by clicking it: a folder with
  // nothing in it is filed under the materials fold, which is the listing's
  // business and not this test's.
  await page.goto(`${host.base}/a/drive#/Work`);
  await page.locator('#crumbs').waitFor();
  await page.waitForFunction(() => location.hash === '#/Work');

  await page.locator('#new').click();
  await page.locator('#sheet .tcard[data-id="slides"]').click();
  await page.locator('#start[data-open="1"]').waitFor();
  assert.match(await page.locator('#start-where').innerText(), /into Work/);

  await page.locator('#start-name').fill('Kickoff');
  await page.locator('#start-go').click();
  await page.waitForURL(/\/a\/Work%2FKickoff$/);
});
