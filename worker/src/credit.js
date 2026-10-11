// worker/src/credit.js
// Starter credit, through a proxy (docs/ACCOUNTS.md, "Starter credit").
//
// A drive on credit runs Claude Code with ANTHROPIC_BASE_URL set to
// https://marbledrive.app/_credit and its own token as the key. Here the
// token is checked against the Directory, the drive's spend against its cap,
// and the request goes on to Anthropic with the owner's key, which never
// leaves this Worker. The answer streams back untouched; a copy of it is read
// on the side for its usage, priced, and added to the drive's total once it
// has finished, so nothing waits on the accounting.
//
//   POST /_credit/v1/messages               the one that costs
//   POST /_credit/v1/messages/count_tokens  free, passed on
//   GET  /_credit/v1/models[/<id>]          free, passed on
//   GET  /_credit/balance                   the drive's own cap and spend, by its token
//   /_credit/admin/drives[/<name>[/token]]  the owner's, behind DOOR_ADMIN_TOKEN
//
// Off unless CREDIT_ANTHROPIC_KEY is set: every path here is then a 404, as
// if it were not there. It does not need the door to be on, so a drive made
// by hand can be on credit too.

import { sameSecret, sha256Hex } from './door/tokens.js';

export const CREDIT_PATH = '/_credit';
export const UPSTREAM = 'https://api.anthropic.com';
/** What Anthropic's error says when a drive is at its cap. The drive looks
 *  for these words (server/agent/providers/claude.js). */
export const USED_UP = 'Starter credit used up. Connect your Claude to keep going.';

// ------------------------------------------------------------------ prices
//
// Dollars per million tokens, first match wins, so a more particular id goes
// above a broader one. Cache writes are 1.25x input for five minutes and 2x
// for an hour; reads are their own column. Anything not matched is priced as
// the dearest row, so a new model can only ever be overcounted.
// From Anthropic's price list as of October 2026.
export const PRICES = [
  { match: /fable-5-1|mythos-5-1/, input: 10, output: 50, cacheRead: 0.25 },
  { match: /fable|mythos/, input: 10, output: 50, cacheRead: 1 },
  { match: /opus-5-5/, input: 4, output: 20, cacheRead: 0.2 },
  { match: /opus-4-[01]\b|opus-4-20|opus-4-1-/, input: 15, output: 75, cacheRead: 1.5 },
  { match: /opus/, input: 5, output: 25, cacheRead: 0.5 },
  { match: /sonnet-5/, input: 2, output: 10, cacheRead: 0.2 },
  { match: /sonnet/, input: 3, output: 15, cacheRead: 0.3 },
  { match: /haiku/, input: 1, output: 5, cacheRead: 0.1 },
];
const DEAREST = { input: 15, output: 75, cacheRead: 1.5 };
/** A web search Claude ran on Anthropic's side: $10 per thousand. */
export const WEB_SEARCH_USD = 0.01;
/** Fast mode is billed at twice the standard rate. */
const FAST = 2;

export const priceOf = (model) => PRICES.find((row) => row.match.test(String(model ?? '')))
  ?? DEAREST;

/** One response's usage in millionths of a dollar (a token at $1 per million
 *  is one). */
export function costMicros(model, usage = {}) {
  const p = priceOf(model);
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const written = n(usage.cache_creation_input_tokens);
  const by = usage.cache_creation ?? {};
  const hour = n(by.ephemeral_1h_input_tokens);
  const fiveMin = by.ephemeral_5m_input_tokens != null ? n(by.ephemeral_5m_input_tokens) : Math.max(0, written - hour);
  let micros =
    n(usage.input_tokens) * p.input +
    n(usage.output_tokens) * p.output +
    fiveMin * p.input * 1.25 +
    hour * p.input * 2 +
    n(usage.cache_read_input_tokens) * p.cacheRead;
  if (usage.speed === 'fast') micros *= FAST;
  micros += n(usage.server_tool_use?.web_search_requests) * WEB_SEARCH_USD * 1_000_000;
  return Math.ceil(micros);
}

// ------------------------------------------------------------------ usage

/** The model and usage in one answer, read from a stream of it: SSE
 *  (message_start, then message_delta, whose counts are running totals) or
 *  one JSON body. Resolves with `{ model, usage }`, or null. */
export async function readUsage(stream, contentType = '') {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const sse = String(contentType).includes('text/event-stream');
  let model = null;
  let usage = null;
  let text = '';
  const merge = (more) => {
    if (!more || typeof more !== 'object') return;
    usage = { ...(usage ?? {}) };
    for (const [k, v] of Object.entries(more)) if (v !== null && v !== undefined) usage[k] = v;
  };
  const line = (raw) => {
    if (!raw.startsWith('data:')) return;
    let event;
    try {
      event = JSON.parse(raw.slice(5).trim());
    } catch {
      return;
    }
    if (event?.type === 'message_start') {
      model = event.message?.model ?? model;
      merge(event.message?.usage);
    } else if (event?.type === 'message_delta') {
      merge(event.usage);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (!sse) continue;
      let at;
      while ((at = text.indexOf('\n')) >= 0) {
        line(text.slice(0, at).replace(/\r$/, ''));
        text = text.slice(at + 1);
      }
    }
  } catch {
    // A stream cut short still cost what it had used by then.
  }
  text += decoder.decode();
  if (sse) {
    if (text) line(text.replace(/\r$/, ''));
  } else {
    try {
      const body = JSON.parse(text);
      model = body?.model ?? null;
      merge(body?.usage);
    } catch {
      return null;
    }
  }
  return usage ? { model, usage } : null;
}

// ------------------------------------------------------------------ answers

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
/** An error in Anthropic's own shape, which Claude Code reads and shows. */
const apiError = (status, type, message) => json(status, { type: 'error', error: { type, message } });
const nothing = () => json(404, { type: 'error', error: { type: 'not_found_error', message: 'Not found.' } });

/** Is credit switched on? Only with the owner's key and the Directory. */
export const creditReady = (env) => Boolean(env?.CREDIT_ANTHROPIC_KEY && env?.DIRECTORY);

const PASSED = [
  [/^\/v1\/messages$/, 'POST', true],
  [/^\/v1\/messages\/count_tokens$/, 'POST', false],
  [/^\/v1\/models$/, 'GET', false],
  [/^\/v1\/models\/[A-Za-z0-9._@:-]{1,100}$/, 'GET', false],
];
// What goes on to Anthropic from the drive's request. Not its key, not its
// cookies, not Cloudflare's own headers.
const FORWARD = new Set(['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'user-agent', 'x-app']);

function dir(env) {
  const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName('directory'));
  return async (method, path, payload) => {
    const res = await stub.fetch(new Request(`https://directory${path}`, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    }));
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    return { status: res.status, ok: res.ok, data };
  };
}

/** The drive a request is from, by the token Claude Code sends: `x-api-key`
 *  for ANTHROPIC_API_KEY, a bearer for ANTHROPIC_AUTH_TOKEN. */
async function driveOf(request, d) {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const token = request.headers.get('x-api-key') || bearer;
  if (!/^mdc_[0-9a-f]{48}$/.test(token ?? '')) return null;
  const r = await d('GET', `/credit/token/${await sha256Hex(token)}`);
  return r.ok ? r.data : null;
}

const ADMIN = [
  ['GET', /^\/drives$/, '/credit'],
  ['GET', /^\/drives\/([a-z0-9-]{1,40})$/, (m) => `/credit/${m[1]}`],
  ['POST', /^\/drives\/([a-z0-9-]{1,40})$/, (m) => `/credit/${m[1]}`],
  ['POST', /^\/drives\/([a-z0-9-]{1,40})\/token$/, (m) => `/credit/${m[1]}/token`],
  ['DELETE', /^\/drives\/([a-z0-9-]{1,40})\/token$/, (m) => `/credit/${m[1]}/token`],
];

async function admin(request, env, inner) {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.DOOR_ADMIN_TOKEN || !(await sameSecret(bearer, env.DOOR_ADMIN_TOKEN))) return json(401, { why: 'unauthorised' });
  for (const [method, re, to] of ADMIN) {
    const m = re.exec(inner);
    if (!m || method !== request.method) continue;
    let payload;
    if (method === 'POST') {
      try {
        payload = await request.json();
      } catch {
        payload = {};
      }
    }
    const r = await dir(env)(method, typeof to === 'function' ? to(m) : to, payload ?? (method === 'POST' ? {} : undefined));
    return json(r.status, r.data);
  }
  return json(404, { why: 'no such route' });
}

/** Everything under /_credit. `ctx.waitUntil` keeps the accounting going
 *  after the answer has gone back. */
export async function credit(request, env, { fetchImpl = fetch, ctx = null } = {}) {
  if (!creditReady(env)) return nothing();
  const url = new URL(request.url);
  const inner = url.pathname.slice(CREDIT_PATH.length);
  try {
    if (inner.startsWith('/admin/')) return await admin(request, env, inner.slice('/admin'.length));

    const d = dir(env);
    if (inner === '/balance' && request.method === 'GET') {
      const drive = await driveOf(request, d);
      if (!drive) return apiError(401, 'authentication_error', 'This drive’s credit token is not known.');
      return json(200, { cap: drive.cap, spent: drive.spent, left: drive.left, by: drive.by });
    }

    const passed = PASSED.find(([re]) => re.test(inner));
    if (!passed) return nothing();
    const [, method, costs] = passed;
    if (request.method !== method) return apiError(405, 'invalid_request_error', `Use ${method}.`);

    const drive = await driveOf(request, d);
    if (!drive) return apiError(401, 'authentication_error', 'This drive’s credit token is not known.');
    if (costs && drive.left <= 0) return apiError(402, 'billing_error', USED_UP);

    const headers = new Headers();
    for (const [k, v] of request.headers) if (FORWARD.has(k.toLowerCase()) || k.toLowerCase().startsWith('x-stainless-')) headers.set(k, v);
    headers.set('x-api-key', env.CREDIT_ANTHROPIC_KEY);
    const init = { method, headers, redirect: 'manual' };
    if (method === 'POST') {
      init.body = request.body;
      init.duplex = 'half';
    }
    let res;
    try {
      res = await fetchImpl(`${UPSTREAM}${inner}${url.search}`, init);
    } catch {
      return apiError(529, 'overloaded_error', 'Anthropic could not be reached. Try again in a minute.');
    }

    const out = new Headers(res.headers);
    out.delete('anthropic-organization-id');
    out.set('cache-control', 'no-store');
    if (!costs || !res.ok || !res.body) return new Response(res.body, { status: res.status, headers: out });

    // One copy to the drive as it arrives; the other read on the side.
    const [toDrive, toCount] = res.body.tee();
    const work = (async () => {
      const read = await readUsage(toCount, res.headers.get('content-type') ?? '');
      if (!read) return;
      const micros = costMicros(read.model, read.usage);
      if (micros <= 0) return;
      const r = await d('POST', '/credit/spend', { name: drive.name, micros });
      if (!r.ok) console.log(`credit: could not add ${micros} to ${drive.name}: ${r.status}`);
    })().catch(() => console.log(`credit: counting ${drive.name}'s request failed`));
    if (ctx?.waitUntil) ctx.waitUntil(work);
    return new Response(toDrive, { status: res.status, headers: out });
  } catch {
    console.log(`credit: ${inner} failed`);
    return apiError(500, 'api_error', 'The credit proxy failed. Try again in a minute.');
  }
}
