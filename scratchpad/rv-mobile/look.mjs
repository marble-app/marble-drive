// Look at the document the way a phone does.
//   node look.mjs <port> <outPrefix> [width] [height] [preset] [scrollY]
// Writes <outPrefix>.png and prints measurements a screenshot cannot show.
import { chromium } from 'playwright';

const [, , port = '8731', prefix = 'shot', w = '390', h = '844', preset = '', scrollY = '0'] = process.argv;
const W = +w, H = +h;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: W < 700, hasTouch: W < 700 });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await p.goto(`http://127.0.0.1:${port}/rv.html`, { waitUntil: 'load' });
await p.waitForTimeout(900);
if (preset) { await p.evaluate(v => document.querySelector(`[data-preset="${v}"]`)?.click(), preset); await p.waitForTimeout(500); }
if (+scrollY) { await p.evaluate(y => window.scrollTo(0, y), +scrollY); await p.waitForTimeout(350); }

await p.screenshot({ path: `${prefix}.png`, scale: 'css' });

const m = await p.evaluate(() => {
  const de = document.documentElement;
  const vis = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const box = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const name = el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

  const out = {
    view: document.querySelector('.stage')?.getAttribute('data-arrange'),
    show: document.querySelector('.stage')?.getAttribute('data-show'),
    pageOverflowPx: de.scrollWidth - de.clientWidth,
    docHeight: de.scrollHeight,
    tooSmallTargets: [], overflowing: [], overlaps: [],
  };

  const band = document.querySelector('.band-wrap');
  out.bandHeight = vis(band) ? box(band).h : 0;
  const rail = document.querySelector('.rail');
  out.railHeight = vis(rail) ? box(rail).h : 0;
  const first = [...document.querySelectorAll('.pool > .item')].find(vis);
  out.firstCardTop = first ? Math.round(box(first).y + window.scrollY) : null;

  // 1. touch targets below 44px in either direction
  const seen = new Set();
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select, summary')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    // count a ::before/::after hit expander as part of the target
    const cs = getComputedStyle(el, '::before');
    let hit = { w: r.width, h: r.height };
    if (cs.content !== 'none' && cs.position === 'absolute') {
      const inset = v => parseFloat(v) || 0;
      hit = { w: r.width - inset(cs.left) - inset(cs.right), h: r.height - inset(cs.top) - inset(cs.bottom) };
    }
    if (hit.h >= 44 && hit.w >= 44) continue;
    const k = name(el) + Math.round(hit.w) + 'x' + Math.round(hit.h);
    if (seen.has(k)) continue; seen.add(k);
    out.tooSmallTargets.push({ el: name(el), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 22), w: Math.round(hit.w), h: Math.round(hit.h) });
  }
  out.tooSmallTargets = out.tooSmallTargets.slice(0, 30);

  // 2. anything painting past the right edge of the page
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= de.clientWidth + 1) continue;
    // inside a deliberate sideways scroller is fine
    let sc = el.parentElement, inScroller = false;
    while (sc && sc !== document.body) { if (sc.scrollWidth > sc.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowX)) { inScroller = true; break; } sc = sc.parentElement; }
    if (inScroller) continue;
    out.overflowing.push({ el: name(el), right: Math.round(r.right), ...box(el) });
  }
  out.overflowing = out.overflowing.slice(0, 20);

  // 3. text a floating chip is sitting on top of
  for (const chip of document.querySelectorAll('.now-ref-form, .chip, .now-ref-x, .field-btn')) {
    if (!vis(chip)) continue;
    const c = chip.getBoundingClientRect();
    const host = chip.closest('.now-ref, .item, .beat, .claim');
    if (!host) continue;
    for (const t of host.querySelectorAll('h3, h4, p, .now-ref-title')) {
      if (!vis(t) || t.contains(chip)) continue;
      const r = t.getBoundingClientRect();
      const ox = Math.min(c.right, r.right) - Math.max(c.left, r.left);
      const oy = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
      if (ox > 2 && oy > 2) out.overlaps.push({ chip: name(chip), over: name(t), text: (t.textContent || '').trim().slice(0, 30), byPx: Math.round(ox) });
    }
  }
  out.overlaps = out.overlaps.slice(0, 15);
  return out;
});
console.log(JSON.stringify({ ...m, pageErrors: errs.slice(0, 6) }, null, 2));
await b.close();
