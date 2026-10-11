// server/hub/schedule.js
// The home host keeps the hub current. Every minute it checks the lease, even
// when the drive is idle: a lease that moved means another machine is home, so
// this host stops (onLost) instead of uploading over it. A lease it cannot
// reach means waiting a minute, never uploading blind. It uploads only when the
// drive differs from the last upload (any file added, removed, renamed, or of
// another size or mtime).
//
// dirty() says whether the hub is behind: an upload is running, a write
// request came in that no tick started after it has covered (by uploading,
// or by a scan that found nothing new), or the drive
// last seen differs from the one last uploaded. A sprite pauses about a second
// after its last connection, freezing every timer, so the host keeps it awake
// while wantsAwake() (bin/marble-drive.js): dirty(), for at most giveUpMs of
// unsuccessful attempts (a refused upload, a failing one, an unreachable
// lease), after which it lets the sprite sleep until something changes again.
// A write request touches at once; a change made by an agent with no request
// is seen by a separate rescan (watchMs). dirty() itself only reads what the
// scans left.

import crypto from 'node:crypto';

import { scan, up } from './sync.js';

/** What a scan says about the drive, as one string: a hash of every file's
 *  path, size and mtime when the scan lists them, else its counts. */
export function signature(seen) {
  if (!seen.byPath) return `${seen.newest}|${seen.files}|${seen.documents}`;
  const hash = crypto.createHash('sha1');
  for (const rel of Object.keys(seen.byPath).sort()) {
    const [size, mtime] = seen.byPath[rel];
    hash.update(`${rel}\0${size}\0${mtime}\n`);
  }
  return hash.digest('hex');
}

export function scheduleUploads({
  root,
  settings,
  client,
  upload = up,
  scanImpl = scan,
  everyMs = 60_000,
  watchMs = 15_000,
  giveUpMs = 30 * 60_000,
  now = Date.now,
  onLost,
  log = console.log,
  schedule = setInterval,
}) {
  let last = null; // the signature at the last successful upload
  let seen = null; // the newest scan's signature, by either timer
  let scans = 0; // numbers each scan, so a slow one never overwrites a newer
  let seenNo = 0;
  let touches = 0; // write requests so far
  let covered = 0; // the touches an upload that started after them has carried
  let failingSince = null; // the first unsuccessful attempt of this dirty stretch
  let running = false;
  let uploading = false;
  let refreshing = false;
  const look = async () => {
    const no = ++scans;
    const sig = signature(await scanImpl(root));
    if (no > seenNo) {
      // A new change re-arms a sprite that gave up waiting.
      if (seen !== null && sig !== seen) failingSince = null;
      seen = sig;
      seenNo = no;
    }
    return sig;
  };
  const failed = () => {
    if (failingSince === null) failingSince = now();
  };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      let lease;
      try {
        lease = await client.get();
      } catch (err) {
        failed();
        log(`[hub] upload waits: the lease is unreachable (${err.message})`);
        return;
      }
      if (lease.home !== settings.HUB_MACHINE) {
        log(`[hub] the lease moved to ${lease.home} (epoch ${lease.epoch}); this host stops`);
        onLost(lease);
        return;
      }
      const carries = touches;
      const sig = await look();
      if (last !== null && sig === last) {
        // Nothing to upload. The scan came after every touch counted in
        // `carries`, so it saw whatever those requests wrote: they are
        // covered. A POST that writes nothing (presence, intent) costs no
        // upload.
        covered = Math.max(covered, carries);
        return;
      }
      const started = Date.now();
      uploading = true;
      let result;
      try {
        result = await upload({ root, settings, epoch: lease.epoch });
      } finally {
        uploading = false;
      }
      if (result.ok) {
        last = sig;
        covered = Math.max(covered, carries);
        failingSince = null;
        const moved = result.changed === undefined ? '' : ` ${result.changed} changed, ${result.deleted} deleted,`;
        const full = result.full ? ` (full sync: ${result.full})` : '';
        log(`[hub] uploaded seq ${result.state.seq}: ${result.counts.files} files,${moved} in ${Date.now() - started}ms${full}`);
      } else {
        failed();
        log(`[hub] upload refused: ${result.why}`);
      }
    } catch (err) {
      failed();
      log(`[hub] upload failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      await look();
    } catch {
      // the next tick scans again, and says what went wrong
    } finally {
      refreshing = false;
    }
  };
  const dirty = () => uploading || touches > covered || (seen !== null && seen !== last);
  const wantsAwake = () => dirty() && (failingSince === null || now() - failingSince < giveUpMs);
  const timer = schedule ? schedule(tick, everyMs) : null;
  timer?.unref?.();
  const watch = schedule ? schedule(refresh, watchMs) : null;
  watch?.unref?.();
  if (watch) refresh();
  return {
    tick,
    refresh,
    dirty,
    wantsAwake,
    /** A write request came in: dirty until a tick started after it finds
     *  nothing new, or its upload succeeds. */
    touch() {
      touches += 1;
      failingSince = null;
    },
    stop: () => {
      if (timer) clearInterval(timer);
      if (watch) clearInterval(watch);
    },
  };
}

/** Calls onWrite for every request that may write the drive (anything but
 *  GET and HEAD, and not a tab's "still here", which writes nothing): once
 *  when it arrives, so the sprite is held before its connection closes, and
 *  once when its response closes. The request event comes with the headers,
 *  before the handler has written anything, so an upload starting in between
 *  would carry the first touch without the write; the second post-dates the
 *  write, and so the start of any upload that missed it. 'close' fires after
 *  'finish', and also when the client gave up before the response. */
export function touchOnWrites(server, onWrite) {
  server.on('request', (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    if (req.url.split('?')[0] === '/tab/alive') return;
    onWrite();
    res.once('close', onWrite);
  });
}
