// A PowerPoint, as a deck of this drive's own.
//
// Dropping a .pptx on the Drive should leave a deck you can open, edit and
// present here, not a file you have to take somewhere else to look at. So this
// reads the PowerPoint package and writes a document from the Slides starter:
// one slide per slide, every text box, picture, shape, line and table where its
// author put it, the type in the sizes and colours they chose, and the speaker
// notes under each slide where the starter keeps them.
//
// A slide is drawn to scale rather than reflowed into the starter's own
// one-idea layout. A deck somebody laid out by hand (a photo bled off the left
// edge, a caption in a translucent band) is the thing they are importing, and a
// tidy reflow of it would be a different deck. Every length on a slide is a
// proportion of the slide (left and top in percent, type in `cqi` of the
// face), so it reads the same in the drive's column, on a phone and on a
// projector. The text stays text: each box is editable in place and keeps its
// bold words and colours (`data-marble-rich`, filed with setInner).
//
// What a browser cannot draw (charts, sound and video, pictures in Windows
// metafile formats) is counted by slide, and the deck says in its first line
// what did not come across, so nobody finds out in front of a room.
//
//   const deck = await pptxToDeck(pathOrBuffer, { starter, fileName, putImage })
//   deck.source   the document
//   deck.slides   how many slides it has
//   deck.missing  [{ kind, slides: [3, 7] }]

import crypto from 'node:crypto';
import path from 'node:path';

import { openZip } from './zip.js';
import { child, children, find, findAll, parseXml, path as down, textOf } from './xml.js';

const posix = path.posix;

/** The files this reads: a deck, a show, a template, with macros or without. */
export const POWERPOINT = /\.(pptx|pptm|ppsx|ppsm|potx|potm)$/i;

const XML_LIMIT = 48 * 1024 * 1024;
const IMAGE_LIMIT = 64 * 1024 * 1024;
const MEDIA_LIMIT = 256 * 1024 * 1024;
const DEFAULT_W = 9144000;
const DEFAULT_H = 5143500;
// PowerPoint's "single" line spacing is about this much of the type size.
const LINE = 1.2;

const newIdDefault = () => crypto.randomBytes(5).toString('hex').slice(0, 8);

// ------------------------------------------------------------------- strings

// A soft return some exporters write as a vertical tab is a line break; the
// other control characters are not text HTML can hold.
const escText = (s) =>
  String(s)
    .replace(/\u000b/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const n = (v) => String(Math.round(v * 1000) / 1000);
const styleOf = (parts) => parts.filter(Boolean).join(';');

// ------------------------------------------------------------------- package

function resolvePart(dir, target) {
  let t = String(target ?? '');
  try {
    t = decodeURIComponent(t);
  } catch {
    // A target with a stray % is used as it is.
  }
  return t.startsWith('/') ? t.slice(1) : posix.normalize(posix.join(dir, t));
}

async function openPackage(input) {
  const zip = await openZip(input);
  const parsed = new Map();
  const relations = new Map();

  function xml(part) {
    if (!part || !zip.has(part)) return Promise.resolve(null);
    if (!parsed.has(part)) {
      parsed.set(
        part,
        zip
          .read(part, { limit: XML_LIMIT })
          .then((buf) => parseXml(buf.toString('utf8')))
          .catch(() => null),
      );
    }
    return parsed.get(part);
  }

  function rels(part) {
    const dir = posix.dirname(part);
    const at = posix.join(dir, '_rels', `${posix.basename(part)}.rels`);
    if (!relations.has(at)) {
      relations.set(
        at,
        xml(at).then((root) => {
          const map = new Map();
          for (const r of children(root, 'Relationship')) {
            const external = r.attrs.TargetMode === 'External';
            map.set(r.attrs.Id, {
              type: r.attrs.Type ?? '',
              target: external ? r.attrs.Target : resolvePart(dir, r.attrs.Target),
              external,
            });
          }
          return map;
        }),
      );
    }
    return relations.get(at);
  }

  return { zip, xml, rels, close: () => zip.close() };
}

const relOfType = (rels, suffix) => [...(rels?.values() ?? [])].find((r) => r.type.endsWith(suffix)) ?? null;

// -------------------------------------------------------------------- colour

const DEFAULT_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
const COLOR_TAGS = ['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:scrgbClr', 'a:hslClr'];
const PRESET = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  orange: 'FFA500', purple: '800080', gray: '808080', grey: '808080', darkGray: 'A9A9A9', dkGray: 'A9A9A9',
  lightGray: 'D3D3D3', ltGray: 'D3D3D3', navy: '000080', teal: '008080', maroon: '800000', silver: 'C0C0C0',
  cyan: '00FFFF', magenta: 'FF00FF', lime: '00FF00', olive: '808000', brown: 'A52A2A', pink: 'FFC0CB',
};

function hex(value) {
  const v = /^[0-9a-f]{6}$/i.test(value ?? '') ? value : '000000';
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 1 };
}

function toHsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl({ h, s, l }) {
  if (!s) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return { r: Math.round(ch(h + 1 / 3) * 255), g: Math.round(ch(h) * 255), b: Math.round(ch(h - 1 / 3) * 255) };
}

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** The colour modifiers, in the order the file gives them. */
function modify(base, el) {
  let c = { ...base };
  for (const m of children(el)) {
    const v = Number(m.attrs.val ?? 0) / 100000;
    switch (m.name) {
      case 'a:alpha':
        c.a = clamp(v);
        break;
      case 'a:alphaMod':
        c.a = clamp(c.a * v);
        break;
      case 'a:lumMod':
      case 'a:lumOff': {
        const hsl = toHsl(c);
        hsl.l = clamp(m.name === 'a:lumMod' ? hsl.l * v : hsl.l + v);
        c = { ...fromHsl(hsl), a: c.a };
        break;
      }
      case 'a:satMod': {
        const hsl = toHsl(c);
        hsl.s = clamp(hsl.s * v);
        c = { ...fromHsl(hsl), a: c.a };
        break;
      }
      case 'a:tint':
        c = { r: Math.round(c.r * v + 255 * (1 - v)), g: Math.round(c.g * v + 255 * (1 - v)), b: Math.round(c.b * v + 255 * (1 - v)), a: c.a };
        break;
      case 'a:shade':
        c = { r: Math.round(c.r * v), g: Math.round(c.g * v), b: Math.round(c.b * v), a: c.a };
        break;
      case 'a:inv':
        c = { r: 255 - c.r, g: 255 - c.g, b: 255 - c.b, a: c.a };
        break;
      case 'a:gray': {
        const y = Math.round(0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
        c = { r: y, g: y, b: y, a: c.a };
        break;
      }
      default:
        break;
    }
  }
  return c;
}

/** The colour inside `holder` (a solidFill, a buClr, a fillRef…), or null. */
function colorIn(holder, ctx) {
  const el = child(holder, COLOR_TAGS);
  if (!el) return null;
  let base;
  switch (el.name) {
    case 'a:srgbClr':
      base = hex(el.attrs.val);
      break;
    case 'a:sysClr':
      base = hex(el.attrs.lastClr ?? (/text/i.test(el.attrs.val ?? '') ? '000000' : 'FFFFFF'));
      break;
    case 'a:prstClr':
      base = hex(PRESET[el.attrs.val] ?? '000000');
      break;
    case 'a:scrgbClr': {
      const lin = (v) => {
        const x = clamp(Number(v ?? 0) / 100000);
        return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
      };
      base = { r: lin(el.attrs.r), g: lin(el.attrs.g), b: lin(el.attrs.b), a: 1 };
      break;
    }
    case 'a:hslClr':
      base = { ...fromHsl({ h: Number(el.attrs.hue ?? 0) / 21600000, s: Number(el.attrs.sat ?? 0) / 100000, l: Number(el.attrs.lum ?? 0) / 100000 }), a: 1 };
      break;
    default: {
      const val = el.attrs.val;
      if (val === 'phClr') {
        base = ctx.phClr ? { ...ctx.phClr } : hex('000000');
        break;
      }
      const mapped = ctx.clrMap?.[val] ?? DEFAULT_MAP[val] ?? val;
      base = hex(ctx.theme?.colors?.[mapped]);
      break;
    }
  }
  return modify(base, el);
}

function css(c) {
  if (!c) return null;
  const h = (v) => clamp(v, 0, 255).toString(16).padStart(2, '0');
  if (c.a >= 0.999) return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return `rgb(${c.r} ${c.g} ${c.b} / ${n(c.a)})`;
}

// --------------------------------------------------------------------- theme

function readTheme(root) {
  const colors = {};
  for (const k of children(find(root, 'a:clrScheme'))) {
    const srgb = child(k, 'a:srgbClr');
    const sys = child(k, 'a:sysClr');
    colors[k.name.replace(/^a:/, '')] = srgb
      ? srgb.attrs.val
      : sys
        ? (sys.attrs.lastClr ?? (/text/i.test(sys.attrs.val ?? '') ? '000000' : 'FFFFFF'))
        : '000000';
  }
  const fonts = find(root, 'a:fontScheme');
  const fmt = find(root, 'a:fmtScheme');
  const list = (name) => children(child(fmt, name));
  return {
    colors,
    major: down(fonts, 'a:majorFont', 'a:latin')?.attrs.typeface ?? '',
    minor: down(fonts, 'a:minorFont', 'a:latin')?.attrs.typeface ?? '',
    fills: list('a:fillStyleLst'),
    lines: list('a:lnStyleLst'),
    bgFills: list('a:bgFillStyleLst'),
  };
}

// -------------------------------------------------------------- fills, lines

/** A shape's fill: undefined when it says nothing (the style decides), or
 *  `{ none }`, `{ css }` or `{ blip }`. */
function fillIn(holder, ctx) {
  for (const k of children(holder)) {
    switch (k.name) {
      case 'a:noFill':
        return { none: true };
      case 'a:solidFill': {
        const c = css(colorIn(k, ctx));
        return { css: c, solid: c };
      }
      case 'a:gradFill': {
        // An outline drawn in SVG takes the first stop; a box takes it all.
        const first = child(child(k, 'a:gsLst'), 'a:gs');
        return { css: gradient(k, ctx), solid: first ? css(colorIn(first, ctx)) : null };
      }
      case 'a:blipFill':
        return { blip: k };
      case 'a:pattFill': {
        const c = css(colorIn(child(k, 'a:fgClr'), ctx));
        return { css: c, solid: c };
      }
      case 'a:grpFill':
        return ctx.groupFill ?? undefined;
      default:
        break;
    }
  }
  return undefined;
}

function gradient(el, ctx) {
  const stops = children(child(el, 'a:gsLst'), 'a:gs')
    .map((gs) => ({ at: Number(gs.attrs.pos ?? 0) / 1000, color: css(colorIn(gs, ctx)) }))
    .filter((s) => s.color)
    .sort((a, b) => a.at - b.at);
  if (!stops.length) return null;
  if (stops.length === 1) return stops[0].color;
  const list = stops.map((s) => `${s.color} ${n(s.at)}%`).join(', ');
  if (child(el, 'a:path')) return `radial-gradient(circle, ${list})`;
  const ang = Number(child(el, 'a:lin')?.attrs.ang ?? 0) / 60000;
  return `linear-gradient(${n(ang + 90)}deg, ${list})`;
}

function styleFill(style, ctx) {
  const ref = child(style, 'a:fillRef');
  if (!ref) return undefined;
  const idx = Number(ref.attrs.idx ?? 0);
  if (!idx) return { none: true };
  const phClr = colorIn(ref, ctx);
  const entry = idx >= 1001 ? ctx.theme.bgFills[idx - 1001] : ctx.theme.fills[idx - 1];
  if (!entry) return phClr ? { css: css(phClr), solid: css(phClr) } : undefined;
  return fillIn({ kids: [entry] }, { ...ctx, phClr });
}

/** `{ color, width, dash, head, tail }` in EMU, or null for no line. */
function lineOf(spPr, style, ctx) {
  const ln = child(spPr, 'a:ln');
  const ref = child(style, 'a:lnRef');
  const idx = Number(ref?.attrs.idx ?? 0);
  const phClr = ref ? colorIn(ref, ctx) : null;
  const themed = idx ? ctx.theme.lines[idx - 1] : null;
  const themedFill = themed ? fillIn(themed, { ...ctx, phClr }) : undefined;

  const own = ln ? fillIn(ln, ctx) : undefined;
  const fill = own !== undefined ? own : themedFill;
  if (!fill || fill.none || fill.blip || !fill.css) return null;
  const width = Number(ln?.attrs.w ?? themed?.attrs.w ?? 9525);
  const dash = child(ln, 'a:prstDash')?.attrs.val ?? child(themed, 'a:prstDash')?.attrs.val ?? 'solid';
  const end = (name) => {
    const type = child(ln, name)?.attrs.type ?? 'none';
    return type === 'none' ? null : type;
  };
  return { color: fill.css, width: Math.max(width, 3175), dash, head: end('a:headEnd'), tail: end('a:tailEnd') };
}

// ------------------------------------------------------------------ geometry

function xfrmOf(el) {
  if (!el) return null;
  const off = child(el, 'a:off');
  const ext = child(el, 'a:ext');
  if (!off || !ext) return null;
  const chOff = child(el, 'a:chOff');
  const chExt = child(el, 'a:chExt');
  return {
    x: Number(off.attrs.x ?? 0),
    y: Number(off.attrs.y ?? 0),
    w: Number(ext.attrs.cx ?? 0),
    h: Number(ext.attrs.cy ?? 0),
    rot: Number(el.attrs.rot ?? 0) / 60000,
    flipH: el.attrs.flipH === '1' || el.attrs.flipH === 'true',
    flipV: el.attrs.flipV === '1' || el.attrs.flipV === 'true',
    chOff: chOff ? { x: Number(chOff.attrs.x ?? 0), y: Number(chOff.attrs.y ?? 0) } : null,
    chExt: chExt ? { w: Number(chExt.attrs.cx ?? 0), h: Number(chExt.attrs.cy ?? 0) } : null,
  };
}

const IDENTITY = { ax: 1, bx: 0, ay: 1, by: 0 };

/** A group's children are drawn in its own coordinates; this is the map from
 *  those to the slide's, composed with the map of whatever holds the group. */
function within(map, xf) {
  if (!xf) return map;
  const sx = xf.chExt?.w ? xf.w / xf.chExt.w : 1;
  const sy = xf.chExt?.h ? xf.h / xf.chExt.h : 1;
  const ox = xf.x - (xf.chOff?.x ?? 0) * sx;
  const oy = xf.y - (xf.chOff?.y ?? 0) * sy;
  return { ax: map.ax * sx, bx: map.ax * ox + map.bx, ay: map.ay * sy, by: map.ay * oy + map.by };
}

const shift = (map, dx, dy) => ({ ...map, bx: map.bx + map.ax * dx, by: map.by + map.ay * dy });

function place(xf, map) {
  return {
    x: map.ax * xf.x + map.bx,
    y: map.ay * xf.y + map.by,
    w: map.ax * xf.w,
    h: map.ay * xf.h,
    rot: xf.rot,
    flipH: xf.flipH,
    flipV: xf.flipV,
  };
}

// ------------------------------------------------------------------- shapes

/** Children named the same in a slide and in a SmartArt drawing (`p:spPr`,
 *  `dsp:spPr`), so one reader draws both. */
const pc = (el, local) => child(el, [`p:${local}`, `dsp:${local}`]);

function nvOf(el) {
  return pc(el, 'nvSpPr') ?? pc(el, 'nvPicPr') ?? pc(el, 'nvGraphicFramePr') ?? pc(el, 'nvCxnSpPr') ?? pc(el, 'nvGrpSpPr');
}

const phOf = (el) => down(nvOf(el), 'p:nvPr', 'p:ph');

function placeholders(root) {
  const out = [];
  for (const sp of findAll(down(root, 'p:cSld', 'p:spTree') ?? root, 'p:sp').concat(findAll(down(root, 'p:cSld', 'p:spTree') ?? root, 'p:pic'))) {
    const ph = phOf(sp);
    if (ph) out.push({ sp, type: ph.attrs.type ?? 'obj', idx: ph.attrs.idx ?? null });
  }
  return out;
}

const masterType = (t) => (t === 'ctrTitle' || t === 'title' ? 'title' : ['dt', 'ftr', 'sldNum'].includes(t) ? t : 'body');

function matchLayout(list, ph) {
  const type = ph.attrs.type ?? 'obj';
  const idx = ph.attrs.idx ?? null;
  if (idx !== null) {
    const byIdx = list.find((p) => p.idx === idx);
    if (byIdx) return byIdx;
  }
  return list.find((p) => p.type === type) ?? list.find((p) => masterType(p.type) === masterType(type) && masterType(type) !== 'body') ?? null;
}

const matchMaster = (list, type) => list.find((p) => masterType(p.type) === masterType(type)) ?? null;

// ---------------------------------------------------------------- the text

const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify', justLow: 'justify' };
// Bullets drawn from a symbol font are letters in that font. These are the
// ones decks use, as the characters they are drawn as.
const SYMBOL_BULLETS = {
  '§': '▪', 'ü': '✓', 'Ø': '➢', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'o': '○', 'w': '◆',
  'Ü': '➢', 'à': '➔', 'è': '➔', 'ð': '⇨', 'û': '✗', 'ý': '☒', 'þ': '☑', '¨': '◻', '·': '•', '-': '–',
};

function spacing(k) {
  const pctEl = child(k, 'a:spcPct');
  if (pctEl) return { pct: Number(pctEl.attrs.val ?? 100000) / 100000 };
  const pts = child(k, 'a:spcPts');
  if (pts) return { pts: Number(pts.attrs.val ?? 0) / 100 };
  return null;
}

const truthy = (v) => v === '1' || v === 'true' || v === 'on';

function mergeRun(into, rPr) {
  if (!rPr) return into;
  const a = rPr.attrs;
  if (a.sz !== undefined) into.sz = Number(a.sz) / 100;
  if (a.b !== undefined) into.b = truthy(a.b);
  if (a.i !== undefined) into.i = truthy(a.i);
  if (a.u !== undefined) into.u = a.u !== 'none';
  if (a.strike !== undefined) into.strike = a.strike !== 'noStrike';
  if (a.cap !== undefined) into.cap = a.cap;
  if (a.baseline !== undefined) into.baseline = Number(a.baseline) / 1000;
  for (const k of children(rPr)) {
    switch (k.name) {
      case 'a:solidFill':
        into.fill = k;
        break;
      case 'a:gradFill': {
        const first = child(child(k, 'a:gsLst'), 'a:gs');
        if (first) into.fill = first;
        break;
      }
      case 'a:noFill':
        into.fill = 'none';
        break;
      case 'a:latin':
        if (k.attrs.typeface) into.font = k.attrs.typeface;
        break;
      case 'a:ea':
      case 'a:cs':
        if (k.attrs.typeface && !into.font) into.alt = k.attrs.typeface;
        break;
      case 'a:highlight':
        into.highlight = k;
        break;
      case 'a:hlinkClick':
        if (k.attrs['r:id']) into.link = k.attrs['r:id'];
        break;
      default:
        break;
    }
  }
  return into;
}

function mergePara(into, pPr) {
  if (!pPr) return into;
  const a = pPr.attrs;
  if (a.algn) into.algn = a.algn;
  if (a.marL !== undefined) into.marL = Number(a.marL);
  if (a.indent !== undefined) into.indent = Number(a.indent);
  for (const k of children(pPr)) {
    switch (k.name) {
      case 'a:lnSpc':
        into.lnSpc = spacing(k);
        break;
      case 'a:spcBef':
        into.spcBef = spacing(k);
        break;
      case 'a:spcAft':
        into.spcAft = spacing(k);
        break;
      case 'a:buNone':
        into.bullet = null;
        break;
      case 'a:buChar':
        into.bullet = { char: k.attrs.char ?? '•' };
        break;
      case 'a:buAutoNum':
        into.bullet = { auto: k.attrs.type ?? 'arabicPeriod', start: Number(k.attrs.startAt ?? 1) };
        break;
      case 'a:buBlip':
        into.bullet = { char: '•' };
        break;
      case 'a:buClr':
        into.buClr = k;
        break;
      case 'a:buClrTx':
        into.buClr = null;
        break;
      case 'a:buSzPct':
        into.buSz = Number(k.attrs.val ?? 100000) / 100000;
        break;
      case 'a:buSzTx':
        into.buSz = null;
        break;
      case 'a:buFont':
        into.buFont = k.attrs.typeface ?? null;
        break;
      case 'a:buFontTx':
        into.buFont = null;
        break;
      case 'a:defRPr':
        into.run = mergeRun({ ...(into.run ?? {}) }, k);
        break;
      default:
        break;
    }
  }
  return into;
}

/** The paragraph properties a paragraph at `level` ends up with, from the
 *  master's text styles down through the placeholders to the shape's own. */
function paraStyle(chain, level, pPr) {
  const p = { run: {} };
  for (const style of chain) {
    if (!style) continue;
    // A look that comes from outside the text (a shape's font reference, a
    // table style) sits between the deck's defaults and the box's own.
    if (style.run) {
      p.run = { ...p.run, ...style.run };
      continue;
    }
    mergePara(p, child(style, 'a:defPPr'));
    mergePara(p, child(style, `a:lvl${level + 1}pPr`));
  }
  mergePara(p, pPr);
  return p;
}

function mergeBody(into, bodyPr) {
  if (!bodyPr) return into;
  Object.assign(into, bodyPr.attrs);
  for (const k of children(bodyPr)) {
    if (k.name === 'a:normAutofit') {
      into.fontScale = Number(k.attrs.fontScale ?? 100000) / 100000;
      into.lnReduce = Number(k.attrs.lnSpcReduction ?? 0) / 100000;
    } else if (k.name === 'a:noAutofit' || k.name === 'a:spAutoFit') {
      into.fontScale = 1;
      into.lnReduce = 0;
    }
  }
  return into;
}

const themeFace = (name, theme) =>
  /^\+mj-/.test(name ?? '') ? theme.major : /^\+mn-/.test(name ?? '') ? theme.minor : name;

// A face named for one of its weights ("Helvetica Neue Light") is found on
// most machines only as its family at that weight.
const WEIGHTS = [
  [/\b(thin|hairline)\b/i, 100], [/\b(extra|ultra)[ -]?light\b/i, 200], [/\blight\b/i, 300],
  [/\bmedium\b/i, 500], [/\b(semi|demi)[ -]?bold\b/i, 600], [/\b(extra|ultra)[ -]?bold\b/i, 800],
  [/\b(black|heavy)\b/i, 900], [/\bbold\b/i, 700],
];
const weightOf = (face) => WEIGHTS.find(([re]) => re.test(face ?? ''))?.[1] ?? null;

function fontStack(name, theme) {
  const face = themeFace(name, theme);
  if (!face) return null;
  const clean = (f) => `"${f.replace(/["\\;{}<>]/g, '')}"`;
  const family = weightOf(face) ? face.replace(WEIGHTS.find(([re]) => re.test(face))[0], '').replace(/\s+/g, ' ').trim() : '';
  const quoted = family && family !== face ? `${clean(face)}, ${clean(family)}` : clean(face);
  if (/mono|courier|consolas|menlo|code/i.test(face)) return `${quoted}, ui-monospace, monospace`;
  if (/serif|times|georgia|garamond|cambria|palatino|baskerville|didot|bodoni|caslon|minion|merriweather|playfair|lora|book antiqua|century schoolbook|constantia/i.test(face) && !/sans/i.test(face)) {
    return `${quoted}, ui-serif, Georgia, serif`;
  }
  return `${quoted}, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
}

function roman(num) {
  const table = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  let v = Math.max(1, num);
  for (const [k, s] of table) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return out;
}

function alpha(num) {
  let v = Math.max(1, num);
  let out = '';
  while (v > 0) {
    v -= 1;
    out = String.fromCharCode(97 + (v % 26)) + out;
    v = Math.floor(v / 26);
  }
  return out;
}

function autoNumber(type, num) {
  const m = /^(arabic|romanUc|romanLc|alphaUc|alphaLc)(.*)$/.exec(type ?? '') ?? [null, 'arabic', 'Period'];
  const body =
    m[1] === 'arabic' ? String(num) : m[1] === 'romanUc' ? roman(num).toUpperCase() : m[1] === 'romanLc' ? roman(num) : m[1] === 'alphaUc' ? alpha(num).toUpperCase() : alpha(num);
  const tail = m[2] ?? '';
  if (/ParenBoth/.test(tail)) return `(${body})`;
  if (/ParenR/.test(tail)) return `${body})`;
  if (/Plain/.test(tail)) return body;
  if (/Minus/.test(tail)) return `- ${body} -`;
  return `${body}.`;
}

function bulletChar(bullet, font) {
  const raw = bullet.char ?? '•';
  if (!/wingdings|symbol|webdings|monotype sorts/i.test(font ?? '')) return raw;
  const code = raw.codePointAt(0) ?? 0;
  const plain = code >= 0xf000 && code <= 0xf0ff ? String.fromCharCode(code - 0xf000) : raw;
  return SYMBOL_BULLETS[plain] ?? '•';
}

/**
 * The paragraphs of a txBody as HTML. `chain` is the inherited list styles,
 * lowest first; `body` the merged bodyPr; `textColor` the colour text has when
 * nothing says otherwise (a shape's font reference, or the theme's text).
 */
function textHtml(txBody, { chain, body, ctx, deck, rels, textColor }) {
  const scale = body.fontScale ?? 1;
  const reduce = body.lnReduce ?? 0;
  const counters = [];
  const out = [];
  let first = true;
  for (const para of children(txBody, 'a:p')) {
    const pPr = child(para, 'a:pPr');
    const level = Math.min(8, Math.max(0, Number(pPr?.attrs.lvl ?? 0)));
    const P = paraStyle(chain, level, pPr);
    // A run that is a link opens it. Only the kinds a page may follow.
    const href = (R) => {
      const rel = R.link ? rels?.get(R.link) : null;
      return rel?.external && /^(https?:|mailto:)/i.test(rel.target) ? rel.target : null;
    };
    const runs = [];
    for (const k of children(para)) {
      if (k.name === 'a:r' || k.name === 'a:fld') {
        const text = textOf(child(k, 'a:t'));
        if (!text) continue;
        const rPr = child(k, 'a:rPr');
        const R = mergeRun({ ...P.run }, rPr);
        // A link is drawn in the deck's link colour, underlined, unless the
        // run itself says otherwise.
        if (href(R) && !child(rPr, ['a:solidFill', 'a:gradFill', 'a:noFill'])) {
          R.fill = scheme('hlink');
          R.fillCss = null;
          R.u = true;
        }
        runs.push({ text, R });
      } else if (k.name === 'a:br') {
        runs.push({ br: true, R: mergeRun({ ...P.run }, child(k, 'a:rPr')) });
      }
    }
    const end = mergeRun({ ...P.run }, child(para, 'a:endParaRPr'));
    const hasText = runs.some((r) => r.text?.trim());

    // A run's look as declarations, so what every run shares can go on the
    // paragraph: a word typed between two runs then looks like the paragraph.
    const runDecls = (R) => {
      const size = (R.sz ?? 18) * scale;
      const color = R.fill === 'none' ? 'transparent' : R.fill ? css(colorIn(R.fill, ctx)) : (R.fillCss ?? textColor);
      const deco = [R.u && 'underline', R.strike && 'line-through'].filter(Boolean).join(' ');
      const face = fontStack(R.font ?? R.alt ?? '+mn-lt', ctx.theme);
      const weight = R.b ? null : weightOf(themeFace(R.font ?? R.alt ?? '+mn-lt', ctx.theme));
      return [
        `font-size:${deck.cqi(size * 12700 * (R.baseline ? 0.66 : 1))}`,
        color && `color:${color}`,
        face && `font-family:${face}`,
        R.b && 'font-weight:700',
        weight && `font-weight:${weight}`,
        R.b === false && !weight && 'font-weight:400',
        R.i && 'font-style:italic',
        deco && `text-decoration:${deco}`,
        R.cap === 'all' && 'text-transform:uppercase',
        R.cap === 'small' && 'font-variant:small-caps',
        R.baseline && `vertical-align:${R.baseline > 0 ? 'super' : 'sub'}`,
        R.highlight && `background:${css(colorIn(R.highlight, ctx))}`,
      ].filter(Boolean);
    };

    // Adjacent runs that look the same are one run.
    const merged = [];
    for (const r of runs) {
      if (r.br) {
        merged.push(r);
        continue;
      }
      const decls = runDecls(r.R);
      const look = `${decls.join(';')}|${href(r.R) ?? ''}`;
      const last = merged.at(-1);
      if (last && !last.br && last.look === look) last.text += r.text;
      else merged.push({ ...r, decls, look });
    }

    const pStyle = [];
    const align = ALIGN[P.algn];
    if (align && align !== 'left') pStyle.push(`text-align:${align}`);
    if (P.marL) pStyle.push(`padding-left:${deck.cqi(P.marL)}`);
    if (P.indent) pStyle.push(`text-indent:${deck.cqi(P.indent)}`);
    const lead = runs.find((r) => !r.br)?.R ?? end;
    if (P.lnSpc?.pct !== undefined) pStyle.push(`line-height:${n(LINE * P.lnSpc.pct * (1 - reduce))}`);
    else if (P.lnSpc?.pts !== undefined) pStyle.push(`line-height:${deck.cqi(P.lnSpc.pts * 12700 * scale)}`);
    else if (reduce) pStyle.push(`line-height:${n(LINE * (1 - reduce))}`);
    const gap = (s) => (s?.pts !== undefined ? deck.cqi(s.pts * 12700 * (1 - reduce)) : s?.pct ? `${n(s.pct * LINE * (1 - reduce))}em` : null);
    if (!first && gap(P.spcBef)) pStyle.push(`margin-top:${gap(P.spcBef)}`);
    if (gap(P.spcAft)) pStyle.push(`margin-bottom:${gap(P.spcAft)}`);
    first = false;

    let bu = null;
    if (P.bullet && hasText) {
      if (P.bullet.auto) {
        counters.length = level + 1;
        counters[level] = (counters[level] ?? P.bullet.start - 1) + 1;
        bu = autoNumber(P.bullet.auto, counters[level]);
      } else {
        counters.length = level;
        bu = bulletChar(P.bullet, P.buFont);
      }
      const buColor = P.buClr ? css(colorIn(P.buClr, ctx)) : null;
      if (buColor) pStyle.push(`--bu-color:${buColor}`);
      if (P.buSz && Math.abs(P.buSz - 1) > 0.01) pStyle.push(`--bu-size:${n(P.buSz)}em`);
      if (P.indent < 0) pStyle.push(`--bu-w:${deck.cqi(-P.indent)}`);
    } else if (hasText) {
      counters.length = level;
    }

    const attrs = bu ? ` data-bu="${escAttr(bu)}"` : '';
    if (!hasText && !runs.some((r) => r.br)) {
      out.push(`<p style="${escAttr(styleOf([...pStyle, ...runDecls(end)]))}"><br></p>`);
      continue;
    }

    const texts = merged.filter((r) => !r.br);
    const shared = texts.length ? texts[0].decls.filter((d) => texts.every((r) => r.decls.includes(d))) : runDecls(lead);
    pStyle.push(...shared);
    // The size of the paragraph is its first run's, so a bullet and an empty
    // line are the size of the words beside them.
    if (!shared.some((d) => d.startsWith('font-size:'))) pStyle.push(runDecls(lead)[0]);
    const inner = merged
      .map((r) => {
        if (r.br) return '<br>';
        const text = escText(r.text);
        const link = href(r.R);
        const wrapped = link ? `<a href="${escAttr(link)}" target="_blank" rel="noopener">${text}</a>` : text;
        const own = r.decls.filter((d) => !shared.includes(d));
        return own.length ? `<span style="${escAttr(own.join(';'))}">${wrapped}</span>` : wrapped;
      })
      .join('');
    out.push(`<p${attrs} style="${escAttr(styleOf(pStyle))}">${inner}</p>`);
  }
  return out.join('');
}

const scheme = (val) => ({ name: 'a:solidFill', attrs: {}, kids: [{ name: 'a:schemeClr', attrs: { val }, kids: [] }] });

/** The colour text is when nothing says otherwise. */
const tx1 = (ctx) => css(colorIn(scheme('tx1'), ctx));

const hasAnyText = (txBody) => findAll(txBody, 'a:t').some((t) => textOf(t).trim());

// --------------------------------------------------------- preset geometry

function adjOf(geom, name, fallback) {
  for (const gd of children(child(geom, 'a:avLst'), 'a:gd')) {
    if (gd.attrs.name !== name) continue;
    const m = /val\s+(-?\d+)/.exec(gd.attrs.fmla ?? '');
    if (m) return Number(m[1]) / 100000;
  }
  return fallback;
}

/** An outline for the preset shapes decks are made of, in a w × h box.
 *  `null` for a rectangle (drawn as a box), `undefined` for one this does not
 *  know, which is drawn as a rectangle too. */
function presetPath(prst, w, h, geom) {
  const ss = Math.min(w, h);
  const P = (pts) => `M${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' L')} Z`;
  switch (prst) {
    case 'rect':
    case 'flowChartProcess':
    case 'roundRect':
    case 'flowChartAlternateProcess':
    case 'ellipse':
    case 'flowChartConnector':
    case 'flowChartTerminator':
      return null;
    case 'triangle': {
      const a = adjOf(geom, 'adj', 0.5);
      return P([[w * a, 0], [w, h], [0, h]]);
    }
    case 'rtTriangle':
      return P([[0, 0], [w, h], [0, h]]);
    case 'diamond':
    case 'flowChartDecision':
      return P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const o = ss * adjOf(geom, 'adj', 0.25);
      return P([[o, 0], [w, 0], [w - o, h], [0, h]]);
    }
    case 'trapezoid': {
      const o = ss * adjOf(geom, 'adj', 0.25);
      return P([[0, h], [o, 0], [w - o, 0], [w, h]]);
    }
    case 'pentagon':
      return P([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]);
    case 'homePlate': {
      const t = ss * adjOf(geom, 'adj', 0.5);
      return P([[0, 0], [w - t, 0], [w, h / 2], [w - t, h], [0, h]]);
    }
    case 'chevron': {
      const t = ss * adjOf(geom, 'adj', 0.5);
      return P([[0, 0], [w - t, 0], [w, h / 2], [w - t, h], [0, h], [t, h / 2]]);
    }
    case 'hexagon': {
      const o = ss * adjOf(geom, 'adj', 0.25);
      return P([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]);
    }
    case 'octagon': {
      const o = ss * adjOf(geom, 'adj', 0.29289);
      return P([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]);
    }
    case 'plus': {
      const o = ss * adjOf(geom, 'adj', 0.25);
      return P([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]);
    }
    case 'rightArrow':
    case 'leftArrow':
    case 'upArrow':
    case 'downArrow': {
      const vertical = prst === 'upArrow' || prst === 'downArrow';
      const [L, T] = vertical ? [h, w] : [w, h];
      const shaft = T * adjOf(geom, 'adj1', 0.5);
      const head = Math.min(L, ss * adjOf(geom, 'adj2', 0.5));
      const top = (T - shaft) / 2;
      let pts = [[0, top], [L - head, top], [L - head, 0], [L, T / 2], [L - head, T], [L - head, top + shaft], [0, top + shaft]];
      if (prst === 'leftArrow' || prst === 'upArrow') pts = pts.map(([x, y]) => [L - x, y]);
      if (vertical) pts = pts.map(([x, y]) => [y, x]);
      return P(pts);
    }
    case 'leftRightArrow': {
      const shaft = h * adjOf(geom, 'adj1', 0.5);
      const head = Math.min(w / 2, ss * adjOf(geom, 'adj2', 0.5));
      const top = (h - shaft) / 2;
      return P([[0, h / 2], [head, 0], [head, top], [w - head, top], [w - head, 0], [w, h / 2], [w - head, h], [w - head, top + shaft], [head, top + shaft], [head, h]]);
    }
    case 'star5': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.38 : 1;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
      }
      return P(pts);
    }
    case 'line':
    case 'straightConnector1':
      return `M0,0 L${n(w)},${n(h)}`;
    case 'bentConnector2':
      return `M0,0 L${n(w)},0 L${n(w)},${n(h)}`;
    case 'bentConnector3': {
      const x = w * adjOf(geom, 'adj1', 0.5);
      return `M0,0 L${n(x)},0 L${n(x)},${n(h)} L${n(w)},${n(h)}`;
    }
    case 'curvedConnector2':
      return `M0,0 Q${n(w)},0 ${n(w)},${n(h)}`;
    case 'curvedConnector3': {
      const x = w * adjOf(geom, 'adj1', 0.5);
      return `M0,0 C${n(x)},0 ${n(x)},${n(h)} ${n(w)},${n(h)}`;
    }
    default:
      return undefined;
  }
}

/** A freeform, as SVG path data in a w × h box. */
function customPath(geom, w, h) {
  const out = [];
  for (const p of children(child(geom, 'a:pathLst'), 'a:path')) {
    const pw = Number(p.attrs.w ?? 0) || w;
    const ph = Number(p.attrs.h ?? 0) || h;
    const sx = pw ? w / pw : 1;
    const sy = ph ? h / ph : 1;
    const pt = (el) => [Number(el?.attrs.x ?? 0) * sx, Number(el?.attrs.y ?? 0) * sy];
    let cur = [0, 0];
    const d = [];
    for (const step of children(p)) {
      const pts = children(step, 'a:pt').map(pt);
      switch (step.name) {
        case 'a:moveTo':
          cur = pts[0] ?? cur;
          d.push(`M${n(cur[0])},${n(cur[1])}`);
          break;
        case 'a:lnTo':
          cur = pts[0] ?? cur;
          d.push(`L${n(cur[0])},${n(cur[1])}`);
          break;
        case 'a:cubicBezTo':
          if (pts.length === 3) {
            d.push(`C${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}`);
            cur = pts[2];
          }
          break;
        case 'a:quadBezTo':
          if (pts.length === 2) {
            d.push(`Q${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}`);
            cur = pts[1];
          }
          break;
        case 'a:arcTo': {
          const wr = Number(step.attrs.wR ?? 0) * sx;
          const hr = Number(step.attrs.hR ?? 0) * sy;
          const st = (Number(step.attrs.stAng ?? 0) / 60000) * (Math.PI / 180);
          const sw = (Number(step.attrs.swAng ?? 0) / 60000) * (Math.PI / 180);
          const cx = cur[0] - wr * Math.cos(st);
          const cy = cur[1] - hr * Math.sin(st);
          const end = [cx + wr * Math.cos(st + sw), cy + hr * Math.sin(st + sw)];
          d.push(`A${n(wr)},${n(hr)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${n(end[0])},${n(end[1])}`);
          cur = end;
          break;
        }
        case 'a:close':
          d.push('Z');
          break;
        default:
          break;
      }
    }
    if (d.length) out.push({ d: d.join(' '), fill: p.attrs.fill !== 'none', stroke: p.attrs.stroke !== '0' && p.attrs.stroke !== 'false' });
  }
  return out;
}

const DASHES = {
  dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3],
  sysDashDot: [3, 1, 1, 1], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

// ------------------------------------------------------------------- pictures

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon' };

/** What a browser can show, from the bytes rather than the name: a .png that
 *  is really a JPEG is common, an .emf a browser cannot draw is too. */
function sniff(buf, name) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  const ext = posix.extname(name).slice(1).toLowerCase();
  if (ext === 'svg' && /<svg[\s>]/i.test(buf.toString('utf8', 0, Math.min(buf.length, 4096)))) return 'image/svg+xml';
  if (ext === 'avif') return IMAGE_TYPES.avif;
  return null;
}

// Sound and video a browser plays, by extension: what PowerPoint embeds is
// whatever the author dropped in, and a .wmv is as common as an .mp4.
const MEDIA_TYPES = {
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', oga: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

// ----------------------------------------------------------------- the deck

async function loadMaster(pkg, deck, part) {
  if (deck.masters.has(part)) return deck.masters.get(part);
  const load = (async () => {
    const root = await pkg.xml(part);
    if (!root) return null;
    const rels = await pkg.rels(part);
    const theme = readTheme(await pkg.xml(relOfType(rels, '/theme')?.target));
    const styles = child(root, 'p:txStyles');
    return {
      part,
      root,
      rels,
      theme,
      clrMap: { ...DEFAULT_MAP, ...(child(root, 'p:clrMap')?.attrs ?? {}) },
      title: child(styles, 'p:titleStyle'),
      body: child(styles, 'p:bodyStyle'),
      other: child(styles, 'p:otherStyle'),
      phs: placeholders(root),
    };
  })();
  deck.masters.set(part, load);
  return load;
}

async function loadLayout(pkg, deck, part) {
  if (!part) return null;
  if (deck.layouts.has(part)) return deck.layouts.get(part);
  const load = (async () => {
    const root = await pkg.xml(part);
    if (!root) return null;
    const rels = await pkg.rels(part);
    const master = await loadMaster(pkg, deck, relOfType(rels, '/slideMaster')?.target);
    return { part, root, rels, master, phs: placeholders(root) };
  })();
  deck.layouts.set(part, load);
  return load;
}

function clrMapFor(root, base) {
  const over = down(root, 'p:clrMapOvr', 'a:overrideClrMapping');
  return over ? { ...DEFAULT_MAP, ...over.attrs } : base;
}

/**
 * Everything one slide draws, back to front, as HTML for its face. `layer` is
 * the part being drawn (the slide, its layout or its master): only the
 * slide's own parts are editable and addressable, because the master's logo
 * on every slide is not something you change one slide at a time.
 */
class Painter {
  constructor({ pkg, deck, slide }) {
    this.pkg = pkg;
    this.deck = deck;
    this.slide = slide;
  }

  miss(kind) {
    this.deck.miss(kind, this.slide.number);
  }

  box(g) {
    const { deck } = this;
    return [
      `left:${n((g.x / deck.width) * 100)}%`,
      `top:${n((g.y / deck.height) * 100)}%`,
      `width:${n((g.w / deck.width) * 100)}%`,
      `height:${n((g.h / deck.height) * 100)}%`,
    ];
  }

  turn(g, { flips = true } = {}) {
    const t = [];
    if (g.rot) t.push(`rotate(${n(g.rot)}deg)`);
    if (flips && g.flipH) t.push('scaleX(-1)');
    if (flips && g.flipV) t.push('scaleY(-1)');
    return t.length ? `transform:${t.join(' ')}` : null;
  }

  id(layer) {
    return layer.editable ? ` data-marble-id="${this.deck.newId()}"` : '';
  }

  async image(rel, layer) {
    if (!rel || rel.external) return null;
    return this.deck.image(this.pkg, rel.target, () => this.miss('picture'));
  }

  async blipImage(blip, layer) {
    // A picture saved as SVG keeps a PNG beside it for older readers; the SVG
    // is the one to draw.
    const svg = findAll(blip, 'asvg:svgBlip')[0];
    const ids = [svg?.attrs['r:embed'], blip.attrs['r:embed']].filter(Boolean);
    for (const id of ids) {
      const src = await this.image(layer.rels.get(id), layer);
      if (src) return src;
    }
    if (blip.attrs['r:link'] || !ids.length) this.miss('picture');
    return null;
  }

  /** An <img>, cropped the way the file crops it, filling box `g`. */
  async picture(blipFill, g, layer, { alt = '', radius = null, line = null } = {}) {
    const blip = child(blipFill, 'a:blip');
    if (!blip) return '';
    const src = await this.blipImage(blip, layer);
    if (!src) return '';
    const crop = child(blipFill, 'a:srcRect')?.attrs ?? {};
    const [l, t, r, b] = ['l', 't', 'r', 'b'].map((k) => Number(crop[k] ?? 0) / 100000);
    const frame = [...this.box(g), this.turn(g), radius && `border-radius:${radius}`, line && `outline:${this.deck.cqi(line.width)} solid ${line.color}`, line && `outline-offset:-${this.deck.cqi(line.width)}`];
    const altText = alt ? ` alt="${escAttr(alt)}"` : ' alt=""';
    if (!l && !t && !r && !b) {
      return `<img class="bx"${this.id(layer)}${altText} ${src} style="${escAttr(styleOf(frame))}">`;
    }
    const fx = 1 - l - r || 1;
    const fy = 1 - t - b || 1;
    const inner = [`left:${n((-l / fx) * 100)}%`, `top:${n((-t / fy) * 100)}%`, `width:${n((1 / fx) * 100)}%`, `height:${n((1 / fy) * 100)}%`];
    return `<div class="bx crop"${this.id(layer)} style="${escAttr(styleOf(frame))}"><img${altText} ${src} style="${escAttr(styleOf(inner))}"></div>`;
  }

  /** A shape outline as SVG in its own box, scaled the way the slide is. */
  svg(g, paths, { fill, line }, layer) {
    const pad = line ? line.width : 0;
    const box = { x: g.x - pad, y: g.y - pad, w: g.w + pad * 2, h: g.h + pad * 2, rot: g.rot, flipH: g.flipH, flipV: g.flipV };
    const view = `${n(-pad)} ${n(-pad)} ${n(g.w + pad * 2)} ${n(g.h + pad * 2)}`;
    let defs = '';
    const marker = (type, at) => {
      const id = `m${this.deck.newId()}`;
      defs += `<marker id="${id}" viewBox="0 0 10 10" refX="${type === 'oval' || type === 'diamond' ? 5 : 9}" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto-start-reverse"><path d="${type === 'oval' ? 'M5,0 A5,5 0 1 1 4.99,0 Z' : type === 'diamond' ? 'M5,0 L10,5 L5,10 L0,5 Z' : 'M0,0 L10,5 L0,10 Z'}" fill="${escAttr(line.color)}"/></marker>`;
      return ` marker-${at}="url(#${id})"`;
    };
    const dash = line && DASHES[line.dash] ? ` stroke-dasharray="${DASHES[line.dash].map((v) => n(v * line.width)).join(' ')}"` : '';
    const body = paths
      .map((p) => {
        const f = p.fill && fill && !fill.none && fill.solid ? fill.solid : 'none';
        const stroke = p.stroke && line ? ` stroke="${escAttr(line.color)}" stroke-width="${n(line.width)}"${dash}` : '';
        const ends = p.stroke && line ? `${line.head ? marker(line.head, 'start') : ''}${line.tail ? marker(line.tail, 'end') : ''}` : '';
        return `<path d="${p.d}" fill="${escAttr(f)}"${stroke}${ends}/>`;
      })
      .join('');
    return `<svg class="bx"${this.id(layer)} viewBox="${view}" preserveAspectRatio="none" aria-hidden="true" style="${escAttr(styleOf([...this.box(box), this.turn(box)]))}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
  }

  /** The placeholder this shape stands in for, on the layout and the master. */
  inherited(el, layer) {
    const ph = phOf(el);
    if (!ph || layer.kind !== 'slide') return { ph, layoutPh: null, masterPh: null };
    const layoutPh = matchLayout(this.slide.layout?.phs ?? [], ph);
    const type = ph.attrs.type ?? layoutPh?.type ?? 'obj';
    const masterPh = matchMaster(this.slide.master?.phs ?? [], type);
    return { ph, layoutPh, masterPh, type };
  }

  async shape(sp, map, layer) {
    const { deck, slide } = this;
    const ctx = { ...slide.ctx, groupFill: layer.groupFill };
    const spPr = pc(sp, 'spPr');
    const style = pc(sp, 'style');
    const txBody = pc(sp, 'txBody');
    const { ph, layoutPh, masterPh, type } = this.inherited(sp, layer);
    // A layout's or a master's placeholders are prompts for a slide to fill,
    // never drawn on one.
    if (ph && layer.kind !== 'slide') return '';

    const xf = xfrmOf(child(spPr, 'a:xfrm')) ?? xfrmOf(child(pc(layoutPh?.sp, 'spPr'), 'a:xfrm')) ?? xfrmOf(child(pc(masterPh?.sp, 'spPr'), 'a:xfrm'));
    if (!xf) return '';
    const g = place(xf, map);

    let fill = fillIn(spPr, ctx);
    if (fill === undefined && layoutPh) fill = fillIn(pc(layoutPh.sp, 'spPr'), ctx);
    if (fill === undefined && masterPh) fill = fillIn(pc(masterPh.sp, 'spPr'), ctx);
    if (fill === undefined) fill = styleFill(style, ctx);
    let line = lineOf(spPr, style, ctx);
    if (!line && !child(spPr, 'a:ln') && layoutPh) line = lineOf(pc(layoutPh.sp, 'spPr'), null, ctx);

    const geom = child(spPr, 'a:prstGeom') ?? child(pc(layoutPh?.sp, 'spPr'), 'a:prstGeom');
    const cust = child(spPr, 'a:custGeom');
    const prst = geom?.attrs.prst ?? (cust ? null : 'rect');
    const text = txBody && hasAnyText(txBody);
    const out = [];

    // ------------------------------------------------- the shape's own body
    const filled = fill && !fill.none && (fill.css || fill.blip);
    let radius = null;
    if (prst === 'ellipse' || prst === 'flowChartConnector') radius = '50%';
    else if (prst === 'roundRect' || prst === 'flowChartAlternateProcess') radius = deck.cqi(Math.min(g.w, g.h) * adjOf(geom, 'adj', 0.16667));
    else if (prst === 'flowChartTerminator') radius = deck.cqi(Math.min(g.w, g.h) / 2);
    // An outline drawn in SVG, or none: a rectangle, rounded or not, an
    // ellipse, and any preset this does not know are one CSS box.
    let paths = null;
    if (cust) paths = customPath(cust, g.w, g.h);
    else {
      const d = presetPath(prst, g.w, g.h, geom);
      if (d) paths = [{ d, fill: !/^(line|straightConnector1|bent|curved)/.test(prst), stroke: true }];
    }

    let bodyHtml = '';
    if (fill?.blip) {
      bodyHtml = await this.picture(fill.blip, g, layer, { radius, line });
    } else if (paths && paths.length && (filled || line)) {
      bodyHtml = this.svg(g, paths, { fill, line }, layer);
    }

    // ---------------------------------------------------------- the words
    if (!text && !bodyHtml && !(filled || line)) return '';
    const plain = !paths;
    const boxStyle = [...this.box(g), this.turn(g, { flips: false })];
    if (plain && !fill?.blip) {
      if (filled) boxStyle.push(`background:${fill.css}`);
      if (line) boxStyle.push(`border:${deck.cqi(line.width)} ${line.dash === 'solid' ? 'solid' : /dot/i.test(line.dash) ? 'dotted' : 'dashed'} ${line.color}`);
      if (radius) boxStyle.push(`border-radius:${radius}`);
    }

    if (!text) {
      if (bodyHtml) return bodyHtml;
      return `<div class="bx"${this.id(layer)} style="${escAttr(styleOf(boxStyle))}"></div>`;
    }

    // Body properties and list styles, inherited down the same chain.
    const body = {};
    mergeBody(body, child(pc(masterPh?.sp, 'txBody'), 'a:bodyPr'));
    mergeBody(body, child(pc(layoutPh?.sp, 'txBody'), 'a:bodyPr'));
    const ownBody = child(txBody, 'a:bodyPr');
    body.fontScale = 1;
    body.lnReduce = 0;
    mergeBody(body, ownBody);
    const role = !ph ? 'other' : type === 'title' || type === 'ctrTitle' ? 'title' : 'body';
    const master = slide.master;
    const chain = !ph
      ? [deck.defaultText]
      : [role === 'title' ? master?.title : master?.body, child(pc(masterPh?.sp, 'txBody'), 'a:lstStyle'), child(pc(layoutPh?.sp, 'txBody'), 'a:lstStyle')];
    // A shape's style names the colour and face of its text (white on an
    // accent fill, most often), over the deck's defaults.
    const fontRef = child(style, 'a:fontRef');
    if (fontRef) {
      const run = {};
      if (child(fontRef, COLOR_TAGS)) run.fill = fontRef;
      if (fontRef.attrs.idx === 'major' || fontRef.attrs.idx === 'minor') run.font = fontRef.attrs.idx === 'major' ? '+mj-lt' : '+mn-lt';
      chain.push({ run });
    }
    chain.push(child(txBody, 'a:lstStyle'));
    const textColor = tx1(ctx);

    const inset = (k, d) => deck.cqi(Number(body[k] ?? d));
    const anchor = body.anchor === 'ctr' ? 'ctr' : body.anchor === 'b' ? 'b' : null;
    const textStyle = plain && !fill?.blip ? boxStyle : [...this.box(g), this.turn(g, { flips: false })];
    textStyle.push(`padding:${inset('tIns', 45720)} ${inset('rIns', 91440)} ${inset('bIns', 45720)} ${inset('lIns', 91440)}`);
    if (body.wrap === 'none') textStyle.push('white-space:pre');
    if (body.vert === 'vert' || body.vert === 'eaVert') textStyle.push('writing-mode:vertical-rl');
    if (body.vert === 'vert270') textStyle.push('writing-mode:sideways-lr');

    // SmartArt keeps a text rectangle of its own beside the shape's.
    const txXfrm = xfrmOf(child(sp, 'dsp:txXfrm'));
    if (txXfrm) {
      const tg = place(txXfrm, map);
      textStyle.splice(0, 4, ...this.box(tg));
    }

    const inner = textHtml(txBody, { chain, body, ctx, deck, rels: layer.rels, textColor });
    const editable = layer.editable ? ' data-marble-rich' : '';
    const heading = role === 'title' ? ' role="heading" aria-level="2"' : '';
    const anchored = anchor ? ` data-anchor="${anchor}"` : '';
    if (role === 'title' && layer.editable) slide.titles.push(textOf(txBody).trim());
    out.push(bodyHtml);
    out.push(`<div class="bx tx"${this.id(layer)}${editable}${heading}${anchored} style="${escAttr(styleOf(textStyle))}">${inner}</div>`);
    return out.join('');
  }

  async pic(el, map, layer) {
    const { ph, layoutPh, masterPh } = this.inherited(el, layer);
    if (ph && layer.kind !== 'slide') return '';
    const spPr = pc(el, 'spPr');
    const xf = xfrmOf(child(spPr, 'a:xfrm')) ?? xfrmOf(child(pc(layoutPh?.sp, 'spPr'), 'a:xfrm')) ?? xfrmOf(child(pc(masterPh?.sp, 'spPr'), 'a:xfrm'));
    if (!xf) return '';
    const g = place(xf, map);
    const nv = nvOf(el);
    const prst = child(spPr, 'a:prstGeom')?.attrs.prst;
    const radius = prst === 'ellipse' ? '50%' : prst === 'roundRect' ? this.deck.cqi(Math.min(g.w, g.h) * adjOf(child(spPr, 'a:prstGeom'), 'adj', 0.16667)) : null;
    const alt = child(nv, ['p:cNvPr', 'dsp:cNvPr'])?.attrs.descr ?? '';
    const line = lineOf(spPr, pc(el, 'style'), this.slide.ctx);
    const picture = await this.picture(pc(el, 'blipFill'), g, layer, { alt: /\.(png|jpe?g|gif|svg|bmp|tiff?)$/i.test(alt) ? '' : alt, radius, line });
    const media = await this.media(child(nv, 'p:nvPr'), g, layer);
    return media === null ? picture : media.video ? media.html : `${picture}${media.html}`;
  }

  /** A picture that stands for a sound or a video. A sound keeps its icon and
   *  plays when the icon is pressed; a video is the player itself. Null when
   *  the picture is only a picture. */
  async media(nvPr, g, layer) {
    const video = find(nvPr, 'a:videoFile') ?? find(nvPr, 'a:quickTimeFile');
    const audio = find(nvPr, 'a:audioFile') ?? find(nvPr, 'a:wavAudioFile');
    const embedded = find(nvPr, 'p14:media');
    if (!video && !audio && !embedded) return null;
    const kind = video ? 'video' : 'sound';
    const rel = layer.rels.get(embedded?.attrs['r:embed'] ?? '') ?? layer.rels.get((video ?? audio)?.attrs['r:link'] ?? '');
    const src = rel && !rel.external ? await this.deck.media(this.pkg, rel.target) : null;
    if (!src) {
      this.miss(kind);
      return { html: '', video: false };
    }
    if (kind === 'video') {
      return { video: true, html: `<video class="bx"${this.id(layer)} controls preload="metadata" playsinline ${src} style="${escAttr(styleOf([...this.box(g), this.turn(g), 'object-fit:contain', 'background:#000']))}"></video>` };
    }
    return { video: false, html: `<div class="bx media"${this.id(layer)} role="button" aria-label="Play the sound" title="Play the sound" style="${escAttr(styleOf([...this.box(g), this.turn(g, { flips: false })]))}"><audio preload="none" ${src}></audio></div>` };
  }

  async connector(el, map, layer) {
    const spPr = pc(el, 'spPr');
    const xf = xfrmOf(child(spPr, 'a:xfrm'));
    if (!xf) return '';
    const g = place(xf, map);
    const line = lineOf(spPr, pc(el, 'style'), this.slide.ctx);
    if (!line) return '';
    const geom = child(spPr, 'a:prstGeom');
    const d = presetPath(geom?.attrs.prst ?? 'line', g.w, g.h, geom) ?? `M0,0 L${n(g.w)},${n(g.h)}`;
    return this.svg(g, [{ d, fill: false, stroke: true }], { fill: null, line }, layer);
  }

  async table(tbl, g, layer) {
    const { deck, slide } = this;
    const ctx = slide.ctx;
    const cols = children(child(tbl, 'a:tblGrid'), 'a:gridCol').map((c) => Number(c.attrs.w ?? 0));
    const total = cols.reduce((a, b) => a + b, 0) || 1;
    const tblPr = child(tbl, 'a:tblPr');
    const flags = tblPr?.attrs ?? {};
    const look = deck.tableStyle(child(tblPr, 'a:tableStyleId') ? textOf(child(tblPr, 'a:tableStyleId')).trim() : null, ctx);
    const rows = children(tbl, 'a:tr');
    const body = rows
      .map((tr, r) => {
        const isFirst = truthy(flags.firstRow) && r === 0;
        const isLast = truthy(flags.lastRow) && r === rows.length - 1;
        const band = truthy(flags.bandRow) && !isFirst ? ((r - (truthy(flags.firstRow) ? 1 : 0)) % 2 === 0 ? 'band1H' : 'band2H') : null;
        const part = isFirst ? look.firstRow : isLast ? look.lastRow : band ? look[band] : null;
        const cells = children(tr, 'a:tc')
          .map((tc) => {
            if (truthy(tc.attrs.hMerge) || truthy(tc.attrs.vMerge)) return '';
            const tcPr = child(tc, 'a:tcPr');
            const own = fillIn(tcPr, ctx);
            const fill = own !== undefined ? own : part?.fill ?? look.wholeTbl?.fill;
            const color = part?.color ?? look.wholeTbl?.color ?? null;
            const bold = part?.bold ?? look.wholeTbl?.bold ?? false;
            const pad = (k, d) => deck.cqi(Number(tcPr?.attrs[k] ?? d));
            const edges = ['lnT', 'lnR', 'lnB', 'lnL']
              .map((k, i) => {
                const ln = child(tcPr, `a:${k}`);
                const side = ['top', 'right', 'bottom', 'left'][i];
                if (ln) {
                  const lf = fillIn(ln, ctx);
                  if (!lf || lf.none || !lf.css) return `border-${side}:0`;
                  return `border-${side}:${deck.cqi(Math.max(Number(ln.attrs.w ?? 12700), 3175))} solid ${lf.css}`;
                }
                return look.border ? `border-${side}:${look.border}` : null;
              });
            const anchor = tcPr?.attrs.anchor === 'ctr' ? 'middle' : tcPr?.attrs.anchor === 'b' ? 'bottom' : null;
            const style = styleOf([
              `padding:${pad('marT', 45720)} ${pad('marR', 91440)} ${pad('marB', 45720)} ${pad('marL', 91440)}`,
              fill && !fill.none && fill.css && `background:${fill.css}`,
              ...edges,
              anchor && `vertical-align:${anchor}`,
            ]);
            const txBody = child(tc, 'a:txBody');
            const chain = [deck.defaultText, { run: { ...(color ? { fill: undefined, fillCss: color } : {}), ...(bold ? { b: true } : {}) } }, child(txBody, 'a:lstStyle')];
            const textColor = tx1(ctx);
            const inner = txBody ? textHtml(txBody, { chain, body: {}, ctx, deck, rels: layer.rels, textColor }) : '';
            const span = [
              Number(tc.attrs.gridSpan) > 1 ? ` colspan="${Number(tc.attrs.gridSpan)}"` : '',
              Number(tc.attrs.rowSpan) > 1 ? ` rowspan="${Number(tc.attrs.rowSpan)}"` : '',
            ].join('');
            return `<td${this.id(layer)}${layer.editable ? ' data-marble-rich' : ''}${span} style="${escAttr(style)}">${inner}</td>`;
          })
          .join('');
        return `<tr style="height:${deck.cqi(Number(tr.attrs.h ?? 0))}">${cells}</tr>`;
      })
      .join('');
    const colgroup = cols.map((w) => `<col style="width:${n((w / total) * 100)}%">`).join('');
    return `<table class="bx tb"${this.id(layer)} style="${escAttr(styleOf([...this.box(g), this.turn(g, { flips: false })]))}"><colgroup>${colgroup}</colgroup><tbody>${body}</tbody></table>`;
  }

  async frame(el, map, layer) {
    const xf = xfrmOf(pc(el, 'xfrm'));
    if (!xf) return '';
    const g = place(xf, map);
    const data = down(el, 'a:graphic', 'a:graphicData');
    const uri = data?.attrs.uri ?? '';
    if (uri.endsWith('/table')) {
      const tbl = child(data, 'a:tbl');
      return tbl ? this.table(tbl, g, layer) : '';
    }
    if (uri.endsWith('/chart') || uri.includes('chartex')) {
      this.miss('chart');
      return '';
    }
    if (uri.endsWith('/diagram')) return this.diagram(data, xf, map, layer);
    // An embedded spreadsheet or document keeps a picture of itself.
    const picture = find(data, 'p:pic');
    if (picture) {
      const html = await this.pic(picture, map, layer);
      if (html) return html;
    }
    this.miss('object');
    return '';
  }

  /** SmartArt draws from a drawing PowerPoint keeps beside its data. The
   *  drawing's coordinates are the frame's own. */
  async diagram(data, xf, map, layer) {
    const relIds = child(data, 'dgm:relIds');
    const dataPart = layer.rels.get(relIds?.attrs['r:dm'] ?? '')?.target;
    const dataRoot = await this.pkg.xml(dataPart);
    const drawingId = find(dataRoot, 'dsp:dataModelExt')?.attrs.relId;
    let drawingPart = drawingId ? layer.rels.get(drawingId)?.target : null;
    if (!drawingPart) {
      const drawings = [...layer.rels.values()].filter((r) => r.type.endsWith('/diagramDrawing'));
      if (drawings.length === 1) drawingPart = drawings[0].target;
    }
    const drawing = await this.pkg.xml(drawingPart);
    const tree = find(drawing, 'dsp:spTree');
    if (!tree) {
      this.miss('diagram');
      return '';
    }
    const rels = await this.pkg.rels(drawingPart);
    const inner = { ...layer, rels };
    return this.tree(tree, shift(map, xf.x, xf.y), inner);
  }

  async alternate(el, map, layer) {
    const choice = child(el, 'mc:Choice');
    const fallback = child(el, 'mc:Fallback');
    // An equation is drawn by a math engine PowerPoint has and a browser does
    // not, and its fallback is a picture of it.
    const pick = choice && !find(choice, 'a14:m') ? choice : fallback ?? choice;
    return pick ? this.tree(pick, map, layer) : '';
  }

  async tree(node, map, layer) {
    const out = [];
    for (const el of children(node)) {
      const local = el.name.replace(/^(p|dsp):/, '');
      if (el.name === 'mc:AlternateContent') out.push(await this.alternate(el, map, layer));
      else if (local === 'sp') out.push(await this.shape(el, map, layer));
      else if (local === 'pic') out.push(await this.pic(el, map, layer));
      else if (local === 'cxnSp') out.push(await this.connector(el, map, layer));
      else if (local === 'graphicFrame') out.push(await this.frame(el, map, layer));
      else if (local === 'grpSp') {
        const grpSpPr = pc(el, 'grpSpPr');
        const fill = fillIn(grpSpPr, this.slide.ctx);
        out.push(await this.tree(el, within(map, xfrmOf(child(grpSpPr, 'a:xfrm'))), { ...layer, groupFill: fill ?? layer.groupFill }));
      } else if (local === 'contentPart') this.miss('ink');
    }
    return out.filter(Boolean).join('\n');
  }

  /** A slide's background: its own, else its layout's, else its master's. */
  async background() {
    const { slide } = this;
    for (const layer of [slide.layers.slide, slide.layers.layout, slide.layers.master]) {
      const bg = down(layer?.root, 'p:cSld', 'p:bg');
      if (!bg) continue;
      const bgPr = child(bg, 'p:bgPr');
      let fill;
      if (bgPr) fill = fillIn(bgPr, slide.ctx);
      else {
        const ref = child(bg, 'p:bgRef');
        if (ref) fill = styleFill({ kids: [{ ...ref, name: 'a:fillRef' }] }, slide.ctx);
      }
      if (!fill) continue;
      if (fill.blip) {
        const g = { x: 0, y: 0, w: this.deck.width, h: this.deck.height, rot: 0 };
        const img = await this.picture(fill.blip, g, { ...layer, editable: false });
        return { css: null, html: img.replace('class="bx', 'class="bx bg') };
      }
      return { css: fill.none ? null : fill.css, html: '' };
    }
    return { css: null, html: '' };
  }
}

async function readSlide(pkg, deck, part, number) {
  const root = await pkg.xml(part);
  if (!root) return null;
  const rels = await pkg.rels(part);
  const layout = await loadLayout(pkg, deck, relOfType(rels, '/slideLayout')?.target);
  const master = layout?.master ?? null;
  const theme = master?.theme ?? readTheme(null);
  const clrMap = clrMapFor(root, clrMapFor(layout?.root, master?.clrMap ?? DEFAULT_MAP));
  const slide = {
    number,
    layout,
    master,
    hidden: root.attrs.show === '0' || root.attrs.show === 'false',
    ctx: { theme, clrMap },
    titles: [],
    layers: {
      slide: { kind: 'slide', root, rels, editable: true },
      layout: layout && { kind: 'layout', root: layout.root, rels: layout.rels, editable: false },
      master: master && { kind: 'master', root: master.root, rels: master.rels, editable: false },
    },
  };
  const painter = new Painter({ pkg, deck, slide });
  const parts = [];
  const bg = await painter.background();
  if (bg.html) parts.push(bg.html);

  // What the master and layout draw on every slide, unless the slide or its
  // layout says not to.
  const showMaster = root.attrs.showMasterSp !== '0' && layout?.root?.attrs.showMasterSp !== '0';
  const showLayout = root.attrs.showMasterSp !== '0';
  if (showMaster && master) parts.push(await painter.tree(down(master.root, 'p:cSld', 'p:spTree'), IDENTITY, slide.layers.master));
  if (showLayout && layout) parts.push(await painter.tree(down(layout.root, 'p:cSld', 'p:spTree'), IDENTITY, slide.layers.layout));
  parts.push(await painter.tree(down(root, 'p:cSld', 'p:spTree'), IDENTITY, slide.layers.slide));

  // The speaker notes: the body placeholder of the notes page.
  let notes = '';
  const notesPart = relOfType(rels, '/notesSlide')?.target;
  const notesRoot = await pkg.xml(notesPart);
  if (notesRoot) {
    for (const sp of findAll(notesRoot, 'p:sp')) {
      if (phOf(sp)?.attrs.type !== 'body') continue;
      notes = children(pc(sp, 'txBody'), 'a:p')
        .map((p) =>
          children(p)
            .map((k) => (k.name === 'a:r' || k.name === 'a:fld' ? textOf(child(k, 'a:t')) : k.name === 'a:br' ? '\n' : ''))
            .join(''),
        )
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      break;
    }
  }

  return {
    number,
    hidden: slide.hidden,
    title: slide.titles.find(Boolean) ?? '',
    background: bg.css ?? '#ffffff',
    html: parts.filter(Boolean).join('\n'),
    notes,
  };
}

// --------------------------------------------------------------- the tables

const MEDIUM_2 = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';

function tableLooks(root, ctx, cqi) {
  const looks = new Map();
  for (const style of children(root, 'a:tblStyle')) {
    const part = (name) => {
      const el = child(style, `a:${name}`);
      if (!el) return null;
      const tcStyle = child(el, 'a:tcStyle');
      const tx = child(el, 'a:tcTxStyle');
      const fillHolder = child(tcStyle, 'a:fill');
      const fill = fillHolder ? fillIn(fillHolder, ctx) : undefined;
      return {
        fill,
        color: tx ? css(colorIn(tx, ctx)) : null,
        bold: tx ? tx.attrs.b === 'on' : null,
        tcStyle,
      };
    };
    const whole = part('wholeTbl');
    const borderLn = whole?.tcStyle ? findAll(child(whole.tcStyle, 'a:tcBdr'), 'a:ln')[0] : null;
    const borderFill = borderLn ? fillIn(borderLn, ctx) : null;
    looks.set(style.attrs.styleId, {
      wholeTbl: whole,
      band1H: part('band1H'),
      band2H: part('band2H'),
      firstRow: part('firstRow'),
      lastRow: part('lastRow'),
      border: borderFill?.css ? `${cqi(Number(borderLn.attrs.w ?? 12700))} solid ${borderFill.css}` : null,
    });
  }
  return looks;
}

/** PowerPoint's default table look, which a file names without describing:
 *  a header row in the first accent, rows banded in tints of it. */
function mediumStyle2(ctx, cqi) {
  const accent = (mods) => css(modify(hex(ctx.theme.colors.accent1), { kids: mods.map(([name, val]) => ({ name, attrs: { val }, kids: [] })) }));
  const light = css(hex(ctx.theme.colors[ctx.clrMap.bg1 ?? 'lt1'] ?? 'FFFFFF'));
  return {
    wholeTbl: { fill: { css: accent([['a:tint', '20000']]) }, color: null, bold: false },
    band1H: { fill: { css: accent([['a:tint', '40000']]) } },
    band2H: null,
    firstRow: { fill: { css: accent([]) }, color: light, bold: true },
    lastRow: { fill: { css: accent([]) }, color: light, bold: true },
    border: `${cqi(12700)} solid ${light}`,
  };
}

// ------------------------------------------------------------------ the deck

const MISSING_WORDS = {
  chart: ['the chart', 'the charts'],
  diagram: ['the SmartArt', 'the SmartArt'],
  object: ['an embedded object', 'embedded objects'],
  picture: ['a picture in a format browsers can’t show', 'pictures in a format browsers can’t show'],
  sound: ['the sound', 'the sound'],
  video: ['the video', 'the videos'],
  ink: ['the ink', 'the ink'],
};

const listOf = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** The deck's first line: where it came from, and what it could not bring. */
export function ledeFor({ fileName, missing, hidden }) {
  const lines = [`Made from ${fileName}.`];
  if (missing.length) {
    const parts = missing.map(({ kind, slides }) => {
      const [one, many] = MISSING_WORDS[kind] ?? ['something', 'some things'];
      return `${slides.length > 1 ? many : one} on ${slides.length > 1 ? 'slides' : 'slide'} ${listOf(slides.map(String))}`;
    });
    lines.push(`Not brought over: ${listOf(parts)}.`);
  }
  if (hidden.length) {
    lines.push(`${hidden.length > 1 ? 'Slides' : 'Slide'} ${listOf(hidden.map(String))} ${hidden.length > 1 ? 'were' : 'was'} hidden in PowerPoint.`);
  }
  return lines.join(' ');
}

/**
 * `input` is the .pptx: a path on this disk or its bytes. `starter` is the
 * Slides starter, already built with its title and ids. `putBlob(bytes,
 * type)` answers with the attributes a picture or a clip carries its bytes in
 * (a blob reference, or a data URL); without one, everything is inlined.
 */
export async function pptxToDeck(input, { starter, fileName = 'the PowerPoint', putBlob = null, newId = newIdDefault } = {}) {
  const inline = (bytes, type) => `src="data:${type};base64,${bytes.toString('base64')}"`;
  const put = putBlob ?? inline;
  const pkg = await openPackage(input);
  try {
    const presPart = relOfType(await pkg.rels(''), '/officeDocument')?.target ?? 'ppt/presentation.xml';
    const pres = await pkg.xml(presPart);
    if (!pres || pres.name !== 'p:presentation') throw Object.assign(new Error('not a PowerPoint file'), { status: 400 });
    const presRels = await pkg.rels(presPart);
    const size = child(pres, 'p:sldSz')?.attrs ?? {};
    const width = Number(size.cx ?? DEFAULT_W) || DEFAULT_W;
    const height = Number(size.cy ?? DEFAULT_H) || DEFAULT_H;

    const images = new Map();
    const missing = new Map();
    const deck = {
      width,
      height,
      newId,
      masters: new Map(),
      layouts: new Map(),
      defaultText: child(pres, 'p:defaultTextStyle'),
      cqi: (emu) => `${n((emu / width) * 100)}cqi`,
      miss(kind, slide) {
        if (!missing.has(kind)) missing.set(kind, new Set());
        missing.get(kind).add(slide);
      },
      // One read and one blob per picture, however many slides show it.
      image(pk, part, onMissing) {
        if (!images.has(part)) {
          images.set(
            part,
            (async () => {
              if (!pk.zip.has(part) || pk.zip.size(part) > IMAGE_LIMIT) return null;
              const bytes = await pk.zip.read(part, { limit: IMAGE_LIMIT });
              const type = sniff(bytes, part);
              if (!type) return null;
              return put(bytes, type);
            })().catch(() => null),
          );
        }
        return images.get(part).then((src) => {
          if (!src) onMissing();
          return src;
        });
      },
      media(pk, part) {
        const key = `media:${part}`;
        if (!images.has(key)) {
          images.set(
            key,
            (async () => {
              const type = MEDIA_TYPES[posix.extname(part).slice(1).toLowerCase()];
              if (!type || !pk.zip.has(part) || pk.zip.size(part) > MEDIA_LIMIT) return null;
              return put(await pk.zip.read(part, { limit: MEDIA_LIMIT }), type);
            })().catch(() => null),
          );
        }
        return images.get(key);
      },
      looks: null,
      tableStyle(id, ctx) {
        const looks = this.looks ?? new Map();
        const found = id ? looks.get(id) : null;
        if (found) return found;
        if (!id || id === MEDIUM_2) return mediumStyle2(ctx, this.cqi);
        return { wholeTbl: null, border: `${this.cqi(12700)} solid ${css(hex(ctx.theme.colors.dk1 ?? '000000'))}` };
      },
    };

    const tableRel = relOfType(presRels, '/tableStyles');
    const order = children(child(pres, 'p:sldIdLst'), 'p:sldId')
      .map((s) => presRels.get(s.attrs['r:id'])?.target)
      .filter(Boolean);

    const slides = [];
    for (const [i, part] of order.entries()) {
      if (i === 0 && tableRel) {
        // Table looks are coloured by the theme of the slide they sit on; the
        // first slide's is the deck's in every file worth worrying about.
        const firstRels = await pkg.rels(part);
        const layout = await loadLayout(pkg, deck, relOfType(firstRels, '/slideLayout')?.target);
        const ctx = { theme: layout?.master?.theme ?? readTheme(null), clrMap: layout?.master?.clrMap ?? DEFAULT_MAP };
        deck.looks = tableLooks(await pkg.xml(tableRel.target), ctx, deck.cqi);
      }
      const slide = await readSlide(pkg, deck, part, i + 1);
      if (slide) slides.push(slide);
    }

    const missingList = [...missing.entries()].map(([kind, set]) => ({ kind, slides: [...set].sort((a, b) => a - b) }));
    const hidden = slides.filter((s) => s.hidden).map((s) => s.number);
    const source = renderDeck(starter, {
      width,
      height,
      slides,
      newId,
      lede: ledeFor({ fileName, missing: missingList, hidden }),
    });
    return { source, slides: slides.length, missing: missingList, hidden };
  } finally {
    await pkg.close().catch(() => {});
  }
}

const NOTES_PH = 'Speaker notes — for you, not the room';

function renderDeck(starter, { width, height, slides, newId, lede }) {
  const ratio = width / height;
  const items = slides
    .map((s) =>
      [
        `    <li class="slide" data-marble-id="${newId()}" data-marble-removable>`,
        `      <div class="frame"><div class="face placed" style="background:${escAttr(s.background)}">`,
        s.html,
        '      </div></div>',
        `      <p class="notes" data-marble-id="${newId()}" data-marble-editable data-ph="${NOTES_PH}">${escText(s.notes)}</p>`,
        '    </li>',
      ]
        .filter((line) => line !== '')
        .join('\n'),
    )
    .join('\n');

  const list = /(<ol class="slides"[^>]*?)(>)[\s\S]*?(<\/ol>)/;
  if (!list.test(starter)) throw new Error('the Slides starter has no slide list');
  const shape = Math.abs(ratio - 16 / 9) > 0.01 ? ` style="--ratio: ${n(ratio)}"` : '';
  return starter
    .replace(list, (_, open, close, end) => `${open}${shape}${close}\n${items}\n  ${end}`)
    .replace(/(<p class="lede"[^>]*>)[\s\S]*?(<\/p>)/, (_, open, end) => `${open}${escText(lede)}${end}`);
}
