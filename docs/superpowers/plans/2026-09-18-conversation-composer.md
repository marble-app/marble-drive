# Conversation Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the conversation's textarea with an editor that holds pasted things and the document chip inline and turns `- ` into a list; shrink the composer to one bar; fold tool runs; make asks and prose questions answerable in place; and give the queue its dispatch modes and batch switch.

**Architecture:** Everything is inside `<marble-conversation>` in `runtime/agent-ui.js` (an IIFE, classic script, open shadow root). The editor is a `contenteditable` div with a `value` accessor so the rest of the class keeps reading `this.input.value`. The queue's server half (`dispatch`, `behind`, `bundle`, `combined`, `queueCombine`, `patchQueued`, `user.edited`, `turn.dispatch`, `turn.combined`, `agent.send({ dispatch })`, `agent.patchTurn`) and `runtime/choice-question.js` are already on branch `conversation-composer`; this plan builds only the UI.

**Tech Stack:** Node 22 ESM server, classic-script runtime, `node:test` + Playwright (`test-browser/harness.js`, fake provider). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-conversation-composer-design.md`

## Global Constraints

- Work in `.claude/worktrees/conversation-composer` on branch `conversation-composer`. Do not edit `templates/agents.mrbl`, `runtime/agent-folders.js`, the event `switch` in `receive()`, the `window.marbleAgentUI = …` export line, or the four CSS rules right after `.msg.me` — other sessions own those.
- Node 22: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH`.
- Browser tests: `PATH=… node --test --test-concurrency=1 test-browser/<file>.test.js`. Node tests: `node --test test/<file>.test.js`.
- No new npm dependencies. Same UIST warm / Dusk tokens (`--ink --muted --faint --line --paper --paper-2 --paper-3 --card --accent --accent-soft --accent-ink --danger --caution`).
- Agent text is never `innerHTML`. Chips and cards are built with `h()` and `textContent`.
- Keep class names tests wait on: `.queued`, `.queued-item`, `button.dequeue`, `.tool`, `.msg.me`, `.msg.agent`, `.ask[data-kind]`, `[role="radio"]`, `button.allow`, `button.answer`, `.context-text`, `.context-clear`, `.turn-footer`, `.presets`, `.picker`, `.seg-opts`, `input[name="agent"|"model"|"effort"|"project"]`.
- Code style: two-space indent, single quotes, comments that say why. Prefer small helper functions at the IIFE's top level over long methods.
- TDD: failing test first, watch it fail, then implement. Commit per task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

| file | responsibility |
|---|---|
| `runtime/agent-ui.js` — editor helpers (new block after `// ---- pasted attachments`) | `serializeEditor`, `fillEditor`, `caretLine`, `placeCaret`, list keys |
| `runtime/agent-ui.js` — `MarbleConversation` | markup, chips, context chip, bar, tools, asks, queue |
| `runtime/agent-ui.js` — top-level helpers | `toolLabel`, `toolSource`, `collapseToolRows`, `groupLabel` |
| `runtime/choice-question.js` | already built; imported at runtime |
| `test/fixtures/fake-agent.mjs` | `tool` step (raw call + result, no bridge) |
| `test-browser/composer-editor.test.js` | new: editor behaviour |
| `test-browser/composer-attachments.test.js` | chips inline |
| `test-browser/conversation.test.js` | bar, tiles, tools, asks, queue |
| `test-browser/drawer.test.js`, `test-browser/drive-aim.test.js` | `textarea` → `.editor` |

---

### Task 1: The editor replaces the textarea

**Files:**
- Modify: `runtime/agent-ui.js` (markup at the `<textarea rows="1"…>` line; constructor; `autosize`; new helpers)
- Modify: `test-browser/conversation.test.js`, `test-browser/drawer.test.js`, `test-browser/drive-aim.test.js`, `test-browser/composer-attachments.test.js` (`locator('textarea')` → `locator('.editor')`)
- Create: `test-browser/composer-editor.test.js`

**Interfaces:**
- Produces: `div.editor[contenteditable]` with `value` get/set; module helpers `serializeEditor(root)`, `fillEditor(root, text)`, `caretLine(root)`, `placeCaret(node, offset)`; `this.input` is the editor; `this.setValue(text)` (Task 2 extends it).

- [ ] **Step 1: Write the failing tests**

Create `test-browser/composer-editor.test.js`:

```js
// The box you type into: a list when you ask for one, and a value that reads
// back as the Markdown the agent will get.

import assert from 'node:assert/strict';
import test from 'node:test';

import { startDrive } from './harness.js';

const host = await startDrive({ scripts: { note: [{ say: 'seen' }] } });
test.after(() => host.close());

export async function mount(id = null) {
  await host.reset();
  const { page, errors } = await host.newPage();
  await page.goto(`${host.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && customElements.get('marble-conversation')));
  await page.evaluate((conversation) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    if (conversation) el.setAttribute('conversation', conversation);
    el.style.cssText = 'position:fixed;right:0;top:0;width:460px;height:100vh;';
    document.body.append(el);
  }, id);
  const view = page.locator('body > marble-conversation');
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  return { page, errors, view };
}

const valueOf = (view) => view.locator('.editor').evaluate((el) => el.value);

test('the editor is a contenteditable box with the old placeholder', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  assert.equal(await editor.getAttribute('contenteditable'), 'true');
  assert.equal(await editor.getAttribute('role'), 'textbox');
  assert.equal(await view.locator('textarea').count(), 0);
  assert.equal(await editor.getAttribute('data-placeholder'), 'Ask about this document…');
});

test('dash space starts a bullet list, and Shift+Enter continues it', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('- first');
  assert.equal(await editor.locator('ul > li').count(), 1);
  await editor.press('Shift+Enter');
  await editor.pressSequentially('second');
  assert.equal(await editor.locator('ul > li').count(), 2);
  assert.equal(await valueOf(view), '- first\n- second');
});

test('Shift+Enter on an empty item leaves the list; Backspace on an empty first item undoes it', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('- one');
  await editor.press('Shift+Enter');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('after');
  assert.equal(await editor.locator('li').count(), 1);
  assert.equal(await valueOf(view), '- one\nafter');

  await editor.fill('');
  await editor.pressSequentially('- ');
  assert.equal(await editor.locator('li').count(), 1);
  await editor.press('Backspace');
  assert.equal(await editor.locator('li').count(), 0);
  assert.equal(await valueOf(view), '');
});

test('1. space starts a numbered list', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('1. alpha');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('beta');
  assert.equal(await editor.locator('ol > li').count(), 2);
  assert.equal(await valueOf(view), '1. alpha\n2. beta');
});

test('Shift+Enter outside a list is a newline, and value round-trips lists', async () => {
  const { view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('a');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('b');
  assert.equal(await valueOf(view), 'a\nb');
  await editor.evaluate((el) => { el.value = 'x\n- p\n- q\ny'; });
  assert.equal(await editor.locator('ul > li').count(), 2);
  assert.equal(await valueOf(view), 'x\n- p\n- q\ny');
});

test('a sent list arrives as Markdown and reads back as a list', async () => {
  const { page, view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('script:note');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('- do this');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('then that');
  const started = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true });
  }));
  await editor.press('Enter');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const turns = await host.drive.agents.store.turns(id);
  assert.match(turns[0].prompt, /^script:note\n- do this\n- then that/);
  assert.equal(await view.locator('.msg.me li').count(), 2);
  assert.equal(await valueOf(view), '');
});
```

In `test-browser/conversation.test.js`, `drawer.test.js`, `drive-aim.test.js` and `composer-attachments.test.js` replace every `locator('textarea')` with `locator('.editor')`, and in `composer-attachments.test.js` replace `shadowRoot.querySelector('textarea')` with `shadowRoot.querySelector('.editor')` and `await view.locator('textarea').inputValue()` with `await view.locator('.editor').evaluate((el) => el.value)`.

- [ ] **Step 2: Run the new test and watch it fail**

Run: `PATH=/Users/bryanmin/.nvm/versions/node/v22.22.0/bin:$PATH node --test --test-concurrency=1 test-browser/composer-editor.test.js`

Expected: FAIL — `.editor` is not found (timeout waiting for locator).

- [ ] **Step 3: Editor helpers**

In `runtime/agent-ui.js`, after the `SEND_ICON` / `STOP_ICON` constants and before `class MarbleConversation`, add:

```js
  // ------------------------------------------------------------ the editor

  // A contenteditable box whose value is the Markdown the agent will read:
  // lines, `- item` lists, and a token for each chip. The DOM is kept to text
  // nodes, <br>, <ul>/<ol>/<li> and .ichip spans; a browser or a paste may add
  // a <div>, which reads as a line.
  const LIST_LINE = /^(?:([-*])|(\d+)\.) (.*)$/;

  function serializeEditor(root) {
    let chips = 0;
    const out = [];
    const endsLine = () => !out.length || out.at(-1).endsWith('\n');
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out.push(child.data.replace(/ /g, ' '));
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = child.tagName;
        if (tag === 'BR') { out.push('\n'); continue; }
        if (child.classList.contains('ichip')) {
          const kind = child.dataset.kind;
          if (kind === 'image') out.push(`[image ${(chips += 1)}]`);
          else if (kind === 'text') out.push(`[pasted text ${(chips += 1)}]`);
          continue;
        }
        if (tag === 'UL' || tag === 'OL') {
          if (!endsLine()) out.push('\n');
          let n = 0;
          for (const item of child.children) {
            if (item.tagName !== 'LI') continue;
            n += 1;
            const from = out.length;
            walk(item);
            const inner = out.splice(from).join('').replace(/\n+$/, '');
            out.push(`${tag === 'UL' ? '-' : `${n}.`} ${inner}\n`);
          }
          continue;
        }
        if (tag === 'DIV' || tag === 'P') {
          if (!endsLine()) out.push('\n');
          walk(child);
          if (!endsLine()) out.push('\n');
          continue;
        }
        walk(child);
      }
    };
    walk(root);
    return out.join('').replace(/\n$/, '');
  }

  function fillEditor(root, text) {
    root.replaceChildren();
    let list = null;
    for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
      const hit = LIST_LINE.exec(line);
      if (hit) {
        const tag = hit[1] ? 'UL' : 'OL';
        if (!list || list.tagName !== tag) {
          list = document.createElement(tag);
          root.append(list);
        }
        const item = document.createElement('li');
        item.textContent = hit[3];
        list.append(item);
        continue;
      }
      list = null;
      const last = root.lastChild;
      if (last && last.tagName !== 'UL' && last.tagName !== 'OL') root.append(document.createElement('br'));
      // A trailing space would collapse; the agent gets a plain space back.
      if (line) root.append(document.createTextNode(line.replace(/ $/, ' ')));
    }
  }

  const selectionIn = (root) => {
    const sel = root.getRootNode().getSelection?.() ?? document.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return root.contains(range.startContainer) ? { sel, range } : null;
  };

  function placeCaret(node, offset = null) {
    const sel = node.getRootNode().getSelection?.() ?? document.getSelection();
    const range = document.createRange();
    if (offset === null) {
      range.selectNodeContents(node);
      range.collapse(false);
    } else {
      range.setStart(node, offset);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** The text of the current line up to the caret. */
  function caretLine(root) {
    const at = selectionIn(root);
    if (!at) return '';
    const range = document.createRange();
    range.setStart(root, 0);
    range.setEnd(at.range.startContainer, at.range.startOffset);
    return serializeEditor(range.cloneContents()).split('\n').pop();
  }

  const closestItem = (root) => {
    const at = selectionIn(root);
    const node = at?.range.startContainer;
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const item = el?.closest('li');
    return item && root.contains(item) ? item : null;
  };

  const itemEmpty = (item) => !item.textContent.replace(/ /g, ' ').trim() && !item.querySelector('.ichip');

  /** `- ` or `1. ` typed at the start of a line becomes a list with one item. */
  function startListAt(root, marker) {
    const at = selectionIn(root);
    if (!at) return false;
    const { sel, range } = at;
    for (let n = 0; n < marker.length; n += 1) sel.modify('extend', 'backward', 'character');
    sel.getRangeAt(0).deleteContents();
    const list = document.createElement(marker === '1.' ? 'ol' : 'ul');
    const item = document.createElement('li');
    item.append(document.createElement('br'));
    list.append(item);
    const here = sel.getRangeAt(0);
    here.collapse(true);
    // A leading <br> is the line break before this line; the list stands in
    // for the line, so the break stays and the list follows it.
    here.insertNode(list);
    placeCaret(item, 0);
    return true;
  }

  /** Shift+Enter inside an item: split it, or leave the list from an empty one. */
  function continueList(root, item) {
    const list = item.parentElement;
    if (itemEmpty(item)) {
      const br = document.createElement('br');
      list.after(br);
      const after = document.createTextNode('');
      br.after(after);
      item.remove();
      if (!list.children.length) list.remove();
      placeCaret(after, 0);
      return;
    }
    const at = selectionIn(root);
    const next = document.createElement('li');
    if (at) {
      const rest = at.range;
      rest.setEnd(item, item.childNodes.length);
      next.append(rest.extractContents());
    }
    if (!next.childNodes.length) next.append(document.createElement('br'));
    item.after(next);
    placeCaret(next, 0);
  }

  /** Backspace on an empty item: drop the item, and the list when it is alone. */
  function leaveList(root, item) {
    const list = item.parentElement;
    const only = list.children.length === 1;
    const index = [...list.children].indexOf(item);
    item.remove();
    if (only) {
      const mark = document.createTextNode('');
      list.replaceWith(mark);
      placeCaret(mark, 0);
      return;
    }
    if (index === 0) placeCaret(list.firstElementChild, 0);
    else placeCaret(list.children[index - 1]);
  }
```

- [ ] **Step 4: The markup and the class**

In the constructor's template replace

```html
              <textarea rows="1" placeholder="Ask about this document…" aria-label="Message"></textarea>
```

with

```html
              <div class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-placeholder="Ask about this document…" data-empty></div>
```

Replace `this.input = root.querySelector('textarea');` with:

```js
      this.input = root.querySelector('.editor');
      Object.defineProperty(this.input, 'value', {
        get: () => serializeEditor(this.input),
        set: (text) => this.setValue(text),
      });
```

Change the `keydown` listener on `this.input` so the Enter branch reads:

```js
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          this.submit();
          return;
        }
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault();
          const item = closestItem(this.input);
          if (item) continueList(this.input, item);
          else document.execCommand('insertLineBreak');
          this.onEdited();
          return;
        }
        if (event.key === ' ' && !closestItem(this.input)) {
          const line = caretLine(this.input);
          if (line === '-' || line === '*' || line === '1.') {
            event.preventDefault();
            startListAt(this.input, line);
            this.onEdited();
          }
          return;
        }
        if (event.key === 'Backspace') {
          const item = closestItem(this.input);
          if (item && itemEmpty(item)) {
            event.preventDefault();
            leaveList(this.input, item);
            this.onEdited();
          }
        }
```

Replace the `input` listener:

```js
      this.input.addEventListener('input', () => {
        this.filterSlash();
        this.onEdited();
      });
```

Add the methods (next to `autosize`):

```js
    /** What follows any change to the box: the empty marker and the send button. */
    onEdited() {
      this.input.toggleAttribute('data-empty', !this.input.value && !this.input.querySelector('.ichip[data-key]'));
      this.updateSendable();
    }

    setValue(text) {
      fillEditor(this.input, text);
      if (this.shadowRoot.activeElement === this.input) placeCaret(this.input);
      this.onEdited();
    }

    autosize() {
      this.onEdited();
    }
```

Keep `autosize()` because `submit`, `pickSlash` and `chipSlash` call it. In `slashQuery`, `filterSlash`, `matchSlash`, `submit` nothing changes: they read `this.input.value`.

CSS: replace the `textarea { … }` and `textarea::placeholder` rules with

```css
    .editor { flex: 1; min-width: 0; font: inherit; color: var(--ink); outline: none; max-height: 160px; overflow-y: auto; padding: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .editor[data-empty]::after { content: attr(data-placeholder); color: var(--faint); pointer-events: none; }
    .editor ul, .editor ol { margin: 2px 0; padding-left: 1.25em; }
    .editor li { margin: 0; }
```

- [ ] **Step 5: Run the editor and the renamed tests**

Run: `PATH=… node --test --test-concurrency=1 test-browser/composer-editor.test.js test-browser/conversation.test.js test-browser/composer-attachments.test.js test-browser/drawer.test.js test-browser/drive-aim.test.js`

Expected: composer-editor PASS. In composer-attachments, the attachment-card tests still pass (the strip is untouched until Task 2). In conversation.test.js the three tests listed in memory as failing at HEAD may still fail; everything that passed before must pass. If `pressSequentially('- first')` does not produce a list, check that the space branch runs before the slash-menu branch returns (`onSlashKey` returns false when the menu is hidden).

- [ ] **Step 6: Commit**

```bash
git add runtime/agent-ui.js test-browser/composer-editor.test.js test-browser/conversation.test.js test-browser/composer-attachments.test.js test-browser/drawer.test.js test-browser/drive-aim.test.js
git commit -m "Type into an editor, not a textarea: a dash and a space make a list."
```

---

### Task 2: Pasted things and the document chip sit in the text

**Files:**
- Modify: `runtime/agent-ui.js` (`attachText`, `attachImage`, `dropAttachment`, `clearAttachments`, `renderAttachments`, `packAttachments`, `updateContext`, `setValue`, `onEdited`, markup, CSS)
- Modify: `test-browser/composer-attachments.test.js`, `test-browser/conversation.test.js` (context chip tests at "the context chip shows…" and "…names the aimed target")
- Modify: `test-browser/composer-editor.test.js`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `.ichip[data-kind="image"|"text"][data-key]` and `.ichip[data-kind="context"]` inside `.editor`; `this.attachChip(item)`; `this.insertChip(chip)`; `this.syncChips()`; `packAttachments()` walks chips in document order. `.attachments` strip and `.context` row are removed from the composer markup.

- [ ] **Step 1: Write the failing tests**

In `test-browser/composer-attachments.test.js` rewrite the tests that touch the strip. Keep `pasteText`, `pasteImage`, `promptOf`, `sentFrom` (with `sentFrom` typing via `pressSequentially` at the end of the editor, not `fill`, so the chip survives):

```js
const sentFrom = async (page, view, typed) => {
  const started = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true });
  }));
  const editor = view.locator('.editor');
  if (typed) {
    await editor.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = el.getRootNode().getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await editor.pressSequentially(typed);
  }
  await editor.press('Enter');
  return started;
};

test('a long paste becomes a chip in the text instead of filling the box', async () => {
  const { view, errors } = await mount();
  const swallowed = await pasteText(view, LONG);
  assert.equal(swallowed, true, 'the composer should take the paste');
  const chip = view.locator('.editor .ichip[data-kind="text"]');
  await chip.waitFor();
  assert.match(await chip.textContent(), /Pasted text/);
  assert.match(await chip.textContent(), /60 lines/);
  assert.equal(await view.locator('.editor').evaluate((el) => el.value), '[pasted text 1] ');
  assert.deepEqual(errors, []);
});

test('a short paste is just typing', async () => {
  const { view } = await mount();
  const swallowed = await pasteText(view, 'a couple of words');
  assert.equal(swallowed, false, 'a short paste must reach the editor');
  assert.equal(await view.locator('.ichip[data-key]').count(), 0);
});

test('opening a chip shows the whole thing, and Escape puts it back', async () => {
  const { view } = await mount();
  await pasteText(view, LONG);
  await view.locator('.editor .ichip[data-kind="text"]').click();
  const body = view.locator('.peek-body');
  await body.waitFor();
  assert.match(await view.locator('.peek-title').textContent(), /60 lines/);
  assert.match(await body.textContent(), /line 60:/);
  await view.locator('.peek-close').press('Escape');
  await view.locator('.peek').waitFor({ state: 'hidden' });
});

test('deleting the chip from the text leaves nothing to send', async () => {
  const { view } = await mount();
  await pasteText(view, LONG);
  assert.equal(await view.locator('.send').isDisabled(), false);
  await view.locator('.editor').fill('');
  assert.equal(await view.locator('.ichip[data-key]').count(), 0);
  assert.equal(await view.locator('.send').isDisabled(), true);
});

test('a sent paste travels as a tagged block with a token in the text, and comes back as the same chip', async () => {
  const { page, view, errors } = await mount();
  await pasteText(view, LONG);
  const id = await sentFrom(page, view, 'what is wrong with this log?');

  const prompt = await promptOf(id);
  assert.match(prompt, /^<pasted-text index="1" lines="60" chars="\d+">\n/);
  assert.match(prompt, /line 60: the quick brown fox[\s\S]*<\/pasted-text>/);
  assert.match(prompt, /\[pasted text 1\] what is wrong with this log\?$/);

  const chip = view.locator('.msg.me .ichip[data-kind="text"]');
  await chip.waitFor();
  assert.match(await view.locator('.msg.me').textContent(), /what is wrong with this log\?$/);
  assert.doesNotMatch(await view.locator('.msg.me').textContent(), /pasted-text|\[pasted text/);
  assert.deepEqual(errors, []);
});

test('a pasted image becomes a file the agent is given the path to', async () => {
  const { page, view, errors } = await mount();
  await pasteImage(view, PNG);
  const shot = view.locator('.editor .ichip[data-kind="image"] .ichip-shot');
  await shot.waitFor();
  assert.equal(await shot.evaluate((el) => el.src.startsWith('blob:')), true);

  const id = await sentFrom(page, view, 'what is in this?');
  const prompt = await promptOf(id);
  const path = /<pasted-image [^>]*path="([^"]+)"/.exec(prompt)?.[1];
  assert.ok(path, `expected a path in: ${prompt.slice(0, 200)}`);
  assert.match(path, /\.marble\/agents\/uploads\/[0-9a-f]{16}\.png$/);
  assert.equal((await fsp.readFile(path)).length, Buffer.from(PNG, 'base64').length);
  assert.match(prompt, /name="shot\.png"/);
  assert.match(prompt, /\[image 1\] what is in this\?$/);
  assert.deepEqual(errors, []);
});

test('the sent image is shown back from the host, not from the dead blob', async () => {
  const { page, view } = await mount();
  await pasteImage(view, PNG);
  await sentFrom(page, view, 'look');
  const src = await view.locator('.msg.me .ichip-shot').getAttribute('src');
  assert.match(src, /^\/agent\/uploads\/[0-9a-f]{16}\.png$/);
  const response = await page.request.get(`${host.base}${src}`);
  assert.equal(response.status(), 200);
  assert.equal(response.headers()['content-type'], 'image/png');
});

test('chips are numbered in the order they sit in the text', async () => {
  const { page, view } = await mount();
  await pasteImage(view, PNG);
  await pasteText(view, LONG);
  const id = await sentFrom(page, view, 'both');
  const prompt = await promptOf(id);
  assert.match(prompt, /^<pasted-image index="1"/);
  assert.match(prompt, /<pasted-text index="2"/);
  assert.match(prompt, /\[image 1\] \[pasted text 2\] both$/);
});
```

Keep the upload-route test and the last-picked-model test as they are.

Append to `test-browser/composer-editor.test.js`:

```js
test('the document chip leads the message and can be taken out', async () => {
  const { page, view } = await mount();
  const chip = view.locator('.editor .ichip[data-kind="context"]');
  await chip.waitFor();
  assert.equal((await chip.locator('.context-text').textContent()).trim(), 'garden');
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-marble-id="h"]'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await chip.locator('.context-text', { hasText: '1 selected' }).waitFor();
  await chip.locator('.context-clear').click();
  assert.equal(await view.locator('.editor .ichip[data-kind="context"]').count(), 0);
  await view.locator('.editor').pressSequentially('script:note');
  const started = page.evaluate(() => new Promise((resolve) => {
    document.querySelector('marble-conversation').addEventListener('conversation', (e) => resolve(e.detail.id), { once: true });
  }));
  await view.locator('.editor').press('Enter');
  const id = await started;
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const user = (await host.drive.agents.store.events(id)).find((e) => e.type === 'user');
  assert.equal(user.context.target, 'garden');
  assert.deepEqual(user.context.selection, []);
  // The next message gets the chip back.
  await view.locator('.editor .ichip[data-kind="context"]').waitFor();
});
```

In `test-browser/conversation.test.js`, the two context tests change to locate `.editor .ichip[data-kind="context"] .context-text`, and "can drop the selection" asserts the chip is gone after `.context-clear` instead of reading `garden` from it.

- [ ] **Step 2: Run and watch them fail**

Run: `PATH=… node --test --test-concurrency=1 test-browser/composer-attachments.test.js test-browser/composer-editor.test.js`

Expected: FAIL — no `.ichip`.

- [ ] **Step 3: Chips in the editor**

Markup: delete `<div class="attachments" hidden></div>` from inside `.row`, and delete the whole `<div class="context">…</div>` line. Delete `this.attachmentsEl = …`, `this.contextText = …`, `this.contextClear = …` and the `contextClear` click listener in the constructor.

Add to the class, in the attachments section:

```js
    /** The chip a pasted thing is shown as, in the box and in the sent bubble. */
    attachChip(item) {
      const chip = h('span', 'ichip');
      chip.contentEditable = 'false';
      chip.dataset.kind = item.kind;
      if (item.key) chip.dataset.key = item.key;
      chip.setAttribute('role', 'button');
      chip.tabIndex = -1;
      if (item.kind === 'image') {
        const shot = h('img', 'ichip-shot');
        shot.src = item.src ?? item.url ?? '';
        shot.alt = '';
        chip.append(shot, h('span', 'ichip-name', item.name));
        chip.setAttribute('aria-label', `${item.name}, ${sizeOf(item.bytes ?? 0)} — open`);
      } else {
        chip.append(h('span', 'ichip-name', `Pasted text · ${item.lines} lines`));
        chip.setAttribute('aria-label', `Pasted text, ${item.lines} lines — open`);
      }
      chip.addEventListener('click', () => this.openPeek(item));
      return chip;
    }

    /** At the caret when the box has it, else at the end. A space follows so
     *  typing carries on after the chip. */
    insertChip(chip) {
      const at = selectionIn(this.input);
      const space = document.createTextNode(' ');
      if (at) {
        at.range.deleteContents();
        at.range.insertNode(space);
        at.range.insertNode(chip);
      } else {
        this.input.append(chip, space);
      }
      placeCaret(space, 1);
      this.onEdited();
    }

    /** The list follows the box: a chip that is gone is an attachment that
     *  is gone, whichever key took it out. */
    syncChips() {
      const keys = new Set([...this.input.querySelectorAll('.ichip[data-key]')].map((chip) => chip.dataset.key));
      for (const item of this.attachments) {
        if (keys.has(item.key)) continue;
        if (item.src) URL.revokeObjectURL(item.src);
        if (this.peekItem === item) this.closePeek();
      }
      this.attachments = this.attachments.filter((item) => keys.has(item.key));
      if (!this.input.querySelector('.ichip[data-kind="context"]')) this.skipSelection = true;
    }

    contextChip() {
      const chip = h('span', 'ichip');
      chip.contentEditable = 'false';
      chip.dataset.kind = 'context';
      chip.append(h('span', 'context-text'));
      const clear = h('button', 'context-clear', '×');
      clear.type = 'button';
      clear.setAttribute('aria-label', 'Don’t send the selection');
      clear.addEventListener('click', () => {
        chip.remove();
        this.skipSelection = true;
        this.onEdited();
        this.focusInput();
      });
      chip.append(clear);
      return chip;
    }
```

Rewrite `attachText` and `attachImage` so their last lines are `this.insertChip(this.attachChip(item)); this.focusInput();` instead of `this.renderAttachments(); this.focusInput();` (build `item` as a const first, then push it). Rewrite `dropAttachment(item)` to remove the chip: `this.input.querySelector(`.ichip[data-key="${CSS.escape(item.key)}"]`)?.remove(); this.syncChips(); this.onEdited();`. Rewrite `clearAttachments()`:

```js
    clearAttachments() {
      for (const chip of this.input.querySelectorAll('.ichip[data-key]')) chip.remove();
      this.syncChips();
      this.closePeek();
      this.onEdited();
    }
```

Delete `renderAttachments()`. Keep `attachCard` (Task 3 uses it for old messages).

`packAttachments()` walks chips in document order:

```js
    orderedAttachments() {
      const byKey = new Map(this.attachments.map((item) => [item.key, item]));
      return [...this.input.querySelectorAll('.ichip[data-key]')].map((chip) => byKey.get(chip.dataset.key)).filter(Boolean);
    }
```

and its loop becomes `for (const [index, item] of this.orderedAttachments().entries())`.

`onEdited()` becomes:

```js
    onEdited() {
      this.syncChips();
      this.input.toggleAttribute('data-empty', !this.input.value.trim() && !this.attachments.length);
      this.updateSendable();
    }
```

`setValue(text)` re-materialises tokens and keeps the context chip:

```js
    setValue(text) {
      const before = this.orderedAttachments();
      const context = this.input.querySelector('.ichip[data-kind="context"]');
      fillEditor(this.input, text);
      const walker = document.createTreeWalker(this.input, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (TOKEN.test(node.data)) nodes.push(node);
      for (const node of nodes) {
        const frag = document.createDocumentFragment();
        let last = 0;
        TOKEN.lastIndex = 0;
        for (let m = TOKEN.exec(node.data); m; m = TOKEN.exec(node.data)) {
          frag.append(node.data.slice(last, m.index));
          const item = before[Number(m[2]) - 1];
          frag.append(item ? this.attachChip(item) : m[0]);
          last = m.index + m[0].length;
        }
        frag.append(node.data.slice(last));
        node.replaceWith(frag);
      }
      if (context) this.input.prepend(context);
      if (this.shadowRoot.activeElement === this.input) placeCaret(this.input);
      this.onEdited();
    }
```

Add `const TOKEN = /\[(image|pasted text) (\d+)\]/g;` beside `PASTED`.

`updateContext()`:

```js
    updateContext() {
      const { target, selection, also = [] } = this.api?.context() ?? { target: '', selection: [], also: [] };
      let chip = this.input.querySelector('.ichip[data-kind="context"]');
      if (!chip && !this.skipSelection && target) {
        chip = this.contextChip();
        this.input.prepend(chip, document.createTextNode(' '));
      }
      if (!chip) return;
      const count = this.skipSelection ? 0 : selection.length;
      const parts = [target];
      if (count) parts.push(`${count} selected`);
      if (also.length) parts.push(`+ ${also.length} more`);
      chip.querySelector('.context-text').textContent = parts.join(' · ');
      this.onEdited();
    }
```

In `submit()`, after `this.input.value = '';` the existing `this.skipSelection = false; this.updateContext();` puts the chip back. In `load()`, after `this.clearAttachments()`, add `this.skipSelection = false; this.updateContext();`.

The `paste` handler is unchanged: `takePaste` calls `attachImage` / `attachText`, which now insert at the caret; a short paste falls through to the browser (`insertText`).

CSS — replace the `.attachments`, `.attach-wrap`, `.attach-remove` and `.context*` rules with:

```css
    .ichip {
      display: inline-flex; align-items: center; gap: 5px; vertical-align: -3px; max-width: 100%;
      margin: 0 1px; padding: 1px 8px 1px 6px; border-radius: 999px;
      font-size: 11.5px; font-weight: 500; line-height: 1.5; color: var(--muted);
      background: var(--paper-2); border: 1px solid var(--line); cursor: pointer; user-select: none;
      transition: border-color 160ms var(--settle), background 160ms var(--settle);
    }
    .ichip:hover { border-color: var(--accent); background: var(--card); }
    .ichip[data-kind="context"] { color: var(--muted); padding-right: 3px; cursor: default; }
    .ichip[data-kind="context"]:hover { border-color: var(--line); background: var(--paper-2); }
    .ichip-shot { width: 22px; height: 22px; border-radius: 6px; object-fit: cover; background: var(--paper-3); margin-left: -3px; }
    .ichip-name, .context-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context-clear { font: inherit; border: 0; background: none; color: var(--faint); width: 16px; height: 16px; border-radius: 50%; cursor: pointer; line-height: 1; padding: 0; }
    .context-clear:hover { background: var(--line); color: var(--ink); }
```

Keep the `.attach*` card rules (the peek and old messages still use them).

- [ ] **Step 4: Run the tests**

Run: `PATH=… node --test --test-concurrency=1 test-browser/composer-attachments.test.js test-browser/composer-editor.test.js test-browser/conversation.test.js test-browser/drive-aim.test.js`

Expected: PASS, except the sent-bubble assertions in composer-attachments (`.msg.me .ichip…`), which Task 3 makes pass — leave those two tests red for now and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/composer-attachments.test.js test-browser/composer-editor.test.js test-browser/conversation.test.js
git commit -m "Pasted things and the document sit in the text as chips, numbered in the order they are written."
```

---

### Task 3: A sent message reads the way it was written

**Files:**
- Modify: `runtime/agent-ui.js` (`inline`, `renderText`, `userMessage`, CSS)

**Interfaces:**
- Consumes: `attachChip(item)` (Task 2), `splitPasted`, `TOKEN`.
- Produces: `renderText(text, { chip })` where `chip(kind, n)` returns a node or null; `userMessage(text)` renders paragraphs, lists and chips.

- [ ] **Step 1: The failing tests are the two red ones from Task 2 plus the last test of Task 1** ("a sent list … reads back as a list" expects `.msg.me li`).

- [ ] **Step 2: Implement**

Change `inline(parent, text)` to `inline(parent, text, chip = null)` and, before the `INLINE` loop, when `chip` is given, split on `TOKEN` first:

```js
  function inline(parent, text, chip = null) {
    if (chip) {
      let last = 0;
      TOKEN.lastIndex = 0;
      for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
        const node = chip(m[1], Number(m[2]));
        if (!node) continue;
        inlineMarks(parent, text.slice(last, m.index));
        parent.append(node);
        last = m.index + m[0].length;
      }
      inlineMarks(parent, text.slice(last));
      return;
    }
    inlineMarks(parent, text);
  }
```

Rename the existing body of `inline` to `inlineMarks(parent, text)`. Give `renderText(text, opts = {})` the same hook and pass `opts.chip` into every `inline(...)` call inside it.

Rewrite `userMessage(text)`:

```js
    userMessage(text) {
      const { blocks, rest } = splitPasted(text);
      const node = h('div', 'msg me');
      const items = blocks.map((block) => ({
        kind: block.kind,
        name: block.name || (block.kind === 'image' ? 'Pasted image' : 'Pasted text'),
        url: block.url,
        text: block.text,
        lines: Number(block.lines) || (block.text ? block.text.split('\n').length : 0),
        bytes: Number(block.bytes ?? block.chars) || 0,
      }));
      const shown = new Set();
      const chip = (_kind, n) => {
        const item = items[n - 1];
        if (!item) return null;
        shown.add(item);
        return this.attachChip(item);
      };
      const body = h('div', 'msg-text');
      body.append(renderText(blocks.length ? rest : text, { chip }));
      node.append(body);
      const rest2 = items.filter((item) => !shown.has(item));
      if (rest2.length) {
        const strip = h('div', 'attachments');
        for (const item of rest2) strip.append(this.attachCard(item));
        node.append(strip);
      }
      return node;
    }
```

CSS: add after the `.msg-text { display: block; }` rule (not next to `.msg.me`):

```css
    .msg.me .msg-text { white-space: normal; }
    .msg.me .msg-text p { margin: 0 0 .4em; } .msg.me .msg-text p:last-child { margin-bottom: 0; }
    .msg.me .msg-text ul, .msg.me .msg-text ol { margin: .2em 0 .4em; padding-left: 1.25em; }
    .msg.me .attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
```

and change the `.msg.me` rule's `white-space: pre-wrap;` to nothing — but that rule is in the block another session extends; instead leave it and rely on `.msg.me .msg-text { white-space: normal }` above.

- [ ] **Step 3: Run**

Run: `PATH=… node --test --test-concurrency=1 test-browser/composer-attachments.test.js test-browser/composer-editor.test.js test-browser/conversation.test.js`

Expected: all PASS (the "a prompt reads as a changelog entry" test only checks colours and alignment).

- [ ] **Step 4: Commit**

```bash
git add runtime/agent-ui.js
git commit -m "A sent message shows its chips where they were written, and its lists as lists."
```

---

### Task 4: One bar, no status line, tiles keep their controls

**Files:**
- Modify: `runtime/agent-ui.js` (markup, `paintStatus`, constructor, CSS)
- Modify: `test-browser/conversation.test.js` ("the composer status names…", "Shift+Tab cycles the CLI mode", "a document.changed event is listed…")
- Modify: `test-browser/agents-panes.test.js` only if it asserts a tile hides `.setup` (grep first; if it does, tell the owner of that file — marble-drive-02 — rather than editing it).

**Interfaces:**
- Produces: `.row > .bar` holding `.setup`, `button.mode`, `.dispatch` (Task 9 fills it), `.stop`, `.send`. `this.modeButton`. `paintStatus()` paints only the mode button.

- [ ] **Step 1: Failing tests**

Replace "the composer status names the CLI, documents changed, mode, and where" with:

```js
test('the composer is one card: text, then a bar with the setup, the mode and send', async () => {
  const { view } = await mount();
  await view.locator('.row .bar .presets, .row .bar .picker').first().waitFor();
  assert.equal(await view.locator('.statusline').count(), 0);
  assert.equal(await view.locator('.status-where').count(), 0);
  const mode = view.locator('.row .bar button.mode');
  assert.match(await mode.textContent(), /Default/);
  const [barBox, sendBox] = await Promise.all([view.locator('.bar').boundingBox(), view.locator('.send').boundingBox()]);
  assert.ok(sendBox.y >= barBox.y && sendBox.y + sendBox.height <= barBox.y + barBox.height + 1, 'send sits in the bar');
  const height = await view.locator('.composer').evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(height < 120, `composer is ${height}px tall`);
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
```

In "Shift+Tab cycles the CLI mode" replace `.status-mode` with `button.mode`. In "a document.changed event is listed as a document changed" delete the `.statusline` assertion.

- [ ] **Step 2: Run, watch fail**

Run: `PATH=… node --test --test-concurrency=1 test-browser/conversation.test.js`

Expected: the three tests FAIL.

- [ ] **Step 3: Implement**

Markup — the `<form class="composer">` becomes:

```html
        <form class="composer">
          <div class="slash" hidden role="listbox" aria-label="Commands"></div>
          <div class="peek" hidden>
            <div class="peek-head">
              <span class="peek-title"></span>
              <button type="button" class="peek-close" aria-label="Close">×</button>
            </div>
            <div class="peek-body"></div>
          </div>
          <div class="row">
            <div class="chips" hidden></div>
            <div class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-placeholder="Ask about this document…" data-empty></div>
            <div class="bar">
              <div class="setup" hidden>
                <div class="presets" role="radiogroup" aria-label="Saved setups" hidden></div>
                <button type="button" class="custom-toggle" aria-expanded="false" hidden>Custom</button>
                <div class="picker">
                  <fieldset class="seg picker-agent"><legend>CLI</legend><div class="seg-opts" data-seg="agent"></div></fieldset>
                  <fieldset class="seg picker-project"><legend>Project</legend><div class="seg-opts" data-seg="project"></div></fieldset>
                  <fieldset class="seg picker-models"><legend>Model</legend><div class="seg-opts" data-seg="model"></div></fieldset>
                  <fieldset class="seg picker-effort"><legend>Effort</legend><div class="seg-opts" data-seg="effort"></div></fieldset>
                </div>
              </div>
              <button type="button" class="mode" hidden aria-label="CLI mode — click or Shift+Tab to change"></button>
              <span class="bar-space"></span>
              <div class="dispatch" hidden role="radiogroup" aria-label="How to send while a turn runs"></div>
              <button type="button" class="stop" hidden aria-label="Stop">${STOP_ICON}</button>
              <button type="submit" class="send" aria-label="Send" disabled>${SEND_ICON}</button>
            </div>
          </div>
        </form>
```

Constructor: delete `this.statusline`, `this.statusWho`, `this.statusMode`, `this.statusWhere`; add `this.modeButton = root.querySelector('.mode'); this.dispatchEl = root.querySelector('.dispatch');` and change `this.statusMode.addEventListener('click', …)` to `this.modeButton.addEventListener('click', () => this.cycleMode());`.

`paintStatus()`:

```js
    paintStatus() {
      const provider = this.currentProvider();
      const modes = provider?.modes ?? [];
      const mode = modes.find((item) => item.id === this.mode) ?? modes[0];
      this.modeButton.hidden = !mode;
      this.modeButton.textContent = mode?.label ?? '';
    }
```

`this.editedFiles`, `this.where`, `loadChrome`'s `workspace` call and `filesEditedLabel` stay only where something else reads them; `filesEditedLabel` and `this.where` become unused — delete both and the `workspace` fetch in `loadChrome` (keep `usage`, which `claudeUnavailable` reads).

CSS — replace the `.statusline*`, `.status-*` rules with nothing, and adjust:

```css
    .composer { flex: none; padding: 6px 10px calc(10px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; background: var(--paper); }
    .row { display: flex; flex-direction: column; align-items: stretch; gap: 4px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 8px 8px 6px 12px; transition: border-color 200ms var(--settle), box-shadow 200ms var(--settle); }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 28px; }
    .bar-space { flex: 1; }
    .setup { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; max-width: 100%; position: relative; z-index: 3; }
    .setup[hidden] { display: none; }
    .mode { flex: none; font: inherit; font-size: 11px; font-weight: 500; color: var(--accent-ink); background: none; border: 0; padding: 3px 6px; border-radius: 999px; cursor: pointer; }
    .mode:hover { color: var(--ink); background: var(--paper-2); }
    .mode[hidden] { display: none; }
    .send, .stop { flex: none; width: 28px; height: 28px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center; transition: opacity 200ms var(--settle); }
```

(delete the old `.setup { … width: 100%; … }` rule and the old `.send, .stop { width: 32px … }` rule; `.row-input` is gone). Tiles:

```css
    /* A tile is a pane sharing the screen with others. It keeps its mast and
       its bar — two panes side by side should both say what they are — and
       only gives up padding. */
    :host([data-chrome="tile"]) .composer { padding: 4px 8px 8px; }
    :host([data-chrome="tile"]) .log { padding: 6px 12px 12px; }
    :host([data-chrome="tile"]) .mast { padding: 6px 12px 6px; }
```

replacing the four-line `:host([data-chrome="tile"]) .heading, … .setup { display: none; }` rule and the `.composer { padding: 6px 8px; gap: 4px; }` tile rule. Leave the `:host([data-chrome="pane"])` rules alone.

`showPicker` / `load` set `this.setup.hidden = false` as before; the `.picker` `hidden` toggling in `paintPresets` / `setCustomOpen` is unchanged.

- [ ] **Step 4: Run**

Run: `PATH=… node --test --test-concurrency=1 test-browser/conversation.test.js test-browser/drawer.test.js test-browser/composer-attachments.test.js test-browser/composer-editor.test.js`

Expected: PASS. If "a crowded segment becomes a dropdown instead of scrolling" fails, the picker inside the bar has no width limit: give `.picker` `max-width: 100%` and `.bar` `min-width: 0` (both already in the rules above — check they landed).

Then take a picture. `test-browser/shots.js` only shoots the Agents page, so write a scratch script (in the session scratchpad, not the repo) that imports `startDrive` from `test-browser/harness.js`, mounts a bare `<marble-conversation>` the way `composer-editor.test.js` does at 420px and 900px, and calls `page.screenshot({ path })`. Look at the pictures with the Read tool. The bar should be one line at 420px with the presets and Custom, and `Default` at its end.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "The composer is one card: the status line goes, the setup and the mode move into a bar under the text, and tiles keep it."
```

---

### Task 5: Tool rows say what they touched

**Files:**
- Modify: `runtime/agent-ui.js` (`toolLabel`, new `toolSource`, `toolCall`)
- Modify: `test/fixtures/fake-agent.mjs` (`tool` step)
- Modify: `test-browser/conversation.test.js` (SCRIPTS + a test)

**Interfaces:**
- Consumes: `toolShortName` from `runtime/choice-question.js` — copy its alias table into `agent-ui.js` as `SHORT_NAMES` for the classic script (the module stays the node-tested source; keep the two tables identical and say so in a comment).
- Produces: `.tool[data-name][data-state][data-short][data-source]`; `toolLabel(name, input)` returns `{ label, short, source }`.

- [ ] **Step 1: Failing test**

Add to SCRIPTS in `conversation.test.js`:

```js
  tools: [
    { tool: 'Bash', input: { command: 'node --test test/agent-runner.test.js', description: 'Run the runner tests' } },
    { tool: 'Read', input: { file_path: '/Users/x/marble-drive/test-browser/harness.js' } },
    { tool: 'Read', input: { file_path: '/Users/x/marble-drive/templates/agents.mrbl' } },
    { tool: 'Grep', input: { pattern: 'packFocus', path: '/Users/x/marble-drive/runtime' } },
    { tool: 'Bash', input: { command: 'git diff --stat' } },
    { tool: 'Edit', input: { file_path: '/Users/x/marble-drive/runtime/agent-ui.js' } },
    { say: 'Six calls later.' },
  ],
```

and the test:

```js
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
```

Note: Task 6 will fold these rows into a group; this test reads `textContent`, which works on hidden rows, so it survives.

- [ ] **Step 2: The fixture**

In `test/fixtures/fake-agent.mjs`, after the `step.call` block add:

```js
  // A CLI's own tool (Bash, Read, …): the host only ever sees the call and
  // the result, never a bridge round trip.
  if (step.tool) {
    const callId = `call-${nextId++}`;
    out({ kind: 'call', name: step.tool, input: step.input ?? {}, callId });
    out({ kind: 'result', callId, ok: step.ok !== false, summary: step.summary ?? '' });
  }
```

- [ ] **Step 3: Run, watch fail**

Run: `PATH=… node --test --test-concurrency=1 test-browser/conversation.test.js`

Expected: the new test FAILS on `Tried Bash`.

- [ ] **Step 4: Implement**

Replace `toolLabel` with:

```js
  // Kept identical to TOOL_ALIASES in runtime/choice-question.js, which is
  // the node-tested copy; this file is a classic script and cannot import it.
  const SHORT_NAMES = new Map([
    ['shell', 'Shell'], ['bash', 'Shell'], ['read_document', 'Read'], ['read', 'Read'],
    ['apply_ops', 'Edit'], ['edit', 'Edit'], ['updatetodos', 'Todos'], ['todowrite', 'Todos'], ['task', 'Task'],
  ]);
  const toolShortName = (name) => {
    if (!name) return 'Tool';
    const alias = SHORT_NAMES.get(String(name).toLowerCase());
    if (alias) return alias;
    const segment = String(name).split(/[/:]/).pop() || '';
    return segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : 'Tool';
  };
  const tail = (p) => String(p ?? '').replace(/\/+$/, '').split('/').pop() || String(p ?? '');
  const trimTo = (s, n = 60) => {
    const one = String(s ?? '').replace(/\s+/g, ' ').trim();
    return one.length > n ? `${one.slice(0, n - 1)}…` : one;
  };
  const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url ?? ''); } };
  const firstString = (input) => Object.values(input ?? {}).find((v) => typeof v === 'string' && v.trim()) ?? '';

  /** One line per call: a verb, and the thing it touched. `source` is what a
   *  folded run lists; `short` is the kind it counts by. */
  function toolLabel(name, input = {}) {
    const where = input.path ? ` ${input.path}` : '';
    const short = toolShortName(name);
    const out = (label, source = '') => ({ label, short, source });
    switch (name) {
      case 'read_document':
        return out(`Read${where}${Array.isArray(input.ids) && input.ids.length ? ` · ${plural(input.ids.length, 'element')}` : ''}`, input.path ?? '');
      case 'apply_ops':
        return out(`Editing${where}${input.note ? ` — ${input.note}` : ''}`, input.path ?? '');
      case 'list_documents': return out('Listed documents');
      case 'create_document': return out(`Creating${where}`, input.path ?? '');
      case 'read_guide': return out(input.section ? `Read the guide · ${input.section}` : 'Read the guide', input.section ?? '');
      case 'check_document': return out(`Check${where}`, input.path ?? '');
      case 'browser_navigate': return out(input.url ? `Open ${input.url}` : 'Open page', hostOf(input.url));
      case 'browser_snapshot': return out('Snapshot page');
      case 'browser_click': return out(input.ref ? `Click ${input.ref}` : 'Click', input.ref ?? '');
      case 'browser_type': return out('Type in page');
      case 'browser_tabs': return out(input.action === 'new' ? 'New tab' : input.action === 'close' ? 'Close tab' : 'Tabs');
      case 'browser_take_screenshot': return out('Screenshot');
      case 'browser_close': return out('Close browser');
      case 'browser_navigate_back': return out('Back');
      case 'WebSearch':
      case 'web_search': {
        const q = input.search_term || input.query || '';
        return out(q ? `Search ${q}` : 'Web search', q);
      }
      case 'Bash':
      case 'Shell':
      case 'shell': {
        const what = trimTo(input.description || input.command || input.cmd || '');
        return out(what ? `Ran ${what}` : 'Ran a command', what);
      }
      case 'Read':
      case 'read_file': { const t = tail(input.file_path ?? input.path); return out(`Read ${t}`, t); }
      case 'Grep': {
        const p = trimTo(input.pattern, 40);
        return out(`Grep ${p}${input.path ? ` in ${tail(input.path)}` : ''}`, p);
      }
      case 'Glob': { const p = trimTo(input.pattern, 40); return out(`Glob ${p}`, p); }
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit': { const t = tail(input.file_path ?? input.notebook_path); return out(`Edited ${t}`, t); }
      case 'Write': { const t = tail(input.file_path); return out(`Wrote ${t}`, t); }
      case 'LS': { const t = tail(input.path); return out(`Listed ${t}`, t); }
      case 'WebFetch': { const hst = hostOf(input.url); return out(`Fetched ${hst}`, hst); }
      case 'Task':
      case 'Agent': { const d = trimTo(input.description || input.prompt || ''); return out(d ? `Agent · ${d}` : 'Agent', d); }
      case 'TodoWrite':
      case 'updateTodos': return out('Updated todos');
      case 'Skill': return out(`Skill /${input.skill ?? input.name ?? ''}`, input.skill ?? '');
      default: {
        const arg = trimTo(firstString(input));
        return out(arg ? `${short} ${arg}` : short, arg);
      }
    }
  }
```

Update `toolCall`:

```js
    toolCall(turn, event) {
      const { label, short, source } = toolLabel(event.name, event.input);
      const row = h('div', 'tool', label);
      row.dataset.state = 'pending';
      row.dataset.name = event.name;
      row.dataset.short = short;
      if (source) row.dataset.source = source;
      …
```

and the one other caller, in `ask()` (`toolLabel(event.tool, event.input ?? {})`), to `.label`.

- [ ] **Step 5: Run**

Run: `PATH=… node --test --test-concurrency=1 test-browser/conversation.test.js`

Expected: PASS (including "the transcript shows … Read garden" — the Marble tools keep their labels).

- [ ] **Step 6: Commit**

```bash
git add runtime/agent-ui.js test/fixtures/fake-agent.mjs test-browser/conversation.test.js
git commit -m "A tool row says what it read, ran or searched instead of that it was tried."
```

---

### Task 6: Runs of finished tool rows fold up

**Files:**
- Modify: `runtime/agent-ui.js` (`collapseToolRows`, `groupLabel`, `regroup`, calls in `toolResult`/`opsApplied`/`opsRefused`/`documentChanged`/`finish`, CSS, export line)
- Modify: `test-browser/conversation.test.js`

**Interfaces:**
- Produces: `window.marbleAgentUI.collapseToolRows(nodes)` (an array of sibling nodes in order) and `window.marbleAgentUI.toolShortName`. `.tool-group[data-open]` > `button.tool-group-head[aria-expanded]` + `.tool-group-body[hidden]`.

- [ ] **Step 1: Failing test**

```js
test('finished tool rows fold into one line that counts by kind and names sources', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:tools');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  const group = view.locator('.tool-group');
  assert.equal(await group.count(), 1);
  const head = group.locator('.tool-group-head');
  assert.match(await head.locator('.tool-group-count').textContent(), /^6 steps$/);
  const kinds = await head.locator('.tool-group-kinds').textContent();
  assert.match(kinds, /Shell ×2/);
  assert.match(kinds, /Read harness\.js, agents\.mrbl/);
  assert.match(kinds, /Grep packFocus/);
  assert.match(kinds, /Edit agent-ui\.js/);
  assert.equal(await head.getAttribute('aria-expanded'), 'false');
  assert.equal(await group.locator('.tool').first().isVisible(), false);
  await head.click();
  assert.equal(await head.getAttribute('aria-expanded'), 'true');
  assert.equal(await group.locator('.tool').first().isVisible(), true);
  assert.equal(await group.locator('.tool').count(), 6);
});

test('a refused edit stays out of the fold', async () => {
  const { view } = await mount();
  await sendFrom(view, 'script:stale');
  await view.locator('.turn-footer[data-status="completed"]').waitFor();
  assert.equal(await view.locator('.tool-group').count(), 0);
  assert.equal(await view.locator('.tool[data-state="refused"]').isVisible(), true);
});
```

Also update "the transcript shows the agent's words…": its two rows (`Read garden`, `Edited 1 element in garden`) now fold; change `const tools = view.locator('.tool');` assertions to read `textContent` (they do) and add before them `await view.locator('.tool-group-head').click();` so the visibility of later assertions is not in question.

- [ ] **Step 2: Run, watch fail**

Expected: no `.tool-group`.

- [ ] **Step 3: Implement**

Top-level helpers, after `toolLabel`:

```js
  const foldable = (node) => node?.classList?.contains('tool') && node.dataset.state === 'done';

  /** `Shell ×2 · Read harness.js, agents.mrbl +1 · Grep packFocus`. */
  function groupLabel(rows) {
    const kinds = new Map();
    for (const row of rows) {
      const short = row.dataset.short || 'Tool';
      const entry = kinds.get(short) ?? { n: 0, sources: [] };
      entry.n += 1;
      const source = row.dataset.source;
      if (source && !entry.sources.includes(source)) entry.sources.push(source);
      kinds.set(short, entry);
    }
    return [...kinds].map(([short, { n, sources }]) => {
      const named = sources.slice(0, 2).join(', ');
      const more = sources.length > 2 ? ` +${sources.length - 2}` : '';
      const count = n > 1 ? ` ×${n}` : '';
      return `${short}${count}${named ? ` ${named}${more}` : ''}`;
    }).join(' · ');
  }

  function makeGroup(rows) {
    const group = h('div', 'tool-group');
    group.dataset.open = 'false';
    const head = h('button', 'tool-group-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    head.append(h('span', 'tool-group-count'), h('span', 'tool-group-kinds'));
    const body = h('div', 'tool-group-body');
    body.hidden = true;
    head.addEventListener('click', () => {
      const open = group.dataset.open !== 'true';
      group.dataset.open = String(open);
      head.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    });
    group.append(head, body);
    rows[0].before(group);
    for (const row of rows) body.append(row);
    return group;
  }

  function paintGroup(group) {
    const rows = [...group.querySelectorAll(':scope > .tool-group-body > .tool')];
    group.querySelector('.tool-group-count').textContent = `${rows.length} steps`;
    const kinds = group.querySelector('.tool-group-kinds');
    kinds.textContent = groupLabel(rows);
    group.querySelector('.tool-group-head').title = kinds.textContent;
  }

  /** Fold every run of two or more finished rows in `nodes` (siblings, in
   *  order). A finished row right after a group joins it. Pending, failed and
   *  refused rows stand alone and end a run. */
  function collapseToolRows(nodes) {
    let run = [];
    let group = null;
    const flush = () => {
      if (group) {
        for (const row of run) group.querySelector('.tool-group-body').append(row);
        paintGroup(group);
      } else if (run.length >= 2) {
        paintGroup(makeGroup(run));
      }
      run = [];
      group = null;
    };
    for (const node of nodes) {
      if (node.classList?.contains('tool-group')) {
        flush();
        group = node;
        continue;
      }
      if (foldable(node)) {
        run.push(node);
        continue;
      }
      flush();
    }
    flush();
  }
```

In the class, add:

```js
    /** The nodes that belong to a turn: from its first entry to its footer. */
    turnNodes(turn) {
      const record = this.turns.get(turn);
      if (!record?.footer?.isConnected) return [];
      const nodes = [];
      let start = record.footer.previousSibling;
      // Walk back to the previous turn's footer (or the top).
      while (start && !(start.classList?.contains('turn-footer') && start !== record.footer)) {
        nodes.unshift(start);
        start = start.previousSibling;
      }
      return nodes;
    }

    regroup(turn) {
      collapseToolRows(this.turnNodes(turn));
    }
```

`record.footer` exists once `turn.started` painted it; before that (queued) there are no tool rows. Call `this.regroup(turn)` at the end of `toolResult`, `opsApplied`, `opsRefused`, `documentChanged`, and at the top of `finish` (before the footer is repainted).

CSS:

```css
    .tool-group { display: flex; flex-direction: column; margin: 1px 0; }
    .tool-group-head {
      display: flex; align-items: baseline; gap: 8px; min-width: 0; width: 100%;
      font: inherit; font-size: 12.5px; color: var(--muted); text-align: left;
      background: none; border: 0; padding: 1px 2px; border-radius: 6px; cursor: pointer;
    }
    .tool-group-head::before { content: ''; flex: none; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 5px solid var(--faint); transform: translateY(-1px); transition: transform 120ms var(--settle); }
    .tool-group[data-open="true"] .tool-group-head::before { transform: rotate(90deg) translateX(-1px); }
    .tool-group-head:hover { background: var(--paper-2); color: var(--ink); }
    .tool-group-count { flex: none; color: var(--ink); font-weight: 500; }
    .tool-group-kinds { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tool-group-body { display: flex; flex-direction: column; padding-left: 13px; }
    .tool-group-body[hidden] { display: none; }
```

Export: find the existing `window.marbleAgentUI = { … }` line and add **on the next line** `Object.assign(window.marbleAgentUI, { collapseToolRows, toolShortName });`. If no such object exists yet, create `window.marbleAgentUI = window.marbleAgentUI ?? {};` first — check with grep.

- [ ] **Step 4: Run**

Run: `PATH=… node --test --test-concurrency=1 test-browser/conversation.test.js test-browser/agents-page.test.js`

Expected: PASS (agents-page tests read transcripts too; "pressing a row does not pop" fails at HEAD already).

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "Runs of finished tool calls fold into one line that counts them by kind and names what they touched."
```

---

### Task 7: The question card answers like the CLI's own

**Files:**
- Modify: `runtime/agent-ui.js` (`ask`, `askResponse`, CSS)
- Modify: `test-browser/conversation.test.js` (SCRIPTS `question`, tests)

**Interfaces:**
- Produces: `.ask[data-kind="question"] .ask-q`, options `button[role=radio|checkbox] > kbd + b + small`, `.ask-other`, `input.ask-other-text`; `askResponse` unchanged in signature.

- [ ] **Step 1: Failing tests**

Change the `question` script's options to `[{ label: 'A', description: 'the first way' }, { label: 'B', description: 'the second' }]`. Replace "a question ask offers its options…" with:

```js
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
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement**

Replace the `if (event.kind === 'question') { … }` branch of `ask()`:

```js
      if (event.kind === 'question') {
        const picks = new Map();
        const questions = event.input?.questions ?? [];
        // One answer covers every question; each question's Other text is
        // folded into its picks just before the response is built.
        const resolveOther = [];
        let answer = () => {};
        for (const q of questions) {
          const block = h('div', 'ask-q');
          block.append(h('div', 'ask-title', q.question));
          const list = h('div', 'ask-options');
          list.setAttribute('role', q.multiSelect ? 'group' : 'radiogroup');
          list.setAttribute('aria-label', q.question);
          const set = new Set();
          picks.set(q.question, set);
          const other = document.createElement('input');
          other.className = 'ask-other-text';
          other.hidden = true;
          other.placeholder = 'Type an answer';
          other.setAttribute('aria-label', 'Your own answer');
          const options = [...(q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? '' })), { label: 'Other…', description: '', other: true }];
          const buttons = options.map((o, i) => {
            const b = h('button', o.other ? 'ask-other' : '');
            b.type = 'button';
            b.setAttribute('role', q.multiSelect ? 'checkbox' : 'radio');
            b.setAttribute('aria-checked', 'false');
            b.tabIndex = i === 0 ? 0 : -1;
            b.append(h('kbd', '', String(i + 1)), h('b', '', o.label));
            if (o.description) b.append(h('small', '', o.description));
            return b;
          });
          const choose = (b, o) => {
            if (!q.multiSelect) {
              set.clear();
              for (const x of buttons) x.setAttribute('aria-checked', 'false');
            }
            const on = b.getAttribute('aria-checked') !== 'true';
            b.setAttribute('aria-checked', String(on));
            if (o.other) {
              other.hidden = !on;
              if (on) other.focus();
              set.delete(OTHER);
              if (on) set.add(OTHER);
              return;
            }
            if (on) set.add(o.label);
            else set.delete(o.label);
          };
          resolveOther.push(() => {
            if (set.has(OTHER)) {
              set.delete(OTHER);
              if (other.value.trim()) set.add(other.value.trim());
            }
          });
          buttons.forEach((b, i) => {
            const o = options[i];
            b.addEventListener('click', () => choose(b, o));
            b.addEventListener('keydown', (e) => {
              const digit = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
                for (const x of buttons) x.tabIndex = -1;
                next.tabIndex = 0;
                next.focus();
              } else if (e.key === ' ') {
                e.preventDefault();
                choose(b, o);
              } else if (digit >= 0 && buttons[digit]) {
                e.preventDefault();
                choose(buttons[digit], options[digit]);
                buttons[digit].focus();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (!set.size) choose(b, o);
                if (o.other && !other.value.trim()) return;
                answer();
              }
            });
          });
          other.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              answer();
            }
          });
          list.append(...buttons, other);
          block.append(list);
          card.append(block);
        }
        answer = () => {
          for (const fold of resolveOther) fold();
          submit(askResponse('question', event.input, picks));
        };
        const actions = h('div', 'ask-actions');
        const answerButton = h('button', 'answer', 'Answer');
        answerButton.type = 'button';
        answerButton.addEventListener('click', () => answer());
        actions.append(answerButton);
        card.append(actions);
      }
```

Add `const OTHER = Symbol('other');` near `askResponse`. `askResponse` joins a Set of labels; a Symbol never reaches it because every `resolveOther` runs first.

CSS — replace the `.ask …` rules:

```css
    .ask { margin: 8px 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); display: grid; gap: 10px; box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent); }
    .ask .ask-q { display: grid; gap: 6px; }
    .ask .ask-title { font-weight: 600; font-size: 13px; }
    .ask pre { margin: 0; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; background: var(--paper-2); padding: 6px 8px; border-radius: 8px; }
    .ask .ask-options { display: grid; gap: 3px; }
    .ask .ask-options button {
      display: grid; grid-template-columns: 18px 1fr; column-gap: 8px; align-items: baseline; text-align: left;
      font: inherit; font-size: 12.5px; padding: 6px 8px; border: 1px solid transparent; border-radius: 8px; background: none; color: inherit; cursor: pointer;
    }
    .ask .ask-options button:hover, .ask .ask-options button:focus-visible { background: var(--paper-2); outline: none; }
    .ask .ask-options button[aria-checked="true"] { border-color: var(--accent-ink); background: color-mix(in srgb, var(--accent-ink) 10%, transparent); }
    .ask .ask-options kbd { font: 11px/1.4 inherit; color: var(--faint); text-align: center; border: 1px solid var(--line); border-radius: 4px; }
    .ask .ask-options b { font-weight: 500; }
    .ask .ask-options small { grid-column: 2; color: var(--muted); font-size: 11.5px; }
    .ask .ask-other-text { font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; margin-left: 26px; }
    .ask .ask-other-text[hidden] { display: none; }
    .ask .ask-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .ask .ask-actions button { font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: none; color: inherit; cursor: pointer; }
    .ask .ask-actions button.allow, .ask .ask-actions button.answer { background: var(--accent-ink); color: var(--paper); border-color: var(--accent-ink); }
    .ask .ask-actions button:disabled { opacity: .5; cursor: default; }
    .ask .deny-note { flex: 1; min-width: 8em; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: none; color: inherit; }
```

- [ ] **Step 4: Run**

Run: `PATH=… node --test --test-concurrency=1 test-browser/conversation.test.js test-browser/agents-page.test.js`

Expected: PASS (`test/agent-runner.test.js` "a question is an ask…" is server-only and unchanged).

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "A question card reads like the CLI's: numbered options with what they mean, Other for your own words, digits to pick."
```

---

### Task 8: Questions asked in prose get a picker

**Files:**
- Modify: `runtime/agent-ui.js` (`finish`, new `choicePicker`, `text` bookkeeping, CSS, export)
- Modify: `test-browser/conversation.test.js`

**Interfaces:**
- Consumes: `parseChoiceQuestion(text)` from `/runtime/choice-question.js` (dynamic import); `submit({ dispatch })` (Task 9 adds the argument; here call `submit()`).
- Produces: `.choice-ask[role="group"]` with `button[role=radio|checkbox]` and `button.choice-send`; `record.lastText` on each turn.

- [ ] **Step 1: Failing test**

SCRIPTS:

```js
  choice: [{ say: 'Two ways to lay this out. Which do you want?\n\nA) Side by side\nB) Stacked' }],
```

Test:

```js
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
  assert.match(await view.locator('.msg.me').nth(1).textContent(), /^B — Stacked$/);
  await view.locator('.choice-ask').waitFor({ state: 'detached' });
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement**

At the IIFE top level:

```js
  let choiceModule = null;
  const loadChoice = () => {
    choiceModule ??= import('/runtime/choice-question.js').then((mod) => {
      Object.assign(window.marbleAgentUI, { parseChoiceQuestion: mod.parseChoiceQuestion });
      return mod;
    }).catch(() => null);
    return choiceModule;
  };
```

In `text(turn, text)` set `this.record(turn).lastText = { text, node }` for both branches (the live node or the new node). In `finish()`, after `if (this.running?.turn === turn) this.setRunning(null);`, add `this.offerChoices(turn);`.

```js
    async offerChoices(turn) {
      const record = this.turns.get(turn);
      if (!record?.lastText?.node?.isConnected || record.choice) return;
      const mod = await loadChoice();
      const parsed = mod?.parseChoiceQuestion(record.lastText.text);
      if (!parsed || !record.lastText.node.isConnected) return;
      record.choice = this.choicePicker(parsed, () => { record.choice?.remove(); record.choice = null; });
      record.lastText.node.after(record.choice);
    }

    choicePicker({ question, options, multiHint }, done) {
      const group = h('div', 'choice-ask');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', question);
      const chosen = new Set();
      const buttons = options.map((o, i) => {
        const b = h('button');
        b.type = 'button';
        b.setAttribute('role', multiHint ? 'checkbox' : 'radio');
        b.setAttribute('aria-checked', 'false');
        b.tabIndex = i === 0 ? 0 : -1;
        b.append(h('kbd', '', o.key), h('b', '', o.label));
        return b;
      });
      const toggle = (i) => {
        const b = buttons[i];
        if (!multiHint) {
          chosen.clear();
          for (const x of buttons) x.setAttribute('aria-checked', 'false');
        }
        const on = b.getAttribute('aria-checked') !== 'true';
        b.setAttribute('aria-checked', String(on));
        if (on) chosen.add(i); else chosen.delete(i);
      };
      const send = async (fallback) => {
        if (!chosen.size && fallback != null) toggle(fallback);
        const picked = [...chosen].sort((a, b) => a - b).map((i) => options[i]);
        if (!picked.length) return;
        this.input.value = `${picked.map((o) => o.key).join(', ')} — ${picked.map((o) => o.label).join('; ')}`;
        await this.submit();
        if (!this.input.value) done();
      };
      buttons.forEach((b, i) => {
        b.addEventListener('click', () => toggle(i));
        b.addEventListener('dblclick', () => send(i));
        b.addEventListener('keydown', (e) => {
          const key = options.findIndex((o) => o.key.toLowerCase() === e.key.toLowerCase());
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
            for (const x of buttons) x.tabIndex = -1;
            next.tabIndex = 0;
            next.focus();
          } else if (e.key === ' ') { e.preventDefault(); toggle(i); }
          else if (e.key === 'Enter') { e.preventDefault(); send(i); }
          else if (e.key === 'Escape') { e.preventDefault(); chosen.clear(); for (const x of buttons) x.setAttribute('aria-checked', 'false'); }
          else if (e.key.length === 1 && key >= 0) { e.preventDefault(); toggle(key); buttons[key].focus(); }
        });
      });
      const sendButton = h('button', 'choice-send', 'Send');
      sendButton.type = 'button';
      sendButton.addEventListener('click', () => send(null));
      group.append(...buttons, sendButton);
      return group;
    }
```

Remove a stale picker when the person types their own reply: in `submit()`, after the send succeeds (`await this.api.send(...)`), run `for (const record of this.turns.values()) { record.choice?.remove(); record.choice = null; }`. Also in `load()` nothing extra (the log is cleared).

CSS:

```css
    .choice-ask { display: grid; gap: 3px; margin: -4px 0 10px; padding: 8px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
    .choice-ask button { display: grid; grid-template-columns: 22px 1fr; column-gap: 8px; align-items: baseline; text-align: left; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid transparent; border-radius: 8px; background: none; color: inherit; cursor: pointer; }
    .choice-ask button:hover, .choice-ask button:focus-visible { background: var(--paper-2); outline: none; }
    .choice-ask button[aria-checked="true"] { border-color: var(--accent-ink); background: color-mix(in srgb, var(--accent-ink) 10%, transparent); }
    .choice-ask kbd { font: 11px/1.4 inherit; color: var(--faint); text-align: center; border: 1px solid var(--line); border-radius: 4px; }
    .choice-ask b { font-weight: 500; }
    .choice-ask .choice-send { display: inline-flex; justify-self: start; grid-template-columns: none; margin-top: 4px; padding: 4px 10px; border-color: var(--line); }
```

- [ ] **Step 4: Run**

Run: `PATH=… node --test --test-concurrency=1 test-browser/conversation.test.js` and `PATH=… node --test test/choice-question.test.js`.

Expected: PASS. If the dynamic import 404s, `server/app.js` `RUNTIME` must list `choice-question.js` (it does on this branch) — check the served path with `curl -s localhost:<port>/runtime/choice-question.js | head -1` while a test host is up, or read `test-browser/harness.js` for `host.base`.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "A question asked in prose gets a picker: keys to choose, Enter to send them as the reply."
```

---

### Task 9: The queue you can steer

**Files:**
- Modify: `runtime/agent-ui.js` (markup, `queue`, new `applyQueueCombine`, `setQueueCombine`, `paintQueuedDispatch`, `cycleQueuedDispatch`, `editQueuedPrompt`, `paintDispatch`, `submit({ dispatch })`, keydown, `setRunning`, `load`, event handling inside existing methods, CSS)
- Modify: `test-browser/conversation.test.js`

**Interfaces:**
- Consumes: `agent.send(id, { prompt, dispatch, … })`, `agent.patchTurn(turnId, { prompt?, dispatch? })`, `agent.update(id, { queueCombine })`; events (verified in `server/agent/runner.js`): `turn.queued { dispatch }`, `turn.dispatch { dispatch }`, `user.edited { text }`, `turn.combined`. There is no `meta` event: `queueCombine` is read from the conversation meta on `load()` and kept locally after a PATCH.
- Produces: `.queued[data-combine]`, `.queued-bar` (`button.queued-individually`, `button.queued-together`), `.queued-item[data-dispatch]` (`button.queued-dispatch`, `.queued-text`, `button.dequeue`), `.bar .dispatch` (three `label > input[name="dispatch"]`), `submit({ dispatch })`.

**Constraint:** the event `switch` in `receive()` is owned by another session. The four new events are routed **without editing the switch**: wrap `receive` — at the top of `receive(event)`, before the switch, add one line `if (this.receiveQueue(event)) return;` — no: that is an edit inside `receive`. Instead, in the constructor after `this.off = this.api.on(id, …)` is set up in `load()`, subscribe a second listener: `this.offQueue = this.api.on(id, (event) => { if (this.loading === token) this.receiveQueue(event); });` and dispose it beside `this.off`. `receiveQueue` handles `turn.queued` (dispatch only; the row is still made by the switch's `queue(turn, true)`, so paint after it with `queueMicrotask`), `turn.dispatch`, `user.edited`, `turn.combined`.

- [ ] **Step 1: Failing tests**

```js
test('queued rows show their mode, cycle it, and can be edited', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'later');
  const row = view.locator('.queued-item');
  await row.waitFor();
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
  const turns = await host.drive.agents.store.turns(id);
  assert.equal(turns[1].prompt, 'later, but shorter');
  assert.equal(turns[1].dispatch, 'steer');
});

test('two queued rows show the batch switch, and it is saved on the conversation', async () => {
  const { page, view } = await mount();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await sendFrom(view, 'one');
  assert.equal(await view.locator('.queued-bar').isVisible(), false);
  await sendFrom(view, 'two');
  await view.locator('.queued-bar').waitFor({ state: 'visible' });
  await view.locator('.queued-together').click();
  const id = await page.evaluate(() => document.querySelector('body > marble-conversation').getAttribute('conversation'));
  await page.waitForFunction(async (cid) => (await window.marble.agent.conversation(cid)).meta.queueCombine === true, id);
  assert.equal(await view.locator('.queued').getAttribute('data-combine'), '1');
});

test('while a turn runs the bar offers queue, steer and interrupt, and ⌘Enter steers', async () => {
  const { page, view } = await mount();
  assert.equal(await view.locator('.bar .dispatch').isVisible(), false);
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('.bar .dispatch').waitFor({ state: 'visible' });
  await view.locator('.bar .dispatch input[value="interrupt"]').check({ force: true });
  await view.locator('.editor').fill('now');
  await view.locator('.editor').press('Enter');
  const id = await page.evaluate(() => document.querySelector('body > marble-conversation').getAttribute('conversation'));
  await page.waitForFunction(async (cid) => (await window.marble.agent.conversation(cid)).turns.some((t) => t.dispatch === 'interrupt'), id);
  await view.locator('.turn-footer[data-status="cancelled"]').waitFor();
  await sendFrom(view, 'script:hold');
  await view.locator('button.stop').waitFor({ state: 'visible' });
  await view.locator('.editor').fill('nudge');
  await view.locator('.editor').press('Meta+Enter');
  await page.waitForFunction(async (cid) => (await window.marble.agent.conversation(cid)).turns.some((t) => t.dispatch === 'steer'), id);
});
```

- [ ] **Step 2: Run, watch fail**

- [ ] **Step 3: Implement**

Markup: inside `.composer`, before `.row`:

```html
          <div class="queued" hidden data-combine="0">
            <div class="queued-bar" hidden role="group" aria-label="How queued prompts are sent">
              <button type="button" class="queued-individually" aria-pressed="true">Send individually</button>
              <button type="button" class="queued-together" aria-pressed="false">Send as one prompt</button>
            </div>
          </div>
```

and delete the old `<div class="queued" hidden></div>` above the form. Constructor: `this.queuedBar`, `this.queuedIndividually`, `this.queuedTogether` querySelectors; listeners `click → this.setQueueCombine(false | true)`. Fill `.dispatch` once in the constructor:

```js
      fillRadios(this.dispatchEl, 'dispatch', [
        { id: 'queue', label: 'Queue' }, { id: 'steer', label: 'Steer' }, { id: 'interrupt', label: 'Interrupt' },
      ], { empty: null, value: 'queue' });
      this.dispatchEl.classList.add('seg-opts');
```

Keydown: the plain-Enter branch calls `this.submit()`; add before it

```js
        if (event.key === 'Enter' && !event.shiftKey && (event.metaKey || event.ctrlKey) && !event.isComposing) {
          event.preventDefault();
          this.submit({ dispatch: this.running ? 'steer' : 'queue' });
          return;
        }
```

`submit({ dispatch } = {})`: default `dispatch = this.running ? (radioValue(this.shadowRoot, 'dispatch') || 'queue') : 'queue'`; pass `dispatch` in `this.api.send(id, { prompt, dispatch, ...context })`.

`setRunning(turn)`: add `this.dispatchEl.hidden = !turn; if (!turn) setRadioValue(this.shadowRoot, 'dispatch', 'queue'); requestAnimationFrame(() => slideThumb(this.dispatchEl, { animate: false }));`.

`load()`: replace `this.queuedEl.replaceChildren()` with `for (const item of this.queuedEl.querySelectorAll('.queued-item')) item.remove();` and after `this.meta = meta;` add `this.applyQueueCombine(Boolean(meta.queueCombine));`; subscribe `this.offQueue` as described in the constraint above and dispose it in `disconnectedCallback` and at the top of `load()`.

Methods (adapted from the old branch's uncommitted work — the text edit is a `contenteditable` span, not a textarea):

```js
    receiveQueue(event) {
      const id = this.getAttribute('conversation');
      if (!eventBelongsToConversation(event, id)) return;
      const turn = event.turn;
      switch (event.type) {
        case 'turn.queued':
          this.record(turn).dispatch = event.dispatch ?? 'queue';
          queueMicrotask(() => {
            const row = this.queuedRow(turn);
            if (row) this.paintQueuedDispatch(row, this.record(turn).dispatch);
          });
          break;
        case 'turn.dispatch': {
          this.record(turn).dispatch = event.dispatch;
          const row = this.queuedRow(turn);
          if (row) this.paintQueuedDispatch(row, event.dispatch);
          break;
        }
        case 'user.edited': {
          this.prompts.set(turn, event.text);
          const row = this.queuedRow(turn);
          const text = row?.querySelector('.queued-text');
          if (text && !text.isContentEditable) text.textContent = event.text;
          const bubble = this.logEl.querySelector(`.msg.me[data-turn="${CSS.escape(turn)}"]`);
          if (bubble) {
            const next = this.userMessage(event.text);
            next.dataset.turn = turn;
            bubble.replaceWith(next);
          }
          break;
        }
        case 'turn.combined':
          this.queue(turn, false);
          break;
        default:
      }
    }

    queuedRow(turn) {
      return this.queuedEl.querySelector(`.queued-item[data-turn="${CSS.escape(turn)}"]`);
    }
```

The bubble needs `data-turn` to be found. The `user` case of the switch is another session's; instead tag it in `append(turn, node)`, which is yours: add `if (turn && node.classList?.contains('msg')) node.dataset.turn = turn;` as its first line.

```js
    queue(turn, present) {
      const existing = this.queuedRow(turn);
      if (!present) {
        existing?.remove();
      } else if (!existing) {
        const item = h('div', 'queued-item');
        item.dataset.turn = turn;
        const dispatch = h('button', 'queued-dispatch');
        dispatch.type = 'button';
        dispatch.addEventListener('click', () => this.cycleQueuedDispatch(item, turn));
        const text = h('span', 'queued-text', this.prompts.get(turn) ?? '');
        text.addEventListener('click', () => this.editQueuedPrompt(item, turn));
        const remove = h('button', 'dequeue', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove from the queue');
        remove.addEventListener('mousedown', () => { item.dataset.skipSave = '1'; });
        remove.addEventListener('click', () => this.api.dequeue(turn).catch((err) => this.system(err.message, true)));
        item.append(dispatch, text, remove);
        this.paintQueuedDispatch(item, this.record(turn).dispatch ?? 'queue');
        this.queuedEl.append(item);
      }
      const n = this.queuedEl.querySelectorAll('.queued-item').length;
      this.queuedEl.hidden = n === 0;
      this.queuedBar.hidden = n < 2;
    }

    applyQueueCombine(on) {
      this.queuedEl.dataset.combine = on ? '1' : '0';
      this.queuedIndividually.setAttribute('aria-pressed', on ? 'false' : 'true');
      this.queuedTogether.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    setQueueCombine(on) {
      const id = this.getAttribute('conversation');
      const was = this.queuedEl.dataset.combine === '1';
      this.applyQueueCombine(on);
      if (!id || !this.api?.update) return;
      this.api.update(id, { queueCombine: on }).catch((err) => {
        this.applyQueueCombine(was);
        this.system(err.message, true);
      });
    }

    paintQueuedDispatch(item, mode) {
      const next = mode === 'steer' || mode === 'interrupt' ? mode : 'queue';
      item.dataset.dispatch = next;
      const button = item.querySelector('.queued-dispatch');
      const label = { queue: 'Queue', steer: 'Steer', interrupt: 'Interrupt' }[next];
      button.textContent = label;
      button.setAttribute('aria-label', `${label} — click to change how this prompt is sent`);
    }

    cycleQueuedDispatch(item, turn) {
      const prev = item.dataset.dispatch || 'queue';
      const next = { queue: 'steer', steer: 'interrupt', interrupt: 'queue' }[prev];
      this.paintQueuedDispatch(item, next);
      this.api.patchTurn(turn, { dispatch: next }).catch((err) => {
        this.paintQueuedDispatch(item, prev);
        this.system(err.message, true);
      });
    }

    editQueuedPrompt(item, turn) {
      const text = item.querySelector('.queued-text');
      if (!text || text.isContentEditable) return;
      const before = this.prompts.get(turn) ?? text.textContent;
      text.contentEditable = 'plaintext-only';
      text.textContent = before;
      placeCaret(text);
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        text.contentEditable = 'false';
        text.removeAttribute('contenteditable');
        const next = text.textContent.replace(/\s+/g, ' ').trim();
        if (!save || item.dataset.skipSave || !next || next === before) {
          delete item.dataset.skipSave;
          text.textContent = before;
          return;
        }
        this.prompts.set(turn, next);
        this.api.patchTurn(turn, { prompt: next }).catch((err) => {
          this.prompts.set(turn, before);
          text.textContent = before;
          this.system(err.message, true);
        });
      };
      text.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      }, { once: false });
      text.addEventListener('blur', () => finish(true), { once: true });
    }
```

CSS — replace the `.queued*` rules:

```css
    .queued { display: flex; flex-direction: column; gap: 4px; }
    .queued[hidden] { display: none; }
    .queued-bar { display: flex; align-items: center; align-self: flex-start; background: var(--paper-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px; }
    .queued-bar[hidden] { display: none; }
    .queued-bar button { font: inherit; font-size: 11px; font-weight: 500; border: 0; background: none; color: var(--muted); padding: 3px 9px; border-radius: 999px; cursor: pointer; }
    .queued-bar button[aria-pressed="true"] { color: var(--ink); background: var(--card); box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 12%, transparent); }
    .queued-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); background: var(--paper-2); border: 1px solid var(--line); border-radius: 10px; padding: 3px 4px 3px 6px; }
    .queued-dispatch { flex: none; font: inherit; font-size: 11px; font-weight: 500; color: var(--accent-ink); background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; cursor: pointer; }
    .queued-item[data-dispatch="interrupt"] .queued-dispatch { color: var(--caution); }
    .queued-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; border-radius: 6px; padding: 2px 4px; outline: none; }
    .queued-text[contenteditable] { white-space: normal; background: var(--card); box-shadow: 0 0 0 1px var(--accent); color: var(--ink); }
    .queued-item button.dequeue { font: inherit; border: 0; background: none; color: var(--muted); width: 22px; height: 22px; border-radius: 6px; cursor: pointer; flex: none; }
    .queued-item button.dequeue:hover { background: var(--line); }
    .dispatch[hidden] { display: none; }
```

`.dispatch` reuses `.seg-opts` styling (it has that class), so its three radios look like the presets.

- [ ] **Step 4: Run everything**

Run: `PATH=… node --test --test-concurrency=1 "test-browser/*.test.js"` and `PATH=… npm test`.

Expected: PASS apart from the pre-existing failures named in memory (agents-focus "dragging a card to the stage pins it", agents-resize "double-clicking a seam", agents-page "pressing a row does not pop"). Confirm each of those fails on `main` too before moving on: `git stash` is shared — use `git worktree add /tmp/mdbase-check main` and run the one test there.

- [ ] **Step 5: Commit**

```bash
git add runtime/agent-ui.js test-browser/conversation.test.js
git commit -m "The queue shows its rows with a mode each — queue, steer, interrupt — a switch to send them as one, and the same choice in the bar while a turn runs."
```

---

### Task 10: Look at it, then hand over

**Files:**
- Modify: `docs/AGENTS.md` (composer section: editor, chips, bar, queue modes, folded tools, asks)

- [ ] **Step 1:** With the scratch screenshot script from Task 4, capture the bare conversation at 420px and 900px after a `script:tools` turn, with a pasted image chip in the editor, and with two queued rows (`script:hold` then two sends). Compare against §4, §6 and §7 of the spec: one bar; chips inline; a group line with sources; queue rows with a mode each.
- [ ] **Step 2:** Update `docs/AGENTS.md` where it describes the composer and the queue (grep for "Queued:" and "textarea").
- [ ] **Step 3:** `git commit -m "Docs: the composer as it is now."`
- [ ] **Step 4:** Report to Bryan: what landed, the screenshots' paths, which pre-existing tests fail on main, and that `templates/agents.mrbl` was not touched. Remind him the live host must be restarted to serve the new runner (the queue's server half), and that main's dirty usage-meter files belong to another session.
