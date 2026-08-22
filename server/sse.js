// Who hears about a change.
//
// Two channels, because there are two questions. A document's channel answers
// "the file under this page moved" and is what Marble's carrier already opens.
// The drive channel answers "the folder changed" — something was created,
// moved, or thrown away — and is what makes the Drive a live view of a shared
// space rather than a listing you have to reload.
//
// The `except` in `toDocument` is the whole of the echo rule, and it is worth
// being precise about who it protects. The tab that filed the ops has already
// moved its own DOM; telling it the file changed makes a drag fight itself
// halfway through, and a reconcile clears the undo ring on the way past. Every
// *other* tab is showing a document that has moved underneath it and has to be
// told. So it is the client that is excluded, never the connection and never
// the document.

const KEEPALIVE = 25_000;

export function createChannels() {
  const perDoc = new Map();
  const drive = new Set();

  const add = (set, client) => {
    set.add(client);
    return () => set.delete(client);
  };

  function subscribeDoc(docPath, client) {
    if (!perDoc.has(docPath)) perDoc.set(docPath, new Set());
    const set = perDoc.get(docPath);
    const off = add(set, client);
    return () => {
      off();
      if (set.size === 0) perDoc.delete(docPath);
    };
  }

  const subscribeDrive = (client) => add(drive, client);

  function write(client, payload) {
    try {
      client.res.write(payload);
    } catch {
      // A socket that went away between the check and the write. The 'close'
      // handler that unsubscribes it has either run or is about to.
    }
  }

  /** The bare `changed` Marble's carrier listens for. */
  function toDocument(docPath, event = 'changed', { except = null } = {}) {
    for (const client of perDoc.get(docPath) ?? []) {
      if (except && client.id === except) continue;
      write(client, `data: ${event}\n\n`);
    }
  }

  /** A named event with a body, for the Drive. */
  function toDrive(event, data = {}, { except = null } = {}) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of drive) {
      if (except && client.id === except) continue;
      write(client, payload);
    }
  }

  // A proxy with an idle timeout will close a stream that has been silent for a
  // minute, and the browser reconnects — so this is not about correctness, it
  // is about not reconnecting every sixty seconds for the whole life of a tab.
  const beat = setInterval(() => {
    for (const set of perDoc.values()) for (const client of set) write(client, ': ping\n\n');
    for (const client of drive) write(client, ': ping\n\n');
  }, KEEPALIVE);
  beat.unref?.();

  return {
    subscribeDoc,
    subscribeDrive,
    toDocument,
    toDrive,
    get counts() {
      return { docs: perDoc.size, drive: drive.size };
    },
    close() {
      clearInterval(beat);
      perDoc.clear();
      drive.clear();
    },
  };
}
