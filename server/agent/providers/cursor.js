// Cursor Agent as a Marble agent.
//
// Cursor cannot be told to drop its own tools, so the boundary is a hook
// (bin/marble-cursor-hook.js) that Cursor consults before every call, written
// into the conversation's workspace with `failClosed`. At capability `full`
// the hook allows those tools; `--add-dir` points them at the drive; cwd is
// the drive so the shell starts there. The MCP config, the hook and AGENTS.md
// stay in the conversation workspace, outside the drive, so the turn token
// never lands in a document.
//
// What the hook is told about a call is its name — `MCP:read_document` — and
// not which server it belongs to (checked against a live payload, 2026-09-17).
// `--approve-mcps` approves every server Cursor loads, and Cursor merges the
// user's own ~/.cursor/mcp.json into ours, so a user server with a tool named
// like one of Marble's would pass the hook. Until Cursor says which server a
// call is for, a machine with user-level MCP servers runs no Cursor turns.
//
// The default model is composer-2.5: on 2026-09-16 Cursor's default model was
// at its plan limit and composer-2.5 was not. A conversation's own model wins.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURSOR_MODES, groupCursorModels, resolveCursorModel } from '../catalog.js';
import { pickEnv } from '../env.js';
import { instructionsFor } from '../instructions.js';
import { runCommand } from './exec.js';
import { writePrivateFile } from './private-file.js';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'marble-cursor-hook.js');
const SUMMARY = 200;

/** One line of `cursor-agent models`: `id - Label` or `id - Label (default)`. */
export function parseCursorModels(text) {
  const models = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = /^(\S+)\s+-\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    models.push({ id: match[1], label: match[2].replace(/\s*\(default\)\s*$/i, '').trim() });
  }
  return models;
}

/** The names of the MCP servers in the user's own Cursor config. An absent or
 *  blank file has none; a file that cannot be read or parsed is not evidence
 *  of none, so it answers as if it had some. */
async function userMcpServers(userDir) {
  let text;
  try {
    text = await fsp.readFile(path.join(userDir, 'mcp.json'), 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? [] : ['unreadable mcp.json'];
  }
  if (!text.trim()) return [];
  try {
    const servers = JSON.parse(text)?.mcpServers;
    if (servers == null) return [];
    if (typeof servers !== 'object' || Array.isArray(servers)) return ['unreadable mcp.json'];
    return Object.keys(servers);
  } catch {
    return ['unreadable mcp.json'];
  }
}

/** One line of `cursor-agent -p --output-format stream-json --stream-partial-output`.
 *
 *  Cursor sends a message as fragments and then the whole message again. The
 *  fragments are what a person watches arrive; the whole message is what the
 *  transcript keeps — once. Fragments have `timestamp_ms` but no `model_call_id`;
 *  whole messages have `model_call_id`. `state.text` accumulates fragments.
 *  On a fragment: append text, emit `text.delta`. On a whole message: emit
 *  `{type:'text', text}` with the whole message's text, clear `state.text`. */
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

      // Fragment: has timestamp_ms and no model_call_id.
      // Whole message: has model_call_id or lacks timestamp_ms.
      const isFragment = e.timestamp_ms != null && e.model_call_id == null;

      if (isFragment) {
        // Fragment: accumulate and emit as delta.
        state.text += text;
        return [{ type: 'text.delta', text }];
      } else {
        // Whole message: emit it, clear fragments.
        state.text = '';
        return [{ type: 'text', text }];
      }
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
            // A built-in call's args can be a whole file (an edit's contents),
            // and the hook refused it anyway: a preview says what was tried.
            input: mcp ? call.args?.args ?? {} : { preview: JSON.stringify(call.args ?? {}).slice(0, 500) },
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

export function createCursorProvider({
  exec = runCommand,
  env = process.env,
  secrets,
  defaultModel = 'composer-2.5',
  hookPath = HOOK,
  userDir = path.join(os.homedir(), '.cursor'),
} = {}) {
  const live = () => ({ ...env, ...(typeof secrets === 'function' ? secrets() : secrets ?? {}) });

  return {
    id: 'cursor',
    label: 'Cursor',
    // Cursor has no `--restricted`. The drive is an extra `--add-dir`; the
    // conversation workspace still holds the turn token and the hook. The hook
    // allows Cursor's own tools at `full`, Marble's document tools, and Marble's
    // browser MCP. Another MCP server is still refused.
    capability: 'full',
    defaultModel,
    efforts: [],
    modes: CURSOR_MODES,
    groupModels: groupCursorModels,

    async listModels() {
      const probe = await exec('cursor-agent', ['models'], { env: pickEnv(live()) });
      if (probe.missing || probe.code) return [{ id: defaultModel, label: defaultModel }];
      const listed = parseCursorModels(probe.stdout);
      return listed.length ? listed : [{ id: defaultModel, label: defaultModel }];
    },

    async detect() {
      // The same allowlist a turn starts from, and the key a turn would get.
      const current = live();
      const probeEnv = pickEnv(current);
      if (current.CURSOR_API_KEY) probeEnv.CURSOR_API_KEY = current.CURSOR_API_KEY;
      const probe = await exec('cursor-agent', ['status'], { env: probeEnv });
      if (probe.missing) return { installed: false, signedIn: false, detail: 'cursor-agent is not installed' };
      const servers = await userMcpServers(userDir);
      if (servers.length) {
        return { installed: true, signedIn: false, detail: `blocked: user-level MCP servers in ~/.cursor/mcp.json (${servers.join(', ')})` };
      }
      const account = /Logged in as (\S+)/.exec(`${probe.stdout}\n${probe.stderr}`)?.[1];
      if (account) return { installed: true, signedIn: true, detail: `signed in as ${account}` };
      return {
        installed: true,
        signedIn: false,
        detail: probe.timedOut ? 'cursor-agent status timed out' : 'run `cursor-agent login`',
      };
    },

    async prepare({ workspace, mcp, browser = null, capability = 'documents' }) {
      const servers = await userMcpServers(userDir);
      if (servers.length) {
        throw new Error(
          `Cursor has user-level MCP servers (${servers.join(', ')}) in ~/.cursor/mcp.json; Marble cannot tell their tools from its own, so Cursor turns are off until they are removed`,
        );
      }
      // Cursor runs this through a shell. Double quotes survive a space in a
      // path; they do not make a quote, `$`, backtick or backslash inert.
      for (const part of [process.execPath, hookPath]) {
        if (/["$`\\]/.test(part)) throw new Error(`the Cursor hook command cannot be quoted safely: ${part}`);
      }
      const dir = path.join(workspace, '.cursor');
      await fsp.mkdir(dir, { recursive: true });

      const mcpFile = path.join(dir, 'mcp.json');
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      if (capability === 'full' && browser) config.mcpServers.browser = browser;
      await writePrivateFile(mcpFile, JSON.stringify(config, null, 2));

      const cap = capability === 'full' ? 'full' : 'documents';
      const hooks = {
        version: 1,
        hooks: {
          preToolUse: [{
            command: `MARBLE_CURSOR_CAPABILITY=${cap} "${process.execPath}" "${hookPath}"`,
            failClosed: true,
          }],
        },
      };
      await fsp.writeFile(path.join(dir, 'hooks.json'), JSON.stringify(hooks, null, 2));
      await fsp.writeFile(path.join(workspace, 'AGENTS.md'), instructionsFor(capability));
    },

    spawn({ workspace, prompt, resume = null, model = null, effort = null, mode = null, capability = 'documents', cwd = null }) {
      const current = live();
      const full = capability === 'full' && cwd;
      const args = [
        '-p', '--output-format', 'stream-json', '--stream-partial-output', '--approve-mcps', '--trust',
        '--workspace', workspace,
        ...(full ? ['--add-dir', cwd, '--sandbox', 'disabled'] : []),
        '--model', resolveCursorModel(model, effort, defaultModel),
      ];
      const run = mode || 'agent';
      if (run === 'plan' || run === 'ask') args.push('--mode', run);
      else if (run === 'review') args.push('--auto-review');
      else args.push('--yolo');
      if (resume) args.push('--resume', resume);
      args.push('--', prompt);
      return {
        command: 'cursor-agent',
        args,
        env: current.CURSOR_API_KEY ? { CURSOR_API_KEY: current.CURSOR_API_KEY } : {},
        stdin: '',
        ...(full ? { cwd } : {}),
      };
    },

    parse: (line, state) => parseCursorLine(line, state),

    // `--resume` with a chat Cursor no longer has.
    lostSession: (error) => /(chat|session|conversation)[^\n]*(not found|does not exist|no longer exists)/i.test(String(error ?? '')),
  };
}
