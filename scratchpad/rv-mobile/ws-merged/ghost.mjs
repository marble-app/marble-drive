import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [w,h] of [[390,844],[744,1000],[1440,900]]) {
  const p = await b.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1, isMobile:w<700, hasTouch:w<700 });
  await p.goto('http://127.0.0.1:8750/rv.html',{waitUntil:'load'}); await p.waitForTimeout(1100);
  const r = await p.evaluate(()=>[...document.querySelectorAll('.pool > .col-add')].map(e=>({
    hidden:e.hidden, display:getComputedStyle(e).display,
    rect:(({x,y,width,height})=>({x:Math.round(x),y:Math.round(y),w:Math.round(width),h:Math.round(height)}))(e.getBoundingClientRect())})));
  console.log(w, JSON.stringify(r));
  await p.close();
}
await b.close();
