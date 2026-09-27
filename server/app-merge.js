// A three-way merge of lines, for bringing a newer template into a document
// someone has been living in.
//
// The base is the template the document was built from, the ours is the
// document as it is now, and the theirs is the template as it ships today.
// Where only one side moved, that side wins; where both moved the same lines
// the same way, that is one change; where both moved them differently, the
// merge says so and writes nothing — a page half one version and half the
// other is worse than a page that is a version behind.
//
// Lines are compared with their element ids masked, because a document and a
// fresh build of the same template share every line and no id: the ids were
// minted separately. Every output line remembers where it came from, so a line
// the document already had keeps the document's ids, and only a line the
// template brought is new.

const ID_ATTR = /data-marble-id="([^"]*)"/g;
const MASK = 'data-marble-id="\u0000"';

export const mask = (line) => line.replace(ID_ATTR, MASK);
export const idsOf = (line) => [...line.matchAll(ID_ATTR)].map((m) => m[1]);

/** Lines, keeping the newline with each so a join gives back the bytes. */
export const splitLines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

// ---------------------------------------------------------------------- diff

/** Integer codes for lines, so comparisons are cheap and one table serves
 *  every side of a merge. */
function encoder() {
  const table = new Map();
  return (lines) =>
    Int32Array.from(lines, (line) => {
      let code = table.get(line);
      if (code === undefined) table.set(line, (code = table.size));
      return code;
    });
}

/** Myers' O(ND), for the small gaps between anchors. Returns matched pairs, or
 *  null when the gap is too different to be worth an exact answer. */
function myers(a, a0, a1, b, b0, b1, limit) {
  const n = a1 - a0;
  const m = b1 - b0;
  const max = Math.min(n + m, limit);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m, a0, b0);
    }
  }
  return null;
}

function backtrack(trace, dEnd, n, m, a0, b0) {
  const pairs = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d > 0; d--) {
    const row = trace[d]; // v at the start of step d, covering k in [-d-1, d+1]
    const at = (k) => row[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; pairs.push([a0 + x, b0 + y]); }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { x--; y--; pairs.push([a0 + x, b0 + y]); }
  return pairs.reverse();
}

/** The longest increasing run of `seq[i][1]`, by patience sorting. */
function lis(seq) {
  const tails = [];
  const prev = new Array(seq.length);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]][1] < seq[i][1]) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const out = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.push(seq[i]);
  return out.reverse();
}

/**
 * Matched line pairs between two coded sequences: trim what they share at both
 * ends, anchor on lines that occur once on each side (patience), and let
 * Myers fill each gap between anchors. A gap too different for Myers is left
 * unmatched, which only ever makes a merge more careful, never wrong.
 */
function match(a, a0, a1, b, b0, b1, out, limit) {
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) out.push([a0++, b0++]);
  const tail = [];
  while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) tail.push([--a1, --b1]);
  if (a0 < a1 && b0 < b1) {
    const count = new Map();
    for (let i = a0; i < a1; i++) {
      const c = count.get(a[i]) ?? [0, 0, -1];
      c[0]++; c[2] = i;
      count.set(a[i], c);
    }
    for (let j = b0; j < b1; j++) {
      const c = count.get(b[j]);
      if (c) { c[1]++; c[3] = j; }
    }
    const unique = [];
    for (const c of count.values()) if (c[0] === 1 && c[1] === 1) unique.push([c[2], c[3]]);
    unique.sort((p, q) => p[0] - q[0]);
    const anchors = lis(unique);
    if (anchors.length) {
      let i = a0;
      let j = b0;
      for (const [ai, bj] of anchors) {
        match(a, i, ai, b, j, bj, out, limit);
        out.push([ai, bj]);
        i = ai + 1;
        j = bj + 1;
      }
      match(a, i, a1, b, j, b1, out, limit);
    } else {
      const pairs = myers(a, a0, a1, b, b0, b1, limit);
      if (pairs) for (const p of pairs) out.push(p);
    }
  }
  for (let i = tail.length - 1; i >= 0; i--) out.push(tail[i]);
  return out;
}

export function diffLines(aLines, bLines, { limit = 2000 } = {}) {
  const code = encoder();
  const a = code(aLines);
  const b = code(bLines);
  return match(a, 0, a.length, b, 0, b.length, [], limit);
}

/** Hunks of `a → b`: [aStart, aEnd) of a became [bStart, bEnd) of b. */
function hunksOf(pairs, aLen, bLen) {
  const hunks = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of [...pairs, [aLen, bLen]]) {
    if (ai > i || bj > j) hunks.push({ aStart: i, aEnd: ai, bStart: j, bEnd: bj });
    i = ai + 1;
    j = bj + 1;
  }
  return hunks;
}

// ---------------------------------------------------------------------- merge

/**
 * Merge `theirs` into `ours` relative to `base`. All three are arrays of lines;
 * comparison is on masked lines. Returns { lines, conflicts, changed }, where
 * each output line is `{ line, from: 'ours'|'theirs', at, replaced? }`.
 */
export function merge3(base, ours, theirs) {
  const code = encoder();
  const B = code(base.map(mask));
  const O = code(ours.map(mask));
  const T = code(theirs.map(mask));
  const toOurs = hunksOf(match(B, 0, B.length, O, 0, O.length, [], 2000), B.length, O.length).map((h) => ({ ...h, side: 'ours' }));
  const toTheirs = hunksOf(match(B, 0, B.length, T, 0, T.length, [], 2000), B.length, T.length).map((h) => ({ ...h, side: 'theirs' }));

  // A base line both sides left alone sits at a known place in ours.
  const all = [...toOurs, ...toTheirs].sort((p, q) => p.aStart - q.aStart || p.aEnd - q.aEnd);
  const out = [];
  const conflicts = [];
  let changed = 0;
  let b = 0; // next base line not yet written
  let o = 0; // the ours line that base line b sits at
  const emitOurs = (from, to) => { for (let k = from; k < to; k++) out.push({ line: ours[k], from: 'ours', at: k }); };

  for (let g = 0; g < all.length; ) {
    // A group: hunks whose base ranges overlap or touch. Touching counts,
    // because two edits that meet at a line are edits to one place.
    let start = all[g].aStart;
    let end = all[g].aEnd;
    const group = [all[g++]];
    while (g < all.length && all[g].aStart <= end) { end = Math.max(end, all[g].aEnd); group.push(all[g++]); }

    emitOurs(o, o + (start - b));
    o += start - b;

    const span = (side) => {
      const mine = group.filter((h) => h.side === side);
      if (!mine.length) return null;
      const first = mine[0];
      const last = mine[mine.length - 1];
      return [first.bStart - (first.aStart - start), last.bEnd + (end - last.aEnd)];
    };
    const oSpan = span('ours') ?? [o, o + (end - start)];
    const tSpan = span('theirs');

    if (!tSpan) {
      emitOurs(oSpan[0], oSpan[1]);
    } else if (!group.some((h) => h.side === 'ours')) {
      // Only the template moved here: its lines, remembering which of ours
      // they replace so an element that survived the edit can keep its id.
      for (let k = tSpan[0]; k < tSpan[1]; k++) out.push({ line: theirs[k], from: 'theirs', at: k, replaced: [oSpan[0], oSpan[1]] });
      changed++;
    } else {
      const oCodes = O.subarray(oSpan[0], oSpan[1]);
      const tCodes = T.subarray(tSpan[0], tSpan[1]);
      const same = oCodes.length === tCodes.length && oCodes.every((c, k) => c === tCodes[k]);
      if (same) emitOurs(oSpan[0], oSpan[1]);
      else conflicts.push({ base: [start, end], ours: oSpan, theirs: tSpan });
    }
    o = oSpan[1];
    b = end;
  }
  emitOurs(o, ours.length);
  return { lines: out, conflicts, changed };
}

// ------------------------------------------------------------------- the ids

const TAG_CLASS = /^\s*<([a-zA-Z][\w-]*)\b[^>]*?\bclass="([^"]*)"/;
const keyOf = (line) => {
  const m = TAG_CLASS.exec(line);
  return m ? `${m[1]}.${m[2]}` : null;
};

/**
 * The merged text, with ids settled: a line from ours keeps its ids; a line the
 * template rewrote keeps the id of the element it rewrote when the tag and
 * class still match; anything else keeps the fresh build's id unless that is
 * already taken, in which case it gets a new one.
 */
export function settleIds(merged, ours, newId) {
  const taken = new Set();
  for (const part of merged) if (part.from === 'ours') for (const id of idsOf(part.line)) taken.add(id);
  const pools = new Map();
  const poolFor = ([from, to]) => {
    const key = `${from}:${to}`;
    if (!pools.has(key)) {
      const pool = new Map();
      for (let k = from; k < to; k++) {
        const ids = idsOf(ours[k]);
        const tagKey = keyOf(ours[k]);
        if (ids.length === 1 && tagKey) {
          if (!pool.has(tagKey)) pool.set(tagKey, []);
          pool.get(tagKey).push(ids[0]);
        }
      }
      pools.set(key, pool);
    }
    return pools.get(key);
  };
  const fresh = () => {
    let id;
    do id = newId(); while (taken.has(id));
    taken.add(id);
    return id;
  };

  let carried = 0;
  const text = merged
    .map((part) => {
      if (part.from === 'ours') return part.line;
      const ids = idsOf(part.line);
      if (!ids.length) return part.line;
      let reuse = null;
      if (ids.length === 1 && part.replaced) {
        const tagKey = keyOf(part.line);
        const list = tagKey && poolFor(part.replaced).get(tagKey);
        // Only an id no kept line holds: an element the template rewrote,
        // whose old line is gone from the output.
        while (list && list.length && !reuse) {
          const id = list.shift();
          if (!taken.has(id)) reuse = id;
        }
        if (reuse) taken.add(reuse);
      }
      let i = 0;
      return part.line.replace(ID_ATTR, (_, id) => {
        const next = i++ === 0 && reuse ? (carried++, reuse) : taken.has(id) ? fresh() : (taken.add(id), id);
        return `data-marble-id="${next}"`;
      });
    })
    .join('');
  return { text, carried };
}
