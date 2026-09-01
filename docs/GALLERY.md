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
2. `lib/affordances.drive.js` is read the same way, and **overrides by name**.
3. The parts the starter asked for — plus `shared` and `tail`, which open and
   close the closure, plus `grip` if anything needs a handle — are joined *in the
   base file's order*, because they are pieces of one closure.
4. `__TITLE__`, every `__ID__`, and `__SCRIPT__` are substituted. Each `__ID__`
   gets its own freshly minted id; no id may appear twice in a document.

The result is a self-contained file. The behaviour is copied into it, not linked
from here, which is the point rather than a compromise: a host that shipped
these would have decided what a drag looks like for every document it ever
opened.

## The one override

`lib/affordances.drive.js` replaces `sortable`. Marble's is built on the HTML5
drag-and-drop API, which fires nothing for a finger — so reorder is the single
gesture in the affordance library a phone cannot perform, which is the `k-touch`
card. The replacement is pointer-driven, has a keyboard path (focus the handle,
press the arrow keys), and sets `touch-action: none` so a drag does not scroll
the page instead.

Everything else is Marble's, unchanged. An override that Marble has no part for
is a build error rather than a silently ignored file.

## The six

| | |
|---|---|
| `doc` | notes on a page. A ruler whose markers are the page's margins, a toolbar that is markup in the file, and formatting that lands on the words you selected |
| `sheet` | a grid of cells. Rows are sortable and the column count is one custom property, so adding a column is a cell per row plus one number |
| `slides` | one section per slide. The slide number is a CSS counter, so reordering renumbers without touching a byte |
| `board` | columns of cards. A card's column is where it sits and nothing else |
| `canvas` | notes placed anywhere; the position is an inline style on the note |
| `latex` | a LaTeX project. The sources are `<pre>` elements, the typesetter and the PDF writer are scripts beside them, and the PDF is the only thing in the room that is not kept |

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

## What it costs

**There are no upgrades.** A fix to the sheet starter never reaches the sheets
already made from it. An app is a document you clone, not a program that opens
your data, and that is a straight consequence of the thesis rather than an
implementation detail. Somebody's spreadsheet is theirs, including its bugs.

The version of this we do not build: a starter that stays linked to its origin
and pulls fixes. That is a program opening your data with extra steps, and the
first document that accepts an upgrade it did not ask for is the first document
that is not yours.
