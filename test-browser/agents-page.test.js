import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive, usageHistoryStub } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
  permission: [{ ask: { tool: 'Bash', input: { command: 'ls' } } }, { say: 'after' }],
  answer: [{ say: 'Just an answer.' }],
  sendone: [
    { call: 'list_agents', args: {}, as: 'peers' },
    { call: 'send_message', args: { to: { $ref: 'peers.agents.0.id' }, text: 'ping from a' }, as: 'sent' },
    { say: 'sent' },
  ],
};

const AGENTS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'agents.mrbl');
const sourceOfAgents = async () => {
  const raw = await fsp.readFile(AGENTS_TEMPLATE, 'utf8');
  return raw
    .replaceAll('__TITLE__', 'Agents')
    .replaceAll('__ID__', () => Math.random().toString(36).slice(2, 10))
    .replace('__ICON__', '');
};
const AGENTS = await sourceOfAgents();

const host = await startDrive({
  scripts: SCRIPTS,
  documents: { garden: GARDEN, Agents: AGENTS },
});
test.after(() => host.close());

const openAgents = async (options = {}) => {
  await host.reset();
  const { page, errors } = await host.newPage(options);
  await page.goto(`${host.base}/a/Agents`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  return { page, errors };
};

// Filters and search live in a popover off the Filter button.
const openFilters = async (page) => {
  if (await page.locator('.filterbox[data-open]').count() === 0) await page.locator('.filter-toggle').click();
  await page.locator('.filter-pop').waitFor({ state: 'visible' });
};

// The strip is two sliders and only two — Claude and Fable, the pair you
// spend. Every other provider keeps its meters in Settings › Usage.
test('the topbar shows used usage for Claude, and no other provider', async () => {
  const { page } = await openAgents();
  const claude = page.locator('.usage .meter[data-id="claude-subscription"]');
  await claude.waitFor();
  assert.match(await claude.textContent(), /23%/);
  assert.equal(await page.locator('.usage .meter[data-id="cursor"]').count(), 0, 'Cursor is not on the strip');
  assert.equal(await page.locator('header.topbar .usage .meter').count(), 2, 'two sliders, no more');
  const fill = await claude.locator('.meter-bar i').evaluate((el) => el.style.width);
  assert.equal(fill, '23%');
  assert.equal(await claude.getAttribute('data-tone'), 'blue');
});

test('the topbar shows a Fable slider beside Claude', async () => {
  const { page } = await openAgents();
  const fable = page.locator('.usage .meter[data-id="fable"]');
  await fable.waitFor();
  assert.match(await fable.textContent(), /Fable/);
  assert.match(await fable.textContent(), /58%/);
  assert.equal(await fable.locator('.meter-bar i').evaluate((el) => el.style.width), '58%');
  assert.equal(await fable.getAttribute('data-tone'), 'yellow');
  await fable.hover();
  assert.match(await page.locator('#marble-usage-tip').textContent(), /reset/i);
  // Claude stays the 5-hour bar, and Fable is not counted as a second Claude.
  assert.equal(await page.locator('.usage .meter[data-id="claude-subscription"] .meter-pct').textContent(), '23%');
});

// A slider that vanishes takes the row's shape with it, and reads as "none
// left" rather than "not known". So the pair is always drawn, greyed.
test('the Fable slider stays, greyed, when there is no Fable usage to show', async () => {
  const { page } = await openAgents();
  await page.locator('.usage .meter[data-id="claude-subscription"]').waitFor();
  await page.evaluate(() => {
    window.marbleAgentUI.fillMeters(document.querySelector('header.topbar > .usage'), [
      { id: 'claude-subscription', label: 'Claude', used: 23, windows: [{ id: '5h', label: 'Short-term', used: 23, kind: 'quota' }] },
    ]);
  });
  const fable = page.locator('.usage .meter[data-id="fable"]');
  assert.equal(await fable.count(), 1);
  assert.equal(await fable.getAttribute('data-tone'), 'unavailable');
});

test('a host with no usage at all still shows the two sliders', async () => {
  const { page } = await openAgents();
  await page.locator('.usage .meter[data-id="claude-subscription"]').waitFor();
  await page.evaluate(() => {
    window.marbleAgentUI.fillMeters(document.querySelector('header.topbar > .usage'), []);
  });
  assert.deepEqual(
    await page.locator('header.topbar .usage .meter').evaluateAll((els) => els.map((el) => [el.dataset.id, el.dataset.tone])),
    [['claude-subscription', 'unavailable'], ['fable', 'unavailable']],
  );
});

test('on a phone the meters are one ring in the topbar and a Fleet sheet that stays inside the screen', async () => {
  const { page } = await openAgents({ viewport: { width: 360, height: 700 } });
  await page.reload();
  await page.locator('.topbar .usage-dot:not([hidden])').waitFor();
  assert.equal(await page.locator('.usage .meter').filter({ visible: true }).count(), 0, 'no meter strip on a phone');
  await page.locator('.topbar .usage-dot').click();
  const sheet = page.locator('.sheet[data-kind="fleet"]');
  // One row per usage window now, in place of the meter strip the sheet used
  // to repeat in text underneath.
  await sheet.locator('.fleet-row').first().waitFor();
  const boxes = await sheet.locator('.fleet-row').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.querySelector('.fleet-name')?.textContent ?? '', right: r.right, scroll: el.scrollWidth > el.clientWidth + 1 };
  }));
  assert.ok(boxes.length >= 2, `a row per window, not ${boxes.length}`);
  assert.ok(boxes.some((box) => /fable/i.test(box.name)), `no Fable window: ${boxes.map((b) => b.name).join(' / ')}`);
  assert.ok(boxes.every((box) => box.right <= 360 && !box.scroll), 'the rows stay inside the phone');
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 360);
});

test('a Claude meter with no progress reads as unavailable', async () => {
  const { page } = await openAgents();
  await page.locator('.usage .meter[data-id="claude-subscription"]').waitFor();
  await page.evaluate(() => {
    window.marbleAgentUI.fillMeters(document.querySelector('header.topbar > .usage'), [
      { id: 'claude-subscription', label: 'Claude', available: false, used: null, detail: 'Unavailable' },
      { id: 'cursor', label: 'Cursor', used: 19 },
    ]);
  });
  const claude = page.locator('.usage .meter[data-id="claude-subscription"]');
  assert.equal(await claude.getAttribute('data-tone'), 'unavailable');
  assert.match(await claude.textContent(), /Unavailable/i);
  assert.equal(await page.locator('.usage .meter[data-id="cursor"]').count(), 0, 'and Cursor is not on the strip');
});

test('usage meters color by how much has been used', async () => {
  const { page } = await openAgents();
  const tones = await page.evaluate(() => {
    const fn = window.marbleAgentUI.usageTone;
    return [0, 49, 50, 74, 75, 89, 90, 100].map((n) => [n, fn(n)]);
  });
  assert.deepEqual(tones, [
    [0, 'blue'], [49, 'blue'],
    [50, 'yellow'], [74, 'yellow'],
    [75, 'orange'], [89, 'orange'],
    [90, 'red'], [100, 'red'],
  ]);
});

test('hovering a topbar meter shows when that bar resets', async () => {
  const { page } = await openAgents();
  const claude = page.locator('.usage .meter[data-id="claude-subscription"]');
  await claude.waitFor();
  await claude.hover();
  const tip = page.locator('#marble-usage-tip');
  await tip.waitFor();
  assert.match(await tip.textContent(), /reset/i);
  const text = await page.evaluate(() => {
    const now = new Date(2026, 8, 17, 12, 0, 0);
    const reset = new Date(2026, 8, 17, 15, 30, 0);
    return window.marbleAgentUI.formatReset(reset.toISOString(), now);
  });
  assert.match(text, /today/i);
});

test('the Agents page has no drawer and lists a conversation', async () => {
  const { page, errors } = await openAgents();
  assert.equal(await page.locator('marble-agent-drawer').count(), 0);
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  assert.match(await page.locator(`.conv[data-id="${id}"] .title`).textContent(), /script:rename|New Chat/);
  assert.deepEqual(errors, []);
});

test('a conversation row tags the agent and the model, not the Agents page', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake', model: 'alt', effort: 'high' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  const row = page.locator(`.conv[data-id="${id}"]`);
  await row.locator('.tag[data-kind="agent"]', { hasText: 'Fake' }).waitFor();
  assert.equal((await row.locator('.tag[data-kind="model"]').textContent()).trim(), 'Alt • high');
  assert.equal(await row.locator('.tag[data-kind="doc"]').count(), 0);
});

test('conversation tags name Claude and Claude API', async () => {
  const { page } = await openAgents();
  const tags = await page.evaluate(() => {
    const labels = new Map([
      ['claude-subscription', {
        id: 'claude-subscription',
        label: 'Claude',
        models: [{ id: 'sonnet', label: 'Sonnet' }],
      }],
      ['claude-api', {
        id: 'claude-api',
        label: 'Claude API',
        models: [{ id: 'opus', label: 'Opus' }],
      }],
    ]);
    const of = (summary) => window.marbleAgentUI.conversationTags(summary, labels)
      .map((tag) => ({ kind: tag.kind, label: tag.label }));
    return {
      subscription: of({ target: 'Agents', provider: 'claude-subscription', model: 'sonnet', effort: 'high' }),
      api: of({ provider: 'claude-api', model: 'opus', effort: 'max' }),
      alias: of({ provider: 'claude-subscription', model: 'claude-sonnet-4-5', effort: 'high' }),
    };
  });
  assert.deepEqual(tags.subscription, [
    { kind: 'agent', label: 'Claude' },
    { kind: 'model', label: 'Sonnet • high' },
  ]);
  assert.deepEqual(tags.api, [
    { kind: 'agent', label: 'Claude API' },
    { kind: 'model', label: 'Opus • max' },
  ]);
  assert.deepEqual(tags.alias, [
    { kind: 'agent', label: 'Claude' },
    { kind: 'model', label: 'Sonnet 5 • high' },
  ]);
});

test('the library has no inspector column', async () => {
  const { page } = await openAgents();
  assert.equal(await page.locator('.inspector').count(), 0);
  const tracks = await page.locator('.library').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
  assert.equal(tracks, 2);
});

test('clicking a row opens it in the conversation pane and the mast names the target', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).click();
  const view = page.locator('.pane > marble-conversation');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.getAttribute('conversation'), id);
  const bar = page.locator('.pane > .dock-bar');
  await bar.waitFor();
  assert.match(await bar.locator('.dock-title').textContent(), /\S/);
  // Where the work lands is the mast's, beside the model — not the bar's.
  assert.equal(await bar.locator('.dock-target').count(), 0);
  const link = view.locator('.target-jump');
  await link.waitFor();
  assert.match(await link.locator('.target-what').textContent(), /garden/i);
  assert.match(await link.getAttribute('href'), /garden/i);
});

/** A press answers in colour on anything shaped like a row. Things shaped like
 *  buttons — the topbar cluster, the ⊕, a sheet's Start — do give a little on
 *  a touch screen (the phone polish pass, F1); rows still never pop. */
test('pressing a row does not pop it with a scale animation', async () => {
  const { page } = await openAgents();
  const pops = await page.evaluate(() => {
    const ROW = /\.conv(?![\w.-]|\s+\.manage)|\.focus-card|\.sheet-row|\.fleet-row|\.band-toggle|\.folder-tab/;
    const bad = [];
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        if (!rule.selectorText?.includes(':active')) continue;
        if (!/scale/.test(rule.style?.transform ?? '')) continue;
        for (const one of rule.selectorText.split(',')) {
          if (one.includes(':active') && ROW.test(one)) bad.push(one.trim());
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* a sheet from elsewhere */ }
    }
    return bad;
  });
  assert.deepEqual(pops, []);
});

test('a row archives a conversation and opens the next remaining one', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const older = await agent.start({ provider: 'fake' });
    await agent.send(older, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    const newer = await agent.start({ provider: 'fake' });
    await agent.send(newer, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return { older, newer };
  });
  const newerRow = page.locator(`.conv[data-id="${ids.newer}"]`);
  const olderRow = page.locator(`.conv[data-id="${ids.older}"]`);
  await newerRow.waitFor();
  await olderRow.waitFor();
  await newerRow.locator('.title').click();
  await page.waitForFunction((id) => document.querySelector('marble-conversation')?.getAttribute('conversation') === id, ids.newer);
  assert.equal(await page.locator('.dock-bar button', { hasText: 'Archive' }).count(), 0, 'archive lives on the row, not the pane header');
  await newerRow.locator('.manage .more').click();
  await newerRow.locator('[data-act="archive"]').click();
  await page.waitForFunction((id) => document.querySelector(`.conv[data-id="${id}"]`)?.hidden === true, ids.newer);
  assert.equal(await page.locator('marble-conversation').getAttribute('conversation'), ids.older);
  await openFilters(page);
  await page.locator('.filter[data-filter="archived"]').click();
  await page.waitForFunction((id) => {
    const el = document.querySelector(`.conv[data-id="${id}"]`);
    return Boolean(el) && !el.hidden;
  }, ids.newer);
});

test('the topbar keeps one thin view bar; the CLI bar lives in the filter popover', async () => {
  const { page } = await openAgents();
  assert.equal(await page.locator('.toggles > .seg').count(), 1);
  assert.equal(await page.locator('header.topbar input.search:visible').count(), 0);
  await openFilters(page);
  await page.locator('.filter-pop .seg.cli').waitFor();
  await page.locator('.cli [data-cli="all"]').waitFor();
  await page.locator('.cli [data-cli="fake"]').waitFor();
  const css = await page.locator('.views [data-view="library"]').evaluate((el) => {
    const s = getComputedStyle(el);
    // The pressed pill is the sliding thumb when the switch has one.
    const pill = getComputedStyle(el.parentElement.querySelector(':scope > .seg-thumb') ?? el);
    const track = getComputedStyle(el.parentElement);
    return {
      bg: pill.backgroundColor.replace(/\s/g, ''),
      pad: parseFloat(s.paddingTop),
      radius: track.borderRadius,
    };
  });
  assert.equal(css.bg, 'rgb(255,255,255)');
  assert.ok(css.pad <= 6, `selected pill should be thin, padding-top ${css.pad}`);
  assert.ok(Number.parseFloat(css.radius) >= 20, css.radius);
});

test('the CLI bar hides conversations from the other agent', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  const row = page.locator(`.conv[data-id="${id}"]`);
  await row.waitFor();
  await openFilters(page);
  await page.locator('.cli [data-cli="fake"]').click();
  assert.equal(await row.isHidden(), false);
  await page.evaluate(() => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cli-filter';
    btn.dataset.cli = 'cursor';
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Cursor';
    document.querySelector('.cli').append(btn);
  });
  await page.locator('.cli [data-cli="cursor"]').click();
  await page.waitForFunction((conversation) => document.querySelector(`.conv[data-id="${conversation}"]`)?.hidden, id);
  await page.locator('.cli [data-cli="all"]').click();
  await page.waitForFunction((conversation) => {
    const el = document.querySelector(`.conv[data-id="${conversation}"]`);
    return el && !el.hidden;
  }, id);
});

test('the filter popover is closed and quiet until it is used', async () => {
  const { page } = await openAgents();
  const toggle = page.locator('.filter-toggle');
  await toggle.waitFor();
  assert.equal(await page.locator('.filter-pop').isVisible(), false);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  // Not salient: no border, no fill, and dimmer than the Settings button.
  const look = await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('.filter-toggle'));
    const s = getComputedStyle(document.querySelector('button.settings'));
    return { border: t.borderTopWidth, bg: t.backgroundColor, tc: t.color, sc: s.color };
  });
  assert.equal(look.border, '0px');
  assert.match(look.bg, /rgba\(0, 0, 0, 0\)|transparent/);
  assert.notEqual(look.tc, look.sc);
  assert.equal(await page.locator('.filter-count').isVisible(), false);
  await toggle.click();
  await page.locator('.filter-pop').waitFor({ state: 'visible' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
});

test('an active filter or search marks the closed button, and Clear resets it', async () => {
  const { page } = await openAgents();
  await page.locator('#list .conv').first().waitFor();
  await openFilters(page);
  await page.locator('button.filter[data-filter="review"]').click();
  await page.locator('input.search').fill('nope-nope');
  await page.locator('.filter-toggle').click();
  await page.locator('.filter-pop').waitFor({ state: 'hidden' });
  // A dot, not a digit: a count on the button reads as a notification to go
  // and clear, and the idle cut keeps one filter on by default.
  assert.equal(await page.locator('.filter-count').isVisible(), true);
  assert.equal((await page.locator('.filter-count').textContent()).trim(), '');
  assert.match(await page.locator('.filter-toggle').getAttribute('title'), /Review.*nope-nope/);
  assert.equal(await page.locator('.filter-toggle').getAttribute('data-active'), '');
  await openFilters(page);
  await page.locator('.filter-clear').click();
  assert.equal(await page.locator('input.search').inputValue(), '');
  assert.equal(await page.locator('button.filter[data-filter="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.filter-count').isVisible(), false);
  assert.equal(await page.locator('.filter-toggle').getAttribute('data-active'), null);
  assert.ok((await page.locator('.conv:not([hidden])').count()) >= 1);
});

test('/ opens the filters on the search box and Escape closes them', async () => {
  const { page } = await openAgents();
  await page.locator('#list .conv').first().waitFor();
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('/');
  await page.locator('.filter-pop').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement?.matches('input.search')), true);
  // Typing in the search box is typing, not a shortcut: V must not switch views.
  await page.keyboard.type('v');
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-view')), 'library');
  await page.keyboard.press('Escape');
  await page.locator('.filter-pop').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('filter-toggle')), true);
});

test('clicking outside closes the filter popover', async () => {
  const { page } = await openAgents();
  await openFilters(page);
  await page.locator('h1').click();
  await page.locator('.filter-pop').waitFor({ state: 'hidden' });
});

test('filters and search hide rows without deleting them', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const agent = window.marble.agent;
    await agent.send(await agent.start({ provider: 'fake' }), {
      prompt: 'script:rename',
      target: 'garden',
      viewing: 'Agents',
      selection: [],
    });
  });
  await page.locator('.conv').first().waitFor();
  // send() returns when the turn is accepted, not when it finishes. Wait until
  // nothing is running so this asserts the filter, not a race with the fake agent.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.conv')].every((el) => el.dataset.status !== 'running'),
  );
  await openFilters(page);
  await page.locator('button.filter[data-filter="running"]').click();
  assert.equal(await page.locator('.conv:not([hidden])').count(), 0);
  await page.locator('button.filter[data-filter="all"]').click();
  await page.locator('input.search').fill('nope-nope');
  assert.equal(await page.locator('.conv:not([hidden])').count(), 0);
  await page.locator('input.search').fill('');
  assert.ok((await page.locator('.conv:not([hidden])').count()) >= 1);
});

test('the open conversation id is page-only and survives a reconcile', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).click();
  const view = page.locator('marble-conversation');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.getAttribute('conversation'), id);

  const source = await page.evaluate(() => window.marble.source.outer(document.querySelector('marble-conversation')));
  assert.equal(source.includes(`conversation="${id}"`), false);
  assert.ok(!(await host.drive.store.read('Agents')).includes(`conversation="${id}"`));

  // What patchFromFile does when the file has no conversation attr: strip it,
  // then hand the body to registered wirers.
  await page.evaluate(() => {
    document.querySelector('marble-conversation').removeAttribute('conversation');
    window.marble.adopt(document.body);
  });
  assert.equal(await view.getAttribute('conversation'), id);
});

test('V cycles List, Board, Folders, Focus, Deck and does not file the view', async () => {
  const { page } = await openAgents();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'folders');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'focus');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'deck');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  const filed = await page.evaluate(() => window.marble.source.outer(document.body));
  assert.equal(filed.includes('data-view="focus"'), false, 'focus is page-only and must not be filed');
});

test('V toggles library and board; the same conversation node moves', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  // send() returns when the turn is accepted. script:rename applies ops, so
  // the card belongs in Needs review, not Completed, once it is no longer running.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.conv')].every((el) => el.dataset.status !== 'running'),
  );
  assert.equal(await page.locator('body').getAttribute('data-view'), 'library');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  assert.equal(await page.locator(`.column[data-col="review"] .conv[data-id="${id}"]`).count(), 1);
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).count(), 1, 'the row was moved, not cloned');
  await page.locator('.views [data-view="library"]').click();
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  assert.equal(await page.locator(`#list .conv[data-id="${id}"]`).count(), 1);
});

test('reduced motion crossfades and does not wait on a FLIP', async () => {
  const { page } = await openAgents({ reducedMotion: 'reduce' });
  // Start a conversation first so `.conv` exists; still assert no FLIP transform.
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  const transform = await page.locator('.conv').first().evaluate((el) => getComputedStyle(el).transform).catch(() => 'none');
  assert.ok(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)' || transform == null);
});

test('clicking a board card opens the conversation panel', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');
  assert.equal(await page.locator('marble-conversation').count(), 1, 'one conversation element');
  assert.equal(await page.locator('.pane marble-conversation').getAttribute('conversation'), id);
  const paneShape = await page.evaluate(() => {
    const pane = document.querySelector('.pane');
    const cs = getComputedStyle(pane, '::before');
    return { radius: parseFloat(cs.borderRadius), bar: Boolean(document.querySelector('.pane > .dock-bar:not([hidden])')) };
  });
  assert.ok(paneShape.radius >= 12, `board pane is rounded, radius ${paneShape.radius}`);
  assert.equal(paneShape.bar, true, 'the pane carries its bar');
  await page.locator('.pane > .dock-bar .dock-close').click();
  await page.waitForFunction(() => !document.body.hasAttribute('data-panel'));
});

test('opening a conversation on the board splits beside the kanban, it does not cover it', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');
  const geometry = await page.evaluate(() => {
    const board = document.querySelector('.board').getBoundingClientRect();
    const pane = document.querySelector('.pane').getBoundingClientRect();
    const col = document.querySelector('.column').getBoundingClientRect();
    return {
      boardWidth: board.width,
      paneLeft: pane.left,
      boardRight: board.right,
      colVisible: col.width > 40 && col.height > 40,
      colNotCovered: col.right <= pane.left + 2,
    };
  });
  assert.ok(geometry.boardWidth > 120, `board only ${geometry.boardWidth}px wide`);
  assert.ok(geometry.paneLeft >= geometry.boardRight - 2, `pane at ${geometry.paneLeft} covers board ending ${geometry.boardRight}`);
  assert.equal(geometry.colVisible, true);
  assert.equal(geometry.colNotCovered, true);
});

test('dragging a conversation onto the pane edge opens a second pane', async () => {
  const { page } = await openAgents();
  const [first, second] = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const first = await agent.start({ provider: 'fake' });
    await agent.send(first, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    const second = await agent.start({ provider: 'fake' });
    await agent.send(second, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return [first, second];
  });
  await page.locator(`.conv[data-id="${first}"]`).click();
  await page.locator(`.pane marble-conversation[conversation="${first}"]`).waitFor();
  const box = await page.locator('.pane').boundingBox();
  const row = page.locator(`#list .conv[data-id="${second}"]`);
  await row.hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('marble-conversation').length === 2);
  const ids = await page.locator('marble-conversation').evaluateAll((els) => els.map((el) => el.getAttribute('conversation')));
  assert.ok(ids.includes(first) && ids.includes(second), `panes were ${ids.join(', ')}`);
  const extra = page.locator('.pane marble-conversation[data-marble-transient]');
  assert.equal(await extra.count(), 1);
  assert.equal(await extra.getAttribute('conversation'), second);
  assert.equal(await page.locator(`#list .conv[data-id="${second}"]`).count(), 1);
  assert.equal(await page.locator(`#list .conv[data-id="${second}"]`).isVisible(), true);
});

test('dragging a conversation shows a card that follows the pointer', async () => {
  const { page } = await openAgents();
  const [first, second] = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const first = await agent.start({ provider: 'fake' });
    await agent.send(first, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    const second = await agent.start({ provider: 'fake' });
    await agent.send(second, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return [first, second];
  });
  await page.locator(`.conv[data-id="${first}"]`).click();
  await page.locator(`.pane marble-conversation[conversation="${first}"]`).waitFor();
  const row = page.locator(`#list .conv[data-id="${second}"]`);
  const start = await row.boundingBox();
  await row.hover();
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 10 });
  const card = page.locator('.dock-card');
  await card.waitFor();
  const pos = await card.boundingBox();
  const pointerX = start.x + 80;
  const pointerY = start.y + 40;
  assert.ok(pos.x <= pointerX && pointerX <= pos.x + pos.width + 8, `card x ${pos.x} w ${pos.width} should stay under pointer ${pointerX}`);
  assert.ok(pos.y <= pointerY && pointerY <= pos.y + pos.height + 8, `card y ${pos.y} h ${pos.height} should stay under pointer ${pointerY}`);
  assert.equal(await page.locator(`#list .conv[data-id="${second}"]`).isVisible(), true);
  await page.mouse.up();
});

// A swap moves the panes, not the chats: the frames trade places and each
// chat stays in the frame it was in, which is what the drag previewed.
test('dropping a pane header onto another header trades the panes\' places', async () => {
  const { page } = await openAgents();
  const [first, second] = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const first = await agent.start({ provider: 'fake' });
    await agent.send(first, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    const second = await agent.start({ provider: 'fake' });
    await agent.send(second, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return [first, second];
  });
  await page.locator(`.conv[data-id="${first}"]`).click();
  await page.locator(`.pane > marble-conversation[conversation="${first}"]`).waitFor();
  const box = await page.locator('.pane').boundingBox();
  const row = page.locator(`#list .conv[data-id="${second}"]`);
  await row.hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.locator('.pane marble-conversation[data-marble-transient]').waitFor();
  const extraBar = page.locator('.dock-leaf .dock-bar');
  const primaryBar = page.locator('.pane > .dock-bar');
  const dest = await primaryBar.boundingBox();
  await extraBar.hover();
  await page.mouse.down();
  await page.mouse.move(dest.x + dest.width / 2, dest.y + dest.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction((ids) => {
    const primary = document.querySelector('.pane > marble-conversation')?.getAttribute('conversation');
    const extra = document.querySelector('.pane marble-conversation[data-marble-transient]')?.getAttribute('conversation');
    const pFrame = document.querySelector('.pane .dock-frame[data-key="P"]')?.getBoundingClientRect();
    const leaf = document.querySelector('.pane .dock-leaf:not(.dock-ghost)')?.getBoundingClientRect();
    return primary === ids[0] && extra === ids[1] && pFrame && leaf && pFrame.left > leaf.left + 10;
  }, [first, second]);
});

test('a conversation only occupies one pane', async () => {
  const { page } = await openAgents();
  const [first, second] = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const first = await agent.start({ provider: 'fake' });
    await agent.send(first, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    const second = await agent.start({ provider: 'fake' });
    await agent.send(second, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return [first, second];
  });
  await page.locator(`.conv[data-id="${first}"]`).click();
  await page.locator(`.pane > marble-conversation[conversation="${first}"]`).waitFor();
  const box = await page.locator('.pane').boundingBox();
  await page.locator(`#list .conv[data-id="${second}"]`).hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.locator('.pane marble-conversation[data-marble-transient]').waitFor();
  await page.locator(`#list .conv[data-id="${first}"]`).hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  const ids = await page.locator('.pane marble-conversation').evaluateAll((els) => els.map((el) => el.getAttribute('conversation')).filter(Boolean));
  assert.equal(new Set(ids).size, ids.length, `duplicate panes: ${ids.join(', ')}`);
});

test('pane layout motion uses ease-out', async () => {
  const { page } = await openAgents();
  const easing = await page.evaluate(() => {
    const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('\n');
    const flip = /FLIP_EASE\s*=\s*['"]([^'"]+)['"]/.exec(css + (document.querySelector('.library + .board + script, script:last-of-type')?.textContent ?? ''));
    const scripts = [...document.querySelectorAll('script')].map((el) => el.textContent).join('\n');
    const fromScript = /FLIP_EASE\s*=\s*['"]([^'"]+)['"]/.exec(scripts);
    return fromScript?.[1] ?? flip?.[1] ?? '';
  });
  assert.match(easing, /ease-out/);
});

test('a queued conversation sits in Running, not Completed', async () => {
  const { page } = await openAgents();
  const waiting = await host.drive.agents.store.createConversation({ provider: 'fake' });
  await host.drive.agents.store.createTurn(waiting.id, { prompt: 'later', context: { target: 'garden' } });
  try {
    await page.reload();
    await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
    await page.locator(`.conv[data-id="${waiting.id}"]`).waitFor();
    await page.keyboard.press('v');
    await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
    assert.equal(await page.locator(`.column[data-col="running"] .conv[data-id="${waiting.id}"]`).count(), 1);
  } finally {
    await host.drive.agents.store.updateConversation(waiting.id, { archived: true });
    const leftover = await host.drive.agents.store.turns(waiting.id);
    for (const turn of leftover) {
      if (turn.status === 'queued') await host.drive.agents.store.updateTurn(turn.id, { status: 'removed', finishedAt: Date.now() });
    }
  }
});

test('toggling twice during FLIP keeps one node on the library', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'folders');
  await page.keyboard.press('v');
  await page.keyboard.press('v');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  await page.waitForFunction((cid) => {
    const el = document.querySelector(`.conv[data-id="${cid}"]`);
    if (!el) return false;
    const t = getComputedStyle(el).transform;
    return !el.classList.contains('marble-flip') && (t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)');
  }, id);
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).count(), 1);
  assert.equal(await page.locator(`#list .conv[data-id="${id}"]`).count(), 1);
  const transform = await page.locator(`.conv[data-id="${id}"]`).evaluate((el) => getComputedStyle(el).transform);
  assert.ok(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)');
});

test('toggling twice during a crossfade does not stick opacity', async () => {
  const { page } = await openAgents({ reducedMotion: 'reduce' });
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'folders');
  await page.keyboard.press('v');
  await page.keyboard.press('v');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'library');
  await page.waitForFunction(() => !document.body.hasAttribute('data-crossfade'));
  assert.equal(await page.locator('body').getAttribute('data-crossfade'), null);
  const libOpacity = await page.locator('.library').evaluate((el) => getComputedStyle(el).opacity);
  assert.equal(libOpacity, '1');
  assert.equal(await page.locator(`#list .conv[data-id="${id}"]`).count(), 1);
});

test('opening the board panel does not clone the conversation on reconcile', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');
  const sameNode = await page.evaluate(() => {
    const el = document.querySelector('marble-conversation');
    window.marble.adopt(document.body);
    return el === document.querySelector('marble-conversation')
      && document.querySelectorAll('marble-conversation').length === 1
      && Boolean(el.closest('.pane'));
  });
  assert.equal(sameNode, true);
  assert.equal(await page.locator('.pane marble-conversation').getAttribute('conversation'), id);
});

test('the board panel does not overflow a narrow viewport', async () => {
  const { page } = await openAgents({ viewport: { width: 390, height: 800 } });
  // A phone opens on Deck; this test is about the Board at that width.
  await page.evaluate(() => localStorage.setItem('marble-agents:view', 'library'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');
  const box = await page.evaluate(() => {
    const pane = document.querySelector('.pane').getBoundingClientRect();
    return { pane: pane.width, vw: innerWidth };
  });
  assert.ok(box.pane <= box.vw + 1, `pane ${box.pane} wider than viewport ${box.vw}`);
  assert.equal(await page.locator('marble-conversation').count(), 1);
});

test('opening a conversation clears needs-review', async () => {
  // Earlier tests can leave a script:rename in flight. If that turn lands after
  // reset(), garden is already Backlog and this rename applies nothing — so
  // the row never needs review.
  for (let n = 0; n < 200; n++) {
    const listed = await host.drive.agents.store.conversations();
    if (!listed.some((c) => c.running || c.queued)) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const { page } = await openAgents();
  await host.drive.createDocument('garden', GARDEN.replace('Research Garden', `Garden ${Date.now()}`), { label: 'fresh' });
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  const row = page.locator(`.conv[data-id="${id}"]`);
  await row.waitFor();
  await page.locator(`.conv[data-id="${id}"]:not([data-status="running"])`).waitFor();
  assert.equal(await row.getAttribute('data-status'), 'review');
  await row.click();
  await page.locator(`.conv[data-id="${id}"][data-status="completed"]`).waitFor();
  await openFilters(page);
  await page.locator('button.filter[data-filter="review"]').click();
  assert.equal(await page.locator(`.conv[data-id="${id}"]:not([hidden])`).count(), 0);
});

test('board view survives a file reconcile that still says library', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:rename', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.conv')].every((el) => el.dataset.status !== 'running'),
  );
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  assert.equal(await page.locator(`.column[data-col="review"] .conv[data-id="${id}"]`).count(), 1);

  const filed = await page.evaluate(() => window.marble.source.outer(document.body));
  // The body's own attribute, not the bytes under it: a stylesheet in the
  // page may perfectly well name the view it styles.
  assert.doesNotMatch(filed.slice(0, filed.indexOf('>') + 1), /data-view="board"/, 'board is page-only and must not be filed');
  assert.match(AGENTS, /data-view="library"/);

  // What patchFromFile does: copy the file's library onto the live body, then
  // hand the body to registered wirers. Rows follow the snapped view into #list
  // if placeAll ran before restoreView.
  await page.evaluate((slice) => {
    const next = new DOMParser().parseFromString(slice, 'text/html');
    document.body.setAttribute('data-view', next.body.getAttribute('data-view') || 'library');
    const list = document.querySelector('#list');
    for (const el of [...document.querySelectorAll('.column .conv')]) list.append(el);
    window.marble.adopt(document.body);
  }, AGENTS);
  assert.equal(await page.locator('body').getAttribute('data-view'), 'board');
  assert.equal(await page.locator(`.column[data-col="review"] .conv[data-id="${id}"]`).count(), 1);
});

test('New starts a conversation with the default agent', async () => {
  const { page } = await openAgents();
  const before = await page.locator('#list .conv').count();
  await page.locator('button.new').click();
  await page.waitForFunction((n) => document.querySelectorAll('#list .conv').length > n, before);
  const id = await page.locator('marble-conversation').getAttribute('conversation');
  assert.ok(id, 'New must open the conversation it just started');
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).count(), 1);
});

test('Settings on the Agents page opens the agent settings panel', async () => {
  const { page } = await openAgents();
  await page.locator('button.settings').click();
  const settings = page.locator('marble-agent-settings');
  await settings.locator('h2', { hasText: 'Agent settings' }).waitFor();
  assert.equal(await settings.getAttribute('data-open'), 'true');
});

test('the settings sheet has a Usage tab with Claude short-term and weekly bars', async () => {
  const { page } = await openAgents();
  await page.locator('button.settings').click();
  const settings = page.locator('marble-agent-settings');
  await settings.locator('[role="tab"]', { hasText: 'Usage' }).click();
  const short = settings.locator('.meter[data-id="5h"]');
  const week = settings.locator('.meter[data-id="week"]');
  const other = settings.locator('.meter[data-id="api"]');
  await short.waitFor();
  assert.match(await short.textContent(), /Short-term/);
  assert.match(await short.textContent(), /23%/);
  await week.waitFor();
  assert.match(await week.textContent(), /Weekly/);
  assert.match(await week.textContent(), /41%/);
  assert.match(await week.locator('.reset').textContent(), /reset/i);
  await other.waitFor();
  assert.match(await other.textContent(), /100%/);
  const fable = settings.locator('.meter[data-id="fable"]');
  await fable.waitFor();
  assert.match(await fable.textContent(), /Fable/);
  assert.match(await fable.textContent(), /58%/);
  assert.match(await fable.locator('.reset').textContent(), /reset/i);
  assert.equal(await settings.locator('.meter[data-id="claude_code"]').count(), 0);
});

// ---------------------------------------------------------------- usage history

const HISTORY = usageHistoryStub(26);
const FIRST_ACTIVE = HISTORY.days.findIndex((day) => day.messages > 0);
const SHOWN = HISTORY.days.length - FIRST_ACTIVE;
// The grid never shows fewer than 12 weeks, even when activity began later.
const CELLS = Math.max(SHOWN, 12 * 7);
// Weekly bars start at the first week with activity, up to the last 12.
const weekStart = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay());
};
const WEEKS = Math.min(12, (weekStart(HISTORY.to) - weekStart(HISTORY.days[FIRST_ACTIVE].date)) / (7 * 86_400_000) + 1);

const openUsage = async (options = {}, { routes } = {}) => {
  const { page } = await openAgents(options);
  if (routes) await routes(page);
  // On a phone the Settings button is behind ⋯; the carrier opens it directly.
  if (await page.locator('button.settings').isVisible()) await page.locator('button.settings').click();
  else await page.evaluate(() => window.marble.agent.openSettings());
  const settings = page.locator('marble-agent-settings');
  await settings.locator('[role="tab"]', { hasText: 'Usage' }).click();
  return { page, settings };
};

test('the Usage tab draws one heatmap cell per day, brighter for busier days', async () => {
  const { settings } = await openUsage();
  const cells = settings.locator('.uh-cell');
  await cells.first().waitFor();
  assert.equal(await cells.count(), CELLS);
  assert.equal(await cells.last().getAttribute('data-date'), '2026-09-18');
  const levels = await cells.evaluateAll((els) => els.map((el) => Number(el.dataset.level)));
  assert.ok(levels.includes(0) && levels.includes(4), 'quiet days are level 0, the busiest reach level 4');
  const busiest = HISTORY.days.reduce((best, day) => (day.tokens > best.tokens ? day : best));
  assert.equal(await settings.locator(`.uh-cell[data-date="${busiest.date}"]`).getAttribute('data-level'), '4');
  const sunday = HISTORY.days.at(-6);
  assert.equal(await settings.locator(`.uh-cell[data-date="${sunday.date}"]`).getAttribute('data-level'), '0');
  assert.ok((await settings.locator('.uh-month').count()) >= 2);
});

test('hovering or focusing a day says what happened, and arrow keys move between days', async () => {
  const { page, settings } = await openUsage();
  const last = settings.locator('.uh-cell[data-date="2026-09-18"]');
  await last.hover();
  const tip = settings.locator('.uh-tip');
  await tip.waitFor({ state: 'visible' });
  const text = await tip.textContent();
  assert.match(text, /Fri, Sep 18/);
  assert.match(text, /19\.6k tokens/);
  assert.match(text, /20 messages/);
  assert.match(text, /Fable 31%/);
  await page.mouse.move(2, 2);
  await tip.waitFor({ state: 'hidden' });
  await last.focus();
  await tip.waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowLeft');
  assert.equal(await settings.locator('.uh-cell:focus').getAttribute('data-date'), '2026-09-11');
  await page.keyboard.press('ArrowDown');
  assert.equal(await settings.locator('.uh-cell:focus').getAttribute('data-date'), '2026-09-12');
  assert.equal(await settings.locator('.uh-cell[tabindex="0"]').count(), 1, 'one tab stop, not one per day');
});

test('the model chips and the metric toggle change what the heatmap counts', async () => {
  const { settings } = await openUsage();
  await settings.locator('.uh-cell').first().waitFor();
  const lit = () => settings.locator('.uh-cell:not([data-level="0"])').count();
  const all = await lit();
  await settings.locator('.uh-chip', { hasText: 'Fable' }).click();
  assert.equal(await lit(), 7, 'only the days with Fable usage stay lit');
  assert.equal(await settings.locator('.uh-chip', { hasText: 'Fable' }).getAttribute('aria-pressed'), 'true');
  await settings.locator('.uh-metric button', { hasText: 'Messages' }).click();
  await settings.locator('.uh-cell[data-date="2026-09-18"]').hover();
  assert.match(await settings.locator('.uh-tip').textContent(), /5 messages/);
  await settings.locator('.uh-chip', { hasText: 'All' }).click();
  assert.equal(await lit(), all);
  assert.equal(await settings.locator('.uh-chip', { hasText: 'Haiku' }).count(), 0, 'no chip for a model with no usage');
});

test('summary tiles read this week against last, streaks and active days', async () => {
  const { settings } = await openUsage();
  await settings.locator('.uh-tile').first().waitFor();
  assert.equal(await settings.locator('.uh-tile').count(), 6);
  const tile = (name) => settings.locator('.uh-tile-label', { hasText: new RegExp(`^${name}$`) }).locator('xpath=..');
  assert.match(await tile('Last 7 days').textContent(), /(Up|Down) \d+% vs the 7 days before/);
  assert.match(await tile('Current streak').textContent(), /5 days/);
  assert.match(await tile('Active days').textContent(), new RegExp(`44 of ${SHOWN}`));
  assert.match(await tile('Busiest day').textContent(), /[A-Z][a-z]{2} \d+/);
});

test('weekly bars are stacked by model, labelled, and have a table view', async () => {
  const { settings } = await openUsage();
  await settings.locator('.uh-bar').first().waitFor();
  assert.equal(await settings.locator('.uh-bar').count(), WEEKS, 'no empty weeks before the first activity');
  assert.ok((await settings.locator('.uh-seg').count()) >= WEEKS);
  assert.match(await settings.locator('.uh-seg').last().getAttribute('data-tip'), /(Opus|Sonnet|Fable)/);
  // The light-mode aqua and yellow are under 3:1, so the model shares are always spelled out.
  const legend = await settings.locator('.uh-legend').textContent();
  assert.match(legend, /Opus \d+%/);
  assert.match(legend, /Sonnet \d+%/);
  assert.match(legend, /Fable \d+%/);
  await settings.locator('.uh-view button', { hasText: 'Table' }).click();
  assert.equal(await settings.locator('.uh-table tbody tr').count(), WEEKS);
  assert.equal(await settings.locator('.uh-bar').first().isVisible(), false);
});

test('the sheet is wider on the Usage tab, and the live limit bars are still there', async () => {
  const { page, settings } = await openUsage();
  await settings.locator('.uh-cell').first().waitFor();
  const usageWidth = (await settings.locator('.sheet').boundingBox()).width;
  await settings.locator('[role="tab"]', { hasText: 'Settings' }).click();
  const settingsWidth = (await settings.locator('.sheet').boundingBox()).width;
  assert.ok(usageWidth > settingsWidth + 200, `${usageWidth} should be well over ${settingsWidth}`);
  await settings.locator('[role="tab"]', { hasText: 'Usage' }).click();
  await settings.locator('.meter[data-id="fable"]').waitFor();
  assert.equal(await page.locator('marble-agent-settings').getAttribute('data-open'), 'true');
});

test('clicking a header meter opens the Usage tab', async () => {
  const { page } = await openAgents();
  await page.locator('.usage .meter[data-id="fable"]').click();
  const settings = page.locator('marble-agent-settings');
  await settings.locator('[role="tab"][data-tab="usage"][aria-selected="true"]').waitFor();
  await settings.locator('.uh-cell').first().waitFor();
});

test('an empty history and a failed one each say so in one line, and the limits still render', async () => {
  const empty = await openUsage({}, {
    routes: (page) => page.route('**/agent/usage/history*', (route) => route.fulfill({
      json: { ...HISTORY, days: HISTORY.days.map((day) => ({ ...day, messages: 0, tokens: 0, cacheRead: 0, byModel: {} })) },
    })),
  });
  await empty.settings.locator('.uh-empty').waitFor();
  assert.match(await empty.settings.locator('.uh-empty').textContent(), /No Claude Code activity/);
  assert.equal(await empty.settings.locator('.uh-cell').count(), 0);
  await empty.settings.locator('.meter[data-id="5h"]').waitFor();

  const failed = await openUsage({}, { routes: (page) => page.route('**/agent/usage/history*', (route) => route.fulfill({ status: 500, body: 'no' })) });
  await failed.settings.locator('.uh-empty').waitFor();
  assert.match(await failed.settings.locator('.uh-empty').textContent(), /Couldn.t read usage history/);
  await failed.settings.locator('.meter[data-id="5h"]').waitFor();
});

test('on a phone the Usage tab does not scroll sideways', async () => {
  const { page, settings } = await openUsage({ viewport: { width: 360, height: 740 } });
  await settings.locator('.uh-cell').first().waitFor();
  const overflow = await page.evaluate(() => {
    const sheet = document.querySelector('marble-agent-settings').shadowRoot.querySelector('.sheet');
    return { page: document.documentElement.scrollWidth, sheet: sheet.scrollWidth - sheet.clientWidth };
  });
  assert.ok(overflow.page <= 360, `page is ${overflow.page}px wide`);
  assert.ok(overflow.sheet <= 1, `sheet overflows by ${overflow.sheet}px`);
});

test('the chart colours follow the light or dark palette that was validated', async () => {
  for (const [colorScheme, opus, level4] of [['light', '#2a78d6', '#104281'], ['dark', '#3987e5', '#86b6ef']]) {
    const { settings } = await openUsage({ colorScheme });
    await settings.locator('.uh').waitFor();
    const got = await settings.locator('.uh').evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.getPropertyValue('--uh-opus').trim(), cs.getPropertyValue('--uh-l4').trim()];
    });
    assert.deepEqual(got, [opus, level4], colorScheme);
  }
});

test('New says why when this host is not running agents', async () => {
  const off = await startDrive({ agents: false, documents: { garden: GARDEN, Agents: AGENTS } });
  try {
    const { page } = await off.newPage();
    await page.goto(`${off.base}/a/Agents`);
    await page.waitForFunction(() => Boolean(window.marble));
    await page.locator('button.new').click();
    assert.match(await page.locator('.pane-hint').textContent(), /not running agents/i);
  } finally {
    await off.close();
  }
});

test('a conversation waiting on the person says Needs you', async () => {
  const { page } = await openAgents();
  await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.send(id, { prompt: 'script:permission', target: 'garden' });
  });
  await page.locator('.conv .badge', { hasText: 'Needs you' }).first().waitFor();
});

test('stateOf is one vocabulary: waiting, working, failed, unseen, idle', async () => {
  const { page } = await openAgents();
  const states = await page.evaluate(() => {
    const s = window.marbleAgentUI.stateOf;
    return [
      s({ asking: true, running: true }),
      s({ running: true }),
      s({ queued: true }),
      s({ needsReview: true, lastOutcome: 'failed' }),
      s({ needsReview: true, lastOutcome: 'watchdog' }),
      s({ needsReview: true, lastOutcome: 'done' }),
      s({ lastOutcome: 'done' }),
      s({}),
    ];
  });
  assert.deepEqual(states, ['waiting', 'working', 'working', 'failed', 'failed', 'unseen', 'idle', 'idle']);
  assert.match(await page.evaluate(() => window.marbleAgentUI.STATE_CSS), /\[data-state="waiting"\] \.dot/);
});

test('an answered turn sits in Needs review until it is opened', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.send(id, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"][data-status="review"]`).waitFor();
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).getAttribute('data-state'), 'unseen');
  await page.keyboard.press('v');
  await page.locator(`.column[data-col="review"] .conv[data-id="${id}"]`).waitFor();
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.locator(`.conv[data-id="${id}"][data-status="completed"]`).waitFor();
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).getAttribute('data-state'), 'idle');
});

test('a conversation waiting on the person sits first in Needs review, marked waiting', async () => {
  const { page } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const done = await agent.start({ provider: 'fake' });
    await agent.send(done, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] });
    const asking = await agent.start({ provider: 'fake' });
    await agent.send(asking, { prompt: 'script:permission', target: 'garden', viewing: 'Agents', selection: [] });
    return { done, asking };
  });
  await page.locator(`.conv[data-id="${ids.asking}"][data-state="waiting"]`).waitFor();
  await page.locator(`.conv[data-id="${ids.done}"][data-state="unseen"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  const order = await page.evaluate(() => [...document.querySelectorAll('.column[data-col="review"] > .conv:not([hidden])')].map((el) => el.dataset.id));
  assert.equal(order[0], ids.asking, 'waiting first');
  assert.ok(order.includes(ids.done));
  assert.equal(await page.locator(`.column[data-col="running"] .conv[data-id="${ids.asking}"]`).count(), 0);
});

test('a turn that finishes while its pane is focused is already seen', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake' });
    await window.marble.agent.update(id, { title: 'watched' });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).click();
  await page.locator(`.pane marble-conversation[conversation="${id}"]`).waitFor();
  await page.evaluate((cid) => window.marble.agent.send(cid, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] }), id);
  // waitForFunction takes an async predicate's Promise as truthy, so poll here.
  for (let n = 0; n < 200; n += 1) {
    if (await page.evaluate(async (cid) => Boolean((await window.marble.agent.conversation(cid)).meta.lastFinishedAt), id)) break;
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(400);
  assert.equal(await page.locator(`.conv[data-id="${id}"]`).getAttribute('data-status'), 'completed');
});

test('with no pane open, dragging a board card to the right edge opens it there', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'to dock' });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  // The switch FLIPs the card into its column; measure it once it has landed.
  await page.waitForFunction((cid) => document.querySelector(`.column .conv[data-id="${cid}"]`)?.getAnimations().every((a) => a.playState !== 'running'), id);
  const row = await page.locator(`.column .conv[data-id="${id}"]`).boundingBox();
  const board = await page.locator('.board').boundingBox();
  await page.mouse.move(row.x + 40, row.y + 12);
  await page.mouse.down();
  await page.mouse.move(row.x + 80, row.y + 40, { steps: 3 });
  await page.mouse.move(board.x + board.width - 30, board.y + board.height / 2, { steps: 10 });
  await page.locator('.board-dockzone[data-drop]').waitFor();
  await page.mouse.up();
  await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');
  assert.equal(await page.locator('.pane marble-conversation').getAttribute('conversation'), id);
});

test('a thin board stacks its columns and scrolls as one', async () => {
  const { page } = await openAgents({ viewport: { width: 980, height: 800 } });
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'stacked' });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  assert.equal(await page.locator('.board[data-stack]').count(), 0, 'wide enough for three columns');
  await page.locator(`.column .conv[data-id="${id}"]`).click();
  await page.waitForFunction(() => document.body.getAttribute('data-panel') === 'open');
  await page.locator('.board[data-stack]').waitFor();
  const cols = await page.evaluate(() => [...document.querySelectorAll('.column')].map((c) => c.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y) })));
  assert.ok(cols[0].x === cols[1].x && cols[1].x === cols[2].x, 'one column of three');
  assert.ok(cols[0].y < cols[1].y && cols[1].y < cols[2].y, 'stacked in order');
});

test('a card changing column animates into place', async () => {
  const { page } = await openAgents();
  const id = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const id = await agent.start({ provider: 'fake' });
    await agent.update(id, { title: 'mover' });
    return id;
  });
  await page.locator(`.conv[data-id="${id}"]`).waitFor();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  await page.waitForFunction((cid) => document.querySelector(`.column .conv[data-id="${cid}"]`)?.getAnimations().every((a) => a.playState !== 'running'), id);
  const moved = page.evaluate((cid) => new Promise((resolve, reject) => {
    const el = document.querySelector(`.conv[data-id="${cid}"]`);
    const start = performance.now();
    const tick = () => {
      const anim = el.getAnimations().find((a) => a.playState === 'running' && a.effect?.getKeyframes?.().some((k) => k.transform));
      if (anim && el.closest('.column')?.dataset.col !== 'completed') resolve(anim.effect.getTiming().duration);
      else if (performance.now() - start > 8000) reject(new Error('no column move animation'));
      else requestAnimationFrame(tick);
    };
    tick();
  }), id);
  await page.evaluate((cid) => window.marble.agent.send(cid, { prompt: 'script:answer', target: 'garden', viewing: 'Agents', selection: [] }), id);
  const duration = await moved;
  assert.ok(duration > 0 && duration <= 420, `column move animates (${duration}ms)`);
});

test('a message from another agent renders as a from-bubble that opens the sender', async () => {
  const { page, errors } = await openAgents();
  const ids = await page.evaluate(async () => {
    const agent = window.marble.agent;
    const a = await agent.start({ provider: 'fake' });
    const b = await agent.start({ provider: 'fake' });
    await agent.update(a, { title: 'Sender' });
    await agent.send(a, { prompt: 'script:sendone', target: 'garden', viewing: 'Agents', selection: [] });
    return { a, b };
  });
  // Open b once its turn exists; the delivery turn's user event carries `from`.
  await page.locator(`.conv[data-id="${ids.b}"]`).waitFor();
  await page.locator(`.conv[data-id="${ids.b}"]`).click();
  const bubble = page.locator('marble-conversation .msg.me.from-agent').first();
  await bubble.waitFor({ timeout: 15_000 });
  assert.match(await bubble.locator('.from').textContent(), /Sender/);
  assert.match(await bubble.locator('.msg-text').textContent(), /ping from a/);
  await bubble.locator('.from').click();
  await page.waitForFunction((id) => document.querySelector('marble-conversation')?.getAttribute('conversation') === id, ids.a);
  const sent = page.locator('marble-conversation .system', { hasText: /Sent to/ }).first();
  await sent.waitFor();
  assert.deepEqual(errors, []);
});

test('arriving with ?open=<id> opens that chat and spends the parameter', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent));
  const id = await page.evaluate(() => window.marble.agent.start({ provider: 'fake' }));
  await page.goto(`${host.base}/a/Agents?open=${id}`);
  await page.waitForFunction((cid) => document.querySelector(`marble-conversation[conversation="${cid}"]`) !== null, id);
  assert.equal(new URL(page.url()).searchParams.has('open'), false);
  await page.close();
});
