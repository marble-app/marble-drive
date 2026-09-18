import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading.' },
  ],
  permission: [{ ask: { tool: 'Bash', input: { command: 'ls' } } }, { say: 'after' }],
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

test('the topbar shows used usage for Claude and Cursor', async () => {
  const { page } = await openAgents();
  const claude = page.locator('.usage .meter[data-id="claude-subscription"]');
  const cursor = page.locator('.usage .meter[data-id="cursor"]');
  await claude.waitFor();
  assert.match(await claude.textContent(), /23%/);
  assert.match(await cursor.textContent(), /19%/);
  const fill = await claude.locator('.meter-bar i').evaluate((el) => el.style.width);
  assert.equal(fill, '23%');
  assert.equal(await claude.getAttribute('data-tone'), 'blue');
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
  assert.equal((await page.locator('.usage .meter[data-id="cursor"] .meter-pct').textContent()).trim(), '19%');
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
  assert.match(await page.locator(`.conv[data-id="${id}"] .title`).textContent(), /script:rename|Untitled/);
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

test('conversation tags name Claude and KIXLAB API', async () => {
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
        label: 'KIXLAB API',
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
    { kind: 'agent', label: 'KIXLAB API' },
    { kind: 'model', label: 'Opus • max' },
  ]);
  assert.deepEqual(tags.alias, [
    { kind: 'agent', label: 'Claude' },
    { kind: 'model', label: 'Sonnet • high' },
  ]);
});

test('the library has no inspector column', async () => {
  const { page } = await openAgents();
  assert.equal(await page.locator('.inspector').count(), 0);
  const tracks = await page.locator('.library').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
  assert.equal(tracks, 2);
});

test('clicking a row opens it in the conversation pane and a header names the target', async () => {
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
  assert.match(await bar.locator('.dock-target').textContent(), /garden/i);
});

test('pressing a row does not pop it with a scale animation', async () => {
  const { page } = await openAgents();
  const pops = await page.evaluate(() => {
    const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('\n');
    return /:active[^{}]*\{[^}]*transform:\s*scale/.test(css);
  });
  assert.equal(pops, false);
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
  await page.locator('.filter[data-filter="archived"]').click();
  await page.waitForFunction((id) => {
    const el = document.querySelector(`.conv[data-id="${id}"]`);
    return Boolean(el) && !el.hidden;
  }, ids.newer);
});

test('the topbar has three thin segmented bars, including CLI', async () => {
  const { page } = await openAgents();
  await page.locator('.toggles .seg.cli').waitFor();
  assert.equal(await page.locator('.toggles > .seg').count(), 3);
  await page.locator('.cli [data-cli="all"]').waitFor();
  await page.locator('.cli [data-cli="fake"]').waitFor();
  const css = await page.locator('.views [data-view="library"]').evaluate((el) => {
    const s = getComputedStyle(el);
    const track = getComputedStyle(el.parentElement);
    return {
      bg: s.backgroundColor.replace(/\s/g, ''),
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

test('V cycles List, Board, Folders, Focus and does not file the view', async () => {
  const { page } = await openAgents();
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'board');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'folders');
  await page.keyboard.press('v');
  await page.waitForFunction(() => document.body.getAttribute('data-view') === 'focus');
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
  await page.locator('.board-panel[data-open="true"]').waitFor();
  assert.equal(await page.locator('marble-conversation').count(), 1, 'one conversation element');
  assert.equal(await page.locator('.pane marble-conversation').getAttribute('conversation'), id);
  assert.equal(await page.locator('.board-panel marble-conversation').count(), 0);
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
  await page.locator('.board-panel[data-open="true"]').waitFor();
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

test('dropping a pane header onto another header swaps the chats', async () => {
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
    return primary === ids[1] && extra === ids[0];
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
  await page.locator('.board-panel[data-open="true"]').waitFor();
  const sameNode = await page.evaluate(() => {
    const el = document.querySelector('marble-conversation');
    window.marble.adopt(document.body);
    return el === document.querySelector('marble-conversation')
      && document.querySelectorAll('marble-conversation').length === 1
      && Boolean(el.closest('.pane'));
  });
  assert.equal(sameNode, true);
  assert.equal(await page.locator('.board-panel marble-conversation').count(), 0);
  assert.equal(await page.locator('.pane marble-conversation').getAttribute('conversation'), id);
});

test('the board panel does not overflow a narrow viewport', async () => {
  const { page } = await openAgents({ viewport: { width: 390, height: 800 } });
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
  await page.locator('.board-panel[data-open="true"]').waitFor();
  const box = await page.evaluate(() => {
    const pane = document.querySelector('.pane').getBoundingClientRect();
    const panel = document.querySelector('.board-panel').getBoundingClientRect();
    return { pane: pane.width, panel: panel.width, vw: innerWidth };
  });
  assert.ok(box.pane <= box.vw + 1, `pane ${box.pane} wider than viewport ${box.vw}`);
  assert.ok(box.panel <= box.vw + 1, `panel ${box.panel} wider than viewport ${box.vw}`);
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
  assert.equal(filed.includes('data-view="board"'), false, 'board is page-only and must not be filed');
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
  assert.equal(await settings.locator('.meter[data-id="claude_code"]').count(), 0);
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
