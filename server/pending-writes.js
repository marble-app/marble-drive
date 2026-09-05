// Answers one question honestly: "is the content now on disk something *we*
// just put there?" — no matter how many of our own writes to the same
// document are still in flight at once.
//
// The watcher used to ask this by comparing disk content against a single
// `lastKnown` slot, and that breaks the moment a document is written to fast
// enough that write B's bookkeeping lands before write A's own rename event
// has settled: by the time A's (slow) settle check runs, `lastKnown` already
// holds B's content, the comparison misses, and A's own save gets reported to
// every open tab — including the one that just made it — as an edit from
// outside. A save that a person is still typing through is exactly the worst
// moment for that: the page reconciles itself against a version of the file
// that predates keystrokes it is still producing.
//
// So instead of one slot, this is a multiset of hashes we are expecting to
// see confirmed. Each write registers the hash of what it is about to put on
// disk; the watcher consumes one matching registration per hash it actually
// sees. Order between overlapping writes no longer matters, because nothing
// here is ever overwritten — only added and removed.

const TTL = 5000; // long enough for any real write to settle; short enough
                   // that a filesystem event a watcher never saw doesn't sit
                   // here forever, shadowing a later, unrelated coincidence.

export function createPendingWrites({ ttl = TTL } = {}) {
  const perDoc = new Map(); // docPath -> Map<hash, Timeout[]>

  /** Register a write we are about to make. Call this before the bytes move. */
  function mark(docPath, hash) {
    if (!perDoc.has(docPath)) perDoc.set(docPath, new Map());
    const hashes = perDoc.get(docPath);
    if (!hashes.has(hash)) hashes.set(hash, []);
    const bucket = hashes.get(hash);

    const timer = setTimeout(() => {
      const at = bucket.indexOf(timer);
      if (at >= 0) bucket.splice(at, 1);
      if (bucket.length === 0) {
        hashes.delete(hash);
        if (hashes.size === 0) perDoc.delete(docPath);
      }
    }, ttl);
    timer.unref?.();
    bucket.push(timer);
  }

  /** Is this hash one of ours? Consumes exactly one matching registration if
   *  so — a second write that happens to produce identical bytes is still
   *  accounted for on its own. */
  function take(docPath, hash) {
    const bucket = perDoc.get(docPath)?.get(hash);
    if (!bucket?.length) return false;
    clearTimeout(bucket.shift());
    if (bucket.length === 0) {
      const hashes = perDoc.get(docPath);
      hashes.delete(hash);
      if (hashes.size === 0) perDoc.delete(docPath);
    }
    return true;
  }

  /** A document's identity is its path, and a move changes it — so a mark
   *  registered under the old path has to follow, the same way `lastKnown`
   *  already does in the caller. Left behind, it would sit under a name the
   *  watcher never checks again, and the rename settling under the new name
   *  would look like a stranger's edit for want of a mark that was there all
   *  along, just filed under the old address. */
  function move(from, to) {
    if (!perDoc.has(from) || from === to) return;
    perDoc.set(to, perDoc.get(from));
    perDoc.delete(from);
  }

  return { mark, take, move };
}
