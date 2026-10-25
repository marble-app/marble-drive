// The front door's admin API as marble-host uses it (docs/ACCOUNTS.md, "The
// admin routes"), with DOOR_ADMIN_TOKEN from host.env: the queue the maker
// drains and the steps it reports, the people the reconcile reads every five
// minutes, the drives' records, the events marble-host reports for the
// sign-up timeline, and the end of a drive.
//
// A refusal is an error with the door's `status` and its `why`, so a caller
// can tell a drive the door has never heard of (404) from one it is ending
// (409) from a door that could not be reached (no status).

export class DoorRefusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createDoor({ url, token, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const on = Boolean(token);
  async function api(method, route, body) {
    if (!on) throw new Error('there is no DOOR_ADMIN_TOKEN in host.env');
    const res = await fetchImpl(new URL(`/_door${route}`, url).href, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const why = await res
        .json()
        .then((b) => (typeof b?.why === 'string' ? b.why.slice(0, 200) : null))
        .catch(() => null);
      throw new DoorRefusal(res.status, `the door answered ${method} ${route} with ${res.status}${why ? ` (${why})` : ''}`);
    }
    return res.json();
  }
  return {
    on,
    api,
    queue: async () => (await api('GET', '/queue?home=pchost')).drives ?? [],
    step: (name, body) => api('POST', `/drives/${name}/step`, body),
    people: async () => (await api('GET', '/people')).people ?? [],
    drives: async () => (await api('GET', '/drives')).drives ?? [],
    /** One of marble-host's reports into the door's log: agent-connected,
     *  first-document, drive-updated or drive-restarted, with a detail of a
     *  few words and numbers. */
    event: (drive, kind, detail = null) => api('POST', '/events', { drive, kind, ...(detail ? { detail } : {}) }),
    /** The door ends a drive: `removing`, so the edge stops serving it, and
     *  every session of its person ends. */
    remove: (name) => api('POST', `/drives/${name}/remove`, { confirm: name }),
  };
}
