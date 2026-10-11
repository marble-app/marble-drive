# Construction zones and conflict forks: say what is happening

**Date:** 2026-09-18
**Status:** design, awaiting review
**Scope:** `runtime/collab.js`, `server/app.js`, `server/touched.js` (new), `server/agent/runner.js`, `docs/AGENTS.md`, tests

## 1. The problem

Bryan was editing a document while an agent worked in it. Three things went wrong at once, and together they made the page feel broken:

1. **The box was in the wrong place.** The construction zone — the corner-marked frame that says where the agent is — sat over empty space while the element it marked was hundreds of pixels lower.
2. **He did not know what the box meant.** Its label was the agent's own `apply_ops` note, verbatim: something like *"rename the heading"*. With no subject, that reads as an instruction to the person, not a report of what the agent is doing.
3. **A fork appeared and he did not know whether he wanted to merge.** A `<marble-alt>` with `You | Agent | Keep this | Merge` showed up with no line saying why. And *Merge* does not merge: it opens an agent conversation asking it to write a third version.

Symptom 1 is already fixed (§2). This spec is about 2 and 3, plus the server-side cause that makes forks appear when the person did not change anything.

Two requirements Bryan added while this was being written, which set the direction of §4.3:

- **Being on the tab is observation, not modification.** A caret parked in an element is not a claim on it. The agent must be free to change anything the person is not actually editing.
- **The zone is the coordination signal, and the person will honour it.** If the agent clearly shows where it is working, Bryan would rather be the one who does not interject there. The system should not fork defensively on his behalf as well.

## 2. What already landed (for the record)

The zone was positioned once, when the agent's presence frame arrived, and re-positioned only on scroll and resize. The person's own typing reflows the page and sends nothing back to their tab — their ops and presence are never echoed to themselves — so nothing in `collab.js` ran. Fixed on 2026-09-18 in `runtime/collab.js`: a `MutationObserver` on the document (ignoring the overlay's own mutations) plus a `ResizeObserver` per target, coalesced into one animation frame; a target that left the DOM is re-resolved by id from the presence map. Two tests in `test-browser/collab.test.js` (typing above the target; replacing the target) fail on the old file and pass on the new one.

## 3. How it works today

- **Zone.** `runner.js` and `tools.js` call `onLook(docPath, ids, client, {phase, note})`; `app.js` broadcasts it as a `presence` frame; `collab.js` draws one frame per agent client around the smallest element containing all its ids. An agent whose ids resolve to nothing on this page draws nothing — see the 2026-09-19 note below. Label = `note`, else `Reading` / `Writing` / `Working`.
- **Touched ids.** `server/app.js` keeps one `createTouched()` registry per document and client. It is fed by (a) every write's ids and (b) every presence POST — which the runtime sends on `focusin`, i.e. wherever the person's caret lands. **`note()` accumulates**; a client's set is only dropped when its event socket closes, or (for agents) when the turn ends via `forgetWriter`.
- **Forks.** When a write's ids overlap another client's touched set (same element, or ancestor/descendant), `mergeOps` / `mergeWrite` wraps that element in a `<marble-alt>` with a `you` and an `agent` version. `collab.js` skins that as the fork bar.

So today: click into a paragraph at 10:00, click into a heading at 10:05, and at 10:40 an agent rewriting either one forks — even though the person changed nothing. That is where most of the "why is this here?" comes from.

## 4. Design

### 4.1 The zone label names its author

The label reads **`Agent · <what it is doing>`**.

- With a note: `Agent · rename the heading`. The note is shown with its first letter lowercased (unless the first word is all capitals, e.g. an acronym) and one trailing period removed, so the tool's "One sentence: what this change does" lands as a clause.
- Without a note: `Agent · reading`, `Agent · writing`, `Agent · working`.

`Agent` matches the word already used on the fork bar. Naming the conversation (its title) would be better still but the title is not on the wire; see §8.

The live dot and the *Hide* button are unchanged.

### 4.2 The fork bar says why it is there, and what each button does

The bar gains one line of context above its controls, in the same muted 12px face:

> **You and the agent both changed this.**

Controls become: `You | Agent` (segmented, unchanged) · **Keep this** (unchanged) · **Ask an agent to combine** (was *Merge*).

- The line is static text; it does not name the agent conversation (§8).
- *Ask an agent to combine* keeps today's behaviour exactly (`askMerge`): select the versions, aim the drawer at the document, send the merge prompt to the current conversation or open the drawer. Only the name and `aria-label` change, so the button promises what it does.
- The bar already wraps (`flex-wrap`), so the longer label costs nothing on narrow widths.

### 4.3 A conflict is two edits during the same turn — not a caret, not history

Two changes to what counts as "touched" in `server/app.js`:

**(a) Presence no longer feeds the conflict set.** The `/presence` route keeps broadcasting the frame (that is the wash other people see) but stops calling `note()`. Where the person's caret is has no bearing on whether an agent's write forks. The 400 ms flush debounce in the runtime is the only window in which typed-but-unsent keystrokes could be lost to an agent write landing on the same element, and by Bryan's second requirement he is not typing there anyway.

**(b) The person's writes count only if they landed after the agent's turn began.** Today a person's written ids accumulate until their socket closes, so a paragraph edited at 10:00 forks against an agent rewriting it at 10:40 — even though the agent read the 10:00 version before writing. Concurrency is relative to the turn: the agent's read of the document at turn start is its base, and only person edits *after* that base are edits it could not have seen.

Implementation:

- A drive-side registry, `server/touched.js`, with the same shape as the package's `createTouched()` (`note`, `except`, `all`, `drop`, `forget`) plus a timestamp per id and a `since` option: `except(doc, client, { since })` returns only ids noted at or after `since`. `app.js` uses it in place of the package's registry; `@bdhmin/marble` is not changed.
- The live turn object gets `turn.startedAt` alongside the store update, and `agents.running()` already returns live turns, so `app.js` can find the turn for `agent:<conv>` and read it.
- At the two conflict sites:
  - `applyOps` with an agent client: `since = startedAt` of that conversation's running turn.
  - The external-write branch with a claiming turn: the same `since`.
  - A person's write, or an unclaimed outside write: no `since` — the other side is an agent whose set is already scoped to its turn (it is forgotten at turn end), or another person, where the old rule stands.
- Socket close and `forgetWriter` unchanged.

**(c) An undo neither forks nor claims.** Found while implementing (b): an undo writes as `agent-undo:<conv>` *after* its turn has ended, so `forgetWriter` never clears it — its claim on every element it restored lived forever, and forked the person's next edit to any of them. It also went through the fork check itself, where each of its steps is already guarded by the hash the agent left (`server/agent/undo.js`: an element edited since is skipped, not forked). So `applyOps` treats `agent-undo:` clients as a retraction: no `mergeOps`, no `note()`.

A test that had passed by accident — `two undos of the same turn at once` in `test/agent-http.test.js` — surfaced this. Its heading was already `Backlog` when it ran, so the agent's rename changed nothing and recorded no undo step; the stale undo claim then forced a fork whose text happened to satisfy the assertion. The test now resets its document first.

**Why not a TTL.** A time-to-live makes a fork depend on how fast the person types; the turn boundary is the thing that actually defines "could the agent have seen this".

**Why writes are still remembered past the turn.** Two turns can overlap on one document (two conversations). A person's edit during turn A is also concurrent with turn B if B started before it. The timestamp handles both; the set itself is only trimmed by socket close, as today.

### 4.4 A paragraph of documentation

`docs/AGENTS.md` gets a short section, *While an agent works*, saying: the corner-marked frame is where the agent is and what it is doing; *Hide* puts it away for the session; if you and the agent change the same thing you get two versions with a bar to pick one or to ask an agent to combine them.

## 5. What does not change

- Zone geometry, *Hide* / *Show work*, reduced-motion and reduced-transparency handling.
- How forks are detected inside the package (`classifyOverlap`, `forkAlt`, `mergeWrite`), and that conflicts are wrapped rather than overwritten.
- *Keep this* and version switching, including undo.
- The `apply_ops` tool schema. Agents keep writing one-sentence notes.

## 6. Testing

Browser (`test-browser/collab.test.js`):
- Label with a note: `Agent · rename the heading` from the note `Rename the heading.`; an all-caps first word keeps its case.
- Label without a note, per phase: `Agent · reading` / `writing` / `working`.
- The fork bar shows the context line and the buttons `You, Agent, Keep this, Ask an agent to combine` (update the existing expectation).
- *Ask an agent to combine* still calls `marble.agent.select` / `aim` / `send` (stub `window.marble.agent` and assert).

Server:
- `test/touched.test.js` (new, unit): `note` records a time; `except` without `since` returns everything, with `since` only ids at or after it; `drop` / `forget` / `all` match the package's registry.
- `test/server.test.js` or `test/agent-http.test.js`, whichever already drives a person-plus-agent write:
  - A presence POST followed by an agent write to that element **applies cleanly** — no `<marble-alt>`. This is the test that encodes requirement 1.
  - A person write to `p`, then a turn starts, then the agent writes `p`: applies cleanly.
  - A turn starts, the person writes `p`, the agent writes `p`: forks.
  - The agent writes `p` during its turn, the person writes `p` in the same turn: forks (unchanged).
  - Socket close still clears the person's set.

## 7. Files

- `runtime/collab.js` — `phaseLabel` (§4.1); fork bar markup and labels (§4.2).
- `server/touched.js` — timestamped registry (§4.3).
- `server/app.js` — use it; stop noting presence; pass `since` at the two agent conflict sites (§4.3).
- `server/agent/runner.js` — `turn.startedAt` on the live turn (§4.3).
- `docs/AGENTS.md` — §4.4.
- `test-browser/collab.test.js`, `test/touched.test.js`, `test/server.test.js` (or `agent-http`).

## 8. Decisions and what was left out

| Decision | Why |
|---|---|
| Prefix `Agent ·` rather than change how agents write notes | Robust to any provider's phrasing; zero prompt cost; the no-note case gets the same shape for free. |
| Lowercase the first letter and strip one period | Notes are written as sentences; shown as a clause after `·` they read naturally. Guard all-caps first words so `PDF export` stays `PDF`. |
| Rename *Merge* rather than make it merge | An automatic merge of two arbitrary HTML subtrees is a research problem, not a button. The honest name is the fix. |
| Context line is fixed text, not "You and *Writing plan* both changed this" | The conversation title is not in the presence or fork payload. Plumbing it is a separate, small change (runner `meta.label`) — worth doing later for both the zone and the bar, not blocking this. |
| Presence out of the conflict set entirely, not "current caret only" | Bryan's requirement: observing is not editing, and he will yield to the zone. The 400 ms flush window is the whole exposure. A first draft kept the current caret protected; his note removed the reason for it. |
| "Concurrent" = after the agent's turn began, via timestamps, not a TTL | The turn's start is the agent's base; a TTL would tie forks to typing speed. A drive-side registry keeps `@bdhmin/marble` and `../marble` untouched, which another session may be in. |
| Fork still on genuine overlap (both wrote it in the same turn) | That is the case the fork exists for, and it is the one where the bar's new line is true. |
| No auto-resolve of forks when the turn ends | A fork is the person's decision; the bar waits for them. |

Out of scope, noted for later: naming the agent in labels; the observation that `apply_ops`'s read-before-write ledger already prevents the agent clobbering edits it has not seen, which means many forks *against the agent* are belt-and-braces — a future spec could relax fork detection for ledgered writes and keep it only for file-tool writes.

## 9. Amendment, 2026-09-19 — the page banner is gone

A zone points. Its whole claim is *here*: corner marks around an element, a
label hanging off it, both following that element as the page reflows. Work
with nothing to point at had been falling back to a pill fixed at the top of
the page — `.marble-zone-page`, no frame, centred over whatever chrome was
underneath it. On a page whose subject is agents, that pill sat above the
header announcing "Agent · working" to someone already looking at a list of
working agents: an ambient status line wearing a zone's clothes, duplicating
what the app's own chrome carries, and belonging to no part of the layout.

`paintZones` now resolves a target first and skips any presence that has none:
no ids, ids that are not on this page, or a spread so wide that the only
element containing all of it is the body. The `.marble-zone-page` rules and the
phase-only branch of the presence map went with it — an agent that names no ids
is simply dropped from `presence`, because nothing reads it any more.

What this gives up: an agent editing far-apart elements at once (common
ancestor `body`) shows no zone rather than a banner. That is the right trade.
An app that wants to say "agents are working" should say it in its own chrome,
where it can say *which* ones; the overlay's job is only to point.
