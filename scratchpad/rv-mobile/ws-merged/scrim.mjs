import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
await p.goto('http://127.0.0.1:8750/rv.html',{waitUntil:'load'}); await p.waitForTimeout(900);
await p.click('.pm-opts button'); await p.waitForTimeout(600);
const r = await p.evaluate(()=>{
  const out={};
  for (const s of ['.pm-scrim','.marble-sheet-scrim','[class*=scrim]','[class*=pm-]']) {
    const els=[...document.querySelectorAll(s)];
    out[s]=els.map(e=>({cls:e.className, rect:e.getBoundingClientRect().toJSON(), z:getComputedStyle(e).zIndex, pos:getComputedStyle(e).position}));
  }
  out.bodyClasses = document.body.className;
  return out;
});
console.log(JSON.stringify(r,null,1).slice(0,2200));
await b.close();
