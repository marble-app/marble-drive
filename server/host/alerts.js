// The owner's phone hears about the few things that need him: a drive that
// failed its checks twice, memory or disk past the line, a release rolled
// back. Sent to a push service such as ntfy (HOST_NTFY_URL, a private topic's
// URL); without it, nothing is sent and the events say the same.
//
// `once` alerts are kept to one an hour per drive and kind, so a drive that
// keeps falling over sends a note, not a stream of them.

export function createAlerts({ url = null, fetchImpl = fetch, log = console, now = Date.now, everyMs = 60 * 60 * 1000 } = {}) {
  const last = new Map();
  return {
    on: Boolean(url),
    /** Resolves with whether a note went; never throws. */
    async send({ drive = null, kind, message, once = true }) {
      const key = `${drive ?? '*'}:${kind}`;
      if (once && last.has(key) && now() - last.get(key) < everyMs) return false;
      last.set(key, now());
      if (!url) return false;
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { title: `marble-host: ${kind}${drive ? ` (${drive})` : ''}`, tags: 'warning', 'content-type': 'text/plain; charset=utf-8' },
          body: message,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) log.error?.(`[host] the alert about ${key} was refused (${res.status})`);
        return res.ok;
      } catch (err) {
        log.error?.(`[host] the alert about ${key} did not go: ${err.message}`);
        return false;
      }
    },
  };
}
