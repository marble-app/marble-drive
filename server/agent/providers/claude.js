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

import fsp from 'node:fs/promises';
import path from 'node:path';

import { INSTRUCTIONS } from '../instructions.js';
import { runCommand } from './exec.js';

const PREFIX = 'mcp__marble__';
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

    case 'stream_event': {
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
        e.is_error
          ? { type: 'done', ok: false, error: String(e.result || e.subtype || 'Claude reported an error') }
          : { type: 'done', ok: true },
      ];
    }

    default:
      return [];
  }
}

export function createClaudeProvider({ auth = 'subscription', exec = runCommand, env = process.env } = {}) {
  const api = auth === 'api';

  return {
    id: api ? 'claude-api' : 'claude-subscription',
    label: api ? 'Claude (API key)' : 'Claude',

    async detect() {
      const probeEnv = { ...env };
      // Asked with a key in the environment, the CLI answers about the key.
      if (!api) delete probeEnv.ANTHROPIC_API_KEY;
      const probe = await exec('claude', ['auth', 'status'], { env: probeEnv });
      if (probe.missing) return { installed: false, signedIn: false, detail: 'claude is not installed' };

      if (api) {
        return env.ANTHROPIC_API_KEY
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

    async prepare({ workspace, mcp }) {
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      // The token in here is good for one turn, and nobody else's business.
      await fsp.writeFile(path.join(workspace, 'mcp.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
      await fsp.chmod(path.join(workspace, 'mcp.json'), 0o600);
    },

    spawn({ workspace, prompt, resume = null, model = null }) {
      const args = [
        '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--tools', '', '--strict-mcp-config', '--mcp-config', path.join(workspace, 'mcp.json'),
        '--allowedTools', 'mcp__marble', '--setting-sources', 'project', '--disable-slash-commands',
        '--append-system-prompt', INSTRUCTIONS,
      ];
      if (model) args.push('--model', model);
      if (resume) args.push('--resume', resume);
      return {
        command: 'claude',
        args,
        env: api && env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {},
        stdin: prompt,
      };
    },

    parse: (line) => parseClaudeLine(line),
  };
}
