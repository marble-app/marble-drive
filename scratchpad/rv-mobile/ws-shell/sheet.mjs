import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://127.0.0.1:8741/rv.html',{waitUntil:'load'}); await p.waitForTimeout(900);
await p.click('.pm-opts'); await p.waitForTimeout(500);
await p.screenshot({path:'v-sheet.png', scale:'css'});
console.log('expanded:', await p.getAttribute('.pm-opts','aria-expanded'));
// does a dial inside the sheet still work?
await p.click('[data-set="arrange:list"]'); await p.waitForTimeout(400);
console.log('arrange after dial:', await p.getAttribute('.stage','data-arrange'));
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
console.log('expanded after esc:', await p.getAttribute('.pm-opts','aria-expanded'));
// does a bottom-bar preset still work AND visibly change the top of the page?
const before = await p.screenshot({ scale:'css' });
await p.click('[data-preset="timeline"]'); await p.waitForTimeout(600);
const after = await p.screenshot({ path:'v-timeline.png', scale:'css' });
console.log('arrange after preset:', await p.getAttribute('.stage','data-arrange'));
console.log('above-the-fold changed:', !before.equals(after));
console.log('errors:', errs);
await b.close();
