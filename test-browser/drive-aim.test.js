import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrive } from '../server/seed.js';
import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  hello: [{ say: 'ok' }],
};

const READING = GARDEN.replace('Research Garden', 'Reading List').replace('<title>Garden', '<title>Reading');

const host = await startDrive({
  scripts: SCRIPTS,
  documents: {
    drive: await buildDrive(),
    garden: GARDEN,
    reading: READING,
  },
});
test.after(() => host.close());

async function openDrive() {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/drive`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-agent-drawer')));
  await page.locator('#items .item[data-path="garden"]').waitFor();
  const drawer = page.locator('marble-agent-drawer');
  return { page, errors, drawer, view: drawer.locator('marble-conversation') };
}

const sendFromDrawer = async (drawer, view, text) => {
  await drawer.locator('.launcher').click();
  await drawer.locator('aside.panel[data-open="true"]').waitFor();
  await view.locator('textarea').fill(text);
  await view.locator('textarea').press('Enter');
  await view.locator('.msg.me').waitFor();
};

const userContext = async (page) =>
  page.evaluate(async () => {
    const [summary] = await window.marble.agent.conversations();
    const { events } = await window.marble.agent.conversation(summary.id);
    return events.find((event) => event.type === 'user').context;
  });

test('picking a document on Drive aims the drawer at that file, without leaving Drive', async () => {
  const { page, drawer, view } = await openDrive();
  await page.locator('#items .item[data-path="garden"] .name').click();
  await page.waitForFunction(() => window.marble.agent.context().target === 'garden');
  const here = await page.evaluate(() => ({
    app: window.marble.app,
    context: window.marble.agent.context(),
  }));
  assert.equal(here.app, 'drive');
  assert.equal(here.context.viewing, 'drive');
  assert.equal(here.context.target, 'garden');
  assert.deepEqual(here.context.also, []);

  await sendFromDrawer(drawer, view, 'script:hello');
  const sent = await userContext(page);
  assert.equal(sent.target, 'garden');
  assert.equal(sent.viewing, 'drive');
});

test('picking nothing on Drive leaves the writable target as Drive', async () => {
  const { page, drawer, view } = await openDrive();
  const here = await page.evaluate(() => window.marble.agent.context());
  assert.equal(here.viewing, 'drive');
  assert.equal(here.target, 'drive');

  await sendFromDrawer(drawer, view, 'script:hello');
  const sent = await userContext(page);
  assert.equal(sent.target, 'drive');
  assert.equal(sent.viewing, 'drive');
});

test('several picked documents: the first is writable, the rest are also in view', async () => {
  const { page } = await openDrive();
  await page.locator('#items .item[data-path="garden"] .name').click();
  await page.locator('#items .item[data-path="reading"] .name').click({ modifiers: ['Meta'] });
  const here = await page.waitForFunction(() => {
    const ctx = window.marble.agent.context();
    return ctx.target === 'garden' && ctx.also?.includes('reading') ? ctx : null;
  });
  const ctx = await here.jsonValue();
  assert.equal(ctx.viewing, 'drive');
  assert.equal(ctx.target, 'garden');
  assert.deepEqual(ctx.also, ['reading']);
});
