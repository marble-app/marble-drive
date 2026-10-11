import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BROWSER_TOOLS, passFromEnv } from '../server/agent/browser.js';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'marble-browser-mcp.js');

function startBridge() {
  const child = spawn(process.execPath, [BRIDGE], {
    env: { PATH: process.env.PATH },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message);
  });
  let id = 0;
  const rpc = (method, params) => {
    id += 1;
    const answer = new Promise((resolve) => waiting.set(id, resolve));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return answer;
  };
  return { child, rpc };
}

test('initialize answers as a tools server named browser', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
  assert.equal(reply.result.protocolVersion, '2025-03-26');
  assert.equal(reply.result.serverInfo.name, 'browser');
  child.kill();
});

test('tools/list is exactly the eight browser tools', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('tools/list', {});
  assert.deepEqual(reply.result.tools.map((t) => t.name), BROWSER_TOOLS);
  child.kill();
});

test('a refused url is an error result, not a crash, and does not need Chromium', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('tools/call', { name: 'browser_navigate', arguments: { url: 'file:///etc/passwd' } });
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /http/);
  child.kill();
});

test('an unknown tool is an error result', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('tools/call', { name: 'browser_evaluate', arguments: {} });
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /no tool/);
  child.kill();
});

test('an unknown method is a JSON-RPC error', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('resources/list', {});
  assert.equal(reply.error.code, -32601);
  child.kill();
});

test('ending stdin closes the process', async () => {
  const { child } = startBridge();
  child.stdin.end();
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('browser MCP did not exit after stdin ended')), 3_000);
    child.on('close', (exit) => {
      clearTimeout(timer);
      resolve(exit);
    });
  });
  assert.equal(code, 0);
});

test('the pass comes from the environment or from the private file it names', async () => {
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  assert.equal(passFromEnv({}), undefined);
  assert.deepEqual(passFromEnv({ MARBLE_BROWSER_ORIGIN: 'http://o', MARBLE_BROWSER_PASS: 'c1' }), { origin: 'http://o', cookie: 'c1' });
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-pass-'));
  const file = path.join(dir, 'browser-pass');
  await fsp.writeFile(file, 'c2\n', { mode: 0o600 });
  assert.deepEqual(passFromEnv({ MARBLE_BROWSER_ORIGIN: 'http://o', MARBLE_BROWSER_PASS_FILE: file }), { origin: 'http://o', cookie: 'c2' });
  assert.equal(passFromEnv({ MARBLE_BROWSER_ORIGIN: 'http://o', MARBLE_BROWSER_PASS_FILE: path.join(dir, 'gone') }), undefined);
});
