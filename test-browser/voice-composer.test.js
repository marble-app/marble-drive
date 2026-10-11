// Talking to a chat: Talk in the composer listens, the words go in as a
// prompt that was said aloud, and the reply is spoken when the turn ends.
// Chromium's fake microphone plays a clip made here (half a second of room,
// a burst of tone where a sentence would be, then quiet); a fake OpenAI on a
// local port writes it down and speaks the reply. Nothing reaches the network.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { startDrive } from './harness.js';

/** A mono 16-bit WAV: quiet, except a 220 Hz tone, wavering like a voice,
 *  over each [from, to] second span in `voiced`. */
function wav({ seconds, voiced = [], rate = 16000 }) {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    const on = voiced.some(([from, to]) => t >= from && t < to);
    const value = on ? 0.35 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 5 * t)) * Math.sin(2 * Math.PI * 220 * t) : 0.0005 * Math.sin(2 * Math.PI * 50 * t);
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-voice-browser-'));
const mic = path.join(dir, 'hello.wav');
await fsp.writeFile(mic, wav({ seconds: 8, voiced: [[0.5, 1.8]] }));
const REPLY = wav({ seconds: 4, voiced: [[0, 4]] });

// OpenAI: what it heard is whatever the test says it heard.
let heard = 'hello there';
const calls = [];
const openai = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  calls.push({ url: req.url, type: req.headers['content-type'] });
  if (req.url === '/v1/audio/transcriptions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ text: heard }));
  }
  if (req.url === '/v1/audio/speech') {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    return res.end(REPLY);
  }
  res.writeHead(404);
  return res.end();
});
const openaiBase = await new Promise((resolve) => openai.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${openai.address().port}`)));

const SCRIPTS = {
  slow: [{ sleep: 4000 }, { say: 'Slow one done.' }],
  quick: [{ say: 'I read the Board. There are four cards.' }],
};
const launchOptions = {
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${mic}`, '--autoplay-policy=no-user-gesture-required'],
};
const host = await startDrive({ scripts: SCRIPTS, launchOptions, keys: { openai: 'sk-proj-browser-voice' }, env: { MARBLE_DRIVE_OPENAI_BASE: openaiBase } });
const keyless = await startDrive({ scripts: SCRIPTS, launchOptions, env: { MARBLE_DRIVE_OPENAI_BASE: openaiBase } });
test.after(async () => {
  await host.close();
  await keyless.close();
  openai.closeAllConnections();
  openai.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

async function mount(on = host, { conversation = null } = {}) {
  await on.reset();
  const { page, errors } = await on.newPage();
  // Every microphone the page opens, so a test can see it closed again.
  await page.addInitScript(() => {
    window.__streams = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await real(constraints);
      window.__streams.push(stream);
      return stream;
    };
    window.__spoken = [];
    if (window.speechSynthesis) window.speechSynthesis.speak = (utterance) => { window.__spoken.push(utterance.text); setTimeout(() => utterance.onend?.(), 10); };
  });
  await page.goto(`${on.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent && window.marbleVoice && customElements.get('marble-conversation')));
  await page.evaluate((id) => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    if (id) el.setAttribute('conversation', id);
    el.style.cssText = 'position:fixed;right:0;top:0;width:460px;height:100vh;';
    document.body.append(el);
  }, conversation);
  const view = page.locator('body > marble-conversation');
  await view.locator('input[name="agent"][value="fake"]').waitFor();
  return { page, errors, view };
}

/** Every state the composer passes through, in order, from now on. */
const watchStates = (page) => page.evaluate(() => {
  const form = document.querySelector('body > marble-conversation').shadowRoot.querySelector('form.composer');
  window.__states = [];
  new MutationObserver(() => {
    const state = form.dataset.voice ?? '';
    if (window.__states.at(-1) !== state) window.__states.push(state);
  }).observe(form, { attributes: true, attributeFilter: ['data-voice'] });
});
const states = (page) => page.evaluate(() => window.__states);
const stateOf = (view) => view.locator('form.composer').evaluate((form) => form.dataset.voice ?? '');

test('with a key, the bar has Talk; pressing it listens, writes it down, and sends it as said aloud', async () => {
  heard = 'script:quick hello there';
  const { page, view, errors } = await mount();
  const talk = view.getByRole('button', { name: 'Talk' });
  await talk.waitFor();
  await watchStates(page);
  const sent = page.waitForRequest((request) => /\/agent\/conversations\/[0-9a-f]{12}\/turns$/.test(request.url()) && request.method() === 'POST');
  const speech = page.waitForRequest((request) => /\/agent\/turns\/[0-9a-f]{12}-t\d+\/speech$/.test(request.url()), { timeout: 20_000 });
  await talk.click();
  await view.locator('.voice-line', { hasText: 'Listening' }).waitFor();
  const body = JSON.parse((await sent).postData());
  assert.equal(body.context.spoken, true);
  assert.equal(body.prompt, 'script:quick hello there');
  const prompt = view.locator('.msg.me', { hasText: 'script:quick hello there' });
  await prompt.waitFor();
  assert.equal(await prompt.locator('.msg-said').textContent(), 'Said aloud');
  // Every microphone it opened is closed again.
  assert.equal(await page.evaluate(() => window.__streams.length > 0 && window.__streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))), true);
  // The reply is asked for once the turn ends, and the bar says it is speaking.
  const asked = await speech;
  assert.match(asked.url(), /-t1\/speech$/);
  await view.locator('.voice-speaking', { hasText: 'Speaking' }).waitFor();
  await view.getByRole('button', { name: 'Stop speaking' }).waitFor();
  assert.deepEqual((await states(page)).slice(0, 4), ['listening', 'writing', '', 'speaking']);
  // Esc stops it.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('body > marble-conversation').shadowRoot.querySelector('form.composer').dataset.voice);
  assert.equal(await view.locator('.voice-speaking').isVisible(), false);
  assert.deepEqual(errors, []);
});

test('Talk while it speaks stops the reply and listens', async () => {
  heard = 'script:quick again';
  const { page, view } = await mount();
  await view.getByRole('button', { name: 'Talk' }).click();
  await view.locator('.voice-speaking', { hasText: 'Speaking' }).waitFor({ timeout: 20_000 });
  await view.getByRole('button', { name: 'Talk' }).click();
  await view.locator('.voice-line', { hasText: 'Listening' }).waitFor();
  assert.equal(await view.locator('.voice-speaking').isVisible(), false);
  assert.equal(await page.evaluate(() => window.marbleVoice.speaking), false);
  await view.getByRole('button', { name: 'Cancel' }).click();
});

test('Cancel throws the clip away: nothing is sent, and the microphone closes', async () => {
  heard = 'script:quick should not go';
  const { page, view } = await mount();
  let posted = 0;
  page.on('request', (request) => { if (/\/turns$/.test(request.url()) && request.method() === 'POST') posted += 1; });
  let transcribed = 0;
  page.on('request', (request) => { if (request.url().includes('/agent/voice/transcribe')) transcribed += 1; });
  await view.getByRole('button', { name: 'Talk' }).click();
  await view.locator('.voice-line', { hasText: 'Listening' }).waitFor();
  await view.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await stateOf(view), '');
  await page.waitForTimeout(3000);
  assert.equal(posted, 0);
  assert.equal(transcribed, 0);
  assert.equal(await page.evaluate(() => window.__streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))), true);
  assert.equal(await view.locator('.editor').evaluate((el) => el.value), '');
});

test('Send while listening sends what was said so far', async () => {
  heard = 'script:quick sent early';
  const { page, view } = await mount();
  const sent = page.waitForRequest((request) => /\/turns$/.test(request.url()) && request.method() === 'POST');
  await view.getByRole('button', { name: 'Talk' }).click();
  await view.locator('.voice-line', { hasText: 'Listening' }).waitFor();
  await page.waitForTimeout(800);
  await view.getByRole('button', { name: 'Send' }).click();
  const body = JSON.parse((await sent).postData());
  assert.equal(body.prompt, 'script:quick sent early');
  assert.equal(body.context.spoken, true);
});

test('said while a turn runs, it steers', async () => {
  const { page, view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('script:slow');
  await editor.press('Enter');
  await view.locator('.stop:not([hidden])').waitFor();
  heard = 'actually make it blue';
  const sent = page.waitForRequest((request) => /\/turns$/.test(request.url()) && request.method() === 'POST' && JSON.parse(request.postData()).prompt === 'actually make it blue');
  await view.getByRole('button', { name: 'Talk' }).click();
  const body = JSON.parse((await sent).postData());
  assert.equal(body.dispatch, 'steer');
  assert.equal(body.context.spoken, true);
});

test('at rest nothing on the composer moves', async () => {
  const { view } = await mount();
  await view.getByRole('button', { name: 'Talk' }).waitFor();
  const moving = await view.evaluate((el) => [...el.shadowRoot.querySelectorAll('.commit, .commit *, .voice-line, .voice-line *, .voice-speaking, .voice-speaking *')]
    .flatMap((node) => node.getAnimations()).length);
  assert.equal(moving, 0);
});

test('a typed reply can be read aloud, in the drive’s voice', async () => {
  const { page, view } = await mount();
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('script:quick');
  const speech = page.waitForRequest((request) => /\/speech$/.test(request.url()), { timeout: 20_000 });
  await editor.press('Enter');
  const read = view.getByRole('button', { name: 'Read aloud' });
  await read.waitFor({ timeout: 20_000 });
  // Typed, so nothing was spoken until asked.
  await page.waitForTimeout(500);
  assert.equal(await view.locator('.voice-speaking').isVisible(), false);
  await read.click();
  await speech;
  await view.locator('.voice-speaking', { hasText: 'Speaking' }).waitFor();
});

test('with Send when I stop off, the words wait in the box', async () => {
  heard = 'script:quick wait for me';
  await host.drive.agents.store.saveSettings({ voice: { sendWhenStop: false } });
  try {
    const { page, view } = await mount();
    let posted = 0;
    page.on('request', (request) => { if (/\/turns$/.test(request.url()) && request.method() === 'POST') posted += 1; });
    await view.getByRole('button', { name: 'Talk' }).click();
    await page.waitForFunction(() => document.querySelector('body > marble-conversation').shadowRoot.querySelector('.editor').value === 'script:quick wait for me', null, { timeout: 15_000 });
    assert.equal(await stateOf(view), '');
    assert.equal(posted, 0);
  } finally {
    await host.drive.agents.store.saveSettings({ voice: { sendWhenStop: true } });
  }
});

test('without a key there is no Talk, and Read aloud uses the device’s voice', async () => {
  const { page, view } = await mount(keyless);
  const editor = view.locator('.editor');
  await editor.click();
  await editor.pressSequentially('script:quick');
  await editor.press('Enter');
  const read = view.getByRole('button', { name: 'Read aloud' });
  await read.waitFor({ timeout: 20_000 });
  assert.equal(await view.getByRole('button', { name: 'Talk' }).count(), 0);
  await read.click();
  await page.waitForFunction(() => window.__spoken.length > 0);
  const said = await page.evaluate(() => window.__spoken[0]);
  assert.match(said, /I read the Board\. There are four cards\./);
});

test('speech switched off removes Talk', async () => {
  await host.drive.agents.store.saveSettings({ voice: { on: false } });
  try {
    const { view } = await mount();
    await view.locator('.editor').waitFor();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await view.getByRole('button', { name: 'Talk' }).count(), 0);
  } finally {
    await host.drive.agents.store.saveSettings({ voice: { on: true } });
  }
});
