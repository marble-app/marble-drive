import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createUsageHistory, familyOf } from '../server/agent/usage-history.js';

const NOW = new Date('2026-09-18T20:00:00Z');
const LA = 'America/Los_Angeles';

const line = ({ id, req = `req-${id}`, ts, model = 'claude-opus-5', input = 10, output = 20, write = 5, read = 1000, sidechain = false, type = 'assistant' }) => JSON.stringify({
  type,
  timestamp: ts,
  requestId: req,
  isSidechain: sidechain,
  message: {
    id,
    model,
    role: 'assistant',
    content: [{ type: 'text', text: 'SECRET TEXT THAT MUST NEVER LEAVE THE SCAN' }],
    usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: read },
  },
});

const fixture = async (files) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-history-'));
  for (const [name, lines] of Object.entries(files)) {
    const file = path.join(root, name);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, `${lines.join('\n')}\n`);
  }
  return root;
};

const make = (root, extra = {}) => createUsageHistory({ root, now: () => NOW, timeZone: LA, ttl: 0, ...extra });
const dayOf = (history, date) => history.days.find((day) => day.date === date);

test('familyOf maps a model id to its family, so a new point release needs no code', () => {
  assert.equal(familyOf('claude-fable-5-1'), 'fable');
  assert.equal(familyOf('claude-opus-5'), 'opus');
  assert.equal(familyOf('claude-sonnet-5'), 'sonnet');
  assert.equal(familyOf('claude-haiku-4-5-20251001'), 'haiku');
  assert.equal(familyOf('claude-opus-6-2'), 'opus');
  assert.equal(familyOf('gpt-5'), 'other');
  assert.equal(familyOf(undefined), 'other');
});

test('a message repeated per content block, or in a resumed session, counts once', async () => {
  const root = await fixture({
    'p1/a.jsonl': [
      line({ id: 'm1', ts: '2026-09-18T18:00:00Z' }),
      line({ id: 'm1', ts: '2026-09-18T18:00:00Z' }),
      line({ id: 'm2', ts: '2026-09-18T18:05:00Z' }),
    ],
    'p2/b.jsonl': [line({ id: 'm1', ts: '2026-09-18T18:00:00Z' })],
  });
  const day = dayOf(await make(root)({ weeks: 2 }), '2026-09-18');
  assert.equal(day.messages, 2);
  assert.equal(day.tokens, 2 * (10 + 20 + 5));
  assert.equal(day.cacheRead, 2 * 1000);
});

test('synthetic placeholders are dropped, sidechains are kept, and junk lines are skipped', async () => {
  const root = await fixture({
    'p/a.jsonl': [
      line({ id: 's', ts: '2026-09-18T18:00:00Z', model: '<synthetic>' }),
      line({ id: 'side', ts: '2026-09-18T18:01:00Z', sidechain: true }),
      '{ not json',
      line({ id: 'u', ts: '2026-09-18T18:02:00Z', type: 'user' }),
      '',
      line({ id: 'h', ts: '2026-09-18T18:03:00Z', model: 'claude-haiku-4-5-20251001' }),
    ],
  });
  const day = dayOf(await make(root)({ weeks: 2 }), '2026-09-18');
  assert.equal(day.messages, 2);
  assert.deepEqual(Object.keys(day.byModel).sort(), ['haiku', 'opus']);
  assert.equal(day.byModel.haiku.messages, 1);
});

test('the result carries counts and nothing else from the transcripts', async () => {
  const root = await fixture({ 'p/a.jsonl': [line({ id: 'm', ts: '2026-09-18T18:00:00Z' })] });
  const history = await make(root)({ weeks: 2 });
  assert.equal(JSON.stringify(history).includes('SECRET TEXT'), false);
  assert.equal(JSON.stringify(history).includes(root), false);
  assert.equal(history.source, 'claude-code-local');
  assert.equal(history.tz, LA);
});

test('days are calendar days in the given time zone', async () => {
  // 23:30 and 00:30 Pacific on either side of midnight = 06:30Z and 07:30Z.
  const root = await fixture({
    'p/a.jsonl': [
      line({ id: 'late', ts: '2026-09-17T06:30:00Z' }),
      line({ id: 'early', ts: '2026-09-17T07:30:00Z' }),
    ],
  });
  const history = await make(root)({ weeks: 2 });
  assert.equal(dayOf(history, '2026-09-16').messages, 1);
  assert.equal(dayOf(history, '2026-09-17').messages, 1);
});

test('days are dense and end today, with zero days present', async () => {
  const root = await fixture({ 'p/a.jsonl': [line({ id: 'm', ts: '2026-09-18T18:00:00Z' })] });
  const history = await make(root)({ weeks: 2 });
  assert.equal(history.days.length, 14);
  assert.equal(history.to, '2026-09-18');
  assert.equal(history.from, '2026-09-05');
  assert.equal(history.days.at(-1).date, '2026-09-18');
  const empty = dayOf(history, '2026-09-10');
  assert.deepEqual(empty, { date: '2026-09-10', messages: 0, tokens: 0, cacheRead: 0, byModel: {} });
});

test('messages outside the range are ignored, and a missing root is an empty history', async () => {
  const root = await fixture({ 'p/a.jsonl': [line({ id: 'old', ts: '2026-01-01T12:00:00Z' })] });
  const history = await make(root)({ weeks: 2 });
  assert.equal(history.days.every((day) => day.messages === 0), true);
  const none = await make(path.join(root, 'does-not-exist'))({ weeks: 2 });
  assert.equal(none.days.length, 14);
  assert.equal(none.days.every((day) => day.messages === 0), true);
});

test('weeks is clamped between 1 and 53', async () => {
  const root = await fixture({ 'p/a.jsonl': [line({ id: 'm', ts: '2026-09-18T18:00:00Z' })] });
  const history = make(root);
  assert.equal((await history({ weeks: 0 })).days.length, 7);
  assert.equal((await history({ weeks: 999 })).days.length, 53 * 7);
  assert.equal((await history({ weeks: Number.NaN })).days.length, 26 * 7);
});

test('a second call re-reads only the files that changed', async () => {
  const root = await fixture({
    'p/a.jsonl': [line({ id: 'a1', ts: '2026-09-18T18:00:00Z' })],
    'p/b.jsonl': [line({ id: 'b1', ts: '2026-09-18T18:01:00Z' })],
  });
  const history = make(root);
  await history({ weeks: 2 });
  assert.equal(history.stats.filesParsed, 2);
  await history({ weeks: 2 });
  assert.equal(history.stats.filesParsed, 2, 'untouched files are not re-read');
  await fsp.appendFile(path.join(root, 'p/a.jsonl'), `${line({ id: 'a2', ts: '2026-09-18T18:02:00Z' })}\n`);
  const after = await history({ weeks: 2 });
  assert.equal(history.stats.filesParsed, 3, 'only the appended file is re-read');
  assert.equal(dayOf(after, '2026-09-18').messages, 3);
});

test('a file last written before the range starts is not opened', async () => {
  const root = await fixture({ 'p/old.jsonl': [line({ id: 'x', ts: '2026-01-01T12:00:00Z' })] });
  const long = new Date('2026-01-02T00:00:00Z');
  await fsp.utimes(path.join(root, 'p/old.jsonl'), long, long);
  const history = make(root);
  await history({ weeks: 2 });
  assert.equal(history.stats.filesParsed, 0);
});
