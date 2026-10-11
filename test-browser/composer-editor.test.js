// The box you type into: a list when you ask for one, and a value that reads
// back as the Markdown the agent will get.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const host = await startDrive({ scripts: { note: [{ say: 'seen' }] } });
test.after(() => host.close());

async function mount(id = null) {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate((conversation) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    if (conversation) el.setAttribute('conversation', conversation);
    el.style.cssText = 'position:fixed;right:0;top:0;width:460px;height:100vh;';
    document.body.append(el);
  }, id);
  const view = page.locator('body > marble-conversation');
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  return { page, errors, view };
}

const valueOf = (view) => view.locator('.editor').evaluate((el) => el.value);

test('the editor is a contenteditable box with the old placeholder', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  assert.equal(await editor.getAttribute('contenteditable'), 'true');
  assert.equal(await editor.getAttribute('role'), 'textbox');
  assert.equal(await view.locator('textarea').count(), 0);
  assert.equal(await editor.getAttribute('data-placeholder'), 'Ask about this document…');
});

test('dash space starts a bullet list, and Shift+Enter continues it', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('- first');
  assert.equal(await editor.locator('ul > li').count(), 1);
  await editor.press('Shift+Enter');
  await editor.pressSequentially('second');
  assert.equal(await editor.locator('ul > li').count(), 2);
  assert.equal(await valueOf(view), '- first\n- second');
});

test('Shift+Enter on an empty item leaves the list; Backspace on an empty first item undoes it', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('- one');
  await editor.press('Shift+Enter');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('after');
  assert.equal(await editor.locator('li').count(), 1);
  assert.equal(await valueOf(view), '- one\nafter');

  await editor.fill('');
  await editor.pressSequentially('- ');
  assert.equal(await editor.locator('li').count(), 1);
  await editor.press('Backspace');
  assert.equal(await editor.locator('li').count(), 0);
  assert.equal(await valueOf(view), '');
});

test('1. space starts a numbered list', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('1. alpha');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('beta');
  assert.equal(await editor.locator('ol > li').count(), 2);
  assert.equal(await valueOf(view), '1. alpha\n2. beta');
});

test('Shift+Enter outside a list is a newline, and value round-trips lists', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('a');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('b');
  assert.equal(await valueOf(view), 'a\nb');
  await editor.evaluate((el) => { el.value = 'x\n- p\n- q\ny'; });
  assert.equal(await editor.locator('ul > li').count(), 2);
  assert.equal(await valueOf(view), 'x\n- p\n- q\ny');
});

test('a sent list arrives as Markdown and reads back as a list', async () => {
  const { page, view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('script:note');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('- do this');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('then that');
  const started = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true });
  }));
  await editor.press('Enter');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const turns = await host.drive.agents.store.turns(id);
  assert.match(turns[0].prompt, /^script:note\n- do this\n- then that/);
  assert.equal(await view.locator('.msg.me li').count(), 2);
  assert.equal(await valueOf(view), '');
});

test('the document travels without a pill in the text, and the selection can be dropped', async () => {
  const { page, view } = await mount();
  // Nothing in the message but the message.
  assert.equal(await view.locator('.editor .ichip').count(), 0);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  const pill = view.locator('.bar .selection');
  await pill.filter({ hasText: '1 selected' }).waitFor();
  await pill.locator('.selection-clear').click();
  await view.locator('.editor').pressSequentially('script:note');
  const started = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true });
  }));
  await view.locator('.editor').press('Enter');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const user = (await host.drive.agents.store.events(id)).find((e) => e.type === 'user');
  // The document still travels — a turn cannot exist without one — and only
  // the selection was dropped. That is the whole of what the pill decided.
  assert.equal(user.context.target, 'garden');
  assert.deepEqual(user.context.selection, []);
  // And the message itself carried no pill text into the prompt.
  const turns = await host.drive.agents.store.turns(id);
  assert.match(turns[0].prompt, /^script:note/);
});
