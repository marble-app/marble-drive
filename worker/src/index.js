// worker/src/index.js
// The lease, on Cloudflare: one Durable Object per drive, so a read after a
// move always sees it (KV can lag by a minute). The Mac, the sprite and
// tools/drive-home.mjs are its only callers, with one shared bearer token.
// Its second job is the front door: a marbledrive.app name is routed to its
// drive (router.js) and never needs the token.

import { INITIAL, move } from './lease.js';
import { Directory } from './door/directory.js';
import { isFrontDoor, route } from './router.js';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export class Lease {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const current = (await this.state.storage.get('lease')) ?? INITIAL;
    if (request.method === 'GET') return json(200, current);
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/move')) {
      let body;
      try {
        body = await request.json();
      } catch {
        return json(400, { why: 'the body must be JSON', lease: current });
      }
      const result = move(current, { to: body?.to, epoch: body?.epoch, now: Date.now() });
      if (!result.ok) return json(result.status, { why: result.why, lease: result.lease ?? current });
      await this.state.storage.put('lease', result.lease);
      return json(200, result.lease);
    }
    return json(404, { why: 'no such route' });
  }
}

export async function handle(request, env) {
  if (isFrontDoor(new URL(request.url).hostname)) return route(request, env);
  if (!env.LEASE_TOKEN) return json(500, { why: 'LEASE_TOKEN is not set on this Worker' });
  if (request.headers.get('authorization') !== `Bearer ${env.LEASE_TOKEN}`) return json(401, { why: 'unauthorised' });
  const match = /^\/lease\/([a-z0-9-]+)(\/move)?$/.exec(new URL(request.url).pathname);
  if (!match) return json(404, { why: 'no such route' });
  return env.LEASE.get(env.LEASE.idFromName(match[1])).fetch(request);
}

export { Directory };

export default { fetch: handle };
