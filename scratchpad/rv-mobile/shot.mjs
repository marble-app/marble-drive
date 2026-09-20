// Screenshot the Research Vision doc at a given width, in a given view.
// usage: node shot.mjs <outPrefix> [width] [height] [arrange] [scrollY]
import { chromium } from 'playwright';

const [, , prefix = 'shot', w = '390', h = '844', arrange = '', scrollY = '0'] = process.argv;

const b = await chromium.launch();
const p = await b.newPage({
  viewport: { width: +w, height: +h },
  deviceScaleFactor: 2,
  isMobile: +w < 700,
  hasTouch: +w < 700,
});
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await p.goto('http://127.0.0.1:8731/rv.html', { waitUntil: 'load' });
await p.waitForTimeout(900);

if (arrange) {
  await p.evaluate(a => {
    const s = document.querySelector('.stage');
    const btn = document.querySelector(`[data-arrange-set="${a}"], [data-preset="${a}"], [data-view-set="${a}"]`);
    if (btn) btn.click(); else s.setAttribute('data-arrange', a);
  }, arrange);
  await p.waitForTimeout(500);
}
if (+scrollY) { await p.evaluate(y => window.scrollTo(0, y), +scrollY); await p.waitForTimeout(350); }

await p.screenshot({ path: `${prefix}.png`, scale: 'css' });

// measurements that a screenshot alone will not tell you
const m = await p.evaluate(() => {
  const de = document.documentElement;
  const out = {
    docScrollW: de.scrollWidth, clientW: de.clientWidth,
    horizontalOverflow: de.scrollWidth - de.clientWidth,
    offenders: [],
    tinyTargets: [],
    bandH: null, railH: null,
  };
  const band = document.querySelector('.band-wrap');
  if (band) out.bandH = Math.round(band.getBoundingClientRect().height);
  const rail = document.querySelector('.rail');
  if (rail) out.railH = Math.round(rail.getBoundingClientRect().height);
  // what sticks out past the right edge
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > de.clientWidth + 1 && el.offsetParent !== null) {
      const scrollable = el.closest('[style*="overflow"], .pool, .band');
      out.offenders.push({
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
        right: Math.round(r.right), w: Math.round(r.width),
      });
    }
  }
  out.offenders = out.offenders.slice(0, 25);
  // touch targets under 44px
  for (const el of document.querySelectorAll('button, a, [role="button"], .chip, .venue')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 40 || r.width < 32) {
      out.tinyTargets.push({
        sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''),
        text: (el.textContent || '').trim().slice(0, 24),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }
  const seen = new Set();
  out.tinyTargets = out.tinyTargets.filter(t => { const k = t.sel + t.w + t.h; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 25);
  return out;
});
console.log(JSON.stringify({ ...m, pageErrors: errs.slice(0, 8) }, null, 2));
await b.close();
