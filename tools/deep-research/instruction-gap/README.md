# The Instruction Gap

Builds `drive/Research/Deep Research/The Instruction Gap.mrbl`. Content in
`content.py`, frame in `build.py`. Shares `affordances.js`, `behaviour.js` and
`atlas.css` with the parent folder.

    cp ../{affordances.js,behaviour.js,atlas.css} .
    python3 build.py /tmp/out.mrbl

Two figures are specific to this note and not in the parent generator:

- **The proximity map** is a percentage-positioned scatter inside `.map`.
  Each point carries its own `la` (label anchor: up/down/left/right) because
  collisions are a property of the arrangement and no rule generates a clean
  one. Adding a point means picking its anchor by eye.
- **The capability matrix** borrows the right-hand gutter via
  `figure.wide { margin-right:-15.75rem }`, because seven columns do not fit a
  35rem measure. It gives the gutter back under 1100px.

Counts quoted in the prose are derived from `MATRIX` in `content.py`. Re-derive
them after any edit rather than trusting the sentence; the caption drifted from
the data once already.
