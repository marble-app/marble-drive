import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

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
  question: [{ ask: { tool: 'AskUserQuestion', input: { questions: [{ question: 'A or B?', header: 'Pick', options: [{ label: 'A', description: 'the first way' }, { label: 'B', description: 'the second' }], multiSelect: false }] } } }],
  stale: [
    { call: 'apply_ops', args: { path: 'garden', note: 'unread', ops: [{ type: 'setText', id: 'p', text: 'x' }] } },
    { say: 'It was refused.' },
  ],
  choice: [{ say: 'Two ways to lay this out. Which do you want?\n\nA) Side by side\nB) Stacked' }],
  // A write, then a pause: long enough to read the construction zone the write
  // drew, and the row in the mast that points at it.
  building: [
    { call: 'read_document', args: { path: 'garden' } },
    { call: 'apply_ops', args: { path: 'garden', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { sleep: 2000 },
    { say: 'done' },
  ],
  elsewhere: [
    { call: 'read_document', args: { path: 'atlas' } },
    { call: 'apply_ops', args: { path: 'atlas', note: 'rename the heading', ops: [{ type: 'setText', id: 'h', text: 'Backlog' }] } },
    { sleep: 6000 },
    { say: 'done' },
  ],
  tools: [
    { tool: 'Bash', input: { command: 'node --test test/agent-runner.test.js', description: 'Run the runner tests' } },
    { tool: 'Read', input: { file_path: '/Users/x/marble-drive/test-browser/harness.js' } },
    { tool: 'Read', input: { file_path: '/Users/x/marble-drive/templates/agents.mrbl' } },
    { tool: 'Grep', input: { pattern: 'packFocus', path: '/Users/x/marble-drive/runtime' } },
    { tool: 'Bash', input: { command: 'git diff --stat' } },
    { tool: 'Edit', input: { file_path: '/Users/x/marble-drive/runtime/agent-ui.js' } },
    { say: 'Six calls later.' },
  ],
  // Operating the app instead of rewriting it. The act is one line about the
  // person's document, so it keeps its line while the reads fold around it.
  operating: [
    { tool: 'Read', input: { file_path: '/Users/x/marble-drive/runtime/collab.js' } },
    { tool: 'read_affordances', input: { path: 'table', ids: ['sort'] } },
    { tool: 'act', input: { path: 'table', id: 'sort', gesture: 'press' }, summary: 'Pressed Sort · 12 changes' },
    { tool: 'Grep', input: { pattern: 'sort', path: '/Users/x/marble-drive/runtime' } },
    { say: 'Sorted.' },
  ],
  // One command somebody refused and one that merely fell over. They arrive
  // the same way; the drawer has to tell them apart.
  refusals: [
    {
      tool: 'Bash',
      input: { command: 'grep -rn usage server', description: 'Find the usage wiring' },
      ok: false,
      denied: true,
      summary: 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Credential Exploration].',
    },
    {
      tool: 'Bash',
      input: { command: 'node /tmp/repro.mjs', description: 'Reproduce the crash' },
      ok: false,
      summary: "Exit code 1\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'",
    },
    { say: 'One refused, one broken.' },
  ],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN, atlas: GARDEN } });
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

/** Pick a radio in the setup. A folded segment keeps its radios in a closed
 *  menu, so this clicks the input itself rather than looking for it. */
const pick = (view, name, value) => view.evaluate((el, [n, v]) => {
  el.shadowRoot.querySelector(`input[name="${n}"][value="${v}"]`).click();
}, [name, value]);

const sendFrom = async (view, text) => {
  await view.locator('.editor').fill(text);
  await view.locator('.editor').press('Enter');
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
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: [{ id: 'high', label: 'High' }, { id: 'high-fast', label: 'High Fast' }, { id: 'xhigh', label: 'Extra High' }], hasBare: false },
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
  assert.deepEqual(names.names, ['Sonnet High', 'Opus High', 'Fable 5.1 High']);
  assert.ok(names.presets <= names.pills + 12, `presets ${names.presets} should hug pills ${names.pills}, not setup ${names.setup}`);
  // The setup shares its row with the mode and send buttons now, so the
  // margin is what Custom takes, not the old empty half of the composer.
  assert.ok(names.presets < names.setup - 40, `presets ${names.presets} should not fill setup ${names.setup}`);
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
  const names = boxes.filter((item) => item.text.includes('Grok 4.7 High'));
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

test('saved setups collapse to the one you are on, at every width', async () => {
  const { view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await installNamedSetups(view, { model: 'grok-4.7', effort: 'high' });
  // A row of capsules for a choice made rarely outweighed the prompt above it,
  // and had to be packed and re-packed at every width to fit. One word cannot
  // overflow, so the fitting problem is gone rather than solved.
  for (const width of [1100, 620, 460, 300]) {
    await view.evaluate((el, w) => { el.style.width = `${w}px`; el.fitSetup(); }, width);
    await view.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const shape = await view.evaluate((el) => {
      const sr = el.shadowRoot;
      const track = sr.querySelector('.presets');
      const more = track.querySelector('.presets-more');
      return {
        height: Math.round(track.getBoundingClientRect().height),
        onTrack: track.querySelectorAll(':scope > .preset').length,
        inMenu: sr.querySelectorAll('.presets-menu .preset').length,
        trigger: more.textContent.replace(/\s+/g, ' ').trim(),
        fill: getComputedStyle(more).backgroundColor,
      };
    });
    assert.equal(shape.onTrack, 0, `width ${width}: nothing should sit on the track`);
    assert.ok(shape.inMenu >= 4, `width ${width}: every setup lives in the menu, got ${shape.inMenu}`);
    assert.ok(shape.height < 32, `width ${width}: one row, got ${shape.height}`);
    assert.match(shape.trigger, /Grok 4\.7 High/, `width ${width}: the trigger names the setup you are on`);
    assert.match(shape.fill, /rgba\(0, 0, 0, 0\)/, `width ${width}: the trigger is a word, not a capsule`);
  }
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
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: [{ id: 'high', label: 'High' }, { id: 'high-fast', label: 'High Fast' }, { id: 'xhigh', label: 'Extra High' }], hasBare: false },
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
  // The setups live in the trigger's menu now, so open it to reach them.
  await view.locator('.presets-more').click();
  await view.locator('.presets-menu input[name="preset"][value="opus-high"]').click({ force: true });
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
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: [{ id: 'high', label: 'High' }, { id: 'high-fast', label: 'High Fast' }, { id: 'xhigh', label: 'Extra High' }], hasBare: false },
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
      model: 'grok-4.7',
      effort: 'high',
      name: 'Grok 4.7 High',
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
  assert.equal(flags.model, 'grok-4.7');
  assert.equal(flags.effort, 'high', 'Grok 4.7 rests on High, not High Fast');
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

// An unreadable meter (`available: false`, no `used`) is not spent usage.
// Not knowing is not being out: stay on Claude and leave its presets on.
// Spent usage (`used >= 100`) is the test above.
test('an unreadable Claude meter stays on Claude with its presets enabled', async () => {
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
  assert.equal(flags.preferred, 'claude-subscription');
  assert.equal(flags.agent, 'claude-subscription');
  assert.equal(flags.claudeDisabled, false);
  assert.equal(flags.sonnetDisabled, false);
  assert.equal(flags.grokDisabled, false);
});

// A meter the host could not fetch at all is not a meter that says zero left.
// When the CLI keeps its login somewhere the host cannot read, the strip has
// no Claude slider — and that used to grey out every Claude model, leaving a
// signed-in person with nothing to pick.
test('a signed-in Claude with no usage meter keeps its models pickable', async () => {
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
        models: [{ id: 'sonnet', label: 'Sonnet 5' }, { id: 'opus', label: 'Opus 5' }, { id: 'fable', label: 'Fable 5.1' }],
        efforts: ['high', 'xhigh'],
        modes: [{ id: 'default', label: 'Default' }],
      },
    ];
    el.usageMeters = [];
    await el.loadChrome();
    el.usageMeters = [];
    const usable = el.providerList.filter((item) => item.installed && item.signedIn);
    el.fillAgents(el.preferredProvider(usable)?.id);
    await el.syncCatalog();
    el.paintPresets({ initial: true });
    const presets = [...el.shadowRoot.querySelectorAll('input[name="preset"]')];
    return {
      preferred: el.preferredProvider(usable)?.id,
      claudeDisabled: el.shadowRoot.querySelector('input[name="agent"][value="claude-subscription"]')?.disabled ?? false,
      presetIds: presets.map((input) => input.value),
      disabledPresets: presets.filter((input) => input.disabled).map((input) => input.value),
      disabledModels: [...el.shadowRoot.querySelectorAll('input[name="model"]')]
        .filter((input) => input.disabled).map((input) => input.value),
    };
  });
  assert.equal(flags.preferred, 'claude-subscription');
  assert.equal(flags.claudeDisabled, false);
  assert.ok(flags.presetIds.includes('sonnet-high'), `expected Claude presets, got ${flags.presetIds.join(',')}`);
  assert.deepEqual(flags.disabledPresets, []);
  assert.deepEqual(flags.disabledModels, []);
});

/** Two conversations side by side in one page — the arrangement that let two
 *  setup sheets stand open at once, one per chat, floating over the same
 *  document. Each is narrow enough to leave the middle of the window empty,
 *  so a click at 640 lands on the page and on neither of them. */
async function mountPair() {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(() => {
    for (const side of ['left', 'right']) {
      const el = document.createElement('marble-conversation');
      el.setAttribute('data-marble-transient', '');
      el.dataset.side = side;
      el.style.cssText = `position:fixed;top:0;width:320px;height:100vh;${side}:0;`;
      document.body.append(el);
    }
  });
  const view = (side) => page.locator(`body > marble-conversation[data-side="${side}"]`);
  return { page, errors, left: view('left'), right: view('right') };
}

/** Give a view a Claude it can build setups from, and pack them into the •••.
 *  The model and effort are pinned rather than left to the catalog's default,
 *  because committing a setup persists it on the host — so a test that scrubs
 *  would otherwise hand its choice to whichever test ran next. */
const withSetups = (view, { efforts = ['high', 'xhigh'], model = 'fable', effort = 'high' } = {}) =>
  view.evaluate(async (el, [list, pick]) => {
    el.providerList = [{
      id: 'claude-subscription',
      label: 'Claude',
      installed: true,
      signedIn: true,
      default: true,
      models: [{ id: 'sonnet', label: 'Sonnet 5' }, { id: 'opus', label: 'Opus 5' }, { id: 'fable', label: 'Fable 5.1' }],
      efforts: list,
      modes: [{ id: 'default', label: 'Default' }],
    }];
    el.usageMeters = [];
    el.fillAgents('claude-subscription');
    await el.syncCatalog(pick);
    el.paintPresets({ initial: true });
    el.fitSetup();
  }, [efforts, { model, effort }]);

const segOpen = (view) => view.evaluate((el) => Boolean(el.shadowRoot.querySelector('.presets.is-open')));

/** The dock's own arrangement: two chats absolutely placed over one pane at
 *  z-index 2, so each is its own stacking context and a later sibling paints
 *  over the whole of an earlier one. `cover` is the side that paints on top,
 *  which is the side appended last. */
async function mountDock({ cover = 'left' } = {}) {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate((top) => {
    const pane = document.createElement('div');
    pane.style.cssText = 'position:fixed;inset:0;background:#fff;';
    document.body.append(pane);
    for (const side of [top === 'left' ? 'right' : 'left', top]) {
      const el = document.createElement('marble-conversation');
      el.setAttribute('data-marble-transient', '');
      el.dataset.side = side;
      el.style.cssText = `position:absolute;z-index:2;top:0;height:100%;width:49%;${side}:0;background:#fff;`;
      pane.append(el);
    }
  }, cover);
  const view = (side) => page.locator(`marble-conversation[data-side="${side}"]`);
  return { page, errors, left: view('left'), right: view('right') };
}

test('an open sheet is not painted over by the chat in the next pane', async () => {
  // The sheet hangs left off its trigger, so the right chat's sheet reaches
  // under the left one — and the left one is the sibling that paints on top.
  const { page, left, right } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await withSetups(right);
  await right.locator('.presets-more').click();
  await right.locator('.presets-menu').waitFor({ state: 'visible' });

  const hit = await page.evaluate(() => {
    const owner = document.querySelector('marble-conversation[data-side="right"]');
    const neighbour = document.querySelector('marble-conversation[data-side="left"]');
    const menu = owner.shadowRoot.querySelector('.presets-menu');
    const box = menu.getBoundingClientRect();
    const next = neighbour.getBoundingClientRect();
    // A point inside the sheet that also falls inside the neighbouring chat.
    const x = Math.round(Math.min(box.left + 6, next.right - 6));
    const y = Math.round(box.top + box.height / 2);
    return {
      overlaps: box.left < next.right,
      // elementFromPoint retargets to the shadow host, so the sheet reads as
      // its own conversation — what matters is which conversation answers.
      topmost: document.elementFromPoint(x, y)?.dataset?.side ?? null,
    };
  });
  assert.equal(hit.overlaps, true, 'the sheet has to reach under the other pane for this to test anything');
  assert.equal(hit.topmost, 'right', 'the chat next door painted over the open sheet');
});

test('a raised sheet still lands where its trigger is, at the right size', async () => {
  const { left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await left.locator('.presets-more').click();
  await left.locator('.presets-menu').waitFor({ state: 'visible' });
  const placed = await left.evaluate(async (el) => {
    const menu = el.shadowRoot.querySelector('.presets-menu');
    await Promise.all(menu.getAnimations().map((animation) => animation.finished.catch(() => {})));
    const box = menu.getBoundingClientRect();
    const trigger = el.shadowRoot.querySelector('.presets-more').getBoundingClientRect();
    const style = getComputedStyle(menu);
    return {
      // The popover UA sheet centres [popover] in the viewport with an auto
      // margin and paints it in system colours; both have to be overridden.
      margin: style.margin,
      width: Math.round(box.width),
      left: Math.round(box.left),
      // This trigger sits near the window's left edge, so the sheet cannot
      // hang right-aligned off it — floatMenu clamps it to the 8px pad. A
      // popover left to the UA would sit in the middle of the window instead.
      viewport: innerWidth,
      overlapsTrigger: box.left <= trigger.right + 1 && box.right >= trigger.left - 1,
      above: box.bottom <= Math.round(trigger.top),
      rows: el.shadowRoot.querySelectorAll('.presets-menu .preset').length,
    };
  });
  assert.equal(placed.margin, '0px', 'the UA popover margin would centre it in the window');
  assert.equal(placed.left, 8, 'it is clamped to the window pad, not centred in the top layer');
  assert.ok(placed.left < placed.viewport / 4, 'and nowhere near the middle');
  assert.ok(placed.overlapsTrigger, 'it still hangs off its own trigger');
  assert.ok(placed.above, 'and still opens above it');
  assert.ok(placed.width > 100 && placed.width < 360, `and keeps its own width, got ${placed.width}px`);
  assert.equal(placed.rows, 3, 'three setups now that effort has its own axis');
});

test('only one setup sheet is open on the page, whichever chat opened it', async () => {
  const { page, left, right } = await mountPair();
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await withSetups(right);

  await left.locator('.presets-more').click();
  assert.deepEqual([await segOpen(left), await segOpen(right)], [true, false]);

  // The bug: a pointerdown in the pane next door never reached the first
  // conversation's shadow root, so its sheet stayed up beside the new one.
  await right.locator('.presets-more').click();
  assert.deepEqual([await segOpen(left), await segOpen(right)], [false, true], 'opening one sheet must close the other');

  // And a click on the page behind them, which is in no shadow root at all.
  await page.mouse.click(640, 400);
  assert.deepEqual([await segOpen(left), await segOpen(right)], [false, false], 'a click outside must close the open sheet');

  await right.locator('.presets-more').click();
  assert.equal(await segOpen(right), true);
  await page.keyboard.press('Escape');
  assert.equal(await segOpen(right), false, 'Escape closes it from anywhere too');

  // Queue / Steer / Interrupt is the same kind of sheet — a folded .seg-opts —
  // and it has to take its turn with the setups rather than stack on them.
  const dispatchOpen = () => right.evaluate((el) => el.dispatchEl.classList.contains('is-open'));
  await left.locator('.presets-more').click();
  assert.equal(await segOpen(left), true);
  await right.evaluate((el) => { el.dispatchEl.hidden = false; });
  await right.locator('.dispatch .seg-current').click();
  assert.equal(await segOpen(left), false, 'a dispatch sheet closes an open setup sheet a pane away');
  assert.equal(await dispatchOpen(), true);
  await page.mouse.click(640, 400);
  assert.equal(await dispatchOpen(), false, 'and it dismisses on an outside click like the rest');
});

test('the setup sheet grows in and shrinks out instead of blinking', async () => {
  const { left } = await mountPair();
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await left.locator('.presets-more').waitFor();

  const shut = await left.evaluate((el) => {
    const menu = el.shadowRoot.querySelector('.presets-menu');
    const style = getComputedStyle(menu);
    return { display: style.display, opacity: style.opacity, transform: style.transform, transition: style.transitionProperty };
  });
  assert.equal(shut.display, 'none');
  assert.equal(shut.opacity, '0');
  // `transform` resolves to `none` on a display:none element whatever the
  // rule says, so the shut sheet's own resting size is not readable here —
  // the mid-entry checks below are what prove it grows.
  assert.ok(shut.transition.includes('display'), `display has to transition for a display:none sheet to animate at all — got ${shut.transition}`);
  assert.ok(shut.transition.includes('transform'), `and transform, to grow — got ${shut.transition}`);

  // Read the transitions themselves rather than sampling a value at some
  // frame: what the sheet's opacity happens to be two frames in is a race,
  // but "a 150ms fade from 0 to 1 is running on it" is not.
  const running = (view) => view.evaluate((el) => el.shadowRoot.querySelector('.presets-menu').getAnimations().map((animation) => {
    const property = animation.transitionProperty ?? '';
    const frames = animation.effect?.getKeyframes?.() ?? [];
    return {
      property,
      duration: animation.effect?.getTiming?.().duration ?? 0,
      from: String(frames[0]?.[property] ?? ''),
      to: String(frames.at(-1)?.[property] ?? ''),
    };
  }));
  const opening = await left.evaluate(async (el) => {
    el.shadowRoot.querySelector('.presets-more').click();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }).then(() => running(left));
  const fadeIn = opening.find((item) => item.property === 'opacity');
  const growIn = opening.find((item) => item.property === 'transform');
  assert.ok(fadeIn, `expected a running fade, got ${opening.map((i) => i.property).join(',') || 'nothing'}`);
  assert.ok(growIn, `expected a running grow, got ${opening.map((i) => i.property).join(',') || 'nothing'}`);
  assert.ok(fadeIn.duration > 0, 'the fade has to take time');
  assert.equal(fadeIn.from, '0', 'it enters from nothing — @starting-style is what supplies that');
  assert.equal(fadeIn.to, '1');
  assert.notEqual(growIn.from, 'none', 'and enters at a size it has to grow out of');

  await left.locator('.presets-menu').waitFor({ state: 'visible' });
  const settled = await left.evaluate(async (el) => {
    const menu = el.shadowRoot.querySelector('.presets-menu');
    await Promise.all(menu.getAnimations().map((animation) => animation.finished.catch(() => {})));
    const style = getComputedStyle(menu);
    return { opacity: style.opacity, transform: style.transform, position: style.position };
  });
  assert.equal(settled.opacity, '1');
  assert.equal(settled.transform, 'none', 'it lands at rest, not a shade off');
  // It has to stay fixed while it leaves, or the fade plays back at the anchor.
  assert.equal(settled.position, 'fixed');
  const leaving = await left.evaluate(async (el) => {
    const menu = el.shadowRoot.querySelector('.presets-menu');
    el.shadowRoot.querySelector('.presets-more').click();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const style = getComputedStyle(menu);
    return { display: style.display, position: style.position };
  });
  assert.equal(leaving.display, 'flex', 'it is still on screen while it leaves');
  // The bug this guards: unfloating on the same frame as the close strips
  // `position: fixed` and teleports the sheet back to its anchor, so the
  // fade-out plays somewhere else on the screen.
  assert.equal(leaving.position, 'fixed', 'it must not snap back to its anchor mid-exit');
  const fadeOut = (await running(left)).find((item) => item.property === 'opacity');
  assert.ok(fadeOut, 'expected a running fade out');
  assert.equal(fadeOut.to, '0');
});

test('a setup row under the pointer lights up, and eases into it', async () => {
  const { left } = await mountPair();
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await left.locator('.presets-more').click();
  // The label, not the span: the radio is stretched over the row to take the
  // click, and the span is pointer-events: none behind it. Hovering the label
  // is what a pointer actually does, and what the rule reads.
  const row = left.locator('.presets-menu .preset', { hasText: 'Sonnet High' });
  await row.waitFor();
  const before = await row.evaluate((label) => getComputedStyle(label.querySelector('span')).backgroundColor);
  await row.hover();
  // Reading the colour straight after the hover reads it at t=0 of the fade,
  // which is the colour it is leaving. Let the transition finish, and take
  // the proof that it eased from the transition itself.
  const settled = await row.evaluate(async (label) => {
    const span = label.querySelector('span');
    const easing = span.getAnimations().map((animation) => animation.transitionProperty ?? '');
    await Promise.all(span.getAnimations().map((animation) => animation.finished.catch(() => {})));
    return { easing, fill: getComputedStyle(span).backgroundColor };
  });
  assert.ok(settled.easing.includes('background-color'), `the fill has to ease in, got ${settled.easing.join(',') || 'a snap'}`);
  assert.notEqual(settled.fill, before, 'hovering a row has to paint it');
  assert.notEqual(settled.fill, 'rgba(0, 0, 0, 0)');
});

const scrub = (view) => view.evaluate((el) => ({
  open: el.scrubIsOpen(),
  at: el.scrubAt ?? null,
  stops: (el.scrubPresets ?? []).map((preset) => preset.id),
  model: el.shadowRoot.querySelector('.scrub-model')?.textContent.trim() ?? '',
  // Every word of the scale is in the DOM; only the lit one is the reading.
  effort: el.shadowRoot.querySelector('.scrub-effort > i.is-on')?.textContent ?? '',
  gauge: [...el.shadowRoot.querySelectorAll('.scrub-gauge > i')].filter((bar) => bar.classList.contains('is-on')).length,
  labels: [...el.shadowRoot.querySelectorAll('.scrub-stop')].map((stop) => stop.querySelector('.scrub-name').textContent),
  stopEfforts: [...el.shadowRoot.querySelectorAll('.scrub-stop')].map((stop) => stop.querySelector('.scrub-stop-effort > i.is-on')?.textContent ?? ''),
  tuned: el.scrubPresets ? el.scrubPresets.map((preset) => `${preset.model}=${el.scrubTuned.get(preset.id)}`) : [],
  marked: [...el.shadowRoot.querySelectorAll('.scrub-stop')].findIndex((stop) => stop.classList.contains('is-at')),
  setup: el.shadowRoot.querySelector('.presets-more')?.textContent.trim() ?? '',
}));

const hold = async (page) => {
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
};
const release = async (page) => {
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
};

test('holding the two modifiers raises the setups as a stepped scrubber', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();
  assert.equal((await scrub(left)).open, false, 'nothing is up before the keys go down');

  await hold(page);
  const up = await scrub(left);
  assert.equal(up.open, true);
  // Weakest at the left: a slider is pushed right to turn something up.
  assert.deepEqual(up.stops, ['sonnet-high', 'opus-high', 'fable-high'], 'one stop per setup you can pick, weakest first');
  assert.deepEqual(up.labels, ['Sonnet', 'Opus', 'Fable 5.1'], 'the model alone — effort has its own axis now');
  assert.equal(up.marked, up.at, 'the stop it starts on is the one marked');
  assert.equal(up.model, 'Fable 5.1');
  assert.equal(up.effort, 'High');

  // Raised, not just floated: it has the pane next door to clear as well.
  assert.equal(
    await left.evaluate((el) => el.shadowRoot.querySelector('.scrub').matches(':popover-open')),
    true,
  );
  await release(page);
});

test('the arrows walk the scrubber while the modifiers are held, and stop at the ends', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();
  await hold(page);
  // The default setup is the strongest, which is now the right-hand end.
  const start = await scrub(left);
  assert.equal(start.at, start.stops.length - 1);
  assert.equal(start.model, 'Fable 5.1');

  await page.keyboard.press('ArrowLeft');
  const moved = await scrub(left);
  assert.equal(moved.at, start.at - 1);
  assert.equal(moved.marked, moved.at, 'the mark follows');
  assert.equal(moved.model, 'Opus');

  // A timeline has ends; holding an arrow down comes to rest, it does not cycle.
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowLeft');
  const leftEnd = await scrub(left);
  assert.equal(leftEnd.at, 0, 'the left end holds');
  assert.equal(leftEnd.model, 'Sonnet');
  // The knob and the fill went with it rather than staying where they were.
  const atLeft = await left.evaluate((el) => ({
    fill: el.shadowRoot.querySelector('.scrub-fill').style.width,
    knob: el.shadowRoot.querySelector('.scrub-knob').style.transform,
  }));
  assert.equal(atLeft.fill, '0px');
  assert.equal(atLeft.knob, 'translateX(0px)');

  for (let i = 0; i < 9; i += 1) await page.keyboard.press('ArrowRight');
  assert.equal((await scrub(left)).at, start.stops.length - 1, 'and so does the right');
  const atRight = await left.evaluate((el) => ({
    fill: el.shadowRoot.querySelector('.scrub-fill').style.width,
    knob: el.shadowRoot.querySelector('.scrub-knob').style.transform,
  }));
  assert.notEqual(atRight.fill, '0px');
  assert.notEqual(atRight.knob, 'translateX(0px)');
  await release(page);
});

test('up and down tune the effort of the model the scrubber is on', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left, { efforts: ['low', 'medium', 'high', 'xhigh', 'max'] });
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();

  await hold(page);
  const start = await scrub(left);
  assert.equal(start.effort, 'High', 'it opens on the effort actually set, not the stop\'s own');
  assert.equal(start.gauge, 3, 'and the gauge is filled to it');

  await page.keyboard.press('ArrowUp');
  const up = await scrub(left);
  assert.equal(up.effort, 'Extra High');
  assert.equal(up.gauge, 4);
  assert.equal(up.at, start.at, 'the model it is on does not move');

  // Let the switch above land first. Reversing one that has not visually
  // left zero is 0 → 0, which is no change and so no transition — the
  // browser is right about that, and it is not what this is asking.
  await left.evaluate(async (el) => {
    const parts = [...el.shadowRoot.querySelectorAll('.scrub-effort > i, .scrub-gauge > i')];
    await Promise.all(parts.flatMap((node) => node.getAnimations().map((a) => a.finished.catch(() => {}))));
  });

  // The switch is animated, not swapped: the word that arrives fades and
  // rises, the word it replaces leaves, and the colour and weight travel.
  // The tune and the reading share one round-trip — the fade is 160ms, and a
  // couple of assertions in between are enough to miss the end of it, which
  // is a slower machine away from being a flake.
  const running = await left.evaluate((el) => {
    const root = el.shadowRoot;
    const lit = () => root.querySelector('.scrub-effort > i.is-on')?.textContent ?? '';
    const was = lit();
    el.tuneScrub(-1);
    const props = (node) => (node?.getAnimations() ?? []).map((a) => a.transitionProperty ?? '').filter(Boolean);
    const words = [...root.querySelectorAll('.scrub-effort > i')];
    return {
      was,
      now: lit(),
      on: props(words.find((i) => i.classList.contains('is-on'))),
      // Only one of the words that are off is the one just turned off; the
      // rest were never on and have nothing but their colour running.
      all: words.map((i) => `${i.textContent}:${i.classList.contains('is-on') ? 'on' : 'off'}:${getComputedStyle(i).opacity}:${props(i).join('+') || '-'}`),
      leaving: words.filter((i) => !i.classList.contains('is-on')).map(props).filter((list) => list.includes('opacity')).length,
      bar: props([...root.querySelectorAll('.scrub-gauge > i')].find((i) => i.classList.contains('is-on'))),
    };
  });
  assert.equal(running.was, 'Extra High');
  assert.equal(running.now, 'High', 'the tune has to have actually happened for the rest of this to mean anything');
  assert.ok(running.on.includes('color'), `the colour travels, got ${running.on.join(',') || 'nothing'}`);
  assert.ok(running.on.includes('font-weight'), `and the weight, got ${running.on.join(',') || 'nothing'}`);
  assert.ok(running.on.includes('opacity'), 'the arriving word fades in');
  assert.equal(running.leaving, 1, `and exactly the one it replaced fades out — ${running.all.join(' | ')}`);
  assert.ok(running.bar.includes('background-color'), `the gauge fills rather than flicking, got ${running.bar.join(',') || 'nothing'}`);
  await page.keyboard.press('ArrowUp');

  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowUp');
  assert.equal((await scrub(left)).effort, 'Max', 'the top holds');
  for (let i = 0; i < 9; i += 1) await page.keyboard.press('ArrowDown');
  const bottom = await scrub(left);
  assert.equal(bottom.effort, 'Low', 'and so does the bottom');
  assert.equal(bottom.gauge, 1);
  await release(page);
});

test('a setup no chip matches still opens on its own model', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  // Opus at Max is no saved setup — it is what tuning the effort leaves.
  await withSetups(left, { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], model: 'opus', effort: 'max' });
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();

  await hold(page);
  const up = await scrub(left);
  assert.equal(up.model, 'Opus', 'the stop is the model, even with no chip to match');
  assert.equal(up.effort, 'Max', 'and the gauge carries the effort that had no chip');
  assert.equal(up.gauge, 5);
  await release(page);
});

test('each model keeps its own effort, and wears it under its name', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left, { efforts: ['low', 'medium', 'high', 'xhigh', 'max'] });
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();

  await hold(page);
  // Turn the strongest model all the way up.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.deepEqual((await scrub(left)).tuned, ['sonnet=high', 'opus=high', 'fable=max'], 'only the one it is on moved');

  // Walk off it: the next model is still where it was left, not at Max.
  await page.keyboard.press('ArrowLeft');
  const opus = await scrub(left);
  assert.equal(opus.model, 'Opus');
  assert.equal(opus.effort, 'High', 'a raised effort does not follow you to the next model');
  assert.equal(opus.gauge, 3);

  await page.keyboard.press('ArrowDown');
  assert.deepEqual((await scrub(left)).tuned, ['sonnet=high', 'opus=medium', 'fable=max']);

  // And back: the model you tuned is still tuned.
  await page.keyboard.press('ArrowRight');
  const back = await scrub(left);
  assert.equal(back.effort, 'Max', 'the model you tuned kept it');
  // Each stop says what it is remembering, under its own name.
  assert.deepEqual(back.stopEfforts, ['High', 'Medium', 'Max']);
  assert.deepEqual(back.labels, ['Sonnet', 'Opus', 'Fable 5.1'], 'the names stay the names');
  await release(page);
});

test('the model name does not move when the effort word changes length', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left, { efforts: ['low', 'medium', 'high', 'xhigh', 'max'] });
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();
  // Unrounded: a sub-pixel wobble is still a wobble, and rounding would hide
  // one while turning another into a whole pixel of apparent movement.
  const modelLeft = () => left.evaluate((el) => el.shadowRoot.querySelector('.scrub-model').getBoundingClientRect().left);

  // The card scales as it arrives, so a rect read mid-entry is the entry's,
  // not the layout's. This test is about where things come to rest.
  const settled = () => left.evaluate(async (el) => {
    const parts = [...el.shadowRoot.querySelectorAll('.scrub, .scrub *')];
    await Promise.all(parts.flatMap((node) => node.getAnimations().map((a) => a.finished.catch(() => {}))));
  });

  await hold(page);
  const at = [];
  // "Low" and "Extra High" are the extremes of the scale's own width; the
  // stack is sized to the longest, so the name beside it cannot shift.
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowDown');
  await settled();
  at.push(await modelLeft());
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('ArrowUp');
    at.push(await modelLeft());
    await settled();
    at.push(await modelLeft());
  }
  const spread = Math.max(...at) - Math.min(...at);
  assert.ok(spread < 0.01, `the name held still at every effort, got ${at.map((n) => n.toFixed(2)).join(', ')}`);
  assert.equal((await scrub(left)).effort, 'Extra High', 'and it really did walk the whole scale');
  await release(page);
});

test('a tuned effort is committed along with the model', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left, { efforts: ['low', 'medium', 'high', 'xhigh', 'max'] });
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();

  await hold(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await release(page);
  await left.locator('.presets-more').waitFor();
  const picked = await left.evaluate(async (el) => {
    await new Promise((done) => setTimeout(done, 60));
    const root = el.shadowRoot;
    return {
      model: root.querySelector('input[name="model"]:checked')?.value,
      effort: root.querySelector('input[name="effort"]:checked')?.value,
    };
  });
  // The setup that used to be its own chip, now reached by one press of ↑.
  assert.deepEqual(picked, { model: 'opus', effort: 'xhigh' });
});

test('effort alone is enough of a change to be worth committing', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left, { efforts: ['low', 'medium', 'high', 'xhigh', 'max'] });
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();

  await hold(page);
  await page.keyboard.press('ArrowDown');
  await release(page);
  const effort = await left.evaluate(async (el) => {
    await new Promise((done) => setTimeout(done, 60));
    return el.shadowRoot.querySelector('input[name="effort"]:checked')?.value;
  });
  assert.equal(effort, 'medium', 'the model never moved, but the effort did');
});

test('letting the modifiers go commits the setup the scrubber landed on', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();
  const before = (await scrub(left)).setup;

  await hold(page);
  // Down one from the strongest, which is where the default sits.
  await page.keyboard.press('ArrowLeft');
  await release(page);
  await left.locator('.presets-more', { hasText: 'Opus High' }).waitFor();
  const after = await scrub(left);
  assert.equal(after.open, false, 'the scrubber goes down with the keys');
  assert.notEqual(after.setup, before);
  assert.equal(after.setup, 'Opus High');
  assert.equal(
    await left.evaluate((el) => el.shadowRoot.querySelector('input[name="model"]:checked')?.value),
    'opus',
    'and the picker underneath followed it',
  );
});

test('Escape drops the scrubber without changing the setup', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await left.locator('.presets-more').waitFor();
  await left.locator('.editor').click();
  const before = (await scrub(left)).setup;

  await hold(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  assert.equal((await scrub(left)).open, false);
  await release(page);
  assert.equal((await scrub(left)).setup, before, 'a cancelled scrub commits nothing');
});

test('resting on the setup button names the shortcut, after a beat', async () => {
  const { page, left } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await left.locator('.presets-more').waitFor();
  // Its own tip: every armed control keeps one beside it, so ".keytip" alone
  // now means more than one thing.
  const hint = () => left.evaluate((el) => {
    const tip = el.shadowRoot.querySelector('.presets-more + .keytip');
    return { open: Boolean(tip?.classList.contains('is-open')), text: tip?.textContent ?? '' };
  });

  await left.locator('.presets-more').hover();
  // A tip that arrives the instant the pointer crosses the button is noise on
  // the way to somewhere else; this one waits to be rested on.
  assert.equal((await hint()).open, false, 'not on the way past');

  await left.locator('.presets-more + .keytip').waitFor({ state: 'visible' });
  const up = await hint();
  assert.equal(up.open, true);
  assert.match(up.text, /⌃⌥/);
  assert.match(up.text, /model/);
  assert.match(up.text, /effort/);
  // It has the pane next door to clear, like every other floating thing here.
  assert.equal(await left.evaluate((el) => el.shadowRoot.querySelector('.presets-more + .keytip').matches(':popover-open')), true);

  await page.mouse.move(4, 4);
  await left.locator('.presets-more + .keytip').waitFor({ state: 'hidden' });
  assert.equal((await hint()).open, false, 'moving on takes it away');
});

test('the scrubber belongs to the chat that has focus', async () => {
  const { page, left, right } = await mountDock({ cover: 'left' });
  await left.locator('input[name="agent"][value="fake"]').waitFor();
  await withSetups(left);
  await withSetups(right);
  await right.locator('.editor').click();

  await hold(page);
  assert.deepEqual(
    [(await scrub(left)).open, (await scrub(right)).open],
    [false, true],
    'the keys go to the chat being written in, not to every pane on the page',
  );
  await release(page);
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
          { id: 'grok-4.7', label: 'Grok 4.7', efforts: [{ id: 'high', label: 'High' }, { id: 'high-fast', label: 'High Fast' }, { id: 'xhigh', label: 'Extra High' }], hasBare: false },
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
  assert.deepEqual(names, ['Sonnet High', 'Grok 4.7 High', 'Opus High', 'Fable 5.1 High']);
  assert.equal(await view.locator('.presets').isVisible(), true);
  assert.equal(await view.locator('.picker').isVisible(), false);
  assert.equal(await view.locator('input[name="preset"][value="sonnet-high"]').isChecked(), true);
  await view.locator('.custom-toggle').click();
  assert.equal(await view.locator('.picker').isVisible(), true);
  const claudeModels = await view.evaluate((el) => [...el.shadowRoot.querySelectorAll('input[name="model"]')].map((input) => input.value));
  assert.deepEqual(claudeModels, ['haiku', 'sonnet', 'opus', 'fable']);
  await view.evaluate(async (el) => {
    await el.applyPreset({
      id: 'grok-high',
      provider: 'cursor',
      model: 'grok-4.7',
      effort: 'high',
      name: 'Grok 4.7 High',
      brand: 'cursor',
    });
  });
  assert.equal(await view.evaluate((el) => el.shadowRoot.querySelector('input[name="agent"]:checked')?.value), 'cursor');
  assert.equal(await view.evaluate((el) => el.shadowRoot.querySelector('input[name="model"]:checked')?.value), 'grok-4.7');
  assert.equal(await view.evaluate((el) => el.shadowRoot.querySelector('input[name="effort"]:checked')?.value), 'high');
  assert.equal(await view.locator('.picker').isVisible(), true, 'Custom stays open so the sliders do not vanish');
  const cursorModels = await view.evaluate((el) => [...el.shadowRoot.querySelectorAll('input[name="model"]')].map((input) => input.value));
  assert.deepEqual(cursorModels, ['', 'auto', 'grok-4.7']);
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
    return { color: s.color.replace(/\s/g, ''), pad: parseFloat(s.paddingTop), weight: s.fontWeight };
  });
  // No sliding capsule behind the choice any more — the chosen segment says so
  // in the type, which is the whole point of the quiet bar.
  assert.equal(await view.locator('.picker-agent .seg-thumb').evaluate((el) => getComputedStyle(el).display), 'none');
  const tone = await view.evaluate((el) => {
    const cs = getComputedStyle(el);
    const paint = (v) => { const d = document.createElement('div'); d.style.color = v; el.shadowRoot.append(d); const c = getComputedStyle(d).color.replace(/\s/g, ''); d.remove(); return c; };
    return { ink: paint(cs.getPropertyValue('--ink')), muted: paint(cs.getPropertyValue('--muted')) };
  });
  assert.equal(selected.color, tone.ink, 'the chosen segment carries full ink');
  assert.notEqual(selected.color, tone.muted, 'the chosen segment must not look like its neighbours');
  assert.ok(Number(selected.weight) >= 600, `chosen segment should be heavier, got ${selected.weight}`);
  assert.ok(selected.pad <= 6, `composer pill should be thin, padding-top ${selected.pad}`);
});

test('a new conversation can name its model from the picker', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="model"][value="alt"]').waitFor({ state: 'attached' });
  await pick(view, 'model', 'alt');
  await pick(view, 'effort', 'high');
  const started = page.evaluate(() => new Promise((resolve) => document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true })));
  await sendFrom(view, 'script:rename');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const meta = await page.evaluate(async (conversation) => (await window.marble.agent.conversation(conversation)).meta, id);
  assert.equal(meta.model, 'alt');
  assert.equal(meta.effort, 'high');
});

test('the composer is two registers: the message with its send, then a settings bar', async () => {
  const { view } = await mount();
  await view.locator('.row .bar .setup .picker').waitFor();
  assert.equal(await view.locator('.statusline').count(), 0);
  assert.equal(await view.locator('.status-where').count(), 0);
  const mode = view.locator('.row .bar button.mode');
  assert.match(await mode.textContent(), /Default/);
  // Send belongs to the field it sends, not to the settings strip. In the bar
  // it made the strip impossible to balance — crushed in a narrow pane, and
  // stranded past a wide gap in a wide one.
  const [fieldBox, barBox, sendBox] = await Promise.all([
    view.locator('.field').boundingBox(),
    view.locator('.bar').boundingBox(),
    view.locator('.send').boundingBox(),
  ]);
  assert.ok(
    sendBox.y >= fieldBox.y - 1 && sendBox.y + sendBox.height <= fieldBox.y + fieldBox.height + 1,
    'send sits with the message, in the field',
  );
  assert.ok(sendBox.y + sendBox.height <= barBox.y + 1, 'send sits above the settings bar');
  // The bar reaches the full width of the card, so the mode label lands on the
  // right edge rather than against a button that used to sit there.
  const modeBox = await mode.boundingBox();
  assert.ok(barBox.x + barBox.width - (modeBox.x + modeBox.width) < 14, 'the mode label holds the right edge');
  const height = await view.locator('.composer').evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(height < 130, `composer is ${height}px tall`);
});

test('a tile keeps its mast and its bar', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await view.evaluate((el) => el.setAttribute('data-chrome', 'tile'));
  assert.equal(await view.locator('.mast').isVisible(), true);
  assert.equal(await view.locator('.bar .setup').isVisible(), true);
  await page.close();
});

test('Shift+Tab cycles the CLI mode', async () => {
  const { page, view } = await mount();
  await view.locator('button.mode').waitFor();
  assert.match(await view.locator('button.mode').textContent(), /Default/);
  await view.locator('.editor').press('Shift+Tab');
  assert.match(await view.locator('button.mode').textContent(), /Plan/);
  await pick(view, 'model', 'alt');
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
  await view.locator('.editor').fill('/');
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
  await view.locator('.editor').fill('/comp');
  await view.locator('.slash').waitFor();
  await view.locator('.editor').press('Tab');
  assert.match(await view.locator('.chip').textContent(), /Compact/i);
  assert.equal(await view.locator('.editor').evaluate((el) => el.value), '');
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

  // Both calls finished, so they fold; open the fold to read them.
  await view.locator('.tool-group-head').click();
  const tools = view.locator('.tool');
  assert.match(await tools.nth(0).textContent(), /Read garden/);
  assert.match(await tools.nth(1).textContent(), /Edited 1 element in garden/);
  assert.equal(await tools.nth(1).getAttribute('data-state'), 'done');
  assert.match(await view.locator('.turn-footer').last().textContent(), /Changed 1 element/);
});

test('a CLI tool row names what it touched, never "Tried"', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:tools');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const rows = view.locator('.tool');
  assert.match(await rows.nth(0).textContent(), /^Ran Run the runner tests$/);
  assert.match(await rows.nth(1).textContent(), /^Read harness\.js$/);
  assert.match(await rows.nth(3).textContent(), /^Grep packFocus in runtime$/);
  assert.match(await rows.nth(4).textContent(), /^Ran git diff --stat$/);
  assert.match(await rows.nth(5).textContent(), /^Edited agent-ui\.js$/);
  assert.equal(await rows.nth(1).getAttribute('data-short'), 'Read');
  assert.equal(await rows.nth(1).getAttribute('data-source'), 'harness.js');
  assert.equal(await view.locator('.tool', { hasText: 'Tried' }).count(), 0);
});

test('finished tool rows fold into one line that counts by kind and names sources', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:tools');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const group = view.locator('.tool-group');
  assert.equal(await group.count(), 1);
  const head = group.locator('.tool-group-head');
  assert.match(await head.locator('.tool-group-count').textContent(), /^6 steps$/);
  const kinds = await head.locator('.tool-group-kinds').textContent();
  assert.match(kinds, /Shell ×2 · /);
  assert.match(kinds, /Read ×2 harness\.js, agents\.mrbl/);
  assert.match(kinds, /Grep packFocus/);
  assert.match(kinds, /Edit agent-ui\.js/);
  assert.equal(await head.getAttribute('aria-expanded'), 'false');
  assert.equal(await group.locator('.tool').first().isVisible(), false);
  await head.click();
  assert.equal(await head.getAttribute('aria-expanded'), 'true');
  assert.equal(await group.locator('.tool').first().isVisible(), true);
  assert.equal(await group.locator('.tool').count(), 6);
});

// Calling both "Blocked: Bash" read as a drive with no access, when most of
// them were the agent tripping over its own shell. Only a refusal is a
// decision, and only a decision gets the word.
test('an act says what the app did, and stays out of the fold', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:operating');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();

  // Called as an address and a gesture; reported as the sentence the host
  // wrote once the control had run.
  const act = view.locator('.tool[data-kind="act"]');
  assert.equal(await act.count(), 1);
  assert.equal((await act.textContent()).trim(), 'Pressed Sort · 12 changes');
  assert.equal(await act.isVisible(), true, 'an act is never folded away');
  assert.equal(await view.locator('.tool-group .tool[data-kind="act"]').count(), 0);
  assert.match(await view.locator('.tool-group-count').first().textContent(), /^2 steps$/);
  assert.match(
    await view.locator('.tool-group-kinds').first().textContent(),
    /Read_affordances/,
  );
});

test('a refused command says Blocked, a broken one says Failed, and both keep their label', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:refusals');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();

  const blocked = view.locator('.tool[data-state="refused"]');
  const failed = view.locator('.tool[data-state="failed"]');
  assert.equal(await blocked.count(), 1);
  assert.equal(await failed.count(), 1);

  // The label of the step survives, so the row still says which command it was.
  assert.equal(await blocked.textContent(), 'Blocked: Ran Find the usage wiring');
  assert.equal(await failed.textContent(), 'Failed: Ran Reproduce the crash');

  // Why, on hover.
  assert.match(await blocked.getAttribute('title'), /auto mode classifier/);
  assert.match(await failed.getAttribute('title'), /ERR_MODULE_NOT_FOUND/);

  // Neither folds away: an unfinished row ends a run.
  assert.equal(await view.locator('.tool-group').count(), 0);
});

test('a refused edit stays out of the fold', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:stale');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.tool-group').count(), 0);
  assert.equal(await view.locator('.tool[data-state="refused"]').isVisible(), true);
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

test('queued rows show their mode, cycle it, and can be edited', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'later');
  const row = view.locator('.queued-item');
  // Instrumented, because this wait is one of the ones that loses its 30s
  // budget on a loaded machine: on failure say whether the row was never made
  // (nothing queued) or was made and drew nothing (the floating stack).
  await row.waitFor().catch(async (err) => {
    const seen = await view.evaluate((el) => {
      const r = el.shadowRoot;
      const q = r.querySelector('.queued');
      const box = (n) => { const b = n.getBoundingClientRect(); return [b.width, b.height, b.top].map((v) => Math.round(v)); };
      return {
        queuedHidden: q.hidden,
        queued: box(q),
        rows: [...r.querySelectorAll('.queued-item')].map(box),
        running: !r.querySelector('.stop').hidden,
        turns: r.querySelectorAll('.turn-footer').length,
        sent: r.querySelectorAll('.msg.me').length,
      };
    });
    throw new Error(`queued row never showed: ${JSON.stringify(seen)} — ${err.message}`);
  });
  assert.equal(await row.getAttribute('data-dispatch'), 'queue');
  assert.match(await row.locator('.queued-dispatch').textContent(), /Queue/);
  await row.locator('.queued-dispatch').click();
  await page.waitForFunction(() => document.querySelector('body > marble-conversation').shadowRoot.querySelector('.queued-item').dataset.dispatch === 'steer');
  await row.locator('.queued-text').click();
  const edit = row.locator('.queued-text[contenteditable]');
  await edit.waitFor();
  await edit.fill('later, but shorter');
  await edit.press('Enter');
  await row.locator('.queued-text', { hasText: 'later, but shorter' }).waitFor();
  const id = await page.evaluate(() => document.querySelector('body > marble-conversation').getAttribute('conversation'));
  await page.waitForFunction(async (cid) => (await window.marble.agent.conversation(cid)).turns[1]?.prompt === 'later, but shorter', id);
  const turns = await host.drive.agents.store.turns(id);
  assert.equal(turns[1].dispatch, 'steer');
});

test('two queued rows show the batch switch, and it is saved on the conversation', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'one');
  await view.locator('.queued-item').waitFor();
  assert.equal(await view.locator('.queued-bar').isVisible(), false);
  await sendFrom(view, 'two');
  await view.locator('.queued-bar').waitFor({ state: 'visible' });
  await view.locator('.queued-together').click();
  const id = await page.evaluate(() => document.querySelector('body > marble-conversation').getAttribute('conversation'));
  await page.waitForFunction(async (cid) => (await window.marble.agent.conversation(cid)).meta.queueCombine === true, id);
  assert.equal(await view.locator('.queued').getAttribute('data-combine'), '1');
});

test('while a turn runs the bar offers queue and steer only, and ⌘Enter steers', async () => {
  const { page, view } = await mount();
  assert.equal(await view.locator('.bar .dispatch').isVisible(), false);
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('.bar .dispatch').waitFor({ state: 'visible' });
  const modes = await view.evaluate((el) => [...el.shadowRoot.querySelectorAll('input[name="dispatch"]')].map((i) => i.value));
  assert.deepEqual(modes, ['queue', 'steer'], 'interrupt is not on offer');
  await pick(view, 'dispatch', 'steer');
  await view.locator('.editor').fill('now');
  await view.locator('.editor').press('Enter');
  const id = await page.evaluate(() => document.querySelector('body > marble-conversation').getAttribute('conversation'));
  await page.waitForFunction(async (cid) => (await window.marble.agent.conversation(cid)).turns.some((t) => t.dispatch === 'steer'), id);
  await view.locator('button.stop').click();
  await view.locator('.turn-footer[data-status="cancelled"]').waitFor();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('.editor').fill('nudge');
  await view.locator('.editor').press('Meta+Enter');
  await page.waitForFunction(async (cid) => (await window.marble.agent.conversation(cid)).turns.filter((t) => t.dispatch === 'steer').length >= 2, id);
});

test('a queued row cycles between queue and steer, never interrupt', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'later');
  const row = view.locator('.queued-item');
  await row.waitFor();
  assert.equal(await row.getAttribute('data-dispatch'), 'queue');
  await row.locator('.queued-dispatch').click();
  await page.waitForFunction(() => document.querySelector('body > marble-conversation').shadowRoot.querySelector('.queued-item').dataset.dispatch === 'steer');
  await row.locator('.queued-dispatch').click();
  await page.waitForFunction(() => document.querySelector('body > marble-conversation').shadowRoot.querySelector('.queued-item').dataset.dispatch === 'queue');
});

test('a queued prompt is only the floating row, and joins the log when it starts', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:slow');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('.msg.me').waitFor();
  await sendFrom(view, 'waiting its turn');
  await view.locator('.queued-item').waitFor();
  // Two bubbles exist — log order is kept — but the queued one is not shown.
  assert.equal(await view.locator('.msg.me').count(), 2);
  assert.equal(await view.locator('.msg.me').nth(1).isVisible(), false);
  assert.match(await view.locator('.queued-text').textContent(), /waiting its turn/);
  // The stack floats over the foot of the log, so the log ends above it.
  const room = await view.evaluate((el) => {
    const log = el.shadowRoot.querySelector('.log');
    const queued = el.shadowRoot.querySelector('.queued');
    return {
      foot: parseFloat(getComputedStyle(log).paddingBottom),
      stack: Math.round(queued.getBoundingClientRect().height),
    };
  });
  assert.ok(room.stack > 0, 'the stack has a height');
  assert.ok(room.foot >= room.stack, `the log's foot (${room.foot}) clears the stack (${room.stack})`);
  // Once it runs it is a message like any other, and the foot comes back.
  await view.locator('.queued-item').waitFor({ state: 'detached' });
  await page.waitForFunction(() => {
    const el = document.querySelector('body > marble-conversation');
    return el.shadowRoot.querySelectorAll('.msg.me')[1]?.dataset.waiting === undefined;
  });
  assert.equal(await view.locator('.msg.me').nth(1).isVisible(), true);
  const foot = await view.evaluate((el) => parseFloat(getComputedStyle(el.shadowRoot.querySelector('.log')).paddingBottom));
  assert.ok(foot < room.foot, 'the room under the log goes with the stack');
});

test('a prompt taken out of the queue leaves no bubble behind', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:slow');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('.msg.me').waitFor();
  await sendFrom(view, 'never mind');
  await view.locator('.queued-item').waitFor();
  await view.locator('.queued-item button.dequeue').click();
  await view.locator('.queued-item').waitFor({ state: 'detached' });
  assert.equal(await view.locator('.msg.me').count(), 1);
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

test('the document is never a pill in the text, and the bar says when a selection rides along', async () => {
  const { page, view } = await mount();
  // The pane's own bar names the document; naming it again inside the prose
  // was the same fact twice, and a pill the caret had to step over.
  assert.equal(await view.locator('.editor .ichip').count(), 0);
  assert.equal(await view.locator('.selection').isVisible(), false);

  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  const pill = view.locator('.bar .selection');
  await pill.filter({ hasText: '1 selected' }).waitFor();
  // Still nothing in the text.
  assert.equal(await view.locator('.editor .ichip').count(), 0);
  await pill.locator('.selection-clear').click();
  await page.waitForFunction(() => {
    const el = document.querySelector('marble-conversation').shadowRoot.querySelector('.selection');
    return el?.hidden === true;
  });
});

test('aiming at another document does not put anything in the message', async () => {
  const { page, view } = await mount();
  await page.evaluate(() => window.marble.agent.aim('notes', { also: ['reading', 'log'] }));
  await page.waitForTimeout(200);
  // Where the turn is aimed is the pane's business, not the prose's.
  assert.equal(await view.locator('.editor .ichip').count(), 0);
  assert.equal(await view.locator('.editor').evaluate((el) => el.value), '');
});

test('shift+enter makes a new line instead of sending', async () => {
  const { view } = await mount();
  await view.locator('.editor').fill('one');
  await view.locator('.editor').press('Shift+Enter');
  await view.locator('.editor').pressSequentially('two');
  assert.equal(await view.locator('.editor').evaluate((el) => el.value), 'one\ntwo');
  assert.equal(await view.locator('.msg.me').count(), 0);
});

// Emptying the box left the browser's <br> in it, and the placeholder — an
// ::after — drew on the line under that: a card twice as tall as a line with
// the prompt at the bottom of it. A box you have emptied is a box you have
// not yet typed in.
test('a box emptied by hand is the same height as one never typed in', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  const height = () => view.locator('.field').evaluate((el) => el.getBoundingClientRect().height);
  const fresh = await height();
  await editor.click();
  await editor.pressSequentially('hello there');
  await editor.press('ControlOrMeta+a');
  await editor.press('Backspace');
  await editor.evaluate((el) => el.hasAttribute('data-empty'));
  assert.equal(await editor.innerHTML(), '', 'nothing is left in an empty box');
  assert.equal(await height(), fresh, 'the card is the height it started at');
  // And the caret is still in it: an empty box you cannot type in is worse.
  await editor.pressSequentially('again');
  assert.equal(await editor.evaluate((el) => el.value), 'again');
});

test('the drawer shows used usage for Claude and Fable', async () => {
  const { page } = await mount();
  await page.evaluate(() => window.marble.agent.open());
  const claude = page.locator('marble-agent-drawer .usage .meter[data-id="claude-subscription"]');
  const fable = page.locator('marble-agent-drawer .usage .meter[data-id="fable"]');
  await claude.waitFor();
  assert.match(await claude.textContent(), /23%/);
  assert.match(await fable.textContent(), /58%/);
  // Two sliders, the same pair as the page's topbar: Cursor is in Settings.
  assert.equal(await page.locator('marble-agent-drawer .usage .meter').count(), 2);
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

test('a question ask lists numbered options with descriptions; arrows, digits and Enter answer', async () => {
  const { view, errors } = await mount();
  await sendFrom(view, 'script:question');
  const card = view.locator('.ask[data-kind="question"]');
  await card.waitFor();
  const options = card.locator('[role="radio"]');
  assert.equal(await options.count(), 3, 'two options and Other');
  assert.equal(await options.nth(0).locator('kbd').textContent(), '1');
  assert.equal(await options.nth(0).locator('b').textContent(), 'A');
  assert.equal(await options.nth(0).locator('small').textContent(), 'the first way');
  assert.match(await options.nth(2).textContent(), /Other/);
  await options.first().focus();
  await options.first().press('ArrowDown');
  await options.nth(1).press('Enter');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await view.locator('.msg.agent', { hasText: 'answered:allow:B' }).waitFor();
  assert.deepEqual(errors, []);
});

test('Other on a question takes a typed answer', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:question');
  const card = view.locator('.ask[data-kind="question"]');
  await card.waitFor();
  await card.locator('.ask-other').click();
  const text = card.locator('.ask-other-text');
  await text.waitFor({ state: 'visible' });
  await text.fill('neither, do C');
  await text.press('Enter');
  await view.locator('.msg.agent', { hasText: 'answered:allow:neither, do C' }).waitFor();
});

test('a digit picks an option', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:question');
  const card = view.locator('.ask[data-kind="question"]');
  await card.waitFor();
  await card.locator('[role="radio"]').first().press('2');
  assert.equal(await card.locator('[role="radio"]').nth(1).getAttribute('aria-checked'), 'true');
  await card.locator('button.answer').click();
  await view.locator('.msg.agent', { hasText: 'answered:allow:B' }).waitFor();
});

test('a question asked in prose gets a picker under it, and Enter sends the keys', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:choice');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const picker = view.locator('.choice-ask');
  await picker.waitFor();
  assert.equal(await picker.getAttribute('aria-label'), 'Two ways to lay this out. Which do you want?');
  const options = picker.locator('[role="radio"]');
  assert.equal(await options.count(), 2);
  assert.equal(await options.nth(1).locator('kbd').textContent(), 'B');
  await options.first().focus();
  await options.first().press('ArrowDown');
  await options.nth(1).press(' ');
  const sent = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-conversation').addEventListener('running', (e) => { if (e.detail.turn) resolve(); }, { once: true });
  }));
  await options.nth(1).press('Enter');
  await sent;
  await view.locator('.msg.me').nth(1).waitFor();
  assert.match((await view.locator('.msg.me').nth(1).textContent()).trim(), /^B — Stacked$/);
  await view.locator('.choice-ask').waitFor({ state: 'detached' });
});

test('a new conversation is started in the picked project, and the mast names it', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-browser-repo-'));
  // Registered from the page so the request is same-origin, like the settings panel's.
  const repo = await page.evaluate((p) => window.marble.agent.addProject({ name: 'Repo', path: p }), dir);
  await view.evaluate((el) => el.fillProjects());
  await view.locator('input[name="project"][value="drive"]').waitFor({ state: 'attached' });
  assert.equal(await view.locator('input[name="project"][value="drive"]').isChecked(), true);
  await pick(view, 'project', repo.id);
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

test('a running conversation says where its hands are, and the row goes when the turn does', async () => {
  const { view, errors } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  await sendFrom(view, 'script:building');

  const row = view.locator('.zone-jump');
  await row.waitFor();
  assert.equal((await view.locator('.zone-what').textContent()).trim(), 'Building here');

  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await row.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
});

test('the row names the other document, and pressing it opens that document at the work', async () => {
  const { page, view } = await mount();
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  // Reading one document, working in another: the case the row exists for.
  await page.evaluate(() => window.marble.agent.aim('atlas'));
  await sendFrom(view, 'script:elsewhere');

  await view.locator('.zone-jump').waitFor();
  assert.equal((await view.locator('.zone-what').textContent()).trim(), 'Building in atlas');

  await view.locator('.zone-jump').click();
  await page.waitForURL(/\/a\/atlas/);
  await page.waitForFunction(() => document.documentElement.classList.contains('marble-collab-host'));
  assert.equal(await page.evaluate(() => location.hash), '', 'the hash is spent on arrival');
  // The tab arrived after the frame was broadcast, and is caught up on joining:
  // landing on the page the agent is in and seeing no box would read as broken.
  await page.locator('.marble-zone').waitFor();
  assert.match(await page.locator('.marble-zone-label').innerText(), /Agent · rename the heading/);
});

/** The same view in callout chrome: what the card at a selection holds. */
async function mountCallout() {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(() => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.dataset.chrome = 'callout';
    el.setAttribute('project', 'drive');
    el.setAttribute('data-folded', '');
    el.style.cssText = 'position:fixed;left:0;bottom:0;width:420px;';
    document.body.append(el);
  });
  return { page, errors, view: page.locator('body > marble-conversation') };
}

test('callout chrome folds the log to a ticker, unfolds on click and on an ask', async () => {
  const { page, view } = await mountCallout();
  await view.locator('.editor').waitFor();
  assert.equal(await view.locator('.editor').getAttribute('data-placeholder'), 'Ask about this…');
  assert.equal(await view.locator('.heading').isVisible(), false, 'no heading in a callout');

  await sendFrom(view, 'script:rename');
  await view.locator('.ticker:not([hidden])').waitFor();
  await page.waitForFunction(() => /\S/.test(document.querySelector('body > marble-conversation').shadowRoot.querySelector('.ticker').textContent));
  assert.equal(await view.locator('.log').isVisible(), false, 'folded: the log is hidden');

  await view.locator('.ticker').click();
  assert.equal(await view.locator('.log').isVisible(), true, 'a click unfolds');
  await view.locator('.ticker').click();
  assert.equal(await view.locator('.log').isVisible(), false, 'and folds again');

  // An ask needs an answer, so it unfolds by itself.
  await sendFrom(view, 'script:question');
  await view.locator('.ask').waitFor();
  assert.equal(await view.evaluate((el) => el.hasAttribute('data-folded')), false);
});

test('the ticker says what the log said last, and nothing outside callout chrome has one', async () => {
  const { view } = await mountCallout();
  await sendFrom(view, 'script:rename');
  await view.locator('.ticker:not([hidden])').waitFor();
  // Folded, the log's own footer is hidden with it; unfold to wait on the turn.
  await view.locator('.ticker').click();
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  // The ticker follows the log a frame behind, by design.
  await view.locator('.ticker', { hasText: 'Renamed the heading' }).waitFor();
  const line = await view.locator('.ticker').innerText();
  assert.match(line, /Renamed the heading to Backlog\. kept the questions/, 'the last thing said, on one line');
  assert.ok(!line.includes('\n'), 'one line');

  const { view: plain } = await mount();
  await sendFrom(plain, 'script:rename');
  await plain.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await plain.locator('.ticker').isVisible(), false, 'the drawer keeps its log');
});

test('the usage toggle sits with the model, and Pause asks above the box', async () => {
  const { page, view } = await mount();
  await view.locator('.failover').waitFor();
  assert.equal(await view.locator('.failover').getAttribute('data-failover'), 'auto');
  assert.equal(
    await view.evaluate((el) => el.shadowRoot.querySelector('.failover').querySelector('svg') != null),
    true,
    'a glyph, not the word Auto, which the permission modes already own',
  );
  assert.equal(
    await view.evaluate((el) => {
      const style = getComputedStyle(el.shadowRoot.querySelector('.failover'));
      return `${style.borderTopWidth} ${style.backgroundColor}`;
    }),
    '0px rgba(0, 0, 0, 0)',
    'no pill: it is as quiet as the options beside it',
  );
  assert.equal(
    await view.evaluate((el) => el.shadowRoot.querySelector('.failover').closest('.setup-row') != null),
    true,
    'the toggle lives in the setup row, which a phone moves into the sheet',
  );

  await sendFrom(view, 'script:rename');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const id = await view.getAttribute('conversation');
  await view.locator('.failover').click();
  await page.waitForFunction(async (conversation) => {
    const meta = await window.marble.agent.conversation(conversation);
    return meta.meta.failover === 'pause';
  }, id);
  assert.equal(await view.locator('.failover').getAttribute('data-failover'), 'pause');
  assert.match(
    await view.locator('.failover').getAttribute('aria-label'),
    /^Pause when Claude usage stops/,
    'the mode it is in, said out loud',
  );

  // A rest on it names the mode; moving on takes the tip away.
  await view.locator('.failover').hover();
  const tip = view.locator('.failover + .keytip');
  await tip.waitFor({ state: 'visible' });
  assert.match(await tip.innerText(), /^Pause when Claude usage runs out/);
  await view.locator('.editor').hover();
  await tip.waitFor({ state: 'hidden' });

  await view.evaluate((el, conversation) => {
    el.receive({
      type: 'turn.failed',
      usageStopped: true,
      canSwitch: true,
      turn: `${conversation}-t9`,
    });
  }, id);
  await view.locator('.usage-note').waitFor();
  const place = await view.evaluate((el) => {
    const root = el.shadowRoot;
    const note = root.querySelector('.usage-note').getBoundingClientRect();
    const editor = root.querySelector('.editor').getBoundingClientRect();
    return { note: note.bottom, editor: editor.top, text: root.querySelector('.usage-note-text').textContent };
  });
  assert.ok(place.note <= place.editor, 'the note sits above the box');
  assert.equal(place.text, 'Claude usage stopped. Switch to Cursor?');

  await view.locator('.usage-leave').click();
  await view.locator('.usage-note').waitFor({ state: 'hidden' });
  await page.waitForFunction(async (conversation) => {
    const body = await window.marble.agent.conversation(conversation);
    return body.events.some((event) => event.type === 'usage.left');
  }, id);
});
