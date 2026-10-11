// Starter credit, as this drive sees it (docs/ACCOUNTS.md, "Starter credit").
//
// A drive the door made has two settings: the credit proxy's address
// (MARBLE_CREDIT_URL) and its own token for it (MARBLE_CREDIT_TOKEN). Claude
// runs on them as claude-credit (providers/claude.js). This reads, with the
// same token, how much of the drive's credit is spent, for Agents settings'
// "On Bryan's starter credit · $3.90 of $5 used" and the chat's note when
// less than a dollar is left. The token never goes to a page.

/** Below this many dollars left, the chat says so once. */
export const LOW_CREDIT_USD = 1;
const KEEP_MS = 30_000;
const TIMEOUT_MS = 5_000;

/** `{ available, read({ fresh }), forget() }`. `read` answers `{ cap, spent,
 *  left, by }` in dollars, or null when the proxy cannot be asked; a reading
 *  is kept for half a minute so every page that opens does not ask again. */
export function createCreditReader({ url = null, token = null, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const base = String(url ?? '').trim().replace(/\/+$/, '');
  const available = Boolean(base && token);
  let kept = null; // { at, value }

  async function read({ fresh = false } = {}) {
    if (!available) return null;
    if (!fresh && kept && now() - kept.at < KEEP_MS) return kept.value;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
    timer.unref?.();
    try {
      const res = await fetchImpl(`${base}/balance`, { headers: { 'x-api-key': token, accept: 'application/json' }, signal: stop.signal });
      if (!res.ok) return kept?.value ?? null;
      const body = await res.json();
      const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const value = { cap: n(body.cap), spent: n(body.spent), left: n(body.left), by: typeof body.by === 'string' && body.by ? body.by : null };
      kept = { at: now(), value };
      return value;
    } catch {
      return kept?.value ?? null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    available,
    read,
    forget: () => {
      kept = null;
    },
  };
}

/** What the page is told: no token, and whether it is used up or low. */
export function creditView(reading, { active = false } = {}) {
  if (!reading) return { available: true, active, known: false };
  return {
    available: true,
    active,
    known: true,
    by: reading.by,
    cap: reading.cap,
    spent: reading.spent,
    left: reading.left,
    usedUp: reading.left <= 0,
    low: reading.left > 0 && reading.left < LOW_CREDIT_USD,
  };
}
