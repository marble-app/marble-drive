# Drawing the change: worked examples

Each example is one still from the spec (Notes and Sketches/Ask at Anything, v5 and v6), worked as the card and the marks one call would send, with **why** the tool is that tool. Ids are made up. Most are walks (each part needs thought and follows the last); the rules and the judgment are near the end. They are grouped by the *kind of work*, because that is what carries over: picking arrivals on a seismogram and picking chords on a lead sheet are both "work along a line, one place at a time", whatever the subject.

Use them as reasoning to borrow, never as a menu. If your design is one of these with the nouns changed, go back to the card's Tool line and answer it for your artifact.

---

## Filling: values written into places that are empty

### Itinerary table — fill in where each day happens
`Artifact` a week's itinerary · `Unit` day / days · `Order` down the Where column, day by day · `Tool` a spreadsheet's cell cursor on the cell being filled · `Ahead` — (the empty cells already show it) · `Before` — · `Tag` Filling 3 of 4 days
```json
{"verb":"Filling","unit":["day","days"],"draw":[{"at":"wed-where","shape":"ring","key":"tool"}]}
```
Why: anyone who has filled a column knows the cell cursor; it says which cell, not "somewhere in the table".

### Plate map — lay out a dilution series (biology)
`Artifact` a 96-well plate map for a dilution series · `Unit` well / wells · `Order` the protocol's: column by column, the controls left alone · `Tool` the tip's ring on the well being filled · `Ahead` the wells still to fill, outlined dashed · `Before` — · `Tag` Filling 36 of 80 wells
```json
{"verb":"Filling","unit":["well","wells"],"draw":[{"at":"C5","shape":"ring","key":"tool"},{"at":"D5","as":"ahead","shape":"ring"},{"at":"E5","as":"ahead","shape":"ring"},{"at":"F5","as":"ahead","shape":"ring"}]}
```
Why: a ring is what you look at over a pipette tip, and a plan on a plate map is drawn as outlined wells. More than a dozen ahead: send them in `reach` and ring only the next few.

### Booking form — book a room for Thursday
`Artifact` a room-booking form · `Unit` field / fields · `Order` the form's own, top to bottom · `Tool` a ring on the field being filled · `Ahead` the Book button, ringed dashed, and left for the person · `Before` — · `Tag` Filling 2 of 3 fields
```json
{"verb":"Filling","unit":["field","fields"],"draw":[{"at":"f-day","shape":"ring","key":"tool"},{"at":"book","as":"ahead","shape":"ring"}]}
```
Why: focus rings are how forms show where you are. The press that sends is the person's: it is shown as next, never pressed.

### Glossed example — gloss a Turkish sentence (languages)
`Artifact` an interlinear glossed example · `Unit` word / words · `Order` word by word, left to right (right to left in a right-to-left script) · `Tool` the word being glossed, boxed, with a caret in its gloss line · `Ahead` an empty slot under each word still to gloss · `Before` — · `Tag` Glossing 3 of 4 words
```json
{"verb":"Glossing","unit":["word","words"],"draw":[{"at":"w3","shape":"ring","key":"tool"},{"at":"w3","on":"below","shape":"line"},{"at":"w4","on":"below","as":"ahead","shape":"line"}]}
```
Why: a linguist's interlinear has a line under every word waiting for its gloss; the empty slot is the plan.

### Runs in a results table — run an ablation, three seeds each (computer science)
`Artifact` an ablation results table, one cell per run · `Unit` run / runs · `Order` as runs finish, not row by row · `Tool` in the running cell, its elapsed time · `Ahead` queued cells written faint · `Before` — · `Tag` Running 7 of 12 runs
```json
{"verb":"Running","unit":["run","runs"],"draw":[{"at":"wide-s2","text":"38 m","as":"now"},{"at":"wide-s3","text":"21 m"},{"at":"both-s1","text":"queued","as":"ahead"}]}
```
Why: long work shows how long it has run and what waits behind it; the score itself lands as content when the run finishes.

---

## Placing: new parts arriving

### List — add the papers
`Artifact` a reading list · `Unit` paper / papers · `Order` where each belongs, not always the end · `Tool` a line where the next row will land, before it exists · `Ahead` — · `Before` — · `Tag` Adding 3 of 4 papers
```json
{"verb":"Adding","unit":["paper","papers"],"draw":[{"at":"p7","on":"below","shape":"line","key":"tool"}]}
```
Why: it is the drop line of every sortable list: where it will go is shown before it is there.

### Kinship chart — chart the household from field notes (anthropology)
`Artifact` a kinship chart · `Unit` person / people · `Order` by descent, generation by generation · `Tool` the end of the line being drawn to the next person · `Ahead` the next person as a dashed outline at that end · `Before` — · `Tag` Placing 8 of 9 people
```json
{"verb":"Placing","unit":["person","people"],"draw":[{"at":"chart","svg":"<path d='M52 40V62'/>","key":"tool"},{"at":"chart","as":"ahead","svg":"<rect x='47' y='62' width='10' height='9'/>"}]}
```
Why: the chart's own marks (lines of descent, a place for a person) carry the plan; nothing is drawn that a kinship chart does not already have.

### Sampling sites — place a site every 2 km downstream (environment)
`Artifact` a sampling map along a river · `Unit` site / sites · `Order` downstream, measured along the water · `Tool` the site being placed, with its distance from the last · `Ahead` the sites still to place, dashed rings at the same spacing · `Before` — · `Tag` Placing 4 of 7 sites
```json
{"verb":"Placing","unit":["site","sites"],"draw":[{"at":"river","shape":"dot","x":46,"y":38,"text":"2.0 km","key":"tool"},{"at":"river","as":"ahead","svg":"<circle cx='58' cy='47' r='1.2'/><circle cx='69' cy='58' r='1.2'/><circle cx='80' cy='66' r='1.2'/>"}]}
```
Why: spacing is the rule, so the distance is the label; the dashed rings show the rule's future.

### A new section — add a section for open questions (building)
`Artifact` a spec page · `Unit` block / blocks · `Order` laid out first at full size, then filled from the top · `Tool` a line where the next block lands · `Ahead` each block still to come as a dashed outline of its place · `Before` — · `Tag` Adding 3 of 7 blocks
```json
{"verb":"Adding","unit":["block","blocks"],"draw":[{"at":"q-3","on":"below","shape":"line","key":"tool"},{"at":"q-4","as":"ahead","shape":"ring"},{"at":"q-5","as":"ahead","shape":"ring"}]}
```
Why: laying out at full size first means what is below moves once, not with every line; the outlines are the blueprint. (Insert the stubs in the first stage, then fill them.)

---

## Measuring: edges, sizes and spans that move

### Shape — widen the box by 24 px
`Artifact` a placed box · `Unit` px · `Order` one edge, one motion · `Tool` handles on the box and a measure above it · `Ahead` the size it is heading for, dashed · `Before` — · `Tag` Widening 15 of 24 px
```json
{"verb":"Widening","measure":{"now":15,"of":24,"unit":"px"},"draw":[{"at":"box","shape":"ring","key":"tool"},{"at":"box","as":"ahead","svg":"<rect x='0' y='0' width='118' height='100'/>"},{"at":"box","on":"above","text":"+24 px"}]}
```
Why: a measure is a number, so the tag counts the number, not the parts. Coordinates past 100 draw outside the part.

### Street section — fit a protected bike lane (urban design)
`Artifact` a street cross-section, building face to building face · `Unit` m · `Order` lane by lane across the section · `Tool` handles on the lane being resized · `Ahead` — · `Before` the lane's old edge, dashed · `Tag` Fitting 18.0 of 18.0 m
```json
{"verb":"Fitting","measure":{"now":18,"of":18,"unit":"m"},"draw":[{"at":"lane-2","shape":"ring","key":"tool"},{"at":"lane-2","as":"before","svg":"<path d='M112 0V100'/>"}]}
```
Why: the constraint is the total width, so the tag keeps a running total; the dashed old edge shows how far it moved.

### Calendar — find 90 minutes on Wednesday
`Artifact` a week calendar · `Unit` hours and minutes · `Order` along the day · `Tool` a block dragged over the hours it wants, with its times · `Ahead` — · `Before` — · `Tag` Holding 1 h 30
```json
{"verb":"Holding","measure":{"now":90,"unit":"min"},"draw":[{"at":"wed","svg":"<rect class='fill' x='4' y='25' width='92' height='19'/>","text":"10:00–11:30","x":50,"y":34,"key":"tool"}]}
```
Why: a calendar is worked by dragging out a block; nothing is booked until the change lets go.

### Gantt chart — give Build two more days
`Artifact` a project timeline · `Unit` day / days · `Order` the task, then what depends on it · `Tool` the end of the bar being stretched, with the new length · `Ahead` — · `Before` the old end, dashed; the moved task's ghost · `Tag` Stretching +2 days
```json
{"verb":"Stretching","measure":{"now":2,"unit":"days"},"draw":[{"at":"t-build","on":"end","shape":"line","key":"tool","text":"+2 days"},{"at":"t-build","as":"before","svg":"<path d='M72 0V100'/>"}]}
```

### Board — move Typing to Doing
`Artifact` a kanban board · `Unit` card / cards · `Order` one card, one column · `Tool` the card held up, and a line in Doing where it will drop · `Ahead` — · `Before` — · `Tag` Moving 1 card
```json
{"verb":"Moving","unit":["card","cards"],"draw":[{"at":"card-typing","shape":"ring","key":"tool"},{"at":"card-caret","on":"below","shape":"line"}]}
```

---

## Connecting and drawing

### Diagram — connect Change to Undo
`Artifact` a flow diagram · `Unit` arrow / arrows · `Order` one connector · `Tool` the loose end of the line being drawn · `Ahead` a ring on the box it will join · `Before` — · `Tag` Connecting 1 arrow
```json
{"verb":"Connecting","unit":["arrow","arrows"],"draw":[{"at":"diagram","svg":"<path d='M40 50H62'/>","key":"tool"},{"at":"box-undo","as":"ahead","shape":"ring"}]}
```

### Seismograms — pick the first arrivals (earth sciences)
`Artifact` a record section, one trace per station · `Unit` station / stations · `Order` by distance from the event, nearest first · `Tool` a cursor on the trace being read; a pick line on each trace read · `Ahead` the travel-time curve where the rest should fall, dotted · `Before` — · `Tag` Picking 4 of 5 stations
```json
{"verb":"Picking","unit":["station","stations"],"draw":[{"at":"isa","shape":"ring","key":"tool"},{"at":"gor","svg":"<path d='M34 0V100'/>","text":"P 5.88 s","x":34,"y":0},{"at":"stack","as":"ahead","svg":"<polyline points='42,75 50,100'/>"}]}
```
Why: a seismologist's picks are vertical lines on the trace; the travel-time curve is their plan.

### Forest plot — pool the sites' results (health)
`Artifact` a forest plot · `Unit` site / sites · `Order` site by site as each report is read · `Tool` the row landing now · `Ahead` the pooled diamond, dashed, moving as rows arrive · `Before` — · `Tag` Pooling 5 of 6 sites
```json
{"verb":"Pooling","unit":["site","sites"],"draw":[{"at":"row-lima","shape":"ring","key":"tool"},{"at":"pooled","as":"ahead","svg":"<polygon points='42,50 51,20 60,50 51,80'/>"}]}
```
Why: the pooled estimate is not known until the last site; dashed says "provisional" in the plot's own shape.

### Map — find a way across town
`Artifact` a street map · `Unit` km · `Order` along the route · `Tool` a dot where it is now · `Ahead` nothing: the road ahead is drawn only once it gets there · `Before` — · `Tag` Routing 1.2 of 2.0 km
```json
{"verb":"Routing","measure":{"now":1.2,"of":2,"unit":"km"},"draw":[{"at":"map","svg":"<polyline points='12,80 20,72 31,70 38,58'/>"},{"at":"map","shape":"dot","x":38,"y":58,"key":"tool"}]}
```
Why: when the future is not known, do not draw it. Ahead is for plans, not guesses.

### Calcium imaging — find the active cells (neuroscience)
`Artifact` a calcium recording with its cell traces · `Unit` cell / cells · `Order` cell by cell across the field, each outline checked against the ones already drawn so none overlap · `Tool` the cell being outlined, dashed until it closes · `Ahead` — · `Before` — · `Tag` Outlining 5 of 9 cells
```json
{"verb":"Outlining","unit":["cell","cells"],"draw":[{"at":"field","as":"ahead","svg":"<ellipse cx='62' cy='40' rx='6' ry='5'/>","key":"tool"},{"at":"trace-5","on":"start","shape":"line"}]}
```

---

## Cutting and editing along a line

### Recording — cut the long pause
`Artifact` an interview recording, as a waveform · `Unit` seconds · `Order` along time · `Tool` a playhead at the cut · `Ahead` a wash over the pause it will take out · `Before` — · `Tag` Cutting 0:28
```json
{"verb":"Cutting","measure":{"now":28,"unit":"s"},"draw":[{"at":"wave","shape":"line","x":41,"key":"tool"},{"at":"wave","as":"ahead","svg":"<rect class='fill' x='41' y='0' width='12' height='100'/>"}]}
```

### Code — give pictures a tool of their own
`Artifact` a source file · `Unit` line / lines (or case / cases) · `Order` top of the function down · `Tool` the caret's line · `Ahead` — · `Before` — · `Tag` Writing 3 of 3 cases
```json
{"verb":"Writing","unit":["case","cases"],"draw":[{"at":"l15","on":"start","shape":"line","key":"tool"},{"at":"l13","on":"start","shape":"dot","y":50},{"at":"l14","on":"start","shape":"dot","y":50}]}
```
Why: editors mark touched lines in the gutter; the caret says which line now.

---

## Matching, sorting and grouping

### Affinity map — group the interview notes (HCI)
`Artifact` an affinity map of interview notes · `Unit` note / notes · `Order` as each note is read · `Tool` the note held over the group it will join, a line where it will land · `Ahead` the pile still to sort, with its count · `Before` — · `Tag` Sorting 23 of 40 notes
```json
{"verb":"Sorting","unit":["note","notes"],"draw":[{"at":"n23","shape":"ring","key":"tool"},{"at":"g-backups","on":"below","shape":"line"},{"at":"pile","as":"ahead","text":"17 to sort"}]}
```

---

## Reading and checking

### Sources under a claim
`Artifact` a claim in a paper, with its citations · `Unit` source / sources · `Order` source by source · `Tool` a ring on the source being read, the passage it rests on · `Ahead` — · `Before` — · `Tag` Checking 3 of 4 sources
```json
{"verb":"Checking","unit":["source","sources"],"draw":[{"at":"ref-3","shape":"ring","key":"tool"},{"at":"claim","on":"end","text":"3"}]}
```
Why: a value that came from somewhere keeps where it came from; the number joins the claim only once its source holds.

### Scan and transcript — transcribe the letter (history)
`Artifact` a manuscript letter, the scan beside its transcription · `Unit` line / lines · `Order` line by line down the page · `Tool` the line being read, boxed on the scan, and its words arriving beside it · `Ahead` — · `Before` — · `Tag` Transcribing 3 of 9 lines
```json
{"verb":"Transcribing","unit":["line","lines"],"draw":[{"at":"scan","svg":"<rect x='6' y='27' width='88' height='8'/>","key":"tool"},{"at":"tx-3","on":"start","shape":"line"}]}
```
Why: the same place is marked twice, on the scan and in the text, so either can be followed.

---

## Rules: one instruction on many parts

A rule has no order and no walking tool. Its tool is the control a specialist would set it with, drawn once on whatever stands for the rule, and every part turns at once.

### Round the corners
`Artifact` a page of cards · `Unit` card / cards · `Shape` rule · `Tool` the corner grip on the first card, with the radius it is going to · `Ahead` the reach, tinted · `Before` — · `Tag` Rounding 4 cards
```json
{"verb":"Rounding","unit":["card","cards"],"draw":[{"at":"card-1","shape":"dot","x":100,"y":0,"text":"12 px"}]}
```
Send `reach` with every card, then one batch of ops. The page turns the four in loose batches, like scales: never one after another.

### Recolour a chart in blues
`Artifact` a line chart with four series · `Unit` series · `Shape` rule (one palette for all four) · `Tool` the legend, where a chart's colours are set: each swatch ringed with its new colour named · `Ahead` — · `Before` the old colour's name, struck, beside each · `Tag` Recolouring 4 series
```json
{"verb":"Recolouring","unit":["series","series"],"draw":[{"at":"legend","shape":"ring"},{"at":"legend-1","on":"end","as":"before","text":"orange"},{"at":"legend-2","on":"end","as":"before","text":"green"}]}
```
Why: the legend is the control; the lines follow it. Walking the series one by one would make a palette look like four separate edits.

### A price column into another currency (any rule over hundreds of rows)
`Shape` rule, 300 rows · `Tool` the column's header, where the rule is set: `USD → EUR × 0.92` · `Tag` Converting 120 of 300 prices
```json
{"verb":"Converting","unit":["price","prices"],"draw":[{"at":"th-price","on":"above","text":"USD → EUR × 0.92"},{"at":"p001-price","on":"end","as":"before","text":"$4.20"}]}
```
Thirteen calls of 24, each dealt across the table (rows 1, 14, 27 … then 2, 15, 28 …), so the column changes all over at once instead of filling from the top.

---

## Judgment: many parts, each its own

### An icon for every row
`Artifact` a settings list · `Unit` row / rows · `Shape` judgment (each icon is its own choice; none depends on another) · `Tool` none that moves: the work happens in every group at once · `Ahead` the empty icon slots, tinted by `reach` · `Before` — · `Tag` Choosing 12 of 30 icons
```json
{"path":"Settings/App","note":"Give every setting an icon from the page's own set.",
 "plan":"Give the row one icon from the page's own icon set that says what the setting does; insert it as the row's first child, sized like the others.",
 "shards":[{"ids":["r1","r2","r3","r4","r5","r6","r7","r8","r9","r10"]},{"ids":["r11","r12","r13","r14","r15","r16","r17","r18","r19","r20"]},{"ids":["r21","r22","r23","r24","r25","r26","r27","r28","r29","r30"]}],
 "marks":{"verb":"Choosing","unit":["icon","icons"]}}
```
Why: when the work is everywhere at once, a single moving tool would lie about where it is. The groups land as their workers finish, and the page marks each as it lands.

---

## Two things no still covers, derived

### Caption track — shift every caption 1.2 s later
1. *Artifact.* A subtitler would call it a caption track: cues, each an in-time, an out-time and a line of text, for a video.
2. *Shape.* One shift for every cue is a rule: no order, all at once.
3. *Who works on it, and what do they set?* A subtitler shifts a whole track with its offset, not cue by cue.
4. *Card.* `Unit` cue / cues · `Shape` rule · `Tool` the control a subtitler sets it with, the track's offset: `+1.2 s` on the track's header · `Ahead` the reach · `Before` the first cue's old time, struck, so the size of the shift is seen · `Tag` Shifting 48 cues
```json
{"verb":"Shifting","unit":["cue","cues"],"draw":[{"at":"track-head","on":"end","text":"+1.2 s"},{"at":"cue-1-in","on":"end","as":"before","text":"00:01:04.200"}]}
```

### Scavenger hunt — write the clue chain
1. *Artifact.* Whoever sets a scavenger hunt calls it a clue chain: a map of the stops, and a card for each stop whose clue leads to the next.
2. *Shape.* A walk: each clue is written knowing where the last one left the players, so the order is the route's.
3. *Who, and what do they hold?* The setter walks the route with a pen: a pin on the stop they are standing at, and the way to the next one in mind.
4. *Card.* `Unit` clue / clues · `Order` along the route · `Tool` a dot on the map at the current stop, and a ring on its clue card (the same place marked twice) · `Ahead` the stops not yet written, hollow · `Before` — · `Tag` Writing 4 of 9 clues
```json
{"verb":"Writing","unit":["clue","clues"],"draw":[{"at":"map","shape":"dot","x":44,"y":61,"key":"tool"},{"at":"card-4","shape":"ring","key":"card"},{"at":"map","as":"ahead","shape":"dot","x":58,"y":40},{"at":"map","as":"ahead","shape":"dot","x":71,"y":33}]}
```

---

## What not to do: progress written into the page

An agent with no `marks` to hand will build the progress into the document. Here, adding a date to each event on a timeline:

```text
insert <style data-marble-id="chg-style"> .chg-now { animation: pulse 1.6s infinite } …
setAttr ev1 class="event chg-now"
insert <p class="chg-line">Dating 1 of 9 events…</p>
… nine batches …
remove chg-style, remove chg-line, setAttr every event back   ← the cleanup call
```

Every one of those is a write to the file: it lands in history and undo, other people's tabs see it, the review on rest shows it as part of the change, and a turn that stops halfway leaves it behind. The same change, drawn:

```json
{"ops":[],"reach":["ev1","ev2","ev3","ev4","ev5","ev6","ev7","ev8","ev9"],"total":9,
 "marks":{"verb":"Dating","unit":["event","events"],"draw":[{"at":"ev1","on":"start","shape":"line","key":"tool"}]}}
```
then one batch per few events, each moving the tool on with the same key, and nothing to clear up.
