// Swipe the board sideways and look at where it comes to rest.
//   node swipe.mjs <port> <out> <width> <preset> <steps> <pageScrollY>
import { chromium } from 'playwright';
const [,,port='8743',out='sw',w='390',preset='board',steps='1',py='1160'] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:+w,height:844}, deviceScaleFactor:2, isMobile:+w<700, hasTouch:+w<700 });
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});
await p.goto(`http://127.0.0.1:${port}/rv.html`,{waitUntil:'load'});
await p.waitForTimeout(900);
await p.evaluate(v => document.querySelector(`[data-preset="${v}"]`)?.click(), preset);
await p.waitForTimeout(500);
await p.evaluate(y => window.scrollTo(0,+y), py); await p.waitForTimeout(300);
for (let i=0;i<+steps;i++) {
  // a real flick, at a y inside the board
  const box = await p.evaluate(()=>{const r=document.querySelector('.pool').getBoundingClientRect();return {y:Math.round(r.top+80)}});
  await p.mouse.move(200, box.y);
  await p.mouse.wheel(200, 0);
  await p.waitForTimeout(800);
}
await p.waitForTimeout(150);
await p.screenshot({path:`${out}.png`, scale:'css'});
console.log(JSON.stringify(await p.evaluate(()=>{
  const pool=document.querySelector('.pool');
  const hud=document.querySelector('.rv-hud');
  const lanes=[...pool.children].filter(e=>e.classList.contains('lane')&&e.getClientRects().length);
  return {
    scrollLeft:Math.round(pool.scrollLeft), max:pool.scrollWidth-pool.clientWidth,
    laneLefts:lanes.map(l=>Math.round(l.getBoundingClientRect().left)),
    strip:document.querySelector('.rv-cols-n')?.textContent,
    hud:hud?hud.textContent:null, hudLit:hud?hud.classList.contains('rv-lit'):null,
    pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
  };
}),null,1));
if(errs.length)console.log('ERRORS',errs);
await b.close();
