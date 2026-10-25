// The router: the one way into the PC's drives from outside, and the only
// thing the `marble-pc-host` tunnel reaches (127.0.0.1:4460).
//
// The front door's Worker sends each request for <name>.marbledrive.app here
// with `x-marble-drive: <name>` and `x-marble-host-key: <PC_HOST_KEY>`, after
// checking that person's pass. Without the key, nothing is answered but a 401,
// so nobody goes around the door: the tunnel's own name is public. Both
// headers are taken off before the request goes on to the drive's port.
//
// It streams both ways and holds nothing: a live update stream (SSE) flows as
// the drive writes it, an upload flows as the browser sends it, and when the
// browser goes, the request to the drive is cut too, so an abandoned stream
// does not keep a drive awake. A drive that is stopped, suspended or not here
// answers 503 "resting".
//
// Every request it forwards carries X-Forwarded-For, so the drive never takes
// it for one made on this machine (server/gate.js, isLocal), and keeps the
// Worker's X-Forwarded-Host and X-Forwarded-Proto, which the drive's origin
// checks and Secure cookies follow.

import crypto from 'node:crypto';
import http from 'node:http';

import { NAME } from './settings.js';

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
// Answered here already (node sends the 100 itself), so not asked again.
const ASKED = new Set(['expect']);
const OURS = new Set(['x-marble-drive', 'x-marble-host-key']);

export const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  b.length > 0 &&
  crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

/** The headers a drive is given: the browser's, less hop-by-hop ones and ours. */
export function forwardHeaders(headers, remoteAddress) {
  const named = new Set(
    String(headers.connection ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (HOP.has(k) || OURS.has(k) || ASKED.has(k) || named.has(k)) continue;
    out[k] = value;
  }
  const from = remoteAddress || '127.0.0.1';
  out['x-forwarded-for'] = out['x-forwarded-for'] ? `${out['x-forwarded-for']}, ${from}` : from;
  return out;
}

const RESTING = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>This drive is resting</title>
<style>body{font:17px/1.5 system-ui,sans-serif;max-width:32rem;margin:18vh auto;padding:0 1.5rem;color:#222;background:#fbfaf8}
@media (prefers-color-scheme: dark){body{color:#eee;background:#1c1b1a}}h1{font-size:1.4rem;font-weight:600}</style></head>
<body><h1>This drive is resting</h1><p>It isn't running right now. Your documents are safe. Try again in a minute.</p></body></html>
`;

export function createRouter({ key, lookup, onPoke = () => {}, health = () => ({ ok: true }), log = console }) {
  if (!key) throw new Error('the router needs HOST_KEY');
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(status === 401 ? { connection: 'close' } : {}) });
    res.end(JSON.stringify(body));
  };
  const resting = (res) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30' });
    res.end(RESTING);
  };

  const server = http.createServer((req, res) => {
    if (!same(req.headers['x-marble-host-key'], key)) {
      // Drain whatever was sent, so the 401 reaches the sender.
      req.resume();
      return json(res, 401, { error: 'unauthorised' });
    }
    const name = req.headers['x-marble-drive'];
    if (!name) {
      const route = new URL(req.url, 'http://x').pathname;
      req.resume();
      if (req.method === 'POST' && route === '/_host/poke') {
        onPoke();
        return json(res, 202, { ok: true });
      }
      if (req.method === 'GET' && route === '/_host/health') return json(res, 200, health());
      return json(res, 404, { error: 'not found' });
    }
    const drive = NAME.test(String(name)) ? lookup(String(name)) : null;
    if (!drive || drive.state !== 'running' || !drive.port) {
      req.resume();
      return resting(res);
    }

    const upstream = http.request({
      host: '127.0.0.1',
      port: drive.port,
      method: req.method,
      path: req.url,
      headers: forwardHeaders(req.headers, req.socket.remoteAddress),
      agent,
    });
    let answered = false;
    upstream.on('response', (up) => {
      answered = true;
      const headers = {};
      for (const [k, v] of Object.entries(up.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v;
      res.writeHead(up.statusCode ?? 502, up.statusMessage, headers);
      // Each piece as it comes: an SSE stream must not wait for a buffer.
      res.flushHeaders();
      up.on('data', (chunk) => {
        if (!res.write(chunk)) {
          up.pause();
          res.once('drain', () => up.resume());
        }
      });
      up.on('end', () => res.end());
      up.on('error', () => res.destroy());
      up.on('aborted', () => res.destroy());
    });
    upstream.on('error', (err) => {
      if (!answered) {
        log.error?.(`[router] ${name}: ${err.code ?? err.message}`);
        return resting(res);
      }
      res.destroy();
    });
    // The browser went (or its upload was cut): so does the request to the drive.
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });

  // An upload takes as long as it takes, and a stream stays open for hours:
  // no time limit on a request beyond the drive's own.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;
  // Nothing here upgrades a connection (the drive streams over plain HTTP).
  server.on('upgrade', (req, socket) => {
    socket.end('HTTP/1.1 501 Not Implemented\r\nconnection: close\r\n\r\n');
  });

  return {
    server,
    listen: (port, host = '127.0.0.1') => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve(server.address().port);
      });
    }),
    close: () =>
      new Promise((resolve) => {
        agent.destroy();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
