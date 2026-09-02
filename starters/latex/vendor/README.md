# Vendored: Linux Libertine O / Linux Biolinum O

`04e-embed.html` carries these two typefaces, subsetted, so the LaTeX and paper
starters draw a page in the faces `acmart` sets rather than substituting Times
and Helvetica. `acmart` loads them via `\RequirePackage[tt=false, type1=true]{libertine}`:

| engine key      | face                     |
|-----------------|--------------------------|
| `rm rmb rmi rmbi` | Linux Libertine O        |
| `sf sfb sfi`      | Linux Biolinum O         |

Monospace (`tt`) stays Courier and mathematics stays Symbol — `acmart` sets
those in Inconsolata and `newtxmath`, not yet brought across.

## Licence

Linux Libertine is **GPL with the font exception** (embedding the font in a
document places no licence on the document) and additionally **SIL OFL**.
`LinuxLibertine-LICENCE.txt` and `LinuxLibertine-GPL.txt` are the texts as they
ship in the CTAN `libertine` package; `LinuxLibertine-README.txt` is that
package's README.

## Rebuilding `04e-embed.html`

From the CTAN `libertine` package's `opentype/` directory, for each of
`LinLibertine_R/_RB/_RI/_RBI` and `LinBiolinum_R/_RB/_RI`:

```
pyftsubset FACE.otf \
  --unicodes=U+0020-007E,U+00A0-00FF,<the smart-quote/dash/ligature slots \
             05-metrics.html's WINANSI map and the ligature step can emit> \
  --layout-features= --no-hinting --desubroutinize --glyph-names
```

Then base64 each result and record the `FontBBox`, `ItalicAngle`, `Ascent`,
`Descent` and `CapHeight` from its `head` / `OS/2` tables into
`window.TeX.embed`. `06-pdf.html` embeds each as a `/FontFile3` of
`/Subtype /OpenType` and names it on the font dictionary; the `/Widths` come
from `04b-libertine.html`, which measured the page in these same faces.
