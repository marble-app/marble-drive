// The arithmetic under the marks tools, kept apart from the DOM so it can be
// tested in node: what a rectangle means on a page of addressed boxes, what a
// drawn stroke means, and how a stroke is held to the element it was drawn on.
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
   *  children only when every addressed child that *could* be chosen is
   *  chosen — a rect across a whole list is the list; a rect across one item
   *  is that item.
   *
   *  A zero-area child is left out of that count. It has coverage 0 by the
   *  guard in `coverage`, so it can never be a candidate, and asking for it
   *  would make one hidden child veto its parent forever: the Drive's own
   *  sidebar holds a `hidden` list beside its visible ones, and a marquee
   *  over it would hand an agent the children instead of the sidebar. A
   *  parent with no non-degenerate children left never coalesces at all.
   *
   *  Runs on every frame of a drag over every box on screen, so the shape of
   *  the work matters: one pass to find the candidates, one walk up each
   *  candidate's parent chain to drop the ancestors among them, and a merge
   *  loop that asks a Set rather than scanning an array. */
  const idsInRect = (rect, boxes, { threshold = 0.6 } = {}) => {
    const order = new Map(boxes.map((box, i) => [box.id, i]));
    const byId = new Map(boxes.map((box) => [box.id, box]));
    const children = new Map();
    for (const box of boxes) {
      if (!box.parent || !area(box)) continue;
      if (!children.has(box.parent)) children.set(box.parent, []);
      children.get(box.parent).push(box.id);
    }
    const candidates = new Set();
    for (const box of boxes) if (coverage(rect, box) >= threshold) candidates.add(box.id);
    // Leaves win: a candidate that is an ancestor of another candidate is not
    // one of them. Walking up from each candidate costs its depth; asking
    // every candidate about every other one costs the square of the page.
    const ancestors = new Set();
    for (const id of candidates) {
      for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) if (candidates.has(p)) ancestors.add(p);
    }
    const chosen = new Set([...candidates].filter((id) => !ancestors.has(id)));
    for (;;) {
      let merged = false;
      for (const id of chosen) {
        const parent = byId.get(id)?.parent;
        if (!parent || !candidates.has(parent)) continue;
        const kids = children.get(parent) ?? [];
        if (!kids.length || !kids.every((kid) => chosen.has(kid))) continue;
        for (const kid of kids) chosen.delete(kid);
        chosen.add(parent);
        merged = true;
        break;
      }
      if (!merged) break;
    }
    return [...chosen].sort((a, b) => order.get(a) - order.get(b));
  };

  // ------------------------------------------------------------------ strokes

  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  /** The box a stroke was drawn inside. Zero-sized for a single point, which
   *  every caller below is written to survive. */
  const boundsOf = (points) => {
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    for (const p of points) {
      if (p.x < left) left = p.x;
      if (p.x > right) right = p.x;
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }
    if (!points.length) return { left: 0, top: 0, width: 0, height: 0 };
    return { left, top, width: right - left, height: bottom - top };
  };

  /** How far the hand travelled, which is not how far it got. */
  const lengthOf = (points) => {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
    return total;
  };

  const centroidOf = (points) => {
    if (!points.length) return { x: 0, y: 0 };
    let x = 0; let y = 0;
    for (const p of points) { x += p.x; y += p.y; }
    return { x: x / points.length, y: y / points.length };
  };

  /** What a stroke is, by cheap heuristics and never by redrawing it.
   *
   *  A **box** closes on itself and traces its own bounding box rather than
   *  filling it: a circle comes in at 0.79 of the box's perimeter, a hand-drawn
   *  rectangle at about 1, and a scribble that happens to end where it started
   *  is well past 2 and stays ink. An **arrow** got nearly as far as it
   *  travelled. Everything else is ink, which is a reading too — "over these
   *  elements" — not a failure to be one of the other two. */
  const readStroke = (points, { minimum = 18 } = {}) => {
    if (!Array.isArray(points) || points.length < 3) return 'ink';
    const span = boundsOf(points);
    const reach = Math.hypot(span.width, span.height);
    const travelled = lengthOf(points);
    if (travelled < minimum || reach < minimum) return 'ink';
    const gap = distance(points[0], points[points.length - 1]);
    const perimeter = 2 * (span.width + span.height);
    if (gap <= 0.25 * reach && perimeter > 0 && travelled <= 2 * perimeter
      && Math.min(span.width, span.height) >= 12) return 'box';
    if (gap / travelled >= 0.8) return 'arrow';
    return 'ink';
  };

  /** Whether a stroke is the head someone just put on the arrow before it,
   *  rather than a mark of its own: short, soon after, and drawn at one of
   *  that arrow's two ends. Returns which end it points at, or null. */
  const arrowHeadFor = (arrow, points, { within = 500, elapsed = 0 } = {}) => {
    if (!arrow || arrow.kind !== 'arrow' || elapsed > within) return null;
    const shaft = arrow.points;
    if (!shaft?.length || !points?.length) return null;
    const travelled = lengthOf(points);
    const shaftLength = lengthOf(shaft);
    if (!shaftLength || travelled > 0.5 * shaftLength) return null;
    const here = centroidOf(points);
    const ends = [shaft[0], shaft[shaft.length - 1]];
    const near = ends.map((end) => distance(here, end));
    const which = near[0] <= near[1] ? 0 : 1;
    if (near[which] > Math.max(24, 0.25 * shaftLength)) return null;
    return which === 0 ? 'start' : 'end';
  };

  /** A stroke is kept as fractions of the box it was drawn on, never as
   *  pixels: documents reflow, the pinned drawer takes a margin off `<html>`,
   *  and an agent rewrites elements while you look. Fractions outside 0..1 are
   *  allowed — a stroke can run past its anchor's edge. */
  const toFractions = (box, points) => points.map((p) => [
    box.width ? (p.x - box.left) / box.width : 0,
    box.height ? (p.y - box.top) / box.height : 0,
  ]);

  const fromFractions = (box, pairs) => pairs.map(([u, v]) => ({
    x: box.left + u * box.width,
    y: box.top + v * box.height,
  }));

  globalThis.marbleMarksGeometry = {
    coverage, idsInRect,
    boundsOf, lengthOf, centroidOf, readStroke, arrowHeadFor, toFractions, fromFractions,
  };
})();
