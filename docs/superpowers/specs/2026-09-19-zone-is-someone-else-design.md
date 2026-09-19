# The construction zone is someone else, and it is two-way

**Date:** 2026-09-19
**Status:** built 2026-09-19
**Scope:** `runtime/collab.js`, `runtime/agent-ui.js`, `server/agent/index.js`, `server/app.js`, `docs/AGENTS.md`, tests

## 1. The problem

Bryan asked for the zone to be hidden once, and then said why: he did not read
it as *an agent is here*. He read it as a piece of the app's own chrome that had
appeared for no reason. Three things caused that:

1. **It wore the document's accent.** `--zone-mark` was mixed from `--accent`,
   the same variable every control on the page is tinted from. A frame in the
   app's own colour is a part of the app.
2. **It was four corner marks.** Corner marks read as a crop guide or a
   selection handle — a tool of yours — not as an occupied region.
3. **It was a dead end.** The zone said work was happening and gave you nowhere
   to go with that. The conversation doing the work was somewhere else, and
   nothing in either place pointed at the other.

## 2. Design

### 2.1 The agent has its own colour

One violet, declared on `.marble-zone-layer` and inherited by everything in it.
It is deliberately *not* `--accent`: every document accent in this drive is a
muted blue, sage, terracotta or gold, so a saturated violet is outside that
vocabulary, which is the point. The agent is not a feature of the app it is
working in.

It is written `color-mix(in srgb, #6d55d4 78%, var(--ink))` rather than a flat
literal with a `prefers-color-scheme` variant, because dark mode in this drive is
per-document, not per-OS: a light document read on a dark-scheme machine would
otherwise get the dark-mode violet. Carrying the hue toward the document's own
ink darkens it on light paper and lightens it on dark, and needs no media query.

### 2.2 The zone is a full box you can see and click through

Closed 1.5px border, 10px radius, and a fill of the same colour at 11% (15% on
dark). The fill is what makes it read as *occupied* rather than *marked*. The
frame keeps `pointer-events: none`, so the wash is over the content and the
content is still yours to click, select and type in. Under
`prefers-reduced-transparency` the fill goes and the border stays.

### 2.3 The label is a pill with a way out

The label moves from bare text with a paper text-shadow to a pill in the zone's
own colour, still hung below the box (and above it when the box is at the foot of
the window, as before). It carries, in order: the live dot, `Agent · <what it is
doing>`, **Open chat**, **Hide**.

*Open chat* opens the conversation whose client drew this zone
(`agent:<id>` → `<id>`):

- a page that hosts its own conversation UI — it says so with
  `<meta name="marble-agent" content="custom">`, which is also what suppresses
  the dock — gets `marble-agent:open` on `document`, the event the Agents page
  already listens for to put a chat on its stage;
- everywhere else, `marble.agent.open(id)`, the dock on the right.

No change to `templates/agents.mrbl` or the live `drive/Agents.mrbl`: both
doors already existed.

### 2.4 The conversation says where its hands are, and takes you there

`marble-conversation`'s mast gains one row, under the tags: a live dot and
**Building in `<doc>`** (or **Building here** when the zone is on the page you
are reading). Pressing it jumps:

- same document → scroll the zone's target to the middle of the window and flash
  it;
- another document → navigate to `/a/<path>#at=<id>,<id>`.

`collab.js` reads `#at=` once on arrival, strips it from the URL, scrolls to the
smallest element containing those ids and flashes them. It retries for a beat,
because a page that builds its own body from script (Agents) has no such element
at first paint.

The drawer's existing `Viewing X · editing Y` line stands down while the row is
up; two ways of saying the same thing is worse than either.

### 2.5 How the conversation learns about the zone

The zone frame is broadcast on the *document's* channel, and the conversation may
be read from anywhere. So `server/agent/index.js` wraps the one `onLook` both the
tools and the runner already call, and publishes the same frame on the
conversation's own stream as `{ type: 'zone', path, ids, phase?, note? }`.

It is published, never appended: this is live state, not transcript. A page that
opens mid-turn simply has no row until the next `apply_ops`, and the turn's end
already sends `ids: []`, which clears it.

### 2.6 A zone you arrive next to

Presence is a broadcast: it reaches the tabs that were listening at the time. The
tab this feature opens is by definition not one of them — it was created by the
jump, mid-turn. Worse, it cannot be fixed by writing the standing frames down the
`/events` stream on subscribe, which was the first attempt: a page loads its
runtime in several `<script>` tags, `marble.js` opens the stream in the first and
`collab.js` registers the presence listener in the last, and the frame can be
delivered in the gap between them. It reproduced reliably on a same-tab
navigation and not at all on a cold tab, which is what that race looks like.

So the host keeps a registry of the zones standing per document (`looking` in
`server/app.js`, fed by `onLook`, an empty `ids` being a removal) and answers
`GET /presence?app=<doc>` with them. `collab.js` asks once on attach and takes
any frame it has not already heard about. Ask, rather than be told, and the race
cannot exist.

## 3. What does not change

Zone geometry and re-layout, `Hide` / `Show work` and their session key, the
phase label wording, the fork bar, `prefers-reduced-motion`.

## 4. Testing

`test-browser/collab.test.js`: the zone is a closed box with a fill; *Open chat*
on a `custom` page dispatches `marble-agent:open` and elsewhere calls
`marble.agent.open`; `#at=` scrolls and clears itself. The existing label
assertions strip *Open chat* as well as *Hide*.

`test-browser/conversation.test.js`: a running turn paints the mast row and the
row goes when the turn does; the row names the other document and pressing it
opens that document, hash spent, with the zone already drawn on arrival.

`test/agent-http.test.js`: while a turn holds a zone, `GET /presence` returns the
writing frame and the conversation's own stream carries the matching `zone`
event; the turn ending empties both.
