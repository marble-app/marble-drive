#!/usr/bin/env node
// The seeing loop for visuals in the chat. Renders the skill's own recipes in a
// real conversation — drawer width and pane width, light and dark — and writes
// a PNG per shot to test-results/visuals/.
//
//   node tools/visual-shots.mjs            # all four recipes, four ways
//   node tools/visual-shots.mjs options    # one recipe
//
// The recipes here and the ones in .claude/skills/visuals-in-chat/recipes.md
// are the same text. If you change one, change the other: this is what says
// the documented recipe is the one that renders.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GARDEN, startDrive } from '../test-browser/harness.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(REPO, 'test-results', 'visuals');

const RECIPES = await (async () => {
  const file = path.join(REPO, '.claude', 'skills', 'visuals-in-chat', 'recipes.md');
  const text = await fsp.readFile(file, 'utf8');
  const out = {};
  // Every ```marble-visual block in the recipes, named by the heading above it.
  const parts = text.split(/^## /m).slice(1);
  for (const part of parts) {
    const name = part.split('\n')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const block = /^```marble-visual(.*)\n([\s\S]*?)\n```$/m.exec(part);
    if (block) out[name] = `\`\`\`marble-visual${block[1]}\n${block[2]}\n\`\`\``;
  }
  return out;
})();

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RECIPES);
const scripts = Object.fromEntries(
  Object.entries(RECIPES).map(([name, block]) => [name, [{ say: `${headline(name)}\n\n${block}\n\nSay which, or tell me what is missing.` }]]),
);

function headline(name) {
  return `Here is what I have in mind for ${name.replace(/-/g, ' ')}.`;
}

await fsp.mkdir(OUT, { recursive: true });
const host = await startDrive({ scripts, documents: { garden: GARDEN } });
const sizes = [{ id: 'drawer', width: 380 }, { id: 'pane', width: 900 }];
const schemes = ['light', 'dark'];

for (const name of names) {
  if (!scripts[name]) {
    console.error(`no recipe "${name}" — there is: ${Object.keys(RECIPES).join(', ')}`);
    continue;
  }
  for (const scheme of schemes) {
    for (const size of sizes) {
      const { page, errors } = await host.newPage({ colorScheme: scheme, viewport: { width: Math.max(1000, size.width + 120), height: 900 } });
      await page.goto(`${host.base}/a/garden`);
      await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
      await page.evaluate((w) => {
        const el = document.createElement('marble-conversation');
        el.setAttribute('data-marble-transient', '');
        el.style.cssText = `position:fixed;right:0;top:0;width:${w}px;height:100vh;`;
        document.body.append(el);
      }, size.width);
      const view = page.locator('body > marble-conversation');
      await view.locator('.editor').fill(`script:${name}`);
      await view.locator('.editor').press('Enter');
      await view.locator('.visual-frame').waitFor();
      await view.locator('.turn-footer[data-status="completed"]').waitFor();
      await page.waitForTimeout(700);
      const file = path.join(OUT, `${name}-${scheme}-${size.id}.png`);
      await view.screenshot({ path: file });
      const height = await view.locator('.visual-frame').evaluate((el) => el.clientHeight);
      console.log(`${path.relative(REPO, file)}  ${height}px${errors.length ? `  ⚠ ${errors.join(' | ')}` : ''}`);
      await page.close();
    }
  }
}

await host.close();
