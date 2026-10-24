// The flat marble, drawn from a space.
//
// A space says what every new app's mark agrees on and how far each one may
// wander: a range for each number, a set for each choice. A seed — the new
// document's path — picks one point in it. Each gene reads its own number off
// the seed, so widening one range moves only that gene and the rest of every
// mark stays where it was.
//
// A drive's space is tuned in a document: Favicon Studio, or any page whose
// head says <meta name="marble-favicons"> (server/favicon.js finds it). That
// page carries a copy of this file in its own script, because it draws the
// same marks the host will, and a document cannot import from a host. So this
// file imports nothing and touches nothing but its arguments: it has to run
// unchanged in a page. Change it here, and paste the same text, `export`s
// dropped, into the studio.
//
// Drawn at 32 and seen at 16, so everything is a flat shape with its ends on
// the rim: no gradients, no clip paths, no strokes that a 16px raster would
// smear.

export const MARK_VERSION = 1;

// ---- the seed. FNV-1a, then murmur's finaliser so neighbouring paths land far
// apart. Math.imul keeps it the same number in every engine.
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
const unit = (seed, gene) => hash32(`${seed}\u241f${gene}`) / 4294967296;

// ---- the space's two kinds of dimension.
export const RANGES = ['hue', 'chroma', 'light', 'angle', 'bend', 'width', 'shift', 'contrast', 'size'];
export const CHOICES = {
  form: ['wave', 'split', 'eye', 'bands'],
  ribbon: ['tint', 'shade', 'white', 'neighbour', 'opposite'],
  glint: ['none', 'dot', 'arc'],
  depth: ['none', 'crescent'],
  rim: ['none', 'ring'],
  frame: ['none', 'tile'],
};
// What each number may be at all — the ends of its strip in the studio.
export const DOMAIN = {
  hue: [0, 360],
  chroma: [0, 0.16],
  light: [0.35, 0.85],
  angle: [-90, 90],
  bend: [-1, 1],
  width: [0.12, 0.5],
  shift: [-0.4, 0.4],
  contrast: [0.08, 0.4],
  size: [12, 16],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A range's value at u in [0, 1): anywhere in it, or on one of its steps. */
function along(range, u, isHue) {
  const lo = range.lo;
  const span = range.hi - range.lo;
  const steps = Math.round(num(range.steps, 0));
  let t = u;
  if (steps === 1) t = 0.5;
  else if (steps > 1) {
    const i = Math.min(steps - 1, Math.floor(u * steps));
    // A whole turn of hue has its two ends on the same colour, so its steps
    // divide the circle rather than the line.
    t = isHue && span >= 360 ? i / steps : i / (steps - 1);
  }
  const v = lo + span * t;
  return isHue ? ((v % 360) + 360) % 360 : v;
}

/** The middle of a range: where the studio stands before anything is picked. */
export function middle(range, isHue) {
  return along({ ...range, steps: 1 }, 0, isHue);
}

/** A space as written, made safe to draw from: every range present and in its
 *  domain, every set non-empty and made of known names. */
export function tidy(space = {}) {
  const out = { v: MARK_VERSION };
  for (const key of RANGES) {
    const [dlo, dhi] = DOMAIN[key];
    const r = space[key] ?? {};
    let lo = num(r.lo, DEFAULTS[key].lo);
    let hi = num(r.hi, DEFAULTS[key].hi);
    if (key === 'hue') {
      lo = ((lo % 360) + 360) % 360;
      if (hi < lo) hi += 360;
      hi = Math.min(hi, lo + 360);
    } else {
      lo = clamp(lo, dlo, dhi);
      hi = clamp(hi, dlo, dhi);
      if (hi < lo) [lo, hi] = [hi, lo];
    }
    const steps = clamp(Math.round(num(r.steps, 0)), 0, 12);
    out[key] = steps ? { lo, hi, steps } : { lo, hi };
  }
  for (const [key, names] of Object.entries(CHOICES)) {
    const picked = (Array.isArray(space[key]) ? space[key] : []).filter((n) => names.includes(n));
    out[key] = picked.length ? [...new Set(picked)] : [...DEFAULTS[key]];
  }
  return out;
}

/** One point in the space: the genes a mark is drawn from. */
export function genome(space, seed) {
  const s = tidy(space);
  const g = {};
  for (const key of RANGES) g[key] = along(s[key], unit(seed, key), key === 'hue');
  for (const key of Object.keys(CHOICES)) {
    const set = s[key];
    g[key] = set[Math.min(set.length - 1, Math.floor(unit(seed, key) * set.length))];
  }
  return g;
}

// ---- colour. OKLCH, so a family that varies only in hue keeps one weight:
// the same lightness reads as the same lightness whether it is sage or rust.
function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A colour as hex. Out of gamut, chroma gives way and lightness and hue keep
 *  their places, which is what keeps a family's weight even at its edges. */
export function oklch(L, C, h) {
  const l = clamp(L, 0, 1);
  let c = Math.max(0, C);
  let rgb = oklchToRgb(l, c, h);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 18; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToRgb(l, mid, h))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = oklchToRgb(l, c, h);
  }
  return `#${rgb.map((v) => Math.round(clamp(gamma(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** The colours a mark is painted in, from its genes. */
export function paint(g) {
  const { hue: h, chroma: C, light: L, contrast: k } = g;
  const body = oklch(L, C, h);
  const ribbon = {
    tint: () => oklch(L + k, C * 0.62, h),
    shade: () => oklch(L - k, C * 0.95, h),
    white: () => oklch(0.975, 0.008, h),
    neighbour: () => oklch(L + k * 0.55, C, h + 48),
    opposite: () => oklch(L + k * 0.55, C * 0.9, h + 180),
  }[g.ribbon]();
  return {
    body,
    ribbon,
    deep: oklch(L - 0.09, C * 1.02, h),
    rim: oklch(L - 0.16, C, h),
    pearl: oklch(0.965, Math.min(C, 0.02), h),
  };
}

// ---- drawing. Every shape is built in a frame where the swirl runs left to
// right through the middle, then turned by the angle as points, so the file
// holds plain coordinates and no transforms.
const f1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
};

function frame(cx, cy, R, angle) {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return ([x, y]) => [cx + (x * cos - y * sin) * R, cy + (x * sin + y * cos) * R];
}

// A chord across the unit disc at height o (−1 top … 1 bottom), bent into an S
// by `bend`. Its ends sit on the rim, so a band between two of them is closed
// by the rim itself.
function chord(o, bend) {
  const y = clamp(o, -0.96, 0.96);
  const x = Math.sqrt(1 - y * y);
  // The S keeps inside the disc: it bends less as the chord nears the rim.
  const A = bend * 0.95 * (1 - Math.abs(y) * 0.8);
  return [[-x, y], [-x / 3, y - A], [x / 3, y + A], [x, y]];
}

function bandPath(at, R, top, bottom) {
  const [a0, a1, a2, a3] = top.map(at);
  const [b0, b1, b2, b3] = bottom.map(at);
  const P = (p) => `${f1(p[0])} ${f1(p[1])}`;
  const r = f1(R);
  return `M${P(a0)}C${P(a1)} ${P(a2)} ${P(a3)}A${r} ${r} 0 0 1 ${P(b3)}C${P(b2)} ${P(b1)} ${P(b0)}A${r} ${r} 0 0 1 ${P(a0)}Z`;
}

function splitPath(at, R, line) {
  const [a0, a1, a2, a3] = line.map(at);
  // Round the bottom in two arcs, through the bottom of the disc, rather than
  // one: an arc near half a turn leaves its centre to a guess, and the guess
  // slides it off the rim.
  const low = at([0, 1]);
  const P = (p) => `${f1(p[0])} ${f1(p[1])}`;
  const r = f1(R);
  return `M${P(a0)}C${P(a1)} ${P(a2)} ${P(a3)}A${r} ${r} 0 0 1 ${P(low)}A${r} ${r} 0 0 1 ${P(a0)}Z`;
}

function eyePath(at, width, bend) {
  const H = width * 1.6;
  const s = bend * 0.5;
  const pts = [[-1, 0], [-0.42, -H * (1 + s)], [0.42, -H * (1 - s)], [1, 0], [0.42, H * (1 + s)], [-0.42, H * (1 - s)]].map(at);
  const P = (p) => `${f1(p[0])} ${f1(p[1])}`;
  return `M${P(pts[0])}C${P(pts[1])} ${P(pts[2])} ${P(pts[3])}C${P(pts[4])} ${P(pts[5])} ${P(pts[0])}Z`;
}

// The swirl runs a hair past the rim. Two antialiased edges laid on the same
// circle let the colour underneath show through as a seam; one edge over the
// other does not, and a third of a pixel at 32 is nothing at 16.
const OVER = 0.25;

function swirl(g, cx, cy, disc) {
  const R = disc + OVER;
  const at = frame(cx, cy, R, g.angle);
  const w = g.width;
  const o = g.shift;
  switch (g.form) {
    case 'split':
      return splitPath(at, R, chord(o, g.bend));
    case 'eye':
      return eyePath(at, w, g.bend);
    case 'bands': {
      const t = w * 0.62;
      const gap = t * 0.8;
      const first = bandPath(at, R, chord(o - gap - t, g.bend), chord(o - gap, g.bend));
      const second = bandPath(at, R, chord(o + gap, g.bend), chord(o + gap + t, g.bend));
      return first + second;
    }
    default:
      return bandPath(at, R, chord(o - w, g.bend), chord(o + w, g.bend));
  }
}

// Light comes from the same corner on every mark — the top left, where it
// fell on the glass marble — so it is placed in the page's frame, not the
// swirl's, and the family agrees on where the sun is.
function glint(kind, cx, cy, R) {
  if (kind === 'dot') {
    return `<circle cx='${f1(cx - R * 0.42)}' cy='${f1(cy - R * 0.44)}' r='${f1(R * 0.15)}' fill='#fff' fill-opacity='.9'/>`;
  }
  if (kind === 'arc') {
    const r = R * 0.68;
    const p = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
    const [x0, y0] = p(196);
    const [x1, y1] = p(244);
    return `<path d='M${f1(x0)} ${f1(y0)}A${f1(r)} ${f1(r)} 0 0 1 ${f1(x1)} ${f1(y1)}' fill='none' stroke='#fff' stroke-opacity='.9' stroke-width='${f1(R * 0.16)}' stroke-linecap='round'/>`;
  }
  return '';
}

// A flat crescent of the body's own deeper tone along the bottom right: the
// shadow side of a ball, said in one shape.
// It keeps to the rim exactly, where the swirl runs past it: the rim lets the
// lit body through as a hairline on the shadow side, which is what reflected
// light does to a ball anyway, and a crescent run past the rim ends in a tick.
function crescent(cx, cy, R, fill) {
  const d = R * 0.42;
  const vx = -d / Math.SQRT2;
  const vy = -d / Math.SQRT2;
  const mx = vx / 2;
  const my = vy / 2;
  const h = Math.sqrt(R * R - (d / 2) ** 2);
  const nx = -vy / d;
  const ny = vx / d;
  const p1 = [cx + mx + nx * h, cy + my + ny * h];
  const p2 = [cx + mx - nx * h, cy + my - ny * h];
  const r = f1(R);
  // The outer edge is the long way round the rim, the inner the short way
  // round the circle that casts it.
  return `<path d='M${f1(p1[0])} ${f1(p1[1])}A${r} ${r} 0 1 1 ${f1(p2[0])} ${f1(p2[1])}A${r} ${r} 0 0 0 ${f1(p1[0])} ${f1(p1[1])}Z' fill='${fill}'/>`;
}


/** The mark as SVG source: single quotes, so it can sit in a double-quoted
 *  attribute once uri() has encoded the three characters a URI cannot hold. */
export function draw(g) {
  const c = paint(g);
  const tile = g.frame === 'tile';
  const R = tile ? g.size * 0.6 : g.size;
  const cx = 16;
  const cy = 16;
  let body = '';
  if (tile) body += `<rect width='32' height='32' rx='7.5' fill='${c.body}'/>`;
  const disc = tile ? c.pearl : c.body;
  const vane = tile ? c.body : c.ribbon;
  body += `<circle cx='16' cy='16' r='${f1(R)}' fill='${disc}'/>`;
  if (g.depth === 'crescent' && !tile) body += crescent(cx, cy, R, c.deep);
  body += `<path d='${swirl(g, cx, cy, R)}' fill='${vane}'/>`;
  if (g.rim === 'ring') body += `<circle cx='16' cy='16' r='${f1(R - 0.6)}' fill='none' stroke='${tile ? c.body : c.rim}' stroke-opacity='.55' stroke-width='1.2'/>`;
  if (!tile) body += glint(g.glint, cx, cy, R);
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>${body}</svg>`;
}

/** The mark as a data URI, encoded only where a URI in an attribute needs it. */
export const uri = (svgSource) => `data:image/svg+xml,${svgSource.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'")}`;

/** A seed's mark in a space: the one call a host makes for a new document. */
export const mark = (space, seed) => draw(genome(space, seed));

// The family a drive starts with, before anyone tunes it: six dusty colours
// at one lightness, so no app's mark is louder than another's, round the
// wheel from rose to blue and never through violet, which is the agents'
// colour here. The one ribbon of the old glass marble, rising to the right,
// and the light in the same corner.
export const DEFAULTS = {
  hue: { lo: 355, hi: 255, steps: 6 },
  chroma: { lo: 0.075, hi: 0.075 },
  light: { lo: 0.6, hi: 0.6 },
  angle: { lo: -40, hi: -20 },
  bend: { lo: 0.35, hi: 0.6 },
  width: { lo: 0.27, hi: 0.27 },
  shift: { lo: -0.08, hi: 0.08 },
  contrast: { lo: 0.24, hi: 0.24 },
  size: { lo: 15, hi: 15 },
  form: ['wave'],
  ribbon: ['tint'],
  glint: ['dot'],
  depth: ['none'],
  rim: ['none'],
  frame: ['none'],
};
