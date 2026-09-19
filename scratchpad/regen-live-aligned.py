"""Regenerate drive/Agents.mrbl from templates/agents.mrbl when the template
has gained or lost __ID__ slots: align the two line-wise (ids masked) with
difflib, carry an id across for a slot inside an equal run, mint for the rest.
Usage: python3 scratchpad/regen-live-aligned.py [--write]"""
import re, sys, difflib, random, pathlib
root = pathlib.Path('/Users/bryanmin/Development/3rd-year-projects/marble-drive')
tpl = (root / 'templates/agents.mrbl').read_text()
live = (root / 'drive/Agents.mrbl').read_text()
ID_RE = re.compile(r'data-marble-id="([a-z0-9]{8})"')
SLOT = 'data-marble-id="__ID__"'
fixed = set(ID_RE.findall(tpl))
def mask(line):
    return ID_RE.sub(lambda m: m.group(0) if m.group(1) in fixed else SLOT, line)
tl = tpl.split('\n'); ll = live.split('\n')
tm = [mask(x) for x in tl]; lm = [mask(x) for x in ll]
sm = difflib.SequenceMatcher(None, tm, lm, autojunk=False)
used = set(ID_RE.findall(live))
def mint():
    while True:
        s = ''.join(random.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(8))
        if s not in used: used.add(s); return s
out = list(tl); carried = minted = 0; minted_lines = []
live_of = {}
CLASS_RE = re.compile(r'^\s*<(\w+)[^>]*?class="([^"]+)"')
def key(line):
    m = CLASS_RE.match(line)
    return (m.group(1), m.group(2)) if m else None
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == 'equal':
        for k in range(i2 - i1): live_of[i1 + k] = j1 + k
    elif tag == 'replace':
        # Same element (tag + class) on both sides of a rewritten run keeps its id.
        pool = {}
        for j in range(j1, j2):
            if SLOT in lm[j]:
                pool.setdefault(key(lm[j]), []).append(j)
        for i in range(i1, i2):
            if SLOT in tm[i] and key(tm[i]) in pool and pool[key(tm[i])]:
                live_of[i] = pool[key(tm[i])].pop(0)
for i, line in enumerate(tl):
    if SLOT not in line: continue
    ids = None
    if i in live_of:
        ids = [x for x in ID_RE.findall(ll[live_of[i]]) if x not in fixed]
        if len(ids) != line.count(SLOT): ids = None
    if ids is None:
        ids = [mint() for _ in range(line.count(SLOT))]; minted += len(ids); minted_lines.append(i + 1)
    else: carried += len(ids)
    it = iter(ids)
    out[i] = re.sub(re.escape(SLOT), lambda m: f'data-marble-id="{next(it)}"', line)
res = '\n'.join(out)
res = res.replace('<title>__TITLE__</title>', '<title>Agents</title>')
icon = re.search(r'^<link rel="icon"[^\n]*$', live, re.M); assert icon
res = res.replace('__ICON__', icon.group(0), 1).replace('__TITLE__', 'Agents')
live_body = re.search(r'^<body[^\n]*>$', live, re.M).group(0)
res = re.sub(r'^<body[^\n]*>$', lambda m: live_body, res, count=1, flags=re.M)
# The Focus canvas line carries state the seam wrote (data-split); keep the
# live line, with the id the template line was given.
tpl_focus = re.search(r'^<div [^\n]*class="focus"[^\n]*>$', res, re.M)
live_focus = re.search(r'^<div [^\n]*class="focus"[^\n]*>$', live, re.M)
if tpl_focus and live_focus:
    fid = ID_RE.search(tpl_focus.group(0)).group(1)
    keep = ID_RE.sub(f'data-marble-id="{fid}"', live_focus.group(0), count=1)
    res = res.replace(tpl_focus.group(0), keep, 1)
assert '__ID__' not in res and '__TITLE__' not in res and '__ICON__' not in res
print(f'carried {carried} minted {minted} at template lines {minted_lines}')
# live-only lines (would be dropped): masked lines in live not in template
lost = [(j1, j2) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag in ('delete', 'replace', 'insert') and j2 > j1]
lost_lines = [ll[j] for a, b in lost for j in range(a, b)]
print('live-only lines:', len(lost_lines))
for x in lost_lines[:12]: print('  >', x[:110])
if '--write' in sys.argv:
    (root / 'drive/Agents.mrbl').write_text(res); print('written', len(res))
else:
    pathlib.Path('/tmp/Agents.regen.mrbl').write_text(res); print('dry run', len(res))
