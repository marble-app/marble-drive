#!/usr/bin/env python3
"""Assemble "The Instruction Gap" as a Marble document.

Frame (stylesheet, affordances, rich-text behaviour) is inherited from the
Interface Reasoning atlas. Content lives in content.py.
"""
import html, re, sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import content as C  # noqa: E402

AFF = (HERE / 'affordances.js').read_text()
BEH = (HERE / 'behaviour.js').read_text()

ids_seen = set()


def mid(s):
    s = re.sub(r'[^a-z0-9-]', '-', s.lower())
    if s in ids_seen:
        raise SystemExit(f'duplicate id {s}')
    ids_seen.add(s)
    return f'data-marble-id="{s}"'


def esc(s):
    return html.escape(s, quote=False)


# ------------------------------------------------------------------ styles
KIND_INK = {'conv': '#8a7f6d', 'ind': '#2a5db0', 'hci': '#1a6b5f', 'other': '#7a4fa8', 'thesis': '#b4552f'}


def css():
    base = (HERE / 'atlas.css').read_text()
    base = base.replace('--hci:#1a6b5f; --ai:#2a5db0; --flag:#b4552f;',
                        '--hci:#1a6b5f; --ai:#2a5db0; --flag:#b4552f; '
                        '--conv:#8a7f6d; --ind:#2a5db0; --acad:#1a6b5f; --other:#7a4fa8; --thesis:#b4552f; '
                        '--yes:#1a6b5f; --part:#b8912f;')
    # The atlas's two figure widgets are replaced wholesale, so their rules go.
    base = re.sub(r'/\* figure 1 — the loop, stepped \*/.*?/\* figure 2 — coverage matrix \*/', '', base, flags=re.S)
    base = re.sub(r'\.matrix \{.*?\.pane-refs a:hover \{ color:var\(--ai\); \}', '', base, flags=re.S)
    base = re.sub(r'@media \(max-width:720px\) \{.*?\}\s*$', '', base, flags=re.S)
    base += """
    /* ------------------------------------------------------- figure 1: map */
    .map { position:relative; width:100%; aspect-ratio:1.28/1; border:1px solid var(--hair);
           background:
             linear-gradient(to right, transparent 0 49.7%, var(--hair) 49.7% 50.3%, transparent 50.3%),
             linear-gradient(to bottom, transparent 0 49.7%, var(--hair) 49.7% 50.3%, transparent 50.3%),
             #fff; }
    .map .quad { position:absolute; inset:0 0 50% 50%; background:#fbf6ef; }
    .pt { position:absolute; transform:translate(-50%,50%); width:11px; height:11px; padding:0;
          border:1.5px solid var(--ink); border-radius:50%; background:#fff; cursor:pointer; }
    .pt[data-kind="conv"]   { border-color:var(--conv); }
    .pt[data-kind="ind"]    { border-color:var(--ind); }
    .pt[data-kind="hci"]    { border-color:var(--acad); }
    .pt[data-kind="other"]  { border-color:var(--other); border-radius:2px; transform:translate(-50%,50%) rotate(45deg); }
    .pt[data-kind="thesis"] { border-color:var(--thesis); background:var(--thesis); width:13px; height:13px; }
    .pt[data-near="yes"]::after { content:""; position:absolute; inset:-5px; border:1px dotted currentColor; border-radius:50%; }
    .pt[data-kind="conv"]::after  { color:var(--conv); }
    .pt[data-kind="ind"]::after   { color:var(--ind); }
    .pt[data-kind="other"]::after { color:var(--other); border-radius:2px; }
    .pt:hover, .pt:focus-visible { outline:2px solid var(--ink); outline-offset:3px; }
    .pt[aria-pressed="true"] { background:var(--ink); border-color:var(--ink); }
    .pt[aria-pressed="true"][data-kind="thesis"] { background:var(--thesis); }
    .ptl { position:absolute; font:400 10.5px/1.25 var(--sans);
           color:var(--muted); white-space:nowrap; pointer-events:none; }
    .ptl[data-a="up"]    { transform:translate(-50%, 50%); }
    .ptl[data-a="down"]  { transform:translate(-50%, 50%); }
    .ptl[data-a="left"]  { transform:translate(-100%, 50%); }
    .ptl[data-a="right"] { transform:translate(0, 50%); }
    .axl { font:600 9.5px/1.3 var(--sans); letter-spacing:.11em; text-transform:uppercase; color:var(--faint); }
    .axrow { display:flex; justify-content:space-between; margin-top:.5rem; }
    .axside { position:absolute; left:-.4rem; top:50%; transform-origin:0 0; transform:rotate(-90deg) translate(-50%,-100%); }
    .mapwrap { position:relative; padding-left:1.6rem; }
    .legend { display:flex; flex-wrap:wrap; gap:.4rem 1.1rem; margin-top:.9rem; }
    .legend span { display:inline-flex; align-items:center; gap:.35rem; font:400 11.5px/1.3 var(--sans); color:var(--muted); }
    .legend i { width:9px; height:9px; border:1.5px solid; border-radius:50%; display:inline-block; }
    .legend i.other { border-radius:2px; transform:rotate(45deg); }
    .legend i.thesis { background:var(--thesis); border-color:var(--thesis); }
    .mapnote { margin-top:.9rem; min-height:4.2em; }
    .mapnote .pane { display:none; }
    .mapnote .pane b { color:var(--ink); }
    .mapnote .pane .un { color:var(--flag); font-weight:600; }

    /* ---------------------------------------------------- figure 2: matrix */
    .cap { display:grid; gap:1px; background:var(--hair); font:400 12px/1.3 var(--sans); }
    .cap .ch { background:var(--paper); padding:.4rem .3rem; font:600 9.5px/1.2 var(--sans); letter-spacing:.05em;
               text-transform:uppercase; color:var(--muted); text-align:center; white-space:pre-line;
               align-self:end; overflow-wrap:anywhere; hyphens:none; }
    .cap .cr { background:var(--paper); padding:.55rem .6rem .55rem 0; color:var(--ink); font:400 12.5px/1.35 var(--sans); }
    .cap .cr i { color:var(--faint); font-style:normal; font-weight:600; margin-right:.4rem; }
    .cc { border:0; background:#fff; cursor:pointer; padding:.6rem 0; font:600 12px/1 var(--sans); color:transparent; }
    .cc[data-v="yes"]  { background:#dfeae6; color:var(--yes); }
    .cc[data-v="part"] { background:#f6efda; color:var(--part); }
    .cc[data-v=""]     { background:#faf9f7; }
    .cc:hover, .cc:focus-visible { outline:2px solid var(--ink); outline-offset:-2px; }
    .cc[aria-pressed="true"] { outline:2px solid var(--ink); outline-offset:-2px; }

    /* A seven-column matrix does not fit a 35rem measure. This one figure
       borrows the right-hand gutter, and gives it back when the sheet
       collapses to a single column. */
    figure.wide { margin-right:-15.75rem; }
    @media (max-width:1100px) { figure.wide { margin-right:0; } }

    /* ------------------------------------------------------- claim strengths */
    .strengths { list-style:none; padding:0; margin-top:1.3rem; border-top:1px solid var(--ink); }
    .strengths > li { padding:1rem 0; border-bottom:1px solid var(--hair); }
    .strengths .sh { display:flex; align-items:baseline; gap:.7rem; }
    .strengths .sl { font:600 10.5px/1 var(--sans); letter-spacing:.13em; text-transform:uppercase; color:var(--faint); }
    .strengths .sv { font:600 10.5px/1 var(--sans); letter-spacing:.05em; color:var(--flag); margin-left:auto; }
    .strengths li[data-ours] .sv { color:var(--acad); }
    .strengths .st { margin-top:.5rem; font:400 16px/1.5 var(--serif); color:var(--muted); }
    .strengths li[data-ours] .st { color:var(--ink); }
    .strengths .sn { margin-top:.5rem; font:400 13.5px/1.5 var(--sans); color:var(--body); }

    /* --------------------------------------------------------- differences */
    .diffs { list-style:none; padding:0; margin-top:1.3rem; }
    .diff { border-top:1px solid var(--ink); padding:1.1rem 0 1.3rem; }
    .diff + .diff { border-top:1px solid var(--hair); }
    .diff h3 { display:flex; align-items:baseline; gap:.7rem; font:600 15px/1.3 var(--sans); color:var(--ink); }
    .diff h3 i { font:600 11px/1 var(--sans); font-style:normal; color:var(--faint); letter-spacing:.06em; }
    .diff h3 .tag { margin-left:auto; font:600 9.5px/1 var(--sans); letter-spacing:.1em; text-transform:uppercase; }
    .diff[data-state="empty"] h3 .tag { color:var(--flag); }
    .diff[data-state="open"] h3 .tag { color:var(--part); }
    .diff[data-state="partial"] h3 .tag { color:var(--acad); }
    .spec { display:grid; grid-template-columns:1fr 1fr; gap:1px; margin-top:.85rem; background:var(--hair); }
    .spec > div { background:#fff; padding:.75rem .85rem; }
    .spec .lab { font:600 9.5px/1 var(--sans); letter-spacing:.11em; text-transform:uppercase; color:var(--faint); }
    .spec p { margin-top:.45rem; font:400 13.5px/1.5 var(--sans); color:var(--body); }
    .spec .need { background:#fbf8f3; }
    .spec .need p { color:var(--ink); }
    .whohas { margin-top:.7rem; font:400 13px/1.5 var(--sans); color:var(--muted); }
    .whohas b { color:var(--ink); font-weight:600; }

    /* ---------------------------------------------------------- appraisal */
    .appr { list-style:none; padding:0; margin-top:1.1rem; }
    .appr > li { padding:.85rem 0 .9rem 1rem; border-left:2px solid var(--hair); }
    .appr.good > li { border-left-color:var(--acad); }
    .appr.bad > li { border-left-color:var(--flag); }
    .appr h4 { font:600 14px/1.35 var(--sans); color:var(--ink); }
    .appr p { margin-top:.35rem; font:400 14px/1.55 var(--sans); color:var(--body); }
    .verdict { margin-top:1.6rem; padding:1.1rem 1.2rem; background:#fbf6ef; border:1px solid var(--rule);
               font:400 15.5px/1.55 var(--serif); color:var(--ink); }

    %%SHOW%%
    @media (max-width:820px) {
      .spec { grid-template-columns:1fr; }
      .ptl { display:none; }
    }
    @media (max-width:720px) {
      body { font-size:16.5px; }
      .sheet { padding:0 1.1rem 5rem; }
      .entry { grid-template-columns:44px minmax(0,1fr); gap:.8rem; }
      .thumb { width:44px; height:59px; }
      .cap { font-size:11px; }
    }
    """
    show = []
    for p in C.MAP_POINTS:
        show.append(f'body[data-point="{p["key"]}"] .mapnote .pane[data-for-cell="{p["key"]}"]')
    show.append('')
    cap = []
    for d in C.DIFFERENCES:
        for c in C.MATRIX_COLS:
            cell = f'{d["key"]}-{c["key"]}'
            cap.append(f'body[data-cell="{cell}"] .mapnote .pane[data-for-cell="{cell}"]')
    rules = (',\n    '.join(show[:-1]) + ' { display:block; }\n    '
             + ',\n    '.join(cap) + ' { display:block; }')
    base = base.replace('%%SHOW%%', rules)
    return base


# ------------------------------------------------------------------ pieces
def para(key, text, rich=False):
    attr = 'data-marble-rich' if rich else 'data-marble-editable'
    return f'<p {mid(key)} {attr}>{text}</p>'


def aside(key, head, text):
    return (f'<div class="aside" {mid("a-" + key)}>'
            f'<p class="sidenote" {mid("sn-" + key)} data-marble-rich><b>{esc(head)}</b>{text}</p></div>')


def section(key, num, title, inner):
    return (f'<section id="s-{key}" {mid("s-" + key)} class="prose">\n'
            f'      <span class="snum" {mid("sn0-" + key)}>Section {num}</span>\n'
            f'      <h2 {mid("h-" + key)} data-marble-editable>{esc(title)}</h2>\n'
            f'      {inner}\n    </section>')


def strengths():
    out = f'<ul class="strengths" {mid("strengths")}>'
    for s in C.CLAIM_STRENGTHS:
        ours = ' data-ours' if s.get('ours') else ''
        out += (f'<li {mid("cs-" + s["key"])}{ours}>'
                f'<div class="sh" {mid("csh-" + s["key"])}>'
                f'<span class="sl" {mid("csl-" + s["key"])}>{esc(s["label"])}</span>'
                f'<span class="sv" {mid("csv-" + s["key"])}>{esc(s["verdict"])}</span></div>'
                f'<p class="st" {mid("cst-" + s["key"])} data-marble-editable>{esc(s["text"])}</p>'
                f'<p class="sn" {mid("csn-" + s["key"])} data-marble-editable>{esc(s["note"])}</p></li>')
    return out + '</ul>'


def figure_map():
    pts = ''
    labels = ''
    panes = ''
    for p in C.MAP_POINTS:
        near = ' data-near="yes"' if p.get('near') else ''
        pts += (f'<button class="pt" {mid("pt-" + p["key"])} data-marble-value="{p["key"]}" data-kind="{p["kind"]}"{near}'
                f' style="left:{p["x"]}%;bottom:{p["y"]}%" aria-label="{esc(p["label"])}"></button>')
        # Each point says where its own label sits, because collisions are a
        # property of the arrangement and no rule generates a clean one.
        a = p.get('la', 'up')
        dy = {'up': 13, 'down': -13, 'left': 0, 'right': 0}[a]
        dx = {'up': 0, 'down': 0, 'left': -14, 'right': 14}[a]
        labels += (f'<span class="ptl" {mid("ptl-" + p["key"])} data-a="{a}" '
                   f'style="left:calc({p["x"]}% + {dx}px);bottom:calc({p["y"]}% + {dy}px)">'
                   f'{esc(p["label"])}</span>')
        un = ' <span class="un">search-snippet only</span>' if p.get('unverified') else ''
        panes += (f'<div class="pane" {mid("mp-" + p["key"])} data-for-cell="{p["key"]}">'
                  f'<p {mid("mpp-" + p["key"])} data-marble-rich><b>{esc(p["label"])}.</b> {esc(p["note"])}{un}</p></div>')
    legend = ''.join(
        f'<span {mid("lg-" + l["kind"])}><i class="{l["kind"]}" style="border-color:{KIND_INK[l["kind"]]}'
        f'{";background:" + KIND_INK[l["kind"]] if l["kind"] == "thesis" else ""}"></i>{esc(l["label"])}</span>'
        for l in C.MAP_LEGEND)
    return (f'<figure {mid("fig-1")}><div class="fig-frame" {mid("fig1f")}>'
            f'<div class="mapwrap" {mid("mapwrap")}>'
            f'<span class="axl axside" {mid("axside")}>encodes decisions not yet made →</span>'
            f'<div class="map" {mid("map")} data-marble-choose="data-point" data-marble-of="body" aria-label="Proximity map">'
            f'<span class="quad" {mid("quad")}></span>{pts}{labels}</div>'
            f'<div class="axrow" {mid("axrow")}>'
            f'<span class="axl" {mid("ax-l")}>addressed to a person</span>'
            f'<span class="axl" {mid("ax-r")}>addressed to a model deciding alone</span></div></div>'
            f'<div class="legend" {mid("legend")}>{legend}</div>'
            f'<div class="mapnote" {mid("mapnote")}>{panes}</div>'
            f'</div><figcaption {mid("fig1c")} data-marble-rich>{C.FIG1_CAPTION}</figcaption></figure>')


def differences():
    out = f'<ul class="diffs" {mid("diffs")} data-marble-sortable="diffs">'
    tags = {'empty': 'nobody', 'open': 'nearly nobody', 'partial': 'partly solved'}
    for d in C.DIFFERENCES:
        k = d['key']
        out += (f'<li class="diff" id="d-{k}" {mid("df-" + k)} data-state="{d["state"]}" data-marble-removable>'
                f'<h3 {mid("dfh-" + k)}><i {mid("dfn-" + k)}>{d["n"]}</i>'
                f'<span {mid("dft-" + k)} data-marble-editable>{esc(d["title"])}</span>'
                f'<span class="tag" {mid("dfg-" + k)}>{tags[d["state"]]}</span></h3>'
                f'<div class="spec" {mid("dfs-" + k)}>'
                f'<div {mid("dfa-" + k)}><span class="lab" {mid("dfal-" + k)}>What guidance says today</span>'
                f'<p {mid("dfap-" + k)} data-marble-editable>{esc(d["now"])}</p></div>'
                f'<div class="need" {mid("dfb-" + k)}><span class="lab" {mid("dfbl-" + k)}>What a generator needs told</span>'
                f'<p {mid("dfbp-" + k)} data-marble-editable>{esc(d["need"])}</p></div></div>'
                f'<p class="whohas" {mid("dfw-" + k)} data-marble-rich><b>Who has it.</b> {esc(d["who"])}</p></li>')
    return out + '</ul>'


def figure_cap():
    cols = C.MATRIX_COLS
    n = len(cols)
    head = f'<span class="ch" {mid("ch-0")}></span>' + ''.join(
        f'<span class="ch" {mid("ch-" + c["key"])}>{esc(c["label"])}</span>' for c in cols)
    body = ''
    panes = ''
    glyph = {'yes': '●', 'part': '◐', '': '·'}
    for d in C.DIFFERENCES:
        k = d['key']
        body += (f'<span class="cr" {mid("cr-" + k)}><i {mid("cri-" + k)}>{d["n"]}</i>{esc(d["title"])}</span>')
        row = C.MATRIX[k]
        for c in cols:
            v = row[c['key']]
            cell = f'{k}-{c["key"]}'
            body += (f'<button class="cc" {mid("cc-" + cell)} data-marble-value="{cell}" data-v="{v}"'
                     f' aria-label="{esc(d["title"])}, {esc(c["label"].replace(chr(10), " "))}">{glyph[v]}</button>')
            says = {'yes': 'Can express this.', 'part': 'Partly, or structurally rather than stated.',
                    '': 'No way to say this.'}[v]
            panes += (f'<div class="pane" {mid("cp-" + cell)} data-for-cell="{cell}">'
                      f'<p {mid("cpp-" + cell)} data-marble-rich><b>{esc(c["label"].replace(chr(10), " "))} · '
                      f'{esc(d["title"])}.</b> {esc(says)} <a href="#d-{k}">Read the difference</a></p></div>')
    grid = f'grid-template-columns:minmax(0,1fr) repeat({n}, 4.1rem);'
    return (f'<figure class="wide" {mid("fig-2")}><div class="fig-frame" {mid("fig2f")}>'
            f'<div class="cap" {mid("cap")} style="{grid}" data-marble-choose="data-cell" data-marble-of="body"'
            f' aria-label="Capability matrix">{head}{body}</div>'
            f'<div class="mapnote" {mid("capnote")}>{panes}</div>'
            f'</div><figcaption {mid("fig2c")} data-marble-rich>{C.FIG2_CAPTION}</figcaption></figure>')


def appraisal(items, cls, prefix):
    out = f'<ul class="appr {cls}" {mid(prefix)}>'
    for i, it in enumerate(items, 1):
        out += (f'<li {mid(prefix + "-" + str(i))}>'
                f'<h4 {mid(prefix + "h-" + str(i))} data-marble-editable>{esc(it["head"])}</h4>'
                f'<p {mid(prefix + "p-" + str(i))} data-marble-editable>{esc(it["body"])}</p></li>')
    return out + '</ul>'


def verdict():
    return f'<p class="verdict" {mid("verdict")} data-marble-editable>{esc(C.VERDICT)}</p>'


def questions():
    items = ''.join(f'<li {mid("q-" + str(i))} data-marble-editable data-marble-removable>{esc(q)}</li>'
                    for i, q in enumerate(C.QUESTIONS, 1))
    return (f'<ul class="qs" id="qs-list" {mid("qs-list")} data-marble-sortable="questions">{items}</ul>'
            f'<button class="addq" {mid("add-q")} data-marble-add="#tpl-q" data-marble-into="#qs-list"'
            f' data-marble-instruction="Add an open question.">+ question</button>')


# ------------------------------------------------------------------ blocks
def render_blocks(skey, blocks):
    out, pn = [], 0
    for b in blocks:
        kind = b[0]
        if kind == 'p':
            pn += 1
            out.append(para(f'{skey}-p{pn}', b[1], rich=(len(b) > 2 and b[2])))
        elif kind == 'aside':
            out.append(aside(f'{skey}-{b[1]}', b[2], b[3]))
        elif kind == 'strengths':
            out.append(strengths())
        elif kind == 'map':
            out.append(figure_map())
        elif kind == 'differences':
            out.append(differences())
        elif kind == 'cap':
            out.append(figure_cap())
        elif kind == 'good':
            out.append(appraisal(C.APPRAISAL_GOOD, 'good', 'good'))
        elif kind == 'bad':
            out.append(appraisal(C.APPRAISAL_BAD, 'bad', 'bad'))
        elif kind == 'verdict':
            out.append(verdict())
        elif kind == 'questions':
            out.append(questions())
        else:
            raise SystemExit(f'unknown block {kind}')
    return '\n      '.join(out)


SECTIONS = [
 dict(key='claim', rail='Three claims', title='Three claims, only one of them yours to make', blocks=[
  ('p', 'The sentence “GenUI design is about designing the instructions the generator reads” can be read at three strengths. They are not variations. They have different competitors, different evidence requirements, and two of them are already taken.'),
  ('strengths',),
  ('aside', 'read', 'How readers pick', 'A reader resolves an ambiguous claim to the weakest reading that makes the sentences true. If the strong version is not stated and defended in the abstract, it will not be the version anyone argues with.'),
 ]),
 dict(key='map', rail='Where prior work sits', title='Where prior work actually sits', blocks=[
  ('p', 'Two questions separate everything in this area. Who is the guidance addressed to, a person with judgment and colleagues, or a model that must decide alone? And what does it encode, decisions somebody already made, or a procedure for decisions nobody has made yet?'),
  ('map',),
  ('p', 'The horizontal axis is crowded and the vertical one is not. The field has spent three years moving guidance rightward, from documents for people to documents for machines, and has barely moved it upward at all. Astryx is the clearest case. It is the largest agent-first design system in existence, eight years of internal work behind it, and its content is identical to what a human reads. Only the delivery changed.', True),
  ('p', 'The upper right holds three things and none of them is about interfaces. That is the whole argument, and it is also the whole risk, because a sceptic will say the region is empty for a reason.', True),
 ]),
 dict(key='diffs', rail='Eight differences', title='Eight differences, with specimens', blocks=[
  ('p', 'This is the part you have not written. Each of these is a kind of statement that conventional design guidance does not contain, paired with what a generator would need instead. The left column is real where I could quote it and an honest “silence” where the case simply never arose.'),
  ('differences',),
  ('p', 'Five of the eight are silence rather than disagreement, and the reason is structural rather than an oversight. A human designer never regenerates the screen, never faces a case with no colleague to ask, and never produces two instances that might diverge. The questions could not come up, so the vocabulary to answer them was never built. That is the strongest available form of your argument, and it is not the form you have been using.', True),
 ]),
 dict(key='cap', rail='What formats can say', title='What the current formats can and cannot say', blocks=[
  ('p', 'The same eight, against the artefacts that might plausibly carry them. Every judgment here comes from the format’s own documentation, checked on 20 September 2026.'),
  ('cap',),
  ('p', 'The rightmost column is the uncomfortable one. A specification written for assistant behaviour expresses five of the eight outright and two more in part, and it was not built for interfaces at all. Of the artefacts that were, Astryx expresses none, A2UI and a conventional design system one apiece in part, DESIGN.md two, and Maru three. Google’s system instruction touches four, always partially, and nobody outside Google can read it. That asymmetry is either the best evidence for your paper or the best evidence that interface design does not need these statements, and the paper has to take a position on which.', True),
 ]),
 dict(key='honest', rail='Honest appraisal', title='An honest appraisal of where the argument stands', blocks=[
  ('p', 'What follows is written to be useful rather than encouraging. The good side first, because it is real, and then the part that would sink the paper in its current form.'),
  ('good',),
  ('p', '<b>And the problems.</b>', True),
  ('bad',),
  ('verdict',),
 ]),
 dict(key='qs', rail='Open questions', title='Open questions', blocks=[
  ('p', 'The things this analysis did not settle, including the two objections I could not answer on your behalf.'),
  ('questions',),
 ]),
]


def build():
    rail = ''.join(f'<li {mid("rl-" + str(i))}><a href="#s-{s["key"]}" {mid("rla-" + str(i))}>{i}. {esc(s["rail"])}</a></li>'
                   for i, s in enumerate(SECTIONS, 1))
    secs = [section(s['key'], i, s['title'], render_blocks(s['key'], s['blocks']))
            for i, s in enumerate(SECTIONS, 1)]
    first_pt = C.MAP_POINTS[-1]['key']
    first_cell = f'{C.DIFFERENCES[3]["key"]}-spec'
    return f'''<!doctype html>
<html lang="en" data-marble="1">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="marble:capabilities" content="storage; net=none">
  <title>{esc(C.TITLE_SHORT)}</title>
  <style data-marble-id="style-main">{css()}</style>
</head>
<body data-marble-id="report" data-point="{first_pt}" data-cell="{first_cell}">
  <div class="sheet" {mid("sheet")}>

    <div class="masthead" {mid("masthead")}>
      <span class="kicker" {mid("kicker")} data-marble-editable>{esc(C.KICKER)}</span>
      <span class="date" {mid("date")} data-marble-editable>{esc(C.DATE)}</span>
    </div>

    <div class="opening" {mid("opening")}>
      <h1 {mid("title")} data-marble-editable>{esc(C.TITLE)}</h1>
      <p class="byline" {mid("byline")} data-marble-editable>{esc(C.BYLINE)}</p>
      <p class="question" {mid("question")} data-marble-editable>{esc(C.QUESTION)}</p>
      {aside("note-use", "This note is the file", C.USE_NOTE)}
      <div class="answer" {mid("answer")}>
        {''.join(para("ans-" + str(i), p, rich=True) for i, p in enumerate(C.ANSWER, 1))}
      </div>
    </div>

    <nav class="rail" {mid("rail")} aria-label="Contents">
      <p {mid("rail-h")}>Contents</p>
      <ol {mid("rail-list")}>{rail}</ol>
    </nav>

    {chr(10).join(secs)}

    <footer {mid("footer")}>
      <span {mid("foot-l")} data-marble-editable>{esc(C.FOOT)}</span>
      <span {mid("foot-r")}>Marble document</span>
    </footer>
  </div>

  <template id="tpl-q">
    <li data-marble-editable data-marble-removable>A new question.</li>
  </template>

  <script data-marble-id="script-behaviour">{BEH}</script>

  <script data-marble-id="script-affordances">{AFF}</script>
</body>
</html>
'''


if __name__ == '__main__':
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'out.mrbl'
    page = build()
    out.write_text(page)
    print(out, len(page), 'bytes', len(ids_seen), 'ids')
