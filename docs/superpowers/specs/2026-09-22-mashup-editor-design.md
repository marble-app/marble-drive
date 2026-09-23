# Mashup Studio: the clip editor

2026-09-22. For drive/Fun/Song Mashups/Mashup Studio.mrbl.

## Why

Bryan heard Ariana's chorus in the beat arrive before Billie's chorus in the
vocals. The arrangement was a list of rows, each naming a vocal bar range and
a beat bar range, so the only way to fix that was to guess bar numbers without
seeing either song. He wants to take the instrumental apart bar by bar and put
the bars back where they fit the vocals.

Asked for, then dropped by him: four-stem splitting (drums/bass/other). The
host splitter stays two-stem. This is an editor for the two stems he has.

## What

An **Editor** panel replaces both the section list (Arrangement) and the
Line up panel. Both did the same job with less to see.

- **Two lanes on one bar ruler**: Vocals (Billie) and Beat (Ariana), each
  drawn as a waveform already at the tempo the two meet at. Ruler numbers
  are mashup bars.
- **Clips.** A clip is a stretch of one song placed on the timeline:
  `<li class="clip" data-lane="vocals|beat" data-at data-from data-len>` in
  a hidden `<ol class="clips">`. All three numbers are in beats at the
  meeting tempo. `at` is where it plays in the mashup, `from` is where it
  starts in its own song counted from that song's bar 1, and `len` is how
  long it runs. Beats rather than seconds, so changing the tempo or bar 1
  never moves a clip.
- **Gestures.** Click selects (⇧ adds). Drag moves and snaps to bars; the
  Snap control switches to beats or off, and holding ⌘/Ctrl turns snapping
  off for one drag (⌥ is taken by copying). Dragging a clip's edge trims
  it. ⌥-drag leaves a copy behind.
  `S` splits at the playhead (the selected clips, or every clip under the
  playhead). ⌘D duplicates right after itself. Delete removes. ←/→ nudges
  (⇧ by a bar, ⌥ by a twentieth of a beat); with nothing selected they move
  the playhead instead. Clicking the ruler or an empty lane moves the playhead.
  ⌘/Ctrl-wheel or pinch zooms; Fit shows the whole song.
- **Dropping over a clip overwrites it** in that lane: covered clips are
  trimmed, split or removed. The beat is meant to be rebuilt, so a
  dropped chorus replaces the verse bars under it instead of piling on top.
- **Ariana's bars.** A strip under the lanes shows the whole instrumental,
  bars numbered, with the bars already used shaded. Drag across it to pick
  bars; drag the pick into the Beat lane, or press *Place at playhead*,
  which also moves the playhead to the end of what was placed so repeated
  presses build the song. Clicking the strip plays her song from that bar.
- **Every edit is one undo step**, however many clips it touches (split = a
  setAttr plus an insert, overwrite = setAttrs, inserts and removes).

## How it plays

No offline pre-render of lanes any more. Play schedules each clip straight
onto the live context from the conformed (tempo/key-fitted) buffer, so an
edit costs a reschedule, not a re-render. Save as WAV runs the same schedule
through an OfflineAudioContext and the same mix chain. `data-fade` still
crossfades every clip edge, and `data-nudge` still shifts the vocal lane.

## Carry-over

The current arrangement (8 rows, `data-v-offset` 7.2 beats) was converted
into clips once, when the editor went in, so the first play sounds exactly
like the last. The vocals merge into one continuous clip. Beat loops
become one clip per pass. The converted clips were filed as markup; the
page has no conversion code. The old rows' names (Intro, Verse 1, Chorus
at her bars 17–24, …) went with them.

## Not doing

Four stems, per-clip gain, markers or labels, and moving a clip between
lanes (a clip's source is its lane's song).

## Testing

Headless: a throwaway host (`MARBLE_DRIVE_ROOT=/tmp/sdrive`, stems
symlinked) serving a copy of the doc, driven by the repo's Playwright
(/tmp/ed/test.mjs). 27 checks, all passing against the finished file: the
13 converted clips load; select, move, trim, ⌥-copy, split, delete,
duplicate, pick-and-place and drag-from-strip file the right attributes;
landing on a clip trims, splits or removes it; each gesture undoes in one
step; play runs and the total is the clips' length; Save as WAV is the
clips' length plus the 2.5 s tail; the file on disk ends with the right
clips; no page errors. Also looked at: fit, zoomed, and a 400 px dark view.
Not checked: that the converted clips sound sample-identical to the old
section list (the old code was replaced, so there was nothing to render
against).

## Palette (added the same evening)

Bryan asked for "a small spatial canvas space that holds these music things,
like my little palette". It sits under the editor.

- A card is `<li class="swatch" data-lane data-from data-len data-x data-y>`
  in `<ol class="swatches">`, with its name as an editable `.sw-name`. It
  holds a stretch of one record, like a clip that is not placed anywhere
  yet. x and y are pixels on the space, which scrolls sideways when the page
  is narrower than the cards are spread, instead of squeezing them together.
- Positions are drawn by a constructed stylesheet (`adoptedStyleSheets`),
  never written onto the card, so nothing page-only reaches the file.
  The dragged card is a transient clone (`.marble-pal-lift`), so it can leave
  the scrolling space.
- **In:** drag a clip down from the lanes, or a pick down from Ariana's
  strip. The source stays where it was: the palette keeps a copy.
- **Out:** drag a card onto its own lane, which previews the drop with the
  dashed ghost and overwrites what it lands on. The card stays in the
  palette. A beat card held over the vocals lane says where it belongs.
  *Use* places it at the playhead.
- Click a card to hear it, fitted to the mashup's tempo and key, through the
  same mix. × or ⌫ removes it. Every change is one undo step.
- Seeded with the five stretches of Ariana's beat the arrangement used, named
  for what they sat under.
- The page never loaded Marble's affordance library, so `data-marble-editable`
  has never worked here (the title, the lede and the to-dos are affected too).
  The palette wires its own card names, with `pageOnly('contenteditable')`.

Tested: /tmp/ed/test2.mjs, 23 checks against a fixture on a fresh throwaway
host, plus the editor suite again; both pass.
