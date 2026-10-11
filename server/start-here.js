// Where / sends someone arriving at a new drive.
//
// A new drive is seeded with Start here (templates/start-here.mrbl,
// server/seed.js) and / opens it instead of the Drive until it is deleted or
// every row on it is ticked. Only an arrival is sent there: a visit that comes
// from one of this drive's own pages (the shell's Drive button, a link on
// Start here itself) is going to the Drive on purpose, so it gets the Drive.
// The Drive's own address (/a/<home>) always opens the Drive.

import { readManifest } from './app-updates.js';

/** Where a new drive's first page is written, and where / looks for it. */
export const START_HERE = 'start-here';

/** Whether / opens Start here before the Drive (the spec's open question,
 *  "Start here or the Drive first?", taken at its proposed default). Off, a
 *  new drive still gets the page, and / goes to the Drive as before. */
export const OPENS_FIRST = true;

/** Whether every row on a Start here page is ticked: each `data-step` row
 *  carries data-done="yes". A page with no rows left has nothing to finish. */
export function startHereDone(source) {
  const rows = [...String(source ?? '').matchAll(/<[a-z][\w-]*\b[^>]*\bdata-step="[^"]*"[^>]*>/gi)].map((m) => m[0]);
  return rows.every((tag) => /\bdata-done="yes"/.test(tag));
}

/** Whether a request to / was made from one of this drive's own documents. */
export function fromOwnPage(req) {
  const referer = req.headers?.referer;
  if (!referer) return false;
  try {
    const from = new URL(referer);
    return from.host === req.headers.host && from.pathname.startsWith('/a/');
  } catch {
    return false;
  }
}

/**
 * The Start here page / should open for this request, or null for the Drive.
 * The path comes from `.marble/apps.json`: a drive that was passed over when
 * it was seeded (it already had documents) records null and never has one.
 */
export async function startHereFor(store, req) {
  if (!OPENS_FIRST || fromOwnPage(req)) return null;
  const { seeded } = await readManifest(store.marbleDir);
  const where = Object.hasOwn(seeded, 'start-here') ? seeded['start-here'] : START_HERE;
  if (!where) return null;
  const source = await store.read(where).catch(() => null);
  if (source === null || startHereDone(source)) return null;
  return where;
}
