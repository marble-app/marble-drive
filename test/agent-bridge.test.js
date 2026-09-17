import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'marble-mcp.js');

// A host that answers the two routes the bridge uses. Real HTTP, so what is
// tested is the bridge's actual requests.
const seen = [];
const host = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    const end = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/agent/tools') return end(200, { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] });
    if (req.url === '/agent/tools/echo') return end(200, { echoed: JSON.parse(body).arguments });
    if (req.url === '/agent/tools/refused') return end(200, { error: 'not writable' });
    return end(401, { error: 'no running turn holds that token' });
  });
});
await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve));
const URL_BASE = `http://127.0.0.1:${host.address().port}`;

function startBridge(env = { MARBLE_DRIVE_URL: URL_BASE, MARBLE_AGENT_TOKEN: 'tok' }) {
  const child = spawn(process.execPath, [BRIDGE], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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

test('initialize answers as a tools server and echoes the protocol version', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
  assert.equal(reply.result.protocolVersion, '2025-03-26');
  assert.deepEqual(reply.result.capabilities, { tools: {} });
  assert.equal(reply.result.serverInfo.name, 'marble');
  child.kill();
});

test('tools come from the host, with the token', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('tools/list', {});
  assert.equal(reply.result.tools[0].name, 'echo');
  assert.equal(seen.at(-1).auth, 'Bearer tok');
  child.kill();
});

test('a call is forwarded and its result handed back as text', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('tools/call', { name: 'echo', arguments: { x: 1 } });
  assert.equal(reply.result.isError, false);
  assert.deepEqual(JSON.parse(reply.result.content[0].text), { echoed: { x: 1 } });
  child.kill();
});

test('a tool error and a refused token both reach the agent as readable errors', async () => {
  const { child, rpc } = startBridge();
  const refused = await rpc('tools/call', { name: 'refused', arguments: {} });
  assert.equal(refused.result.isError, true);
  const denied = await rpc('tools/call', { name: 'anything', arguments: {} });
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /no running turn/);
  child.kill();
});

test('an unreachable host is an error result, not a crash', async () => {
  const { child, rpc } = startBridge({ MARBLE_DRIVE_URL: 'http://127.0.0.1:9', MARBLE_AGENT_TOKEN: 'tok' });
  const reply = await rpc('tools/call', { name: 'echo', arguments: {} });
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /could not be reached/);
  child.kill();
});

test('an unknown method is a JSON-RPC error', async () => {
  const { child, rpc } = startBridge();
  const reply = await rpc('resources/list', {});
  assert.equal(reply.error.code, -32601);
  child.kill();
});

test('without its environment the bridge refuses to start', async () => {
  const { child } = startBridge({});
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 2);
});

test.after(() => host.close());
