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

/** The frame an agent's look is said as: the caller's fields ride along,
 *  `label` keeps its old default (the client), and `client` and `ids` are
 *  the look's own. */
export function lookFrame(client, ids, extra = {}) {
  const { label, client: _client, ids: _ids, ...meta } = extra ?? {};
  return {
    ...meta,
    client,
    ids: Array.isArray(ids) ? ids : [],
    label: label ?? client,
  };
}

/** A presence frame as someone holding a share link is sent it: where the
 *  work is and how far along, never the words — the prompt the owner asked
 *  with, an agent's note on a batch, or the words of the step it says it is
 *  on (its count stays). Everyone else is sent the frame whole. */
export function forVisitor(frame) {
  if (!frame || typeof frame !== 'object') return frame;
  const { prompt, note, step, ...rest } = frame;
  if (step && typeof step === 'object') {
    const { text, ...count } = step;
    rest.step = count;
  } else if (step !== undefined) {
    rest.step = step;
  }
  return rest;
}

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

  /** The bare `changed` Marble's carrier listens for. When `ops` is present,
   *  a named `ops` event goes first so a new carrier can apply them without
   *  throwing away undo; `changed` still follows so an old carrier refetches. */
  function toDocument(docPath, event = 'changed', { except = null, ops = null, client = null } = {}) {
    const opsFrame = ops?.length
      ? `event: ops\ndata: ${JSON.stringify({ ops, client })}\n\n`
      : null;
    const changedFrame = `data: ${event}\n\n`;
    for (const listener of perDoc.get(docPath) ?? []) {
      if (except && listener.id === except) continue;
      if (opsFrame) write(listener, opsFrame);
      write(listener, changedFrame);
    }
  }

  /** A presence frame to every tab on the document; a share link's
   *  listener (`visitor`) is sent `forVisitor`'s part of it. */
  function toPresence(docPath, data, { except = null } = {}) {
    const frame = (body) => `event: presence\ndata: ${JSON.stringify(body)}\n\n`;
    const payload = frame(data);
    let visitorPayload = null;
    for (const listener of perDoc.get(docPath) ?? []) {
      if (except && listener.id === except) continue;
      if (listener.visitor) write(listener, (visitorPayload ??= frame(forVisitor(data))));
      else write(listener, payload);
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
    toPresence,
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
