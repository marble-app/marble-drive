// Answers one question honestly: "is the content now on disk something *we*
// just put there?" — no matter how many of our own writes to the same
// document are still in flight at once, and no matter how long the host was
// too busy to look.
//
// The watcher used to ask this by comparing disk content against a single
// `lastKnown` slot, and that breaks the moment a document is written to fast
// enough that write B's bookkeeping lands before write A's own rename event
// has settled. So instead of one slot, this is a record of the hashes of our
// own recent writes, per document.
//
// It used to be a multiset whose entries expired after 5 s. That made "ours"
// a question about the clock: a batch that held the event loop for longer than
// 5 s (a merge on a 2 MB page took 54 s) let the mark of the save before it
// expire, the watcher then read the host's own save, called it an edit from
// outside, and merged it against every session's edits — forking each edited
// element into a <marble-alt>. Nothing here expires by time any more. A mark
// leaves in one of two ways:
//
//   - the watcher consumes it, having seen those bytes on disk, and every
//     older mark of the same document goes with it: writes to one document
//     are serialized, so once a later write's bytes have been seen, the
//     earlier ones will never be on disk again as *our* save;
//   - it is pushed out by newer marks once a document has KEEP of them.

const KEEP = 32;

export function createPendingWrites({ keep = KEEP } = {}) {
  const perDoc = new Map(); // docPath -> hash[] (oldest first)

  /** Register a write we are about to make. Call this before the bytes move. */
  function mark(docPath, hash) {
    if (!perDoc.has(docPath)) perDoc.set(docPath, []);
    const hashes = perDoc.get(docPath);
    hashes.push(hash);
    if (hashes.length > keep) hashes.splice(0, hashes.length - keep);
  }

  /** Is this hash one of ours? Consumes the oldest matching mark, and every
   *  older one with it (they are superseded: writes to one document are
   *  serialized). A second write that produced identical bytes and has not
   *  been seen yet is newer, so it stays for its own event. */
  function take(docPath, hash) {
    const hashes = perDoc.get(docPath);
    if (!hashes) return false;
    const at = hashes.indexOf(hash);
    if (at < 0) return false;
    hashes.splice(0, at + 1);
    if (hashes.length === 0) perDoc.delete(docPath);
    return true;
  }

  /** Is this hash one of ours, without consuming anything. */
  const has = (docPath, hash) => Boolean(perDoc.get(docPath)?.includes(hash));

  /** How many marks a document holds; for tests. */
  const size = (docPath) => perDoc.get(docPath)?.length ?? 0;

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

  return { mark, take, has, size, move };
}
