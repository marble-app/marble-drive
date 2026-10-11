// What a drive costs, from its ledger, at Fly's Sprites rates.
//
// Fly bills CPU actually used and memory held, per second, only while a sprite
// runs, plus storage: hot while awake, cold always (fly.io/pricing, and the
// update effective 2026-10-01). These are estimates; a pasted bill
// (server/console/bill.js) calibrates them product by product.

const DAY = 24 * 60 * 60 * 1000;

/** Each row applies from its date (UTC) until the next row's. Dollars per hour. */
export const RATES = [
  { from: '2026-01-01', cpu: 0.07, ram: 0.04375, hot: 0.000683, cold: 0.000027 },
  { from: '2026-10-01', cpu: 0.03825, ram: 0.021875, hot: 0.000683, cold: 0.000027 },
];

/** Fly's minimum while a sprite runs: 1/16 of a CPU and 256 MB. */
export const FLOORS = { cpu: 0.0625, mem: 0.25 };

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function rateAt(ms) {
  const day = dayOf(ms);
  let rate = RATES[0];
  for (const r of RATES) if (r.from <= day) rate = r;
  return rate;
}

/** What one ledger minute used, in billed units: CPU-hours, GB-hours. */
export function lineUse(line, { basis = 'mem' } = {}) {
  const dt = Number(line.dt) || 0;
  const hours = dt / 3600;
  const cpuSeconds = Math.max(Number(line.cpu) || 0, FLOORS.cpu * dt);
  const mem = line[basis] ?? line.mem ?? line.used ?? null;
  return {
    cpuH: cpuSeconds / 3600,
    ramGBh: Math.max(mem ?? FLOORS.mem, FLOORS.mem) * hours,
    hotGBh: (Number(line.disk) || 0) * hours,
  };
}

/** Units → dollars at a rate, each product scaled by its calibration factor. */
export function price(use, rate, factor = {}) {
  return {
    cpu: (use.cpuH ?? 0) * rate.cpu * (factor.cpu ?? 1),
    ram: (use.ramGBh ?? 0) * rate.ram * (factor.ram ?? 1),
    hot: (use.hotGBh ?? 0) * rate.hot * (factor.hot ?? 1),
    cold: (use.coldGBh ?? 0) * rate.cold,
  };
}

export function lineCost(line, options = {}) {
  return price(lineUse(line, options), rateAt(line.t * 1000), options.factor);
}

/** Cold storage on `diskGB` from one moment to another, across rate changes. */
export function coldCost(diskGB, fromMs, toMs) {
  if (!diskGB || toMs <= fromMs) return 0;
  let total = 0;
  for (let t = fromMs; t < toMs;) {
    const next = Math.min(toMs, Date.parse(`${dayOf(t)}T00:00:00Z`) + DAY);
    total += diskGB * ((next - t) / 3.6e6) * rateAt(t).cold;
    t = next;
  }
  return total;
}

export const sum = (costs) => costs.reduce((a, c) => ({
  cpu: a.cpu + (c.cpu ?? 0),
  ram: a.ram + (c.ram ?? 0),
  hot: a.hot + (c.hot ?? 0),
  cold: a.cold + (c.cold ?? 0),
}), { cpu: 0, ram: 0, hot: 0, cold: 0 });

export const total = (c) => (c.cpu ?? 0) + (c.ram ?? 0) + (c.hot ?? 0) + (c.cold ?? 0);

/** Billed ÷ estimated, per product, where both are known. */
export function calibrate(estimate, billed) {
  const factor = {};
  for (const key of ['cpu', 'ram', 'hot']) {
    if (billed?.[key] > 0 && estimate?.[key] > 0) factor[key] = billed[key] / estimate[key];
  }
  return factor;
}

/**
 * Month end: spent so far, plus each day left priced at its own rate from the
 * recent days' use (so a month that crosses a price change is priced right).
 * `recent` is the use of each recent full day: [{ cpuH, ramGBh, hotGBh }].
 */
export function project({ spent, recent, now, factor = {}, coldPerDay = 0 }) {
  const monthEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1);
  if (!recent.length) return { end: spent, low: spent, high: spent, daysLeft: (monthEnd - now) / DAY };
  const days = [];
  for (let t = now; t < monthEnd; t = Math.min(monthEnd, Date.parse(`${dayOf(t)}T00:00:00Z`) + DAY)) {
    const next = Math.min(monthEnd, Date.parse(`${dayOf(t)}T00:00:00Z`) + DAY);
    days.push({ rate: rateAt(t), share: (next - t) / DAY });
  }
  const priced = (use) => days.reduce((a, d) => a + d.share * (total(price(use, d.rate, factor)) + coldPerDay), 0);
  const mean = (key) => recent.reduce((a, u) => a + (u[key] ?? 0), 0) / recent.length;
  const avg = { cpuH: mean('cpuH'), ramGBh: mean('ramGBh'), hotGBh: mean('hotGBh') };
  const spends = recent.map((u) => priced(u));
  return {
    end: spent + priced(avg),
    low: spent + Math.min(...spends),
    high: spent + Math.max(...spends),
    daysLeft: days.reduce((a, d) => a + d.share, 0),
  };
}
