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
    const { fullIds, selectedIds, hoveredId, now } = ctx;
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

      const alwaysDigest =
        selectedSet.has(card.id) ||
        card.id === hoveredId ||
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

  /** Lay the field out as a partition, not a hull.
   *
   *  A basin used to be the bounding box of members that a free pack had
   *  scattered, so two folders could own the same pixels. Here each folder is
   *  given a region and its cards are packed inside it, which makes the box a
   *  container by construction: regions are laid on shelves left to right and
   *  wrap, so they cannot intersect.
   *
   *  `groups` is `[{ folderId, cards: [{ id, lod, ox, oy }] }]` in the order
   *  they should appear; pass the ungrouped one (folderId null) last. `ox` and
   *  `oy` are a card's stored focusX/focusY, used only to order cards within
   *  their own region — dragging inside a region reorders, dragging across
   *  regions is what changes the folder.
   *
   *  Returns `{ regions, rects, height }`, all in canvas coordinates. */
  const packRegions = ({ groups, canvas, top = 0, sizes, gap = GAP, margin = MARGIN }) => {
    const dw = sizes?.digest?.w ?? 260;
    const dh = sizes?.digest?.h ?? 132;
    const cw = sizes?.chip?.w ?? 168;
    const ch = sizes?.chip?.h ?? 56;
    const room = Math.max(dw + 2 * PAD, canvas.w - 2 * margin);

    const measured = groups.map((group) => {
      // Ungrouped gets the same geometry as a folder — pad and a name line —
      // so its cards sit on the same baseline. Only the fill differs, which is
      // what says "these are loose" without making them look dropped.
      const pad = PAD;
      const nameH = NAME_H;

      // Stable: cards never dragged share a key and keep the order they came
      // in (recency), while a card dragged upward sorts above them.
      const cards = [...group.cards].sort((a, b) => {
        const ay = Number.isFinite(a.oy) ? a.oy : 0.5;
        const by = Number.isFinite(b.oy) ? b.oy : 0.5;
        if (ay !== by) return ay - by;
        const ax = Number.isFinite(a.ox) ? a.ox : 0.5;
        const bx = Number.isFinite(b.ox) ? b.ox : 0.5;
        return ax - bx;
      });
      const digests = cards.filter((card) => card.lod !== 'chip');
      const chips = cards.filter((card) => card.lod === 'chip');

      return { folderId: group.folderId, pad, nameH, digests, chips };
    }).filter((group) => group.digests.length || group.chips.length);

    // Columns are a fair share of the shelf, then a greedy top-up. A blind
    // `sqrt` shape squares each group in isolation, which stacks three cards
    // into an L when they would have fitted in one readable row — and arrow
    // keys navigate by position, so the shape decides how they move.
    const unit = (group) => (group.digests.length ? dw : cw) + gap;
    const widthOf = (group, cols) => cols * unit(group) - gap + 2 * group.pad;
    const rowsOf = (group, cols) => {
      const digestRows = group.digests.length ? Math.ceil(group.digests.length / cols) : 0;
      const chipCols = group.digests.length
        ? Math.max(1, Math.floor((cols * unit(group)) / (cw + gap)))
        : cols;
      const chipRows = group.chips.length ? Math.ceil(group.chips.length / chipCols) : 0;
      return digestRows + chipRows;
    };

    const share = measured.length ? (room - (measured.length - 1) * gap) / measured.length : room;
    const cols = measured.map((group) => {
      const want = group.digests.length || group.chips.length;
      const fits = Math.floor((share - 2 * group.pad + gap) / unit(group));
      return Math.max(1, Math.min(want, fits));
    });
    let used = measured.reduce((sum, group, i) => sum + widthOf(group, cols[i]) + gap, 0) - gap;
    // Spend whatever the shelf has left on the group that is stacking deepest.
    for (let pass = 0; pass < 12; pass += 1) {
      let best = -1;
      let bestRows = 0;
      for (let i = 0; i < measured.length; i += 1) {
        const want = measured[i].digests.length || measured[i].chips.length;
        if (cols[i] >= want) continue;
        if (used + unit(measured[i]) > room) continue;
        const gain = rowsOf(measured[i], cols[i]) - rowsOf(measured[i], cols[i] + 1);
        if (gain > 0 && rowsOf(measured[i], cols[i]) > bestRows) {
          bestRows = rowsOf(measured[i], cols[i]);
          best = i;
        }
      }
      if (best < 0) break;
      cols[best] += 1;
      used += unit(measured[best]);
    }

    measured.forEach((group, i) => {
      const n = cols[i];
      group.digestCols = group.digests.length ? n : 0;
      const contentW = n * unit(group) - gap;
      group.chipCols = Math.max(1, Math.floor((contentW + gap) / (cw + gap)));
      const digestRows = group.digestCols ? Math.ceil(group.digests.length / group.digestCols) : 0;
      const chipRows = group.chips.length ? Math.ceil(group.chips.length / group.chipCols) : 0;
      let contentH = 0;
      if (digestRows) contentH += digestRows * (dh + gap);
      if (chipRows) contentH += chipRows * (ch + gap);
      group.contentW = contentW;
      group.w = contentW + 2 * group.pad;
      group.h = Math.max(0, contentH - gap) + 2 * group.pad + group.nameH;
    });

    // Shelve first, place second. Regions on a shelf share its height, and any
    // height the canvas has left over is split between the shelves — a
    // partition that hugs its contents reads as debris along the top edge,
    // while equal blocks read as a deliberate division of the space. Cards can
    // only be placed once the shelf a region sits on knows how tall it is.
    const shelves = [];
    let shelf = { groups: [], w: margin };
    for (const group of measured) {
      if (shelf.groups.length && shelf.w + group.w > canvas.w - margin) {
        shelves.push(shelf);
        shelf = { groups: [], w: margin };
      }
      shelf.groups.push(group);
      shelf.w += group.w + gap;
    }
    if (shelf.groups.length) shelves.push(shelf);

    for (const row of shelves) {
      row.h = row.groups.reduce((max, group) => Math.max(max, group.h), 0);
    }
    const natural = shelves.reduce((sum, row) => sum + row.h + gap, 0) - gap;
    const slack = shelves.length
      ? Math.max(0, (canvas.h - top - 2 * margin - natural) / shelves.length)
      : 0;

    const regions = [];
    const rects = {};
    let y = top + margin;

    for (const row of shelves) {
      let x = margin;
      const h = row.h + slack;
      for (const group of row.groups) {
        regions.push({ folderId: group.folderId, x, y, w: group.w, h });

        const cx = x + group.pad;
        const cy = y + group.pad + group.nameH;
        group.digests.forEach((card, i) => {
          rects[card.id] = {
            x: cx + (i % group.digestCols) * (dw + gap),
            y: cy + Math.floor(i / group.digestCols) * (dh + gap),
            w: dw,
            h: dh,
          };
        });
        const digestH = group.digestCols
          ? Math.ceil(group.digests.length / group.digestCols) * (dh + gap)
          : 0;
        group.chips.forEach((card, i) => {
          rects[card.id] = {
            x: cx + (i % group.chipCols) * (cw + gap),
            y: cy + digestH + Math.floor(i / group.chipCols) * (ch + gap),
            w: cw,
            h: ch,
          };
        });

        x += group.w + gap;
      }
      y += h + gap;
    }

    return { regions, rects, height: shelves.length ? y - gap + margin : top + margin };
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
    realmOf,
    suggestName,
    nextColor,
    assignLods,
    nearestCard,
    rubberband,
    separateRects,
    packRegions,
  };
})();
