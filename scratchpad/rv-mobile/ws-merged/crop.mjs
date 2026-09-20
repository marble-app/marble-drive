import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [label,port] of [['crop-merged',8750],['crop-pristine',8731]]) {
  const p = await b.newPage({ viewport:{width:1440,height:900}, deviceScaleFactor:4 });
  await p.goto(`http://127.0.0.1:${port}/rv.html`,{waitUntil:'load'}); await p.waitForTimeout(900);
  await p.evaluate(()=>document.querySelector('[data-preset="board"]').click()); await p.waitForTimeout(700);
  await p.screenshot({ path:`${label}.png`, clip:{x:1280,y:325,width:140,height:26} });
  await p.close();
}
await b.close();
