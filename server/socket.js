// One connection per tab.
//
// A drive page keeps several live streams open — its document, the drive, an
// agent conversation or two, build mode, the console — and over HTTP/1.1 a
// browser holds at most six connections to one origin, so a tab with five
// streams had one connection left for everything else and saves queued behind
// them ("saving…" that never ends). The page's carrier (`marble.stream`, in
// @bdhmin/marble's runtime/marble.js) instead carries every stream of a tab
// over one WebSocket, `GET /sync/ws`, and this is the host's end of it.
//
// Frames are JSON text:
//
//   tab → host   {t:"sub", id, url, lastEventId?}   open the stream at url
//                {t:"unsub", id}                    close it
//                {t:"ping"}                         keepalive (every 25 s)
//   host → tab   {t:"open", id}                     the stream is open
//                {t:"ev", id, event, data, lastEventId?}   one SSE event
//                {t:"err", id, status, reason}      it did not open (or failed)
//                {t:"end", id, lastEventId?}        the host ended it
//                {t:"pong"}
//
// A `sub` is served by the drive's own request handler, exactly as the SSE
// request for that url would be: a request made of the socket's own upgrade
// request (its cookies, its bearer, where it came from) with the sub's url and
// `Last-Event-ID`, and a response that turns what the route writes into `ev`
// frames. So every route keeps its own rules — the gate, a share link's
// policy, the idle sweep (server/streams.js), Last-Event-ID replay — and no
// SSE route changes. A route that answers anything but an event stream is an
// `err` with its status: a 204 is "stop trying" (a rested tab), as it is to
// an EventSource.

import { EventEmitter } from 'node:events';

import { WebSocketServer } from 'ws';

export const SOCKET_PATH = '/sync/ws';
const MAX_SUBS = 64;
const MAX_FRAME = 64 * 1024;
const MAX_URL = 4096;
const MAX_BUFFERED = 16 * 1024 * 1024;
// A tab pings every 25 s. Twice that and more without a word, it is gone.
const SILENT_MS = 75_000;
// A socket with no streams for this long is closed; the tab opens another
// when it next needs one.
const EMPTY_MS = 5 * 60_000;
const ERR_REASON_MAX = 300;

// The upgrade request's headers that describe the socket, not the stream.
const SOCKET_HEADERS = new Set([
  'upgrade',
  'connection',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
  'accept-encoding',
  'content-length',
  'transfer-encoding',
]);

/** A request for one stream, made of the socket's upgrade request. */
function streamRequest(upgrade, url, lastEventId) {
  const req = new EventEmitter();
  const headers = {};
  for (const [key, value] of Object.entries(upgrade.headers)) {
    if (!SOCKET_HEADERS.has(key)) headers[key] = value;
  }
  headers.accept = 'text/event-stream';
  if (lastEventId !== undefined && lastEventId !== null && lastEventId !== '') headers['last-event-id'] = String(lastEventId);
  else delete headers['last-event-id'];
  req.method = 'GET';
  req.url = url;
  req.headers = headers;
  req.rawHeaders = Object.entries(headers).flatMap(([k, v]) => [k, String(v)]);
  req.httpVersion = upgrade.httpVersion;
  req.httpVersionMajor = upgrade.httpVersionMajor;
  req.httpVersionMinor = upgrade.httpVersionMinor;
  // Where the request came from is the socket's: the gate's `isLocal` reads it.
  req.socket = upgrade.socket;
  req.connection = upgrade.socket;
  req.complete = true;
  req.aborted = false;
  req.readable = false;
  req.resume = () => req;
  req.pause = () => req;
  req.setEncoding = () => req;
  req.read = () => null;
  req.pipe = (dest) => dest;
  req[Symbol.asyncIterator] = async function* empty() {};
  return req;
}

/** Reads SSE text as the route writes it and calls `onEvent` per event. */
function sseReader(onEvent) {
  let buffer = '';
  let lastEventId = '';
  const block = (text) => {
    let event = '';
    const data = [];
    let any = false;
    let own = null;
    for (const raw of text.split(/\r\n|\r|\n/)) {
      if (!raw || raw.startsWith(':')) continue;
      const colon = raw.indexOf(':');
      const field = colon < 0 ? raw : raw.slice(0, colon);
      let value = colon < 0 ? '' : raw.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') {
        data.push(value);
        any = true;
      } else if (field === 'id' && !value.includes('\0')) {
        lastEventId = value;
        own = value;
      }
    }
    // `lastEventId` only on an event that carried an id of its own.
    if (any) onEvent({ event: event || 'message', data: data.join('\n'), lastEventId: own });
  };
  return {
    push(chunk) {
      buffer += chunk;
      for (;;) {
        const at = buffer.search(/\r\n\r\n|\n\n|\r\r/);
        if (at < 0) break;
        const sep = buffer.startsWith('\r\n\r\n', at) ? 4 : 2;
        block(buffer.slice(0, at));
        buffer = buffer.slice(at + sep);
      }
    },
    get lastEventId() {
      return lastEventId;
    },
  };
}

/** A response a route can write to as if it were an HTTP response. What it
 *  writes goes to `sink`: `head(status, headers)`, `data(text)`, `end()`. */
class StreamResponse extends EventEmitter {
  constructor(req, sink) {
    super();
    this.req = req;
    this.sink = sink;
    this.statusCode = 200;
    this.statusMessage = '';
    this.headersSent = false;
    this.writableEnded = false;
    this.writableFinished = false;
    this.finished = false;
    this.destroyed = false;
    this.sendDate = false;
    this._headers = {};
  }

  setHeader(name, value) {
    this._headers[String(name).toLowerCase()] = value;
    return this;
  }

  getHeader(name) {
    return this._headers[String(name).toLowerCase()];
  }

  getHeaders() {
    return { ...this._headers };
  }

  hasHeader(name) {
    return String(name).toLowerCase() in this._headers;
  }

  removeHeader(name) {
    delete this._headers[String(name).toLowerCase()];
  }

  writeHead(status, message, headers) {
    if (this.headersSent) return this;
    if (typeof message === 'object' && message !== null) headers = message;
    else if (typeof message === 'string') this.statusMessage = message;
    this.statusCode = status;
    if (Array.isArray(headers)) {
      for (let i = 0; i + 1 < headers.length; i += 2) this.setHeader(headers[i], headers[i + 1]);
    } else if (headers) {
      for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    }
    this.headersSent = true;
    this.sink.head(this.statusCode, this._headers);
    return this;
  }

  flushHeaders() {
    if (!this.headersSent) this.writeHead(this.statusCode);
  }

  write(chunk, encoding, cb) {
    if (typeof encoding === 'function') cb = encoding;
    if (this.writableEnded || this.destroyed) return false;
    if (!this.headersSent) this.writeHead(this.statusCode);
    if (chunk !== undefined && chunk !== null && chunk.length !== 0) {
      this.sink.data(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    }
    if (typeof cb === 'function') queueMicrotask(cb);
    return true;
  }

  end(chunk, encoding, cb) {
    if (typeof chunk === 'function') [cb, chunk] = [chunk, undefined];
    if (typeof encoding === 'function') cb = encoding;
    if (this.writableEnded) return this;
    if (chunk !== undefined && chunk !== null) this.write(chunk);
    else if (!this.headersSent) this.writeHead(this.statusCode);
    this.writableEnded = true;
    this.writableFinished = true;
    this.finished = true;
    this.sink.end();
    this.emit('finish');
    this._close();
    if (typeof cb === 'function') queueMicrotask(cb);
    return this;
  }

  destroy() {
    if (!this.writableEnded) this.sink.end({ destroyed: true });
    this.writableEnded = true;
    this._close();
    return this;
  }

  // The stream is over, from either end: the route's `close` handlers run.
  _close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
    this.req.emit('close');
  }
}

/**
 * `handle(req, res)`: the drive's request handler. `authorize(req)` answers
 * `{ ok: true }` or `{ status, error }` for an upgrade request.
 */
export function createSocketHub({ handle, authorize, log = console, maxSubs = MAX_SUBS, silentMs = SILENT_MS, emptyMs = EMPTY_MS } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false, clientTracking: false });
  const sockets = new Set();
  let upgrades = 0;
  let refused = 0;

  function reject(socket, status, error) {
    refused += 1;
    const words = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' }[status] ?? 'Error';
    const body = JSON.stringify({ error });
    try {
      socket.end(`HTTP/1.1 ${status} ${words}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n${body}`);
    } catch {
      socket.destroy();
    }
  }

  /** The server's `upgrade` event. */
  async function upgrade(req, socket, head) {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://x').pathname;
    } catch {
      return reject(socket, 400, 'not an address');
    }
    if (pathname !== SOCKET_PATH) return reject(socket, 404, 'nothing upgrades here');
    if (String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return reject(socket, 400, 'only a WebSocket upgrades here');
    let verdict;
    try {
      verdict = await authorize(req);
    } catch (err) {
      log.error?.(`[socket] deciding an upgrade failed: ${err.message}`);
      return reject(socket, 503, 'try again');
    }
    if (!verdict?.ok) return reject(socket, verdict?.status ?? 401, verdict?.error ?? 'this drive is closed');
    if (socket.destroyed) return undefined;
    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, req));
    return undefined;
  }

  function serve(ws, upgradeReq) {
    upgrades += 1;
    const subs = new Map(); // id → { res, req }
    const conn = { ws, subs, lastSeen: Date.now(), emptySince: Date.now(), tab: tabIn(upgradeReq.url) };
    sockets.add(conn);

    const send = (frame) => {
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > MAX_BUFFERED) {
        // A tab that stopped reading: let it go, it reconnects and catches up.
        log.log?.('[socket] a tab fell too far behind; closing its socket');
        ws.terminate();
        return;
      }
      ws.send(JSON.stringify(frame));
    };

    function open(id, url, lastEventId) {
      const req = streamRequest(upgradeReq, url, lastEventId);
      // A stream opened without the tab's id (the carrier's own) belongs to
      // the tab the socket's other streams name: the idle sweep asks it.
      const tab = tabIn(url);
      if (tab) conn.tab = tab;
      req.marbleTab = () => conn.tab;
      const reader = sseReader((ev) => send({ t: 'ev', id, event: ev.event, data: ev.data, ...(ev.lastEventId ? { lastEventId: ev.lastEventId } : {}) }));
      let streaming = false;
      let body = '';
      let status = 200;
      const sub = { req, res: null, done: false };
      const finish = () => {
        if (sub.done) return;
        sub.done = true;
        if (subs.get(id) === sub) subs.delete(id);
        if (!subs.size) conn.emptySince = Date.now();
      };
      const res = new StreamResponse(req, {
        head(code, headers) {
          status = code;
          streaming = code === 200 && /^text\/event-stream/i.test(String(headers['content-type'] ?? ''));
          if (streaming) send({ t: 'open', id });
        },
        data(text) {
          if (streaming) reader.push(text);
          else if (body.length < 4096) body += text;
        },
        end({ destroyed = false } = {}) {
          // Closed from this end (unsub, socket gone): the tab knows already.
          if (sub.closing) return finish();
          if (streaming) send({ t: 'end', id, ...(reader.lastEventId ? { lastEventId: reader.lastEventId } : {}) });
          else send({ t: 'err', id, status: destroyed && status === 200 ? 500 : status, reason: reasonOf(status, body) });
          finish();
        },
      });
      sub.res = res;
      subs.set(id, sub);
      conn.emptySince = null;
      Promise.resolve()
        .then(() => handle(req, res))
        .catch((err) => {
          log.error?.(`[socket] stream ${url} failed: ${err?.stack ?? err}`);
          if (!res.writableEnded) {
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end();
          }
        });
    }

    function close(id) {
      const sub = subs.get(id);
      if (!sub) return;
      sub.closing = true;
      subs.delete(id);
      if (!subs.size) conn.emptySince = Date.now();
      sub.res.destroy();
    }

    ws.on('message', (raw, isBinary) => {
      conn.lastSeen = Date.now();
      if (isBinary) return;
      let frame;
      try {
        frame = JSON.parse(raw.toString('utf8'));
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      if (frame.t === 'ping') return send({ t: 'pong' });
      const id = frame.id;
      const idOk = (typeof id === 'string' && id.length > 0 && id.length <= 64) || (Number.isInteger(id) && id >= 0);
      if (frame.t === 'unsub') {
        if (idOk) close(id);
        return undefined;
      }
      if (frame.t !== 'sub' || !idOk) return undefined;
      const url = frame.url;
      // Only this origin's own paths, and never the socket itself.
      if (typeof url !== 'string' || url.length > MAX_URL || !url.startsWith('/') || url.startsWith('//') || /[\r\n\0\\]/.test(url)) {
        return send({ t: 'err', id, status: 400, reason: 'a stream is a path on this drive' });
      }
      let pathname;
      try {
        pathname = new URL(url, 'http://x').pathname;
      } catch {
        return send({ t: 'err', id, status: 400, reason: 'a stream is a path on this drive' });
      }
      if (pathname === SOCKET_PATH) return send({ t: 'err', id, status: 400, reason: 'the socket is not a stream' });
      if (subs.has(id)) close(id);
      if (subs.size >= maxSubs) return send({ t: 'err', id, status: 429, reason: `at most ${maxSubs} streams on one socket` });
      const lastEventId = typeof frame.lastEventId === 'string' || Number.isFinite(frame.lastEventId) ? String(frame.lastEventId).slice(0, 256) : undefined;
      open(id, url, lastEventId);
      return undefined;
    });

    const end = () => {
      if (!sockets.has(conn)) return;
      sockets.delete(conn);
      for (const id of [...subs.keys()]) close(id);
    };
    ws.on('close', end);
    ws.on('error', end);
    ws.on('pong', () => {
      conn.lastSeen = Date.now();
    });
  }

  // Sockets that went silent (a laptop that slept, a phone that left), or sat
  // with no streams, are closed. A ping each sweep keeps a quiet but present
  // tab's lastSeen fresh through its pong.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const conn of [...sockets]) {
      if (now - conn.lastSeen > silentMs) conn.ws.terminate();
      else if (conn.emptySince !== null && now - conn.emptySince > emptyMs) conn.ws.close(4000, 'no streams');
      else if (conn.ws.readyState === conn.ws.OPEN) {
        try {
          conn.ws.ping();
        } catch {
          // Closing anyway.
        }
      }
    }
  }, Math.max(1000, Math.min(25_000, Math.floor(silentMs / 3))));
  sweep.unref?.();

  return {
    upgrade,
    get counts() {
      let streams = 0;
      for (const conn of sockets) streams += conn.subs.size;
      return { open: sockets.size, upgrades, refused, streams };
    },
    close() {
      clearInterval(sweep);
      for (const conn of [...sockets]) conn.ws.terminate();
      sockets.clear();
    },
  };
}

const TAB = /^[A-Za-z0-9_-]{1,64}$/;
function tabIn(url) {
  try {
    const tab = new URL(url, 'http://x').searchParams.get('tab');
    return tab && TAB.test(tab) ? tab : null;
  } catch {
    return null;
  }
}

function reasonOf(status, body) {
  if (status === 204) return 'rested';
  let text = body;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === 'string') text = parsed.error;
  } catch {
    // Plain text, or nothing.
  }
  return String(text || `HTTP ${status}`).slice(0, ERR_REASON_MAX);
}
