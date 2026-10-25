// Asking a drive on the PC how it is, over loopback, the way a person's
// browser never does: marble-host's requests carry no forwarded headers, so
// the drive answers them as local (server/gate.js, isLocal).
//
// A drive passes its check, after it is made or moved to a release, when
// within a minute: /health answers naming that release, its first page
// answers below 500 (a sign-in redirect is an answer), and /health/deep shows
// both agent CLIs' versions, so its agent can start.

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createProbe({ fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  async function get(port, route, { bearer = null, accept = 'application/json' } = {}) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}${route}`, {
        redirect: 'manual',
        headers: { accept, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text().catch(() => '');
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {}
      return { status: res.status, body };
    } catch {
      return null;
    }
  }
  return {
    get,
    /** /health's answer, or null when the drive does not give one. */
    async health(port) {
      const r = await get(port, '/health');
      return r?.status === 200 && r.body?.ok ? r.body : null;
    },
    /** /health/deep's answer; the drive's passphrase is the bearer it asks for. */
    async deep(port, secret) {
      const r = await get(port, '/health/deep', { bearer: secret });
      return r?.status === 200 && r.body?.ok ? r.body : null;
    },
    /** The status of the drive's first page, as a browser would ask for it. */
    async page(port) {
      return (await get(port, '/', { accept: 'text/html' }))?.status ?? null;
    },
  };
}

export async function checkDrive({ probe, port, release, secret, deadlineMs = 60_000, everyMs = 1000, now = Date.now, sleep = sleepFor }) {
  const until = now() + deadlineMs;
  let why = 'it did not answer /health';
  for (;;) {
    const health = await probe.health(port);
    if (!health) why = 'it did not answer /health';
    else if (release && health.release !== release) why = `/health says release ${health.release ?? 'none'}, not ${release}`;
    else {
      const page = await probe.page(port);
      if (page === null || page >= 500) why = `its first page answered ${page ?? 'nothing'}`;
      else {
        const deep = await probe.deep(port, secret);
        if (!deep) why = 'it did not answer /health/deep';
        else if (!deep.claude?.version || !deep.codex?.version) why = `/health/deep has ${deep.claude?.version ? '' : 'no Claude Code version'}${!deep.claude?.version && !deep.codex?.version ? ' and ' : ''}${deep.codex?.version ? '' : 'no Codex version'}`;
        else return { ok: true, health, deep };
      }
    }
    if (now() + everyMs > until) return { ok: false, why };
    await sleep(everyMs);
  }
}
