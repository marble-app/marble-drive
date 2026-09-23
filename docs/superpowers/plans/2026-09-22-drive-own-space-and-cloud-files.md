# Drive's own space + files in a cloud drive: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh install starts with its own empty drive and nothing done in a drive becomes a git change; files of any kind and size upload reliably and show a picture on any host.

**Architecture:** Owner choices move into the drive (`.marble/drive.json`, `<drive>/.claude/skills`); the app's skills ship as a plugin passed with `--plugin-dir`; Drive-project agent turns get `GIT_CEILING_DIRECTORIES`. Pictures are drawn by the page in `runtime/drive.js` (shared by the template and the live Drive document) and kept by the host beside QuickLook's; big uploads go through resumable chunked sessions in a new `server/uploads.js`.

**Tech Stack:** Node 22 (`node:test`), Playwright (test-browser harness), plain browser JS, pdf.js 4.10.38 from jsdelivr.

**Specs:** `docs/superpowers/specs/2026-09-22-drive-is-its-own-space-design.md`, `docs/superpowers/specs/2026-09-22-files-in-a-cloud-drive-design.md`

**Workspace:** worktree `.claude/worktrees/drive-own-space`, branch `drive-own-space`, `node_modules` symlinked to the main checkout's. The running host serves the main checkout, so nothing here is live until merged and the host restarted.

## Global Constraints

- Development drive stays at `<repo>/drive` (`MARBLE_DRIVE_ROOT` default `<cwd>/drive`); production sets `/data` (Fly) or `/drive` (Sprites).
- `drive.json` lives at `<drive>/.marble/drive.json`; missing or unreadable is `{}`.
- Plugin folder `agent-plugin/`, plugin name `marble-drive`.
- Drawn pictures: 640 px wide, WebP q 0.8, PUT body ≤ 512 KB, ≤ 1280 px long side, WebP or PNG only.
- Chunk size 32 MB (`MARBLE_DRIVE_UPLOAD_CHUNK` overrides, for tests); sessions swept after 24 h idle; free-space margin 1 GB; default cap `MARBLE_DRIVE_MAX_FILE` 20 GB.
- Retry backoff 1, 2, 4, 8, 16 s, then the file fails as retryable.
- Never write the live `drive/drive.mrbl` while the host runs (markup changes are reverted); never restart the host without asking.

## Deviations from the specs, decided while planning

- **pdf.js from jsdelivr, pinned 4.10.38**, not vendored by the host. The browser loads it, not the host, so a production host still needs no outbound access; adding an npm dependency here would write into the `node_modules` the live host shares. If it cannot load, the tile keeps its glyph.
- **Drawn pictures are keyed like QuickLook's** (path, modified, bytes), so a moved file is redrawn lazily rather than its picture being moved. Old pictures are orphaned in `.marble/thumbs/`, as QuickLook's already are.
- **Drawing lives in `runtime/drive.js`** (`drive.drawThumb`), and `uploadFile` draws after a successful upload, so the two Drive documents only need a two-line hook in `mountFile`.
- **Stem splitting needs no code**: `GET /stems` already answers `ready`, and Mashup Studio already hides splitting when it is false.
- **The Agents page does not colour by realm** (only a unit test calls `realmOf`), so `agent-folders.js` just stops naming the owner's folders.

## Review Focus

- A `drive.json` that is malformed JSON, or has `realms` as a non-object: the host must answer `{}`-shaped settings, not 500.
- A second drop of the same file after a reload, but into a different folder: must start a new upload, not resume the old session.
- A chunk retried after the host already stored it (answer lost): the 409 path must continue from the host's `received`, never duplicate bytes.
- A file whose picture draw fails (unsupported codec, corrupt PDF): the tile keeps its glyph and nothing is posted.
- A Drive-project turn whose drive is *not* inside a git repo (production): setting `GIT_CEILING_DIRECTORIES` must be harmless.

---

## Part A: the drive is its own space

### Task A1: drive settings and `/today`

**Files:** Create `server/drive-settings.js`; modify `server/config.js` (latestDoc default), `server/app.js` (`/today`, `GET /drive/settings`), `runtime/drive.js` (`settings()`); test `test/drive-settings.test.js`.

**Interfaces:** Produces `readDriveSettings(marbleDir) → Promise<{ realms: Record<string,string>, latest: string|null }>`; route `GET /drive/settings` answers that object; `marble.drive.settings()` in the page resolves it (or `{ realms: {}, latest: null }` on any failure).

- [ ] Failing tests: missing file → `{ realms: {}, latest: null }`; malformed JSON → same; `realms` non-object or non-string values dropped; `latest` non-string → null; `/drive/settings` serves the file; `/today` precedence env > drive.json > newest document; `loadConfig({}).latestDoc === null`.
- [ ] Implement; run `node --test test/drive-settings.test.js test/server.test.js`.
- [ ] Update `test/server.test.js`'s `/today` test (it seeds "Bryan's Days/today" and relies on the old default) to set `latest` in drive.json.
- [ ] Commit.

### Task A2: no owner folders in the shipped Drive

**Files:** Modify `templates/drive.mrbl` (REALMS `{}` filled from `drive.settings()` before the first draw), `runtime/agent-folders.js` (`REALMS = {}`, `realmOf(path, realms = REALMS)`), `test/agent-folders.test.js`; browser test `test-browser/drive-realms.test.js`.

- [ ] Failing browser test: a drive with `drive.json` `{ realms: { Research: 'research' } }` and folders `Research`, `Days` → `Research` tile has `data-realm="research"`, `Days` has none; a drive without drive.json → no `data-realm` anywhere; `grep "Bryan"` of the template source finds nothing.
- [ ] Implement: `let REALMS = {}`; at boot `await drive.settings()` then assign, before the first `refresh()`.
- [ ] Update the agent-folders unit test to pass the map.
- [ ] Run both tests; commit.

### Task A3: Drive-project turns cannot reach the app's git

**Files:** Modify `server/agent/runner.js` (after `const env = …`); test `test/agent-runner.test.js`.

- [ ] Failing test: a full turn in the built-in Drive project spawns with `env.GIT_CEILING_DIRECTORIES === path.dirname(root)`; a registered-project turn has no such key; a documents turn has none.
- [ ] Implement: `if (capability === 'full' && project?.builtIn) env.GIT_CEILING_DIRECTORIES = path.dirname(project.path);`
- [ ] Run `node --test test/agent-runner.test.js`; commit.

### Task A4: the app's skills as a plugin; the owner's from the drive

**Files:** Create `agent-plugin/.claude-plugin/plugin.json`; `git mv` `.claude/skills/visuals-in-chat`, `.agents/skills/genui-author`, `.agents/skills/growing-the-open-page`, `.agents/skills/typesafe-ai` into `agent-plugin/skills/`; remove the `.claude/skills/typesafe-ai` symlink; modify `server/agent/skills.js` (`skillDirs({ home, root, plugin })`), `server/agent/index.js` (call site), `server/agent/providers/claude.js` (`--plugin-dir` on full turns), `server/agent/instructions.js` (namespaced skill names; one line on where a new skill goes), `Dockerfile` (`COPY agent-plugin ./agent-plugin`); tests `test/agent-skills.test.js`, `test/agent-provider-claude.test.js`.

**Interfaces:** `skillDirs({ home, root, plugin }) → string[]` in order: `<root>/.claude/skills`, `<root>/.agents/skills`, `<plugin>/skills`, `<home>/.claude/skills`, `<home>/.agents/skills`. `PLUGIN_DIR` exported from `server/agent/skills.js` = `<repo>/agent-plugin`. Plugin skills are listed with id `marble-drive:<name>`.

- [ ] Failing tests: skillDirs order and no repo dirs; plugin skills listed namespaced; a full Claude spawn includes `--plugin-dir <PLUGIN_DIR>`, a documents spawn does not; Drive instructions mention `.claude/skills/<name>` for new skills.
- [ ] Implement; `grep -rn "visuals-in-chat" server runtime templates` updated to the namespaced name where it names the skill to the agent.
- [ ] Run the two test files plus `test/agent-catalog.test.js`; commit.

### Task A5: guards

**Files:** Create `test/fresh-drive.test.js`, `test/drive-git-boundary.test.js`.

- [ ] `fresh-drive`: `createDrive` on an empty temp root with `HOME` pointed at an empty temp dir: seeded Drive and Agents documents contain no `Bryan`; `listSkills(skillDirs(...))` ids are exactly the plugin's; `/today` redirects to the newest document.
- [ ] `drive-git-boundary`: temp dir `git init` as the "checkout", drive at `<it>/drive` (gitignored there), boot, seed, write a document, upload a file, run `git status` from the drive with the runner's env rule applied (spawn `git status` with `GIT_CEILING_DIRECTORIES=<checkout>`): exit code 128 "not a git repository"; outer `git status --porcelain` shows only the `.gitignore` commit state (clean).
- [ ] Run; commit.

### Task A6: nothing machine-specific tracked

**Files:** `.gitignore`; `git rm --cached -r test-results .codex .sprite`; `macos/finder-helper/install.sh`, `Info.plist`, `Preview-Info.plist` (keys), `AppMain.swift`; `test-browser/{drive-days-almanac,day-run,drive-trash,drive-file-previews,drive-drop-files}.test.js` (live doc resolution helper in `test-browser/live-drive.js`).

**Interfaces:** `liveDriveDoc() → string|null` path: `MARBLE_DRIVE_DOC`, else `<MARBLE_DRIVE_ROOT or <repo>/drive>/drive.mrbl`.

- [ ] install.sh: fail with usage when `MARBLE_DRIVE_ROOT` or `MARBLE_DRIVE_HOST` is unset; write both into the installed app's Info.plist with `plutil -replace`. AppMain.swift reads `Bundle.main.object(forInfoDictionaryKey:)`.
- [ ] Live-doc tests use `liveDriveDoc()`; run them (they skip or run as before).
- [ ] Commit.

### Task A7 (at merge, with the host stopped): `/my-day` leaves the repo

- [ ] Copy `.claude/skills/my-day` (with `state/`) to `drive/.claude/skills/my-day`; drop the `drive/` prefix from paths in its SKILL.md and lib; move `test/day-story.test.js`, `test/my-day-authors.test.js`, `test-browser/day-story.test.js` into its `test/` folder (harness via `MARBLE_DRIVE_REPO`).
- [ ] `git rm -r .claude/skills/my-day .agents/skills/my-day`; drop the state ignore line.
- [ ] Write `drive/.marble/drive.json` with the owner's realms and `latest: "Bryan's Days/today"`.
- [ ] Patch the live `drive/drive.mrbl` day-runner `data-project` to the Drive project (host stopped).

## Part B: files in a cloud drive

### Task B1: the host keeps drawn pictures

**Files:** Modify `server/thumbs.js` (`put`, drawn-first `get`, `imageSize`), `server/app.js` (`PUT /drive/thumb`, content type by answer), `server/config.js` (`MARBLE_DRIVE_QUICKLOOK` switch for tests); tests `test/thumbs.test.js`, `test/server.test.js`.

**Interfaces:** `thumbs.put(file, bytes) → Promise<{ type }>` throws `{ status: 400 }` on bad input; `thumbs.get(file, want) → Promise<{ at, type } | null>` (drawn first, then QuickLook); `imageSize(buf) → { type: 'png'|'webp', width, height } | null`.

- [ ] Failing tests: PNG and WebP (VP8, VP8L, VP8X) sizes parsed; put rejects > 512 KB, non-image, > 1280 px; stored picture served by GET with `image/webp`; a changed modified time misses; QuickLook still used when nothing drawn.
- [ ] Implement; run; commit.

### Task B2: the page draws pictures

**Files:** Modify `runtime/drive.js` (`drawThumb`, called after `uploadFile` success), `templates/drive.mrbl` (`mountFile` error path calls `drive.drawThumb`); browser test `test-browser/drive-drawn-pictures.test.js`.

**Interfaces:** `marble.drive.drawThumb({ path, ext, v, file = null }) → Promise<string|null>`: an object URL of the drawn picture after it was stored, or null when the kind cannot be drawn. At most two draws at once.

- [ ] Failing browser test on a host with QuickLook off: dropping a PNG, a PDF (fixture generated in the test) and a WebM (recorded with MediaRecorder from a canvas in the page) → each tile gets an `.fp-img`; a second page shows it from `/drive/thumb` with no draw (count PUTs); a `.xyz` file keeps its glyph and posts nothing.
- [ ] Implement drawing: images via `createImageBitmap`; video via `<video muted preload=metadata>` seek; PDF via `import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs')`.
- [ ] Run; commit.

### Task B3: upload sessions and the cap

**Files:** Create `server/uploads.js`; modify `server/app.js` (routes, sweep timer, Content-Length check on the single route), `server/config.js` (20 GB default, `uploadChunkBytes`, free-space margin); test `test/uploads.test.js`.

**Interfaces:** `createUploads({ store, dir, maxBytes, chunkBytes, freeBytes, now })` → `{ start({ folder, name, bytes, modified }), append(id, offset, stream), status(id), finish(id), cancel(id), sweep() }`; errors carry `status` (413, 507, 409 with `received`, 404).

- [ ] Failing tests: assembles byte for byte across chunks; wrong offset 409 with `received`; retried chunk after a lost answer continues; finish early refused; cancel and sweep leave no part or JSON; cap 413 and free-space 507 at start; nothing half-arrived listed; single route refuses a too-large `Content-Length` up front.
- [ ] Implement; run with `test/server.test.js`; commit.

### Task B4: the page uploads in resumable chunks

**Files:** Modify `runtime/drive.js` (`uploadFile` chunks above the host's chunk size, retries, 409, localStorage resume, `onState`), `templates/drive.mrbl` (row shows "reconnecting…", failed-retryable rows keep their files and the card offers Retry; "Drop *name* again to finish it" for remembered sessions); browser test `test-browser/drive-resumable-upload.test.js`.

- [ ] Failing browser tests (host with `MARBLE_DRIVE_UPLOAD_CHUNK=65536`): a 1 MB file whose third chunk request is aborted once shows reconnecting then completes byte for byte; a reload after two chunks plus a second drop of the same file finishes from the host's `received` (count chunk PUTs); the same file dropped into another folder starts fresh.
- [ ] Implement; run with `drive-drop-files.test.js`; commit.

### Task B5 (at merge, with the host stopped): the live Drive document

- [ ] `tools/patch-cloud-files.py` applies B2's `mountFile` hook and B4's tray changes to `drive/drive.mrbl`; run it with the host stopped; verify by reading back.

## Finish

- [ ] Full `npm test`, and the browser files touched here.
- [ ] Whole-branch review.
- [ ] With the owner: stop the host, merge, A7, B5, start the host, verify `/today`, the Drive, an upload and a picture.
