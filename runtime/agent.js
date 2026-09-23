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
    // Aimed at a document other than this page. Drive uses this so picking a
    // row writes that file without leaving the listing. viewing stays this
    // page; also is extra documents in view, not extra writable targets.
    let aimed = null;
    let alsoLooking = [];

    const elementOf = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement ?? null);

    const addressed = (node) => {
      const hit = elementOf(node)?.closest?.('[data-marble-id]');
      if (!hit || hit.closest(TRANSIENT)) return null;
      return hit.getAttribute('data-marble-id');
    };

    const notify = () => dispatchEvent(new CustomEvent('marble:agent-context'));

    // Every addressed element the range touches, said once. Candidates are the
    // elements the range intersects, minus <html>, <body> and transient chrome.
    // Leaves are the deepest of those; a leaf's addressed ancestor replaces its
    // children only when the range holds all of it, so a fully selected list is
    // its list, and three paragraphs picked out of a section stay three.
    const SKIP = new Set(['HTML', 'BODY']);
    // A boundary point sitting inside a node's own last descendant — the end
    // of its final line of text — compares as *before* a boundary point one
    // level up, right after that node closes, even though both sit at the
    // same place on the page. selectNode's probe lands one level up, so a
    // selection that runs to the very end of a list's last item would never
    // read as covering the list. Descending to the deepest leaf on each edge
    // puts the probe at the same depth a real selection ends at — skipping
    // whitespace-only text (the indentation between tags in the markup) so
    // the probe lands on real content, not the formatting around it.
    const blank = (node) => node.nodeType === Node.TEXT_NODE && !node.data.trim();
    const deepEdge = (el, atEnd) => {
      let node = el;
      for (;;) {
        const kids = [...node.childNodes].filter((kid) => !blank(kid));
        if (!kids.length) break;
        node = atEnd ? kids[kids.length - 1] : kids[0];
      }
      const offset = atEnd ? (node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length) : 0;
      return [node, offset];
    };
    const contains = (range, el) => {
      const probe = document.createRange();
      const [startNode, startOffset] = deepEdge(el, false);
      const [endNode, endOffset] = deepEdge(el, true);
      probe.setStart(startNode, startOffset);
      probe.setEnd(endNode, endOffset);
      return range.compareBoundaryPoints(Range.START_TO_START, probe) <= 0
        && range.compareBoundaryPoints(Range.END_TO_END, probe) >= 0;
    };
    const idsInRange = (range) => {
      const candidates = [...document.querySelectorAll('[data-marble-id]')].filter((el) =>
        !SKIP.has(el.tagName) && !el.closest(TRANSIENT) && el.getRootNode() === document && range.intersectsNode(el));
      const set = new Set(candidates);
      let chosenEls = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
      for (;;) {
        let merged = false;
        for (const el of chosenEls) {
          const parent = el.parentElement?.closest('[data-marble-id]');
          if (!parent || !set.has(parent) || !contains(range, parent)) continue;
          chosenEls = [parent, ...chosenEls.filter((other) => !parent.contains(other))];
          merged = true;
          break;
        }
        if (!merged) break;
      }
      return chosenEls
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map((el) => el.getAttribute('data-marble-id'));
    };

    document.addEventListener('selectionchange', () => {
      const selection = getSelection();
      if (!selection || !selection.rangeCount) return;
      // Focus moving into the drawer is not the person choosing something new.
      const anchor = elementOf(selection.anchorNode);
      if (!anchor || anchor.closest(TRANSIENT) || anchor.shadowRoot || anchor.getRootNode() !== document) return;
      if (selection.isCollapsed) {
        // Focus moving into the agent's own chrome — the drawer, a callout
        // card — collapses the page's selection to the document root as a
        // side effect. That is the browser tidying up after a focus change,
        // not the person saying "nothing"; the anchor check above misses it
        // because the collapse lands on <body>, not on the chrome.
        if (document.activeElement?.closest?.(TRANSIENT)) return;
        if (!remembered.length) return;
        remembered = [];
        notify();
        return;
      }
      remembered = idsInRange(selection.getRangeAt(0));
      notify();
    });

    const context = () => ({
      viewing: marble.app,
      target: aimed ?? marble.app,
      selection: [...(chosen ?? remembered)],
      also: [...alsoLooking],
    });

    // ---------------------------------------------------------- the streams

    const streams = new Map();
    // A backgrounded page closes its streams and reopens them on return: a
    // phone suspends constantly, and a dead EventSource nobody reconnected
    // is how a page comes to feel broken.
    let suspended = false;

    const openStream = (key, entry) => {
      const url = key === '*' ? '/agent/events?all=1' : `/agent/events?conversation=${enc(key)}`;
      const source = new EventSource(url);
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
      if (key === '*') {
        source.addEventListener('summary', deliver);
        source.addEventListener('folders', deliver);
        // An ask opening or closing anywhere, for a list that would
        // otherwise need every conversation's stream to know.
        for (const kind of ['ask', 'ask.resolved']) {
          source.addEventListener(kind, (message) => {
            let data;
            try {
              data = JSON.parse(message.data);
            } catch {
              return;
            }
            for (const handler of [...current.handlers]) handler({ kind, ...data });
          });
        }
      } else source.onmessage = deliver;
      entry.source = source;
    };

    function on(key, fn) {
      let entry = streams.get(key);
      if (!entry) {
        entry = { source: null, handlers: new Set(), history: key === '*' ? null : [] };
        if (!suspended) openStream(key, entry);
        streams.set(key, entry);
      }
      entry.handlers.add(fn);
      if (entry.history) {
        for (const event of entry.history) fn(event);
      }
      return () => {
        entry.handlers.delete(fn);
        if (entry.handlers.size === 0 && streams.get(key) === entry) {
          entry.source?.close();
          streams.delete(key);
        }
      };
    }

    function suspend() {
      suspended = true;
      for (const entry of streams.values()) {
        entry.source?.close();
        entry.source = null;
      }
    }

    function resume() {
      if (!suspended) return;
      suspended = false;
      for (const [key, entry] of streams) if (!entry.source) openStream(key, entry);
    }

    const streamsOpen = () => [...streams.values()].filter((entry) => entry.source).length;

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
      skills: (provider = null) => ask(provider ? `/agent/skills?provider=${enc(provider)}` : '/agent/skills'),
      usage: () => ask('/agent/usage'),
      asks: () => ask('/agent/asks'),
      usageHistory: (weeks) => ask(weeks ? `/agent/usage/history?weeks=${enc(weeks)}` : '/agent/usage/history'),
      workspace: () => ask('/agent/workspace'),
      conversations: ({ archived = false } = {}) => ask(`/agent/conversations${archived ? '?archived=1' : ''}`),
      conversation: (id) => ask(`/agent/conversations/${enc(id)}`),
      update: (id, patch) => ask(`/agent/conversations/${enc(id)}`, { method: 'PATCH', body: patch }),
      failover: (id) => ask(`/agent/conversations/${enc(id)}/failover`, { method: 'POST' }),
      leaveUsage: (id, turn) => ask(`/agent/conversations/${enc(id)}/usage-left`, { method: 'POST', body: { turn } }),
      // A chat with nothing in it, taken off the disk instead of filed.
      // The host refuses it for anything that has been used, so a caller
      // that guesses wrong gets an error rather than a hole.
      discard: (id) => ask(`/agent/conversations/${enc(id)}`, { method: 'DELETE' }),

      // An image pasted or dropped into a composer. It is kept as a file
      // because that is the only form every provider can open — each one is a
      // CLI reading the disk — so what comes back is a path, and the turn
      // carries the path rather than the bytes.
      upload: ({ name = '', type, data }) => ask('/agent/uploads', { method: 'POST', body: { name, type, data } }),

      projects: () => ask('/agent/projects'),
      addProject: (body) => ask('/agent/projects', { method: 'POST', body }),
      removeProject: (id) => ask(`/agent/projects/${enc(id)}`, { method: 'DELETE' }),

      async start({ provider, model = null, effort = null, mode = null, handoffFrom = null, project = null, failover = null } = {}) {
        const body = { provider };
        if (model) body.model = model;
        if (effort) body.effort = effort;
        if (mode) body.mode = mode;
        if (handoffFrom) body.handoffFrom = handoffFrom;
        if (project) body.project = project;
        if (failover === 'auto' || failover === 'pause') body.failover = failover;
        return (await ask('/agent/conversations', { method: 'POST', body })).id;
      },
      handoff: (id, provider) => agent.start({ provider, handoffFrom: id }),

      send(id, { prompt, target, viewing, selection, also, dispatch, surface } = {}) {
        const here = context();
        const body = {
          prompt,
          context: {
            target: target ?? here.target,
            viewing: viewing ?? here.viewing,
            selection: selection ?? here.selection,
            also: also ?? here.also,
          },
        };
        if (dispatch) body.dispatch = dispatch;
        // Where it was typed, when that is an app for talking rather than a
        // document being worked on. Only `chat` is understood.
        if (surface) body.context.surface = surface;
        return ask(`/agent/conversations/${enc(id)}/turns`, { method: 'POST', body });
      },

      patchTurn: (turnId, patch) => ask(`/agent/turns/${enc(turnId)}`, { method: 'PATCH', body: patch }),

      cancel: (turnId) => ask(`/agent/turns/${enc(turnId)}/cancel`, { method: 'POST' }),
      answer: (turnId, requestId, response) => ask(`/agent/turns/${enc(turnId)}/answer`, { method: 'POST', body: { requestId, response } }),
      undo: (turnId) => ask(`/agent/turns/${enc(turnId)}/undo`, { method: 'POST' }),
      dequeue: (turnId) => ask(`/agent/turns/${enc(turnId)}`, { method: 'DELETE' }),
      archive: (id, archived = true) => ask(`/agent/conversations/${enc(id)}`, { method: 'PATCH', body: { archived } }),
      markReviewed: (id) => ask(`/agent/conversations/${enc(id)}`, { method: 'PATCH', body: { reviewed: true } }),
      restore: (docPath, sha) => ask(`/restore?app=${enc(docPath)}&sha=${enc(sha)}`, { method: 'POST' }),

      folders: () => ask('/agent/folders'),
      createFolder: (body) => ask('/agent/folders', { method: 'POST', body }),
      updateFolder: (id, patch) => ask(`/agent/folders/${enc(id)}`, { method: 'PATCH', body: patch }),
      deleteFolder: (id) => ask(`/agent/folders/${enc(id)}`, { method: 'DELETE' }),
      saveWorkingSet: (ids) => ask('/agent/folders/working-set', { method: 'PUT', body: { ids } }),

      on,
      suspend,
      resume,
      streamsOpen,
      context,
      select(ids) {
        chosen = Array.isArray(ids) && ids.length ? [...ids] : null;
        notify();
      },
      aim(path, { also } = {}) {
        aimed = path || null;
        alsoLooking = Array.isArray(also) ? [...also] : [];
        notify();
      },

      // The conversation is this document's, not the tab's. A chat opened
      // beside one page is about that page; carried to the next one it would
      // quietly start talking about somewhere else. So each document keeps its
      // own, a page that has none opens a new one, and moving a chat to
      // another page is something the person does from the menu, never the
      // drawer on its own.
      current: () => storage.get(agent.here(KEY)),
      remember: (id) => storage.set(agent.here(KEY), id ?? null),
      here: (key) => `${key}:${marble.app ?? location.pathname}`,
      storage,

      open: (id = null) => dispatchEvent(new CustomEvent('marble:agent-open', { detail: { id } })),
      close: () => dispatchEvent(new CustomEvent('marble:agent-close')),
      openSettings: (tab) => dispatchEvent(new CustomEvent('marble:agent-settings', { detail: { tab } })),
    };

    marble.agent = agent;
    dispatchEvent(new CustomEvent('marble:agent', { detail: agent }));
  };

  if (window.marble) attach(window.marble);
  else addEventListener('marble:ready', (event) => attach(event.detail), { once: true });
})();
