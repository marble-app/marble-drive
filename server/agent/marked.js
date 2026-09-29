// What was marked, as the agent will see it.
//
// Describe mode sends words ("a box around q1") and ids, and the host adds the
// saved source of those ids. That is the document; it is not the screen. A
// page drawn by its own script, a canvas, a region that falls across three
// elements without covering any of them — the words say where, and nothing
// says what was there. So a brief from Describe mode carries two more things:
//
//   - what the page itself read off the screen under the marks at the moment
//     of sending (`seen`), live state and all — written by the page, since
//     only it has the state;
//   - a picture: the same document opened here, headless, at the width it was
//     read at, with the marks drawn back on it at their anchors, and the region
//     they cover cut out. Anchors, not pixels, because the fonts and the scroll
//     here are not the person's; a stroke is held as fractions of the element
//     it was drawn on, so it lands on the same words either way.
//
// One Chromium, launched when a brief first needs it, one shot at a time, and
// closed after a minute with nothing to do. A shot that fails or is slow is
// left out: the brief goes without its picture rather than not at all.

import { loadChromium } from './browser.js';

export const SEEN_BUDGET = 6_000;
const MAX_STROKES = 40;
const MAX_POINTS = 400;
const MAX_NOTES = 20;
const MAX_IDS = 60;

const num = (value, lo, hi) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};
const id = (value) => (typeof value === 'string' && value && value.length <= 200 ? value : null);

/** What a page sent, kept to what a shot and a prompt can use. Anything else
 *  in it is dropped; nothing in it is trusted to be small. */
export function cleanMarked(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const width = num(raw.viewport?.width, 200, 4000);
  const height = num(raw.viewport?.height, 200, 4000);
  const ids = (Array.isArray(raw.ids) ? raw.ids : []).map(id).filter(Boolean).slice(0, MAX_IDS);
  const strokes = (Array.isArray(raw.strokes) ? raw.strokes : []).slice(0, MAX_STROKES).map((stroke) => {
    const anchorId = id(stroke?.anchorId);
    const parts = (Array.isArray(stroke?.parts) ? stroke.parts : []).slice(0, 4).map((pairs) =>
      (Array.isArray(pairs) ? pairs : []).slice(0, MAX_POINTS)
        .map((pair) => [num(pair?.[0], -50, 50), num(pair?.[1], -50, 50)])
        .filter(([u, v]) => u !== null && v !== null))
      .filter((pairs) => pairs.length > 1);
    return anchorId && parts.length ? { anchorId, parts } : null;
  }).filter(Boolean);
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).slice(0, MAX_NOTES).map((note) => {
    const anchorId = id(note?.anchorId);
    const u = num(note?.u, -50, 50);
    const v = num(note?.v, -50, 50);
    return anchorId && u !== null && v !== null ? { anchorId, u, v, text: String(note?.text ?? '').slice(0, 500) } : null;
  }).filter(Boolean);
  const seen = typeof raw.seen === 'string' ? raw.seen.slice(0, SEEN_BUDGET) : '';
  const values = {};
  for (const [key, value] of Object.entries(raw.values && typeof raw.values === 'object' ? raw.values : {}).slice(0, MAX_IDS)) {
    if (!id(key)) continue;
    if (typeof value === 'boolean') values[key] = value;
    else if (typeof value === 'string') values[key] = value.slice(0, 500);
  }
  if (!ids.length && !strokes.length && !notes.length && !seen) return null;
  return {
    viewport: width && height ? { width: Math.round(width), height: Math.round(height) } : { width: 1280, height: 800 },
    ids,
    strokes,
    notes,
    values,
    seen,
  };
}

/** Runs in the headless page: hide Marble's own chrome, find the anchors,
 *  bring them into view, draw the marks back on, and say what to cut out. */
function drawMarks({ ids, strokes, notes, values = {} }) {
  const style = document.createElement('style');
  style.textContent = `
    marble-agent-drawer, .marble-callout, .marble-callout-layer, .marble-marks-layer, .marble-marks-held,
    [data-marble-transient]:not(style):not(script) { display: none !important; }
    .marble-shot-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; overflow: visible; }
    .marble-shot-layer svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .marble-shot-note {
      position: absolute; width: 190px; box-sizing: border-box; padding: 6px 8px 7px; border-radius: 10px;
      background: #fffbe6; color: #222; border: 1.5px solid #d4582a;
      font: 500 12.5px/1.35 system-ui, sans-serif; white-space: pre-wrap; word-break: break-word;
      box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 8px 22px rgba(0,0,0,.14);
    }`;
  document.head.append(style);
  const find = (key) => document.querySelector(`[data-marble-id="${CSS.escape(key)}"]`);
  // What they had typed and ticked, which this copy of the page never saw.
  for (const [key, value] of Object.entries(values)) {
    const field = find(key);
    if (!field) continue;
    if (typeof value === 'boolean') field.checked = value;
    else field.value = value;
  }
  const anchors = [...new Set([...ids, ...strokes.map((s) => s.anchorId), ...notes.map((n) => n.anchorId)])]
    .map(find).filter(Boolean);
  if (!anchors.length) return null;
  // The first anchor into the middle of the window, scrolling whatever holds
  // it; then the window again, so a region taller than that starts at its top.
  anchors[0].scrollIntoView({ block: 'center', inline: 'nearest' });
  const spans = () => {
    const out = [];
    const boxOf = (key) => find(key)?.getBoundingClientRect() ?? null;
    for (const key of ids) { const b = boxOf(key); if (b?.width || b?.height) out.push({ l: b.left, t: b.top, r: b.right, b: b.bottom }); }
    for (const stroke of strokes) {
      const b = boxOf(stroke.anchorId);
      if (!b) continue;
      for (const pairs of stroke.parts) for (const [u, v] of pairs) {
        const x = b.left + u * b.width;
        const y = b.top + v * b.height;
        out.push({ l: x, t: y, r: x, b: y });
      }
    }
    for (const note of notes) {
      const b = boxOf(note.anchorId);
      if (!b) continue;
      const x = b.left + note.u * b.width;
      const y = b.top + note.v * b.height;
      out.push({ l: x, t: y, r: x + 190, b: y + 60 });
    }
    if (!out.length) return null;
    return {
      left: Math.min(...out.map((s) => s.l)), top: Math.min(...out.map((s) => s.t)),
      right: Math.max(...out.map((s) => s.r)), bottom: Math.max(...out.map((s) => s.b)),
    };
  };
  let region = spans();
  if (region && (region.top < 0 || region.bottom > innerHeight)) {
    window.scrollBy(0, region.top - Math.max(24, (innerHeight - (region.bottom - region.top)) / 2));
    region = spans();
  }
  if (!region) return null;

  const layer = document.createElement('div');
  layer.className = 'marble-shot-layer';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  layer.append(svg);
  const colour = '#d4582a';
  for (const key of ids) {
    const b = find(key)?.getBoundingClientRect();
    if (!b) continue;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    Object.entries({
      x: b.left - 3, y: b.top - 3, width: b.width + 6, height: b.height + 6, rx: 6,
      fill: 'rgba(212,88,42,.06)', stroke: colour, 'stroke-width': 2, 'stroke-dasharray': '6 4',
    }).forEach(([k, v]) => rect.setAttribute(k, String(v)));
    svg.append(rect);
  }
  for (const stroke of strokes) {
    const b = find(stroke.anchorId)?.getBoundingClientRect();
    if (!b) continue;
    for (const pairs of stroke.parts) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pairs.map(([u, v], i) => `${i ? 'L' : 'M'}${(b.left + u * b.width).toFixed(1)} ${(b.top + v * b.height).toFixed(1)}`).join(' '));
      Object.entries({ fill: 'none', stroke: colour, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
        .forEach(([k, v]) => path.setAttribute(k, v));
      svg.append(path);
    }
  }
  for (const note of notes) {
    const b = find(note.anchorId)?.getBoundingClientRect();
    if (!b) continue;
    const node = document.createElement('div');
    node.className = 'marble-shot-note';
    node.textContent = note.text || '…';
    node.style.left = `${Math.round(b.left + note.u * b.width)}px`;
    node.style.top = `${Math.round(b.top + note.v * b.height)}px`;
    layer.append(node);
    const r = node.getBoundingClientRect();
    region.bottom = Math.max(region.bottom, r.bottom);
    region.right = Math.max(region.right, r.right);
  }
  document.documentElement.append(layer);

  const pad = 40;
  const left = Math.max(0, Math.floor(region.left - pad));
  const top = Math.max(0, Math.floor(region.top - pad));
  const right = Math.min(innerWidth, Math.ceil(region.right + pad));
  const bottom = Math.min(innerHeight, Math.ceil(region.bottom + pad));
  if (right - left < 8 || bottom - top < 8) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function createMarkedShots({ origin, cookie = () => null, chromium = null, log = console, idleMs = 60_000, timeoutMs = 20_000 } = {}) {
  let browser = null;
  let idle = null;
  let queue = Promise.resolve();

  const release = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      const closing = browser;
      browser = null;
      closing?.then((b) => b.close()).catch(() => {});
    }, idleMs);
    idle.unref?.();
  };

  const launch = () => {
    browser ??= (async () => (chromium ?? await loadChromium()).launch({ headless: true }))();
    browser.catch(() => { browser = null; });
    return browser;
  };

  async function take(docPath, marked) {
    const base = origin();
    const b = await launch();
    const { width, height } = marked.viewport;
    // Wide regions at 1×, small ones at 2×, so the words in the picture are
    // readable either way and it never becomes a ten-megabyte file.
    const context = await b.newContext({ viewport: { width, height }, deviceScaleFactor: width > 1100 ? 1 : 2 });
    try {
      const jar = cookie();
      if (jar) await context.addCookies([{ name: jar.name, value: jar.value, url: base }]);
      // The page is here to be looked at once: it does not join the document's
      // live streams, say a tab is in use, start chats of its own — or write
      // anything, whatever its script would do on load.
      await context.route(() => true, (route) => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        const quiet = pathname === '/events' || pathname === '/tab/alive' || pathname.startsWith('/agent/');
        return request.method() !== 'GET' || quiet ? route.abort() : route.continue();
      });
      const page = await context.newPage();
      const url = `${base}/a/${docPath.split('/').map(encodeURIComponent).join('/')}`;
      await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(250);
      const clip = await page.evaluate(drawMarks, marked);
      if (!clip) return null;
      await page.waitForTimeout(50);
      return await page.screenshot({ clip, type: 'png', timeout: timeoutMs });
    } finally {
      await context.close().catch(() => {});
    }
  }

  /** A PNG of the marked region of `docPath`, or null. Never throws. */
  function shoot(docPath, marked) {
    const run = queue.then(async () => {
      clearTimeout(idle);
      let timer;
      try {
        return await Promise.race([
          take(docPath, marked),
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs + 5_000); }),
        ]);
      } catch (err) {
        log.warn?.(`[agents] no picture of the marks on ${docPath}: ${err.message}`);
        return null;
      } finally {
        clearTimeout(timer);
        release();
      }
    });
    queue = run.catch(() => null);
    return run;
  }

  async function close() {
    clearTimeout(idle);
    const closing = browser;
    browser = null;
    await closing?.then((b) => b.close()).catch(() => {});
  }

  return { shoot, close };
}
