import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-connector-'));
const WORK = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-connector-work-'));
const KEYS = path.join(WORK, 'agent-keys.local');
process.env.MARBLE_DRIVE_ROOT = ROOT;
process.env.MARBLE_APPS = ROOT;
process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';
process.env.MARBLE_DRIVE_AGENT_KEYS = KEYS;

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const quiet = { log() {}, info() {}, warn() {}, error() {} };
const SECRET = 'open sesame';
const SOURCE = `<!doctype html>
<html><head><title>Garden</title></head>
<body data-marble-id="b"><h1 data-marble-id="h">Research Garden</h1></body></html>
`;
const SCRIPTS = {
  hello: [{ say: 'Hello from the drive.' }],
  permission: [{ ask: { tool: 'Bash', input: { command: 'ls' } } }, { say: 'after' }],
  hold: [{ silent: 20_000 }],
};

const config = loadConfig({
  ...process.env,
  MARBLE_DRIVE_SECRET: SECRET,
  MARBLE_DRIVE_CONNECTOR: '1',
  MARBLE_DRIVE_AGENTS: '1',
  MARBLE_DRIVE_AGENT_NAMING: '0',
  MARBLE_DRIVE_AGENT_DRAWING: '0',
  MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
  MARBLE_DRIVE_AGENT_WORKDIR: WORK,
  MARBLE_DRIVE_AGENT_KEYS: KEYS,
});
const drive = await createDrive(config, {
  log: quiet,
  agentProviders: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]),
});
await drive.createDocument('garden', SOURCE);
const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
const base = `http://127.0.0.1:${port}`;
const REDIRECT = 'https://claude.example/api/mcp/auth_callback';

test.after(async () => {
  await drive.close?.();
  drive.server.close();
});

const call = (route, { method = 'GET', headers = {}, body, form } = {}) =>
  fetch(base + route, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined,
  });

const owner = async () => {
  const response = await call('/gate', { method: 'POST', body: { secret: SECRET } });
  return response.headers.get('set-cookie').split(';')[0];
};

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

async function register() {
  const response = await call('/oauth/register', { method: 'POST', body: { client_name: 'Claude', redirect_uris: [REDIRECT] } });
  assert.equal(response.status, 201);
  return (await response.json()).client_id;
}

/** The whole dance, as Claude does it: a code for a yes, then tokens. */
async function signIn(clientId, { verifier, challenge } = pkce()) {
  const cookie = await owner();
  const response = await call('/oauth/authorize', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base },
    form: {
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      decision: 'allow',
    },
  });
  assert.equal(response.status, 302);
  const back = new URL(response.headers.get('location'));
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get('state'), 'xyz');
  const code = back.searchParams.get('code');
  const tokens = await call('/oauth/token', {
    method: 'POST',
    form: { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT },
  });
  return { response: tokens, code };
}

let rpcId = 0;
async function rpc(token, method, params) {
  const response = await call('/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
    body: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const tool = async (token, name, args = {}) => {
  const { body } = await rpc(token, 'tools/call', { name, arguments: args });
  return body.result.structuredContent;
};

test('without a token, /mcp says where to sign in', async () => {
  const response = await call('/mcp', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);

  const resource = await (await call('/.well-known/oauth-protected-resource')).json();
  assert.equal(resource.resource, `${base}/mcp`);
  assert.deepEqual(resource.authorization_servers, [base]);
  const server = await (await call('/.well-known/oauth-authorization-server')).json();
  assert.equal(server.token_endpoint, `${base}/oauth/token`);
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
});

test('registering takes only https or loopback redirects', async () => {
  for (const bad of ['http://evil.example/cb', 'javascript:alert(1)', 'https://x.example/cb#frag']) {
    const response = await call('/oauth/register', { method: 'POST', body: { redirect_uris: [bad] } });
    assert.equal(response.status, 400, bad);
  }
  const ok = await call('/oauth/register', { method: 'POST', body: { redirect_uris: ['http://127.0.0.1:6274/cb'] } });
  assert.equal(ok.status, 201);
});

test('the Allow page is the owner\'s alone, and only for a known redirect', async () => {
  const clientId = await register();
  const { challenge } = pkce();
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' });

  const stranger = await call(`/oauth/authorize?${query}`, { headers: { Accept: 'text/html' } });
  assert.equal(stranger.status, 302);
  assert.match(stranger.headers.get('location'), /^\/gate\?to=/);

  const cookie = await owner();
  const page = await call(`/oauth/authorize?${query}`, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Let Claude use your drive\?/);

  const elsewhere = new URLSearchParams(query);
  elsewhere.set('redirect_uri', 'https://evil.example/cb');
  const refused = await call(`/oauth/authorize?${elsewhere}`, { headers: { Cookie: cookie } });
  assert.equal(refused.status, 400);

  const forged = await call('/oauth/authorize', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://evil.example' },
    form: { ...Object.fromEntries(query), decision: 'allow' },
  });
  assert.equal(forged.status, 403);

  const no = await call('/oauth/authorize', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: base },
    form: { ...Object.fromEntries(query), state: 's', decision: 'deny' },
  });
  assert.equal(new URL(no.headers.get('location')).searchParams.get('error'), 'access_denied');
});

test('a code needs its verifier, and is good once', async () => {
  const clientId = await register();
  const keys = pkce();
  const wrong = await signIn(clientId, { verifier: 'not-the-verifier', challenge: keys.challenge });
  assert.equal(wrong.response.status, 400);

  const right = await signIn(clientId, keys);
  assert.equal(right.response.status, 200);
  const again = await call('/oauth/token', {
    method: 'POST',
    form: { grant_type: 'authorization_code', code: right.code, code_verifier: keys.verifier, client_id: clientId, redirect_uri: REDIRECT },
  });
  assert.equal(again.status, 400);
});

test('signed in, Claude reads the drive and runs a chat', async () => {
  const clientId = await register();
  const tokens = await (await signIn(clientId)).response.json();
  assert.equal(tokens.token_type, 'Bearer');

  const init = await rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, 'marble-drive');

  const listed = await rpc(tokens.access_token, 'tools/list', {});
  assert.deepEqual(
    listed.body.result.tools.map((t) => t.name).sort(),
    ['answer_question', 'list_chats', 'list_documents', 'read_chat', 'read_document', 'send_to_chat', 'start_chat', 'stop_chat'],
  );

  const docs = await tool(tokens.access_token, 'list_documents');
  assert.ok(docs.documents.some((d) => d.path === 'garden'));
  const read = await tool(tokens.access_token, 'read_document', { path: 'garden.mrbl' });
  assert.equal(read.whole, true);
  assert.match(read.source, /Research Garden/);
  assert.equal(read.link, `${base}/a/garden`);

  const started = await tool(tokens.access_token, 'start_chat', { prompt: 'script:hello', document: 'garden', title: 'From Claude', wait_seconds: 20 });
  assert.equal(started.status, 'completed');
  assert.match(started.reply, /Hello from the drive\.$/);
  assert.equal(started.document, 'garden');
  assert.equal(started.link, `${base}/a/Agents?open=${started.chat}`);

  const chats = await tool(tokens.access_token, 'list_chats');
  assert.equal(chats.chats[0].chat, started.chat);
  assert.equal(chats.chats[0].title, 'From Claude');

  const more = await tool(tokens.access_token, 'send_to_chat', { chat: started.chat, prompt: 'script:hello', wait_seconds: 20 });
  assert.match(more.reply, /Hello from the drive\.$/);
  const back = await tool(tokens.access_token, 'read_chat', { chat: started.chat });
  assert.equal(back.turns.length, 2);

  const missing = await tool(tokens.access_token, 'start_chat', { prompt: 'hi', document: 'nowhere' });
  assert.match(missing.error, /no document/);
});

test('a chat that asks waits for an answer from Claude', async () => {
  const tokens = await (await signIn(await register())).response.json();
  const started = await tool(tokens.access_token, 'start_chat', { prompt: 'script:permission', document: 'garden', wait_seconds: 20 });
  assert.equal(started.status, 'running');
  const [ask] = started.waiting_on;
  assert.equal(ask.kind, 'permission');
  const answered = await tool(tokens.access_token, 'answer_question', { chat: started.chat, question_id: ask.question_id, allow: true, wait_seconds: 20 });
  assert.equal(answered.status, 'completed');
  assert.match(answered.reply, /after$/);
});

test('stop_chat ends a running turn', async () => {
  const tokens = await (await signIn(await register())).response.json();
  const started = await tool(tokens.access_token, 'start_chat', { prompt: 'script:hold', document: 'garden', wait_seconds: 0 });
  assert.ok(['queued', 'running'].includes(started.status));
  assert.equal((await tool(tokens.access_token, 'stop_chat', { chat: started.chat })).stopped, true);
});

test('a refresh token is good once, and turning the app off ends its tokens', async () => {
  const clientId = await register();
  const first = await (await signIn(clientId)).response.json();
  const refresh = (token) => call('/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: token, client_id: clientId } });
  const second = await refresh(first.refresh_token);
  assert.equal(second.status, 200);
  const next = await second.json();
  assert.equal((await refresh(first.refresh_token)).status, 400);

  const cookie = await owner();
  const { grants } = await (await call('/connector/grants', { headers: { Cookie: cookie } })).json();
  const page = await (await call('/connector', { headers: { Cookie: cookie } })).text();
  assert.match(page, /Connected apps/);
  assert.match(page, new RegExp(`${base.replace(/[.]/g, '\\.')}/mcp`));

  assert.equal((await rpc(next.access_token, 'ping', {})).status, 200);
  for (const grant of grants) {
    const off = await call(`/connector/grants/${grant.id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: base } });
    assert.equal(off.status, 200);
  }
  assert.equal((await rpc(next.access_token, 'ping', {})).status, 401);
  assert.equal((await refresh(next.refresh_token)).status, 400);
});

test('nobody but the owner sees the connected apps', async () => {
  assert.equal((await call('/connector/grants')).status, 401);
});
