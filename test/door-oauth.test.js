// test/door-oauth.test.js
// Sign in with Google or GitHub (worker/src/door/oauth.js), against fakes of
// both: the redirect carries what it must, the callback checks the state, the
// ID token's claims and a verified email, and nothing secret is echoed back.
import assert from 'node:assert/strict';
import test from 'node:test';

import { DoorError, finish, start } from '../worker/src/door/oauth.js';
import { b64urlEncode } from '../worker/src/door/tokens.js';
import { doorEnv, fakeProviders } from './fixtures/door-env.js';

const NOW = Date.now();

async function begin(provider, env, { invite = null, to = null } = {}) {
  const res = await start(provider, { env, invite, to, now: NOW });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  const setCookie = res.headers.get('set-cookie');
  return { location, setCookie, cookie: setCookie.split(';')[0], state: location.searchParams.get('state'), nonce: location.searchParams.get('nonce') };
}

const callback = (provider, { state, cookie, code = 'the-code', extra = '' }) =>
  new Request(`https://marbledrive.app/auth/${provider}/callback?code=${code}&state=${state}${extra}`, { headers: cookie ? { cookie } : {} });

async function refusal(promise) {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof DoorError, err.stack);
    return err;
  }
  assert.fail('expected a refusal');
}

test('the redirect to Google carries the client, the callback, the scopes, state, an S256 challenge and a nonce', async () => {
  const env = doorEnv();
  const { location, setCookie } = await begin('google', env, { invite: 'f'.repeat(32) });
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = location.searchParams;
  assert.equal(q.get('client_id'), env.GOOGLE_CLIENT_ID);
  assert.equal(q.get('redirect_uri'), 'https://marbledrive.app/auth/google/callback');
  assert.equal(q.get('scope'), 'openid email profile');
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.match(q.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(q.get('state'), /^[0-9a-f]{32}$/);
  assert.match(q.get('nonce'), /^[0-9a-f]{32}$/);
  assert.match(setCookie, /^__Host-md_oauth=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
  assert.ok(!setCookie.includes('f'.repeat(32)), 'the invite is not readable in the cookie as written');
});

test('the redirect to GitHub carries its scopes and a challenge, and no nonce', async () => {
  const env = doorEnv();
  const { location } = await begin('github', env);
  assert.equal(location.origin + location.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(location.searchParams.get('scope'), 'read:user user:email');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://marbledrive.app/auth/github/callback');
  assert.equal(location.searchParams.get('nonce'), null);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
});

test('Google: the right state gives the identity, with the invite and the way back carried through', async () => {
  const env = doorEnv();
  const flow = await begin('google', env, { invite: 'a'.repeat(32), to: '/enter?drive=ana&to=%2F' });
  const { fetchImpl, calls } = fakeProviders({ google: { nonce: flow.nonce } });
  const who = await finish('google', callback('google', flow), { env, fetchImpl, now: NOW });
  assert.deepEqual(who, { provider: 'google', subject: '1100000000000001', email: 'ana@example.com', name: 'Ana', invite: 'a'.repeat(32), to: '/enter?drive=ana&to=%2F' });
  assert.ok(!JSON.stringify(who).includes('ya29'), 'no access token in the result');
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('code'), 'the-code');
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.match(form.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(form.get('redirect_uri'), 'https://marbledrive.app/auth/google/callback');
});

test('GitHub: the numeric id and the primary verified email', async () => {
  const env = doorEnv();
  const flow = await begin('github', env);
  const { fetchImpl, calls } = fakeProviders({ github: { emails: [{ email: 'old@example.com', primary: false, verified: true }, { email: 'ana@example.com', primary: true, verified: true }] } });
  const who = await finish('github', callback('github', flow), { env, fetchImpl, now: NOW });
  assert.equal(who.subject, '4242');
  assert.equal(who.email, 'ana@example.com');
  assert.ok(!JSON.stringify(who).includes('gho_'), 'no access token in the result');
  const api = calls.find((c) => c.url === 'https://api.github.com/user');
  assert.equal(api.headers.get('authorization'), 'Bearer gho_github-access-token');
  assert.ok(api.headers.get('user-agent'));
});

test('a missing, wrong or stale state is refused in words that echo nothing', async () => {
  const env = doorEnv();
  const flow = await begin('google', env);
  const { fetchImpl } = fakeProviders({ google: { nonce: flow.nonce } });
  const cases = [
    callback('google', { ...flow, cookie: null }),
    callback('google', { ...flow, state: 'b'.repeat(32) }),
    callback('google', { ...flow, state: '' }),
    callback('github', flow),
  ];
  for (const req of cases) {
    const provider = new URL(req.url).pathname.split('/')[2];
    const err = await refusal(finish(provider, req, { env, fetchImpl, now: NOW }));
    assert.match(err.message, /Start again/);
    assert.ok(!err.message.includes('the-code'));
  }
  const late = await refusal(finish('google', callback('google', flow), { env, fetchImpl, now: NOW + 601_000 }));
  assert.match(late.message, /took too long/);
  // A changed character inside the MAC (the last one only carries padding bits).
  const at = flow.cookie.lastIndexOf('.') + 5;
  const forged = flow.cookie.slice(0, at) + (flow.cookie[at] === 'A' ? 'B' : 'A') + flow.cookie.slice(at + 1);
  await refusal(finish('google', callback('google', { ...flow, cookie: forged }), { env, fetchImpl, now: NOW }));
});

test("Google: a token for another app, a stale exp, a wrong nonce or an unverified email are refused", async () => {
  const env = doorEnv();
  const cases = [
    [(flow) => ({ aud: 'someone-else', nonce: flow.nonce }), /another app/],
    [(flow) => ({ exp: Math.floor(NOW / 1000) - 10, nonce: flow.nonce }), /Start again/],
    [() => ({ nonce: 'c'.repeat(32) }), /Start again/],
    [(flow) => ({ email_verified: false, nonce: flow.nonce }), /hasn’t confirmed this email/],
    [(flow) => ({ claims: { iss: 'https://evil.example' }, nonce: flow.nonce }), /another app/],
  ];
  for (const [google, why] of cases) {
    const flow = await begin('google', env);
    const { fetchImpl } = fakeProviders({ google: google(flow) });
    const err = await refusal(finish('google', callback('google', flow), { env, fetchImpl, now: NOW }));
    assert.match(err.message, why);
  }
});

test('GitHub with no verified email, and a provider that refuses the code', async () => {
  const env = doorEnv();
  let flow = await begin('github', env);
  let fake = fakeProviders({ github: { emails: [{ email: 'ana@example.com', primary: true, verified: false }] } });
  let err = await refusal(finish('github', callback('github', flow), { env, fetchImpl: fake.fetchImpl, now: NOW }));
  assert.equal(err.message, 'Your GitHub account has no verified email address. Verify one on GitHub, then sign in again.');
  flow = await begin('github', env);
  fake = fakeProviders({ github: { fail: true } });
  err = await refusal(finish('github', callback('github', flow), { env, fetchImpl: fake.fetchImpl, now: NOW }));
  assert.match(err.message, /GitHub didn’t accept/);
  flow = await begin('google', env);
  fake = fakeProviders({ google: { fail: true } });
  err = await refusal(finish('google', callback('google', flow), { env, fetchImpl: fake.fetchImpl, now: NOW }));
  assert.match(err.message, /Google didn’t accept/);
});

test('a person who cancels at the provider is told so', async () => {
  const env = doorEnv();
  const flow = await begin('google', env);
  const err = await refusal(finish('google', callback('google', { ...flow, extra: '&error=access_denied' }), { env, fetchImpl: fakeProviders().fetchImpl, now: NOW }));
  assert.match(err.message, /cancelled/);
});

test('a provider with no client set up is not offered', async () => {
  const env = doorEnv({ GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' });
  const err = await refusal(start('github', { env, now: NOW }));
  assert.match(err.message, /isn't set up yet/);
  assert.equal(b64urlEncode(new Uint8Array([1])), 'AQ');
});
