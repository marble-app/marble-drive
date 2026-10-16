// A PowerPoint let go over a conversation.
//
// It becomes a deck of the drive's own beside the page, the way a drop on the
// Drive does, and the message carries a chip that names it. What the agent is
// sent is where the deck is, so "make it shorter" has something to act on. A
// file the chat cannot carry is said no to by name, and the page stays put.

import assert from 'node:assert/strict';
import test from 'node:test';

import { makePptx } from '../test/fixtures/pptx.js';
import { startDrive } from './harness.js';

const host = await startDrive({ scripts: { note: [{ say: 'seen' }] } });
test.after(() => host.close());

async function mount() {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marble?.drive && customElements.get('marble-conversation')));
  await page.evaluate(() => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.style.cssText = 'position:fixed;right:0;top:0;width:460px;height:100vh;';
    document.body.append(el);
  });
  const view = page.locator('body > marble-conversation');
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  return { page, errors, view };
}

/** Files off the desktop, let go over the box you type in. */
const drop = (view, files) =>
  view.evaluate((el, list) => {
    const data = new DataTransfer();
    for (const { name, base64, type } of list) {
      data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type }));
    }
    const at = el.shadowRoot.querySelector('.editor');
    for (const type of ['dragenter', 'dragover', 'drop']) {
      at.dispatchEvent(new DragEvent(type, { bubbles: true, composed: true, cancelable: true, dataTransfer: data }));
    }
  }, files);

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const promptOf = async (conversationId) => {
  for (let n = 0; n < 60; n += 1) {
    const turns = await host.drive.agents.store.turns(conversationId);
    if (turns.length) return turns.at(-1).prompt ?? '';
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${conversationId} never recorded a turn`);
};

test('a PowerPoint dropped on the chat becomes a deck, and the agent is sent where it is', async () => {
  const { page, view, errors } = await mount();
  await drop(view, [{ name: 'Fixture.pptx', type: PPTX, base64: makePptx().toString('base64') }]);

  const chip = view.locator('.editor .ichip[data-kind="slides"]');
  await chip.waitFor();
  await page.waitForFunction(
    () => /Fixture · 3 slides/.test(document.querySelector('marble-conversation').shadowRoot.querySelector('.editor .ichip[data-kind="slides"]')?.textContent ?? ''),
  );
  assert.ok(await host.drive.store.has('Fixture'), 'the deck is a document beside the page');
  assert.equal(await host.drive.store.hasFile('Fixture.pptx'), false, 'the PowerPoint went to the Trash');
  assert.equal(await view.locator('.editor').evaluate((el) => el.value), '[slides 1] ');

  const started = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true });
  }));
  const editor = view.locator('.editor');
  await editor.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = el.getRootNode().getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await editor.pressSequentially('make it shorter');
  await editor.press('Enter');
  const prompt = await promptOf(await started);
  assert.equal(
    prompt,
    '<pasted-slides index="1" name="Fixture" path="Fixture" slides="3" from="Fixture.pptx" url="/a/Fixture"></pasted-slides>\n\n[slides 1] make it shorter',
  );

  // The sent message shows the same chip, not the markup.
  const sent = view.locator('.msg.me .ichip[data-kind="slides"]');
  await sent.waitFor();
  assert.match(await sent.textContent(), /Fixture · 3 slides/);
  assert.doesNotMatch(await view.locator('.msg.me').textContent(), /pasted-slides|\[slides/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a file the chat cannot carry is named, and the page stays where it was', async () => {
  const { page, view } = await mount();
  const before = page.url();
  await drop(view, [{ name: 'notes.zip', type: 'application/zip', base64: Buffer.from('PK').toString('base64') }]);
  await view.locator('.system.error').waitFor();
  assert.match(await view.locator('.system.error').last().textContent(), /notes\.zip can’t go in a message\. Pictures and PowerPoint decks can\./);
  assert.equal(page.url(), before);
  assert.equal(await view.locator('.ichip[data-key]').count(), 0);
  await page.close();
});

test('a PowerPoint that cannot be read takes its chip back and says where the file is', async () => {
  const { page, view } = await mount();
  await drop(view, [{ name: 'Broken.pptx', type: PPTX, base64: Buffer.from('not a zip').toString('base64') }]);
  await view.locator('.system.error').waitFor();
  assert.match(await view.locator('.system.error').last().textContent(), /Couldn’t make slides from Broken\.pptx: not a zip file\. It is in the drive as Broken\.pptx\./);
  assert.equal(await view.locator('.ichip[data-key]').count(), 0);
  assert.ok(await host.drive.store.hasFile('Broken.pptx'));
  await page.close();
});
