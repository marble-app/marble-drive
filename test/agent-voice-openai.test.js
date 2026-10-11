// The host's ears and voice (server/agent/voice/openai.js): a clip goes to
// OpenAI's transcription endpoint and comes back as words; words go to its
// speech endpoint and come back as audio. Against a fake OpenAI on a local
// port, never the network.
//
// The field shapes are the ones OpenAI's docs gave on 2026-10-10
// (developers.openai.com/api/docs/guides/speech-to-text): multipart `file`,
// `model`, and one `keywords[]` field per term; JSON `{ model, voice, input,
// instructions, response_format }` for speech.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createKeyStore } from '../server/agent/keys.js';
import { createVoice, VoiceError } from '../server/agent/voice/openai.js';

const KEY = 'sk-proj-voice-test-do-not-echo';
const seen = [];
let answer = null;
const openai = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const record = { url: req.url, method: req.method, authorization: req.headers.authorization, type: req.headers['content-type'], body };
  if (String(req.headers['content-type']).startsWith('multipart/form-data')) {
    record.form = await new Response(body, { headers: { 'content-type': req.headers['content-type'] } }).formData();
  } else if (body.length) {
    record.json = JSON.parse(body.toString('utf8'));
  }
  seen.push(record);
  if (answer) return answer(req, res, record);
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${String(req.headers.authorization).slice(7)}`, code: 'invalid_api_key' } }));
  }
  if (req.url === '/v1/audio/transcriptions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ text: 'hello there', languages: [{ code: 'en' }] }));
  }
  if (req.url === '/v1/audio/speech') {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    res.write(Buffer.from('ID3fake-'));
    return setTimeout(() => res.end(Buffer.from('mp3-bytes')), 20);
  }
  res.writeHead(404);
  res.end();
});
const base = await new Promise((resolve) => openai.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${openai.address().port}`)));
test.after(() => { openai.closeAllConnections(); openai.close(); });
test.beforeEach(() => { seen.length = 0; answer = null; });

const keysWith = async (value) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-voice-keys-'));
  const keys = createKeyStore({ file: path.join(dir, 'agent-keys.local') });
  if (value) await keys.write({ openai: value });
  return keys;
};

test('the key store answers a key by name on the host, and its flags and env are as before', async () => {
  const keys = await keysWith(KEY);
  assert.equal(keys.value('openai'), KEY);
  assert.equal(keys.value('anthropic'), null);
  assert.equal(keys.value('nonsense'), null);
  assert.deepEqual(await keys.flags(), { anthropic: false, claude: false, cursor: false, openai: true });
  assert.deepEqual(keys.asEnv(), { CODEX_API_KEY: KEY });
});

test('with no OpenAI key, voice is not available, and says why', async () => {
  const voice = createVoice({ keys: await keysWith(null), baseURL: base });
  assert.deepEqual(voice.available(), { ok: false, why: 'no-key' });
  await assert.rejects(voice.transcribe({ audio: Buffer.from('x'), type: 'audio/webm' }), (err) => err instanceof VoiceError && err.status === 409);
  assert.equal(seen.length, 0);
});

test('a clip is sent as the API wants it, with the key as a bearer token, and its words come back', async () => {
  const voice = createVoice({ keys: await keysWith(KEY), baseURL: base });
  assert.deepEqual(voice.available(), { ok: true });
  const result = await voice.transcribe({ audio: Buffer.from('webm-bytes'), type: 'audio/webm;codecs=opus', keywords: ["Bryan's Days", 'Mashup Studio'] });
  assert.deepEqual(result, { text: 'hello there' });
  assert.equal(seen.length, 1);
  const [call] = seen;
  assert.equal(call.url, '/v1/audio/transcriptions');
  assert.equal(call.authorization, `Bearer ${KEY}`);
  assert.equal(call.form.get('model'), 'gpt-transcribe');
  assert.deepEqual(call.form.getAll('keywords[]'), ["Bryan's Days", 'Mashup Studio']);
  const file = call.form.get('file');
  assert.equal(file.name, 'clip.webm');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'webm-bytes');
});

test('an iPhone clip goes as m4a', async () => {
  const voice = createVoice({ keys: await keysWith(KEY), baseURL: base });
  await voice.transcribe({ audio: Buffer.from('mp4-bytes'), type: 'audio/mp4' });
  assert.equal(seen[0].form.get('file').name, 'clip.m4a');
});

test('the model is a setting', async () => {
  const voice = createVoice({ keys: await keysWith(KEY), baseURL: base, settings: async () => ({ transcribeModel: 'gpt-4o-transcribe' }) });
  await voice.transcribe({ audio: Buffer.from('x'), type: 'audio/webm' });
  assert.equal(seen[0].form.get('model'), 'gpt-4o-transcribe');
});

test('a refused key says where to fix it, and never says the key', async () => {
  const voice = createVoice({ keys: await keysWith('sk-proj-wrong-do-not-echo'), baseURL: base });
  await assert.rejects(voice.transcribe({ audio: Buffer.from('x'), type: 'audio/webm' }), (err) => {
    assert.ok(err instanceof VoiceError);
    assert.equal(err.message, "OpenAI didn't accept the key in Settings › Voice.");
    assert.ok(!JSON.stringify({ message: err.message, stack: err.stack, cause: String(err.cause ?? '') }).includes('do-not-echo'));
    return true;
  });
});

test('OpenAI down is a plain retry', async () => {
  answer = (req, res) => { res.writeHead(503); res.end('down'); };
  const voice = createVoice({ keys: await keysWith(KEY), baseURL: base });
  await assert.rejects(voice.transcribe({ audio: Buffer.from('x'), type: 'audio/webm' }), { message: "OpenAI didn't answer. Try again." });
  const nowhere = createVoice({ keys: await keysWith(KEY), baseURL: 'http://127.0.0.1:9' });
  await assert.rejects(nowhere.transcribe({ audio: Buffer.from('x'), type: 'audio/webm' }), { message: "OpenAI didn't answer. Try again." });
});

test('nothing heard says to try again closer', async () => {
  answer = (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ text: '  ' })); };
  const voice = createVoice({ keys: await keysWith(KEY), baseURL: base });
  await assert.rejects(voice.transcribe({ audio: Buffer.from('x'), type: 'audio/webm' }), { message: "Didn't catch anything. Try again a little closer." });
});

test('an aborted clip is not retried', async () => {
  let calls = 0;
  answer = (req, res) => { calls += 1; setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"text":"late"}'); }, 300); };
  const voice = createVoice({ keys: await keysWith(KEY), baseURL: base });
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 30);
  await assert.rejects(voice.transcribe({ audio: Buffer.from('x'), type: 'audio/webm', signal: stop.signal }), { name: 'AbortError' });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(calls, 1);
});

test('speech sends the words, the voice and the way to say them, and streams the audio back', async () => {
  const voice = createVoice({ keys: await keysWith(KEY), baseURL: base });
  const response = await voice.speak({ text: 'Done. It is on the screen.', voice: 'cedar' });
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'ID3fake-mp3-bytes');
  const [call] = seen;
  assert.equal(call.url, '/v1/audio/speech');
  assert.equal(call.authorization, `Bearer ${KEY}`);
  assert.deepEqual(call.json, {
    model: 'gpt-4o-mini-tts',
    voice: 'cedar',
    input: 'Done. It is on the screen.',
    instructions: 'Speak plainly and at an even, unhurried pace, like a colleague giving a quick update.',
    response_format: 'mp3',
  });
});

test('speech defaults to marin, and a refused key is the same plain line', async () => {
  const voice = createVoice({ keys: await keysWith(KEY), baseURL: base });
  await (await voice.speak({ text: 'Hi.' })).arrayBuffer();
  assert.equal(seen[0].json.voice, 'marin');
  const wrong = createVoice({ keys: await keysWith('sk-proj-wrong-do-not-echo'), baseURL: base });
  await assert.rejects(wrong.speak({ text: 'Hi.' }), (err) => err instanceof VoiceError && !err.message.includes('do-not-echo') && err.message === "OpenAI didn't accept the key in Settings › Voice.");
});
