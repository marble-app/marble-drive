#!/usr/bin/env node
// build.mjs — the engine behind Bryan's Bulletin.
//
// This is NOT a template filler. The run (SKILL.md) *composes* the day: which
// components exist, where each sits (sticky rail vs. reading stream), how it is
// treated (card / bare / tint), and how much content it carries. This file
// renders that composition against the design system in lib/design.css, wraps it
// in shell.mrbl, and verifies the result.
//
//   readback  <file>            interaction state left in a prior issue
//   dates                       date candidates from key-dates.md + third-year.mrbl
//   assemble  --payload <p|->   compose + render the dated issue, verify
//   harvest   [file]            update state/seen.json, print saved items + votes
//   check     --file <file>     invariant self-check + layout doctor

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const REPO = path.resolve(SKILL, '..', '..', '..');
const NLDIR = path.join(REPO, 'drive', 'Newsletter');

const DEFAULTS = {
  shell: path.join(SKILL, 'shell.mrbl'),
  design: path.join(HERE, 'design.css'),
  fontCss: path.join(HERE, 'font.css'),
  dir: NLDIR,
  stable: path.join(NLDIR, 'today.mrbl'),
  keyDates: path.join(SKILL, 'key-dates.md'),
  thirdYear: path.join(REPO, 'drive', 'Travel', 'third-year.mrbl'),
  seen: path.join(SKILL, 'state', 'seen.json'),
  palettes: path.join(HERE, 'palettes.json'),
  paletteState: path.join(SKILL, 'state', 'palettes.json'),
  imagesTool: path.join(HERE, 'images.mjs'),
  layoutTool: path.join(HERE, 'layoutcheck.mjs'),
};
const IMAGE_BUDGET = 30;

// ---------------------------------------------------------------- helpers ----

const die = (msg) => { console.error(`[bulletin] ${msg}`); process.exit(1); };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const decodeEntities = (s) => String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const stripTags = (s) => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, '')).trim();
const slug = (s) => String(s ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x';

const usedIds = new Set();
function mint() { let id; do { id = crypto.randomBytes(5).toString('hex').slice(0, 8); } while (usedIds.has(id)); usedIds.add(id); return id; }

function atLocalNoon(ymd) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim()); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0) : null; }
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayYmd = () => ymdOf(new Date());
function daysUntil(ymd, fromYmd) { const a = atLocalNoon(ymd), b = atLocalNoon(fromYmd || todayYmd()); return a && b ? Math.round((a - b) / 86400000) : null; }
const humanLongUpper = (ymd) => { const d = atLocalNoon(ymd); return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase() : ''; };
const humanShort = (ymd) => { const d = atLocalNoon(ymd); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''; };
const humanShortNoDow = (ymd) => { const d = atLocalNoon(ymd); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; };
const hour12 = (h) => { const x = ((h % 24) + 24) % 24; return `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? 'am' : 'pm'}`; };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

// ------------------------------------------------------------------ icons ----

const IC_TIP = { gmail: 'Gmail', gcal: 'Google Calendar', notion: 'Notion', slack: 'Slack', github: 'GitHub', arxiv: 'arXiv', web: 'the web', meteo: 'Open-Meteo', marble: 'this drive' };
const SRC_MAP = { gmail: 'gmail', email: 'gmail', mail: 'gmail', calendar: 'gcal', gcal: 'gcal', 'google calendar': 'gcal', notion: 'notion', slack: 'slack', github: 'github', git: 'github', arxiv: 'arxiv', web: 'web', 'open-meteo': 'meteo', weather: 'meteo', drive: 'marble', 'third-year': 'marble', notes: 'marble' };
function icon(kind) {
  const k = SRC_MAP[String(kind || '').toLowerCase()] || (IC_TIP[kind] ? kind : null);
  if (!k) return '';
  return `<span class="ic-wrap" data-tip="${escAttr(IC_TIP[k])}" data-marble-id="${mint()}"><svg class="ic" aria-hidden="true"><use href="#ic-${k}"/></svg></span>`;
}
function sourceBits(meta) {
  if (!meta) return '';
  const first = String(meta).split(/[·|]/)[0].trim();
  const ic = icon(first);
  const rest = String(meta).replace(/^[^·|]*[·|]\s*/, '');
  return ic ? `${ic} <span data-marble-id="${mint()}">${esc(rest || first)}</span>` : `<span data-marble-id="${mint()}">${esc(meta)}</span>`;
}

// ------------------------------------------------------------------ flags ----

const CC = { spain: 'ES', 'united states': 'US', usa: 'US', america: 'US', greece: 'GR', russia: 'RU', belarus: 'BY', czechia: 'CZ', 'czech republic': 'CZ', italy: 'IT', serbia: 'RS', germany: 'DE', france: 'FR', 'great britain': 'GB', uk: 'GB', australia: 'AU', canada: 'CA', poland: 'PL', norway: 'NO', denmark: 'DK', switzerland: 'CH', austria: 'AT', argentina: 'AR', brazil: 'BR', japan: 'JP', china: 'CN', kazakhstan: 'KZ', bulgaria: 'BG', croatia: 'HR', netherlands: 'NL', 'south africa': 'ZA', tunisia: 'TN', ukraine: 'UA', latvia: 'LV', finland: 'FI', hungary: 'HU', romania: 'RO' };
function flag(country) {
  if (!country) return '';
  const cc = /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : CC[String(country).toLowerCase().trim()];
  return cc ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
}

// ---------------------------------------------------------------- palette ----

function hexRGB(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return [128, 128, 128]; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function popSwatch(sw) {
  let best = null, s = -1;
  for (const h of sw) {
    const [r, g, b] = hexRGB(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum < 0.32 || lum > 0.9) continue;
    const sc = (mx - mn) / 255 * 1.6 + (1 - Math.abs(lum - 0.62));
    if (sc > s) { s = sc; best = h; }
  }
  return best;
}
function pickPalette(seed, override) {
  const lib = JSON.parse(fs.readFileSync(DEFAULTS.palettes, 'utf8')).palettes;
  if (override != null) {
    const byName = lib.find((p) => p.name.toLowerCase() === String(override).toLowerCase());
    if (byName) return { pal: byName, recorded: false };
    const i = Number(override); if (Number.isInteger(i) && lib[i]) return { pal: lib[i], recorded: false };
  }
  let recent = [];
  try { recent = JSON.parse(fs.readFileSync(DEFAULTS.paletteState, 'utf8')).recent || []; } catch {}
  const avoid = new Set(recent.slice(-6));
  const pool = lib.filter((p) => !avoid.has(p.name));
  const choices = pool.length ? pool : lib;
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pal = choices[h % choices.length];
  return { pal, recorded: true, recent: [...recent, pal.name].slice(-24) };
}
const ROLE_VARS = { bg: '--bg', panel: '--panel', ink: '--ink', muted: '--muted', faint: '--faint', line: '--line', accent: '--accent', accentSoft: '--accent-soft', accentInk: '--accent-ink', warm: '--warm' };
function roleBlock(roles, sw) {
  const parts = Object.entries(ROLE_VARS).map(([k, v]) => `${v}:${roles[k]}`);
  sw.slice(0, 4).forEach((h, i) => parts.push(`--c${i + 1}:${h}`));
  parts.push(`--pop:${popSwatch(sw) || roles.warm}`);
  return parts.join(';');
}
function paletteStyle(pal) {
  const L = roleBlock(pal.light, pal.swatches), D = roleBlock(pal.dark, pal.swatches);
  return `<style id="nl-palette">\n:root{${L}}\n@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${D}}}\n:root[data-theme="dark"]{${D}}\n:root[data-theme="light"]{${L}}\n</style>`;
}

// ------------------------------------------------------------ image inline ---

let imagesInlined = 0;
const imageCache = new Map();
function inlineImage(src, width = 640) {
  if (!src) return '';
  if (src.startsWith('data:')) return src;
  if (!/^https?:\/\//i.test(src)) return '';
  const ck = `${width}|${src}`;
  if (imageCache.has(ck)) return imageCache.get(ck);
  if (imagesInlined >= IMAGE_BUDGET) return '';
  try {
    const uri = execFileSync('node', [DEFAULTS.imagesTool, src, '--width', String(width), '--quiet'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 45000 }).trim();
    if (uri.startsWith('data:')) { imagesInlined += 1; imageCache.set(ck, uri); return uri; }
  } catch {}
  imageCache.set(ck, '');
  return '';
}

// --------------------------------------------------------------- readback ----

function readback(file) {
  if (!file || !fs.existsSync(file)) return { exists: false, date: null, rows: {}, views: {} };
  const html = fs.readFileSync(file, 'utf8');
  const dateM = /<meta name="newsletter:date" content="([^"]*)">/.exec(html);
  const views = {};
  for (const m of html.matchAll(/<section\b([^>]*)>/g)) {
    const a = m[1];
    const k = /data-view-key="([^"]+)"/.exec(a); const v = /data-view="([^"]*)"/.exec(a);
    if (k && v) views[k[1]] = v[1];
  }
  const rows = {};
  const chunks = html.split(/(?=<li\b|<div class="(?:ncard|pcard|mo)[ "])/);
  for (const chunk of chunks) {
    const tagM = /^<(li|div)\b([^>]*)>/.exec(chunk);
    if (!tagM) continue;
    const attrs = tagM[2];
    const keyM = /data-key="([^"]*)"/.exec(attrs);
    if (!keyM) continue;
    const end = tagM[1] === 'li' ? '</li>' : '</div>';
    const body = chunk.slice(0, chunk.indexOf(end) + end.length);
    const noteM = /<div class="note"[^>]*>([\s\S]*?)<\/div>/.exec(body);
    const titleM = /<(?:div|h4) class="(?:title|ntitle|ptitle|mo-title)"[^>]*>([\s\S]*?)<\/(?:div|h4)>/.exec(body);
    const hrefM = titleM ? /href="([^"]*)"/.exec(titleM[1]) : null;
    const voteM = /data-vote="([^"]*)"/.exec(attrs);
    const cls = (/class="([^"]*)"/.exec(attrs) || [, ''])[1];
    rows[keyM[1]] = {
      kind: /\bncard\b|\bmo\b/.test(cls) ? 'item' : /\bpcard\b/.test(cls) ? 'arxiv' : /\btodo\b|\bfocus\b/.test(cls) ? 'todo' : /\bkeydate\b/.test(cls) ? 'keydate' : 'row',
      done: /\bdata-done\b/.test(attrs), snooze: /\bdata-snooze\b/.test(attrs), pin: /\bdata-pin\b/.test(attrs),
      open: /\bdata-open\b/.test(attrs), vote: voteM ? voteM[1] : null, saved: /\bdata-saved\b/.test(attrs),
      note: noteM ? stripTags(noteM[1]) : '', title: titleM ? stripTags(titleM[1]) : '',
      url: hrefM ? decodeEntities(hrefM[1]) : '',
    };
  }
  return { exists: true, date: dateM ? dateM[1] : null, views, rows };
}

// ------------------------------------------------------------- date sweep ----

function sweepDates() {
  const out = { keyDatesFile: [], thirdYear: [] };
  if (fs.existsSync(DEFAULTS.keyDates)) {
    for (const line of fs.readFileSync(DEFAULTS.keyDates, 'utf8').split('\n')) {
      const m = /^\s*(\d{4}-\d{2}-\d{2})\s{2,}(.+?)\s*$/.exec(line);
      if (m) out.keyDatesFile.push({ date: m[1], label: m[2] });
    }
  }
  if (fs.existsSync(DEFAULTS.thirdYear)) {
    const html = fs.readFileSync(DEFAULTS.thirdYear, 'utf8');
    const seen = new Set();
    for (const m of html.matchAll(/(\d{4}-\d{2}-\d{2})/g)) {
      const around = stripTags(html.slice(Math.max(0, m.index - 80), m.index + 80)).replace(/\s+/g, ' ');
      if (seen.has(m[1] + around)) continue;
      seen.add(m[1] + around);
      out.thirdYear.push({ date: m[1], context: around });
    }
    for (const m of html.matchAll(/<h[23][^>]*>([^<]{2,80})<\/h[23]>/g)) {
      const t = stripTags(m[1]);
      if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) || /\b20\d{2}\b/.test(t)) out.thirdYear.push({ heading: t });
    }
  }
  return out;
}

// -------------------------------------------------------------- primitives ---

const REL_LABEL = ['Field', 'Tangential', 'Adjacent', 'Core'];
const relOf = (x) => {
  let n = x && (x.relevance ?? x.rating ?? x.score);
  if (n == null) return null;
  n = Number(n);
  return n > 3 ? Math.max(0, Math.min(3, Math.round(n / 33.4))) : Math.max(0, Math.min(3, Math.round(n)));
};
const REL_TIP = [
  'Field awareness — no direct line to your vision.',
  'Tangential — brushes a question you care about.',
  'Adjacent — clearly next door to a named project.',
  'Core — advances a named project or answers an open question.',
];
const relPill = (n) => n == null ? '' :
  `<span class="rel rel-${n} tip" data-marble-id="${mint()}" data-tip="${escAttr(`Fit to your research vision: ${REL_LABEL[n]}\n${REL_TIP[n]}`)}">${REL_LABEL[n]}</span>`;
const urgencyVar = (n) => n == null ? 'var(--faint)' : n <= 2 ? 'var(--warm)' : n <= 7 ? 'var(--accent)' : n <= 21 ? 'var(--accent-ink)' : 'var(--faint)';

const todoActs = () => `    <div class="acts" data-marble-transient>\n      <button class="act act-pin" data-act="pin" title="Pin">&#9679;</button>\n      <button class="act act-snooze" data-act="snooze" title="Snooze to tomorrow">&#8250;</button>\n    </div>`;
const itemActs = () => `    <div class="acts" data-marble-transient>\n      <button class="act act-up" data-act="up" title="More like this">&#9650;</button>\n      <button class="act act-down" data-act="down" title="Less like this">&#9660;</button>\n      <button class="act act-save" data-act="save" title="Save to reading list">&#9733;</button>\n    </div>`;

// Every component that shows outside data says where it came from, with a link.
function srcLine(name, url, ic) {
  return `\n<p class="csrc" data-marble-id="${mint()}">${ic ? icon(ic) : ''}<span data-marble-id="${mint()}">Source:</span> ` +
    `<a href="${escAttr(url)}" target="_blank" rel="noopener" data-marble-id="${mint()}">${esc(name)}</a></p>`;
}

function thumb(src, cls, width) {
  const uri = inlineImage(src, width);
  if (!uri) return '';
  return `<div class="${cls}" data-marble-id="${mint()}"><img src="${uri}" alt="" data-marble-id="${mint()}"></div>`;
}

// ------------------------------------------------------------- renderers -----

function rChecklist(items, prev, klass) {
  return (items || []).map((t) => {
    const title = String(t.title || '').trim();
    if (!title) return '';
    const key = t.key || slug((t.source || '') + '|' + title);
    const c = prev.rows[key] || {};
    const note = t.note != null ? t.note : c.note || '';
    const flags = (t.done ? ' data-done' : '') + (t.snooze ? ' data-snooze' : '') + (t.pin ? ' data-pin' : '');
    const meta = [t.source ? icon(t.source) : '', t.meta ? `<span data-marble-id="${mint()}">${esc(t.meta)}</span>` : ''].filter(Boolean).join(' ');
    return [
      `  <li class="row ${klass}" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
      `    <button class="chk" data-marble-transient data-act="done" aria-label="Toggle done"></button>`,
      `    <div class="body">`,
      `      <div class="title" data-marble-editable>${esc(title)}</div>`,
      t.why ? `      <div class="why" data-marble-editable>${esc(t.why)}</div>` : '',
      meta ? `      <div class="meta">${meta}</div>` : '',
      `      <div class="note" data-marble-editable>${esc(note)}</div>`,
      `    </div>`, todoActs(), `  </li>`,
    ].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

function rNewsCards(items, prev) {
  return (items || []).map((it) => ({ it, r: relOf(it) })).sort((a, b) => (b.r ?? -1) - (a.r ?? -1))
    .map(({ it, r }) => {
      const title = String(it.title || '').trim();
      if (!title) return '';
      const url = String(it.url || '').trim();
      const key = it.key || (url ? slug(url) : slug(title));
      const c = prev.rows[key] || {};
      const note = it.note != null ? it.note : c.note || '';
      const vote = it.vote != null ? it.vote : c.vote || null;
      const saved = it.saved != null ? it.saved : c.saved || false;
      const open = it.open != null ? it.open : c.open || false;
      const th = it.image ? thumb(it.image, 'nthumb', 420) : '';
      const flags = (vote ? ` data-vote="${escAttr(vote)}"` : '') + (saved ? ' data-saved' : '') + (open ? ' data-open' : '');
      const hasMore = it.abstract || it.authors;
      return [
        `  <div class="ncard expandable${th ? '' : ' no-img'}" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
        th ? `    ${th}` : '',
        `    <div class="nbody" data-marble-id="${mint()}">`,
        `      <h4 class="ntitle" data-marble-id="${mint()}">${url ? `<a href="${escAttr(url)}" target="_blank" rel="noopener">${esc(title)}</a>` : esc(title)}</h4>`,
        (it.meta || it.published) ? `      <div class="nmeta">${sourceBits(it.meta)}${it.published ? `<span data-marble-id="${mint()}">${esc(it.published)}</span>` : ''}</div>` : '',
        it.why ? `      <div class="nwhy" data-marble-id="${mint()}"><b data-marble-id="${mint()}">Why this matters to you</b><span data-marble-id="${mint()}" data-marble-editable>${esc(it.why)}</span></div>` : '',
        `      <div class="nfoot" data-marble-id="${mint()}">${relPill(r)}${hasMore ? `<button class="exp-toggle" data-marble-transient data-exp>more</button>` : ''}</div>`,
        hasMore ? `      <div class="exp" data-marble-id="${mint()}"><div class="exp-inner" data-marble-id="${mint()}">` : '',
        it.abstract ? `        <div class="abstract" data-marble-id="${mint()}" data-marble-editable>${esc(it.abstract)}</div>` : '',
        it.authors ? `        <div class="authors" data-marble-id="${mint()}">${esc(Array.isArray(it.authors) ? it.authors.join(', ') : it.authors)}</div>` : '',
        hasMore ? `      </div></div>` : '',
        `      <div class="note" data-marble-id="${mint()}" data-marble-editable>${esc(note)}</div>`,
        `    </div>`, itemActs(), `  </div>`,
      ].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n');
}

function rPapers(arxiv, prev) {
  const list = ((arxiv && arxiv.papers) || []).map((p) => ({ p, r: relOf(p) })).sort((a, b) => (b.r ?? -1) - (a.r ?? -1));
  return list.map(({ p, r }) => {
    const title = String(p.title || '').trim();
    if (!title) return '';
    const key = p.key || slug(p.id || p.absUrl || title);
    const c = prev.rows[key] || {};
    const pub = (p.published || '').slice(0, 10);
    const authors = Array.isArray(p.authors) ? p.authors : [];
    const authShort = authors.length > 3 ? authors.slice(0, 3).join(', ') + ` +${authors.length - 3}` : authors.join(', ');
    const flags = (c.vote ? ` data-vote="${escAttr(c.vote)}"` : '') + (c.saved ? ' data-saved' : '') + (c.open ? ' data-open' : '');
    const th = thumb(p.image || p.pdfUrl || (p.id ? `https://arxiv.org/pdf/${p.id}` : ''), 'pthumb', 460);
    return [
      `  <div class="pcard expandable" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
      th ? `    ${th}` : '',
      `    <h4 class="ptitle" data-marble-id="${mint()}"><a href="${escAttr(p.absUrl || ('https://arxiv.org/abs/' + p.id))}" target="_blank" rel="noopener">${esc(title)}</a></h4>`,
      `    <div class="pmeta" data-marble-id="${mint()}">${esc(authShort)}</div>`,
      p.why ? `    <div class="pwhy" data-marble-id="${mint()}" data-marble-editable>${esc(p.why)}</div>` : '',
      `    <div class="pfoot" data-marble-id="${mint()}">${relPill(r)}<span class="pdate" data-marble-id="${mint()}">${esc(humanShortNoDow(pub) || pub)}</span><button class="exp-toggle" data-marble-transient data-exp>abstract</button></div>`,
      `    <div class="exp" data-marble-id="${mint()}"><div class="exp-inner" data-marble-id="${mint()}">`,
      `      <div class="abstract" data-marble-id="${mint()}">${esc(p.abstract || '')}</div>`,
      `      <div class="authors" data-marble-id="${mint()}">${authors.length ? esc(authors.join(', ')) + ' &middot; ' : ''}<a href="${escAttr(p.pdfUrl || ('https://arxiv.org/pdf/' + p.id))}" target="_blank" rel="noopener">PDF</a></div>`,
      `    </div></div>`,
      `    <div class="note" data-marble-id="${mint()}" data-marble-editable>${esc(c.note || '')}</div>`,
      itemActs(), `  </div>`,
    ].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

function restOfDay(c) {
  const rest = (c.hourly || []).filter((h) => h.time.slice(0, 10) === (c.localTime || '').slice(0, 10));
  const pop = Math.max(0, ...rest.map((h) => h.pop || 0), c.today?.popMax || 0);
  const last = rest.length ? rest[rest.length - 1].label.toLowerCase() : c.now.label.toLowerCase();
  let s = `${last === c.now.label.toLowerCase() ? 'Holding ' + last : 'Turning ' + last} toward evening — high ${c.today.hi}°.`;
  if (pop >= 30) s += ` ${pop}% chance of rain.`;
  return s;
}
function rWeather(w) {
  if (!w || w.error) return `<p class="csub" data-marble-id="${mint()}">Weather unavailable this run.</p>`;
  const block = (c, here) => {
    if (!c) return '';
    const hrs = (c.hourly || []).slice(0, 7).map((h) =>
      `<div class="wx-hr tip" data-marble-id="${mint()}" data-tip="${escAttr(`${hour12(h.hour)} — ${h.label}\n${h.temp}°${c.unit || 'F'}${h.pop != null ? `  ·  ${h.pop}% chance of rain` : ''}`)}">` +
      `<div class="hh" data-marble-id="${mint()}">${hour12(h.hour)}</div>` +
      `<div class="he" data-marble-id="${mint()}">${esc(h.glyph)}</div><div class="ht" data-marble-id="${mint()}">${h.temp}°</div></div>`).join('');
    return [
      `  <div class="wx-block" data-marble-id="${mint()}" data-sky="${escAttr(c.now.sky || 'cloudy')}">`,
      `    <div class="wx-city" data-marble-id="${mint()}">${esc(c.city)}${here ? ' — you are here' : ''}</div>`,
      `    <div class="wx-now" data-marble-id="${mint()}">`,
      `      <span class="wx-emoji tip" data-marble-id="${mint()}" data-tip="${escAttr(`${c.city}: ${c.now.label}\nHigh ${c.today.hi}° · Low ${c.today.lo}° · feels like ${c.now.feels}°${c.today.popMax != null ? `\n${c.today.popMax}% chance of rain today` : ''}`)}">${esc(c.now.glyph)}</span>`,
      `      <span class="wx-temp" data-marble-id="${mint()}">${c.now.temp}<sup>°${esc(c.unit || 'F')}</sup></span>`,
      `      <span class="wx-txt" data-marble-id="${mint()}"><span class="wx-cond" data-marble-id="${mint()}">${esc(c.now.label)}</span><br>`,
      `        <span class="wx-hilo" data-marble-id="${mint()}">H ${c.today.hi}° · L ${c.today.lo}° · feels ${c.now.feels}°</span></span>`,
      `    </div>`,
      `    <p class="wx-rest" data-marble-id="${mint()}">${esc(restOfDay(c))}</p>`,
      `    <div class="wx-hrs" data-marble-id="${mint()}">${hrs}</div>`,
      `  </div>`,
    ].join('\n');
  };
  return `<div class="wx" data-marble-id="${mint()}">\n${block(w.zurich, true)}\n${block(w.sanDiego, false)}\n</div>` +
    srcLine('Open-Meteo', 'https://open-meteo.com/', 'meteo');
}

function rKeyDatesList(dates, from) {
  return (dates || []).map((d) => ({ ...d, n: daysUntil(d.date, from) })).filter((d) => d.n != null && d.n >= 0)
    .sort((a, b) => a.n - b.n).map((d) => {
      const label = String(d.label || '').trim() || '(untitled)';
      return [
        `  <li class="row keydate" data-marble-id="${mint()}" data-key="${escAttr(d.key || slug(d.date + '|' + label))}" style="--u:${urgencyVar(d.n)}">`,
        `    <span class="when-pill" data-marble-id="${mint()}">${d.n === 0 ? 'today' : `${d.n}<small> d</small>`}</span>`,
        `    <div class="body"><div class="title" data-marble-id="${mint()}" data-marble-editable>${esc(label)}</div>`,
        `      <div class="meta">${d.source ? icon(d.source) + ' ' : ''}<span data-marble-id="${mint()}">${esc(humanShort(d.date))}</span></div></div>`,
        `  </li>`,
      ].join('\n');
    }).join('\n');
}

// The column of what's coming. Two scales, both laid out in flow with a computed
// margin — no absolute positioning, so nothing can overlap however dates fall.
//   scale 'c' — compressed (sqrt). Near dates breathe, far ones still fit, and
//               ticks at 1 week / 3 weeks / 3 months admit the distortion.
//   scale 's' — strictly proportional. One pixel per day, no cheating.
function rTimelineY(dates, from, scale) {
  const evs = (dates || []).map((d) => ({ ...d, n: daysUntil(d.date, from) }))
    .filter((d) => d.n != null && d.n >= 0).sort((a, b) => a.n - b.n);
  if (!evs.length) return `<p class="csub" data-marble-id="${mint()}">Nothing on the horizon.</p>`;

  const maxN = Math.max(evs[evs.length - 1].n, 14);
  const linear = scale === 's';
  const pos = linear ? (d) => d * 3.1 : (d) => Math.sqrt(d) * 44;
  const MIN = linear ? 2 : 15;

  const TICKS = [0, 7, 21, 90, 180, 365].filter((t) => t <= maxN * 1.05);
  const NAME = { 0: 'today', 7: '1 week', 21: '3 weeks', 90: '3 months', 180: '6 months', 365: '1 year' };
  const rows = [
    ...(linear ? [] : TICKS.map((t) => ({ tick: true, n: t }))),
    ...evs.map((d) => ({ ...d, tick: false })),
  ].sort((a, b) => a.n - b.n || (a.tick ? -1 : 1));

  let prev = null;
  const body = rows.map((r) => {
    const y = pos(r.n);
    const gap = prev == null ? 0 : Math.max(MIN, Math.round(y - prev));
    prev = y;
    if (r.tick) {
      return `  <div class="tly-row tly-tick" data-marble-id="${mint()}" style="margin-top:${gap}px">` +
        `<span class="tly-when" data-marble-id="${mint()}">${esc(NAME[r.n] || `${r.n} d`)}</span>` +
        `<span class="tly-dot" data-marble-id="${mint()}"></span>` +
        `<span class="tly-body" data-marble-id="${mint()}"></span></div>`;
    }
    const label = String(r.label || '').trim() || '(untitled)';
    const tip = `${label}\n${humanShort(r.date)}  ·  ${r.n === 0 ? 'today' : `in ${r.n} day${r.n === 1 ? '' : 's'}`}${r.source ? `\nfrom ${r.source}` : ''}`;
    return `  <div class="tly-row tip tip-l" data-marble-id="${mint()}" data-key="${escAttr(r.key || slug(r.date + '|' + label))}" ` +
      `style="margin-top:${gap}px;--u:${urgencyVar(r.n)}" data-tip="${escAttr(tip)}">` +
      `<span class="tly-when" data-marble-id="${mint()}">${r.n === 0 ? 'now' : r.n}<small data-marble-id="${mint()}">${r.n === 0 ? '' : 'days'}</small></span>` +
      `<span class="tly-dot" data-marble-id="${mint()}"></span>` +
      `<span class="tly-body" data-marble-id="${mint()}"><span class="tly-label" data-marble-id="${mint()}" data-marble-editable>${esc(label)}</span>` +
      `<span class="tly-date" data-marble-id="${mint()}">${esc(humanShort(r.date))}</span></span></div>`;
  }).join('\n');
  return `<div class="tly-scroll" data-marble-id="${mint()}"><div class="tly" data-marble-id="${mint()}">\n${body}\n</div></div>`;
}

// A front-page mosaic: the strongest story runs wide with its picture, the next
// two at half, the rest as short columns. Rank comes from relevance, so the
// layout changes shape with the day.
function rNewsMosaic(feed, prev) {
  const all = [];
  for (const [k, kicker] of [['genui', 'GenUI'], ['industry', 'Industry'], ['hci', 'HCI']]) {
    for (const it of (feed || {})[k] || []) all.push({ it, kicker, r: relOf(it) });
  }
  if (!all.length) return `<p class="csub" data-marble-id="${mint()}">Nothing new today.</p>`;
  all.sort((a, b) => (b.r ?? -1) - (a.r ?? -1));
  return `<div class="mosaic" data-marble-id="${mint()}">\n` + all.map(({ it, kicker, r }, i) => {
    const size = i === 0 ? 'mo-lead' : i <= 2 ? 'mo-mid' : 'mo-small';
    const url = String(it.url || '').trim();
    const key = it.key || (url ? slug(url) : slug(it.title));
    const c = prev.rows[key] || {};
    const img = (i <= 2 && it.image) ? thumb(it.image, 'mo-img', i === 0 ? 900 : 500) : '';
    const flags = (c.vote ? ` data-vote="${escAttr(c.vote)}"` : '') + (c.saved ? ' data-saved' : '');
    return [
      `  <div class="mo ${size}" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
      img ? `    ${img}` : '',
      `    <div class="mo-kicker" data-marble-id="${mint()}">${esc(kicker)}</div>`,
      `    <h4 class="mo-title" data-marble-id="${mint()}">${url ? `<a href="${escAttr(url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</h4>`,
      it.why ? `    <p class="mo-dek" data-marble-id="${mint()}">${esc(it.why)}</p>` : '',
      `    <div class="mo-foot" data-marble-id="${mint()}">${relPill(r)}${it.published ? `<span class="pdate" data-marble-id="${mint()}">${esc(it.published)}</span>` : ''}</div>`,
      itemActs(),
      `  </div>`,
    ].filter(Boolean).join('\n');
  }).join('\n') + `\n</div>`;
}

function bktSeed(p, win) {
  p = p || {};
  const face = p.photo ? inlineImage(p.photo, 96) : '';
  const fl = flag(p.country);
  const faceHtml = `<span class="bkt-face" data-marble-id="${mint()}"${face ? ` style="background-image:url(${face})"` : ''}>${fl ? `<span class="bkt-flag" data-marble-id="${mint()}">${fl}</span>` : ''}</span>`;
  const tip = p.name ? `${p.name}${p.country ? ` · ${p.country}` : ''}${p.seed ? ` · seed ${p.seed}` : ''}${p.score ? `\n${p.score}` : ''}${win ? '\nwon' : ''}` : '';
  return `<div class="bkt-seed${win ? ' win' : ''}${tip ? ' tip tip-l' : ''}" data-marble-id="${mint()}"${tip ? ` data-tip="${escAttr(tip)}"` : ''}>${faceHtml}` +
    `<span class="bkt-nm" data-marble-id="${mint()}">${p.seed ? `<span class="bkt-sd" data-marble-id="${mint()}">${esc(p.seed)}</span>` : ''}${esc(p.name || 'TBD')}</span>` +
    `${p.score ? `<span class="bkt-sc" data-marble-id="${mint()}">${esc(p.score)}</span>` : ''}</div>`;
}
function rBracket(half) {
  if (!half || !half.rounds) return `<p class="csub" data-marble-id="${mint()}">Draw not available.</p>`;
  const R = half.rounds.map((r) => ({ name: r.name, matches: (r.matches || []).slice() }));
  for (let i = R.length - 2; i >= 0; i--) {
    const need = R[i + 1].matches.length * 2;
    while (R[i].matches.length < need) R[i].matches.push({ a: {}, b: {}, winner: '' });
  }
  const m2 = (m) => `<div class="bkt-match" data-marble-id="${mint()}">${bktSeed(m.a, m.winner === 'a')}${bktSeed(m.b, m.winner === 'b')}</div>`;
  const cols = R.map((rd, ri) => {
    const last = ri === R.length - 1;
    const pairs = [];
    for (let i = 0; i < rd.matches.length; i += last ? 1 : 2) {
      const g = last ? [rd.matches[i]] : rd.matches.slice(i, i + 2);
      pairs.push(`<div class="bkt-pair${last ? ' bkt-solo' : ''}" data-marble-id="${mint()}">${g.map(m2).join('')}</div>`);
    }
    return `<div class="bkt-round" data-marble-id="${mint()}"><div class="bkt-rname" data-marble-id="${mint()}">${esc(rd.name)}</div><div class="bkt-pairs" data-marble-id="${mint()}">${pairs.join('')}</div></div>`;
  }).join('');
  return `<div class="bracket" data-marble-id="${mint()}">${cols}</div>`;
}
function rUsoNow(u) {
  const list = (u.top || []).map((m) =>
    `<div class="bkt-match" data-marble-id="${mint()}"><div class="bkt-rname" data-marble-id="${mint()}">${esc(m.label || '')}</div>${bktSeed(m.a, m.winner === 'a')}${bktSeed(m.b, m.winner === 'b')}</div>`).join('');
  return list ? `<div class="uso-now" data-marble-id="${mint()}">${list}</div>` : rBracket(u.men);
}

function rPalStrip(pal) {
  return `<span class="pal-chips" data-marble-id="${mint()}">${pal.swatches.slice(0, 4).map((h) => `<i class="tip" style="background:${escAttr(h)}" data-tip="${escAttr(h)}" data-marble-id="${mint()}"></i>`).join('')}</span>` +
    `<span class="pal-name" data-marble-id="${mint()}">${esc(pal.name)}</span>`;
}

// ------------------------------------------------------------- composition ---

const CAT = { focus: 'var(--warm)', push: 'var(--accent)', todos: 'var(--accent)', news: 'var(--c1)', papers: 'var(--c2)', weather: 'var(--c3)', calendar: 'var(--accent-ink)', usopen: 'var(--c4)', art: 'var(--c4)', roadahead: 'var(--accent)', custom: 'var(--accent)' };
const TITLE = { focus: 'Today, sharply', push: 'Push one thing forward', todos: 'To-dos', news: 'Worth your attention', papers: 'Fresh on arXiv · cs.HC', weather: 'Sky', calendar: 'The weeks ahead', usopen: 'US Open', art: "Today's colour", roadahead: 'The road ahead' };

function componentBody(type, node, P, prev, pal) {
  switch (type) {
    case 'focus':
      return { html: `<ol class="list" data-marble-id="${mint()}" data-marble-sortable="focus">\n${rChecklist(P.focus, prev, 'focus')}\n</ol>`, n: (P.focus || []).length };
    case 'todos':
      return { html: `<ol class="list" data-marble-id="${mint()}" data-marble-sortable="todos">\n${rChecklist(P.todos, prev, 'todo')}\n</ol>\n<button class="add" data-marble-transient data-marble-add="#tpl-todo" data-marble-into="prev">a to-do</button>`, n: (P.todos || []).length };
    case 'push': {
      const p = P.push || {};
      if (!p.title) return { html: `<p class="csub" data-marble-id="${mint()}">Nothing flagged to push today.</p>` };
      return { html: `<h3 class="push-h" data-marble-id="${mint()}" data-marble-editable>${esc(p.title)}</h3>\n<p class="push-b" data-marble-id="${mint()}" data-marble-editable>${esc(p.body || '')}</p>` };
    }
    case 'news': {
      const f = P.feed || {};
      const total = ['genui', 'industry', 'hci'].reduce((a, k) => a + (f[k] || []).length, 0);
      if (!total) return { html: `<p class="csub" data-marble-id="${mint()}">Nothing new today.</p>`, n: 0 };
      const subs = [['genui', 'GenUI \u00b7 malleable software'], ['industry', 'Industry & startups'], ['hci', 'HCI pulse']]
        .filter(([k]) => (f[k] || []).length)
        .map(([k, label]) => `<div class="nsub" data-marble-id="${mint()}"><h3 data-marble-id="${mint()}">${esc(label)}</h3>` +
          `<div data-marble-id="${mint()}" data-marble-sortable="news">\n${rNewsCards(f[k], prev)}\n</div>` +
          (k === 'genui' ? `<button class="add" data-marble-transient data-marble-add="#tpl-news" data-marble-into="prev">a link</button>` : '') + `</div>`).join('\n');
      const view = node.view || prev.views.news || 'list';
      return {
        n: total, view, viewKey: 'news',
        seg: `<span class="seg"><button data-setview="list">Reading</button><button data-setview="cal">Front page</button></span>`,
        html: `<div class="v v-list" data-marble-id="${mint()}">${subs}</div>\n` +
          `<div class="v v-cal" data-marble-id="${mint()}">${rNewsMosaic(f, prev)}</div>`,
      };
    }
    case 'papers': {
      const a = P.arxiv || {};
      const n = (a.papers || []).length;
      const sub = a.error ? 'arXiv unavailable this run.'
        : `${n} paper${n === 1 ? '' : 's'} from ${humanShort((a.newestDate || '').slice(0, 10)) || '—'} · sorted by fit to your research`;
      return { html: `<p class="csub" data-marble-id="${mint()}">${esc(sub)}</p>\n<div class="pgrid" data-marble-id="${mint()}" data-marble-sortable="papers">\n${rPapers(a, prev)}\n</div>` +
        srcLine('arXiv cs.HC new submissions', 'https://arxiv.org/list/cs.HC/recent', 'arxiv'), n };
    }
    case 'weather': return { html: rWeather(P.weather) };
    case 'calendar': {
      const view = node.view || prev.views.calendar || 'c';
      const n = (P.keyDates || []).filter((d) => daysUntil(d.date, P.date) >= 0).length;
      return {
        n, view, viewKey: 'calendar',
        seg: `<span class="seg"><button data-setview="c">Compressed</button><button data-setview="s">To scale</button></span>`,
        html: rTimelineY(P.keyDates, P.date, view),
      };
    }
    case 'usopen': {
      const u = P.usOpen || {};
      if (u.error) return { html: `<p class="csub" data-marble-id="${mint()}">US Open data unavailable.</p>` };
      const view = node.view || prev.views.usopen || 'top';
      return {
        view, viewKey: 'usopen',
        seg: `<span class="seg"><button data-setview="top">Now</button><button data-setview="men">Men</button><button data-setview="women">Women</button></span>`,
        html: (u.note ? `<p class="csub" data-marble-id="${mint()}">${esc(u.note)}</p>\n` : '') +
          `<div class="v v-top" data-marble-id="${mint()}">${rUsoNow(u)}</div>\n` +
          `<div class="v v-men" data-marble-id="${mint()}">${rBracket(u.men)}</div>\n` +
          `<div class="v v-women" data-marble-id="${mint()}">${rBracket(u.women)}</div>` +
          srcLine(u.sourceName || 'US Open — official draws', u.sourceUrl || 'https://www.usopen.org/en_US/scores/draws/', 'web'),
      };
    }
    case 'art': {
      const h = P.hero || {};
      const img = h.image ? inlineImage(h.image, 800) : '';
      return {
        html: [
          img ? `<div class="art-img" data-marble-id="${mint()}"><img src="${img}" alt="${escAttr(h.credit || '')}" data-marble-id="${mint()}"></div>` : '',
          h.credit ? `<p class="art-credit" data-marble-id="${mint()}">${esc(h.credit)}</p>` : '',
          `<div class="pal" data-marble-id="${mint()}">${rPalStrip(pal)}</div>`,
          img ? srcLine('Art Institute of Chicago (public domain)', h.page || 'https://www.artic.edu/collection', 'web') : '',
        ].filter(Boolean).join('\n'),
      };
    }
    case 'roadahead': {
      const r = P.representation || {};
      return { sub: r.name, html: `<div class="repr" data-marble-id="${mint()}">\n${r.html || '<p class="csub">No representation was authored today.</p>'}\n</div>` };
    }
    case 'custom': return { html: node.html || '' };
    default: return null;
  }
}

function renderComponent(node, P, prev, pal) {
  const built = componentBody(node.type, node, P, prev, pal);
  if (!built) die(`unknown component type "${node.type}"`);
  const treatment = node.treatment || 'card';
  const title = node.title === null ? '' : (node.title || TITLE[node.type] || '');
  const cat = node.cat || CAT[node.type] || 'var(--accent)';
  const cls = ['comp', treatment, 'reveal', built.view ? 'viewbox' : ''].filter(Boolean).join(' ');
  const viewAttrs = built.view ? ` data-view="${escAttr(built.view)}" data-view-key="${escAttr(built.viewKey)}"` : '';
  const head = title
    ? `  <div class="chead"><h2 data-marble-id="${mint()}">${esc(title)}</h2>` +
      (built.n ? `<span class="n" data-marble-id="${mint()}">${built.n}</span>` : '') +
      (built.sub ? `<span class="n" data-marble-id="${mint()}">${esc(built.sub)}</span>` : '') +
      (built.seg ? `<span class="right" data-marble-transient>${built.seg}</span>` : '') + `</div>\n`
    : '';
  return `<section class="${cls}" data-marble-id="${mint()}" style="--cat: ${cat}"${viewAttrs}>\n${head}${built.html}\n</section>`;
}

const DEFAULT_LAYOUT = {
  rail: [
    { type: 'weather', treatment: 'card' },
    { type: 'art', treatment: 'card' },
  ],
  stream: [
    { type: 'focus', treatment: 'bare' },
    { type: 'push', treatment: 'tint' },
    { type: 'todos', treatment: 'bare' },
    { type: 'news', treatment: 'bare' },
    { type: 'papers', treatment: 'bare' },
    { type: 'usopen', treatment: 'bare' },
    { type: 'roadahead', treatment: 'card' },
  ],
  tail: [
    { type: 'calendar', treatment: 'card' },
  ],
};

// ------------------------------------------------------------------ assemble --

function guardHtml(html, what) {
  const bad = [[/<script\b/i, 'a <script> tag'], [/\son\w+\s*=/i, 'an inline event handler'], [/javascript:/i, 'a javascript: URL'], [/@import/i, 'an @import'], [/url\(\s*["']?https?:/i, 'an external url()'], [/<(img|iframe|object|embed|link)\b[^>]*\b(src|href)\s*=\s*["']?https?:/i, 'an external asset']];
  for (const [re, why] of bad) if (re.test(String(html || ''))) die(`${what} contains ${why} — self-contained markup + CSS only`);
}
function newestDatedIssue() {
  try {
    const f = fs.readdirSync(DEFAULTS.dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.mrbl$/.test(x)).sort();
    return f.length ? path.join(DEFAULTS.dir, f[f.length - 1]) : null;
  } catch { return null; }
}

function assemble(args) {
  let raw;
  if (args.payload === '-' || args.payload === true) raw = fs.readFileSync(0, 'utf8');
  else if (typeof args.payload === 'string') raw = fs.readFileSync(args.payload, 'utf8');
  else die('assemble needs --payload <file|->');
  let P;
  try { P = JSON.parse(raw); } catch (e) { die(`payload is not valid JSON: ${e.message}`); }

  const date = P.date || todayYmd();
  if (!atLocalNoon(date)) die(`payload.date "${date}" is not YYYY-MM-DD`);
  P.date = date;
  const outPath = args.out || path.join(DEFAULTS.dir, `${date}.mrbl`);
  const prevFile = fs.existsSync(DEFAULTS.stable) ? DEFAULTS.stable : (newestDatedIssue() || outPath);
  const prev = readback(prevFile);

  if (P.representation) guardHtml(P.representation.html, 'representation.html');
  const layout = P.layout && (P.layout.rail || P.layout.stream) ? P.layout : DEFAULT_LAYOUT;
  for (const n of [...(layout.rail || layout.deck || []), ...(layout.stream || []), ...(layout.tail || [])]) if (n.type === 'custom') guardHtml(n.html, `custom component "${n.title || ''}"`);

  const picked = pickPalette(date, P.palette);
  const pal = picked.pal;

  const railNodes = layout.rail || layout.deck || [];
  const tailNodes = layout.tail || [];
  const rail = railNodes.map((n) => renderComponent(n, P, prev, pal)).join('\n\n');
  const tail = tailNodes.map((n) => renderComponent(n, P, prev, pal)).join('\n\n');
  const stream = (layout.stream || []).map((n) => renderComponent(n, P, prev, pal)).join('\n\n');

  const summary = Array.isArray(P.summary) ? P.summary.join(' ') : (P.summary || '');
  const srcs = (P.sources || ['gmail', 'gcal', 'notion', 'arxiv', 'meteo']).map((s) => icon(s)).join(' ');
  const body = [
    `  <header class="masthead" data-marble-id="${mint()}">`,
    `    <span class="date" data-marble-id="${mint()}">${esc(humanLongUpper(date))}</span>`,
    `    <span class="greet" data-marble-id="${mint()}" data-marble-editable>${esc(P.greeting || 'Good morning, Bryan.')}</span>`,
    summary ? `    <p class="sub" data-marble-id="${mint()}" data-marble-editable>${esc(summary)}</p>` : '',
    `  </header>`,
    ``,
    `  <div class="shell" data-marble-id="${mint()}">`,
    `    <aside class="rail" data-marble-id="${mint()}">`,
    rail,
    `    </aside>`,
    `    <div class="stream" data-marble-id="${mint()}">`,
    stream,
    `    </div>`,
    tailNodes.length ? `    <aside class="tail" data-marble-id="${mint()}">\n${tail}\n    </aside>` : '',
    `  </div>`,
    ``,
    `  <footer class="colophon" data-marble-id="${mint()}"><span data-marble-id="${mint()}">Assembled for you from</span> ${srcs} <span data-marble-id="${mint()}">&nbsp;·&nbsp; palette <b data-marble-id="${mint()}">${esc(pal.name)}</b></span></footer>`,
  ].filter(Boolean).join('\n');

  let html = fs.readFileSync(DEFAULTS.shell, 'utf8');
  html = html.replaceAll('__DATE__', escAttr(date)).replaceAll('__PALETTE_NAME__', escAttr(pal.name));
  html = html.replace('__DESIGN__', fs.readFileSync(DEFAULTS.design, 'utf8'));
  const fontCss = fs.existsSync(DEFAULTS.fontCss) ? fs.readFileSync(DEFAULTS.fontCss, 'utf8') : '';
  html = html.replace('__FONT__', fontCss ? `<style id="nl-font">\n${fontCss}\n</style>` : '<style id="nl-font"></style>');
  html = html.replace('__PALETTE__', paletteStyle(pal));
  html = html.replace('__BODY__', body);

  const check = selfCheck(html);
  if (!check.ok) die(`self-check failed:\n  - ${check.problems.join('\n  - ')}`);

  const out = {
    date, out: outPath, stable: DEFAULTS.stable, palette: pal.name,
    components: { rail: railNodes.map((n) => n.type), stream: (layout.stream || []).map((n) => n.type), tail: tailNodes.map((n) => n.type) },
    counts: {
      focus: (P.focus || []).length, todos: (P.todos || []).length,
      keyDates: (P.keyDates || []).length,
      news: ['genui', 'industry', 'hci'].reduce((s, k) => s + ((P.feed || {})[k] || []).length, 0),
      papers: ((P.arxiv || {}).papers || []).length,
    },
    imagesInlined, bytes: Buffer.byteLength(html), carriedForward: Object.keys(prev.rows).length,
  };
  if (args['dry-run']) { console.log(JSON.stringify({ dryRun: true, ...out }, null, 2)); return; }

  fs.mkdirSync(DEFAULTS.dir, { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, html); fs.renameSync(tmp, outPath);
  fs.copyFileSync(outPath, DEFAULTS.stable);
  const after = fs.readFileSync(outPath, 'utf8');
  const re = selfCheck(after);
  if (!re.ok) die(`file on disk failed re-check:\n  - ${re.problems.join('\n  - ')}`);

  try { execFileSync('node', [DEFAULTS.layoutTool, outPath], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { console.error(((e.stdout || '') + (e.stderr || '')).toString()); die('layout doctor found problems — fix design.css / the renderers.'); }

  if (picked.recorded) {
    fs.mkdirSync(path.dirname(DEFAULTS.paletteState), { recursive: true });
    fs.writeFileSync(DEFAULTS.paletteState, JSON.stringify({ recent: picked.recent, updated: new Date().toISOString() }, null, 2));
  }
  console.log(JSON.stringify({ ok: true, ...out, bytes: Buffer.byteLength(after), layout: 'clean', savedItems: Object.entries(prev.rows).filter(([, v]) => v.saved).map(([k]) => k) }, null, 2));
}

// ---------------------------------------------------------------- checks -----

function selfCheck(html) {
  const problems = [];
  const left = html.match(/__[A-Z_]+__/g);
  if (left) problems.push(`unfilled placeholder(s): ${[...new Set(left)].join(', ')}`);
  const ids = [...html.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set(); const dup = new Set();
  for (const id of ids) { if (seen.has(id)) dup.add(id); seen.add(id); }
  if (dup.size) problems.push(`duplicate data-marble-id: ${[...dup].slice(0, 8).join(', ')}`);
  if (ids.length < 30) problems.push(`only ${ids.length} addressable elements`);
  for (const [o, c] of [['<script', '</script>'], ['<template', '</template>'], ['<style', '</style>'], ['<section', '</section>']]) {
    const a = (html.match(new RegExp(o, 'g')) || []).length, b = (html.match(new RegExp(c, 'g')) || []).length;
    if (a !== b) problems.push(`unbalanced ${o}…${c} (${a} vs ${b})`);
  }
  if (!/data-marble="1"/.test(html)) problems.push('missing data-marble="1"');
  if (!/<meta name="newsletter:date" content="\d{4}-\d{2}-\d{2}">/.test(html)) problems.push('missing newsletter:date meta');
  if (!/id="nl-palette"/.test(html)) problems.push('palette not injected');
  if (!/marble\.register\(/.test(html)) problems.push('affordance script missing');
  // The ban is on components that scroll *vertically* inside themselves. A
  // deliberately horizontal track (the timeline) is a different thing and says so
  // in its name, so match the bare `scroll` class as a whole token.
  if (/class="(?:[^"]*\s)?scroll(?:\s[^"]*)?"/.test(html)) problems.push('a component uses inner vertical scrolling — not allowed');
  if (/overflow-y:\s*(auto|scroll)/.test(html.replace(/tl[xy]-scroll[\s\S]{0,400}?}/g, ''))) problems.push('overflow-y scrolling found outside the timeline track');
  return { ok: problems.length === 0, problems };
}

function harvest(args) {
  const file = args.file || args._[1] || DEFAULTS.stable;
  const rb = readback(file);
  if (!rb.exists) die(`no issue at ${file}`);
  let seen = { keys: [] };
  if (fs.existsSync(DEFAULTS.seen)) { try { seen = JSON.parse(fs.readFileSync(DEFAULTS.seen, 'utf8')); } catch {} }
  const keys = new Set(seen.keys || []);
  for (const [k, r] of Object.entries(rb.rows)) if (r.kind === 'item' || r.kind === 'arxiv') keys.add(k);
  const saved = [], votes = { up: [], down: [] };
  for (const [key, r] of Object.entries(rb.rows)) {
    if (r.saved) saved.push({ key, title: r.title, url: r.url, note: r.note });
    if (r.vote === 'up') votes.up.push({ key, title: r.title });
    if (r.vote === 'down') votes.down.push({ key, title: r.title });
  }
  if (!args['dry-run']) {
    fs.mkdirSync(path.dirname(DEFAULTS.seen), { recursive: true });
    fs.writeFileSync(DEFAULTS.seen, JSON.stringify({ keys: [...keys].sort(), updated: new Date().toISOString() }, null, 2));
  }
  console.log(JSON.stringify({ issueDate: rb.date, seenTotal: keys.size, saved, votes }, null, 2));
}

// -------------------------------------------------------------------- main ---

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'readback') console.log(JSON.stringify(readback(args._[1] || args.file || DEFAULTS.stable), null, 2));
else if (cmd === 'dates') console.log(JSON.stringify(sweepDates(), null, 2));
else if (cmd === 'assemble') assemble(args);
else if (cmd === 'harvest') harvest(args);
else if (cmd === 'check') {
  const file = args.file || args._[1] || DEFAULTS.stable;
  if (!fs.existsSync(file)) die(`no file at ${file}`);
  const r = selfCheck(fs.readFileSync(file, 'utf8'));
  if (!r.ok) die(`self-check failed:\n  - ${r.problems.join('\n  - ')}`);
  try { execFileSync('node', [DEFAULTS.layoutTool, file], { stdio: 'inherit' }); } catch { process.exit(1); }
  console.log('[bulletin] check: ok');
} else {
  console.log(`Bryan's Bulletin — build.mjs
  readback [file] | dates | assemble --payload <f|-> [--dry-run] | harvest [file] | check [--file F]
  composes drive/Newsletter/<YYYY-MM-DD>.mrbl (mirrored to today.mrbl) from payload.layout`);
  if (cmd) die(`unknown command "${cmd}"`);
}
