// The arithmetic under the marks toolbar, kept apart from the DOM so it can
// be tested in node: what a rectangle means on a page of addressed boxes,
// where a thrown toolbar lands, and the spring that carries it there.
//
// Loaded in the browser before agent-marks.js, and imported in node by the
// tests; it touches neither window nor document.

(() => {
  const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);

  /** The share of `box` that lies inside `rect`, 0 to 1. */
  const coverage = (rect, box) => {
    const whole = area(box);
    if (!whole) return 0;
    const left = Math.max(rect.left, box.left);
    const top = Math.max(rect.top, box.top);
    const right = Math.min(rect.left + rect.width, box.left + box.width);
    const bottom = Math.min(rect.top + rect.height, box.top + box.height);
    if (right <= left || bottom <= top) return 0;
    return ((right - left) * (bottom - top)) / whole;
  };

  /** Every addressed box the rectangle means, said once, in document order.
   *  Candidates are boxes covered by `threshold` of their area or more.
   *  Leaves are the deepest candidates. A candidate parent replaces its
   *  children only when every addressed child is chosen — a rect across a
   *  whole list is the list; a rect across one item is that item. */
  const idsInRect = (rect, boxes, { threshold = 0.6 } = {}) => {
    const order = new Map(boxes.map((box, i) => [box.id, i]));
    const byId = new Map(boxes.map((box) => [box.id, box]));
    const children = new Map();
    for (const box of boxes) {
      if (!box.parent) continue;
      if (!children.has(box.parent)) children.set(box.parent, []);
      children.get(box.parent).push(box.id);
    }
    const under = (id, ancestor) => {
      for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) if (p === ancestor) return true;
      return false;
    };
    const candidates = new Set(boxes.filter((box) => coverage(rect, box) >= threshold).map((box) => box.id));
    let chosen = [...candidates].filter((id) => ![...candidates].some((other) => other !== id && under(other, id)));
    for (;;) {
      let merged = false;
      for (const id of chosen) {
        const parent = byId.get(id)?.parent;
        if (!parent || !candidates.has(parent)) continue;
        const kids = children.get(parent) ?? [];
        if (!kids.every((kid) => chosen.includes(kid))) continue;
        chosen = [parent, ...chosen.filter((other) => !kids.includes(other))];
        merged = true;
        break;
      }
      if (!merged) break;
    }
    return chosen.sort((a, b) => order.get(a) - order.get(b));
  };

  /** Where a flick comes to rest, from Designing Fluid Interfaces: an
   *  exponential decay, not the textbook v²/2a. 0.998 is scroll feel. */
  const project = (velocity, decelerationRate = 0.998) =>
    ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);

  /** The corner of a `width × height` field a point is nearest. Points past
   *  the field still resolve, so a projected landing can be off-screen. */
  const nearestCorner = ({ x, y }, { width, height }) =>
    `${y < height / 2 ? 't' : 'b'}${x < width / 2 ? 'l' : 'r'}`;

  // The semi-implicit Euler update's numerical damping depends on step size,
  // so a spring driven straight off requestAnimationFrame would bounce
  // differently on a 60Hz external monitor than on a 120Hz ProMotion Mac —
  // and in a node test given yet another dt. Substepping at a fixed, small
  // step makes the motion the same regardless of what dt the caller passes.
  const STEP = 0.001;

  /** Advance a damped spring by `dt` seconds, in Apple's two parameters:
   *  `damping` is the damping ratio (1 = no overshoot), `response` the
   *  period in seconds. Integrates in fixed `STEP`-sized substeps internally
   *  (semi-implicit Euler per substep), so it is stable and frame-rate
   *  independent for any dt the caller passes. */
  const spring = (state, target, dt, { damping = 1, response = 0.4 } = {}) => {
    if (!Number.isFinite(dt) || dt <= 0) return state;
    const omega = (2 * Math.PI) / response;
    const stiffness = omega * omega;
    const drag = 2 * damping * omega;
    let { x, v } = state;
    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(STEP, remaining);
      const acceleration = -stiffness * (x - target) - drag * v;
      v = v + acceleration * h;
      x = x + v * h;
      remaining -= h;
    }
    return { x, v };
  };

  const settled = (state, target) => Math.abs(state.x - target) < 0.5 && Math.abs(state.v) < 10;

  globalThis.marbleMarksGeometry = { coverage, idsInRect, project, nearestCorner, spring, settled };
})();
