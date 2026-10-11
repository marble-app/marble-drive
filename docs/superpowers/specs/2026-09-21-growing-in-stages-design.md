# Growing the open page, in stages

2026-09-21. Revises the *Growing the open page* ritual (`skills/build-in-marble/SKILL.md`
in the marble package, served to every agent by `read_guide`; summarised in
`server/agent/instructions.js`; pointed at by `.agents/skills/growing-the-open-page`).

## The gap

The ritual as written answers *where* the agent is working: a stub goes in where
the UI will sit, and the host draws the construction zone around whatever the agent
reads and writes. It does not answer *how far along* the work is. "Fill the stub
with later small ops: name, then controls, then copy — whatever order the layout
reads" produces a page that is half-rendered until the last op lands: a card with
a heading and no body, then a body and no controls. A person watching sees pieces
arrive, not an interface taking shape, and if the agent stops the pieces are what
they keep.

## The principle

The progress of an agent building an interface should be inspectable, traceable
and understandable from the page itself. The way to get that is to build the
interface **incrementally as a sequence of whole interfaces**: the same final UI a
one-shot build would produce, revealed coarse to fine, so that every stop is a
plainer version of the destination rather than a fragment of it.

This is the *Gradual Generation of User Interfaces* method (Min, Jiang, Huang, Xia;
arXiv:2601.17975) applied to construction rather than customisation: identify the
key intermediate stages of the interface, and make sure the elements that matter
persist across them. We take the intermediate layers and the continuity rule; we do
not attach customisations to the layers. The intermediate interfaces exist so the
person can see what is being built and how far it has got.

## What changes for the agent

Only the order of building. The destination is fixed before the first op, and a
stage is never an excuse to build a different interface. The agent decides the
stages itself — the method says what a stage must be, not which stages this
interface has.

A stage is:

- **Whole.** At every stop the page reads as a finished interface, plainer than the
  next: nothing dangling, nothing that only makes sense once the next stage lands,
  `check_document` clean. If the agent stops, the person keeps something that works.
- **Continuous.** The element that stands for a section in stage one *is* that
  section in the last stage — same `data-marble-id`, refined in place. Never remove
  an element to reinsert its finished form; that is a cut in the thread, and the
  zone jumps to a new element.
- **Named.** The `note` of each `apply_ops` call names the stage and what it adds
  (`Stage 2 of 4: lay out the three columns, empty.`). The host already writes the
  note on the zone's label (`runtime/collab.js` `phaseLabel`), so naming the stage
  there is what makes the progression legible in the page without any page-side
  marker. The plan is said once, in one line, before the first op.
- **Free of filler at the end.** A stage that is not whole without something the
  final interface does not have — the document's own empty-state line, a plain list
  a later stage turns into a grid — may plant it, in the document's idiom, and owes
  its removal to a named later stage. No stage number, *loading* or *coming soon*
  ever lands in the page: the page never narrates, the note does.

Three to six stages. Fewer shows nothing; more is noise. The default order is
coarse to fine — what exists, how it is arranged, what each slot holds, what it can
do, how it looks — and the agent picks another when it explains the interface
better.

## Decisions and why

- **Narration lives in the `note`, not in the page.** The page is the file; a
  marker in it is a fact written down that is not part of the interface, and would
  have to be removed. The note already reaches the zone label and the `changed`
  event, so the machinery for showing progress exists and needs no runtime change.
- **One batch per stage step, not one op per stage.** `apply_ops` caps at 24 ops, and
  undo is per write. A stage may take a few calls; each carries the stage's name.
  Undo then walks back stage by stage, which is the traceability the principle asks
  for.
- **Continuity by id, enforced as a rule not a tool.** The tools cannot tell a
  replacement from a removal. The rule is explicit, and the audit below checks it.
- **Filler is allowed and owed.** Forbidding it makes the *whole* rule impossible
  for some interfaces; leaving it unbounded is how a page ends up with a stale
  placeholder. So: allowed to keep a stage whole, in the document's idiom, and every
  piece is retired by a named later stage.
- **Scope is the live view and any build that lands through ops.** A whole-file
  rewrite of a document nobody is looking at is still allowed, as before.
- **The drive's `.agents/skills/growing-the-open-page` stays a pointer.** One copy
  of the steps, in the package the host serves through `read_guide`.

## Verification

`tools/stage-audit.mjs` replays a JSON list of `apply_ops` batches against a
document through the same `repairOps` → `validateOps` → `applyOps` path the tool
uses, and grades the build: every batch leaves the document clean under `examine`;
every id an earlier batch introduced is still in the final document (continuity);
no batch removes an element the build itself introduced unless its note says the
element was filler; every note names its stage; the final document carries no
marker words; three or more stages. It reads ids with the format's own parser
rather than a regex, and blames a disappearance on the batch that caused it rather
than on every batch after. The runs recorded below were graded with it.

Node tests assert the guide, the instructions and the drive skill carry the stage
rules, and that the audit passes a staged build and fails a cut, a marker and a
one-shot insert.

## Baseline and result

Four runs, same board fixture, each a fresh agent asked to write down the
`apply_ops` calls it would make, graded with `tools/stage-audit.mjs`.

| Run | Instructions | Stages | Verdict |
| --- | --- | --- | --- |
| Baseline | the old ritual | 4 | fails — no stage is named |
| Team column | revised | 5 | passes |
| Team column, repeat | revised | 5 | passes |
| Load chart | revised | 5 | fails on a control that files no op |

**The baseline already staged the work.** This is the most useful result and it
sharpened the change. Asked to add a column of member cards, the old instructions
produced four batches in almost exactly the order the new rule asks for: the empty
column, three card stubs, the names and roles, then the buttons. Every element kept
its id. What the baseline did *not* do is name any of them — its notes read "Insert
three card stubs into the Team column… before filling in content", which describes
an op, not a position in a sequence. A person watching the zone label saw four
unrelated sentences and could not tell whether the fourth was the last.

So the gap was never that agents build in one shot. It is that the build has no
**spine** a watcher can count along. That is why `named` is the check the baseline
fails and the revised runs pass, and why the rule about the note is load-bearing
rather than decorative.

**Two things the runs changed in the design.**

1. The repeat run folded the whole plan into its first note, which the zone label
   truncates. The guide now says the plan goes in the reply and a note is one
   sentence.
2. The chart run retired a filler paragraph by removing it, and the audit could not
   tell that from cutting a real section — both are a `remove` of something the
   build introduced. Rather than weaken the check, the guide now requires the
   retiring stage to say so in its note, which is the sentence that tells them
   apart. On the re-run the agent avoided the question altogether by revising the
   placeholder values in place, which is the better answer.

**The chart run's remaining failure is real and is not about staging.** Its Refresh
button recounts the columns by writing `style.width` and `textContent` and never
calls `window.marble.op`, so its effect dies with the tab — rule 7. The staging
itself held: five stages, whole at every stop, 22 elements all keeping their ids,
no filler left. Building in stages does not make a build correct; it makes an
incorrect one legible, and here it located the defect in stage 4 of 5.

## A bug this found in the format's own checker

`checkIdiom` in the marble package matched `marble\.op\s*\(`, so it read
`window.marble?.op(…)` as a script that files nothing. That is backwards: a
document must keep working opened with no host, where `window.marble` never
arrives, so the optional-chaining spelling is the one the doctrine asks for. The
first chart run was refused for writing correct code. The patterns for `op`,
`apply`, `patch`, `pageOnly` and `transient` are now built from one `carrier()`
helper that accepts `marble.x(`, `marble?.x(` and `marble?.x?.(`, with a test over
all four spellings.
