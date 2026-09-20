import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [label,port] of [['merged',8750],['pristine',8731]]) {
  const p = await b.newPage({ viewport:{width:1440,height:900} });
  await p.goto(`http://127.0.0.1:${port}/rv.html`,{waitUntil:'load'}); await p.waitForTimeout(900);
  await p.evaluate(()=>document.querySelector('[data-preset="board"]').click()); await p.waitForTimeout(600);
  console.log(label, JSON.stringify(await p.evaluate(()=>({
    counts: document.querySelector('[data-counts]')?.textContent,
    rect: (({x,y,width})=>({x:Math.round(x),y:Math.round(y),w:Math.round(width)}))(document.querySelector('[data-counts]').getBoundingClientRect()),
  }))));
  await p.close();
}
await b.close();
