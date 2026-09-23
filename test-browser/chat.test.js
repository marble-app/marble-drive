// The Chat app: a plain chatbot over the conversations Agents runs. Served
// from the same build a fresh drive is seeded with.

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChat } from '../server/seed.js';
import { startDrive } from './harness.js';

const SCRIPTS = {
  hello: [{ say: 'Hello **there**.\n\n- one\n- two' }],
  tools: [
    { tool: 'Read', input: { file_path: '/Users/x/notes/plan.md' } },
    { tool: 'Bash', input: { command: 'ls', description: 'List the folder' } },
    { say: 'Two steps later.' },
  ],
  slow: [{ sleep: 4000 }, { say: 'finally' }],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { Chat: await buildChat() } });
test.after(() => host.close());

async function openChat(options) {
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Chat`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleAgentUI));
  return { page, errors };
}

const send = async (page, words) => {
  await page.locator('.field textarea').fill(words);
  await page.locator('.field textarea').press('Enter');
};

test('a fresh chat greets, then sends, streams a reply and files itself in the sidebar', async () => {
  await host.reset();
  const { page, errors } = await openChat();
  assert.equal(await page.locator('.hello').isVisible(), true);
  assert.equal(await page.locator('.send').isDisabled(), true);

  await send(page, 'script:hello');
  await page.locator('.me', { hasText: 'script:hello' }).waitFor();
  await page.locator('.reply .md strong', { hasText: 'there' }).waitFor();
  assert.equal(await page.locator('.hello').isVisible(), false);
  assert.equal(await page.locator('.me').count(), 1, 'the drawn bubble is the one the host confirmed');
  assert.equal(await page.locator('.reply .md li').count(), 2);

  const id = await page.evaluate(() => location.hash.slice(1));
  assert.match(id, /^[0-9a-f]{12}$/);
  await page.locator(`.row[data-id="${id}"] .pick[aria-current="page"]`).waitFor();

  // The turn was sent as a chat, so the agent is told to answer, not edit.
  const { turns } = await (await fetch(`${host.base}/agent/conversations/${id}`)).json();
  assert.equal(turns[0].context.surface, 'chat');
  assert.equal(turns[0].context.target, 'Chat');
  assert.deepEqual(errors, []);
});

test('an idea fills the field, and the work between words folds into one line', async () => {
  await host.reset();
  const { page, errors } = await openChat();
  await page.locator('.idea').first().click();
  assert.equal(await page.locator('.field textarea').inputValue(), 'Explain an idea simply');
  assert.equal(await page.locator('.send').isDisabled(), false);

  await send(page, 'script:tools');
  await page.locator('.reply .md', { hasText: 'Two steps later.' }).waitFor();
  const work = page.locator('.work');
  assert.equal(await work.count(), 1);
  assert.equal(await work.getAttribute('data-state'), 'done');
  assert.equal((await work.locator('.work-label').textContent()).trim(), '2 steps');
  await work.locator('summary').click();
  assert.equal(await work.locator('.steps li').count(), 2);
  assert.match(await work.locator('.steps li').first().textContent(), /Read\s*plan\.md/);
  assert.deepEqual(errors, []);
});

test('a reply can be stopped, and a reload reads the chat back', async () => {
  await host.reset();
  const { page, errors } = await openChat();
  await send(page, 'script:slow');
  await page.locator('.send[data-mode="stop"]').waitFor();
  await page.locator('.dots').waitFor();
  await page.locator('.send').click();
  await page.locator('.note', { hasText: 'Stopped.' }).waitFor();
  assert.equal(await page.locator('.send').getAttribute('data-mode'), 'send');

  await page.reload();
  await page.locator('.me', { hasText: 'script:slow' }).waitFor();
  await page.locator('.note', { hasText: 'Stopped.' }).waitFor();
  assert.equal(await page.locator('.hello').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('the model menu sets what new chats start on, in the file', async () => {
  await host.reset();
  const { page, errors } = await openChat();
  await page.locator('.model:not([hidden])').waitFor();
  await page.locator('.model').click();
  await page.locator('#models button', { hasText: 'Alt' }).click();
  assert.equal(await page.locator('.model').textContent(), 'Alt');
  await page.waitForFunction(async () => (await (await fetch('/a/Chat', { cache: 'no-store' })).text()).includes('data-model="alt"'));
  assert.deepEqual(errors, []);
});

test('on a phone the list comes first and a chat is pushed in over it', async () => {
  await host.reset();
  const seed = await openChat();
  await send(seed.page, 'script:hello');
  await seed.page.locator('.reply .md strong').waitFor();
  const id = await seed.page.evaluate(() => location.hash.slice(1));

  const { page, errors } = await host.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.goto(`${host.base}/a/Chat`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  const row = page.locator(`.row[data-id="${id}"] .pick`);
  await row.waitFor();
  const offscreen = await page.locator('.room').evaluate((el) => el.getBoundingClientRect().left);
  assert.ok(offscreen >= 380, `the room waits off to the right (${offscreen})`);

  await row.tap();
  await page.waitForFunction(() => Math.abs(document.querySelector('.room').getBoundingClientRect().left) < 1);
  await page.locator('.reply .md strong', { hasText: 'there' }).waitFor();
  await page.locator('.back').tap();
  await page.waitForFunction(() => document.querySelector('.room').getBoundingClientRect().left >= 380);
  assert.deepEqual(errors, []);
});
