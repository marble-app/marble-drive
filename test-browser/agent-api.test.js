import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
  followup: [
    { say: 'The second reply.' },
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

test('each subscriber gets the sequenced history and continues with the live stream', async () => {
  const { page } = await open();
  const result = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    const first = [];
    let firstCompleted;
    const offFirst = agent.on(id, (event) => {
      first.push(event);
      if (event.type === 'turn.completed') firstCompleted?.(event);
    });

    const initialDone = new Promise((resolve) => { firstCompleted = resolve; });
    await agent.send(id, { prompt: 'script:rename' });
    await initialDone;

    const initialSeqs = first.filter((event) => event.seq).map((event) => event.seq);
    const initialLast = initialSeqs.at(-1);
    const second = [];
    let secondCompleted;
    const nextFirstDone = new Promise((resolve) => {
      firstCompleted = (event) => {
        if (event.seq > initialLast) resolve(event.seq);
      };
    });
    const nextSecondDone = new Promise((resolve) => { secondCompleted = resolve; });
    const offSecond = agent.on(id, (event) => {
      second.push(event);
      if (event.type === 'turn.completed' && event.seq > initialLast) secondCompleted(event.seq);
    });
    const replayedSeqs = second.filter((event) => event.seq).map((event) => event.seq);

    await agent.send(id, { prompt: 'script:followup' });
    const [firstLiveSeq, secondLiveSeq] = await Promise.all([nextFirstDone, nextSecondDone]);
    offSecond();
    offFirst();
    return {
      initialSeqs,
      replayedSeqs,
      firstSeqs: first.filter((event) => event.seq).map((event) => event.seq),
      secondSeqs: second.filter((event) => event.seq).map((event) => event.seq),
      firstLiveSeq,
      secondLiveSeq,
    };
  });

  assert.deepEqual(result.replayedSeqs, result.initialSeqs, 'the second subscriber receives the completed history');
  assert.deepEqual(result.secondSeqs, result.firstSeqs, 'both subscribers receive each sequenced event once and in order');
  assert.equal(result.secondLiveSeq, result.firstLiveSeq, 'the second subscriber stays on the shared live stream');
});

test('context is this document and the addressed elements the person selected', async () => {
  const { page } = await open();
  const empty = await page.evaluate(() => window.marble.agent.context());
  assert.deepEqual(empty, { viewing: 'garden', target: 'garden', selection: [], also: [] });

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

test('aim() points the writable target at another document without leaving this page', async () => {
  const { page } = await open();
  const aimed = await page.evaluate(() => {
    const heard = [];
    addEventListener('marble:agent-context', () => heard.push(true));
    window.marble.agent.aim('notes', { also: ['reading'] });
    return { context: window.marble.agent.context(), heard: heard.length };
  });
  assert.equal(aimed.context.viewing, 'garden');
  assert.equal(aimed.context.target, 'notes');
  assert.deepEqual(aimed.context.also, ['reading']);
  assert.ok(aimed.heard >= 1, 'aiming dispatches marble:agent-context');

  const cleared = await page.evaluate(() => {
    window.marble.agent.aim(null);
    return window.marble.agent.context();
  });
  assert.equal(cleared.viewing, 'garden');
  assert.equal(cleared.target, 'garden');
  assert.deepEqual(cleared.also, []);
});

test('send() uses the aimed path as context.target', async () => {
  const { page } = await open();
  const target = await page.evaluate(async () => {
    const agent = window.marble.agent;
    agent.aim('notes');
    const id = await agent.start({ provider: 'fake' });
    const user = await new Promise((resolve) => {
      const off = agent.on(id, (event) => {
        if (event.type === 'user') {
          off();
          resolve(event.context);
        }
      });
      agent.send(id, { prompt: 'script:followup' });
    });
    return user;
  });
  assert.equal(target.target, 'notes');
  assert.equal(target.viewing, 'garden');
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

const selectBetween = (page, fromId, fromOffset, toId, toOffset) => page.evaluate(([a, ao, b, bo]) => {
  const from = document.querySelector(`[data-marble-id="${a}"]`).firstChild;
  const to = document.querySelector(`[data-marble-id="${b}"]`).firstChild;
  const range = document.createRange();
  range.setStart(from, ao);
  range.setEnd(to, bo === -1 ? to.length : bo);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}, [fromId, fromOffset, toId, toOffset]);

test('a selection carries every addressed element it crosses, and a fully covered list is its list', async () => {
  const { page } = await open();
  // From inside the paragraph to the end of the second question: p, then the
  // whole list, which coalesces to q.
  await selectBetween(page, 'p', 5, 'q2', -1);
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 2);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['p', 'q']);
});

test('a selection that stops inside a list keeps the items, not the list', async () => {
  const { page } = await open();
  await selectBetween(page, 'q1', 0, 'q2', 4);
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 2);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['q1', 'q2']);
});

test('a selection of the whole page never names the body', async () => {
  const { page } = await open();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.body);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForFunction(() => window.marble.agent.context().selection.length > 0);
  assert.deepEqual((await page.evaluate(() => window.marble.agent.context())).selection, ['h', 'p', 'q']);
});

test('the summary stream reports conversations changing', async () => {
  const { page } = await open();
  await page.evaluate(() => {
    const agent = window.marble.agent;
    window.summaryForTest = new Promise((resolve) => {
      const off = agent.on('*', (s) => {
        off();
        resolve(s);
      });
    });
  });
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename' });
  });
  const summary = await page.evaluate(() => window.summaryForTest);
  assert.ok(summary.id);
  assert.ok('needsReview' in summary);
});
