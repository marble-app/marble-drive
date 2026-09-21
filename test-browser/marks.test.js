import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const AGENTS = (await fsp.readFile(AGENTS_TEMPLATE, 'utf8'))
  .replaceAll('__TITLE__', 'Agents')
  .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
  .replace('__ICON__', '');

// A page taller than the window, with a row below the fold and a banner that
// does not move when the page does. The garden fixture is five elements in
// one screen and can say nothing about either.
const TALL = `<!doctype html>
<html><head><meta charset="utf-8"><title>Tall</title>
<style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  .banner { position: fixed; top: 0; left: 0; right: 0; height: 60px; background: #eee; }
  .gap { height: 1000px; }
  .row { height: 120px; background: #f6f6f6; }
  .tail { height: 1500px; }
</style></head>
<body data-marble-id="b">
  <div class="banner" data-marble-id="banner">Pinned to the window</div>
  <div class="gap" data-marble-id="gap"></div>
  <div class="row" data-marble-id="r1">Below the fold until you scroll</div>
  <div class="tail" data-marble-id="tail"></div>
</body></html>
`;

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS, tall: TALL } });
test.after(() => host.close());

const pages = [];
const closePages = async () => {
  for (const page of pages.splice(0)) await page.close().catch(() => {});
};
test.after(closePages);

const open = async (doc = 'garden', { width = 1200, height = 800, reducedMotion = null } = {}) => {
  await closePages();
  await host.reset();
  const { page } = await host.newPage();
  pages.push(page);
  await page.setViewportSize({ width, height });
  if (reducedMotion) await page.emulateMedia({ reducedMotion });
  await page.goto(`${host.base}/a/${doc}`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  return page;
};

const bar = (page) => page.locator('.marble-marks-bar');
const main = (page) => page.locator('.marble-marks-main');
const barBox = (page) => page.evaluate(() => {
  const r = document.querySelector('.marble-marks-bar').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});
const launcherBox = (page) => page.evaluate(() => {
  const r = document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});
// The toolbar takes its horizontal inset from the launcher it stacks on, not
// from its own PAD: the launcher's inset carries `env(safe-area-inset-right)`
// and the toolbar's would not, so two round buttons 6px out of true on a
// desktop are a whole notch apart on a phone in landscape. Above it, centred
// on it, one column.
const stackedOnLauncher = (box, launcher) => {
  const drift = Math.abs((box.left + box.width / 2) - (launcher.left + launcher.width / 2));
  assert.ok(drift <= 1, `toolbar centre is ${drift}px off the launcher's`);
  assert.ok(Math.abs(box.bottom - (launcher.top - 12)) <= 1, `bottom edge at ${box.bottom}, launcher top at ${launcher.top}`);
};

test('every document gets the toolbar in the bottom-right corner above the drawer\'s launcher; the Agents page does not', async () => {
  const page = await open();
  await bar(page).waitFor();
  stackedOnLauncher(await barBox(page), await launcherBox(page));
  assert.equal(await page.evaluate(() => document.querySelector('.marble-marks-layer').hasAttribute('data-marble-transient')), true);
  assert.equal(await main(page).getAttribute('aria-expanded'), 'false');

  const agents = await open('Agents');
  await agents.waitForTimeout(300);
  assert.equal(await agents.locator('.marble-marks-layer').count(), 0, 'no toolbar on the page made of agents');
});

test('the toolbar leaves the drawer’s launcher reachable in the same corner', async () => {
  const page = await open();
  await bar(page).waitFor();
  const [barRect, launcherRect] = await page.evaluate(() => {
    const l = document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher');
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    return [r(document.querySelector('.marble-marks-bar')), r(l)];
  });
  const overlaps = barRect.left < launcherRect.right && barRect.right > launcherRect.left
    && barRect.top < launcherRect.bottom && barRect.bottom > launcherRect.top;
  assert.equal(overlaps, false, `toolbar ${JSON.stringify(barRect)} covers launcher ${JSON.stringify(launcherRect)}`);
  // And the launcher is what a click in its middle actually reaches.
  const hit = await page.evaluate(() => {
    const l = document.querySelector('marble-agent-drawer').shadowRoot.querySelector('.launcher');
    const b = l.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return top?.tagName?.toLowerCase() ?? null;
  });
  assert.equal(hit, 'marble-agent-drawer');
});

test('the toolbar steps aside while the drawer is open, and comes back when it closes', async () => {
  const page = await open();
  await bar(page).waitFor();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').click();
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').hidden);
  await drawer.locator('button.close').click();
  await page.waitForFunction(() => !document.querySelector('.marble-marks-bar').hidden);
});

test('a resize while the drawer is open does not strand the toolbar when it reappears', async () => {
  const page = await open();
  await bar(page).waitFor();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').click();
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').hidden);
  // The bar is display:none here, so its offsetWidth/offsetHeight are 0.
  // restingPoint() must not use them, or this resize computes a degenerate
  // rest point nothing ever corrects afterwards.
  await page.setViewportSize({ width: 1000, height: 700 });
  await drawer.locator('button.close').click();
  await page.waitForFunction(() => !document.querySelector('.marble-marks-bar').hidden);
  stackedOnLauncher(await barBox(page), await launcherBox(page));
});

test('pinning the drawer moves the toolbar in with the page edge', async () => {
  const page = await open();
  await bar(page).waitFor();
  const drawer = page.locator('marble-agent-drawer');
  await drawer.locator('.launcher').click();
  await page.locator('marble-agent-drawer aside.panel[data-open="true"]').waitFor();
  await drawer.locator('button.pin').click();
  await page.locator('marble-agent-drawer aside.panel[data-pinned="true"]').waitFor();
  await page.waitForFunction(() => document.documentElement.getBoundingClientRect().right < innerWidth - 300);
  await page.waitForFunction(() => {
    const edge = document.documentElement.getBoundingClientRect().right;
    const r = document.querySelector('.marble-marks-bar').getBoundingClientRect();
    return Math.abs(r.right - (edge - 16)) <= 1;
  });
});

const strip = (page) => page.locator('.marble-marks-strip');
const tool = (page, name) => page.locator(`.marble-marks-tool[data-tool="${name}"]`);

test('the button opens a strip holding Select, out of its own corner, and closes it again', async () => {
  const page = await open();
  await bar(page).waitFor();
  assert.equal(await strip(page).isHidden(), true);
  await main(page).click();
  await strip(page).waitFor();
  assert.equal(await main(page).getAttribute('aria-expanded'), 'true');
  await tool(page, 'select').waitFor();
  assert.equal(await tool(page, 'select').getAttribute('aria-pressed'), 'false');
  assert.equal(await tool(page, 'select').getAttribute('data-label'), 'Select');
  // The strip hangs above the button and shares its right edge.
  const [b, s] = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return [r('.marble-marks-main'), r('.marble-marks-strip')];
  });
  assert.ok(s.bottom < b.top, 'strip sits above the button');
  assert.ok(Math.abs(s.right - b.right) <= 1, 'strip shares the button\'s right edge');
  assert.equal(await strip(page).evaluate((el) => {
    const [x, y] = getComputedStyle(el).transformOrigin.split(' ').map(parseFloat);
    return Math.round(x) === el.offsetWidth && Math.round(y) === el.offsetHeight;
  }), true, 'grows from the bottom right');
  await main(page).click();
  await page.waitForFunction(() => document.querySelector('.marble-marks-strip').hidden);
  assert.equal(await main(page).getAttribute('aria-expanded'), 'false');
});

test('under reduced motion the strip cross-fades in rather than blinking', async () => {
  const page = await open('garden', { reducedMotion: 'reduce' });
  await bar(page).waitFor();
  await main(page).click();
  // §5.7: every spring and slide becomes a cross-fade. Nothing about the
  // strip may move — but it still arrives, and `transition: none` would take
  // the fade away with the scale and leave a blink. Read while it is still
  // running, before the 300ms is up.
  const props = await strip(page).evaluate((el) => el.getAnimations()
    .flatMap((a) => a.effect.getKeyframes())
    .flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))));
  assert.ok(props.includes('opacity'), `the fade is running, got ${props.join(', ') || 'nothing at all'}`);
  assert.ok(!props.includes('transform') && !props.includes('filter'), `nothing moves, got ${props.join(', ')}`);
  await strip(page).waitFor();
  const settled = await strip(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return { transform: style.transform, filter: style.filter, transition: style.transitionProperty };
  });
  assert.equal(settled.transform, 'none');
  assert.equal(settled.filter, 'none');
  assert.ok(!/transform|filter/.test(settled.transition), `only opacity and display transition, got ${settled.transition}`);
});

const drag = async (page, from, to, { shift = false } = {}) => {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
};
const boxOf = (page, id) => page.locator(`[data-marble-id="${id}"]`).boundingBox();
const selection = (page) => page.evaluate(() => window.marble.agent.context().selection);
const enterSelect = async (page) => {
  // The strip's own `hidden` IDL property, not Playwright's rendered
  // isHidden(): a collapse from the previous drag is still visibly fading
  // out under the allow-discrete transition, so asking what is on screen
  // races that 300ms and can read "still open" moments before it finishes
  // closing for good.
  if (await strip(page).evaluate((el) => el.hidden)) await main(page).click();
  await tool(page, 'select').click();
  await page.locator('.marble-marks-layer[data-mode="select"]').waitFor();
};

test('Select outlines elements as the marquee crosses them, and a rect over a list hands the list to the callout', async () => {
  const page = await open();
  await bar(page).waitFor();
  await enterSelect(page);
  assert.equal(await tool(page, 'select').getAttribute('aria-pressed'), 'true');
  const q = await boxOf(page, 'q');
  await page.mouse.move(q.x - 6, q.y - 6);
  await page.mouse.down();
  await page.mouse.move(q.x + q.width + 6, q.y + q.height / 2, { steps: 6 });
  await page.locator('.marble-marks-marquee:not([hidden])').waitFor();
  // Half way down the list only the first item is covered.
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-hit:not([hidden])').length === 1);
  await page.mouse.move(q.x + q.width + 6, q.y + q.height + 6, { steps: 6 });
  await page.waitForFunction(() => document.querySelectorAll('.marble-marks-hit:not([hidden])').length === 1);
  await page.mouse.up();
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q"]');
  // The mode ends with the release, and the callout's handle takes over.
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  await page.locator('.marble-callout-handle:not([hidden])').waitFor();
  assert.equal(await page.locator('.marble-marks-marquee:not([hidden])').count(), 0);
});

test('a marquee that grazes an element selects nothing, and a fresh text selection replaces a marquee', async () => {
  const page = await open();
  await bar(page).waitFor();
  await enterSelect(page);
  const p = await boxOf(page, 'p');
  await drag(page, { x: p.x - 6, y: p.y + p.height - 3 }, { x: p.x + p.width + 6, y: p.y + p.height + 3 });
  await page.waitForTimeout(100);
  assert.deepEqual(await selection(page), []);

  await enterSelect(page);
  await drag(page, { x: p.x - 6, y: p.y - 6 }, { x: p.x + p.width + 6, y: p.y + p.height + 6 });
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');
  await page.evaluate(() => {
    const el = document.querySelector('[data-marble-id="h"]');
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h"]');
});

test('a page that scrolls under a drag commits what is on screen when the hand lets go', async () => {
  const page = await open('tall');
  await bar(page).waitFor();
  await enterSelect(page);
  // The boxes are measured at the press and translated by the scroll after
  // it, which is what keeps a momentum scroll off the frame budget. Two
  // things that translation cannot know: a row that was below the fold and
  // was never measured, and the banner, which is `position: fixed` and did
  // not move with the page at all. `finish` measures again before it commits
  // for exactly that reason.
  await page.mouse.move(1190, 380);
  await page.mouse.down();
  await page.mouse.move(1100, 420, { steps: 4 });
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(() => scrollY >= 590);
  await page.mouse.move(5, 540, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => window.marble.agent.context().selection.length > 0);
  assert.deepEqual(await selection(page), ['r1'], 'the row that scrolled into view, and not the banner that never moved');
});

test('Shift adds a second marquee; Escape leaves the mode and then clears the selection', async () => {
  const page = await open();
  await bar(page).waitFor();
  await enterSelect(page);
  const q1 = await boxOf(page, 'q1');
  await drag(page, { x: q1.x - 6, y: q1.y - 4 }, { x: q1.x + q1.width + 6, y: q1.y + q1.height + 4 });
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["q1"]');
  await enterSelect(page);
  const h = await boxOf(page, 'h');
  await drag(page, { x: h.x - 6, y: h.y - 6 }, { x: h.x + h.width + 6, y: h.y + h.height + 6 }, { shift: true });
  await page.waitForFunction(() => JSON.stringify([...window.marble.agent.context().selection].sort()) === '["h","q1"]');

  await enterSelect(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  assert.deepEqual((await selection(page)).sort(), ['h', 'q1'], 'leaving the mode keeps the selection');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.marble.agent.context().selection.length === 0);
});

test('double-clicking Select pins the mode for several rectangles', async () => {
  const page = await open();
  await bar(page).waitFor();
  await main(page).click();
  await tool(page, 'select').dblclick();
  await page.locator('.marble-marks-layer[data-mode="select"][data-pinned]').waitFor();
  const h = await boxOf(page, 'h');
  await drag(page, { x: h.x - 6, y: h.y - 6 }, { x: h.x + h.width + 6, y: h.y + h.height + 6 });
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["h"]');
  assert.equal(await page.evaluate(() => document.querySelector('.marble-marks-layer').dataset.mode), 'select', 'pinned: still in the mode');
  const p = await boxOf(page, 'p');
  await drag(page, { x: p.x - 6, y: p.y - 6 }, { x: p.x + p.width + 6, y: p.y + p.height + 6 });
  // Without Shift the second rectangle replaces the first.
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
});

test('Escape mid-drag ends the drag it was in, not just the mode', async () => {
  const page = await open();
  await bar(page).waitFor();
  await enterSelect(page);
  const h = await boxOf(page, 'h');
  await page.mouse.move(h.x - 6, h.y - 6);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width + 6, h.y + h.height + 6, { steps: 6 });
  await page.locator('.marble-marks-marquee:not([hidden])').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  assert.equal(await page.locator('.marble-marks-marquee:not([hidden])').count(), 0);
  assert.equal(await page.locator('.marble-marks-hit:not([hidden])').count(), 0);
  await page.mouse.up();
});

test('a tool mode owns Escape while it is on, and the callout\'s picks survive it', async () => {
  const page = await open();
  await bar(page).waitFor();
  const p = await boxOf(page, 'p');
  await page.keyboard.down('Alt');
  await page.mouse.click(p.x + 10, p.y + p.height / 2);
  await page.keyboard.up('Alt');
  await page.waitForFunction(() => JSON.stringify(window.marble.agent.context().selection) === '["p"]');

  await enterSelect(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.marble-marks-layer').dataset.mode === '');
  assert.deepEqual(await selection(page), ['p'], 'the pick is still there once the mode ends');
});

test('the toolbar can be thrown to another corner, and the corner is remembered', async () => {
  const page = await open();
  await bar(page).waitFor();
  const b = await barBox(page);
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 300, cy, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').hasAttribute('data-dragging'));
  await page.mouse.move(cx - 700, cy, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => localStorage.getItem('marble-marks:corner:garden') === 'bl');
  await page.waitForFunction(() => Math.abs(document.querySelector('.marble-marks-bar').getBoundingClientRect().left - 16) <= 1);
  assert.equal(await page.evaluate(() => document.querySelector('.marble-marks-bar').dataset.corner), 'bl');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  await bar(page).waitFor();
  await page.waitForFunction(() => Math.abs(document.querySelector('.marble-marks-bar').getBoundingClientRect().left - 16) <= 1);
});

test('a short press is a click, not a throw', async () => {
  const page = await open();
  await bar(page).waitFor();
  const b = await barBox(page);
  await page.mouse.move(b.left + 20, b.top + 20);
  await page.mouse.down();
  await page.mouse.move(b.left + 24, b.top + 22);
  await page.mouse.up();
  await strip(page).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('marble-marks:corner:garden')), null);
});

test('with the strip open, dragging closes it first, and the strip reopens on the new side', async () => {
  const page = await open();
  await bar(page).waitFor();
  await main(page).click();
  await strip(page).waitFor();
  const b = await barBox(page);
  await page.mouse.move(b.left + 20, b.top + 20);
  await page.mouse.down();
  await page.mouse.move(b.left - 900, b.top - 600, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('.marble-marks-strip').hidden);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').dataset.corner === 'tl');
  await main(page).click();
  await strip(page).waitFor();
  const [button, s] = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return [r('.marble-marks-main'), r('.marble-marks-strip')];
  });
  assert.ok(s.top > button.bottom, 'in a top corner the strip hangs below');
  assert.ok(Math.abs(s.left - button.left) <= 1, 'and shares the left edge');
});

test('under reduced motion a throw jumps and fades instead of springing', async () => {
  const page = await open('garden', { reducedMotion: 'reduce' });
  await bar(page).waitFor();
  const b = await barBox(page);
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 300, cy, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('.marble-marks-bar').hasAttribute('data-dragging'));
  await page.mouse.move(cx - 700, cy, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => localStorage.getItem('marble-marks:corner:garden') === 'bl');
  // A spring takes frames to converge; the jump is done in the same tick as
  // the release, so — with no wait at all — the bar should already sit at
  // its new corner rather than partway toward it.
  const left = (await barBox(page)).left;
  assert.ok(Math.abs(left - 16) <= 1, `jumped straight to the corner (left at ${left})`);
  // The only Animation running is the opacity fade: a spring never creates
  // a Web Animation at all (it drives `transform` by hand, frame by frame),
  // so anything here that touches a property other than opacity would mean
  // the spring path ran instead.
  const kinds = await page.evaluate(() => document.querySelector('.marble-marks-bar')
    .getAnimations()
    .flatMap((a) => a.effect.getKeyframes())
    .flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))));
  assert.ok(kinds.length > 0, 'the opacity fade is running');
  assert.ok(kinds.every((prop) => prop === 'opacity'), `only opacity animates, got ${kinds.join(', ')}`);
});
