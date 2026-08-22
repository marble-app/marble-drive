# The path grammar

> `isValidName` refuses a slash, so the namespace is flat. Loosen it to segments
> joined by slashes with no `..`.
>
> — the `k-path` card

One character is the whole difference between a flat namespace and folders.
Marble's own check is `/^[a-z0-9][a-z0-9._-]*$/i`, which refuses `/`. This is
that check per segment, plus the rules a segment needs once there can be more
than one of them.

## What a path is

- Segments joined by `/`. No leading or trailing slash — both are trimmed.
- `''` is the root folder. It is a legal path, and it is what "My Drive" names.
- Each segment matches `/^[a-z0-9][a-z0-9._ -]*$/i`. Spaces are allowed inside a
  name, because `q3 numbers` is what people call things.
- At most 16 segments deep, at most 64 characters each.

## What it refuses, and why

| Refused | Why |
|---|---|
| `..`, `.` as a segment | traversal, in the only spelling that matters |
| an empty segment (`a//b`) | two paths that mean one place |
| `\` | a path separator is `/`; a backslash is a character in a name on Unix and a separator on Windows |
| a leading `.` | the bookkeeping tree lives in `.marble/`, and a dotfile is not a document |
| a trailing `.` or space | legal here, unrepresentable on Windows. A name that round-trips on one machine and not another is a sync bug waiting for G4 |
| `.marble`, `.trash`, `.blobs` | reserved. Unreachable twice over, since a leading dot already fails |
| a null byte | belt and braces |

`resolveUnder(root, path)` checks the resolved answer against the root a second
time. The grammar already makes traversal impossible; two independent reasons is
the right number for the function that turns a stranger's string into a
filesystem call.

## The flat key

`docKey('work/q3/notes')` is `'work%2Fq3%2Fnotes'`. Marble's history writes
`<key>.history.jsonl` into one directory, so the key cannot contain a separator.
`unKey` reverses it. This is the only place a path is spelled differently, and
it is why you will see `%2F` in filenames under `.marble/`.

## What it costs

A path is an address. Moving a document changes its address, so a link somebody
shared stops working — a bill that comes due at G2, when links start being
shared with people rather than with yourself. The alternative was a flat
namespace with tags, and that was rejected in the vision on the grounds that
folders are what people already know how to use.

The Drive shows a document's **name in the folder** as its label, not the
`<title>` inside it, for exactly this reason: the name is the address, and after
a rename the two are allowed to disagree. The title becomes the tooltip.
