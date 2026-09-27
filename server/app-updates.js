// Bringing a drive's own app pages forward.
//
// A drive's Drive, Agents, Chat and Board pages — and every note made from the
// Note starter — are documents the person owns and may have changed. A release
// that improves the template used to reach new drives only. This brings the
// improvement into the copies that already exist, the way a version-control
// merge would:
//
//   base    the version of the template the copy was built from, found in
//           templates/lineage/ (recorded in .marble/apps.json once known,
//           recognised by likeness before that)
//   ours    the copy as it is now, with whatever its owner did to it
//   theirs  the template as it ships today
//
// Only a clean merge is written, and only one that passes the document check
// with no new errors. A copy that has drifted too far from any version to trust
// the base, or where the owner and the template changed the same lines, is left
// exactly as it is and remembered as held, so it is not retried until the
// template moves again. Every write goes through the store, so the copy before
// the update is a restore point in the document's history, one click away.
//
// Off with MARBLE_DRIVE_APP_UPDATES=off (config.appUpdates === false).

import fsp from 'node:fs/promises';
import path from 'node:path';

import { examine } from './engine.js';
import { APPS, buildApp, lineage } from './app-lineage.js';
import { diffLines, mask, merge3, settleIds, splitLines } from './app-merge.js';

const MANIFEST = 'apps.json';
/** A copy missing more than this share of its base's lines is its owner's own. */
const DRIFT = 0.15;
/** How alike a document must be to a starter to count as made from it. */
const LIKENESS = 0.8;

// ------------------------------------------------------------------ manifest

export async function readManifest(marbleDir) {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(marbleDir, MANIFEST), 'utf8'));
    return { seeded: raw.seeded ?? {}, docs: raw.docs ?? {} };
  } catch {
    return { seeded: {}, docs: {} };
  }
}

export async function writeManifest(marbleDir, manifest) {
  const file = path.join(marbleDir, MANIFEST);
  await fsp.mkdir(marbleDir, { recursive: true });
  await fsp.writeFile(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  await fsp.rename(`${file}.tmp`, file);
}

// ------------------------------------------------------------------ likeness

const titleOf = (source) => /<title>([^<]*)<\/title>/.exec(source)?.[1] ?? '';

/** The affordance script a copy carries: the block the host composed, which
 *  always opens the same way. Building the base with the copy's own block is
 *  what lets a newer Marble package's script arrive as a template change. */
const SCRIPT_BLOCK = /<script>\n\(\(\) => \{\n {2}const begin = \(marble\) => \{\n {4}const TRANSIENT = 'data-marble-transient';\n[\s\S]*?\n<\/script>/;
const scriptOf = (source) => SCRIPT_BLOCK.exec(source)?.[0] ?? null;

async function buildMasked(app, source, ours) {
  const title = titleOf(ours);
  let built = await buildApp(app, source, { title });
  const own = scriptOf(ours);
  const fresh = scriptOf(built);
  if (own && fresh) built = built.replace(fresh, () => own);
  return built;
}

function multiset(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/** How much of `base` is still in `ours`, as a share of base's lines. */
function containment(baseMasked, oursCounts) {
  const left = new Map(oursCounts);
  let hits = 0;
  for (const line of baseMasked) {
    const n = left.get(line);
    if (n) { hits++; left.set(line, n - 1); }
  }
  return baseMasked.length ? hits / baseMasked.length : 0;
}

/** The version of `app` a copy is most like, and how alike. */
async function closest(app, ours, oursMasked) {
  const counts = multiset(oursMasked);
  let best = null;
  for (const version of lineage(app)) {
    const baseMasked = splitLines(await buildMasked(app, version.source, ours)).map(mask);
    const score = containment(baseMasked, counts);
    if (!best || score >= best.score) best = { version, score };
  }
  return best;
}

// ------------------------------------------------------------------- one copy

/**
 * What an update would do to one copy, without doing it.
 * → { status: 'current'|'update'|'held', reason?, text?, from?, to }
 */
export async function planCopy(app, ours, { known = null } = {}) {
  const versions = lineage(app);
  const target = versions.at(-1);
  if (!target) return { status: 'held', reason: 'no-lineage' };

  const oursLines = splitLines(ours);
  const oursMasked = oursLines.map(mask);
  let base = known ? versions.find((v) => v.id === known) : null;
  if (!base) {
    const best = await closest(app, ours, oursMasked);
    base = best?.version;
  }
  if (!base) return { status: 'held', reason: 'no-base', to: target.id };
  if (base.id === target.id) return { status: 'current', from: base.id, to: target.id };

  const baseLines = splitLines(await buildMasked(app, base.source, ours));
  const theirs = await buildApp(app, target.source, { title: titleOf(ours) });
  const theirsLines = splitLines(theirs);

  // A copy its owner has rebuilt is theirs, not the template's: the merge
  // would be guessing at a base it cannot see.
  const baseMasked = baseLines.map(mask);
  const kept = diffLines(baseMasked, oursMasked).length;
  const drift = 1 - kept / Math.max(1, baseLines.length);
  if (drift > DRIFT) return { status: 'held', reason: 'customized', drift, from: base.id, to: target.id };

  const merged = merge3(baseLines, oursLines, theirsLines);
  if (merged.conflicts.length) {
    return { status: 'held', reason: 'conflicts', conflicts: merged.conflicts.length, drift, from: base.id, to: target.id };
  }
  if (!merged.changed) return { status: 'current', from: target.id, to: target.id };

  const { text } = settleIds(merged.lines, oursLines, () => Math.random().toString(36).slice(2, 10).padEnd(8, '0'));

  // The check the Marble format keeps: nothing the merge introduced may be an
  // error that neither the copy nor the new template already had.
  const errors = (source) => new Set(examine('app.mrbl', source).filter((f) => f.level === 'error').map((f) => f.message));
  const before = new Set([...errors(ours), ...errors(theirs)]);
  const introduced = [...errors(text)].filter((message) => !before.has(message));
  if (introduced.length) return { status: 'held', reason: 'check', errors: introduced, from: base.id, to: target.id };

  return { status: 'update', text, hunks: merged.changed, drift, from: base.id, to: target.id };
}

// ---------------------------------------------------------------- every copy

/** The copies in a drive: seeded apps where the host put them, and documents
 *  made from a starter wherever they are. */
async function copiesIn(store, config, manifest) {
  const copies = new Map();
  for (const app of APPS) {
    const where = manifest.seeded[app.id] ?? app.seeded?.(config);
    if (where && (await store.has(where))) copies.set(where, app);
  }
  for (const [where, entry] of Object.entries(manifest.docs)) {
    const app = APPS.find((a) => a.id === entry.app);
    if (app && !copies.has(where) && (await store.has(where))) copies.set(where, app);
  }

  const derived = APPS.filter((app) => app.derived && lineage(app).length);
  if (!derived.length) return copies;
  for (const doc of await store.list({ recursive: true })) {
    if (doc.kind === 'folder' || copies.has(doc.path)) continue;
    if (manifest.docs[doc.path]?.app === null) continue; // looked at before, made from nothing we ship
    const source = await store.read(doc.path);
    if (!source) continue;
    const masked = splitLines(source).map(mask);
    let best = null;
    for (const app of derived) {
      const found = await closest(app, source, masked);
      if (found && found.score >= LIKENESS && (!best || found.score > best.score)) best = { app, ...found };
    }
    if (best) copies.set(doc.path, best.app);
  }
  return copies;
}

/**
 * Bring every copy in the drive forward. Returns one line per copy looked at.
 * `dryRun` plans without writing anything, the manifest included.
 */
export async function updateApps({ store, config, log = console, dryRun = false, write = null } = {}) {
  // The host's own write path when it is running (serialized with the ops on
  // the same document, and announced to its open tabs); the store's otherwise.
  const put = write ?? ((where, text, options) => store.write(where, text, options));
  const marbleDir = store.marbleDir;
  const manifest = await readManifest(marbleDir);
  const report = [];

  for (const [where, app] of await copiesIn(store, config, manifest)) {
    const entry = manifest.docs[where] ?? {};
    const target = lineage(app).at(-1);
    if (!target) continue;
    if (entry.version === target.id) continue;
    if (entry.held?.to === target.id) {
      report.push({ path: where, app: app.id, status: 'held', reason: entry.held.reason, again: true });
      continue;
    }
    const ours = await store.read(where);
    if (ours === null) continue;

    let plan;
    try {
      plan = await planCopy(app, ours, { known: entry.version });
    } catch (err) {
      plan = { status: 'held', reason: 'error', error: err.message, to: target.id };
    }
    const { text, ...line } = plan;
    report.push({ path: where, app: app.id, ...line });
    if (dryRun) continue;

    if (plan.status === 'update') {
      // Re-read at the last moment: an edit that landed while we merged wins,
      // and the update waits for the next start.
      if ((await store.read(where)) !== ours) continue;
      await put(where, text, { label: 'app-update' });
      manifest.docs[where] = { app: app.id, version: plan.to, at: new Date().toISOString() };
      log.log?.(`[apps] brought ${where} forward (${app.id} ${plan.from} → ${plan.to}, ${plan.hunks} changes)`);
    } else if (plan.status === 'current') {
      manifest.docs[where] = { app: app.id, version: plan.to, at: entry.at ?? new Date().toISOString() };
    } else {
      manifest.docs[where] = { app: app.id, version: entry.version ?? plan.from ?? null, held: { to: plan.to, reason: plan.reason, at: new Date().toISOString() } };
      log.log?.(`[apps] left ${where} as it is (${app.id}: ${plan.reason})`);
    }
  }
  if (!dryRun) await writeManifest(marbleDir, manifest);
  return report;
}
