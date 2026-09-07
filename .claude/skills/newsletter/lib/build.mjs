#!/usr/bin/env node
// build.mjs — the mechanical half of Bryan's Bulletin.
//
// The skill (SKILL.md) does the thinking: it gathers focus items, todos, key
// dates, weather, US Open, the feed, and today's arXiv cs.HC, and it authors the
// "road ahead" representation. It hands the result here as one JSON payload.
// This file does the parts that should be identical every day:
//
//   readback  <file>              print interaction state left in a prior issue
//   dates                         print date candidates from key-dates.md + third-year.mrbl
//   assemble  --payload <p|->     archive yesterday, render today from the template, verify
//   harvest   [file]              update state/seen.json, print saved items + votes
//   check     --file <file>       run the invariant self-check alone
//
// One file per run (drive/Newsletter/today.mrbl), written atomically after
// archiving the previous one. Talks to no network except optional image inlining
// (via images.mjs) of http image URLs found in the payload.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const REPO = path.resolve(SKILL, '..', '..', '..');

const DEFAULTS = {
  template: path.join(SKILL, 'template.mrbl'),
  out: path.join(REPO, 'drive', 'Newsletter', 'today.mrbl'),
  archiveDir: path.join(REPO, 'drive', 'Newsletter', 'archive'),
  keyDates: path.join(SKILL, 'key-dates.md'),
  thirdYear: path.join(REPO, 'drive', 'Travel', 'third-year.mrbl'),
  seen: path.join(SKILL, 'state', 'seen.json'),
  palettes: path.join(SKILL, 'lib', 'palettes.json'),
  paletteState: path.join(SKILL, 'state', 'palettes.json'),
  imagesTool: path.join(HERE, 'images.mjs'),
};
const IMAGE_BUDGET = 14;

// ---------------------------------------------------------------- small helpers

const die = (msg) => { console.error(`[bulletin] ${msg}`); process.exit(1); };

const esc = (s) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const decodeEntities = (s) =>
  String(s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const stripTags = (s) => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, '')).trim();

const slug = (s) =>
  String(s ?? '').toLowerCase().replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x';

const usedIds = new Set();
function mint() {
  let id;
  do { id = crypto.randomBytes(5).toString('hex').slice(0, 8); } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

function atLocalNoon(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function daysUntil(ymd, fromYmd) {
  const a = atLocalNoon(ymd), b = atLocalNoon(fromYmd || todayYmd());
  if (!a || !b) return null;
  return Math.round((a - b) / 86400000);
}
const humanLong = (ymd) => {
  const d = atLocalNoon(ymd);
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
};
const humanShort = (ymd) => {
  const d = atLocalNoon(ymd);
  return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
};
const humanShortNoDow = (ymd) => {
  const d = atLocalNoon(ymd);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
};

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

// Splice `inner` between an empty element's tags, matched by data-marble-id.
function fill(html, id, inner) {
  const re = new RegExp(`(data-marble-id="${id}"[^>]*>)(\\s*)(</[a-zA-Z0-9]+>)`);
  if (!re.test(html)) die(`fill: no empty element data-marble-id="${id}" in template`);
  return html.replace(re, (_a, openEnd, _ws, closeTag) => `${openEnd}\n${inner}\n${closeTag}`);
}
function setAttrOn(html, id, name, value) {
  const re = new RegExp(`(<[a-zA-Z0-9]+\\b[^>]*\\bdata-marble-id="${id}")([^>]*)(>)`);
  return html.replace(re, (_a, pre, mid, gt) => {
    const cleaned = mid.replace(new RegExp(`\\s${name}="[^"]*"`), '');
    return `${pre}${cleaned} ${name}="${escAttr(value)}"${gt}`;
  });
}

// --------------------------------------------------------------------- palette

function pickPalette(dateSeed, override) {
  const lib = JSON.parse(fs.readFileSync(DEFAULTS.palettes, 'utf8')).palettes;
  if (override != null) {
    const byName = lib.find((p) => p.name.toLowerCase() === String(override).toLowerCase());
    if (byName) return { pal: byName, recorded: false };
    const i = Number(override);
    if (Number.isInteger(i) && lib[i]) return { pal: lib[i], recorded: false };
  }
  let recent = [];
  try { recent = JSON.parse(fs.readFileSync(DEFAULTS.paletteState, 'utf8')).recent || []; } catch {}
  const avoid = new Set(recent.slice(-6));
  const pool = lib.filter((p) => !avoid.has(p.name));
  const choices = pool.length ? pool : lib;
  let h = 0;
  for (const ch of String(dateSeed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pal = choices[h % choices.length];
  return { pal, recorded: true, recent: [...recent, pal.name].slice(-24) };
}

const ROLE_VARS = {
  bg: '--bg', panel: '--panel', ink: '--ink', muted: '--muted', faint: '--faint',
  line: '--line', accent: '--accent', accentSoft: '--accent-soft', accentInk: '--accent-ink', warm: '--warm',
};
const roleBlock = (roles) =>
  Object.entries(ROLE_VARS).map(([k, v]) => `${v}:${roles[k]}`).join(';');

function paletteStyle(pal) {
  return (
    `<style id="nl-palette">\n` +
    `:root{${roleBlock(pal.light)}}\n` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${roleBlock(pal.dark)}}}\n` +
    `:root[data-theme="dark"]{${roleBlock(pal.dark)}}\n` +
    `:root[data-theme="light"]{${roleBlock(pal.light)}}\n` +
    `</style>`
  );
}
function renderSwatches(pal) {
  const chips = pal.swatches.slice(0, 4)
    .map((h) => `<i style="background:${escAttr(h)}" data-marble-id="${mint()}"></i>`).join('');
  return `<div class="chips" data-marble-id="${mint()}">${chips}</div>` +
    `<span class="pname" data-marble-id="${mint()}">${esc(pal.name)}</span>`;
}

// --------------------------------------------------------------- image inlining

let imagesInlined = 0;
function inlineImage(src, width = 480) {
  if (!src) return '';
  if (src.startsWith('data:')) return src;
  if (!/^https?:\/\//i.test(src)) return '';
  if (imagesInlined >= IMAGE_BUDGET) return '';
  try {
    const uri = execFileSync('node', [DEFAULTS.imagesTool, src, '--width', String(width), '--quiet'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim();
    if (uri.startsWith('data:')) { imagesInlined += 1; return uri; }
  } catch {}
  return '';
}

// --------------------------------------------------------------------- readback

function readback(file) {
  if (!fs.existsSync(file)) return { exists: false, date: null, rows: {}, dateView: null };
  const html = fs.readFileSync(file, 'utf8');
  const dateM = /<meta name="newsletter:date" content="([^"]*)">/.exec(html);
  const dvM = /data-marble-id="nl-p-dates"[^>]*\bdata-view="([^"]*)"/.exec(html);
  const rows = {};
  const chunks = html.split(/(?=<li\b)/);
  for (const chunk of chunks) {
    const tagM = /^<li\b([^>]*)>/.exec(chunk);
    if (!tagM) continue;
    const attrs = tagM[1];
    const keyM = /data-key="([^"]*)"/.exec(attrs);
    if (!keyM) continue;
    const body = chunk.slice(0, chunk.indexOf('</li>') + 5);
    const noteM = /<div class="note"[^>]*>([\s\S]*?)<\/div>/.exec(body);
    const titleM = /<div class="title"[^>]*>([\s\S]*?)<\/div>/.exec(body);
    const hrefM = titleM ? /href="([^"]*)"/.exec(titleM[1]) : null;
    const voteM = /data-vote="([^"]*)"/.exec(attrs);
    const clsM = /class="([^"]*)"/.exec(attrs);
    const cls = clsM ? clsM[1] : '';
    rows[keyM[1]] = {
      kind: /\bitem\b/.test(cls) ? 'item' : /\btodo\b/.test(cls) ? 'todo' : /\bkeydate\b/.test(cls) ? 'keydate' : 'row',
      done: /\bdata-done\b/.test(attrs),
      snooze: /\bdata-snooze\b/.test(attrs),
      pin: /\bdata-pin\b/.test(attrs),
      open: /\bdata-open\b/.test(attrs),
      vote: voteM ? voteM[1] : null,
      saved: /\bdata-saved\b/.test(attrs),
      note: noteM ? stripTags(noteM[1]) : '',
      title: titleM ? stripTags(titleM[1]) : '',
      url: hrefM ? decodeEntities(hrefM[1]) : '',
    };
  }
  return { exists: true, date: dateM ? dateM[1] : null, dateView: dvM ? dvM[1] : null, rows };
}

// ------------------------------------------------------------------ date sweep

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
      if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) || /\b20\d{2}\b/.test(t)) {
        out.thirdYear.push({ heading: t });
      }
    }
  }
  return out;
}

// --------------------------------------------------------------------- renderers

const acts = (kind) => {
  if (kind === 'todo') return (
    `    <div class="acts" data-marble-transient>\n` +
    `      <button class="act act-pin" data-act="pin" title="Pin">&#9679;</button>\n` +
    `      <button class="act act-snooze" data-act="snooze" title="Snooze to tomorrow">&#8250;</button>\n` +
    `    </div>`);
  return (
    `    <div class="acts" data-marble-transient>\n` +
    `      <button class="act act-up" data-act="up" title="More like this">&#9650;</button>\n` +
    `      <button class="act act-down" data-act="down" title="Less like this">&#9660;</button>\n` +
    `      <button class="act act-save" data-act="save" title="Save to reading list">&#9733;</button>\n` +
    `    </div>`);
};

function renderChecklist(items, prev, { klass, sortable }) {
  return (items || []).map((t) => {
    const title = String(t.title || '').trim();
    if (!title) return '';
    const key = t.key || slug((t.source || '') + '|' + title);
    const carried = prev.rows[key] || {};
    const note = t.note != null ? t.note : carried.note || '';
    const metaBits = [t.source, t.meta].filter(Boolean).join(' · ');
    const flags = (t.done ? ' data-done' : '') + (t.snooze ? ' data-snooze' : '') + (t.pin ? ' data-pin' : '');
    return [
      `  <li class="row ${klass}" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
      `    <button class="chk" data-marble-transient data-act="done" aria-label="Toggle done"></button>`,
      `    <div class="body">`,
      `      <div class="title" data-marble-editable>${esc(title)}</div>`,
      t.why ? `      <div class="why" data-marble-editable>${esc(t.why)}</div>` : '',
      metaBits ? `      <div class="meta" data-marble-editable>${esc(metaBits)}</div>` : '',
      `      <div class="note" data-marble-editable>${esc(note)}</div>`,
      `    </div>`,
      acts('todo'),
      `  </li>`,
    ].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

function figureHtml(image, caption) {
  const uri = inlineImage(image, 520);
  if (!uri) return '';
  return `      <figure data-marble-id="${mint()}"><img src="${uri}" alt="" data-marble-id="${mint()}">` +
    (caption ? `<figcaption data-marble-id="${mint()}">${esc(caption)}</figcaption>` : '') + `</figure>`;
}

function renderFeed(items, prev) {
  return (items || []).map((it) => {
    const title = String(it.title || '').trim();
    if (!title) return '';
    const url = String(it.url || '').trim();
    const key = it.key || (url ? slug(url) : slug(title));
    const carried = prev.rows[key] || {};
    const note = it.note != null ? it.note : carried.note || '';
    const vote = it.vote != null ? it.vote : carried.vote || null;
    const saved = it.saved != null ? it.saved : carried.saved || false;
    const open = it.open != null ? it.open : carried.open || false;
    const titleHtml = url
      ? `<a href="${escAttr(url)}" target="_blank" rel="noopener">${esc(title)}</a>` : esc(title);
    const flags = (vote ? ` data-vote="${escAttr(vote)}"` : '') + (saved ? ' data-saved' : '') + (open ? ' data-open' : '');
    const hasMore = it.abstract || it.authors || it.published || it.image;
    const fig = it.image ? figureHtml(it.image, it.imageCaption || '') : '';
    return [
      `  <li class="row item expandable" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
      `    <span class="tag" data-marble-id="${mint()}" data-marble-editable>${esc(it.tag || 'link')}</span>`,
      `    <div class="body">`,
      `      <div class="title" data-marble-id="${mint()}">${titleHtml}</div>`,
      it.meta ? `      <div class="meta" data-marble-id="${mint()}" data-marble-editable>${esc(it.meta)}</div>` : '',
      it.why ? `      <div class="why" data-marble-id="${mint()}" data-marble-editable>${esc(it.why)}</div>` : '',
      hasMore ? `      <button class="exp-toggle" data-marble-transient data-exp>more</button>` : '',
      hasMore ? `      <div class="exp-body" data-marble-id="${mint()}">` : '',
      it.published ? `        <div class="pubdate" data-marble-id="${mint()}" style="margin-bottom:.3rem">Published ${esc(it.published)}</div>` : '',
      it.abstract ? `        <div class="abstract" data-marble-id="${mint()}" data-marble-editable>${esc(it.abstract)}</div>` : '',
      it.authors ? `        <div class="authors" data-marble-id="${mint()}">${esc(Array.isArray(it.authors) ? it.authors.join(', ') : it.authors)}</div>` : '',
      fig,
      hasMore ? `      </div>` : '',
      `      <div class="note" data-marble-id="${mint()}" data-marble-editable>${esc(note)}</div>`,
      `    </div>`,
      acts('item'),
      `  </li>`,
    ].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

function renderArxiv(arxiv, prev) {
  const papers = (arxiv && arxiv.papers) || [];
  const newest = arxiv && arxiv.newestDate;
  return papers.map((p) => {
    const title = String(p.title || '').trim();
    if (!title) return '';
    const key = p.key || slug(p.id || p.absUrl || title);
    const carried = prev.rows[key] || {};
    const note = carried.note || '';
    const vote = carried.vote || null;
    const saved = carried.saved || false;
    const open = carried.open || false;
    const pub = (p.published || '').slice(0, 10);
    const fresh = newest && pub && Math.abs(Date.parse(pub) - Date.parse(newest)) <= 86400000 ? ' fresh' : '';
    const authors = Array.isArray(p.authors) ? p.authors : [];
    const authShort = authors.length > 4 ? authors.slice(0, 4).join(', ') + ' +' + (authors.length - 4) : authors.join(', ');
    const flags = (vote ? ` data-vote="${escAttr(vote)}"` : '') + (saved ? ' data-saved' : '') + (open ? ' data-open' : '');
    const fig = p.image ? figureHtml(p.image, 'arXiv:' + (p.id || '')) : '';
    return [
      `  <li class="row item expandable${fresh}" data-marble-id="${mint()}" data-key="${escAttr(key)}" data-marble-removable${flags}>`,
      `    <span class="pubdate" data-marble-id="${mint()}">${esc(humanShortNoDow(pub) || pub)}</span>`,
      `    <div class="body">`,
      `      <div class="title" data-marble-id="${mint()}"><a href="${escAttr(p.absUrl || ('https://arxiv.org/abs/' + p.id))}" target="_blank" rel="noopener">${esc(title)}</a></div>`,
      `      <div class="meta" data-marble-id="${mint()}">${esc(authShort)}${p.primary ? ` &middot; ${esc(p.primary)}` : ''}</div>`,
      p.why ? `      <div class="why" data-marble-id="${mint()}" data-marble-editable>${esc(p.why)}</div>` : '',
      `      <button class="exp-toggle" data-marble-transient data-exp>abstract</button>`,
      `      <div class="exp-body" data-marble-id="${mint()}">`,
      `        <div class="pubdate" data-marble-id="${mint()}" style="margin-bottom:.3rem">Submitted ${esc(humanShort(pub) || pub)}${p.updated && p.updated.slice(0,10) !== pub ? ` &middot; revised ${esc(humanShortNoDow(p.updated.slice(0,10)))}` : ''}</div>`,
      `        <div class="abstract" data-marble-id="${mint()}">${esc(p.abstract || '')}</div>`,
      authShort ? `        <div class="authors" data-marble-id="${mint()}">${esc(authors.join(', '))}</div>` : '',
      `        <div class="authors" data-marble-id="${mint()}"><a href="${escAttr(p.pdfUrl || ('https://arxiv.org/pdf/' + p.id))}" target="_blank" rel="noopener">PDF</a> &middot; <a href="${escAttr(p.htmlUrl || ('https://arxiv.org/html/' + p.id))}" target="_blank" rel="noopener">HTML</a></div>`,
      fig,
      `      </div>`,
      `      <div class="note" data-marble-id="${mint()}" data-marble-editable>${esc(note)}</div>`,
      `    </div>`,
      acts('item'),
      `  </li>`,
    ].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

function renderKeyDatesList(dates, fromYmd) {
  return (dates || [])
    .map((d) => ({ ...d, n: daysUntil(d.date, fromYmd) }))
    .filter((d) => d.n != null && d.n >= 0)
    .sort((a, b) => a.n - b.n)
    .map((d) => {
      const label = String(d.label || '').trim() || '(untitled)';
      const key = d.key || slug(d.date + '|' + label);
      const nText = d.n === 0 ? 'today' : `${d.n}<small> d</small>`;
      const soon = d.n <= 14 ? ' data-soon' : '';
      return [
        `  <li class="row keydate" data-marble-id="${mint()}" data-key="${escAttr(key)}"${soon}>`,
        `    <span class="when-pill" data-marble-id="${mint()}">${nText}</span>`,
        `    <div class="body">`,
        `      <div class="title" data-marble-id="${mint()}" data-marble-editable>${esc(label)}</div>`,
        `      <div class="meta" data-marble-id="${mint()}">${esc(humanShort(d.date))}${d.source ? ` &middot; ${esc(d.source)}` : ''}</div>`,
        `    </div>`,
        `  </li>`,
      ].join('\n');
    }).join('\n');
}

function renderCalendar(dates, fromYmd) {
  const start = atLocalNoon(fromYmd) || new Date();
  const ev = {};
  for (const d of dates || []) {
    const n = daysUntil(d.date, fromYmd);
    if (n == null || n < 0) continue;
    (ev[d.date] ||= []).push({ label: String(d.label || '').trim(), soon: n <= 14 });
  }
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const months = [];
  for (let mi = 0; mi < 2; mi++) {
    const first = new Date(start.getFullYear(), start.getMonth() + mi, 1);
    const y = first.getFullYear(), m = first.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const lead = first.getDay();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(`<div class="cell pad" data-marble-id="${mint()}"></div>`);
    for (let d = 1; d <= days; d++) {
      const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hits = ev[ymd];
      const isToday = ymd === (fromYmd || todayYmd());
      const cls = ['cell', hits ? 'ev' : '', hits && hits.some((h) => h.soon) ? 'soon' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
      const lbl = hits ? `<span class="lbl" data-marble-id="${mint()}">${esc(hits[0].label.length > 22 ? hits[0].label.slice(0, 20) + '…' : hits[0].label)}${hits.length > 1 ? ` +${hits.length - 1}` : ''}</span>` : '';
      cells.push(`<div class="${cls}" data-marble-id="${mint()}" title="${escAttr(hits ? hits.map((h) => h.label).join(' · ') : '')}">${d}${lbl}</div>`);
    }
    months.push(
      `  <div class="cal-m" data-marble-id="${mint()}">\n` +
      `    <h4 data-marble-id="${mint()}">${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h4>\n` +
      `    <div class="cal-grid" data-marble-id="${mint()}">${DOW.map((x) => `<div class="dow" data-marble-id="${mint()}">${x}</div>`).join('')}${cells.join('')}</div>\n` +
      `  </div>`);
  }
  return `<div class="cal" data-marble-id="${mint()}">\n${months.join('\n')}\n</div>`;
}

const WX_GLYPH = { '☀': '☀', '🌤': '🌤', '⛅': '⛅', '☁': '☁', '🌫': '🌫', '🌦': '🌦', '🌧': '🌧', '🌨': '🌨', '❄': '❄', '⛈': '⛈', '·': '·' };
function restOfDay(c) {
  const rest = (c.hourly || []).filter((h) => h.time.slice(0, 10) === (c.localTime || '').slice(0, 10));
  const pop = Math.max(0, ...rest.map((h) => h.pop || 0), c.today?.popMax || 0);
  const last = rest.length ? rest[rest.length - 1].label.toLowerCase() : c.now.label.toLowerCase();
  let s = `${last === c.now.label.toLowerCase() ? 'Staying ' + last : 'Turning ' + last} into the evening; high ${c.today.hi}°.`;
  if (pop >= 30) s += ` ${pop}% chance of rain.`;
  return s;
}
function renderWeather(w) {
  if (!w || w.error) return `<p class="sub" data-marble-id="${mint()}">Weather unavailable.</p>`;
  const card = (c, primary) => {
    if (!c) return '';
    const hrs = (c.hourly || []).slice(0, 7).map((h) =>
      `<div class="h" data-marble-id="${mint()}"><div class="hh" data-marble-id="${mint()}">${h.hour}h</div>` +
      `<div class="hg" data-marble-id="${mint()}">${esc(h.glyph)}</div>` +
      `<div class="ht" data-marble-id="${mint()}">${h.temp}°</div></div>`).join('');
    return [
      `  <div class="wx-card" data-marble-id="${mint()}">`,
      `    <div class="city" data-marble-id="${mint()}">${esc(c.city)}${primary ? ' — you are here' : ''}</div>`,
      `    <div class="nowrow" data-marble-id="${mint()}">`,
      `      <span class="temp" data-marble-id="${mint()}">${c.now.temp}°</span>`,
      `      <span class="glyph" data-marble-id="${mint()}">${esc(c.now.glyph)}</span>`,
      `      <span data-marble-id="${mint()}"><span class="cond" data-marble-id="${mint()}">${esc(c.now.label)}</span><br>`,
      `        <span class="hilo" data-marble-id="${mint()}">H ${c.today.hi}° &nbsp; L ${c.today.lo}° &nbsp; feels ${c.now.feels}°</span></span>`,
      `    </div>`,
      `    <div class="rest" data-marble-id="${mint()}">${esc(restOfDay(c))}</div>`,
      `    <div class="wx-hours" data-marble-id="${mint()}">${hrs}</div>`,
      `  </div>`,
    ].join('\n');
  };
  return `<div class="wx" data-marble-id="${mint()}">\n${card(w.zurich, true)}\n${card(w.sanDiego, false)}\n</div>`;
}

function seedRow(p, win) {
  const ph = p.photo ? inlineImage(p.photo, 96) : '';
  const img = ph ? `<img class="ph" src="${ph}" alt="" data-marble-id="${mint()}">` : `<span class="ph" data-marble-id="${mint()}"></span>`;
  return `<div class="seedrow${win ? ' win' : ''}" data-marble-id="${mint()}">${img}` +
    `<span class="nm" data-marble-id="${mint()}">${esc((p.seed ? `[${p.seed}] ` : '') + (p.name || 'TBD'))}</span>` +
    `<span class="sc" data-marble-id="${mint()}">${esc(p.score || '')}</span></div>`;
}
function renderDraw(half, label) {
  if (!half || !half.rounds) return '';
  const rounds = half.rounds.map((rd) => {
    const matches = (rd.matches || []).map((m) =>
      `<div class="match" data-marble-id="${mint()}">${seedRow(m.a || {}, m.winner === 'a')}${seedRow(m.b || {}, m.winner === 'b')}</div>`).join('');
    return `<div class="rd" data-marble-id="${mint()}"><div class="rdname" data-marble-id="${mint()}">${esc(rd.name)}</div>${matches}</div>`;
  }).join('');
  const champ = half.champion
    ? `<div class="champ" data-marble-id="${mint()}">${half.champion.photo ? `<img class="ph" src="${inlineImage(half.champion.photo, 96)}" alt="" style="vertical-align:middle;margin-right:.4rem" data-marble-id="${mint()}">` : ''}Champion: <b>${esc(half.champion.name)}</b></div>`
    : '';
  return `  <div class="half" data-marble-id="${mint()}">\n    <h4 data-marble-id="${mint()}">${esc(label)}</h4>\n    <div class="rounds" data-marble-id="${mint()}">${rounds}</div>\n    ${champ}\n  </div>`;
}
function renderUsOpen(u) {
  if (!u || u.error) return `<p class="sub" data-marble-id="${mint()}">US Open data unavailable.</p>`;
  return `<div class="draw" data-marble-id="${mint()}">\n${renderDraw(u.men, "Men's singles")}\n${renderDraw(u.women, "Women's singles")}\n${u.note ? `<p class="sub" data-marble-id="${mint()}">${esc(u.note)}</p>` : ''}\n</div>`;
}

function renderGlance(chips) {
  return (chips || []).filter(Boolean)
    .map((c) => `<span data-marble-id="${mint()}">${c}</span>`).join('\n');
}
function renderSummary(paras) {
  const list = Array.isArray(paras) ? paras : [paras];
  return list.filter(Boolean).map((p) => `<p class="summary" data-marble-id="${mint()}" data-marble-editable>${esc(p)}</p>`).join('\n');
}

// --------------------------------------------------------------------- assemble

function partOfDay() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

function guardRepresentation(html) {
  const h = String(html || '');
  const bad = [
    [/<script\b/i, 'a <script> tag'],
    [/\son\w+\s*=/i, 'an inline event handler (on*=)'],
    [/javascript:/i, 'a javascript: URL'],
    [/@import/i, 'an @import'],
    [/url\(\s*["']?https?:/i, 'an external url() reference'],
    [/<(img|iframe|object|embed|link)\b[^>]*\b(src|href)\s*=\s*["']?https?:/i, 'an external asset'],
  ];
  for (const [re, why] of bad) if (re.test(h)) return why;
  return null;
}

function assemble(args) {
  const templatePath = args.template || DEFAULTS.template;
  const outPath = args.out || DEFAULTS.out;
  const archiveDir = args['archive-dir'] || DEFAULTS.archiveDir;

  let payloadRaw;
  if (args.payload === '-' || args.payload === true) payloadRaw = fs.readFileSync(0, 'utf8');
  else if (typeof args.payload === 'string') payloadRaw = fs.readFileSync(args.payload, 'utf8');
  else die('assemble needs --payload <file|->');
  let payload;
  try { payload = JSON.parse(payloadRaw); } catch (e) { die(`payload is not valid JSON: ${e.message}`); }

  const date = payload.date || todayYmd();
  if (!atLocalNoon(date)) die(`payload.date "${date}" is not YYYY-MM-DD`);

  const prev = readback(outPath);

  // 1. archive
  let archived = null;
  if (prev.exists && !args['no-archive']) {
    const stamp = prev.date || fs.statSync(outPath).mtime.toISOString().slice(0, 10);
    fs.mkdirSync(archiveDir, { recursive: true });
    const dest = path.join(archiveDir, `${stamp}.mrbl`);
    if (stamp === date) archived = '(skipped — outgoing issue is already today)';
    else if (fs.existsSync(dest)) archived = `${dest} (kept existing)`;
    else if (args['dry-run']) archived = `${dest} (dry-run)`;
    else { fs.copyFileSync(outPath, dest); archived = dest; }
  }

  // 2. representation guard
  const repr = payload.representation || {};
  const reprHtml = repr.html || '<p class="sub">No representation was authored for today.</p>';
  const bad = guardRepresentation(repr.html);
  if (bad) die(`representation.html contains ${bad} — self-contained markup + CSS only`);

  // 3. palette
  const picked = pickPalette(date, payload.palette);
  const pal = picked.pal;

  // 4. render sections
  const focusHtml = renderChecklist(payload.focus, prev, { klass: 'focus', sortable: 'focus' });
  const todosHtml = renderChecklist(payload.todos, prev, { klass: 'todo', sortable: 'todos' });
  const feed = payload.feed || {};
  const feedGen = renderFeed(feed.genui, prev);
  const feedInd = renderFeed(feed.industry, prev);
  const feedHci = renderFeed(feed.hci, prev);
  const datesList = renderKeyDatesList(payload.keyDates, date);
  const calHtml = renderCalendar(payload.keyDates, date);
  const wxHtml = renderWeather(payload.weather);
  const usoHtml = renderUsOpen(payload.usOpen);
  const arxivHtml = renderArxiv(payload.arxiv, prev);

  const nFocus = (payload.focus || []).filter((t) => t && t.title).length;
  const nTodos = (payload.todos || []).filter((t) => t && t.title).length;
  const nFeed = (feed.genui || []).length + (feed.industry || []).length + (feed.hci || []).length;
  const nDates = (payload.keyDates || []).filter((d) => daysUntil(d.date, date) >= 0).length;
  const nArxiv = ((payload.arxiv || {}).papers || []).length;

  const upcoming = (payload.keyDates || [])
    .map((d) => ({ ...d, n: daysUntil(d.date, date) }))
    .filter((d) => d.n != null && d.n >= 0).sort((a, b) => a.n - b.n);
  const nextDate = upcoming[0];

  const wxNow = payload.weather && !payload.weather.error && payload.weather.zurich
    ? `${payload.weather.zurich.now.temp}° ${payload.weather.zurich.now.label.toLowerCase()} in Zurich` : null;

  const glance = payload.glance && Array.isArray(payload.glance) ? payload.glance : [
    `<b>${nFocus}</b> to focus on`,
    `<b>${nTodos}</b> todos`,
    nextDate ? `<b>${nextDate.n}d</b> to ${esc(nextDate.label)}` : null,
    wxNow,
    `<b>${nArxiv}</b> new on arXiv`,
  ];

  const arxivMeta = payload.arxiv && !payload.arxiv.error
    ? `${nArxiv} paper${nArxiv === 1 ? '' : 's'} · newest submitted ${humanShort((payload.arxiv.newestDate || '').slice(0, 10)) || '—'} · scanned ${payload.arxiv.countScanned || '?'} recent`
    : 'arXiv unavailable this run.';

  // 5. splice
  let html = fs.readFileSync(templatePath, 'utf8');
  html = html.replaceAll('__DATE__', escAttr(date));
  html = html.replaceAll('__PALETTE_NAME__', escAttr(pal.name));
  html = html.replace('__PALETTE__', paletteStyle(pal));
  html = fill(html, 'nl-swatches', renderSwatches(pal));
  html = fill(html, 'nl-date', `    ${esc(humanLong(date))}`);
  const greeting = payload.greeting || `Good ${partOfDay()}, Bryan.`;
  html = html.replace(/(data-marble-id="nl-greeting"[^>]*>)[^<]*(<\/p>)/, `$1${esc(greeting)}$2`);
  html = fill(html, 'nl-summary', renderSummary(payload.summary || 'Here is your day.'));
  html = fill(html, 'nl-glance', renderGlance(glance));
  html = fill(html, 'nl-focus-count', nFocus ? `(${nFocus})` : '');
  html = fill(html, 'nl-focus', focusHtml);
  html = fill(html, 'nl-todos-count', nTodos ? `(${nTodos})` : '');
  html = fill(html, 'nl-todos', todosHtml);
  html = fill(html, 'nl-weather', wxHtml);
  html = fill(html, 'nl-dates-count', nDates ? `(${nDates})` : '');
  html = fill(html, 'nl-dates', datesList);
  html = fill(html, 'nl-cal', calHtml);
  if (prev.dateView === 'cal') html = setAttrOn(html, 'nl-p-dates', 'data-view', 'cal');
  html = fill(html, 'nl-usopen-sub', payload.usOpen && payload.usOpen.asOf ? `As of ${esc(payload.usOpen.asOf)}` : '');
  html = fill(html, 'nl-usopen', usoHtml);
  html = fill(html, 'nl-feed-count', nFeed ? `(${nFeed})` : '');
  html = fill(html, 'nl-feed-genui', feedGen);
  html = fill(html, 'nl-feed-industry', feedInd);
  html = fill(html, 'nl-feed-hci', feedHci);
  html = fill(html, 'nl-arxiv-count', nArxiv ? `(${nArxiv})` : '');
  html = fill(html, 'nl-arxiv-meta', `    ${arxivMeta}`);
  html = fill(html, 'nl-arxiv', arxivHtml);
  html = fill(html, 'nl-repr-name', repr.name ? esc(repr.name) : '');
  html = fill(html, 'nl-repr',
    `    <p class="sub" data-marble-id="${mint()}">${esc(repr.name || 'freeform')} · ${esc(humanShortNoDow(date))}</p>\n${reprHtml}`);

  // 6. verify
  const check = selfCheck(html);
  if (!check.ok) die(`self-check failed:\n  - ${check.problems.join('\n  - ')}`);

  const summaryOut = {
    date, out: outPath, archived, palette: pal.name,
    counts: { focus: nFocus, todos: nTodos, keyDates: nDates, feed: nFeed, arxiv: nArxiv },
    imagesInlined, bytes: Buffer.byteLength(html), carriedForward: Object.keys(prev.rows).length,
  };

  if (args['dry-run']) { console.log(JSON.stringify({ dryRun: true, ...summaryOut }, null, 2)); return; }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, outPath);
  const after = fs.readFileSync(outPath, 'utf8');
  const recheck = selfCheck(after);
  if (!recheck.ok) die(`file on disk failed re-check:\n  - ${recheck.problems.join('\n  - ')}\n  recover from drive/.marble/history/`);

  if (picked.recorded) {
    fs.mkdirSync(path.dirname(DEFAULTS.paletteState), { recursive: true });
    fs.writeFileSync(DEFAULTS.paletteState, JSON.stringify({ recent: picked.recent, updated: new Date().toISOString() }, null, 2));
  }

  console.log(JSON.stringify({
    ok: true, ...summaryOut, bytes: Buffer.byteLength(after),
    savedItems: Object.entries(prev.rows).filter(([, v]) => v.saved).map(([k]) => k),
  }, null, 2));
}

// ------------------------------------------------------------------- self-check

function selfCheck(html) {
  const problems = [];
  const leftovers = html.match(/__[A-Z_]+__/g);
  if (leftovers) problems.push(`unfilled placeholder(s): ${[...new Set(leftovers)].join(', ')}`);
  const ids = [...html.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set(); const dupes = new Set();
  for (const id of ids) { if (seen.has(id)) dupes.add(id); seen.add(id); }
  if (dupes.size) problems.push(`duplicate data-marble-id: ${[...dupes].slice(0, 8).join(', ')}`);
  if (ids.length < 20) problems.push(`only ${ids.length} addressable elements — template likely not filled`);
  for (const [open, close] of [['<script', '</script>'], ['<template', '</template>'], ['<style', '</style>']]) {
    const o = (html.match(new RegExp(open, 'g')) || []).length;
    const c = (html.match(new RegExp(close, 'g')) || []).length;
    if (o !== c) problems.push(`unbalanced ${open}…${close} (${o} vs ${c})`);
  }
  if (!/data-marble="1"/.test(html)) problems.push('missing data-marble="1"');
  if (!/<meta name="newsletter:date" content="\d{4}-\d{2}-\d{2}">/.test(html)) problems.push('missing/malformed newsletter:date meta');
  if (!/id="nl-palette"/.test(html)) problems.push('palette style not injected (__PALETTE__ left?)');
  if (!/marble\.register\(/.test(html)) problems.push('affordance script missing');
  if (!/<!doctype html>/i.test(html)) problems.push('missing <!doctype html>');
  return { ok: problems.length === 0, problems };
}

// --------------------------------------------------------------------- harvest

function harvest(args) {
  const file = args.file || args._[1] || DEFAULTS.out;
  const rb = readback(file);
  if (!rb.exists) die(`no issue at ${file} to harvest`);
  let seen = { keys: [], updated: null };
  if (fs.existsSync(DEFAULTS.seen)) { try { seen = JSON.parse(fs.readFileSync(DEFAULTS.seen, 'utf8')); } catch {} }
  const keySet = new Set(seen.keys || []);
  for (const [k, r] of Object.entries(rb.rows)) if (r.kind === 'item') keySet.add(k);
  const saved = [], votes = { up: [], down: [] };
  for (const [key, r] of Object.entries(rb.rows)) {
    if (r.saved) saved.push({ key, title: r.title, url: r.url, note: r.note });
    if (r.vote === 'up') votes.up.push({ key, title: r.title, url: r.url });
    if (r.vote === 'down') votes.down.push({ key, title: r.title, url: r.url });
  }
  const out = { issueDate: rb.date, seenTotal: keySet.size, seenAdded: keySet.size - (seen.keys?.length || 0), saved, votes };
  if (!args['dry-run']) {
    fs.mkdirSync(path.dirname(DEFAULTS.seen), { recursive: true });
    fs.writeFileSync(DEFAULTS.seen, JSON.stringify({ keys: [...keySet].sort(), updated: new Date().toISOString() }, null, 2));
  }
  console.log(JSON.stringify(out, null, 2));
}

// ------------------------------------------------------------------------- main

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (cmd === 'readback') console.log(JSON.stringify(readback(args._[1] || args.file || DEFAULTS.out), null, 2));
else if (cmd === 'dates') console.log(JSON.stringify(sweepDates(), null, 2));
else if (cmd === 'assemble') assemble(args);
else if (cmd === 'harvest') harvest(args);
else if (cmd === 'check') {
  const file = args.file || args._[1] || DEFAULTS.out;
  if (!fs.existsSync(file)) die(`no file at ${file}`);
  const res = selfCheck(fs.readFileSync(file, 'utf8'));
  if (res.ok) console.log('[bulletin] check: ok');
  else die(`check failed:\n  - ${res.problems.join('\n  - ')}`);
} else {
  console.log(`Bryan's Bulletin — build.mjs
  readback [file]          interaction state (done/snooze/pin/open/vote/saved/note) as JSON
  dates                    date candidates from key-dates.md + third-year.mrbl
  assemble --payload <f|-> [--dry-run] [--no-archive] [--out F] [--template F]
  harvest [file] [--dry-run]
  check [--file F]

paths:
  template  ${DEFAULTS.template}
  out       ${DEFAULTS.out}
  archive   ${DEFAULTS.archiveDir}
  palettes  ${DEFAULTS.palettes}`);
  if (cmd) die(`unknown command "${cmd}"`);
}
