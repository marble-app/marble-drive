import assert from 'node:assert/strict';
import test from 'node:test';

import { GARDEN, startDrive } from './harness.js';

// A real reply from the Agents panel (2026-09-22) that arrived as raw `##`
// and `| … |` text: headings, bold lead lines over bullets, and a table.
const REPLY = [
  'Picking up where I stopped. I also checked `related-work.mrbl`.',
  '',
  '## Four more differences',
  '',
  '**1. Forking copies the app and its data together.**',
  '- Remixing a Lovable project copies the code, not the data.',
  '- Copying a `.mrbl` copies both. You get the app *with* your data in it.',
  '',
  '**2. The data is tied to how it looks.**',
  '- In Marble, the data is written *as* the interface.',
  '',
  '## Questions a reviewer will ask',
  '',
  '| Question | The answer your design already suggests |',
  '|---|---|',
  '| "How do you query 500 cards?" | Derived indexes, never written back (`a | b`) |',
  '| "Isn\'t this just XSS by design?" | Yes, until capabilities are enforced |',
  '',
  'If it helps, I can draft a subsection.',
].join('\n');

const host = await startDrive({ scripts: { reply: [{ say: REPLY }] }, documents: { garden: GARDEN } });
test.after(() => host.close());

async function open() {
  await host.reset();
  const { page } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marbleAgentUI?.renderText));
  return page;
}

/** renderText's output as a tag outline: `h3 "…"`, `ul > li "…"`, … */
const outline = (page, text) => page.evaluate((src) => {
  const box = document.createElement('div');
  box.append(window.marbleAgentUI.renderText(src));
  const walk = (node, depth) => [...node.children].flatMap((el) => {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    return [`${'  '.repeat(depth)}${el.tagName.toLowerCase()}${own ? ` ${own}` : ''}`, ...walk(el, depth + 1)];
  });
  return walk(box, 0);
}, text);

test('a reply with headings and a table renders them, not their syntax', async () => {
  const page = await open();
  const view = page.locator('body > marble-conversation');
  await page.evaluate(() => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.style.cssText = 'position:fixed;right:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  });
  await view.locator('.editor').fill('script:reply');
  await view.locator('.editor').press('Enter');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const agent = view.locator('.msg.agent').last();
  assert.deepEqual(await agent.locator('.md-h').allTextContents(), ['Four more differences', 'Questions a reviewer will ask']);
  assert.doesNotMatch(await agent.textContent(), /##|\|---/);
  assert.equal(await agent.locator('table th').count(), 2);
  assert.equal(await agent.locator('table tbody tr').count(), 2);
  // A pipe inside backticks is the code's, not a column.
  assert.equal(await agent.locator('table tbody tr').first().locator('td').count(), 2);
  assert.equal(await agent.locator('table td code').first().textContent(), 'a | b');
  assert.equal(await agent.locator('ul').count(), 2);
  // The heading is weightier than the text but not a page title.
  const sizes = await agent.evaluate((el) => {
    const px = (n) => parseFloat(getComputedStyle(n).fontSize);
    return { h: px(el.querySelector('.md-h')), p: px(el.querySelector('p')) };
  });
  assert.ok(sizes.h > sizes.p && sizes.h < sizes.p * 1.3, JSON.stringify(sizes));
});

test('a numbered list survives blank lines and indented paragraphs', async () => {
  const page = await open();
  const src = [
    '1. Forking copies the app.',
    '',
    '   Remixing copies the code, not the data.',
    '2. The data is tied to how it looks.',
    '   - nested one',
    '   - nested two',
    '',
    '3. Conflicts are per element.',
  ].join('\n');
  assert.deepEqual(await outline(page, src), [
    'ol',
    '  li Forking copies the app.',
    '    p Remixing copies the code, not the data.',
    '  li The data is tied to how it looks.',
    '    ul',
    '      li nested one',
    '      li nested two',
    '  li Conflicts are per element.',
  ]);
});

test('a list that starts past one keeps its number', async () => {
  const page = await open();
  const start = await page.evaluate(() => {
    const box = document.createElement('div');
    box.append(window.marbleAgentUI.renderText('3. third\n4. fourth'));
    return box.querySelector('ol').start;
  });
  assert.equal(start, 3);
});

test('quotes, rules, strike and nested marks', async () => {
  const page = await open();
  assert.deepEqual(await outline(page, '> quoted **with `code`**\n> still quoted\n\n---\n\n~~gone~~ and * * *'), [
    'blockquote',
    '  p quoted still quoted',
    '    strong with',
    '      code code',
    '    br',
    'hr',
    'p and * * *',
    '  del gone',
  ]);
  assert.deepEqual(await outline(page, '* * *'), ['hr']);
});

test('a lone pipe in prose is not a table, and hostile text stays text', async () => {
  const page = await open();
  assert.deepEqual(await outline(page, 'a | b\nc'), ['p a | bc', '  br']);
  const html = await page.evaluate(() => {
    const box = document.createElement('div');
    box.append(window.marbleAgentUI.renderText('## <img src=x onerror="window.__pwned=1">\n\n| <b>x</b> | y |\n|---|---|\n| [bad](javascript:1) | z |'));
    return { img: box.querySelectorAll('img, b').length, links: box.querySelectorAll('a').length };
  });
  assert.deepEqual(html, { img: 0, links: 0 });
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

// Nested marks recurse into inlineMarks. With one shared /g regex the inner
// call reset lastIndex to 0 and the outer loop re-found the same `**…**`
// forever: any reply with bold in it froze the tab and ate memory.
test('bold, italic and links with marks inside them finish rendering', { timeout: 20000 }, async () => {
  const page = await open();
  const line = '**What\'s new:** **Writing Screens** (`Research/`), and *a `b`* and [**c**](https://x.org) and ~~*d*~~ end';
  const run = outline(page, line);
  const hung = new Promise((resolve) => setTimeout(() => resolve('hung'), 5000));
  assert.deepEqual(await Promise.race([run, hung]), [
    'p (), and  and  and  end',
    '  strong What\'s new:',
    '  strong Writing Screens',
    '  code Research/',
    '  em a',
    '    code b',
    '  a',
    '    strong c',
    '  del',
    '    em d',
  ]);
});
