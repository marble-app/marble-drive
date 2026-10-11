// Settings › Voice: whether chats listen, when replies are read aloud, which
// voice, and the OpenAI key voice needs. Settings › Usage counts the minutes.

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';

import { startDrive } from './harness.js';

const speech = [];
const openai = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url === '/v1/audio/speech') {
    speech.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    return res.end(Buffer.alloc(16));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end('{"object":"list","data":[]}');
});
const openaiBase = await new Promise((resolve) => openai.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${openai.address().port}`)));

const SCRIPTS = { quick: [{ say: 'Done here.' }] };
const host = await startDrive({ scripts: SCRIPTS, keys: { openai: 'sk-proj-settings-voice' }, env: { MARBLE_DRIVE_OPENAI_BASE: openaiBase } });
// A friend's drive: its agents run on the owner's login, and it has no
// OpenAI key of its own.
const tester = await startDrive({ scripts: SCRIPTS, providers: ['claude-subscription'], env: { MARBLE_DRIVE_OPENAI_BASE: openaiBase } });
test.after(async () => {
  await host.close();
  await tester.close();
  openai.closeAllConnections();
  openai.close();
});

async function openVoice(on, tab = 'voice') {
  await on.reset();
  const { page, errors } = await on.newPage();
  await page.goto(`${on.base}/a/garden`);
  await page.waitForFunction(() => Boolean(window.marble?.agent?.openSettings));
  await page.evaluate((which) => window.marble.agent.openSettings(which), tab);
  const settings = page.locator('marble-agent-settings');
  await settings.locator('h2', { hasText: 'Agent settings' }).waitFor();
  return { page, errors, settings };
}

test('the Voice tab lists the voices; choosing Cedar is what the next reply is spoken in', async () => {
  const { page, settings, errors } = await openVoice(host);
  const select = settings.locator('select[name="voice-voice"]');
  await select.waitFor();
  const voices = await select.locator('option').allTextContents();
  assert.equal(voices[0], 'Marin');
  assert.ok(voices.includes('Cedar'));
  assert.equal(await select.inputValue(), 'marin');
  assert.match(await settings.locator('.pane-voice').textContent(), /Replies are read by an OpenAI voice\. What you say is sent to OpenAI to be written down, and is not kept\./);
  await select.selectOption('cedar');
  await settings.locator('button.save').click();
  await page.waitForFunction(() => document.querySelector('marble-agent-settings')?.getAttribute('data-open') === 'false');
  const saved = await (await fetch(`${host.base}/agent/settings`)).json();
  assert.equal(saved.voice.voice, 'cedar');
  assert.ok(!JSON.stringify(saved).includes('sk-proj-settings-voice'));

  // The next reply is asked for in Cedar.
  const { id } = await (await fetch(`${host.base}/agent/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"provider":"fake"}' })).json();
  const { turnId } = await (await fetch(`${host.base}/agent/conversations/${id}/turns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'script:quick', context: { target: 'garden' } }) })).json();
  for (let i = 0; i < 100; i += 1) {
    const { turns } = await (await fetch(`${host.base}/agent/conversations/${id}`)).json();
    if (turns.find((t) => t.id === turnId)?.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  speech.length = 0;
  await (await fetch(`${host.base}/agent/turns/${turnId}/speech`)).arrayBuffer();
  assert.equal(speech[0].voice, 'cedar');
  await host.drive.agents.store.saveSettings({ voice: { voice: 'marin' } });
  assert.deepEqual(errors, []);
});

test('Play sample speaks a sentence in the voice showing', async () => {
  const { settings } = await openVoice(host);
  await settings.locator('select[name="voice-voice"]').selectOption('sage');
  speech.length = 0;
  await settings.getByRole('button', { name: 'Play sample' }).click();
  for (let i = 0; i < 100 && !speech.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(speech[0]?.voice, 'sage');
});

test('turning Talk to chats off takes Talk out of every composer', async () => {
  const { page, settings } = await openVoice(host);
  await page.evaluate(() => {
    const el = document.createElement('marble-conversation');
    el.setAttribute('data-marble-transient', '');
    el.style.cssText = 'position:fixed;left:0;top:0;width:420px;height:100vh;';
    document.body.append(el);
  });
  const view = page.locator('body > marble-conversation');
  await view.getByRole('button', { name: 'Talk' }).waitFor();
  await settings.locator('input[name="voice-on"]').uncheck();
  await settings.locator('button.save').click();
  await page.waitForFunction(() => !document.querySelector('body > marble-conversation').shadowRoot.querySelector('.talk:not([hidden])'));
  assert.equal(await view.getByRole('button', { name: 'Talk' }).count(), 0);
  assert.equal((await (await fetch(`${host.base}/agent/voice`)).json()).on, false);
  await host.drive.agents.store.saveSettings({ voice: { on: true } });
});

test('a friend’s drive with no OpenAI key of its own says voice needs one, and offers the field', async () => {
  const { settings } = await openVoice(tester);
  const pane = settings.locator('.pane-voice');
  await pane.locator('input[name="key-openai-voice"]').waitFor();
  assert.match(await pane.textContent(), /Voice needs an OpenAI key on this drive\./);
  assert.equal(await settings.getByRole('button', { name: 'Play sample' }).isDisabled(), true);
});

test('Usage counts the minutes heard and spoken this month', async () => {
  const month = new Date().toISOString().slice(0, 7);
  await fsp.writeFile(path.join(host.root, '.marble', 'agents', 'voice-usage.json'), JSON.stringify({ month, heardSeconds: 240, spokenChars: 1800 }));
  const { settings } = await openVoice(host, 'usage');
  const line = settings.locator('.voice-usage p');
  await line.waitFor();
  assert.equal(await line.textContent(), '4 min heard · 2 min spoken');
});
