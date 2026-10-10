// worker/src/door/names.js
// What a drive may be called: `<name>.marbledrive.app`. Public, in the way a
// GitHub username is, so the rules are said in words where the name is typed.

// The addresses the service itself uses, or may.
export const RESERVED = new Set(['www', 'app', 'api', 'docs', 'status', 'admin', 'mail', 'auth', 'account', 'join', 'enter', 'door', 'help']);
// The testers' drives, kept for them until a claim invite hands each over.
export const KEPT_FOR_CLAIM = new Set(['bryan', 'tbryan', 'irene', 'sam', 'sangho', 'peiling']);
// Tunnels (mac-, pc-) and sprites (t-, d-) have names of this shape.
const MACHINE_PREFIX = /^(mac|pc|t|d)-/;

export const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** What is wrong with a name, in words, or null when it is a good one.
 *  `claiming` lets a claim invite hand over a name kept for a tester. */
export function nameProblem(name, { claiming = false } = {}) {
  if (typeof name !== 'string' || name === '') return 'Give your drive a name.';
  if (name.length < 3) return 'A name is at least 3 characters.';
  if (name.length > 30) return 'A name is at most 30 characters.';
  if (!/^[a-z0-9-]+$/.test(name)) return 'Use only lowercase letters, digits and hyphens.';
  if (name.startsWith('-') || name.endsWith('-')) return 'A name can’t start or end with a hyphen.';
  if (name.includes('--')) return 'A name can’t have two hyphens in a row.';
  if (MACHINE_PREFIX.test(name)) return 'Names starting with mac-, pc-, t- or d- are kept for machines.';
  if (RESERVED.has(name)) return 'That name is kept for Marble Drive itself.';
  if (!claiming && KEPT_FOR_CLAIM.has(name)) return `${name} is taken.`;
  if (!NAME_RE.test(name)) return 'That name can’t be used.';
  return null;
}
