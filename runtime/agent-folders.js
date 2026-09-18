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

  globalThis.marbleAgentFolders = {
    COLOR_KEYS,
    REALMS,
    CHIP_COOL_MS,
    DIGEST_BUDGET,
    FULL_CAP,
    GAP,
    realmOf,
    suggestName,
    nextColor,
    assignLods,
    nearestCard,
    rubberband,
    separateRects,
  };
})();
