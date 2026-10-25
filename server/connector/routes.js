// The connector's doors (server/connector): what Claude and ChatGPT find when
// they are given this drive's address, in the order they knock.
//
//   1. POST /mcp with no token → 401, naming where to read about the drive's
//      sign-in (RFC 9728, /.well-known/oauth-protected-resource).
//   2. GET /.well-known/oauth-authorization-server → where to register, send
//      the owner, and trade codes (RFC 8414).
//   3. POST /oauth/register → a client id (RFC 7591).
//   4. The owner's browser at /oauth/authorize: behind the gate like any page,
//      so it is the passphrase or the Marble Drive sign-in that proves it is
//      the owner. One question, Allow or Don't allow.
//   5. POST /oauth/token → tokens, then refreshed tokens.
//   6. POST /mcp with the token → the tools (server/connector/mcp.js).
//
// Everything but the Allow page sits in front of the gate: those requests come
// from claude.ai's or chatgpt.com's servers, which hold a token, not a cookie.

import { escapeHtml, html, json, readBody, send } from '../http.js';
import { overHttps } from '../gate.js';
import { sameOrigin } from '../sessions.js';
import { appFor, redirectAllowed } from './grants.js';

const SCOPE = 'drive';
const BODY_MAX = 1024 * 1024;
const OPEN_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
};
// Open to any origin by design (OPEN_CORS above) and judged by their own
// tokens, so the host's own-page check on changes (server/app.js) leaves them
// to these routes.
export const PUBLIC = new Set([
  '/mcp',
  '/oauth/register',
  '/oauth/token',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
  '/.well-known/openid-configuration',
]);

const bearer = (req) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim() ?? '';

async function readForm(req) {
  const raw = (await readBody(req, BODY_MAX)).toString('utf8');
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export function createConnectorRoutes({ grants, mcp, publicUrl = null, isOwner, signInAt, log = console }) {
  /** This drive's address as the outside world reaches it. Configured where
   *  it is known (MARBLE_DRIVE_PUBLIC_URL); otherwise the address the request
   *  came in on, believing https only from a proxy on this machine. */
  const originOf = (req) =>
    publicUrl ?? `${overHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host || 'localhost'}`;

  const resourceMeta = (origin) => ({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
    resource_name: 'Marble Drive',
  });

  const serverMeta = (origin) => ({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
  });

  const publicJson = (res, status, body, headers = {}) => json(res, status, body, { ...OPEN_CORS, ...headers });

  async function mcpRoute(req, res, origin) {
    if (req.method !== 'POST') {
      // No stream to hold open, and no session to end: every answer is in
      // the POST that asked.
      return publicJson(res, 405, { error: 'POST JSON-RPC messages to /mcp' }, { Allow: 'POST' });
    }
    const who = await grants.check(bearer(req));
    if (!who) {
      return publicJson(res, 401, { error: 'sign in to this drive first' }, {
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${SCOPE}"`,
      });
    }
    let body;
    try {
      body = JSON.parse((await readBody(req, BODY_MAX)).toString('utf8'));
    } catch {
      return publicJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'that body is not JSON' } });
    }
    const answer = await mcp.handle(body, { origin, client: who.name });
    if (answer === null) return send(res, 202, '', OPEN_CORS);
    return publicJson(res, 200, answer);
  }

  async function tokenRoute(req, res) {
    if (req.method !== 'POST') return publicJson(res, 405, { error: 'invalid_request' });
    const form = await readForm(req);
    const refuse = (error, description) => publicJson(res, 400, { error, error_description: description });
    if (form.grant_type === 'authorization_code') {
      const tokens = await grants.exchange({
        code: form.code,
        verifier: form.code_verifier,
        clientId: form.client_id,
        redirect: form.redirect_uri,
      });
      return tokens ? publicJson(res, 200, tokens, { Pragma: 'no-cache' }) : refuse('invalid_grant', 'that code is spent, late, or not for this client');
    }
    if (form.grant_type === 'refresh_token') {
      const tokens = await grants.refresh({ token: form.refresh_token, clientId: form.client_id });
      return tokens ? publicJson(res, 200, tokens, { Pragma: 'no-cache' }) : refuse('invalid_grant', 'that refresh token is spent or was turned off');
    }
    return refuse('unsupported_grant_type', 'authorization_code or refresh_token');
  }

  async function registerRoute(req, res) {
    if (req.method !== 'POST') return publicJson(res, 405, { error: 'invalid_request' });
    try {
      const client = await grants.register(await readForm(req));
      return publicJson(res, 201, {
        client_id: client.id,
        client_id_issued_at: Math.floor(client.made / 1000),
        client_name: client.name,
        redirect_uris: client.redirects,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
    } catch (err) {
      if (err.code) return publicJson(res, 400, { error: err.code, error_description: err.message });
      throw err;
    }
  }

  /** The one page: may this app use the drive? */
  function askPage(res, { client, params }) {
    const name = escapeHtml(client.name);
    const app = appFor(params.redirect_uri);
    // Whose hands the drive ends up in, said before the button: the account
    // that pressed Connect, wherever that was.
    const whose = app.local
      ? `<p>Only press Allow if you started this on this computer just now. The app answers at ${escapeHtml(app.host)}, on this machine.</p>`
      : `<p>Only press Allow if you pressed Connect in ${name} just now. Your drive will be linked to the ${name} account signed in there (${escapeHtml(app.host)}), and anyone using that account can use it.</p>`;
    const fields = Object.entries(params)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join('');
    return html(res, 200, `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Let ${name} use your drive?</title>
<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:0 24px;background:#fafaf7;color:#111111}
main{max-width:26rem}h1{font-size:1.25rem;font-weight:600;margin:0 0 .75rem}p,li{color:#5a5a5a}ul{padding-left:1.1rem;margin:.5rem 0 1.25rem}
form{display:flex;gap:.5rem}button{font:inherit;padding:.6rem .9rem;border:1px solid #ddd9cf;border-radius:8px;background:transparent;color:#111111;cursor:pointer}
button[value=allow]{background:#738698;color:#fafaf7;border-color:#738698}
@media (prefers-color-scheme: dark){body{background:#161616;color:#ededed}p,li{color:#a3a3a3}button{color:#ededed;border-color:#3a3a3a}button[value=allow]{color:#161616;background:#9db0c2;border-color:#9db0c2}}</style>
<main><h1>Let ${name} use your drive?</h1>
<p>${name} will be able to:</p>
<ul><li>read every document and app in this drive</li>
<li>start, steer and stop agent chats, which run on this computer with the same access as the ones you start in Marble</li>
<li>answer the questions those chats ask</li></ul>
${whose}
<p>You can turn it off again at any time on this drive’s Connected apps page (/connector).</p>
<form method="post" action="/oauth/authorize">${fields}
<button name="decision" value="allow">Allow</button><button name="decision" value="deny">Don’t allow</button></form></main>`, {
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'; form-action 'self' https://claude.ai https://claude.com https://chatgpt.com https://chat.openai.com http://localhost:* http://127.0.0.1:*",
    });
  }

  const backTo = (redirect, query) => {
    const url = new URL(redirect);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    return url.href;
  };

  async function authorizeRoute(req, res, url) {
    if (!isOwner(req)) return send(res, 302, '', { Location: signInAt(req) });
    const params = req.method === 'POST' ? await readForm(req) : Object.fromEntries(url.searchParams);
    const client = await grants.client(params.client_id);
    // A client or redirect this drive does not know is never redirected to:
    // that is how an authorize page becomes an open redirect.
    if (!client || !params.redirect_uri || !client.redirects.includes(params.redirect_uri) || !redirectAllowed(params.redirect_uri)) {
      return html(res, 400, '<!doctype html><meta charset="utf-8"><p>This sign-in link is not for an app this drive knows. Start again from the app.</p>');
    }
    const fail = (error) => send(res, 302, '', { Location: backTo(params.redirect_uri, { error, state: params.state }) });
    if (params.response_type !== 'code') return fail('unsupported_response_type');
    if (!params.code_challenge || params.code_challenge_method !== 'S256') return fail('invalid_request');

    if (req.method === 'GET') {
      const kept = {
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        response_type: 'code',
        code_challenge: params.code_challenge,
        code_challenge_method: 'S256',
        ...(params.state ? { state: params.state } : {}),
        ...(params.scope ? { scope: params.scope } : {}),
      };
      return askPage(res, { client, params: kept });
    }
    if (req.method !== 'POST' || !sameOrigin(req)) return html(res, 403, '<!doctype html><meta charset="utf-8"><p>That answer did not come from this drive’s page.</p>');
    if (params.decision !== 'allow') return fail('access_denied');
    const code = grants.issueCode({
      clientId: client.id,
      redirect: params.redirect_uri,
      challenge: params.code_challenge,
      scope: SCOPE,
    });
    log.info?.(`[connector] ${client.name} let in`);
    return send(res, 302, '', { Location: backTo(params.redirect_uri, { code, state: params.state }) });
  }

  /** Connected apps: who was let in, when they last came, and a way to
   *  turn each off. The address to give Claude or ChatGPT is on it too. */
  function appsPage(res, list, origin) {
    const when = (t) => (t ? new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet');
    const rows = list.length
      ? list.map((g) => `<li data-id="${escapeHtml(g.id)}"><span><b>${escapeHtml(g.name)}</b><br><small>Let in ${escapeHtml(when(g.made))} · last used ${escapeHtml(when(g.used))}</small></span><button>Turn off</button></li>`).join('')
      : '<li><span>No apps yet. Add the address above as a connector in Claude or ChatGPT, then press Allow when this drive asks.</span></li>';
    return html(res, 200, `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected apps</title>
<style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:48px 24px;background:#fafaf7;color:#111111}
main{max-width:34rem;margin:0 auto}h1{font-size:1.25rem;font-weight:600;margin:0 0 .5rem}p,small{color:#5a5a5a}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:#efede6;padding:.15rem .4rem;border-radius:6px;user-select:all}
ul{list-style:none;padding:0;margin:1.5rem 0 0;border-top:1px solid #ddd9cf}li{display:flex;gap:1rem;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:1px solid #ddd9cf}
button{font:inherit;padding:.4rem .75rem;border:1px solid #ddd9cf;border-radius:8px;background:transparent;color:#111111;cursor:pointer}
@media (prefers-color-scheme: dark){body{background:#161616;color:#ededed}p,small{color:#a3a3a3}code{background:#242424}ul,li{border-color:#3a3a3a}button{color:#ededed;border-color:#3a3a3a}}</style>
<main><h1>Connected apps</h1>
<p>Apps you let into this drive from Claude, ChatGPT or another MCP client. To add one, give it this address:</p>
<p><code>${escapeHtml(origin)}/mcp</code></p>
<ul>${rows}</ul></main>
<script>for(const b of document.querySelectorAll('li[data-id] button'))b.addEventListener('click',async()=>{const li=b.closest('li');b.disabled=true;const r=await fetch('/connector/grants/'+encodeURIComponent(li.dataset.id),{method:'DELETE'});if(r.ok)li.remove();else b.disabled=false})</script>`, { 'X-Frame-Options': 'DENY' });
  }

  /** The routes that come before the gate. True when this was one of them. */
  async function handlePublic(req, res, url) {
    const route = url.pathname;
    if (!PUBLIC.has(route)) return false;
    if (req.method === 'OPTIONS') {
      send(res, 204, '', { ...OPEN_CORS, 'Access-Control-Max-Age': '86400' });
      return true;
    }
    const origin = originOf(req);
    if (route === '/mcp') await mcpRoute(req, res, origin);
    else if (route === '/oauth/token') await tokenRoute(req, res);
    else if (route === '/oauth/register') await registerRoute(req, res);
    else if (route.startsWith('/.well-known/oauth-protected-resource')) publicJson(res, 200, resourceMeta(origin));
    else publicJson(res, 200, serverMeta(origin));
    return true;
  }

  /** The owner's routes, behind the gate: the Allow page, and the list of
   *  apps let in, each of which can be turned off. */
  async function handleOwner(req, res, url) {
    const route = url.pathname;
    if (route === '/oauth/authorize') {
      await authorizeRoute(req, res, url);
      return true;
    }
    if (route === '/connector' && req.method === 'GET') {
      appsPage(res, await grants.list(), originOf(req));
      return true;
    }
    if (route === '/connector/grants' && req.method === 'GET') {
      json(res, 200, { grants: await grants.list() });
      return true;
    }
    const off = /^\/connector\/grants\/([A-Za-z0-9_-]+)$/.exec(route);
    if (off && req.method === 'DELETE') {
      if (!sameOrigin(req)) json(res, 403, { error: 'not from this drive' });
      else json(res, 200, { removed: await grants.revoke(off[1]) });
      return true;
    }
    return false;
  }

  return { handlePublic, handleOwner };
}
