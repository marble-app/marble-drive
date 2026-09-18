// Which ids each writer has touched in each document, and when. The package's
// registry (`createTouched` in @bdhmin/marble/server/collab.js) remembers the
// ids; this one also remembers the time, so a conflict check can ask "touched
// since this turn began?" rather than "touched ever". Same shape otherwise.

const conversationOf = (client) => {
  if (typeof client !== 'string') return null;
  if (client.startsWith('agent-undo:')) return client.slice('agent-undo:'.length);
  if (client.startsWith('agent:')) return client.slice('agent:'.length);
  return null;
};

// An agent and its undo write as one; anyone else is themselves.
function sameWriter(a, b) {
  if (!a || !b) return a === b;
  if (a === b) return true;
  const left = conversationOf(a);
  const right = conversationOf(b);
  return left !== null && left === right;
}

export function createTouched() {
  // doc → client → id → time last noted
  const docs = new Map();

  const clientsOf = (doc) => {
    if (!docs.has(doc)) docs.set(doc, new Map());
    return docs.get(doc);
  };

  return {
    note(doc, client, ids, at = Date.now()) {
      if (!client) return;
      const clients = clientsOf(doc);
      if (!clients.has(client)) clients.set(client, new Map());
      const times = clients.get(client);
      for (const id of ids) {
        if (!id) continue;
        times.set(id, Math.max(at, times.get(id) ?? 0));
      }
    },

    except(doc, client, { since = 0 } = {}) {
      const union = new Set();
      for (const [who, times] of clientsOf(doc)) {
        if (sameWriter(who, client)) continue;
        for (const [id, at] of times) if (at >= since) union.add(id);
      }
      return [...union];
    },

    all(doc, options) {
      return this.except(doc, null, options);
    },

    drop(doc, client) {
      clientsOf(doc).delete(client);
    },

    // A writer that has gone away is not touching anything anywhere.
    forget(client) {
      if (!client) return;
      for (const clients of docs.values()) {
        for (const who of [...clients.keys()]) {
          if (sameWriter(who, client)) clients.delete(who);
        }
      }
    },
  };
}
