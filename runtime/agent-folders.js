// Pure helpers for Agents Folders and Focus: naming, realm colors, LOD, layout.
// Classic IIFE so the host can inject it as a script tag; Node tests import for side effect.

(() => {
  const REALMS = {
    Research: 'research',
    Fun: 'fun',
    "Bryan's Days": 'days',
    Marble: 'marble',
    Travel: 'travel',
  };

  const COLOR_KEYS = [
    'research',
    'fun',
    'days',
    'marble',
    'travel',
    'clay',
    'sage',
    'mist',
    'ink',
    'gold',
  ];

  const CHIP_COOL_MS = 45_000;
  const DIGEST_BUDGET = 4;
  const FULL_CAP = 4;
  const GAP = 8;

  const realmOf = (path) => (path ? REALMS[path.split('/')[0]] || '' : '');

  const suggestName = (targets) => {
    if (!targets.length) return 'Group';

    const segments = targets.map((t) => t.split('/'));
    const first = segments[0];
    let shared = 0;

    outer: for (let i = 0; i < first.length; i++) {
      const seg = first[i];
      for (let j = 1; j < segments.length; j++) {
        if (segments[j][i] !== seg) break outer;
      }
      shared = i + 1;
    }

    if (shared === 0) return 'Group';
    return first[shared - 1].slice(0, 40);
  };

  const nextColor = (used) => {
    const taken = new Set(used);
    for (const key of COLOR_KEYS) {
      if (!taken.has(key)) return key;
    }
    return COLOR_KEYS[0];
  };

  const assignLods = (cards, ctx) => {
    const { fullIds, selectedIds, now } = ctx;
    const fullSet = new Set(fullIds);
    const selectedSet = new Set(selectedIds);
    const lods = {};

    let alwaysDigestCount = 0;
    const flexible = [];

    for (const card of cards) {
      if (fullSet.has(card.id)) {
        lods[card.id] = 'full';
        continue;
      }

      // Hover informs; selection commits. A card that grew under the pointer
      // pushed its column, which moved the pointer off it, which shrank it
      // again — so `hoveredId` is read for nothing here.
      const alwaysDigest =
        selectedSet.has(card.id) ||
        card.running ||
        card.needsReview;

      if (alwaysDigest) {
        lods[card.id] = 'digest';
        alwaysDigestCount++;
        continue;
      }

      flexible.push(card);
    }

    const budget = Math.max(0, DIGEST_BUDGET - alwaysDigestCount);
    const warm = [];
    const cold = [];

    for (const card of flexible) {
      const recent = Math.max(card.lastInteractedAt ?? 0, card.updatedAt ?? 0);
      if (now - recent < CHIP_COOL_MS) warm.push({ card, recent });
      else cold.push({ card, recent });
    }

    // Warm cards stay Digest longer; among cold, most recent keeps Digest first.
    warm.sort((a, b) => b.recent - a.recent);
    cold.sort((a, b) => b.recent - a.recent);

    const digestSlots = [...warm, ...cold].slice(0, budget);
    const digestIds = new Set(digestSlots.map(({ card }) => card.id));

    for (const card of flexible) {
      lods[card.id] = digestIds.has(card.id) ? 'digest' : 'chip';
    }

    return lods;
  };

  const DIRS = {
    right: { ux: 1, uy: 0 },
    left: { ux: -1, uy: 0 },
    up: { ux: 0, uy: -1 },
    down: { ux: 0, uy: 1 },
  };

  const nearestCard = (cards, fromId, dir) => {
    const from = cards.find((c) => c.id === fromId);
    const { ux, uy } = DIRS[dir] ?? { ux: 0, uy: 0 };
    let best = null;
    let bestDist = Infinity;

    for (const card of cards) {
      if (card.id === fromId) continue;

      const dx = card.cx - from.cx;
      const dy = card.cy - from.cy;
      const proj = dx * ux + dy * uy;
      if (proj <= 0) continue;

      const lateral = Math.abs(dx * uy - dy * ux);
      if (Math.atan2(lateral, proj) > Math.PI / 4) continue;

      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = card;
      }
    }

    return best;
  };

  const rubberband = (overshoot, dimension, constant = 0.55) =>
    (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));

  const separateRects = (rects, gap = GAP) => {
    const out = rects.map((r) => ({ ...r }));

    for (let iter = 0; iter < 40; iter++) {
      let moved = false;

      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          const a = out[i];
          const b = out[j];
          const ax = a.x + a.w / 2;
          const ay = a.y + a.h / 2;
          const bx = b.x + b.w / 2;
          const by = b.y + b.h / 2;
          let dx = ax - bx;
          let dy = ay - by;
          const dist = Math.hypot(dx, dy) || 1;
          dx /= dist;
          dy /= dist;

          const overlapX = (a.w + b.w) / 2 + gap - Math.abs(ax - bx);
          const overlapY = (a.h + b.h) / 2 + gap - Math.abs(ay - by);
          if (overlapX <= 0 || overlapY <= 0) continue;

          const penetration = Math.min(overlapX, overlapY);
          const push = penetration / 2;
          a.x += dx * push;
          a.y += dy * push;
          b.x -= dx * push;
          b.y -= dy * push;
          moved = true;
        }
      }

      if (!moved) break;
    }

    return out;
  };


  const PAD = 18;
  const NAME_H = 20;
  const MARGIN = 16;

  // A conversation is a tall thing, so the canvas spends its height on the
  // conversation and its width on rank. These are the widths a column is
  // allowed to take; heights are always the whole canvas.
  const PANE_MIN = 300;
  const PANE_PREF = 420;
  const PANE_MAX = 560;
  const FIELD_MIN = 196;
  const FIELD_PREF = 260;
  const FIELD_MAX = 320;
  // The trailing column that makes a folder of whatever is dropped on it. It
  // is a chip wide, and it is what the field's leftover room is for.
  const NEW_W = 168;

  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

  /** Rank order inside a column. An unranked card sorts last and keeps the
   *  order it came in, so a conversation that starts while you are working
   *  joins the bottom of its column and moves nothing above it. */
  const byRank = (cards) => [...cards].sort((a, b) => {
    const ay = Number.isFinite(a.oy) ? a.oy : Infinity;
    const by = Number.isFinite(b.oy) ? b.oy : Infinity;
    if (ay !== by) return ay - by;
    const ax = Number.isFinite(a.ox) ? a.ox : Infinity;
    const bx = Number.isFinite(b.ox) ? b.ox : Infinity;
    return ax === bx ? 0 : ax - bx;
  });

  /** The rank a card needs to sit at `index` among `keys` — the midpoint of
   *  its neighbours, which is one PATCH rather than a renumbered column.
   *
   *  `null` means there is no midpoint to take: a neighbour is unranked, or
   *  the two of them are closer together than a float can usefully split. The
   *  caller answers that by numbering the whole column with `ranks`. */
  const rankFor = (keys, index) => {
    const prev = index > 0 ? keys[index - 1] : undefined;
    const next = index < keys.length ? keys[index] : undefined;
    if (index > 0 && !Number.isFinite(prev)) return null;
    if (index < keys.length && !Number.isFinite(next)) return null;
    const lo = index > 0 ? prev : 0;
    const hi = index < keys.length ? next : 1;
    if (!(hi - lo > 1e-4)) return null;
    return (lo + hi) / 2;
  };

  /** Ranks for a column of `count`, strictly inside (0, 1) — the store clamps
   *  the field to [0,1], so a rank is a fraction and never an index. */
  const ranks = (count) => Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));

  const cardHeight = (card, sizes) => (card.lod === 'chip'
    ? (sizes?.chip?.h ?? 56)
    : (sizes?.digest?.h ?? 132));

  /** Lay the canvas out as one row of full-height columns.
   *
   *  Ranking runs left to right — stage first, then a region per folder in
   *  catalog order with the loose one last — because top to bottom is the
   *  axis a conversation needs for itself. Cards fill a region downward and
   *  wrap into a second sub-column of the same region rather than into a
   *  second row of regions: a second row would put rank back on the vertical
   *  axis, which is the fault this shape exists to fix.
   *
   *  `fulls` is `[{ id }]` already in stage order. `groups` is
   *  `[{ folderId, cards: [{ id, lod, ox, oy }] }]`, loose one last. Returns
   *  every rect in canvas coordinates, plus the regions and the stage — which
   *  is where hit-testing reads its slots from, so a drop lands where the
   *  layout put things rather than where a second measurement thinks they are. */
  const packFocus = ({
    fulls = [],
    groups = [],
    canvas,
    sizes,
    gap = GAP,
    margin = MARGIN,
    range = {},
    newGroup = 'auto',
  }) => {
    const dh = sizes?.digest?.h ?? 132;
    const paneMin = range.paneMin ?? PANE_MIN;
    const panePref = range.panePref ?? PANE_PREF;
    const paneMax = range.paneMax ?? PANE_MAX;
    const fieldMin = range.fieldMin ?? FIELD_MIN;
    const fieldPref = range.fieldPref ?? FIELD_PREF;
    const fieldMax = range.fieldMax ?? FIELD_MAX;

    const height = Math.max(canvas.h, dh + NAME_H + 2 * PAD + 2 * margin);
    const top = margin;
    const availH = height - 2 * margin;
    const innerH = availH - NAME_H - 2 * PAD;

    // Shape before width. How deep a region stacks is a question about card
    // heights alone, so the sub-column count is settled before a single width
    // is negotiated — which is what lets the negotiation be one pass.
    const shaped = [];
    for (const group of groups) {
      const cards = byRank(group.cards ?? []);
      // An empty column is normally nothing to draw, but the loose one has to
      // stay while a card is in the air — leaving a folder needs somewhere to
      // land, and `keep` is how the caller says so.
      if (!cards.length && !group.keep) continue;
      const stacks = [[]];
      let used = 0;
      for (const card of cards) {
        const h = cardHeight(card, sizes);
        if (used && used + h > innerH) {
          stacks.push([]);
          used = 0;
        }
        stacks[stacks.length - 1].push(card);
        used += h + gap;
      }
      shaped.push({ folderId: group.folderId ?? null, stacks });
    }

    const subCols = shaped.reduce((n, group) => n + group.stacks.length, 0);
    // Everything in the field's width that is not a column: the pads, the gaps
    // between sub-columns, and the gaps between regions.
    const fixed = shaped.reduce((n, group) => n + (group.stacks.length - 1) * gap + 2 * PAD, 0)
      + Math.max(0, shaped.length - 1) * gap;

    const room = Math.max(0, canvas.w - 2 * margin);
    const n = fulls.length;
    const bar = (n && subCols) ? gap : 0;

    // Neither side outranks the other when the canvas is tight: both start
    // from what they want, and a deficit is shared in proportion to how much
    // each has to give. Giving the stage its fill first letterboxes the field
    // at two pins; giving the field its fill first pins a conversation at its
    // floor while chips sit at their preferred width. Where a floor cannot be
    // met the floor wins and the canvas scrolls — a conversation is never
    // squeezed below reading width.
    const stageAt = (w) => (n ? n * w + (n - 1) * gap : 0);
    const fieldAt = (w) => (subCols ? subCols * w + fixed : 0);
    let stageW = stageAt(panePref);
    let fieldW = fieldAt(fieldPref);
    const spare = room - bar - stageW - fieldW;
    if (spare >= 0) {
      // Slack goes to the conversations, then to the columns — and what is
      // left after both reach their preferred maximum is not air: it is
      // shared between them in proportion, so a wide screen is filled edge
      // to edge. The New-group slot is set aside first, so the fill does
      // not swallow the one column that says a folder can be made.
      const toStage = n ? Math.min(spare, stageAt(paneMax) - stageW) : 0;
      stageW += toStage;
      const toField = subCols ? Math.min(spare - toStage, fieldAt(fieldMax) - fieldW) : 0;
      fieldW += toField;
      const air = spare - toStage - toField;
      const reserve = shaped.length && air >= NEW_W + gap ? NEW_W + gap : 0;
      const fill = air - reserve;
      if (fill > 0 && (n || subCols)) {
        const total = stageW + fieldW;
        const toStageFill = n ? (subCols ? fill * (stageW / total) : fill) : 0;
        stageW += toStageFill;
        if (subCols) fieldW += fill - toStageFill;
      }
      // Whole pixels: a fractional rect renders soft and measures unsteady.
      // The column takes a whole width; what rounding leaves goes to the
      // stage, so the fill still reaches the edge.
      if (subCols) fieldW = Math.floor((fieldW - fixed) / subCols) * subCols + fixed;
      stageW = n ? room - bar - reserve - fieldW : 0;
    } else {
      const give = -spare;
      const stageGive = stageW - stageAt(paneMin);
      const fieldGive = fieldW - fieldAt(fieldMin);
      const total = stageGive + fieldGive;
      const share = total > 0 ? Math.min(1, give / total) : 0;
      stageW -= stageGive * share;
      fieldW -= fieldGive * share;
    }
    const colW = subCols ? Math.max(fieldMin, Math.floor((fieldW - fixed) / subCols)) : fieldPref;
    if (!n) stageW = 0;

    const rects = {};
    const stage = { x: margin, y: top, w: stageW, h: availH, cols: [] };
    let x = margin;

    if (n) {
      const cw = (stageW - (n - 1) * gap) / n;
      fulls.forEach((full, i) => {
        const id = full?.id ?? full;
        const rect = { id, x: x + i * (cw + gap), y: top, w: cw, h: availH };
        stage.cols.push(rect);
        rects[id] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      });
      x += stageW + gap;
    }

    // A region is as tall as what it holds. Regions pack down a field column
    // and start the next column when the canvas runs out — so two small
    // folders share a column instead of each taking a tall, mostly empty one.
    const regions = [];
    let colIndex = 0;
    let colX = x;
    let colTop = top;
    let colWidth = 0;
    for (const group of shaped) {
      const w = group.stacks.length * colW + (group.stacks.length - 1) * gap + 2 * PAD;
      const tallest = group.stacks.reduce((best, stack) => {
        const stacked = stack.reduce((n, card) => n + cardHeight(card, sizes) + gap, 0) - gap;
        return Math.max(best, stacked);
      }, 0);
      const h = Math.min(availH, Math.max(0, tallest) + NAME_H + 2 * PAD);
      // While a card is in the air, the loose region is a landing zone: the
      // lifted card is counted in it, and tucked under a folder it would
      // shrink that folder under the pointer (regions share their column's
      // height). It opens its own column for the length of the drag.
      const landing = newGroup === 'always' && group.folderId === null;
      if (regions.length && (landing || colTop + h > top + availH + 0.01)) {
        colIndex += 1;
        colX += colWidth + gap;
        colTop = top;
        colWidth = 0;
      }
      const region = {
        folderId: group.folderId,
        x: colX,
        y: colTop,
        w,
        h,
        col: colIndex,
        inner: { x: colX + PAD, y: colTop + PAD + NAME_H, w: w - 2 * PAD, h: h - NAME_H - 2 * PAD },
        cards: [],
      };
      group.stacks.forEach((stack, si) => {
        const cx = colX + PAD + si * (colW + gap);
        let cy = colTop + PAD + NAME_H;
        for (const card of stack) {
          const ch = cardHeight(card, sizes);
          const rect = { id: card.id, x: cx, y: cy, w: colW, h: ch };
          region.cards.push(rect);
          rects[card.id] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
          cy += ch + gap;
        }
      });
      regions.push(region);
      colTop += h + gap;
      colWidth = Math.max(colWidth, w);
    }
    if (regions.length) x = colX + colWidth + gap;

    // A field column is as tall as the canvas. Regions in it are placed by
    // their content, then share what the column has left, in proportion —
    // cards keep their size and stay at the top; the region's box grows.
    const columns = new Map();
    for (const region of regions) columns.set(region.col, [...(columns.get(region.col) ?? []), region]);
    for (const stacked of columns.values()) {
      const content = stacked.reduce((sum, region) => sum + region.h, 0);
      const left = availH - content - (stacked.length - 1) * gap;
      if (left <= 0.01 || !content) continue;
      let y = top;
      for (const [index, region] of stacked.entries()) {
        const last = index === stacked.length - 1;
        const grown = last ? top + availH - y : Math.round(region.h + left * (region.h / content));
        const dy = y - region.y;
        region.y = y;
        region.h = grown;
        region.inner.y += dy;
        region.inner.h = grown - NAME_H - 2 * PAD;
        for (const card of region.cards) {
          card.y += dy;
          rects[card.id].y += dy;
        }
        y += grown + gap;
      }
    }

    // Making a folder is otherwise undiscoverable — you have to guess that one
    // card dropped on another means something. A column you can see says it.
    // It is drawn in the room the columns did not take, so it costs the
    // conversations nothing; `newGroup: 'always'` overrides that for the
    // length of a drag, when it is the thing being aimed at.
    const wantsNew = regions.length && (newGroup === 'always'
      || margin + room - x >= NEW_W - 0.5);
    const newSlot = wantsNew ? { x, y: top, w: NEW_W, h: availH } : null;
    if (newSlot) x += NEW_W + gap;

    const placed = n || regions.length;
    return {
      stage,
      regions,
      newGroup: newSlot,
      rects,
      colW,
      width: placed ? Math.max(canvas.w, x - gap + margin) : Math.max(canvas.w, 2 * margin),
      height,
    };
  };

  /** Where a point lands in a region: which slot the drop would insert at, and
   *  the bar to draw for it. `over` is the card the point sits squarely on,
   *  which is the only reading that can mean "make a folder of these two". */
  const slotAt = (region, point, gap = GAP) => {
    const inner = region.inner;
    if (!region.cards.length) {
      return { index: 0, over: null, x: inner.x, w: inner.w, y: inner.y };
    }

    const columns = [];
    for (const card of region.cards) {
      let column = columns.find((row) => Math.abs(row.x - card.x) < 1);
      if (!column) {
        column = { x: card.x, w: card.w, cards: [] };
        columns.push(column);
      }
      column.cards.push(card);
    }
    const column = columns.reduce((best, row) => (
      Math.abs(point.x - (row.x + row.w / 2)) < Math.abs(point.x - (best.x + best.w / 2)) ? row : best
    ), columns[0]);

    const last = column.cards[column.cards.length - 1];
    let index = region.cards.indexOf(last) + 1;
    let y = last.y + last.h + gap / 2;
    let over = null;
    for (const card of column.cards) {
      if (point.y >= card.y + card.h * 0.28 && point.y <= card.y + card.h * 0.72) over = card.id;
      if (point.y < card.y + card.h / 2) {
        index = region.cards.indexOf(card);
        y = card.y - gap / 2;
        break;
      }
    }
    return { index, over, x: column.x, w: column.w, y };
  };

  /** The region under a point, with the gap as tolerance — else the nearest,
   *  so a drop below the last region in a column still has somewhere to go. */
  const regionAt = (pack, point, gap = GAP) => {
    const regions = pack?.regions ?? [];
    if (!regions.length) return null;
    const hit = regions.find((r) => (
      point.x >= r.x - gap && point.x <= r.x + r.w + gap && point.y >= r.y - gap && point.y <= r.y + r.h + gap
    ));
    if (hit) return hit;
    const dist = (r) => Math.hypot(
      Math.max(r.x - point.x, 0, point.x - (r.x + r.w)),
      Math.max(r.y - point.y, 0, point.y - (r.y + r.h)),
    );
    return regions.reduce((best, r) => (dist(r) < dist(best) ? r : best), regions[0]);
  };

  /** The same question for the stage, where the slots run left to right. */
  const stageSlotAt = (stage, point, gap = GAP) => {
    if (!stage.cols.length) return { index: 0, x: stage.x, y: stage.y, h: stage.h };
    const last = stage.cols[stage.cols.length - 1];
    let index = stage.cols.length;
    let x = last.x + last.w + gap / 2;
    for (let i = 0; i < stage.cols.length; i += 1) {
      const col = stage.cols[i];
      if (point.x < col.x + col.w / 2) {
        index = i;
        x = col.x - gap / 2;
        break;
      }
    }
    return { index, x, y: stage.y, h: stage.h };
  };

  /** A slot answer near the boundary that produced the last one is the same
   *  answer. Without this, a pointer resting on a card's midline opens and
   *  closes the gap on every pixel. */
  const steadySlot = (prev, next, point, band = 8) => {
    if (!prev || !next) return next;
    if (prev.column !== next.column || (prev.folderId ?? null) !== (next.folderId ?? null)) return next;
    if (Math.abs((next.index ?? 0) - (prev.index ?? 0)) !== 1) return next;
    if (!Number.isFinite(prev.edge)) return next;
    const axis = prev.column === 'stage' ? point.x : point.y;
    return Math.abs(axis - prev.edge) <= band ? prev : next;
  };

  globalThis.marbleAgentFolders = {
    COLOR_KEYS,
    REALMS,
    CHIP_COOL_MS,
    DIGEST_BUDGET,
    FULL_CAP,
    GAP,
    PAD,
    NAME_H,
    MARGIN,
    PANE_MIN,
    PANE_PREF,
    PANE_MAX,
    FIELD_MIN,
    FIELD_PREF,
    FIELD_MAX,
    NEW_W,
    realmOf,
    suggestName,
    nextColor,
    assignLods,
    nearestCard,
    rubberband,
    separateRects,
    byRank,
    rankFor,
    ranks,
    packFocus,
    slotAt,
    stageSlotAt,
    steadySlot,
    regionAt,
  };
})();
