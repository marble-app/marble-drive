// A picture of a file the page cannot draw for itself. The first page of a PDF,
// a slide deck, a HEIC photo off a phone, an SVG drawn to pixels so its script
// never runs: the browser can render none of these into a tile, and the system
// this host runs on already can. So the host asks it — QuickLook on a Mac, the
// same thumbnailer Finder uses — and keeps the answer.
//
// Nothing here is required. A host that is not on a Mac, or a file QuickLook
// has no picture for, answers `null`, and the page draws the file's own glyph
// instead. A thumbnail is a nicety that is never the only way to see a file.
//
// Songs are deliberately left to the page. QuickLook's picture of an mp3 with
// no artwork is a grey note, and the page can do better from the bytes: the
// waveform, and the cover when the file carries one.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

// What is worth asking about. Pictures the browser *can* draw are on the list
// too, because a 14 MB photo is a lot to load into a tile two hundred pixels
// wide; the page falls back to the file itself if this says no.
export const THUMB_EXTS = new Set([
  'pdf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico',
  'heic', 'heif', 'tif', 'tiff', 'svg', 'psd', 'eps', 'ai',
  'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf',
  'mp4', 'm4v', 'mov', 'webm',
  'doc', 'docx', 'rtf', 'pages', 'odt',
  'ppt', 'pptx', 'key', 'odp',
  'xls', 'xlsx', 'numbers', 'ods',
  'epub',
]);

// Three sizes rather than whatever a tile asked for, so a window dragged a
// pixel wider does not make every picture again.
const SIZES = [320, 640, 1280];
export const thumbSize = (want) => SIZES.find((s) => s >= (Number(want) || 0)) ?? SIZES[SIZES.length - 1];

function quicklook(file, size, outDir, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile('qlmanage', ['-t', '-s', String(size), '-o', outDir, file], { timeout }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * `dir` is where pictures are kept; `make` is swappable so a test can stand in
 * for QuickLook on a machine without it.
 */
export function createThumbs({ dir, platform = process.platform, make = quicklook, most = 2 } = {}) {
  const able = platform === 'darwin' || make !== quicklook;
  const inflight = new Map();
  let running = 0;
  const queue = [];

  // At most `most` at once. A folder of forty photos opening is forty asks,
  // and forty QuickLook processes at once is the machine, not the page.
  const slot = () =>
    new Promise((resolve) => {
      if (running < most) {
        running += 1;
        resolve();
      } else queue.push(resolve);
    });
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else running -= 1;
  };

  async function render(file, size, out) {
    await fsp.mkdir(dir, { recursive: true });
    const work = await fsp.mkdtemp(path.join(dir, '.work-'));
    try {
      await slot();
      let ok;
      try {
        ok = await make(file.at, size, work);
      } finally {
        release();
      }
      if (!ok) return null;
      // QuickLook names its answer after the file, plus `.png`.
      const made = path.join(work, path.basename(file.at) + '.png');
      const info = await fsp.stat(made).catch(() => null);
      if (!info || !info.size) return null;
      await fsp.rename(made, out);
      return out;
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }
  }

  /** The path of a PNG picturing `file` (a `store.readRaw` answer), or null. */
  async function get(file, want) {
    if (!able || !THUMB_EXTS.has(file.ext)) return null;
    const size = thumbSize(want);
    // Named for the version of the file, not the file: an edited PDF is a new
    // picture, and the old one is simply never asked for again.
    const key = crypto
      .createHash('sha1')
      .update(`${file.path}\n${file.modified}\n${file.bytes}\n${size}`)
      .digest('hex');
    const out = path.join(dir, key + '.png');
    if (await fsp.stat(out).then(() => true, () => false)) return out;
    if (!inflight.has(key)) {
      inflight.set(
        key,
        render(file, size, out)
          .catch(() => null)
          .finally(() => inflight.delete(key)),
      );
    }
    return inflight.get(key);
  }

  return { get, able };
}
