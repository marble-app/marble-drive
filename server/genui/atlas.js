// Space₀, indexed. The Atlas is read-only to this work: entries by id,
// sub-dimensions by key (resolved through `specializes`), and every variation
// name slugified once so a document's attribute values and the codebook agree
// on spelling without either copying the other.

import fsp from 'node:fs/promises';

export const slug = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const kebab = (key) => String(key ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export const camel = (attr) => String(attr ?? '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

export function indexAtlas(atlas) {
  const entries = new Map();
  for (const entry of atlas?.entries ?? []) if (entry?.id) entries.set(entry.id, entry);

  const own = new Map();
  const subsOf = (id) => {
    if (own.has(id)) return own.get(id);
    const out = new Map();
    const entry = entries.get(id);
    for (const dim of entry?.dims ?? []) {
      for (const sub of dim?.subs ?? []) {
        if (!sub?.key || out.has(sub.key)) continue;
        const vars = new Map();
        for (const v of sub.vars ?? []) {
          const name = Array.isArray(v) ? v[0] : v?.name;
          const gloss = Array.isArray(v) ? v[1] : v?.gloss;
          if (name) vars.set(slug(name), { name: String(name), gloss: String(gloss ?? '') });
        }
        out.set(sub.key, { entry, dim, sub, vars });
      }
    }
    own.set(id, out);
    return out;
  };

  const resolve = (id, key, seen = new Set()) => {
    if (!entries.has(id) || seen.has(id)) return null;
    seen.add(id);
    const hit = subsOf(id).get(key);
    if (hit) return hit;
    for (const parent of entries.get(id).relations?.specializes ?? []) {
      const inherited = resolve(parent, key, seen);
      if (inherited) return inherited;
    }
    return null;
  };

  return {
    has: (id) => entries.has(id),
    entry: (id) => entries.get(id) ?? null,
    sub: (id, key) => resolve(id, key),
  };
}

export async function loadAtlas(file) {
  return indexAtlas(JSON.parse(await fsp.readFile(file, 'utf8')));
}
