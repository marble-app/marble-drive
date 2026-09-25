// What a drive costs, from its ledger, at Fly's rates on the day it was used.

import assert from 'node:assert/strict';
import test from 'node:test';

import { calibrate, coldCost, lineCost, lineUse, project, rateAt, total } from '../server/console/cost.js';

const at = (iso) => Date.parse(iso) / 1000;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('a minute is priced at the rates of its own day, either side of 2026-10-01', () => {
  const line = { dt: 3600, cpu: 3600, mem: 2, disk: 10 };
  const sep = lineCost({ ...line, t: at('2026-09-30T23:30:00Z') });
  close(sep.cpu, 0.07);
  close(sep.ram, 2 * 0.04375);
  close(sep.hot, 10 * 0.000683);
  const oct = lineCost({ ...line, t: at('2026-10-01T00:30:00Z') });
  close(oct.cpu, 0.03825);
  close(oct.ram, 2 * 0.021875);
  assert.equal(rateAt(Date.parse('2026-10-15T00:00:00Z')).ram, 0.021875);
});

test('Fly\'s floors while running: 1/16 of a CPU and 256 MB; a missing reading bills the floor', () => {
  const idle = lineUse({ t: 0, dt: 3600, cpu: 1, mem: 0.1, disk: 0 });
  close(idle.cpuH, 0.0625);
  close(idle.ramGBh, 0.25);
  const blind = lineUse({ t: 0, dt: 3600, cpu: null, mem: null, used: null, disk: null });
  close(blind.ramGBh, 0.25);
  close(blind.hotGBh, 0);
  const byUsed = lineUse({ t: 0, dt: 3600, mem: 3.6, used: 1.8 }, { basis: 'used' });
  close(byUsed.ramGBh, 1.8);
});

test('cold storage accrues always, across the price change', () => {
  close(coldCost(10, Date.parse('2026-09-30T00:00:00Z'), Date.parse('2026-10-02T00:00:00Z')), 10 * 48 * 0.000027);
  assert.equal(coldCost(0, 0, 1e9), 0);
});

test('calibration is billed over estimated, per product, where both exist', () => {
  assert.deepEqual(calibrate({ ram: 5, cpu: 0.5, hot: 0 }, { ram: 6, cpu: 0.5, hot: 0.11 }), { ram: 1.2, cpu: 1 });
});

test('the projection prices each day left at its own rate', () => {
  // Noon on Sep 30: half a day at September's rates, then nothing (the month ends).
  const sep = project({ spent: 10, recent: [{ cpuH: 0, ramGBh: 24, hotGBh: 0 }], now: Date.parse('2026-09-30T12:00:00Z') });
  close(sep.end, 10 + 0.5 * 24 * 0.04375);
  close(sep.daysLeft, 0.5);
  // Oct 30 at noon: a day and a half at October's rates.
  const oct = project({ spent: 0, recent: [{ cpuH: 0, ramGBh: 24, hotGBh: 0 }, { cpuH: 0, ramGBh: 48, hotGBh: 0 }], now: Date.parse('2026-10-30T12:00:00Z') });
  close(oct.end, 1.5 * 36 * 0.021875);
  close(oct.low, 1.5 * 24 * 0.021875);
  close(oct.high, 1.5 * 48 * 0.021875);
  const none = project({ spent: 3, recent: [], now: Date.parse('2026-10-30T12:00:00Z') });
  assert.equal(none.end, 3);
  assert.equal(total({ cpu: 1, ram: 2, hot: 3, cold: 4 }), 10);
});
