---
name: growing-the-open-page
description: Use when editing a Marble document someone is looking at — adding a card, section, row, or any UI the open tab will see appear; when a build takes more than one apply_ops call and the person should be able to see how far along it is; or when you are about to Write a finished subtree into a .mrbl that has a viewer.
---

# Growing the open page

This ritual is Marble's, not Drive's. Call `read_guide` with section "Growing the open page" (it is `skills/build-in-marble` in the marble package). Do not keep a second copy of the steps here.

The short of it: decide the finished interface, then reveal it in three to six named stages, each a whole, plainer version of the next, every element keeping the id it was born with. The stage's name goes in the `apply_ops` note, never in the page.

Two tools this drive adds on top of that ritual:

`apply_ops` takes `reach` and `total`. Send a step's ids ahead in `reach`, with its first batch, so the page can show the whole reach before any of it changes. Give `total` when you know how many parts the whole change will touch — fifteen stills, not just this call's four — and the page counts toward it as later batches land.

`fan_out` is for six or more parts that each need their own judgment — a label per row, an icon per item, a rewrite per paragraph — not for a build's stages. Write one plan every worker follows, split the parts into shards, and each shard's worker returns edits that are checked before they land. A shard that fails leaves its parts as they were and says why; the rest still lands. For a few parts, or one change every part shares, apply_ops alone is simpler.
