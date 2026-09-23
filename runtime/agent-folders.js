// Pure helpers for Agents Folders and Focus: naming, realm colors, LOD, layout.
// Classic IIFE so the host can inject it as a script tag; Node tests import for side effect.

(() => {
  // No folders of its own: which top-level folders wear a realm is the
  // drive's choice (`.marble/drive.json`), handed in by whoever asks.
  const REALMS = Object.freeze({});

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
  const GAP = 5;

  const realmOf = (path, realms = REALMS) => (path ? realms[path.split('/')[0]] || '' : '');

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


  const PAD = 10;
  const NAME_H = 20;
  const MARGIN = 8;

  // A conversation is a tall thing, so the canvas spends its height on the
  // conversation and its width on rank. These are the widths a column is
  // allowed to take; heights are always the whole canvas.
  const PANE_MIN = 300;
  const PANE_PREF = 420;
  const PANE_MAX = 560;
  const FIELD_MIN = 196;
  const FIELD_PREF = 260;
  const FIELD_MAX = 320;
  // A pile is a group folded down to a tab in a rail: its name turned on its
  // side so the tab can be a finger wide, and nothing else but a count. It is
  // the last thing the field gives up before the canvas would have to scroll,
  // and it is deliberately tiny — a group you are not working in should cost
  // the stage almost nothing. Laid flat it cost 152px of width to use 30px of
  // an 800px column; turned on its side it costs 34 and uses all of it.
  const PILE_W = 34;
  // The shortest a tab may be before the rail drops to its smallest form. A
  // name turned sideways needs a run of pixels to be a word rather than an
  // ellipsis; below that the entry keeps only what a group cannot do without,
  // which is its colour and how much is in it.
  const PILE_MIN_H = 64;
  // The smallest an entry gets: a square in the group's colour with its count
  // inside. No name at all — at this size the colour is the name.
  const PILE_DOT = 26;
  // What the rail widens to when you open an entry. One field column's floor,
  // paid once however many entries you open — opening is meant to be a peek,
  // not a promotion.
  const PILE_OPEN_W = 196;
  // A closed entry inside an opened rail: a menu row, so its name reads the
  // right way up next to the one you opened.
  const PILE_ROW_H = 26;
  // Once every group is a pile and the stage still will not fit, the panes
  // themselves go under reading width rather than the canvas scrolling: the
  // person asked for this many at once and the screen is the budget.
  const PANE_FLOOR = 168;
  // The trailing column that makes a folder of whatever is dropped on it. It
  // is a chip wide, and it is what the field's leftover room is for.
  const NEW_W = 168;
  // The stage against the field: a golden split of whatever the canvas has,
  // inside the floors and ceilings above. Between panes nobody outranks
  // anybody; it is the two sides of the canvas that stand in ratio.
  const PHI = (1 + Math.sqrt(5)) / 2;
  // That ratio as the stage's share of the two sides together, which is the
  // form the seam between them is dragged in: φ/(1+φ), a hair under 62%.
  const GOLDEN_SPLIT = 1 / (1 + 1 / PHI);
  // How far a hand may take that seam. The low end is a stop and not a floor:
  // the panes keep reading width whatever it says. The high end is all the way
  // — a field asked for nothing folds its groups into the rail and the stage
  // has the canvas — because closing the field by dragging the seam onto it is
  // the same gesture as sizing it, only finished.
  const SPLIT_MIN = 0.12;
  const SPLIT_MAX = 0.98;

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
    : (sizes?.digest?.h ?? 161));

  /** Lay the canvas out as one row of full-height columns.
   *
   *  Ranking runs left to right and rises as it goes: a region per folder in
   *  catalog order with the loose one last, then the stage at the right edge.
   *  What you are not working on is passed over on the way in, and the pins
   *  you are working in are the last thing the row says — the same direction
   *  the language reads, so the eye ends where the attention belongs. Top to
   *  bottom stays the axis a conversation needs for itself: cards fill a
   *  region downward and wrap into a second sub-column of the same region
   *  rather than into a second row of regions, since a second row would put
   *  rank back on the vertical axis, which is the fault this shape exists to
   *  fix.
   *
   *  The row never runs off the canvas. Where it would, the field folds: a
   *  group at a time turns into a pile — a folder with a name and a count, in
   *  a rail at the left edge — until what is left fits beside the stage. A
   *  group's `weight` is what the fold order reads (the caller passes
   *  recency, so the stalest goes first); Ungrouped has none and folds before
   *  any real folder. `piled` names groups the caller has already folded, and
   *  `opened` names groups the person opened by hand, which the loop may
   *  never fold.
   *  Past that there is nothing left to give and the panes themselves go
   *  under reading width, down to `PANE_FLOOR`, because a screenful of
   *  conversations is what was asked for and the screen is the budget.
   *
   *  `split` is where the seam between the stage and the field stands, as the
   *  stage's share of the two of them together. Null — nobody has touched it —
   *  is `GOLDEN_SPLIT`. A number is a hand on the seam, and a hand outranks
   *  the preferred widths: the ceilings stop applying, so the field may be
   *  dragged wider than a column ever asks to be and the panes wider than
   *  reading width. The floors still hold, because a side squeezed past its
   *  floor is a side you cannot read, which is not what dragging a seam is
   *  for.
   *
   *  `fulls` is `[{ id }]` already in stage order. `groups` is
   *  `[{ folderId, weight, cards: [{ id, lod, ox, oy }] }]`, loose one last.
   *  Returns every rect in canvas coordinates, plus the regions (piles among
   *  them, flagged `piled`) and the stage — which is where hit-testing reads
   *  its slots from, so a drop lands where the layout put things rather than
   *  where a second measurement thinks they are. */
  const packFocus = (options = {}) => {
    const {
      fulls = [],
      groups = [],
      canvas,
      sizes,
      gap = GAP,
      margin = MARGIN,
      range = {},
      newGroup = 'auto',
      piled = [],
      opened = [],
      split = null,
    } = options;
    const dh = sizes?.digest?.h ?? 161;
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
    //
    // It runs over whichever groups are still expanded, because piling one is
    // the field's last concession and the loop below has to be able to ask
    // "and what if this one folded?" without a second layout pass.
    const shapeField = (list) => {
      const shaped = [];
      for (const group of list) {
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

      // Which field column each region lands in, settled before any width is
      // negotiated. Nothing here depends on width — a region's height is its
      // cards' heights — so the two passes cannot disagree, and the width the
      // field asks for is the width it will actually occupy. Sizing the field as
      // though every sub-column stood side by side was what left a band of dead
      // canvas down the right whenever two regions shared a column.
      const regionH = (group) => {
        const tallest = group.stacks.reduce((best, stack) => {
          const stacked = stack.reduce((sum, card) => sum + cardHeight(card, sizes) + gap, 0) - gap;
          return Math.max(best, stacked);
        }, 0);
        return Math.min(availH, Math.max(0, tallest) + NAME_H + 2 * PAD);
      };
      const fieldCols = [];
      let colTop = top;
      for (const group of shaped) {
        const h = regionH(group);
        // While a card is in the air the loose region is a landing zone and
        // opens its own column — the same rule the layout below follows.
        // While a card is in the air the loose region is a landing zone: it
        // opens its own column so that a folder it would otherwise tuck under
        // does not shrink under the pointer aiming at it (regions share their
        // column's height). `'rail'` is a drag too — it only says the
        // New-group affordance is drawn as an overlay rather than packed.
        const landing = (newGroup === 'always' || newGroup === 'rail') && group.folderId === null;
        if (fieldCols.length && (landing || colTop + h > top + availH + 0.01)) {
          fieldCols.push({ groups: [] });
          colTop = top;
        } else if (!fieldCols.length) {
          fieldCols.push({ groups: [] });
        }
        fieldCols[fieldCols.length - 1].groups.push(group);
        group.col = fieldCols.length - 1;
        group.h = h;
        colTop += h + gap;
      }

      // A field column is as wide as the widest region standing in it.
      const colStacks = fieldCols.map((column) => column.groups.reduce((most, group) => Math.max(most, group.stacks.length), 0));
      const subCols = colStacks.reduce((n, stacks) => n + stacks, 0);
      // Everything in the field's width that is not a sub-column: the pads,
      // the gaps between sub-columns, and the gaps between field columns.
      const fixed = colStacks.reduce((n, stacks) => n + (stacks - 1) * gap + 2 * PAD, 0)
        + Math.max(0, fieldCols.length - 1) * gap;
      return { shaped, fieldCols, colStacks, subCols, fixed };
    };

    const room = Math.max(0, canvas.w - 2 * margin);
    const n = fulls.length;
    // Where the seam between the two sides has been dragged to, if it has.
    // Read before the folding below, because a hand on the seam is one of the
    // two things that folds a group.
    //
    // A hand's split is **where the seam stands, as a fraction of the canvas**
    // — the stage's end of it, so the number reads the same way φ does and an
    // old file still means what it said. It is deliberately not the stage's
    // share of the two sides: that span shrinks by a rail's width the moment a
    // group folds, so the same number meant two different places either side
    // of a fold, and a drag across one landed the seam thirty pixels from the
    // finger before correcting itself on the next move. Measured against the
    // whole canvas, which nothing the seam does can change, the mapping from a
    // split to a position is exact and the same on both sides of every fold.
    const bias = Number.isFinite(split) ? clamp(split, SPLIT_MIN, SPLIT_MAX) : null;
    // Where that puts the seam, and what it leaves the field: the seam stands
    // in the middle of the bar between the two sides, and the rail stands to
    // the field's left, so both come off the top before the field is measured.
    const handSeamX = bias == null ? null : margin + (1 - bias) * room;

    // ---- What folds. The canvas never scrolls sideways: a focused chat is
    // worth more than a column of cards, so when the stage cannot stand at
    // reading width the field gives up groups one at a time, each folding
    // into a pile — a folder with a name and a count — until the row fits.
    //
    // Which group folds first is `weight`: the caller passes recency, so the
    // group nothing has happened in all day is the one that disappears, and
    // opening a pile (which sets its weight to now) keeps it open and folds
    // something else instead. Ungrouped has no weight of its own, so it folds
    // before any real folder — it is the junk drawer, and the screenshot that
    // asked for this had it eating half the canvas.
    const pileKey = (group) => group.folderId ?? null;
    const asked = new Set(piled.map((key) => key ?? null));
    const drawable = groups.filter((group) => (group.cards ?? []).length || group.keep);
    let open = drawable.filter((group) => !asked.has(pileKey(group)));
    const folded = drawable.filter((group) => asked.has(pileKey(group)));
    // Ungrouped has no weight of its own and folds before any real folder.
    const weightOf = (group) => (Number.isFinite(group.weight)
      ? group.weight
      : (group.folderId == null ? -Infinity : 0));
    // Least valuable first: the order the loop eats through. A group you have
    // opened is not spared — it folds like any other and is drawn expanded
    // inside the rail, which is what makes opening one cheap.
    const order = [...open].sort((a, b) => weightOf(a) - weightOf(b));

    // ---- The rail is a menu of what the canvas had no room for, and it has
    // three forms, each one smaller than the last:
    //
    //   open  — you clicked an entry. The rail widens once, to one field
    //           column's floor, and the entry you opened lists its chats under
    //           its name. Everything else in the rail becomes a menu row.
    //   tab   — nothing open, and every entry can have a readable run of
    //           height. Names turn a quarter turn; the tabs divide the canvas
    //           between them.
    //   dot   — too many entries for that. All a group keeps is its colour and
    //           its count, in a square.
    //
    // `held` is what you opened. An opened group is still folded — that is the
    // point: opening is a peek inside the rail, not a promotion back to a
    // column of its own.
    const held = new Set(opened.map((key) => key ?? null));
    const chipH = sizes?.chip?.h ?? 56;
    const dotPerCol = Math.max(1, Math.floor((availH + gap) / (PILE_DOT + gap)));
    const railMetrics = (list) => {
      if (!list.length) return { form: 'none', w: 0, cols: 0, span: 0 };
      if (list.some((group) => held.has(pileKey(group)))) {
        return { form: 'open', w: PILE_OPEN_W, cols: 1, span: PILE_OPEN_W + gap };
      }
      if (list.length * (PILE_MIN_H + gap) - gap <= availH + 0.5) {
        return { form: 'tab', w: PILE_W, cols: 1, span: PILE_W + gap };
      }
      const cols = Math.ceil(list.length / dotPerCol);
      return { form: 'dot', w: PILE_DOT, cols, span: cols * PILE_DOT + cols * gap };
    };

    // One fold at a time until the row fits. A single fold does not always buy
    // width — two groups sharing a column, one of them folded, leaves the
    // column exactly as wide as it was — but the next one does, when the last
    // region leaves and the column goes with it. So the loop does not ask
    // whether a fold pays; it keeps going until the row fits or there is
    // nothing left to fold.
    const stageFloor = n ? n * paneMin + (n - 1) * gap : 0;
    const fieldFloorOf = (info) => (info.subCols ? info.subCols * fieldMin + info.fixed : 0);
    const fits = (info, list) => {
      const seam = (n && info.subCols) ? gap : 0;
      return stageFloor + seam + fieldFloorOf(info) + railMetrics(list).span <= room + 0.5;
    };
    // What the field looked like before either loop ran, and the order the
    // loops eat through it in — `stops` below replays them to find every
    // shape the field can take, and both lists are about to be spent.
    const baseOpen = [...open];
    const baseFolded = [...folded];
    const foldOrder = [...order];
    const fold = () => {
      const victim = order.shift();
      open = open.filter((group) => group !== victim);
      folded.push(victim);
      shape = shapeField(open);
    };
    let shape = shapeField(open);
    while (!fits(shape, folded) && order.length) fold();
    // How many folds the canvas itself insisted on. Nothing can put these
    // back, so the seam's travel starts here.
    const forced = foldOrder.length - order.length;

    // A hand on the seam is the other thing that folds a group. The loop
    // above folds what the canvas has no room for; this one folds what the
    // hand has no room for. Dragging the seam left is asking for a smaller
    // field, and a field with nothing left to give answers by folding a
    // group rather than by refusing to move: FIELD_MIN is still the tightest
    // a column is read at, but arriving there costs a group its column
    // instead of costing the gesture its travel. Drag back and the fold comes
    // undone, because nothing here is remembered — the shape is recomputed
    // from the ask on every pass.
    const fieldAsk = (info, list) => (info.subCols
      ? handSeamX - margin - railMetrics(list).span - gap / 2
      : 0);
    // A hair under the floor is the floor. The ask arrives as a share rounded
    // to a thousandth, so it lands a pixel either side of where it was aimed,
    // and a pixel is not a reason to fold a group away.
    const FOLD_SLACK = 2;
    if (bias != null && n) {
      while (order.length && fieldAsk(shape, folded) + FOLD_SLACK < fieldFloorOf(shape)) fold();
    }

    // The piles read in catalog order, not in the order things happened to
    // fold: a pile that jumped seats every time its neighbour folded would be
    // a row you cannot learn.
    folded.sort((a, b) => drawable.indexOf(a) - drawable.indexOf(b));

    const { shaped, fieldCols, colStacks, subCols, fixed } = shape;
    const rail = railMetrics(folded);
    const railSpan = rail.span;
    const bar = (n && subCols) ? gap : 0;

    // Neither side outranks the other when the canvas is tight: both start
    // from what they want, and a deficit is shared in proportion to how much
    // each has to give. Giving the stage its fill first letterboxes the field
    // at two pins; giving the field its fill first pins a conversation at its
    // floor while chips sit at their preferred width. The loop above has
    // already folded whatever had to fold for both floors to be meetable, so
    // this is a negotiation between two sides that both fit.
    // What is left of the canvas once the rail has taken its width. The rail
    // is not negotiable — it is the compacted form of a thing that already
    // lost its negotiation — but at a finger wide it is barely a cost.
    const usableRoom = Math.max(0, room - railSpan);
    const stageAt = (w) => (n ? n * w + (n - 1) * gap : 0);
    const fieldAt = (w) => (subCols ? subCols * w + fixed : 0);
    let stageW = stageAt(panePref);
    let fieldW = fieldAt(fieldPref);
    // A split somebody asked for, honoured inside the floors alone: the
    // ceilings are only what each side would like, and the seam is somebody
    // saying what they would like instead. The field is what is left of the
    // canvas to the left of the seam once the rail and half the bar are off
    // it, which is the one measurement that does not move when a group folds.
    const byHand = (usable) => {
      const floorS = Math.min(stageAt(paneMin), usable);
      const floorF = Math.max(0, Math.min(fieldAt(fieldMin), usable - floorS));
      const want = handSeamX - margin - railSpan - gap / 2;
      const f = clamp(want, floorF, Math.max(floorF, usable - floorS));
      return [usable - f, f];
    };
    const spare = usableRoom - bar - stageW - fieldW;
    if (bias != null && n && subCols) {
      // A hand on the seam spends the whole row: no New-group column is set
      // aside out of width that was asked for by name.
      const usable = usableRoom - bar;
      [stageW, fieldW] = byHand(usable);
      fieldW = Math.max(0, Math.floor((fieldW - fixed) / subCols) * subCols + fixed);
      stageW = usable - fieldW;
    } else if (spare >= 0) {
      // What is left once both sides stand at their ceiling is the air the
      // New-group column may be set aside from. Room set aside for it only
      // when there is going to be one in the pack: held open at rest it is a
      // strip of dead canvas down the right that nothing ever stands in; held
      // open only for a drag it moves the whole field the moment you lift a
      // card. `'rail'` is neither — the caller overlays it — so it reserves
      // nothing.
      const air = spare - (stageAt(paneMax) - stageW) - (fieldAt(fieldMax) - fieldW);
      const packsNew = newGroup === 'always' || newGroup === 'auto';
      const reserve = packsNew && shaped.length && air >= NEW_W + gap ? NEW_W + gap : 0;
      const usable = usableRoom - bar - reserve;
      if (n && subCols) {
        // Stage against field is a golden split of the usable width — the
        // stage φ, the field 1 — inside the floors and ceilings. A side held
        // at its ceiling hands what it cannot take to the other, stage first.
        // Past both ceilings together the ceilings say nothing (a wide screen
        // is filled edge to edge, not left as air), and the split is φ
        // exactly. This is the split until a hand moves the seam; after that
        // the branch above has already answered.
        const want = usable * GOLDEN_SPLIT;
        if (usable > stageAt(paneMax) + fieldAt(fieldMax)) {
          stageW = want;
          fieldW = usable - want;
        } else {
          stageW = clamp(want, stageAt(paneMin), stageAt(paneMax));
          fieldW = clamp(usable - stageW, fieldAt(fieldMin), fieldAt(fieldMax));
          stageW = clamp(usable - fieldW, stageAt(paneMin), stageAt(paneMax));
          fieldW = clamp(usable - stageW, fieldAt(fieldMin), fieldAt(fieldMax));
        }
      } else if (n) {
        stageW = usable;
      } else if (subCols) {
        fieldW = usable;
      }
      // Whole pixels: a fractional rect renders soft and measures unsteady.
      // The column takes a whole width; what rounding leaves goes to the
      // stage, so the fill still reaches the edge.
      if (subCols) fieldW = Math.floor((fieldW - fixed) / subCols) * subCols + fixed;
      stageW = n ? usableRoom - bar - reserve - fieldW : 0;
    } else {
      const give = -spare;
      const stageGive = stageW - stageAt(paneMin);
      const fieldGive = fieldW - fieldAt(fieldMin);
      const total = stageGive + fieldGive;
      const share = total > 0 ? Math.min(1, give / total) : 0;
      stageW -= stageGive * share;
      fieldW -= fieldGive * share;
    }
    // The canvas does not scroll sideways, so nothing may end up wider than
    // it. Everything the field could fold has folded by now, so the shortfall
    // — if there is one at all — is the stage's: the panes go under reading
    // width, down to PANE_FLOOR, rather than the row running off the screen.
    // Past that floor too there is nothing left to give and the panes simply
    // share what the canvas has.
    const ceiling = Math.max(0, usableRoom - bar);
    if (stageW + fieldW > ceiling + 0.5) {
      const over = stageW + fieldW - ceiling;
      const stageGive = Math.max(0, stageW - stageAt(PANE_FLOOR));
      const take = Math.min(over, stageGive);
      stageW -= take;
      if (over - take > 0.5) {
        const left = over - take;
        const fieldGive = Math.max(0, fieldW - fieldAt(0));
        const off = Math.min(left, fieldGive);
        fieldW -= off;
        stageW = Math.max(0, ceiling - fieldW);
      }
    }
    const colW = subCols ? Math.max(0, Math.floor((fieldW - fixed) / subCols)) : fieldPref;
    if (!n) stageW = 0;

    const rects = {};
    const stage = { x: margin, y: top, w: stageW, h: availH, cols: [] };
    // The field is laid first, from the left margin; the stage is placed after
    // it, against the right edge. The widths either side gets were negotiated
    // above and do not depend on which end they stand at — only the running
    // `x` does, so the stage waits its turn.
    let x = margin;
    const stageSpan = n ? stageW + gap : 0;

    // ---- The rail, at the very left. Rank rises to the right and a folded
    // group is the least of what the canvas is showing, so it stands at the
    // low end. Every entry is a region like any other — it has a box, it takes
    // a drop, it wears its folder's colour. What differs is how much of itself
    // it gets to show.
    const piles = [];
    const railRegions = [];
    if (folded.length) {
      const entry = (group) => ({
        folderId: group.folderId ?? null,
        count: (group.cards ?? []).length,
        ids: (group.cards ?? []).map((card) => card.id),
      });

      if (rail.form === 'open') {
        // A menu with one section unrolled. Closed entries take a row each;
        // what is left is shared between the entries you opened, and each
        // shows as many of its chats as its share has room for. More than that
        // and the count on its header is the rest of the answer — opening is a
        // peek, and a peek that pushed the panes under reading width would be
        // the thing this is trying not to be.
        const openOnes = folded.filter((group) => held.has(pileKey(group)));
        const shut = folded.length - openOnes.length;
        const spare = availH - shut * (PILE_ROW_H + gap);
        const share = openOnes.length ? (spare - (openOnes.length - 1) * gap) / openOnes.length : 0;
        let y = top;
        for (const group of folded) {
          const open2 = held.has(pileKey(group));
          const base = entry(group);
          if (!open2) {
            piles.push({
              ...base,
              piled: true,
              form: 'row',
              x, y, w: rail.w, h: PILE_ROW_H,
              col: -1,
              inner: { x, y, w: rail.w, h: PILE_ROW_H },
              cards: [],
            });
            y += PILE_ROW_H + gap;
            continue;
          }
          const cards = byRank(group.cards ?? []);
          const room2 = Math.max(NAME_H + PAD, Math.min(share, NAME_H + PAD + cards.length * (chipH + gap)));
          const fitRows = Math.max(0, Math.floor((room2 - NAME_H - PAD + gap) / (chipH + gap)));
          const shown = cards.slice(0, fitRows);
          const h = NAME_H + PAD + (shown.length ? shown.length * (chipH + gap) - gap : 0);
          const region = {
            folderId: group.folderId ?? null,
            opened: true,
            count: cards.length,
            hidden: cards.length - shown.length,
            // What did not fit has no seat, so the caller must know to hide
            // it — an unplaced card keeps whatever rect it had last.
            hiddenIds: cards.slice(shown.length).map((card) => card.id),
            x, y, w: rail.w, h,
            col: -1,
            inner: { x: x + PAD / 2, y: y + NAME_H, w: rail.w - PAD, h: h - NAME_H },
            cards: [],
          };
          let cy = y + NAME_H;
          for (const card of shown) {
            const rect = { id: card.id, x: x + PAD / 2, y: cy, w: rail.w - PAD, h: chipH };
            region.cards.push(rect);
            rects[card.id] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
            cy += chipH + gap;
          }
          railRegions.push(region);
          y += h + gap;
        }
      } else if (rail.form === 'tab') {
        // Tabs turned on their side, dividing the canvas's height between
        // them, so the rail is full from top to bottom.
        const th = (availH - (folded.length - 1) * gap) / folded.length;
        folded.forEach((group, i) => {
          const py = top + i * (th + gap);
          piles.push({
            ...entry(group),
            piled: true,
            form: 'tab',
            x, y: py, w: rail.w, h: th,
            col: -1,
            inner: { x, y: py, w: rail.w, h: th },
            cards: [],
          });
        });
      } else {
        // Squares. Too many groups for any of them to have a readable run of
        // height, so the name goes and the colour carries it, with the count
        // inside. Spaced to fill the rail rather than stacked at the top.
        const perCol = Math.min(dotPerCol, Math.ceil(folded.length / rail.cols));
        folded.forEach((group, i) => {
          const col = Math.floor(i / perCol);
          const inCol = i % perCol;
          const tally = Math.min(perCol, folded.length - col * perCol);
          const step = tally > 1
            ? Math.max(PILE_DOT + gap, (availH - PILE_DOT) / (tally - 1))
            : 0;
          const px = x + col * (PILE_DOT + gap);
          const py = top + inCol * step;
          piles.push({
            ...entry(group),
            piled: true,
            form: 'dot',
            x: px, y: py, w: PILE_DOT, h: PILE_DOT,
            col: -1 - col,
            inner: { x: px, y: py, w: PILE_DOT, h: PILE_DOT },
            cards: [],
          });
        });
      }
      x += railSpan;
    }

    const placeStage = (at) => {
      if (!n) return;
      stage.x = at;
      const cw = (stageW - (n - 1) * gap) / n;
      fulls.forEach((full, i) => {
        const id = full?.id ?? full;
        const rect = { id, x: at + i * (cw + gap), y: top, w: cw, h: availH };
        stage.cols.push(rect);
        rects[id] = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      });
    };

    // A region is as tall as what it holds, and stands in the field column the
    // pass above put it in — so two small folders share a column instead of
    // each taking a tall, mostly empty one. Every region in a column is as
    // wide as the column, which is the width that column was paid for.
    const regions = [];
    const colWidths = colStacks.map((stacks) => stacks * colW + (stacks - 1) * gap + 2 * PAD);
    const colXs = [];
    {
      let at = x;
      for (const [index, w] of colWidths.entries()) {
        colXs.push(at);
        at += w + (index < colWidths.length - 1 ? gap : 0);
      }
    }
    let colIndex = 0;
    let colX = x;
    let colTop = top;
    for (const group of shaped) {
      const w = colWidths[group.col] ?? (group.stacks.length * colW + (group.stacks.length - 1) * gap + 2 * PAD);
      const h = group.h;
      if (group.col !== colIndex) {
        colIndex = group.col;
        colTop = top;
      }
      colX = colXs[group.col] ?? colX;
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
    }
    if (colXs.length) x = colXs[colXs.length - 1] + colWidths[colWidths.length - 1] + gap;

    // A field column is as tall as the canvas. Regions in it are placed by
    // their content, then share what the column has left, in proportion —
    // cards keep their size and stay at the top; the region's box grows.
    const columns = new Map();
    for (const region of regions) columns.set(region.col, [...(columns.get(region.col) ?? []), region]);
    for (const stacked of columns.values()) {
      const roomH = availH;
      const content = stacked.reduce((sum, region) => sum + region.h, 0);
      const left = roomH - content - (stacked.length - 1) * gap;
      if (left <= 0.01 || !content) continue;
      let y = top;
      for (const [i, region] of stacked.entries()) {
        const last = i === stacked.length - 1;
        const grown = last ? top + roomH - y : Math.round(region.h + left * (region.h / content));
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
    // length of a drag, when it is the thing being aimed at. `'never'` is for
    // when it could not be used: an unclickable column is furniture, not an
    // affordance, and the field would rather have the width.
    // `'rail'` means the caller draws it themselves, as an overlay at the
    // canvas edge: a column reserved only for the length of a drag shoves the
    // whole field sideways the instant you lift a card, and a gesture that
    // moves its own target is not a gesture.
    // The room left over is measured against what the stage still has to be
    // given, since the stage is placed after this and not before it.
    const wantsNew = newGroup !== 'never' && newGroup !== 'rail' && (regions.length || piles.length)
      && (newGroup === 'always' || margin + room - x - stageSpan >= NEW_W - 0.5);
    const newSlot = wantsNew ? { x, y: top, w: NEW_W, h: availH } : null;
    if (newSlot) x += NEW_W + gap;

    placeStage(x);
    if (n) x += stageW + gap;

    // The middle of the bar between the field's side of the canvas and the
    // stage: where the seam is drawn, and the coordinate `stops` speaks in.
    // With every group folded there is no field left to end and the bar is
    // the gap the rail already carries.
    const seamX = subCols ? margin + railSpan + fieldW + gap / 2 : margin + railSpan - gap / 2;

    /** Where the seam has somewhere to stand, as seam-x, low to high.
     *
     *  The field's width is not a continuum. A column reads between FIELD_MIN
     *  and FIELD_MAX and nowhere else, and a group either holds a column or
     *  is a pile in the rail — so between one shape of the field and the next
     *  there are only a handful of widths that mean anything. These are them:
     *  for every shape the field can still take, the width its columns read
     *  tightest at, the width they ask for, and the width they stop widening
     *  at. The last of them is the field folded away altogether, which is a
     *  rail and no columns.
     *
     *  φ is in the list too, taken from a pack with no hand on it rather than
     *  computed a second way, so the place the seam rests is a place it can
     *  also be dropped.
     *
     *  Lazy, and priced accordingly: it replays the fold order and packs the
     *  canvas once more, which is a thing to do when a hand comes down on the
     *  seam and not on every frame of the drag it starts. */
    const stops = () => {
      const kept = [];
      const add = (at, rank) => {
        if (!Number.isFinite(at)) return;
        kept.push({ at, rank });
      };
      // The travel starts at the shape the canvas already insisted on, so the
      // folds it forced are folded here too. Starting from every group open
      // instead — which is what `baseOpen` is — priced the first shapes at a
      // floor no canvas could pay, and every one of them fell off the end of
      // the list. A field with anything already folded was left with a stop
      // or two out of a dozen, a `min` hundreds of pixels above the rail it
      // can actually fold to, and therefore a whole leftward drag spent
      // inside a rubber band.
      const already = foldOrder.slice(0, forced);
      let openK = baseOpen.filter((group) => !already.includes(group));
      const foldedK = [...baseFolded, ...already];
      let ceiling = Infinity;  // the floor of the shape one fold back
      // The one stretch of the travel with nothing in it. Every shape of the
      // field covers a run of widths — its floor up to the floor of the shape
      // before — and the runs meet, so the travel is continuous all the way
      // down to the last column. Under that there is only the rail, which is
      // one width and not a run: between the narrowest column the field can
      // show and the rail it folds to, there is no width at all.
      let hollow = null;
      // The widths where a group changes form: at each shape's floor the next
      // group folds into the rail, and a hand crossing one is watching a
      // column become a pile. The caller wants to know because that is a
      // change of contents rather than of size, and it is the one thing in a
      // drag that should ease rather than track.
      const folds = [];
      for (let k = forced; k <= foldOrder.length; k += 1) {
        if (k > forced) {
          const victim = foldOrder[k - 1];
          openK = openK.filter((group) => group !== victim);
          foldedK.push(victim);
        }
        const shapeK = shapeField(openK);
        const span = railMetrics(foldedK).span;
        const edge = (w) => margin + span + (shapeK.subCols ? shapeK.subCols * w + shapeK.fixed : 0);
        const floorK = edge(fieldMin);
        if (!shapeK.subCols) {
          // No columns left: the seam stands in the bar the rail carries.
          const shut = margin + span - gap / 2;
          add(shut, 1);
          if (Number.isFinite(ceiling)) hollow = [shut, ceiling + gap / 2];
          break;
        }
        // A width only counts while the shape that offers it is the shape the
        // packer would choose, which is up to the floor of the shape before.
        for (const [w, rank] of [[fieldMin, 1], [fieldPref, 2], [fieldMax, 1]]) {
          const at = edge(w);
          if (at < ceiling - 0.5) add(at + gap / 2, rank);
        }
        if (floorK < ceiling - 0.5) folds.push(floorK + gap / 2);
        ceiling = floorK;
      }
      // Where the layout puts the seam when nobody is holding it.
      const rest = split == null ? seamX : packFocus({ ...options, split: null }).seamX;
      add(rest, 3);
      // And the ratios a person can name. The widths above are the layout's
      // own vocabulary — what a column reads at, what a group costs — but a
      // canvas split in half or in thirds is a thing you mean to ask for, and
      // it is the only kind of state you can describe over a desk. φ is one of
      // these already; it arrives as the rest position above.
      for (const share of [1 / 3, 1 / 2, 2 / 3]) add(margin + room * share, 2);
      // Two stops a few pixels apart are one stop, and the one that means
      // more keeps the place: φ over a preferred width over a floor.
      kept.sort((a, b) => a.at - b.at || b.rank - a.rank);
      const at = [];
      for (const stop of kept) {
        const last = at.length - 1;
        if (last >= 0 && stop.at - at[last] < 14) continue;
        at.push(stop.at);
      }
      // The ends of the travel. Past the low one there is no field left to
      // fold; past the high one the stage is at reading width, which the seam
      // does not cross.
      const low = at.length ? at[0] : seamX;
      const high = margin + room - stageAt(paneMin) - gap / 2;
      return {
        at: at.filter((v) => v <= high + 0.5),
        min: low,
        max: Math.max(low, high),
        hollow,
        folds,
      };
    };

    return {
      stage,
      // Piles stand in the same list as the regions they are the folded form
      // of: a basin is painted from this, a drop is hit-tested against it, and
      // neither cares how big the box is.
      regions: [...piles, ...railRegions, ...regions],
      piles,
      // The expanded field as one box, and where the seam between it and the
      // stage ended up standing. A seam dragged by hand reads both from here
      // rather than re-measuring the canvas, so what it moves is the split
      // the layout actually used — floors, rounding and all.
      field: subCols ? { x: margin + railSpan, y: top, w: fieldW, h: availH } : null,
      // The rail is the field's folded half, so the seam stands to the right
      // of both of them: `fieldEdge` is where that half ends.
      railSpan,
      fieldEdge: margin + railSpan + fieldW,
      seamX,
      stops,
      // Where the seam ended up, in the unit a hand sets it in: its distance
      // from the right edge of the canvas, over the canvas. A field folded
      // away to its rail still has one — the rail is what is left of the
      // field — and with nothing at all on that side there is no seam and no
      // split.
      split: (n && (subCols || piles.length)) ? (1 - (seamX - margin) / room) : null,
      room,
      newGroup: newSlot,
      rects,
      colW,
      // The canvas never scrolls sideways. Everything above is a negotiation
      // to make that true; this is only where it is stated.
      width: Math.max(canvas.w, 2 * margin),
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

  // ------------------------------------------------------------- the peek
  //
  // What a chat was about, for the card a pointer is resting on. A title is
  // written by a namer and generalises; the two things that actually tell one
  // chat from another are the last thing you asked and the last thing that
  // came back, and neither of them fits on a card.
  //
  // Facts, not lines: the page renders them, because the tool labeller and
  // the tag pills are browser things and this module is read by the host too.

  /** Markdown with the markup taken out. A peek is a glance — `**bold**` in a
   *  glance is noise as syntax and noise as weight — so the marks go and the
   *  words stay. Single underscores are left alone: `run_of_words` is a file
   *  name far more often than it is emphasis. */
  const plainOf = (text) => String(text ?? '')
    .replace(/```[\w-]*\n?/g, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const DOC_WRITES = new Set(['document.changed', 'ops.applied']);

  /** `{ meta, turns, events }` from `GET /agent/conversations/:id`, digested.
   *  `doing` is the tail of the tool calls — what it is doing now, while it is
   *  running; `said` is the last thing it said; `touched` is the documents it
   *  wrote to, most recent first. */
  const peekOf = (detail, { doing: doingCap = 3, touched: touchedCap = 4 } = {}) => {
    const meta = detail?.meta ?? {};
    const turns = Array.isArray(detail?.turns) ? detail.turns : [];
    const events = Array.isArray(detail?.events) ? detail.events : [];

    // The last turn, whatever became of it: a queued one is still the thing
    // you last asked for, and a failed one is still what you were after.
    const last = turns[turns.length - 1] ?? null;
    let asked = plainOf(last?.prompt ?? '');
    if (!asked) {
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i]?.type === 'user') {
          asked = plainOf(events[i].text ?? '');
          break;
        }
      }
    }

    // One pass backwards: the newest of everything is what a peek wants.
    let said = '';
    const doing = [];
    const touched = [];
    let tools = 0;
    const lastTurn = last?.id ?? null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      const type = event?.type;
      if (type === 'text') {
        if (!said) said = plainOf(event.text ?? '');
      } else if (type === 'tool.call') {
        if (doing.length < doingCap) doing.unshift({ name: event.name ?? '', input: event.input ?? {} });
        if (!lastTurn || !event.turn || event.turn === lastTurn) tools += 1;
      } else if (DOC_WRITES.has(type) && event.path
        && !touched.includes(event.path) && touched.length < touchedCap) {
        touched.push(event.path);
      }
    }

    return {
      id: meta.id ?? '',
      asked,
      askedAt: last?.createdAt ?? null,
      said,
      doing,
      touched,
      tools,
      turns: turns.length,
      model: meta.model ?? '',
    };
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
    PILE_W,
    PILE_MIN_H,
    PILE_DOT,
    PILE_OPEN_W,
    PILE_ROW_H,
    PANE_FLOOR,
    PHI,
    GOLDEN_SPLIT,
    SPLIT_MIN,
    SPLIT_MAX,
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
    plainOf,
    peekOf,
  };
})();
