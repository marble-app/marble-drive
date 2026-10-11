import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// A long chat opens on its last few turns and fills in upward as it is read;
// a chat this tab has had open draws from its own copy before the host
// answers. Neither may show anything a chat drawn whole would not.

const host = await startDrive({ documents: { garden: GARDEN } });
test.after(() => host.close());
const store = () => host.drive.agents.store;
/** An event as the runner writes one: kept, then told to whoever is watching. */
const emit = async (id, event) => {
  const stored = await store().appendEvent(id, event);
  host.drive.agents.hub.publish(id, stored, await store().summary(id));
  return stored;
};

/** A finished conversation of `n` turns, written straight to the store. */
async function chat(n, { words = 'answer' } = {}) {
  const { id } = await store().createConversation({ provider: 'fake' });
  for (let i = 1; i <= n; i += 1) await turn(id, i, words);
  return id;
}
async function turn(id, i, words = 'answer') {
  const t = `${id}-t${i}`;
  const s = { appendEvent: emit };
  await s.appendEvent(id, { type: 'user', turn: t, text: `ask ${i}`, context: { target: 'garden' } });
  await s.appendEvent(id, { type: 'turn.started', turn: t });
  await s.appendEvent(id, { type: 'tool.call', turn: t, callId: `c${i}`, name: 'Read', input: { file_path: `/x/${i}.md` } });
  await s.appendEvent(id, { type: 'tool.result', turn: t, callId: `c${i}`, ok: true, summary: 'read' });
  await s.appendEvent(id, { type: 'text', turn: t, text: `${words} ${i}\n\n${'A line to give the turn some height. '.repeat(90)}` });
  await s.appendEvent(id, { type: 'turn.completed', turn: t });
}

async function mount(page, id) {
  await page.evaluate((cid) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.setAttribute('conversation', cid);
    el.style.cssText = 'position:fixed;right:0;top:0;width:440px;height:100vh;';
    document.body.append(el);
  }, id);
  return page.locator('body > marble-conversation');
}
const rows = (view) => view.locator('.log').evaluate((log) => [...log.children]
  .filter((el) => !el.classList.contains('earlier'))
  .map((el) => `${el.className}|${el.dataset.state ?? ''}|${'old' in el.dataset}|${el.textContent.replace(/\s+/g, ' ').trim()}`));
const said = (view) => view.locator('.msg.me').allTextContents();

async function open({ detail = 'simple' } = {}) {
  const { page, errors } = await host.newPage({ detail });
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  return { page, errors };
}

/** The same chat drawn whole, the way it was before any of this. */
async function whole(id, detail) {
  const { page } = await open({ detail });
  await page.evaluate(() => {
    const real = window.marble.agent.conversation;
    window.marble.agent.conversation = (cid) => real(cid);
  });
  const view = await mount(page, id);
  await view.locator('.msg.me').first().waitFor();
  await page.waitForTimeout(200);
  const out = await rows(view);
  await page.context().close();
  return out;
}

for (const detail of ['simple', 'technical']) {
  test(`${detail}: a long chat opens on its last turns, and scrolling up brings the rest, in place`, async () => {
    const id = await chat(12);
    const { page, errors } = await open({ detail });
    const view = await mount(page, id);
    await view.locator('.msg.me').first().waitFor();
    assert.deepEqual(await said(view), ['ask 10', 'ask 11', 'ask 12']);
    const earlier = view.locator('.earlier');
    assert.equal(await earlier.textContent(), 'Show earlier messages');
    // It opens at the foot, as a chat always has.
    assert.ok(await view.locator('.log').evaluate((log) => log.scrollHeight - log.scrollTop - log.clientHeight < 48));

    // Scrolled toward the top, the turns above arrive; whatever the reader was
    // looking at stays where it was on screen.
    const anchor = view.locator('.msg.me', { hasText: 'ask 10' });
    await view.locator('.log').evaluate((log) => { log.scrollTop = 0; });
    const top = await anchor.evaluate((el) => el.getBoundingClientRect().top);
    await page.waitForFunction((el) => el.shadowRoot.querySelectorAll('.msg.me').length > 3, await view.elementHandle());
    await page.waitForTimeout(100);
    assert.ok(Math.abs((await anchor.evaluate((el) => el.getBoundingClientRect().top)) - top) < 2, 'the reader keeps their place');

    // All the way up, the log is the one a whole read would have drawn.
    await page.waitForFunction((el) => {
      const log = el.shadowRoot.querySelector('.log');
      log.scrollTop = 0;
      return !log.querySelector('.earlier');
    }, await view.elementHandle(), { polling: 100, timeout: 10_000 });
    assert.equal((await said(view)).length, 12);
    assert.deepEqual(await rows(view), await whole(id, detail));
    assert.deepEqual(errors, []);
    await page.context().close();
  });
}

test('the button fetches the turns above for a reader who clicks rather than scrolls', async () => {
  const id = await chat(6);
  const { page } = await open();
  // A tall pane with the watcher out of the way: only the button can do it.
  await page.addInitScript(() => { window.IntersectionObserver = class { observe() {} disconnect() {} }; });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  const view = await mount(page, id);
  await view.locator('.msg.me').first().waitFor();
  assert.equal((await said(view)).length, 3);
  await view.locator('.earlier').click();
  await page.waitForFunction((el) => el.shadowRoot.querySelectorAll('.msg.me').length === 6, await view.elementHandle());
  assert.equal(await view.locator('.earlier').count(), 0);
  await page.context().close();
});

test('news of a turn above the drawn part waits for that turn, instead of landing at the foot', async () => {
  const id = await chat(6);
  const { page, errors } = await open({ detail: 'technical' });
  const view = await mount(page, id);
  await view.locator('.msg.me').first().waitFor();
  await emit(id, { type: 'turn.undone', turn: `${id}-t2`, reverted: 2, kept: 0 });
  await page.waitForTimeout(500);
  assert.equal(await view.locator('.undone').count(), 0);
  assert.equal(await view.locator('.log > :last-child').getAttribute('class'), 'turn-footer');
  await page.waitForFunction((el) => {
    const log = el.shadowRoot.querySelector('.log');
    log.scrollTop = 0;
    return !log.querySelector('.earlier');
  }, await view.elementHandle(), { polling: 100, timeout: 10_000 });
  assert.equal(await view.locator('.undone').count(), 1);
  const footer = view.locator('.turn-footer').nth(1);
  assert.match(await footer.textContent(), /Undid 2/);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('news of an earlier turn that lands while that turn is being fetched is not lost', async () => {
  const id = await chat(6);
  const { page, errors } = await open({ detail: 'technical' });
  const view = await mount(page, id);
  await view.locator('.msg.me').first().waitFor();
  // The fetch for the turns above is answered, and only then does the undo
  // land: the answer does not carry it, and the stream said it too early.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(/before=/, async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await view.locator('.log').evaluate((log) => { log.scrollTop = 0; });
  await page.waitForTimeout(200);
  await emit(id, { type: 'turn.undone', turn: `${id}-t2`, reverted: 2, kept: 0 });
  await page.waitForTimeout(300);
  release();
  await page.waitForFunction((el) => el.shadowRoot.querySelectorAll('.msg.me').length === 6, await view.elementHandle());
  await view.locator('.undone').waitFor();
  assert.equal(await view.locator('.undone').count(), 1);
  assert.match(await view.locator('.turn-footer').nth(1).textContent(), /Undid 2/);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('a chat this tab has had open draws from its copy before the host answers, then catches up', async () => {
  const id = await chat(4);
  const { page, errors } = await open();
  let view = await mount(page, id);
  await view.locator('.msg.me').first().waitFor();
  // Leaving is when the copy is kept.
  await page.evaluate(() => document.querySelector('body > marble-conversation').remove());
  await turn(id, 5, 'later');

  // The host is slow to answer; the chat is on screen anyway.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(/\/agent\/conversations\/[0-9a-f]{12}(\?|$)/, async (route) => { await held; await route.continue(); });
  view = await mount(page, id);
  await view.locator('.msg.me').first().waitFor({ timeout: 2000 });
  assert.deepEqual(await said(view), ['ask 2', 'ask 3', 'ask 4']);
  assert.equal(await view.locator('.heading').textContent(), 'ask 1', 'the title comes with the copy');
  release();
  await view.locator('.msg.me', { hasText: 'ask 5' }).waitFor();
  assert.deepEqual(await said(view), ['ask 2', 'ask 3', 'ask 4', 'ask 5']);
  await page.unroute(/\/agent\/conversations\//);

  // Caught up is the same as fresh: all the way up, the whole chat.
  await page.waitForFunction((el) => {
    const log = el.shadowRoot.querySelector('.log');
    log.scrollTop = 0;
    return !log.querySelector('.earlier');
  }, await view.elementHandle(), { polling: 100, timeout: 10_000 });
  assert.deepEqual(await rows(view), await whole(id, 'simple'));

  // And live events keep landing after a start from the copy.
  await turn(id, 6, 'live');
  await view.locator('.msg.me', { hasText: 'ask 6' }).waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('a copy of a chat the host no longer has is taken down', async () => {
  const { id } = await store().createConversation({ provider: 'fake' });
  const { page } = await open();
  await page.evaluate((cid) => sessionStorage.setItem(`marble-chat-tail:${cid}`, JSON.stringify({
    v: 1, meta: { id: cid, title: 'Ghost' }, seq: 3, earlier: null, older: [],
    events: [{ seq: 1, t: 1, type: 'user', turn: `${cid}-t1`, text: 'a ghost prompt' }],
  })), id);
  await store().discardConversation(id);
  const view = await mount(page, id);
  await view.locator('.system.error').waitFor();
  assert.equal(await view.locator('.msg.me').count(), 0);
  assert.equal(await page.evaluate((cid) => sessionStorage.getItem(`marble-chat-tail:${cid}`), id), null);
  await page.context().close();
});
