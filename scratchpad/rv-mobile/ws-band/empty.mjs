import { chromium } from 'playwright';
const [,,W='390',H='844',name='empty'] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:+W,height:+H}, deviceScaleFactor:2, isMobile:+W<700, hasTouch:+W<700 });
await p.goto('http://127.0.0.1:8742/rv.html',{waitUntil:'load'});
await p.waitForTimeout(900);
await p.evaluate(() => {
  document.querySelectorAll('.pool > .item[data-now]').forEach(el => el.removeAttribute('data-now'));
  // nudge the document's own painter the way an unpin would
  document.querySelectorAll('.now-ref-x').forEach(x => {});
});
// let the doc repaint: click an unpin to force paintNow, or dispatch its own path
await p.evaluate(() => { const b=document.querySelector('.band'); b.querySelectorAll('.now-ref').forEach(r=>r.remove()); b.classList.add('is-empty'); });
await p.waitForTimeout(400);
const el = await p.$('.band-wrap');
await el.screenshot({ path:`${name}.png`, scale:'css' });
console.log(JSON.stringify(await p.evaluate(() => {
  const w=document.querySelector('.band-wrap'), b=document.querySelector('.band');
  return { wrapH: Math.round(w.getBoundingClientRect().height), bandH: Math.round(b.getBoundingClientRect().height),
           scrollW: b.scrollWidth, clientW: b.clientWidth, tabindex: b.getAttribute('tabindex'),
           pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
           after: getComputedStyle(b,'::after').content.slice(0,60) };
})));
await b.close();
