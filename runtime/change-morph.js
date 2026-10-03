// The engine: end states in, motion out (v5, Notes and Sketches/Ask at
// Anything, "End states in, motion out" and "Scales, not a queue").
//
// Nothing that writes to a page animates it. An agent's batch, a worker's
// shard, an undo and a rule are all end states: ops that make the page what
// it is next. So the page keeps the one engine that moves anything, and it
// moves from what was to what is:
//
//   - just before a batch lands, `capture` reads what its parts look like and
//     where they and their neighbours stand (and, for a change to a sheet,
//     what every element in view looks like);
//   - once it has landed, `play` reads them again and plays the difference:
//     numbers in a style (corners, padding, gaps, type) run from the old
//     value to the new; colours run through OKLCH; what moved or changed size
//     is drawn where it was and slides to where it is (FLIP); what was put in
//     rises 3px from .98; what was taken out is drawn where it stood and
//     fades while its neighbours close the gap; new words are written in at
//     reading pace once the old ones have faded; anything else crossfades;
//   - the parts move in loose batches of two to six, each batch drawn far
//     from the last, about 60 ms apart and all started within 600 ms
//     (`choreograph`), so a change of thirty parts reads as one change
//     spreading over the page and not as a queue.
//
// With reduced motion every change is one 150 ms crossfade, all at once.
// Past its budget (60 parts, 300 restyled elements, a hidden tab, a snapshot
// gone stale) nothing moves and every part is let go at once. What the
// person's hand is on (focus, caret, a drag) never moves. Every motion is the
// Web Animations API, tagged `marble-morph`, and only those are ever
// cancelled; words are hidden with a highlight, which paints ranges without
// touching a node; ghosts live in one fixed transient layer outside the
// addressed tree. Nothing here is ever filed as an op.

(() => {
  if (window.marbleMorph) return;

  const TRANSIENT = 'data-marble-transient';
  const ID = 'data-marble-id';
  const TAG = 'marble-morph';
  const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)';      // arriving and settling
  const EASE_COLOUR = 'cubic-bezier(.22, .61, .36, 1)'; // colour
  const HIGHLIGHT = 'marble-morph-unwritten';
  const DRAGGED = '[data-marble-dragging], .marble-dragging';

  const PROPS = [
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap',
    'fontSize', 'letterSpacing', 'lineHeight', 'opacity',
    'color', 'backgroundColor', 'borderTopColor', 'outlineColor',
  ];
  const COLOURS = new Set(['color', 'backgroundColor', 'borderTopColor', 'outlineColor']);
  // `normal` is no length, but for these it is none at all.
  const ZERO_WHEN_NORMAL = new Set(['letterSpacing', 'rowGap', 'columnGap']);

  // Budget.
  const MOST_PARTS = 60;     // parts in one batch before nothing moves
  const MOST_LOOK = 300;     // elements a sheet's change reads, and restyles before nothing moves
  const SCAN = 5000;         // elements a sheet's change looks through for those in view
  const NEAR = 40;           // neighbours read for each part, for what moves round it
  const STALE = 10_000;      // ms a snapshot keeps
  const GHOST_STYLED = 150;  // elements of a ghost given their own look

  // Scales, not a queue.
  const GAP = 60;            // ms between batch starts
  const JITTER = 30;         // ± ms on each gap
  const LAST_START = 600;    // ms by which every batch has started
  const SHORTEST_RUN = 380;  // ms a part's numbers take, at least
  const LONGEST_RUN = 460;   // and at most
  const BATCH_MIN = 2;
  const BATCH_MAX = 6;
  const ORDERED = 14;        // batches up to this many are put in the order that keeps each far from the last

  // Clocks.
  const COLOUR = 300;        // ms a colour takes
  const MOVE = 340;          // ms what moved takes to get where it is
  const ARRIVE = 340;        // ms what was put in takes to rise
  const GHOST = 200;         // ms what was taken out takes to fade
  const CROSSFADE = 150;     // ms anything else takes, and everything with reduced motion
  const OLD_WORDS = 150;     // ms the replaced words take to fade
  const RATE = 60;           // characters a second the new words are written at
  const WRITE_MIN = 220;     // ms, so one word is still seen arriving
  const WRITE_MAX = 1500;    // ms, however much there is to write
  const PLAIN_FADE = 200;    // ms the new words fade in where words cannot be hidden
  const SLACK = 600;         // ms past the last motion's end before a play is finished regardless

  const SKIP = new Set(['HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'NOSCRIPT', 'BR', 'WBR', 'SOURCE', 'TRACK']);
  const SOLID = 'img, svg, canvas, video, audio, iframe, input, select, textarea, button, table, ul, ol, dl, hr, marble-alt, [data-marble-run]';
  const stillness = matchMedia('(prefers-reduced-motion: reduce)');
  const canMark = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';

  const STYLE = `
    .marble-morph-layer { position: fixed; inset: 0; pointer-events: none; overflow: visible; }
    .marble-morph-ghost, .marble-morph-ghost * { pointer-events: none !important; }
    .marble-morph-ghost { position: fixed; margin: 0; box-sizing: border-box; }
    ::highlight(${HIGHLIGHT}) { color: transparent; text-shadow: none; }
  `;

  const style = document.createElement('style');
  style.setAttribute(TRANSIENT, '');
  style.textContent = STYLE;
  (document.head ?? document.documentElement).append(style);

  let layer = null;
  function layerOf() {
    if (layer?.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'marble-morph-layer';
    layer.setAttribute(TRANSIENT, '');
    layer.setAttribute('aria-hidden', 'true');
    document.documentElement.append(layer);
    return layer;
  }

  // ------------------------------------------------------------ small things

  const byId = (id) => (id ? (window.marble?.byId?.(id) ?? document.querySelector(`[${ID}="${CSS.escape(id)}"]`)) : null);
  const unique = (value) => (Array.isArray(value) ? [...new Set(value.filter((v) => v != null && v !== '').map(String))] : []);
  const transient = (el) => Boolean(el?.closest?.(`[${TRANSIENT}]`));
  const fits = (el) => Boolean(el) && el.nodeType === 1 && !SKIP.has(el.tagName) && !el.hasAttribute(TRANSIENT);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const tell = (onPart, id, phase) => {
    if (!onPart) return;
    try {
      onPart(id, phase);
    } catch (err) {
      console.error('[marble-morph] onPart', err);
    }
  };

  /** Where an element stands in the window, as it is drawn now (a motion
   *  in flight included: a new motion starts from there). In the window and
   *  not on the page: what the person sees is what must not jump. When
   *  something above the window grows, the browser scrolls to keep what is
   *  in view where it was (scroll anchoring), and that has not moved. */
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  const inView = (r) => Boolean(r) && (r.width > 0 || r.height > 0)
    && r.top < innerHeight && r.top + r.height > 0
    && r.left < innerWidth && r.left + r.width > 0;
  const centreOf = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  function propsOf(el) {
    const css = getComputedStyle(el);
    const out = {};
    for (const prop of PROPS) out[prop] = css[prop];
    return out;
  }

  // Words: text offsets over the element's own text nodes.
  function textNodes(root) {
    const out = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest(`[${TRANSIENT}], script, style`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n);
    return out;
  }
  const textOf = (root) => textNodes(root).map((n) => n.data).join('');
  function point(nodes, root, offset) {
    let left = offset;
    for (const n of nodes) {
      if (left <= n.length) return [n, left];
      left -= n.length;
    }
    const last = nodes.at(-1);
    return last ? [last, last.length] : [root, root.childNodes.length];
  }
  function rangeOf(root, from, to) {
    const nodes = textNodes(root);
    const range = document.createRange();
    const [a, ao] = point(nodes, root, from);
    const [b, bo] = point(nodes, root, to);
    range.setStart(a, ao);
    range.setEnd(b, bo);
    return range;
  }

  /** A block holding nothing but words: inline children only, and none of
   *  them a control, a picture or structure. */
  function isTextBlock(el) {
    if (!fits(el) || el.matches(SOLID) || el.querySelector(SOLID)) return false;
    for (const child of el.children) {
      if (child.hasAttribute(TRANSIENT)) continue;
      const d = getComputedStyle(child).display;
      if (d !== 'none' && d !== 'contents' && !d.startsWith('inline')) return false;
    }
    return true;
  }

  const classesOf = (el) => [...el.classList].filter((c) => !c.startsWith('marble-')).join(' ');
  /** What a part is built of, without its words: which elements, in which
   *  shape, with which attributes. */
  function skeletonOf(el) {
    let out = '';
    let n = 0;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => (node.hasAttribute(TRANSIENT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walk.nextNode(); node && n < 3000; node = walk.nextNode(), n += 1) {
      out += `<${node.tagName}|${node.childElementCount}`;
      for (const a of node.attributes) out += a.name === 'class' ? ` class=${classesOf(node)}` : ` ${a.name}=${a.value}`;
      out += '>';
    }
    return out;
  }
  function attrsOf(el) {
    return [...el.attributes].map((a) => (a.name === 'class' ? `class=${classesOf(el)}` : `${a.name}=${a.value}`)).sort().join('\n');
  }

  // ------------------------------------------------------------ colour
  //
  // Computed colours come as rgb(), color(srgb …), color(display-p3 …),
  // oklab() or oklch(). Each is taken to OKLab (Björn Ottosson's), and a
  // colour's motion is written as oklch() keyframes along the OKLCH path, the
  // shorter way round the hue, so a blue going green does not pass through
  // grey on the way.

  const toLinear = (c) => {
    const sign = c < 0 ? -1 : 1;
    const x = Math.abs(c);
    return sign * (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  };
  function linearToOklab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
  }
  const P3_TO_SRGB = [
    [1.2249401762805598, -0.22494017628055996, 0],
    [-0.04205695470968816, 1.0420569547096881, 0],
    [-0.019637554590334432, -0.07863604555063188, 1.0982736001409663],
  ];
  const times = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const num = (part, scale = 1) => {
    if (part === undefined || part === 'none') return 0;
    return part.endsWith('%') ? (parseFloat(part) / 100) * scale : parseFloat(part);
  };

  /** A computed colour as { L, C, H, A } in OKLCH, or null when it is not
   *  one this can read. */
  function oklchOf(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) return null;
    if (s === 'transparent') return { L: 0, C: 0, H: 0, A: 0 };
    const m = /^([a-z-]+)\((.*)\)$/.exec(s);
    if (!m) return null;
    const [fn, body] = [m[1], m[2]];
    const [main, alpha] = body.split('/');
    let parts = main.split(/[\s,]+/).filter(Boolean);
    let A = alpha !== undefined ? num(alpha.trim()) : 1;
    let lab = null;
    if (fn === 'rgb' || fn === 'rgba') {
      if (alpha === undefined && parts.length === 4) A = num(parts[3]);
      const rgb = parts.slice(0, 3).map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255));
      lab = linearToOklab(rgb.map(toLinear));
    } else if (fn === 'color') {
      const space = parts[0];
      parts = parts.slice(1, 4).map((p) => num(p));
      if (space === 'srgb') lab = linearToOklab(parts.map(toLinear));
      else if (space === 'srgb-linear') lab = linearToOklab(parts);
      else if (space === 'display-p3') lab = linearToOklab(times(P3_TO_SRGB, parts.map(toLinear)));
      else return null;
    } else if (fn === 'oklab') {
      lab = [num(parts[0]), num(parts[1], 0.4), num(parts[2], 0.4)];
    } else if (fn === 'oklch') {
      const L = num(parts[0]);
      const C = num(parts[1], 0.4);
      const H = num(parts[2]);
      if ([L, C, H, A].some((n) => !Number.isFinite(n))) return null;
      return { L, C, H: ((H % 360) + 360) % 360, A };
    } else {
      return null;
    }
    if (!lab || lab.some((n) => !Number.isFinite(n)) || !Number.isFinite(A)) return null;
    const [L, a, b] = lab;
    const C = Math.hypot(a, b);
    const H = C < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    return { L, C, H, A };
  }

  const writeOklch = ({ L, C, H, A }) => `oklch(${+L.toFixed(4)} ${+C.toFixed(4)} ${+H.toFixed(2)} / ${+clamp(A, 0, 1).toFixed(3)})`;

  /** `from` to `to` in OKLCH at t. A colour with no hue takes the other's;
   *  a colour that is not there at all takes the other's look, so only its
   *  alpha moves. */
  function mixOklch(from, to, t) {
    let p = from;
    let q = to;
    if (p.A < 0.001) p = { ...q, A: 0 };
    if (q.A < 0.001) q = { ...p, A: 0 };
    let h1 = p.H;
    let h2 = q.H;
    if (p.C < 0.0005) h1 = h2;
    if (q.C < 0.0005) h2 = h1;
    let dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
    return {
      L: p.L + (q.L - p.L) * t,
      C: p.C + (q.C - p.C) * t,
      H: (((h1 + dh * t) % 360) + 360) % 360,
      A: p.A + (q.A - p.A) * t,
    };
  }
  const sameColour = (p, q) => Math.abs(p.A - q.A) < 0.01
    && Math.hypot(p.L - q.L, p.C * Math.cos((p.H * Math.PI) / 180) - q.C * Math.cos((q.H * Math.PI) / 180),
      p.C * Math.sin((p.H * Math.PI) / 180) - q.C * Math.sin((q.H * Math.PI) / 180)) < 0.002;

  // ------------------------------------------------------------ the dealer

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const meanOf = (ps) => (ps.length
    ? { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length }
    : { x: 0, y: 0 });
  function positionOf(item) {
    const r = item?.rect ?? item;
    if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) return { x: r.x, y: r.y };
    if (r && Number.isFinite(r.left) && Number.isFinite(r.top)) return { x: r.left + (r.width || 0) / 2, y: r.top + (r.height || 0) / 2 };
    return { x: 0, y: 0 };
  }

  /** The order of `batches` that keeps the closest two consecutive batches
   *  as far apart as it can: the largest distance for which a path through
   *  every batch exists, by bisection, each step a bounded search. */
  function farApart(batches) {
    const n = batches.length;
    if (n < 3 || n > ORDERED) return batches;
    const D = batches.map((a) => batches.map((b) => distance(a.c, b.c)));
    const steps = [...new Set(D.flat().filter((d) => d > 0))].sort((a, b) => a - b);
    const pathAbove = (least) => {
      const used = new Array(n).fill(false);
      const seq = [];
      let budget = 3000;
      const reach = (i) => {
        let c = 0;
        for (let j = 0; j < n; j += 1) if (!used[j] && j !== i && D[i][j] >= least) c += 1;
        return c;
      };
      const go = (i) => {
        budget -= 1;
        if (budget < 0) return false;
        used[i] = true;
        seq.push(i);
        if (seq.length === n) return true;
        const next = [];
        for (let j = 0; j < n; j += 1) if (!used[j] && D[i][j] >= least) next.push(j);
        // The one with the fewest ways on goes first, or it is left stranded.
        next.sort((a, b) => reach(a) - reach(b));
        for (const j of next) if (go(j)) return true;
        used[i] = false;
        seq.pop();
        return false;
      };
      const starts = [...Array(n).keys()].sort((a, b) => reach(a) - reach(b));
      for (const s of starts) {
        if (go(s)) return seq.slice();
        if (budget < 0) return null;
      }
      return null;
    };
    let lo = 0;
    let hi = steps.length - 1;
    let best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const seq = pathAbove(steps[mid]);
      if (seq) {
        best = seq;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best ? best.map((i) => batches[i]) : batches;
  }

  /** "Scales, not a queue": who starts when, and for how long. Pure. Each
   *  item may carry `rect` ({ left, top, width, height }) or `x`/`y`, or
   *  `opts.at(item)` says where it is. Returns, in the items' order,
   *  { item, delay, duration, batch }. */
  function choreograph(items, opts = {}) {
    const list = Array.isArray(items) ? items : [];
    const spread = opts.spread !== false;
    const random = typeof opts.random === 'function' ? opts.random : Math.random;
    const at = typeof opts.at === 'function' ? opts.at : positionOf;
    const n = list.length;
    if (!n) return [];
    const pts = list.map((item) => {
      const p = at(item) ?? {};
      return { x: Number.isFinite(p.x) ? p.x : 0, y: Number.isFinite(p.y) ? p.y : 0 };
    });
    // Batches of two to six: each seeded by the part farthest from where the
    // last batch was, and filled with that part's nearest neighbours.
    const left = list.map((_, i) => i);
    const batches = [];
    let last = meanOf(pts);
    while (left.length) {
      let size = BATCH_MIN + Math.floor(random() * (BATCH_MAX - BATCH_MIN + 1));
      if (left.length - size === 1) size = size < BATCH_MAX ? size + 1 : size - 1;
      size = clamp(size, 1, left.length);
      let members;
      if (!spread) {
        members = left.splice(0, size);
      } else {
        let seedAt = 0;
        let far = -1;
        left.forEach((i, k) => {
          const d = distance(pts[i], last);
          if (d > far) { far = d; seedAt = k; }
        });
        const [seed] = left.splice(seedAt, 1);
        left.sort((a, b) => distance(pts[a], pts[seed]) - distance(pts[b], pts[seed]));
        members = [seed, ...left.splice(0, size - 1)];
      }
      last = meanOf(members.map((i) => pts[i]));
      batches.push({ members, c: last });
    }
    const order = spread ? farApart(batches) : batches;
    // About 60 ms apart, give or take 30, and all started within 600 ms.
    let t = 0;
    const starts = order.map((_, k) => {
      if (k) t += GAP + (random() * 2 - 1) * JITTER;
      return t;
    });
    const latest = starts.at(-1);
    const squeeze = latest > LAST_START ? LAST_START / latest : 1;
    const out = new Array(n);
    order.forEach((batch, k) => {
      const delay = Math.round(starts[k] * squeeze);
      for (const i of batch.members) {
        out[i] = { item: list[i], delay, duration: Math.round(SHORTEST_RUN + random() * (LONGEST_RUN - SHORTEST_RUN)), batch: k };
      }
    });
    return out;
  }

  // ------------------------------------------------------------ what is left of a play

  // id -> the ghosts and the words being written for it, finished on the
  // next capture of the same id or when its play is done.
  const leftovers = new Map();
  function keep(id, finish) {
    if (!id) return;
    (leftovers.get(id) ?? leftovers.set(id, new Set()).get(id)).add(finish);
  }
  function drop(id, finish) {
    const set = leftovers.get(id);
    if (!set) return;
    set.delete(finish);
    if (!set.size) leftovers.delete(id);
  }
  function clean(id) {
    const set = leftovers.get(id);
    if (!set) return;
    leftovers.delete(id);
    for (const finish of set) finish();
  }

  const marks = canMark ? new Highlight() : null;
  function hide(range) {
    if (!marks || !range) return;
    marks.add(range);
    if (CSS.highlights.get(HIGHLIGHT) !== marks) CSS.highlights.set(HIGHLIGHT, marks);
  }
  function unhide(range) {
    if (!marks || !range) return;
    marks.delete(range);
    if (!marks.size && CSS.highlights.get(HIGHLIGHT) === marks) CSS.highlights.delete(HIGHLIGHT);
  }

  /** Only this engine's motions, never the page's own. */
  function cancelOwn(el) {
    for (const a of el.getAnimations()) if (a.id === TAG) a.cancel();
  }
  function animate(el, keyframes, timing) {
    const a = el.animate(keyframes, timing);
    a.id = TAG;
    return a;
  }
  const ended = (a) => a.finished.then(() => {}, () => {});

  // ------------------------------------------------------------ under a hand
  //
  // Nothing eases under a hand. A press, focus, or a drag that begins while
  // something is moving stops this engine's motion on what it lands on (and
  // on what carries that, and what is in it) at once, where it is going.

  const beingWritten = new Map(); // element -> finish, for words being written in
  let playing = 0;
  function letGoUnder(el) {
    if (!el || el.nodeType !== 1 || transient(el)) return;
    for (let up = el; up && up !== document.documentElement; up = up.parentElement) cancelOwn(up);
    if (el !== document.body && el !== document.documentElement) {
      for (const a of el.getAnimations({ subtree: true })) if (a.id === TAG) a.cancel();
    }
    for (const [node, finish] of [...beingWritten]) if (node === el || el.contains(node) || node.contains(el)) finish();
  }
  addEventListener('pointerdown', (event) => { if (playing) letGoUnder(event.target); }, true);
  addEventListener('focusin', (event) => { if (playing) letGoUnder(event.target); }, true);
  const drags = new MutationObserver((records) => {
    for (const { target } of records) if (target.nodeType === 1 && target.matches(DRAGGED)) letGoUnder(target);
  });
  function begin() {
    playing += 1;
    if (playing === 1) drags.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class', 'data-marble-dragging'] });
  }
  function done() {
    playing = Math.max(0, playing - 1);
    if (!playing) drags.disconnect();
  }

  // ------------------------------------------------------------ ghosts

  // What a ghost needs of each element to look as it did: its box, its
  // type, its colours. Read while the element is still on the page.
  const LOOKS = [
    'display', 'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-clip',
    'color', 'opacity', 'visibility', 'box-shadow', 'outline-style', 'outline-width', 'outline-color',
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'font-feature-settings', 'font-variation-settings',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform', 'text-shadow',
    'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-overflow',
    'white-space', 'vertical-align', 'overflow-wrap', 'word-break', 'direction', 'writing-mode',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order',
    'align-items', 'align-content', 'align-self', 'justify-content', 'justify-items', 'justify-self',
    'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
    'list-style-type', 'list-style-position', 'overflow-x', 'overflow-y', 'object-fit', 'object-position',
    'position', 'top', 'right', 'bottom', 'left', 'float', 'aspect-ratio', 'transform', 'filter',
    'fill', 'stroke', 'stroke-width',
  ];
  const UNGHOSTED = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'iframe', 'object', 'embed', 'noscript', 'template', 'frame', 'frameset']);
  const STRIP = ['id', ID, 'name', 'for', 'form', 'autofocus', 'autoplay', 'contenteditable', 'tabindex', 'accesskey', 'popover', 'draggable'];

  /** A copy of `el` that looks as it does, drawn on its own outside the
   *  page: no ids, no scripts, nothing that can be pressed or focused. */
  function ghostOf(el, rect, most = GHOST_STYLED) {
    const clone = el.cloneNode(true);
    const from = [el, ...el.querySelectorAll('*')];
    const to = [clone, ...clone.querySelectorAll('*')];
    const styled = Math.max(1, Math.min(from.length, to.length, most));
    for (let i = 0; i < styled; i += 1) {
      const css = getComputedStyle(from[i]);
      const look = to[i].style;
      for (const name of LOOKS) look.setProperty(name, css.getPropertyValue(name));
    }
    for (const node of to) {
      if (!node.isConnected && node !== clone && !clone.contains(node)) continue;
      // No scripts, frames or sheets: a ghost's look is already its own, and
      // a sheet in it would restyle the page under it while it fades.
      if (node !== clone && (node.hasAttribute(TRANSIENT) || UNGHOSTED.has(node.localName))) {
        node.remove();
        continue;
      }
      for (const name of STRIP) node.removeAttribute(name);
      for (const a of [...node.attributes]) if (/^on/i.test(a.name)) node.removeAttribute(a.name);
      for (const name of [...node.classList]) if (name.startsWith('marble-')) node.classList.remove(name);
    }
    const display = getComputedStyle(el).display;
    const look = clone.style;
    // On its own, a row or a cell is a box, and an inline thing a block.
    const alone = display === 'table-row' ? 'flex'
      : display.startsWith('inline-') ? display.slice('inline-'.length)
        : /^(inline|table-cell|contents)$/.test(display) ? 'block' : display;
    look.setProperty('display', alone);
    for (const [name, value] of [
      ['position', 'fixed'], ['margin', '0'], ['transform', 'none'], ['transition', 'none'], ['animation', 'none'],
      ['max-width', 'none'], ['max-height', 'none'], ['min-width', '0'], ['min-height', '0'],
      ['right', 'auto'], ['bottom', 'auto'], ['z-index', 'auto'], ['box-sizing', 'border-box'],
      ['width', `${rect.width}px`], ['height', `${rect.height}px`],
    ]) look.setProperty(name, value);
    clone.classList.add('marble-morph-ghost');
    clone.setAttribute(TRANSIENT, '');
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');
    return { node: clone, opacity: seenOpacity(el), styled };
  }

  /** How much of an element shows: its opacity and every one above it. */
  function seenOpacity(el) {
    if (getComputedStyle(el).visibility !== 'visible') return 0;
    let seen = 1;
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const o = Number(getComputedStyle(node).opacity);
      seen *= Number.isFinite(o) ? o : 1;
      if (seen < 0.01) return 0;
    }
    return seen;
  }

  function placeGhost(node, rect) {
    node.style.setProperty('left', `${rect.left}px`);
    node.style.setProperty('top', `${rect.top}px`);
    layerOf().append(node);
  }

  // The look of an element's words, for drawing the old ones where they were.
  const WORD_LOOKS = [
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'font-feature-settings', 'font-variation-settings',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform', 'white-space', 'overflow-wrap',
    'word-break', 'direction', 'color', 'text-shadow', 'tab-size', 'hyphens',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  ];
  /** The words that were, drawn where they stood: only the ones replaced
   *  show; the rest hold their places unseen. */
  function oldWordsOf(el, text, from, to, rect) {
    const node = document.createElement('div');
    const css = getComputedStyle(el);
    for (const name of WORD_LOOKS) node.style.setProperty(name, css.getPropertyValue(name));
    node.style.setProperty('border-style', 'solid');
    node.style.setProperty('border-color', 'transparent');
    node.style.setProperty('width', `${rect.width}px`);
    node.style.setProperty('height', `${rect.height}px`);
    node.style.setProperty('overflow', 'hidden');
    const unseen = (words) => {
      const span = document.createElement('span');
      span.style.color = 'transparent';
      span.style.textShadow = 'none';
      span.textContent = words;
      return span;
    };
    const seen = document.createElement('span');
    seen.textContent = text.slice(from, to);
    node.append(unseen(text.slice(0, from)), seen, unseen(text.slice(to)));
    node.className = 'marble-morph-ghost';
    node.setAttribute(TRANSIENT, '');
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  // ------------------------------------------------------------ capture

  /** Up to NEAR elements round `at` under `parent` (all but `skip`), then
   *  what follows the parent and its parents: what moves when a part grows,
   *  shrinks, comes or goes. */
  function nearOf(parent, at, skip) {
    const out = [];
    if (parent && parent !== document.documentElement && parent !== document.head) {
      const kids = [...parent.children].filter(fits);
      let i = at ? kids.indexOf(at) : -1;
      if (i < 0) i = kids.length;
      const from = Math.max(0, Math.min(i - 8, kids.length - NEAR - 1));
      for (const kid of kids.slice(from, from + NEAR + 1)) if (kid !== skip && out.length < NEAR) out.push(kid);
    }
    for (let up = parent; up && up !== document.body && up !== document.documentElement && out.length < NEAR; up = up.parentElement) {
      for (let s = up.nextElementSibling; s && out.length < NEAR; s = s.nextElementSibling) if (fits(s)) out.push(s);
    }
    return out;
  }

  const isSheet = (el) => el?.tagName === 'STYLE' || (el?.tagName === 'LINK' && /stylesheet/i.test(el.rel ?? ''));

  /** What `ids` look like and where they and what is round them stand, just
   *  before a batch lands. `opts` is the batch's presence frame: its kind,
   *  removes and inserts (and client); `scope: 'page'` reads every element
   *  in view, as a change to a sheet does. */
  function capture(ids, opts = {}) {
    const parts = unique(ids);
    const removes = unique(opts?.removes);
    const inserts = (Array.isArray(opts?.inserts) ? opts.inserts : [])
      .map((e) => ({ parentId: e?.parentId ? String(e.parentId) : null, beforeId: e?.beforeId ? String(e.beforeId) : null, ids: unique(e?.ids) }))
      .filter((e) => e.ids.length);
    for (const id of new Set([...parts, ...removes])) clean(id);
    const snap = {
      at: performance.now(),
      ids: parts,
      kind: opts?.kind ?? null,
      client: opts?.client ? String(opts.client) : null,
      look: false,
      entries: [],
      ghosts: new Map(),
      inserted: new Set(inserts.flatMap((e) => e.ids)),
      visible: 0,
      read: 0,
      skip: null,
    };
    if (parts.length > MOST_PARTS) { snap.skip = 'parts'; return snap; }
    if (document.hidden) { snap.skip = 'hidden'; return snap; }

    const known = new Map(); // element -> entry
    const add = (el, { owner = null, props = false, part = false } = {}) => {
      let entry = known.get(el);
      if (!entry) {
        entry = { el, id: el.getAttribute(ID), owner, part: null, rect: rectOf(el), props: null };
        known.set(el, entry);
        snap.entries.push(entry);
      }
      if (part && !entry.part) {
        entry.part = part;
        entry.owner = part;
        entry.text = textOf(el);
        entry.block = isTextBlock(el);
        entry.skeleton = skeletonOf(el);
        entry.attrs = attrsOf(el);
      }
      if (props && !entry.props) entry.props = propsOf(el);
      return entry;
    };

    // Every element in view under `root`, up to the budget: what a change to
    // a sheet, or to a part's own look, may restyle.
    const scan = (root, owner) => {
      let looked = 0;
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => {
          if (!fits(node) || looked >= SCAN) return NodeFilter.FILTER_REJECT;
          looked += 1;
          // A drawing's insides are its own business.
          if (node.parentElement?.closest('svg')) return NodeFilter.FILTER_REJECT;
          const r = node.getBoundingClientRect();
          if (!r.width && !r.height) return NodeFilter.FILTER_SKIP;
          // Far out of view: so is all that is in it.
          if (r.bottom < -innerHeight || r.top > innerHeight * 2) return NodeFilter.FILTER_REJECT;
          return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      });
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        snap.visible += 1;
        if (snap.read < MOST_LOOK && !known.get(node)?.props) {
          add(node, { owner, props: true });
          snap.read += 1;
        }
      }
    };

    const els = parts.map(byId);
    const deep = ['look', 'attr', 'mixed'].includes(snap.kind);
    snap.look = opts?.scope === 'page' || els.some(isSheet)
      || (snap.kind === 'look' && els.some((el) => el === document.body || el === document.documentElement));
    parts.forEach((id, i) => {
      const el = els[i];
      if (!el?.isConnected || !fits(el) || transient(el)) return;
      add(el, { part: id, props: true });
      if (deep && !snap.look) scan(el, id);
      for (const near of nearOf(el.parentElement, el, el)) add(near, { owner: id });
    });
    for (const { parentId, beforeId, ids: roots } of inserts) {
      const parent = byId(parentId);
      if (!parent || transient(parent)) continue;
      const before = byId(beforeId);
      for (const near of nearOf(parent, before?.parentElement === parent ? before : null, null)) add(near, { owner: roots[0] });
    }
    if (snap.look) scan(document.body, null);
    // What will be taken out, drawn while it is still here. A frame that
    // does not say what kind of change it is (an undo's; a host's before v5)
    // does not say what it takes out either: each part in view gets a ghost
    // ready, as far as the budget goes, and one is used only if its part goes.
    let budget = GHOST_STYLED * 2;
    const ghostable = snap.kind ? removes : [...new Set([...removes, ...parts])];
    for (const id of ghostable) {
      const entry = snap.entries.find((e) => e.part === id);
      if (!entry || !inView(entry.rect) || budget <= 0 || !seenOpacity(entry.el)) continue;
      const ghost = ghostOf(entry.el, entry.rect, Math.min(GHOST_STYLED, budget));
      budget -= ghost.styled;
      snap.ghosts.set(id, { rect: entry.rect, node: ghost.node, opacity: ghost.opacity, parent: entry.el.parentElement });
    }
    return snap;
  }

  // ------------------------------------------------------------ play

  /** The person's hand: what has focus (in an editable surface, the block
   *  their caret is in), and where a selection they made starts. What is
   *  focused or being typed in holds what is inside it too; a selection
   *  holds only what holds it. A note is often one editable surface for the
   *  whole page, so there the caret's block is the hand, not the note. A
   *  click in words that cannot be edited leaves a caret there too, which
   *  is no hand at all. */
  function handNodes() {
    const out = [];
    const active = document.activeElement;
    const sel = getSelection?.();
    const anchor = sel?.rangeCount ? sel.anchorNode : null;
    const anchorEl = anchor ? (anchor.nodeType === 1 ? anchor : anchor.parentElement) : null;
    if (active && active !== document.body && active !== document.documentElement && !transient(active)) {
      out.push({ node: active.isContentEditable && anchorEl && active.contains(anchorEl) ? anchorEl : active, inside: true });
    }
    const editing = Boolean(anchorEl?.isContentEditable);
    if (anchorEl && anchorEl !== document.body && anchorEl !== document.documentElement && !transient(anchorEl) && (editing || !sel.isCollapsed)) {
      out.push({ node: anchorEl, inside: editing });
    }
    return out;
  }

  function numberOf(prop, value) {
    if (value === 'normal' && ZERO_WHEN_NORMAL.has(prop)) return { n: 0, text: '0px' };
    if (prop === 'opacity') {
      const n = Number(value);
      return Number.isFinite(n) ? { n, text: String(value) } : null;
    }
    if (!/^-?[\d.]+(px)?$/.test(String(value).trim())) return null;
    return { n: parseFloat(value), text: String(value) };
  }

  /** Each style number that moved, before and after; and each colour. */
  function styleChanges(before, after) {
    const nums = [];
    const cols = [];
    for (const prop of PROPS) {
      const a = before[prop];
      const b = after[prop];
      if (a === b || a == null || b == null) continue;
      if (COLOURS.has(prop)) {
        const p = oklchOf(a);
        const q = oklchOf(b);
        if (p && q && !sameColour(p, q)) cols.push({ prop, p, q });
        continue;
      }
      const x = numberOf(prop, a);
      const y = numberOf(prop, b);
      if (x && y) {
        if (Math.abs(x.n - y.n) >= (prop === 'opacity' ? 0.01 : 0.5)) nums.push({ prop, from: x.text, to: y.text });
      } else if (prop.endsWith('Radius') && a !== b) {
        // An elliptical or percentage corner: let the browser run it.
        nums.push({ prop, from: a, to: b });
      }
    }
    return { nums, cols };
  }

  const SAMPLES = [0, 0.25, 0.5, 0.75, 1];
  function colourFrames(cols) {
    return SAMPLES.map((t) => {
      const frame = { offset: t };
      for (const { prop, p, q } of cols) frame[prop] = writeOklch(mixOklch(p, q, t));
      return frame;
    });
  }

  /** Common start and end of two strings: what lies between was rewritten. */
  function diff(before, after) {
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
    let tail = 0;
    while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
    return { start, end: after.length - tail, oldEnd: before.length - tail, tail };
  }

  /** The new words, written in one at a time once the old ones have faded,
   *  the way agent-text.js types at its caret. Returns how long it takes in
   *  all, or 0 when there is nothing new to write. */
  function writeWords({ el, id, before, after, rect, delay, waits, motion, finishers }) {
    const { start, end, oldEnd } = diff(before, after);
    const removed = before.slice(start, oldEnd);
    if (end <= start && !removed.trim()) return 0;
    // What the edit left alone after the new words stays seen; only the new
    // words are written in.
    const hideTo = end;
    const length = Math.max(0, end - start);
    const writing = length ? clamp((length / RATE) * 1000, WRITE_MIN, WRITE_MAX) : 0;
    let ghost = null;
    if (removed.trim()) {
      ghost = oldWordsOf(el, before, start, oldEnd, rect);
      placeGhost(ghost, rect);
      waits.push(ended(motion(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: OLD_WORDS, delay, easing: EASE_OUT, fill: 'both' })));
    }
    const begin = delay + (ghost ? OLD_WORDS : 0);
    let finished = false;
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    let hidden = null;
    let raf = 0;
    let timer = 0;
    let guard = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(guard);
      cancelAnimationFrame(raf);
      unhide(hidden);
      hidden = null;
      ghost?.remove();
      drop(id, finish);
      if (beingWritten.get(el) === finish) beingWritten.delete(el);
      resolve();
    };
    keep(id, finish);
    beingWritten.set(el, finish);
    finishers.push(finish);
    waits.push(done);
    if (!marks) {
      // No way to hide words: the new ones fade in once the old have gone.
      const fade = motion(el, [{ opacity: 0 }, { opacity: 1 }], { duration: PLAIN_FADE, delay: begin, easing: EASE_OUT, fill: 'backwards' });
      ended(fade).then(finish);
      return begin + PLAIN_FADE;
    }
    hidden = hideTo > start ? rangeOf(el, start, hideTo) : null;
    hide(hidden);
    let shown = start;
    let began = 0;
    const frame = (now) => {
      if (finished) return;
      if (!el.isConnected || textOf(el) !== after) { finish(); return; }
      const t = writing ? Math.max(0, now - began) / writing : 1;
      let next = start + Math.round(length * Math.min(1, t));
      // A word at a time, where the words are short enough to.
      if (next < end) {
        const space = after.indexOf(' ', next);
        if (space > 0 && space < end && space - next < 6) next = space;
      }
      if (next !== shown) {
        shown = next;
        unhide(hidden);
        hidden = shown < end ? rangeOf(el, shown, hideTo) : null;
        hide(hidden);
      }
      if (t >= 1) { finish(); return; }
      raf = requestAnimationFrame(frame);
    };
    timer = setTimeout(() => {
      began = performance.now();
      raf = requestAnimationFrame(frame);
    }, begin);
    // Frames stop in a tab nobody is looking at; the words do not wait.
    guard = setTimeout(finish, begin + writing + SLACK);
    return begin + writing;
  }

  /** Plays a snapshot to what the page is now. Calls `onPart(id, 'start')`
   *  as each part's motion begins and `onPart(id, 'end')` once it has
   *  ended; resolves when every motion has. */
  function play(snap, opts = {}) {
    const onPart = typeof opts?.onPart === 'function' ? opts.onPart : null;
    const ids = Array.isArray(snap?.ids) ? snap.ids : [];
    const letGo = () => {
      for (const id of ids) tell(onPart, id, 'end');
      return Promise.resolve();
    };
    if (!snap || !Array.isArray(snap.entries)) return letGo();
    if (snap.skip || document.hidden || performance.now() - snap.at > STALE) {
      for (const entry of snap.entries) {
        const el = liveOf(entry);
        if (el) cancelOwn(el);
      }
      return letGo();
    }
    begin();
    let played;
    try {
      played = run(snap, onPart);
    } catch (err) {
      console.error('[marble-morph]', err);
      played = letGo();
    }
    return played.finally(done);
  }

  function liveOf(entry) {
    const el = entry.id ? byId(entry.id) : null;
    if (el && !transient(el)) return el;
    return entry.el.isConnected && !transient(entry.el) ? entry.el : null;
  }

  const inOrder = (a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  function run(snap, onPart) {
    const still = stillness.matches;
    const hand = handNodes();
    const dragged = [...document.querySelectorAll(DRAGGED)];
    const held = (el) => hand.some(({ node, inside }) => el.contains(node) || (inside && node.contains(el)))
      || dragged.some((node) => el.contains(node) || node.contains(el));
    const claimed = Boolean(snap.client && window.marbleText?.claims?.(snap.client));
    const partEntries = new Map(snap.entries.filter((e) => e.part).map((e) => [e.part, e]));
    // Every motion this play starts, and what it leaves drawn, so it
    // finishes only its own.
    const mine = [];
    const finishers = [];
    const motion = (el, keyframes, timing) => {
      const a = animate(el, keyframes, timing);
      mine.push(a);
      return a;
    };

    // 1. Our own motions on all of it stop, so what is now is read clean.
    const live = new Map();
    for (const entry of snap.entries) {
      const el = liveOf(entry);
      if (!el) continue;
      cancelOwn(el);
      live.set(entry, el);
    }
    // What was put in: the roots the frame names, and any part that was not
    // here before and is now (a frame that does not name its inserts).
    const arrived = [];
    for (const id of new Set([...snap.inserted, ...snap.ids])) {
      if (partEntries.has(id)) continue; // it was here before: it moved
      const el = byId(id);
      if (!el || !fits(el) || transient(el)) continue;
      cancelOwn(el);
      arrived.push({ id, el, rect: null, lead: null });
    }

    // 2. What is now, read before anything is written.
    const now = new Map();
    for (const [entry, el] of live) {
      const after = { rect: rectOf(el) };
      if (entry.props) after.props = propsOf(el);
      if (entry.part) {
        after.text = textOf(el);
        after.block = isTextBlock(el);
        after.skeleton = skeletonOf(el);
        after.attrs = attrsOf(el);
      }
      now.set(entry, after);
    }
    for (const a of arrived) a.rect = rectOf(a.el);

    // 3. What changed, element by element.
    const plans = [];
    const planOf = new Map(); // element -> plan
    const heldParts = new Set();
    let restyled = 0;
    for (const [entry, el] of live) {
      const after = now.get(entry);
      if (held(el)) {
        if (entry.part) heldParts.add(entry.part);
        continue;
      }
      const plan = { entry, el, after, nums: [], cols: [], words: false, fade: false, attrs: false, flip: null, lead: null };
      if (entry.props && after.props) Object.assign(plan, styleChanges(entry.props, after.props));
      if (entry.part) {
        const text = entry.text !== after.text;
        const shape = entry.skeleton !== after.skeleton;
        // Words the caret in the text is typing are the caret's.
        const quiet = claimed && after.block;
        if (!quiet && text && !shape && entry.block && after.block) plan.words = true;
        else if (!quiet && (shape || text)) plan.fade = true;
        plan.attrs = entry.attrs !== after.attrs;
      }
      const b = entry.rect;
      const a = after.rect;
      const moved = Math.abs(b.left - a.left) >= 1 || Math.abs(b.top - a.top) >= 1
        || Math.abs(b.width - a.width) >= 1 || Math.abs(b.height - a.height) >= 1;
      plan.moved = moved && (inView(b) || inView(a));
      if (plan.nums.length || plan.cols.length || plan.moved) restyled += 1;
      plans.push(plan);
      planOf.set(el, plan);
    }
    plans.sort(inOrder);
    // A sheet's change that restyles more than the budget (counted over what
    // is in view, from the share of it that was read) is let go at once.
    if (snap.look) {
      const share = snap.read ? Math.max(snap.visible, snap.read) / snap.read : 1;
      if (restyled * share > MOST_LOOK) {
        for (const id of snap.ids) tell(onPart, id, 'end');
        return Promise.resolve();
      }
    }
    const ghosts = [];
    for (const [id, ghost] of snap.ghosts) {
      if (byId(id)) continue; // still here: it was not taken out after all
      ghosts.push({ id, ...ghost, lead: null });
    }
    const coming = arrived.filter((a) => !held(a.el));

    if (still) return stillPlay(snap, onPart, { plans, arrived: coming, heldParts, motion });

    // 4. The style numbers and colours start now, at what was: until a
    //    part's turn comes they hold it (fill backwards), so the layout read
    //    next is the old one wherever only a number moved, and only what
    //    moved for another reason is left to FLIP.
    for (const plan of plans) {
      if (plan.nums.length) {
        plan.numbers = motion(plan.el, [
          Object.fromEntries(plan.nums.map(({ prop, from }) => [prop, from])),
          Object.fromEntries(plan.nums.map(({ prop, to }) => [prop, to])),
        ], { duration: SHORTEST_RUN, easing: EASE_OUT, fill: 'backwards' });
      }
      if (plan.cols.length) {
        plan.colours = motion(plan.el, colourFrames(plan.cols), { duration: COLOUR, easing: EASE_COLOUR, fill: 'backwards' });
      }
    }

    // 5. What moved is drawn where it was and slides to where it is (FLIP).
    const flips = [];
    for (const plan of plans) {
      if (!plan.moved) continue;
      const mid = rectOf(plan.el);
      const before = plan.entry.rect;
      if (!mid.width && !mid.height) continue;
      const dx = before.left - mid.left;
      const dy = before.top - mid.top;
      const dw = before.width - mid.width;
      const dh = before.height - mid.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(dw) < 1 && Math.abs(dh) < 1) continue;
      plan.flip = {
        dx, dy, ownX: dx, ownY: dy, holder: null, holds: false,
        sx: mid.width ? before.width / mid.width : 1,
        sy: mid.height ? before.height / mid.height : 1,
        resized: Math.abs(dw) >= 1 || Math.abs(dh) >= 1,
      };
      flips.push(plan);
    }
    // Inside something that shifts, an element moves only by what it moves
    // on its own, in step with what holds it. A box that only grew or shrank
    // carries nothing, and is not stretched while anything in it moves.
    const flipOf = new Map(flips.map((plan) => [plan.el, plan]));
    for (const plan of flips) {
      let holder = null;
      for (let up = plan.el.parentElement; up && up !== document.body; up = up.parentElement) {
        const above = flipOf.get(up);
        if (!above) continue;
        above.flip.holds = true;
        if (!holder && (Math.abs(above.flip.dx) >= 0.5 || Math.abs(above.flip.dy) >= 0.5)) holder = above;
      }
      if (!holder) continue;
      plan.flip.holder = holder;
      plan.flip.ownX = plan.flip.dx - holder.flip.dx;
      plan.flip.ownY = plan.flip.dy - holder.flip.dy;
    }
    const moving = (plan) => Boolean(plan.nums.length || plan.cols.length || plan.flip || plan.words || plan.fade || plan.attrs);
    // What holds something that moves, comes or goes: a box that grew or
    // shrank for that reason is not crossfaded, or what is coming would be
    // dimmed with it.
    const holdsMotion = new Set();
    const markAbove = (el, inclusive) => {
      for (let up = inclusive ? el : el.parentElement; up && up !== document.body && !holdsMotion.has(up); up = up.parentElement) holdsMotion.add(up);
    };
    for (const plan of plans) if (moving(plan)) markAbove(plan.el, false);
    for (const a of coming) markAbove(a.el, false);
    for (const g of ghosts) if (g.parent?.isConnected) markAbove(g.parent, true);

    // 6. Who leads each motion: a part leads its own, its insides and its
    //    neighbours; on a sheet's change, the outermost element that changed.
    const leads = new Map(); // key -> { key, id, rect }
    const leadFor = (key, id, rect) => leads.get(key) ?? leads.set(key, { key, id, rect }).get(key);
    const changed = new Set(plans.filter(moving).map((plan) => plan.el));
    const rectOfPart = (id) => {
      const entry = partEntries.get(id);
      if (entry) return now.get(entry)?.rect ?? entry.rect;
      return arrived.find((a) => a.id === id)?.rect ?? snap.ghosts.get(id)?.rect ?? null;
    };
    for (const plan of plans) {
      if (!moving(plan)) continue;
      const owner = plan.entry.owner;
      if (owner) {
        plan.lead = leadFor(`part:${owner}`, owner, rectOfPart(owner) ?? plan.after.rect);
        continue;
      }
      let top = plan.el;
      for (let up = plan.el.parentElement; up && up !== document.body; up = up.parentElement) if (changed.has(up)) top = up;
      const root = planOf.get(top) ?? plan;
      plan.lead = leadFor(root.el, null, root.after.rect);
    }
    for (const plan of flips) if (plan.flip.holder?.lead) plan.lead = plan.flip.holder.lead;
    for (const a of coming) a.lead = leadFor(`part:${a.id}`, a.id, a.rect);
    for (const g of ghosts) g.lead = leadFor(`part:${g.id}`, g.id, g.rect);

    const dealt = choreograph([...leads.values()], { at: (lead) => centreOf(lead.rect ?? { left: 0, top: 0, width: 0, height: 0 }) });
    const timing = new Map(dealt.map((d) => [d.item, d]));
    const when = (lead) => timing.get(lead) ?? { delay: 0, duration: SHORTEST_RUN };

    // 7. Everything starts at its lead's turn.
    const waitsOf = new Map(); // lead -> promises
    const waits = (lead) => waitsOf.get(lead) ?? waitsOf.set(lead, []).get(lead);
    let latest = 0;
    const faded = new Set();
    const fadedAbove = (el) => {
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) if (faded.has(up)) return true;
      return false;
    };
    for (const plan of plans) {
      if (!plan.lead) continue;
      const { delay, duration } = when(plan.lead);
      const list = waits(plan.lead);
      const fades = plan.nums.some((n) => n.prop === 'opacity');
      if (plan.numbers) {
        plan.numbers.effect.updateTiming({ delay, duration });
        list.push(ended(plan.numbers));
        latest = Math.max(latest, delay + duration);
      }
      if (plan.colours) {
        plan.colours.effect.updateTiming({ delay });
        list.push(ended(plan.colours));
        latest = Math.max(latest, delay + COLOUR);
      }
      if (plan.flip) {
        const f = plan.flip;
        const own = getComputedStyle(plan.el).transform;
        const words = f.resized && plan.el.textContent.trim() !== '';
        // Only a box with no words and nothing moving inside it is stretched.
        const scale = f.resized && !words && !f.holds && own === 'none';
        const shifts = Math.abs(f.ownX) >= 0.5 || Math.abs(f.ownY) >= 0.5;
        if (shifts || scale) {
          const shift = `translate(${+f.ownX.toFixed(2)}px, ${+f.ownY.toFixed(2)}px)${scale ? ` scale(${+f.sx.toFixed(4)}, ${+f.sy.toFixed(4)})` : ''}`;
          const frames = own === 'none'
            ? [{ transform: shift, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }]
            : [{ transform: `${shift} ${own}` }, { transform: own }];
          list.push(ended(motion(plan.el, frames, { duration: MOVE, delay, easing: EASE_OUT, fill: 'backwards' })));
          latest = Math.max(latest, delay + MOVE);
        }
        // Words that grew or shrank with their box are not stretched: the
        // box moves, and what is in it crossfades.
        if (words && !plan.words && !fades && !holdsMotion.has(plan.el)) plan.fade = true;
      }
      if (plan.words) {
        const took = writeWords({
          el: plan.el, id: plan.entry.part, before: plan.entry.text, after: plan.after.text, rect: plan.entry.rect, delay, waits: list, motion, finishers,
        });
        if (took) latest = Math.max(latest, took);
        else { plan.words = false; plan.fade = true; }
      }
      // An attribute that changed and showed nothing else is still a change.
      if (plan.attrs && !plan.words && !plan.fade && !plan.nums.length && !plan.cols.length && !plan.flip) plan.fade = true;
      if (plan.fade && !plan.words && !fades && !fadedAbove(plan.el)) {
        faded.add(plan.el);
        list.push(ended(motion(plan.el, [{ opacity: 0.35 }, { opacity: 1 }], { duration: CROSSFADE, delay, easing: EASE_OUT, fill: 'backwards' })));
        latest = Math.max(latest, delay + CROSSFADE);
      }
    }
    for (const a of coming) {
      const { delay } = when(a.lead);
      waits(a.lead).push(ended(motion(a.el, [
        { opacity: 0, transform: 'translateY(3px) scale(.98)' },
        { opacity: 1, transform: 'none' },
      ], { duration: ARRIVE, delay, easing: EASE_OUT, fill: 'backwards' })));
      latest = Math.max(latest, delay + ARRIVE);
    }
    for (const g of ghosts) {
      const { delay } = when(g.lead);
      placeGhost(g.node, g.rect);
      const fade = motion(g.node, [{ opacity: g.opacity }, { opacity: 0 }], { duration: GHOST, delay, easing: EASE_OUT, fill: 'both' });
      const finish = () => { g.node.remove(); drop(g.id, finish); };
      keep(g.id, finish);
      finishers.push(finish);
      waits(g.lead).push(ended(fade).then(finish));
      latest = Math.max(latest, delay + GHOST);
    }

    // 8. Each part ends once everything it leads has; a sheet once all has;
    //    the play once every part has.
    const everything = [...waitsOf.values()].flat();
    const timers = [];
    const all = [];
    for (const id of snap.ids) {
      const lead = leads.get(`part:${id}`);
      const sheet = snap.look && !lead && !partEntries.has(id) && !snap.inserted.has(id);
      const its = heldParts.has(id) && !lead ? [] : lead ? (waitsOf.get(lead) ?? []) : sheet ? everything : [];
      if (!its.length) {
        tell(onPart, id, 'end');
        continue;
      }
      const delay = lead ? when(lead).delay : Math.min(...dealt.map((d) => d.delay));
      let started = false;
      let over = false;
      const timer = setTimeout(() => {
        if (started || over) return;
        started = true;
        tell(onPart, id, 'start');
      }, delay);
      timers.push(timer);
      // A motion cut short ends its part early: it has started by then, and
      // never starts again.
      all.push(Promise.all(its).then(() => {
        clearTimeout(timer);
        if (!started) { started = true; tell(onPart, id, 'start'); }
        over = true;
        tell(onPart, id, 'end');
      }));
    }
    all.push(...everything);

    // A tab put away mid-play, or frames that stop coming: everything ends
    // where it was going.
    const finishAll = () => {
      for (const a of mine) {
        if (a.playState === 'finished' || a.playState === 'idle') continue;
        try { a.finish(); } catch { a.cancel(); }
      }
      for (const finish of finishers) finish();
    };
    const guard = setTimeout(finishAll, latest + SLACK);
    const away = () => { if (document.hidden) finishAll(); };
    document.addEventListener('visibilitychange', away);
    return Promise.all(all).then(() => {
      clearTimeout(guard);
      for (const timer of timers) clearTimeout(timer);
      document.removeEventListener('visibilitychange', away);
      for (const g of ghosts) g.node.remove();
      if (layer && !layer.childElementCount) layer.remove();
    });
  }

  /** Reduced motion: every change is one crossfade, all at once. Nothing is
   *  drawn over the page and no words are written in. */
  function stillPlay(snap, onPart, { plans, arrived, heldParts, motion }) {
    const waitsOf = new Map(); // part id ('' for a sheet's) -> promises
    const faded = new Set();
    const fade = (el, key) => {
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) if (faded.has(up)) return;
      faded.add(el);
      (waitsOf.get(key) ?? waitsOf.set(key, []).get(key))
        .push(ended(motion(el, [{ opacity: 0.35 }, { opacity: 1 }], { duration: CROSSFADE, delay: 0, easing: EASE_OUT, fill: 'backwards' })));
    };
    for (const plan of plans) {
      if (plan.nums.length || plan.cols.length || plan.moved || plan.words || plan.fade || plan.attrs) fade(plan.el, plan.entry.owner ?? '');
    }
    for (const a of arrived) fade(a.el, a.id);
    const everything = [...waitsOf.values()].flat();
    const all = [];
    for (const id of snap.ids) {
      const its = heldParts.has(id) ? [] : waitsOf.get(id) ?? (snap.look ? everything : []);
      if (!its.length) { tell(onPart, id, 'end'); continue; }
      tell(onPart, id, 'start');
      all.push(Promise.all(its).then(() => tell(onPart, id, 'end')));
    }
    all.push(...everything);
    return Promise.all(all).then(() => {});
  }

  window.marbleMorph = { capture, play, choreograph, PROPS: [...PROPS] };
})();
