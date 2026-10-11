// worker/src/door/names.js
// What a drive may be called: `<name>.marbledrive.app`. Public, in the way a
// GitHub username is, so the rules are said in words where the name is typed.

// The addresses the service itself uses, or may.
export const RESERVED = new Set(['www', 'app', 'api', 'docs', 'status', 'admin', 'mail', 'auth', 'account', 'join', 'enter', 'door', 'help']);
// The testers' drives, kept for them until a claim invite hands each over.
export const KEPT_FOR_CLAIM = new Set(['bryan', 'tbryan', 'irene', 'sam', 'sangho', 'peiling']);
// Tunnels (mac-, pc-) and sprites (t-, d-) have names of this shape. A spare
// drive's sprite is d-spare-<hex> (server/provisioner.js), so a drive named
// spare-<anything> would have its sprite's name.
const MACHINE_PREFIX = /^(mac|pc|t|d|spare)-/;

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
  if (MACHINE_PREFIX.test(name)) return 'Names starting with mac-, pc-, t-, d- or spare- are kept for machines.';
  if (RESERVED.has(name)) return 'That name is kept for Marble Drive itself.';
  if (!claiming && KEPT_FOR_CLAIM.has(name)) return `${name} is taken.`;
  if (!NAME_RE.test(name)) return 'That name can’t be used.';
  return null;
}

/** Names to offer someone from what Google or GitHub calls them, best first,
 *  each one nameProblem accepts. "Ana Lima" gives ana, ana-lima, analima,
 *  then the email's own part, then ana2 to ana9. Whether each is free is the
 *  Directory's to say. */
export function nameSuggestions(fullName = '', email = '') {
  const fold = (s) =>
    String(s ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const words = fold(fullName).split('-').filter(Boolean);
  const local = fold(String(email ?? '').split('@')[0]);
  const out = [];
  const add = (n) => {
    const name = n.slice(0, 30).replace(/-+$/, '');
    if (!nameProblem(name) && !out.includes(name)) out.push(name);
  };
  if (words.length) {
    add(words[0]);
    if (words.length > 1) {
      const last = words.at(-1);
      add(`${words[0]}-${last}`);
      add(`${words[0]}${last}`);
    }
  }
  if (local) add(local);
  const base = (out[0] ?? words[0] ?? local ?? '').slice(0, 28).replace(/-+$/, '');
  if (base) for (let i = 2; i <= 9; i += 1) add(`${base}${i}`);
  return out;
}
