// server/standby.js
// The host on the machine that is not home (docs/superpowers/specs/
// 2026-09-29-mac-home-drive-design.md, piece 3). It never opens the drive. It
// answers /health so a deploy's health check passes, and every other request
// with a page saying where the drive is.

import http from 'node:http';

const WHERE = { mac: 'on the Mac', fly: 'on Fly' };

export function createStandby({ home = null, since = null } = {}) {
  const where = WHERE[home] ?? 'somewhere else';
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><title>Marble Drive</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#222}
@media (prefers-color-scheme:dark){body{background:#1b1b1a;color:#e8e6e1}}main{max-width:28rem;padding:1rem}</style>
<main><h1>This drive is ${where} right now</h1>
<p>Nothing is lost: it is being served from the other machine${since ? ` since ${since.slice(0, 16).replace('T', ' ')} UTC` : ''}.
This page checks again every 30 seconds.</p></main>`;
  return http.createServer((req, res) => {
    const route = new URL(req.url, 'http://standby').pathname;
    if (route === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, standby: true, home, working: 0 }));
      return;
    }
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30', 'cache-control': 'no-store' });
    res.end(page);
  });
}
