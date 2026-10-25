// worker/src/pc-host.js
// Other people's drives on the owner's PC (docs/HOSTING.md, "Other people's
// drives on the PC"). One tunnel, pc-host.marbledrive.app, reaches marble-host's
// router on the PC, which hands each request to the drive its header names.
// The Worker adds that name and a key only it and the PC hold, after the
// owner's pass is checked, so nobody can go around the door.
//
// Three settings turn it on: PC_HOST_URL and PC_HOST_KEY so the Worker can
// reach the PC at all, and NEW_DRIVE_HOME=pchost so sign-up makes new drives
// there. With NEW_DRIVE_HOME unset every new drive is made on Fly, as before.
//
// The Worker also looks at the PC itself every five minutes (wrangler.toml's
// [triggers]): a machine at home can be off, and its owner should hear that
// before the people whose drives are on it do.

import { directory, PCHOST } from './door/directory.js';

export { PCHOST };
export const DRIVE_HEADER = 'x-marble-drive';
export const KEY_HEADER = 'x-marble-host-key';
export const HEALTH_TIMEOUT_MS = 10_000;
/** While the PC stays down it is said again at most this often. */
export const ALERT_EVERY_MS = 60 * 60 * 1000;

/** Where a drive made by sign-up lives: `pchost` when NEW_DRIVE_HOME says so,
 *  otherwise `fly`, which is also what unset means. */
export const newDriveHome = (env) => (String(env?.NEW_DRIVE_HOME ?? '').trim().toLowerCase() === PCHOST ? PCHOST : 'fly');

/** Can the Worker reach the PC host? Its address and its key, both. */
export const pcHostReady = (env) => Boolean(env?.PC_HOST_URL && env?.PC_HOST_KEY);

/** Ask marble-host to look at the door's queue now. It also looks by itself,
 *  so a poke that fails is logged and the drive is still made. Only the host
 *  key goes with it: never the Sprites token or the door's admin token. */
export function pokePcHost(env, fetchImpl, ctx) {
  if (!pcHostReady(env)) return;
  const work = (async () => {
    try {
      const res = await fetchImpl(new URL('/_host/poke', env.PC_HOST_URL).href, { method: 'POST', headers: { [KEY_HEADER]: env.PC_HOST_KEY } });
      if (!res.ok) console.log(`door: the PC host answered the poke with ${res.status}`);
    } catch {
      console.log('door: the PC host did not answer the poke');
    }
  })();
  if (ctx?.waitUntil) ctx.waitUntil(work);
  return work;
}

// ---------------------------------------------------------------- the watch

const iso = (ms) => new Date(ms).toISOString();

function lasted(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

/** What one check changes, and what it says: `down` the first time the PC
 *  fails and then hourly while it stays down, `back` once when it answers
 *  after an alert went out. `watch` is what to keep; `alerted` is filled in
 *  by the caller once an alert has actually been sent. */
export function nextWatch(prev, { ok, at, detail = null }) {
  const was = prev?.down ? prev : null;
  if (ok) return { watch: { down: false, since: null, alerted: null, checked: iso(at), detail: null }, say: was?.alerted ? 'back' : null, since: was?.since ?? null };
  const since = was?.since ?? iso(at);
  const due = !was?.alerted || at - Date.parse(was.alerted) >= ALERT_EVERY_MS;
  return { watch: { down: true, since, alerted: was?.alerted ?? null, checked: iso(at), detail }, say: due ? 'down' : null, since };
}

/** The words of an alert, short enough for a phone's lock screen. */
export function alertText(say, { at, since, detail }) {
  const gone = at - Date.parse(since);
  if (say === 'back') return `The PC host is answering again, after ${lasted(gone)}.`;
  if (gone >= 60_000) return `The PC host still isn’t answering, ${lasted(gone)} now (${detail}).`;
  return `The PC host isn’t answering (${detail}). Drives on it show “Your drive is resting”.`;
}

/** `fn(signal)`, given up after `ms`. A timer of its own rather than
 *  AbortSignal.timeout, whose timer Node lets the process exit under. */
async function within(ms, fn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('no answer in time', 'TimeoutError')), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** GET /_host/health with the key: `{ ok, detail }`. Anything but a 200
 *  that says `ok: true`, in time, is the PC not answering. */
async function askHealth(env, fetchImpl, timeoutMs) {
  try {
    return await within(timeoutMs, async (signal) => {
      const res = await fetchImpl(new URL('/_host/health', env.PC_HOST_URL).href, { headers: { [KEY_HEADER]: env.PC_HOST_KEY, accept: 'application/json' }, signal });
      if (!res.ok) return { ok: false, detail: `it answered ${res.status}` };
      const body = await res.json().catch(() => null);
      if (body?.ok !== true) return { ok: false, detail: 'it answered, but not that it is well' };
      return { ok: true, detail: null };
    });
  } catch (err) {
    return { ok: false, detail: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? `no answer in ${Math.round(timeoutMs / 1000)} s` : 'it could not be reached' };
  }
}

/** A short plain-text post to ntfy. The URL is the secret (its topic), so it
 *  is never logged. */
async function sendAlert(env, fetchImpl, text, timeoutMs) {
  try {
    const res = await within(timeoutMs, (signal) =>
      fetchImpl(env.ALERT_NTFY_URL, { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8', title: 'Marble PC host' }, body: text, signal }),
    );
    if (!res.ok) console.log(`pc-host watch: the alert was refused (${res.status})`);
    return res.ok;
  } catch {
    console.log('pc-host watch: the alert could not be sent');
    return false;
  }
}

/** The cron's one job. Without PC_HOST_URL and PC_HOST_KEY it does nothing;
 *  without ALERT_NTFY_URL it checks and logs, and says nothing. What was last
 *  said is kept in the Directory, so every run agrees on it. */
export async function checkPcHost(env, { fetchImpl = fetch, now = Date.now(), timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  if (!pcHostReady(env)) return { skipped: true };
  const health = await askHealth(env, fetchImpl, timeoutMs);
  if (!health.ok) console.log(`pc-host watch: ${health.detail}`);
  if (!env.ALERT_NTFY_URL || !env.DIRECTORY) return { ok: health.ok, said: null };

  const dir = directory(env);
  const kept = await dir('GET', '/watch/pchost');
  const prev = kept.ok ? kept.data.watch ?? null : null;
  const { watch, say, since } = nextWatch(prev, { ok: health.ok, at: now, detail: health.detail });
  let said = null;
  if (say) {
    const sent = await sendAlert(env, fetchImpl, alertText(say, { at: now, since, detail: health.detail }), timeoutMs);
    if (sent) said = say;
    if (sent && say === 'down') watch.alerted = iso(now);
    // A "back" that didn't go out is kept owed: the next check says it.
    if (!sent && say === 'back') return { ok: true, said: null };
  }
  await dir('POST', '/watch/pchost', watch);
  return { ok: health.ok, said };
}
