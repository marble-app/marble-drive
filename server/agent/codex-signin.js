// Connecting the person's own ChatGPT plan from the browser, through Codex's
// own device sign-in (spec "Their own Claude or ChatGPT"). `codex login
// --device-auth` asks OpenAI for a one-time code, prints OpenAI's device page
// and the code, and waits. The person opens the page, signs in there and types
// the code; OpenAI then hands the login straight to the waiting command, which
// keeps it in the drive's home (~/.codex) and exits 0. Nothing comes back
// through here: this reads the page and the code off what the command prints,
// and whether it worked off its exit and `codex login status`. It never opens
// the file Codex keeps the login in.
//
// Codex is held to the rules Anthropic sets for hosting Claude Code (the
// command as published, every sign-in method kept, the provider's own page,
// the login never collected), since OpenAI has published none of its own.
//
// Unlike Claude's, this one reads nothing from the page, so it runs on plain
// pipes, not a pseudo-terminal. `codex` is a small Node launcher that starts
// the real binary as its child, and killing the launcher alone would leave
// the child asking OpenAI for fifteen minutes; so the command gets a process
// group of its own, and the whole group is what is ended.
//
// One sign-in at a time. Starting again ends the one before, and one nobody
// finishes is ended after fifteen minutes, when its code runs out anyway.

import { spawn } from 'node:child_process';

import { joinWrapped, stripTerminal, URL_CHARS } from './claude-signin.js';
import { pickEnv } from './env.js';
import { runCommand } from './providers/exec.js';
import { SignInError, watchRun } from './sign-in-run.js';

/** How long a started sign-in waits for the person before it is ended: the
 *  life of OpenAI's code. */
export const SIGN_IN_WAIT_MS = 15 * 60_000; // MARBLE_DRIVE_CODEX_SIGNIN_SECONDS
/** How long `codex login --device-auth` has to print the page and the code. */
export const CODE_WAIT_MS = 30_000;
/** OpenAI's device page, when the command names none (it always has). */
export const DEVICE_PAGE = 'https://auth.openai.com/codex/device';

/** OpenAI's device page as the command printed it, or null. A link cut
 *  across lines by a narrow terminal is joined back together. */
export function findDeviceUrl(raw) {
  const lines = stripTerminal(raw).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const found = /https:\/\/[^\s]+/.exec(lines[i]);
    if (!found) continue;
    // A link at the end of its line may run on to the next, and one on the
    // last line may still be arriving.
    const ends = found.index + found[0].length >= lines[i].trimEnd().length;
    if (ends && i === lines.length - 1) return null;
    const url = ends ? joinWrapped(lines, i, found[0], URL_CHARS) : found[0];
    if (url && /^https:\/\/([a-z0-9-]+\.)*openai\.com\//i.test(url) && /device/i.test(url)) return url;
  }
  return null;
}

// A one-time code: letters and digits in groups joined by a dash, the way
// Codex prints it ("H43K-IT446").
const CODE = /^[A-Z0-9]{3,10}(?:-[A-Z0-9]{3,10})+$/;

/** The one-time code the command printed, or null: the first word that looks
 *  like one on the lines after it says "one-time code". */
export function findDeviceCode(raw) {
  const lines = stripTerminal(raw).split('\n');
  const said = lines.findIndex((line) => /one-time code/i.test(line));
  if (said === -1) return null;
  // The last line may still be arriving.
  for (const line of lines.slice(said + 1, lines.length - 1)) {
    const word = line.trim().split(/\s+/)[0] ?? '';
    if (CODE.test(word)) return word;
    if (/^(?:continue|\d+\.)/i.test(line.trim())) break;
  }
  return null;
}

/** How many minutes the command said its code lasts, or null. */
export function findExpiry(raw) {
  const found = /expires in (\d+) minutes?/i.exec(stripTerminal(raw));
  return found ? Number(found[1]) : null;
}

/** What the command said went wrong, or null: its own "Error logging in"
 *  line, whole. */
export function findDeviceError(raw) {
  const text = stripTerminal(raw);
  const said = /(?:^|\n)[ \t]*Error logging in(?: with device code)?:[ \t]*([^\n]+)\n/i.exec(text);
  if (said) return said[1].trim();
  const other = /(?:^|\n)[ \t]*(?:Error|error):[ \t]*([^\n]+)\n/.exec(text);
  return other ? other[1].trim() : null;
}

/** How Codex is signed in here, as `codex login status` says (it answers on
 *  stderr): `chatgpt` for the ChatGPT login, `api-key` for a key it keeps
 *  itself, null when signed out. Asked with no key in the environment, so
 *  the answer is about the login. */
export async function codexStatus({ command = 'codex', env = process.env, exec = runCommand, timeout = 10_000 } = {}) {
  const probe = await exec(command, ['login', 'status'], { env: pickEnv(env), timeout });
  if (probe.missing) return { installed: false, signedIn: false, method: null };
  const text = `${probe.stdout ?? ''}\n${probe.stderr ?? ''}`;
  const signedIn = probe.code === 0 && /\blogged in\b/i.test(text) && !/\bnot logged in\b/i.test(text);
  const method = !signedIn ? null : /using chatgpt/i.test(text) ? 'chatgpt' : /api key/i.test(text) ? 'api-key' : 'other';
  return { installed: true, signedIn, method, ...(probe.timedOut ? { timedOut: true } : {}) };
}

/** `codex logout`: Codex forgets the login it keeps under this home. */
export async function codexLogout({ command = 'codex', env = process.env, exec = runCommand, timeout = 15_000 } = {}) {
  const result = await exec(command, ['logout'], { env: pickEnv(env), timeout });
  if (result.missing) return { ok: false, missing: true };
  return { ok: result.code === 0, detail: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 300) };
}

/** A command and everything it started, ended at once. */
const killGroup = (child) => {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
};

/**
 * One drive's ChatGPT sign-in.
 *
 *   start()   → { url, code, expiresAt }   runs `codex login --device-auth`
 *   status()  → { state, url, code, expiresAt, error }
 *   cancel()                               ends whatever is running
 *
 * `state` is idle, waiting (for the person on OpenAI's page), checking (the
 * command exited 0 and `codex login status` is being asked), signed-in,
 * expired (fifteen minutes passed), failed (with `error`, a sentence a person
 * can act on) or ended (cancelled, or started again). `onSignedIn` is called
 * once when the login lands, whether or not a page is still asking.
 */
export function createCodexSignIn({
  command = 'codex',
  env = () => process.env,
  waitMs = SIGN_IN_WAIT_MS,
  codeWaitMs = CODE_WAIT_MS,
  spawnProcess = spawn,
  exec = runCommand,
  now = Date.now,
  onSignedIn = async () => {},
  log = console,
} = {}) {
  let session = null;
  // How the last one ended, until the next starts: a page that polls after
  // the login landed, or after the code ran out, is told so.
  let last = { state: 'idle' };
  const baseEnv = () => (typeof env === 'function' ? env() : env);

  function view(it) {
    return { state: it.state, url: it.url, code: it.userCode, expiresAt: it.expiresAt, ...(it.error ? { error: it.error } : {}) };
  }

  async function settle(it) {
    if (it.ended === 'exited' && it.exitCode === 0) {
      it.state = 'checking';
      const status = await codexStatus({ command, env: baseEnv(), exec });
      if (status.signedIn && status.method === 'chatgpt') {
        it.state = 'signed-in';
        try {
          await onSignedIn();
        } catch (err) {
          log.error?.(`[codex sign-in] after signing in: ${err.message}`);
        }
      } else {
        it.state = 'failed';
        it.error = "Codex finished, but isn't signed in to ChatGPT. Get a new code to try again.";
        log.error?.(`[codex sign-in] exited 0, but codex login status says ${status.method ?? 'signed out'}`);
      }
    } else if (it.ended === 'exited' || it.ended === 'failed') {
      const said = findDeviceError(`${it.output}\n`);
      it.state = said && /timed out|expired/i.test(said) ? 'expired' : 'failed';
      it.error = it.state === 'expired'
        ? 'That code ran out. Get a new one.'
        : it.exit === 'missing'
          ? "This drive can't run ChatGPT's sign-in. Use an API key instead."
          : said
            ? `ChatGPT's sign-in stopped: ${said.replace(/\.$/, '')}.`
            : "ChatGPT's sign-in stopped. Get a new code to try again.";
      if (it.exitCode !== null || said) log.error?.(`[codex sign-in] ${it.exit}: ${said ?? 'no reason given'}`);
    } else {
      it.state = it.ended === 'timed out' ? 'expired' : 'ended';
      if (it.state === 'expired') it.error = 'That code ran out. Get a new one.';
    }
    if (session === it) {
      session = null;
      last = view(it);
    }
  }

  async function start() {
    session?.end('started again');
    let child;
    try {
      child = spawnProcess(command, ['login', '--device-auth'], {
        // The allowlist an agent starts from: its home, so the login lands in
        // the drive's own ~/.codex, and no key.
        env: { ...pickEnv(baseEnv()) },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } catch (err) {
      throw new SignInError("This drive can't run ChatGPT's sign-in. Use an API key instead.", { detail: err.message });
    }
    const startedAt = now();
    const it = watchRun(child, { waitMs, kill: killGroup, onEnd: (run) => { settle(run); } });
    Object.assign(it, { state: 'starting', url: null, userCode: null, expiresAt: null, error: null });
    session = it;
    last = { state: 'idle' };

    const found = await it.waitFor((out) => {
      const code = findDeviceCode(out);
      return code ? { code, url: findDeviceUrl(out) ?? DEVICE_PAGE, minutes: findExpiry(out) } : null;
    }, codeWaitMs);
    if (!found) {
      const said = findDeviceError(`${it.output}\n`);
      const tail = stripTerminal(it.output).trim().split('\n').slice(-6).join(' | ');
      it.end('no code');
      log.error?.(`[codex sign-in] no code (${it.exit ?? 'still running'}): ${tail}`);
      if (it.exit === 'missing') throw new SignInError("This drive can't run ChatGPT's sign-in. Use an API key instead.", { detail: 'codex is not installed' });
      throw new SignInError(said ? `ChatGPT's sign-in didn't start: ${said}` : "ChatGPT's sign-in didn't start. Try again in a minute.", { detail: tail });
    }
    const minutes = found.minutes ?? waitMs / 60_000;
    Object.assign(it, {
      state: 'waiting',
      url: found.url,
      userCode: found.code,
      expiresAt: new Date(startedAt + Math.min(minutes * 60_000, waitMs)).toISOString(),
    });
    return { url: it.url, code: it.userCode, expiresAt: it.expiresAt };
  }

  return {
    start,
    status: () => (session ? view(session) : last),
    cancel: () => session?.end('cancelled'),
    /** Whether a sign-in is waiting for the person. */
    waiting: () => Boolean(session && session.state === 'waiting'),
    /** Codex's own word on whether it is signed in here now. */
    loginStatus: () => codexStatus({ command, env: baseEnv(), exec }),
    /** Codex's own sign-out, after ending any sign-in still waiting. */
    signOut: () => {
      session?.end('signed out');
      return codexLogout({ command, env: baseEnv(), exec });
    },
    close() {
      session?.end('closed');
    },
  };
}
