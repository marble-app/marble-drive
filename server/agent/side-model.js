// The small jobs beside a turn: a chat's title (namer.js), the progress
// drawing (drawer.js), a callout's suggestions (offer.js), a build's picks and
// its answers to comments (build/pieces.js, build/reply.js), a few words read
// as one rule (change/intent.js), and fan_out's workers (change/fanout.js).
// Each asks a model one question with no tools and reads one answer.
//
// They used to call `claude` and nothing else, so on a drive whose only agent
// is ChatGPT's every one of them failed quietly; only titles fell back to
// Codex. They ask here instead, and this picks the CLI the way the namer did:
// Claude when it works (its login, a plan token an older Connect kept, an API
// key, or starter credit), else Codex (the ChatGPT login, or an OpenAI key).
// "Works" is each CLI's own word (`claude auth status`, `codex login status`),
// asked at most once a minute, and a run that is refused quickly moves on to
// the next way while the job's time lasts. A drive hosted for a person runs
// these on that person's own login, so they spend a little of their plan.
//
// A job asks in Claude's words: a model by Claude's name and a timeout. On
// Codex the name becomes one of Codex's own, in one table (CODEX_FOR_CLAUDE),
// and a model the account does not have falls back to Codex's default.

import os from 'node:os';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { claudeStatus } from './claude-signin.js';
import { codexStatus } from './codex-signin.js';
import { pickEnv } from './env.js';
import { creditSettings } from './providers/claude.js';
import { featuresOff, HEADLESS_OFF, NO_SHELL, tomlString } from './providers/codex.js';
import { runCommand } from './providers/exec.js';

/** How long "what works here" is believed. */
export const WAYS_TTL = 60_000;

/**
 * A Claude model, as a job names it, and what Codex runs instead: the tier
 * Codex's own catalog gives the same job (0.159.3: GPT-6-Luna "fast and
 * affordable", GPT-6.1-Sol the workhorse, GPT-6-Astra the frontier), at a
 * reasoning effort that keeps a small job as quick as Haiku's.
 */
export const CODEX_FOR_CLAUDE = {
  haiku: { model: 'gpt-6-luna', effort: 'low' },
  sonnet: { model: 'gpt-6.1-sol', effort: 'medium' },
  opus: { model: 'gpt-6.1-sol', effort: 'high' },
  fable: { model: 'gpt-6-astra', effort: 'high' },
};

/** The Codex model and effort for a Claude model name or id ("haiku",
 *  "claude-opus-5-5[1m]"). An effort the job asked for wins. */
export function codexFor(model, effort = null) {
  const name = String(model ?? '').toLowerCase();
  const family = ['fable', 'opus', 'sonnet', 'haiku'].find((f) => name.includes(f)) ?? 'haiku';
  const plan = CODEX_FOR_CLAUDE[family];
  const efforts = new Set(['low', 'medium', 'high', 'xhigh']);
  return { model: plan.model, effort: efforts.has(effort) ? effort : plan.effort };
}

/** Claude's way of asking: no tools, no MCP server of the login's, none of
 *  the person's settings, the answer as text, the question after `--` so it
 *  is never read as a flag. */
export function claudeArgs({ prompt, system = null, model = 'haiku', effort = null }) {
  return [
    '-p',
    '--model', model,
    ...(effort ? ['--effort', effort] : []),
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', 'project',
    ...(system ? ['--system-prompt', system] : []),
    '--output-format', 'text',
    '--', prompt,
  ];
}

/** Codex's: read-only, no shell and no browser of its own, none of the
 *  person's config, nothing kept; plain exec prints only the answer. */
export function codexArgs({ prompt, system = null, model = null, effort = 'low' }) {
  return [
    'exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config',
    '-s', 'read-only', '-c', 'approval_policy="never"',
    ...featuresOff([...NO_SHELL, ...HEADLESS_OFF]),
    ...(model ? ['-m', model] : []),
    '-c', `model_reasoning_effort=${tomlString(effort)}`,
    ...(system ? ['-c', `developer_instructions=${tomlString(system)}`] : []),
    '--', prompt,
  ];
}

// Codex saying the account cannot use that model, rather than that it failed.
const MODEL_REFUSED = /model[^\n]*(?:not (?:supported|available|found)|does not exist|unknown|isn't available|not have access)|(?:unknown|unsupported|invalid) model/i;

/** Where the CLIs are asked from: an empty folder, so a job never runs the
 *  person's hooks, skills or memory, and never touches their project. */
export async function scratch() {
  const dir = path.join(os.tmpdir(), 'marble-agent-namer');
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

const reason = (result) => (result.timedOut ? 'timed out' : String(result.stderr ?? '').trim().split('\n').at(-1) || `exit ${result.code}`);

/**
 * The helper every side job asks.
 *
 *   ways()          → [{ cli, how }], what works here now, best first
 *   run(request)    → what runCommand answers, plus `cli` and `how`;
 *                     `{ missing: true }` when nothing here can answer
 *   forget()        drop what it knew, after a sign-in, a sign-out or a key
 *
 * `env` is the host's environment and `secrets()` the drive's key file as
 * environment (keys.js), both read when a job runs. `ways` may be given
 * instead of asked, as a list or a function.
 */
export function createSideModel({ env = process.env, secrets = () => ({}), exec = runCommand, ways: given = null, ttl = WAYS_TTL, now = Date.now, log = console } = {}) {
  let known = null;
  const live = () => ({ ...(typeof env === 'function' ? env() : env), ...(typeof secrets === 'function' ? secrets() : secrets ?? {}) });

  async function detect() {
    const current = live();
    const found = [];
    const claude = await claudeStatus({ env: current, exec, timeout: 8_000 });
    if (claude.installed) {
      if (current.CLAUDE_CODE_OAUTH_TOKEN) found.push({ cli: 'claude', how: 'token' });
      // A status that did not answer in time is not a no: the run says.
      if (claude.signedIn || claude.timedOut) found.push({ cli: 'claude', how: 'login' });
      if (current.ANTHROPIC_API_KEY) found.push({ cli: 'claude', how: 'api' });
      if (creditSettings(current)) found.push({ cli: 'claude', how: 'credit' });
    }
    const codex = await codexStatus({ env: current, exec, timeout: 8_000 });
    if (codex.installed) {
      // The ChatGPT login only: `codex login --with-api-key` is a key too,
      // and a key kept here is the one that counts.
      if ((codex.signedIn && codex.method === 'chatgpt') || codex.timedOut) found.push({ cli: 'codex', how: 'chatgpt' });
      if (current.CODEX_API_KEY) found.push({ cli: 'codex', how: 'api' });
    }
    return found;
  }

  async function ways() {
    if (given) return typeof given === 'function' ? given() : given;
    if (known && now() - known.at < ttl) return known.list;
    const list = await detect();
    known = { at: now(), list };
    return list;
  }

  /** The environment one way runs in: the allowlist, and only the one
   *  secret that way is paid by. */
  function envFor(way, extra) {
    const current = live();
    const base = { ...pickEnv(current), ...extra };
    if (way.cli === 'claude') {
      if (way.how === 'token') return { ...base, CLAUDE_CODE_OAUTH_TOKEN: current.CLAUDE_CODE_OAUTH_TOKEN };
      if (way.how === 'api') return { ...base, ANTHROPIC_API_KEY: current.ANTHROPIC_API_KEY };
      if (way.how === 'credit') {
        const credit = creditSettings(current);
        return credit ? { ...base, ANTHROPIC_BASE_URL: credit.url, ANTHROPIC_API_KEY: credit.token } : base;
      }
      return base;
    }
    return way.how === 'api' ? { ...base, CODEX_API_KEY: current.CODEX_API_KEY } : base;
  }

  async function attempt(way, { prompt, system, model, effort, timeout, signal, cwd, env: extra, launch }) {
    const start = launch ?? exec;
    const options = { timeout, env: envFor(way, way.cli === 'claude' ? extra : {}), cwd, signal };
    if (way.cli === 'claude') return start('claude', claudeArgs({ prompt, system, model, effort }), options);
    const plan = codexFor(model, effort);
    const result = await start('codex', codexArgs({ prompt, system, ...plan }), options);
    if (!result?.code || result.aborted || !MODEL_REFUSED.test(`${result.stderr ?? ''}\n${result.stdout ?? ''}`)) return result;
    // Not one this account has: Codex's own default, at the same effort.
    return start('codex', codexArgs({ prompt, system, model: null, effort: plan.effort }), options);
  }

  /**
   * Ask one question. `job` names it in the log; `model` and `effort` are in
   * Claude's words; `env` is added for Claude only (MAX_THINKING_TOKENS);
   * `launch(command, args, options)` starts the process when the job has its
   * own way to (fan_out's workers go first when memory runs out).
   */
  async function run({ job = 'a side job', prompt, system = null, model = 'haiku', effort = null, timeout = 45_000, signal, cwd = null, env: extra = {}, launch = null } = {}) {
    const list = await ways();
    if (!list.length) return { code: null, stdout: '', stderr: '', missing: true, none: true };
    const dir = cwd ?? await scratch();
    const deadline = now() + timeout;
    let last = null;
    for (const [i, way] of list.entries()) {
      const left = deadline - now();
      if (signal?.aborted) return { code: null, stdout: '', stderr: '', aborted: true };
      if (i > 0 && left < 1_000) break;
      const result = { ...(await attempt(way, { prompt, system, model, effort, timeout: i ? left : timeout, signal, cwd: dir, env: extra, launch })), cli: way.cli, how: way.how };
      if (result.aborted || signal?.aborted) return { ...result, aborted: true };
      // Not installed after all: what works here has changed.
      if (result.missing) {
        known = null;
        last = result;
        continue;
      }
      // Refused (signed out, out of usage): the next way, while time lasts.
      // A timeout is the model being slow, and the job's time is spent.
      if (result.code && !result.timedOut && i < list.length - 1) {
        log.error?.(`[agents] ${job} on ${way.cli} (${way.how}) failed: ${reason(result)}; trying the next`);
        last = result;
        continue;
      }
      return result;
    }
    return last ?? { code: null, stdout: '', stderr: '', missing: true, none: true };
  }

  return { ways, run, forget: () => { known = null; } };
}

/** What a job runs on when nobody hands it the drive's helper: Claude on its
 *  login, which is what every one of them ran before there was a choice,
 *  started by `exec` in `env`. */
export const claudeOnLogin = ({ exec = runCommand, env = process.env } = {}) => (
  createSideModel({ exec, env, ways: [{ cli: 'claude', how: 'login' }] })
);
