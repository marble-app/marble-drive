#!/usr/bin/env node
// Marble's tools, as an MCP server on stdio.
//
// Every agent CLI — Claude Code, Cursor, Codex — can start an MCP server and
// call its tools, so this is the one door they all come through. It holds no
// logic: each call is forwarded to the host that started the turn, with the
// turn's token, and the host decides everything. That keeps one copy of the
// rules, and it means a bridge that outlives its turn can do nothing at all.

import readline from 'node:readline';

const BASE = process.env.MARBLE_DRIVE_URL;
const TOKEN = process.env.MARBLE_AGENT_TOKEN;

if (!BASE || !TOKEN) {
  process.stderr.write('marble-mcp: MARBLE_DRIVE_URL and MARBLE_AGENT_TOKEN are required\n');
  process.exit(2);
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function host(route, { method = 'GET', body = null } = {}) {
  const response = await fetch(new URL(route, BASE), {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { error: payload.error ?? `the drive answered ${response.status}` };
  return payload;
}

const asContent = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  isError: Boolean(payload.error),
});

async function handle({ id, method, params }) {
  // A notification carries no id and wants no answer.
  if (id === undefined || id === null) return;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'marble', version: '0.1.0' },
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list': {
        const listed = await host('/agent/tools');
        if (listed.error) return fail(id, -32603, listed.error);
        return reply(id, { tools: listed.tools ?? [] });
      }
      case 'tools/call': {
        const name = encodeURIComponent(String(params?.name ?? ''));
        return reply(id, asContent(await host(`/agent/tools/${name}`, {
          method: 'POST',
          body: { arguments: params?.arguments ?? {} },
        })));
      }
      default:
        return fail(id, -32601, `no method "${method}"`);
    }
  } catch (err) {
    // Said to the agent as a tool result, because an agent reads those and
    // tells the person; a protocol error is something a CLI swallows.
    if (method === 'tools/call') {
      return reply(id, asContent({ error: `the drive could not be reached: ${err.cause?.code ?? err.message}` }));
    }
    return fail(id, -32603, err.message);
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  handle(message);
});
