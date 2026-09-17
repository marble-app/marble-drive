#!/usr/bin/env node
// Cursor's preToolUse hook for a Marble agent's workspace.
//
// cursor-agent has no flag that removes its own file and shell tools — the
// 2026-09-16 spike watched `--mode ask` and `--sandbox enabled` both let its
// edit tool write a file. A hook can refuse, though, and Cursor asks this one
// before every tool call. It allows Marble's tools by name and nothing else:
// not the built-in tools, and not another MCP server's differently named tools.
// The workspace registers it with `failClosed`, so a hook that crashes is a
// refusal too.
//
// What it cannot do: tell two servers' tools apart. Cursor tells it
// `tool_name: "MCP:read_document"` and nothing about which server that is
// (live payload, 2026-09-17), so a user-level server with a tool of the same
// name would be allowed. That is why the Cursor provider refuses to run while
// ~/.cursor/mcp.json names any server. Whether a user-level ~/.cursor/hooks.json
// runs alongside this hook, and how their answers combine, is unverified.

const ALLOWED = new Set([
  'MCP:list_documents',
  'MCP:read_document',
  'MCP:apply_ops',
  'MCP:create_document',
  'MCP:read_guide',
]);

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
  const answer = ALLOWED.has(name)
    ? { permission: 'allow' }
    : {
        permission: 'deny',
        user_message: 'Marble agents can only use Marble tools',
        agent_message: 'Only the marble tools are available here: list_documents, read_document, apply_ops, create_document and read_guide.',
      };
  process.stdout.write(JSON.stringify(answer));
});
