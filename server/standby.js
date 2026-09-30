// server/standby.js
// The host on the machine that is not home (docs/superpowers/specs/
// 2026-09-29-mac-home-drive-design.md, piece 3). It never opens the drive. It
// answers /health so a deploy's health check passes, and every other request
// with a page saying where the drive is.

import fs from 'node:fs';
import http from 'node:http';

import { holdPath } from './hub/settings.js';

const WHERE = { mac: 'on the Mac', fly: 'on Fly' };

/** Where the page should say the drive is: the lease as it is now, asked
 *  afresh (the remembered one is stale after a move), else the remembered
 *  one; and whether drive-home holds this machine. Never throws. */
export async function whereIsHome({ settings, client, held = (s) => fs.existsSync(holdPath(s)) }) {
  if (!settings) return { home: null, since: null, held: false };
  const lease = await client.get().catch(() => client.cached());
  return { home: lease?.home ?? null, since: lease?.since ?? null, held: Boolean(held(settings)) };
}

export function createStandby({ home = null, since = null, held = false } = {}) {
  const where = WHERE[home] ?? 'somewhere else';
  // A held machine is the side a move left: it knows the drive is elsewhere,
  // but a lease it read may be stale, so it names no place.
  const said = held
    ? `<h1>This drive is being served from the other machine</h1>
<p>Nothing is lost. This page checks again every 30 seconds.</p>`
    : `<h1>This drive is ${where} right now</h1>
<p>Nothing is lost: it is being served from the other machine${since ? ` since ${since.slice(0, 16).replace('T', ' ')} UTC` : ''}.
This page checks again every 30 seconds.</p>`;
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><title>Marble Drive</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#222}
@media (prefers-color-scheme:dark){body{background:#1b1b1a;color:#e8e6e1}}main{max-width:28rem;padding:1rem}</style>
<main>${said}</main>`;
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
