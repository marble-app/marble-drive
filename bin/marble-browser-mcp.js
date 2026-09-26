#!/usr/bin/env node
// An agent's isolated browser, as an MCP server on stdio.
//
// Unlike marble-mcp.js this does not call back into the Drive host. There is
// no ledger for a web page. Playwright runs in this process; when the CLI
// kills the turn, stdin closes and the browser goes with it.

import readline from 'node:readline';

import { BROWSER_SCHEMAS, createBrowserSession, toMcpResult } from '../server/agent/browser.js';

const session = createBrowserSession({
  userDataDir: process.env.MARBLE_BROWSER_PROFILE || undefined,
  pass: process.env.MARBLE_BROWSER_PASS
    ? { origin: process.env.MARBLE_BROWSER_ORIGIN, cookie: process.env.MARBLE_BROWSER_PASS }
    : undefined,
});

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle({ id, method, params }) {
  if (id === undefined || id === null) return;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'browser', version: '0.1.0' },
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: BROWSER_SCHEMAS });
      case 'tools/call':
        return reply(id, toMcpResult(await session.call(params?.name, params?.arguments ?? {})));
      default:
        return fail(id, -32601, `no method "${method}"`);
    }
  } catch (err) {
    if (method === 'tools/call') return reply(id, toMcpResult({ error: err.message }));
    return fail(id, -32603, err.message);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  handle(message);
});
rl.on('close', () => {
  session.close().finally(() => process.exit(0));
});
