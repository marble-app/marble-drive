# Watching an agent use your app

**Date:** 2026-09-22
**Status:** design
**Scope:** `runtime/collab.js` (the act mark, the ordering, the label), `runtime/agent-ui.js` (the act row), `server/agent/act.js` + `server/agent/index.js` (the `acting` frame and its sentence), `server/oplog.js` (`origin`).
**Builds on:** `2026-09-22-agents-operate-apps-design.md` §9, which named three things the person should see and stopped there.

## 1. The question §9 skipped

The operate design gives the agent a good percept: it acts, and it gets back the
ops the app filed. The person gets no such thing. Today the drive can say *an
agent is working here* — a violet box around a region, a label, a wash, a trail
where a turn landed. All of that was designed for an agent that **writes the
file**. Operating is a different event and the existing vocabulary says it wrong:

- A zone says *work is happening in this region*. A press happens **to one
  control, at one instant**. A box around a button that is being pressed reads
  as "the agent is rewriting this button".
- The op flashes say *these elements changed*. They are the consequence. On
  their own they are a poltergeist: twelve rows move and nothing says why.
- Nothing distinguishes *the agent wrote this* from *the agent pressed your
  button and your app wrote this*. Those are different facts about your
  document, and only the second one is reproducible by you.

So the feedback layer has one job, and it is not "show activity":

> **Show the cause at the control, the effect where it lands, and the order
> between them — so the person sees the app being used, not the document being
> mutated.**

## 2. No cursor, because there is no pointer

Every computer-use product animates a mouse: a cursor glides across the screen
and clicks. It does that because in those systems the action *is* a coordinate —
the picture is the interface, and the cursor is the honest rendering of what the
agent computed.

Here the act is an address. Nothing in the operate design ever takes an x and a
y (§2 of that spec). A cursor gliding across this page would be a drawn lie, and
a consequential one: a travelling pointer implies the agent can press anything it
can see, when in fact it can press only what declared itself pressable. The
picture would over-promise the capability in exactly the direction the design
deliberately closed.

**So the mark converges on the control instead of travelling to it.** It appears
just outside the control's own outline and contracts onto it — arrival without
a journey, which is what an addressed act actually is.

## 3. The agent's colour is the press; the app's colour is the change

The drive already has two accents in play on any document: `--zone-mark`, the
violet that means *someone else is here*, and the document's own `--accent`,
which is what the app uses to say things about itself.

The split falls out of that, and it is the whole visual argument:

| | drawn in | because |
|---|---|---|
| the press | `--zone-mark` (violet, the agent's colour) | the press is the agent's contribution, and its only one |
| the change | the document's `--accent` (the existing op flash) | the change was made by the app, by its own code, in its own idiom |

An agent that *authors* is violet all the way down: the zone, the trail, the
whole region is someone else's hand in your file. An agent that *operates* is
violet for one instant at one control, and after that everything you see is your
own app doing its own job. That is not decoration; it is the correct account of
who did what, and it is the difference the whole operate design exists to make.

## 4. The three ranges

The drive's feedback already works at three ranges and says the same thing at
each: the element, the page, the conversation. Acting takes the same shape.

**The element — the press.** A ring in the agent's violet, in the control's own
shape, and the control held down while the act is in flight.

**The page — the label.** The zone pill, which already hangs off the zone's
corner with a breathing dot and an *Open chat* button, stops saying "Agent ·
working" and says what is being done, in the present tense while it happens and
in the past tense with a count when it lands: **"Agent · pressing Sort"** →
**"Agent · pressed Sort · 12 changes"**.

**The conversation — the row.** One line: **"Pressed Sort · 12 changes"**. Not
`act("Table.mrbl", "sort-btn", "press")`, and not a diff of twelve moved rows.
The ops are the agent's percept; the act is the person's.

## 5. Cause before effect, even when the effect arrives first

In the C path the host computes the op from the readout and writes it. The ops
are on the wire *before* the page has been told a press happened. Played back
naively, the person sees twelve rows move and then a button light up — the
document's own history, told backwards.

**So the page holds the effect for one beat.** While an act from a client is in
flight, ops from that same client queue; they are released when the ring
releases, staggered in document order so a large effect reads as a sweep rather
than a jump-cut. This is the one place in the drive where the page deliberately
delays what it could paint immediately, and the reason is that the person is
being told a story with a *because* in it.

## 6. An act that is invisible is the failure

Two cases, both mandatory, both easy to lose:

**A fast act must still be seen.** The C path can resolve in under a frame. So
the mark has a **minimum dwell** — contact, then a hold, then release, about
540ms end to end — independent of how long the act actually took. An act too
quick to see is, for the person, an act that never happened.

**An act that changed nothing must say so.** `{ ops: [], acted: true }` is a
finding, not an error: the agent pressed your Sort button and your Sort button
did nothing. The label says **"pressed Sort · nothing changed"** and holds it
longer than a successful one, because it is the surprising one and the person is
the only one who can do anything about it.

## 7. The sentence comes from the host, not from the agent

The label could be written by the model — it knows what it meant to do. It must
not be. The whole claim of this feature is that the person is seeing *what the
agent actually did*, and a sentence the agent composed is a sentence about its
intentions.

The host has better material and no motive: it knows the id, the gesture, and
the op that was filed, and it can read the control's own text out of the
document. **"Pressed Sort" is derived from the button's own label**, the way the
person would name it. If an agent's turn goes wrong, the labels stay true.

## 8. Your hands win, visibly

§9 of the operate design defers an act on an element the person has touched
since the turn began. Deferral must be visible or it reads as a hang: the
control the agent is waiting on shows the ring **unfilled and still** — arrived,
not pressed — and the label says **"Agent · waiting for you · Sort"**. The
person moves on, the act lands, and nothing was taken from them. A silent
deferral would have the agent look broken for doing exactly the right thing.

## 9. No new channel, and no new banner

Two constraints worth stating because both are tempting to break.

**No new channel.** Presence already addresses ids, carries a `phase`, survives
reconnects, and arrives in the page as `marble:presence` with its detail passed
through verbatim — `../marble/runtime/marble.js` does not inspect the frame. So
`acting` is a third phase beside `reading` and `writing`, the note carries the
sentence, and the frame may carry `gesture` and an effect count. Nothing in the
format package changes, and the feedback layer is testable before the `act` tool
exists.

**No banner.** The drive's rule is that the page never narrates: a marker that is
not the UI itself does not go on the page. Everything here sits on the control it
is about or in the conversation, which is the place narration belongs. An act on
a control that is scrolled out of view draws nothing — the chat reports it, and
the chat can take you there, which is the affordance `marble:jump-to` already is.

## 10. Anatomy, exactly

```
  t=0      the acting frame arrives naming one id
           ring appears at scale 1.14, opacity 0, in the control's own
           border-radius, drawn on the zone layer (it never touches layout)
           the control gets [data-marble-acting] — down 1px, 96% brightness

  t=140ms  contact: ring at scale 1, full opacity, sitting on the outline
           it breathes 0.55↔1 at the zone dot's rate, so the two read as family

  t≥360ms  release begins (never earlier, however fast the act was):
           ring expands to 1.06 and fades over 180ms; the control comes up

  t=+0     the held ops are released, 40ms apart in document order, each one
           flashing in the document's own accent — the app doing its job

  label    "pressing Sort" → "pressed Sort · 12 changes", held 2.4s
           (3.6s when nothing changed)
```

Reduced motion: no scale, no breath — the ring appears, holds, and fades.
Reduced transparency: the ring stays; it is a line, and lines are what survive.

## 11. What is built now, and what waits for `act`

Buildable today, because presence already carries everything: the ring, the
dwell, the ordering, the label, reduced-motion behaviour, and the browser test
that drives all of it with synthetic frames.

Waiting on the `act` tool: the frames themselves; the host-written sentence; the
effect count; `origin: operated` in the log, which is what would let the trail
distinguish *the agent wrote this* from *your app wrote this*; and the act row's
rewrite-on-result in the conversation.

One rule about that row goes in now, because it is a decision and not plumbing:
**an act row never folds.** The stream folds runs of finished steps into "7
steps" because reads and greps are the agent's business. An act is not the
agent's business — it is a thing that happened in the person's document, by the
person's app. It stays on its own line, with the reads folded around it.

## 12. Decided, with the reasoning

- **The press is the agent's colour, the change is the app's.** The alternative —
  everything violet — would say the agent moved twelve rows. It didn't. It
  pressed one button.
- **Convergence, not a cursor.** A travelling pointer would draw a capability
  this design does not have and deliberately refused.
- **Minimum dwell over truthful timing.** A 40ms press rendered in 40ms is not
  more honest; it is less, because nobody saw it.
- **The host writes the sentence.** A feedback layer that reports the agent's
  own account of itself is not a feedback layer.
- **Delay the effect to keep the order.** The only thing more confusing than no
  feedback is feedback in the wrong causal order.

## 13. Open

- **Replay.** Ops are stamped with the act id, so "show me what that did" is a
  scrub away. Wanted, but it is a second interaction, not a signal.
- **Two acts at once**, from two conversations, on two controls. Two rings is
  probably right; two labels may collide, and the label layout has no stacking
  rule yet.
- **The trail after an operated act.** An operated change is reproducible by
  pressing again; an authored one only the file remembers. That argues for two
  trail marks, and it needs `origin` in the log before it can be drawn.
