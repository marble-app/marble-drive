# Blobs, and the way back

> A document points at a hash instead of carrying 1.7 MB of base64. This is the
> first real tension with "one file, one app", so it comes with its own escape:
> any document can be flattened back into one self-contained file to hand to
> someone.
>
> — the `k-blob` card

## Measure first

`corpus-teaser.mrbl` in the Marble checkout is 1.76 MB, nearly all of it base64
JPEG. Over a phone connection that number is what decides whether blobs are a
nicety or a blocker — so there is a command that answers it before anybody
chooses:

```
$ marble-drive weigh
  bytes     base64    nodes   document
  1.76 MB       94%      312   photos/corpus teaser
    51 KB         —       36   drive
    23 KB         —       21   work/q3 numbers

  1.83 MB across 3 document(s); 90% of it is inline base64.
```

## Out

```
POST /drive/extract {"path": "photos/corpus teaser"}
```

Every `src="data:…;base64,…"` at or above 64 KB becomes a blob under
`.marble/blobs/`, content-addressed by SHA-256. The element keeps its id and its
position; it gains `data-marble-blob="<hash>"` and its `src` becomes a 1×1
transparent GIF.

Small data URLs are left alone. A hash for a 400-byte icon is a worse document
for no gain.

## Back

```
GET /drive/download?path=photos/corpus%20teaser
```

Every blob inlined, the two attributes removed, the bytes identical to what went
in — there is a test that asserts exactly that, byte for byte. This is not a
convenience feature; it is the thing that makes taking the storage win safe. A
document you can hand to somebody is a document that opens with no host at all.

A blob that has gone missing is left named in the document rather than silently
dropped, and reported in the answer.

## How it stays true that a document names no route

The file says `data-marble-blob="<hash>"`. It does not say where a hash is
resolved, because that is the host's business — `runtime/drive.js` sets the real
`src` on the page and never writes it back. Flatten produces a file with no
attribute pointing anywhere at all.

## The tension, stated plainly

"One file, one app" is the whole claim, and a document that points at a hash
outside itself is not one file. The vision names two honest answers and picks
the first:

1. **Blobs absorb it.** Structure and behaviour stay in the markup where they
   can be dragged and rewritten; the bytes that are not structure sit beside the
   file under a hash. The document stays the app; it stops being the whole
   payload.
2. **Some apps are not Marble apps.** A tool whose state is genuinely opaque
   gets a data sidecar and gives up in-place malleability for it.

The second has no floor: once one app keeps its state elsewhere, the next one
has a precedent rather than an argument to answer. So: blobs, and a flatten that
is always one request away.
