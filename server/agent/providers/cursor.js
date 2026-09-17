// Cursor Agent as a Marble agent.
//
// Cursor cannot be told to drop its own tools, so the boundary is a hook
// (bin/marble-cursor-hook.js) that Cursor consults before every call, written
// into the conversation's workspace with `failClosed`. The MCP config and the
// instructions live in the same workspace, which is outside the drive, so even
// a tool that slipped past the hook would find nothing there worth touching.
//
// The default model is composer-2.5: on 2026-09-16 Cursor's default model was
// at its plan limit and composer-2.5 was not. A conversation's own model wins.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INSTRUCTIONS } from '../instructions.js';
import { runCommand } from './exec.js';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'marble-cursor-hook.js');
const SUMMARY = 200;

/** One line of `cursor-agent -p --output-format stream-json --stream-partial-output`.
 *
 *  Cursor sends a message as fragments and then the whole message again. The
 *  fragments are what a person watches arrive; the whole message is what the
 *  transcript keeps — once. `state.text` is the fragments so far. */
export function parseCursorLine(line, state) {
  const e = JSON.parse(line);
  state.text ??= '';

  const pending = () => {
    if (!state.text) return [];
    const text = state.text;
    state.text = '';
    return [{ type: 'text', text }];
  };

  switch (e.type) {
    case 'system':
      return e.subtype === 'init' && e.session_id ? [{ type: 'session', id: e.session_id }] : [];

    case 'assistant': {
      const text = (e.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (!text) return [];
      if (state.text && text === state.text) {
        state.text = '';
        return [{ type: 'text', text }];
      }
      state.text += text;
      return [{ type: 'text.delta', text }];
    }

    case 'tool_call': {
      const kind = Object.keys(e.tool_call ?? {}).find((key) => key.endsWith('ToolCall'));
      // Cursor's own lookup of the MCP schemas is bookkeeping, not work.
      if (!kind || kind === 'getMcpToolsToolCall') return [];
      const call = e.tool_call[kind];
      const mcp = kind === 'mcpToolCall';

      if (e.subtype === 'started') {
        return [
          ...pending(),
          {
            type: 'tool.call',
            name: mcp ? call.args?.toolName : kind.replace(/ToolCall$/, ''),
            input: mcp ? call.args?.args ?? {} : call.args ?? {},
            callId: e.call_id,
          },
        ];
      }

      if (e.subtype === 'completed') {
        const result = call.result ?? {};
        const content = Array.isArray(result.success?.content)
          ? result.success.content.map((c) => c.text?.text ?? '').join('')
          : '';
        return [
          {
            type: 'tool.result',
            callId: e.call_id,
            ok: Boolean(result.success) && !result.success.isError,
            summary: (content || String(result.rejected?.reason ?? result.error?.message ?? '')).slice(0, SUMMARY),
          },
        ];
      }
      return [];
    }

    case 'result': {
      const usage = e.usage ?? {};
      return [
        ...pending(),
        { type: 'usage', inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null },
        e.is_error
          ? { type: 'done', ok: false, error: String(e.result || 'Cursor reported an error') }
          : { type: 'done', ok: true },
      ];
    }

    default:
      return [];
  }
}

export function createCursorProvider({ exec = runCommand, env = process.env, defaultModel = 'composer-2.5', hookPath = HOOK } = {}) {
  return {
    id: 'cursor',
    label: 'Cursor',

    async detect() {
      const probe = await exec('cursor-agent', ['status']);
      if (probe.missing) return { installed: false, signedIn: false, detail: 'cursor-agent is not installed' };
      const account = /Logged in as (\S+)/.exec(`${probe.stdout}\n${probe.stderr}`)?.[1];
      if (account) return { installed: true, signedIn: true, detail: `signed in as ${account}` };
      return {
        installed: true,
        signedIn: false,
        detail: probe.timedOut ? 'cursor-agent status timed out' : 'run `cursor-agent login`',
      };
    },

    async prepare({ workspace, mcp }) {
      const dir = path.join(workspace, '.cursor');
      await fsp.mkdir(dir, { recursive: true });

      const mcpFile = path.join(dir, 'mcp.json');
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      await fsp.writeFile(mcpFile, JSON.stringify(config, null, 2), { mode: 0o600 });
      await fsp.chmod(mcpFile, 0o600);

      const hooks = {
        version: 1,
        hooks: { preToolUse: [{ command: `"${process.execPath}" "${hookPath}"`, failClosed: true }] },
      };
      await fsp.writeFile(path.join(dir, 'hooks.json'), JSON.stringify(hooks, null, 2));
      await fsp.writeFile(path.join(workspace, 'AGENTS.md'), INSTRUCTIONS);
    },

    spawn({ workspace, prompt, resume = null, model = null }) {
      const args = [
        '-p', '--output-format', 'stream-json', '--stream-partial-output', '--approve-mcps', '--trust',
        '--workspace', workspace, '--model', model ?? defaultModel,
      ];
      if (resume) args.push('--resume', resume);
      args.push(prompt);
      return {
        command: 'cursor-agent',
        args,
        env: env.CURSOR_API_KEY ? { CURSOR_API_KEY: env.CURSOR_API_KEY } : {},
        stdin: '',
      };
    },

    parse: (line, state) => parseCursorLine(line, state),
  };
}
