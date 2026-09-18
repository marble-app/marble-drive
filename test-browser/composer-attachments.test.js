// What arrives through the clipboard, and what the composer remembers.
//
// A screenshot and a page of pasted log both have to leave the box you are
// typing in and still reach the agent; the model you last chose has to be the
// one the next conversation starts on.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import test from 'node:test';

import { startDrive } from './harness.js';

const host = await startDrive({ scripts: { note: [{ say: 'seen' }] } });
test.after(() => host.close());

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const LONG = Array.from({ length: 60 }, (_, n) => `line ${n + 1}: the quick brown fox jumps over the lazy dog`).join('\n');

/** A bare <marble-conversation>, the way conversation.test.js mounts one. */
async function mount(id = null, { reset = true } = {}) {
  if (reset) await host.reset();
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

const pasteText = (view, text) =>
  view.evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    const input = el.shadowRoot.querySelector('.editor');
    input.focus();
    return !input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);

const pasteImage = (view, base64) =>
  view.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    const input = el.shadowRoot.querySelector('.editor');
    input.focus();
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, base64);

/** The conversation exists a beat before its first turn does. */
const promptOf = async (conversationId) => {
  for (let n = 0; n < 60; n += 1) {
    const turns = await host.drive.agents.store.turns(conversationId);
    if (turns.length) return turns.at(-1).prompt ?? '';
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${conversationId} never recorded a turn`);
};

const sentFrom = async (page, view, typed) => {
  const started = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true });
  }));
  if (typed) await view.locator('.editor').fill(typed);
  // Enter rather than the button: the drawer sits over the same corner of the
  // page this test mounts the view in.
  await view.locator('.editor').press('Enter');
  return started;
};

test('a long paste becomes a card instead of filling the box', async () => {
  const { view, errors } = await mount();
  const swallowed = await pasteText(view, LONG);
  assert.equal(swallowed, true, 'the composer should take the paste');
  assert.equal(await view.locator('.editor').evaluate((el) => el.value), '');
  const card = view.locator('.attach[data-kind="text"]');
  await card.waitFor();
  assert.match(await card.textContent(), /Pasted text/);
  assert.match(await card.textContent(), /60 lines/);
  assert.deepEqual(errors, []);
});

test('a short paste is just typing', async () => {
  const { view } = await mount();
  const swallowed = await pasteText(view, 'a couple of words');
  assert.equal(swallowed, false, 'a short paste must reach the textarea');
  assert.equal(await view.locator('.attach').count(), 0);
});

test('opening a card shows the whole thing, and Escape puts it back', async () => {
  const { view } = await mount();
  await pasteText(view, LONG);
  await view.locator('.attach[data-kind="text"]').click();
  const body = view.locator('.peek-body');
  await body.waitFor();
  assert.match(await view.locator('.peek-title').textContent(), /60 lines/);
  assert.match(await body.textContent(), /line 60:/);
  await view.locator('.peek-close').press('Escape');
  await view.locator('.peek').waitFor({ state: 'hidden' });
});

test('taking a card off leaves nothing to send', async () => {
  const { view } = await mount();
  await pasteText(view, LONG);
  assert.equal(await view.locator('.send').isDisabled(), false);
  await view.locator('.attach-remove').click();
  assert.equal(await view.locator('.attach').count(), 0);
  assert.equal(await view.locator('.send').isDisabled(), true);
});

test('a sent paste travels as a tagged block and comes back as the same card', async () => {
  const { page, view, errors } = await mount();
  await pasteText(view, LONG);
  const id = await sentFrom(page, view, 'what is wrong with this log?');

  const prompt = await promptOf(id);
  assert.match(prompt, /^<pasted-text index="1" lines="60" chars="\d+">\n/);
  assert.match(prompt, /line 60: the quick brown fox[\s\S]*<\/pasted-text>/);
  assert.match(prompt, /what is wrong with this log\?$/);

  const card = view.locator('.msg.me .attach[data-kind="text"]');
  await card.waitFor();
  assert.match(await view.locator('.msg.me .msg-text').textContent(), /^what is wrong with this log\?$/);
  assert.doesNotMatch(await view.locator('.msg.me .msg-text').textContent(), /pasted-text/);
  assert.deepEqual(errors, []);
});

test('a pasted image becomes a file the agent is given the path to', async () => {
  const { page, view, errors } = await mount();
  await pasteImage(view, PNG);
  const shot = view.locator('.attach[data-kind="image"] .attach-shot');
  await shot.waitFor();
  assert.equal(await shot.evaluate((el) => el.src.startsWith('blob:')), true);

  const id = await sentFrom(page, view, 'what is in this?');
  const prompt = await promptOf(id);
  const path = /<pasted-image [^>]*path="([^"]+)"/.exec(prompt)?.[1];
  assert.ok(path, `expected a path in: ${prompt.slice(0, 200)}`);
  assert.match(path, /\.marble\/agents\/uploads\/[0-9a-f]{16}\.png$/);
  assert.equal((await fsp.readFile(path)).length, Buffer.from(PNG, 'base64').length);
  assert.match(prompt, /name="shot\.png"/);
  assert.deepEqual(errors, []);
});

test('the sent image is shown back from the host, not from the dead blob', async () => {
  const { page, view } = await mount();
  await pasteImage(view, PNG);
  await sentFrom(page, view, 'look');
  const src = await view.locator('.msg.me .attach-shot').getAttribute('src');
  assert.match(src, /^\/agent\/uploads\/[0-9a-f]{16}\.png$/);
  const response = await page.request.get(`${host.base}${src}`);
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['content-type'], 'image/png');
});

test('an upload route only answers for a name it minted', async () => {
  const { page } = await mount();
  const bad = await page.request.get(`${host.base}/agent/uploads/..%2F..%2Fsettings.json`);
  assert.equal(bad.ok(), false);
  const missing = await page.request.get(`${host.base}/agent/uploads/${'0'.repeat(16)}.png`);
  assert.equal(missing.status(), 404);
});

test('the model you last picked is the one the next conversation starts on', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="model"][value="alt"]').click({ force: true });
  await page.waitForFunction(async () => {
    const settings = await (await fetch('/agent/settings', { cache: 'no-store' })).json();
    return settings.models?.fake === 'alt';
  });

  const started = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  const meta = await host.drive.agents.store.conversation(started);
  assert.equal(meta.model, 'alt');

  // And a fresh composer opens on it rather than on "Default" — without a
  // reset in between, which is what puts the drive back to having no pick.
  const { view: next } = await mount(null, { reset: false });
  await next.locator('input[name="model"][value="alt"]').waitFor();
  assert.equal(await next.locator('input[name="model"][value="alt"]').isChecked(), true);
});
