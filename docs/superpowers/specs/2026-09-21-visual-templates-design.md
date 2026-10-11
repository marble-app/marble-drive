# A template you can see, and a template you can brief

2026-09-21. Two changes to the same surface, which is why they are one spec.

Bryan's complaint, verbatim: *"redesign so that i don't have to read all the text
description to know what the template is. make it more visual so i can just see
what it is."* And then: *"build a functionality that lets me select a template,
and then I can follow up with the app that I want, like the changes I want to
build off of this template."*

Run autonomously at his instruction — no approval gates, decisions recorded here
instead. Where I had a real choice I have written down what I picked and what I
rejected, so the next person can disagree with the reasoning rather than guess at
it.

## What is wrong now

The gallery is two surfaces over one list (`STARTERS` in `server/gallery.js`,
served by `GET /drive/starters`):

- the **+New popover** — eight stacked rows, each a 10px square swatch, a title,
  and a sentence of prose;
- the **Templates page** — the same eight as bordered cards, same swatch, same
  sentence.

Three things make it unreadable at a glance, and none of them is the copy's
fault:

1. **Every swatch is the same colour.** All eight starters carry
   `accent: '#738698'`. The one non-textual cue on the card is identical across
   the whole set, so it distinguishes nothing.
2. **The only real differentiator is a sentence.** "Notes on a page. Select words
   and the toolbar acts on them" versus "Notes, one at a time. No toolbar" — you
   cannot tell those apart without reading both, twice.
3. **Nothing shows the document.** A template *is* a document. The drive already
   knows how to show a document without opening it — the grid view's tile mounts
   a sandboxed, script-free iframe of the real file, blown up and scaled down —
   and the gallery, of all places, does not use it.

And the commit is a `window.prompt()` for a filename. It is the only `prompt()`
left on this page.

## The shape of the answer

**A template card is a picture of the document, one word, and a colour.** No
prose on the card at all. The blurb does not get shorter — it moves one level
down, into the panel you get when you pick one, which is where somebody who
wants to read is standing.

**Picking a template does not make a document. It opens a brief.** Name, and
"what do you want to build?". Leave the second field alone and you get today's
behaviour (a clone, yours to reshape). Fill it in and the clone is handed to an
agent with your words, and you land in the new document watching it get built.

That second half is not a new subsystem — every piece exists. `drive.create()`
makes the clone, `agent.start()` + `agent.send()` brief an agent at a path, and
the drawer already renders a conversation in any document. The only thing
missing is a way to arrive at a document with a particular conversation open,
which is one deep link.

## Part 1 — the visual gallery

### The preview is the real document

`GET /drive/starters/<id>/preview` returns the starter, built, as HTML. No
document is written; nothing is stored. The page mounts it in the same
`sandbox=""` iframe the grid tiles use — the file renders, no script in it runs,
and the frame has an opaque origin. A preview is a picture, not a second live
copy.

Two transforms on the way out, both because the frame cannot run scripts anyway:

- **`<script>` elements are dropped.** This is most of the payload: the `latex`
  starter carries a typesetter, and stripping it takes the preview from 934 KB to
  50 KB. `paper` goes from 1.18 MB to 86 KB. All eight together are ~215 KB.
- **Every `<pre>` is capped at 1200 characters.** The `paper` starter carries
  `acmart.cls` as a file in its project; 40 lines of it and 4000 lines of it are
  the same grey rectangle at 0.2 scale.

Built once per id and cached in memory, beside the existing affordance-parts
cache. The starters do not change while the host runs.

*Rejected: generating PNG thumbnails at build time.* It needs a headless browser
in the build, it goes stale the moment a starter changes, and it cannot answer a
dark-mode preference. The live render cannot be wrong about what the document
looks like.

*Rejected: hand-drawn schematic glyphs as the primary identity* (a page of lines
for `doc`, a grid for `sheet`, three columns for `board`). Crisper at thumbnail
size, but it is a drawing of a category rather than a picture of the document,
and it has to be maintained in lockstep with eight files it does not live in. The
schematic survives in a reduced role: a 16px glyph in the card's footer, and the
thing that shows while the frame loads or if it fails.

### One accent per starter, from the drive's own palette

The Drive already has a palette — `SWATCHES` in `drive.mrbl`, the colours a
folder can be tinted: Research green `#2f6f5b`, Coral `#c45c3e`, Sage `#6f8f7d`,
Pearl `#7e91a3`, Slate `#3d6b8a`, Walnut `#8b5e3c`, Amber `#b45309`. The
templates take their accents from it, so a template and a folder are coloured out
of one box of pencils:

| starter | accent | |
|---|---|---|
| `doc` | Slate `#3d6b8a` | |
| `note` | Pearl `#7e91a3` | |
| `sheet` | Research green `#2f6f5b` | |
| `board` | Amber `#b45309` | |
| `slides` | Coral `#c45c3e` | |
| `canvas` | Sage `#6f8f7d` | |
| `paper` | Walnut `#8b5e3c` | one family with `latex`, |
| `latex` | Walnut `#8b5e3c` | and honest about it |

`paper` and `latex` share a colour because they are the same document with two
projects in it. Two swatches that match where the things really do match is
information, not a collision.

### The card, and the two densities

One component, two densities, because a thing that looks the same must behave
the same:

- **`.tcard`** — the tile. A 4:3 preview, and a footer of glyph + title. That is
  the whole card. Hover lifts it and eases the preview up 2%; the accent is a
  hairline along the footer's top edge, so colour arrives as part of the object
  rather than as a dot beside it.
- **`.tgrid`** — the Templates page: `auto-fill, minmax(15rem, 1fr)`, the cards
  large enough that the preview is legible.
- **`.tgrid[data-compact]`** — the +New popover: two columns of the same card at
  ~8rem, title only. The popover widens from 19rem to 23rem to hold them.

Order is by family rather than by anything alphabetical: `doc`, `note` (write),
`sheet`, `board`, `canvas` (structure), `slides` (present), `paper`, `latex`
(publish). Related things sit next to each other and the grid does the grouping
without a heading.

### What the card does not say

No blurb, no byte count, no part list. Everything the old card said in prose is
either visible in the preview or one click away in the panel. The person's
complaint was *reading*; the fix is not shorter sentences, it is fewer.

## Part 2 — the brief

### The panel

Picking a card — from either surface — opens **`#start`**, a card over a scrim:

```
┌───────────────────────────────────────────────────────────┐
│  ┌─────────────────┐   Board                    Amber ▔  │
│  │                 │   Columns of cards. A card's column  │
│  │   live preview  │   is where it sits and nothing else. │
│  │   at 0.34       │                                      │
│  │                 │   Name                               │
│  │                 │   [ Board                          ] │
│  └─────────────────┘                                      │
│                        What do you want to build?         │
│                        [                                ] │
│                        [                                ] │
│                        ( idea ) ( idea ) ( idea )         │
│                                                           │
│  into Research/Marble              [ Cancel ]  [ Create ] │
└───────────────────────────────────────────────────────────┘
```

- **The preview again, larger.** Same route, same sandboxed frame, 0.34 instead
  of 0.2. The picture you clicked is the picture you are looking at; nothing
  swaps under you.
- **The blurb.** Here, and only here.
- **Name**, prefilled with the template's own name and selected on open, so
  typing replaces it and Enter accepts it.
- **"What do you want to build?"**, a textarea, explicitly optional.
- **Three idea chips.** One tap fills the field. They are concrete — "a reading
  list with a column for status and one for rating" — because an empty prompt
  field teaches nothing about what is possible, and three examples teach most of
  it. They live in `STARTERS` beside the blurb: a starter arrives with its own
  ideas, and the page holds no per-template copy.
- **Where it lands**, named in the footer. `into My Drive` or `into
  Research/Marble`. A create that puts the file somewhere you were not looking is
  the one failure this panel can still have, so it says the folder out loud.
- **One primary button whose label is the truth.** `Create` while the prompt is
  empty, `Create & build` the moment it is not. Not two buttons where one is
  always dead.

Keys: Enter in the name commits. ⌘/Ctrl+Enter in the prompt commits (Enter there
is a newline). Escape closes. The way back, not a dialog.

Motion, per the drive's own tokens and the apple-design rules: the panel scales
up from the rect of the card that was clicked (`transform-origin` set from
script, once, per opening — the same thing the row menu and the +New popover
already do), and leaves along the same path. The scrim fades. `--settle` is the
curve, `--t` the clock; `prefers-reduced-motion` gets the cross-fade and no
scale.

### What happens on commit

With an empty prompt, exactly what happens today, minus the `prompt()`:

1. `drive.create({ path: here/name, from: id })`
2. go to the new document.

With a prompt:

1. `drive.create({ path: here/name, from: id })` — the document exists first, so
   the agent has something to be aimed at.
2. `agent.start({ provider: settings.defaultProvider })`
3. `agent.send(id, { prompt: brief, target: newPath, viewing: newPath })`
4. go to `/a/<newPath>#chat=<conversation>`.

The button reads `Creating…` and is disabled while that runs — feedback at the
control, not a toast somewhere else. If the agent surface is missing or any of
2–4 fails, step 1 still happened: say so plainly ("Made the document — no agent
here") and go to the document anyway. A half-failure must not lose the file.

The brief the agent gets is short, because `INSTRUCTIONS` already tells it what
a Marble document is and what the ids are for:

> I just made this document from the "Board" template in Marble Drive — a fresh
> clone, so all of it is mine to change.
>
> What I want: **<their words>**
>
> Build it in this document. Keep it one file that works on its own, the way the
> template does.

### The deep link

`#chat=<id>` on a document URL: the drawer boots open on that conversation. Added
to `runtime/agent-ui.js` where the drawer already reads its remembered open
state, and it is general — the Agents page, a callout and the Drive all have a
reason to hand somebody a conversation. It sits beside collab's existing
`#at=<ids>`, which lands you on elements.

*Rejected: writing the drawer's private localStorage keys from the Drive
document.* It works, and it makes `marble-agent:open` part of drive.mrbl's
contract with a runtime it should not know that much about.

*Rejected: staying on the Drive with a progress row.* The interesting thing is
the document changing under the agent's hands. Watching a spinner in a file
listing is strictly worse, and the Drive already has a drawer if you want the
conversation without the document.

## Where the code goes

| file | change |
|---|---|
| `server/gallery.js` | per-starter `accent`, `ideas`, `hint`; `preview(id)`, cached |
| `server/app.js` | `GET /drive/starters/<id>/preview` |
| `runtime/drive.js` | `starterPreviewHref(id)` — a document never names a route |
| `runtime/agent-ui.js` | `#chat=<id>` at drawer boot |
| `templates/drive.mrbl` | gallery CSS, `#start` markup, the script |
| `drive/drive.mrbl` | the same, by exact-string replace of the shared regions |
| `docs/GALLERY.md` | the preview route, the new fields, why the card has no prose |
| `test/gallery.test.js` | preview is script-free, capped, cached; metadata is complete |
| `test/server.test.js` | the route answers, and 404s an unknown id |
| `test-browser/drive-templates.test.js` | new: the gallery, the panel, both commits |

## Testing

Node suites: the preview strips every `<script>`, caps every `<pre>`, is byte-
identical on a second call, and 404s an id nobody has. Every starter carries a
distinct-or-deliberately-shared accent, three ideas, and a hint.

Browser suite, against `buildDrive()` (the template) and then spot-checked
against the live `drive/drive.mrbl` bytes:

- the Templates page draws eight cards, each with a preview frame pointing at its
  own preview route, and no card contains the blurb text;
- clicking a card opens `#start` with that template's name prefilled and its
  three ideas;
- Create with an empty prompt makes the document and navigates — no `prompt()`;
- Create with a prompt makes the document, starts a conversation against the fake
  provider, sends a turn whose text contains the person's words, and lands on
  `/a/<path>#chat=<id>`;
- Escape closes the panel and makes nothing;
- the +New popover draws the same cards in two columns and its card opens the
  same panel.

## Deliberately not built

- **Saving your own templates.** A document you clone is already a template;
  "Duplicate" is in the row menu. Nothing was asked for here.
- **A parts/affordance list on the card.** It is the most interesting thing about
  a starter to the person who wrote it and the least interesting to the person
  choosing one.
- **Search or filter over eight templates.**
- **A second agent turn ("and now add…") from the panel.** The document's own
  drawer is where the second thing you want is said, and it is already there when
  you land.
