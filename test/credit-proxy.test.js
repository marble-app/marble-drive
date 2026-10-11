// worker/src/credit.js: starter credit's proxy at marbledrive.app/_credit,
// through the router as the Worker runs it, over a Directory in memory and a
// fake Anthropic.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { costMicros, priceOf, readUsage, USED_UP } from '../worker/src/credit.js';
import { forgetLeases, route } from '../worker/src/router.js';
import { doorEnv } from './fixtures/door-env.js';

beforeEach(() => forgetLeases());

const KEY = 'sk-ant-owner-key-for-tests';

/** SSE, the way Anthropic streams a message: start, deltas, then the counts. */
function sse(model, { input = 1000, output = 500, cacheRead = 0, cacheWrite = 0 } = {}) {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', model, usage: { input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: output } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

/** A body that arrives in small pieces, split mid-line, as a network gives it. */
function trickle(text, size = 37) {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

function world(vars = {}) {
  const env = doorEnv({ CREDIT_ANTHROPIC_KEY: KEY, ...vars });
  const upstream = [];
  let answer = () => new Response(trickle(sse('claude-sonnet-5')), { status: 200, headers: { 'content-type': 'text/event-stream', 'anthropic-organization-id': 'org-secret' } });
  const fetchImpl = async (input, init = {}) => {
    const body = init.body ? await new Response(init.body).text() : null;
    upstream.push({ url: String(input), method: init.method, headers: new Headers(init.headers), body });
    return answer({ url: String(input), body });
  };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const call = (path, init = {}) => route(new Request(`https://marbledrive.app${path}`, init), env, { fetchImpl, ctx });
  const admin = async (method, path, body) => {
    const res = await call(`/_credit/admin${path}`, { method, headers: { authorization: `Bearer ${env.DOOR_ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  const ask = (token, body = { model: 'claude-sonnet-5', max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hi' }] }, { path = '/_credit/v1/messages?beta=true', auth = 'x-api-key' } = {}) =>
    call(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219',
        cookie: 'something=private',
        ...(auth === 'x-api-key' ? { 'x-api-key': token } : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });
  const settle = async () => {
    await Promise.all(waits.splice(0));
  };
  return { env, upstream, ctx, call, admin, ask, settle, answer: (fn) => { answer = fn; } };
}

test('without CREDIT_ANTHROPIC_KEY every /_credit path is a 404, and Anthropic is never asked', async () => {
  const w = world({ CREDIT_ANTHROPIC_KEY: '' });
  for (const path of ['/_credit/v1/messages', '/_credit/balance', '/_credit/admin/drives']) {
    const res = await w.call(path, { method: path.endsWith('messages') ? 'POST' : 'GET', headers: { 'x-api-key': `mdc_${'a'.repeat(48)}`, authorization: `Bearer ${w.env.DOOR_ADMIN_TOKEN}` } });
    assert.equal(res.status, 404, path);
  }
  assert.equal(w.upstream.length, 0);
});

test('credit works with the door off: a drive made by hand can use it', async () => {
  const w = world({ DOOR_SIGNING_KEY: '' });
  const minted = await w.admin('POST', '/drives/t-ana/token', { cap: 5, by: 'Bryan' });
  assert.equal(minted.status, 200);
  const res = await w.ask(minted.data.token);
  assert.equal(res.status, 200);
  await res.text();
  // The apex is still the placeholder.
  assert.match(await (await w.call('/')).text(), /Coming soon/);
});

test('a token that is unknown, malformed or missing is refused before Anthropic is asked', async () => {
  const w = world();
  for (const token of ['', 'sk-ant-api03-not-ours', `mdc_${'b'.repeat(48)}`]) {
    const res = await w.ask(token);
    assert.equal(res.status, 401, token);
    const body = await res.json();
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, 'authentication_error');
  }
  assert.equal(w.upstream.length, 0);
});

test('a request goes on with the owner key, never the drive token, and streams back untouched', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', {})).data;
  const res = await w.ask(token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(res.headers.get('anthropic-organization-id'), null, 'the owner org id stays here');
  assert.equal(await res.text(), sse('claude-sonnet-5'), 'byte for byte');

  const sent = w.upstream[0];
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages?beta=true');
  assert.equal(sent.headers.get('x-api-key'), KEY);
  assert.equal(sent.headers.get('authorization'), null);
  assert.equal(sent.headers.get('cookie'), null);
  assert.equal(sent.headers.get('anthropic-version'), '2023-06-01');
  assert.equal(sent.headers.get('anthropic-beta'), 'claude-code-20250219');
  assert.equal(JSON.parse(sent.body).model, 'claude-sonnet-5');
  assert.ok(!sent.body.includes(token));
});

test('the token is also taken as a bearer, the way ANTHROPIC_AUTH_TOKEN sends it', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', {})).data;
  const res = await w.ask(token, undefined, { auth: 'bearer' });
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(w.upstream[0].headers.get('x-api-key'), KEY);
});

test('a streamed answer is priced from its usage and added to the drive once it is over', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', {})).data;
  // Sonnet 5: 1000 in at $2/M, 500 out at $10/M, 2000 read at $0.20/M, 400 written at 1.25 x $2/M.
  w.answer(() => new Response(trickle(sse('claude-sonnet-5-20261001', { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 400 }), 11), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  const res = await w.ask(token);
  await res.text();
  await w.settle();
  const after = (await w.admin('GET', '/drives/ana')).data;
  const want = 1000 * 2 + 500 * 10 + 2000 * 0.2 + 400 * 2 * 1.25;
  assert.equal(Math.round(after.spent * 1e6), want);
  assert.equal(after.requests, 1);
  assert.ok(after.last);
});

test('a drive that stops reading still pays for what Anthropic sent', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', {})).data;
  const res = await w.ask(token);
  await res.body.cancel();
  await w.settle();
  assert.ok((await w.admin('GET', '/drives/ana')).data.spent > 0);
});

test('a plain JSON answer is counted too; count_tokens and models are free', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', {})).data;
  w.answer(({ url }) => (url.includes('count_tokens')
    ? new Response(JSON.stringify({ input_tokens: 99 }), { status: 200, headers: { 'content-type': 'application/json' } })
    : url.includes('/v1/models')
      ? new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ id: 'msg', model: 'claude-haiku-4-5', usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } })));
  await (await w.ask(token, { model: 'claude-haiku-4-5', max_tokens: 10, messages: [] })).text();
  await (await w.ask(token, { model: 'claude-haiku-4-5', messages: [] }, { path: '/_credit/v1/messages/count_tokens?beta=true' })).text();
  const models = await w.call('/_credit/v1/models', { headers: { 'x-api-key': token } });
  assert.equal(models.status, 200);
  await w.settle();
  const after = (await w.admin('GET', '/drives/ana')).data;
  assert.equal(Math.round(after.spent * 1e6), 100 * 1 + 10 * 5);
  assert.equal(after.requests, 1);
});

test('only the paths Claude Code needs go through: batches and files do not', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', {})).data;
  for (const path of ['/_credit/v1/messages/batches', '/_credit/v1/files', '/_credit/v1/complete', '/_credit/api/oauth/profile']) {
    const res = await w.call(path, { method: 'POST', headers: { 'x-api-key': token } });
    assert.equal(res.status, 404, path);
  }
  assert.equal(w.upstream.length, 0);
});

test('at its cap a drive is refused with an error it can recognise, and Anthropic is not asked', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', { cap: 0.01 })).data;
  // Opus 5.5: 1000 out at $20/M is 2 cents, past the 1 cent cap.
  w.answer(() => new Response(trickle(sse('claude-opus-5-5', { input: 10, output: 1000 })), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  await (await w.ask(token)).text();
  await w.settle();
  const before = w.upstream.length;
  const res = await w.ask(token);
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.deepEqual(body, { type: 'error', error: { type: 'billing_error', message: USED_UP } });
  assert.match(USED_UP, /Starter credit used up/);
  assert.equal(w.upstream.length, before);
  // Counting tokens is free, so it still works at the cap.
  assert.equal((await w.ask(token, { messages: [] }, { path: '/_credit/v1/messages/count_tokens' })).status, 200);

  const log = (await w.call('/_door/log', { headers: { authorization: `Bearer ${w.env.DOOR_ADMIN_TOKEN}` } }).then((r) => r.json())).lines;
  assert.ok(log.some((l) => l.kind === 'credit-used-up' && l.detail.drive === 'ana'));
});

test('raising the cap lets a drive go on; an error from Anthropic costs nothing', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', { cap: 0 })).data;
  assert.equal((await w.ask(token)).status, 402);
  assert.equal((await w.admin('POST', '/drives/ana', { cap: 2 })).data.credit.cap, 2);
  w.answer(() => new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), { status: 529, headers: { 'content-type': 'application/json' } }));
  const res = await w.ask(token);
  assert.equal(res.status, 529, 'passed back as it came');
  await res.text();
  await w.settle();
  assert.equal((await w.admin('GET', '/drives/ana')).data.spent, 0);
});

test('a drive reads its own cap and spend with its token, and nothing else', async () => {
  const w = world();
  const { token } = (await w.admin('POST', '/drives/ana/token', { cap: 5, by: 'Bryan' })).data;
  await (await w.ask(token)).text();
  await w.settle();
  const res = await w.call('/_credit/balance', { headers: { 'x-api-key': token } });
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.deepEqual(Object.keys(b).sort(), ['by', 'cap', 'left', 'spent']);
  assert.equal(b.cap, 5);
  assert.equal(b.by, 'Bryan');
  assert.ok(b.spent > 0 && b.left < 5);
  assert.equal((await w.call('/_credit/balance', { headers: { 'x-api-key': `mdc_${'c'.repeat(48)}` } })).status, 401);
});

test('minting again replaces the token and keeps what was spent; revoking stops it', async () => {
  const w = world();
  const first = (await w.admin('POST', '/drives/ana/token', {})).data.token;
  await (await w.ask(first)).text();
  await w.settle();
  const spent = (await w.admin('GET', '/drives/ana')).data.spent;
  const second = (await w.admin('POST', '/drives/ana/token', {})).data.token;
  assert.notEqual(first, second);
  assert.equal((await w.ask(first)).status, 401, 'the old token is dead');
  assert.equal((await w.admin('GET', '/drives/ana')).data.spent, spent);
  await (await w.ask(second)).text();
  assert.equal((await w.admin('DELETE', '/drives/ana/token')).status, 200);
  assert.equal((await w.ask(second)).status, 401);
});

test('the admin routes want the admin token', async () => {
  const w = world();
  const res = await w.call('/_credit/admin/drives', { headers: { authorization: 'Bearer wrong' } });
  assert.equal(res.status, 401);
  const list = await w.admin('GET', '/drives');
  assert.deepEqual(list.data, { drives: [] });
});

test('prices: by model family, cache writes and reads, fast mode and web search; unknown is the dearest', () => {
  assert.equal(priceOf('claude-opus-5-5').input, 4);
  assert.equal(priceOf('claude-opus-5-5[1m]').output, 20);
  assert.equal(priceOf('claude-opus-5').input, 5);
  assert.equal(priceOf('claude-opus-4-1-20250805').input, 15);
  assert.equal(priceOf('claude-sonnet-5').input, 2);
  assert.equal(priceOf('claude-sonnet-4-6').input, 3);
  assert.equal(priceOf('claude-haiku-4-5-20251001').output, 5);
  assert.equal(priceOf('claude-fable-5-1').cacheRead, 0.25);
  assert.equal(priceOf('claude-fable-5').cacheRead, 1);
  assert.equal(priceOf('something-new').input, 15);
  assert.equal(costMicros('claude-haiku-4-5', { input_tokens: 1_000_000 }), 1_000_000, 'a million Haiku tokens is a dollar');
  assert.equal(costMicros('claude-sonnet-5', { cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 400 } }), Math.ceil(600 * 2 * 1.25 + 400 * 2 * 2));
  assert.equal(costMicros('claude-opus-5-5', { output_tokens: 100, speed: 'fast' }), 100 * 20 * 2);
  assert.equal(costMicros('claude-sonnet-5', { server_tool_use: { web_search_requests: 3 } }), 30_000);
  assert.equal(costMicros('claude-sonnet-5', { input_tokens: null, output_tokens: -4 }), 0);
});

test('usage is read from SSE split anywhere, with the delta counts as running totals', async () => {
  const text = sse('claude-opus-5-5', { input: 7, output: 321, cacheRead: 5 });
  for (const size of [1, 3, 64, 4096]) {
    const read = await readUsage(trickle(text, size), 'text/event-stream; charset=utf-8');
    assert.equal(read.model, 'claude-opus-5-5');
    assert.equal(read.usage.input_tokens, 7);
    assert.equal(read.usage.output_tokens, 321);
    assert.equal(read.usage.cache_read_input_tokens, 5);
  }
  assert.equal(await readUsage(trickle('not json'), 'application/json'), null);
});
