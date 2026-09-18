// Who hears about agent work as it happens. Two kinds of listener, the same
// split as the Drive's own channels: one conversation's full stream, for the
// drawer and the transcript, and a summary of every conversation, for lists and
// boards that only need to know a card moved.

const KEEPALIVE = 25_000;

export function createHub() {
  const listeners = new Map();

  function subscribe(key, res) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(res);
    return () => {
      listeners.get(key)?.delete(res);
      if (listeners.get(key)?.size === 0) listeners.delete(key);
    };
  }

  const write = (res, payload) => {
    try {
      res.write(payload);
    } catch {
      // Gone between the check and the write; its close handler unsubscribes it.
    }
  };

  function publish(conversationId, event, summary = null) {
    const idLine = event.seq ? `id: ${event.seq}\n` : '';
    for (const res of listeners.get(conversationId) ?? []) write(res, `${idLine}data: ${JSON.stringify(event)}\n\n`);
    if (summary) {
      for (const res of listeners.get('*') ?? []) write(res, `event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
    }
  }

  function publishFolders(payload) {
    for (const res of listeners.get('*') ?? []) {
      write(res, `event: folders\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  }

  const beat = setInterval(() => {
    for (const set of listeners.values()) for (const res of set) write(res, ': ping\n\n');
  }, KEEPALIVE);
  beat.unref?.();

  return {
    subscribe,
    publish,
    publishFolders,
    close() {
      clearInterval(beat);
      listeners.clear();
    },
  };
}
