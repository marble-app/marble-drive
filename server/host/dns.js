// A drive's own name on the host's tunnel (docs/HOSTING.md, "Direct mode"):
// `cloudflared tunnel route dns marble-pc-host <name>.marbledrive.app`, a
// CNAME over the zone's `*` record. cloudflared is signed in as the owner
// (~/.cloudflared/cert.pem), so only marble-host and his terminal run it.

import { execFile } from 'node:child_process';

/** The tunnel every drive's name points at (linux/pc-host/tunnel.sh). */
export const TUNNEL = 'marble-pc-host';

/** Resolves { ok, said }: whether the name points at the tunnel now, and
 *  cloudflared's last line. */
export const routeDns = (host, { run = execFile } = {}) =>
  new Promise((resolve) => {
    run('cloudflared', ['tunnel', 'route', 'dns', TUNNEL, host], { timeout: 60_000 }, (error, stdout, stderr) =>
      resolve({ ok: !error, said: `${stdout ?? ''}${stderr ?? ''}`.trim().split('\n').filter(Boolean).at(-1) ?? '' }),
    );
  });
