# Git repositories in the Drive: indicators and a Publish popover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a git-repository folder visible everywhere in the Drive and give it a Publish popover beside Share that shows what changed, takes an optional message, and shows publishing and its result.

**Architecture:** The server marks repository folders in the tree (`repo: true`) and enriches `GET /drive/git` (changed files with kinds, last commit, GitHub link, behind-count after a fetch, the message a publish would use) and `POST /drive/git/publish` (custom message). The shell owns one popover and a bar button; the sidebar, the row menu and the Drive page (via a `marble:publish` window event) open it. The Drive page draws a mark on repository folders and a toolbar chip.

**Tech Stack:** Node 22 `node:test`, plain ES modules, web components with a shadow root (`runtime/shell.js`), the Drive template `templates/drive.mrbl` with its lineage (`tools/app-lineage.mjs`), Playwright for the browser pass.

**Spec:** `docs/superpowers/specs/2026-10-02-git-publish-popover-design.md`

## Global Constraints

- Everything visible only where publishing is on: `MARBLE_DRIVE_GIT=1` and a passphrase (`gitAllowed`); the shell knows by `data-git="1"` on its script tag (`GIT`).
- A repository is a folder with its own `.git` (file or directory). Nothing walks above a folder to find one.
- Commit message: at most 500 characters after trimming; empty means the automatic `Publish from Marble Drive: …`.
- Fetch for status: 10 s limit; a failed fetch is reported (`fetched: false`), never thrown.
- Never return credentials embedded in a remote URL.
- Design System: words, not capsules (the bar button is text on the bar; the filled pill stays Share's); a dot, never a digit, on a button; motion only while work runs, and none under reduced motion; 1px `--line` borders; colours from tokens only; no emoji.
- The GitHub mark: the 16-unit Octicon `mark-github` path, filled with `currentColor`.
- All Drive-page additions are script-drawn and `data-marble-transient`; regenerate `templates/lineage/drive.json.gz` with `node tools/app-lineage.mjs` and commit it with the template.
- Commits end with the `Co-Authored-By` and `Claude-Session` lines.

## Review Focus

1. A repository folder inside another repository folder (submodule-like): the bar and chip pick the nearest (deepest) one. Pinned in Task 4's `repoOf` and Task 5's `repoAt` (both keep the deepest match).
2. A publish that finishes after the popover was closed: the result must still reach the person (toast). Pinned in Task 4 `publishNow` (`if (pop.hidden) this.say(...)`).
3. Pressing Publish twice fast, or Enter in the message field while publishing: one publish only. Pinned by `this.gitBusy` in Task 4 and the server's per-folder chain (v1 test still passes).
4. A remote URL with a token in it (`https://user:token@github.com/o/r.git`): the page gets `https://github.com/o/r`, nothing else. Pinned in Task 2's parser test.
5. A folder that stops being a repository while the popover is open, or a status request that fails: one plain sentence, Publish disabled. Pinned in Task 4 `drawPublishing` (`!status.repo`, `status.error`).

---

### Task 1: Mark repository folders in the tree

**Files:**
- Modify: `server/store/fs-store.js` (`list()` → `walk()`, ~305-364)
- Modify: `server/store/index.js` (store contract comment for `tree`)
- Test: `test/store-repo.test.js` (create)

**Interfaces:**
- Produces: tree folder entries carry `repo: true` when the folder has an entry named `.git`; absent otherwise.

- [ ] **Step 1: Write the failing test** — `test/store-repo.test.js`:

```js
// A folder that is its own git repository says so in the tree, so the Drive can
// show it without asking git about every folder it draws.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStore } from '../server/store/index.js';

const DOC = '<!doctype html><html data-marble-id="h"><body data-marble-id="b"></body></html>\n';

test('a folder with its own .git is marked, as a directory or as a file', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'store-repo-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'Site/.git'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Site/Inner'), { recursive: true });
  await fsp.mkdir(path.join(root, 'Worktree'), { recursive: true });
  await fsp.writeFile(path.join(root, 'Worktree/.git'), 'gitdir: /elsewhere\n');
  await fsp.mkdir(path.join(root, 'Plain'), { recursive: true });
  await fsp.writeFile(path.join(root, 'Site/page.mrbl'), DOC);

  const tree = await createStore({ root }).tree({ folder: '' });
  const find = (node, p) => node.path === p ? node : (node.children ?? []).map((c) => find(c, p)).find(Boolean);
  assert.equal(find(tree, 'Site').repo, true);
  assert.equal(find(tree, 'Worktree').repo, true);
  assert.equal(find(tree, 'Plain').repo, undefined);
  assert.equal(find(tree, 'Site/Inner').repo, undefined);
  // The .git itself stays hidden.
  assert.equal(find(tree, 'Site/.git'), undefined);
});
```

- [ ] **Step 2: Run it, expect FAIL** — `node --test test/store-repo.test.js` → `undefined !== true`.

- [ ] **Step 3: Implement** — in `walk(relative)`, keep the result in a variable and mark it; in the folder branch, carry the mark:

```js
      // Before the dotfiles are dropped: a folder with its own `.git` (a
      // directory, or a file in a worktree) is a repository, and the tree says
      // so here because the entries are already in hand (server/git.js).
      const repo = entries.some((entry) => entry.name === '.git');
```
(placed right after `const entries = await fsp.readdir(...)`), the folder entry gets `...(inside.repo ? { repo: true } : {}),` after `modified`, and the end of `walk` becomes:

```js
      const found = each.flat();
      if (repo) found.repo = true;
      return found;
```
In `server/store/index.js`, add to the `tree` line of the contract: `a folder that is its own git repository carries repo: true`.

- [ ] **Step 4: Run it, expect PASS** — `node --test test/store-repo.test.js`.

- [ ] **Step 5: Commit** — `git add test/store-repo.test.js server/store/fs-store.js server/store/index.js && git commit -m "Tree: a folder that is its own git repository says repo: true"` (with the trailer lines).

---

### Task 2: Richer status, a fetch, and a message for Publish

**Files:**
- Modify: `server/git.js`
- Modify: `server/app.js` (the two `/drive/git` routes)
- Modify: `runtime/drive.js` (`git.status`, `git.publish`)
- Test: `test/git-publish.test.js` (extend), `test/git-web.test.js` (create)

**Interfaces:**
- Produces (server, exported): `githubWeb(remoteUrl) → string | null`.
- Produces (`GET /drive/git?path=&fetch=1`): `{ repo, path, branch, upstream, changed, ahead, files: [{path, change: 'new'|'changed'|'deleted'}], last: {commit, short, message, when, url} | null, web, behind, fetched, fetchError, message }` — `behind`/`fetched` are null without `fetch=1`; `message` is what a publish with no message would say (null when nothing changed).
- Produces (`POST /drive/git/publish {path, message?}`): v1's answer plus `last`.
- Produces (carrier): `marble.drive.git.status(path, { fetch = false } = {})`, `marble.drive.git.publish(path, { message = '' } = {})`.

- [ ] **Step 1: Write the failing tests.** `test/git-web.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { githubWeb } from '../server/git.js';

test('a GitHub remote, in each spelling, is its page on GitHub', () => {
  assert.equal(githubWeb('https://github.com/bdhmin/phd-portfolio.git'), 'https://github.com/bdhmin/phd-portfolio');
  assert.equal(githubWeb('https://github.com/bdhmin/phd-portfolio'), 'https://github.com/bdhmin/phd-portfolio');
  assert.equal(githubWeb('git@github.com:bdhmin/phd-portfolio.git'), 'https://github.com/bdhmin/phd-portfolio');
  assert.equal(githubWeb('ssh://git@github.com/bdhmin/phd-portfolio.git'), 'https://github.com/bdhmin/phd-portfolio');
});

test('credentials in a remote never come back, and other hosts are not GitHub', () => {
  assert.equal(githubWeb('https://user:ghp_secret@github.com/o/r.git'), 'https://github.com/o/r');
  assert.equal(githubWeb('https://gitlab.com/o/r.git'), null);
  assert.equal(githubWeb('/tmp/remote.git'), null);
  assert.equal(githubWeb(''), null);
  assert.equal(githubWeb(null), null);
});
```

Append to `test/git-publish.test.js`:

```js
test('status lists each change with its kind, and the message a publish would use', async (t) => {
  const { status, site } = await boot(t);
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Changed</h1>'));
  await fsp.writeFile(path.join(site, 'new.mrbl'), DOC);
  await fsp.rm(path.join(site, 'Nested/inner.mrbl'));
  const answer = await (await status('Site')).json();
  const byPath = Object.fromEntries(answer.files.map((f) => [f.path, f.change]));
  assert.deepEqual(byPath, { 'page.mrbl': 'changed', 'new.mrbl': 'new', 'Nested/inner.mrbl': 'deleted' });
  assert.equal(answer.changed, 3);
  assert.match(answer.message, /^Publish from Marble Drive: /);
  assert.equal(answer.behind, null);
  assert.equal(answer.fetched, null);
});

test('status names the last commit; a remote that is not GitHub has no links', async (t) => {
  const { status, site } = await boot(t);
  const answer = await (await status('Site')).json();
  assert.equal(answer.last.message, 'first');
  assert.equal(answer.last.commit, git(site, 'rev-parse', 'HEAD'));
  assert.ok(answer.last.short.length >= 7);
  assert.ok(!Number.isNaN(Date.parse(answer.last.when)));
  assert.equal(answer.last.url, null);
  assert.equal(answer.web, null);
  assert.equal(answer.message, null);
});

test('with fetch, status counts what the remote has that the folder does not', async (t) => {
  const { ask, remote, tmp } = await boot(t);
  const other = path.join(tmp, 'other');
  execFileSync('git', ['clone', '-q', remote, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  await fsp.writeFile(path.join(other, 'theirs.txt'), 'theirs');
  git(other, 'add', '-A');
  git(other, 'commit', '-qm', 'theirs');
  git(other, 'push', '-q');
  const answer = await (await ask('/drive/git?path=Site&fetch=1')).json();
  assert.equal(answer.fetched, true);
  assert.equal(answer.behind, 1);
});

test('a remote that cannot be reached is said, not thrown', async (t) => {
  const { ask, site, tmp } = await boot(t);
  git(site, 'remote', 'set-url', 'origin', path.join(tmp, 'gone.git'));
  const res = await ask('/drive/git?path=Site&fetch=1');
  assert.equal(res.status, 200);
  const answer = await res.json();
  assert.equal(answer.fetched, false);
  assert.ok(answer.fetchError);
});

test('publish uses the message given, and answers with the commit it made', async (t) => {
  const { publish, site, remote } = await boot(t);
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Bio</h1>'));
  const res = await publish('Site', { body: { path: 'Site', message: '  Update the bio  ' } });
  assert.equal(res.status, 200);
  const answer = await res.json();
  assert.equal(git(site, 'log', '-1', '--format=%s'), 'Update the bio');
  assert.equal(answer.last.message, 'Update the bio');
  assert.equal(answer.last.commit, git(remote, 'rev-parse', 'main'));
});

test('a message over 500 characters is refused and nothing is committed', async (t) => {
  const { publish, site, remote } = await boot(t);
  const before = git(remote, 'rev-parse', 'main');
  await fsp.writeFile(path.join(site, 'page.mrbl'), DOC.replace('Page</h1>', 'Long</h1>'));
  const res = await publish('Site', { body: { path: 'Site', message: 'x'.repeat(501) } });
  assert.equal(res.status, 400);
  assert.equal(git(site, 'rev-parse', 'HEAD'), before);
  assert.equal(git(remote, 'rev-parse', 'main'), before);
});
```
`boot`'s `publish` helper takes the body from `opts` when given: change it to
`const publish = (folder, opts = {}) => ask('/drive/git/publish', { method: 'POST', body: { path: folder }, ...opts });` (already the shape — `opts.body` overrides).

- [ ] **Step 2: Run, expect FAIL** — `node --test test/git-web.test.js test/git-publish.test.js` → `githubWeb` not exported; `files` entries are strings; `last` undefined.

- [ ] **Step 3: Implement in `server/git.js`.**

Add after `ASK`/`CHANGE`: `const FETCH = 10_000;` and `const MESSAGE_MAX = 500;`.

Add the parser:

```js
/** A remote's page on GitHub, or null for anything that is not GitHub. A
 *  token written into an https remote is dropped: this goes to a page. */
export function githubWeb(remoteUrl) {
  const found = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i
    .exec(String(remoteUrl ?? '').trim());
  return found ? `https://github.com/${found[1]}/${found[2]}` : null;
}
```

Replace `changedFiles` so it keeps the kind:

```js
/** `git status -z` as what changed and how. A rename names two paths, the new
 *  one first, and counts as a change to the new one. */
function changedFiles(porcelain) {
  const parts = porcelain.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const change = code === '??' || code.includes('A') ? 'new' : code.includes('D') ? 'deleted' : 'changed';
    files.push({ path: entry.slice(3), change });
    if (code[0] === 'R' || code[0] === 'C') i += 1;
  }
  return files;
}
```
`messageFor(files)` takes paths: callers pass `files.map((f) => f.path)`.

Inside `createGit`, add:

```js
  /** The repository's page on GitHub, from the remote the branch pushes to. */
  async function webOf(at, upstream) {
    const remote = upstream?.remote ?? 'origin';
    return githubWeb((await git(at, ['config', '--get', `remote.${remote}.url`])).stdout);
  }

  /** HEAD as a person reads it, or null on a branch with no commits yet. */
  async function lastOf(at, web) {
    const shown = await git(at, ['log', '-1', '--format=%H%x00%h%x00%s%x00%cI']);
    if (shown.code !== 0 || !shown.stdout.trim()) return null;
    const [commit, short, message, when] = shown.stdout.trim().split('\0');
    return { commit, short, message, when, url: web ? `${web}/commit/${commit}` : null };
  }

  /** Commits the upstream has that HEAD lacks, as of the last fetch. */
  async function behindOf(at, upstream) {
    const counted = await git(at, ['rev-list', '--count', `HEAD..${upstream.name}`]);
    return counted.code === 0 ? Number(counted.stdout.trim()) : null;
  }
```

`status(folder, { fetch = false } = {})` becomes:

```js
  async function status(folder, { fetch = false } = {}) {
    const { folder: clean, at } = await repoAt(folder);
    if (!at) return { repo: false, path: clean };
    const branch = await branchOf(at);
    const upstream = await upstreamOf(at, branch);
    // Asking GitHub is the slow part and the only one that leaves the
    // machine, so it happens when a person opens the popover, not on every
    // look at the bar.
    let fetched = null;
    let fetchError = null;
    if (fetch && upstream) {
      const got = await git(at, ['fetch', '--quiet', upstream.remote], FETCH);
      fetched = got.code === 0;
      if (!fetched) fetchError = complaint(got);
    }
    const files = await changes(at);
    const web = await webOf(at, upstream);
    return {
      repo: true,
      path: clean,
      branch,
      upstream: upstream?.name ?? null,
      changed: files.length,
      files,
      ahead: upstream ? await aheadOf(at, upstream) : null,
      behind: fetch && upstream ? await behindOf(at, upstream) : null,
      fetched,
      fetchError,
      web,
      last: await lastOf(at, web),
      message: files.length ? messageFor(files.map((file) => file.path)) : null,
    };
  }
```

`publishNow(folder, { message = '' } = {})`: first line validates —

```js
    const said = String(message ?? '').trim();
    if (said.length > MESSAGE_MAX) throw bad(`a message is at most ${MESSAGE_MAX} characters`);
```
— commit with `said || messageFor(paths)` where `const paths = files.map((file) => file.path);`, the `nothing` answer and the success answer both use `files: paths`, and the success answer adds `last: await lastOf(at, await webOf(at, upstream))`.

`publish(folder, options = {})` passes `options` through to both `publishNow(key, options)` calls.

In `server/app.js`: status route → `git.status(url.searchParams.get('path') ?? '', { fetch: url.searchParams.get('fetch') === '1' })`; publish route → `git.publish(folder, { message: body.message })`.

In `runtime/drive.js`:

```js
    const git = {
      status: (path, { fetch = false } = {}) =>
        ask(`/drive/git?path=${encodeURIComponent(path)}${fetch ? '&fetch=1' : ''}`),
      publish: (path, { message = '' } = {}) =>
        ask('/drive/git/publish', { method: 'POST', body: { path, message } }),
    };
```

- [ ] **Step 4: Run, expect PASS** — `node --test test/git-web.test.js test/git-publish.test.js` (all, including v1's ten).

- [ ] **Step 5: Commit** — `git add server/git.js server/app.js runtime/drive.js test/git-web.test.js test/git-publish.test.js && git commit -m "Publish: what changed and how, the last commit and its link, a fetch for what GitHub has, and a message"`.

---

### Task 3: The shell — mark, bar button, popover, sidebar, row menu, the window event

**Files:**
- Modify: `runtime/shell.js`

**Interfaces:**
- Consumes: tree `repo: true` (Task 1); `marble.drive.git.status(path, {fetch})`, `.publish(path, {message})` and the answers' `files/last/web/behind/fetched/message` (Task 2).
- Produces: `whenOf(iso)`; `window` event `marble:publish` with `detail.path` opens the popover for that repository (used by Task 4). Methods: `repoOf(path)`, `drawGit()`, `refreshGitDot(repo)`, `togglePublishing(path, anchor)`, `loadPublishing(path)`, `drawPublishing(status)`, `publishNow()`, `commitLink(last)`.

- [ ] **Step 1: The mark.** After `const icon = …`:

```js
  // GitHub's own mark (Octicons mark-github), filled: a brand is drawn the way
  // the brand draws it, as the agent chips do theirs (runtime/agent-ui.js).
  const GITHUB_PATH = 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';
  const github = (cls, label = '') =>
    `<svg class="gh ${cls}" viewBox="0 0 16 16" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><path fill="currentColor" d="${GITHUB_PATH}"/></svg>`;
```

  and a relative time (this shell has none yet):

```js
  /** When a commit was made, the way a person says it: "just now", "at 3:42 PM"
   *  today, "Sep 28" this year, with the year before that. */
  const whenOf = (iso) => {
    const at = new Date(iso);
    const now = new Date();
    if (now - at < 60_000) return 'just now';
    if (at.toDateString() === now.toDateString()) return `at ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    return `on ${at.toLocaleDateString([], { month: 'short', day: 'numeric', ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })}`;
  };
```

- [ ] **Step 2: CSS.** Append to `STYLE` after the `.moving` block (before `.toast`):

```css
    /* ── A folder that is its own git repository (server/git.js) ── */
    .gh { width: 14px; height: 14px; flex: none; stroke: none; }
    /* Publish on the bar is words on the bar, as every control there is but
       Share: the filled pill is spent once. A dot says there is something to
       publish; the popover says what. */
    .ib.git { width: auto; padding: 0 9px; gap: 6px; display: flex; align-items: center; font-weight: 600; font-size: 12.5px; position: relative; }
    .ib.git[hidden] { display: none; }
    .ib.git[aria-expanded="true"] { background: var(--paper-2); color: var(--ink); }
    .ib.git[data-dirty]::after { content: ''; position: absolute; top: 5px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    .ib.git[data-busy] .gh { animation: gh-busy 900ms ease-in-out infinite alternate; }
    @keyframes gh-busy { to { opacity: .3; } }
    @media (prefers-reduced-motion: reduce) { .ib.git[data-busy] .gh { animation: none; } }
    /* In the tree, the mark is on the right of a repository's row while the
       row is under the pointer, focused or holding its menu; on a touch
       screen, where nothing is under a pointer, always. */
    .row .mark { margin-left: auto; color: var(--faint); opacity: 0; transition: opacity 120ms var(--settle); }
    .row:is(:hover, :focus-visible, [data-menu]) .mark { opacity: 1; }
    @media (hover: none) { .row .mark { opacity: 1; } }
    .publishing { width: min(340px, calc(100vw - 16px)); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .publishing h3 { margin: 0; font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .publishing p { margin: 0; }
    .publishing .where { display: flex; gap: 8px; align-items: baseline; color: var(--muted); font-size: 12px; min-width: 0; }
    .publishing .branch { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .publishing .web { margin-left: auto; color: var(--muted); text-decoration: none; white-space: nowrap; }
    .publishing .web:hover { color: var(--ink); text-decoration: underline; }
    .publishing :is(.web, .result, .last)[hidden], .publishing .changes:empty { display: none; }
    .publishing .state { color: var(--ink); text-wrap: pretty; }
    .publishing .state .quiet { color: var(--muted); }
    .publishing .changes { list-style: none; margin: 0; padding: 4px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); max-height: 180px; overflow: auto; }
    .publishing .changes li { display: flex; gap: 8px; padding: 3px 0; font-size: 12.5px; min-width: 0; }
    .publishing .changes .file { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .publishing .changes .kind { margin-left: auto; color: var(--muted); flex: none; }
    .publishing .changes .more { color: var(--muted); }
    .publishing .msg { height: 30px; border: 1px solid var(--line); border-radius: 8px; padding: 0 8px; font: inherit; color: var(--ink); background: var(--paper); min-width: 0; }
    .publishing .msg:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
    .publishing .go { display: flex; justify-content: flex-end; }
    .publishing .publish { height: 30px; padding: 0 14px; border-radius: 8px; font-weight: 600; font-size: 12.5px; background: var(--ink); color: var(--paper); }
    .publishing .publish:active { background: var(--accent-ink); }
    .publishing .publish:disabled { opacity: .4; cursor: default; }
    .publishing .result { font-size: 12.5px; color: var(--ink); }
    .publishing .result[data-bad] { color: var(--danger, #b4533e); }
    .publishing :is(.result, .last) a { color: inherit; }
    .publishing .last { color: var(--faint); font-size: 12px; }
```

- [ ] **Step 3: Markup.** Before the Share button in the bar:

```html
          <button type="button" class="ib git" data-act="publish" aria-haspopup="dialog" aria-expanded="false" title="Publish this folder to GitHub" hidden>${github('')}<span>Publish</span></button>
```
After the `.pop.sharing` block:

```html
        <div class="pop publishing" role="dialog" aria-label="Publish" hidden>
          <h3></h3>
          <p class="where"><span class="branch"></span><a class="web" target="_blank" rel="noopener" hidden></a></p>
          <p class="state" role="status"></p>
          <ul class="changes"></ul>
          <input class="msg" aria-label="Message" maxlength="500" autocomplete="off">
          <div class="go"><button type="button" class="publish" disabled>Publish</button></div>
          <p class="result" hidden></p>
          <p class="last" hidden></p>
        </div>
```
Cache `this.publishing = this.$('.publishing');` beside `this.sharing`.

- [ ] **Step 4: Wiring.**
  - Bar click: `else if (act === 'publish') this.togglePublishing(this.repoOf(this.here));`
  - After the sharing listeners:

```js
      this.publishing.querySelector('.publish').addEventListener('click', () => this.publishNow());
      this.publishing.querySelector('.msg').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        this.publishNow();
      });
      // A document asks for the popover by name and path, never by route:
      // the Drive page's toolbar does, inside a repository (templates/drive.mrbl).
      addEventListener('marble:publish', (event) => {
        const path = event.detail?.path;
        if (GIT && window.marble?.drive?.git && typeof path === 'string' && path) this.togglePublishing(path);
      });
```
  - The in-shadow pointerdown allow-list adds `node === this.publishing || node?.dataset?.act === 'publish'`.
  - Escape check adds `|| !this.publishing.hidden`.
  - `hidePops()` adds `this.publishing.hidden = true;` and `this.$('[data-act="publish"]').setAttribute('aria-expanded', 'false');`.

- [ ] **Step 5: Methods** (after `loadShares`/`drawShares`):

```js
    // ------------------------------------------------------------ publishing

    /** The repository a path is in: the nearest folder at or above it that
     *  has its own `.git`, read off the tree. Null outside one, or before the
     *  tree has come. */
    repoOf(path) {
      if (!this.tree || !path) return null;
      let node = this.tree;
      let found = null;
      for (const part of String(path).split('/')) {
        node = (node.children ?? []).find((child) => child.kind === 'folder' && child.name === part);
        if (!node) break;
        if (node.repo) found = node.path;
      }
      return found;
    }

    /** The bar's Publish: there inside a repository, with a dot while
     *  something is unpublished. Asked again a moment after the drive changes,
     *  not on every keystroke's save. */
    drawGit() {
      const button = this.$('[data-act="publish"]');
      const repo = GIT && window.marble?.drive?.git ? this.repoOf(this.here) : null;
      button.hidden = !repo;
      if (!repo) {
        this.gitBar = null;
        return;
      }
      const fresh = repo !== this.gitBar;
      this.gitBar = repo;
      button.title = `Publish ${nameOf(repo)} to GitHub`;
      clearTimeout(this.gitDotTimer);
      this.gitDotTimer = setTimeout(() => this.refreshGitDot(repo), fresh ? 0 : 1500);
    }

    async refreshGitDot(repo) {
      try {
        const status = await window.marble.drive.git.status(repo);
        if (repo !== this.gitBar) return;
        this.$('[data-act="publish"]').toggleAttribute('data-dirty', Boolean(status.repo && (status.changed > 0 || status.ahead > 0)));
      } catch {
        // No dot is the honest answer when the drive cannot be asked.
      }
    }

    /** One popover for every way in: the bar, a folder's menu in the tree,
     *  and a document asking with `marble:publish`. It hangs from the bar's
     *  button when that button is this repository's, else from what opened it. */
    togglePublishing(path, anchor = null) {
      const opening = this.publishing.hidden || path !== this.gitPath;
      this.hidePops();
      if (!opening || !path) return;
      this.gitPath = path;
      const pop = this.publishing;
      pop.querySelector('h3').textContent = `Publish ${nameOf(path)}`;
      pop.querySelector('.msg').value = '';
      pop.querySelector('.result').hidden = true;
      this.drawPublishing(null);
      pop.hidden = false;
      const button = this.$('[data-act="publish"]');
      if (!button.hidden && this.hasAttribute('data-open') && path === this.gitBar) {
        button.setAttribute('aria-expanded', 'true');
        this.place(pop, button, 'right');
      } else if (anchor?.isConnected) {
        this.place(pop, anchor, 'left');
      } else {
        pop.style.left = '';
        pop.style.right = '16px';
        pop.style.top = `${BAR + 8}px`;
      }
      pop.querySelector('.msg').focus({ preventScroll: true });
      this.loadPublishing(path);
    }

    async loadPublishing(path) {
      const asked = (this.gitAsked ?? 0) + 1;
      this.gitAsked = asked;
      try {
        const status = await window.marble.drive.git.status(path, { fetch: true });
        if (asked === this.gitAsked && path === this.gitPath) this.drawPublishing(status);
      } catch (err) {
        if (asked === this.gitAsked) this.drawPublishing({ error: err?.message || 'Could not read this repository' });
      }
    }

    /** The popover as the repository is. `null` while it is being asked. */
    drawPublishing(status) {
      const pop = this.publishing;
      const $ = (selector) => pop.querySelector(selector);
      const state = $('.state');
      const list = $('.changes');
      const go = $('.publish');
      const web = $('.web');
      const last = $('.last');
      list.replaceChildren();
      $('.msg').placeholder = 'Message (optional)';
      if (!status || status.error || !status.repo) {
        $('.branch').textContent = '';
        web.hidden = true;
        last.hidden = true;
        go.disabled = true;
        state.textContent = !status ? 'Checking GitHub…'
          : status.error ? status.error
          : 'This folder is no longer a git repository.';
        return;
      }
      $('.branch').textContent = status.upstream ? `${status.branch} → ${status.upstream}` : (status.branch ?? 'not on a branch');
      web.hidden = !status.web;
      if (status.web) {
        web.href = status.web;
        web.textContent = `${status.web.replace(/^https:\/\//, '')} ↗`;
      }
      const files = status.files ?? [];
      state.textContent = status.behind > 0 ? 'GitHub has changes this folder doesn’t. Pull them in a terminal first.'
        : files.length ? `${files.length} ${files.length === 1 ? 'change' : 'changes'} not published`
        : status.ahead > 0 ? `${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'} waiting to push`
        : !status.upstream ? 'This branch has no upstream yet. Push it once with git push -u.'
        : 'Everything is published';
      if (status.fetched === false) state.append(h('span', 'quiet', ' Couldn’t check GitHub.'));
      const KIND = { new: 'New', changed: 'Changed', deleted: 'Deleted' };
      for (const file of files.slice(0, 8)) {
        const li = h('li');
        li.title = file.path;
        li.append(h('span', 'file', file.path), h('span', 'kind', KIND[file.change] ?? 'Changed'));
        list.append(li);
      }
      if (files.length > 8) list.append(h('li', 'more', `and ${files.length - 8} more`));
      if (status.message) $('.msg').placeholder = status.message;
      go.disabled = Boolean(this.gitBusy) || !status.upstream || status.behind > 0 || (!files.length && !(status.ahead > 0));
      last.hidden = !status.last;
      if (status.last) last.replaceChildren(`${status.ahead > 0 || files.length ? 'Last commit' : 'Last published'} ${whenOf(status.last.when)} · `, this.commitLink(status.last));
    }

    commitLink(last) {
      if (!last) return '';
      if (!last.url) return h('span', '', last.short);
      const a = h('a', '', `${last.short} ↗`);
      a.href = last.url;
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    }

    /** Publish, and say so where it was pressed: the button while it runs, the
     *  commit it made under it after, and the bar's label for a moment. If the
     *  popover was closed meanwhile, the answer comes as a toast. */
    async publishNow() {
      const path = this.gitPath;
      const pop = this.publishing;
      const go = pop.querySelector('.publish');
      const result = pop.querySelector('.result');
      const bar = this.$('[data-act="publish"]');
      const label = bar.querySelector('span');
      if (!path || this.gitBusy || go.disabled) return;
      this.gitBusy = true;
      go.disabled = true;
      go.textContent = 'Publishing…';
      result.hidden = true;
      result.removeAttribute('data-bad');
      if (path === this.gitBar) {
        bar.setAttribute('data-busy', '');
        label.textContent = 'Publishing…';
      }
      try {
        await window.marble.flush?.();
        const done = await window.marble.drive.git.publish(path, { message: pop.querySelector('.msg').value });
        const said = done.nothing ? 'Nothing to publish' : `Published to ${done.branch} · `;
        result.replaceChildren(said, ...(done.nothing ? [] : [this.commitLink(done.last)]));
        result.hidden = false;
        pop.querySelector('.msg').value = '';
        if (pop.hidden) this.say(done.nothing ? 'Nothing to publish' : `Published ${nameOf(path)} to ${done.branch}`, 3000);
        if (path === this.gitBar) {
          label.textContent = done.nothing ? 'Publish' : 'Published';
          clearTimeout(this.gitLabelTimer);
          this.gitLabelTimer = setTimeout(() => { label.textContent = 'Publish'; }, 3000);
          this.refreshGitDot(path);
        }
      } catch (err) {
        result.textContent = err?.message || 'Could not publish';
        result.setAttribute('data-bad', '');
        result.hidden = false;
        label.textContent = 'Publish';
        if (pop.hidden) this.say(err?.message || 'Could not publish', 8000);
      } finally {
        this.gitBusy = false;
        go.textContent = 'Publish';
        bar.removeAttribute('data-busy');
        go.disabled = false;
        if (!pop.hidden && path === this.gitPath) this.loadPublishing(path);
      }
    }
```

- [ ] **Step 6: Keep the bar current.** In `load()`, right after `this.tree = tree;` add `this.drawGit();`; in `load()`'s start, after `if (!this.tree) this.restore();` add `this.drawGit();` (the restored tree is enough to show the button at once).

- [ ] **Step 7: Sidebar mark.** In `branch(folder)`, after `this.glyph(b, child.path, 'folder');`:

```js
          if (GIT && child.repo) b.insertAdjacentHTML('beforeend', github('mark', 'Git repository'));
```

- [ ] **Step 8: Row menu.** Replace v1's `this.repos ??= new Map(); const publishable = …; const publish = …` with:

```js
      // A repository's folder offers Publish, which opens its popover.
      const publish = GIT && folder && drive?.git && this.repoOf(path) === path
        && ['share', 'Publish…', () => this.togglePublishing(path, subject.row), { pick: 'publish' }];
```
and delete v1's lazy probe at the end of `rowMenu` (`if (publishable && !this.repos.has(path)) { … }`) and v1's `publish(path)` method.

- [ ] **Step 9: Syntax and suite** — `node --check runtime/shell.js && npm test` → all pass (shell has no unit tests; the browser pass is Task 5).

- [ ] **Step 10: Commit** — `git add runtime/shell.js && git commit -m "Shell: Publish beside Share for a repository, its popover, and the mark in the tree"`.

---

### Task 4: The Drive page — the mark on repository folders and a toolbar chip

**Files:**
- Modify: `templates/drive.mrbl` (CSS near `.item .name`, the `ICON` block ~1518, `node(entry)` ~1678, `refresh()` ~2567)
- Modify: `templates/lineage/drive.json.gz` (regenerated)

**Interfaces:**
- Consumes: tree `repo: true` (Task 1); the `marble:publish` window event (Task 3); `script[data-git="1"]` (v1).

- [ ] **Step 1: CSS**, after `.item .name b { … }`:

```css
  /* A folder that is its own git repository wears GitHub's mark after its
     name, quietly; Publish is a chip in the toolbar while you are inside it. */
  .item .name .gh, .chip .gh { width: .85rem; height: .85rem; flex: 0 0 auto; color: var(--faint); }
  .chip .gh { color: inherit; }
```

- [ ] **Step 2: The mark and a test for publishing being on**, beside `ICON`:

```js
      // GitHub's own mark (Octicons mark-github), as the shell draws it.
      const GH = '<svg class="gh" viewBox="0 0 16 16" role="img" aria-label="Git repository"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';
      // Whether this drive publishes repositories: the host says so on the
      // shell's script tag. Read when drawing, by which time the tag is there.
      const gitOn = () => document.querySelector('script[data-git="1"]') !== null;
```

- [ ] **Step 3: The mark on items.** In `node(entry)`, after `el.querySelector('b').textContent = …;`:

```js
        if (entry.kind === 'folder' && entry.repo && gitOn()) el.querySelector('.name').insertAdjacentHTML('beforeend', GH);
```

- [ ] **Step 4: The chip.** Add beside `at()`:

```js
      /** The repository the folder on screen is in: the nearest folder at or
       *  above it with its own `.git`. */
      function repoAt(path) {
        let node = root;
        let found = null;
        for (const part of path ? path.split('/') : []) {
          node = (node?.children ?? []).find((child) => child.kind === 'folder' && leaf(child.path) === part);
          if (!node) break;
          if (node.repo) found = node.path;
        }
        return found;
      }

      /** Publish, in the toolbar, inside a repository. It asks the Drive's
       *  chrome for the popover by event; this page names no route. */
      function drawGitChip() {
        let chip = document.querySelector('#git');
        const repo = view === 'drive' && root && gitOn() ? repoAt(here) : null;
        if (!repo) {
          chip?.remove();
          return;
        }
        if (!chip) {
          chip = document.createElement('button');
          chip.className = 'chip';
          chip.id = 'git';
          chip.setAttribute('data-marble-transient', '');
          chip.innerHTML = GH.replace('role="img" aria-label="Git repository"', 'aria-hidden="true"') + '<span>Publish</span>';
          chip.addEventListener('click', () => dispatchEvent(new CustomEvent('marble:publish', { detail: { path: chip.dataset.repo } })));
          document.querySelector('#up').after(chip);
        }
        chip.dataset.repo = repo;
        chip.title = `Publish ${leaf(repo)} to GitHub`;
      }
```
In `refresh()`, after `drawCrumbs();` add `drawGitChip();`.

- [ ] **Step 5: Regenerate the lineage** — `node tools/app-lineage.mjs && node tools/app-lineage.mjs --check`.

- [ ] **Step 6: Suite** — `npm test` → all pass (includes `test/app-lineage.test.js` and the "a document names no route" test).

- [ ] **Step 7: Commit** — `git add templates/drive.mrbl templates/lineage/drive.json.gz && git commit -m "Drive: GitHub's mark on a repository folder, and Publish in the toolbar inside one"`.

---

### Task 5: Docs, the browser pass, and the release

**Files:**
- Modify: `docs/CARRIER-DRIVE.md` (the `git` row; `marble:publish`)
- Modify: `docs/HOSTING.md` ("Publishing a folder with git")
- Modify: `docs/superpowers/specs/2026-10-02-git-publish-popover-design.md` (mark is the 16-unit Octicon; status adds `message`)

- [ ] **Step 1: Docs.** CARRIER-DRIVE row becomes:
`| marble.drive.git.status(path, {fetch})` / `.publish(path, {message})` | a folder that is its own git repository: branch, upstream, what changed and how, the last commit and its GitHub link, and with `fetch` what GitHub has that it lacks; Publish commits (with `message`, or the automatic one) and pushes. Only where the drive has `MARBLE_DRIVE_GIT` on; 404 elsewhere. A page opens the Publish popover with `dispatchEvent(new CustomEvent('marble:publish', {detail: {path}}))` |`.
HOSTING section: replace "such a folder's menu in the sidebar has **Publish**: …" with: the folder shows GitHub's mark (tree on hover, Drive page after its name); inside it, **Publish** sits beside Share in the bar and in the Drive page's toolbar, opening a popover with the status (checked against GitHub when opened), the changed files, an optional message, and the result with a link to the commit.

- [ ] **Step 2: Browser pass.** Scratch drive with the Drive page, a git-backed folder and a bare remote, served from this worktree on port 4477 with `MARBLE_DRIVE_GIT=1`. Playwright with `executablePath: '/Applications/Chrome.app/Contents/MacOS/Google Chrome'`. Check and screenshot:
  1. tree: the mark appears on the repository row on hover, not on others;
  2. Drive page: the mark after the repository folder's name; inside it the Publish chip, which opens the popover;
  3. a document in the repository: bar button with a dot; popover shows "N changes not published", the file list with kinds, the placeholder message;
  4. press Publish: button "Publishing…", then "Published to main · <short>", the bar label "Published", the dot gone, the remote's main equals the folder's HEAD;
  5. behind: push from another clone, reopen: the pull sentence and a disabled button;
  6. light and dark (`emulateMedia({ colorScheme })`), and a 390px-wide viewport for the popover.

- [ ] **Step 3: Full suite and lineage check** — `npm test && node tools/app-lineage.mjs --check`.

- [ ] **Step 4: Commit** — `git add docs && git commit -m "Docs: Publish's popover, the marks, and marble:publish"`.

- [ ] **Step 5: Release (the owner runs it; it restarts the Mac's drives)** — from `~/Development/3rd-year-projects/marble-drive`: `tools/mac-release.sh --ref <HEAD of drive-git-publish>`.
