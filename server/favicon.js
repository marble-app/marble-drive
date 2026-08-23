// The mark.
//
// A marble: a sphere with one ribbon through it and a highlight where the light
// lands. Two versions of the same object, because there are two kinds of page
// here and a tab strip should say which is which —
//
//   the marble, bare        a document. Anything you made or dropped in.
//   the marble, in a tile   the Drive. The interface, the thing that holds them.
//
// It is drawn at 32 and lives at 16, so everything in it is one of three shapes:
// the circle, the ribbon, the highlight. A wordmark, a letter, or a fifth colour
// would be gone by the time it is a favicon.
//
// The colours are the design system's dusty blue — the same one every starter
// accents with — and they are written into the mark rather than left to the
// page, so a document opened from a file:// URL with no host at all still has
// its icon. That is also why this ships as a data URI in the document's own
// head instead of a `/favicon.svg` the document would have to ask a host for:
// a .mrbl is one file, and one file includes the thing in the tab.

const INK = '%23738698'; // --accent-ink, the blue the whole system accents with
const TILE_TOP = '%237e91a3'; // the tile, lit from the same corner as the sphere
const TILE_LOW = '%235f7385';
const RIM = '%235b7083'; // the shaded edge of the sphere
const MID = '%238fa8bd';
const LIT = '%23c6d6e3'; // where the light lands
const PEARL = '%23e9eef3'; // the marble, seen against the tile

// One cubic that enters low on the left and leaves high on the right, stroked
// fat and clipped to the sphere: at 16px it stops being a line and becomes the
// swirl inside the glass, which is the whole difference between a marble and a
// dot.
const RIBBON = 'M4 21C10 12 18 21 28 10';

/** A document. The marble, on nothing. */
export const MARBLE =
  `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E` +
  `%3Cdefs%3E` +
  `%3CradialGradient id='m' cx='.36' cy='.3' r='.8'%3E` +
  `%3Cstop offset='0' stop-color='${LIT}'/%3E` +
  `%3Cstop offset='.55' stop-color='${MID}'/%3E` +
  `%3Cstop offset='1' stop-color='${RIM}'/%3E` +
  `%3C/radialGradient%3E` +
  `%3CclipPath id='g'%3E%3Ccircle cx='16' cy='16' r='13'/%3E%3C/clipPath%3E` +
  `%3C/defs%3E` +
  `%3Ccircle cx='16' cy='16' r='13' fill='url(%23m)'/%3E` +
  `%3Cpath d='${RIBBON}' fill='none' stroke='%23fff' stroke-opacity='.42' stroke-width='3.4' stroke-linecap='round' clip-path='url(%23g)'/%3E` +
  `%3Cellipse cx='11.4' cy='10.6' rx='3.7' ry='2.5' fill='%23fff' fill-opacity='.8' transform='rotate(-32 11.4 10.6)'/%3E` +
  `%3C/svg%3E`;

/** The Drive. The same marble, set in the tile the topbar already wears. */
export const DRIVE =
  `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E` +
  `%3Cdefs%3E` +
  `%3CradialGradient id='m' cx='.36' cy='.3' r='.8'%3E` +
  `%3Cstop offset='0' stop-color='%23fff'/%3E` +
  `%3Cstop offset='1' stop-color='${PEARL}'/%3E` +
  `%3C/radialGradient%3E` +
  `%3ClinearGradient id='t' x1='0' y1='0' x2='0' y2='1'%3E` +
  `%3Cstop offset='0' stop-color='${TILE_TOP}'/%3E` +
  `%3Cstop offset='1' stop-color='${TILE_LOW}'/%3E` +
  `%3C/linearGradient%3E` +
  `%3CclipPath id='g'%3E%3Ccircle cx='16' cy='16' r='9'/%3E%3C/clipPath%3E` +
  `%3C/defs%3E` +
  `%3Crect width='32' height='32' rx='7.5' fill='url(%23t)'/%3E` +
  `%3Ccircle cx='16' cy='16' r='9' fill='url(%23m)'/%3E` +
  `%3Cpath d='M6 20C10 14 16 20 24 12' fill='none' stroke='${INK}' stroke-opacity='.5' stroke-width='2.6' stroke-linecap='round' clip-path='url(%23g)'/%3E` +
  `%3C/svg%3E`;

const SVG = { doc: MARBLE, drive: DRIVE };

/** The mark as SVG source — what the host serves, and what a designer opens. */
export const svg = (kind = 'doc') => decodeURIComponent(SVG[kind] ?? MARBLE);

/** The mark as a data URI. Percent-encoded only where a URI needs it, so the
 *  bytes in the file are still the drawing rather than base64 of it. */
export const dataUri = (kind = 'doc') => `data:image/svg+xml,${SVG[kind] ?? MARBLE}`;

/** The one line a document carries in its head. Around 700 bytes, which is
 *  cheaper than the request it replaces and survives being downloaded. */
export const link = (kind = 'doc') => `<link rel="icon" href="${dataUri(kind)}">`;

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
