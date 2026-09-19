// The Drive surface for Fast GenUI. Keys stay on the host; a document never
// carries TYPESAFE_API_KEY. The route reads the document through the store,
// decides, and writes through the same writeOps a gesture uses — which is why
// an open page moves when Jev decides.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { json, readJson } from '../http.js';
import { docKey, parsePath, PathError } from '../paths.js';
import { explainTypesafeFailure } from '../typesafe/client.js';
import { noKeyFailure, readStop } from '../typesafe/routes.js';
import { loadAtlas } from './atlas.js';
import { decideDocument } from './decide.js';
import { decideRoot } from './root.js';
import { extractSpace, validateSpace } from './space.js';

export function createGenuiHandler({
  store,
  atlasFile,
  apiKey = null,
  writeOps,
  marbleDir,
  ask = undefined,
  log = console,
  maxBodyBytes = 16 * 1024 * 1024,
} = {}) {
  let atlasPromise = null;
  const atlas = () => {
    if (!atlasPromise) {
      atlasPromise = loadAtlas(atlasFile).catch((err) => {
        atlasPromise = null;
        const wrapped = new Error(`the Atlas at ${atlasFile} could not be read: ${err.message}`);
        wrapped.status = 503;
        throw wrapped;
      });
    }
    return atlasPromise;
  };

  const record = async (docPath, entry) => {
    try {
      await fsp.mkdir(marbleDir, { recursive: true });
      await fsp.appendFile(path.join(marbleDir, `${docKey(docPath)}.genui.jsonl`), `${JSON.stringify(entry)}\n`);
    } catch (err) {
      log.error?.(`[genui] could not record a decide for ${docPath}: ${err.message}`);
    }
  };

  // A path arrives from a query string or a JSON body, and the same document
  // must land in the same write queue and the same channel whichever way it
  // was spelled — so it goes through parsePath like every other write route.
  const readDoc = async (raw, res) => {
    let docPath;
    try {
      docPath = parsePath(raw, { allowRoot: false });
    } catch (err) {
      if (err instanceof PathError) {
        json(res, 400, { error: raw ? err.message : 'which document? pass doc=<path>' });
        return null;
      }
      throw err;
    }
    const source = await store.read(docPath);
    if (source === null) {
      json(res, 404, { error: `no document "${docPath}"` });
      return null;
    }
    return { docPath, source };
  };

  // A response whose socket has gone is not a place to write an error.
  const reply = (res, status, body) => {
    if (res.destroyed || res.writableEnded || res.headersSent) return;
    json(res, status, body);
  };

  return {
    atlas,
    async handle(req, res, url) {
      const route = url.pathname;

      if (route === '/genui/space' && req.method === 'GET') {
        const doc = await readDoc(url.searchParams.get('doc') ?? '', res);
        if (doc === null) return true;
        try {
          const index = await atlas();
          json(res, 200, { doc: doc.docPath, space: extractSpace(doc.source), validation: validateSpace(doc.source, index) });
        } catch (err) {
          json(res, err.status ?? 500, { error: err.message });
        }
        return true;
      }

      // Every document that is an app space: what a generator can reopen.
      // Only files whose bytes carry the attribute are parsed.
      if (route === '/genui/spaces' && req.method === 'GET') {
        try {
          const docs = (await store.list({ recursive: true })).filter((e) => e.kind === 'doc');
          const spaces = [];
          for (const doc of docs) {
            const source = await store.read(doc.path);
            if (!source || !source.includes('data-genui=')) continue;
            const space = extractSpace(source);
            if (!space.instances.length) continue;
            spaces.push({
              path: doc.path,
              request: space.request,
              instances: space.instances.length,
              decisions: space.instances.reduce((n, i) => n + i.decisions.length, 0),
            });
          }
          json(res, 200, spaces);
        } catch (err) {
          json(res, err.status ?? 500, { error: err.message });
        }
        return true;
      }

      // L0: which root pattern. The prompt is the state; the Atlas definitions
      // are the glosses; the LLM then authors a space for the one Jev chose.
      if (route === '/genui/root' && req.method === 'POST') {
        if (!apiKey) {
          json(res, 503, { ...noKeyFailure(), error: noKeyFailure().message });
          return true;
        }
        const body = await readJson(req, maxBodyBytes);
        const ac = new AbortController();
        let finished = false;
        res.on('close', () => {
          if (!finished) ac.abort();
        });
        try {
          const index = await atlas();
          const out = await decideRoot({
            atlas: index,
            apiKey,
            request: body.request,
            context: body.context && typeof body.context === 'object' ? body.context : {},
            signal: ac.signal,
            ...(ask ? { ask } : {}),
          });
          finished = true;
          reply(res, 200, out);
        } catch (err) {
          finished = true;
          if (err.code === 'CANCELLED' || ac.signal.aborted) reply(res, 499, { kind: 'cancelled', title: 'Stopped.', message: 'The root decision was cancelled.' });
          else reply(res, err.status ?? 500, { error: err.message, ...(err.status === 400 ? {} : explainTypesafeFailure(err)) });
        }
        return true;
      }

      if (route === '/genui/decide' && req.method === 'POST') {
        if (!apiKey) {
          json(res, 503, { ...noKeyFailure(), error: noKeyFailure().message });
          return true;
        }
        const body = await readJson(req, maxBodyBytes);
        const doc = await readDoc(body.doc ?? '', res);
        if (doc === null) return true;
        const { docPath, source } = doc;
        const dry = body.dry === true;
        const stop = readStop(body.stop);
        const context = body.context && typeof body.context === 'object' ? body.context : {};
        const request = typeof body.request === 'string' && body.request.trim() ? body.request.trim() : null;

        // The client going away cancels the TypeSafe request — but not a write
        // that has already been decided, and never after the run finished.
        const ac = new AbortController();
        let finished = false;
        res.on('close', () => {
          if (!finished) ac.abort();
        });
        try {
          const index = await atlas();
          const result = await decideDocument({
            source,
            atlas: index,
            apiKey,
            request,
            context,
            stop,
            signal: ac.signal,
            ...(ask ? { ask } : {}),
          });
          finished = true;
          let applied = 0;
          if (!dry && result.ops.length) {
            const written = await writeOps(docPath, result.ops, { client: 'genui' });
            applied = written.applied ?? 0;
          }
          const out = {
            doc: docPath,
            dry,
            stop,
            context,
            request: result.state.request,
            decisions: result.decisions,
            ops: result.ops,
            applied,
            elapsedMs: result.elapsedMs,
            usage: result.usage,
          };
          await record(docPath, { at: new Date().toISOString(), ...out });
          reply(res, 200, out);
        } catch (err) {
          finished = true;
          if (err.code === 'CANCELLED' || ac.signal.aborted) {
            await record(docPath, { at: new Date().toISOString(), doc: docPath, dry, stop, context, cancelled: true });
            reply(res, 499, { kind: 'cancelled', title: 'Stopped.', message: 'The decide was cancelled.' });
          } else if (err.status === 422 && err.issues) {
            reply(res, 422, { error: err.message, issues: err.issues });
          } else {
            reply(res, err.status ?? 500, { error: err.message, ...explainTypesafeFailure(err) });
          }
        }
        return true;
      }

      return false;
    },
  };
}
