// Following an agent: your view tied to one conversation's work.
//
// The tether rides `zone` frames, which the host publishes to a conversation
// for every look its agent takes (server/agent/index.js). The tests stub the
// carrier's stream and post those frames by hand, which is what the server
// does over the wire.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const DEEP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Deep</title>
<style>
  body { font: 16px/1.6 Georgia, serif; margin: 40px; }
  .spacer { height: 2600px; }
</style>
</head>
<body data-marble-id="b">
  <p data-marble-id="top">The top of the page.</p>
  <div class="spacer" data-marble-id="spacer"></div>
  <p data-marble-id="deep">Where the agent is working.</p>
  <div class="spacer" data-marble-id="spacer2"></div>
  <p data-marble-id="deeper">And then further down.</p>
</body></html>
`;

const host = await startDrive({ agents: true, documents: { deep: DEEP, garden: GARDEN } });
test.after(() => host.close());

const CHAT = 'abcdef123456';

/** A page with the conversation stream stubbed, and a hand on the frames. */
const open = async (path = 'deep') => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${path}`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  await page.evaluate(() => {
    window.__off = 0;
    window.marble.agent.on = (id, fn) => {
      window.__emit = (frame) => fn(frame);
      return () => { window.__off += 1; };
    };
    window.marble.agent.conversation = async () => ({ title: 'Sort the table' });
  });
  return { page, errors };
};

const tie = (page, id = CHAT) => page.evaluate((chat) => {
  dispatchEvent(new CustomEvent('marble:follow', { detail: { id: chat } }));
}, id);

const zone = (page, frame) => page.evaluate((f) => window.__emit({ type: 'zone', ...f }), frame);

const pill = (page) => page.locator('.marble-follow');

test('a tether says who you are following and what they are doing, and goes to the work', async () => {
  const { page, errors } = await open();
  await tie(page);
  assert.equal(await pill(page).count(), 1);
  await zone(page, { path: 'deep', ids: ['deep'], phase: 'writing', note: 'Rewrite the list.' });

  await page.waitForFunction(() => scrollY > 400, null, { timeout: 4000 });
  assert.match(await pill(page).innerText(), /Following Sort the table · rewrite the list/);
  assert.equal(await pill(page).getAttribute('data-state'), 'live');
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('work already in front of you is left where it is', async () => {
  const { page } = await open();
  await tie(page);
  await zone(page, { path: 'deep', ids: ['top'], phase: 'reading' });
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => scrollY), 0, 'the band is comfortable; nothing to do');
});

test('your scroll wins: a hand on the wheel pauses the tether, and Catch up rejoins', async () => {
  const { page } = await open();
  await tie(page);
  await page.mouse.wheel(0, 240);
  await page.waitForFunction(
    () => document.querySelector('.marble-follow')?.dataset.state === 'paused',
    null,
    { timeout: 4000 },
  );
  assert.match(await pill(page).innerText(), /paused/);

  const at = await page.evaluate(() => scrollY);
  await zone(page, { path: 'deep', ids: ['deeper'], phase: 'writing' });
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => scrollY), at, 'a paused tether does not pull');

  await pill(page).getByRole('button', { name: 'Catch up with the agent' }).click();
  await page.waitForFunction(() => scrollY > 2000, null, { timeout: 4000 });
});

test('the tether crosses documents, and survives the navigation', async () => {
  const { page } = await open();
  await tie(page);
  await zone(page, { path: 'garden', ids: ['q2'], phase: 'writing', note: 'Answer the question.' });
  await page.waitForURL(/\/a\/garden/, { timeout: 5000 });
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  assert.equal(await pill(page).count(), 1, 'still tied on the other side');
  assert.match(await pill(page).innerText(), /Following/);
  // The hash was an instruction, not an address.
  assert.equal(await page.evaluate(() => location.hash), '');
});

test('it never takes you out from under your own hands; it offers instead', async () => {
  const { page } = await open();
  await tie(page);
  await page.evaluate(() => {
    const el = document.querySelector('[data-marble-id="top"]');
    el.setAttribute('contenteditable', 'true');
    el.focus();
  });
  await zone(page, { path: 'garden', ids: ['q2'], phase: 'writing' });
  await page.waitForTimeout(600);
  assert.match(await page.url(), /\/a\/deep/, 'still here: someone is mid-sentence');
  assert.equal(await pill(page).getAttribute('data-state'), 'moved');
  assert.match(await pill(page).innerText(), /moved to garden/);

  await pill(page).getByRole('button', { name: 'Follow the agent to garden' }).click();
  await page.waitForURL(/\/a\/garden/, { timeout: 5000 });
});

test('an agent that comes back spends the offer to follow it away', async () => {
  const { page } = await open();
  await tie(page);
  await page.evaluate(() => {
    const el = document.querySelector('[data-marble-id="top"]');
    el.setAttribute('contenteditable', 'true');
    el.focus();
  });
  await zone(page, { path: 'garden', ids: ['q2'], phase: 'writing' });
  await page.waitForFunction(
    () => document.querySelector('.marble-follow')?.dataset.state === 'moved',
    null,
    { timeout: 4000 },
  );
  // Back here, and the turn ends: no ids, and nowhere else to be.
  await zone(page, { path: 'deep', ids: [], phase: 'working' });
  await page.waitForFunction(
    () => document.querySelector('.marble-follow')?.dataset.state === 'waiting',
    null,
    { timeout: 4000 },
  );
  assert.match(await pill(page).innerText(), /waiting/);
});

test('the tether sits over the page, not under the dock', async () => {
  const { page } = await open();
  await tie(page);
  const centred = await page.evaluate(() => {
    const pill = document.querySelector('.marble-follow');
    return Math.round(parseFloat(pill.style.left)) === Math.round(innerWidth / 2);
  });
  assert.equal(centred, true);

  // What a pinned panel does to the page: it takes its width out of <html>.
  await page.evaluate(() => { document.documentElement.style.marginInlineEnd = '400px'; });
  await page.waitForFunction(
    () => Math.round(parseFloat(document.querySelector('.marble-follow').style.left))
      === Math.round((innerWidth - 400) / 2),
    null,
    { timeout: 4000 },
  );
});

test('Stop unties it, here and on the next page', async () => {
  const { page } = await open();
  await tie(page);
  await pill(page).getByRole('button', { name: 'Stop following this agent' }).click();
  assert.equal(await pill(page).count(), 0);
  assert.equal(await page.evaluate(() => window.__off), 1, 'the stream is let go');

  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  assert.equal(await pill(page).count(), 0);
});

test('Escape leaves following the way it leaves every other mode', async () => {
  const { page } = await open();
  await tie(page);
  await page.keyboard.press('Escape');
  assert.equal(await pill(page).count(), 0);
});
