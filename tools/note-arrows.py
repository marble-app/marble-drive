"""The arrows a note draws when you type -> or -->, as a font of nine glyphs.

The note is set in the machine's own sans, and none of the system sans faces
draws ⟶ ⟵ ⟷: the browser borrows them from a symbol font, thin and sitting low,
and ↔ ⇒ come out a size smaller than the → beside them. So the note carries
these nine itself, drawn here to sit on the middle of the lowercase and to
match the text's stroke, in a regular and a bold cut. `unicode-range` keeps
the font off every other character.

    python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli skia-pathops
    /tmp/ft/bin/python tools/note-arrows.py   # prints the @font-face rules

Paste what it prints over the two rules in starters/note.mrbl.
"""

import base64
import io
import math

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
AXIS = 276          # the middle of the lowercase, where the shaft runs
SIDE = 60           # side bearing each side


def rect(path, a, b, half):
    """A bar of thickness 2*half from a to b, its ends cut square."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = x1 - x0, y1 - y0
    n = math.hypot(dx, dy)
    nx, ny = -dy / n * half, dx / n * half
    path.moveTo(x0 + nx, y0 + ny)
    path.lineTo(x1 + nx, y1 + ny)
    path.lineTo(x1 - nx, y1 - ny)
    path.lineTo(x0 - nx, y0 - ny)
    path.close()


def head(path, tip, way, reach, half):
    """An open chevron whose mitred point is `tip`; `way` is +1 for one
    pointing right, -1 for left. Each arm is lengthened by half a stroke past
    the corner, so the two outer edges meet in a clean point."""
    tx, ty = tip
    cx = tx - way * half * math.sqrt(2)          # the corner of the centrelines
    back = half / math.sqrt(2)
    for up in (1, -1):
        rect(path, (cx + way * back, ty - up * back), (cx - way * reach, ty + up * reach), half)
    return cx


def arrow(length, half, *, left=False, right=False, double=False, reach=None, gap=0):
    path = pathops.Path()
    x0, x1 = SIDE, SIDE + length
    reach = reach or 4 * half + 100
    a, b = x0, x1
    if right:
        b = head(path, (x1, AXIS), 1, reach, half)
    if left:
        a = head(path, (x0, AXIS), -1, reach, half)
    if double:
        # Two rails, stopped where they run into the arms rather than through.
        for y in (AXIS + gap, AXIS - gap):
            rect(path, (a + (gap if left else 0), y), (b - (gap if right else 0), y), half)
    else:
        rect(path, (a, AXIS), (b, AXIS), half)
    path.simplify(fix_winding=True, keep_starting_points=False)
    rec = RecordingPen()
    path.draw(rec)
    pen = TTGlyphPen(None)
    rec.replay(pen)
    return pen.glyph(), x1 + SIDE


def font(weight, half):
    short, long = 680, 1100
    glyphs = {
        'uni2192': (0x2192, arrow(short, half, right=True)),
        'uni2190': (0x2190, arrow(short, half, left=True)),
        'uni2194': (0x2194, arrow(short + 120, half, left=True, right=True)),
        'uni27F6': (0x27F6, arrow(long, half, right=True)),
        'uni27F5': (0x27F5, arrow(long, half, left=True)),
        'uni27F7': (0x27F7, arrow(long, half, left=True, right=True)),
        'uni21D2': (0x21D2, arrow(short + 40, half * .82, right=True, double=True, reach=300, gap=122)),
        'uni21D0': (0x21D0, arrow(short + 40, half * .82, left=True, double=True, reach=300, gap=122)),
        'uni21D4': (0x21D4, arrow(short + 300, half * .82, left=True, right=True, double=True, reach=300, gap=122)),
    }
    order = ['.notdef', *glyphs]
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({code: name for name, (code, _) in glyphs.items()})
    fb.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), **{n: g for n, (_, (g, _w)) in glyphs.items()}})
    metrics = {'.notdef': (500, 0)}
    for name, (_, (g, width)) in glyphs.items():
        g.recalcBounds(fb.font['glyf'])
        metrics[name] = (round(width), g.xMin)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': 'Note arrows', 'styleName': 'Bold' if weight > 500 else 'Regular'})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, usWeightClass=weight)
    fb.setupPost()
    fb.font.flavor = 'woff2'
    out = io.BytesIO()
    fb.save(out)
    return base64.b64encode(out.getvalue()).decode()


RANGE = 'U+2190, U+2192, U+2194, U+21D0, U+21D2, U+21D4, U+27F5-27F7'
for weight, half, span in ((400, 36, '100 549'), (700, 56, '550 900')):
    print(
        f'  @font-face {{ font-family: "Note arrows"; font-weight: {span}; unicode-range: {RANGE};\n'
        f'    src: url(data:font/woff2;base64,{font(weight, half)}) format("woff2"); }}'
    )
