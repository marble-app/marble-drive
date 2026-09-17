// Claude Code as a Marble agent.
//
// The invocation is the one the 2026-09-16 spike proved: no built-in tools at
// all (`--tools ""`), only the marble MCP server (`--strict-mcp-config`), no
// user settings, hooks or CLAUDE.md from this machine (`--setting-sources
// project` over an empty workspace), and the prompt on stdin, because
// `--tools` takes a list and would swallow a trailing prompt as one of its
// values. `--bare` would also shed settings, but it skips the keychain the
// subscription login lives in.
//
// The two providers differ only in billing: the subscription gets no API key
// in its environment, so the CLI uses the login; the API provider hands it one.

import path from 'node:path';

import { pickEnv } from '../env.js';
import { INSTRUCTIONS } from '../instructions.js';
import { runCommand } from './exec.js';
import { writePrivateFile } from './private-file.js';

const PREFIX = 'mcp__marble__';
export const CLAUDE_MODELS = [
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'fable', label: 'Fable' },
];
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const SUMMARY = 200;

const toolName = (name) => (name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name);
const textOf = (content) =>
  Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('') : String(content ?? '');

/** One line of `claude -p --output-format stream-json` as the runner's events. */
export function parseClaudeLine(line) {
  const e = JSON.parse(line);
  switch (e.type) {
    case 'system':
      return e.subtype === 'init' && e.session_id ? [{ type: 'session', id: e.session_id }] : [];

    // A line with a parent_tool_use_id belongs to a subagent working inside a
    // tool call, not to the turn itself.
    case 'stream_event': {
      if (e.parent_tool_use_id) return [];
      const delta = e.event?.delta;
      return e.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text
        ? [{ type: 'text.delta', text: delta.text }]
        : [];
    }

    case 'assistant': {
      if (e.parent_tool_use_id) return [];
      const events = [];
      for (const block of e.message?.content ?? []) {
        if (block.type === 'text' && block.text) events.push({ type: 'text', text: block.text });
        if (block.type === 'tool_use') {
          events.push({ type: 'tool.call', name: toolName(block.name), input: block.input ?? {}, callId: block.id });
        }
      }
      return events;
    }

    case 'user': {
      if (e.parent_tool_use_id) return [];
      const events = [];
      for (const block of e.message?.content ?? []) {
        if (block.type !== 'tool_result') continue;
        events.push({
          type: 'tool.result',
          callId: block.tool_use_id,
          ok: !block.is_error,
          summary: textOf(block.content).slice(0, SUMMARY),
        });
      }
      return events;
    }

    case 'result': {
      const usage = e.usage ?? {};
      return [
        {
          type: 'usage',
          costUsd: e.total_cost_usd ?? null,
          inputTokens: usage.input_tokens ?? null,
          outputTokens: usage.output_tokens ?? null,
        },
        // `error_max_turns` and friends arrive with is_error false.
        e.is_error || e.subtype !== 'success'
          ? { type: 'done', ok: false, error: String(e.result || e.subtype || 'Claude reported an error') }
          : { type: 'done', ok: true },
      ];
    }

    default:
      return [];
  }
}

export function createClaudeProvider({ auth = 'subscription', exec = runCommand, env = process.env, secrets } = {}) {
  const api = auth === 'api';
  const live = () => ({ ...env, ...(typeof secrets === 'function' ? secrets() : secrets ?? {}) });

  return {
    id: api ? 'claude-api' : 'claude-subscription',
    label: api ? 'Claude (API key)' : 'Claude',

    async detect() {
      // The same allowlist a turn starts from. Asked with a key in the
      // environment, the CLI answers about the key, so the subscription is
      // asked without one. `secrets` is read now, not at boot, so a key set
      // in the settings panel is visible without a restart.
      const current = live();
      const probeEnv = pickEnv(current);
      if (api && current.ANTHROPIC_API_KEY) probeEnv.ANTHROPIC_API_KEY = current.ANTHROPIC_API_KEY;
      const probe = await exec('claude', ['auth', 'status'], { env: probeEnv });
      if (probe.missing) return { installed: false, signedIn: false, detail: 'claude is not installed' };

      if (api) {
        return current.ANTHROPIC_API_KEY
          ? { installed: true, signedIn: true, detail: 'ANTHROPIC_API_KEY is set' }
          : { installed: true, signedIn: false, detail: 'set ANTHROPIC_API_KEY to use Claude on the API' };
      }

      let status = null;
      try {
        status = JSON.parse(probe.stdout);
      } catch {
        // Not JSON: an older CLI, or one that failed. Either way, not signed in as far as we can tell.
      }
      if (status?.loggedIn) {
        return { installed: true, signedIn: true, detail: `signed in (${status.authMethod ?? 'claude'})` };
      }
      return {
        installed: true,
        signedIn: false,
        detail: probe.timedOut ? 'claude auth status timed out' : 'run `claude` once to sign in',
      };
    },

    models: CLAUDE_MODELS,
    efforts: CLAUDE_EFFORTS,

    async prepare({ workspace, mcp, skills = [] }) {
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      // The token in here is good for one turn, and nobody else's business.
      await writePrivateFile(path.join(workspace, 'mcp.json'), JSON.stringify(config, null, 2));
      if (skills.length) {
        const { installSkills } = await import('../skills.js');
        await installSkills(workspace, skills);
      }
    },

    spawn({ workspace, prompt, resume = null, model = null, effort = null }) {
      const current = live();
      const args = [
        '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--tools', '', '--strict-mcp-config', '--mcp-config', path.join(workspace, 'mcp.json'),
        '--allowedTools', 'mcp__marble', '--setting-sources', 'project',
        '--append-system-prompt', INSTRUCTIONS,
      ];
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      if (resume) args.push('--resume', resume);
      // Without a key the CLI would fall back to the login, and bill the
      // subscription for a conversation someone chose to put on the API.
      if (api && !current.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not set, so Claude (API key) cannot run — set it or choose Claude');
      }
      return {
        command: 'claude',
        args,
        env: api ? { ANTHROPIC_API_KEY: current.ANTHROPIC_API_KEY } : {},
        stdin: prompt,
      };
    },

    parse: (line) => parseClaudeLine(line),

    // `--resume` with a session the CLI has deleted.
    lostSession: (error) => /no conversation found/i.test(String(error ?? '')),
  };
}
