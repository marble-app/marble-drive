// Files a shared page may read from the folders beside it.
//
// A share link opens one page and nothing of the drive around it
// (server/shares.js). Some pages are views over files: a lab bench that
// draws runs from JSON beside it, a gallery of the apps those runs built,
// screenshots in a folder next door. Shared, such a page loads and draws
// nothing, because every `/drive/file` it asks for is the drive's.
//
// So a page can say which folders go with it, on its root element:
//
//   <html data-marble-share-files="results, kb/builds">
//
// Each entry is a folder relative to the page's own folder, never above it
// (no `..`, no leading `/`); entries are separated by commas. Anyone holding a
// link to the page that can read it may then GET `/drive/file` for any file
// inside those folders, and nothing else. Dot-folders stay unreachable, as
// they are for the owner (server/paths.js).
//
// Only the `<html>` start tag counts. It comes before any text, so typing in
// an editable cannot spell the attribute where it is read, and
// server/share-policy.js refuses the attribute in any op from a link, so a
// link that may modify the page cannot widen what it reads.

import { parsePath } from './paths.js';

export const SHARE_FILES_ATTR = 'data-marble-share-files';

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'", '#34': '"' };
const decode = (value) => value.replace(/&(amp|quot|apos|lt|gt|#39|#34);/g, (_, e) => ENTITIES[e]);

/** The attributes on a document's `<html>` start tag, lower-cased names to
 *  decoded values. Empty when the file does not open with one. */
export function rootAttributes(source) {
  const attrs = new Map();
  const head = /^﻿?(?:\s+|<!--[\s\S]*?-->|<![^>]*>)*<html(?=[\t\n\f\r />])/i.exec(String(source ?? ''));
  if (!head) return attrs;
  const s = source;
  const space = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';
  let i = head[0].length;
  while (i < s.length) {
    while (i < s.length && (space(s[i]) || s[i] === '/')) i += 1;
    if (i >= s.length || s[i] === '>') break;
    // An `=` first is part of the name, as the HTML tokenizer has it.
    let name = s[i];
    i += 1;
    while (i < s.length && !space(s[i]) && s[i] !== '/' && s[i] !== '>' && s[i] !== '=') name += s[i++];
    while (i < s.length && space(s[i])) i += 1;
    let value = '';
    if (s[i] === '=') {
      i += 1;
      while (i < s.length && space(s[i])) i += 1;
      const quote = s[i] === '"' || s[i] === "'" ? s[i] : null;
      if (quote) {
        const end = s.indexOf(quote, i + 1);
        if (end < 0) break;
        value = s.slice(i + 1, end);
        i = end + 1;
      } else {
        const start = i;
        while (i < s.length && !space(s[i]) && s[i] !== '>') i += 1;
        value = s.slice(start, i);
      }
    }
    const key = name.toLowerCase();
    // The first of a repeated attribute wins, as it does in the browser.
    if (!attrs.has(key)) attrs.set(key, decode(value));
  }
  return attrs;
}

/** The folders, from the drive root, whose files a link to `docPath` may
 *  read. Entries that are not a usable path below the page's folder are
 *  dropped rather than trusted. */
export function sharedFolders(docPath, source) {
  const raw = rootAttributes(source).get(SHARE_FILES_ATTR);
  if (!raw) return [];
  const slash = docPath.lastIndexOf('/');
  const folder = slash < 0 ? '' : docPath.slice(0, slash);
  const out = [];
  for (const part of raw.split(',')) {
    if (!part.trim() || part.trim().startsWith('/')) continue;
    try {
      const rel = parsePath(part, { allowRoot: false });
      out.push(folder ? `${folder}/${rel}` : rel);
    } catch {
      // Not a path: ignored, never widened.
    }
  }
  return out;
}

/** Is the drive path `file` inside one of `folders`? */
export function insideShared(file, folders) {
  return folders.some((f) => file.startsWith(`${f}/`));
}
