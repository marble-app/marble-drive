#!/usr/bin/env node
// layoutcheck.mjs — the layout doctor.
//
// A rendered page is the real test (SKILL.md has the browser screenshot-review
// step). This is the always-on static gate: it parses the built .mrbl and its
// inline CSS and flags the mechanical causes of the overlaps and bad spacing a
// generated dashboard tends to grow — absolutely-positioned content, grid/flex
// children that can't shrink, nowrap on long text, fixed pixel heights around
// text, sub-legible font sizes, copy-pasted rule blocks.
//
//   layoutcheck.mjs <file.mrbl> [--json] [--strict]
//
// Exit 1 if any ERROR-level finding (or any finding with --strict). assemble
// calls this after its own self-check.

import fs from 'node:fs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const asJson = argv.includes('--json');
const strict = argv.includes('--strict');
if (!file || !fs.existsSync(file)) {
  console.error('usage: layoutcheck.mjs <file.mrbl> [--json] [--strict]');
  process.exit(2);
}
const html = fs.readFileSync(file, 'utf8');

const findings = [];
const add = (level, rule, msg, where) => findings.push({ level, rule, msg, where });

// ---- pull every <style> block (skip the transient one the carrier injects) ----
const styleBlocks = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)]
  .filter((m) => !/data-marble-transient/.test(m[1]))
  .map((m) => m[2].replace(/\/\*[\s\S]*?\*\//g, ' ')); // drop CSS comments
const css = styleBlocks.join('\n');

// crude rule splitter: "selector { decls }"
const rules = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].replace(/\s+/g, ' ').trim();
  const body = m[2].trim();
  if (!sel || sel.startsWith('@')) continue;
  rules.push({ sel, body });
}

const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
  return m ? m[1].trim() : null;
};

// text we can see in the document body, per class — used to tell "this selector
// holds long text" from "this selector is a chip".
const bodyHtml = html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<template[\s\S]*?<\/template>/gi, ' ');
const classText = {}; // class -> longest text run seen on an element carrying it
for (const m of bodyHtml.matchAll(/<([a-z0-9]+)\b([^>]*\bclass="([^"]+)"[^>]*)>([^<]*)/gi)) {
  const classes = m[3].split(/\s+/);
  const txt = m[4].replace(/\s+/g, ' ').trim();
  for (const c of classes) classText[c] = Math.max(classText[c] || 0, txt.length);
}
const selHoldsLongText = (sel) => {
  const cls = [...sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((x) => x[1]);
  return cls.some((c) => (classText[c] || 0) > 42);
};
const SAFE_ABSOLUTE = /::before|::after|marble-|sprite|swatch|gutter|hero-|badge|starburst|flag|dot|scrim|edge|kicker|corner|rule-line|pin\b|conn(ector)?|line\b|status|tip\b|deck|dock/;

// ---- 1. absolute / fixed positioning on content ----
for (const r of rules) {
  const pos = decl(r.body, 'position');
  if (pos === 'absolute' || pos === 'fixed') {
    if (!SAFE_ABSOLUTE.test(r.sel)) {
      add('error', 'absolute-content',
        `position:${pos} on "${r.sel}" — content should hold its space with grid/flow, not overlap. If it's decorative chrome, name it hero-/badge-/flag-/gutter- or mark it data-marble-transient.`);
    }
  }
  // z-index without a positioning context
  if (decl(r.body, 'z-index') && !pos && !/sticky|relative/.test(r.body)) {
    add('warn', 'zindex-no-position', `z-index on "${r.sel}" without position — has no effect.`);
  }
}

// ---- 2. grid/flex without a shrinkable child anywhere ----
const hasGridFlex = rules.some((r) => /display\s*:\s*(flex|grid)/.test(r.body));
const hasMinWidth0 = /min-width\s*:\s*0/.test(css);
if (hasGridFlex && !hasMinWidth0) {
  add('error', 'no-min-width-0',
    `The stylesheet uses flex/grid but never sets min-width:0 on a child. Grid/flex items default to min-width:auto and won't shrink below their content — long titles then push columns wide and text overlaps neighbours. Add min-width:0 to the text column(s).`);
}

// ---- 3. nowrap on selectors that hold long text ----
for (const r of rules) {
  if (/white-space\s*:\s*nowrap/.test(r.body) && selHoldsLongText(r.sel)) {
    add('error', 'nowrap-long-text',
      `white-space:nowrap on "${r.sel}", which carries text longer than ~42 chars in this issue — it will overflow or clip. Reserve nowrap for chips / dates / single tokens.`);
  }
}

// ---- 4. fixed px height/width around text ----
for (const r of rules) {
  const h = decl(r.body, 'height');
  const w = decl(r.body, 'width');
  const fixedH = h && /^\d+(\.\d+)?px$/.test(h) && Number(h) < 400;
  if (fixedH && selHoldsLongText(r.sel)) {
    add('error', 'fixed-height-text',
      `height:${h} on "${r.sel}" which holds long text — text won't fit at every width/size. Use min-height or let it flow.`);
  }
  if (fixedH && /overflow\s*:\s*hidden/.test(r.body)) {
    add('warn', 'clip-fixed-height', `"${r.sel}" pins height:${h} and overflow:hidden — content taller than that is silently cut.`);
  }
  if (w && /^\d+(\.\d+)?px$/.test(w) && Number(w) > 520 && !/img|figure|hero|max-width/.test(r.sel + r.body)) {
    add('warn', 'wide-fixed-width', `width:${w} (fixed) on "${r.sel}" — prefer max-width so it adapts to the 16" layout and narrower.`);
  }
}

// ---- 5. sub-legible font sizes ----
for (const r of rules) {
  const fs2 = decl(r.body, 'font-size') || (decl(r.body, 'font') || '').match(/(\d*\.?\d+)(px|rem|em)/)?.[0];
  if (!fs2) continue;
  const m = fs2.match(/^(\d*\.?\d+)(px|rem)$/); // em is context-relative — can't resolve statically
  if (!m) continue;
  const px = m[2] === 'px' ? +m[1] : +m[1] * 16;
  if (px && px < 11.5) {
    add('warn', 'tiny-font', `font-size ${fs2} (~${Math.round(px)}px) on "${r.sel}" — below comfortable minimum; bump to ~12px+.`);
  }
}

// ---- 6. duplicate declaration blocks (copy-paste drift risk) ----
const norm = (b) => b.replace(/\s+/g, '').replace(/;$/, '').split(';').sort().join(';');
const seenBlocks = new Map();
for (const r of rules) {
  if (r.body.length < 40) continue;
  if (/:root|prefers-|data-theme/.test(r.sel)) continue; // theme palettes are intentionally mirrored
  const k = norm(r.body);
  if (seenBlocks.has(k)) {
    add('warn', 'dup-block', `"${r.sel}" and "${seenBlocks.get(k)}" have identical declarations — collapse them so they can't drift apart.`);
  } else seenBlocks.set(k, r.sel);
}

// ---- 7. images without alt / aspect (layout shift, a11y) ----
for (const m of bodyHtml.matchAll(/<img\b([^>]*)>/gi)) {
  const a = m[1];
  if (!/\balt\s*=/.test(a)) add('warn', 'img-no-alt', `<img> without alt=`);
  if (!/aspect-ratio|width\s*=|height\s*=/.test(a) && !/aspect-ratio/.test(css)) {
    add('warn', 'img-no-aspect', `<img> with no width/height/aspect-ratio — reserves no space, causes reflow as it loads.`);
  }
}

// ---- 8. inline style positioning on content ----
for (const m of bodyHtml.matchAll(/style="([^"]*)"/gi)) {
  if (/(?:^|;)\s*(position|top|left|right|bottom)\s*:/.test(m[1]) && !/--/.test(m[1])) {
    add('warn', 'inline-position', `inline style with position/top/left: "${m[1].slice(0, 60)}" — positioning belongs in a class.`);
  }
}

// ---- 9. classes the markup uses but the stylesheet never styles ----
// This is how a component silently loses its layout: an edit removes a rule
// block and the markup keeps emitting the class, so it renders as raw blocks.
const styled = new Set();
for (const r of rules) for (const m of r.sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) styled.add(m[1]);
const IGNORE = /^(marble-|ic$|tip$|tip-|reveal$|expandable$|viewbox$|v$|v-|no-img$|fresh$|win$|has$|out$|today$|wk$|pad$|on$|rn$|n$|body$|title$|meta$|note$|why$|abstract$|authors$|acts$|act$|add$|chk$|list$|row$|todo$|focus$|keydate$|item$|exp$|exp-|seg$|right$|dnum$|hh$|he$|ht$)/;
const useCount = {};
for (const m of bodyHtml.matchAll(/class="([^"]+)"/g)) {
  for (const c of m[1].split(/\s+/)) { if (!c || IGNORE.test(c)) continue; useCount[c] = (useCount[c] || 0) + 1; }
}
const orphans = Object.entries(useCount).filter(([c]) => !styled.has(c)).sort((a, b) => b[1] - a[1]);
for (const [c, n] of orphans) {
  add(n >= 3 ? 'error' : 'warn', 'orphan-class',
    `class "${c}" is used on ${n} element(s) but no rule styles it — a stylesheet block was probably lost, and that content is rendering unstyled.`);
}

// ---- 10. body / root missing a max-width guard (horizontal scroll risk) ----
if (!/max-width/.test(css)) {
  add('warn', 'no-max-width', `no max-width anywhere — wide content can force the page to scroll sideways.`);
}

// ---- report ----
const errors = findings.filter((f) => f.level === 'error');
if (asJson) {
  console.log(JSON.stringify({ file, ok: errors.length === 0 && (!strict || findings.length === 0), findings }, null, 2));
} else {
  if (!findings.length) console.log('[layoutcheck] clean');
  for (const f of findings) console.log(`[layoutcheck] ${f.level.toUpperCase()} ${f.rule}: ${f.msg}`);
  if (findings.length) console.log(`[layoutcheck] ${errors.length} error(s), ${findings.length - errors.length} warning(s)`);
}
process.exit(errors.length || (strict && findings.length) ? 1 : 0);
