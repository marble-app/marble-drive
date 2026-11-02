// Which live streams this host keeps open.
//
// On a Fly Sprite an open connection is activity, so a tab left open in a
// forgotten window would keep the sprite awake, and billing, forever. Every
// page carries runtime/tab-rest.js, which tags its streams with a tab id and
// reports (POST /tab/alive) while someone is using it. Here, a stream whose tab
// has gone `unusedMs` without a report is closed, and that tab's reconnect is
// answered 204 No Content, which tells EventSource to stop trying. The tab
// reopens its streams by itself once someone uses it again.
//
// A stream with no tab id comes from a page loaded before this rule. It counts
// as unused: closed `unusedMs` after it opened, with a last frame that gives
// EventSource an id to reconnect with, and a reconnect carrying that id gets
// the 204.
//
// Time here is wall time: it measures people, and a sprite with a stream open
// is not frozen.

const RESTED = 'marble-rested';
const TAB = /^[A-Za-z0-9_-]{1,64}$/;
const FORGET_MS = 24 * 60 * 60 * 1000;

export function createStreams({ unusedMs = 15 * 60_000, checkMs = 60_000, now = Date.now, schedule = setInterval } = {}) {
  const lastUse = new Map(); // tab → time it last reported use
  const open = new Set(); // { tab, since, res }

  const tabOf = (url) => {
    const tab = url.searchParams.get('tab');
    return tab && TAB.test(tab) ? tab : null;
  };

  /** Someone is using this tab. */
  function alive(tab) {
    if (typeof tab === 'string' && TAB.test(tab)) lastUse.set(tab, now());
  }

  /** May this stream open? A tab never seen before is being used now; one
   *  that has gone unused is not let back in until it says it is used. */
  // A stream carried over the tab's socket (server/socket.js) may not name
  // its tab; the socket knows it, and is asked each time.
  const tabFor = (stream) => stream.tab ?? stream.inherit?.() ?? null;

  function admit(req, url) {
    if (req.headers?.['last-event-id'] === RESTED) return false;
    const tab = tabOf(url) ?? req.marbleTab?.() ?? null;
    if (!tab) return true;
    const last = lastUse.get(tab);
    if (last === undefined) {
      lastUse.set(tab, now());
      return true;
    }
    return now() - last < unusedMs;
  }

  function track(req, res, url) {
    const stream = { tab: tabOf(url), inherit: typeof req.marbleTab === 'function' ? req.marbleTab : null, since: now(), res };
    open.add(stream);
    res.on('close', () => open.delete(stream));
  }

  function sweep() {
    const t = now();
    for (const stream of [...open]) {
      const tab = tabFor(stream);
      const used = tab ? lastUse.get(tab) ?? stream.since : stream.since;
      if (t - used < unusedMs) continue;
      open.delete(stream);
      try {
        if (!tab) stream.res.write(`id: ${RESTED}\n\n`);
        stream.res.end();
      } catch {
        // Already gone.
      }
    }
    const live = new Set([...open].map(tabFor));
    for (const [tab, last] of lastUse) if (!live.has(tab) && t - last > FORGET_MS) lastUse.delete(tab);
  }

  const timer = schedule ? schedule(sweep, checkMs) : null;
  timer?.unref?.();

  return {
    alive,
    admit,
    track,
    sweep,
    get count() {
      return open.size;
    },
    /** Open tabs someone reported using within the last `ms`. */
    looking(ms) {
      const t = now();
      const tabs = new Set();
      for (const stream of open) {
        const tab = tabFor(stream);
        if (tab && t - (lastUse.get(tab) ?? 0) < ms) tabs.add(tab);
      }
      return tabs.size;
    },
    close() {
      if (timer) clearInterval(timer);
    },
  };
}
