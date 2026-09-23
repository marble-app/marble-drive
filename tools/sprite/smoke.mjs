// Smoke checks for a sprite, through `sprite proxy <port>:4400`:
//   node tools/sprite/smoke.mjs [http://127.0.0.1:4410]
// The Drive opens; a PDF gets a picture the page drew; a 100 MB upload with a
// chunk cut part way completes. Leaves Checks/ in that drive.
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://127.0.0.1:4410';
const PDF = ['%PDF-1.4','1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj','2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj','3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 280]/Contents 4 0 R>>endobj','4 0 obj<</Length 34>>stream','0.2 0.4 0.8 rg 20 20 160 240 re f','endstream endobj','trailer<</Root 1 0 R>>','%%EOF'].join('\n');
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const puts = [];
page.on('response', (r) => { if (r.request().method() === 'PUT' && r.url().includes('/drive/thumb')) puts.push(r.status()); });
await page.goto(`${BASE}/`);
await page.waitForFunction(() => Boolean(window.marble?.drive?.uploadFile));
console.log('A drive opens:', await page.title());

const pdf = await page.evaluate(async (text) => window.marble.drive.uploadFile({ folder: 'Checks', name: 'check.pdf', file: new File([text], 'check.pdf', { type: 'application/pdf' }) }), PDF);
for (let i = 0; i < 100 && !puts.length; i += 1) await page.waitForTimeout(200);
const thumb = await page.evaluate(async (p) => { const r = await fetch(`/drive/thumb?path=${encodeURIComponent(p)}&w=640`); return `${r.status} ${r.headers.get('content-type')}`; }, pdf.path);
console.log('B pdf picture:', pdf.path, 'PUT', puts, 'GET', thumb);

let cut = false;
await page.route(/\/drive\/uploads\/[0-9a-f]+\?offset=/, (route) => {
  if (!cut && /[?&]offset=33554432(&|$)/.test(route.request().url())) { cut = true; return route.abort('connectionreset'); }
  return route.continue();
});
const t0 = Date.now();
const big = await page.evaluate(async () => {
  const bytes = new Uint8Array(100 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i % 251;
  const states = [];
  const answer = await window.marble.drive.uploadFile({ folder: 'Checks', name: 'big.bin', file: new File([bytes], 'big.bin'), onState: (s) => states.push(s) });
  return { ...answer, states };
});
console.log('C 100 MB with a cut chunk:', JSON.stringify(big), 'cut', cut, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('errors:', errors);
await browser.close();
