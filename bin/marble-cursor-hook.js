#!/usr/bin/env node
// Cursor's preToolUse hook for a Marble agent's workspace.
//
// cursor-agent has no flag that removes its own tools, so the boundary is this
// hook, written into the conversation's workspace with `failClosed`. Marble's
// MCP tools are always allowed. At capability `full` (the default), Cursor's
// own tools are allowed too — Read, Write, Shell, WebSearch, and the rest —
// plus Marble's own browser MCP. Another MCP server's tools are still refused:
// Cursor tells this hook `MCP:read_document` and not which server that is, so a
// user server with a colliding name would pass. That is why the Cursor provider
// refuses to run while ~/.cursor/mcp.json names any server.
//
// MARBLE_CURSOR_CAPABILITY is set in the hook command by prepare(). Unset or
// anything other than `full` is the 2026-09-16 boundary: Marble tools only.

import { BROWSER_TOOLS } from '../server/agent/browser.js';

const MARBLE = new Set([
  'MCP:list_documents',
  'MCP:read_document',
  'MCP:apply_ops',
  'MCP:create_document',
  'MCP:read_guide',
  'MCP:check_document',
]);

const BROWSER = new Set(BROWSER_TOOLS.map((name) => `MCP:${name}`));

const full = process.env.MARBLE_CURSOR_CAPABILITY === 'full';

const allowed = (name) =>
  MARBLE.has(name) || (full && (BROWSER.has(name) || (name !== '' && !name.startsWith('MCP:'))));

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let name = '';
  try {
    name = String(JSON.parse(input || '{}').tool_name ?? '');
  } catch {
    // Unreadable input is not a reason to allow anything.
  }
  const answer = allowed(name)
    ? { permission: 'allow' }
    : {
        permission: 'deny',
        user_message: full
          ? 'Marble agents cannot use another MCP server'
          : 'Marble agents can only use Marble tools',
        agent_message: full
          ? 'Cursor\'s own tools, Marble\'s tools, and Marble\'s browser are available here. Another MCP server is not.'
          : 'Only the marble tools are available here: list_documents, read_document, apply_ops, create_document, check_document and read_guide.',
      };
  process.stdout.write(JSON.stringify(answer));
});
