import { chromium } from 'playwright';
const [,,port='8742', w='1440', h='900'] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:+w,height:+h}, deviceScaleFactor:1 });
await p.goto(`http://127.0.0.1:${port}/rv.html`, { waitUntil:'load' });
await p.waitForTimeout(900);
console.log(JSON.stringify(await p.evaluate(() => {
  const r = el => { const b = el.getBoundingClientRect(); return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}; };
  const lines = el => Math.round(el.getClientRects().length ? el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight) : 0);
  return {
    bandWrap: r(document.querySelector('.band-wrap')),
    band: r(document.querySelector('.band')),
    cards: [...document.querySelectorAll('.now-ref')].map(c => ({
      t: c.querySelector('.now-ref-title').textContent.slice(0,26),
      card: r(c),
      title: r(c.querySelector('.now-ref-title')), titleLines: lines(c.querySelector('.now-ref-title')),
      gloss: r(c.querySelector('.now-ref-gloss')), glossLines: lines(c.querySelector('.now-ref-gloss')),
      form: r(c.querySelector('.now-ref-form')),
      x: r(c.querySelector('.now-ref-x')),
    })),
  };
}), null, 1));
await b.close();
