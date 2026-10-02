# Git repositories in the Drive: indicators and a Publish popover

Date: 2026-10-02 · Branch: `drive-git-publish` · Builds on `48e36a6` (Publish v1)

## Why

Publish v1 (a "Publish" item in a sidebar folder's right-click menu) works but
is invisible: nothing says a folder is a git repository, nothing shows what will
be published, and the only feedback is a toast. The owner edits a website
(`Portfolio/`, a repository that Vercel deploys on push) inside the Drive and
needs to see, at a glance and from wherever they are, that it is a repository,
what has changed, and whether it is published.

## Scope

In:

- A Publish popover in the shell's top bar, beside Share, opened from the bar,
  from the sidebar row menu, and from the Drive page's toolbar inside a
  repository folder.
- Indicators: a GitHub mark on hover in the sidebar tree, and a GitHub mark after
  a repository folder's name in the Drive page's grid and list.
- In the popover: status, the changed-file list, an optional commit message,
  Publish with its progress and result, and the last published commit.

Out (later): pull, commit history, cloning a repository into the Drive,
deploy status from the host (Vercel), per-folder status dots in the tree.

All of it is visible only where publishing is on (`MARBLE_DRIVE_GIT=1` and a
passphrase, as v1). Elsewhere nothing changes.

## Server

### Tree: `repo: true`

`store.list()` (`server/store/fs-store.js`) marks a folder entry `repo: true`
when the folder contains an entry named `.git` (file or directory: a worktree's
`.git` is a file). `walk()` already reads every folder's entries before filtering
dotfiles, so this costs no extra filesystem call. It is emitted whether or not
publishing is on; it is a fact about the folder, and the client decides what to
draw. Documented in the store contract (`server/store/index.js`).

### `GET /drive/git?path=&fetch=1`

Extends v1's status. Adds:

| Field | Meaning |
|---|---|
| `files` | `[{ path, change: 'new' \| 'changed' \| 'deleted' }]`, from `git status --porcelain -z` (rename counts as `changed` under its new path) |
| `last` | `{ commit, short, message, when (ISO), url }` for HEAD, or null on an unborn branch. `url` links to the commit on GitHub when the upstream remote is a GitHub URL, else null |
| `web` | the repository's page on GitHub (`https://github.com/<owner>/<repo>`), or null |
| `behind` | commits the upstream has that HEAD lacks; only when `fetch=1`, else null |
| `fetched` | whether a fetch was attempted and succeeded; `false` with `fetchError` when it failed |
| `message` | what a publish with no message would say, or null when nothing changed (the popover's placeholder) |

`fetch=1` runs `git fetch --quiet <remote>` with a 10 s limit before counting.
`changed` stays (the count) for v1 callers.

GitHub URLs recognised: `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`,
`ssh://git@github.com/o/r(.git)`. Credentials embedded in an https remote are
never returned.

### `POST /drive/git/publish { path, message? }`

`message`, trimmed, at most 500 characters, replaces the automatic
`Publish from Marble Drive: …` when non-empty. The response adds `last` (as
above) so the client can show the published commit and its link without a
second request.

## Shell (`runtime/shell.js`)

### The mark

GitHub's own mark (the 16-unit Octicon `mark-github`), filled with
`currentColor`, as `runtime/agent-ui.js` draws its brand marks. Drawn at 14 px in rows and 16 px in the
bar.

### Which repository a page is in

`repoOf(path)`: the nearest folder at or above `path` whose tree entry has
`repo: true`, or null. Read from `this.tree`, which `load()` keeps current.

### Top bar button

`<button class="ib git" data-act="publish" aria-haspopup="dialog" aria-expanded="false" hidden>`
placed before Share: the mark and the word "Publish", as text on the bare bar
(Design System: words, not capsules; the filled pill stays Share's). Shown when
`GIT` and `repoOf(this.here)`. A dot (`.git[data-dirty]::after`) when the last
status said there are changes or unpushed commits. While a publish runs, the
label is "Publishing…"; after success, "Published" for 3 s, then "Publish".
`.ib.git[hidden]` (and `.share[hidden]`) hide it despite `display:flex`.

### Popover

`<div class="pop publishing" role="dialog" aria-label="Publish" hidden>`, wired
the way `.sharing` is: `toggleSharing`'s twin `togglePublishing(path)`, the
in-shadow pointerdown allow-list, the Escape check, `hidePops()`, and
`place(pop, anchor, 'right')`. When opened from the sidebar or the Drive page,
it is anchored to the bar button if it is visible, else to the row.

Contents, top to bottom:

1. **Title** `Publish <folder name>`; under it, `<branch> → <upstream>` and the
   repository's GitHub link (`github.com/o/r ↗`) when `web` is set.
2. **Status**, one sentence:
   - `files.length` > 0: "2 changes not published"
   - none, `ahead` > 0: "1 commit waiting to push"
   - none, nothing ahead: "Everything is published"
   - `behind` > 0: "GitHub has changes this folder doesn't. Pull them in a terminal first." (Publish disabled)
   - `fetched === false`: append "Couldn't check GitHub." in muted text; Publish stays enabled.
   - While loading: "Checking GitHub…".
3. **Changed files**: one row each, the path relative to the repository and the
   change word (New / Changed / Deleted) in muted text; the ninth onward
   collapses to "and N more". Hidden when there are none.
4. **Message**: a one-line text field; placeholder is the automatic message.
5. **Publish** (the popover's one filled button). Disabled when there is
   nothing to publish, when behind, or while publishing. Pressing it flushes the
   page's pending edits (`marble.flush`), then calls publish with the message.
   While running: "Publishing…". On success: replaced by
   "Published to main · a1b2c3d ↗" (link to the commit), the message field
   cleared, the status re-read. On failure: the error in danger-coloured words
   under the button, kept until the popover closes.
6. **Footer**: "Last published <time> · a1b2c3d ↗" from `last`, using the
   existing `when()` helper.

Status is loaded with `fetch=1` each time the popover opens, guarded by a
sequence counter like `loadShares()`. The bar dot is refreshed from status
without fetch when a page opens in a repository and after each publish.

### Sidebar

- Folder rows with `repo: true` get `<svg class="mark">` (the GitHub mark) at
  the right (`margin-left:auto`), `opacity:0` until the row is hovered,
  focused, or holds its menu; always visible under `@media (hover:none)`. A
  glyph, not a button: the row stays one button.
- The row menu's "Publish" item opens the popover for that folder instead of
  publishing directly. It is shown from the tree's `repo` flag, so v1's lazy
  status probe and `this.repos` cache are removed.

### Opening from a document

The shell listens for `marble:publish` on `window` with `detail.path`; the
Drive page dispatches it. This is how a page asks the host's chrome to open
something without naming a route.

## Drive page (`templates/drive.mrbl`)

- **Grid and list**: in `node(entry)`, a repository folder (`entry.repo`) gets
  the mark after its name inside `.name`, in `--faint`, `aria-label` "Git
  repository".
- **Toolbar**: when the folder being shown is (or is inside) a repository and
  publishing is on, a transient chip "[mark] Publish" after `#up` dispatches
  `marble:publish` with that repository's path. Whether publishing is on is read
  from `script[data-git]`, the way `agent-callout.js` reads `data-home`.
- All new elements are `data-marble-transient` and drawn by script, so the merge
  forward into each drive's copy touches only new lines.
- After editing: `node tools/app-lineage.mjs`, and commit
  `templates/lineage/drive.json.gz` with the template.

Known limit: a drive whose `drive.mrbl` has drifted from its template may be
held by the merge, and then shows neither the grid mark nor the toolbar chip
until it is merged by hand (`marble-drive apps` lists held copies). The bar and
sidebar are host code and always update.

## Errors

- Fetch failure (offline, auth): status still answers, `fetched: false`.
- Publish failures keep v1's messages (rejected → "pull first"; no upstream →
  "push it once with git push -u"; auth → git's own line), shown in the popover.
- A status request for a folder that stopped being a repository answers
  `repo: false`; the popover says "This folder is no longer a git repository."

## Testing

- `test/git-publish.test.js`:
  - `files`, with each change type;
  - `last` (commit, message, time; `url` and `web` are null for the test's
    local bare remote, and the GitHub forms are covered by the parser test below);
  - `behind` after another clone pushes, with `fetch=1`;
  - `fetched: false` with an unreachable remote;
  - a custom message used;
  - an over-long message refused.
- `test/store-tree.test.js` (or the existing tree test): `repo: true` on a
  folder with `.git` (directory, and file), absent elsewhere.
- Unit test for the GitHub URL parser (https, scp-style, ssh, with credentials,
  non-GitHub).
- `npm test` and `node tools/app-lineage.mjs --check`.
- A real-browser pass (Playwright, `/Applications/Chrome.app`) against a scratch
  drive with a git-backed folder and a local bare remote: hover mark in the tree,
  mark in the Drive grid, bar button and dot, popover states (changes, nothing,
  publishing → published, behind, error), and the Drive toolbar chip opening the
  popover.
