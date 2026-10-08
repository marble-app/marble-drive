// Build mode over HTTP, behind the agent routes' own checks (the gate, this
// origin for a change): `/agent/builds…` for an app's marks and builds, and
// `/agent/pieces…` for the gallery.

import { json, readJson, send } from '../http.js';
import { parsePath } from '../paths.js';

const BUILD = /^\/agent\/builds\/(b\d{1,5}|origin)\/(pause|resume|stop|view)$/;
const PIECE = /^\/agent\/pieces\/([\w-]{1,64})$/;
const DRAWN = /^\/agent\/builds\/(b\d{1,5})\/drawn$/;

export function createBuildRoutes({ builds, hub, maxBody }) {
  const pathOf = (url) => parsePath(String(url.searchParams.get('path') ?? ''), { allowRoot: false });

  /** One app's changes as they happen: its state now, then each change. */
  function stream(req, res, docPath) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': open\n\n');
    const off = hub.subscribe(builds.channel(docPath), res);
    req.on('close', off);
    builds.read(docPath)
      .then((state) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'state', state })}\n\n`); })
      .catch(() => {});
  }

  async function handle(req, res, url) {
    const route = url.pathname;
    const method = req.method;
    const client = url.searchParams.get('client') || null;
    try {
      if (route === '/agent/builds' && method === 'GET') return json(res, 200, await builds.read(pathOf(url)));
      if (route === '/agent/builds/events' && method === 'GET') return stream(req, res, pathOf(url));

      if (route === '/agent/builds/marks') {
        const docPath = pathOf(url);
        if (method === 'PUT') {
          const body = await readJson(req, maxBody);
          return json(res, 200, { mark: await builds.putMark(docPath, body.mark, { client }) });
        }
        if (method === 'DELETE') {
          const body = await readJson(req, maxBody);
          const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
          return json(res, 200, { removed: await builds.removeMarks(docPath, ids, { client }) });
        }
      }

      if (route === '/agent/builds/start' && method === 'POST') {
        const body = await readJson(req, maxBody);
        return json(res, 202, await builds.start(pathOf(url), {
          marks: Array.isArray(body.marks) ? body.marks : null,
          words: typeof body.words === 'string' ? body.words : '',
          anchor: typeof body.anchor === 'string' ? body.anchor : null,
          client,
        }));
      }

      const action = BUILD.exec(route);
      if (action && method === 'POST') {
        const [, id, verb] = action;
        const docPath = pathOf(url);
        if (verb === 'view') return json(res, 200, await builds.view(docPath, id));
        if (id === 'origin') return json(res, 400, { error: 'origin can only be viewed' });
        return json(res, 200, await builds[verb](docPath, id));
      }

      if (route === '/agent/builds/comment' && method === 'POST') {
        const body = await readJson(req, maxBody);
        return json(res, 200, await builds.comment(pathOf(url), String(body.id ?? ''), body.text, { client }));
      }
      if (route === '/agent/builds/offer' && method === 'POST') {
        const body = await readJson(req, maxBody);
        return json(res, 200, await builds.takeOffer(pathOf(url), String(body.id ?? ''), body.take === true, { client }));
      }
      if (route === '/agent/builds/hold' && method === 'POST') {
        const body = await readJson(req, maxBody);
        return json(res, 200, await builds.hold(pathOf(url), String(body.id ?? ''), body.held === true, { client }));
      }
      if (route === '/agent/builds/resolve' && method === 'POST') {
        const body = await readJson(req, maxBody);
        return json(res, 200, await builds.resolve(pathOf(url), String(body.id ?? ''), body.resolved === true, { client }));
      }
      const drawnFor = DRAWN.exec(route);
      if (drawnFor && method === 'GET') return json(res, 200, await builds.drawnOf(pathOf(url), drawnFor[1]));
      if (route === '/agent/builds/folder' && method === 'POST') {
        const body = await readJson(req, maxBody);
        if (body.dismiss === true) return json(res, 200, await builds.dismissFolder(pathOf(url)));
        return json(res, 200, await builds.file(pathOf(url), body.folder));
      }

      if (route === '/agent/pieces' && method === 'GET') return json(res, 200, await builds.pieces(pathOf(url)));
      if (route === '/agent/pieces/suggested' && method === 'GET') return json(res, 200, await builds.suggested(pathOf(url)));
      if (route === '/agent/pieces' && method === 'POST') {
        const body = await readJson(req, maxBody);
        return json(res, 201, await builds.savePiece(body));
      }
      if (route === '/agent/pieces/preview' && method === 'GET') {
        const html = await builds.preview({
          id: url.searchParams.get('id'),
          path: url.searchParams.get('path'),
          at: url.searchParams.get('at'),
        });
        if (html === null) return json(res, 404, { error: 'no such piece' });
        // Drawn in a frame with an empty sandbox: nothing in it runs, and it
        // has no origin to reach the drive from.
        return send(res, 200, html, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:",
        });
      }
      const piece = PIECE.exec(route);
      if (piece && method === 'DELETE') return json(res, 200, { removed: await builds.removePiece(piece[1]) });
    } catch (err) {
      if (err.status) return json(res, err.status, { error: err.message });
      if (err.name === 'PathError') return json(res, 400, { error: err.message });
      throw err;
    }
    return null;
  }

  return { handle };
}
