# Representation log

The "road ahead" section renders the user's long-horizon agenda a **new way every
day** — freshly improvised, not from a fixed set. This is the ledger of what has
already been used, so the next one doesn't repeat. Append one line per day:

    YYYY-MM-DD  Name — one line on the form and what it emphasised

The improvised markup+CSS for each day lives in that day's archived issue
(`drive/Newsletter/archive/YYYY-MM-DD.mrbl`), not here.

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
