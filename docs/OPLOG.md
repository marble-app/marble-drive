# The op log

> The op log writes `{t, …op}` — no client id, no counter. Sync at G4 needs both.
> Two fields now costs nothing; two fields across a year of logs costs a
> migration. This is the one G4 decision worth making at G0.
>
> — the `k-ord` card

Every line:

```json
{"t":1787408196387,"doc":"work/q3/notes","client":"hxopj75m","seq":1,
 "type":"move","id":"4b55b336","parentId":"fef83e61","beforeId":null}
```

`t` is when the host wrote it. `client` is the id the page generated for itself.
`seq` is that client's count of its own ops, from this host's point of view.
`doc` is there because a log line that has been copied out of its file should
still say what it is about.

## Why a timestamp is not enough

Two clients whose clocks differ by 40ms — which is every pair of clients — are
unorderable by `t` alone. And one client filing two ops inside a millisecond,
which a drag does constantly, is unorderable by `t` even against itself.

`compareOps` gives a total order: time first, because that is what a person
means by "first"; then `seq` within a client; then the client id, which is
arbitrary and only has to be *consistent* to break a tie.

```js
export const compareOps = (a, b) =>
  a.t - b.t || (a.client === b.client ? a.seq - b.seq : a.client < b.client ? -1 : 1);
```

## What reads it today

Nothing. That is the point. `since(path, {after})` exists and is tested, and G4
is where it earns its keep — "sync over the op log" is the one item in the plan
that cannot be added in front of the data it needs.

## What it is not

The op log is a record of what happened, not a way back. Replaying it from the
beginning would mean trusting every op in it to still apply, which is exactly
the assumption that fails when the thing you want to undo is an op that went
wrong.

The way back is `.marble/history/` — a gzipped snapshot taken before every
write, content-addressed so a document saved a hundred times while nothing
changed costs one blob. Both come from the Marble package; only the extra two
fields are here.
