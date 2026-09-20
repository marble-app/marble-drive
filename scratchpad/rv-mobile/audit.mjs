// Walk every preset view at a given width, shoot it, and measure what breaks.
import { chromium } from 'playwright';
const w = +(process.argv[2] || 390), h = +(process.argv[3] || 844);
const tag = process.argv[4] || 'before';
const VIEWS = ['spine', 'board', 'timeline', 'now', 'map', 'claims', 'questions', 'framings'];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 700, hasTouch: w < 700 });
await p.goto('http://127.0.0.1:8731/rv.html', { waitUntil: 'load' });
await p.waitForTimeout(900);

const report = {};
for (const v of VIEWS) {
  await p.evaluate(v => document.querySelector(`[data-preset="${v}"]`)?.click(), v);
  await p.waitForTimeout(450);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${tag}-${w}-${v}.png`, scale: 'css' });
  report[v] = await p.evaluate(() => {
    const de = document.documentElement;
    const pool = document.querySelector('.pool');
    const band = document.querySelector('.band-wrap');
    const bandR = band ? band.getBoundingClientRect() : null;
    const hidden = band && getComputedStyle(band).display === 'none';
    return {
      arrange: document.querySelector('.stage').getAttribute('data-arrange'),
      pageOverflowPx: de.scrollWidth - de.clientWidth,
      poolScrollsX: pool ? pool.scrollWidth - pool.clientWidth : 0,
      bandH: hidden ? 0 : Math.round(bandR?.height || 0),
      docH: de.scrollHeight,
      // how far down the page the first idea card starts
      firstCardTop: Math.round((document.querySelector('.pool > .item:not([hidden])')?.getBoundingClientRect().top || 0) + window.scrollY),
    };
  });
}
console.log(JSON.stringify(report, null, 2));
await b.close();
