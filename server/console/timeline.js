// A sprite's state over time: running, warm (paused), cold (stopped), or
// unknown, from two kinds of evidence.
//
// - Its ledger (server/ledger.js): every minute it was awake, exactly. A gap
//   between minutes was sleep, and the minute after says how it woke: "warm"
//   (frozen and resumed) or "cold" (it booted, so it was stopped some time in
//   the gap; when is not known).
// - What the Console saw of the Sprites API: a status and when it changed.
//   These say warm or cold for certain, but only while someone was watching.
//
// Layered, most certain on top: the ledger's running minutes, then what was
// observed, then what the ledger implies about its gaps, then unknown.

import { lineCost, total } from './cost.js';

// Two ledger minutes this close are one stretch awake (a line can land a few
// seconds late, and a restart takes a moment).
const JOIN_MS = 90_000;

function runs(lines, options) {
  const out = [];
  for (const line of lines) {
    const end = line.t * 1000;
    const start = end - (Number(line.dt) || 0) * 1000;
    const last = out.at(-1);
    const woke = line.wake === 'warm' || line.wake === 'cold';
    if (last && !woke && start - last.to <= JOIN_MS) {
      last.to = Math.max(last.to, end);
      last.lines.push(line);
    } else out.push({ from: start, to: end, wake: line.wake ?? null, lines: [line] });
  }
  for (const run of out) run.options = options;
  return out;
}

/** Details of a running stretch, for its tooltip. */
function detail(lines, options) {
  let cost = 0;
  let peak = null;
  const why = { looking: 0, idle: 0, work: 0, asks: 0, other: 0, unrecorded: 0 };
  for (const line of lines) {
    cost += total(lineCost(line, options));
    const mem = line[options.basis ?? 'mem'] ?? line.mem ?? line.used;
    if (mem !== null && mem !== undefined) peak = Math.max(peak ?? 0, mem);
    why[reason(line)] += Number(line.dt) || 0;
  }
  return { cost, peakMem: peak, why };
}

/** The one reason a minute was awake, most telling first. */
export function reason(line) {
  // A minute the Console saw from the API but no ledger recorded.
  if (line.est) return 'unrecorded';
  const w = line.why ?? {};
  if (w.looking > 0) return 'looking';
  if (w.work > 0) return 'work';
  if (w.asks > 0) return 'asks';
  if (w.tabs > 0) return 'idle';
  return 'other';
}

export function segments({ lines = [], observations = [], from, to, options = {} }) {
  if (!(to > from)) return [];
  const layers = [];

  // Bottom: what the ledger implies about the time between its stretches.
  const stretches = runs(lines, options);
  const gaps = [];
  for (let i = 1; i < stretches.length; i += 1) {
    const prev = stretches[i - 1];
    const next = stretches[i];
    if (next.from <= prev.to) continue;
    if (next.wake === 'warm') gaps.push({ from: prev.to, to: next.from, state: 'warm', source: 'ledger' });
    else if (next.wake === 'cold') gaps.push({ from: prev.to, to: next.from, state: 'cold', coldEdge: true, source: 'ledger' });
  }
  layers.push(gaps);

  // Then what was seen: each status holds until the next one seen.
  const seen = [...observations].sort((a, b) => a.t - b.t);
  const observed = [];
  for (let i = 0; i < seen.length; i += 1) {
    const end = i + 1 < seen.length ? seen[i + 1].t : to;
    if (end > seen[i].t) observed.push({ from: seen[i].t, to: end, state: seen[i].status === 'running' ? 'running' : seen[i].status === 'cold' ? 'cold' : 'warm', source: 'observed' });
  }
  layers.push(observed);

  // Top: the ledger's own minutes.
  layers.push(stretches.map((s) => ({ from: s.from, to: s.to, state: 'running', source: 'ledger', lines: s.lines })));

  const points = new Set([from, to]);
  for (const layer of layers) {
    for (const s of layer) {
      if (s.from > from && s.from < to) points.add(s.from);
      if (s.to > from && s.to < to) points.add(s.to);
    }
  }
  const cuts = [...points].sort((a, b) => a - b);
  const top = (mid) => {
    for (let l = layers.length - 1; l >= 0; l -= 1) {
      const hit = layers[l].find((s) => s.from <= mid && mid < s.to);
      if (hit) return hit;
    }
    return null;
  };

  const out = [];
  for (let i = 1; i < cuts.length; i += 1) {
    const a = cuts[i - 1];
    const b = cuts[i];
    const hit = top((a + b) / 2);
    const state = hit?.state ?? 'unknown';
    const source = hit?.source ?? null;
    const last = out.at(-1);
    if (last && last.state === state && last.source === source && last.hit === hit) {
      last.to = b;
      continue;
    }
    // A running stretch the ledger saw and one the API saw are the same state;
    // join them rather than draw a seam.
    if (last && last.state === state && state !== 'unknown' && last.to === a && !(hit?.coldEdge)) {
      last.to = b;
      last.hit = hit;
      if (hit?.lines) last.lines = [...new Set([...(last.lines ?? []), ...hit.lines])];
      if (source === 'ledger') last.source = 'ledger';
      continue;
    }
    out.push({ from: a, to: b, state, source, hit, ...(hit?.coldEdge ? { coldEdge: true } : {}), ...(hit?.lines ? { lines: [...hit.lines] } : {}) });
  }
  return out.map(({ hit, lines: ls, ...s }) => {
    if (s.state !== 'running' || !ls?.length) return s;
    const inside = ls.filter((l) => l.t * 1000 > s.from && l.t * 1000 <= s.to + 1);
    return { ...s, ...detail(inside, options) };
  });
}
