// What the person sees while an agent operates their app.
//
// The frames here are the ones the `act` tool will send — presence with a
// third phase — so this suite runs before the tool exists and keeps running
// after it. Design:
// docs/superpowers/specs/2026-09-22-watching-an-agent-use-your-app-design.md

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const APP = `<!doctype html>
<html><head><meta charset="utf-8"><title>Table</title>
<style>
  body { font: 16px/1.5 Georgia, serif; margin: 40px; }
  button {
    font: 500 13px/1 system-ui, sans-serif;
    padding: .5rem 1rem;
    border: 1px solid #ccc;
    border-radius: 999px;
    background: #fff;
  }
</style>
</head>
<body data-marble-id="b">
  <button data-marble-id="sort" data-marble-choose="asc">Sort</button>
  <ul data-marble-id="rows">
    <li data-marble-id="r1">Apples</li>
    <li data-marble-id="r2">Beans</li>
  </ul>
</body></html>
`;

const host = await startDrive({ agents: true, documents: { table: APP } });
test.after(() => host.close());

const open = async () => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/table`);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  return { page, errors };
};

const frame = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('marble:presence', { detail: d }));
}, detail);

const ops = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('marble:ops', { detail: d }));
}, detail);

const pressing = { client: 'agent:c1', ids: ['sort'], phase: 'acting', note: 'Pressing Sort' };

test('a press is a ring on the control, not a zone around it', async () => {
  const { page, errors } = await open();
  await frame(page, pressing);

  assert.equal(await page.locator('.marble-act').count(), 1);
  assert.equal(await page.locator('.marble-zone').count(), 0, 'a press is an event, not a region of work');
  assert.match(await page.locator('.marble-act .marble-zone-label').innerText(), /Agent · pressing Sort/);
  assert.equal(
    await page.locator('[data-marble-id="sort"]').evaluate((el) => el.hasAttribute('data-marble-acting')),
    true,
    'the control is held down while the act is in flight',
  );
  // The ring stands off the control in its own shape: a pill around a pill.
  const ring = await page.locator('.marble-act').evaluate((el) => {
    const button = document.querySelector('[data-marble-id="sort"]').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { grew: Math.round(r.width - button.width), radius: el.style.borderRadius };
  });
  assert.equal(ring.grew, 6);
  assert.equal(ring.radius, '1002px');
  assert.equal(await page.locator('.marble-act .marble-zone-label').getByRole('button', { name: /Open the conversation/ }).count(), 1);
  assert.deepEqual(errors.filter((message) => !/favicon/.test(message)), []);
});

test('the effect waits for the press: cause first, then what the app filed', async () => {
  const { page } = await open();
  await frame(page, pressing);
  await ops(page, { client: 'agent:c1', ops: [{ type: 'setText', id: 'r1', text: 'Apples' }] });

  assert.equal(
    await page.locator('[data-marble-id="r1"]').evaluate((el) => el.classList.contains('marble-flash')),
    false,
    'the host writes the op before the page hears about the press; the page holds it',
  );

  await frame(page, { client: 'agent:c1', ids: [], phase: 'working', note: 'Pressed Sort' });
  await page.waitForFunction(
    () => document.querySelector('[data-marble-id="r1"]')?.classList.contains('marble-flash'),
    null,
    { timeout: 4000 },
  );
  assert.match(await page.locator('.marble-act .marble-zone-label').innerText(), /Agent · pressed Sort · 1 change\b/);
});

test('an act too quick to see is still seen', async () => {
  const { page } = await open();
  await frame(page, pressing);
  await frame(page, { client: 'agent:c1', ids: [], phase: 'working' });
  await page.waitForTimeout(120);
  assert.equal(await page.locator('.marble-act-out').count(), 0, 'the ring holds its floor, however fast the act was');
  await page.waitForFunction(() => document.querySelector('.marble-act-out'), null, { timeout: 4000 });
});

test('an act that changed nothing says so', async () => {
  const { page } = await open();
  await frame(page, pressing);
  await frame(page, { client: 'agent:c1', ids: [], phase: 'working', note: 'Pressed Sort' });
  await page.waitForFunction(
    () => /nothing changed/.test(document.querySelector('.marble-act .marble-zone-label')?.innerText ?? ''),
    null,
    { timeout: 4000 },
  );
  assert.equal(
    await page.locator('[data-marble-id="sort"]').evaluate((el) => el.hasAttribute('data-marble-acting')),
    false,
  );
});

test('a deferred act has arrived and pressed nothing', async () => {
  const { page } = await open();
  // The gesture is dropped, because a deferred act has not been done: the
  // label names the control it is waiting on.
  await frame(page, { ...pressing, deferred: true });
  assert.match(await page.locator('.marble-act .marble-zone-label').innerText(), /Agent · waiting for you · Sort(?! ·)/);
  assert.equal(await page.locator('.marble-act-ring.marble-act-wait').count(), 1);
  assert.equal(
    await page.locator('[data-marble-id="sort"]').evaluate((el) => el.hasAttribute('data-marble-acting')),
    false,
    'the person has their hands on it, so nothing is pressed',
  );

  // They move on, and the act lands.
  await frame(page, pressing);
  assert.equal(await page.locator('.marble-act-ring.marble-act-wait').count(), 0);
  assert.equal(
    await page.locator('[data-marble-id="sort"]').evaluate((el) => el.hasAttribute('data-marble-acting')),
    true,
  );
});

test('an act on nothing this page shows draws nothing, and holds nothing back', async () => {
  const { page } = await open();
  await frame(page, { client: 'agent:c1', ids: ['not-here'], phase: 'acting', note: 'Pressing Sort' });
  assert.equal(await page.locator('.marble-act').count(), 0);
  await ops(page, { client: 'agent:c1', ops: [{ type: 'setText', id: 'r1', text: 'Apples' }] });
  assert.equal(
    await page.locator('[data-marble-id="r1"]').evaluate((el) => el.classList.contains('marble-flash')),
    true,
    'nothing to wait for, so the effect is not delayed',
  );
});

test('an agent that moves on gets its zone back, and the act does not narrate its move', async () => {
  const { page } = await open();
  await frame(page, pressing);
  // Not a report on the press: the agent is writing somewhere else now.
  await frame(page, { client: 'agent:c1', ids: ['rows'], phase: 'writing', note: 'Rewrite the list.' });
  await page.waitForFunction(() => document.querySelector('.marble-zone'), null, { timeout: 4000 });
  assert.match(await page.locator('.marble-zone').innerText(), /Agent · rewrite the list/);
  assert.equal(await page.locator('.marble-act').count(), 0, 'the act label does not hold the zone off the page');
});
