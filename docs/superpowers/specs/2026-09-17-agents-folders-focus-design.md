# Agents Folders and Focus — design

> Status: **approved to build**, 2026-09-17. Continues the Agents page
> (`2026-09-16-agent-interface-design.md` §11, `2026-09-17-agents-panes-design.md`).

Same UIST warm / Dusk tokens. No new npm dependencies. Node 22. Do not
reparent the file’s `<marble-conversation>` (reconcile would clone it).

## 1. What we are building

Agents gains two views beside List and Board.

**Folders** is a vertical tab strip of conversations. A folder is a tab
group. Opening a group shows those chats as today’s panes.

**Focus** is a spatial canvas of rounded rectangular windows. You pin
chats to Full; the rest ease through Digest into Chip. Folder membership
shows as colored basins. The same folder catalog drives both views.

List and Board do not change, except the view switcher has four items and
`V` cycles all four.

## 2. Decisions locked in design

| Topic | Decision |
|---|---|
| Membership | Exclusive. A conversation has one `folderId` or `null` (ungrouped). |
| Focus size | Pin to Full. Not pointer fisheye. Geometry eases; content snaps at three LODs. |
| Views | `List \| Board \| Folders \| Focus` in the existing `.seg.views`. `V` cycles that order. |
| Persistence | Folder catalog, membership, pins, and Focus positions are stored with conversations. |
| Folders chrome | Vertical tabs. Groups on top. Ungrouped last. **New chat** under ungrouped. No New-folder button. |
| How folders start | Drag tab onto tab; Shift/Cmd-select then Save as folder; drop a tab into a folder’s pane gallery. |
| Last member | Dragging the last tab out **dissolves** the folder. Undo recreates it. |
| Focus groups | Basins (tint + name), not a second tab strip. |
| Digest copy (v1) | Title, target, `activity` / `lastOutcome`, running vs needs-review. No extra model call. |

## 3. Principles

1. **Select is not focus.** A click highlights. Layout only changes on
   Focus (double-click / Enter / Keep open) or on a membership gesture.
2. **Folders are born from chats.** There is no empty “New folder”
   control. A working set of panes can exist before anyone names a folder.
3. **One fact, one place.** Membership is `meta.folderId`. Name, color,
   order, and which members are live panes live in `folders.json`. The
   Agents file still does not store conversation rows.
4. **The seeded conversation node does not move.** Extra live threads are
   `data-marble-transient` `<marble-conversation>` elements, same as dock
   extras today. At most four live conversations.
5. **Motion is interruptible.** Drag is 1:1 from the grab point. Settle
   uses critically damped springs from the live transform (`damping 1.0`,
   `response 0.4`). Ease-out for non-gesture layout (view switch, LOD
   crossfade). `prefers-reduced-motion`: 150 ms opacity, no travel.
6. **Same tokens as Drive.** Folder color is a Drive realm key, not a
   new palette.

## 4. View chrome

`body[data-view]` is `library` | `board` | `folders` | `focus`.

The segmented control grows two buttons: **Folders** (`data-view="folders"`)
and **Focus** (`data-view="focus"`). Pressed state is derived from
`body[data-view]`, same as today.

`localStorage` key `marble-agents:view` accepts the four names. Unknown
or missing → `library`. `V` cycles `library → board → folders → focus →
library`. First `V` from List is still Board, so existing tests stay
true.

CLI and filter segments still apply. Search still filters.

Narrow (`max-width: 719px`) and reduced-motion keep today’s 150 ms
crossfade between views. Folders on narrow: tab list, then one
conversation sheet, no extra panes. Focus on narrow: a vertical stack of
cards (no pack, no basins as free 2D). Extra panes stay disabled when
narrow or reduced-motion, same as the panes spec.

## 5. Folders view

### 5.1 Sidebar

A left rail `.folder-rail` (transient list chrome, like `#list`):

```
▼ Research            ← group header (color tick, editable name, count)
    outline spec      ← conversation tab
    figure pass
▼ CHI
    draft
── ungrouped ──       ← label + drop target, always last, even if empty
    leftover
+ New chat            ← always last control; not a folder
```

Group headers reorder by dragging. Ungrouped cannot move among groups.
New chat cannot be dragged.

Click a **group header** → that folder’s workspace (panes of `openIds`,
capped at four). Click a **tab inside a group** → that folder is active
and that chat is the focused pane (added to `openIds` if under the cap,
else it replaces the focused extra). Click an **ungrouped tab** → that
conversation alone in the workspace, not a multi-pane group.

### 5.2 Workspace

Reuse `.pane` and the existing dock (split on edge drop, swap on header,
gutter resize, at most four live). `openIds` on the folder is the durable
stand-in for today’s `localStorage` dock extras **while that folder is
open**. Ungrouped / unsaved working set still uses the page dock key.

Empty folder cannot be created on purpose. A dissolved group leaves
ungrouped chats.

Two members: open as a split. Six members: four most recently in
`openIds` as panes; the other two stay as tabs in the group.

### 5.3 Creating and moving groups

**Drop a tab on another tab.** If the target is ungrouped, create a
folder containing both (server picks name + unused color). An outline and
background in that color ease around both tabs. If the target is already
in a folder, the dragged chat **joins** that folder.

**Shift-click / Cmd-click.** Shift-click is range select in the rail.
Cmd-click (Ctrl-click) toggles one tab. When the selection has two or
more chats, they tile immediately as a **working set** (`workingSetIds`).
A non-blocking menu: suggested name, color tick, **Save as folder** /
**Not now**. Not now keeps the panes; membership is unchanged.

**Drop a tab onto the pane gallery.** It splits in as a pane (same
0.22 edge hit as today). If the gallery is a saved folder, the chat
joins that folder and `openIds`. If it is only a working set, it joins
the set and the Save menu remains.

**Drop into the ungrouped block** → `folderId = null`. If that was the
last member, dissolve the folder.

**Drop into another group** (header or its tab list) → join that folder.

**New chat** (`+ New chat` and the topbar New) creates an ungrouped
conversation and opens it.

### 5.4 Name and color

On create, if the client omitted `name` / `color`:

- **Name** is the most specific shared path segment of the members’
  `target`s. Three chats on `Research/Marble/…` become `Marble`. No
  shared segment → `Group`. Trim to 40 characters.
- **Color** is the Drive realm of the first path segment (`Research` →
  `research`, `Fun` → `fun`, `Bryan's Days` → `days`, `Marble` →
  `marble`, `Travel` → `travel`) if that key is not already used by
  another folder; otherwise `nextColor(used)` walks

  `research, fun, days, marble, travel, clay, sage, mist, ink, gold`

  and picks the first unused. Recycle from the start only if all are
  taken, skipping the current set still if a later key is free; if none
  are free, pick the first key (collision allowed only then).

The group header name is `data-marble-editable` in spirit but **must not
file an op** (it is not document content). Blur / Enter PATCHes the
folder name. A color button on the header opens a palette of those ten
keys; picking PATCHes `color`.

### 5.5 Delete

There is no separate “delete folder” in v1. Dissolving by emptying it is
the path. One-level **undo** on the page (Mod+Z) restores the last
create / join / leave / dissolve. Not a server undo log.

## 6. Focus view

### 6.1 Cards

Every matching conversation (same search / CLI / filter as List) is a
rounded rectangular **window** (`.focus-card`, radius 12px, hairline
`var(--line)`, small gap 8px). Never circles.

Three **levels of detail**. Size eases. Inner content crossfades at the
midpoint of the size change so a composer is never shown crushed.

| LOD | When | Shows |
|---|---|---|
| **Full** | In the pinned set (`meta.pinned`) | Window chrome + live `<marble-conversation>` |
| **Digest** | Default rest for unfocused chats | Goal (title + target), status, key changes (`activity` / last outcome) |
| **Chip** | Cold **and** over the Digest budget | Title, model tick, folder color on the leading edge |

### 6.2 Select vs pin

Spatial gestures live on the card chrome. Clicks inside a Full
transcript stay with the thread (same `typingIn()` idea as `V`).

| Gesture | Result |
|---|---|
| Click | Select immediately. No layout wait for a second click. A Chip peeks to Digest. |
| Shift-click / Cmd-click | Add to / toggle selection. |
| Double-click card or header, or Enter | Selection becomes Full. Other Fulls demote to **Digest**, not Chip. |
| Shift-double-click, or **Keep open** on a Digest/Chip header | Add to Full without demoting current Fulls. |
| Escape | Close Quick Look if open; else demote a selected Full to Digest; else clear selection. |
| Double-click a Full | Does **not** collapse. Collapse is Escape or the header control. |

Cap: four Fulls, the live-conversation cap. Adding a fifth Keep-open
demotes the least recently interacted Full (`lastInteractedAt`).

Hovering Digest/Chip chrome shows **Focus** (exclusive) and **Keep open**
(add). Those are real `<button>`s, visible on `:hover` and
`:focus-within`, and on `hover: none` they stay available in the header.

### 6.3 Digest → Chip

Not a silent wall-clock on every card.

A card stays Digest if it is Full, selected, hovered, running, or
needs review.

Otherwise it **cools**. `CHIP_COOL_MS` is 45 seconds since
`lastInteractedAt` while Focus is the visible view. When the number of
Digest cards besides Fulls exceeds `DIGEST_BUDGET` (4), the coldest
cool Digests become Chip, coldest first.

Hover or select a Chip → Digest again (peek). A demotion in progress is
interruptible: pointer on the card cancels it.

`lastInteractedAt` updates on select, Quick Look, pin, drag release, and
any turn activity already reflected in `updatedAt` (use `max(lastInteractedAt, updatedAt)` when computing cold).

### 6.4 Keyboard

Only when Focus is the view and `typingIn()` is false (canvas, not
composer / search / editable name).

| Key | Result |
|---|---|
| Arrows | Move selection to the nearest card in a 90° cone in that direction. No wrap. Layout unchanged. |
| Shift+arrow | Add that neighbor to the selection. |
| Enter | Focus the selection (same as double-click). |
| Space | Quick Look the primary selection. |
| Escape | Layered dismiss, §6.2. |

### 6.5 Quick Look

Space opens a transient overlay (`data-marble-transient`): a large
read-only preview of that thread (title, target, status, recent events
from `GET /agent/conversations/:id`). It does not pin, does not demote
other Fulls, and does not persist.

Space again, Escape, or a click on the canvas closes it. The card
returns to the LOD it had. With Quick Look open, arrows move selection
and the preview follows (Finder). Enter from Quick Look pins that chat
Full and closes the overlay.

Space is ignored when `typingIn()` (never steals spaces from a prompt).
If the selected card is already Full and the canvas is focused, Space
is a no-op. Multi-select: preview the primary (last clicked or last
arrowed) only.

Do not mount a second live composer in Quick Look. Do not reparent the
file conversation into the overlay.

### 6.6 Pack and drag

No physics library.

While dragging, the grabbed card tracks 1:1 from the grab point
(pointer capture, ~10px hysteresis before a click becomes a drag).
Neighbors ease out of the way.

On release, run **separation**: treat each card as its LOD rectangle,
push overlapping pairs apart along center-to-center until the gap is
8px or 40 iterations, clamp to the canvas with rubber-band
(`overshoot * dimension * 0.55 / (dimension + 0.55 * |overshoot|)`
during the drag past an edge; on release clamp inside). Then spring
each card from its live position to that slot (independent X and Y,
`damping 1`, `response 0.4`). Write `focusX` / `focusY` (canvas-relative
0..1 so resize does not dump the layout).

Missing coordinates: pack from LOD order (Fulls upper-center, Digests
middle, Chips along the trailing/bottom edge).

Z-order: dragging on top, then Full, Digest, Chip.

### 6.7 Basins

Each folder is a padded bounding box around its cards: fill
`color-mix(in srgb, var(--folder) 14%, var(--paper))`, edge
`color-mix(in srgb, var(--folder) 28%, var(--line))`, name on the pad
(editable, same PATCH as the Folders header). Ungrouped cards have no
pad.

- Drop **into** a basin → join that folder.
- Drop onto **empty canvas** → ungrouped (dissolve if last member).
- Drop **onto another ungrouped card** → new folder, same as tab-on-tab.
- Header **folder chip**: menu of folders, Ungrouped, Save as folder.

Clicking a basin name selects every card in that folder. It does not
change pins.

Focus does not repeat the Folders tab strip.

### 6.8 Live conversation placement

The seeded `<marble-conversation>` stays a child of `.pane`.

In Focus, if there is at least one Full, `.pane` is **positioned** (CSS
`position: absolute` + the primary Full frame’s box) to fill the
primary Full window. Extra Fulls are transient conversation elements
inside those cards, same as dock extras.

Leaving Focus clears the inline positioning and restores `.pane` to the
library/board/folders grid. The keyed node is still in `.pane`.

## 7. Data model

### 7.1 Catalog — `.marble/agents/folders.json`

```json
{
  "folders": [
    {
      "id": "a1b2c3d4e5f6",
      "name": "Marble",
      "color": "research",
      "order": 0,
      "openIds": ["c1c1c1c1c1c1", "c2c2c2c2c2c2"]
    }
  ],
  "workingSetIds": []
}
```

`id` is 12 lowercase hex, same as conversations. `openIds` is at most
four, and every id must currently have `folderId` equal to this folder.
Unknown ids are dropped on read. `workingSetIds` is the unsaved pane
gallery.

Ungrouped is not a row. It is every conversation whose `folderId` is
null.

### 7.2 Conversation meta

New fields on `meta.json` / `createConversation`:

| Field | Default | Meaning |
|---|---|---|
| `folderId` | `null` | Exclusive folder id, or ungrouped. |
| `pinned` | `false` | Full in Focus. |
| `focusX` | `null` | 0..1 canvas X, or pack-from-scratch. |
| `focusY` | `null` | 0..1 canvas Y. |
| `lastInteractedAt` | `createdAt` | Cooling clock. |

`summarize` already spreads `meta`, so listings include these fields.

### 7.3 HTTP

Allowlist additions on `PATCH /agent/conversations/:id`:

- `folderId`: `null` or a 12-hex id that exists. Unknown id → 400.
  Setting it to another folder moves the chat (exclusive). Setting null
  ungroups. After the write, if the previous folder has no members,
  dissolve it (delete the catalog row).
- `pinned`: boolean.
- `focusX`, `focusY`: finite numbers, stored clamped to `[0, 1]`, or
  `null`.
- `lastInteractedAt`: ignored from the client. The server sets it to
  `Date.now()` whenever `folderId`, `pinned`, `focusX`, or `focusY`
  is in the patch, and on existing activity updates.

`GET /agent/folders` → `{ folders, workingSetIds }`.

`POST /agent/folders` `{ conversationIds, name?, color? }` → 201 folder.
Requires at least one existing conversation id. Assigns exclusive
membership, computes name/color if omitted, appends `order` at the end,
sets `openIds` to the first four ids. Publishes each conversation
`summary` and a `folders` event.

`PATCH /agent/folders/:id` `{ name?, color?, order?, openIds? }`.
`openIds` max four, must be members. `color` must be a known key.
`name` trim, 40 chars, empty rejected.

`DELETE /agent/folders/:id` → ungroup members, remove row, 200
`{ removed: true }`.

`PUT /agent/folders/working-set` `{ ids }` → store `workingSetIds`
(existing conversation ids only).

### 7.4 Hub and `window.marble.agent`

The `*` EventSource already listens for `summary`. Also listen for
`event: folders` with body `{ folders, workingSetIds }`. `hub.publish`
gains `publishFolders(payload)` that writes that event to `*` listeners.

`window.marble.agent` grows:

```
folders()
createFolder({ conversationIds, name, color })
updateFolder(id, patch)
deleteFolder(id)
saveWorkingSet(ids)
```

`update(id, patch)` already PATCHes a conversation; the new fields ride
along. The page never names a route.

## 8. Motion and accessibility

- View switch (four ways): existing FLIP for List ↔ Board when the
  conversation nodes move; Folders/Focus are different shells, so those
  switches are 200 ms ease-out opacity (150 ms under reduced motion).
- Folder outline forming: 200 ms ease-out on background and border.
- LOD size: spring, §3.5. LOD inner swap: 150 ms opacity at the
  midpoint.
- All icon-only controls have `aria-label`. Group header is a
  `<button>` (open) plus an editable name field. Tabs are `<button
  role="treeitem">` or a simple list of buttons; the rail is
  `role="tree"` if nested, otherwise a labeled list. Prefer a labeled
  list of groups (`role="list"`) over a full tree if the tree ARIA
  gets in the way of drag. Keyboard in Folders rail: arrows move among
  tabs, Enter opens, the same `typingIn()` guard as `V`.
- `:focus-visible` rings use the existing accent treatment.
- `prefers-reduced-transparency`: basin fills become solid
  `var(--paper-2)`, no mix.
- Do not autoplay motion. Springs only follow a gesture or a pin.

## 9. What we are not building

- Nested folders.
- Pointer-fisheye sizing.
- Multi-file Quick Look gallery.
- LLM-generated folder names or Digest summaries.
- Overwriting an already-seeded `Agents` document (seed-once stays).
  Template changes apply to new drives and to browser tests that inject
  `templates/agents.mrbl`. A live drive copy is updated only by editing
  that file or replacing it by hand.
- Changing List or Board beyond the four-way switcher and `V`.
- New npm dependencies.

## 10. Files

| Unit | Responsibility |
|---|---|
| `runtime/agent-folders.js` | Pure helpers: realm map, `nextColor`, `suggestName`, `lodFor`, `nearestCard`, `packSlots`, `separateRects`. Browser: `window.marbleAgentFolders`. Node tests import it. |
| `server/agent/store.js` | `folders.json` read/write, meta fields, dissolve-if-empty. |
| `server/agent/routes.js` | Folder HTTP, PATCH allowlist, `folders` SSE. |
| `server/agent/hub.js` | `publishFolders`. |
| `runtime/agent.js` | Client methods in §7.4; `on('*')` also delivers `folders` events. |
| `server/app.js` | Inject `/runtime/agent-folders.js` when agents are on, as a classic script like `agent.js`. The file is an IIFE that assigns `globalThis.marbleAgentFolders` (window in the browser). Node tests `import` it for the side effect, then read `globalThis.marbleAgentFolders`. |
| `templates/agents.mrbl` | Four views, Folders rail + workspace, Focus canvas. |
| `docs/AGENTS.md` | Document Folders and Focus. |

## 11. Testing

Store and helpers: `node:test` next to `test/agent-store.test.js`,
`test/agent-folders.test.js`.

HTTP: extend `test/agent-http.test.js`.

Browser: extend `test-browser/agents-page.test.js` and add
`test-browser/agents-folders.test.js`, `test-browser/agents-focus.test.js`
using `test-browser/harness.js`. Cover:

- Four-way `V` cycle; first `V` from List is Board; view is not filed.
- Create folder by dropping one tab on another; color unused; name from
  target path.
- Shift-select two tabs → panes + Save; Not now does not set `folderId`.
- Drop last member into ungrouped → folder gone.
- Focus: click selects without pinning; double-click pins; other Fulls
  become Digest.
- Space opens Quick Look without pinning; Enter from it pins.
- Arrow keys move selection; reduced-motion: no transform travel.
- Narrow: no extra panes, Focus is a stack.
- Seeded `<marble-conversation>` still in `.pane` after visiting Focus.

Do not bind or stop port 4400.
