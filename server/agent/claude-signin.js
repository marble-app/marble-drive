// Connecting the person's own Claude plan from the browser (spec "Getting
// someone in", section 7). `claude setup-token` is a terminal program: it
// prints a sign-in address, waits for the code Claude's page shows, then
// prints a long-lived token. A drive has no terminal for it, so this runs it
// in a pseudo-terminal, reads the address it prints, hands the code back to
// it when the page sends one, and reads the token. The token is kept like an
// API key (server/agent/keys.js, CLAUDE_CODE_OAUTH_TOKEN) by the route that
// calls this, never here.
//
// The pseudo-terminal is the system's `script`, not a native module: util-
// linux's on Linux (Fly sprites) and the BSD one on a Mac. Both give the
// command a real tty, which Claude Code's Ink screen needs to draw at all.
// The terminal is made 1000 columns wide first so neither the address nor the
// token is wrapped onto a second line; the parsers below cope if it is.
//
// One sign-in at a time. Starting again ends the one before. A sign-in that
// gets no code in SIGN_IN_WAIT_MS is ended, and so is one whose command
// stops answering, so nothing is left running.

import { spawn } from 'node:child_process';

import { pickEnv } from './env.js';

/** How long a started sign-in waits for its code before it is ended. Ten
 *  minutes: long enough to sign in to Claude in another tab, find the code
 *  and come back; short enough that a forgotten one does not sit for hours. */
export const SIGN_IN_WAIT_MS = 10 * 60_000; // MARBLE_DRIVE_CLAUDE_SIGNIN_SECONDS
/** How long `claude setup-token` has to print its address. */
export const URL_WAIT_MS = 30_000;
/** How long it has, after the code, to print the token or an error. */
export const TOKEN_WAIT_MS = 60_000;
/** The most output kept from one run: the screen is a few kilobytes; a
 *  runaway spinner is not kept forever. */
const OUTPUT_MAX = 256 * 1024;

const ESC = '\u001b';
const BEL = '\u0007';

/** The text a terminal would show, near enough to read: escape sequences out,
 *  a cursor move to a column read as a space (Ink places each word with one),
 *  and a move to another line, or a carriage return on its own, read as a new
 *  line, so what Ink redraws in place does not run into what was there. */
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

const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

/** A run of lines that continue a value cut by the terminal's width: each
 *  following line made only of `chars` is added on. Null until something
 *  that is not part of it has arrived: the rest may still be on its way. The
 *  last of `lines` is whatever came after the last line break. */
function joinWrapped(lines, at, first, chars) {
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

/** The sign-in address `claude setup-token` printed, or null. The terminal
 *  hyperlink carries it whole, so that is read first; failing that, the
 *  plain text, joined back together if the width cut it. */
export function findSignInUrl(raw) {
  const text = String(raw ?? '');
  for (const match of text.matchAll(/\u001b\]8;[^;\u0007\u001b]*;(https:\/\/[^\u0007\u001b\s]+)(?:\u0007|\u001b\\)/g)) {
    if (/oauth|authorize/i.test(match[1])) return match[1];
  }
  const lines = stripTerminal(text).split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const found = /https:\/\/\S+/.exec(lines[i]);
    if (!found || !/oauth|authorize/i.test(lines[i] + (lines[i + 1] ?? ''))) continue;
    // A link at the end of its line may run on to the next.
    const url = found.index + found[0].length >= lines[i].trimEnd().length
      ? joinWrapped(lines, i, found[0], URL_CHARS)
      : found[0];
    if (url && /oauth|authorize/i.test(url)) return url;
  }
  return null;
}

/** The long-lived token, `sk-ant-oat…`, or null. */
export function findToken(raw) {
  const lines = stripTerminal(raw).split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const found = /sk-ant-oat[0-9A-Za-z_-]+/.exec(lines[i]);
    if (!found) continue;
    const ends = found.index + found[0].length >= lines[i].trimEnd().length;
    return ends ? joinWrapped(lines, i, found[0], /^[0-9A-Za-z_-]+$/) : found[0];
  }
  return null;
}

/** What `claude setup-token` said went wrong, or null. Only a whole line
 *  counts, so a message still arriving is not cut short. */
export function findSignInError(raw) {
  const text = stripTerminal(raw);
  const oauth = /OAuth error:?[ \t]*([^\n]+)\n/i.exec(text);
  if (oauth) return oauth[1].trim();
  const policy = /setup-token [^\n]*does not permit[^\n]*(?=\n)/i.exec(text);
  if (policy) return policy[0].trim();
  const failed = /(?:^|\n)[ \t]*(?:Error|Failed)[: ]([^\n]+)\n/.exec(text);
  return failed ? failed[1].trim() : null;
}

const quote = (arg) => `'${String(arg).replace(/'/g, `'\\''`)}'`;

/** The command line that runs `argv` in a pseudo-terminal 1000 columns wide. */
export function ptyCommand(argv, platform = process.platform) {
  const inner = `stty cols 1000 rows 50 2>/dev/null; exec ${argv.map(quote).join(' ')}`;
  // BSD script (macOS): script [-q] file command…, no -c.
  if (platform === 'darwin') return { command: 'script', args: ['-q', '/dev/null', 'sh', '-c', inner] };
  // util-linux script (and busybox's, on Alpine): -c runs the command, -f
  // writes as it comes. The typescript goes to /dev/null; what it shows
  // still comes out on stdout. No -e: busybox has none, and the exit code is
  // not what says whether it worked; the token is.
  return { command: 'script', args: ['-q', '-f', '-c', inner, '/dev/null'] };
}

class SignInError extends Error {
  constructor(message, { status = 502, detail = '' } = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/**
 * One drive's Claude sign-in.
 *
 *   start()       → { url }    runs `claude setup-token`, answers its address
 *   finish(code)  → { token }  hands it the code, answers the token
 *   cancel()                   ends whatever is running
 *
 * Errors carry `status` (400 for a code Claude refused, 409 when no sign-in
 * is waiting, 502 when the command itself failed) and a message a person can
 * act on.
 */
export function createClaudeSignIn({
  command = 'claude',
  env = () => process.env,
  platform = process.platform,
  waitMs = SIGN_IN_WAIT_MS,
  urlWaitMs = URL_WAIT_MS,
  tokenWaitMs = TOKEN_WAIT_MS,
  spawnProcess = spawn,
  log = console,
} = {}) {
  let session = null;

  function end(it, why) {
    if (!it || it.ended) return;
    it.ended = why;
    clearTimeout(it.expiry);
    try {
      // The pty's master closes with `script`, and the command, its session
      // leader's child, is hung up on with it.
      it.child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
    for (const waiter of it.waiters.splice(0)) waiter();
    if (session === it) session = null;
    process.off('exit', onExit);
  }

  // A host that stops mid sign-in takes the command with it.
  function onExit() {
    end(session, 'host stopped');
  }

  /** Resolves when `test(output)` answers something, or the run ends, or `ms`
   *  pass; answers what `test` answered, or null. */
  function waitFor(it, test, ms, from = 0) {
    return new Promise((resolve) => {
      let timer = null;
      const check = () => {
        const found = test(it.output.slice(from));
        if (found || it.ended) {
          clearTimeout(timer);
          const at = it.waiters.indexOf(check);
          if (at !== -1) it.waiters.splice(at, 1);
          resolve(found || null);
          return true;
        }
        return false;
      };
      if (check()) return;
      it.waiters.push(check);
      timer = setTimeout(() => {
        const at = it.waiters.indexOf(check);
        if (at !== -1) it.waiters.splice(at, 1);
        resolve(null);
      }, ms);
      timer.unref?.();
    });
  }

  async function start() {
    end(session, 'started again');
    const base = typeof env === 'function' ? env() : env;
    const { command: launcher, args } = ptyCommand([command, 'setup-token'], platform);
    let child;
    try {
      child = spawnProcess(launcher, args, {
        // The allowlist an agent starts from, plus a terminal type so it
        // draws, and no browser of its own: the page opens the address.
        env: { ...pickEnv(base), TERM: 'xterm-256color', BROWSER: 'false' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      throw new SignInError("This drive can't run Claude's sign-in.", { detail: err.message });
    }
    const it = { child, output: '', waiters: [], ended: null, url: null, expiry: null, codeAt: null, exit: null };
    session = it;
    process.once('exit', onExit);
    const take = (chunk) => {
      if (it.output.length < OUTPUT_MAX) it.output += chunk.toString('utf8');
      for (const waiter of [...it.waiters]) waiter();
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.stdin?.on('error', () => {});
    child.on('error', (err) => {
      it.exit = err.code === 'ENOENT' ? 'missing' : err.message;
      end(it, 'failed');
    });
    // `close`, not `exit`: the last of what it printed (the token) is read
    // before the run counts as over.
    child.on('close', (code, signal) => {
      it.exit = it.exit ?? (signal ? `signal ${signal}` : `exit ${code}`);
      end(it, it.ended ?? 'exited');
    });
    it.expiry = setTimeout(() => end(it, 'timed out'), waitMs);
    it.expiry.unref?.();

    const url = await waitFor(it, findSignInUrl, urlWaitMs);
    if (!url) {
      const tail = stripTerminal(it.output).trim().split('\n').slice(-6).join(' | ');
      end(it, 'no address');
      log.error?.(`[claude sign-in] no sign-in address (${it.exit ?? 'still running'}): ${tail}`);
      if (it.exit === 'missing') throw new SignInError("This drive can't run Claude's sign-in.", { detail: 'script is not installed' });
      const refused = findSignInError(`${it.output}\n`);
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
    // The code, then Enter on its own, as a person would: Ink reads a paste
    // that ends in a return as one keypress otherwise.
    it.child.stdin.write(pasted);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!it.ended) it.child.stdin.write('\r');
    const answer = await waitFor(it, (out) => {
      const token = findToken(out);
      if (token) return { token };
      const error = findSignInError(out);
      return error ? { error } : null;
    }, tokenWaitMs, it.codeAt);
    end(it, 'finished');
    if (answer?.token) return { token: answer.token };
    if (answer?.error) {
      log.error?.(`[claude sign-in] code refused: ${answer.error}`);
      throw new SignInError("Claude didn't accept that code. Open Claude sign-in again for a new one.", { status: 400, detail: answer.error });
    }
    throw new SignInError("Claude didn't answer. Open Claude sign-in again.", { detail: 'no token' });
  }

  return {
    start,
    finish,
    cancel: () => end(session, 'cancelled'),
    /** Whether a sign-in is waiting for its code. */
    waiting: () => Boolean(session && !session.ended && session.url),
    close() {
      end(session, 'closed');
    },
  };
}
