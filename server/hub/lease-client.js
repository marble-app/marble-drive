// server/hub/lease-client.js
// The lease Worker, from a host or a tool. Every answer is remembered beside
// the hub settings, so a machine that starts with no network (the Mac on a
// plane) goes by the last lease it saw: it serves if that named it. A machine
// that never saw one stays on standby. A lease that refuses this machine
// (401/403/404: a wrong token or URL) is not "unreachable": the remembered
// lease is not used, and the machine stands by. A hold file (drive-home's)
// means standby before the lease is asked at all.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { holdPath } from './settings.js';

export function createLeaseClient({
  settings,
  fetchImpl = fetch,
  cacheFile = path.join(path.dirname(settings.file), `lease-${settings.HUB_DRIVE}.json`),
  timeoutMs = 5_000,
}) {
  const base = `${settings.LEASE_URL.replace(/\/$/, '')}/lease/${settings.HUB_DRIVE}`;
  const headers = { authorization: `Bearer ${settings.LEASE_TOKEN}`, 'content-type': 'application/json' };
  const remember = async (lease) => {
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(lease));
    return lease;
  };
  return {
    async get() {
      const res = await fetchImpl(base, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw Object.assign(new Error(`the lease answered ${res.status}`), { status: res.status });
      return remember(await res.json());
    },
    async move(to, epoch) {
      const res = await fetchImpl(`${base}/move`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, epoch }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(body.why ?? `the lease answered ${res.status}`), { status: res.status, lease: body.lease });
      return remember(body);
    },
    async cached() {
      try {
        return JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
      } catch {
        return null;
      }
    },
  };
}

const REFUSED = [401, 403, 404];

export async function decideMode({ settings, client, held = (s) => fs.existsSync(holdPath(s)) }) {
  if (!settings) return { mode: 'serve', why: 'no hub settings: this drive has one home' };
  if (held(settings)) return { mode: 'standby', why: `held by drive-home (${holdPath(settings)})` };
  const verdict = (lease, why) => ({ mode: lease.home === settings.HUB_MACHINE ? 'serve' : 'standby', why, lease });
  try {
    return verdict(await client.get(), 'the lease');
  } catch (err) {
    if (REFUSED.includes(err.status)) {
      return { mode: 'standby', why: `the lease refused this machine (${err.status}): check LEASE_URL and LEASE_TOKEN; the remembered lease is not used` };
    }
    const lease = await client.cached();
    if (!lease) return { mode: 'standby', why: `the lease is unreachable (${err.message}) and none remembered` };
    return verdict(lease, `the lease is unreachable (${err.message}); going by the last one seen`);
  }
}
