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

    // The drive's own choices (`.marble/drive.json`): which top-level folders
    // wear a realm's colour, which document /today opens. A host that predates
    // them, or a drive with none, is simply no choices.
    const settings = () =>
      ask('/drive/settings')
        .then((s) => ({ realms: s?.realms ?? {}, latest: s?.latest ?? null }))
        .catch(() => ({ realms: {}, latest: null }));

    // What a starter looks like, for a gallery that shows the document rather
    // than describing it. A href rather than the bytes, because it is mounted in
    // an iframe and a document is not the thing that decides what a preview may
    // run — and a href rather than a path the page builds, because a document
    // never names a route.
    const starterPreviewHref = (id) => `/drive/starters/${encodeURIComponent(id)}/preview`;
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

    // A file that is not a document — a song, a picture, a PDF — as its own
    // bytes. `file` is a Blob (what a drop hands you), sent as the body with
    // no encoding at all, because a 40 MB WAV base64-quoted is 53 MB of string.
    //
    // XHR rather than fetch, because fetch cannot say how far an upload has
    // got, and a song going up over a slow link with nothing moving looks
    // exactly like a drop that did nothing. `onProgress(sent, total)` hears it;
    // `signal` stops it.
    const uploadFile = ({ folder = '', name, file, onProgress = null, signal = null }) =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          'POST',
          `/drive/upload-file?folder=${encodeURIComponent(folder)}` +
            `&name=${encodeURIComponent(name)}&client=${CLIENT}`,
        );
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.responseType = 'text';
        if (onProgress) xhr.upload.onprogress = (event) => onProgress(event.loaded, event.total || file.size);
        xhr.onload = () => {
          let answer = {};
          try {
            answer = JSON.parse(xhr.responseText || '{}');
          } catch {
            // A proxy's HTML error page is not an answer; the status still is.
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            // Drawn now, while the page still holds the file.
            if (answer.path) drawThumb({ path: answer.path, file });
            return resolve(answer);
          }
          // A host started before it knew about files has no route for them,
          // and "404" says nothing about what to do.
          if (xhr.status === 404) return reject(new Error('the host needs a restart before it can take files'));
          if (xhr.status === 413) return reject(new Error('too large for this host'));
          reject(new Error(answer.error ?? `upload answered ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('the connection dropped'));
        xhr.onabort = () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
        if (signal) {
          if (signal.aborted) return xhr.onabort();
          signal.addEventListener('abort', () => xhr.abort(), { once: true });
        }
        xhr.send(file);
      });

    const move = (from, to) => ask('/drive/move', { method: 'POST', body: { from, to } });
    const remove = (path) => ask('/drive/trash', { method: 'POST', body: { path } });
    const restore = (id, to = null) => ask('/drive/untrash', { method: 'POST', body: { id, to } });
    const weigh = (path) => ask(`/drive/weigh?path=${encodeURIComponent(path)}`);

    // A self-contained copy, blobs and all. The promise that makes blobs safe
    // to take is only a promise if it is one click away.
    const downloadHref = (path) => `/drive/download?path=${encodeURIComponent(path)}`;

    // Where a file that is not a document lives. `tree()` reports these as
    // `kind: 'file'` and their path carries its extension, so this is the one
    // address in the drive that is not a document's. The host decides what is
    // safe to render and what is only safe to download; a document asking for
    // the href is not making that call.
    const fileHref = (path) => `/drive/file?path=${encodeURIComponent(path)}`;

    // A picture of that file, `w` pixels wide or a little more, from the host's
    // thumbnailer. It may answer 404 — no thumbnailer here, or none for this
    // kind — and a page that asks has to have something else to draw. `v` is
    // the file's version (its modified time), so an edited file is a new
    // address and a cached picture of the old one is never shown for it.
    const thumbHref = (path, { w = 640, v = '' } = {}) =>
      `/drive/thumb?path=${encodeURIComponent(path)}&w=${w}` + (v ? `&v=${encodeURIComponent(v)}` : '');

    // -------------------------------------------------------- pictures drawn
    //
    // A host that cannot picture a file (anything but a Mac's QuickLook, or a
    // kind QuickLook does not know) is not the end of it: the page can draw
    // an image, a PDF's first page and a video's frame itself. It draws once,
    // hands the picture to the host to keep for this version of the file, and
    // every later visit, on any device, gets it from `thumbHref` instead.
    //
    // Right after an upload the page still holds the file, so it draws from
    // that and costs the network nothing; otherwise it reads the file back —
    // a PDF and a video only as far as they need to. `drawThumb` answers an
    // object URL of what it drew, or null for a kind no browser can draw.

    const DRAWN = {
      image: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico']),
      video: new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv']),
      pdf: new Set(['pdf']),
    };
    const drawnKind = (ext) => Object.keys(DRAWN).find((k) => DRAWN[k].has(String(ext || '').toLowerCase())) ?? null;
    // Pinned. The browser loads it, not the host, so a host needs no way out
    // to the internet for a PDF to get a picture; offline, a PDF keeps its glyph.
    const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
    const WIDE = 640;
    const LONGEST = 1280;
    const MOST_BYTES = 512 * 1024;

    // Two at once: a folder of forty photos is forty asks, and forty decodes
    // at once is the machine, not the page.
    let drawing = 0;
    const turns = [];
    const turn = () => new Promise((resolve) => {
      if (drawing < 2) {
        drawing += 1;
        resolve();
      } else turns.push(resolve);
    });
    const done = () => {
      const next = turns.shift();
      if (next) next();
      else drawing -= 1;
    };

    const canvasFor = (w, h) => {
      const scale = Math.min(1, WIDE / w, LONGEST / h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      return canvas;
    };
    const once = (el, ok, ms = 20_000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), ms);
      el.addEventListener(ok, () => { clearTimeout(timer); resolve(); }, { once: true });
      el.addEventListener('error', () => { clearTimeout(timer); reject(new Error('no picture')); }, { once: true });
    });

    async function drawImage(source) {
      const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = canvasFor(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      return canvas;
    }

    async function drawVideo(source) {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const own = source instanceof Blob ? URL.createObjectURL(source) : null;
      video.src = own ?? source;
      try {
        await once(video, 'loadeddata');
        // A recorded clip can say its length is Infinity; its first frame will do.
        const at = Number.isFinite(video.duration) ? Math.min(1, video.duration / 10) : 0;
        if (at > 0) {
          video.currentTime = at;
          await once(video, 'seeked');
        }
        const canvas = canvasFor(video.videoWidth, video.videoHeight);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas;
      } finally {
        video.removeAttribute('src');
        video.load();
        if (own) URL.revokeObjectURL(own);
      }
    }

    async function drawPdf(source) {
      const lib = await import(`${PDFJS}pdf.min.mjs`);
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
      const doc = await lib.getDocument(
        source instanceof Blob ? { data: new Uint8Array(await source.arrayBuffer()) } : { url: source, disableAutoFetch: true },
      ).promise;
      try {
        const page = await doc.getPage(1);
        const natural = page.getViewport({ scale: 1 });
        const canvas = canvasFor(natural.width, natural.height);
        const viewport = page.getViewport({ scale: canvas.width / natural.width });
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: g, viewport }).promise;
        return canvas;
      } finally {
        doc.destroy();
      }
    }

    const encode = async (canvas) => {
      for (const quality of [0.8, 0.6, 0.4]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.size <= MOST_BYTES) return blob;
      }
      return null;
    };

    const drawing$ = new Map();
    function drawThumb({ path, ext = null, file = null } = {}) {
      const kind = drawnKind(ext ?? String(path).split('.').pop());
      if (!kind || !path) return Promise.resolve(null);
      if (drawing$.has(path)) return drawing$.get(path);
      const work = (async () => {
        await turn();
        try {
          const source = file ?? fileHref(path);
          const canvas = await (kind === 'image' ? drawImage(source) : kind === 'video' ? drawVideo(source) : drawPdf(source));
          const blob = await encode(canvas);
          if (!blob) return null;
          const kept = await fetch(`/drive/thumb?path=${encodeURIComponent(path)}`, {
            method: 'PUT',
            headers: { 'Content-Type': blob.type || 'image/webp' },
            body: blob,
          });
          return kept.ok ? URL.createObjectURL(blob) : null;
        } catch {
          // A codec this browser lacks, a PDF it cannot read, no network for
          // pdf.js: the tile keeps its glyph.
          return null;
        } finally {
          done();
        }
      })();
      drawing$.set(path, work);
      work.finally(() => setTimeout(() => drawing$.delete(path), 0));
      return work;
    }

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
      settings,
      drawThumb,
      starterPreviewHref,
      trash,
      create,
      mkdir,
      upload,
      uploadFile,
      move,
      remove,
      restore,
      weigh,
      downloadHref,
      fileHref,
      thumbHref,
      on,
      resolveBlobs,
    };

    dispatchEvent(new CustomEvent('marble:drive', { detail: marble.drive }));
  };

  if (window.marble) attach(window.marble);
  else addEventListener('marble:ready', (event) => attach(event.detail), { once: true });
})();
