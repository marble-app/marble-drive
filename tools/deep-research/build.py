#!/usr/bin/env python3
"""Assemble the Deep Research report on designing GenUI as a Marble document.

Content lives in data.py (prose, figures, sources, questions). This file owns
the frame: stylesheet, layout, ids, and the two scripts copied from the
Interface Reasoning atlas so the note has the same affordances.
"""
import html, re, sys, json
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import data as D  # noqa: E402

AFF = (HERE / 'affordances.js').read_text()
BEH = (HERE / 'behaviour.js').read_text()

ids_seen = set()
def mid(s):
    """A data-marble-id, checked unique."""
    s = re.sub(r'[^a-z0-9-]', '-', s.lower())
    if s in ids_seen:
        raise SystemExit(f'duplicate id {s}')
    ids_seen.add(s)
    return f'data-marble-id="{s}"'

def esc(s):
    return html.escape(s, quote=False)

GROUPS = D.GROUPS  # key -> {label, dek, cls}

# ------------------------------------------------------------------ styles
def css():
    base = (HERE / 'atlas.css').read_text()
    # Palette: four source families instead of two fields.
    base = base.replace('--hci:#1a6b5f; --ai:#2a5db0; --flag:#b4552f;',
                        '--acad:#1a6b5f; --ind:#2a5db0; --disc:#b4552f; --eval:#8a6d1f; --agent:#4b5d6e; --flag:#8a6d1f;')
    base = base.replace('.refgroup.hci h3 { color:var(--hci); }\n    .refgroup.ai h3 { color:var(--ai); }',
                        '.refgroup.acad h3 { color:var(--acad); }\n    .refgroup.ind h3 { color:var(--ind); }\n    .refgroup.disc h3 { color:var(--disc); }\n    .refgroup.eval h3 { color:var(--eval); }\n    .refgroup.agent h3 { color:var(--agent); }')
    base = base.replace('.ftag.hci { color:var(--hci); }\n    .ftag.ai { color:var(--ai); }',
                        '.ftag.acad { color:var(--acad); }\n    .ftag.ind { color:var(--ind); }\n    .ftag.disc { color:var(--disc); }\n    .ftag.eval { color:var(--eval); }\n    .ftag.agent { color:var(--agent); }')
    base = base.replace('.conf.ok { color:var(--hci); }', '.conf.ok { color:var(--acad); }')
    base = base.replace('a { color:var(--ai);', 'a { color:var(--ind);')
    base = base.replace('.pane-refs a:hover { color:var(--ai); }', '.pane-refs a:hover { color:var(--ind); }')
    # Figure 1 has six stages, figure 2 has five rows by three columns.
    n = len(D.STAGES)
    stage_rules = []
    for i in range(1, n + 1):
        stage_rules.append(f'body[data-step="{i}"] .stage[data-marble-value="{i}"]')
    stage_txt = []
    for i in range(1, n + 1):
        stage_txt.append(f'body[data-step="{i}"] .stage[data-marble-value="{i}"] b, body[data-step="{i}"] .stage[data-marble-value="{i}"] span')
    step_txt = []
    for i in range(1, n + 1):
        step_txt.append(f'body[data-step="{i}"] .steptext > span[data-step="{i}"]')
    base = re.sub(r'body\[data-step="1"\] \.stage\[data-marble-value="1"\],\n.*?\{ background:var\(--ink\); border-color:var\(--ink\); \}',
                  ',\n    '.join(stage_rules) + ' { background:var(--ink); border-color:var(--ink); }', base, flags=re.S)
    base = re.sub(r'body\[data-step="1"\] \.stage\[data-marble-value="1"\] b, .*?\{ color:#fff; \}',
                  ',\n    '.join(stage_txt) + ' { color:#fff; }', base, flags=re.S)
    base = re.sub(r'body\[data-step="1"\] \.steptext > span\[data-step="1"\],\n.*?\{ display:inline; \}',
                  ',\n    '.join(step_txt) + ' { display:inline; }', base, flags=re.S)
    base = base.replace('.loop { display:grid; grid-template-columns:repeat(4,1fr); gap:.5rem; }',
                        f'.loop {{ display:grid; grid-template-columns:repeat({n},1fr); gap:.5rem; }}')
    cells = []
    for row in D.MATRIX_ROWS:
        for col in D.MATRIX_COLS:
            cells.append(f'body[data-cell="{row["key"]}-{col["key"]}"] .pane[data-for-cell="{row["key"]}-{col["key"]}"]')
    base = re.sub(r'body\[data-cell="frame-hci"\] \.pane\[data-for-cell="frame-hci"\],\n.*?\{ display:block; \}',
                  ',\n    '.join(cells) + ' { display:block; }', base, flags=re.S)
    cols = len(D.MATRIX_COLS)
    base = base.replace('.matrix { display:grid; grid-template-columns:minmax(0,1fr) 5.5rem 5.5rem;',
                        f'.matrix {{ display:grid; grid-template-columns:minmax(0,1fr) {" ".join(["5.5rem"] * cols)};')
    base = base.replace('.matrix { grid-template-columns:minmax(0,1fr) 4rem 4rem; }',
                        f'.matrix {{ grid-template-columns:minmax(0,1fr) {" ".join(["4rem"] * cols)}; }}')
    base = base.replace('.loop { grid-template-columns:1fr 1fr; }', '.loop { grid-template-columns:1fr 1fr 1fr; }')
    # Positions rows carry a "who" line like the harness rows carried a "when".
    base += """
    .stage { display:flex; flex-direction:column; justify-content:flex-start; }
    section > p > .conf { font:600 12px/1 var(--sans); letter-spacing:.06em; text-transform:none; }
    /* --------------------------------------------------------- positions */
    .rows > div.is-ours p { color:var(--ink); }
    .rows .who { display:block; margin-top:.25rem; font:400 11px/1.3 var(--sans); color:var(--faint); }
    /* --------------------------------------------------------- implications */
    .theses { list-style:none; padding:0; margin-top:1.2rem; border-top:1px solid var(--ink); }
    .theses > li { display:grid; grid-template-columns:5rem minmax(0,1fr); gap:1.25rem; padding:.95rem 0; border-bottom:1px solid var(--hair); }
    .theses b.tkey { font:600 12px/1.4 var(--sans); letter-spacing:.06em; color:var(--ink); }
    .theses p { font:400 14.5px/1.5 var(--sans); color:var(--body); }
    .theses p + p { margin-top:.5rem; }
    @media (max-width:720px) { .theses > li { grid-template-columns:1fr; gap:.4rem; } }
    """
    return base

# ------------------------------------------------------------------ thumbs
THUMB_MOTIFS = {
    'list':  '<rect x="7" y="28" width="46" height="1.4" fill="#e6e1d9"/><rect x="7" y="33" width="46" height="1.4" fill="#e6e1d9"/><rect x="7" y="38" width="36" height="1.4" fill="#e6e1d9"/><rect x="7" y="43" width="42" height="1.4" fill="#e6e1d9"/>',
    'figure': '<rect x="7" y="28" width="46" height="18" fill="{tint}"/><path d="M11,42 L22,33 L31,39 L42,30 L49,36" fill="none" stroke="{ink}" stroke-width="1"/>',
    'grid':  '<rect x="7" y="28" width="13" height="9" fill="{tint}"/><rect x="23" y="28" width="13" height="9" fill="{tint}"/><rect x="39" y="28" width="14" height="9" fill="{tint}"/><rect x="7" y="40" width="13" height="9" fill="{tint}"/><rect x="23" y="40" width="13" height="9" fill="{tint}"/><rect x="39" y="40" width="14" height="9" fill="{tint}"/>',
    'screen': '<rect x="7" y="28" width="46" height="22" rx="1.5" fill="none" stroke="{ink}" stroke-width="1"/><rect x="10" y="31" width="18" height="2" fill="{ink}"/><rect x="10" y="36" width="40" height="1.4" fill="{tint2}"/><rect x="10" y="40" width="30" height="1.4" fill="{tint2}"/><rect x="34" y="44" width="16" height="4" rx="1" fill="{tint}"/>',
    'chat':  '<rect x="7" y="28" width="30" height="7" rx="3" fill="{tint}"/><rect x="23" y="38" width="30" height="7" rx="3" fill="#e6e1d9"/><rect x="7" y="48" width="24" height="5" rx="2.5" fill="{tint}"/>',
    'side':  '<rect x="7" y="28" width="22" height="1.4" fill="#e6e1d9"/><rect x="7" y="33" width="22" height="1.4" fill="#e6e1d9"/><rect x="7" y="38" width="18" height="1.4" fill="#e6e1d9"/><rect x="34" y="28" width="19" height="16" fill="{tint}"/>',
}
TINTS = {'acad': ('#1a6b5f', '#d9ebe6', '#bcd6cf'), 'ind': ('#2a5db0', '#dbe6f7', '#c2d2ee'),
         'disc': ('#b4552f', '#f4e1d7', '#ebc9b8'), 'eval': ('#8a6d1f', '#f1e8cf', '#e2d2a3'),
         'agent': ('#4b5d6e', '#e3e8ed', '#c9d2db')}

def thumb(key, group, motif):
    ink, tint, tint2 = TINTS[group]
    body = THUMB_MOTIFS[motif].format(ink=ink, tint=tint, tint2=tint2)
    return (f'<svg class="thumb" {mid("t-" + key)} viewBox="0 0 60 80" aria-hidden="true">'
            f'<rect width="60" height="80" fill="#fff"/><rect x="0" y="0" width="60" height="2.5" fill="{ink}"/>'
            f'<rect x="7" y="9" width="46" height="2.5" rx="1" fill="#b9c2cc"/><rect x="7" y="14" width="30" height="2.5" rx="1" fill="#b9c2cc"/>'
            f'<rect x="7" y="21" width="20" height="1.4" fill="#ddd8d0"/>{body}'
            f'<rect x="7" y="64" width="46" height="1.4" fill="#e6e1d9"/><rect x="7" y="69" width="38" height="1.4" fill="#e6e1d9"/>'
            f'<rect x="0.5" y="0.5" width="59" height="79" fill="none" stroke="#ddd8d0"/></svg>')

# ------------------------------------------------------------------ pieces
def para(key, text, rich=False):
    attr = 'data-marble-rich' if rich else 'data-marble-editable'
    return f'<p {mid(key)} {attr}>{text}</p>'

def aside(key, head, text):
    return (f'<div class="aside" {mid("a-" + key)}>'
            f'<p class="sidenote" {mid("sn-" + key)} data-marble-rich><b>{esc(head)}</b>{text}</p></div>')

def section(key, num, title, inner):
    return (f'<section id="s-{key}" {mid("s-" + key)} class="prose">\n'
            f'      <span class="snum" {mid("sn-" + key)}>Section {num}</span>\n'
            f'      <h2 {mid("h-" + key)} data-marble-editable>{esc(title)}</h2>\n'
            f'      {inner}\n    </section>')

def figure_stages():
    n = len(D.STAGES)
    stages = ''.join(
        f'<button class="stage" {mid("st-" + str(i))} data-marble-value="{i}"><b {mid("stb-" + str(i))}>{esc(s["name"])}</b>'
        f'<span {mid("sts-" + str(i))}>{esc(s["short"])}</span></button>'
        for i, s in enumerate(D.STAGES, 1))
    texts = ''.join(
        f'<span data-step="{i}" {mid("stx-" + str(i))} data-marble-editable>{esc(s["text"])}</span>'
        for i, s in enumerate(D.STAGES, 1))
    return (f'<figure {mid("fig-1")}>'
            f'<div class="fig-frame" {mid("fig1-frame")}>'
            f'<div class="loop" {mid("loop")} data-marble-choose="data-step" data-marble-of="body" aria-label="Degree of generation">{stages}</div>'
            f'<div class="stepbar" {mid("stepbar")}>'
            f'<button {mid("step-back")} data-marble-step="data-step:1:{n}" data-marble-by="-1" data-marble-of="body" aria-label="Previous degree">←</button>'
            f'<button {mid("step-fwd")} data-marble-step="data-step:1:{n}" data-marble-by="1" data-marble-of="body" aria-label="Next degree">→</button>'
            f'<p class="steptext" {mid("steptext")}>{texts}</p></div></div>'
            f'<figcaption {mid("fig1-cap")} data-marble-rich>{D.FIG1_CAPTION}</figcaption></figure>')

def figure_matrix():
    head = f'<span class="mh" {mid("mh-0")}></span>' + ''.join(
        f'<span class="mh" {mid("mh-" + c["key"])}>{esc(c["label"])}</span>' for c in D.MATRIX_COLS)
    body = ''
    panes = ''
    for r in D.MATRIX_ROWS:
        body += f'<span class="mrow" {mid("mr-" + r["key"])}><b {mid("mrb-" + r["key"])}>{esc(r["label"])}</b>{esc(r["sub"])}</span>'
        for c in D.MATRIX_COLS:
            cell = D.MATRIX_CELLS[(r['key'], c['key'])]
            refs = cell['refs']
            n = len(refs)
            density = 'thin' if n <= 3 else ('medium' if n <= 7 else 'thick')
            gap = ' data-gap="yes"' if cell.get('gap') else ''
            key = f'{r["key"]}-{c["key"]}'
            body += (f'<button class="cell" {mid("mc-" + key)} data-marble-value="{key}" data-density="{density}"{gap}>'
                     f'<span {mid("mcn-" + key)}>{n}</span></button>')
            links = ', '.join(f'<a href="#r-{k}">{esc(D.SOURCE_BY_KEY[k]["short"])}</a>' for k in refs)
            panes += (f'<div class="pane" {mid("pn-" + key)} data-for-cell="{key}">'
                      f'<p class="pane-note" {mid("pnn-" + key)} data-marble-editable>{esc(cell["note"])}</p>'
                      f'<p class="pane-refs" {mid("pnr-" + key)}>{links or "<em>Nothing in this scan.</em>"}</p></div>')
    return (f'<figure {mid("fig-2")}><div class="fig-frame" {mid("fig2-frame")}>'
            f'<div class="matrix" {mid("matrix")} data-marble-choose="data-cell" data-marble-of="body" aria-label="Coverage matrix">{head}{body}</div>'
            f'<div class="panes" {mid("panes")}>{panes}</div></div>'
            f'<figcaption {mid("fig2-cap")} data-marble-rich>{D.FIG2_CAPTION}</figcaption></figure>')

def rows_positions():
    out = f'<div class="rows" {mid("rows")}>'
    for i, p in enumerate(D.POSITIONS, 1):
        cls = ' class="is-ours"' if p.get('ours') else ''
        out += (f'<div{cls} {mid("row-" + str(i))}>'
                f'<h4 {mid("r" + str(i) + "-h")}>{esc(p["name"])}<span class="who" {mid("r" + str(i) + "-w")}>{esc(p["who"])}</span></h4>'
                f'<p {mid("r" + str(i) + "-p")} data-marble-rich>{p["text"]}</p></div>')
    return out + '</div>'

def theses():
    out = f'<ul class="theses" {mid("theses")}>'
    for t in D.THESES:
        out += (f'<li {mid("th-" + t["key"])}><b class="tkey" {mid("thk-" + t["key"])}>{esc(t["label"])}</b>'
                f'<div {mid("thb-" + t["key"])}>' + ''.join(f'<p {mid("thp-" + t["key"] + "-" + str(i))} data-marble-rich>{p}</p>' for i, p in enumerate(t['paras'], 1)) + '</div></li>')
    return out + '</ul>'

def entry(src):
    k = src['key']
    g = src['group']
    conf = '<span class="conf ok" ' + mid('c-' + k) + '>checked</span>' if src.get('verified', True) else '<span class="conf todo" ' + mid('c-' + k) + '>unverified — check</span>'
    notes = src.get('notes', '')
    return (f'<li class="entry" id="r-{k}" {mid("e-" + k)} data-status="{src.get("status", "to-read")}" data-marble-removable>'
            f'{thumb(k, g, src.get("motif", "list"))}'
            f'<div class="entry-main" {mid("m-" + k)}>'
            f'<h4 {mid("h-" + k)} data-marble-editable>{esc(src["title"])}</h4>'
            f'<p class="meta" {mid("v-" + k)}>{esc(src["meta"])} <span class="ftag {g}" {mid("f-" + k)}>{esc(GROUPS[g]["tag"])}</span></p>'
            f'<p class="lbl" {mid("ls-" + k)}>What it is {conf}</p>'
            f'<p class="summary" {mid("s-" + k)} data-marble-editable>{esc(src["summary"])}</p>'
            f'<p class="lbl" {mid("lr-" + k)}>What it says about the activity</p>'
            f'<p class="rel" {mid("rl-" + k)} data-marble-editable>{esc(src["stance"])}</p>'
            f'<p class="lbl" {mid("ln-" + k)}>My notes</p>'
            f'<p class="notes" {mid("n-" + k)} data-marble-editable data-ph="Nothing yet — type here.">{esc(notes)}</p>'
            f'<div class="entry-foot" {mid("ft-" + k)}>'
            f'<span class="pick" {mid("pk-" + k)} data-marble-choose="data-status" data-marble-of=".entry" aria-label="Reading status">'
            f'<button {mid("p1-" + k)} data-marble-value="to-read">To read</button><button {mid("p2-" + k)} data-marble-value="read">Read</button><button {mid("p3-" + k)} data-marble-value="key">Key</button></span>'
            f'<a class="src" {mid("a-" + k)} href="{html.escape(src["url"], quote=True)}" target="_blank" rel="noopener noreferrer">Open source →</a>'
            f'</div></div></li>')

def refgroups():
    out = ''
    for gk, g in GROUPS.items():
        srcs = [s for s in D.SOURCES if s['group'] == gk]
        if not srcs:
            continue
        out += (f'<div class="refgroup {gk}" {mid("g-" + gk)}>'
                f'<h3 {mid("gh-" + gk)} data-marble-editable>{esc(g["label"])}</h3>'
                f'<p class="group-dek" {mid("gd-" + gk)} data-marble-editable>{esc(g["dek"])}</p>'
                f'<ol class="refs" {mid("gl-" + gk)} data-marble-sortable="refs">' + ''.join(entry(s) for s in srcs) + '</ol></div>')
    return out

def questions():
    items = ''.join(f'<li {mid("q-" + str(i))} data-marble-editable data-marble-removable>{esc(q)}</li>' for i, q in enumerate(D.QUESTIONS, 1))
    return (f'<ul class="qs" id="qs-list" {mid("qs-list")} data-marble-sortable="questions">{items}</ul>'
            f'<button class="addq" {mid("add-q")} data-marble-add="#tpl-q" data-marble-into="#qs-list" data-marble-instruction="Add an open question.">+ question</button>')

# ------------------------------------------------------------------ blocks
def render_blocks(skey, blocks):
    out = []
    pn = 0
    for b in blocks:
        kind = b[0]
        if kind == 'p':
            pn += 1
            out.append(para(f'{skey}-p{pn}', b[1], rich=(len(b) > 2 and b[2])))
        elif kind == 'aside':
            out.append(aside(f'{skey}-{b[1]}', b[2], b[3]))
        elif kind == 'stages':
            out.append(figure_stages())
        elif kind == 'matrix':
            out.append(figure_matrix())
        elif kind == 'positions':
            out.append(rows_positions())
        elif kind == 'theses':
            out.append(theses())
        elif kind == 'refs':
            out.append(refgroups())
        elif kind == 'questions':
            out.append(questions())
        else:
            raise SystemExit(f'unknown block {kind}')
    return '\n      '.join(out)

# ------------------------------------------------------------------ page
def build():
    rail = ''.join(f'<li {mid("rl-" + str(i))}><a href="#s-{s["key"]}" {mid("rla-" + str(i))}>{i}. {esc(s["rail"])}</a></li>'
                   for i, s in enumerate(D.SECTIONS, 1))
    secs = []
    for i, s in enumerate(D.SECTIONS, 1):
        inner = render_blocks(s['key'], s['blocks'])
        secs.append(section(s['key'], i, s['title'], inner))
    n_sources = len(D.SOURCES)
    page = f'''<!doctype html>
<html lang="en" data-marble="1">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="marble:capabilities" content="storage; net=none">
  <title>{esc(D.TITLE_SHORT)}</title>
  <style data-marble-id="style-main">{css()}</style>
</head>
<body data-marble-id="report" data-step="{D.STEP_DEFAULT}" data-cell="{D.CELL_DEFAULT}">
  <div class="sheet" {mid("sheet")}>

    <div class="masthead" {mid("masthead")}>
      <span class="kicker" {mid("kicker")} data-marble-editable>{esc(D.KICKER)}</span>
      <span class="date" {mid("date")} data-marble-editable>{esc(D.DATE)}</span>
    </div>

    <div class="opening" {mid("opening")}>
      <h1 {mid("title")} data-marble-editable>{esc(D.TITLE)}</h1>
      <p class="byline" {mid("byline")} data-marble-editable>{esc(D.BYLINE.replace("{n}", str(n_sources)))}</p>
      <p class="question" {mid("question")} data-marble-editable>{esc(D.QUESTION)}</p>
      {aside("note-use", "This note is the file", D.USE_NOTE)}
      <div class="answer" {mid("answer")}>
        {''.join(para("ans-" + str(i), p, rich=True) for i, p in enumerate(D.ANSWER, 1))}
      </div>
    </div>

    <nav class="rail" {mid("rail")} aria-label="Contents">
      <p {mid("rail-h")}>Contents</p>
      <ol {mid("rail-list")}>{rail}</ol>
    </nav>

    {chr(10).join(secs)}

    <footer {mid("footer")}>
      <span {mid("foot-l")} data-marble-editable>{esc(D.FOOT)}</span>
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
    return page

if __name__ == '__main__':
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'out.mrbl'
    page = build()
    out.write_text(page)
    print(out, len(page), 'bytes', len(ids_seen), 'ids', len(D.SOURCES), 'sources')
