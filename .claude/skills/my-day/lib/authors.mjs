// Authors on a paper card. Clicking a name marks that person as someone Bryan
// knows; harvest folds it into state/authors.json so the next issue lights them.

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const decodeEntities = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const stripTags = (s) => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, '')).trim();

export const auSlug = (name) => String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function knownAuthorSet(known) {
  const set = new Set();
  for (const [k, v] of Object.entries(known || {})) {
    const sl = auSlug(k);
    if (sl) set.add(sl);
    if (v && v.name) {
      const named = auSlug(v.name);
      if (named) set.add(named);
    }
  }
  return set;
}

function existingRecord(known, sl) {
  if (known[sl]) return { key: sl, rec: known[sl] };
  for (const [k, v] of Object.entries(known)) {
    if (auSlug(k) === sl || auSlug(v && v.name) === sl) return { key: k, rec: v };
  }
  return null;
}

export function rAuthors(authors, known, mint) {
  const list = (Array.isArray(authors) ? authors : String(authors || '').split(/,\s*/)).map((a) => String(a).trim()).filter(Boolean);
  if (!list.length) return '';
  const chips = list.map((name) => {
    const sl = auSlug(name);
    const yes = known.has(sl);
    return `<button class="au tip" type="button" data-marble-id="${mint()}" data-au="${escAttr(sl)}"${yes ? ' data-known' : ''}` +
      ` data-tip="${escAttr(yes ? `${name}\nYou marked this one as someone you know.\nClick to unmark.` : `${name}\nClick if you know them — every paper they appear on will show it.`)}">${esc(name)}</button>`;
  }).join(', ');
  return `<div class="pau" data-marble-id="${mint()}">${chips}</div>`;
}

export function harvestKnownAuthors(html, state, { today } = {}) {
  const known = { ...(state.known || {}) };
  const seen = new Map();
  for (const m of String(html || '').matchAll(/<button\b([^>]*\bclass="au\b[^"]*"[^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = m[1];
    const sl = (/\bdata-au="([^"]*)"/.exec(attrs) || [])[1];
    if (!sl) continue;
    const name = stripTags(m[2]).trim() || sl;
    const marked = /\bdata-known\b/.test(attrs);
    const prev = seen.get(sl) || { name, marked: false };
    seen.set(sl, { name: name || prev.name, marked: prev.marked || marked });
  }
  for (const [sl, info] of seen) {
    if (!info.marked) continue;
    const existing = existingRecord(known, sl);
    const rec = existing
      ? { ...existing.rec, name: (existing.rec && existing.rec.name) || info.name }
      : { name: info.name, markedOn: today };
    if (existing && existing.key !== sl) delete known[existing.key];
    known[sl] = rec;
  }
  return { ...state, known };
}
