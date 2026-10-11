# The callout: summon an agent at a region of the document you are reading

**Date:** 2026-09-19
**Status:** design, approved in chat 2026-09-19
**Scope:** `runtime/agent.js`, new `runtime/agent-callout.js`, `runtime/collab.js`, `runtime/agent-ui.js`, `server/app.js` (injection only), `templates/agents.mrbl` (one `?open=` reader), `docs/AGENTS.md`, `docs/CARRIER-DRIVE.md`, tests

## 1. The problem

Bryan wants agents that are *directable* and *portable*: standing in a document,
he selects a region, calls an agent in, says what he wants, and watches it work
there. Today the plumbing for that exists but the person's half of the gesture
does not.

What exists (and this design does not rebuild):

- `marble.agent.select(ids)`, `aim(path)`, `send(id, {prompt, selection})`. The
  runner slices the selected elements' HTML into the prompt as
  `- They selected these elements:` (`server/agent/runner.js`, `composePrompt`).
- The construction zone. At turn start `look()` defaults its ids to
  `turn.context.selection`, so the agent's violet box lands on exactly what the
  person selected. The label carries `Agent · <clause>`, **Open chat**, **Hide**.
- The chat's `Building here` row that jumps back to the zone.
- One conversation store, read by the drawer and by the Agents page through
  `window.marble.agent`. A conversation is one object in four views.
- Per-turn undo, asks, forks, `needsReview` / `markReviewed`.

What is missing:

1. **Selection is two ids at most.** `runtime/agent.js` maps only the anchor and
   focus elements of a native selection. A selection across five paragraphs
   sends two of them.
2. **There is no composer at the region.** `<marble-conversation>` lives only in
   the drawer or an Agents pane. To brief an agent about *this* you leave *this*.
3. **Nothing on the page says "an agent was asked about this and here is what
   happened."** The zone disappears when the turn ends. What changed, and
   whether you have looked at it, is only in the chat.

## 2. The model in one sentence

The callout is the **fifth view of a conversation**: the same conversation
object the Agents page shows in four views, drawn in situ at the region it is
about. Id is identity. Every transition, callout to drawer to Agents pane and
back, is "same chat, different place."

Two other models were considered and set aside for v1:

- **The portable pin** (drag a chat out of the drawer onto a region). Folded in
  as *which chat answers the summon* (§4.3) rather than a new drag gesture, for
  which the drive has no motion vocabulary.
- **Documents on the Focus stage** (a document as a pane beside chats). Heaviest
  option, and it inverts the good default: bring the agent to the document, not
  the document to the agent.

## 3. Vocabulary

- **Summon**: the gesture that opens a callout at a selection.
- **Callout**: the anchored card holding a `<marble-conversation>` in its
  `callout` chrome. It has three states: **handle** (a disc at the selection,
  before any chat exists), **card** (open, composer showing), **pill** (folded,
  one line: dot + title).
- **Trail**: the thin violet edge left on elements an agent turn changed, until
  the chat is marked reviewed.

Everything the callout draws is `data-marble-transient` chrome in a fixed layer
appended to `<html>`, like the zone layer. No document is edited to get it, and
no document names it.

## 4. Design

### 4.1 Selection: every addressed element in the range

`runtime/agent.js` replaces the two-id mapping with `idsInRange(range)`:

1. **Candidates**: elements with `data-marble-id` that `range.intersectsNode(el)`
   is true for, excluding `<html>`, `<body>`, and anything inside
   `[data-marble-transient]` or a shadow root.
2. **Leaves**: candidates with no candidate descendant.
3. **Coalesce upward**: for a leaf's nearest candidate ancestor `P`, if the range
   fully contains `P` (both boundary points of `P` are inside the range), `P`
   replaces every candidate under it. Repeat until nothing coalesces. A fully
   selected list becomes the list's id; three paragraphs selected out of a
   section stay three paragraphs.
4. Result in document order.

The `selectionchange` listener stores this as `remembered`. Existing behaviour
is kept: a collapsed selection clears it, focus moving into transient chrome
does not touch it, `select(ids)` still overrides it (`chosen`), and
`context().selection` is what travels.

**Pick mode.** Holding **Option** (`altKey`) over the page turns the pointer into
a picker. The callout layer draws a violet outline on the nearest addressed
block under the pointer (`pointer-events: none`, so the page is untouched). A
click while Option is held toggles that element in the picked set and calls
`marble.agent.select(picked)`; the click is stopped before the page sees it.
**Escape** clears the picked set. A new non-collapsed native selection also
clears it, so the two never disagree about what is selected. Option is already
Marble's pick modifier: the Drive listing's lasso is Option-drag.

### 4.2 Summon: a handle at the selection, and ⌘J

When `context().selection` is non-empty and the pointer is up, a **handle**
appears: a 22px disc in the agent's violet, hung off the bottom-left corner of
the selection's common ancestor, exactly where the zone's own label will hang
once a turn starts. It appears after the selection has been still for 180ms and
disappears the moment the selection collapses or the pointer goes down again.
Position and flip (above when the target is at the foot of the window) use the
same rule as the zone's label.

Clicking the handle opens the callout card there. **⌘J with a live selection
does the same**; with no selection ⌘J keeps toggling the drawer. The drawer's
key handler asks first: it dispatches a cancelable `marble-callout:summon` event
on `window`, and if the callout layer took it (`preventDefault`) the drawer does
nothing. The layer takes it only when there is a selection and a callout can be
drawn here.

The layer draws nothing on a page carrying
`<meta name="marble-agent" content="custom">` (the Agents page hosts its own
conversation UI) and nothing when `marble.agent` is absent (agents off).

**Phone.** At the drawer's phone width (≤719px) there is no anchored card: the
handle still appears, and tapping it opens the drawer with the selection
attached, which the composer already shows as its `N selected` control.

### 4.3 Brief: the card is a real conversation

The card is a fixed-position container in the callout layer holding a fresh
`<marble-conversation data-chrome="callout" project="drive">`. It is never a
moved element; the Agents page's rule that a `<marble-conversation>` is never
reparented holds here too, and the card owns its own.

Width `min(440px, 100vw − 24px)`. Placement: below the selection's common
ancestor, left edges aligned; above it when the ancestor's bottom is within
40px of the window's bottom; clamped inside the window. It repositions on scroll
and resize and follows its target the way the zone does. It is drawn in the top
layer (`popover`), since a document's own stacking contexts would otherwise sit
over it.

**Callout chrome** (`data-chrome="callout"` in `runtime/agent-ui.js`):

- The mast is hidden except its tags row, so the model and target read once.
- The composer is complete: chips, attachments, saved setups, CLI / Project /
  Model / Effort pickers, dispatch, mode. Picking a registered project makes the
  turn a coding turn with that repository as its working directory; that is how
  "fix the code behind this" works with no new mechanism.
- The log is **folded** to a **ticker**: one line, the text of the latest log
  entry (an agent line, a tool call, or a status), ellipsised. Clicking the
  ticker unfolds the log to `max-height: min(50vh, 360px)`; clicking the fold
  arrow folds it again. An ask unfolds the log by itself, because an ask needs
  an answer.

**Which chat answers.** Default: a new conversation, created on first send by
the component's own path (`api.start` when the `conversation` attribute is
missing). The card offers one alternative in its header: **Continue in
<title>**, shown when `marble.agent.current()` names a conversation that is not
archived and not running. Choosing it sets the component's `conversation`
attribute to that id before the send. This is the "portable" agent: the chat you
were in follows you to the new region with its memory intact.

**The send.** The component's `submit()` reads `api.context()`, which already
carries `viewing`, `target: marble.app`, and `selection`. Nothing new travels.
The turn record keeps `context.selection`, which is what §4.6 rebuilds from.

### 4.4 Watch: the callout becomes the zone's label

On send, the turn's `look()` draws the zone on the selection. The callout card
then **docks** to the zone: the card's anchor becomes the zone's target element
and the zone's own label pill is suppressed for that conversation, so there is
one object on the page, not a pill and a card saying the same thing. The card's
header shows what the label would have: the live dot and `Agent · <clause>` from
the zone's `phase`/`note`, which arrive on the conversation's SSE stream as the
`zone` event the mast's `Building here` row already consumes.

While the turn runs:

- The ticker shows the latest log entry.
- Every op the agent applies flashes its element (existing) and adds a
  **trail**: class `marble-trail` on the element, a 2px violet inset rule on the
  left edge (`box-shadow: inset 2px 0 0 var(--zone-mark)`), so layout does not
  move. `runtime/collab.js` owns the trail, keyed by client, fed from the
  `marble:ops` event it already handles.
- If the agent writes in another document, the zone event's `path` differs from
  `marble.app`, and the header reads `Building in <path>` with the existing jump.
- An ask renders inline; the log unfolds.

### 4.5 Finish: changed, undo, done

On `turn.completed` (and `failed`, `cancelled`, `interrupted`) the header's
status becomes an **end row**:

    Changed 4 elements · Undo · Done

- The count is the number of distinct ids in `marble:ops` events whose client
  is `agent:<id>` during the turn, counted by the callout layer. Zero changes
  reads `No changes · Done`. A failed turn reads `Failed · Done` and the log
  unfolds so the error is visible.
- **Undo** calls the existing per-turn `marble.agent.undo(turnId)` for the last
  undoable turn, then the row re-reads.
- **Done** calls `marble.agent.markReviewed(id)`, clears that conversation's
  trail, and removes the callout. Seeing it and saying done is reviewing it,
  the same rule the Focus pane uses.

### 4.6 The callout persists, and rebuilds itself

The card has a **fold** control (×) that collapses it to a **pill**: dot,
title, hung where the card was. Clicking the pill reopens the card. Folded
callouts are remembered per tab in `sessionStorage` under
`marble-callout-folded:<app>`; dismissed ones (Done) need no memory because
`markReviewed` is the memory.

On load the layer **rehydrates**: it lists conversations, keeps those with
`target === marble.app` that are not archived and are `running`, `asking`, or
`needsReview`, fetches each one's turns, takes the last turn's
`context.selection`, and if those ids resolve on the page it draws a callout
there, as a pill unless the conversation is running or asking, in which case it
is a card. At most six callouts are rebuilt, newest first. A conversation whose
selection no longer resolves draws nothing; the drawer still lists it.

Live: the layer subscribes to `marble.agent.on('*')`. A `user` event whose
`context.target` is this document, for a conversation with no callout here,
spawns one at that turn's selection. So a prompt sent from the drawer with a
selection also gets a callout, and the two paths converge.

### 4.7 Move: same chat, different place

The card header has two text buttons:

- **Open beside** calls `marble.agent.open(id)` (the drawer opens on this chat,
  `switchTo` already exists) and folds the card to its pill.
- **Open in Agents** navigates to the Agents document with `?open=<id>`. The
  Agents page's `boot` reads that parameter after `start`, calls its own
  `open(id)`, and removes the parameter with `history.replaceState` so a reload
  does not reopen it. This is the one template change and the one live-doc
  patch.

From the other direction, the zone label's **Open chat** now dispatches a
cancelable `marble-callout:open` on `document` first; if a callout for that
conversation exists on the page the layer unfolds it and takes the event,
otherwise `collab.js` falls through to its existing behaviour (Agents page
event or the drawer). `Building here` in a chat still jumps to the zone.

### 4.8 What the server does

Nothing new. Anchor is `turn.context.selection`; target is `meta.target`;
review is `lastReviewedAt`; undo is `POST /agent/turns/:id/undo`. The only
server edit is `injectCarrier` in `server/app.js` adding
`<script src="/runtime/agent-callout.js" data-marble-transient>` after
`collab.js` when agents are on, and the matching `RUNTIME` entry. That is a
host restart; everything else in `runtime/` is re-read per request.

## 5. Decisions made here, and why

- **⌘J is contextual rather than a new key.** One key for "agent", and the
  selection decides where the agent appears. The drawer stays one keypress
  away with no selection, and one click away from the card.
- **The card is the full conversation component, not a lighter stub.** A stub
  would need its own send, its own chips, its own setups, and would drift. The
  component already has a `tile` density; `callout` is one more.
- **New chat by default, continue in one tap.** A summon is usually a fresh
  question about a fresh region. Continuing is offered, never assumed, because
  a chat mid-task elsewhere should not silently receive an unrelated brief.
- **Documents do not come to the Agents page in v1.** See §2.
- **Option is the pick modifier.** Precedent in the Drive listing's Option-drag
  lasso. Holding a key is the only way a click on a page full of live controls
  can mean "this one" without firing it.
- **The trail is an inset shadow, not a border or an outline.** It cannot move
  layout, it survives `overflow: hidden` on the element itself, and it goes when
  the class goes.
- **Rehydration reads the store rather than adding an `anchor` field.** The
  turn already remembers its selection. A stored anchor would have to be kept
  in step with it for no gain in v1.

## 6. Components and their boundaries

| Unit | Owns | Depends on |
|---|---|---|
| `runtime/agent.js` | `idsInRange`, `remembered`, `chosen`, `context()` | DOM selection |
| `runtime/agent-callout.js` (new) | the layer, handle, pick mode, card, pill, docking to the zone, end row, rehydration, `marble-callout:*` events | `marble.agent`, `marble.collab.tapeTarget`, `<marble-conversation>` |
| `runtime/collab.js` | zone, trail, `Open chat` fallthrough, exposes `marble.collab = { tapeTarget }` | presence SSE, `marble:ops` |
| `runtime/agent-ui.js` | `callout` chrome, fold/ticker, `continue` attribute, ⌘J yield in the drawer | the component's existing log and composer |
| `server/app.js` | injecting the script | — |
| `templates/agents.mrbl` | `?open=<id>` | its own `open(id)` |

Events between units, all `CustomEvent`s, all cancelable where a taker exists:

| Event | On | Dispatched by | Taken by |
|---|---|---|---|
| `marble-callout:summon` | `window` | drawer's ⌘J handler | callout layer, when a selection exists |
| `marble-callout:open` `{id}` | `document` | zone label's Open chat | callout layer, when that chat has a callout here |
| `marble-callout:reviewed` `{id}` | `document` | callout layer's Done | `collab.js`, clears that client's trail |
| `marble-callout:docked` `{id}` | `document` | callout layer, when a card docks to a zone | `collab.js`, hides that zone's label pill |

## 7. Error handling

- `marble.agent` absent or the conversation list failing: the layer draws
  nothing and logs nothing. Agents off is a normal state.
- A selection whose common ancestor is `<body>` (the whole page): the handle
  hangs off the top-left of the first selected element instead, since
  `tapeTarget` returns null and a callout still needs somewhere to be.
- Selected ids that do not resolve after a patch: the callout repositions on
  the next `marble:ops`; if the ids are gone for good it folds to a pill at the
  window's bottom-right with the title, so the chat is still reachable.
- `Continue in` a conversation that started running between paint and click:
  the send goes as a `queue` dispatch, which is what the component already does
  for a running chat.
- `?open=` naming a conversation that does not exist: `open(id)` already
  tolerates a stale id; the parameter is still removed.

## 8. Testing

Browser tests, Playwright through `test-browser/harness.js`, fake provider
scripts from `test/fixtures/fake-provider.js`. Unit tests where a pure function
exists.

- `test-browser/agent-api.test.js`: a selection spanning `p`, `q1`, `q2` in
  GARDEN yields `['p','q']` (the list coalesces, the paragraph stays); a
  selection from inside `q1` to inside `q2` yields `['q1','q2']`; Option-click
  picks and Escape clears.
- New `test-browser/callout.test.js`:
  - selecting text shows a handle at the selection; collapsing hides it;
  - clicking the handle opens a card holding a `marble-conversation` with
    `data-chrome="callout"`; ⌘J with a selection does the same; ⌘J with none
    opens the drawer;
  - sending `script:building` from the card posts a turn whose
    `context.selection` is the selection, the zone appears on the same target,
    the zone's own label is hidden, and the card header reads `Agent · rename
    the heading`;
  - after the turn the header reads `Changed 1 element · Undo · Done`, `h`
    carries `marble-trail`, Done clears the trail and removes the callout and
    the conversation is reviewed;
  - Undo restores the heading;
  - a reload while `script:hold` runs rebuilds a card at `h`;
  - fold gives a pill; the pill reopens the card;
  - Open beside opens the drawer on the same id; Open chat on a zone whose
    conversation has a callout unfolds the callout, not the drawer;
  - a prompt sent from the drawer with a selection spawns a callout;
  - the Agents page draws no handle; the phone width opens the drawer.
- `test-browser/agents-page.test.js`: `/a/Agents?open=<id>` opens that chat and
  the URL loses the parameter.
- `node --test test/server.test.js` or a small addition: `injectCarrier`
  includes `agent-callout.js` after `collab.js` only when agents are on.

## 9. Not in v1

- A marquee over document elements.
- Dragging a chat out of the drawer onto a region.
- Documents as panes on the Focus stage.
- A diff view of what a turn changed beyond the trail.
- A stored anchor a person can move without sending a turn.
