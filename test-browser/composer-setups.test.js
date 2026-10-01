// The saved-setup control in the composer: one word that has to name the
// setup this conversation will actually run as. It is packed at every width,
// so the word is the only thing telling you which model you are on.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const host = await startDrive({ documents: { garden: GARDEN } });
test.after(() => host.close());

// The real provider list's shape, with the two agents the setups name.
const PROVIDERS = [
  {
    id: 'claude-subscription',
    label: 'Claude',
    installed: true,
    signedIn: true,
    detail: 'signed in',
    defaultModel: null,
    models: [
      { id: 'haiku', label: 'Haiku 4.5' },
      { id: 'sonnet', label: 'Sonnet 5' },
      { id: 'opus', label: 'Opus 5.5' },
      { id: 'fable', label: 'Fable 5.1' },
    ],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    modes: [{ id: 'auto', label: 'Auto' }, { id: 'plan', label: 'Plan' }],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    installed: true,
    signedIn: true,
    detail: 'signed in',
    defaultModel: null,
    models: [{ id: 'auto', label: 'Cursor models' }, { id: 'grok-4.7', label: 'Grok 4.7' }],
    efforts: [],
    modes: [{ id: 'agent', label: 'Run Everything' }],
  },
  {
    id: 'codex',
    label: 'Codex',
    installed: true,
    signedIn: true,
    detail: 'signed in with ChatGPT',
    defaultModel: null,
    // Codex's catalog: each model with its own efforts, first is its default.
    models: [
      { id: 'gpt-6-astra', label: 'GPT-6-Astra', hasBare: true, efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map((id) => ({ id, label: id })) },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', hasBare: true, efforts: ['low', 'medium', 'high'].map((id) => ({ id, label: id })) },
    ],
    efforts: ['low', 'medium', 'high', 'xhigh'],
    modes: [{ id: 'full', label: 'Full access' }, { id: 'workspace', label: 'Workspace' }, { id: 'read', label: 'Read only' }],
  },
];

/** A bare composer with the real setups available: the drive's own fake agent
 *  is not one of them, so the providers call is answered here instead. `meta`
 *  opens the composer on a started conversation carrying that setup. */
async function mount({ meta = null } = {}) {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(([providers, meta]) => {
    window.marble.agent = {
      ...window.marble.agent,
      providers: async () => providers,
      ...(meta ? { conversation: async (id) => ({ meta: { id, title: 'Setups', ...meta }, messages: [] }) } : {}),
    };
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    if (meta) el.setAttribute('conversation', 'aaaaaaaaaaaa');
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  }, [PROVIDERS, meta]);
  const view = page.locator('body > marble-conversation');
  await view.locator('input[name="preset"][value="opus-high"]').waitFor({ state: 'attached' });
  return { page, errors, view };
}

/** What the packed control says out loud, with the brand mark stripped. */
const setupWord = (view) => view.evaluate((el) =>
  el.shadowRoot.querySelector('.presets-more')?.textContent?.trim() ?? '');

const pick = (view, name, value) => view.evaluate((el, [n, v]) => {
  el.shadowRoot.querySelector(`input[name="${n}"][value="${v}"]`).click();
}, [name, value]);

const settled = (view) => view.evaluate((el) => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)));
}));

test('the setup word follows the setup you pick', async () => {
  const { view, errors } = await mount();
  await pick(view, 'preset', 'opus-high');
  await settled(view);
  assert.equal(await setupWord(view), 'Opus 5.5 High');
  await pick(view, 'preset', 'fable-high');
  await settled(view);
  assert.equal(await setupWord(view), 'Fable 5.1 High');
  assert.deepEqual(errors, []);
});

test('a model tuned off a setup is still named by its own model', async () => {
  const { view, errors } = await mount();
  await pick(view, 'preset', 'opus-high');
  await settled(view);
  // The second axis: Opus at Max is no saved setup, but it is very much not
  // Sonnet, and the one word on screen may not say it is.
  await pick(view, 'effort', 'max');
  await settled(view);
  const word = await setupWord(view);
  assert.ok(!/Sonnet/.test(word), `the setup word says "${word}" while the model is Opus`);
  assert.match(word, /Opus/);
  // And it is the same word, not a bigger one: a setup nobody saved wears the
  // chip's own node so it reads at the chip's size and carries its brand mark.
  const worn = await view.evaluate((el) => {
    const span = el.shadowRoot.querySelector('.presets-more > span');
    return { size: span && getComputedStyle(span).fontSize, brand: Boolean(span?.querySelector('.brand')) };
  });
  assert.equal(worn.size, '11px');
  assert.equal(worn.brand, true);
  assert.deepEqual(errors, []);
});

test('a conversation opens on the setup it was started with', async () => {
  const { view, errors } = await mount({ meta: { provider: 'claude-subscription', model: 'opus', effort: 'high' } });
  await settled(view);
  assert.equal(await setupWord(view), 'Opus 5.5 High');
  assert.deepEqual(errors, []);
});

test('a conversation opened off a saved setup still names its model', async () => {
  const { view, errors } = await mount({ meta: { provider: 'claude-subscription', model: 'opus', effort: 'xhigh' } });
  await settled(view);
  const word = await setupWord(view);
  assert.ok(!/Sonnet/.test(word), `the setup word says "${word}" while the conversation runs Opus`);
  assert.match(word, /Opus/);
  assert.deepEqual(errors, []);
});

test('a model chosen in the custom picker is named by the setup word', async () => {
  const { view, errors } = await mount();
  await pick(view, 'preset', 'opus-high');
  await settled(view);
  await pick(view, 'model', 'haiku');
  await settled(view);
  const word = await setupWord(view);
  assert.ok(!/Sonnet|Opus/.test(word), `the setup word says "${word}" while the model is Haiku`);
  assert.match(word, /Haiku/);
  assert.deepEqual(errors, []);
});

test('a signed-in Codex adds its setup, named from its own catalog and wearing its mark', async () => {
  const { view, errors } = await mount();
  const setup = await view.evaluate((el) => {
    const label = el.shadowRoot.querySelector('input[name="preset"][value="codex-high"]')?.closest('label');
    return label ? { text: label.textContent.trim(), brand: Boolean(label.querySelector('svg.brand')) } : null;
  });
  assert.ok(setup, 'Codex has a saved setup');
  assert.equal(setup.text, 'GPT-6-Astra High');
  assert.equal(setup.brand, true);
  await pick(view, 'preset', 'codex-high');
  await settled(view);
  assert.equal(await setupWord(view), 'GPT-6-Astra High');
  assert.deepEqual(await view.evaluate((el) => [
    el.shadowRoot.querySelector('input[name="agent"]:checked')?.value,
    el.shadowRoot.querySelector('input[name="model"]:checked')?.value,
    el.shadowRoot.querySelector('input[name="effort"]:checked')?.value,
  ]), ['codex', 'gpt-6-astra', 'high']);
  assert.deepEqual(errors, []);
});

test('Codex at an effort only it has is named by its own model and that effort', async () => {
  const { view, errors } = await mount();
  await pick(view, 'preset', 'codex-high');
  await settled(view);
  await pick(view, 'effort', 'ultra');
  await settled(view);
  assert.equal(await setupWord(view), 'GPT-6-Astra Ultra');
  assert.deepEqual(errors, []);
});

test('a conversation on Codex opens on its setup', async () => {
  const { view, errors } = await mount({ meta: { provider: 'codex', model: 'gpt-6-astra', effort: 'high' } });
  await settled(view);
  assert.equal(await setupWord(view), 'GPT-6-Astra High');
  assert.deepEqual(errors, []);
});
