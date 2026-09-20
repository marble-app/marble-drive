import { chromium } from 'playwright';
const [,,W='390',H='844',sx='0',name='band'] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:+W,height:+H}, deviceScaleFactor:2, isMobile:+W<700, hasTouch:+W<700 });
await p.goto('http://127.0.0.1:8742/rv.html', { waitUntil:'load' });
await p.waitForTimeout(900);
if (+sx) await p.evaluate(x => document.querySelector('.band').scrollLeft = x, +sx);
await p.waitForTimeout(300);
const el = await p.$('.band-wrap');
await el.screenshot({ path: `${name}.png`, scale: 'css' });
console.log(JSON.stringify(await p.evaluate(() => {
  const band = document.querySelector('.band');
  return { scrollWidth: band.scrollWidth, clientWidth: band.clientWidth, wrapH: Math.round(document.querySelector('.band-wrap').getBoundingClientRect().height) };
})));
await b.close();
