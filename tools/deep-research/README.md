# Deep Research report generator

Builds `drive/Research/Deep Research/Designing GenUI.mrbl` from the content in
`data.py` and the five `sources_*.py` files. The frame (stylesheet, figures,
ids, affordances) is inherited from the Interface Reasoning atlas in
`drive/Research/Corpus/`; `affordances.js`, `behaviour.js` and `atlas.css` are
copied out of it verbatim.

    python3 tools/deep-research/build.py /tmp/out.mrbl
    node -e "import('./server/engine.js').then(m=>console.log(m.examine('x.mrbl', require('fs').readFileSync('/tmp/out.mrbl','utf8'))))"
    cp /tmp/out.mrbl "drive/Research/Deep Research/Designing GenUI.mrbl"   # only while nobody has it open

Every element id is derived from a source key, so re-running the build keeps
ids stable as long as keys do not change. A new report of the same kind should
copy this folder, replace `data.py` and the sources, and keep the frame.
