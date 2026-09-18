import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startDrive } from './harness.js';

const SCRIPTS = {
  rename: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { say: 'Renamed the heading to **Backlog**.\n\n- kept the questions\n- changed nothing else' },
  ],
  hostile: [{ say: 'Try <img src=x onerror="window.__pwned=1"> and [bad](javascript:window.__pwned=1) and [good](https://example.com)' }],
  slow: [{ sleep: 1500 }, { say: 'finally' }],
  hold: [{ silent: 20_000 }],
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
  question: [{ ask: { tool: 'AskUserQuestion', input: { questions: [{ question: 'A or B?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }] } } }],
  stale: [
    { call: 'apply_ops', args: { path: 'garden', note: 'unread', ops: [{ type: 'setText', id: 'p', text: 'x' }] } },
    { say: 'It was refused.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS });
test.after(() => host.close());

/** A page with a bare <marble-conversation> in it — the drawer is not needed to test the view. */
async function mount(id = null) {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate((conversation) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    if (conversation) el.setAttribute('conversation', conversation);
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  }, id);
  // `body >` so the drawer's own conversation (inside its shadow root, Task 4) is never matched.
  return { page, errors, view: page.locator('body > marble-conversation') };
}

const sendFrom = async (view, text) => {
  await view.locator('textarea').fill(text);
  await view.locator('textarea').press('Enter');
};

test('a new conversation picks an agent, sends on Enter, and becomes that conversation', async () => {
  const { page, view, errors } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  assert.equal(await view.locator('input[name="agent"][value="fake"]').isChecked(), true);

  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(await view.getAttribute('conversation'), id);

  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.msg.me').first().textContent(), 'script:rename');
  assert.equal(await view.locator('.picker-agent').isVisible(), true);
  assert.deepEqual(errors, []);
});

test('composer controls do not scale when pressed', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const pops = await view.evaluate((el) => /:active[^{}]*\{[^}]*transform:\s*scale/.test(el.shadowRoot.querySelector('style')?.textContent ?? ''));
  assert.equal(pops, false);
});

test('a crowded segment becomes a dropdown instead of scrolling', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await view.evaluate((el) => {
    const box = el.shadowRoot.querySelector('[data-seg="model"]');
    const models = Array.from({ length: 16 }, (_, i) => ({ id: `m${i}`, label: `Model ${i} Extra Long` }));
    window.marbleAgentUI.fillRadios(box, 'model', models, { empty: null, value: 'm0' });
    window.marbleAgentUI.fitPicker(el.shadowRoot.querySelector('.picker'));
  });
  const flags = await view.evaluate((el) => {
    const box = el.shadowRoot.querySelector('[data-seg="model"]');
    const picker = el.shadowRoot.querySelector('.picker');
    return {
      drop: box.classList.contains('is-drop'),
      scroll: picker.scrollWidth > picker.clientWidth + 2,
    };
  });
  assert.equal(flags.drop, true);
  assert.equal(flags.scroll, false);
  await view.locator('[data-seg="model"] .seg-current').click();
  await view.locator('input[name="model"][value="m3"]').click({ force: true });
  assert.equal(await view.evaluate((el) => el.shadowRoot.querySelector('[data-seg="model"] .seg-current').textContent.trim()), 'Model 3 Extra Long');
});

const installNamedSetups = async (view, { model = 'sonnet', effort = 'high', width = null } = {}) => {
  await view.evaluate(async (el, { model, effort, width }) => {
    if (width) el.style.width = `${width}px`;
    el.providerList = [
      {
        id: 'claude-subscription',
        label: 'Claude',
        installed: true,
        signedIn: true,
        models: [
          { id: 'haiku', label: 'Haiku 4.5' },
          { id: 'sonnet', label: 'Sonnet 4.5' },
          { id: 'opus', label: 'Opus 4.1' },
          { id: 'fable', label: 'Fable 5' },
        ],
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        modes: [{ id: 'default', label: 'Default' }],
      },
      {
        id: 'cursor',
        label: 'Cursor',
        installed: true,
        signedIn: true,
        models: [
          { id: 'auto', label: 'Auto' },
          { id: 'cursor-grok-4.6', label: 'Grok 4.6', efforts: [{ id: 'high', label: 'High' }, { id: 'xhigh', label: 'Extra High' }], hasBare: false },
        ],
        efforts: [],
        modes: [{ id: 'agent', label: 'Run Everything' }],
      },
    ];
    window.marbleAgentUI.fillRadios(el.shadowRoot.querySelector('[data-seg="agent"]'), 'agent', [
      { id: 'claude-subscription', label: 'Claude' },
      { id: 'cursor', label: 'Cursor' },
    ], { empty: null, value: model.startsWith('cursor') || model.includes('grok') ? 'cursor' : 'claude-subscription' });
    await el.syncCatalog({ model, effort });
    el.paintPresets({ initial: true });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, { model, effort, width });
};

test('saved setups hug their labels instead of stretching across the composer', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const names = await view.evaluate(async (el) => {
    el.providerList = [
      {
        id: 'claude-subscription',
        label: 'Claude',
        installed: true,
        signedIn: true,
        models: [
          { id: 'haiku', label: 'Haiku 4.5' },
          { id: 'sonnet', label: 'Sonnet 4.5' },
          { id: 'opus', label: 'Opus 4.1' },
          { id: 'fable', label: 'Fable 5' },
        ],
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        modes: [{ id: 'default', label: 'Default' }],
      },
    ];
    window.marbleAgentUI.fillRadios(el.shadowRoot.querySelector('[data-seg="agent"]'), 'agent', [
      { id: 'claude-subscription', label: 'Claude' },
    ], { empty: null, value: 'claude-subscription' });
    await el.syncCatalog({ model: 'sonnet', effort: 'high' });
    el.paintPresets({ initial: true });
    el.setCustomOpen(true);
    const setup = el.shadowRoot.querySelector('.setup').getBoundingClientRect();
    const presets = el.shadowRoot.querySelector('.presets').getBoundingClientRect();
    const picker = el.shadowRoot.querySelector('.picker').getBoundingClientRect();
    const pills = [...el.shadowRoot.querySelectorAll('.preset span')].reduce((sum, node) => sum + node.getBoundingClientRect().width, 0);
    return {
      setup: setup.width,
      presets: presets.width,
      picker: picker.width,
      pills,
      names: [...el.shadowRoot.querySelectorAll('.preset span')].map((node) => node.textContent.trim()),
    };
  });
  assert.deepEqual(names.names, ['Sonnet High', 'Opus Extra High']);
  assert.ok(names.presets <= names.pills + 12, `presets ${names.presets} should hug pills ${names.pills}, not setup ${names.setup}`);
  assert.ok(names.presets < names.setup - 80, `presets ${names.presets} should not fill setup ${names.setup}`);
});

const presetGeometry = (el) => {
  const presets = el.shadowRoot.querySelector('.presets');
  const track = presets.getBoundingClientRect();
  const boxes = [...el.shadowRoot.querySelectorAll('.preset span, .presets-more > span')].map((node) => {
    const box = node.getBoundingClientRect();
    return {
      text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
      parent: node.parentElement?.className,
      display: getComputedStyle(node).display,
      width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
      left: Math.round(box.left * 10) / 10,
      right: Math.round(box.right * 10) / 10,
      top: Math.round(box.top * 10) / 10,
    };
  }).filter((item) => item.width > 0 && item.height > 0 && item.display !== 'none');
  const names = boxes.filter((item) => item.text.includes('Grok Extra High'));
  const overlap = (a, b) => a.left < b.right - 2 && b.left < a.right - 2 && Math.abs(a.top - b.top) < 12;
  const clashes = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      if (overlap(names[i], names[j])) clashes.push([names[i], names[j]]);
    }
  }
  return {
    height: track.height,
    width: Math.round(track.width * 10) / 10,
    packed: presets.classList.contains('is-packed'),
    moreHidden: presets.querySelector('.presets-more')?.hidden ?? null,
    moreWidth: presets.querySelector('.presets-more')?.getBoundingClientRect().width ?? 0,
    boxes,
    names,
    clashes,
  };
};

test('a crowded saved-setup capsule stays one row and keeps the selected chip inside', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await installNamedSetups(view, { model: 'cursor-grok-4.6', effort: 'xhigh', width: 320 });
  const geometry = await view.evaluate((el) => {
    const presets = el.shadowRoot.querySelector('.presets');
    const track = presets.getBoundingClientRect();
    const inside = (node) => {
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) return true;
      return box.top >= track.top - 1.5
        && box.bottom <= track.bottom + 1.5
        && box.left >= track.left - 1.5
        && box.right <= track.right + 1.5;
    };
    const chips = [...el.shadowRoot.querySelectorAll('.preset')].map((node) => {
      const input = node.querySelector('input');
      const box = node.getBoundingClientRect();
      return {
        id: input.value,
        checked: input.checked,
        visible: box.width > 0 && box.height > 0,
        inside: inside(node),
      };
    });
    const more = el.shadowRoot.querySelector('.presets-more');
    return {
      height: track.height,
      chips,
      more: Boolean(more) && !more.hidden && more.getBoundingClientRect().width > 0,
    };
  });
  assert.ok(geometry.height < 36, `capsule should stay one row, height ${geometry.height}`);
  const selected = geometry.chips.find((chip) => chip.checked);
  assert.equal(selected?.id, 'grok-xhigh');
  assert.equal(selected.visible, true);
  assert.equal(selected.inside, true);
  assert.ok(geometry.chips.filter((chip) => chip.visible).every((chip) => chip.inside), 'visible chips must stay inside the capsule');
  assert.equal(geometry.more, true, 'overflow should collapse into More');
  await view.locator('.presets-more').click();
  assert.equal(await view.locator('.presets-menu .preset').count(), geometry.chips.filter((chip) => !chip.visible).length);
  await view.locator('input[name="preset"][value="grok-high"]').click({ force: true });
  assert.equal(await view.locator('input[name="preset"][value="grok-high"]').isChecked(), true);
});

test('a narrow saved-setup capsule paints the selected name once', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await installNamedSetups(view, { model: 'cursor-grok-4.6', effort: 'xhigh', width: 160 });
  const dump = await view.evaluate(presetGeometry);
  assert.ok(dump.height < 36, `capsule should stay one row, height ${dump.height}`);
  assert.ok(dump.width > 80, `capsule should hug the selected name, not a 28px nub (${dump.width})`);
  assert.equal(dump.names.length, 1, `selected name painted ${dump.names.length} times: ${JSON.stringify(dump)}`);
  assert.equal(dump.clashes.length, 0, `overlapping labels: ${JSON.stringify(dump.clashes)}`);
  const name = dump.names[0];
  assert.ok(name.width <= dump.width + 2, `name ${name.width} must fit in capsule ${dump.width}`);
});

test('Custom keeps the Claude model sliders visible after picking a preset', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await view.evaluate(async (el) => {
    el.providerList = [
      {
        id: 'claude-subscription',
        label: 'Claude',
        installed: true,
        signedIn: true,
        models: [
          { id: 'haiku', label: 'Haiku 4.5' },
          { id: 'sonnet', label: 'Sonnet 4.5' },
          { id: 'opus', label: 'Opus 4.1' },
          { id: 'fable', label: 'Fable 5' },
        ],
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        modes: [{ id: 'default', label: 'Default' }],
      },
      {
        id: 'cursor',
        label: 'Cursor',
        installed: true,
        signedIn: true,
        models: [
          { id: 'auto', label: 'Auto' },
          { id: 'cursor-grok-4.6', label: 'Grok 4.6', efforts: [{ id: 'high', label: 'High' }, { id: 'xhigh', label: 'Extra High' }], hasBare: false },
        ],
        efforts: [],
        modes: [{ id: 'agent', label: 'Run Everything' }],
      },
    ];
    window.marbleAgentUI.fillRadios(el.shadowRoot.querySelector('[data-seg="agent"]'), 'agent', [
      { id: 'claude-subscription', label: 'Claude' },
      { id: 'cursor', label: 'Cursor' },
    ], { empty: null, value: 'claude-subscription' });
    await el.syncCatalog({ model: 'sonnet', effort: 'high' });
    el.paintPresets({ initial: true });
  });
  await view.locator('.custom-toggle').click();
  assert.equal(await view.locator('.picker').isVisible(), true);
  await view.locator('input[name="preset"][value="opus-xhigh"]').click({ force: true });
  await page.waitForFunction(() => {
    const el = document.querySelector('body > marble-conversation');
    return el?.shadowRoot.querySelector('input[name="model"]:checked')?.value === 'opus';
  });
  assert.equal(await view.locator('.picker').isVisible(), true, 'picking a preset must not hide Custom sliders');
  const claudeModels = await view.evaluate((el) => [...el.shadowRoot.querySelectorAll('input[name="model"]')].map((input) => input.value));
  assert.deepEqual(claudeModels, ['haiku', 'sonnet', 'opus', 'fable']);
});

test('Cursor presets stay enabled on a Claude conversation', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const flags = await view.evaluate(async (el) => {
    el.providerList = [
      {
        id: 'claude-subscription',
        label: 'Claude',
        installed: true,
        signedIn: true,
        models: [
          { id: 'haiku', label: 'Haiku 4.5' },
          { id: 'sonnet', label: 'Sonnet 4.5' },
          { id: 'opus', label: 'Opus 4.1' },
          { id: 'fable', label: 'Fable 5' },
        ],
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        modes: [{ id: 'default', label: 'Default' }],
      },
      {
        id: 'cursor',
        label: 'Cursor',
        installed: true,
        signedIn: true,
        models: [
          { id: 'auto', label: 'Auto' },
          { id: 'cursor-grok-4.6', label: 'Grok 4.6', efforts: [{ id: 'high', label: 'High' }, { id: 'xhigh', label: 'Extra High' }], hasBare: false },
        ],
        efforts: [],
        modes: [{ id: 'agent', label: 'Run Everything' }],
      },
    ];
    if (el.api) el.api.update = async () => ({});
    el.setAttribute('conversation', 'aaaaaaaaaaaa');
    el.meta = { id: 'aaaaaaaaaaaa', provider: 'claude-subscription', model: 'sonnet', effort: 'high' };
    window.marbleAgentUI.fillRadios(el.shadowRoot.querySelector('[data-seg="agent"]'), 'agent', [
      { id: 'claude-subscription', label: 'Claude' },
      { id: 'cursor', label: 'Cursor' },
    ], { empty: null, value: 'claude-subscription' });
    await el.syncCatalog({ model: 'sonnet', effort: 'high' });
    el.paintPresets({ initial: true });
    await el.applyPreset({
      id: 'grok-high',
      provider: 'cursor',
      model: 'cursor-grok-4.6',
      effort: 'high',
      name: 'Grok High',
      brand: 'cursor',
    });
    return {
      grokDisabled: el.shadowRoot.querySelector('input[name="preset"][value="grok-high"]')?.disabled ?? true,
      agent: el.shadowRoot.querySelector('input[name="agent"]:checked')?.value,
      model: el.shadowRoot.querySelector('input[name="model"]:checked')?.value,
      effort: el.shadowRoot.querySelector('input[name="effort"]:checked')?.value,
    };
  });
  assert.equal(flags.grokDisabled, false);
  assert.equal(flags.agent, 'cursor');
  assert.equal(flags.model, 'cursor-grok-4.6');
  assert.equal(flags.effort, 'high');
});

test('spent Claude usage prefers Cursor for a new conversation', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const pick = await view.evaluate((el) => {
    el.providerList = [
      { id: 'claude-subscription', label: 'Claude', installed: true, signedIn: true, default: true, models: [], efforts: [], modes: [] },
      { id: 'cursor', label: 'Cursor', installed: true, signedIn: true, models: [], efforts: [], modes: [] },
    ];
    el.usageMeters = [{ id: 'claude-subscription', used: 100 }];
    const usable = el.providerList.filter((item) => item.installed && item.signedIn);
    return el.preferredProvider(usable)?.id;
  });
  assert.equal(pick, 'cursor');
});

test('unavailable Claude usage prefers Cursor and disables Claude presets', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const flags = await view.evaluate(async (el) => {
    el.providerList = [
      {
        id: 'claude-subscription',
        label: 'Claude',
        installed: true,
        signedIn: true,
        default: true,
        models: [{ id: 'sonnet', label: 'Sonnet 4.5' }],
        efforts: ['high'],
        modes: [{ id: 'default', label: 'Default' }],
      },
      {
        id: 'cursor',
        label: 'Cursor',
        installed: true,
        signedIn: true,
        models: [{ id: 'cursor-grok-4.6', label: 'Grok 4.6', efforts: [{ id: 'high', label: 'High' }], hasBare: false }],
        efforts: [],
        modes: [{ id: 'agent', label: 'Run Everything' }],
      },
    ];
    el.usageMeters = [{ id: 'claude-subscription', label: 'Claude', available: false, used: null, detail: 'Unavailable' }];
    const usable = el.providerList.filter((item) => item.installed && item.signedIn);
    el.fillAgents(el.preferredProvider(usable)?.id);
    await el.syncCatalog();
    el.paintPresets({ initial: true });
    return {
      preferred: el.preferredProvider(usable)?.id,
      agent: el.shadowRoot.querySelector('input[name="agent"]:checked')?.value,
      claudeDisabled: el.shadowRoot.querySelector('input[name="agent"][value="claude-subscription"]')?.disabled ?? false,
      sonnetDisabled: el.shadowRoot.querySelector('input[name="preset"][value="sonnet-high"]')?.disabled ?? false,
      grokDisabled: el.shadowRoot.querySelector('input[name="preset"][value="grok-high"]')?.disabled ?? true,
    };
  });
  assert.equal(flags.preferred, 'cursor');
  assert.equal(flags.agent, 'cursor');
  assert.equal(flags.claudeDisabled, true);
  assert.equal(flags.sonnetDisabled, true);
  assert.equal(flags.grokDisabled, false);
});

test('saved setups collapse the custom picker until Custom is opened', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  assert.equal(await view.locator('.presets').isVisible(), false, 'fake host has no Claude/Cursor presets');
  assert.equal(await view.locator('.picker').isVisible(), true);
});

test('Custom model configs stay collapsed even when the current setup is not a named preset', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await view.evaluate(async (el) => {
    el.providerList = [
      {
        id: 'claude-subscription',
        label: 'Claude',
        installed: true,
        signedIn: true,
        models: [
          { id: 'haiku', label: 'Haiku 4.5' },
          { id: 'sonnet', label: 'Sonnet 4.5' },
        ],
        efforts: ['low', 'high'],
        modes: [{ id: 'default', label: 'Default' }],
      },
      {
        id: 'cursor',
        label: 'Cursor',
        installed: true,
        signedIn: true,
        models: [{ id: 'cursor-grok-4.6', label: 'Grok 4.6', efforts: [{ id: 'high', label: 'High' }], hasBare: false }],
        efforts: [],
        modes: [{ id: 'agent', label: 'Run Everything' }],
      },
    ];
    window.marbleAgentUI.fillRadios(el.shadowRoot.querySelector('[data-seg="agent"]'), 'agent', [
      { id: 'claude-subscription', label: 'Claude' },
      { id: 'cursor', label: 'Cursor' },
    ], { empty: null, value: 'claude-subscription' });
    await el.syncCatalog({ model: 'haiku', effort: 'low' });
    el.paintPresets({ initial: true });
  });
  assert.equal(await view.locator('.presets').isVisible(), true);
  assert.equal(await view.locator('.custom-toggle').isVisible(), true);
  assert.equal(await view.locator('.picker').isVisible(), false);
  assert.equal(await view.locator('.custom-toggle').getAttribute('aria-expanded'), 'false');
  await view.locator('.custom-toggle').click();
  assert.equal(await view.locator('.picker').isVisible(), true);
});

test('Claude and Cursor presets become the main toggles', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const names = await view.evaluate(async (el) => {
    el.providerList = [
      {
        id: 'claude-subscription',
        label: 'Claude',
        installed: true,
        signedIn: true,
        models: [
          { id: 'haiku', label: 'Haiku 4.5' },
          { id: 'sonnet', label: 'Sonnet 4.5' },
          { id: 'opus', label: 'Opus 4.1' },
          { id: 'fable', label: 'Fable 5' },
        ],
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        modes: [{ id: 'default', label: 'Default' }],
      },
      {
        id: 'cursor',
        label: 'Cursor',
        installed: true,
        signedIn: true,
        models: [
          { id: 'auto', label: 'Auto' },
          { id: 'composer-2.5', label: 'Composer 2.5' },
          { id: 'cursor-grok-4.6', label: 'Grok 4.6', efforts: [{ id: 'high', label: 'High' }, { id: 'xhigh', label: 'Extra High' }], hasBare: false },
        ],
        efforts: [],
        modes: [{ id: 'agent', label: 'Run Everything' }],
      },
    ];
    window.marbleAgentUI.fillRadios(el.shadowRoot.querySelector('[data-seg="agent"]'), 'agent', [
      { id: 'claude-subscription', label: 'Claude' },
      { id: 'cursor', label: 'Cursor' },
    ], { empty: null, value: 'claude-subscription' });
    await el.syncCatalog({ model: 'sonnet', effort: 'high' });
    el.paintPresets({ initial: true });
    return [...el.shadowRoot.querySelectorAll('.preset span')].map((node) => node.textContent.trim());
  });
  assert.deepEqual(names, ['Sonnet High', 'Opus Extra High', 'Grok High', 'Grok Extra High']);
  assert.equal(await view.locator('.presets').isVisible(), true);
  assert.equal(await view.locator('.picker').isVisible(), false);
  assert.equal(await view.locator('input[name="preset"][value="sonnet-high"]').isChecked(), true);
  await view.locator('.custom-toggle').click();
  assert.equal(await view.locator('.picker').isVisible(), true);
  const claudeModels = await view.evaluate((el) => [...el.shadowRoot.querySelectorAll('input[name="model"]')].map((input) => input.value));
  assert.deepEqual(claudeModels, ['haiku', 'sonnet', 'opus', 'fable']);
  await view.evaluate(async (el) => {
    await el.applyPreset({
      id: 'grok-xhigh',
      provider: 'cursor',
      model: 'cursor-grok-4.6',
      effort: 'xhigh',
      name: 'Grok Extra High',
      brand: 'cursor',
    });
  });
  assert.equal(await view.evaluate((el) => el.shadowRoot.querySelector('input[name="agent"]:checked')?.value), 'cursor');
  assert.equal(await view.evaluate((el) => el.shadowRoot.querySelector('input[name="model"]:checked')?.value), 'cursor-grok-4.6');
  assert.equal(await view.evaluate((el) => el.shadowRoot.querySelector('input[name="effort"]:checked')?.value), 'xhigh');
  assert.equal(await view.locator('.picker').isVisible(), true, 'Custom stays open so the sliders do not vanish');
  const cursorModels = await view.evaluate((el) => [...el.shadowRoot.querySelectorAll('input[name="model"]')].map((input) => input.value));
  assert.deepEqual(cursorModels, ['', 'auto', 'cursor-grok-4.6']);
  const clis = await view.evaluate((el) => [...el.shadowRoot.querySelectorAll('input[name="agent"] + span')].map((node) => node.textContent.trim()));
  assert.deepEqual(clis, ['Claude', 'Cursor']);
});

test('CLI radios are Claude, Cursor, then KIXLAB API', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const order = await view.evaluate((el) => {
    const sorted = window.marbleAgentUI.sortProviders([
      { id: 'claude-api', label: 'KIXLAB API' },
      { id: 'fake', label: 'Fake' },
      { id: 'cursor', label: 'Cursor' },
      { id: 'claude-subscription', label: 'Claude' },
    ]);
    window.marbleAgentUI.fillRadios(el.shadowRoot.querySelector('[data-seg="agent"]'), 'agent', sorted.map((item) => ({
      id: item.id,
      label: item.label,
    })), { empty: null, value: 'claude-subscription' });
    return [...el.shadowRoot.querySelectorAll('input[name="agent"]')].map((input) => input.value);
  });
  assert.deepEqual(order, ['claude-subscription', 'cursor', 'claude-api', 'fake']);
});

test('CLI, model, and effort sit on one segmented row', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const boxes = await Promise.all([
    view.locator('.picker-agent .seg-opts').boundingBox(),
    view.locator('.picker-models .seg-opts').boundingBox(),
    view.locator('.picker-effort .seg-opts').boundingBox(),
  ]);
  assert.ok(boxes.every(Boolean));
  assert.ok(Math.abs(boxes[0].y - boxes[1].y) < 6, `CLI and model should share a row, y ${boxes[0].y} vs ${boxes[1].y}`);
  assert.ok(Math.abs(boxes[1].y - boxes[2].y) < 6, `model and effort should share a row, y ${boxes[1].y} vs ${boxes[2].y}`);
  await view.evaluate((el) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const selected = await view.locator('input[name="agent"][value="fake"] + span').evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color.replace(/\s/g, ''), pad: parseFloat(s.paddingTop) };
  });
  const thumb = await view.locator('.picker-agent .seg-thumb').evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor.replace(/\s/g, ''), opacity: s.opacity };
  });
  assert.equal(thumb.bg, 'rgb(255,255,255)');
  assert.equal(thumb.opacity, '1');
  assert.ok(selected.pad <= 6, `composer pill should be thin, padding-top ${selected.pad}`);
});

test('a new conversation can name its model from the picker', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="model"][value="alt"]').waitFor();
  await view.locator('input[name="model"][value="alt"]').check();
  await view.locator('input[name="effort"][value="high"]').check();
  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const meta = await page.evaluate(async (conversation) => (await window.marble.agent.conversation(conversation)).meta, id);
  assert.equal(meta.model, 'alt');
  assert.equal(meta.effort, 'high');
});

test('the composer status names the CLI, documents changed, mode, and where', async () => {
  const { view } = await mount();
  await view.locator('.statusline').waitFor();
  const before = await view.locator('.statusline').textContent();
  assert.match(before, /Fake/);
  assert.match(before, /0 documents changed/);
  assert.match(before, /Default/);
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const after = await view.locator('.statusline').textContent();
  assert.match(after, /1 document changed/);
});

test('Shift+Tab cycles the CLI mode', async () => {
  const { page, view } = await mount();
  await view.locator('.status-mode').waitFor();
  assert.match(await view.locator('.status-mode').textContent(), /Default/);
  await view.locator('textarea').press('Shift+Tab');
  assert.match(await view.locator('.status-mode').textContent(), /Plan/);
  await view.locator('input[name="model"][value="alt"]').check();
  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const meta = await page.evaluate(async (conversation) => (await window.marble.agent.conversation(conversation)).meta, id);
  assert.equal(meta.mode, 'plan');
});

test('typing / lists clear, compact, models, effort and skills', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await view.locator('textarea').fill('/');
  await view.locator('.slash').waitFor();
  const listed = await view.locator('.slash').textContent();
  assert.match(listed, /Clear conversation/);
  assert.match(listed, /Compact/);
  assert.match(listed, /Effort: high/);
  assert.match(listed, /Alt/);
});

test('a prompt reads as a changelog entry, not a black chat bubble', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const css = await view.locator('.msg.me').evaluate((el) => {
    const s = getComputedStyle(el);
    return { alignSelf: s.alignSelf, color: s.color, background: s.backgroundColor.replace(/\s/g, '') };
  });
  assert.notEqual(css.alignSelf, 'flex-end');
  assert.notEqual(css.background, 'rgb(17,17,17)');
  assert.equal(css.color.replace(/\s/g, ''), 'rgb(17,17,17)');
});

test('the conversation title can be edited', async () => {
  const { page, view } = await mount();
  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const heading = view.locator('.heading');
  await heading.waitFor();
  await heading.click();
  await heading.fill('Backlog pass');
  await heading.press('Enter');
  await page.waitForFunction(async (conversation) => (
    (await window.marble.agent.conversation(conversation)).meta.title === 'Backlog pass'
  ), id);
});

test('Tab on a slash command turns it into a chip', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await view.locator('textarea').fill('/comp');
  await view.locator('.slash').waitFor();
  await view.locator('textarea').press('Tab');
  assert.match(await view.locator('.chip').textContent(), /Compact/i);
  assert.equal(await view.locator('textarea').inputValue(), '');
  assert.equal(await view.locator('.slash').isVisible(), false);
});

test('the transcript shows the agent’s words, its tool calls, and what changed', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();

  const agent = view.locator('.msg.agent').last();
  assert.equal(await agent.locator('strong').textContent(), 'Backlog');
  assert.equal(await agent.locator('li').count(), 2);
  assert.equal(await view.locator('.msg.agent.live').count(), 0, 'the streamed text was replaced by the final text');

  const tools = view.locator('.tool');
  assert.match(await tools.nth(0).textContent(), /Read garden/);
  assert.match(await tools.nth(1).textContent(), /Edited 1 element in garden/);
  assert.equal(await tools.nth(1).getAttribute('data-state'), 'done');
  assert.match(await view.locator('.turn-footer').last().textContent(), /Changed 1 element/);
});

test('undo reverts the turn and says so', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"] button.undo').click();
  await page.waitForFunction(async () => (await (await fetch('/a/garden')).text()).includes('>Research Garden<'));
  await view.locator('.turn-footer .undone').waitFor();
  assert.match(await view.locator('.turn-footer .undone').textContent(), /Undid 1/);
  assert.equal(await view.locator('.turn-footer button.undo').count(), 0);
});

test('agent text is never HTML, and only http(s) links become links', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:hostile');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const agent = view.locator('.msg.agent').last();
  assert.equal(await agent.locator('img').count(), 0);
  assert.match(await agent.textContent(), /<img src=x onerror=/);
  const links = agent.locator('a');
  assert.equal(await links.count(), 1);
  assert.equal(await links.first().getAttribute('href'), 'https://example.com');
  assert.equal(await links.first().getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

test('stop is there while a turn runs, and stops it', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('button.stop').click();
  await view.locator('.turn-footer[data-status="cancelled"]').waitFor();
  assert.equal(await view.locator('button.stop').isVisible(), false);
});

test('a second message while one runs is queued, and can be removed', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:slow');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'script:rename');
  await view.locator('.queued-item').waitFor();
  await view.locator('.queued-item button.dequeue').click();
  await view.locator('.queued-item').waitFor({ state: 'detached' });
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.turn-footer').count(), 1, 'only the first turn ran');
});

test('a refused edit is shown as refused, not as an error', async () => {
  const { page } = await mount();
  const view = page.locator('body > marble-conversation');
  await sendFrom(view, 'script:stale');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.tool').first().getAttribute('data-state'), 'refused');
  assert.match(await view.locator('.tool').first().textContent(), /Refused/);
});

test('events from another conversation are not painted into this view', async () => {
  const { page, view } = await mount();
  const check = await page.evaluate(() => {
    const fn = window.marbleAgentUI.eventBelongsToConversation;
    return {
      exists: typeof fn === 'function',
      own: fn?.({ turn: 'aaaaaaaaaaaa-t1' }, 'aaaaaaaaaaaa'),
      other: fn?.({ turn: 'bbbbbbbbbbbb-t1' }, 'aaaaaaaaaaaa'),
      prefix: fn?.({ turn: 'aaaaaaaaaaaab-t1' }, 'aaaaaaaaaaaa'),
      meta: fn?.({ type: 'handoff' }, 'aaaaaaaaaaaa'),
    };
  });
  assert.equal(check.exists, true);
  assert.equal(check.own, true);
  assert.equal(check.other, false);
  assert.equal(check.prefix, false);
  assert.equal(check.meta, true);

  const ids = await page.evaluate(async () => {
    const a = await window.marble.agent.start({ provider: 'fake' });
    const b = await window.marble.agent.start({ provider: 'fake' });
    return { a, b };
  });
  await view.evaluate((el, a) => el.setAttribute('conversation', a), ids.a);
  await page.waitForFunction((a) => document.querySelector('body > marble-conversation')?.getAttribute('conversation') === a, ids.a);
  await page.evaluate(async (a) => {
    await window.marble.agent.send(a, { prompt: 'script:slow', target: 'garden', viewing: 'garden', selection: [] });
  }, ids.a);
  await view.locator('.msg.me').waitFor();
  await view.evaluate((el, b) => el.setAttribute('conversation', b), ids.b);
  await page.waitForFunction((b) => document.querySelector('body > marble-conversation')?.getAttribute('conversation') === b, ids.b);
  await page.waitForTimeout(1800);
  const painted = await view.evaluate((el) => el.shadowRoot.querySelector('.log')?.textContent ?? '');
  assert.equal(painted.includes('script:slow'), false, 'the previous chat\'s prompt must not appear');
  assert.equal(painted.includes('finally'), false, 'the previous chat\'s stream must not appear');
});

test('an existing conversation opens with its whole history', async () => {
  const id = await (async () => {
    const { page } = await mount();
    const view = page.locator('body > marble-conversation');
    const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
    await sendFrom(view, 'script:rename');
    const conversation = await started;
    await view.locator('.turn-footer[data-status="completed"]').waitFor();
    return conversation;
  })();
  const { view } = await mount(id);
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.msg.me').count(), 1);
  assert.match(await view.locator('.msg.agent').last().textContent(), /Backlog/);
});

test('the context chip shows the target and the selection, and can drop the selection', async () => {
  const { page, view } = await mount();
  assert.equal((await view.locator('.context-text').textContent()).trim(), 'garden');
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await view.locator('.context-text', { hasText: '1 selected' }).waitFor();
  await view.locator('.context-clear').click();
  assert.equal((await view.locator('.context-text').textContent()).trim(), 'garden');
});

test('the context chip names the aimed target and how many more are in view', async () => {
  const { page, view } = await mount();
  await page.evaluate(() => window.marble.agent.aim('notes', { also: ['reading', 'log'] }));
  await view.locator('.context-text', { hasText: 'notes' }).waitFor();
  assert.match((await view.locator('.context-text').textContent()).trim(), /\+ 2 more/);
});

test('shift+enter makes a new line instead of sending', async () => {
  const { view } = await mount();
  await view.locator('textarea').fill('one');
  await view.locator('textarea').press('Shift+Enter');
  await view.locator('textarea').pressSequentially('two');
  assert.equal(await view.locator('textarea').inputValue(), 'one\ntwo');
  assert.equal(await view.locator('.msg.me').count(), 0);
});

test('the drawer shows used usage for Claude and Cursor', async () => {
  const { page } = await mount();
  await page.evaluate(() => window.marble.agent.open());
  const claude = page.locator('marble-agent-drawer .usage .meter[data-id="claude-subscription"]');
  const cursor = page.locator('marble-agent-drawer .usage .meter[data-id="cursor"]');
  await claude.waitFor();
  assert.match(await claude.textContent(), /23%/);
  assert.match(await cursor.textContent(), /19%/);
});

test('the conversation wears the document’s paper and ink', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--paper', 'rgb(26, 58, 42)');
    document.documentElement.style.setProperty('--ink', 'rgb(232, 240, 228)');
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  });
  const view = page.locator('body > marble-conversation');
  const css = await view.locator('.composer').evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor.replace(/\s/g, ''), color: s.color.replace(/\s/g, '') };
  });
  assert.equal(css.bg, 'rgb(26,58,42)');
  const ink = await view.evaluate((el) => getComputedStyle(el).color.replace(/\s/g, ''));
  assert.equal(ink, 'rgb(232,240,228)');
});

test('a painted page without tokens still lends its body to the conversation', async () => {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(() => {
    document.body.style.background = 'rgb(20, 40, 80)';
    document.body.style.color = 'rgb(240, 244, 255)';
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  });
  const view = page.locator('body > marble-conversation');
  const bg = await view.locator('.composer').evaluate((el) => getComputedStyle(el).backgroundColor.replace(/\s/g, ''));
  assert.equal(bg, 'rgb(20,40,80)');
});

test('a document.changed event is listed as a document changed', async () => {
  const store = host.drive.agents.store;
  const meta = await store.createConversation({ provider: 'fake' });
  const turn = await store.createTurn(meta.id, {
    prompt: 'rewrite it',
    context: { target: 'garden', viewing: 'garden', selection: [] },
  });
  await store.appendEvent(meta.id, { type: 'user', text: 'rewrite it', turn: turn.id, context: { target: 'garden' } });
  await store.appendEvent(meta.id, { type: 'turn.started', turn: turn.id, provider: 'fake' });
  await store.appendEvent(meta.id, { type: 'document.changed', turn: turn.id, path: 'garden', sha: 'a'.repeat(64) });
  await store.appendEvent(meta.id, { type: 'turn.completed', turn: turn.id, applied: 0 });
  await store.updateTurn(turn.id, { status: 'completed', applied: 0, finishedAt: Date.now() });

  const { view } = await mount(meta.id);
  await view.locator('.tool[data-name="document.changed"]').waitFor();
  assert.match(await view.locator('.tool[data-name="document.changed"]').textContent(), /garden/);
  assert.match(await view.locator('.tool[data-name="document.changed"]').textContent(), /document/i);
  assert.match(await view.locator('.statusline').textContent(), /1 document changed/);
});

test('a permission ask shows a card, and Allow answers it', async () => {
  const { view, errors } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await sendFrom(view, 'script:permission');
  const card = view.locator('.ask[data-kind="permission"]');
  await card.waitFor();
  assert.match(await card.textContent(), /Bash/);
  assert.match(await card.textContent(), /rm -rf build/);
  await card.locator('button.allow').click();
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.ask').count(), 0);
  await view.locator('.msg.agent', { hasText: 'answered:allow' }).waitFor();
  assert.deepEqual(errors, []);
});

test('a question ask offers its options; arrows move, Enter answers with the label', async () => {
  const { view, errors } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await sendFrom(view, 'script:question');
  const card = view.locator('.ask[data-kind="question"]');
  await card.waitFor();
  assert.equal(await card.locator('[role="radio"]').count(), 2);
  await card.locator('[role="radio"]').first().focus();
  await card.locator('[role="radio"]').first().press('ArrowDown');
  await card.locator('[role="radio"]').nth(1).press('Enter');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await view.locator('.msg.agent', { hasText: 'answered:allow:B' }).waitFor();
  assert.deepEqual(errors, []);
});

test('a new conversation is started in the picked project, and the mast names it', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-browser-repo-'));
  // Registered from the page so the request is same-origin, like the settings panel's.
  const repo = await page.evaluate((p) => window.marble.agent.addProject({ name: 'Repo', path: p }), dir);
  await view.evaluate((el) => el.fillProjects());
  await view.locator('input[name="project"][value="drive"]').waitFor();
  assert.equal(await view.locator('input[name="project"][value="drive"]').isChecked(), true);
  await view.locator(`input[name="project"][value="${repo.id}"]`).check();
  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  const meta = await page.evaluate((cid) => window.marble.agent.conversation(cid).then((r) => r.meta), id);
  assert.equal(meta.project, repo.id);
  await view.locator('.tag[data-kind="project"]', { hasText: 'Repo' }).waitFor();
  assert.equal(await view.locator('.picker-project').isVisible(), false, 'a started conversation cannot change project');
});

test('the mast counts other conversations running in the same project', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const other = await page.evaluate(async () => {
    const id = await window.marble.agent.start({ provider: 'fake', project: 'drive' });
    await window.marble.agent.send(id, { prompt: 'script:hold', target: 'garden' });
    return id;
  });
  await sendFrom(view, 'script:slow');
  await view.locator('.mast .also', { hasText: 'Also working here: 1' }).waitFor();
  await page.evaluate((id) => window.marble.agent.cancel(`${id}-t1`), other);
});
