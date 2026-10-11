// What a change draws, in the words and the tools of the thing it changes (v6,
// Notes and Sketches/Ask at Anything, "The page draws its own tools").
//
// v5 drew every change the same way: a tint on each part and a tag counting
// them, the tag's words looked up from a short list of tags and classes
// (runtime/change-marks.js, `unitOf`). A seismogram is "Changing 4 of 5
// parts", and the tool a person would hold there (a pick on the trace, a
// cursor on the bar, a redline in the clause) is drawn nowhere. No list of
// kinds can be long enough. So an agent that knows what it is changing says
// so itself, with each batch (`apply_ops` and `fan_out` take `marks`):
//
//   - `verb` and `unit`: what the tag says it is doing, in the thing's own
//     words ("Picking", station/stations), and `measure` when the count is
//     not parts ("15 of 24 px", "2.4 of 4.0 m");
//   - `draw`: a few marks anchored to parts by id, drawn in the page's
//     transient layer and never filed: the tool where the work is now
//     (`as: now`), what is still to come in its own form (`ahead`), and what
//     was there before (`before`). Each is a shape the page already knows
//     (ring, line, dot, fill), a few words, or a path in a 100 × 100 box
//     stretched over the part.
//
// Everything here is untrusted input on its way to every tab on the page: it
// is cut to size and to a small vocabulary, an anchor must be a part of the
// document, and a path is checked again where it is drawn (the page rebuilds
// it from an allow-list; it is never set as markup).

export const MARKS_MAX = 24;      // marks drawn at once
export const SVG_MAX = 2400;      // characters of path markup in one mark
export const TEXT_MAX = 48;       // characters of words in one mark
export const VERB_MAX = 32;
export const UNIT_MAX = 24;

export const PLACES = ['over', 'above', 'below', 'start', 'end'];
export const STATES = ['now', 'ahead', 'before'];
export const SHAPES = ['ring', 'line', 'dot', 'fill'];

const oneLine = (value, max) => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

const percent = (value) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
};

// A path is shapes and their geometry, nothing that runs, loads or links.
// The page checks it again element by element; this keeps the obvious out
// of every frame.
const UNSAFE = /<\s*\/?\s*(script|style|foreignobject|iframe|object|embed|image|img|use|a|animate|set|audio|video|link|meta)\b|\bon[a-z]+\s*=|\bhref\b|\bsrc\b|url\s*\(|javascript:|data:/i;

function svgOf(value) {
  if (typeof value !== 'string') return null;
  const svg = value.trim();
  if (!svg || svg.length > SVG_MAX || UNSAFE.test(svg)) return null;
  // Children of the box, not a document of their own.
  if (/<\s*svg\b/i.test(svg)) return null;
  return svg;
}

function unitOf(value) {
  if (Array.isArray(value)) {
    const one = oneLine(value[0], UNIT_MAX);
    if (!one) return null;
    return [one, oneLine(value[1], UNIT_MAX) ?? `${one}s`];
  }
  const one = oneLine(value, UNIT_MAX);
  return one ? [one, `${one}s`] : null;
}

function measureOf(value) {
  if (!value || typeof value !== 'object') return null;
  const now = Number(value.now);
  if (!Number.isFinite(now)) return null;
  const of = Number(value.of);
  const out = { now: Math.round(now * 100) / 100 };
  if (Number.isFinite(of) && of > 0) out.of = Math.round(of * 100) / 100;
  const unit = oneLine(value.unit, 12);
  if (unit) out.unit = unit;
  return out;
}

function markOf(value, has) {
  if (!value || typeof value !== 'object') return null;
  const at = typeof value.at === 'string' ? value.at.trim() : '';
  if (!at || !has(at)) return null;
  const mark = {
    at,
    on: PLACES.includes(value.on) ? value.on : 'over',
    as: STATES.includes(value.as) ? value.as : 'now',
  };
  const key = oneLine(value.key, 24);
  if (key) mark.key = key;
  if (SHAPES.includes(value.shape)) mark.shape = value.shape;
  const text = oneLine(value.text, TEXT_MAX);
  if (text) mark.text = text;
  const svg = svgOf(value.svg);
  if (svg) mark.svg = svg;
  const x = percent(value.x);
  const y = percent(value.y);
  if (x !== null) mark.x = x;
  if (y !== null) mark.y = y;
  // A mark with nothing to draw is nothing.
  if (!mark.shape && !mark.text && !mark.svg) return null;
  return mark;
}

/**
 * The marks an agent gave with a batch, cut to what the page will draw, or
 * null when there is nothing in them. `has(id)` says whether an id names a
 * part of the document (or one this batch puts in): a mark on anything else
 * is dropped. `draw` is kept as given, even empty: an empty list takes the
 * last marks away, and no list leaves them as they are.
 */
export function marksOf(value, { has = () => true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  const verb = oneLine(value.verb, VERB_MAX);
  if (verb) out.verb = verb.charAt(0).toUpperCase() + verb.slice(1);
  const unit = unitOf(value.unit);
  if (unit) out.unit = unit;
  const measure = measureOf(value.measure);
  if (measure) out.measure = measure;
  if (Array.isArray(value.draw)) {
    out.draw = value.draw.slice(0, MARKS_MAX * 2).map((mark) => markOf(mark, has)).filter(Boolean).slice(0, MARKS_MAX);
  }
  return Object.keys(out).length ? out : null;
}

/** A turn's marks so far, with a batch's laid over them: words given again
 *  replace the old ones, a `draw` given replaces the last one whole. */
export function mergeMarks(prior, next) {
  if (!next) return prior ?? null;
  if (!prior) return next;
  return { ...prior, ...next };
}

/** The marks as someone holding a share link is sent them: where and how
 *  far, never the words (the verb and each mark's text). */
export function marksForVisitor(marks) {
  if (!marks || typeof marks !== 'object') return marks;
  const { verb: _verb, draw, ...rest } = marks;
  if (Array.isArray(draw)) rest.draw = draw.map(({ text: _text, ...mark }) => mark).filter((mark) => mark.shape || mark.svg);
  return rest;
}

/** The ids a batch's marks stand on: a frame names them so a tab that opens
 *  mid-change is caught up with them. */
export const anchorsOf = (marks) => (Array.isArray(marks?.draw) ? [...new Set(marks.draw.map((mark) => mark.at))] : []);
