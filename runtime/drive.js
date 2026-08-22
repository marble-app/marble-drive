// The Drive's extension to the carrier surface.
//
// Marble's carrier answers "what does this document need in order to be
// editable": address a node, file an op, hear that the file moved, ask what
// documents exist. That is the right surface for a document and it is not
// enough for a Drive, which has to make folders, clone starters, move things,
// and throw them away.
//
// So this adds `window.marble.drive`. It is deliberately a namespace rather
// than new top-level members: everything under it is a *proposal* for the
// carrier surface, not part of it yet, and a document can tell the difference
// by checking whether it is there. See docs/CARRIER-DRIVE.md.
//
// What matters is the same thing that matters about the rest of the carrier: a
// document never names a route. `drive.mrbl` asks `marble.drive.tree()` what
// exists, and if it ever runs against a host with no Drive underneath it, the
// answer is "nothing" rather than a broken fetch.

(() => {
  const attach = (marble) => {
    if (marble.drive) return;

    const CLIENT = Math.random().toString(36).slice(2, 10);

    // `raw` is for the one verb whose body is a document rather than a
    // description of one. It goes up as itself: a 4 MB file JSON-quoted is a
    // 4 MB string with every byte of it escaped, and the client id travels in
    // the query instead, the way `/ops` already does it.
    const ask = async (route, { method = 'GET', body = null, raw = null } = {}) => {
      const response = await fetch(route, {
        method,
        cache: 'no-store',
        headers: raw !== null
          ? { 'Content-Type': 'text/html; charset=utf-8' }
          : body
            ? { 'Content-Type': 'application/json' }
            : undefined,
        body: raw !== null ? raw : body ? JSON.stringify({ client: CLIENT, ...body }) : undefined,
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(answer.error ?? `${route} answered ${response.status}`);
      return answer;
    };

    // ------------------------------------------------------------- the folder

    const tree = (folder = '') =>
      ask(`/drive/tree?folder=${encodeURIComponent(folder)}`).catch(() => ({
        kind: 'folder',
        path: '',
        title: 'My Drive',
        children: [],
      }));

    const starters = () => ask('/drive/starters').catch(() => []);
    const trash = () => ask('/drive/trash').catch(() => []);

    const create = ({ path, from = null, copy = null }) =>
      ask('/drive/new', { method: 'POST', body: { path, from, copy } });

    const mkdir = (path) => ask('/drive/mkdir', { method: 'POST', body: { path } });

    // A document from somewhere else, into a folder here. `name` is the name it
    // had where it came from — the host is the one that knows what names this
    // drive accepts, so it sanitises rather than making every caller guess.
    const upload = ({ folder = '', name, source }) =>
      ask(
        `/drive/upload?folder=${encodeURIComponent(folder)}` +
          `&name=${encodeURIComponent(name)}&client=${CLIENT}`,
        { method: 'POST', raw: source },
      );

    const move = (from, to) => ask('/drive/move', { method: 'POST', body: { from, to } });
    const remove = (path) => ask('/drive/trash', { method: 'POST', body: { path } });
    const restore = (id, to = null) => ask('/drive/untrash', { method: 'POST', body: { id, to } });
    const weigh = (path) => ask(`/drive/weigh?path=${encodeURIComponent(path)}`);

    // A self-contained copy, blobs and all. The promise that makes blobs safe
    // to take is only a promise if it is one click away.
    const downloadHref = (path) => `/drive/download?path=${encodeURIComponent(path)}`;

    // ------------------------------------------------------------- the events
    //
    // One stream for the whole drive, and a document subscribes to it the way
    // it would subscribe to anything else. Kept separate from the per-document
    // stream Marble's carrier already opens: that one answers "this file
    // moved", and this one answers "the folder did".

    const handlers = new Map();
    let stream = null;

    function listen() {
      if (stream || typeof EventSource === 'undefined') return;
      stream = new EventSource(`/events?drive=1&client=${CLIENT}`);
      for (const name of ['created', 'changed', 'moved', 'trashed', 'restored', 'removed']) {
        stream.addEventListener(name, (event) => {
          let data = {};
          try {
            data = JSON.parse(event.data);
          } catch {
            // A malformed frame is not worth taking the listener down for.
          }
          for (const fn of handlers.get(name) ?? []) fn(data);
          for (const fn of handlers.get('*') ?? []) fn({ event: name, ...data });
        });
      }
    }

    function on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      listen();
      return () => handlers.get(name)?.delete(fn);
    }

    // -------------------------------------------------------------- the blobs
    //
    // A document that has had its heavy bytes extracted carries
    // `data-marble-blob="<hash>"` and a placeholder src. Resolving it is the
    // host's job, not the file's — which is what keeps "one file, one app" true
    // of a document that has been split: hand it to somebody with the bytes
    // inlined and it is whole again, with no attribute left pointing anywhere.

    function resolveBlobs(root = document.body) {
      const scope = root.querySelectorAll ? root : document.body;
      const found = [
        ...(scope.matches?.('[data-marble-blob]') ? [scope] : []),
        ...scope.querySelectorAll('[data-marble-blob]'),
      ];
      for (const el of found) {
        const hash = el.getAttribute('data-marble-blob');
        const href = `/blob/${hash}`;
        if (el.getAttribute('src') === href) continue;
        // The attribute is set on the page and never filed: the file's own src
        // is the placeholder, and writing a route into it would be the document
        // naming this server.
        el.setAttribute('src', href);
      }
    }

    // Re-resolved through `register`, which the carrier calls for anything
    // newly inserted and again over the whole body after reconciling against
    // the file — which is exactly when a resolved src has just been replaced by
    // the placeholder the file holds. Deliberately not `pageOnly('src')`: that
    // would make every src in the document page-only, including the ones a
    // person is entitled to edit in the file.
    marble.register?.(resolveBlobs);

    marble.drive = {
      client: CLIENT,
      tree,
      starters,
      trash,
      create,
      mkdir,
      upload,
      move,
      remove,
      restore,
      weigh,
      downloadHref,
      on,
      resolveBlobs,
    };

    dispatchEvent(new CustomEvent('marble:drive', { detail: marble.drive }));
  };

  if (window.marble) attach(window.marble);
  else addEventListener('marble:ready', (event) => attach(event.detail), { once: true });
})();
