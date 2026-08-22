// The path grammar.
//
// Marble's own name check refuses a slash, and that single character is the
// only reason its namespace is flat. This is that check loosened to segments
// joined by slashes — and it is deliberately its own module with no filesystem
// in it, because a path is a name in the Drive before it is anywhere on a disk.
//
// Everything a request says about where something is passes through `parsePath`
// first. There is no second place that decides whether `../` is allowed.

import path from 'node:path';

export const DOC_EXT = '.mrbl';

// Per segment, and the same shape Marble accepts for a whole flat name — so a
// document that was addressable there is addressable here, at the root.
const SEGMENT = /^[a-z0-9][a-z0-9._ -]*$/i;

// Reserved because the store keeps its own bookkeeping under the drive root and
// a document called `.marble` would be indistinguishable from it.
const RESERVED = new Set(['.marble', '.trash', '.blobs']);

const MAX_SEGMENTS = 16;
const MAX_SEGMENT = 64;

export class PathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathError';
    this.status = 400;
  }
}

/**
 * A path as the Drive understands it: no leading slash, no trailing slash, no
 * empty segment, no `.` or `..`, nothing reserved. The empty string is the root
 * folder and is legal — it is what "My Drive" is a name for.
 *
 * Returns the normalised path. Throws PathError, which the routes turn into a
 * 400, rather than returning null: every caller would have had to check, and
 * the one that forgot would be the one that reached the filesystem.
 */
export function parsePath(input, { allowRoot = true } = {}) {
  if (input === undefined || input === null) input = '';
  if (typeof input !== 'string') throw new PathError('a path has to be a string');

  // A path arrives from three places — a URL tail, a JSON body, a drag — and
  // only the first is guaranteed decoded. Trimming the slashes here means the
  // callers do not each have their own opinion about `/work/` versus `work`.
  const trimmed = input.trim().replace(/^\/+|\/+$/g, '');

  if (trimmed === '') {
    if (allowRoot) return '';
    throw new PathError('a name is required');
  }

  if (trimmed.includes('\0')) throw new PathError('a path cannot contain a null byte');
  if (trimmed.includes('\\')) throw new PathError('a path separator is /, not \\');

  const segments = trimmed.split('/');
  if (segments.length > MAX_SEGMENTS) {
    throw new PathError(`a path is at most ${MAX_SEGMENTS} folders deep`);
  }

  for (const segment of segments) {
    if (segment === '') throw new PathError('a path cannot have an empty segment');
    if (segment === '.' || segment === '..') throw new PathError(`"${segment}" is not a folder`);
    if (segment.length > MAX_SEGMENT) {
      throw new PathError(`"${segment.slice(0, 24)}…" is longer than ${MAX_SEGMENT} characters`);
    }
    if (!SEGMENT.test(segment)) throw new PathError(`"${segment}" is not a usable name`);
    // A trailing dot or space is legal in this grammar and unrepresentable on
    // Windows, and a name that round-trips on one machine and not another is a
    // sync bug waiting for G4.
    if (/[. ]$/.test(segment)) throw new PathError(`"${segment}" cannot end in a dot or a space`);
    if (RESERVED.has(segment.toLowerCase())) throw new PathError(`"${segment}" is reserved`);
  }

  return segments.join('/');
}

export const isValidPath = (input) => {
  try {
    parsePath(input, { allowRoot: false });
    return true;
  } catch {
    return false;
  }
};

/** The folder a path is in, and the last segment. `''` and the name, at the root. */
export function splitPath(docPath) {
  const at = docPath.lastIndexOf('/');
  return at < 0
    ? { parent: '', name: docPath }
    : { parent: docPath.slice(0, at), name: docPath.slice(at + 1) };
}

export const joinPath = (...parts) =>
  parts
    .filter((part) => part !== '' && part !== undefined && part !== null)
    .join('/')
    .replace(/\/+/g, '/');

/** `work/notes` is inside `work`, and inside ``. Nothing is inside itself. */
export const isInside = (docPath, folder) =>
  folder === '' ? docPath !== '' : docPath.startsWith(`${folder}/`);

/**
 * A path as one filesystem-safe token, for the places that need a flat key:
 * Marble's history index writes `<key>.history.jsonl` into one directory, and a
 * key with a slash in it would be a write into a folder nobody made. `%2F` is
 * reversible and is already what a URL would have called it.
 */
export const docKey = (docPath) => docPath.split('/').join('%2F');
export const unKey = (key) => key.split('%2F').join('/');

/**
 * Resolve a Drive path to a location under a root. The grammar above already
 * refuses `..`, and this checks the answer anyway: two independent reasons a
 * traversal cannot happen is the right number for the function that turns a
 * stranger's string into a filesystem call.
 */
export function resolveUnder(root, docPath) {
  const absolute = path.resolve(root, docPath);
  const base = path.resolve(root);
  if (absolute !== base && !absolute.startsWith(base + path.sep)) {
    throw new PathError('that path is outside the drive');
  }
  return absolute;
}

/** A path as it should read to a person: `work/q3/notes` → `Notes`. */
export const titleize = (name) =>
  name
    .replace(new RegExp(`\\${DOC_EXT}$`), '')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
