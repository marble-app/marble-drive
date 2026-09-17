import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  return { page, errors };
};

test('the Agents page has no drawer and lists a conversation', async () => {
  const { page, errors } = await openAgents();
  assert.equal(await page.locator('marble-agent-drawer').count(), 0);
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  assert.match(await page.locator(`.conv[data-id="${id}"] .title`).textContent(), /script:rename|Untitled/);
  assert.deepEqual(errors, []);
});

test('clicking a row opens it in the conversation pane and the inspector', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).click();
  const view = page.locator('marble-conversation');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.getAttribute('conversation'), id);
  assert.match(await page.locator('.inspector').textContent(), /garden|Fake|script:rename/i);
});

test('filters and search hide rows without deleting them', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    await agent.send(await agent.start({ provider: 'fake' }), {
      prompt: 'script:rename',
      target: 'garden',
      viewing: 'Agents',
      selection: [],
    });
  });
  await page.locator('.conv').first().waitFor();
  // send() returns when the turn is accepted, not when it finishes. Wait until
  // nothing is running so this asserts the filter, not a race with the fake agent.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.conv')].every((el) => el.dataset.status !== 'running'),
  );
  await page.locator('button.filter[data-filter="running"]').click();
  assert.equal(await page.locator('.conv:not([hidden])').count(), 0);
  await page.locator('button.filter[data-filter="all"]').click();
  await page.locator('input.search').fill('nope-nope');
  assert.equal(await page.locator('.conv:not([hidden])').count(), 0);
  await page.locator('input.search').fill('');
  assert.ok((await page.locator('.conv:not([hidden])').count()) >= 1);
});

test('the open conversation id is page-only and survives a reconcile', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).click();
  const view = page.locator('marble-conversation');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.getAttribute('conversation'), id);

  const source = await page.evaluate(() => window.marble.source.outer(document.querySelector('marble-conversation')));
  assert.equal(source.includes(`conversation="${id}"`), false);
  assert.ok(!(await host.drive.store.read('Agents')).includes(`conversation="${id}"`));

  // What patchFromFile does when the file has no conversation attr: strip it,
  // then hand the body to registered wirers.
  await page.evaluate(() => {
    document.querySelector('marble-conversation').removeAttribute('conversation');
    window.marble.adopt(document.body);
  });
  assert.equal(await view.getAttribute('conversation'), id);
});

test('V toggles library and board; the same conversation node moves', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  // send() returns when the turn is accepted. script:rename applies ops, so
  // the card belongs in Needs review, not Completed, once it is no longer running.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.conv')].every((el) => el.dataset.status !== 'running'),
  );
  assert.equal(await page.locator('body').getAttribute('data-view'), 'library');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  assert.equal(await page.locator(`.column[data-col="review"] .conv[data-id="${id}"]`).count(), 1);
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).count(), 1, 'the row was moved, not cloned');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  assert.equal(await page.locator(`#list .conv[data-id="${id}"]`).count(), 1);
});

test('reduced motion crossfades and does not wait on a FLIP', async () => {
  const { page } = await openAgents({ reducedMotion: 'reduce' });
  // Start a conversation first so `.conv` exists; still assert no FLIP transform.
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  const transform = await page.locator('.conv').first().evaluate((el) => getComputedStyle(el).transform).catch(() => 'none');
  assert.ok(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)' || transform == null);
});

test('clicking a board card opens the conversation panel', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.locator('.board-panel[data-open="true"]').waitFor();
  assert.equal(await page.locator('marble-conversation').count(), 1, 'one conversation element');
  assert.equal(await page.locator('.pane marble-conversation').getAttribute('conversation'), id);
  assert.equal(await page.locator('.board-panel marble-conversation').count(), 0);
});

test('a queued conversation sits in Running, not Completed', async () => {
  const { page } = await openAgents();
  const waiting = await host.drive.agents.store.createConversation({ provider: 'fake' });
  await host.drive.agents.store.createTurn(waiting.id, { prompt: 'later', context: { target: 'garden' } });
  try {
    await page.reload();
    await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
    await page.locator(`.conv[data-id="${waiting.id}"]`).waitFor();
    await page.keyboard.press('v');
    await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
    assert.equal(await page.locator(`.column[data-col="running"] .conv[data-id="${waiting.id}"]`).count(), 1);
  } finally {
    await host.drive.agents.store.updateConversation(waiting.id, { archived: true });
    const leftover = await host.drive.agents.store.turns(waiting.id);
    for (const turn of leftover) {
      if (turn.status === 'queued') await host.drive.agents.store.updateTurn(turn.id, { status: 'removed', finishedAt: Date.now() });
    }
  }
});

test('toggling twice during FLIP keeps one node on the library', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  await page.waitForFunction((cid) => {
    const el = document.querySelector(`.conv[data-id="${cid}"]`);
    if (!el) return false;
    const t = getComputedStyle(el).transform;
    return !el.classList.contains('marble-flip') && (t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)');
  }, id);
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).count(), 1);
  assert.equal(await page.locator(`#list .conv[data-id="${id}"]`).count(), 1);
  const transform = await page.locator(`.conv[data-id="${id}"]`).evaluate((el) => getComputedStyle(el).transform);
  assert.ok(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)');
});

test('toggling twice during a crossfade does not stick opacity', async () => {
  const { page } = await openAgents({ reducedMotion: 'reduce' });
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  await page.waitForFunction(() => !document.body.hasAttribute('data-crossfade'));
  assert.equal(await page.locator('body').getAttribute('data-crossfade'), null);
  const libOpacity = await page.locator('.library').evaluate((el) => getComputedStyle(el).opacity);
  assert.equal(libOpacity, '1');
  assert.equal(await page.locator(`#list .conv[data-id="${id}"]`).count(), 1);
});

test('opening the board panel does not clone the conversation on reconcile', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.locator('.board-panel[data-open="true"]').waitFor();
  const sameNode = await page.evaluate(() => {
    const el = document.querySelector('marble-conversation');
    window.marble.adopt(document.body);
    return el === document.querySelector('marble-conversation')
      && document.querySelectorAll('marble-conversation').length === 1
      && Boolean(el.closest('.pane'));
  });
  assert.equal(sameNode, true);
  assert.equal(await page.locator('.board-panel marble-conversation').count(), 0);
  assert.equal(await page.locator('.pane marble-conversation').getAttribute('conversation'), id);
});
