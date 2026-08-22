// The Drive host.
//
// It serves a .mrbl document as the page, applies ops to it, and tells every
// other browser on that document that it moved. That loop is Marble's, and this
// is it with a network in the middle and folders underneath — which is the
// whole of G0 and most of G1.
//
// What it does *not* do is ship an interface. The Drive you see is
// `drive.mrbl`, an ordinary document in the drive, which asks the carrier what
// exists and writes what it thinks of the answer into its own markup. If this
// file had an HTML index in it the claim would already be broken.
//
// Nothing below reaches the filesystem. Every read and every write goes through
// the store, which is the seam the next four generations hang off.

import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { backupNow, scheduleBackups } from './backup.js';
import { bytesOf, chooseProvider, enginePath, guardOps, shaOf } from './engine.js';
import { blobsIn, extract, flatten } from './flatten.js';
import { createGate } from './gate.js';
import { escapeHtml, html, json, readBody, readJson, send, text } from './http.js';
import { createIntents } from './intent-routes.js';
import { createOpLog } from './oplog.js';
import { PathError, parsePath, splitPath } from './paths.js';
import { build as buildStarter, list as listStarters } from './gallery.js';
import { createChannels } from './sse.js';
import { createStore } from './store/index.js';
import { watchDrive } from './watch.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const RUNTIME = {
  // Marble's carrier, served from the package. Not copied into this repo: two
  // copies of the contract is how two hosts stop rendering a file the same way.
  'marble.js': () => enginePath('runtime/marble.js'),
  // The Drive's extension to it. Everything a Drive needs that a single
  // document does not — see docs/CARRIER-DRIVE.md.
  'drive.js': () => path.join(REPO, 'runtime', 'drive.js'),
};

export async function createDrive(config, { log = console } = {}) {
  const store = createStore({ root: config.root });
  await store.ready();

  const channels = createChannels();
  const oplog = createOpLog({ dir: store.marbleDir });
  const gate = createGate({
    secret: config.secret,
    cookieName: config.cookieName,
    days: config.sessionDays,
    secure: config.secureCookie,
  });
  const intents = createIntents({ store, log });

  // Writes are serialized per document. `lastKnown` holds the last content this
  // host is sure about and which client put it there, and it answers the two
  // questions the watcher cannot: whether a change on disk is one of ours, and
  // what the document said *before* an edit from outside.
  const queues = new Map();
  const lastKnown = new Map();

  const enqueue = (docPath, task) => {
    const next = (queues.get(docPath) ?? Promise.resolve()).then(task, task);
    queues.set(docPath, next.catch(() => {}));
    return next;
  };

  // ------------------------------------------------------------------ serving

  const injectCarrier = (source, docPath) => {
    const tags =
      `<script src="/runtime/marble.js" data-marble-app="${escapeHtml(docPath)}" data-marble-transient></script>\n` +
      `<script src="/runtime/drive.js" data-marble-transient></script>`;
    return source.includes('</body>')
      ? source.replace(/<\/body>/i, () => `${tags}\n</body>`)
      : source + tags;
  };

  /** Every document the Drive can see, flat — the shape Marble's carrier
   *  already expects from `/docs`, with `path` and `folder` added. A document
   *  written for a flat host still works; one written for this one gets
   *  folders. */
  const listDocs = async () => (await store.list({ recursive: true })).filter((e) => e.kind === 'doc');

  // ------------------------------------------------------------------ writing

  /** The one write path. Ops are checked against the document as it actually
   *  is and refused as a batch, a restore point is taken of what is being
   *  replaced, and only then do the bytes move. */
  async function applyOps(docPath, ops, { client = null } = {}) {
    return enqueue(docPath, async () => {
      const source = await store.read(docPath);
      if (source === null) throw Object.assign(new Error(`no document "${docPath}"`), { status: 404 });

      const next = guardOps(source, ops);
      if (next === source) return { applied: 0, bytes: bytesOf(source), sha: shaOf(source) };

      lastKnown.set(docPath, { source: next, client });
      const written = await store.write(docPath, next, { label: 'ops', ops });
      await oplog.append(docPath, ops, { client: client ?? 'anon' });
      return { applied: ops.length, ...written };
    });
  }

  /** A document arriving from anywhere other than an op — created, restored,
   *  flattened. Same serialization, same restore point, same echo. */
  async function putDocument(docPath, source, { label, client = null, event = 'created' } = {}) {
    const result = await enqueue(docPath, async () => {
      lastKnown.set(docPath, { source, client: null });
      return store.write(docPath, source, { label });
    });
    channels.toDocument(docPath, 'changed', { except: client });
    channels.toDrive(event, { path: docPath }, { except: client });
    return result;
  }

  // ------------------------------------------------------------------- routes

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const route = url.pathname;

    try {
      // The gate, and the two things that have to be reachable through it: the
      // form itself, and a health check a load balancer runs before anybody has
      // a cookie.
      if (route === '/health') return json(res, 200, { ok: true, docs: channels.counts });
      if (route === '/gate') return gateRoute(req, res, url);
      if (!gate.allows(req)) {
        if ((req.headers.accept ?? '').includes('text/html')) {
          return send(res, 302, '', { Location: `/gate?to=${encodeURIComponent(req.url)}` });
        }
        return json(res, 401, { error: 'this drive is closed', hint: 'POST /gate with the secret' });
      }

      if (route === '/') {
        // Land on the Drive if it is there. It is an ordinary document with no
        // standing, so deleting it falls back to whatever exists.
        const landing = (await store.has(config.home))
          ? config.home
          : (await listDocs())[0]?.path;
        if (landing) return send(res, 302, '', { Location: `/a/${encodeURIComponent(landing)}` });
        return text(res, 404, `no documents in ${config.root}\n\nmake one:  marble-drive new <name>\n`);
      }

      if (route.startsWith('/runtime/')) {
        const file = route.slice('/runtime/'.length);
        const resolve = Object.hasOwn(RUNTIME, file) ? RUNTIME[file] : null;
        if (!resolve) return text(res, 404, `no runtime module "${file}"`);
        const js = await fsp.readFile(resolve(), 'utf8').catch(() => null);
        if (js === null) return text(res, 404, `no runtime module "${file}"`);
        return send(res, 200, js, { 'Content-Type': 'text/javascript; charset=utf-8' });
      }

      if (route.startsWith('/a/')) {
        const docPath = parsePath(decodeURIComponent(route.slice(3)), { allowRoot: false });
        const source = await store.read(docPath);
        if (source === null) return text(res, 404, `no document "${docPath}"`);
        // Serving is the first thing that happens to a document this session, so
        // it is where the baseline comes from: an edit from outside now has a
        // state to be measured against, and a restore point that predates it.
        if (!lastKnown.has(docPath)) {
          lastKnown.set(docPath, { source, client: null });
          await store.mark(docPath, source, 'opened');
        }
        return html(res, 200, injectCarrier(source, docPath));
      }

      // ------------------------------------------------- the carrier's surface

      if (route === '/docs' && req.method === 'GET') {
        if (url.searchParams.get('tree')) {
          return json(res, 200, await store.tree({ folder: url.searchParams.get('folder') ?? '' }));
        }
        // `name` is what Marble's carrier calls a document, and here that name
        // is its whole path — so `marble.href(doc.name)` still opens it.
        const docs = await listDocs();
        return json(res, 200, docs.map((doc) => ({ ...doc, name: doc.path })));
      }

      if (route === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        const client = { id: url.searchParams.get('client'), res };

        const off = url.searchParams.get('drive')
          ? channels.subscribeDrive(client)
          : channels.subscribeDoc(parsePath(url.searchParams.get('app'), { allowRoot: false }), client);
        req.on('close', off);
        return;
      }

      if (route === '/ops' && req.method === 'POST') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const client = url.searchParams.get('client');
        const ops = JSON.parse((await readBody(req, config.maxBodyBytes)).toString('utf8'));
        if (!Array.isArray(ops)) return json(res, 400, { error: 'expected an array of ops' });

        const result = await applyOps(docPath, ops, { client });
        if (result.applied) {
          // The echo is for the other tabs, the other devices, the other
          // people, and the agent — never for whoever filed it.
          channels.toDocument(docPath, 'changed', { except: client });
          channels.toDrive('changed', { path: docPath, bytes: result.bytes }, { except: client });
        }
        return json(res, 200, { ok: true, ...result });
      }

      if (route === '/history' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        return json(res, 200, await store.history(docPath));
      }

      if (route === '/restore' && req.method === 'POST') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const sha = url.searchParams.get('sha');
        if (!/^[0-9a-f]{64}$/.test(sha ?? '')) return json(res, 400, { error: 'bad checkpoint' });

        const wanted = await store.snapshot(docPath, sha);
        if (wanted === null) return json(res, 404, { error: `no checkpoint ${sha.slice(0, 12)}` });
        const current = await store.read(docPath);
        if (wanted === current) return json(res, 200, { ok: true, sha, restored: false });

        // Deliberately not claimed as one client's write: every tab, including
        // the one that asked, is showing a document that just moved wholesale.
        await putDocument(docPath, wanted, { label: 'before-restore', event: 'changed' });
        return json(res, 200, { ok: true, sha, restored: true, bytes: bytesOf(wanted) });
      }

      if (route === '/intents' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const entry = await intents.lookup(docPath, url.searchParams.get('id'));
        if (!entry) return json(res, 404, { error: 'no record of that intent' });
        return json(res, 200, entry);
      }

      if ((route === '/intent' || route === '/zoom') && req.method === 'POST') {
        const docPath = parsePath(url.searchParams.get('app'), { allowRoot: false });
        const request = await readJson(req, config.maxBodyBytes);
        const run = route === '/intent' ? intents.ask : intents.zoom;

        if (!(req.headers.accept ?? '').includes('text/event-stream')) {
          return json(res, 200, await run(docPath, request));
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        // Past this point the status line is already sent, so a failure is an
        // `error` event rather than a 400. A closed connection stops the work
        // rather than only stopping the writing about it.
        let gone = false;
        const withdrawn = new AbortController();
        req.on('close', () => {
          gone = true;
          withdrawn.abort();
        });
        const emit = (event, data) => {
          if (!gone) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        try {
          emit('done', await run(docPath, request, ({ type, ...rest }) => emit(type, rest), withdrawn.signal));
        } catch (err) {
          if (!withdrawn.signal.aborted) emit('error', { error: err.message });
        }
        return res.end();
      }

      // ---------------------------------------------------------- drive verbs

      if (route === '/drive/starters' && req.method === 'GET') {
        return json(res, 200, listStarters());
      }

      if (route === '/drive/tree' && req.method === 'GET') {
        return json(res, 200, await store.tree({ folder: url.searchParams.get('folder') ?? '' }));
      }

      if (route === '/drive/new' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const docPath = await freePath(parsePath(body.path, { allowRoot: false }));
        const source = body.from
          ? await buildStarter(body.from, { name: splitPath(docPath).name })
          : await copyOf(body.copy, docPath);
        await putDocument(docPath, source, { label: 'created', client: body.client ?? null });
        return json(res, 200, { ok: true, path: docPath, href: `/a/${encodeURIComponent(docPath)}` });
      }

      if (route === '/drive/mkdir' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const made = await store.mkdir(body.path);
        channels.toDrive('created', { path: made.path, kind: 'folder' });
        return json(res, 200, { ok: true, ...made });
      }

      if (route === '/drive/move' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const moved = await store.move(body.from, body.to);
        // The name is the address, so a move is a change of identity. The
        // bookkeeping this host holds in memory has to follow it or the next
        // write is measured against the wrong baseline.
        if (lastKnown.has(moved.from)) {
          lastKnown.set(moved.to, lastKnown.get(moved.from));
          lastKnown.delete(moved.from);
        }
        channels.toDrive('moved', moved);
        return json(res, 200, { ok: true, ...moved });
      }

      if (route === '/drive/trash' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const entry = await store.trash(body.path);
        lastKnown.delete(entry.path);
        channels.toDrive('trashed', entry);
        return json(res, 200, { ok: true, ...entry });
      }

      if (route === '/drive/trash' && req.method === 'GET') {
        return json(res, 200, await store.listTrash());
      }

      if (route === '/drive/untrash' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const entry = await store.untrash(body.id, { to: body.to ?? null });
        channels.toDrive('restored', entry);
        return json(res, 200, { ok: true, ...entry });
      }

      // ---------------------------------------------------------------- blobs

      if (route.startsWith('/blob/') && req.method === 'GET') {
        const blob = await store.blobs.get(route.slice('/blob/'.length));
        if (!blob) return text(res, 404, 'no such blob');
        // Content-addressed, so the bytes behind a hash never change and this is
        // the one thing in the whole host that is safe to cache forever.
        return send(res, 200, blob.data, {
          'Content-Type': blob.type,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
      }

      if (route === '/blob' && req.method === 'POST') {
        const bytes = await readBody(req, config.maxBlobBytes);
        const put = await store.blobs.put(bytes, { type: req.headers['content-type'] });
        return json(res, 200, { ok: true, ...put, href: `/blob/${put.hash}` });
      }

      if (route === '/drive/extract' && req.method === 'POST') {
        const body = await readJson(req, config.maxBodyBytes);
        const docPath = parsePath(body.path, { allowRoot: false });
        const source = await store.read(docPath);
        if (source === null) return json(res, 404, { error: `no document "${docPath}"` });

        const result = await extract(source, store.blobs, { min: body.min ?? undefined });
        if (!result.extracted.length) return json(res, 200, { ok: true, extracted: 0, bytes: bytesOf(source) });
        await putDocument(docPath, result.source, { label: 'extract', event: 'changed' });
        return json(res, 200, {
          ok: true,
          extracted: result.extracted.length,
          was: bytesOf(source),
          bytes: bytesOf(result.source),
        });
      }

      // The escape hatch that makes blobs safe to take: any document, back to
      // one self-contained file you can hand to somebody.
      if (route === '/drive/download' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('path'), { allowRoot: false });
        const source = await store.read(docPath);
        if (source === null) return text(res, 404, `no document "${docPath}"`);
        const whole = url.searchParams.get('flatten') === '0'
          ? { source, inlined: 0 }
          : await flatten(source, store.blobs);
        const { name } = splitPath(docPath);
        return send(res, 200, whole.source, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}.mrbl"`,
          'X-Marble-Blobs-Inlined': String(whole.inlined),
        });
      }

      if (route === '/drive/weigh' && req.method === 'GET') {
        const docPath = parsePath(url.searchParams.get('path'), { allowRoot: false });
        const source = await store.read(docPath);
        if (source === null) return json(res, 404, { error: `no document "${docPath}"` });
        return json(res, 200, weigh(docPath, source));
      }

      return text(res, 404, 'not found');
    } catch (err) {
      if (!(err instanceof PathError)) log.error(`[drive] ${req.method} ${route} — ${err.message}`);
      if (res.headersSent) return res.end();
      return json(res, err.status ?? 400, {
        error: err.message,
        ...(err.hint ? { hint: err.hint } : {}),
      });
    }
  });

  // ------------------------------------------------------------------ helpers

  function gateRoute(req, res, url) {
    if (gate.open) return send(res, 302, '', { Location: '/' });

    if (req.method === 'POST') {
      return readJson(req, 4096)
        .then((body) => {
          if (!gate.accepts(body.secret)) return json(res, 401, { error: 'that is not the secret' });
          return json(res, 200, { ok: true }, { 'Set-Cookie': gate.cookieHeader() });
        })
        .catch(() => json(res, 400, { error: 'expected {"secret":"…"}' }));
    }

    // The only HTML this host ships, and it is one form. Anything more would be
    // the host having an interface, which is the thing the Drive exists not to
    // need — but a door has to be openable before there is a document to open.
    const to = escapeHtml(url.searchParams.get('to') ?? '/');
    return html(res, 200, `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Marble Drive</title>
<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#fafaf7;color:#111111}
form{display:flex;gap:.5rem}input,button{font:inherit;padding:.6rem .8rem;border:1px solid #ddd9cf;border-radius:8px}
button{background:#738698;color:#fafaf7;border-color:#738698;cursor:pointer}p{color:#5a5a5a}</style>
<div><p>This drive is closed.</p>
<form onsubmit="event.preventDefault();fetch('/gate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:this.secret.value})}).then(r=>r.ok?location.replace('${to}'):this.secret.select())">
<input name="secret" type="password" placeholder="Secret" autofocus><button>Open</button></form></div>`);
  }

  /** A name that is not taken. Drive appends "(1)" and so does this, because
   *  refusing a click that could have worked is worse than a number. */
  async function freePath(wanted) {
    if (!(await store.has(wanted)) && !(await store.hasFolder(wanted))) return wanted;
    const { parent, name } = splitPath(wanted);
    for (let n = 1; n < 500; n += 1) {
      const candidate = [parent, `${name} ${n}`].filter(Boolean).join('/');
      if (!(await store.has(candidate)) && !(await store.hasFolder(candidate))) return candidate;
    }
    throw new PathError(`too many documents called "${name}"`);
  }

  /** Fork on edit's other half: a copy is a copy of the bytes, because a
   *  document is one file. Nothing else has to happen for it to be yours. */
  async function copyOf(from, to) {
    const source = await store.read(parsePath(from, { allowRoot: false }));
    if (source === null) throw Object.assign(new Error(`no document "${from}"`), { status: 404 });
    return source.replace(/<title>([^<]*)<\/title>/i, () => `<title>${escapeHtml(splitPath(to).name)}</title>`);
  }

  /** What a document weighs, in the terms that decide whether blobs are a
   *  nicety or a blocker: total bytes, how many of them are base64, and how
   *  much of it a hand or a model can actually address. */
  function weigh(docPath, source) {
    const inline = [...source.matchAll(/;base64,([A-Za-z0-9+/=\s]+)"/g)]
      .map((match) => Math.floor(match[1].replace(/\s+/g, '').length * 0.75));
    const heavy = inline.reduce((sum, n) => sum + n, 0);
    const bytes = bytesOf(source);
    return {
      path: docPath,
      bytes,
      nodes: (source.match(/data-marble-id="/g) ?? []).length,
      inlineBlobs: inline.length,
      inlineBytes: heavy,
      // The number the decision actually turns on. Over a phone connection a
      // document that is 90% pixels is not a document, it is a download.
      share: bytes ? Number((heavy / bytes).toFixed(3)) : 0,
      blobs: blobsIn(source).length,
    };
  }

  // ----------------------------------------------------------------- watching

  const watcher = watchDrive(store, async (docPath) => {
    const current = await store.read(docPath);
    const prior = lastKnown.get(docPath);

    if (current === null) {
      // Gone. Either the trash route moved it, in which case the Drive already
      // heard, or somebody deleted the file by hand.
      if (prior) {
        lastKnown.delete(docPath);
        channels.toDrive('removed', { path: docPath });
      }
      return;
    }

    if (prior && current === prior.source) {
      // Our own save, and it has already been announced — synchronously, by the
      // route that made it, which is both faster than this and certain to
      // happen. Marble's host broadcasts from here instead, because its write
      // path does not; doing both is how every other tab hears one edit twice.
      //
      // Nothing is dropped by returning: a rename can wake this watcher several
      // times for one save, and every one of those wakes is this branch.
      return;
    }

    log.log(`[drive] ${docPath} changed outside the host — patching clients`);
    // What the document said before the edit, which is the state you want back
    // when the edit is an agent rewriting more of the file than it meant to.
    // There is no way to capture this as it happens: an external write is only
    // ever observed after the fact.
    if (prior) await store.mark(docPath, prior.source, 'pre-external');
    lastKnown.set(docPath, { source: current, client: null });
    await store.thinHistory(docPath).catch(() => {});
    channels.toDocument(docPath, 'changed');
    channels.toDrive(prior ? 'changed' : 'created', { path: docPath });
  });

  /** What every document said before this host was watching it. Reading the
   *  drive once at boot is what makes "every write is preceded by a snapshot"
   *  true of the first write as well — including a write by an agent that
   *  reaches a document no browser has opened. */
  async function seed() {
    for (const doc of await listDocs()) {
      if (lastKnown.has(doc.path)) continue;
      const source = await store.read(doc.path);
      if (source === null) continue;
      lastKnown.set(doc.path, { source, client: null });
      await store.mark(doc.path, source, 'seen');
    }
  }

  const stopBackups = scheduleBackups({
    root: config.root,
    dir: config.backupDir,
    command: config.backupCommand,
    keep: config.backupKeep,
    everyMinutes: config.backupEveryMinutes,
    log: log.log,
  });

  return {
    server,
    store,
    channels,
    gate,
    oplog,
    config,
    seed,
    weigh,
    backupNow: () =>
      backupNow({
        root: config.root,
        dir: config.backupDir,
        command: config.backupCommand,
        keep: config.backupKeep,
      }),
    provider: () => {
      try {
        return chooseProvider();
      } catch {
        return null;
      }
    },
    async close() {
      stopBackups();
      watcher.close();
      channels.close();
      // Event streams are open by design and keep-alive sockets are open by
      // default, so `close()` alone waits for a client that has no reason to go
      // first. Cut them, then wait for the listener itself.
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
