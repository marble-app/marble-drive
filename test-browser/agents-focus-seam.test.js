/** The seam between the field and the stage.
 *
 *  Focus balances the two sides at φ, which is a good answer to a question
 *  nobody asked. This is the question: a seam in the bar between them, the
 *  split it sets written into the document, and φ still there to go back to.
 *
 *  Its own file, for the reason agents-focus-piles.test.js gives: the older
 *  focus test files are rewritten wholesale by other conversations and a test
 *  appended there gets dropped without anything failing.
 */
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

const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(async () => {
  await openPage?.close().catch(() => {});
  await host.close();
});

// Every pin is a live pane on an event stream. Each test hands its page back
// before the next one asks for one.
let openPage = null;

const openAgents = async () => {
  if (openPage) {
    await openPage.close().catch(() => {});
    openPage = null;
  }
  await host.reset();
  const { page, errors } = await host.newPage({ viewport: { width: 1440, height: 900 } });
  openPage = page;
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      for (const row of await window.marble.agent.conversations()) await window.marble.agent.archive(row.id, true);
    } catch { /* fresh agent */ }
    try { localStorage.removeItem('marble-agents:focus-mode'); } catch { /* private */ }
  });
  return { page, errors };
};

const until = async (page, check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await page.waitForTimeout(50);
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** The split as the document has it. `data-split="…"` with a double quote is
 *  the attribute and nothing else: where the script names it, it is in single
 *  quotes. `null` is the attribute not being there at all, which is the
 *  layout's own answer rather than a number that happens to equal it. */
const splitInFile = async () => {
  const source = await host.drive.store.read('Agents');
  const found = /data-split="([\d.]+)"/.exec(source);
  return found ? Number(found[1]) : null;
};

/** The op reaches the file a beat after the pointer comes up. */
const untilSplit = async (want, tries = 60) => {
  let last;
  for (let n = 0; n < tries; n += 1) {
    last = await splitInFile();
    if (want(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`the document still says ${last}`);
};

/** One pin on the stage and a folder of four in the field: both sides exist,
 *  so there is a seam between them. */
const seed = async (page) => {
  await page.evaluate(async () => {
    const mk = async (title) => {
      const id = await window.marble.agent.start({ provider: 'fake' });
      await window.marble.agent.update(id, { title });
      return id;
    };
    const pinned = await mk('staged');
    await window.marble.agent.update(pinned, { pinned: true });
    const alpha = [];
    for (let i = 0; i < 4; i += 1) alpha.push(await mk(`alpha ${i + 1}`));
    await window.marble.agent.createFolder({ conversationIds: alpha, name: 'Research', color: 'research' });
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator('.focus-modes').waitFor();
  await page.locator('.focus-seam').waitFor();
  // Switching to Focus eases the whole canvas into place. A drag started
  // while it is still moving is a drag against a moving origin — the pointer
  // is read in canvas coordinates — so the seam trails the cursor by however
  // far the canvas still had to go. That is the view arriving, not the seam
  // missing; wait for it to land.
  await stillCanvas(page);
};

/** A mouse move dispatched over CDP has not been handled the instant the call
 *  returns. Two frames is the page having seen it: Chrome delivers a
 *  pointermove before the frame's callbacks, so a measurement after the second
 *  one is the page's answer and not the harness racing it. */
const settleFrames = (page) => page.evaluate(() => new Promise((done) => {
  requestAnimationFrame(() => requestAnimationFrame(() => done()));
}));

const stillCanvas = async (page) => {
  let last = null;
  let steady = 0;
  for (let i = 0; i < 40; i += 1) {
    const now = await page.evaluate(() => document.querySelector('.focus').getBoundingClientRect().left);
    // Three in a row, not two: an ease that has not started yet reads as two
    // measurements the same, and the wait ends before the movement begins.
    steady = last != null && Math.abs(now - last) < 0.1 ? steady + 1 : 0;
    if (steady >= 2) return;
    last = now;
    await page.waitForTimeout(40);
  }
};

/** The field as it stands and the stage beside it. A field dragged all the
 *  way in has no expanded basin left — only a rail of piles — which is a width
 *  of nought and not a missing measurement. */
const widths = (page) => page.evaluate(() => {
  const basin = document.querySelector('.focus-basin:not([data-pile])');
  const pane = document.querySelector('.pane');
  return {
    field: basin ? basin.getBoundingClientRect().width : 0,
    stage: pane.getBoundingClientRect().width,
    piles: document.querySelectorAll('.focus-basin[data-pile]').length,
  };
});

/** Where the seam stands, in the canvas coordinates the layout speaks in. */
const seamAt = (page) => page.evaluate(() => window.marbleFocusSeam?.()?.seamX ?? null);

/** A let-go springs the seam onto its stop, and the gesture is not over until
 *  that spring is. Watching the numbers stop changing is not enough — a slow
 *  frame reads as two measurements the same — so this waits on the spring
 *  itself. */
const seamSettled = async (page) => {
  for (let i = 0; i < 60; i += 1) {
    const now = await page.evaluate(() => window.marbleFocusSeam?.() ?? null);
    if (now && !now.settling) return now.seamX;
    await page.waitForTimeout(40);
  }
  throw new Error('the seam never stopped moving');
};

/** A basin eases to its new width, so a measurement taken the instant the
 *  pointer comes up is the old one. This waits for it to stop moving. */
const settled = async (page) => {
  let last = null;
  for (let i = 0; i < 40; i += 1) {
    const now = await widths(page);
    if (last && Math.abs(now.field - last.field) < 0.5 && Math.abs(now.stage - last.stage) < 0.5) return now;
    last = now;
    await page.waitForTimeout(40);
  }
  return last;
};

const dragSeamBy = async (page, dx, { still = false } = {}) => {
  const box = await page.locator('.focus-seam').boundingBox();
  const y = box.y + Math.min(200, box.height / 2);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 10 });
  // A hand that stops before it lifts has no momentum to hand over, which is
  // the only way to ask where the seam lands on its own account.
  if (still) {
    await page.waitForTimeout(160);
    await page.mouse.move(box.x + box.width / 2 + dx, y);
  }
  await page.mouse.up();
};

test('the two sides rest at φ, with a seam standing between them', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const { field, stage } = await widths(page);
  assert.ok(Math.abs(stage / field - 1.618) / 1.618 < 0.05, `stage/field should be about φ, got ${stage / field}`);
  const seam = await page.locator('.focus-seam').boundingBox();
  const gap = await page.evaluate(() => {
    const basin = document.querySelector('.focus-basin:not([data-pile])').getBoundingClientRect();
    return { right: basin.right, paneLeft: document.querySelector('.pane').getBoundingClientRect().left };
  });
  const centre = seam.x + seam.width / 2;
  assert.ok(centre > gap.right - 2 && centre < gap.paneLeft + 2, `the seam stands in the bar, at ${centre}`);
  assert.deepEqual(errors, []);
});

test('dragging the seam gives the field the width, and writes the split into the file', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const before = await widths(page);
  await dragSeamBy(page, 180);
  const after = await settled(page);
  assert.ok(after.field > before.field + 120, `the field should have grown: ${before.field} → ${after.field}`);
  assert.ok(after.stage < before.stage - 120, `and the stage given it up: ${before.stage} → ${after.stage}`);

  const split = await untilSplit((value) => value != null);
  const shown = after.stage / (after.stage + after.field);
  assert.ok(Math.abs(split - shown) < 0.03, `filed ${split}, showing ${shown}`);
  assert.deepEqual(errors, []);
});

test('the split a drag left is the one the next visit opens with', async () => {
  const { page } = await openAgents();
  await seed(page);
  await dragSeamBy(page, 160);
  await untilSplit((value) => value != null);
  const wanted = (await settled(page)).field;

  const { page: second } = await host.newPage({ viewport: { width: 1440, height: 900 } });
  await second.goto(`${host.base}/a/Agents`);
  await second.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await second.locator('.views [data-view="focus"]').click();
  await second.locator('.focus-seam').waitFor();
  await until(second, async () => Math.abs((await widths(second)).field - wanted) < 6, 'the field to reopen at its width');
  await second.close();
});

test('the seam answers the arrow keys, and two presses put φ back', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const rest = await widths(page);
  await page.locator('.focus-seam').focus();
  for (let n = 0; n < 3; n += 1) await page.keyboard.press('ArrowRight');
  const nudged = await settled(page);
  assert.ok(nudged.field > rest.field + 40, `arrows should widen the field: ${rest.field} → ${nudged.field}`);
  await untilSplit((value) => value != null);
  assert.equal(
    await page.locator('.focus-seam').getAttribute('aria-valuetext'),
    `${Math.round((1 - nudged.stage / (nudged.stage + nudged.field)) * 100)}% of the canvas to the field`,
  );

  // Two presses close together are the reset — and the attribute goes out of
  // the file, rather than being written back as a number that means φ.
  await page.locator('.focus-seam').click();
  await page.locator('.focus-seam').click({ delay: 20 });
  await until(page, async () => Math.abs((await widths(page)).field - rest.field) < 8, 'the field to go back to φ');
  await untilSplit((value) => value == null);
  assert.deepEqual(errors, []);
});

test('the seam never squeezes the stage past the width it needs to be read', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  await dragSeamBy(page, 1200);
  const wide = await widths(page);
  assert.ok(wide.stage > 280, `a pane keeps reading width, got ${wide.stage}`);
  assert.equal(
    await page.evaluate(() => {
      const el = document.querySelector('.focus');
      return el.scrollWidth > el.clientWidth + 1;
    }),
    false,
    'and the canvas still does not scroll sideways',
  );
  assert.deepEqual(errors, []);
});

test('dragging the seam onto the field folds it away, and dragging back brings it out', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const before = await widths(page);
  assert.equal(before.piles, 0, 'nothing is folded to begin with');

  // All the way in. The field does not stop at the width a column reads at —
  // it folds into the rail, and what is left of the canvas is the stage.
  await dragSeamBy(page, -1200);
  const shut = await settled(page);
  assert.equal(shut.field, 0, `the field folded away, got a column ${shut.field} wide`);
  assert.ok(shut.piles > 0, 'and stands in the rail as a pile');
  assert.ok(shut.stage > before.stage + 200, `the stage took the width: ${before.stage} → ${shut.stage}`);
  assert.equal(
    await page.evaluate(() => {
      const el = document.querySelector('.focus');
      return el.scrollWidth > el.clientWidth + 1;
    }),
    false,
    'and the canvas still does not scroll sideways',
  );
  // The seam is still there, or there would be no way to ask for the field
  // back — and asking brings the column out again.
  await page.locator('.focus-seam').waitFor();
  await dragSeamBy(page, 400);
  const back = await settled(page);
  assert.ok(back.field > 180, `the column came back out, got ${back.field}`);
  assert.deepEqual(errors, []);
});

test('the seam stays under the cursor the whole way in', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const stops = await page.evaluate(() => window.marbleFocusSeam?.() ?? null);
  const box = await page.locator('.focus-seam').boundingBox();
  const canvas = await page.evaluate(() => document.querySelector('.focus').getBoundingClientRect().left);
  const y = box.y + 200;
  const from = box.x + box.width / 2;
  await page.mouse.move(from, y);
  await page.mouse.down();
  const misses = [];
  for (let dx = -12; dx > -340; dx -= 12) {
    await page.mouse.move(from + dx, y);
    await settleFrames(page);
    const finger = from + dx - canvas;
    // The hollow under the last column is the one stretch with nothing in it:
    // there the seam holds at an end on purpose. Everywhere else it is under
    // the hand, and the couple of pixels are the field's columns taking whole
    // widths.
    if (stops.hollow && finger < stops.hollow[1] + 8) continue;
    const at = await seamAt(page);
    if (Math.abs(at - finger) > 4) misses.push(`${Math.round(finger)} → ${Math.round(at)}`);
  }
  await page.mouse.up();
  assert.deepEqual(misses, [], `the seam left the cursor at: ${misses.join(', ')}`);
  assert.deepEqual(errors, []);
});

test('the field folds only when the hand means it, and unfolds the same way', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const stops = await page.evaluate(() => window.marbleFocusSeam?.() ?? null);
  assert.ok(stops.hollow, 'a field that can fold away has a hollow under its last column');
  const [shut, open] = stops.hollow;
  const box = await page.locator('.focus-seam').boundingBox();
  const canvas = await page.evaluate(() => document.querySelector('.focus').getBoundingClientRect().left);
  const y = box.y + 200;
  const from = box.x + box.width / 2;
  const at = async (x) => {
    await page.mouse.move(canvas + x, y);
    await settleFrames(page);
    return seamAt(page);
  };
  await page.mouse.move(from, y);
  await page.mouse.down();
  // A little way into the hollow is not yet asking for the field to go: the
  // seam holds at the narrowest column it can show.
  assert.ok(Math.abs(await at(open - 20) - open) < 2, 'just inside, the field is still there');
  // A good pull past the end is asking, and the field folds into the rail.
  assert.ok(Math.abs(await at(open - 70) - shut) < 2, 'pulled past it, the field folds away');
  // Coming back out takes the same pull from the other end, so a hand resting
  // in the middle does not flutter the field open and shut.
  assert.ok(Math.abs(await at(shut + 20) - shut) < 2, 'just off the rail, coming back, is still shut');
  assert.ok(Math.abs(await at(shut + 70) - open) < 2, 'and pulled past that the column comes back');
  await page.mouse.up();
  assert.deepEqual(errors, []);
});

test('the drag follows the pointer off the canvas and out of the window', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  const box = await page.locator('.focus-seam').boundingBox();
  const canvas = await page.evaluate(() => document.querySelector('.focus').getBoundingClientRect().left);
  const y = box.y + 200;
  const from = box.x + box.width / 2;
  await page.mouse.move(from, y);
  await page.mouse.down();
  // The bar is twelve pixels wide and the gesture is not: a hand that wanders
  // over the stage, up into the topbar or off the window entirely is still
  // dragging the seam. Nothing here may depend on the pointer staying over
  // the element it came down on — or on that element surviving the drag,
  // which a patch landing mid-gesture can take away.
  const stations = [
    ['over the stage', from + 60, y],
    ['up in the topbar', from + 20, 8],
    ['below the canvas', from - 40, 894],
    ['off the top of the window', from - 100, -40],
  ];
  for (const [where, x, at] of stations) {
    await page.mouse.move(x, at);
    await settleFrames(page);
    const seam = await seamAt(page);
    assert.ok(Math.abs(seam - (x - canvas)) < 6, `${where}: the cursor is at ${Math.round(x - canvas)}, the seam at ${Math.round(seam)}`);
  }
  // Back inside before letting go: a release dispatched outside the window
  // is not always delivered, and a button left down belongs to the browser,
  // not to this test.
  await page.mouse.move(from - 100, y);
  await settleFrames(page);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('marble-resizing')), false, 'and the gesture ends');
  assert.deepEqual(errors, []);
});

test('a field the canvas has already folded can still be dragged all the way in', async () => {
  const { page, errors } = await openAgents();
  // Bryan's shape: two pins and far more chats than the canvas can hold, so
  // the packer folds some of the field before the seam is ever touched.
  await page.evaluate(async () => {
    const mk = async (title) => {
      const id = await window.marble.agent.start({ provider: 'fake' });
      await window.marble.agent.update(id, { title });
      return id;
    };
    for (let i = 0; i < 2; i += 1) {
      const id = await mk(`pinned ${i + 1}`);
      await window.marble.agent.update(id, { pinned: true });
    }
    const some = [];
    for (let i = 0; i < 15; i += 1) some.push(await mk(`folder ${i + 1}`));
    await window.marble.agent.createFolder({ conversationIds: some, name: 'Agents UI Polish', color: 'research' });
    for (let i = 0; i < 30; i += 1) await mk(`loose ${i + 1}`);
  });
  await page.locator('.views [data-view="focus"]').click();
  await page.locator('.focus-seam').waitFor();
  await stillCanvas(page);
  const seam = await page.evaluate(() => window.marbleFocusSeam());
  assert.ok(seam.min < seam.seamX - 200, `the travel reaches the rail, not ${Math.round(seam.min)}`);

  // And the hand gets all of it: 240px of cursor is 240px of seam, not the
  // fifty a rubber band would allow.
  const box = await page.locator('.focus-seam').boundingBox();
  const y = box.y + 200;
  const from = box.x + box.width / 2;
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(from - 240, y, { steps: 12 });
  await settleFrames(page);
  const at = await seamAt(page);
  await page.mouse.up();
  // All the travel there is: 240px of cursor spends every width the field
  // still has — down to the narrowest column, and past it into the rail if
  // the pull was long enough — rather than being eaten by a rubber band a few
  // pixels in. The bug this guards read `min` off a shape the canvas had
  // already folded past, which left the whole drag inside that band.
  const floor = seam.hollow ? seam.hollow[1] : seam.min;
  assert.ok(at <= floor + 4, `the seam stopped at ${Math.round(at)}, with travel down to ${Math.round(floor)}`);
  assert.ok(seam.seamX - at > 100, `and it really moved: ${Math.round(seam.seamX)} → ${Math.round(at)}`);
  assert.deepEqual(errors, []);
});

test('let go near a width that means something, the seam settles onto it', async () => {
  const { page, errors } = await openAgents();
  await seed(page);
  // Where the layout says the seam can stand. Asked before the drag, because
  // the answer is about the cards and not about where the seam happens to be.
  const stops = await page.evaluate(() => window.marbleFocusSeam?.() ?? null);
  assert.ok(stops && stops.stops.length >= 3, 'the layout offers stops to land on');
  const nearest = (x) => stops.stops.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), stops.stops[0]);
  const rest = await seamAt(page);

  // A nudge off a stop is not a new place to be: let go, it goes back.
  await dragSeamBy(page, -36, { still: true });
  const back = await seamSettled(page);
  assert.ok(Math.abs(back - rest) < 4, `a nudge came back to where it was: ${rest} → ${back}`);

  // A drag that reaches for the next one down lands on it exactly.
  await dragSeamBy(page, -150, { still: true });
  const at = await seamSettled(page);
  const near = nearest(at);
  assert.ok(Math.abs(near - at) < 4, `settled at ${Math.round(at)}, nearest stop ${Math.round(near)}`);
  assert.ok(Math.abs(near - rest) > 20, `and it is a different stop than the one it left, ${Math.round(near)}`);
  assert.deepEqual(errors, []);
});
