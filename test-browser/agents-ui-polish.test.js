// Six things Bryan caught in the Agents UI: a composer bar that grew a second
// row instead of folding, cards showing from behind their panes, focus that
// took the title away and lit the bar white, a dead New-group column, and a
// drag preview the size of the whole stage.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();
const host = await startDrive({ documents: { garden: GARDEN, Agents: AGENTS } });
test.after(() => host.close());

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(async () => {
    try {
      const { folders } = await window.marble.agent.folders();
      for (const row of folders) await window.marble.agent.deleteFolder(row.id);
    } catch { /* fresh agent */ }
    try {
      for (const row of await window.marble.agent.conversations()) await window.marble.agent.archive(row.id, true);
    } catch { /* fresh agent */ }
  });
  return { page, errors };
};

/** Two chats open side by side, so there is a focused pane and a neighbour. */
const openTwoPanes = async (page) => {
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const title of ['first chat', 'second chat']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
    }
  });
  await page.locator('#list .conv').nth(1).waitFor();
  await page.locator('#list .conv').first().click();
  await page.locator('.pane > marble-conversation[conversation]').waitFor();
  const row = await page.locator('#list .conv').nth(1).boundingBox();
  const at = await page.evaluate(() => {
    const r = document.querySelector('.pane').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(row.x + 60, row.y + 15);
  await page.mouse.down();
  await page.mouse.move(row.x + 100, row.y + 30, { steps: 3 });
  await page.mouse.move(at.x + at.w * 0.92, at.y + at.h * 0.5, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.dock-frame:not(.marble-leaving)').length >= 2);
  await page.waitForTimeout(600);
};

// ---------------------------------------------------------------- composer

test('a crowded composer bar folds its setups instead of growing a second row', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(id, { title: 'composer' });
  });
  await page.locator('#list .conv').first().click();
  await page.locator('.pane > marble-conversation[conversation]').waitFor();
  await page.waitForTimeout(500);

  // The state Bryan's screenshot is in: saved setups, a Custom toggle and a
  // long mode label, in a pane too narrow to hold them all at once.
  await page.evaluate(() => {
    const c = document.querySelector('marble-conversation[data-chrome]');
    const sr = c.shadowRoot;
    const presets = sr.querySelector('.presets');
    presets.hidden = false;
    ['Sonnet High', 'Opus Extra High', 'Grok High', 'Haiku Fast', 'Opus Plan'].forEach((name, i) => {
      const label = document.createElement('label');
      label.className = 'preset';
      label.dataset.index = String(i);
      label.innerHTML = `<input type="radio" name="setup" ${i === 1 ? 'checked' : ''}><span>${name}</span>`;
      presets.append(label);
    });
    sr.querySelector('.custom-toggle').hidden = false;
    sr.querySelector('.picker').hidden = true;
    const mode = sr.querySelector('.mode');
    mode.hidden = false;
    mode.textContent = 'Bypass permissions';
    sr.querySelector('.setup').hidden = false;
    document.querySelector('.pane').style.width = '460px';
    document.querySelector('.pane').style.flex = 'none';
    c.fitSetup();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('marble-conversation[data-chrome]').fitSetup());
  await page.waitForTimeout(400);

  const bar = await page.evaluate(() => {
    const sr = document.querySelector('marble-conversation[data-chrome]').shadowRoot;
    const box = (s) => { const el = sr.querySelector(s); const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, right: b.right }; };
    return {
      bar: box('.bar'), setup: box('.setup'), presets: box('.presets'),
      custom: box('.custom-toggle'), mode: box('.mode'), send: box('.send'),
      packed: sr.querySelectorAll('.presets-menu .preset').length,
    };
  });

  // The setup keeps one row: the track packs its extra setups into the ••• menu.
  assert.ok(bar.packed > 0, `expected setups to fold into the menu, packed ${bar.packed}`);
  assert.ok(bar.setup.h < 40, `setup grew to ${bar.setup.h}px — it wrapped instead of folding`);
  // Custom stays beside the track, not orphaned on a line of its own.
  assert.ok(
    Math.abs(bar.custom.y - bar.presets.y) < 12,
    `Custom sits ${Math.round(bar.custom.y - bar.presets.y)}px below the setups`,
  );
  // The mode label holds the bar's right edge; the send button is not in the
  // bar at all any more — it belongs to the field it sends.
  assert.ok(bar.bar.right - bar.mode.right < 14, `the mode label is ${Math.round(bar.bar.right - bar.mode.right)}px off the right edge`);
  assert.ok(bar.mode.x > bar.setup.x, 'the mode label should follow the setup, not sit under it');
  assert.ok(bar.send.bottom <= bar.bar.y + 1, 'send should sit above the settings bar, with the message');
});

// ------------------------------------------------------- panes and ghosts

test('no Focus card shows from behind the pane that covers it', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const [i, title] of ['pinned one', 'pinned two', 'loose'].entries()) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title, pinned: i < 2, focusY: (i + 1) / 4 });
    }
  });
  await page.locator('#list .conv').nth(2).waitFor();
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForTimeout(900);

  const leaks = await page.evaluate(() => {
    const frames = [...document.querySelectorAll('.dock-frame:not(.marble-leaving)')]
      .map((f) => f.getBoundingClientRect());
    const out = [];
    for (const card of document.querySelectorAll('.focus-card[data-lod="full"]')) {
      const c = card.getBoundingClientRect();
      // A Full card is the seat of a pane: some frame must cover it whole.
      const covered = frames.some((f) => (
        c.left >= f.left - 0.6 && c.right <= f.right + 0.6
        && c.top >= f.top - 0.6 && c.bottom <= f.bottom + 0.6
      ));
      if (!covered) {
        out.push({
          id: card.dataset.id,
          card: { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height) },
          frames: frames.map((f) => ({ x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.width), h: Math.round(f.height) })),
        });
      }
    }
    return out;
  });
  assert.deepEqual(leaks, [], `Full cards stick out from behind their panes: ${JSON.stringify(leaks)}`);
});

// ------------------------------------------------------------ focus state

test('moving focus between panes changes colour only — the title stays', async () => {
  const { page } = await openAgents();
  await openTwoPanes(page);

  const read = async () => page.evaluate(() => {
    const shot = (c) => {
      const sr = c.shadowRoot;
      const heading = sr.querySelector('.heading');
      const frame = c.closest('.dock-frame') ?? document.querySelector('.dock-frame[data-key="P"]');
      return {
        focused: c.getAttribute('data-focused'),
        headingShown: heading ? getComputedStyle(heading).display !== 'none' : false,
        headingText: heading?.textContent ?? '',
        surface: getComputedStyle(c).backgroundColor,
        frameBg: frame ? getComputedStyle(frame).backgroundColor : null,
      };
    };
    return [...document.querySelectorAll('marble-conversation[data-focused]')].map(shot);
  });

  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const before = await read();
  assert.equal(before.length, 2, 'expected two panes');
  // Every pane says what it is, focused or not.
  for (const pane of before) {
    assert.ok(pane.headingShown, `a ${pane.focused === 'true' ? 'focused' : 'neighbour'} pane hid its title`);
    assert.ok(pane.headingText.trim().length > 0, 'a pane heading was empty');
  }
  const lit = before.find((p) => p.focused === 'true');
  const rest = before.find((p) => p.focused === 'false');
  assert.ok(lit && rest, 'expected one focused pane and one neighbour');
  // Focus reads as a surface a shade deeper, never as a whiter one.
  assert.ok(
    lum(lit.surface) < lum(rest.surface) - 1,
    `focused surface ${lit.surface} is not darker than the neighbour ${rest.surface}`,
  );
  assert.ok(
    lum(lit.frameBg) <= lum(rest.frameBg),
    `focused frame ${lit.frameBg} is lighter than the neighbour ${rest.frameBg}`,
  );

  // The bar never goes white under the focused pane.
  const bars = await page.evaluate(() => [...document.querySelectorAll('.dock-bar')].map((b) => ({
    focused: b.hasAttribute('data-focused'),
    bg: getComputedStyle(b).backgroundColor,
  })));
  const litBar = bars.find((b) => b.focused);
  assert.ok(litBar, 'no focused bar');
  assert.ok(
    /rgba\(0, 0, 0, 0\)/.test(litBar.bg) || lum(litBar.bg) < 250,
    `the focused bar turned white (${litBar.bg})`,
  );

  // And the colour eases rather than cutting.
  const eases = await page.evaluate(() => {
    const frame = document.querySelector('.dock-frame');
    const c = document.querySelector('marble-conversation[data-focused]');
    return {
      frame: getComputedStyle(frame).transitionProperty,
      convo: getComputedStyle(c).transitionProperty,
    };
  });
  assert.match(eases.frame, /background-color|all/, 'the frame does not animate its colour');
  assert.match(eases.convo, /background-color|all/, 'the conversation does not animate its colour');

  // Switching focus keeps every title on screen.
  await page.evaluate(() => {
    const frames = [...document.querySelectorAll('.dock-frame:not([data-focused])')];
    frames[0]?.querySelector('.dock-bar')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  });
  await page.waitForTimeout(500);
  const after = await read();
  for (const pane of after) {
    assert.ok(pane.headingShown, 'a title disappeared when focus moved');
  }
});

// -------------------------------------------------------------- new group

test('the New group column is gone, and the field keeps the width it used to take', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const title of ['one', 'two', 'three']) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title });
    }
  });
  await page.locator('#list .conv').nth(2).waitFor();
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForTimeout(800);

  assert.equal(await page.locator('.focus-newgroup').count(), 0, 'a dead column is still on the canvas');

  // Lifting a card must not raise one either — a column that appears only for
  // the drag shoves the field sideways out from under the gesture.
  const before = await page.evaluate(() => [...document.querySelectorAll('.focus-basin')]
    .map((b) => Math.round(b.getBoundingClientRect().x)));
  const box = await page.locator('.focus-card').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + 30, { steps: 4 });
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.focus-newgroup').count(), 0, 'a column appeared on the lift');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => [...document.querySelectorAll('.focus-basin')]
    .map((b) => Math.round(b.getBoundingClientRect().x)));
  assert.deepEqual(after, before, 'the field moved across the drag');
});

test('a pinned card does not paint from under the pane that covers it', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const [i, title] of ['pinned one', 'pinned two', 'loose'].entries()) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title, pinned: i < 2, focusY: (i + 1) / 4 });
    }
  });
  await page.locator('#list .conv').nth(2).waitFor();
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForTimeout(900);

  const shown = await page.evaluate(() => [...document.querySelectorAll('.focus-card[data-lod="full"]')]
    .map((c) => ({ id: c.dataset.id, seated: c.hasAttribute('data-seated'), vis: getComputedStyle(c).visibility })));
  assert.ok(shown.length >= 2, 'expected the pins to have cards');
  for (const card of shown) {
    assert.equal(card.seated, true, 'a pinned card under a pane should be seated');
    assert.equal(card.vis, 'hidden', 'a seated card must not paint — that is the duplicate pane');
  }
  // Scrolling the canvas cannot expose it either: the pane is position:fixed
  // and does not follow, which is how the second title bar appeared.
  await page.evaluate(() => { const f = document.querySelector('.focus'); f.scrollTop += 150; f.scrollLeft += 150; });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => [...document.querySelectorAll('.focus-card[data-lod="full"]')]
    .map((c) => getComputedStyle(c).visibility));
  assert.ok(after.every((v) => v === 'hidden'), 'a seated card became visible after a scroll');
});

test('the field fills the canvas even when two regions share a column', async () => {
  const { page } = await openAgents({ viewport: { width: 1800, height: 1000 } });
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const ids = [];
    for (let i = 0; i < 7; i += 1) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title: `chat ${i}`, pinned: i < 2, focusY: (i + 1) / 8 });
      ids.push(id);
    }
    await agent.createFolder({ conversationIds: ids.slice(2, 4), name: 'small group' });
  });
  await page.locator('#list .conv').nth(6).waitFor();
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForTimeout(1000);

  const fill = await page.evaluate(() => {
    const focus = document.querySelector('.focus');
    const box = focus.getBoundingClientRect();
    let right = 0;
    for (const el of document.querySelectorAll('.focus-basin, .pane')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) right = Math.max(right, r.right);
    }
    return { canvasRight: box.right, usedRight: right, unused: box.right - right };
  });
  // One margin of air is the design; a dead column is not.
  assert.ok(
    fill.unused <= 24,
    `${Math.round(fill.unused)}px of canvas goes unused on the right (used ${Math.round(fill.usedRight)} of ${Math.round(fill.canvasRight)})`,
  );
});

// ------------------------------------------------------------ drag preview

test('dragging onto the stage previews a column, not the whole stage', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    for (const [i, title] of ['pinned', 'loose one', 'loose two'].entries()) {
      const id = await agent.start({ provider: 'fake' });
      await agent.update(id, { title, pinned: i === 0, focusY: (i + 1) / 4 });
    }
  });
  await page.locator('#list .conv').nth(2).waitFor();
  await page.locator('.views [data-view="focus"]').click();
  await page.waitForTimeout(900);

  const from = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.focus-card[data-lod="digest"]')][0];
    const r = card.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const stage = await page.evaluate(() => {
    const r = document.querySelector('.pane').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 30, from.y - 20, { steps: 4 });
  // Just off the stage's leading edge — inside the band a drop reads as
  // "a new column here", not over a pane, which would open room instead.
  await page.mouse.move(stage.x - 5, stage.y + stage.h * 0.5, { steps: 12 });
  await page.waitForTimeout(400);

  const preview = await page.evaluate(() => {
    const slot = document.querySelector('.focus-stageslot') ?? document.querySelector('.focus-slot');
    const s = document.querySelector('.pane').getBoundingClientRect();
    if (!slot) return { slot: null, stageW: s.width };
    const r = slot.getBoundingClientRect();
    // It has to be on top of the panes to be a preview at all.
    const mid = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      slot: { w: r.width, h: r.height, z: getComputedStyle(slot).zIndex },
      overPanes: Boolean(mid?.closest?.('.focus-stageslot')) || getComputedStyle(slot).pointerEvents === 'none',
      stageW: s.width,
      stageH: s.height,
    };
  });
  await page.mouse.up();
  await page.waitForTimeout(300);

  assert.ok(preview.slot, `no drop preview was drawn for a stage drop (target ${JSON.stringify(preview.target)})`);
  assert.ok(
    preview.slot.w < preview.stageW * 0.9,
    `the drop preview is ${Math.round(preview.slot.w)}px wide against a ${Math.round(preview.stageW)}px stage — it covers the whole thing`,
  );
});

// ------------------------------------------------------------ one title each

/** A dock used to name every conversation twice: 12.5px in the bar and 15px in
 *  the mast right beneath it, the lower one larger. The heading wins, because
 *  it is the one you can type in. */
test('a docked pane names itself once — the heading, not the bar', async () => {
  const { page } = await openAgents();
  await openTwoPanes(page);

  const shot = await page.evaluate(() => {
    const px = (el, prop) => (el ? parseFloat(getComputedStyle(el)[prop]) : null);
    const shown = (el) => Boolean(el)
      && getComputedStyle(el).display !== 'none'
      && el.getBoundingClientRect().width > 0;
    return {
      bars: [...document.querySelectorAll('.dock-bar')].map((bar) => {
        const title = bar.querySelector('.dock-title');
        return { shown: shown(title), text: (title?.textContent ?? '').trim() };
      }),
      headings: [...document.querySelectorAll('marble-conversation[data-chrome="tile"]')].map((convo) => {
        const heading = convo.shadowRoot.querySelector('.heading');
        return {
          shown: shown(heading),
          text: (heading?.textContent ?? '').trim(),
          size: px(heading, 'fontSize'),
        };
      }),
    };
  });

  assert.equal(shot.headings.length, 2, 'expected two tile-chrome panes');
  for (const heading of shot.headings) {
    assert.ok(heading.shown, 'a docked pane hid its heading');
    assert.ok(heading.text.length > 0, 'a docked pane had an empty heading');
    assert.ok(heading.size <= 13.01, `a docked heading is ${heading.size}px — 13px or smaller was asked for`);
  }
  const named = shot.bars.filter((bar) => bar.shown && bar.text.length > 0);
  assert.deepEqual(
    named,
    [],
    `${named.length} of ${shot.bars.length} bars still carry a title beside the heading: ${JSON.stringify(named)}`,
  );
});

/** A lone pane has no heading — the `pane` chrome rule hides it — so its bar is
 *  the only thing naming it and keeps the title. Smaller, not gone. */
test('a lone pane keeps its bar title, and it is smaller', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'the only chat' });
  });
  await page.locator('#list .conv').first().click();
  await page.locator('.pane > marble-conversation[conversation]').waitFor();
  await page.locator('.pane > .dock-bar .dock-title').waitFor();
  await page.waitForTimeout(300);

  const shot = await page.evaluate(() => {
    const bar = document.querySelector('.pane > .dock-bar .dock-title');
    const convo = document.querySelector('.pane > marble-conversation[conversation]');
    const heading = convo?.shadowRoot?.querySelector('.heading');
    return {
      barText: (bar?.textContent ?? '').trim(),
      barShown: Boolean(bar) && getComputedStyle(bar).display !== 'none',
      barSize: bar ? parseFloat(getComputedStyle(bar).fontSize) : null,
      headingShown: Boolean(heading) && getComputedStyle(heading).display !== 'none',
    };
  });

  assert.ok(shot.barShown, 'a lone pane hid the one title it has');
  assert.match(shot.barText, /\S/, 'a lone pane had an empty bar title');
  assert.ok(shot.barSize <= 11.51, `a lone bar title is ${shot.barSize}px — 11.5px or smaller was asked for`);
  assert.ok(!shot.headingShown, 'a lone pane showed a heading as well as its bar title');
});
