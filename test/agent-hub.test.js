import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createHub } from '../server/agent/hub.js';
import { createAgentRoutes } from '../server/agent/routes.js';

const CONV = 'abcdef012345';

/** Just enough of a ServerResponse to be an SSE listener. */
function fakeRes() {
  const res = new EventEmitter();
  res.chunks = [];
  res.afterClose = [];
  res.destroyed = false;
  res.writeHead = () => res;
  res.write = (chunk) => {
    (res.destroyed ? res.afterClose : res.chunks).push(chunk);
    return true;
  };
  res.hangUp = () => {
    res.destroyed = true;
    res.emit('close');
  };
  res.ids = () => res.chunks.flatMap((c) => [...c.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1])));
  return res;
}

const fakeReq = (headers = {}) => Object.assign(new EventEmitter(), { method: 'GET', headers: { host: 'localhost', ...headers } });

test('the hub sends a conversation its own events and every listener on * a summary', () => {
  const hub = createHub();
  const one = fakeRes();
  const other = fakeRes();
  const all = fakeRes();
  const offOne = hub.subscribe(CONV, one);
  hub.subscribe('ffffffffffff', other);
  hub.subscribe('*', all);

  hub.publish(CONV, { seq: 1, type: 'user' }, { id: CONV, status: 'running' });
  hub.publish(CONV, { type: 'text.delta', text: 'hi' });
  assert.deepEqual(one.chunks, [
    `id: 1\ndata: ${JSON.stringify({ seq: 1, type: 'user' })}\n\n`,
    `data: ${JSON.stringify({ type: 'text.delta', text: 'hi' })}\n\n`,
  ]);
  assert.deepEqual(other.chunks, []);
  assert.deepEqual(all.chunks, [`event: summary\ndata: ${JSON.stringify({ id: CONV, status: 'running' })}\n\n`], 'no summary, no frame');

  offOne();
  hub.publish(CONV, { seq: 2, type: 'text' });
  assert.equal(one.chunks.length, 2, 'unsubscribed listeners hear nothing more');
  hub.close();
});

/** Routes over a store whose read of the transcript waits for `release`. */
function slowRoutes(stored) {
  const hub = createHub();
  let release;
  const reading = new Promise((resolve) => { release = resolve; });
  let started;
  const readStarted = new Promise((resolve) => { started = resolve; });
  const store = {
    async events(id, { after = 0 } = {}) {
      started();
      await reading;
      return stored.filter((e) => e.seq > after);
    },
  };
  const routes = createAgentRoutes({ store, runner: {}, tools: {}, hub, providers: new Map(), writeOps: null, maxBody: 1024 });
  return { hub, routes, release, readStarted };
}

const url = (query) => new URL(`http://localhost/agent/events?${query}`);

test('the conversation stream neither drops nor repeats an event across replay and live', async () => {
  const stored = [{ seq: 1, type: 'user' }, { seq: 2, type: 'turn.queued' }];
  const { hub, routes, release, readStarted } = slowRoutes(stored);
  const res = fakeRes();
  const handling = routes.handle(fakeReq(), res, url(`conversation=${CONV}&after=0`));
  await readStarted;
  // While the transcript is being read: event 2 was already appended (so the
  // read will return it) and is published now; event 3 is appended and
  // published after the read began.
  hub.publish(CONV, stored[1]);
  hub.publish(CONV, { type: 'text.delta', text: 'x' });
  hub.publish(CONV, { seq: 3, type: 'turn.started' });
  release();
  await handling;
  hub.publish(CONV, stored[1]); // appended before the read, published only now
  hub.publish(CONV, { seq: 4, type: 'text' });
  assert.deepEqual(res.ids(), [1, 2, 3, 4]);
  assert.ok(res.chunks.some((c) => c.includes('text.delta')), 'events without a seq pass through');
  hub.close();
});

test('a client that leaves while the transcript is read is not left subscribed', async () => {
  const { hub, routes, release, readStarted } = slowRoutes([{ seq: 1, type: 'user' }]);
  const res = fakeRes();
  const handling = routes.handle(fakeReq(), res, url(`conversation=${CONV}`));
  await readStarted;
  res.hangUp();
  release();
  await handling;
  hub.publish(CONV, { seq: 2, type: 'text' });
  assert.deepEqual(res.afterClose, [], 'nothing is written to a listener that hung up');
  hub.close();
});

test('Last-Event-ID is where a reconnecting stream replays from', async () => {
  const stored = [{ seq: 1, type: 'user' }, { seq: 2, type: 'turn.queued' }, { seq: 3, type: 'turn.started' }];
  const { hub, routes, release } = slowRoutes(stored);
  release();
  const res = fakeRes();
  await routes.handle(fakeReq({ 'last-event-id': '2' }), res, url(`conversation=${CONV}&after=0`));
  assert.deepEqual(res.ids(), [3]);
  hub.close();
});
