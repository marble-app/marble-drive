import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS });
test.after(() => host.close());

const open = async (path = 'garden') => {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/${path}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return { page, errors };
};

test('the agent API attaches to the carrier and reaches the host', async () => {
  const { page, errors } = await open();
  const providers = await page.evaluate(() => window.marble.agent.providers());
  assert.equal(providers[0].id, 'fake');
  assert.equal(providers[0].default, true);
  assert.deepEqual(errors, []);
});

test('start and send run a turn, and the stream replays and follows it', async () => {
  const { page } = await open();
  const events = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    const seen = [];
    await new Promise((resolve) => {
      const off = agent.on(id, (event) => {
        seen.push(event);
        if (event.type === 'turn.completed') {
          off();
          resolve();
        }
      });
      agent.send(id, { prompt: 'script:rename' });
    });
    return seen;
  });
  const types = events.map((e) => e.type);
  for (const type of ['user', 'turn.started', 'tool.call', 'ops.applied', 'text.delta', 'text', 'turn.completed']) {
    assert.ok(types.includes(type), type);
  }
  const stored = events.filter((e) => e.seq);
  assert.deepEqual(stored.map((e) => e.seq), stored.map((_, i) => i + 1), 'every stored event once, in order');
  assert.equal(events.find((e) => e.type === 'user').context.target, 'garden', 'the target is this document');
  assert.match(await host.drive.store.read('garden'), />Backlog</);
});

test('context is this document and the addressed elements the person selected', async () => {
  const { page } = await open();
  const empty = await page.evaluate(() => window.marble.agent.context());
  assert.deepEqual(empty, { viewing: 'garden', target: 'garden', selection: [] });

  await page.evaluate(() => {
    const range = document.createRange();
    range.setStart(document.querySelector('[data-marble-id="q1"]').firstChild, 0);
    range.setEnd(document.querySelector('[data-marble-id="q2"]').firstChild, 4);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 2);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['q1', 'q2']);

  // Clicking away inside the document clears it.
  await page.evaluate(() => getSelection().collapse(document.querySelector('[data-marble-id="p"]').firstChild, 1));
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);
});

test('a selection survives focus moving into transient chrome', async () => {
  const { page } = await open();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const chrome = document.createElement('div');
    chrome.setAttribute('data-marble-transient', '');
    chrome.innerHTML = '<input id="chrome-input">';
    document.body.append(chrome);
  });
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 1);
  await page.focus('#chrome-input');
  await page.evaluate(() => getSelection().collapse(document.getElementById('chrome-input'), 0));
  await page.waitForTimeout(50);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['h']);
});

test('select() overrides the text selection until cleared', async () => {
  const { page } = await open();
  assert.deepEqual(await page.evaluate(() => {
    window.marble.agent.select(['q2']);
    return window.marble.agent.context().selection;
  }), ['q2']);
  assert.deepEqual(await page.evaluate(() => {
    window.marble.agent.select(null);
    return window.marble.agent.context().selection;
  }), []);
});

test('remember, current, open and close', async () => {
  const { page } = await open();
  const result = await page.evaluate(async () => {
    const agent = window.marble.agent;
    agent.remember('abc123abc123');
    const heard = [];
    addEventListener('marble:agent-open', (e) => heard.push(['open', e.detail.id]));
    addEventListener('marble:agent-close', () => heard.push(['close']));
    agent.open('abc123abc123');
    agent.close();
    return { current: agent.current(), heard };
  });
  assert.deepEqual(result, { current: 'abc123abc123', heard: [['open', 'abc123abc123'], ['close']] });
});

test('a failing call rejects with the host’s own words', async () => {
  const { page } = await open();
  const message = await page.evaluate(() => window.marble.agent.start({ provider: 'nope' }).catch((err) => err.message));
  assert.equal(message, 'no provider "nope"');
});

test('the summary stream reports conversations changing', async () => {
  const { page } = await open();
  const summary = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const heard = new Promise((resolve) => {
      const off = agent.on('*', (s) => {
        off();
        resolve(s);
      });
    });
    await new Promise((r) => setTimeout(r, 100));
    const id = await agent.start({ provider: 'fake' });
    agent.send(id, { prompt: 'script:rename' });
    return heard;
  });
  assert.ok(summary.id);
  assert.ok('needsReview' in summary);
});
