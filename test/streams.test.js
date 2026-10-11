// Which live streams a sprite keeps open. A stream counts as activity, so a
// tab left open and forgotten would keep a sprite awake forever: a stream is
// closed once its tab has gone 15 minutes without being used, and a forgotten
// tab's reconnect is answered 204, which tells EventSource to stop trying.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createStreams } from '../server/streams.js';

const MIN = 60_000;
function setup() {
  const clock = { t: 1_000_000 };
  const streams = createStreams({ unusedMs: 15 * MIN, now: () => clock.t, schedule: null });
  const open = (query = '', headers = {}) => {
    const url = new URL(`http://x/events?${query}`);
    const req = { headers };
    const res = Object.assign(new EventEmitter(), {
      written: '',
      ended: false,
      write(s) { this.written += s; return true; },
      end() { this.ended = true; this.emit('close'); },
    });
    const admitted = streams.admit(req, url);
    if (admitted) streams.track(req, res, url);
    return { admitted, res };
  };
  return { clock, streams, open };
}

test('a used tab keeps its stream; a tab unused for 15 minutes loses it', () => {
  const { clock, streams, open } = setup();
  const used = open('tab=aaa');
  const forgotten = open('tab=bbb');
  assert.equal(used.admitted, true);
  assert.equal(streams.count, 2);
  clock.t += 10 * MIN;
  streams.alive('aaa');
  clock.t += 6 * MIN;
  streams.sweep();
  assert.equal(used.res.ended, false);
  assert.equal(forgotten.res.ended, true);
  assert.equal(streams.count, 1);
});

test('a forgotten tab reconnecting is told to stop; once used again it may open', () => {
  const { clock, streams, open } = setup();
  open('tab=bbb');
  clock.t += 16 * MIN;
  streams.sweep();
  assert.equal(open('tab=bbb').admitted, false, 'the automatic reconnect gets 204');
  streams.alive('bbb');
  assert.equal(open('tab=bbb').admitted, true, 'the tab woke, said so, and reopened');
});

test('a stream with no tab counts as unused: closed after 15 minutes, and its reconnect stopped', () => {
  const { clock, streams, open } = setup();
  const old = open('');
  assert.equal(old.admitted, true, 'a page from before tabs had ids still gets its stream');
  clock.t += 14 * MIN;
  streams.sweep();
  assert.equal(old.res.ended, false);
  clock.t += 1 * MIN;
  streams.sweep();
  assert.equal(old.res.ended, true);
  const marker = /^id: (.+)$/m.exec(old.res.written)?.[1];
  assert.ok(marker, 'the last frame gives EventSource an id to come back with');
  assert.equal(open('', { 'last-event-id': marker }).admitted, false);
});

test('a stream that closes itself is no longer counted', () => {
  const { streams, open } = setup();
  const s = open('tab=ccc');
  s.res.emit('close');
  assert.equal(streams.count, 0);
});
