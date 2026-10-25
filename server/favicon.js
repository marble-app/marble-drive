// The mark.
//
// A marble, flat: a disc, one ribbon through it, and a dot where the light
// lands. It was a glass sphere until this — a radial gradient, a ribbon at 42%
// white, a highlight — and in a tab strip that read as a bead rather than a
// mark, drawn in a material none of the drive's own pages use. They are paper,
// ink and one dusty blue, and the tab that opens one is drawn the same way.
// Two versions of the same object, because there are two kinds of page here
// and a tab strip should say which is which —
//
//   the marble, bare        a document. Anything you made or dropped in.
//   the marble, in a tile   the Drive. The interface, the thing that holds them.
//
// and a third, which is not one drawing but a family of them: a new app's own.
// A drive that keeps a Favicon Studio has a space of marks, and each document
// made from a starter gets one point in it, drawn from its path
// (server/favicon-space.js). Siblings rather than strangers: the space says
// what they share and how far apart they may be. A drive without one draws
// from the family every drive starts with (DEFAULTS); a studio with no space
// in use makes the bare marble.
//
// It is drawn at 32 and lives at 16, so everything in it is one of three
// shapes: the disc, the ribbon, the dot. The colours are written into the mark
// rather than left to the page, so a document opened from a file:// URL with
// no host at all still has its icon. That is also why this ships as a data URI
// in the document's own head instead of a `/favicon.svg` the document would
// have to ask a host for: a .mrbl is one file, and one file includes the thing
// in the tab.

import { DEFAULTS, draw, mark, tidy, uri } from './favicon-space.js';

// The marble's own point in the space: the system's dusty blue (--accent-ink
// and the Drive's "marble" folder sit either side of it), the ribbon rising to
// the right the way the glass one's did, and the light in the top left.
const HOME = {
  hue: 246, chroma: 0.048, light: 0.63, contrast: 0.24,
  angle: -27, bend: 0.48, width: 0.27, shift: 0, size: 15,
  form: 'wave', ribbon: 'tint', glint: 'dot', depth: 'none', rim: 'none', frame: 'none',
};

// A data URI's body: percent-encoded only where a URI needs it, so the bytes
// in the file are still the drawing rather than base64 of it.
const body = (svgSource) => uri(svgSource).slice('data:image/svg+xml,'.length);

/** A document. The marble, on nothing. */
export const MARBLE = body(draw(HOME));

/** The Drive. The same marble, set in the tile the topbar already wears. */
export const DRIVE = body(draw({ ...HOME, frame: 'tile' }));

// The glass marble this replaced, kept for the documents that still carry it in
// their heads, which is every document made before. Each is still the host's
// mark rather than its own: the Drive does not list it as the document's icon
// (server/store/fs-store.js), and a page that carries it is served with the
// flat one in its place (`refreshed`). The file keeps what it has until it is
// written by something that means to; serving a newer mark is not that.
const GLASS = {
  doc: "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E" +
    "%3CradialGradient id='m' cx='.36' cy='.3' r='.8'%3E%3Cstop offset='0' stop-color='%23c6d6e3'/%3E" +
    "%3Cstop offset='.55' stop-color='%238fa8bd'/%3E%3Cstop offset='1' stop-color='%235b7083'/%3E" +
    "%3C/radialGradient%3E%3CclipPath id='g'%3E%3Ccircle cx='16' cy='16' r='13'/%3E%3C/clipPath%3E%3C/defs%3E" +
    "%3Ccircle cx='16' cy='16' r='13' fill='url(%23m)'/%3E" +
    "%3Cpath d='M4 21C10 12 18 21 28 10' fill='none' stroke='%23fff' stroke-opacity='.42' stroke-width='3.4' stroke-linecap='round' clip-path='url(%23g)'/%3E" +
    "%3Cellipse cx='11.4' cy='10.6' rx='3.7' ry='2.5' fill='%23fff' fill-opacity='.8' transform='rotate(-32 11.4 10.6)'/%3E" +
    "%3C/svg%3E",
  drive: "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E" +
    "%3CradialGradient id='m' cx='.36' cy='.3' r='.8'%3E%3Cstop offset='0' stop-color='%23fff'/%3E" +
    "%3Cstop offset='1' stop-color='%23e9eef3'/%3E%3C/radialGradient%3E" +
    "%3ClinearGradient id='t' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%237e91a3'/%3E" +
    "%3Cstop offset='1' stop-color='%235f7385'/%3E%3C/linearGradient%3E%3CclipPath id='g'%3E" +
    "%3Ccircle cx='16' cy='16' r='9'/%3E%3C/clipPath%3E%3C/defs%3E" +
    "%3Crect width='32' height='32' rx='7.5' fill='url(%23t)'/%3E" +
    "%3Ccircle cx='16' cy='16' r='9' fill='url(%23m)'/%3E" +
    "%3Cpath d='M6 20C10 14 16 20 24 12' fill='none' stroke='%23738698' stroke-opacity='.5' stroke-width='2.6' stroke-linecap='round' clip-path='url(%23g)'/%3E" +
    "%3C/svg%3E",
};

const SVG = { doc: MARBLE, drive: DRIVE };

/** The mark as SVG source — what the host serves, and what a designer opens. */
export const svg = (kind = 'doc') => decodeURIComponent(SVG[kind] ?? MARBLE);

/** The mark as a data URI. */
export const dataUri = (kind = 'doc') => `data:image/svg+xml,${SVG[kind] ?? MARBLE}`;

/** The one line a document carries in its head. Under four hundred bytes,
 *  which is cheaper than the request it replaces and survives being
 *  downloaded. */
export const link = (kind = 'doc') => `<link rel="icon" href="${dataUri(kind)}">`;

/** Every mark the host has handed out as its own, now and before: what a
 *  document carries without having chosen it. */
export const HOST_MARKS = new Set([...Object.values(SVG), ...Object.values(GLASS)].map((b) => `data:image/svg+xml,${b}`));

/** A document as it should be served: the glass marble, where it still sits
 *  in the head, swapped for the flat one of the same kind. Nothing else is
 *  touched, and a mark somebody chose is never the glass marble. */
export function refreshed(source) {
  if (!source.includes(GLASS.doc) && !source.includes(GLASS.drive)) return source;
  const end = source.search(/<\/head>/i);
  const cut = end < 0 ? Math.min(source.length, 65536) : end;
  let head = source.slice(0, cut);
  for (const kind of ['doc', 'drive']) {
    head = head.replaceAll(`href="data:image/svg+xml,${GLASS[kind]}"`, () => `href="${dataUri(kind)}"`);
  }
  return head + source.slice(cut);
}

// ---------------------------------------------------------- a drive's space

/** Where a drive keeps its space: a page that says so in its head. */
export const SPACE_META = /<meta\s+name=["']marble-favicons["']/i;

const attrsOf = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
};

/**
 * The space new apps are drawn from, as a studio page writes it, or null.
 *
 * The page holds its spaces as JSON scripts inside the element marked
 * `data-favicon-spaces`, and that element's `data-use` names the one in use
 * by its id. Read with patterns rather than a parser because that is all of
 * the page this needs, and an attribute may sit anywhere in its tag: the
 * host's own merge moves them.
 */
export function spaceIn(source) {
  if (!SPACE_META.test(source.slice(0, 65536))) return null;
  const holder = /<[a-z][\w-]*\s[^>]*\bdata-favicon-spaces\b[^>]*>/i.exec(source);
  const use = holder ? attrsOf(holder[0])['data-use'] ?? '' : '';
  if (!use) return null;
  for (const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = attrsOf(m[1]);
    if (attrs.type !== 'application/json' || attrs['data-marble-id'] !== use) continue;
    try {
      return tidy(JSON.parse(m[2]));
    } catch {
      return null;
    }
  }
  return null;
}

/** A new document's own mark, drawn from a space at its path. */
export const linkFor = (space, seed) => `<link rel="icon" href="${uri(mark(space, seed))}">`;

/**
 * The mark a document about to be made at `docPath` starts with: its own
 * point in the drive's space when the drive keeps one, else its point in the
 * family every drive starts with. A studio that has no space in use is a
 * choice too, and it makes the bare marble.
 *
 * The studio is found by what it says about itself, not by its name, so it can
 * be renamed or filed in a folder. If there are two, the one changed last is
 * the one somebody is tuning.
 */
export async function markFor(store, docPath) {
  let entries = [];
  try {
    entries = await store.list({ recursive: true });
  } catch {
    return linkFor(DEFAULTS, docPath);
  }
  let studios = 0;
  for (const entry of entries) {
    if (entry.kind !== 'doc' || !entry.favicons) continue;
    studios += 1;
    const space = spaceIn((await store.read(entry.path)) ?? '');
    if (space) return linkFor(space, docPath);
  }
  return studios ? link('doc') : linkFor(DEFAULTS, docPath);
}

// ------------------------------------------------------------ old documents

// `rel` is a list, so "shortcut icon" and "apple-touch-icon" both count: the
// question this answers is whether the document already says what its tab looks
// like, not whether it says it the way this repo would.
const HAS_ICON = /<link[^>]*\brel=["']?[^"'>]*\bicon\b/i;

/** The mark, put into a document that has none — for the ones already in a
 *  drive when this shipped. It is one line into the head and nothing else, and
 *  a document that already names an icon is left exactly as it is: a mark
 *  somebody chose beats the one that came with the host. */
export function stamp(source, kind = 'doc') {
  if (HAS_ICON.test(source)) return source;
  const tag = link(kind);
  // After the title, which is where a head this repo writes keeps it, and where
  // anyone reading the file expects the tab's other half to be.
  if (/<\/title>/i.test(source)) return source.replace(/<\/title>/i, (m) => `${m}\n${tag}`);
  if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`);
  if (/<html[^>]*>/i.test(source)) return source.replace(/<html[^>]*>/i, (m) => `${m}\n${tag}`);
  return `${tag}\n${source}`;
}

/** Does this document already have a tab icon of its own? */
export const stamped = (source) => HAS_ICON.test(source);
