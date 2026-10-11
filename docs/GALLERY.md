# The template gallery

> `bin/scaffold.js` already builds a document out of a starter plus named parts
> of the affordance library. Promote it to a route and ship the starters: doc,
> sheet, slides, board, canvas. "New sheet" is a clone, and the clone is yours to
> reshape — which is the part Drive cannot offer.
>
> — the `k-gal` card

## How a starter is built

A starter is markup in `starters/<id>.mrbl` plus a list of affordance parts in
`server/gallery.js`. At create time:

1. Marble's `lib/affordances.js` is read and cut at its `// ==== part: name ====`
   markers.
2. `lib/affordances.drive.js` is read the same way, and **can override by name**. There is no override today.
3. The parts the starter asked for — plus `shared` and `tail`, which open and
   close the closure, plus `grip` if anything needs a handle — are joined *in the
   base file's order*, because they are pieces of one closure.
4. `__TITLE__`, every `__ID__`, and `__SCRIPT__` are substituted. Each `__ID__`
   gets its own freshly minted id; no id may appear twice in a document.

The result is a self-contained file. The behaviour is copied into it, not linked
from here, which is the point rather than a compromise: a host that shipped
these would have decided what a drag looks like for every document it ever
opened.

## Overrides

`lib/affordances.drive.js` can replace a Marble part by name. There is no
override today. The file once replaced `sortable` because Marble's used HTML5
drag-and-drop, which a finger cannot fire; Marble's sortable is pointer-driven
now, so a Drive-specific copy would only drift.

An override that Marble has no part for is a build error rather than a silently
ignored file.

## The eight

In the order the gallery draws them, which is by family — write, structure,
present, publish.

| | |
|---|---|
| `doc` | notes on a page. A ruler whose markers are the page's margins, a toolbar that is markup in the file, and formatting that lands on the words you selected |
| `note` | the same document with everything taken out of it and one thing put in: several notes in the one file, with the open one an attribute on `<body>`. Not a page you compose — a place you put text |
| `sheet` | a grid of cells. Rows are sortable and the column count is one custom property, so adding a column is a cell per row plus one number |
| `board` | columns of cards. A card's column is where it sits and nothing else |
| `canvas` | notes placed anywhere; the position is an inline style on the note |
| `slides` | one section per slide. The slide number is a CSS counter, so reordering renumbers without touching a byte |
| `paper` | a LaTeX document with a CHI submission in it: `acmart` in two columns, a folder tree derived from the file names, and a button that rewrites the class option when a draft needs one column instead of two |
| `latex` | a LaTeX project. The sources are `<pre>` elements, the typesetter and the PDF writer are scripts beside them, and the PDF is the only thing in the room that is not kept |

The last two are one document with two projects in it. `starters/latex/` is a
folder of parts rather than a single file, and `starters/paper/` is three files,
two of which are nothing but `<!-- include: ../latex/… -->` lines. A starter
that is a folder is concatenated in name order and its includes expanded, so
what leaves here is still one file with no seams in it — and a fix to the
typesetter is one fix rather than two.

Two of them do something the affordance library cannot, and do it in their own
`<script>`: the sheet's "+ column" (three kinds of edit in one gesture, filed as
one undo step), and the doc's editing model. The doc is the larger case, and the
instructive one.

It asks for `editable`, `history` and `status` and nothing else. No `sortable`,
`removable` or `add`, because a drag handle and a delete cross beside every
paragraph are what an outliner looks like and not what writing looks like; Enter
splitting a paragraph at the caret, Backspace joining it to the one above and
the arrow keys crossing between paragraphs do that work instead, from one
keydown listener in the document's own `<script>`.

**It also invents an affordance, which is the part worth reading.** `editable`
is a `setText` affordance: an element's whole contents are replaced on every
keystroke, which is right for a name in the chrome and fatal to a `<b>` in the
middle of a sentence — and the doctor says so, refusing any `data-marble-editable`
that holds addressed children. So the doc marks its paragraphs
`data-marble-rich` and edits them with `setInner`, keeping the inline markup.
Three things fall out of that and each is written down in the file next to the
code that needs it:

- **Two kinds of property, two places.** What belongs to the paragraph — style,
  alignment, list, indent — is one attribute on the block, so each change is one
  `setAttr`. What belongs to the characters — weight, slant, colour, face, size
  — is inline markup around them. The toolbar picks which by whether anything is
  selected.
- **A vocabulary, and a filter.** A `contenteditable` will write far more than
  `<b>`, `<i>`, `<u>`, `<s>`, `<br>` and a styled `<span>` given a paste or a
  stray shortcut, so what comes out of the browser is filtered down to that list
  before it reaches the file rather than trusted on the way out.
- **Undo is the document's own.** The carrier coalesces `setText` and not
  `setInner`, so a burst of typing is grouped into one step here instead; and
  the shared `history` part steps aside inside any `contenteditable` that is not
  a `data-marble-editable`, so the doc binds Ctrl+Z itself rather than letting
  the browser's stack desync the page from the file.

That is the intended way to extend a document — the generic parts handle the
generic gestures, and a document is allowed to know things about itself, up to
and including what an edit to it means.

## What a card shows

Nothing you have to read but the name.

Each card in the gallery mounts the real starter — built, and with everything
runnable taken out of it — in a `sandbox=""` iframe, blown up and scaled back
down, which is the same trick the Drive's own grid tiles use on documents. So a
template is chosen by looking at it. `GET /drive/starters/<id>/preview` is what
the card asks for; `preview()` builds it, and nothing is written by asking.

Two transforms on the way out, and both are free because the frame could not run
anything anyway:

- **every `<script>` goes.** It is most of the payload. `latex` carries a
  typesetter: 934 KB becomes 50 KB, and `paper` 1.18 MB becomes 86 KB. All eight
  previews together are about 215 KB.
- **every `<pre>` is capped at 1200 characters.** `paper` carries `acmart.cls` as
  a file in its project, and forty lines of it and four thousand are the same
  grey rectangle at a fifth of scale.

Built once per id and kept, beside the affordance-parts cache and for the same
reason: the starters do not change while the host runs.

The other two cues are colour and shape. Each starter carries an `accent` out of
the Drive's own folder palette — the colours a folder can be tinted — so a
template and a folder are coloured from one box of pencils. They were all
`#738698` once, which made the swatch on a card the one cue that distinguished
nothing:

| | | | |
|---|---|---|---|
| `doc` | Slate `#3d6b8a` | `canvas` | Sage `#6f8f7d` |
| `note` | Pearl `#7e91a3` | `slides` | Coral `#c45c3e` |
| `sheet` | Research green `#2f6f5b` | `paper` | Walnut `#8b5e3c` |
| `board` | Amber `#b45309` | `latex` | Walnut `#8b5e3c` |

`paper` and `latex` share Walnut, because they are one document with two projects
in it and a card that said otherwise would be lying. The shape is a schematic
drawn in `drive.mrbl` — lines on a page, a grid, three columns — which shows
while the frame loads, stays if it never does, and sits in the card's foot
whatever happens.

The order is by family: write, structure, present, publish. The grid does the
grouping, so no heading has to.

**The blurb did not get shorter. It moved.** It is in the panel you get when you
pick one, which is where somebody who wants to read is standing — and on the
card's `title`, for a hover.

## Starting from one

Picking a template does not make a document. It opens a brief: what to call it,
and *what do you want to build?* Leave that second field alone and it is the
clone it always was. Fill it in and the clone is handed to an agent.

Three ideas sit under the field, concrete and one tap each, because an empty
prompt field teaches nothing about what a starter can become and three examples
teach most of it. They travel with the starter — `ideas` beside `blurb` and
`hint` in `STARTERS` — so a new starter arrives with its own and the page holds
no per-template copy.

What happens on commit, in order, because the order is the whole of the error
handling:

1. `drive.create({ path, from })`. The document exists first, so there is
   something for an agent to be aimed at.
2. With an empty prompt, go to it. Done.
3. Otherwise `agent.start({ provider: defaultProvider })` and `agent.send(…)`
   with the brief, `target` and `viewing` both the new path.
4. Go to `/a/<path>#chat=<conversation>`, which is a deep link
   `runtime/agent-ui.js` reads at boot: the drawer opens on that conversation
   whatever was left open last. It sits beside collab's `#at=<ids>`, which lands
   you on elements rather than on a chat.

**Step 1 has already happened by the time any of the rest can fail.** So a
failure from there is said out loud and then walked past — you land in the
document either way. Losing the file because no agent could be reached would be
much the worse of the two outcomes.

The brief itself is short, because `INSTRUCTIONS` already tells an agent what a
Marble document is and what the ids in it are for. What it cannot know is which
template this came out of, and that every part of it is fair game:

> I just made this document from the “Board” template in Marble Drive — a fresh
> clone, so all of it is mine to change.
>
> What I want: *what you typed*
>
> Build it in this document. Keep it one file that works on its own, the way the
> template does.

## What it costs

**There are no upgrades.** A fix to the sheet starter never reaches the sheets
already made from it. An app is a document you clone, not a program that opens
your data, and that is a straight consequence of the thesis rather than an
implementation detail. Somebody's spreadsheet is theirs, including its bugs.

The version of this we do not build: a starter that stays linked to its origin
and pulls fixes. That is a program opening your data with extra steps, and the
first document that accepts an upgrade it did not ask for is the first document
that is not yours.
