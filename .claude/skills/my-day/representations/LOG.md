# Representation log

The "road ahead" section renders the user's long-horizon agenda a **new way every
day** — freshly improvised, not from a fixed set. This is the ledger of what has
already been used, so the next one doesn't repeat. Append one line per day:

    YYYY-MM-DD  Name — one line on the form and what it emphasised

The improvised markup+CSS for each day lives in that day's archived issue
(`drive/Bryan's Days/archive/YYYY-MM-DD.mrbl`), not here.

## Constraints on a representation (see SKILL.md step 6)

- Self-contained: a `<style>` block scoped under `.repr` + plain markup. No script,
  no inline `on*=` handlers, no external assets, no `@import`. `net=none` safe.
- Reads from `drive/Research/research-vision.mrbl` sections 04–06 (principles,
  open questions, agenda Now/Next/Later, targets) and project states.
- Genuinely a different *way of seeing*, not a restyle: timeline, constellation,
  iceberg, metro map, weather forecast, concentric rings, tarot pull, contour
  map, tide chart, org chart, subway departure board, garden, ledger, dialogue,
  spectrum sliders, heatmap calendar, nested scopes, receding road, actor
  network... and things not on this list.
- Every element gets a `data-marble-id`; make pieces editable / sortable where it
  makes sense so the user can nudge it.

## Used

(none yet — first run starts the list)
2026-09-07  Departure board — split-flap board; agenda as work "departing" through gates (CHI 10 Sep, Ai2, UIST), status = now/next/later.
2026-09-07  Pinned to the board — agenda as pinned bulletin-board notes, Now/Next/Later columns, pushpin color = urgency (rebuild of the day).
2026-09-07  The trellis — agenda as a garden trellis: 3 rails (Now/Next/Later), projects as pill-nodes coloured by thesis, forward-growth metaphor.
2026-09-08  Soundings — a nautical depth chart; distance from shore = Now/Next/Later, depth in fathoms = how far a piece is from being answerable, colour = thesis. Inline SVG cross-section (waterline, water body deepening left→right, seabed polyline, drop lines at the zone boundaries) over three washed columns of sounding rows.
2026-09-09  Contact sheet — the agenda as a photographic proof sheet: two film strips (perforation rails top and bottom), each project one frame carrying its thesis chip and open question, with a grease-pencil mark drawn over the frame — ringed = printing now, crop brackets = next, struck = held. The point the ring-and-column forms miss: a contact sheet is the sheet you mark up to decide what gets enlarged, so the agenda reads as an editorial decision rather than a status.
2026-09-10  Star chart — the four theses as four constellations of stars over a horizon line; star size = momentum (seed → submitted), colour = thesis; the Elicitive UIs star sits ringed on the horizon as the one going in tonight, with the next tick at UIST 2027. The point the ledger/column forms miss: it puts the submissions on a time axis, so "one thesis just shipped, which carries the next deadline" reads directly off the picture.
2026-09-11  The gear train — the agenda as one clock movement: three meshing wheels (the four theses · the CHI 2027 cycle · this week) drawn in inline SVG with toothed rims, each labelled with its ratio, over a strip of the dated teeth the cycle wheel has left to release (5 Nov → 18 Feb). The point the column and list forms keep missing: Now/Next/Later are not three piles, they are one coupled mechanism — so "Later never moves" is gearing, not neglect, and the program wheel only advances when the cycle wheel completes a turn.
2026-09-14  The play — the agenda as one snap of an American-football play: an inline-SVG field where the four theses are pass routes run from the line of scrimmage, route depth = how far a claim has to travel before it could be defended, and the break in a route = a question that breaks twice. Now/Next/Later become first read / second read / checkdown. The point the column and gear forms miss: Later is not neglect, it is the third read — you only get there if the first two are covered. Chosen because the day is NFL Week 1.
2026-09-14  The shipwright's register — the agenda as the Ship of Theseus: an inline-SVG hull in side elevation, seven projects as planks laid from the garboard up to the sheer (solid = fastened, bright = being fitted now, dashed = cut and waiting on the slip), the keel drawn in the four thesis colours, beside a sortable plank register. The point the route and gear forms miss: the agenda's identity question — swap any plank and it is still the same programme so long as the keel holds. Chosen because Bryan asked for Bernstein's "The Interface of Theseus".
2026-09-15  The mixing desk — the agenda as one console: eight channel strips, each project a fader whose level is gain in dB relative to unity (+6 down to −16), a coloured bus bar naming which thesis it feeds, and a state chip (SOLO / NOW / NEXT / IN REVIEW / LATER); above them a master headroom meter reading "three channels pushed above unity", below them a bus legend. The point every previous form misses — the board, the trellis, the columns, the hull — is that they all render Later as a *place*, so the agenda reads as piles and the eye concludes Later is not started. A fader says the opposite: a channel at −16 is still running, still costing you something, just turned down, and the only real question each morning is which one is loudest. Solo on World Interface Models because the Solaris paper turned out to be a real artifact rather than a launch post; Elicitive UIs sits at −12 IN REVIEW because it is out of Bryan's hands until reviews come back, which is a different thing from Later and the desk can say so.
2026-09-16  The loom — voice and sketch enter as two weft threads, while the four research theses form the fixed warp that keeps each generated surface recognizably Bryan's; an inline-SVG loom shows the translation, and five sortable passes turn Now / Next / In review / Later into the order the shuttle crosses projects. The point the mixing desk and route forms miss: a new input modality should not replace the research programme's structure — it should be woven through it. Chosen because Bryan's voice note asks for a representation generated from what he says without losing the words that produced it.
2026-09-17  The tide chart — four inline-SVG curves (one per thesis) rising and falling across the next seven weeks to UIST, filled bands reading as ebb/flow instead of piles, plus a sortable nine-row tide table (▲ rising / ▶ high slack / ▼ falling / ● low slack) and three flag markers (Ai2 starts, NYC, UIST). The point every prior form misses: a low-slack item hasn't stalled, it's between pulls and comes back around on its own schedule — which the board, the gears, the hull and the desk all render as neglect instead of rhythm. Chosen because Bryan is newly coastal (Marin, staying a while) and three Now items genuinely crest together this week.
2026-09-18  The unsent mail — correspondence desk, not a board: one letter on the blotter (the Anthropic application, due this morning) and a stack of unsent envelopes (Bernstein, the professors, the grant skeleton, Detroit, the course). The point every Now/Next/Later form misses: these items are not status — they are letters that have not left the house, and the only question this morning is which one gets a stamp.
