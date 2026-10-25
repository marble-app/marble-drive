// Connecting the person's own Claude plan from the browser, through Claude
// Code's own sign-in (spec "Their own Claude or ChatGPT"). `claude auth login
// --claudeai` is a terminal program: it prints Anthropic's sign-in address,
// waits at "Paste code here if prompted" for the code Anthropic's page shows,
// and with it finishes the sign-in itself and keeps the login under the
// drive's home, as it would on a laptop. A drive has no terminal for it, so
// this runs it in a pseudo-terminal, reads the address it prints, and types
// the code into it when the page sends one. Whether it worked is the command's
// exit and `claude auth status`. Nothing of the login passes through here.
//
// That is the point of the command. Anthropic's terms for hosting Claude Code
// (code.claude.com/docs/en/legal-and-compliance) say a host may not collect,
// store or pass along a Claude.ai login. This used to run `claude setup-token`,
// read the long-lived token it printed, and keep that in Marble's key file. A
// token some drive already kept still works (the Claude provider reads it)
// until Disconnect takes it away; nothing here makes one any more. The code
// the person pastes is not a login: it is good once, and only to the command
// that asked for it, which holds the other half of the exchange.
//
// The pseudo-terminal is the system's `script`, not a native module: util-
// linux's on Linux and the BSD one on a Mac. The terminal is made 1000 columns
// wide so the address is not wrapped onto a second line (the parser copes if
// it is), and echo is turned off, so the code typed into it never comes back
// in what this reads. The shell around the command prints its process id
// first and its exit code last, so a run can be ended whole, and "exits 0" is
// read the same through every `script`.
//
// One sign-in at a time. Starting again ends the one before. A sign-in that
// gets no code in SIGN_IN_WAIT_MS is ended, and so is one whose command stops
// answering, so nothing is left running.

import { spawn } from 'node:child_process';

import { pickEnv } from './env.js';
import { runCommand } from './providers/exec.js';
import { SignInError, watchRun } from './sign-in-run.js';

/** How long a started sign-in waits for its code before it is ended. Ten
 *  minutes: long enough to sign in to Claude in another tab, find the code
 *  and come back; short enough that a forgotten one does not sit for hours. */
export const SIGN_IN_WAIT_MS = 10 * 60_000; // MARBLE_DRIVE_CLAUDE_SIGNIN_SECONDS
/** How long `claude auth login` has to print its address. */
export const URL_WAIT_MS = 30_000;
/** How long it has, after the code, to say whether the sign-in took. */
export const LOGIN_WAIT_MS = 60_000;

const PID_MARK = 'marble-pid:';
const EXIT_MARK = 'marble-exit:';

/** The text a terminal would show, near enough to read: escape sequences out,
 *  a cursor move to a column read as a space (Ink places each word with one),
 *  and a move to another line, or a carriage return on its own, read as a new
 *  line, so what is redrawn in place does not run into what was there. */
export function stripTerminal(raw) {
  return String(raw ?? '')
    // OSC (hyperlinks, titles): ESC ] … BEL or ESC \
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    // CSI to a column: a space, so "Paste\e[8Gcode" reads "Paste code".
    .replace(/\u001b\[\d*G/g, ' ')
    // CSI up or down a line: a line break.
    .replace(/\u001b\[\d*[AB]/g, '\n')
    .replace(/\r+\n/g, '\n')
    .replace(/\r/g, '\n')
    // Every other CSI, and the short escapes (ESC 7, ESC 8, ESC ( B).
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[()][0-9A-Za-z]/g, '')
    .replace(/\u001b[@-_]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

/** A run of lines that continue a value cut by the terminal's width: each
 *  following line made only of `chars` is added on. Null until something
 *  that is not part of it has arrived: the rest may still be on its way. The
 *  last of `lines` is whatever came after the last line break. */
export function joinWrapped(lines, at, first, chars) {
  let value = first;
  for (let i = at + 1; i < lines.length; i++) {
    const next = lines[i].trim();
    const last = i === lines.length - 1;
    // The unfinished last line ends the value only once it plainly is not
    // more of it.
    if (last) return next && !chars.test(next) ? value : null;
    if (!next || !chars.test(next)) return value;
    value += next;
  }
  return null;
}

// The page opens the address in a new tab, so only Anthropic's own count.
const ANTHROPIC = /^https:\/\/([a-z0-9-]+\.)*(claude\.com|claude\.ai|anthropic\.com)\//i;
const signInAddress = (url) => ANTHROPIC.test(url) && /oauth|authorize/i.test(url);

/** The sign-in address Claude Code printed, or null. The terminal hyperlink
 *  carries it whole, so that is read first; failing that, the plain text,
 *  joined back together if the width cut it. */
export function findSignInUrl(raw) {
  const text = String(raw ?? '');
  for (const match of text.matchAll(/\u001b\]8;[^;\u0007\u001b]*;(https:\/\/[^\u0007\u001b\s]+)(?:\u0007|\u001b\\)/g)) {
    if (signInAddress(match[1])) return match[1];
  }
  const lines = stripTerminal(text).split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const found = /https:\/\/\S+/.exec(lines[i]);
    if (!found || !/oauth|authorize/i.test(lines[i] + (lines[i + 1] ?? ''))) continue;
    // A link at the end of its line may run on to the next.
    const url = found.index + found[0].length >= lines[i].trimEnd().length
      ? joinWrapped(lines, i, found[0], URL_CHARS)
      : found[0];
    if (url && signInAddress(url)) return url;
  }
  return null;
}

/** What Claude Code said went wrong, or null. Only a whole line counts, so a
 *  message still arriving is not cut short. */
export function findSignInError(raw) {
  const text = stripTerminal(raw);
  const failed = /(?:^|\n)[ \t]*Login failed:?[ \t]*([^\n]+)\n/i.exec(text);
  if (failed) return failed[1].trim();
  const oauth = /OAuth error:?[ \t]*([^\n]+)\n/i.exec(text);
  if (oauth) return oauth[1].trim();
  // A machine's managed settings can rule this sign-in out before it starts.
  const managed = /(?:^|\n)[ \t]*(Managed settings [^\n]+)\n/i.exec(text);
  if (managed) return managed[1].trim();
  const error = /(?:^|\n)[ \t]*(?:Error|Failed)[: ]([^\n]+)\n/.exec(text);
  return error ? error[1].trim() : null;
}

/** The exit code the shell around the command printed, or null. */
export function findExit(raw) {
  const all = [...stripTerminal(raw).matchAll(new RegExp(`${EXIT_MARK}(\\d+)`, 'g'))];
  return all.length ? Number(all.at(-1)[1]) : null;
}

/** How a code that was typed in came out: `{ ok }` when Claude Code said the
 *  login was made, `{ invalid }` when it said the code was not whole (it
 *  keeps waiting at its prompt then), `{ error }` when it refused or exited
 *  without saying, or null for not yet. Only its own words for this count:
 *  a stray warning on the way is not a refusal. */
export function findLoginOutcome(raw) {
  const text = stripTerminal(raw);
  if (/(?:^|\n)[ \t]*Login successful\b/i.test(text)) return { ok: true };
  if (/(?:^|\n)[ \t]*Invalid code\b[^\n]*\n/i.test(text)) return { invalid: true };
  const failed = /(?:^|\n)[ \t]*(?:Login failed|OAuth error):?[ \t]*([^\n]+)\n/i.exec(text);
  if (failed) return { error: failed[1].trim() };
  const exit = findExit(text);
  return exit === null ? null : { error: findSignInError(text) ?? `it exited ${exit}` };
}

const findPid = (raw) => {
  const found = new RegExp(`${PID_MARK}(\\d+)`).exec(stripTerminal(raw));
  return found ? Number(found[1]) : null;
};

const quote = (arg) => `'${String(arg).replace(/'/g, `'\\''`)}'`;

/**
 * The command line that runs `argv` in a pseudo-terminal 1000 columns wide.
 * With `watch`, echo is off, and the shell says its process id before the
 * command and the command's exit code after it.
 */
export function ptyCommand(argv, platform = process.platform, { watch = false } = {}) {
  const run = argv.map(quote).join(' ');
  const inner = watch
    ? `stty cols 1000 rows 50 -echo 2>/dev/null; echo "${PID_MARK}$$"; ${run}; printf '\\n${EXIT_MARK}%s\\n' "$?"`
    : `stty cols 1000 rows 50 2>/dev/null; exec ${run}`;
  // BSD script (macOS): script [-q] file command…, no -c.
  if (platform === 'darwin') return { command: 'script', args: ['-q', '/dev/null', 'sh', '-c', inner] };
  // util-linux script (and busybox's, on Alpine): -c runs the command, -f
  // writes as it comes. The typescript goes to /dev/null; what it shows
  // still comes out on stdout. No -e: busybox has none, and the shell says
  // the exit code itself.
  return { command: 'script', args: ['-q', '-f', '-c', inner, '/dev/null'] };
}

/** Whether Claude Code is signed in here, as `claude auth status` says: its
 *  own login under this home, asked with no key in the environment so the
 *  answer is about the login. `method` is the CLI's word for it (claude.ai
 *  for a Claude plan). Never the account's name, email or organisation. */
export async function claudeStatus({ command = 'claude', env = process.env, exec = runCommand, timeout = 10_000 } = {}) {
  const probe = await exec(command, ['auth', 'status', '--json'], { env: pickEnv(env), timeout });
  if (probe.missing) return { installed: false, signedIn: false, method: null };
  let status = null;
  try {
    status = JSON.parse(probe.stdout);
  } catch {
    // Not JSON: a CLI too old for --json, or one that failed.
  }
  const signedIn = Boolean(status?.loggedIn) && probe.code === 0;
  return { installed: true, signedIn, method: signedIn ? String(status.authMethod ?? 'claude.ai') : null, ...(probe.timedOut ? { timedOut: true } : {}) };
}

/** `claude auth logout`: Claude Code forgets the login it keeps under this
 *  home. Answers whether it said it did. */
export async function claudeLogout({ command = 'claude', env = process.env, exec = runCommand, timeout = 15_000 } = {}) {
  const result = await exec(command, ['auth', 'logout'], { env: pickEnv(env), timeout });
  if (result.missing) return { ok: false, missing: true };
  return { ok: result.code === 0, detail: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 300) };
}

/**
 * One drive's Claude sign-in.
 *
 *   start()       → { url }        runs `claude auth login --claudeai`, answers its address
 *   finish(code)  → { signedIn }   types the code into it, answers once it is signed in
 *   cancel()                       ends whatever is running
 *
 * Errors carry `status` (400 for a code Claude refused, with `retry` when the
 * same sign-in can take another paste; 409 when no sign-in is waiting; 502
 * when the command itself failed) and a message a person can act on.
 */
export function createClaudeSignIn({
  command = 'claude',
  env = () => process.env,
  platform = process.platform,
  waitMs = SIGN_IN_WAIT_MS,
  urlWaitMs = URL_WAIT_MS,
  loginWaitMs = LOGIN_WAIT_MS,
  spawnProcess = spawn,
  exec = runCommand,
  log = console,
} = {}) {
  let session = null;
  const baseEnv = () => (typeof env === 'function' ? env() : env);

  function end(why) {
    session?.end(why);
  }

  async function start() {
    end('started again');
    const { command: launcher, args } = ptyCommand([command, 'auth', 'login', '--claudeai'], platform, { watch: true });
    let child;
    try {
      child = spawnProcess(launcher, args, {
        // The allowlist an agent starts from, plus a terminal type so it
        // draws, and no browser of its own: the page opens the address.
        env: { ...pickEnv(baseEnv()), TERM: 'xterm-256color', BROWSER: 'false' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      throw new SignInError("This drive can't run Claude's sign-in. Use an API key instead.", { detail: err.message });
    }
    const it = watchRun(child, {
      waitMs,
      // The pty's master closes with `script`, and the command is hung up on
      // with it. Its process group goes too, in case it does not take a
      // hangup: the shell around it named its process id, which is that
      // group's.
      kill: (proc, run) => {
        const group = findPid(run.output);
        if (group) {
          try {
            process.kill(-group, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
        proc.kill('SIGKILL');
      },
      onEnd: (run) => { if (session === run) session = null; },
    });
    it.url = null;
    it.codeAt = null;
    session = it;

    const url = await it.waitFor(findSignInUrl, urlWaitMs);
    if (!url) {
      const refused = findSignInError(`${it.output}\n`);
      const tail = stripTerminal(it.output).trim().split('\n').slice(-6).join(' | ');
      it.end('no address');
      log.error?.(`[claude sign-in] no sign-in address (${it.exit ?? 'still running'}): ${tail}`);
      if (it.exit === 'missing') throw new SignInError("This drive can't run Claude's sign-in. Use an API key instead.", { detail: 'script is not installed' });
      throw new SignInError(refused ? `Claude's sign-in didn't start: ${refused}` : "Claude's sign-in didn't start. Try again in a minute.", { detail: tail });
    }
    it.url = url;
    return { url };
  }

  async function finish(code) {
    const it = session;
    const pasted = String(code ?? '').trim();
    if (!pasted || /\s/.test(pasted) || pasted.length > 2048) {
      throw new SignInError('Paste the whole code Claude showed you.', { status: 400 });
    }
    if (!it || it.ended || !it.url) {
      throw new SignInError('That sign-in has ended. Open Claude sign-in again.', { status: 409 });
    }
    if (it.codeAt !== null) throw new SignInError('A code is already being checked.', { status: 409 });
    it.codeAt = it.output.length;
    const from = it.codeAt;
    // The code, then Enter on its own, as a person would: a screen that reads
    // keys one at a time takes a paste that ends in a return as one keypress.
    it.child.stdin.write(pasted);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!it.ended) it.child.stdin.write('\r');
    const answer = await it.waitFor((out) => findLoginOutcome(out), loginWaitMs, from);

    if (answer?.invalid) {
      // Claude Code is still waiting at its prompt: another paste can go in.
      it.codeAt = null;
      throw new SignInError("That isn't the whole code. Copy all of it from Claude's page and paste it again.", { status: 400, retry: true });
    }
    if (!answer?.ok) {
      it.end('finished');
      if (answer?.error) {
        log.error?.(`[claude sign-in] code refused: ${answer.error}`);
        const refused = /\b4\d\d\b|invalid|expired|grant|state/i.test(answer.error);
        throw new SignInError(
          refused ? "Claude didn't accept that code. Open Claude sign-in again for a new one." : `Claude's sign-in failed: ${answer.error.replace(/\.$/, '')}. Open Claude sign-in again.`,
          { status: refused ? 400 : 502, detail: answer.error },
        );
      }
      throw new SignInError("Claude didn't answer. Open Claude sign-in again.", { detail: 'no answer' });
    }
    // Signed in, it says: the command's exit, then Claude Code's own word.
    const exited = await it.waitFor((out) => {
      const status = findExit(out);
      return status === null ? null : { status };
    }, 15_000, from);
    it.end('finished');
    if (exited && exited.status !== 0) {
      log.error?.(`[claude sign-in] said it signed in, then exited ${exited.status}`);
      throw new SignInError("Claude's sign-in didn't finish. Open Claude sign-in again.", { detail: `exit ${exited.status}` });
    }
    const status = await claudeStatus({ command, env: baseEnv(), exec });
    if (!status.signedIn) {
      log.error?.('[claude sign-in] the command finished, but claude auth status says signed out');
      throw new SignInError("Claude's sign-in didn't finish. Open Claude sign-in again.", { detail: 'not signed in after login' });
    }
    return { signedIn: true, method: status.method };
  }

  return {
    start,
    finish,
    cancel: () => end('cancelled'),
    /** Whether a sign-in is waiting for its code. */
    waiting: () => Boolean(session && !session.ended && session.url),
    /** Whether Claude Code is signed in here now. */
    status: () => claudeStatus({ command, env: baseEnv(), exec }),
    /** Claude Code's own sign-out, after ending any sign-in still waiting. */
    signOut: () => {
      end('signed out');
      return claudeLogout({ command, env: baseEnv(), exec });
    },
    close() {
      end('closed');
    },
  };
}
