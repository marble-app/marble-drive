// Every drive's ledger, gathered on admin-p1, and the answers the dashboard
// draws (docs/superpowers/specs/2026-09-25-console-dashboard-design.md).
//
// Two kinds of evidence are kept, per sprite, under console/usage/<sprite>/:
// - ledger lines (<YYYY-MM>.jsonl), pulled with `sprite exec` of
//   ledger-read.mjs from a drive that is awake anyway, or read from this
//   drive's own ledger. The newest line stored is the cursor: a restart never
//   stores a line twice or skips one.
// - what the Sprites API said (observations.jsonl): each change of status,
//   and the wake and pause times the API reports, so a stretch the Console did
//   not see still lands where it happened.
//
// Nothing here wakes a drive: pull() is called only for sprites the API says
// are running.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBill } from './bill.js';
import { RATES, calibrate, coldCost, lineCost, lineUse, project, sum, total } from './cost.js';
import { reason, segments } from './timeline.js';

export const READER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ledger-read.mjs');
const REMOTE = '/tmp/marble-ledger-read.mjs';
const H = 60 * 60 * 1000;
const DAY = 24 * H;
const KEEP_DAYS = 90;
// A drive with no ledger yet, seen running by the API, is costed as a typical
// awake minute: half a GB above Fly's floor is too little for a host, so 2 GB.
const TYPICAL = { cpuPerSecond: 0.05, mem: 2, disk: 5 };
const RANGES = { '24h': { ms: DAY, step: 5 * 60_000 }, '7d': { ms: 7 * DAY, step: H }, '30d': { ms: 30 * DAY, step: H } };

const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const roleOf = (labels = []) => (labels.includes('marble-owner') ? 'owner' : labels.some((l) => l === 'marble-tester' || l === 'marble-user') ? 'user' : 'other');
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// Today alone is scaled to a day only once it holds this much: an hour after a
// deploy is a restart's burst and every tab reconnecting, not a day.
const TODAY_ENOUGH = 6 * H;

/**
 * The use of each of the last seven full days since anything was recorded, a
 * day with nothing counting as zero. With no full day yet, today so far,
 * scaled to a day, once there are six hours of it.
 */
export function recentDays(byDay, firstMs, now) {
  const zero = { cpuH: 0, ramGBh: 0, hotGBh: 0 };
  const today = Date.parse(`${dayOf(now)}T00:00:00Z`);
  const out = [];
  for (let d = today - 7 * DAY; d < today; d += DAY) if (d >= firstMs) out.push(byDay.get(dayOf(d)) ?? zero);
  if (out.length || !Number.isFinite(firstMs)) return out;
  const since = Math.max(firstMs, today);
  if (now - since < TODAY_ENOUGH) return [];
  const u = byDay.get(dayOf(now)) ?? zero;
  const k = DAY / (now - since);
  return [{ cpuH: u.cpuH * k, ramGBh: u.ramGBh * k, hotGBh: u.hotGBh * k }];
}

export function createUsage({ dir, sprites, self, selfLedger = null, now = Date.now, basis = 'mem', log = console }) {
  const cache = new Map(); // name → { lines, observations }
  const pulling = new Map(); // name → Promise
  let bills = null;
  let budget;

  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    const own = path.join(dir, name);
    const lines = [];
    const observations = [];
    const oldest = monthOf(now() - KEEP_DAYS * DAY);
    let names = [];
    try {
      names = (await fsp.readdir(own)).sort();
    } catch {}
    for (const file of names) {
      const m = /^(\d{4}-\d{2})\.jsonl$/.exec(file);
      const isObs = file === 'observations.jsonl';
      if (!m && !isObs) continue;
      if (m && m[1] < oldest) continue;
      const text = await fsp.readFile(path.join(own, file), 'utf8').catch(() => '');
      for (const raw of text.split('\n')) {
        if (!raw) continue;
        try {
          (isObs ? observations : lines).push(JSON.parse(raw));
        } catch {}
      }
    }
    lines.sort((a, b) => a.t - b.t);
    observations.sort((a, b) => a.t - b.t);
    const entry = { lines, observations };
    cache.set(name, entry);
    return entry;
  }

  async function append(name, file, items) {
    if (!items.length) return;
    await fsp.mkdir(path.join(dir, name), { recursive: true });
    await fsp.appendFile(path.join(dir, name, file), items.map((i) => JSON.stringify(i)).join('\n') + '\n');
  }

  /** Record what the API says now. Returns the changes, for the live stream. */
  async function observe(rows) {
    const changes = [];
    for (const row of rows) {
      const entry = await load(row.name);
      const obs = entry.observations;
      let last = obs.at(-1) ?? null;
      const fresh = [];
      const add = (t, status) => {
        if (!Number.isFinite(t) || t > now() + 60_000) return;
        if (last && (t <= last.t || status === last.status)) return;
        last = { t, status };
        fresh.push(last);
      };
      // When it last woke and last paused, even if nobody was watching then.
      [
        { t: Date.parse(row.ranAt ?? ''), status: 'running' },
        { t: Date.parse(row.pausedAt ?? ''), status: 'warm' },
      ].filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t).forEach((p) => add(p.t, p.status));
      if (row.status && (!last || last.status !== row.status)) add(now(), row.status);
      if (!fresh.length) continue;
      obs.push(...fresh);
      await append(row.name, 'observations.jsonl', fresh).catch((err) => log.error?.(`[usage] ${err.message}`));
      for (const f of fresh) changes.push({ sprite: row.name, ...f });
    }
    return changes;
  }

  async function fetchLines(name, since) {
    if (name === self && selfLedger) return { lines: await selfLedger.read(since), more: false };
    const { stdout } = await sprites.exec(name, ['node', REMOTE, String(since)], { files: [[READER, REMOTE]], timeout: 60_000 });
    const rows = stdout.split('\n').filter(Boolean);
    const at = rows.findIndex((r) => r.startsWith('{"ledger"'));
    if (at < 0) return { lines: [], more: false };
    const head = JSON.parse(rows[at]);
    const lines = [];
    for (const raw of rows.slice(at + 1)) {
      try {
        lines.push(JSON.parse(raw));
      } catch {}
    }
    return { lines, more: Boolean(head.more) };
  }

  /** New ledger lines from one drive, stored once. Only for a running sprite. */
  function pull(name) {
    if (pulling.has(name)) return pulling.get(name);
    const run = (async () => {
      const entry = await load(name);
      const got = [];
      for (let round = 0; round < 20; round += 1) {
        const cursor = entry.lines.at(-1)?.t ?? 0;
        const { lines, more } = await fetchLines(name, cursor);
        const fresh = lines.filter((l) => Number.isFinite(l?.t) && l.t > cursor).sort((a, b) => a.t - b.t);
        const byMonth = new Map();
        for (const line of fresh) {
          const month = monthOf(line.t * 1000);
          if (!byMonth.has(month)) byMonth.set(month, []);
          byMonth.get(month).push(line);
        }
        for (const [month, items] of byMonth) await append(name, `${month}.jsonl`, items);
        entry.lines.push(...fresh);
        got.push(...fresh);
        if (!more || !fresh.length) break;
      }
      return got;
    })().finally(() => pulling.delete(name));
    pulling.set(name, run);
    return run;
  }

  // ------------------------------------------------------------ answers

  function covered(lines) {
    const out = [];
    for (const l of lines) {
      const b = l.t * 1000;
      const a = b - (Number(l.dt) || 0) * 1000;
      const last = out.at(-1);
      if (last && a - last[1] <= 90_000) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  }

  /** Minutes the API saw running that no ledger line covers, as typical lines. */
  function estimated(entry, from, to) {
    const { lines, observations } = entry;
    const typical = {
      cpuPerSecond: median(lines.map((l) => (l.dt ? l.cpu / l.dt : null))) ?? TYPICAL.cpuPerSecond,
      mem: median(lines.map((l) => l[basis] ?? l.mem)) ?? TYPICAL.mem,
      disk: lines.findLast?.((l) => l.disk)?.disk ?? TYPICAL.disk,
    };
    const have = covered(lines);
    const out = [];
    for (let i = 0; i < observations.length; i += 1) {
      if (observations[i].status !== 'running') continue;
      const a = Math.max(from, observations[i].t);
      const b = Math.min(to, observations[i + 1]?.t ?? to);
      for (let t = a + 60_000; t <= b; t += 60_000) {
        if (have.some(([x, y]) => t - 30_000 >= x && t - 30_000 < y)) continue;
        out.push({ t: t / 1000, dt: 60, cpu: typical.cpuPerSecond * 60, mem: typical.mem, used: typical.mem, disk: typical.disk, why: {}, est: true });
      }
    }
    return out;
  }

  function lastDisk(entry) {
    return entry.lines.findLast?.((l) => l.disk)?.disk ?? null;
  }

  async function allNames(rows) {
    const names = new Set(rows.map((r) => r.name));
    try {
      for (const n of await fsp.readdir(dir)) if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(n)) names.add(n);
    } catch {}
    return [...names];
  }

  async function readBills() {
    if (bills) return bills;
    const text = await fsp.readFile(path.join(dir, 'bills.jsonl'), 'utf8').catch(() => '');
    bills = text.split('\n').filter(Boolean).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
    return bills;
  }

  async function readBudget() {
    if (budget !== undefined) return budget;
    const saved = await fsp.readFile(path.join(dir, 'budget.json'), 'utf8').then(JSON.parse, () => null);
    budget = Number.isFinite(saved?.monthly) ? saved.monthly : null;
    return budget;
  }

  /** The dashboard's data for a range: '24h', '7d', '30d' or 'month'. */
  async function query({ range = '7d', rows = [] } = {}) {
    const t = now();
    const monthStart = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1);
    const spec = RANGES[range] ?? (range === 'month' ? { ms: t - monthStart, step: H } : RANGES['7d']);
    const to = t;
    const from = range === 'month' ? monthStart : t - spec.ms;
    const step = spec.step;
    const byName = new Map(rows.map((r) => [r.name, r]));
    const names = await allNames(rows);
    const entries = new Map();
    for (const name of names) entries.set(name, await load(name));

    // Calibration from the newest bill: what the ledger says that range cost.
    const bill = (await readBills()).at(-1) ?? null;
    let factor = {};
    let calibration = null;
    if (bill) {
      const est = sum([...entries.values()].flatMap((e) => [...e.lines, ...estimated(e, bill.from, bill.to)]
        .filter((l) => l.t * 1000 > bill.from && l.t * 1000 <= bill.to)
        .map((l) => lineCost(l, { basis }))));
      factor = calibrate(est, bill.products);
      calibration = { factor, bill, estimate: est };
    }
    const options = { basis, factor };

    let firstMs = Infinity;
    const sprites = [];
    const monthDays = new Map(); // day → { name → $ }
    const recentUse = new Map(); // day → { cpuH, ramGBh, hotGBh }
    let coldPerDay = 0;
    for (const name of names) {
      const entry = entries.get(name);
      const row = byName.get(name);
      const earliest = Math.min(from, monthStart, t - 8 * DAY);
      const lines = [...entry.lines, ...estimated(entry, earliest, to)]
        .filter((l) => l.t * 1000 > earliest && l.t * 1000 <= to)
        .sort((a, b) => a.t - b.t);
      if (!row && !lines.length) continue;
      if (lines.length) firstMs = Math.min(firstMs, (lines[0].t - (Number(lines[0].dt) || 0)) * 1000);
      const inRange = lines.filter((l) => l.t * 1000 > from);

      const buckets = new Map();
      const totals = { cost: { cpu: 0, ram: 0, hot: 0, cold: 0 }, awakeHours: 0, estimatedHours: 0, why: { looking: 0, idle: 0, work: 0, asks: 0, other: 0, unrecorded: 0 }, turns: 0, opens: 0 };
      for (const line of inRange) {
        const c = lineCost(line, options);
        const key = Math.floor((line.t * 1000 - 1) / step) * step;
        const b = buckets.get(key) ?? { t: key, awake: 0, cpu: 0, memS: 0, memN: 0, cost: 0, why: { looking: 0, idle: 0, work: 0, asks: 0, other: 0, unrecorded: 0 }, turns: 0, opens: 0, est: 0 };
        const dt = Number(line.dt) || 0;
        b.awake += dt;
        b.cpu += Number(line.cpu) || 0;
        const mem = line[basis] ?? line.mem;
        if (mem !== null && mem !== undefined) {
          b.memS += mem * dt;
          b.memN += dt;
        }
        b.cost += total(c);
        b.why[reason(line)] += dt;
        b.turns += line.turns ?? 0;
        b.opens += line.opens ?? 0;
        if (line.est) b.est += dt;
        buckets.set(key, b);
        for (const k of ['cpu', 'ram', 'hot']) totals.cost[k] += c[k];
        totals.awakeHours += dt / 3600;
        if (line.est) totals.estimatedHours += dt / 3600;
        totals.why[reason(line)] += dt;
        totals.turns += line.turns ?? 0;
        totals.opens += line.opens ?? 0;
      }
      const disk = lastDisk(entry) ?? (lines.length ? TYPICAL.disk : 0);
      totals.cost.cold = coldCost(disk, Math.max(from, entry.lines[0] ? entry.lines[0].t * 1000 : from), to);
      totals.total = total(totals.cost);
      coldPerDay += coldCost(disk, t, t + DAY);

      // The month, day by day, and the last seven full days' use.
      for (const line of lines) {
        const ms = line.t * 1000;
        const day = dayOf(ms);
        if (ms > monthStart) {
          const d = monthDays.get(day) ?? {};
          d[name] = (d[name] ?? 0) + total(lineCost(line, options));
          monthDays.set(day, d);
        }
        if (ms > Date.parse(`${dayOf(t)}T00:00:00Z`) - 7 * DAY) {
          const u = lineUse(line, { basis });
          const r = recentUse.get(day) ?? { cpuH: 0, ramGBh: 0, hotGBh: 0 };
          r.cpuH += u.cpuH;
          r.ramGBh += u.ramGBh;
          r.hotGBh += u.hotGBh;
          recentUse.set(day, r);
        }
      }

      sprites.push({
        name,
        role: row ? roleOf(row.labels) : 'gone',
        createdAt: row?.createdAt ?? null,
        status: row?.status ?? null,
        awake: Boolean(row?.awake),
        hasLedger: entry.lines.length > 0,
        segments: segments({ lines: inRange, observations: entry.observations, from, to, options }),
        buckets: [...buckets.values()].sort((a, b) => a.t - b.t).map(({ memS, memN, cpu, ...b }) => ({
          ...b,
          cpu: b.awake ? cpu / b.awake : 0,
          mem: memN ? memS / memN : null,
        })),
        totals,
      });
    }
    const order = { owner: 0, user: 1, other: 2, gone: 3 };
    sprites.sort((a, b) => order[a.role] - order[b.role] || String(a.createdAt ?? '9').localeCompare(String(b.createdAt ?? '9')) || a.name.localeCompare(b.name));

    const days = [...monthDays.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, bySprite]) => ({
      day,
      bySprite,
      total: Object.values(bySprite).reduce((a, b) => a + b, 0),
    }));
    // Cold storage accrues whether or not anything ran.
    const monthCold = sprites.reduce((a, s) => a + coldCost(lastDisk(entries.get(s.name)) ?? 0, monthStart, t), 0);
    const spent = days.reduce((a, d) => a + d.total, 0) + monthCold;
    const recent = recentDays(recentUse, firstMs, t);
    const projection = { ...project({ spent, recent, now: t, factor, coldPerDay }), days: recent.length };

    const all = sum(sprites.map((s) => s.totals.cost));
    return {
      now: t,
      range,
      from,
      to,
      step,
      basis,
      rates: RATES,
      calibration,
      budget: await readBudget(),
      sprites,
      totals: { cost: all, total: total(all), awakeHours: sprites.reduce((a, s) => a + s.totals.awakeHours, 0) },
      month: { from: monthStart, days, spent, cold: monthCold, projection },
    };
  }

  async function addBill(text) {
    const result = parseBill(text);
    if (!result.ok) return result;
    const list = await readBills();
    const entry = { ...result.bill, pastedAt: now() };
    list.push(entry);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.appendFile(path.join(dir, 'bills.jsonl'), `${JSON.stringify(entry)}\n`);
    return { ok: true, bill: entry };
  }

  async function setBudget(monthly) {
    const value = monthly === null || monthly === '' || monthly === undefined ? null : Number(monthly);
    if (value !== null && !(Number.isFinite(value) && value >= 0 && value < 1e6)) throw Object.assign(new Error('a budget is a number of dollars'), { status: 400 });
    budget = value;
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'budget.json'), JSON.stringify({ monthly: value }));
    return value;
  }

  return { observe, pull, query, addBill, setBudget, bills: readBills, budget: readBudget };
}
