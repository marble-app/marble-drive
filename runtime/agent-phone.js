// Pure helpers for the Agents document on a phone: which band a conversation
// belongs in, what an ask card shows cold, and the fisheye that lays Focus
// out as one column. Classic IIFE so the host can inject it as a script tag;
// Node tests import it for its side effect.

(() => {
  // ------------------------------------------------------------ bands
  //
  // Deck orders by how much a conversation wants you. Every summary lands in
  // exactly one band, derived from what summarize() already publishes.

  const bandOf = (summary) => {
    if (!summary || summary.archived) return null;
    if (summary.asking) return 'asks';
    if (summary.running || summary.queued || summary.status === 'running') return 'running';
    if (summary.needsReview) return 'review';
    return 'idle';
  };

  const bandCompare = (band) => {
    if (band === 'asks') return (a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
    if (band === 'review') return (a, b) => (b.lastFinishedAt ?? b.updatedAt ?? 0) - (a.lastFinishedAt ?? a.updatedAt ?? 0);
    return (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  };

  // ------------------------------------------------------------ asks

  const LEAD_TYPES = new Set(['text', 'tool.call']);

  /** The last two things the agent said or did before it asked. */
  const askLead = (events, askSeq) => events
    .filter((event) => event.seq < askSeq && LEAD_TYPES.has(event.type))
    .slice(-2)
    .map((event) => (event.type === 'text'
      ? { type: 'text', text: String(event.text ?? '') }
      : { type: 'tool.call', name: event.name, input: event.input ?? {} }));

  const PEEK_LINES = 6;

  /** Enough to answer without opening the conversation. */
  const peekOf = (request) => {
    const input = request?.input ?? {};
    if (request?.kind === 'question') {
      return { title: String(input.questions?.[0]?.question ?? 'A question'), detail: '', lines: [] };
    }
    const title = String(request?.displayName || request?.tool || 'Tool');
    const detail = String(input.command ?? input.file_path ?? input.path ?? input.url ?? input.pattern ?? '');
    const body = typeof input.new_string === 'string' ? input.new_string : typeof input.content === 'string' ? input.content : '';
    const lines = body ? body.split('\n').slice(0, PEEK_LINES) : [];
    return { title, detail, lines };
  };

  // ------------------------------------------------------------ the fisheye
  //
  // One scalar, `focal`, lays out the whole column. A card's tier is its
  // distance from focal: 0 full, 1 digest, 2 chip, 3+ sliver, linear between.
  // The Full takes whatever the neighbours leave, so heights always sum to
  // the room and a smaller room only ever shrinks the Full.

  const TIERS = { full: null, digest: 112, chip: 44, sliver: 10 };
  const SLIVER_OVERLAP = 2;
  const LADDER = [TIERS.digest, TIERS.chip, TIERS.sliver]; // heights at d = 1, 2, 3

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Height of a neighbour at distance d (d ≥ 1). */
  const neighbourHeight = (d) => {
    if (d >= 3) return TIERS.sliver;
    if (d <= 1) return TIERS.digest;
    const lo = Math.floor(d);
    const t = d - lo;
    return LADDER[lo - 1] + (LADDER[lo] - LADDER[lo - 1]) * t;
  };

  const lodOf = (d) => (d < 0.5 ? 'full' : d < 1.5 ? 'digest' : d < 2.5 ? 'chip' : 'sliver');

  function fisheye(count, focal, room) {
    if (!count) return [];
    const f = clamp(focal, 0, count - 1);
    const lo = Math.floor(f);
    const hi = Math.min(count - 1, lo + 1);
    const t = f - lo;
    const heights = new Array(count);
    let used = 0;
    for (let i = 0; i < count; i += 1) {
      if (i === lo || i === hi) continue;
      heights[i] = neighbourHeight(Math.abs(i - f));
      used += heights[i];
    }
    const full = room - used;
    if (lo === hi) {
      heights[lo] = Math.max(TIERS.digest, full);
    } else {
      // Between two integers the pair nearest focal shares what a Full and a
      // digest would take together; t decides the split, so at t = 0 the
      // lower card is exactly the Full it was and the hand-off is linear.
      const pair = Math.max(TIERS.digest * 2, full);
      const share = pair - TIERS.digest * 2;
      heights[lo] = TIERS.digest + share * (1 - t);
      heights[hi] = TIERS.digest + share * t;
    }
    // Slivers overlap so a run of them reads as a deck edge-on.
    const cards = [];
    let top = 0;
    for (let i = 0; i < count; i += 1) {
      const d = Math.abs(i - f);
      const lod = lodOf(d);
      const prevSliver = i > 0 && lodOf(Math.abs(i - 1 - f)) === 'sliver';
      if (lod === 'sliver' && prevSliver) top -= SLIVER_OVERLAP;
      cards.push({ top, height: heights[i], lod, d });
      top += heights[i];
    }
    // Overlaps freed a little room; the Full takes it so the column still
    // ends exactly at the bottom.
    const slack = room - top;
    if (slack !== 0) {
      const target = lo === hi ? lo : (t < 0.5 ? lo : hi);
      cards[target].height += slack;
      for (let i = target + 1; i < count; i += 1) cards[i].top += slack;
    }
    return cards;
  }

  /** The focal that puts card `index` at `top`. Moving focal down moves every
   *  card up, so the layout is monotone in focal and a bisection finds it. */
  function focalFor(index, top, count, room) {
    if (count < 2) return 0;
    let lo = 0;
    let hi = count - 1;
    for (let n = 0; n < 40; n += 1) {
      const mid = (lo + hi) / 2;
      const placed = fisheye(count, mid, room)[index].top;
      if (placed > top) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ------------------------------------------------------------ the spring
  //
  // The desk's spring (agent-ui.js) is critically damped and lives on rAF.
  // This is the same integrator as a pure step, with the damping ratio as a
  // parameter, so a flick can overshoot and a tap cannot.

  const stepSpring = (state, target, dt, { damping = 1, response = 0.4 } = {}) => {
    const omega = (2 * Math.PI) / response;
    const step = Math.min(0.032, Math.max(0.0005, dt));
    let { x, v } = state;
    v += (-omega * omega * (x - target) - 2 * damping * omega * v) * step;
    x += v * step;
    const settled = Math.abs(x - target) < 0.0005 && Math.abs(v) < 0.01;
    return settled ? { x: target, v: 0, settled: true } : { x, v, settled: false };
  };

  /** Where a released gesture would come to rest (Apple's projection). */
  const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

  globalThis.marbleAgentPhone = { bandOf, bandCompare, askLead, peekOf, TIERS, SLIVER_OVERLAP, fisheye, focalFor, stepSpring, project };
})();
