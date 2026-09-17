#!/usr/bin/env node
// build.mjs — the engine behind Bryan's Days.
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
//   feedback  [--all]           what Bryan wrote INTO past issues — asks for this dashboard
//   check     --file <file>     invariant self-check + layout doctor

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const REPO = path.resolve(SKILL, '..', '..', '..');
const NLDIR = path.join(REPO, 'drive', "Bryan's Days");

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
  carry: path.join(SKILL, 'state', 'carry.json'),
  feedback: path.join(SKILL, 'state', 'feedback.json'),
  authors: path.join(SKILL, 'state', 'authors.json'),
  imagesTool: path.join(HERE, 'images.mjs'),
  layoutTool: path.join(HERE, 'layoutcheck.mjs'),
};
const IMAGE_BUDGET = 30;

// ---------------------------------------------------------------- helpers ----

const die = (msg) => { console.error(`[day] ${msg}`); process.exit(1); };
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

// Slice an element out of HTML by walking its own nesting. The naive version —
// "cut at the first closing tag" — is right for a <li> whose children are divs,
// but it truncates a <div class="pcard"> at its first inner close, which sits far
// above the note. Every note Bryan ever wrote on a paper or a news card was
// dropped that way. Depth-match instead, so a card carries its note like a row.
function sliceTag(chunk, tag) {
  const re = new RegExp('<' + tag + '\\b|</' + tag + '>', 'g');
  let depth = 0, m;
  while ((m = re.exec(chunk))) {
    if (m[0][1] === '/') { if (--depth === 0) return chunk.slice(0, m.index + m[0].length); }
    else depth++;
  }
  return chunk;
}

function readback(file) {
  if (!file || !fs.existsSync(file)) return { exists: false, date: null, rows: {}, views: {}, expanded: {} };
  const html = fs.readFileSync(file, 'utf8');
  const dateM = /<meta name="(?:day|newsletter):date" content="([^"]*)">/.exec(html);
  const views = {};
  const expanded = {};
  for (const m of html.matchAll(/<section\b([^>]*)>/g)) {
    const a = m[1];
    const k = /data-view-key="([^"]+)"/.exec(a); const v = /data-view="([^"]*)"/.exec(a);
    if (k && v) views[k[1]] = v[1];
    const ek = /data-exp-key="([^"]+)"/.exec(a);
    if (ek) expanded[ek[1]] = /\bdata-expanded\b/.test(a);
  }
  // Scan every candidate element by its OWN tag, testing the class list rather
  // than assuming class is the first attribute. It is not: when Bryan expands or
  // stars a card, marble files a setAttr and the new attribute lands ahead of
  // class — <div data-open="" data-saved="" class="pcard" ...>. A class-first
  // pattern stops matching at exactly that point, so the cards he actually
  // engaged with were the ones whose notes and state were silently dropped.
  const rows = {};
  const tagRe = /<(li|div)\b([^>]*)>/g;
  let tm;
  while ((tm = tagRe.exec(html))) {
    const attrs = tm[2];
    const cls = (/class="([^"]*)"/.exec(attrs) || [, ''])[1];
    const classes = new Set(cls.split(/\s+/).filter(Boolean));
    const isCard = classes.has('ncard') || classes.has('pcard') || classes.has('mo');
    const isRow = tm[1] === 'li' && classes.has('row');
    if (!isCard && !isRow) continue;
    const keyM = /data-key="([^"]*)"/.exec(attrs);
    if (!keyM) continue;
    const body = sliceTag(html.slice(tm.index), tm[1]);
    const noteM = /<div class="note"[^>]*>([\s\S]*?)<\/div>/.exec(body);
    const titleM = /<(?:div|h4) class="(?:title|ntitle|ptitle|mo-title)"[^>]*>([\s\S]*?)<\/(?:div|h4)>/.exec(body);
    const hrefM = titleM ? /href="([^"]*)"/.exec(titleM[1]) : null;
    const voteM = /data-vote="([^"]*)"/.exec(attrs);
    rows[keyM[1]] = {
      kind: (classes.has('ncard') || classes.has('mo')) ? 'item' : classes.has('pcard') ? 'arxiv'
        : (classes.has('todo') || classes.has('focus')) ? 'todo' : classes.has('keydate') ? 'keydate' : 'row',
      done: /\bdata-done\b/.test(attrs), snooze: /\bdata-snooze\b/.test(attrs), pin: /\bdata-pin\b/.test(attrs),
      open: /\bdata-open\b/.test(attrs), vote: voteM ? voteM[1] : null, saved: /\bdata-saved\b/.test(attrs),
      note: noteM ? stripTags(noteM[1]) : '', title: titleM ? stripTags(titleM[1]) : '',
      url: hrefM ? decodeEntities(hrefM[1]) : '',
    };
  }

  // Rows Bryan added himself come from a <template> and carry no data-key, so
  // the loop above cannot see them. They are the most important rows in the
  // file — they are the only ones he wrote — so pick them up separately.
  const added = [];
  const addRe = /<li\b([^>]*)>/g;
  let am;
  while ((am = addRe.exec(html))) {
    const attrs = am[1];
    const cls = (/class="([^"]*)"/.exec(attrs) || [, ''])[1];
    const classes = new Set(cls.split(/\s+/).filter(Boolean));
    if (!classes.has('row') || (!classes.has('todo') && !classes.has('focus'))) continue;
    if (/data-key="/.test(attrs)) continue;
    const m = [null, classes.has('focus') ? 'focus' : 'todo', attrs, sliceTag(html.slice(am.index), 'li')];
    const body = m[3];
    const title = stripTags((/<div class="title"[^>]*>([\s\S]*?)<\/div>/.exec(body) || [, ''])[1]).trim();
    if (!title || title === 'New to-do' || title === 'New priority') continue;
    added.push({
      kind: m[1],
      key: `own-${slug(title)}`,
      title,
      note: stripTags((/<div class="note"[^>]*>([\s\S]*?)<\/div>/.exec(body) || [, ''])[1]).trim(),
      why: stripTags((/<div class="why"[^>]*>([\s\S]*?)<\/div>/.exec(body) || [, ''])[1]).trim(),
      done: /\bdata-done\b/.test(m[2]), snooze: /\bdata-snooze\b/.test(m[2]),
    });
  }
  return { exists: true, date: dateM ? dateM[1] : null, views, expanded, rows, added };
}

// ---------------------------------------------------- what Bryan wrote down ---
// A to-do he typed into the page is a standing fact about his life, not a row in
// one morning's file. It goes into state/carry.json and stays there — surfacing
// in every issue, feeding the timeline once it has a date, and climbing into the
// focus list as that date gets close — until he ticks it off.

function loadCarry() {
  try { return JSON.parse(fs.readFileSync(DEFAULTS.carry, 'utf8')); }
  catch { return { items: [], updated: null }; }
}

function saveCarry(c) {
  fs.mkdirSync(path.dirname(DEFAULTS.carry), { recursive: true });
  c.updated = new Date().toISOString();
  fs.writeFileSync(DEFAULTS.carry, JSON.stringify(c, null, 2));
}

function carry(file, issueDate) {
  const rb = readback(file);
  const c = loadCarry();
  const byKey = new Map(c.items.map((i) => [i.key, i]));
  const seenToday = issueDate || rb.date || todayYmd();

  // New hand-written rows join the list.
  for (const a of rb.added) {
    const prev = byKey.get(a.key);
    if (prev) {
      prev.title = a.title; prev.lastSeen = seenToday;
      if (a.note) prev.note = a.note;
      if (a.done) prev.done = true;
      if (a.snooze) prev.snooze = true;
    } else {
      const item = { key: a.key, title: a.title, note: a.note || '', kind: a.kind,
        origin: 'bryan', date: null, addedOn: seenToday, lastSeen: seenToday, done: !!a.done };
      c.items.push(item); byKey.set(a.key, item);
    }
  }
  // Anything carried and then ticked off in the page stops being carried.
  for (const item of c.items) {
    const row = rb.rows[item.key];
    if (row && row.done) item.done = true;
    if (row && row.note) item.note = row.note;
    if (row) item.lastSeen = seenToday;
  }
  const before = c.items.length;
  c.items = c.items.filter((i) => !i.done);
  saveCarry(c);
  return { file, issueDate: seenToday, added: rb.added.length, retired: before - c.items.length, open: c.items };
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
// Urgency is one hue — the theme's accent — and nearness is how much of it there
// is. A four-colour scale made "soon" and "far" look like different kinds of
// thing; a single ramp reads as one axis, which is what a date actually is.
const URGENCY_STOPS = [[0, 100], [2, 88], [7, 70], [21, 52], [60, 36], [120, 24]];
const urgencyPct = (n) => {
  if (n == null) return 14;
  for (const [days, pct] of URGENCY_STOPS) if (n <= days) return pct;
  return 14;
};
const urgencyVar = (n) => `color-mix(in srgb, var(--accent) ${urgencyPct(n)}%, transparent)`;
const urgencyWord = (n) => n == null ? 'no date'
  : n === 0 ? 'today' : n === 1 ? 'tomorrow' : n <= 2 ? 'in two days'
  : n <= 7 ? 'this week' : n <= 21 ? 'within three weeks'
  : n <= 60 ? 'within two months' : n <= 120 ? 'within four months' : 'further out';

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

// ------------------------------------------------------------------- tags ---
// What kind of research a paper is, readable at a glance. Three kinds, because
// three is what colour can carry: what the work PRODUCES (artifact), how it was
// DONE (method), and what it is ABOUT (topic). Anything unrecognised falls
// through as a topic rather than being dropped — the vocabulary is a
// convenience, not a gate.
const TAGS = {
  // artifact — the thing the paper hands you
  dataset:   ['Dataset',    'artifact', 'Contributes a dataset or corpus'],
  corpus:    ['Corpus',     'artifact', 'Contributes a corpus'],
  benchmark: ['Benchmark',  'artifact', 'Contributes a benchmark or evaluation suite'],
  model:     ['Model',      'artifact', 'Trains or releases a model'],
  system:    ['System',     'artifact', 'Builds and demonstrates a working system'],
  toolkit:   ['Toolkit',    'artifact', 'Contributes a toolkit or library others can build on'],
  technique: ['Technique',  'artifact', 'Contributes a new interaction or algorithmic technique'],
  // method — how the claim was earned
  study:     ['Study',      'method',   'Empirical study with participants'],
  formative: ['Formative',  'method',   'Formative or exploratory work that shapes a design'],
  interview: ['Interviews', 'method',   'Interview or qualitative study'],
  survey:    ['Survey',     'method',   'Survey of people, or a literature survey'],
  eval:      ['Eval',       'method',   'Primarily an evaluation of existing systems or models'],
  theory:    ['Theory',     'method',   'Conceptual, theoretical, or framework work'],
  position:  ['Position',   'method',   'Position paper or provocation'],
  // topic — the field it sits in
  hci:       ['HCI',        'topic',    'Human–computer interaction'],
  genui:     ['GenUI',      'topic',    'Generative user interfaces'],
  malleable: ['Malleable',  'topic',    'Malleable / end-user-modifiable software'],
  llm:       ['LLM',        'topic',    'Large language models'],
  rlhf:      ['RLHF',       'topic',    'Reinforcement learning from human feedback / alignment'],
  agents:    ['Agents',     'topic',    'Autonomous or tool-using agents'],
  nlp:       ['NLP',        'topic',    'Natural language processing'],
  vis:       ['Vis',        'topic',    'Data visualisation'],
  xr:        ['XR',         'topic',    'AR / VR / mixed reality'],
  robotics:  ['Robotics',   'topic',    'Robotics and teleoperation'],
  health:    ['Health',     'topic',    'Health, clinical, or wellbeing'],
  a11y:      ['Access',     'topic',    'Accessibility'],
  fab:       ['Fabrication','topic',    'Digital fabrication and physical making'],
  audio:     ['Audio',      'topic',    'Audio, speech, and music'],
  education: ['Education',  'topic',    'Teaching and learning'],
  cscw:      ['CSCW',       'topic',    'Collaboration and social computing'],
  creativity:['Creativity', 'topic',    'Creativity support'],
  ml:        ['ML',         'topic',    'Machine learning, generally'],
};
const TAGALIAS = {
  'user study': 'study', 'lab study': 'study', 'field study': 'study', 'empirical': 'study',
  'qualitative': 'interview', 'interviews': 'interview', 'evaluation': 'eval',
  'visualization': 'vis', 'visualisation': 'vis', 'dataviz': 'vis',
  'accessibility': 'a11y', 'ar': 'xr', 'vr': 'xr', 'mixed reality': 'xr',
  'framework': 'theory', 'conceptual': 'theory', 'literature review': 'survey',
  'alignment': 'rlhf', 'end-user programming': 'malleable', 'eup': 'malleable',
  'fabrication': 'fab', 'speech': 'audio', 'music': 'audio', 'llms': 'llm',
  'generative ui': 'genui', 'agent': 'agents', 'prototype': 'system',
};
function tagOf(raw) {
  const k = String(raw || '').trim().toLowerCase();
  if (!k) return null;
  const key = TAGALIAS[k] || k;
  const hit = TAGS[key];
  if (hit) return { label: hit[0], kind: hit[1], tip: hit[2] };
  // Unknown but deliberate: keep Bryan's word, present it as a topic.
  const label = String(raw).trim().replace(/\s+/g, ' ');
  return { label: label.length > 14 ? label.slice(0, 13) + '…' : label, kind: 'topic', tip: `Research area: ${label}` };
}
function rTags(list) {
  const tags = (Array.isArray(list) ? list : []).map(tagOf).filter(Boolean).slice(0, 4);
  if (!tags.length) return '';
  return `<div class="ptags" data-marble-id="${mint()}">` + tags.map((t) =>
    `<span class="ptag tip" data-kind="${escAttr(t.kind)}" data-tip="${escAttr(t.tip)}" data-marble-id="${mint()}">${esc(t.label)}</span>`).join('') + `</div>`;
}

// ----------------------------------------------------------------- authors ---
// Every author, spelled out — an et-al hides exactly the person Bryan is
// scanning for. Each name is a control: click it once and it is marked as
// someone he knows, and from then on every paper that person appears on wears
// the mark. The page files a setAttr for the click, harvest folds it into
// state/authors.json, and the next morning's build renders it already lit.
const auSlug = (name) => String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function loadKnownAuthors() {
  try {
    const j = JSON.parse(fs.readFileSync(DEFAULTS.authors, 'utf8'));
    return new Map(Object.entries(j.known || {}).map(([k, v]) => [k, v && v.name ? v.name : k]));
  } catch { return new Map(); }
}

function rAuthors(authors, known) {
  const list = (Array.isArray(authors) ? authors : String(authors || '').split(/,\s*/)).map((a) => String(a).trim()).filter(Boolean);
  if (!list.length) return '';
  const chips = list.map((name) => {
    const sl = auSlug(name);
    const yes = known.has(sl);
    return `<button class="au tip" type="button" data-marble-transient data-au="${escAttr(sl)}"${yes ? ' data-known' : ''}` +
      ` data-tip="${escAttr(yes ? `${name}\nYou marked this one as someone you know.\nClick to unmark.` : `${name}\nClick if you know them — every paper they appear on will show it.`)}">${esc(name)}</button>`;
  }).join('');
  return `<div class="pau" data-marble-id="${mint()}">${chips}</div>`;
}

function rPapers(arxiv, prev) {
  const list = ((arxiv && arxiv.papers) || []).map((p) => ({ p, r: relOf(p) })).sort((a, b) => (b.r ?? -1) - (a.r ?? -1));
  const known = loadKnownAuthors();
  return list.map(({ p, r }) => {
    const title = String(p.title || '').trim();
    if (!title) return '';
    const key = p.key || slug(p.id || p.absUrl || title);
    const c = prev.rows[key] || {};
    const pub = (p.published || '').slice(0, 10);
    const authors = Array.isArray(p.authors) ? p.authors : [];
    const flags = (c.vote ? ` data-vote="${escAttr(c.vote)}"` : '') + (c.saved ? ' data-saved' : '') + (c.open ? ' data-open' : '');
    const th = thumb(p.image || p.pdfUrl || (p.id ? `https://arxiv.org/pdf/${p.id}` : ''), 'pthumb', 460);
    const tagHtml = rTags(p.tags);
    return [
      `  <div class="pcard expandable" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
      th ? `    ${th}` : '',
      `    <h4 class="ptitle" data-marble-id="${mint()}"><a href="${escAttr(p.absUrl || ('https://arxiv.org/abs/' + p.id))}" target="_blank" rel="noopener">${esc(title)}</a></h4>`,
      rAuthors(authors, known),
      tagHtml ? `    ${tagHtml}` : '',
      p.why ? `    <div class="pwhy" data-marble-id="${mint()}" data-marble-editable>${esc(p.why)}</div>` : '',
      `    <div class="pfoot" data-marble-id="${mint()}">${relPill(r)}<span class="pdate" data-marble-id="${mint()}">${esc(humanShortNoDow(pub) || pub)}</span><button class="exp-toggle" data-marble-transient data-exp>abstract</button></div>`,
      `    <div class="exp" data-marble-id="${mint()}"><div class="exp-inner" data-marble-id="${mint()}">`,
      `      <div class="abstract" data-marble-id="${mint()}">${esc(p.abstract || '')}</div>`,
      `      <div class="authors" data-marble-id="${mint()}"><a href="${escAttr(p.pdfUrl || ('https://arxiv.org/pdf/' + p.id))}" target="_blank" rel="noopener">PDF</a></div>`,
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
// Bryan reads Fahrenheit but lives in Zurich, so every temperature carries its
// Celsius quietly alongside. Faded, never competing with the number it explains.
const toC = (f) => Math.round((Number(f) - 32) * 5 / 9);
const bothT = (f, unit) => (unit || 'F') === 'F' ? `${f}°F / ${toC(f)}°C` : `${f}°C`;

// A row of numbers tells you today is 63 and tomorrow is 61. It does not tell
// you the shape of the day — where the warmth sits, how fast it falls off after
// dark. That shape is what a line carries and a column of digits cannot, so the
// hourly strip draws both: the readable number above, the curve underneath.
//
// One SVG spans the whole 48-hour track rather than one per cell, because a line
// broken at every hour is not a line. It is laid out as a grid whose columns are
// the hours, with the chart rows spanning column 1 to -1; that keeps every point
// registered to the hour above it without any measuring in script.
const WX_COL = 10;           // viewBox units per hour — the grid sets real width
function wxTempChart(hours, unit) {
  const n = hours.length;
  if (n < 2) return '';
  const H = 36, PAD = 7;
  const temps = hours.map((h) => h.temp);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const span = Math.max(1, hi - lo);
  const X = (i) => i * WX_COL + WX_COL / 2;
  const Y = (t) => H - PAD - ((t - lo) / span) * (H - PAD * 2);
  const pts = hours.map((h, i) => `${X(i)},${Y(h.temp).toFixed(2)}`);
  const area = `M${X(0)},${H} L${pts.join(' L')} L${X(n - 1)},${H} Z`;
  return `<svg class="wxc wxc-temp" viewBox="0 0 ${n * WX_COL} ${H}" preserveAspectRatio="none" role="img"` +
    ` aria-label="${escAttr(`Temperature over the next 48 hours, ranging ${bothT(lo, unit)} to ${bothT(hi, unit)}`)}" data-marble-id="${mint()}">` +
    `<path class="wxc-area" d="${area}"/>` +
    `<polyline class="wxc-line" points="${pts.join(' ')}" vector-effect="non-scaling-stroke"/></svg>`;
}
function wxPrecipChart(hours) {
  const n = hours.length;
  const pops = hours.map((h) => (h.pop == null ? 0 : h.pop));
  if (n < 2 || !pops.some((p) => p > 0)) return '';   // dry days draw nothing
  const H = 22;
  const X = (i) => i * WX_COL + WX_COL / 2;
  const Y = (p) => H - 1.5 - (p / 100) * (H - 4);
  const pts = hours.map((h, i) => `${X(i)},${Y(pops[i]).toFixed(2)}`);
  return `<svg class="wxc wxc-pop" viewBox="0 0 ${n * WX_COL} ${H}" preserveAspectRatio="none" role="img"` +
    ` aria-label="${escAttr(`Chance of precipitation over 48 hours, peaking at ${Math.max(...pops)} per cent`)}" data-marble-id="${mint()}">` +
    `<path class="wxc-area" d="M${X(0)},${H} L${pts.join(' L')} L${X(n - 1)},${H} Z"/>` +
    `<polyline class="wxc-line" points="${pts.join(' ')}" vector-effect="non-scaling-stroke"/></svg>`;
}

// Ten days, each hi/lo drawn as a bar on ONE shared scale across the whole
// column. A per-row scale would draw a mild day and a hot one identically, which
// is exactly the comparison the row is there to support.
function wxDaily(daily, unit) {
  const days = (daily || []).slice(0, 10);
  if (!days.length) return '';
  const lo = Math.min(...days.map((d) => d.lo));
  const hi = Math.max(...days.map((d) => d.hi));
  const span = Math.max(1, hi - lo);
  const rows = days.map((d, i) => {
    const l = ((d.lo - lo) / span) * 100, r = ((d.hi - lo) / span) * 100;
    const name = i === 0 ? 'Today' : new Date(`${d.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    const tip = `${name} · ${d.label}\nHigh ${bothT(d.hi, unit)} · Low ${bothT(d.lo, unit)}` +
      (d.pop != null ? `\n${d.pop}% chance of precipitation` : '');
    return `<div class="wxd-row tip" data-tip="${escAttr(tip)}" data-marble-id="${mint()}">` +
      `<span class="wxd-day" data-marble-id="${mint()}">${esc(name)}</span>` +
      `<span class="wxd-gl" data-marble-id="${mint()}">${esc(d.glyph)}` +
      (d.pop ? `<i class="wxd-pop" data-marble-id="${mint()}">${d.pop}%</i>` : '') + `</span>` +
      `<span class="wxd-lo" data-marble-id="${mint()}">${d.lo}°</span>` +
      `<span class="wxd-bar" style="--l:${l.toFixed(1)}%;--r:${r.toFixed(1)}%" data-marble-id="${mint()}"></span>` +
      `<span class="wxd-hi" data-marble-id="${mint()}">${d.hi}°</span></div>`;
  }).join('');
  return `<div class="wxd" data-marble-id="${mint()}">` +
    `<div class="wxd-hd" data-marble-id="${mint()}">10-day forecast</div>${rows}</div>`;
}

function rWeather(w) {
  if (!w || w.error) return `<p class="csub" data-marble-id="${mint()}">Weather unavailable this run.</p>`;
  const block = (c, here) => {
    if (!c) return '';
    const hours = (c.hourly || []).slice(0, 48);
    // The hour columns. A day boundary is a rule on the cell that starts the new
    // day plus its name above it — not a spacer column, because a spacer would
    // knock every point in the chart out of register with the hour it belongs to.
    let lastDay = null;
    const cells = hours.map((h) => {
      const day = h.day || String(h.time || '').slice(0, 10);
      const isNew = lastDay && day !== lastDay;
      lastDay = day;
      const tip = `${humanShort(day)} · ${hour12(h.hour)} — ${h.label}\n${bothT(h.temp, c.unit)}` +
        (h.feels != null ? `\nFeels like ${bothT(h.feels, c.unit)}` : '') +
        (h.pop != null ? `\n${h.pop}% chance of rain` : '');
      return `<div class="wx-hr tip${isNew ? ' wx-newday' : ''}" data-marble-id="${mint()}" data-tip="${escAttr(tip)}">` +
        `<div class="hh" data-marble-id="${mint()}">${isNew ? esc(humanShort(day).split(',')[0]) : hour12(h.hour)}</div>` +
        `<div class="he" data-marble-id="${mint()}">${esc(h.glyph)}</div>` +
        `<div class="ht" data-marble-id="${mint()}">${h.temp}°</div></div>`;
    }).join('');
    const tempChart = wxTempChart(hours, c.unit);
    const popChart = wxPrecipChart(hours);
    const popMax = Math.max(0, ...hours.map((h) => h.pop || 0));
    return [
      `  <div class="wx-block" data-marble-id="${mint()}" data-sky="${escAttr(c.now.sky || 'cloudy')}">`,
      `    <div class="wx-city" data-marble-id="${mint()}">${esc(c.city)}${here ? ' — you are here' : ''}</div>`,
      `    <div class="wx-now" data-marble-id="${mint()}">`,
      `      <span class="wx-emoji tip" data-marble-id="${mint()}" data-tip="${escAttr(`${c.city}: ${c.now.label}\nHigh ${bothT(c.today.hi, c.unit)} · Low ${bothT(c.today.lo, c.unit)}\nFeels like ${bothT(c.now.feels, c.unit)}${c.today.popMax != null ? `\n${c.today.popMax}% chance of rain today` : ''}`)}">${esc(c.now.glyph)}</span>`,
      `      <span class="wx-temp" data-marble-id="${mint()}">${c.now.temp}<sup>°${esc(c.unit || 'F')}</sup></span>`,
      ((c.unit || 'F') === 'F'
        ? `      <span class="wx-c tip" data-marble-id="${mint()}" data-tip="${escAttr(`${c.now.temp}°F is ${toC(c.now.temp)}°C`)}">${toC(c.now.temp)}°C</span>`
        : ''),
      `      <span class="wx-txt" data-marble-id="${mint()}"><span class="wx-cond" data-marble-id="${mint()}">${esc(c.now.label)}</span><br>`,
      `        <span class="wx-hilo tip" data-marble-id="${mint()}" data-tip="${escAttr(`High ${bothT(c.today.hi, c.unit)}\nLow ${bothT(c.today.lo, c.unit)}\nFeels like ${bothT(c.now.feels, c.unit)}`)}">H ${c.today.hi}° · L ${c.today.lo}° · feels ${c.now.feels}°${(c.unit || 'F') === 'F' ? ` <span class="wx-c" data-marble-id="${mint()}">${toC(c.today.hi)}° / ${toC(c.today.lo)}°C</span>` : ''}</span></span>`,
      `    </div>`,
      `    <p class="wx-rest" data-marble-id="${mint()}">${esc(restOfDay(c))}</p>`,
      `    <div class="wx-hrs" data-marble-id="${mint()}"><div class="wx-track" style="--wx-n:${hours.length}" data-marble-id="${mint()}">`,
      `      <div class="wx-cells" data-marble-id="${mint()}">${cells}</div>`,
      tempChart ? `      <div class="wx-band wx-band-t" data-marble-id="${mint()}">${tempChart}</div>` : '',
      popChart ? `      <div class="wx-band wx-band-p" data-marble-id="${mint()}">${popChart}</div>` : '',
      `    </div></div>`,
      popChart ? `    <div class="wx-legend" data-marble-id="${mint()}"><span class="wx-lg wx-lg-t tip" data-tip="${escAttr('The line is temperature across the next 48 hours.')}" data-marble-id="${mint()}">temperature</span><span class="wx-lg wx-lg-p tip" data-tip="${escAttr(`Chance of precipitation, peaking at ${popMax}%.`)}" data-marble-id="${mint()}">chance of rain · to ${popMax}%</span></div>` : '',
      `  </div>`,
    ].filter(Boolean).join('\n');
  };
  // Which city is "here" is the payload's to say (weather.here: "zurich" | "sanDiego"),
  // and that city reads first. It was fixed to Zurich, which would have gone on
  // telling Bryan he was there after the trip ended on 13 Sep.
  const blocks = w.here === "sanDiego"
    ? [block(w.sanDiego, true), block(w.zurich, false)]
    : [block(w.zurich, true), block(w.sanDiego, false)];
  return `<div class="wx" data-marble-id="${mint()}">\n${blocks.join("\n")}\n</div>` +
    srcLine('Open-Meteo', 'https://open-meteo.com/', 'meteo');
}

// The expanded reading of the same data: the ten-day strip, and the day's
// numbers spelled out. It is the same forecast, given room.
function rWeatherMore(w) {
  if (!w || w.error) return '';
  const one = (c) => {
    if (!c) return '';
    const sun = (t) => (t ? hour12(Number(String(t).slice(11, 13))) + String(t).slice(13, 16).replace(/^:00$/, '') : '—');
    return `<div class="wxm-city" data-marble-id="${mint()}">` +
      `<h4 class="wxm-h" data-marble-id="${mint()}">${esc(c.city)}</h4>` +
      `<div class="wxm-facts" data-marble-id="${mint()}">` +
      `<span data-marble-id="${mint()}"><b data-marble-id="${mint()}">Now</b>${bothT(c.now.temp, c.unit)}</span>` +
      `<span data-marble-id="${mint()}"><b data-marble-id="${mint()}">Feels</b>${bothT(c.now.feels, c.unit)}</span>` +
      `<span data-marble-id="${mint()}"><b data-marble-id="${mint()}">Sunrise</b>${esc(sun(c.today.sunrise))}</span>` +
      `<span data-marble-id="${mint()}"><b data-marble-id="${mint()}">Sunset</b>${esc(sun(c.today.sunset))}</span>` +
      (c.today.popMax != null ? `<span data-marble-id="${mint()}"><b data-marble-id="${mint()}">Rain today</b>${c.today.popMax}%</span>` : '') +
      `</div>${wxDaily(c.daily, c.unit)}</div>`;
  };
  const order = w.here === "sanDiego" ? [w.sanDiego, w.zurich] : [w.zurich, w.sanDiego];
  return `<div class="wxm" data-marble-id="${mint()}">${order.map(one).join("")}</div>`;
}

// The plain list: every date, in order, nothing distorted. The dot carries the
// urgency — one hue, more of it the closer the date is — so the column scans as
// a single gradient from now to far off.
function rKeyDatesList(dates, from) {
  const evs = (dates || []).map((d) => ({ ...d, n: daysUntil(d.date, from) }))
    .filter((d) => d.n != null && d.n >= 0).sort((a, b) => a.n - b.n);
  if (!evs.length) return `<p class="csub" data-marble-id="${mint()}">Nothing on the horizon.</p>`;
  const rows = evs.map((d) => {
    const label = String(d.label || '').trim() || '(untitled)';
    const tip = `${label}\n${humanShort(d.date)}  ·  ${d.n === 0 ? 'today' : `in ${d.n} day${d.n === 1 ? '' : 's'}`} (${urgencyWord(d.n)})${d.source ? `\nfrom ${d.source}` : ''}`;
    return [
      `  <li class="kd tip" data-marble-id="${mint()}" data-key="${escAttr(d.key || slug(d.date + '|' + label))}" style="--u:${urgencyVar(d.n)}" data-tip="${escAttr(tip)}">`,
      `    <span class="kd-dot" data-marble-id="${mint()}"></span>`,
      `    <span class="kd-when" data-marble-id="${mint()}">${d.n === 0 ? 'now' : d.n}<small data-marble-id="${mint()}">${d.n === 0 ? '' : 'd'}</small></span>`,
      `    <span class="kd-body" data-marble-id="${mint()}"><span class="kd-label" data-marble-id="${mint()}" data-marble-editable>${esc(label)}</span>`,
      `      <span class="kd-date" data-marble-id="${mint()}">${d.source ? icon(d.source) + ' ' : ''}${esc(humanShort(d.date))}</span></span>`,
      `  </li>`,
    ].join('\n');
  }).join('\n');
  return `<ul class="kdlist" data-marble-id="${mint()}">\n${rows}\n</ul>`;
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

// The week as it actually reads: a slate you scan for who won, with Bryan's
// team pulled out of the grid rather than buried in alphabetical order. A game
// that has not kicked off carries a time, never a zero — an unplayed game and a
// nil-nil draw must never look the same.
function rNflTeam(t, win) {
  const tip = `${t.name || ''}${t.record ? ` · ${t.record}` : ''}${win ? ' · won' : ''}`;
  return `<div class="nfl-t${win ? ' win' : ''} tip" data-tip="${escAttr(tip)}" data-marble-id="${mint()}">` +
    `<span class="nfl-ab" data-marble-id="${mint()}">${esc(t.abbr || '')}</span>` +
    `<span class="nfl-nm" data-marble-id="${mint()}">${esc(t.name || '')}</span>` +
    `<span class="nfl-sc" data-marble-id="${mint()}">${t.score == null ? '—' : esc(String(t.score))}</span></div>`;
}
function rNflWeek(n) {
  const days = (n.days || []).map((d) => {
    const games = (d.games || []).map((g) => {
      const aw = g.winner === 'a', hw = g.winner === 'h';
      const fav = g.fav ? ' fav' : '';
      return `<div class="nfl-g${fav}" data-marble-id="${mint()}"${g.fav ? ' data-fav' : ''}>` +
        rNflTeam(g.away, aw) + rNflTeam(g.home, hw) +
        `<div class="nfl-st${g.live ? ' live' : ''}" data-marble-id="${mint()}">${esc(g.status || '')}` +
        (g.note ? `<span class="nfl-gn" data-marble-id="${mint()}">${esc(g.note)}</span>` : '') + `</div></div>`;
    }).join('');
    return `<div class="nfl-day" data-marble-id="${mint()}">` +
      `<h3 class="nfl-dh" data-marble-id="${mint()}">${esc(d.label || '')}</h3>` +
      `<div class="nfl-games" data-marble-id="${mint()}">${games}</div></div>`;
  }).join('');
  return days || `<p class="csub" data-marble-id="${mint()}">No games this week.</p>`;
}

// One game, read the way a fan reads it: the scoreline, how it got there
// quarter by quarter, the plays that changed it, and where the game was won on
// the stat sheet. The bars are the only chart, because two numbers compared is
// the whole story a box score tells.
function rNflGame(g) {
  if (!g || !g.away) return `<p class="csub" data-marble-id="${mint()}">No game selected.</p>`;
  const side = (t, win) => `<div class="ng-side${win ? ' win' : ''}" data-marble-id="${mint()}">` +
    `<span class="ng-tn" data-marble-id="${mint()}">${esc(t.name || '')}</span>` +
    `<span class="ng-pts" data-marble-id="${mint()}">${esc(String(t.score ?? '—'))}</span></div>`;
  const q = g.quarters || {};
  const qt = (q.labels || []).length
    ? `<table class="ng-qt" data-marble-id="${mint()}"><thead><tr><th data-marble-id="${mint()}"></th>` +
      (q.labels || []).map((l) => `<th data-marble-id="${mint()}">${esc(l)}</th>`).join('') +
      `<th data-marble-id="${mint()}">T</th></tr></thead><tbody>` +
      [[g.away, q.away], [g.home, q.home]].map(([t, row]) =>
        `<tr data-marble-id="${mint()}"><th data-marble-id="${mint()}">${esc(t.abbr || t.name || '')}</th>` +
        (row || []).map((v) => `<td data-marble-id="${mint()}">${esc(String(v))}</td>`).join('') +
        `<td class="ng-tot" data-marble-id="${mint()}">${esc(String(t.score ?? ''))}</td></tr>`).join('') +
      `</tbody></table>` : '';
  const plays = (g.plays || []).map((p) =>
    `<li class="ng-play" data-marble-id="${mint()}"><span class="ng-pq tip" data-tip="${escAttr(`${p.q || ''} ${p.clock || ''}`)}" data-marble-id="${mint()}">${esc(p.q || '')}</span>` +
    `<span class="ng-pt" data-marble-id="${mint()}">${esc(p.text || '')}</span>` +
    `<span class="ng-pw" data-marble-id="${mint()}">${esc(p.at || '')}</span></li>`).join('');
  const stats = (g.stats || []).map((s) => {
    const a = Number(s.a) || 0, b = Number(s.b) || 0, tot = a + b || 1;
    const pct = Math.round((a / tot) * 100);
    return `<div class="ng-stat" data-marble-id="${mint()}">` +
      `<span class="ng-sl" data-marble-id="${mint()}">${esc(s.label || '')}</span>` +
      `<span class="ng-sv" data-marble-id="${mint()}">${esc(s.av ?? String(a))}</span>` +
      `<span class="ng-bar tip" data-tip="${escAttr(`${s.label}\n${g.away.abbr}: ${s.av ?? a}\n${g.home.abbr}: ${s.bv ?? b}`)}" data-marble-id="${mint()}">` +
      `<i style="width:${pct}%" data-marble-id="${mint()}"></i></span>` +
      `<span class="ng-sv ng-sb" data-marble-id="${mint()}">${esc(s.bv ?? String(b))}</span></div>`;
  }).join('');
  const leaders = (g.leaders || []).map((l) =>
    `<li class="ng-lrow" data-marble-id="${mint()}"><span class="ng-lr" data-marble-id="${mint()}">${esc(l.role || '')}</span>` +
    `<span class="ng-ln" data-marble-id="${mint()}">${esc(l.name || '')}</span>` +
    `<span class="ng-ll" data-marble-id="${mint()}">${esc(l.line || '')}</span></li>`).join('');
  const box = (t, body) => body
    ? `<div class="ng-box" data-marble-id="${mint()}"><h4 class="ng-bt" data-marble-id="${mint()}">${esc(t)}</h4>${body}</div>` : '';
  return `<div class="ng" data-marble-id="${mint()}">` +
    `<div class="ng-head" data-marble-id="${mint()}">` + side(g.away, g.winner === 'a') +
    `<span class="ng-vs" data-marble-id="${mint()}">${esc(g.vs || 'at')}</span>` + side(g.home, g.winner === 'h') + `</div>` +
    (g.meta ? `<p class="ng-meta" data-marble-id="${mint()}" data-marble-editable>${esc(g.meta)}</p>` : '') +
    `<div class="ng-grid" data-marble-id="${mint()}">` +
      box('By quarter', qt) +
      box('How it was scored', plays ? `<ul class="ng-plays" data-marble-id="${mint()}">${plays}</ul>` : '') +
      box('Where it was won', stats ? `<div class="ng-stats" data-marble-id="${mint()}">${stats}</div>` : '') +
      box('Leaders', leaders ? `<ul class="ng-lead" data-marble-id="${mint()}">${leaders}</ul>` : '') +
    `</div>` +
    (g.next ? `<p class="ng-next" data-marble-id="${mint()}" data-marble-editable>${esc(g.next)}</p>` : '') +
    `</div>`;
}

function rPalStrip(pal) {
  return `<span class="pal-chips" data-marble-id="${mint()}">${pal.swatches.slice(0, 4).map((h) => `<i class="tip" style="background:${escAttr(h)}" data-tip="${escAttr(h)}" data-marble-id="${mint()}"></i>`).join('')}</span>` +
    `<span class="pal-name" data-marble-id="${mint()}">${esc(pal.name)}</span>`;
}

// ------------------------------------------------------------- composition ---

const CAT = { focus: 'var(--warm)', push: 'var(--accent)', todos: 'var(--accent)', news: 'var(--c1)', papers: 'var(--c2)', weather: 'var(--c3)', calendar: 'var(--accent-ink)', usopen: 'var(--c4)', nfl: 'var(--c1)', art: 'var(--c4)', roadahead: 'var(--accent)', custom: 'var(--accent)' };
const TITLE = { focus: 'Today, sharply', push: 'Push one thing forward', todos: 'To-dos', news: 'Worth your attention', papers: 'Fresh on arXiv · cs.HC', weather: 'Sky', calendar: 'The weeks ahead', usopen: 'US Open', nfl: 'NFL', art: "Today's colour", roadahead: 'The road ahead' };
// Reverse of TITLE, for issues built before `data-comp` existed on `<section>` 
// -- sweepFeedback falls back to matching a component's header text against this.
const TITLE_TO_TYPE = Object.fromEntries(Object.entries(TITLE).map(([type, t]) => [t, type]));

function componentBody(type, node, P, prev, pal) {
  switch (type) {
    case 'focus':
      // No fixed number. This is the list of what actually has to happen today,
      // and some days that is one thing and some days it is six.
      return { html: `<ol class="list" data-marble-id="${mint()}" data-marble-sortable="focus">\n${rChecklist(P.focus, prev, 'focus')}\n</ol>\n<button class="add" data-marble-transient data-marble-add="#tpl-focus" data-marble-into="prev">a priority</button>`, n: (P.focus || []).length };
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
      // Front page leads unless Bryan has since chosen otherwise in the page (8 Sep).
      const view = node.view || prev.views.news || 'cal';
      return {
        n: total, view, viewKey: 'news',
        seg: `<span class="seg" role="group" aria-label="How to read the news"><button data-setview="list">Reading</button><button data-setview="cal">Front page</button></span>`,
        html: `<div class="v v-list" data-marble-id="${mint()}">${subs}</div>\n` +
          `<div class="v v-cal" data-marble-id="${mint()}">${rNewsMosaic(f, prev)}</div>`,
      };
    }
    case 'papers': {
      const a = P.arxiv || {};
      const n = (a.papers || []).length;
      // payload.arxiv.sub overrides the line when the grid is not one day's listing
      // (a backfilled paper, a watched author) and the default would misdate it.
      const sub = a.error ? 'arXiv unavailable this run.'
        : a.sub ? String(a.sub) : `${n} paper${n === 1 ? '' : 's'} from ${humanShort((a.newestDate || '').slice(0, 10)) || '—'} · sorted by fit to your research`;
      return { html: `<p class="csub" data-marble-id="${mint()}">${esc(sub)}</p>\n<div class="pgrid" data-marble-id="${mint()}" data-marble-sortable="papers">\n${rPapers(a, prev)}\n</div>` +
        srcLine('arXiv cs.HC new submissions', 'https://arxiv.org/list/cs.HC/recent', 'arxiv'), n };
    }
    case 'weather': {
      const more = rWeatherMore(P.weather);
      return { html: rWeather(P.weather), more, moreTip: 'Ten-day forecast, sun times, and the day in full' };
    }
    case 'calendar': {
      // Two readings of the same dates: the timeline, which puts them in space,
      // and the list, which just tells you what is next. The old compressed /
      // to-scale pair drew nearly the same picture twice.
      const raw = node.view || prev.views.calendar || 't';
      const view = raw === 'l' ? 'l' : 't';
      const n = (P.keyDates || []).filter((d) => daysUntil(d.date, P.date) >= 0).length;
      return {
        n, view, viewKey: 'calendar',
        seg: `<span class="seg" role="group" aria-label="How to read what is coming"><button data-setview="t">Timeline</button><button data-setview="l">List</button></span>`,
        html: `<div class="v v-t" data-marble-id="${mint()}">${rTimelineY(P.keyDates, P.date, 'c')}</div>\n` +
              `<div class="v v-l" data-marble-id="${mint()}">${rKeyDatesList(P.keyDates, P.date)}</div>`,
      };
    }
    case 'usopen': {
      const u = P.usOpen || {};
      if (u.error) return { html: `<p class="csub" data-marble-id="${mint()}">US Open data unavailable.</p>` };
      const view = node.view || prev.views.usopen || 'top';
      return {
        view, viewKey: 'usopen',
        seg: `<span class="seg" role="group" aria-label="Which draw"><button data-setview="top">Now</button><button data-setview="men">Men</button><button data-setview="women">Women</button></span>`,
        html: (u.note ? `<p class="csub" data-marble-id="${mint()}">${esc(u.note)}</p>\n` : '') +
          `<div class="v v-top" data-marble-id="${mint()}">${rUsoNow(u)}</div>\n` +
          `<div class="v v-men" data-marble-id="${mint()}">${rBracket(u.men)}</div>\n` +
          `<div class="v v-women" data-marble-id="${mint()}">${rBracket(u.women)}</div>` +
          srcLine(u.sourceName || 'US Open — official draws', u.sourceUrl || 'https://www.usopen.org/en_US/scores/draws/', 'web'),
      };
    }
    case 'nfl': {
      const n = P.nfl || {};
      if (n.error) return { html: `<p class="csub" data-marble-id="${mint()}">NFL data unavailable.</p>` };
      const view = node.view || prev.views.nfl || 'week';
      const done = (n.days || []).flatMap((d) => d.games || []).filter((g) => g.winner).length;
      return {
        n: done || undefined, sub: n.sub, view, viewKey: 'nfl',
        seg: `<span class="seg" role="group" aria-label="Which reading of the week"><button data-setview="week">The week</button><button data-setview="niners">Niners</button></span>`,
        html: (n.note ? `<p class="csub" data-marble-id="${mint()}">${esc(n.note)}</p>\n` : '') +
          `<div class="v v-week" data-marble-id="${mint()}">${rNflWeek(n)}</div>\n` +
          `<div class="v v-niners" data-marble-id="${mint()}">${rNflGame(n.game)}</div>` +
          srcLine(n.sourceName || 'NFL.com — Week 1 scores', n.sourceUrl || 'https://www.nfl.com/scores/2026/week-1', 'web'),
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
        // The swatches are the day's palette; opened up, they say which colour
        // is doing which job, and give the hex you would actually paste.
        more: `<div class="pal-more" data-marble-id="${mint()}">` +
          `<div class="pal-title" data-marble-id="${mint()}">${esc(pal.name)}</div>` +
          pal.swatches.map((hex, i) => `<div class="pal-row" data-marble-id="${mint()}">` +
            `<span class="pal-sw" style="background:${escAttr(hex)}" data-marble-id="${mint()}"></span>` +
            `<code class="pal-hex" data-marble-id="${mint()}">${esc(hex)}</code>` +
            `<span class="pal-role" data-marble-id="${mint()}">${esc(['accent — what the eye lands on', 'warm — urgency and near dates', 'a supporting hue', 'a supporting hue', 'a supporting hue'][i] || 'a supporting hue')}</span></div>`).join('') +
          (h.credit ? `<p class="pal-note" data-marble-id="${mint()}">Drawn from ${esc(h.credit)}.</p>` : '') + `</div>`,
        moreTip: 'The full palette, with the hex values',
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
  // A component may carry a second, fuller reading of the same data. It stays
  // out of the way until asked for: a chevron at the top right of the header,
  // and the panel opens in place. The open/shut state is filed like a view is,
  // so the page reopens the way Bryan left it.
  const expKey = built.more ? (built.expKey || node.type) : '';
  const isOpen = built.more ? (node.expanded != null ? !!node.expanded : !!(prev.expanded || {})[expKey]) : false;
  const cls = ['comp', treatment, 'reveal', built.view ? 'viewbox' : '', built.more ? 'expandable-comp' : ''].filter(Boolean).join(' ');
  const viewAttrs = (built.view ? ` data-view="${escAttr(built.view)}" data-view-key="${escAttr(built.viewKey)}"` : '')
    + (built.more ? ` data-exp-key="${escAttr(expKey)}"${isOpen ? ' data-expanded' : ''}` : '');
  const head = title
    ? `  <div class="chead"><h2 data-marble-id="${mint()}">${esc(title)}</h2>` +
      (built.n ? `<span class="n" data-marble-id="${mint()}">${built.n}</span>` : '') +
      (built.sub ? `<span class="n" data-marble-id="${mint()}">${esc(built.sub)}</span>` : '') +
      (built.seg || built.more
        ? `<span class="right" data-marble-transient>${built.seg || ''}${built.more
            ? `<button class="comp-exp tip" data-comp-exp aria-label="Show more detail" data-tip="${escAttr(built.moreTip || 'More detail')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>`
            : ''}</span>`
        : '') + `</div>\n`
    : '';
  const more = built.more ? `\n  <div class="comp-more" data-marble-id="${mint()}">${built.more}</div>` : '';
  return `<section class="${cls}" data-comp="${escAttr(node.type)}" data-marble-id="${mint()}" style="--cat: ${cat}"${viewAttrs}>\n${head}${built.html}${more}\n</section>`;
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
// Issues are named for the day, not dated — "Two days to CHI.mrbl" tells you
// what that morning was about in a way "2026-09-08.mrbl" never does. The date
// lives in the file's own metadata, which is what we sort on.
const ISSUE_DATE_RE = /<meta\s+name="(?:day|newsletter):date"\s+content="([^"]+)"/i;
function issueDateOf(file) {
  try { return (fs.readFileSync(file, 'utf8').slice(0, 2000).match(ISSUE_DATE_RE) || [])[1] || null; }
  catch { return null; }
}
function newestIssue() {
  try {
    const rows = fs.readdirSync(DEFAULTS.dir)
      .filter((x) => x.endsWith('.mrbl') && x !== 'today.mrbl' && x !== 'index.mrbl')
      .map((x) => path.join(DEFAULTS.dir, x))
      .map((f) => ({ f, d: issueDateOf(f) }))
      .filter((r) => r.d)
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return rows.length ? rows[rows.length - 1].f : null;
  } catch { return null; }
}

// Keep it readable in a Drive listing: real spaces and capitals, only the
// characters a filesystem refuses stripped out.
function issueFileName(title, date) {
  const clean = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 70);
  return `${clean || date}.mrbl`;
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
  const title = String(P.title || '').trim() || date;
  P.title = title;
  let outPath = args.out || path.join(DEFAULTS.dir, issueFileName(title, date));
  // Two mornings can land on the same theme; the older one keeps its name.
  if (!args.out && fs.existsSync(outPath) && issueDateOf(outPath) && issueDateOf(outPath) !== date) {
    outPath = path.join(DEFAULTS.dir, issueFileName(`${title} (${date})`, date));
  }
  const prevFile = fs.existsSync(DEFAULTS.stable) ? DEFAULTS.stable : (newestIssue() || outPath);
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
  // The masthead reads as the top of the stream, not as a banner over the whole
  // page: same left edge as everything you read down, stacked top to bottom.
  const masthead = [
    `      <header class="masthead" data-marble-id="${mint()}">`,
    `        <span class="date" data-marble-id="${mint()}">${esc(humanLongUpper(date))}</span>`,
    `        <span class="greet" data-marble-id="${mint()}" data-marble-editable>${esc(P.greeting || 'Good morning, Bryan.')}</span>`,
    summary ? `        <p class="sub" data-marble-id="${mint()}" data-marble-editable>${esc(summary)}</p>` : '',
    `      </header>`,
  ].filter(Boolean).join('\n');

  const body = [
    `  <div class="shell" data-marble-id="${mint()}">`,
    `    <aside class="rail" data-marble-id="${mint()}">`,
    rail,
    `    </aside>`,
    `    <div class="stream" data-marble-id="${mint()}">`,
    masthead,
    stream,
    `    </div>`,
    tailNodes.length ? `    <aside class="tail" data-marble-id="${mint()}">\n${tail}\n    </aside>` : '',
    `  </div>`,
    ``,
    `  <footer class="colophon" data-marble-id="${mint()}"><span data-marble-id="${mint()}">Assembled for you from</span> ${srcs} <span data-marble-id="${mint()}">&nbsp;·&nbsp; palette <b data-marble-id="${mint()}">${esc(pal.name)}</b></span></footer>`,
  ].filter(Boolean).join('\n');

  let html = fs.readFileSync(DEFAULTS.shell, 'utf8');
  html = html.replaceAll('__DATE__', escAttr(date)).replaceAll('__PALETTE_NAME__', escAttr(pal.name));
  html = html.replaceAll('__TITLE__', esc(title));
  html = html.replace('__DESIGN__', fs.readFileSync(DEFAULTS.design, 'utf8'));
  const fontCss = fs.existsSync(DEFAULTS.fontCss) ? fs.readFileSync(DEFAULTS.fontCss, 'utf8') : '';
  html = html.replace('__FONT__', fontCss ? `<style id="nl-font">\n${fontCss}\n</style>` : '<style id="nl-font"></style>');
  html = html.replace('__PALETTE__', paletteStyle(pal));
  html = html.replace('__BODY__', body);

  const check = selfCheck(html);
  if (!check.ok) die(`self-check failed:\n  - ${check.problems.join('\n  - ')}`);

  const out = {
    date, title, out: outPath, stable: DEFAULTS.stable, palette: pal.name,
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
  if (!/<meta name="day:date" content="\d{4}-\d{2}-\d{2}">/.test(html)) problems.push('missing day:date meta');
  if (!/id="nl-palette"/.test(html)) problems.push('palette not injected');
  if (!/marble\.register\(/.test(html)) problems.push('affordance script missing');
  // The ban is on components that scroll *vertically* inside themselves. A
  // deliberately horizontal track (the timeline) is a different thing and says so
  // in its name, so match the bare `scroll` class as a whole token.
  if (/class="(?:[^"]*\s)?scroll(?:\s[^"]*)?"/.test(html)) problems.push('a component uses inner vertical scrolling — not allowed');
  if (/overflow-y:\s*(auto|scroll)/.test(html.replace(/tl[xy]-scroll[\s\S]{0,400}?}/g, ''))) problems.push('overflow-y scrolling found outside the timeline track');
  return { ok: problems.length === 0, problems };
}

// Which authors Bryan marked as known, read back out of the page he clicked in.
// Names come from the button text so the record stays human-readable.
function harvestAuthors(file) {
  let html = '';
  try { html = fs.readFileSync(file, 'utf8'); } catch { return { added: 0, total: 0 }; }
  let state = { _note: 'Authors Bryan marked as people he knows, by clicking their name on a paper. Every future issue renders them already marked. Written by \`build.mjs harvest\`.', known: {}, updated: null };
  try { state = JSON.parse(fs.readFileSync(DEFAULTS.authors, 'utf8')); } catch {}
  state.known = state.known || {};
  let added = 0;
  for (const m of html.matchAll(/<button class="au[^"]*"[^>]*data-au="([^"]*)"([^>]*)>([\s\S]*?)<\/button>/g)) {
    if (!/\bdata-known\b/.test(m[2])) continue;
    const sl = m[1]; if (!sl) continue;
    if (!state.known[sl]) { state.known[sl] = { name: stripTags(m[3]).trim() || sl, markedOn: todayYmd() }; added++; }
  }
  state.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(DEFAULTS.authors), { recursive: true });
  fs.writeFileSync(DEFAULTS.authors, JSON.stringify(state, null, 2) + '\n');
  return { added, total: Object.keys(state.known).length };
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
  const carried = args['dry-run'] ? loadCarry() : carry(file, rb.date);
  const authors = args['dry-run'] ? { added: 0, total: loadKnownAuthors().size } : harvestAuthors(file);
  if (!args['dry-run']) {
    fs.mkdirSync(path.dirname(DEFAULTS.seen), { recursive: true });
    fs.writeFileSync(DEFAULTS.seen, JSON.stringify({ keys: [...keys].sort(), updated: new Date().toISOString() }, null, 2));
  }
  console.log(JSON.stringify({ issueDate: rb.date, seenTotal: keys.size, saved, votes, authorsKnown: authors,
    carried: { newFromBryan: carried.added ?? 0, retired: carried.retired ?? 0, open: (carried.open || carried.items || []).length } }, null, 2));
}

// -------------------------------------------------------------------- main ---

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
// ---------------------------------------------------------------- feedback ---
// Bryan does not file tickets. When he wants this dashboard to change, he types
// it into the page — into a note under a row, or a to-do he adds himself — and
// that sentence then sits in one morning's file and is never seen again.
//
// This sweeps every issue ever written for those sentences, drops the ones a
// later run already acted on, and hands the rest back. It is deliberately
// generous about what counts: a note is Bryan's own words, so it is surfaced
// whether or not it trips the hint pattern; `likely` only marks the ones that
// read like a request so a run can lead with them.
const FB_HINT = /\b(add|adds|added|remove|drop|make|show|hide|instead|next time|tomorrow|please|can you|could you|i want|i'd like|would like|prefer|too (?:small|big|large|many|few|long|short|dense|busy)|label|tag|colou?r|font|smaller|bigger|larger|move|swap|stop|don'?t|do not|always|never|why (?:is|does|isn'?t)|should)\b/i;

function fbId(text) { return crypto.createHash('sha1').update(String(text).trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 8); }

function loadFeedbackState() {
  try { return JSON.parse(fs.readFileSync(DEFAULTS.feedback, 'utf8')); }
  catch {
    return { _note: 'Requests Bryan typed into the pages themselves. `applied` records what a run has already acted on so it stops resurfacing. Written by `build.mjs feedback --apply`.', applied: {}, updated: null };
  }
}

function sweepFeedback(opts = {}) {
  const state = loadFeedbackState();
  const applied = state.applied || {};
  const files = fs.existsSync(DEFAULTS.dir)
    ? fs.readdirSync(DEFAULTS.dir).filter((f) => f.endsWith('.mrbl') && f !== 'index.mrbl').map((f) => path.join(DEFAULTS.dir, f))
    : [];
  const found = new Map();
  for (const file of files) {
    let html = '';
    try { html = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const date = (/<meta name="(?:day|newsletter):date" content="([^"]*)">/.exec(html) || [, ''])[1] || '';
    const title = stripTags((/<title>([\s\S]*?)<\/title>/.exec(html) || [, ''])[1]).trim();

    // Which component a note sits in, so a request can be read in context.
    // `data-comp` names the type reliably; older issues built before it existed
    // fall back to matching the header text against each type's default title —
    // good enough for anything Bryan hasn't retitled.
    const sections = [];
    for (const m of html.matchAll(/<section class="comp\b[^"]*"[^>]*>/g)) {
      const tag = m[0];
      const head = html.slice(m.index, m.index + 900);
      const name = stripTags((/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(head) || [, ''])[1]).trim();
      const type = (/\bdata-comp="([^"]*)"/.exec(tag) || [, ''])[1] || TITLE_TO_TYPE[name] || '';
      sections.push({ at: m.index, name, type });
    }
    const sectionAt = (i) => { let s = { name: '', type: '' }; for (const sec of sections) { if (sec.at <= i) s = sec; else break; } return s; };
    const READING_TYPES = new Set(['papers', 'news', 'feed']);

    // every note Bryan left, wherever it is
    for (const m of html.matchAll(/<div class="note"[^>]*>([\s\S]*?)<\/div>/g)) {
      const text = stripTags(m[1]).trim();
      if (!text) continue;
      const before = html.slice(Math.max(0, m.index - 2600), m.index);
      const on = stripTags((/<(?:div|h4) class="(?:title|ntitle|ptitle|mo-title)"[^>]*>([\s\S]*?)<\/(?:div|h4)>/g.exec(before.split(/<(?:li|div class="(?:ncard|pcard|mo)[ "])/).pop() || '') || [, ''])[1]).trim();
      const id = fbId(text);
      const prev = found.get(id);
      if (prev) { if (date > prev.lastSeen) prev.lastSeen = date; prev.seenIn = Math.min(prev.seenIn + 1, 99); continue; }
      const sec = sectionAt(m.index);
      found.set(id, { id, text, where: sec.name || 'somewhere in the page', component: sec.type, kind: READING_TYPES.has(sec.type) ? 'reading' : 'dashboard', on, firstSeen: date, lastSeen: date, seenIn: 1, issue: title, likely: FB_HINT.test(text) });
    }
    // and anything he thumbed down — not words, but a judgement worth reading
    for (const m of html.matchAll(/data-vote="down"[\s\S]{0,1400}?<(?:div|h4) class="(?:title|ntitle|ptitle)"[^>]*>([\s\S]*?)<\/(?:div|h4)>/g)) {
      const on = stripTags(m[1]).trim();
      if (!on) continue;
      const id = fbId('down:' + on);
      if (found.has(id)) continue;
      const sec = sectionAt(m.index);
      found.set(id, { id, text: `(thumbed down) ${on}`, where: sec.name || '', component: sec.type, kind: READING_TYPES.has(sec.type) ? 'reading' : 'dashboard', on, firstSeen: date, lastSeen: date, seenIn: 1, issue: title, likely: false, vote: 'down' });
    }
  }
  const all = [...found.values()].sort((a, b) => (b.likely - a.likely) || String(b.lastSeen).localeCompare(String(a.lastSeen)));
  const open = all.filter((f) => !applied[f.id]);
  return {
    issuesScanned: files.length,
    open: opts.all ? all : open,
    openCount: open.length,
    likelyCount: open.filter((f) => f.likely).length,
    appliedCount: Object.keys(applied).length,
    applied: opts.all ? applied : undefined,
  };
}

function applyFeedback(ids, change) {
  const state = loadFeedbackState();
  state.applied = state.applied || {};
  const swept = sweepFeedback({ all: true });
  const byId = Object.fromEntries(swept.open.map((f) => [f.id, f]));
  const done = [];
  for (const id of ids) {
    const f = byId[id];
    state.applied[id] = { text: f ? f.text : '(not found in the current sweep)', from: f ? f.firstSeen : null, appliedOn: todayYmd(), change: change || '' };
    done.push(id);
  }
  state.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(DEFAULTS.feedback), { recursive: true });
  fs.writeFileSync(DEFAULTS.feedback, JSON.stringify(state, null, 2) + '\n');
  return { marked: done, appliedCount: Object.keys(state.applied).length };
}

if (cmd === 'readback') console.log(JSON.stringify(readback(args._[1] || args.file || DEFAULTS.stable), null, 2));
else if (cmd === 'feedback') {
  if (args.apply) {
    const ids = String(args.apply).split(',').map((x) => x.trim()).filter(Boolean);
    console.log(JSON.stringify(applyFeedback(ids, args.change || args.note || ''), null, 2));
  } else console.log(JSON.stringify(sweepFeedback({ all: !!args.all }), null, 2));
}
else if (cmd === 'dates') console.log(JSON.stringify(sweepDates(), null, 2));
else if (cmd === 'assemble') assemble(args);
else if (cmd === 'harvest') harvest(args);
else if (cmd === 'carry') {
  const file = args.file || args._[1] || DEFAULTS.stable;
  if (args.list) console.log(JSON.stringify(loadCarry(), null, 2));
  else console.log(JSON.stringify(carry(file, null), null, 2));
}
else if (cmd === 'check') {
  const file = args.file || args._[1] || DEFAULTS.stable;
  if (!fs.existsSync(file)) die(`no file at ${file}`);
  const r = selfCheck(fs.readFileSync(file, 'utf8'));
  if (!r.ok) die(`self-check failed:\n  - ${r.problems.join('\n  - ')}`);
  try { execFileSync('node', [DEFAULTS.layoutTool, file], { stdio: 'inherit' }); } catch { process.exit(1); }
  console.log('[day] check: ok');
} else {
  console.log(`Bryan's Days — build.mjs
  readback [file] | dates | carry [file] [--list] | assemble --payload <f|-> [--dry-run]
  harvest [file] | check [--file F] | feedback [--all] [--apply <id,id>] [--change "..."]
  composes drive/Bryan's Days/<the day's theme>.mrbl (mirrored to today.mrbl) from payload.layout
  carry  — folds to-dos Bryan typed himself into state/carry.json so they outlive the issue
  feedback — sweeps every past issue for notes Bryan wrote asking this dashboard to change`);
  if (cmd) die(`unknown command "${cmd}"`);
}
