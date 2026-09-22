# Operating the app, not just writing it

**Date:** 2026-09-22
**Status:** design
**Scope:** `marble-drive` — `server/agent/act.js` (new), `server/agent/tools.js` (two tools), `server/agent/instructions.js`, `server/sse.js` (an addressed `act` frame), `server/oplog.js` (`origin`, `act`), `server/app.js` (the route, the presence phase), `runtime/collab.js` (receive, dispatch, stamp). `../marble` — `runtime/affords.js` gains a second reader.
**Builds on:** `2026-09-21-affords-and-adjust-design.md`, which made the vocabulary readable and stopped one question short of this one

## 1. The lopsidedness

An agent in this drive can rewrite any app in it, down to the element. It cannot
press one button in one.

So when the person asks it to sort the table, it reads the sort handler, infers
what the handler does, and re-implements sorting by hand in ops. That is wrong
in the specific way reimplementation is always wrong: it duplicates logic that
already exists and duplicates it slightly differently, it skips whatever the app
validates on the way, and it files a batch of ops the app itself would never
have filed. The document ends up in a state its own code could not have
produced.

The general statement, and the reason this is worth building:

> **An agent that can author an app but not operate it will always reach for the
> authoring tool, even when the app already has the answer.**

There is a second cost, quieter and larger. An agent that cannot operate what it
builds cannot *check* what it builds. It writes a sort button and has no way to
learn whether the button sorts. Every claim it makes about behaviour is a claim
about source it read, never about behaviour it saw.

## 2. Why this is not the usual computer use

Computer use as the field practises it — screenshots, accessibility trees,
coordinates, a model guessing what a button does from its label — exists because
the app is opaque. The agent is outside it, and the only surface is the picture.

Here the agent is inside. It has the entire source of the app. Every element
carries `data-marble-id`. The affordance vocabulary is declared in attributes and
is already machine-readable: `marbleVocabulary.affords(el)` reports what an
element permits *and names the op each gesture would file*. And every consequence
of anything, from anyone, lands in the op log in the same vocabulary the agent
reads and writes.

Two consequences follow, and they decide the whole design.

**The action is an addressed act, never a coordinate.** The agent does not need
to find a button in a picture. The button has an id, and the document can say
what pressing it affords. Nothing in this design ever takes an x and a y.

**The observation is ops, never a screenshot.** After an act, the agent gets back
the exact list of ops the app filed. That is a strictly better percept than a
picture: it is small, exact, diffable, expressed in the vocabulary the agent
already thinks in, and it makes assertion natural — *pressing Sort should file a
move for every row and change no text.* An act that files nothing says so, which
is how an agent finds out its own button is broken.

So: do not build a screenshot loop. Build an act/effect loop in the op vocabulary.

## 3. Where the handler runs — three answers, one verb

The three plausible designs differ only in *where the document's handler
executes*. They are not alternatives; they are a fallback chain, and the agent
must never have to care which one answered.

**C — nowhere. The host computes the op.** `affords()` already names the op each
gesture would file, so a host can answer `move`, `size`, `toggle` and the rest by
computing the op directly, without running a line of page script. Cheap,
deterministic, auditable, testable, available with no page open anywhere. Blind
to exactly one thing: a control whose behaviour lives in the document's own
script.

**A — the person's open page.** The host pushes an act down the document's
existing SSE channel; the page dispatches it on the element; the document's own
handler runs; the ops go out the normal `/ops` write path. This is the only
version with the *real* runtime state, and nothing has to be reconciled. It is
also the version where the person watches their app being used, which is the
feature and not a side effect — `channels.toPresence` already paints the element
an agent is on.

**B — a page of the agent's own.** A headless render of the same file, carrier
loaded, authenticated as `agent:<conversation>`, ops through the same route.
Works with nobody watching, parallelises, and is the obvious home for tests.
Costs a Chromium per turn, and its state is not the person's state: localStorage,
in-memory values, dock width, dark mode and the Focus layout are all its own.

**Resolution order: C, then A, then B.** Compute it if the vocabulary can answer;
otherwise ride the page that is open; otherwise open one. One tool, one result
shape, and the resolver's answer reported as a field the agent can read but does
not have to.

## 4. What the format has to learn

`affords(el)` answers one question: *what can be done to this element.* Move it,
size it, type in it, remove it, pick it, toggle an attribute on it.

Operating asks the other half, and there is no reader for it:

> **What does this element do when it is pressed, and what op would that file?**

The default vocabulary already contains controls of exactly this kind.
`data-marble-add="#tpl-section" data-marble-into="#outline"` is a button that
files an `insert` from a template. `data-marble-toggle`, `data-marble-choose`,
`data-marble-step` and `data-marble-expand` are elements whose press writes an
attribute. `<marble-alt data-marble-active>` switches which alternative is live.
Every one of these is declared, in the file, in attributes — and `affords` reports
some of them as a property of the element while reporting none of them as a
*thing to press*.

So `../marble/runtime/affords.js` gains a second reader beside the first:

```js
globalThis.marbleVocabulary.does(button)
// { kind: 'add', template: '#tpl-section', into: '#outline', op: 'insert' }
globalThis.marbleVocabulary.does(checkbox)
// { kind: 'toggle', name: 'data-done', op: 'setAttr' }
globalThis.marbleVocabulary.does(somethingElse)   // → null
```

It follows the rules the first reader established, and for the same reasons. It
is data, never callbacks — a caller has to be able to print it, diff two of them
or put one in a prompt. It writes nothing and wires nothing. It lives on
`marbleVocabulary`, not on `window.marble`, because the carrier surface is the
contract between a document and any host and a reader for one particular
vocabulary is not part of it. And **an undeclared control returns `null`, which
is a true answer** — a caller that presses it anyway knows it is acting
undeclared, which is precisely the hook §8 hangs consequence on.

## 5. The tools

Two, added to `TOOL_SCHEMAS` in `server/agent/tools.js`.

**`read_affordances(path, ids?)`** — the readout. For each id: what can be done to
it (`affords`), what it does when pressed (`does`), and the op each would file.
This is the agent's accessibility tree, except that it is exact, it is addressed,
and it names ops rather than roles. It is a read, so it goes through the same
ledger `read_document` does: an element whose affordances you were shown is an
element you have seen.

**`act(path, id, gesture, value?)`** — the verb. One call, one gesture, on one id.
The gesture vocabulary comes from the readout and from nowhere else: `press`,
`type`, `set`, `move`, `size`, `remove`, `pick`. There is no `click`, because
`click` is a mouse and this is not one.

Refusals reuse the machinery that already exists. `act` on a document that is not
`turn.writable` is refused the way `apply_ops` is. A gesture the readout does not
offer for that id is refused with the readout, which is itself a read, so the
retry can succeed — the same shape as the ledger refusal, and for the same
reason.

## 6. The act/effect loop

```
act(path, id, 'press')
  → resolve: can the vocabulary answer this?          (C)  → compute the op, write it
  → else: is a page open on this document?            (A)  → elect one, address the frame
  → else:                                             (B)  → open one as agent:<conversation>

  the page dispatches the gesture on the element
  the document's own handler runs
  every op batch it files is stamped with this act's id
  the page reports the act finished

  → the host returns the stamped ops to the agent
```

**An act is addressed to one page, never broadcast.** `channels.toDocument`
writes to every listener on a document minus one; an act sent that way would be
pressed once per open tab. So `toAct(docPath, listenerId, frame)` writes to a
single elected listener, and every other page ignores an `act` frame not
addressed to it. The election picks the listener that most recently showed
activity — `server/touched.js` already records per-writer times for exactly this
kind of question — and falls back to the most recently connected listener, since
a page that has only ever read has no entry there. If the elected page does not report back within a short window,
the act falls through to B rather than being retried, because a handler that
hung once will hang again.

**The effect needs no separate report channel.** The page's ops already travel
the normal `/ops` route; while an act is executing, `runtime/collab.js` stamps
each batch with the act id. The host collects ops carrying that id until the page
says the act is done or the window closes. This is why the effect is free, and it
is also where provenance comes from.

The result the agent gets is `{ ops, where: 'computed' | 'page' | 'agent-page',
acted: true }`, or `{ ops: [], acted: true }` — an act that ran and changed
nothing, which is a finding and not an error.

## 7. Provenance, transaction, undo

`oplog.append` already writes `{t, doc, client, seq, label, …op}`. Three things
that are genuinely different are currently indistinguishable in that log: the
person filed this, the agent *authored* this, and the agent *operated the app and
the app* filed this. Two fields fix it:

- **`origin`** — `person` | `authored` | `operated`.
- **`act`** — the act id, on operated ops only.

These are two free fields now and a migration across a year of logs later, which
is the argument `server/oplog.js` already makes in its own header for `client` and
`seq`. They are worth taking on that argument alone.

`act` also makes the transaction. One press may file seven ops; undoing it must
undo the press, not one seventh of it. `server/agent/inverse.js` already builds
inverse steps and `server/agent/undo.js` already applies them — the change is that
the unit is the act group, applied in reverse, rather than the batch. Given that
undo here has already been wrong in both directions once, an act that could only
be half-undone is not acceptable.

## 8. Consequence

Operating can do things authoring cannot. Authoring writes bytes into a file and
every byte is recoverable. Pressing runs the document's script, and a script can
send mail, spend money, or navigate away.

The bound for the first build is sharp and comes from §4: **`act` runs only where
the readout is non-null.** The default vocabulary is itself a declaration — the
attributes in the file say what the gesture does and which op ends it — so acts
within it are, by construction, acts that file ops and do nothing else. A control
whose `does()` is `null` is a control whose behaviour nobody declared, and it is
simply out of reach until there is a way to declare it.

That is a correction to the looser "press it and watch the ops" position, and the
correction is the point: press-and-watch is safe only for handlers that are
*already* known to file ops and nothing else. For an arbitrary `onclick`, watching
the ops tells you what it wrote to the file and nothing about what it sent over
the network.

So v2's work is a consequence declaration, not a press mechanism — an attribute
by which a document says *this control files ops* or *this control leaves the
document*. Free acts are the first kind. The second kind asks the person, every
time, naming the control. Undeclared stays undeclared, and stays refused.

## 9. What the person sees

Presence already has the vocabulary. `onLook` sends `{client, ids, phase}` and the
phases today are `reading` and `writing`; operating is a third, `acting`, and
`runtime/collab.js` already paints `.marble-presence` on the ids a frame names.

Three additions, all small:

- The control an agent presses flashes as it is pressed. An act that is invisible
  is the failure mode of this whole feature.
- The work stream reads **"pressed Sort"**, not a diff of twelve moved rows. The
  ops are the agent's percept; the act is the person's.
- Never act on an element the person's hands are on. `touched.js` records per-id
  times per writer and already answers "touched since this turn began"; an act on
  a recently-touched id defers rather than racing.

And there is a stop, which is the same stop that already halts a turn.

## 10. The rule the agent is told

Into `DRIVE_INSTRUCTIONS` and `INSTRUCTIONS` in `server/agent/instructions.js`,
beside the stages rule, because it is the same kind of rule:

> **Operate before you author.** If the document has a control for what you were
> asked to do, press it with `act`. Rewriting what a control would have done
> duplicates the app's logic and skips what it checks. Use `read_affordances` to
> find out what a control does; if it declares nothing, it cannot be pressed —
> author instead.

## 11. The first slice

The smallest thing that closes the loop end to end:

1. `does()` in `../marble/runtime/affords.js`, with its test in the format's suite.
2. `read_affordances` and `act` in `server/agent/tools.js`, resolver path **C only** —
   the host computes the op from the readout. No page, no browser, no new frame.
3. `origin` and `act` in `server/oplog.js`; act-grouped undo.
4. The `acting` presence phase.

That is enough for an agent to move a card, tick a checkbox, add a section from a
template and rename a thing — *and to verify each one from the ops it got back* —
with no Chromium and no new channel. It answers the only question worth answering
before paying for A or B: **is act-and-read-the-ops the right primitive?** If the
effect reads well to a model, A is a frame and an election. If it doesn't, we
found out for the price of one reader.

## 12. Testing

- `../marble/test/` — `does()` against the fixture apps, including the null answer
  for an undeclared control. The format's e2e enumerates the carrier surface
  member by member; `does` goes on `marbleVocabulary`, so that test must still
  pass unchanged. It is the guard that this did not quietly widen the carrier.
- `test/act.test.js` — the resolver's order, the refusal shapes, `origin` and `act`
  in the log, and an act group undone whole.
- `test-browser/act.test.js` — a real page, a real affordance, ops coming back;
  and the election, with two pages open, pressing once.
- Load-flaky suites here are a known hazard: rerun a single file before treating
  a failure as a regression.

## 13. Decided, with the reasoning

- **The person's page over the agent's, when one is open.** Seeing the agent use
  your app is the feature. An agent operating an invisible copy is a worse
  product *and* a worse research artifact, whatever it costs in races.
- **No new declaration format in v1.** The default vocabulary is already a
  declaration; riding it costs one reader. Inventing a second vocabulary before
  the loop has proved itself would be designing the hard half first.
- **`act` stays separate from the Playwright browser tools.** They are different
  epistemics — one is addressed and exact, the other is guessing from a picture.
  A document is not a website the agent is visiting; collapsing the two would
  drag coordinates back into a design whose whole claim is that it has none.
- **No screenshot in the loop anywhere.** If an act's effect is not legible in
  ops, that is a finding about the format, not a reason to take a picture.

## 14. Open

- Election when several people have the same document open. One page presses; the
  rest see the ops. Whose page, and does it matter?
- An act on a document nobody has open, in the C path, has no page to run in —
  correct and cheap, but the person sees the effect only when they next open it.
  Does an act need to appear in the work stream of a document that was closed?
- Whether `read_affordances` should be a separate tool or a mode of
  `read_document`. Separate here because the ledger question differs, but two
  reads of the same document by two tools is a seam worth watching.
