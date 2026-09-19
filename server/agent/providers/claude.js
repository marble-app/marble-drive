// Claude Code as a Marble agent.
//
// Two invocations, one per capability. A `documents` turn is the 2026-09-16
// spike: no built-in tools (`--tools ""`), only the marble MCP server, no user
// settings (`--setting-sources project` over an empty workspace), prompt on
// stdin. A `full` turn is the 2026-09-18 one: the CLI exactly as the terminal
// runs it — the person's own settings, plugins, skills, hooks, memory, MCP
// servers and subagents — with Marble's MCP server added by `--mcp-config`,
// the working directory set to the conversation's project, and permission
// prompts routed back to Marble over stream-json stdin so the person can
// answer them from the drawer.
//
// The two providers differ only in billing: the subscription gets no API key
// in its environment, so the CLI uses the login; the API provider hands it one.

import path from 'node:path';

import { CLAUDE_MODES } from '../catalog.js';
import { pickEnv } from '../env.js';
import { instructionsFor } from '../instructions.js';
import { runCommand } from './exec.js';
import { writePrivateFile } from './private-file.js';

export const CLAUDE_MODELS = [
  { id: 'haiku', label: 'Haiku 4.5' },
  { id: 'sonnet', label: 'Sonnet 5' },
  { id: 'opus', label: 'Opus 5' },
  { id: 'fable', label: 'Fable 5.1' },
];
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// The request id Marble gives the stream-json initialize handshake. Its reply
// carries the CLI's own skills list.
export const INIT_REQUEST_ID = 'marble-init';
const SUMMARY = 200;

const toolName = (name) => String(name ?? '').replace(/^mcp__[a-zA-Z0-9_-]+__/, '');
const textOf = (content) =>
  Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('') : String(content ?? '');
const skill = (name, description = '') => ({ id: String(name), name: String(name), description: String(description ?? '') });

// A tool that failed and a tool that was refused read the same on the wire —
// `is_error: true` — but they mean opposite things to the person watching. A
// command that exited 1 is the agent's own business; a refusal is a decision
// someone made, and the only one worth putting the word "Blocked" on. The CLI
// says which in the text: the auto-mode classifier names itself, a permission
// rule or handler says the request was denied, and a hook says it blocked.
const DENIAL = /\b(denied by the Claude Code auto mode classifier|permission (?:for this action |to use [^\n]*?)?(?:was |is )?denied|requested permissions[^\n]*?(?:denied|rejected)|operation not permitted by (?:a )?hook|blocked by (?:a )?hook)\b/i;

export const isDenial = (text) => DENIAL.test(String(text ?? ''));

/** One line of `claude -p --output-format stream-json` as the runner's events.
 *  `state` is the runner's per-turn scratch: what a line means can depend on
 *  the lines before it. */
export function parseClaudeLine(line, state = {}) {
  const e = JSON.parse(line);
  switch (e.type) {
    case 'system': {
      // Work the CLI is carrying that its own result does not wait for: a
      // subagent, a backgrounded command. Every task the CLI starts is
      // announced, and every task that ends is notified — including, on a
      // resumed session, tasks this process never started, which is why the
      // count is a set and not a tally.
      if (e.subtype === 'task_started' || e.subtype === 'task_notification') {
        const tasks = (state.tasks ??= new Set());
        if (e.subtype === 'task_started') tasks.add(e.task_id);
        else tasks.delete(e.task_id);
        return [{ type: 'background', pending: tasks.size }];
      }
      if (e.subtype !== 'init') return [];
      const events = [];
      if (e.session_id) events.push({ type: 'session', id: e.session_id });
      const names = Array.isArray(e.slash_commands) ? e.slash_commands : [];
      if (names.length) {
        events.push({ type: 'catalog', skills: names.map((name) => skill(name)), agents: Array.isArray(e.agents) ? e.agents : [] });
      }
      return events;
    }

    // The CLI needs the person: a permission prompt, or AskUserQuestion.
    case 'control_request': {
      const r = e.request ?? {};
      if (r.subtype !== 'can_use_tool') return [];
      return [{
        type: 'ask',
        requestId: e.request_id,
        tool: r.tool_name,
        displayName: r.display_name ?? r.tool_name,
        input: r.input ?? {},
        interactive: Boolean(r.requires_user_interaction),
      }];
    }

    // The answer to our initialize handshake lists the CLI's skills with
    // descriptions; any other reply is bookkeeping.
    case 'control_response': {
      const r = e.response ?? {};
      if (r.request_id !== INIT_REQUEST_ID || !Array.isArray(r.response?.commands)) return [];
      return [{ type: 'catalog', skills: r.response.commands.map((c) => skill(c.name, c.description)) }];
    }

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
        const text = textOf(block.content);
        events.push({
          type: 'tool.result',
          callId: block.tool_use_id,
          ok: !block.is_error,
          denied: Boolean(block.is_error) && isDenial(text),
          summary: text.slice(0, SUMMARY),
        });
      }
      return events;
    }

    case 'result': {
      // A result with no model turns behind it is not an answer. It is what
      // the CLI prints when it flushes a notification queued before this
      // process existed, ahead of reading the prompt it was given. Treating
      // it as the end closed stdin under an agent that had not begun.
      if (e.num_turns === 0) return [];
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
    label: api ? 'KIXLAB API' : 'Claude',
    capability: 'full',

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
    modes: CLAUDE_MODES,

    async prepare({ workspace, mcp, browser = null, capability = 'documents' }) {
      const config = { mcpServers: { marble: { command: mcp.command, args: mcp.args, env: mcp.env } } };
      if (capability === 'full' && browser) config.mcpServers.browser = browser;
      // The token in here is good for one turn, and nobody else's business.
      await writePrivateFile(path.join(workspace, 'mcp.json'), JSON.stringify(config, null, 2));
    },

    spawn({ workspace, prompt, resume = null, model = null, effort = null, mode = null, capability = 'documents', kind = 'drive', cwd = null }) {
      const current = live();
      const full = capability === 'full';
      // A conversation from before modes had `auto` stored `default`.
      const permission = !mode || mode === 'default' ? 'auto' : mode;
      const args = full
        ? [
            '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages',
            // The person's own mode; whatever it would prompt for comes to us on stdout.
            '--permission-mode', permission,
            '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio',
            // Marble's server is added to whatever the person configured, not swapped for it.
            '--mcp-config', path.join(workspace, 'mcp.json'),
            '--append-system-prompt', instructionsFor('full', kind),
          ]
        : [
            '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
            '--tools', '', '--strict-mcp-config', '--mcp-config', path.join(workspace, 'mcp.json'),
            '--allowedTools', 'mcp__marble', '--setting-sources', 'project',
            '--append-system-prompt', instructionsFor('documents'),
          ];
      if (full && permission === 'bypassPermissions') args.push('--allow-dangerously-skip-permissions');
      if (!full && mode && mode !== 'default') {
        args.push('--permission-mode', mode);
        if (mode === 'bypassPermissions') args.push('--allow-dangerously-skip-permissions');
      }
      // No model or effort means the person's own settings.json — the terminal default.
      if (model) args.push('--model', model);
      if (effort) args.push('--effort', effort);
      if (resume) args.push('--resume', resume);
      // Without a key the CLI would fall back to the login, and bill the
      // subscription for a conversation someone chose to put on the API.
      if (api && !current.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not set, so KIXLAB API cannot run — set it or choose Claude');
      }
      // A full turn speaks stream-json: the initialize handshake first (it is
      // what makes AskUserQuestion available and answers with the skills
      // list), then the prompt as a user message. stdin stays open for the
      // control responses that answer prompts.
      const stdin = full
        ? `${JSON.stringify({ type: 'control_request', request_id: INIT_REQUEST_ID, request: { subtype: 'initialize', hooks: {} } })}\n${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`
        : prompt;
      return {
        command: 'claude',
        args,
        env: api ? { ANTHROPIC_API_KEY: current.ANTHROPIC_API_KEY } : {},
        stdin,
        ...(full ? { stdinOpen: true } : {}),
        // A full agent works in its project. A documents agent keeps its empty
        // workspace, where its own tools — if any ever got through — find
        // nothing.
        ...(full && cwd ? { cwd } : {}),
      };
    },

    parse: (line, state) => parseClaudeLine(line, state),

    // `--resume` with a session the CLI has deleted.
    lostSession: (error) => /no conversation found/i.test(String(error ?? '')),
  };
}
