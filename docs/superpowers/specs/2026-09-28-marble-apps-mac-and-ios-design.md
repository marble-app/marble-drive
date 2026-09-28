# Marble as apps: the Mac, then iOS

2026-09-28. **Status: thinking, not a plan.** Nothing here is built or scheduled.
It records the options, what each costs, and where they lead, so the first
implementation plan can be written from a decision rather than a hunch.

## What the owner asked for

- **A packaged Mac app**, simple enough to install on a second Mac (the
  MacBook Air) with no repo, no `sprite` login and no terminal. It should do three
  things: keep the Finder copy of the drive (`~/Marble Drive`, today a launchd job
  on one Mac, `tools/backup-agent.mjs`); open Marble's apps and documents as desktop
  windows; and preview documents in Finder (Quick Look).
- Decided in conversation: the windows are **windows onto admin-p1**, live, as
  the browser is now (not a Marble host running on the Mac), and the app is **for
  the owner first, built so friends can have it later** (no Fly login, pairing by
  code).
- **Then iOS.** The owner's worry, in their words: `.mrbl` files are HTML, but
  on iOS it is better to run them as Swift native apps, and keeping everything in
  sync across those is a big architectural challenge.

## What decides this: what a `.mrbl` is

From `../marble/SPEC.md`, the facts every option below has to live with:

1. **The file is the app.** A `.mrbl` is an HTML document holding its content,
   structure, style, *behavior* and the controls that change it. The owner's
   own apps (Drive, Agents, Chat, Board, Notes, Research Vision) are such files,
   and each person's copy is theirs to change (CLAUDE.md, Rules). In Marble
   content is code: the collaboration programme rejected any split between the two.
2. **"Any two hosts must render the same file identically"** (principle 3). A
   host provides reading and code-changing (the carrier surface, `window.marble`)
   and nothing else. It is "HTML, no build step" (principle 5), and that is
   load-bearing: a gesture can be a source edit only because the screen is the
   source.
3. **Edits are ops**, six of them (`setText`, `setInner`, `setAttr`, `insert`,
   `move`, `remove`), addressed by `data-marble-id`, spliced into the file by
   byte range (`patcher.js`, on parse5). The drive logs every op per document
   (`.marble/<doc>.ops.jsonl`) with `client`, `seq` and `t`, which is the
   roadmap's `k-ord` ("ops that can be ordered later").
4. **Whole-file writes become ops too.** `@bdhmin/marble/collab` compares two
   sources per id (`diffSources`) and, where two writers touched the same node,
   forks it into a `<marble-alt>` holding both (`mergeWrite`, `forkAlt`) instead
   of losing one. Conflict has a native representation in the format.
5. **Today there is one writer per drive**: the host on the sprite. Browsers
   send ops to it and hear changes back; agents write through it. Nothing edits
   a drive while offline.
6. **Much of a drive is not documents**: the file tree, blobs, conversations
   (`.marble/agents/*`, append-only JSON lines), `drive.json`, settings. Those are
   data behind host APIs, not HTML.

## The tension, stated plainly

A native renderer that does not run the document's own CSS and JavaScript is
not a Marble host. It is a second app with its own opinion of what the
document is, which is exactly what principle 3 forbids. Any "native" option
therefore has to be placed on one side of this line:

- **Documents** (anything that is a `.mrbl`, including the owner's own Drive and
  Agents pages) are code. Showing one faithfully needs a web engine that runs it.
- **The drive's own data** (files, folders, conversations, agents, sharing,
  backups, notifications, settings) is not code. Native clients of the host's API
  for it break nothing.

Two outside facts push the same way:

- **On iOS every web engine is WebKit.** Safari, Chrome and a `WKWebView` in our
  own app are the same engine. So "web on iOS" and "WebKit in a Swift app" are
  not different technologies; the difference is the shell around it.
- **App Store Review Guideline 2.5.2**, as I understand it, forbids an app
  from downloading code that changes its features, with an exception for
  JavaScript run by WebKit. In Marble, opening a document downloads code. A
  native renderer that executed document behavior some other way would be
  outside that exception; WebKit is inside it. (Check the current text before
  relying on this. Guideline 4.2, "minimum functionality", is the other one: a
  bare web wrapper can be rejected, and native surfaces are what answer it.)

## Two axes, kept apart

Every plan below is a choice on two independent axes. Mixing them up is what
makes this look harder than it is.

- **How a document is shown and edited** on a device (plans A–E).
- **How changes reach every device** (sync models S1–S3).

### How documents are shown: five plans

**A. Native shells around the live drive.** A Swift app with native chrome
(windows, Dock, tabs, menus, share sheet, notifications) whose document views
are `WKWebView`s showing admin-p1, exactly as a browser does. The host stays the
only writer. Offline, documents open read-only from the local copy.
- For: one engine for every document, every principle intact, smallest build,
  the same app model on Mac and iOS. Everything that works in Safari today works.
- Against: no offline editing. WebKit differs from the Chromium the tests run in.
  iOS `contenteditable` (keyboard, selection, the caret traps already met in
  `lib/affordances.js`) is where WebKit hurts most.

**B. The app is a Marble host (a carrier in Swift).** As A, but the app holds a
local replica of each document and applies ops itself: it injects `window.marble`
into the `WKWebView` and splices ops into its own copy of the file. The patcher is
parse5 (pure JavaScript), so the app can run the same `patcher.js` in
JavaScriptCore rather than write a second HTML parser in Swift, keeping "two
hosts render identically" true by using the same code.
- For: offline editing, with no loss of fidelity. This is the roadmap's G4
  ("local-first, desktop, agent as peer"), and the op log was shaped for it.
- Against: needs sync model S2 (below), which is the real work. The app becomes
  a second place writes happen, so every guarantee the sprite's host makes has
  to hold on the phone too.

**C. Native apps for the drive's data, web for documents.** SwiftUI for what
is not a document: browsing and searching files, conversations with agents,
asks and notifications, sharing, pairing, backups. Documents open in A (or B).
- For: native where native matters most on a phone (lists, search, chat, the
  keyboard for chat, background notifications, widgets, the Files app), with
  no second renderer for any document. Answers guideline 4.2.
- Against: the owner's Drive and Agents *pages* are documents they have
  customized; a native file browser does not carry those customizations. The
  native views are views of the data, beside the pages, not replacements for
  them. Two ways to see one drive is a design cost to manage.

**D. Native rendering from a declared model.** Documents that opt in declare
their data (a board's cards, a note's blocks) in a schema, and the app ships
SwiftUI renderers for known kinds that edit the same ids through ops.
- For: fully native feel for those kinds.
- Against: each kind is implemented twice and will drift; the document is no
  longer the whole app (principle 2); an agent can reshape a document's behavior
  but can never reshape a native renderer (content is code stops being true on
  the phone); and a new kind needs an app update. **Rejected**, except as a
  question to revisit if one kind (notes, say) proves worth a hand-built native
  editor.

**E. A native reading-and-writing lens.** SwiftUI reads the semantic HTML of
any document (headings, paragraphs, lists, tables, images) for fast native
reading, and edits only the nodes the document itself marks editable
(`data-marble-editable`), emitting `setText` / `insert` / `move` / `remove` by
id. It declares itself a lens, as Reader mode does, not a host.
- For: native text editing and dictation for quick capture, on any document,
  offline if paired with S2, and honest about what it is. The affordances
  the file already declares say what may be edited.
- Against: the document's look and behavior are absent in the lens; a second
  way to edit means a second set of bugs.

### How changes reach every device: three models

**S1. One writer (today).** Every write goes to the host on the sprite, which
orders it, splices it and tells every open view. Devices keep copies only to
read. Simple and already correct; offline is read-only.

**S2. A replicated op log (local-first).** Each device holds replicas (the
file and its op log) and writes to them offline, stamping ops with its own
`client` and `seq`. When it can reach the host it sends the ops it has not had
acknowledged and receives the ones it missed (`oplog.since()`, written and
unused). The host is the **sequencer**: it puts ops in one order, applies them
with the patcher, and returns the canonical order, which the device replays onto
its copy of the file. Because ops name ids, not offsets, most concurrent ops do
not interfere. When two devices touched the same node, the host forks it into a
`<marble-alt>` holding both (the existing `mergeWrite` behavior) instead of
choosing. What it still needs:
- ids minted offline must not collide (random ids, checked on arrival);
- rules for structural pairs (`move` against `remove` of an ancestor, `insert`
  under a removed parent), each written down and tested;
- replaying canonical order onto a device's optimistic local state (rebase);
- non-document data: conversations are append-only and merge by union; blobs
  are immutable; `drive.json` and settings are small and last-write-wins.

**S3. A CRDT for the tree (Yjs, Automerge).** The document's source of truth
becomes a CRDT and the HTML a rendering of it. **Rejected**: the file stops being
the app, byte-identical splices and legible diffs go, and hand editing (principle
4) becomes an import.

### The combinations worth having

| | S1 one writer | S2 op log |
|---|---|---|
| **A** shells | the Mac app, phase 1; the first iOS app | pointless (A has no local writer) |
| **B** host in the app | pointless (B exists to write locally) | **G4**: offline Mac and iOS |
| **C** native data views | with A: the iOS app that passes review | with B, later |
| **E** lens | online capture on the phone | offline capture |

## Recommendation

1. **Build the shared foundation first**, which every combination needs: device
   pairing and keys on the host, a sync manifest and file endpoints, a change feed,
   and the checkpoint-on-sync the Mac copy uses. The Mac app and the iOS app are
   two clients of it.
2. **Mac app, phase 1: A + S1**, the design below. It answers what was asked for
   and commits to nothing that a later B would have to undo.
3. **iOS, first version: A + C + S1.** WebKit views of the live drive for
   documents, native SwiftUI for files, chat, notifications, sharing and
   backups, and the drive's copy in the Files app. Online editing, read-only
   offline. This is the version that respects the format, passes review, and
   feels native where a phone most needs it.
4. **G4 (B + S2) when offline editing earns it.** The foundation for it is
   already laid (op log with `client`/`seq`, id-addressed ops, conflict as
   `<marble-alt>`); the missing pieces are named in S2. Running `patcher.js` in
   JavaScriptCore keeps the phone and the sprite on one implementation.
5. **E, possibly, for quick capture on the phone**, after A + C is in use and
   there is evidence people want to write on the phone without the document's
   own interface.
6. **Not D.**

The owner's instinct ("iOS is better as Swift native apps") is right about
the drive and wrong only about documents: make the drive native, keep documents
as documents. The synchronization challenge is real, but it is the challenge of
offline writing (S2). It is not caused by HTML, and it does not arise until B.

## The Mac app, phase 1 (A + S1)

The design discussed on 2026-09-27, kept here as the part closest to a plan.

- **Grow `Marble.app`** (`macos/finder-helper`, Swift, today: opens `.mrbl` from
  Finder and previews them in Quick Look). Swift because Quick Look, and later a
  File Provider (a real Finder sidebar entry with on-demand files), must be.
  Electron was considered: same engine as the tests and reuse of the Node sync
  code, but ~150 MB and a second toolchain for the extensions.
- **Pairing, not a Fly login.** The Console's Backups view gets **Add a Mac**:
  a short code valid for minutes. The app trades it for its own device key.
  The key signs its windows in (it is exchanged for the gate's cookie), so there is
  no passphrase prompt. The Console lists paired Macs, their last sync, and
  **Remove**.
- **Windows.** Drive, Agents, Chat, Board and any document as real windows:
  Dock, ⌘-Tab, windows restored at launch, a `.mrbl` double-clicked in Finder opens
  live. When admin-p1 cannot be reached, a document opens read-only from the copy
  under a banner that says how old it is.
- **The Finder copy** keeps today's layout (`~/Marble Drive` → `~/Marble
  Backups/<utc>/`, `.marble/sync.json`), but is fetched over admin-p1's own URL
  with the device key instead of `sprite exec` and rsync: a manifest (path,
  size, time), then the files that differ, hard-linking the rest from the copy
  before.
- **When it syncs.** Without Fly credentials the app cannot ask whether the
  drive is asleep without waking it (any request to a sprite wakes it). So:
  while a window is open (the drive is awake anyway), after 10 quiet minutes and
  at most hourly, as now; when the last window closes; at launch; and every few
  hours regardless, each check costing about a minute of the drive being awake,
  which is what catches long agent runs with no window open. The launchd job on
  the MacBook Pro is retired, so two Macs never report as one.
- **History on Fly**: admin-p1 makes the checkpoint itself when a sync begins
  (its Console holds the Sprites CLI); a friend's drive skips it and relies on
  Marble's own history.
- **Several Macs**: each reports under its own device; one is marked primary
  and alone makes checkpoints and carries out restores, so nothing is done twice.
- **Packaging**: one `.app` from a build script, in a `.dmg`. Unsigned by an
  Apple Developer ID for now, so the first open on the Air is right-click → Open.
  Developer ID ($99/year), notarization and auto-update come with friends.

## Host work both apps need

- `server/devices.js`: pairing codes (minted behind the gate, minutes long),
  device keys (stored hashed in `.marble/devices.json` with name, platform,
  created, last seen), revocation; bearer auth for `/sync/*`, and a trade of the
  key for the gate cookie so app windows are signed in.
- `server/sync.js`: `GET /sync/manifest` (every file but the ledger, the Console's
  files and the host lock, with size and time; an ETag of the newest change, which
  the host's watcher already knows), `GET /sync/file`, and `POST /sync/begin`
  (makes the Fly checkpoint where the drive can).
- A change feed over the existing event stream, so an open app hears "changed"
  instead of polling.
- The Console's Backups view reads devices and syncs from the host itself (it
  sees them happen), rather than from a report a Mac leaves.
- Later, for S2: `POST /ops` with `client`/`seq` and `GET /ops?since=`.

## Risks

- **WebKit parity.** Marble is tested in Chromium. Run the browser suites under
  Playwright's WebKit before either app ships, and treat what breaks as bugs in
  the pages, since Safari users meet them already. `moveBefore` is one
  Chromium-only API in use: the owner's live Drive page (its tiles view) calls it
  where it exists and falls back where it does not, which is the pattern to hold
  every page to.
- **The iOS keyboard in `contenteditable`**: the part of A most likely to feel
  bad on a phone, and the case for E.
- **Waking the sprite.** Every request from an app wakes it. The sync schedule
  above is built around that; iOS background refresh (a few times a day at the
  system's discretion) happens to fit it.
- **A device key reads the whole drive.** Revocation from the Console on day one;
  keys stored in the Keychain; never in the drive.
- **Review and accounts**: an Apple Developer account for Developer ID (Mac) and
  the App Store (iOS); 2.5.2 and 4.2 as above.
- **Two ways to see the drive (C)**: the native file browser and the owner's own
  Drive page will disagree about layout and customizations. Say which is which.

## Open questions for the owner

1. For iOS, is offline editing needed in the first version, or is read-only
   offline enough until G4?
2. Is "native for the drive's data, web for documents" the split you meant, or
   were there specific documents (notes? the board?) you wanted native? That is
   the one place D or E might be worth their cost.
3. Should the iOS app be the owner's alone first (TestFlight) or go to the
   testers at once? That decides whether review rules bite in version one.
4. An Apple Developer account: when?
