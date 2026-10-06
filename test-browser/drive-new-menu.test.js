// The New menu opens ready to type: a message box, then the three apps a
// sentence can go to (Chat, Agent, Board), then the templates. Chat and Board
// are handed the words in the address, as #ask=<words>; an Agent conversation
// is started here and opened on the Agents page by ?open=<id>.
// The Drive's own bars, as a phone or a page without the shell has them:
// on a desk the shell frames the Drive and these are its (shell-drive-frame).

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({ documents: { drive: await buildDrive(), garden: GARDEN } });
test.after(() => host.close());

async function openMenu(page) {
  if (!page.url().endsWith('/a/drive')) {
    await page.goto(`${host.base}/a/drive`);
    await page.locator('#items .item[data-path="garden"]').waitFor();
  }
  await page.locator('#new').click();
  await page.locator('#sheet[data-open="1"]').waitFor();
  await page.locator('#starters .tcard').first().waitFor();
}

const pressed = (page) => page.locator('.sheet-app[aria-pressed="true"] b').textContent();

test('New opens on a focused message box, the three apps, then the templates', async () => {
  const { page, errors } = await host.newPage({ shell: false });
  await openMenu(page);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'ask');
  assert.deepEqual(await page.locator('#sheet .sheet-h').allTextContents(), ['Prompt in', 'Start from a template']);
  assert.deepEqual(await page.locator('.sheet-app b').allTextContents(), ['Chat', 'Agent', 'Board']);
  assert.equal(await pressed(page), 'Chat');
  // Send waits for words.
  assert.equal(await page.locator('#ask-send').isDisabled(), true);
  await page.keyboard.type('a habit tracker');
  assert.equal(await page.locator('#ask-send').isDisabled(), false);
  // Escape from the field closes the menu.
  await page.keyboard.press('Escape');
  await page.locator('#sheet[data-open="1"]').waitFor({ state: 'detached' });
  assert.deepEqual(errors.filter((e) => !e.includes('sandboxed')), []);
  await page.context().close();
});

test('Enter sends the words to Chat in the address, in this tab', async () => {
  const { page } = await host.newPage({ shell: false });
  await openMenu(page);
  await page.keyboard.type('a habit tracker');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/a\/Chat#ask=/);
  assert.equal(new URL(page.url()).hash, '#ask=' + encodeURIComponent('a habit tracker'));
  await page.context().close();
});

test('a tile with nothing typed opens its app, and is remembered for Enter', async () => {
  const { page } = await host.newPage({ shell: false });
  await openMenu(page);
  await page.locator('.sheet-app[data-name="Board"]').click();
  await page.waitForURL((url) => url.pathname === '/a/Board');
  assert.equal(new URL(page.url()).hash, '');

  await openMenu(page);
  assert.equal(await pressed(page), 'Board');
  await page.keyboard.type('sketch a kanban');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/a\/Board#ask=/);
  assert.equal(decodeURIComponent(new URL(page.url()).hash), '#ask=sketch a kanban');

  // Chat with an empty box is a fresh chat.
  await openMenu(page);
  await page.locator('.sheet-app[data-name="Chat"]').click();
  await page.waitForURL(/\/a\/Chat#new$/);
  await page.context().close();
});

test('Cmd-click opens the app in a new tab and leaves the Drive where it is', async () => {
  const { page } = await host.newPage({ shell: false });
  await openMenu(page);
  await page.keyboard.type('two words');
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.locator('.sheet-app[data-name="Chat"]').click({ modifiers: ['Meta'] }),
  ]);
  assert.match(popup.url(), /\/a\/Chat#ask=two%20words$/);
  assert.equal(page.url(), `${host.base}/a/drive`);
  await page.context().close();
});

test('Agent starts the conversation here and opens it on the Agents page', async () => {
  const { page } = await host.newPage({ shell: false });
  await openMenu(page);
  await page.keyboard.type('build me a timer');
  await page.locator('.sheet-app[data-name="Agent"]').click();
  await page.waitForURL(/\/a\/Agents\?open=[0-9a-f]+/);
  const id = new URL(page.url()).searchParams.get('open');
  // The words went as that conversation's first turn.
  const turns = await host.drive.agents.store.turns(id);
  assert.equal(turns[0]?.prompt, 'build me a timer');
  await page.context().close();
});
