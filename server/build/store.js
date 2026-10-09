// What Build mode keeps for a document, beside it and never in it.
//
// A mark is about the app, not the app's state: a note in the file would be an
// edit to the app, in its undo, in its diff and in every copy downloaded. So a
// document's marks, its builds and their plans are one JSON file under
// `.marble/builds/`, named by a hash of the document's path, and moved with the
// document (`move`). Checkpoints are kept here too, gzipped by content hash:
// the history log is pruned, and a build has to outlive that.
//
// One writer per document at a time (`update`), so two tabs filing marks
// together cannot lose one of them.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export const MARKS_MAX = 300;
export const BUILDS_MAX = 60;
export const PIECES_MAX = 400;
const TEXT_MAX = 4_000;
const THREAD_MAX = 40;
const POINTS_MAX = 600;
const PARTS_MAX = 24;
const IDS_MAX = 60;
const PLAN_MAX = 24;
const SNAPSHOT_HTML_MAX = 400_000;
const IMAGES_MAX = 8;
const CLIPS_MAX = 4;
const CLIP_HTML_MAX = 20_000;
export const IMAGE_NAME = /^[0-9a-f]{24}\.(png|jpg|webp|gif)$/;
export const IMAGE_BYTES_MAX = 8 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const TYPE_OF = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export const MARK_TYPES = new Set(['note', 'stroke', 'comment', 'piece']);
export const STROKE_KINDS = new Set(['box', 'arrow', 'ink']);
export const MARK_STATES = new Set(['waiting', 'building', 'built']);
export const PART_STATES = new Set(['ahead', 'now', 'done']);

export const shaOf = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const keyOf = (docPath) => crypto.createHash('sha1').update(String(docPath)).digest('hex');
export const newId = (prefix = 'm') => `${prefix}${crypto.randomBytes(5).toString('hex')}`;

const str = (value, max = TEXT_MAX) => String(value ?? '').slice(0, max);
const num = (value, lo = -4, hi = 5) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0;
};
const idOf = (value) => {
  const s = String(value ?? '').trim();
  return /^[\w:.-]{1,64}$/.test(s) ? s : null;
};
const ids = (list) => (Array.isArray(list) ? list.map(idOf).filter(Boolean).slice(0, IDS_MAX) : []);

/** A thread line, as the page or the model wrote it. */
function cleanLine(line) {
  const who = line?.who === 'agent' ? 'agent' : 'you';
  const out = { who, text: str(line?.text).trim(), at: Number(line?.at) || Date.now() };
  if (who === 'agent' && line?.offer && typeof line.offer === 'object') {
    const text = str(line.offer.text, 400).trim();
    if (text) out.offer = { text, taken: line.offer.taken === true ? true : line.offer.taken === false ? false : null };
  }
  if (line?.pending === true) out.pending = true;
  return out;
}

/**
 * A mark from the page, kept to the shape the page draws and the brief reads,
 * and nothing else: a mark is the page's own words about the app, and none of
 * it is trusted further than that.
 */
export function cleanMark(raw) {
  if (!raw || typeof raw !== 'object' || !MARK_TYPES.has(raw.type)) return null;
  const id = idOf(raw.id);
  const anchorId = idOf(raw.anchorId);
  if (!id) return null;
  const mark = {
    id,
    type: raw.type,
    anchorId,
    u: num(raw.u),
    v: num(raw.v),
    at: Number(raw.at) || Date.now(),
    state: MARK_STATES.has(raw.state) ? raw.state : 'waiting',
    build: raw.build ? str(raw.build, 16) : null,
  };
  if (raw.first === true) mark.first = true;
  if (raw.held === true) mark.held = true;
  // Put away: off the app and out of the margin's list, kept in its Archived
  // list to bring back. A built mark and a resolved comment are archived by
  // the host; anything else by its own press.
  if (raw.archived === true) mark.archived = true;
  if (raw.type === 'note') {
    mark.text = str(raw.text).trim();
    // What was pasted onto it: pictures, kept beside the builds by name, and
    // parts of pages, as their markup and their words.
    const images = (Array.isArray(raw.images) ? raw.images : []).slice(0, IMAGES_MAX)
      .filter((image) => IMAGE_NAME.test(String(image?.name ?? '')))
      .map((image) => ({ name: image.name, w: Math.round(num(image.w, 0, 10_000)), h: Math.round(num(image.h, 0, 10_000)) }));
    if (images.length) mark.images = images;
    const clips = (Array.isArray(raw.clips) ? raw.clips : []).slice(0, CLIPS_MAX)
      .map((clip) => ({ html: str(clip?.html, CLIP_HTML_MAX), text: str(clip?.text, 160).trim() }))
      .filter((clip) => clip.html.trim());
    if (clips.length) mark.clips = clips;
  }
  if (raw.type === 'stroke') {
    mark.kind = STROKE_KINDS.has(raw.kind) ? raw.kind : 'ink';
    mark.ids = ids(raw.ids);
    mark.from = idOf(raw.from);
    mark.to = idOf(raw.to);
    mark.parts = (Array.isArray(raw.parts) ? raw.parts : []).slice(0, PARTS_MAX).map((part) => ({
      pairs: (Array.isArray(part?.pairs) ? part.pairs : []).slice(0, POINTS_MAX)
        .filter((pair) => Array.isArray(pair) && pair.length === 2)
        .map(([u, v]) => [Math.round(num(u) * 1e4) / 1e4, Math.round(num(v) * 1e4) / 1e4]),
    })).filter((part) => part.pairs.length > 1);
    if (!mark.parts.length) return null;
  }
  if (raw.type === 'comment') {
    mark.thread = (Array.isArray(raw.thread) ? raw.thread : []).slice(-THREAD_MAX).map(cleanLine).filter((line) => line.text || line.pending);
    mark.resolved = raw.resolved === true;
  }
  if (raw.type === 'piece') {
    const piece = raw.piece ?? {};
    mark.piece = {
      id: str(piece.id, 64),
      title: str(piece.title, 120),
      kind: str(piece.kind, 40),
      line: str(piece.line, 200),
      source: piece.source && typeof piece.source === 'object'
        ? { path: str(piece.source.path, 400), id: idOf(piece.source.id) }
        : null,
    };
    mark.w = num(raw.w, 120, 900) || 260;
  }
  return mark;
}

/** A plan from the lead agent's build_plan call. */
export function cleanPlan(raw, prior = null) {
  const parts = (Array.isArray(raw?.parts) ? raw.parts : []).slice(0, PLAN_MAX).map((part) => ({
    title: str(part?.title, 80).trim(),
    detail: str(part?.detail, 120).trim(),
    state: PART_STATES.has(part?.state) ? part.state : 'ahead',
    ids: ids(part?.ids),
  })).filter((part) => part.title);
  const title = str(raw?.title, 80).replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const folder = str(raw?.folder, 300).trim().replace(/^\/+|\/+$/g, '');
  // The comments the build settles, by id, each with a line saying how; the
  // host resolves them when the build finishes.
  const given = Array.isArray(raw?.settled) ? raw.settled : null;
  const settled = given
    ? given.slice(0, MARKS_MAX).map((item) => (typeof item === 'string' ? { id: item } : item))
      .map((item) => ({ id: idOf(item?.id), said: str(item?.said, 400).trim() }))
      .filter((item) => item.id)
    : prior?.settled ?? [];
  return {
    parts: parts.length ? parts : prior?.parts ?? [],
    title: title || prior?.title || null,
    folder: folder || prior?.folder || null,
    settled,
  };
}

const fresh = (docPath) => ({ path: docPath, marks: [], builds: [], conversation: null, folder: null, n: 0, rev: 0 });

export function createBuildStore({ dir }) {
  const statesDir = path.join(dir, 'docs');
  const snapsDir = path.join(dir, 'snapshots');
  const piecesFile = path.join(dir, 'pieces.json');
  const queues = new Map();

  const fileOf = (docPath) => path.join(statesDir, `${keyOf(docPath)}.json`);

  async function writeAtomic(file, text) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, file);
  }

  async function read(docPath) {
    try {
      const value = JSON.parse(await fsp.readFile(fileOf(docPath), 'utf8'));
      return value && value.path === docPath ? { ...fresh(docPath), ...value } : fresh(docPath);
    } catch {
      return fresh(docPath);
    }
  }

  /** One change to a document's state, in turn with every other. `change`
   *  edits the state in place (or returns a new one) and may return a value. */
  function update(docPath, change) {
    const prior = queues.get(docPath) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(async () => {
      const state = await read(docPath);
      const result = await change(state);
      state.rev = (state.rev ?? 0) + 1;
      state.marks = state.marks.slice(-MARKS_MAX);
      state.builds = state.builds.slice(-BUILDS_MAX);
      await writeAtomic(fileOf(docPath), JSON.stringify(state));
      return { state, result };
    });
    queues.set(docPath, next);
    next.finally(() => { if (queues.get(docPath) === next) queues.delete(docPath); }).catch(() => {});
    return next;
  }

  /** Every document with build state, for the boot sweep. */
  async function all() {
    const names = await fsp.readdir(statesDir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(await fsp.readFile(path.join(statesDir, name), 'utf8'));
        if (value?.path) out.push(value);
      } catch { /* a torn file is skipped, not fatal */ }
    }
    return out;
  }

  /** The document moved: its state goes with it, under its new name. */
  async function move(from, to) {
    const state = await read(from);
    if (!state.rev) return false;
    state.path = to;
    await writeAtomic(fileOf(to), JSON.stringify(state));
    await fsp.unlink(fileOf(from)).catch(() => {});
    return true;
  }

  async function putSnapshot(source) {
    const sha = shaOf(source);
    const file = path.join(snapsDir, `${sha}.gz`);
    try {
      await fsp.access(file);
    } catch {
      await writeAtomic(file, await gzip(Buffer.from(String(source))));
    }
    return sha;
  }

  // A picture pasted onto a note, kept by what it is: the same picture twice
  // is one file.
  const imagesDir = path.join(dir, 'images');
  async function putImage(bytes, type) {
    const ext = IMAGE_TYPES[String(type ?? '').split(';')[0].trim().toLowerCase()];
    if (!ext) throw Object.assign(new Error('a note takes a PNG, JPEG, WebP or GIF picture'), { status: 415 });
    if (!bytes?.length) throw Object.assign(new Error('the picture was empty'), { status: 400 });
    const name = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.${ext}`;
    const file = path.join(imagesDir, name);
    try { await fsp.access(file); } catch { await writeAtomic(file, bytes); }
    return { name, path: file };
  }
  async function image(name) {
    if (!IMAGE_NAME.test(String(name ?? ''))) return null;
    try {
      return { bytes: await fsp.readFile(path.join(imagesDir, name)), type: TYPE_OF[name.split('.').pop()] };
    } catch {
      return null;
    }
  }
  const imagePath = (name) => (IMAGE_NAME.test(String(name ?? '')) ? path.join(imagesDir, name) : null);

  async function snapshot(sha) {
    if (!/^[0-9a-f]{64}$/.test(String(sha ?? ''))) return null;
    try {
      return (await gunzip(await fsp.readFile(path.join(snapsDir, `${sha}.gz`)))).toString('utf8');
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- pieces

  let piecesQueue = Promise.resolve();
  async function readPieces() {
    try {
      const value = JSON.parse(await fsp.readFile(piecesFile, 'utf8'));
      return Array.isArray(value?.pieces) ? value.pieces : [];
    } catch {
      return [];
    }
  }
  function updatePieces(change) {
    const next = piecesQueue.catch(() => {}).then(async () => {
      const pieces = await readPieces();
      const result = await change(pieces);
      await writeAtomic(piecesFile, JSON.stringify({ pieces: pieces.slice(-PIECES_MAX) }));
      return result;
    });
    piecesQueue = next;
    return next;
  }

  /** A saved piece, as it is kept: its source, its markup and styles as they
   *  were when saved, and a line on what it does. */
  function cleanPiece(raw) {
    return {
      id: idOf(raw?.id) ?? newId('p'),
      title: str(raw?.title, 120).trim() || 'A piece',
      kind: str(raw?.kind, 40).trim() || 'Part',
      line: str(raw?.line, 200).trim(),
      source: raw?.source ? { path: str(raw.source.path, 400), id: idOf(raw.source.id) } : null,
      html: str(raw?.html, SNAPSHOT_HTML_MAX),
      css: str(raw?.css, 120_000),
      script: str(raw?.script, 120_000),
      at: Number(raw?.at) || Date.now(),
    };
  }

  return {
    dir,
    read,
    update,
    all,
    move,
    putSnapshot,
    snapshot,
    putImage,
    image,
    imagePath,
    pieces: readPieces,
    async savePiece(raw) {
      const piece = cleanPiece(raw);
      await updatePieces((pieces) => {
        const at = pieces.findIndex((p) => p.id === piece.id);
        if (at >= 0) pieces.splice(at, 1);
        pieces.push(piece);
      });
      return piece;
    },
    async removePiece(id) {
      return updatePieces((pieces) => {
        const at = pieces.findIndex((p) => p.id === id);
        if (at < 0) return false;
        pieces.splice(at, 1);
        return true;
      });
    },
  };
}
