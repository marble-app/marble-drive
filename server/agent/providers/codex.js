// Codex as a Marble agent.
//
// `codex exec --json`, which is what @openai/codex-sdk runs and reads: the
// prompt on stdin, one event per line on stdout, and `resume <thread>` for
// every turn after the first. The runner already owns the process (Stop, the
// stall check, first-to-go, resume), so the SDK would only be a second owner
// in between.
//
// A full turn is the terminal's own Codex: the person's ~/.codex config, its
// skills, AGENTS.md and MCP servers, with Marble's two MCP servers added by
// `-c` and Marble's rules as developer instructions. The servers are named
// marble_drive and marble_browser, so a server of the person's own called
// `marble` is left alone. The turn token and the browser's pass are listed in
// `env_vars` and travel in the environment, never in argv.
//
// One agent, two ways to pay. An OpenAI key set in Agents settings goes in as
// CODEX_API_KEY, the variable `codex exec` reads (OPENAI_API_KEY it ignores,
// checked 2026-10-01 on 0.154); without one, the ChatGPT login does.
//
// exec has no channel for asking the person, so there are no asks: the mode is
// a sandbox chosen up front, and Codex asks its questions in text.

import fs from 'node:fs';
import path from 'node:path';

import { CODEX_MODES } from '../catalog.js';
import { pickEnv } from '../env.js';
import { instructionsFor } from '../instructions.js';
import { PLUGIN_DIR, PLUGIN_NAME } from '../skills.js';
import { runCommand } from './exec.js';

// The efforts every listed model shares, for the settings panel's one menu.
// The composer offers each model its own (parseCodexModels).
export const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const EFFORT_LABELS = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra' };
const SANDBOX = { full: 'danger-full-access', workspace: 'workspace-write', read: 'read-only' };
const SUMMARY = 200;

/** A TOML basic string. JSON's escapes are TOML's, except that TOML refuses a
 *  raw DEL and an escaped lone surrogate, so neither is left to reach it. */
export const tomlString = (value) => JSON.stringify(String(value ?? '').toWellFormed()).replace(/\u007f/g, '\\u007f');
const tomlList = (values) => `[${values.map(tomlString).join(', ')}]`;

// Codex models are OpenAI's; a Claude family, a Claude API pin or a Cursor id
// left on a conversation that switched agents is not one of them.
const isCodexModel = (model) => /^(gpt|o\d|codex)/i.test(String(model ?? ''));

/** `codex debug models` as the picker's list: the models Codex itself lists,
 *  in its order, each with the efforts it takes. */
export function parseCodexModels(text) {
  let catalog;
  try {
    catalog = JSON.parse(String(text ?? ''));
  } catch {
    return [];
  }
  const models = Array.isArray(catalog?.models) ? catalog.models : Array.isArray(catalog) ? catalog : [];
  return models
    .filter((m) => m?.slug && (m.visibility ?? 'list') === 'list')
    .map((m) => ({
      id: String(m.slug),
      label: String(m.display_name || m.slug),
      efforts: (m.supported_reasoning_levels ?? [])
        .map((level) => String(level?.effort ?? ''))
        .filter((id) => EFFORTS.has(id))
        .map((id) => ({ id, label: EFFORT_LABELS[id] })),
      // No effort is a choice too: the model's own default.
      hasBare: true,
    }));
}

/** The command Codex was asked to run, without the shell it wraps it in:
 *  `/bin/zsh -lc 'echo hi'` is `echo hi`. */
function unwrapShell(command) {
  const text = String(command ?? '');
  const single = /^\S*\/(?:ba|z)?sh -lc '([\s\S]*)'$/.exec(text);
  if (single) return single[1].replace(/'\\''/g, "'");
  const double = /^\S*\/(?:ba|z)?sh -lc "([\s\S]*)"$/.exec(text);
  if (double) return double[1].replace(/\\(["\\$`])/g, '$1');
  return text;
}

const mcpText = (result) =>
  (Array.isArray(result?.content) ? result.content : []).map((c) => (c?.type === 'text' ? c.text : '')).join('');

/** The call an item is, for the transcript. */
function callOf(item) {
  switch (item.type) {
    case 'command_execution':
      return { name: 'Bash', input: { command: unwrapShell(item.command) } };
    case 'mcp_tool_call':
      return { name: String(item.tool ?? 'tool'), input: item.arguments ?? {} };
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      return { name: 'Edit', input: { file_path: changes[0]?.path ?? '', changes } };
    }
    case 'web_search':
      return { name: 'WebSearch', input: { query: String(item.query ?? '') } };
    default:
      return null;
  }
}

/** How the call an item is came out. */
function resultOf(item) {
  switch (item.type) {
    case 'command_execution':
      return { ok: item.status === 'completed' && item.exit_code === 0, summary: String(item.aggregated_output ?? '') };
    case 'mcp_tool_call':
      return {
        ok: item.status === 'completed' && !item.error,
        summary: item.error ? String(item.error.message ?? item.error) : mcpText(item.result),
      };
    case 'file_change':
      return { ok: item.status === 'completed', summary: (item.changes ?? []).map((c) => `${c.kind} ${c.path}`).join('\n') };
    default:
      return { ok: item.status !== 'failed', summary: String(item.query ?? '') };
  }
}

/** Codex's failure without what only its own log needs: everything from
 *  ", url:" on is the endpoint, the Cloudflare ray and the request id. */
const plainError = (message) => {
  const text = String(message ?? '').trim();
  const cut = text.search(/,\s*url:\s/);
  return (cut > 0 ? text.slice(0, cut) : text) || 'Codex reported an error';
};

/** One line of `codex exec --json` as the runner's events. `state` remembers
 *  which items have been announced, so a result never arrives before its call. */
export function parseCodexLine(line, state = {}) {
  const e = JSON.parse(line);
  const started = (state.started ??= new Set());
  switch (e.type) {
    case 'thread.started':
      return e.thread_id ? [{ type: 'session', id: String(e.thread_id) }] : [];

    case 'item.started': {
      const item = e.item ?? {};
      const call = callOf(item);
      if (!call || started.has(item.id)) return [];
      started.add(item.id);
      return [{ type: 'tool.call', ...call, callId: item.id }];
    }

    case 'item.completed': {
      const item = e.item ?? {};
      if (item.type === 'agent_message') return item.text ? [{ type: 'text', text: String(item.text) }] : [];
      const call = callOf(item);
      // Reasoning, the plan list and transport notices are not the turn's words.
      if (!call) return [];
      const events = [];
      if (!started.has(item.id)) events.push({ type: 'tool.call', ...call, callId: item.id });
      started.delete(item.id);
      const { ok, summary } = resultOf(item);
      events.push({ type: 'tool.result', callId: item.id, ok, summary: summary.slice(0, SUMMARY) });
      return events;
    }

    case 'turn.completed': {
      const usage = e.usage ?? {};
      return [
        { type: 'usage', inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null },
        { type: 'done', ok: true },
      ];
    }

    // The end of a turn that went wrong. The `error` lines before it are
    // Codex retrying; it says when it has given up, here.
    case 'turn.failed':
      return [{ type: 'done', ok: false, error: plainError(e.error?.message) }];

    default:
      return [];
  }
}

/** The app's own skills, which Codex cannot be handed as a plugin. They are
 *  named with where they are, and Codex reads one when it fits — how it uses
 *  its own skills too. Read once: they ship with the release. */
let appSkills = null;
function appSkillsText(dir = path.join(PLUGIN_DIR, 'skills')) {
  if (appSkills !== null) return appSkills;
  const rows = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name, 'SKILL.md');
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const description = /^description:\s*(.*)$/m.exec(front)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
    rows.push(`- ${PLUGIN_NAME}:${entry.name} — ${file}${description ? `: ${description}` : ''}`);
  }
  appSkills = rows.length
    ? `Marble's own skills are files rather than installed skills here. When the text above names one, or a task fits one below, read its SKILL.md before you start and follow it:\n${rows.join('\n')}`
    : '';
  return appSkills;
}

// Marble's tools are approved up front. They refuse what Marble's rules
// forbid themselves (read before write, stale edits, other documents), and in
// a sandbox Codex would otherwise want an approval that exec cannot ask for,
// and refuse every call (seen 2026-10-01 in read-only).
const serverArgs = (name, server) => [
  '-c', `mcp_servers.${name}.command=${tomlString(server.command)}`,
  '-c', `mcp_servers.${name}.args=${tomlList(server.args ?? [])}`,
  '-c', `mcp_servers.${name}.env_vars=${tomlList(Object.keys(server.env ?? {}))}`,
  '-c', `mcp_servers.${name}.default_tools_approval_mode="approve"`,
];

export function createCodexProvider({ exec = runCommand, env = process.env, secrets } = {}) {
  const live = () => ({ ...env, ...(typeof secrets === 'function' ? secrets() : secrets ?? {}) });
  const keyOf = (current) => String(current.CODEX_API_KEY ?? '').trim();

  return {
    id: 'codex',
    label: 'Codex',
    capability: 'full',
    // No model means the person's own config.toml — the terminal default.
    defaultModel: null,
    efforts: CODEX_EFFORTS,
    modes: CODEX_MODES,

    async listModels() {
      const probe = await exec('codex', ['debug', 'models'], { env: pickEnv(live()), timeout: 10_000 });
      if (probe.missing || probe.code) return [];
      return parseCodexModels(probe.stdout);
    },

    async detect() {
      // The same allowlist a turn starts from. The key is not handed to the
      // probe: `login status` answers about ~/.codex, and a key set here is
      // signed in by being set.
      const current = live();
      const probeEnv = pickEnv(current);
      const version = await exec('codex', ['--version'], { env: probeEnv });
      if (version.missing) return { installed: false, signedIn: false, detail: 'codex is not installed' };
      if (keyOf(current)) return { installed: true, signedIn: true, detail: 'on an OpenAI API key' };
      const status = await exec('codex', ['login', 'status'], { env: probeEnv });
      const text = `${status.stdout ?? ''}\n${status.stderr ?? ''}`;
      if (status.code === 0 && /\blogged in\b/i.test(text) && !/\bnot logged in\b/i.test(text)) {
        return { installed: true, signedIn: true, detail: /chatgpt/i.test(text) ? 'signed in with ChatGPT' : 'signed in' };
      }
      return {
        installed: true,
        signedIn: false,
        detail: status.timedOut ? 'codex login status timed out' : 'add an OpenAI API key, or run `codex login`',
      };
    },

    // Nothing to write: Codex takes its servers and instructions as flags, so
    // the turn token is never in a file of its own.
    async prepare() {},

    spawn({ workspace, prompt, resume = null, model = null, effort = null, mode = null, capability = 'documents', kind = 'drive', cwd = null, mcp, browser = null }) {
      const current = live();
      const full = capability === 'full' && Boolean(cwd);
      const where = full ? cwd : workspace;
      const sandbox = full ? SANDBOX[mode] ?? SANDBOX.full : SANDBOX.read;
      const instructions = full
        ? [instructionsFor('full', kind), appSkillsText()].filter(Boolean).join('\n\n')
        : instructionsFor('documents');
      const args = ['exec', '--json', '--skip-git-repo-check', '-C', where, '-s', sandbox];
      // A documents turn gets none of the person's own Codex: no MCP servers
      // of theirs, no instructions, no hooks. Its shell can only read.
      if (!full) args.push('--ignore-user-config');
      if (isCodexModel(model)) args.push('-m', String(model));
      if (EFFORTS.has(effort)) args.push('-c', `model_reasoning_effort=${tomlString(effort)}`);
      args.push('-c', `developer_instructions=${tomlString(instructions)}`);
      const childEnv = { ...(mcp?.env ?? {}) };
      if (mcp) args.push(...serverArgs('marble_drive', mcp));
      if (full && browser) {
        args.push(...serverArgs('marble_browser', browser));
        Object.assign(childEnv, browser.env ?? {});
      }
      const key = keyOf(current);
      if (key) childEnv.CODEX_API_KEY = key;
      if (resume) args.push('resume', String(resume));
      args.push('-');
      return {
        command: 'codex',
        args,
        env: childEnv,
        stdin: prompt,
        ...(full ? { cwd } : {}),
      };
    },

    parse: (line, state) => parseCodexLine(line, state),

    /** What a run that ended without a `turn.failed` died of: Codex's own
     *  `Error:` line, not the first thing on stderr, which is often a log line
     *  from one of the person's MCP servers. */
    failure(stderr) {
      const lines = String(stderr ?? '').split('\n').filter((l) => /^Error:\s/.test(l));
      return lines.length ? lines.at(-1).replace(/^Error:\s*/, '').trim() : null;
    },

    // `resume` with a thread whose rollout this machine does not have.
    lostSession: (error) => /no rollout found|thread\/resume failed/i.test(String(error ?? '')),
  };
}
