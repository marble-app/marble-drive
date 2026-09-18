// The Drive surface for Fast GenUI. Keys stay on the host; a document never
// carries TYPESAFE_API_KEY. The route reads the document through the store,
// decides, and writes through the same writeOps a gesture uses — which is why
// an open page moves when Jev decides.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { json, readJson } from '../http.js';
import { docKey } from '../paths.js';
import { explainTypesafeFailure } from '../typesafe/client.js';
import { loadAtlas } from './atlas.js';
import { decideDocument } from './decide.js';
import { extractSpace, validateSpace } from './space.js';

function noKeyFailure() {
  return explainTypesafeFailure({
    status: 503,
    message: 'TYPESAFE_API_KEY is not set. Put it in .env.local and restart the host.',
  });
}

function readStop(value, fallback = 0.75) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n > 1 ? n / 100 : n;
}

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

  const readDoc = async (docPath, res) => {
    if (!docPath) {
      json(res, 400, { error: 'which document? pass doc=<path>' });
      return null;
    }
    const source = await store.read(docPath);
    if (source === null) {
      json(res, 404, { error: `no document "${docPath}"` });
      return null;
    }
    return source;
  };

  return {
    atlas,
    async handle(req, res, url) {
      const route = url.pathname;

      if (route === '/genui/space' && req.method === 'GET') {
        const docPath = url.searchParams.get('doc') ?? '';
        const source = await readDoc(docPath, res);
        if (source === null) return true;
        try {
          const index = await atlas();
          json(res, 200, { doc: docPath, space: extractSpace(source), validation: validateSpace(source, index) });
        } catch (err) {
          json(res, err.status ?? 500, { error: err.message });
        }
        return true;
      }

      if (route === '/genui/decide' && req.method === 'POST') {
        if (!apiKey) {
          json(res, 503, { ...noKeyFailure(), error: noKeyFailure().message });
          return true;
        }
        const body = await readJson(req, maxBodyBytes);
        const docPath = String(body.doc ?? '').trim();
        const source = await readDoc(docPath, res);
        if (source === null) return true;
        const dry = body.dry === true;
        const stop = readStop(body.stop);
        const context = body.context && typeof body.context === 'object' ? body.context : {};
        const request = typeof body.request === 'string' && body.request.trim() ? body.request.trim() : null;
        const ac = new AbortController();
        res.on('close', () => ac.abort());
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
          json(res, 200, out);
        } catch (err) {
          if (err.status === 422 && err.issues) {
            json(res, 422, { error: err.message, issues: err.issues });
          } else {
            const explained = explainTypesafeFailure(err);
            json(res, err.status ?? 500, { error: err.message, ...explained });
          }
        }
        return true;
      }

      return false;
    },
  };
}
