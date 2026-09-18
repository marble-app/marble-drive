// The provider adapter for `fake-agent.mjs`. Real adapters (Plan 2) have the
// same five members; this one's stream format is simply the fake agent's own.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-agent.mjs');

export function createFakeProvider({ scripts = {}, id = 'fake' } = {}) {
  return {
    id,
    label: 'Fake',
    // Scripted MCP calls, not a real CLI. Tests that want file tools set this
    // to `full` themselves.
    capability: 'documents',
    models: [{ id, label: 'Fake' }, { id: 'alt', label: 'Alt' }],
    efforts: ['low', 'high'],
    modes: [{ id: 'default', label: 'Default' }, { id: 'plan', label: 'Plan' }],
    detect: async () => ({ installed: true, signedIn: true, detail: 'scripted' }),
    lostSession: (error) => /no conversation found/i.test(error),
    spawn({ mcp, prompt, resume, env }) {
      const name = /^script:(\S+)/.exec(prompt)?.[1];
      return {
        command: process.execPath,
        args: [AGENT],
        env: {
          ...env,
          FAKE_SCRIPT: JSON.stringify(scripts[name] ?? []),
          FAKE_MCP: JSON.stringify(mcp),
          FAKE_RESUME: resume ?? '',
        },
        stdin: `${prompt}\n`,
        // Asks are answered on stdin while the turn runs.
        stdinOpen: true,
      };
    },
    parse(line) {
      const e = JSON.parse(line);
      switch (e.kind) {
        case 'session': return [{ type: 'session', id: e.id }];
        case 'delta': return [{ type: 'text.delta', text: e.text }];
        case 'text': return [{ type: 'text', text: e.text }];
        case 'call': return [{ type: 'tool.call', name: e.name, input: e.input, callId: e.callId }];
        case 'result': return [{ type: 'tool.result', callId: e.callId, ok: e.ok, summary: e.summary }];
        case 'ask': return [{ type: 'ask', requestId: e.requestId, tool: e.tool, displayName: e.tool, input: e.input, interactive: e.tool === 'AskUserQuestion' }];
        case 'done': return [{ type: 'done', ok: e.ok, error: e.error }];
        default: return [];
      }
    },
  };
}
