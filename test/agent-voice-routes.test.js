// The voice routes (server/agent/routes.js): a clip in, words out; a finished
// turn in, its reply spoken. Behind the gate like every /agent/ route, against
// a fake OpenAI on a local port.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.MARBLE_DRIVE_BACKUP_DIR = '';
process.env.MARBLE_DRIVE_BACKUP_CMD = '';

const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');
const { speakable } = await import('../server/agent/voice/speakable.js');

const quiet = { log() {}, error() {} };
const KEY = 'sk-proj-voice-routes-do-not-echo';
const MARKER = 'AUDIO-MARKER-7f3a';
const REPLY = 'I added the card. It says **call the dentist**.\n\n```js\nconst x = 1;\n```\n\nSee [the Board](https://example.com/board).';

// OpenAI, as far as voice can tell.
const seen = [];
let down = false;
const openai = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const record = { url: req.url, authorization: req.headers.authorization };
  if (String(req.headers['content-type']).startsWith('multipart/form-data')) {
    record.form = await new Response(body, { headers: { 'content-type': req.headers['content-type'] } }).formData();
  } else if (body.length) record.json = JSON.parse(body.toString('utf8'));
  seen.push(record);
  if (down) { res.writeHead(503); return res.end(); }
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${req.headers.authorization}` } }));
  }
  if (req.url === '/v1/audio/transcriptions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ text: 'hello there' }));
  }
  if (req.url === '/v1/audio/speech') {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    return res.end(Buffer.from('ID3-spoken-bytes'));
  }
  res.writeHead(404);
  res.end();
});
const openaiBase = await new Promise((resolve) => openai.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${openai.address().port}`)));

const SCRIPTS = {
  spoken: [{ say: REPLY }],
  slow: [{ sleep: 1500 }, { say: 'slow' }],
  permission: [{ ask: { tool: 'Bash', input: { command: 'rm -rf build' } } }, { say: 'after' }],
};

const drives = [];
async function makeDrive({ key = KEY, secret = null } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-voice-routes-'));
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-voice-routes-work-'));
  const keys = path.join(work, 'agent-keys.local');
  if (key) await fsp.writeFile(keys, JSON.stringify({ openai: key }), { mode: 0o600 });
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_APPS: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_PROVIDER: 'fake',
    MARBLE_DRIVE_AGENT_WORKDIR: work,
    MARBLE_DRIVE_AGENT_KEYS: keys,
    MARBLE_DRIVE_OPENAI_BASE: openaiBase,
    ...(secret ? { MARBLE_DRIVE_SECRET: secret } : {}),
  });
  const drive = await createDrive(config, { log: quiet, agentProviders: new Map([['fake', createFakeProvider({ scripts: SCRIPTS })]]) });
  await drive.createDocument('Board', '<!doctype html><html><head><title>Bryan’s Board</title></head><body data-marble-id="b"><h1 data-marble-id="h">Board</h1></body></html>\n');
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  drives.push(drive);
  const raw = (method, route, { body, headers = {} } = {}) => fetch(base + route, { method, headers: { Origin: base, ...headers }, body });
  const api = async (method, route, body, headers = {}) => {
    const response = await raw(method, route, { body: body ? JSON.stringify(body) : undefined, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed, text };
  };
  return { root, base, raw, api, drive };
}

test.after(async () => {
  for (const drive of drives) await drive.close();
  openai.closeAllConnections();
  openai.close();
});
test.beforeEach(() => { seen.length = 0; down = false; });

const until = async (check, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('timed out');
};

async function walk(dir) {
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out.sort();
}

const clip = (size = 2048) => Buffer.concat([Buffer.from(MARKER), Buffer.alloc(size, 7)]);

test('every voice route is behind the gate', async () => {
  const { raw } = await makeDrive({ secret: 'voice-gate-secret' });
  for (const [method, route] of [['GET', '/agent/voice'], ['POST', '/agent/voice/transcribe'], ['GET', '/agent/turns/0123456789ab-t1/speech'], ['POST', '/agent/voice/sample']]) {
    const response = await raw(method, route, { body: method === 'POST' ? clip() : undefined, headers: method === 'POST' ? { 'Content-Type': 'audio/webm' } : {} });
    assert.equal(response.status, 401, `${method} ${route}`);
  }
  assert.equal(seen.length, 0);
});

test('a clip from another origin is refused', async () => {
  const { raw } = await makeDrive();
  const response = await raw('POST', '/agent/voice/transcribe', { body: clip(), headers: { 'Content-Type': 'audio/webm', Origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
  assert.equal(seen.length, 0);
});

test('with no key, voice says it needs one, and a clip goes nowhere', async () => {
  const { api, raw } = await makeDrive({ key: null });
  const got = await api('GET', '/agent/voice');
  assert.equal(got.status, 200);
  assert.equal(got.body.available, false);
  assert.equal(got.body.why, 'no-key');
  const response = await raw('POST', '/agent/voice/transcribe', { body: clip(), headers: { 'Content-Type': 'audio/webm' } });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'Voice needs an OpenAI key on this drive. Add one in Settings › Voice.' });
  assert.equal(seen.length, 0);
});

test('with a key, voice is available, with its defaults', async () => {
  const { api } = await makeDrive();
  const got = await api('GET', '/agent/voice');
  assert.equal(got.body.available, true);
  assert.equal(got.body.on, true);
  assert.equal(got.body.voice, 'marin');
  assert.equal(got.body.readAloud, 'spoken');
  assert.equal(got.body.sendWhenStop, true);
  assert.equal(got.body.whileRunning, 'steer');
  assert.equal(got.body.maxSeconds, 120);
  assert.ok(got.body.voices.includes('cedar'));
  assert.ok(!got.text.includes(KEY));
});

test('a clip over four megabytes is refused before OpenAI hears of it', async () => {
  const { raw } = await makeDrive();
  const response = await raw('POST', '/agent/voice/transcribe', { body: clip(5 * 1024 * 1024), headers: { 'Content-Type': 'audio/webm' } });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'That was too long to send. Keep a clip under two minutes.' });
  assert.equal(seen.length, 0);
});

test('a clip that is not audio is refused', async () => {
  const { raw } = await makeDrive();
  const response = await raw('POST', '/agent/voice/transcribe', { body: clip(), headers: { 'Content-Type': 'text/plain' } });
  assert.equal(response.status, 415);
  assert.equal(seen.length, 0);
});

test('a good clip comes back as words, spelled the drive’s way, and nothing of it is kept', async () => {
  const { raw, root } = await makeDrive();
  // Once to let the host make whatever it makes on a first request.
  await (await raw('POST', '/agent/voice/transcribe?doc=Board&seconds=2', { body: clip(), headers: { 'Content-Type': 'audio/webm;codecs=opus' } })).json();
  const before = await walk(root);
  seen.length = 0;
  const response = await raw('POST', '/agent/voice/transcribe?doc=Board&seconds=2', { body: clip(), headers: { 'Content-Type': 'audio/mp4' } });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { text: 'hello there' });
  assert.ok(!text.includes(KEY));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].authorization, `Bearer ${KEY}`);
  assert.equal(seen[0].form.get('file').name, 'clip.m4a');
  const keywords = seen[0].form.getAll('keywords[]');
  assert.ok(keywords.includes('Bryan’s Board'), keywords.join(' | '));
  assert.ok(keywords.length <= 40);
  const after = await walk(root);
  assert.deepEqual(after, before, 'no new file under the drive or .marble/');
  for (const file of after) {
    const bytes = await fsp.readFile(file);
    assert.ok(!bytes.includes(MARKER), `${file} holds the clip`);
  }
});

test('OpenAI down is a plain retry, and nothing is kept', async () => {
  const { raw, root } = await makeDrive();
  down = true;
  const response = await raw('POST', '/agent/voice/transcribe', { body: clip(), headers: { 'Content-Type': 'audio/webm' } });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "OpenAI didn't answer. Try again." });
  for (const file of await walk(root)) assert.ok(!(await fsp.readFile(file)).includes(MARKER));
});

test('a refused key says where to fix it, never the key', async () => {
  const { raw } = await makeDrive({ key: 'sk-proj-wrong-do-not-echo' });
  const response = await raw('POST', '/agent/voice/transcribe', { body: clip(), headers: { 'Content-Type': 'audio/webm' } });
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes('do-not-echo'));
  assert.deepEqual(JSON.parse(text), { error: "OpenAI didn't accept the key in Settings › Voice." });
});

const startTurn = async (api, prompt, context = {}) => {
  const conversation = await api('POST', '/agent/conversations', { provider: 'fake' });
  const turn = await api('POST', `/agent/conversations/${conversation.body.id}/turns`, { prompt, context: { target: 'Board', viewing: 'Board', selection: [], ...context } });
  return { id: conversation.body.id, turnId: turn.body.turnId };
};
const finished = (api, id, turnId) => until(async () => {
  const { body } = await api('GET', `/agent/conversations/${id}`);
  const turn = body.turns.find((t) => t.id === turnId);
  return turn && !['queued', 'running'].includes(turn.status) ? body : null;
});

test('a finished turn’s reply is spoken as speakable() says it', async () => {
  const { api, raw } = await makeDrive();
  const { id, turnId } = await startTurn(api, 'script:spoken', { spoken: true });
  const body = await finished(api, id, turnId);
  const user = body.events.find((e) => e.type === 'user' && e.turn === turnId);
  assert.equal(user.spoken, true, 'the prompt says it was said aloud');
  const response = await raw('GET', `/agent/turns/${turnId}/speech`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'ID3-spoken-bytes');
  const call = seen.find((s) => s.url === '/v1/audio/speech');
  assert.equal(call.json.input, speakable(REPLY));
  assert.notEqual(call.json.input, REPLY);
  assert.equal(call.json.voice, 'marin');
});

test('a turn still running has nothing to say yet', async () => {
  const { api, raw } = await makeDrive();
  const { id, turnId } = await startTurn(api, 'script:slow');
  const response = await raw('GET', `/agent/turns/${turnId}/speech`);
  assert.equal(response.status, 409);
  await finished(api, id, turnId);
});

test('a turn waiting on an OK says so, and approves nothing', async () => {
  const { api, raw } = await makeDrive();
  const { turnId } = await startTurn(api, 'script:permission', { spoken: true });
  await until(async () => (await api('GET', '/agent/asks')).body.asks.some((a) => a.turn === turnId));
  const response = await raw('GET', `/agent/turns/${turnId}/speech`);
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.equal(seen.find((s) => s.url === '/v1/audio/speech').json.input, "It needs your OK. It's on the screen.");
  assert.ok((await api('GET', '/agent/asks')).body.asks.some((a) => a.turn === turnId), 'still asking');
});

test('the chosen voice is the one asked for', async () => {
  const { api, raw } = await makeDrive();
  const saved = await api('PUT', '/agent/settings', { voice: { voice: 'cedar', readAloud: 'always' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.voice.voice, 'cedar');
  assert.equal(saved.body.voice.readAloud, 'always');
  assert.equal(saved.body.voice.on, true, 'the rest stays as it was');
  const bad = await api('PUT', '/agent/settings', { voice: { voice: 'robot', readAloud: 'sometimes' } });
  assert.equal(bad.body.voice.voice, 'cedar');
  assert.equal(bad.body.voice.readAloud, 'always');
  const { id, turnId } = await startTurn(api, 'script:spoken');
  await finished(api, id, turnId);
  await (await raw('GET', `/agent/turns/${turnId}/speech`)).arrayBuffer();
  assert.equal(seen.find((s) => s.url === '/v1/audio/speech').json.voice, 'cedar');
});

test('a sample is spoken in the voice asked for', async () => {
  const { raw } = await makeDrive();
  const response = await raw('POST', '/agent/voice/sample', { body: JSON.stringify({ voice: 'cedar' }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  await response.arrayBuffer();
  const call = seen.find((s) => s.url === '/v1/audio/speech');
  assert.equal(call.json.voice, 'cedar');
  assert.match(call.json.input, /\w/);
});

test('minutes heard and characters spoken are counted for the month', async () => {
  const { api, raw } = await makeDrive();
  await (await raw('POST', '/agent/voice/transcribe?seconds=90', { body: clip(), headers: { 'Content-Type': 'audio/webm' } })).json();
  await (await raw('POST', '/agent/voice/transcribe?seconds=9999', { body: clip(), headers: { 'Content-Type': 'audio/webm' } })).json();
  await (await raw('POST', '/agent/voice/sample', { body: '{}', headers: { 'Content-Type': 'application/json' } })).arrayBuffer();
  const got = await api('GET', '/agent/voice');
  assert.equal(got.body.usage.heardSeconds, 90 + 120, 'a clip counts at most the cap');
  assert.ok(got.body.usage.spokenChars > 0);
  assert.match(got.body.usage.month, /^\d{4}-\d{2}$/);
});

test('no response from a voice route carries the key', async () => {
  const { api, raw } = await makeDrive();
  const bodies = [
    (await api('GET', '/agent/voice')).text,
    (await api('GET', '/agent/settings')).text,
    await (await raw('POST', '/agent/voice/transcribe', { body: clip(), headers: { 'Content-Type': 'audio/webm' } })).text(),
  ];
  for (const body of bodies) assert.ok(!body.includes(KEY));
});
