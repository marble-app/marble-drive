// Gathering every drive's ledger on admin-p1, and the dashboard's answers.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createUsage, recentDays } from '../server/console/usage.js';

const H = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const minutes = (startMs, endMs, extra = {}) => {
  const out = [];
  for (let t = startMs + 60_000; t <= endMs; t += 60_000) out.push({ t: t / 1000, dt: 60, cpu: 3, mem: 2, used: 1, disk: 4, why: { tabs: 1, looking: 1, work: 0, asks: 0 }, turns: 0, opens: 0, wake: null, ...extra });
  return out;
};
const row = (name, status, extra = {}) => ({ name, status, awake: status === 'running', labels: name === 'admin-p1' ? ['marble-owner'] : ['marble-tester'], createdAt: `2026-09-2${name.length % 10}T00:00:00Z`, ranAt: null, pausedAt: null, ...extra });

async function world({ remote = {}, self = [] } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-'));
  const calls = [];
  const sprites = {
    exec: async (name, cmd) => {
      calls.push({ name, cmd });
      const since = Number(cmd[2]);
      const lines = (remote[name] ?? []).filter((l) => l.t > since);
      return { stdout: `noise\n${JSON.stringify({ ledger: lines.length, more: false })}\n${lines.map((l) => JSON.stringify(l)).join('\n')}\n` };
    },
  };
  const selfLedger = { read: async (since) => self.filter((l) => l.t > since) };
  const make = () => createUsage({ dir, sprites, self: 'admin-p1', selfLedger, now: () => NOW, log: { error() {} } });
  return { dir, calls, make, usage: make(), remote, self };
}

test('pulled lines are stored once, and a restart picks up after the newest stored line', async () => {
  const w = await world({ remote: { 't-sam': minutes(NOW - 2 * H, NOW - H) } });
  assert.equal((await w.usage.pull('t-sam')).length, 60);
  assert.equal((await w.usage.pull('t-sam')).length, 0, 'nothing twice');
  w.remote['t-sam'].push(...minutes(NOW - H, NOW - H + 10 * 60_000));
  const again = w.make();
  assert.equal((await again.pull('t-sam')).length, 10);
  assert.equal(w.calls.at(-1).cmd[2], String((NOW - H) / 1000), 'the cursor is the newest stored line');
  const stored = await fsp.readFile(path.join(w.dir, 't-sam', '2026-10.jsonl'), 'utf8');
  assert.equal(stored.trim().split('\n').length, 70);
});

test('this drive reads its own ledger, with no exec', async () => {
  const w = await world({ self: minutes(NOW - H, NOW) });
  assert.equal((await w.usage.pull('admin-p1')).length, 60);
  assert.equal(w.calls.length, 0);
});

test('observations: only changes, plus the wake and pause the API remembers', async () => {
  const w = await world();
  const first = await w.usage.observe([row('t-sam', 'warm', { ranAt: new Date(NOW - 3 * H).toISOString(), pausedAt: new Date(NOW - 2 * H).toISOString() })]);
  assert.deepEqual(first.map((c) => [c.status, (NOW - c.t) / H]), [['running', 3], ['warm', 2]]);
  assert.deepEqual(await w.usage.observe([row('t-sam', 'warm', { ranAt: new Date(NOW - 3 * H).toISOString(), pausedAt: new Date(NOW - 2 * H).toISOString() })]), []);
  const cold = await w.usage.observe([row('t-sam', 'cold')]);
  assert.deepEqual(cold.map((c) => c.status), ['cold']);
});

test('the dashboard: segments, buckets, totals, the month and its projection', async () => {
  const w = await world({ remote: { 't-sam': minutes(NOW - 5 * H, NOW - 4 * H) }, self: minutes(NOW - 2 * H, NOW) });
  await w.usage.pull('t-sam');
  await w.usage.pull('admin-p1');
  const rows = [row('admin-p1', 'running'), row('t-sam', 'warm')];
  await w.usage.observe(rows);
  const q = await w.usage.query({ range: '24h', rows });
  assert.deepEqual(q.sprites.map((s) => s.name), ['admin-p1', 't-sam'], 'owner first');
  const sam = q.sprites[1];
  assert.ok(Math.abs(sam.totals.awakeHours - 1) < 1e-9);
  assert.ok(sam.segments.some((s) => s.state === 'running' && s.to - s.from === H));
  assert.equal(sam.buckets.reduce((a, b) => a + b.awake, 0), 3600);
  assert.equal(sam.buckets[0].cpu, 0.05, 'average cores');
  assert.equal(sam.buckets[0].mem, 2);
  assert.ok(q.totals.total > 0);
  assert.ok(q.month.spent > 0);
  assert.ok(q.month.projection.end >= q.month.spent);
  assert.equal(q.budget, null);
  assert.ok(!JSON.stringify(q).includes('NaN'));
});

test('a drive with no ledger yet, seen running, is costed as typical minutes and marked so', async () => {
  const w = await world();
  await w.usage.observe([row('t-irene', 'running', { ranAt: new Date(NOW - H).toISOString() })]);
  const q = await w.usage.query({ range: '24h', rows: [row('t-irene', 'running', { ranAt: new Date(NOW - H).toISOString() })] });
  const irene = q.sprites[0];
  assert.equal(irene.hasLedger, false);
  assert.equal(Math.round(irene.totals.estimatedHours), 1);
  assert.ok(irene.totals.total > 0);
});

test('a removed drive still draws where it has history; an empty drive draws nothing broken', async () => {
  const w = await world({ remote: { 't-old': minutes(NOW - 3 * H, NOW - 2 * H) } });
  await w.usage.pull('t-old');
  const blank = await w.usage.query({ range: '24h', rows: [row('t-new', 'warm')] });
  assert.equal(blank.sprites[0].segments[0].state, 'unknown', 'never seen, never read');
  const paused = row('t-new', 'warm', { pausedAt: new Date(NOW - 3 * H).toISOString() });
  await w.usage.observe([paused]);
  const q = await w.usage.query({ range: '24h', rows: [paused] });
  assert.deepEqual(q.sprites.map((s) => [s.name, s.role]), [['t-new', 'user'], ['t-old', 'gone']]);
  assert.equal(q.sprites[0].totals.total, 0);
  assert.deepEqual(q.sprites[0].segments.map((x) => [x.state, (x.to - x.from) / H]), [['unknown', 21], ['warm', 3]]);
  assert.ok(Number.isFinite(q.month.projection.end) && q.month.projection.end >= q.month.spent);
});

test('a pasted bill calibrates every estimate; a budget is kept; bad input is refused', async () => {
  const w = await world({ self: minutes(NOW - 30 * H, NOW - 26 * H) });
  await w.usage.pull('admin-p1');
  const before = await w.usage.query({ range: '7d', rows: [row('admin-p1', 'running')] });
  const est = before.sprites[0].totals.cost.ram;
  const bad = await w.usage.addBill('nonsense $5');
  assert.equal(bad.ok, false);
  const ok = await w.usage.addBill(`From: 10/09/2026\nTo: 10/09/2026\nTotal Spend $${(est * 2).toFixed(4)}\nSprites: RAM $${(est * 2).toFixed(4)}`);
  assert.equal(ok.ok, true, ok.why);
  const after = await w.usage.query({ range: '7d', rows: [row('admin-p1', 'running')] });
  assert.ok(Math.abs(after.calibration.factor.ram - 2) < 0.01);
  assert.ok(Math.abs(after.sprites[0].totals.cost.ram - est * 2) < 0.001);
  assert.equal(await w.usage.setBudget(25), 25);
  assert.equal((await w.make().query({ range: '7d', rows: [] })).budget, 25, 'kept across a restart');
  await assert.rejects(() => w.usage.setBudget('lots'), /dollars/);
});

test('recent days: the last seven full days since the first line, else today scaled once there is an hour', () => {
  const byDay = new Map([['2026-10-09', { cpuH: 1, ramGBh: 48, hotGBh: 0 }]]);
  // First line at noon on the 7th: the 8th and the 9th are the full days.
  assert.equal(recentDays(byDay, NOW - 3 * 24 * H, NOW).length, 2);
  assert.deepEqual(recentDays(byDay, NOW - 3 * 24 * H, NOW)[1], { cpuH: 1, ramGBh: 48, hotGBh: 0 });
  assert.equal(recentDays(byDay, NOW - 30 * 24 * H, NOW).length, 7, 'at most seven');
  assert.deepEqual(recentDays(new Map(), NOW - 30 * 60_000, NOW), []);
  const today = new Map([['2026-10-10', { cpuH: 0, ramGBh: 12, hotGBh: 0 }]]);
  assert.deepEqual(recentDays(today, NOW - 2 * H, NOW), [], 'two hours after a deploy is not a day');
  assert.equal(recentDays(today, NOW - 6 * H, NOW)[0].ramGBh, 48);
});
