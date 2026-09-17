// The agents surface of the carrier: `window.marble.agent`.
//
// Like `marble.drive`, a namespace a document can test for, and a proposal for
// the carrier rather than part of it. It is only ever injected when the host
// runs agents, so its absence is the answer to "can I talk to an agent here".
//
// Two things it does that are not just fetch calls:
//
//   - it remembers what the person last selected in the document, because the
//     moment they click into a composer to ask about it, the page's selection
//     collapses — focus moving into transient chrome is not a new selection;
//   - it keeps one event stream per conversation, however many views of that
//     conversation are open, and closes it when the last one goes.

(() => {
  const KEY = 'marble-agent:conversation';
  const TRANSIENT = '[data-marble-transient]';

  const attach = (marble) => {
    if (marble.agent) return;

    const enc = encodeURIComponent;

    const ask = async (route, { method = 'GET', body = null } = {}) => {
      const response = await fetch(route, {
        method,
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(answer.error ?? `${route} answered ${response.status}`);
      return answer;
    };

    // ---------------------------------------------------------- the selection

    let chosen = null;
    let remembered = [];

    const elementOf = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement ?? null);

    const addressed = (node) => {
      const hit = elementOf(node)?.closest?.('[data-marble-id]');
      if (!hit || hit.closest(TRANSIENT)) return null;
      return hit.getAttribute('data-marble-id');
    };

    const notify = () => dispatchEvent(new CustomEvent('marble:agent-context'));

    document.addEventListener('selectionchange', () => {
      const selection = getSelection();
      if (!selection || !selection.rangeCount) return;
      // Focus moving into the drawer is not the person choosing something new.
      const anchor = elementOf(selection.anchorNode);
      if (!anchor || anchor.closest(TRANSIENT) || anchor.shadowRoot || anchor.getRootNode() !== document) return;
      if (selection.isCollapsed) {
        if (!remembered.length) return;
        remembered = [];
        notify();
        return;
      }
      const ids = [];
      for (const id of [addressed(selection.anchorNode), addressed(selection.focusNode)]) {
        if (id && !ids.includes(id)) ids.push(id);
      }
      remembered = ids;
      notify();
    });

    const context = () => ({
      viewing: marble.app,
      target: marble.app,
      selection: [...(chosen ?? remembered)],
    });

    // ---------------------------------------------------------- the streams

    const streams = new Map();

    function on(key, fn) {
      let entry = streams.get(key);
      if (!entry) {
        const url = key === '*' ? '/agent/events?all=1' : `/agent/events?conversation=${enc(key)}`;
        entry = { source: new EventSource(url), handlers: new Set(), history: key === '*' ? null : [] };
        const current = entry;
        const deliver = (message) => {
          let data;
          try {
            data = JSON.parse(message.data);
          } catch {
            return;
          }
          if (current.history) current.history.push(data);
          for (const handler of [...current.handlers]) handler(data);
        };
        if (key === '*') entry.source.addEventListener('summary', deliver);
        else entry.source.onmessage = deliver;
        streams.set(key, entry);
      }
      entry.handlers.add(fn);
      if (entry.history) {
        for (const event of entry.history) fn(event);
      }
      return () => {
        entry.handlers.delete(fn);
        if (entry.handlers.size === 0 && streams.get(key) === entry) {
          entry.source.close();
          streams.delete(key);
        }
      };
    }

    // ------------------------------------------------------------- the rest

    const storage = {
      get(key) {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      set(key, value) {
        try {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        } catch {
          // Private browsing, or storage refused. The drawer still works; it just forgets.
        }
      },
    };

    const agent = {
      providers: () => ask('/agent/providers'),
      settings: () => ask('/agent/settings'),
      saveSettings: (patch) => ask('/agent/settings', { method: 'PUT', body: patch }),
      conversations: ({ archived = false } = {}) => ask(`/agent/conversations${archived ? '?archived=1' : ''}`),
      conversation: (id) => ask(`/agent/conversations/${enc(id)}`),

      async start({ provider, model = null, handoffFrom = null } = {}) {
        const body = { provider };
        if (model) body.model = model;
        if (handoffFrom) body.handoffFrom = handoffFrom;
        return (await ask('/agent/conversations', { method: 'POST', body })).id;
      },
      handoff: (id, provider) => agent.start({ provider, handoffFrom: id }),

      send(id, { prompt, target, viewing, selection } = {}) {
        const here = context();
        return ask(`/agent/conversations/${enc(id)}/turns`, {
          method: 'POST',
          body: {
            prompt,
            context: {
              target: target ?? here.target,
              viewing: viewing ?? here.viewing,
              selection: selection ?? here.selection,
            },
          },
        });
      },

      cancel: (turnId) => ask(`/agent/turns/${enc(turnId)}/cancel`, { method: 'POST' }),
      undo: (turnId) => ask(`/agent/turns/${enc(turnId)}/undo`, { method: 'POST' }),
      dequeue: (turnId) => ask(`/agent/turns/${enc(turnId)}`, { method: 'DELETE' }),
      archive: (id, archived = true) => ask(`/agent/conversations/${enc(id)}`, { method: 'PATCH', body: { archived } }),
      markReviewed: (id) => ask(`/agent/conversations/${enc(id)}`, { method: 'PATCH', body: { reviewed: true } }),
      restore: (docPath, sha) => ask(`/restore?app=${enc(docPath)}&sha=${enc(sha)}`, { method: 'POST' }),

      on,
      context,
      select(ids) {
        chosen = Array.isArray(ids) && ids.length ? [...ids] : null;
        notify();
      },

      current: () => storage.get(KEY),
      remember: (id) => storage.set(KEY, id ?? null),
      storage,

      open: (id = null) => dispatchEvent(new CustomEvent('marble:agent-open', { detail: { id } })),
      close: () => dispatchEvent(new CustomEvent('marble:agent-close')),
    };

    marble.agent = agent;
    dispatchEvent(new CustomEvent('marble:agent', { detail: agent }));
  };

  if (window.marble) attach(window.marble);
  else addEventListener('marble:ready', (event) => attach(event.detail), { once: true });
})();
