# The drive is its own space, not part of the app

2026-09-22. Status: design, awaiting review.

## Why

Marble Drive is two things that share one checkout: the **app** (this
repository: the host, the runtime, the templates, the tests) and a **drive** (a
person's documents, their history, their choices). Two guarantees follow from
keeping them apart, and today neither fully holds:

1. **A fresh install starts with its own space.** Someone who clones the repo
   and runs it gets an empty drive of their own, not the owner's setup: no
   `/my-day` in their `/` menu, no "Bryan's Days" in their folder colours, no
   `/today` pointing at a folder they do not have, no installer aimed at
   someone else's laptop.
2. **Using Marble never makes a git change.** Everything a person builds is
   tracked by Marble's own history (`<drive>/.marble/`), never by this
   repository. Developing the app is git work in the repo; using the drive is
   not.

This is not about anonymity: the `bdhmin` package scope, bundle ids, and names
in docs and comments stay.

## Where the drive lives

- **A development machine (the owner's MacBook): `<repo>/drive`, unchanged.**
  `MARBLE_DRIVE_ROOT` keeps defaulting to `<cwd>/drive`, and `drive/` stays
  gitignored. Nothing on this machine moves.
- **Production: a root-level folder, set explicitly.** Fly already sets
  `MARBLE_DRIVE_ROOT=/data` (`fly.toml`, `Dockerfile`, `docker-compose.yml`).
  A Sprites machine sets `MARBLE_DRIVE_ROOT=/drive` in its launch environment
  when that deploy is written (it is not in the repo yet). The default is for
  development; production never relies on it.

## What breaks the guarantees today

- **The owner's setup ships to everyone.**
  - `server/agent/index.js` lists skills from the repo's `.claude/skills`, so
    `/my-day` (16 tracked files) is offered to every install.
  - `templates/drive.mrbl` and `runtime/agent-folders.js` hard-code the owner's
    top-level folders (`Research`, `Fun`, `Bryan's Days`, `Marble`, `Travel`)
    as realms.
  - `server/config.js` defaults `latestDoc` to `"Bryan's Days/today"`.
  - `macos/finder-helper` defaults to the owner's drive path and Tailscale host
    (`install.sh`, and hard-coded in `AppMain.swift`).
- **An agent working in the drive is inside the app's git repository.** With
  the drive at `<repo>/drive`, a Drive-project turn's `git status` or
  `git commit` finds the `marble-drive` repo and acts on the app.
- **The app's own agent skills only reach agents by accident.** A Drive-project
  turn runs in `<repo>/drive` and picks up skills from the checkout around it.
  On a production machine, where the drive is not inside a checkout, it would
  get none of them.
- **Tooling rewrites tracked files.** `test-results/` (17 tracked PNGs) is
  rewritten by `tools/visual-shots.mjs`; `.codex/hooks.json` is tracked despite
  being ignored; `.sprite` names the owner's deploy org.

## Design

Three homes, each with one owner:

| Home | Holds | Tracked by |
|---|---|---|
| The app (this repo) | host, runtime, templates, starters, the app's own agent skills, tests | git |
| The drive (`<repo>/drive` in development, `/data` or `/drive` in production) | documents, `.marble/` history, the owner's skills, the drive's settings | Marble |
| The machine | `.env.local`, launchd, the Finder helper's install | nothing (gitignored or outside the repo) |

### 1. An agent in the drive cannot reach the app's repository

For every turn whose project is the Drive, the runner adds
`GIT_CEILING_DIRECTORIES=<parent of the drive root>` to the agent's
environment. Git stops its search for a repository before it reaches the
checkout, so from inside the drive `git status` reports "not a git repository"
and a commit cannot land in the app. Turns in a registered project (such as the
owner's "Marble Drive" development project) are unchanged: that is where
developing the app belongs.

This guards against accident, not intent. A full-capability agent can still
`cd` out of the drive; the point is that nothing an agent does *in the drive*
becomes a git change.

*Verified 2026-09-22 (probe turn from `<checkout>/drive`):* Claude walks up
and loads the checkout's `.claude/skills` (it listed `my-day` and
`visuals-in-chat`), but not `.agents/skills`. The checkout has no `CLAUDE.md`,
and its `.claude/settings.json` only sets worktree isolation. Moving both skills
out of the repository's `.claude/skills` (sections 3 and 4) is therefore what
stops a drive inheriting them; `.agents/skills/<name>` stays as symlinks into
the plugin so Cursor, which may read that folder, is unchanged.

### 2. The drive's settings: `<drive>/.marble/drive.json`

A small JSON file for choices that belong to a drive rather than to a machine
or to one document. Optional; a missing or unreadable file is `{}`.

```json
{
  "realms": { "Research": "research", "Bryan's Days": "days" },
  "latest": "Bryan's Days/today"
}
```

- `realms`: top-level folder → realm key. The shipped template and
  `runtime/agent-folders.js` start with `{}` and merge this in. The host serves
  it (gated, like every route) at `GET /drive/settings`; the Drive template and
  the Agents page read it once at load.
- `latest`: the document `/today` opens. Precedence: `MARBLE_DRIVE_LATEST_DOC`,
  then `drive.json`, then the newest document (today's fallback when the target
  is missing). `config.latestDoc`'s default becomes `null`.

No UI writes it in this change; the row-menu tint keeps working as the
per-folder colour override. The owner's live `drive.mrbl` keeps its own `DAYS`,
`VISION` and `REALMS` constants and is not changed by this section.

*Decided:* under `.marble/` rather than a visible document, so it travels and
is backed up with the drive but never shows in a listing. The config.js warning
about files in the drive applies to secrets; nothing here is one.

### 3. The owner's skills live in the drive

- The host lists skills from `<drive>/.claude/skills` and
  `<drive>/.agents/skills`, the app's plugin (`agent-plugin/skills`, section
  4), and `~/.claude/skills` and `~/.agents/skills` as now, and **no longer
  from the repo's own `.claude/skills` or `.agents/skills`**, which are for
  developing the app.
- A Drive-project turn runs with the drive as its working directory, so Claude
  finds these skills on its own; the host's list only fills the `/` menu before
  a turn reports the CLI's own list.
- `/my-day` moves to `<drive>/.claude/skills/my-day` (on this machine,
  `<repo>/drive/.claude/skills/my-day`, inside the ignored drive), with its
  `state/` folder, so the `.claude/skills/my-day/state/` ignore line goes away.
  Its paths lose their `drive/` prefix, because the working directory is now
  the drive; `.claude/skills/my-day/lib/build.mjs` is the same relative path
  from there. Its tests (`test/day-story.test.js`,
  `test/my-day-authors.test.js`, `test-browser/day-story.test.js`) move with it
  and run by hand, the rule already used for tests of drive documents. The
  browser test finds the host's harness through `MARBLE_DRIVE_REPO`. The repo's
  `.agents/skills/my-day` symlink is removed.
- The day-runner button in the owner's live `drive.mrbl` changes
  `data-project="Marble Drive"` to the Drive project.

### 4. The app's own skills travel with the app

`visuals-in-chat`, `genui-author`, `growing-the-open-page` and `typesafe-ai` are
the product's skills, not the owner's. They move into a plugin folder,
`agent-plugin/` (`.claude-plugin/plugin.json` named `marble-drive`, and
`skills/<name>/`), and the Claude provider passes
`--plugin-dir <repo>/agent-plugin` on every full turn. Agents get them wherever
the drive is, including on a production machine where the drive is not inside
a checkout. Plugin skills are namespaced (`marble-drive:visuals-in-chat`);
`server/agent/instructions.js` and the `/` menu use the namespaced names.
Cursor and Codex turns are unchanged. The `Dockerfile` copies `agent-plugin/`
into the image (it copies directories one by one, so this is a line of its
own).

A skill the person asks an agent to make is theirs, so it belongs in their
drive. The Drive-project instructions in `server/agent/instructions.js` say so
in one line: a new skill goes in `<drive>/.claude/skills/<name>/`, never in
`~/.claude/skills` or the app's repository.

### 5. Nothing machine-specific is tracked

- `test-results/`, `.codex/` and `.sprite` are removed from the index and
  ignored.
- `macos/finder-helper/install.sh` requires `MARBLE_DRIVE_ROOT` and
  `MARBLE_DRIVE_HOST` (no defaults) and writes them into the helper's
  `Info.plist` (`MarbleDriveRoot`, `MarbleDriveHost`); `AppMain.swift` reads
  them from there instead of hard-coding them.
- Browser tests of the live drive document (`drive-days-almanac`, `day-run`,
  `drive-trash`, `drive-file-previews`, `drive-drop-files`) find it through
  `MARBLE_DRIVE_DOC`, else `MARBLE_DRIVE_ROOT`, else `<repo>/drive`, and skip
  when it is absent.

### 6. Dropped files on a production host

Moved to `2026-09-22-files-in-a-cloud-drive-design.md`: pictures the page
draws for images, PDFs and video on any host, resumable uploads, the upload
cap and free-space check, and what stem splitting and machine size need in
production.

### 7. Guards

- A fresh host on an empty temporary root seeds a drive whose Drive and Agents
  documents name no owner folders, whose skill list (with an empty temporary
  `HOME`) is exactly the app's plugin skills, and whose `/today` falls back to
  the newest document.
- A Drive-project turn's environment carries `GIT_CEILING_DIRECTORIES` set to
  the drive root's parent; a registered-project turn's does not.
- End to end, with the drive inside a temporary git repository standing in for
  the checkout: boot, seed, write a document, upload a file, and run a scripted
  agent turn that runs `git status` from the drive. The turn sees no
  repository, and the outer repository's `git status --porcelain` is unchanged.

## Milestones

1. **Host.** Sections 1, 2, 3 (skill listing only), 4 and 7, and the probe in
   section 1. Tests green. No owner data moves.
2. **Repo hygiene.** Section 5.
3. **`/my-day` leaves the repo.** Copy it into the owner's drive, update its
   paths, move its tests, remove it from the repo, and repoint the day-runner
   button in the live `drive.mrbl` (one write with the host stopped, per the
   serve-host rule). Check that `/my-day` still appears and runs from a Drive
   conversation.

## Out of scope

- Moving the owner's drive. It stays at `<repo>/drive` on the MacBook.
- The Sprites deploy itself. This spec only fixes what it must set
  (`MARBLE_DRIVE_ROOT=/drive`).
- Rewriting git history. The owner's files remain in the public history.
- Renaming the `@bdhmin/marble` package or the `com.bdhmin.*` bundle ids.
- Multi-tenant hosting (`MARBLE_DRIVE_DATA`), which already keeps drives
  outside the repo.
- A settings UI for `drive.json`.
- **History for files that are not documents (follow-up).** Marble's history
  records `.mrbl` documents only (`server/store/fs-store.js`: "a file that is
  not a document has no history"). A person's skills and dropped files are
  saved in their drive and included in its backups, but an edit to one cannot
  be undone through Marble. That needs its own design.
