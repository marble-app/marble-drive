import { chromium } from 'playwright';
const b = await chromium.launch();
const url = 'http://127.0.0.1:8742/rv.html';

async function page(w=390,h=844){
  const p = await b.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:2, isMobile:w<700, hasTouch:w<700 });
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(url,{waitUntil:'load'}); await p.waitForTimeout(900); p._errs=errs; return p;
}
const state = p => p.evaluate(() => ({
  refs: document.querySelectorAll('.now-ref').length,
  nowCards: document.querySelectorAll('.pool > .item[data-now]').length,
  flashing: document.querySelectorAll('.marble-now-flash').length,
  tabindex: document.querySelector('.band').getAttribute('tabindex'),
}));
// geometry of card 1's x and title, in page coords
const geom = p => p.evaluate(() => {
  const c = document.querySelector('.now-ref');
  const x = c.querySelector('.now-ref-x');
  const t = c.querySelector('.now-ref-title');
  const r = e => { const b=e.getBoundingClientRect(); return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}; };
  return { card:r(c), x:r(x), title:r(t) };
});

const out = {};
// --- keyboard reach: tabindex only where the strip overflows
let p = await page(390,844);
out.tabindex_390 = (await state(p)).tabindex;
await p.close();
p = await page(1440,900);
out.tabindex_1440 = (await state(p)).tabindex;
await p.close();

// --- tap the x expander, 10px up-left of the glyph (inside the 44px area, outside the 18px glyph)
p = await page(390,844);
await p.evaluate(() => document.querySelector('.band-wrap').scrollIntoView({block:'center'}));
await p.waitForTimeout(300);
let g = await geom(p);
out.before = await state(p);
out.expanderPoint = { x: Math.round(g.x.l - 9), y: Math.round(g.x.t + 9) };
await p.mouse.click(out.expanderPoint.x, out.expanderPoint.y);
await p.waitForTimeout(400);
out.afterExpanderTap = await state(p);
out.errs1 = p._errs; await p.close();

// --- tap the card body (middle of the title)
p = await page(390,844);
await p.evaluate(() => document.querySelector('.band-wrap').scrollIntoView({block:'center'}));
await p.waitForTimeout(300);
g = await geom(p);
out.titlePoint = { x: Math.round(g.title.l + 30), y: Math.round(g.title.t + g.title.h/2) };
await p.mouse.click(out.titlePoint.x, out.titlePoint.y);
await p.waitForTimeout(250);
out.afterTitleTap = await state(p);
await p.close();

// --- tap the very end of the title row, just left of the expander
p = await page(390,844);
await p.evaluate(() => document.querySelector('.band-wrap').scrollIntoView({block:'center'}));
await p.waitForTimeout(300);
g = await geom(p);
out.edgePoint = { x: Math.round(g.x.l - 15), y: Math.round(g.card.t + 20) };
await p.mouse.click(out.edgePoint.x, out.edgePoint.y);
await p.waitForTimeout(250);
out.afterEdgeTap = await state(p);
await p.close();

console.log(JSON.stringify(out,null,1));
await b.close();
