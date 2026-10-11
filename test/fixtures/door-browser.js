// A browser, as far as the door can tell: it keeps cookies per host the way
// `__Host-` cookies are kept (this host only), sends what it holds, and follows
// nothing on its own, so a test can look at every redirect.
import { route } from '../../worker/src/router.js';

export function browser(env, { fetchImpl, now = () => Date.now(), ip = '198.51.100.7', userAgent = 'Test/1.0' } = {}) {
  const jars = new Map(); // host -> Map(name -> value)
  const jar = (host) => {
    if (!jars.has(host)) jars.set(host, new Map());
    return jars.get(host);
  };
  function keep(host, res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';');
      const at = pair.indexOf('=');
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
      if (maxAge && Number(maxAge.split('=')[1]) <= 0) jar(host).delete(name);
      else jar(host).set(name, value);
    }
  }
  async function go(href, { method = 'GET', headers = {}, body, origin } = {}) {
    const url = new URL(href, 'https://marbledrive.app');
    const cookie = [...jar(url.hostname)].map(([k, v]) => `${k}=${v}`).join('; ');
    const req = new Request(url, {
      method,
      headers: {
        accept: 'text/html',
        'user-agent': userAgent,
        'cf-connecting-ip': ip,
        ...(cookie ? { cookie } : {}),
        ...(origin ? { origin } : {}),
        ...headers,
      },
      body,
    });
    const res = await route(req, env, { fetchImpl, now: now() });
    keep(url.hostname, res);
    return res;
  }
  const form = (href, fields, origin = 'https://marbledrive.app') =>
    go(href, { method: 'POST', origin, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  return { go, form, jar, jars };
}

/** Sign in through the fake provider: start, then the callback. */
export async function signInWith(b, provider, { invite = null, to = null, fake } = {}) {
  const q = new URLSearchParams();
  if (invite) q.set('invite', invite);
  if (to) q.set('to', to);
  const started = await b.go(`/auth/${provider}/start${q.toString() ? `?${q}` : ''}`);
  if (started.status !== 302) return started;
  const at = new URL(started.headers.get('location'));
  if (fake?.setNonce) fake.setNonce(at.searchParams.get('nonce'));
  return b.go(`/auth/${provider}/callback?code=c0de&state=${at.searchParams.get('state')}`);
}
