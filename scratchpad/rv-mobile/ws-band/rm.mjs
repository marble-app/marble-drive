import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, reducedMotion:'reduce' });
await p.goto('http://127.0.0.1:8742/rv.html',{waitUntil:'load'}); await p.waitForTimeout(900);
console.log(JSON.stringify(await p.evaluate(() => {
  const b=document.querySelector('.band'); const cs=getComputedStyle(b);
  return { snapType: cs.scrollSnapType, scrollBehavior: cs.scrollBehavior, wrapH: Math.round(document.querySelector('.band-wrap').getBoundingClientRect().height) };
})));
await b.close();
