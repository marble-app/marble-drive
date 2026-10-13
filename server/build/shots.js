// Pictures of the sketches a build takes. A sketch is often a drawing of an
// interface (a panel boxed in, a button scrawled where it should go), and
// words for it ("Ink sketched over #h") lose what was drawn. So when a build
// starts, the app is opened in a headless Chromium, each sketch is drawn over
// it in the same place (its points are fractions of the part it was drawn
// on: agent-marks.js toFractions), and that stretch of the app is
// photographed. The brief hands the build those pictures to Read.
//
// Never fails a build: no Chromium, no page, a slow page, and the sketch is
// briefed in words alone, as before.

import { loadChromium, passCookies } from '../agent/browser.js';

const VIEWPORT = { width: 1280, height: 900 };
const PAD = 48;        // px of the app shown around a sketch
const MIN = { width: 360, height: 220 };
const INK = '#d6453d';

/** Draw one sketch over the page and say what to photograph, in page px. */
function drawSketch(mark) {
  const anchor = mark.anchorId ? document.querySelector(`[data-marble-id="${CSS.escape(mark.anchorId)}"]`) : null;
  const box = (anchor ?? document.body).getBoundingClientRect();
  const x0 = scrollX + box.left;
  const y0 = scrollY + box.top;
  const parts = mark.parts.map((part) => part.pairs.map(([u, v]) => [x0 + u * box.width, y0 + v * box.height]));
  const all = parts.flat();
  if (!all.length) return null;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('data-marble-shot', '');
  const W = document.documentElement.scrollWidth;
  const H = document.documentElement.scrollHeight;
  Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: `${W}px`, height: `${H}px`, pointerEvents: 'none', zIndex: '2147483647', overflow: 'visible' });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  for (const points of parts) {
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
    Object.assign(line.style, { fill: 'none', stroke: mark.ink, strokeWidth: '3', strokeLinecap: 'round', strokeLinejoin: 'round' });
    svg.append(line);
  }
  document.documentElement.append(svg);
  const pad = mark.pad;
  let cl = left - pad;
  let ct = top - pad;
  let cw = right - left + pad * 2;
  let ch = bottom - top + pad * 2;
  if (cw < mark.min.width) { cl -= (mark.min.width - cw) / 2; cw = mark.min.width; }
  if (ch < mark.min.height) { ct -= (mark.min.height - ch) / 2; ch = mark.min.height; }
  cl = Math.max(0, Math.min(cl, W - cw));
  ct = Math.max(0, Math.min(ct, H - ch));
  return { x: Math.round(cl), y: Math.round(ct), width: Math.round(Math.min(cw, W)), height: Math.round(Math.min(ch, H)) };
}

/**
 * Photograph each sketch over the app.
 * @param {object} input
 * @param {string} input.origin   this host, on loopback
 * @param {string|null} input.cookie  the drive pass, `name=value`, when the drive is gated
 * @param {string} input.docPath
 * @param {object[]} input.marks  the marks the build takes; only sketches are drawn
 * @returns {Promise<Map<string, Buffer>>} mark id → PNG
 */
export async function shootSketches({ origin, cookie = null, docPath, marks, timeout = 20_000, log = console, chromium = null }) {
  const strokes = (marks ?? []).filter((m) => m.type === 'stroke' && m.parts?.length);
  const out = new Map();
  if (!strokes.length || !origin) return out;
  let browser = null;
  try {
    const engine = chromium ?? await loadChromium();
    browser = await engine.launch();
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    if (cookie) await context.addCookies(passCookies({ origin, cookie }));
    // The app as it is used: no Describe toolbar, no shell, no marks of its own.
    await context.addInitScript(() => {
      try {
        localStorage.setItem('marble-build', 'off');
        localStorage.setItem('marble-shell:open', '0');
      } catch { /* opaque origin */ }
    });
    const page = await context.newPage();
    const href = `${origin}/a/${String(docPath).split('/').map(encodeURIComponent).join('/')}`;
    await page.goto(href, { waitUntil: 'load', timeout });
    await page.waitForTimeout(700);
    for (const mark of strokes) {
      const clip = await page.evaluate(drawSketch, { anchorId: mark.anchorId, parts: mark.parts, ink: INK, pad: PAD, min: MIN }).catch(() => null);
      if (!clip?.width || !clip?.height) continue;
      const bytes = await page.screenshot({ clip, fullPage: true, timeout }).catch(() => null);
      await page.evaluate(() => { for (const node of document.querySelectorAll('[data-marble-shot]')) node.remove(); }).catch(() => {});
      if (bytes?.length) out.set(mark.id, bytes);
    }
  } catch (err) {
    log.error?.(`[builds] sketches were not photographed: ${err.message}`);
  } finally {
    await browser?.close().catch(() => {});
  }
  return out;
}
