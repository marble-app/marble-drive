// Visuals in the transcript, in a real browser: the card, the sandbox around
// it, the palette inside it, the width it answers to, and the click that
// becomes the next message.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

const OPTIONS = `Two ways to lay out the card.

\`\`\`marble-visual Two layouts
<div class="two">
  <button class="pick" aria-pressed="false" data-answer="Side by side"><b>Side by side</b><span class="meta">Two columns, the picture leading.</span></button>
  <button class="pick" aria-pressed="false" data-answer="Stacked"><b>Stacked</b><span class="meta">One column, the words leading.</span></button>
</div>
<style>
  .two { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
  @media (max-width: 420px) { .two { grid-template-columns: 1fr; } }
</style>
\`\`\`

Pick one and I will build it.`;

const WIDGET = `How much of the page should it take?

\`\`\`marble-visual How wide
<label class="row"><span class="label">Width</span><input id="w" type="range" min="1" max="3" value="2"></label>
<p class="meta">Chosen: <b id="said">half</b></p>
<button class="send" id="go">Use this</button>
<script>
  const words = { 1: 'a third', 2: 'half', 3: 'the whole width' };
  const w = document.getElementById('w');
  const said = document.getElementById('said');
  w.addEventListener('input', () => {
    said.textContent = words[w.value];
    marble.draft('Make it ' + words[w.value] + ' of the page.');
  });
  document.getElementById('go').addEventListener('click', () => {
    marble.answer('Make it ' + words[w.value] + ' of the page.');
  });
<\/script>
\`\`\``;

// Everything a visual might try on the page it is drawn in. It must fail, and
// it must fail quietly enough that nothing ends up in the console.
const HOSTILE = `Here.

\`\`\`marble-visual Nosy
<p id="report">trying</p>
<script>
  const tried = [];
  try { parent.document.title = 'taken'; } catch (err) { tried.push('document'); }
  try { parent.window.__pwned = 1; } catch (err) { tried.push('window'); }
  try { top.location = 'https://example.com'; } catch (err) { tried.push('location'); }
  try { localStorage.setItem('x', '1'); } catch (err) { tried.push('storage'); }
  document.getElementById('report').textContent = tried.join(',');
<\/script>
\`\`\``;

const TALL = `Long.

\`\`\`marble-visual A long one
<div style="height: 1400px; background: var(--paper-2); border-radius: 8px"></div>
\`\`\``;

const half = OPTIONS.length - 60;

const SCRIPTS = {
  options: [{ say: OPTIONS }],
  widget: [{ say: WIDGET }],
  hostile: [{ say: HOSTILE }],
  tall: [{ say: TALL }],
  // The same message, arriving in pieces, cut in the middle of the visual.
  stream: [{ stream: [OPTIONS.slice(0, 40), OPTIONS.slice(40, half)], every: 120 }, { sleep: 700 }, { say: OPTIONS }],
  code: [{ say: 'A diagram.\n\n```marble-visual Shape\n<svg viewBox="0 0 100 20"><rect x="1" y="1" width="98" height="18" rx="4" fill="none" stroke="var(--accent-ink)"/></svg>\n```' }],
  // A fence that is not a visual stays a code block.
  plain: [{ say: 'Run it:\n\n```bash\nnpm test\n```' }],
  // Two in one message: each card has to answer for itself.
  both: [{ say: `Before:\n\n\`\`\`marble-visual Now\n<p id="which">now</p><button class="send" data-answer="Keep what it does now.">Keep this</button>\n\`\`\`\n\nAfter:\n\n\`\`\`marble-visual Proposed\n<p id="which">proposed</p><button class="send" data-answer="Use the proposed one.">Use this</button>\n\`\`\`\n\nWhich?` }],
};

const host = await startDrive({ scripts: SCRIPTS, documents: { garden: GARDEN } });
test.after(() => host.close());

async function mount({ width = 900, chrome = null } = {}) {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate(([w, kind]) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    if (kind) el.dataset.chrome = kind;
    el.style.cssText = `position:fixed;right:0;top:0;width:${w}px;height:100vh;`;
    document.body.append(el);
  }, [width, chrome]);
  return { page, errors, view: page.locator('body > marble-conversation') };
}

const sendFrom = async (view, text) => {
  await view.locator('.editor').fill(text);
  await view.locator('.editor').press('Enter');
};

const frameOf = (page) => page.frameLocator('body > marble-conversation iframe.visual-frame');

/** Poll a page fact until it is what we are waiting for, then return it. */
const poll = async (read, want, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value === want || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
};

const frameHeight = (view) => view.locator('.visual-frame').evaluate((el) => el.clientHeight);

test('a marble-visual block becomes a sandboxed card, and the prose around it is still prose', async () => {
  const { page, view, errors } = await mount();
  await sendFrom(view, 'script:options');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();

  const card = view.locator('.visual');
  await card.waitFor();
  assert.equal(await card.getAttribute('aria-label'), 'Two layouts');
  assert.equal(await view.locator('.visual-title').textContent(), 'Two layouts');

  const frame = view.locator('.visual-frame');
  // allow-scripts and nothing else. allow-same-origin here would hand the
  // drive's own origin to whatever the agent wrote.
  assert.equal(await frame.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(await frame.getAttribute('title'), 'Two layouts');

  // The markup is in the frame, never in the log.
  const message = view.locator('.msg.agent').last();
  const said = await message.innerText();
  assert.equal(said.includes('<button'), false);
  assert.equal(said.includes('data-answer'), false);
  assert.match(said, /Two ways to lay out the card\./);
  assert.match(said, /Pick one and I will build it\./);
  assert.equal(await message.locator('button.pick').count(), 0);

  assert.equal(await frameOf(page).locator('.pick').count(), 2);
  assert.deepEqual(errors, []);
});

test('the frame wears the page palette, and takes a new one without reloading', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:options');
  await view.locator('.visual-frame').waitFor();
  const pick = frameOf(page).locator('.pick').first();
  const readAccent = () => pick.evaluate((el) => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());

  const chrome = await view.evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim());
  assert.equal(await poll(readAccent, chrome), chrome);
  // And it is really being used: the option's text is the ink token.
  const ink = await view.evaluate((el) => getComputedStyle(el).getPropertyValue('--ink').trim());
  assert.equal(await pick.evaluate((el) => getComputedStyle(el).color), await page.evaluate((v) => {
    const probe = document.createElement('span');
    probe.style.color = v;
    document.body.append(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, ink));

  // The document changes colour; the frame is told, and nothing reloads.
  const before = await pick.evaluate(() => performance.now());
  await page.evaluate(() => document.documentElement.style.setProperty('--accent', 'rgb(1, 2, 3)'));
  assert.equal(await poll(readAccent, 'rgb(1, 2, 3)'), 'rgb(1, 2, 3)');
  assert.equal(await pick.evaluate((el, was) => performance.now() > was, before), true);
});

test('the card sizes itself to its content, and answers to its own width', async () => {
  const { page, view } = await mount({ width: 900 });
  await sendFrom(view, 'script:options');
  await view.locator('.visual-frame').waitFor();

  const columns = () => frameOf(page).locator('.two').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(await poll(columns, 2), 2);

  // Grown to exactly its content, not left at the placeholder's height.
  const fit = await frameOf(page).locator('.marble-fit').evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
  assert.equal(fit > 60, true, `content measured ${fit}px`);
  assert.equal(await poll(() => frameHeight(view), fit), fit);

  // A frame is its own viewport: the card's width is what the media query
  // reads, not the window's.
  await view.evaluate((el) => { el.style.width = '380px'; });
  assert.equal(await poll(columns, 1), 1);
  await view.evaluate((el) => { el.style.width = '900px'; });
  assert.equal(await poll(columns, 2), 2);
});

test('an option in a visual is the next message', async () => {
  const { page, view, errors } = await mount();
  await sendFrom(view, 'script:options');
  await view.locator('.visual-frame').waitFor();
  await view.locator('.turn-footer[data-status="completed"]').waitFor();

  const stacked = frameOf(page).locator('.pick', { hasText: 'Stacked' });
  await stacked.click();

  await view.locator('.msg.me').nth(1).waitFor();
  assert.equal((await view.locator('.msg.me').nth(1).textContent()).trim(), 'Stacked');
  // The card says it has been spent, and the frame knows too.
  await view.locator('.visual-sent').waitFor({ state: 'visible' });
  assert.equal(await stacked.getAttribute('aria-pressed'), 'true');
  assert.equal(await frameOf(page).locator('.pick').first().getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []);
});

test('a widget can draft into the composer before it answers', async () => {
  const { page, view, errors } = await mount();
  await sendFrom(view, 'script:widget');
  await view.locator('.visual-frame').waitFor();
  await view.locator('.turn-footer[data-status="completed"]').waitFor();

  const slider = frameOf(page).locator('#w');
  await slider.fill('3');
  const typed = () => view.locator('.editor').textContent();
  assert.equal(await poll(typed, 'Make it the whole width of the page.'), 'Make it the whole width of the page.');
  // Drafting is not sending: one message from me so far.
  assert.equal(await view.locator('.msg.me').count(), 1);

  await frameOf(page).locator('#go').click();
  await view.locator('.msg.me').nth(1).waitFor();
  assert.equal((await view.locator('.msg.me').nth(1).textContent()).trim(), 'Make it the whole width of the page.');
  assert.deepEqual(errors, []);
});

test('a visual cannot reach the page it is drawn in', async () => {
  const { page, view, errors } = await mount();
  await sendFrom(view, 'script:hostile');
  await view.locator('.visual-frame').waitFor();

  const report = frameOf(page).locator('#report');
  assert.equal(await poll(() => report.textContent(), 'document,window,location,storage'), 'document,window,location,storage');
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.title(), 'Garden');
  assert.match(page.url(), /\/a\/garden$/);
  // Nothing the frame did reached the page's own script surface.
  assert.equal(await view.evaluate((el) => el.shadowRoot.querySelectorAll('script').length), 0);
  // The one thing in the console is the browser saying no to the navigation,
  // which is the sandbox working rather than the page breaking.
  assert.equal(errors.every((line) => /Unsafe attempt to initiate navigation/.test(line)), true, errors.join('\n'));
});

test('the markup behind a visual is one press away', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:code');
  await view.locator('.visual-frame').waitFor();

  const code = view.locator('.visual-code');
  assert.equal(await code.isVisible(), false);
  await view.locator('.visual-act', { hasText: 'Code' }).click();
  assert.equal(await code.isVisible(), true);
  assert.match(await code.textContent(), /<svg viewBox="0 0 100 20">/);
  await view.locator('.visual-act', { hasText: 'Code' }).click();
  assert.equal(await code.isVisible(), false);
});

test('Expand is offered only when there is more to see', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:tall');
  await view.locator('.visual-frame').waitFor();

  const expand = view.locator('.visual-act', { hasText: /Expand|Collapse/ });
  await expand.waitFor({ state: 'visible' });
  // A 1400px visual in an 800px window: 70vh at rest, 85vh expanded.
  assert.equal(await poll(() => frameHeight(view), 560), 560);
  await expand.click();
  assert.equal(await poll(() => frameHeight(view), 680), 680);
  assert.equal(await expand.textContent(), 'Collapse');
  await expand.click();
  assert.equal(await poll(() => frameHeight(view), 560), 560);
  assert.equal(await expand.textContent(), 'Expand');
});

test('a short visual is not asked to expand', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:code');
  await view.locator('.visual-frame').waitFor();
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await poll(() => view.locator('.visual-act', { hasText: 'Expand' }).isVisible(), false), false);
});

test('a half-written visual is never shown as markup', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:stream');
  // Mid-stream: the words are there, the markup is not, and a card is coming.
  await view.locator('.msg.agent.live').waitFor();
  await view.locator('.msg.agent.live .visual-pending').waitFor();
  const live = await view.locator('.msg.agent.live').textContent();
  assert.match(live, /Two ways to lay out the card\./);
  assert.equal(live.includes('<button'), false);
  assert.equal(live.includes('class="pick"'), false);

  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  await view.locator('.visual-frame').waitFor();
  assert.equal(await view.locator('.visual-pending').count(), 0);
});

test('a reload draws the visual again from the transcript', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:options');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const id = await view.getAttribute('conversation');

  await page.reload();
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate((conversation) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.setAttribute('conversation', conversation);
    el.style.cssText = 'position:fixed;right:0;top:0;width:900px;height:100vh;';
    document.body.append(el);
  }, id);
  const after = page.locator('body > marble-conversation');
  await after.locator('.visual-frame').waitFor();
  assert.equal(await after.locator('.visual-frame').getAttribute('sandbox'), 'allow-scripts');
  assert.equal(await page.frameLocator('body > marble-conversation iframe.visual-frame').locator('.pick').count(), 2);
});

test('an ordinary fenced block is still a code block', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:plain');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.visual').count(), 0);
  assert.match(await view.locator('.msg.agent pre').last().textContent(), /npm test/);
});

test('a visual reads at the size the transcript around it reads at', async () => {
  const { page, view } = await mount({ width: 420, chrome: 'phone' });
  await sendFrom(view, 'script:options');
  await view.locator('.visual-frame').waitFor();
  const size = () => frameOf(page).locator('.marble-fit').evaluate((el) => getComputedStyle(el).fontSize);
  // The phone transcript is 17px, so the card is not a picture of a smaller app.
  assert.equal(await poll(size, '17px'), '17px');
});

test('the caption and its buttons are not what the callout says was said', async () => {
  const { view } = await mount({ width: 420, chrome: 'callout' });
  await sendFrom(view, 'script:options');
  await view.locator('.visual-frame').waitFor();
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const whole = 'Two ways to lay out the card. Pick one and I will build it.';
  const said = await poll(() => view.locator('.ticker').textContent(), whole);
  // The words on both sides of the visual, and nothing the card itself wears.
  assert.equal(said, whole);
});

test('a host that cannot serve the module shows the markup instead of a shimmer', async () => {
  const { page, view } = await mount();
  await page.route('**/runtime/chat-visual.js', (route) => route.abort());
  await sendFrom(view, 'script:options');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const card = view.locator('.visual');
  await card.locator('pre').waitFor();
  assert.match(await card.locator('pre').textContent(), /class="pick"/);
  assert.equal(await poll(() => view.locator('.visual-pending').count(), 0), 0);
  assert.equal(await view.locator('.visual-frame').count(), 0);
});

test('two visuals in one message each answer for themselves', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:both');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.visual').count(), 2);
  assert.deepEqual(await view.locator('.visual-title').allTextContents(), ['Now', 'Proposed']);

  const second = page.frameLocator('body > marble-conversation .visual:nth-of-type(2) iframe');
  assert.equal(await second.locator('#which').textContent(), 'proposed');
  await second.locator('button').click();
  await view.locator('.msg.me').nth(1).waitFor();
  assert.equal((await view.locator('.msg.me').nth(1).textContent()).trim(), 'Use the proposed one.');
  // The card that was not pressed does not claim to have been.
  const sent = await view.locator('.visual-sent').evaluateAll((els) => els.map((el) => !el.hidden));
  assert.deepEqual(sent, [false, true]);
});
