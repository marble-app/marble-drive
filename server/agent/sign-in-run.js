// One sign-in command, run for a page: what it has printed so far, who is
// waiting on it, and how it ended. Claude's sign-in and ChatGPT's
// (claude-signin.js, codex-signin.js) are each one of these at a time.
//
// It holds the command's output in memory for as long as the sign-in lasts,
// to read an address or a code off it, and nothing of it is written anywhere.
// A run that ends is killed, so nothing is left waiting on a code nobody will
// send; a run that ended by exiting is not, because its process id may
// already belong to something else.

/** The most output kept from one run: a sign-in prints a few hundred bytes;
 *  a runaway spinner is not kept forever. */
const OUTPUT_MAX = 256 * 1024;

/**
 * Watch `child` until it exits or `end` is called. `waitMs` is how long it
 * may run at all; `kill(child, run)` stops it (and whatever it started).
 *
 *   run.output          everything printed so far, stdout and stderr together
 *   run.ended           null while it runs, then why it stopped: 'exited',
 *                       'failed' (could not start), or the reason given to end
 *   run.exitCode        its exit code, once it has exited by itself
 *   run.waitFor(test, ms, from)
 *                       resolves with what `test(output.slice(from))`
 *                       answers, or null once it ends or `ms` pass
 *   run.end(why)        stops it
 */
export function watchRun(child, { waitMs, kill, onEnd = () => {} }) {
  const run = { child, output: '', ended: null, exitCode: null, exit: null, waiters: [] };
  const wake = () => {
    for (const waiter of [...run.waiters]) waiter();
  };

  function end(why) {
    if (run.ended) return;
    run.ended = why;
    clearTimeout(expiry);
    process.off('exit', onExit);
    if (why !== 'exited' && why !== 'failed') {
      try {
        kill(child, run);
      } catch {
        // Already gone.
      }
    }
    wake();
    run.waiters.length = 0;
    onEnd(run);
  }
  // A host that stops mid sign-in takes the command with it.
  const onExit = () => end('host stopped');
  process.once('exit', onExit);

  const take = (chunk) => {
    if (run.output.length < OUTPUT_MAX) run.output += chunk.toString('utf8');
    wake();
  };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  child.stdin?.on('error', () => {});
  child.on('error', (err) => {
    run.exit = err.code === 'ENOENT' ? 'missing' : err.message;
    end('failed');
  });
  // `close`, not `exit`: the last of what it printed is read before the run
  // counts as over.
  child.on('close', (code, signal) => {
    run.exitCode = signal ? null : code;
    run.exit = run.exit ?? (signal ? `signal ${signal}` : `exit ${code}`);
    end('exited');
  });
  const expiry = setTimeout(() => end('timed out'), waitMs);
  expiry.unref?.();

  run.end = end;
  run.waitFor = (test, ms, from = 0) => new Promise((resolve) => {
    let timer = null;
    const check = () => {
      const found = test(run.output.slice(from));
      if (!found && !run.ended) return false;
      clearTimeout(timer);
      const at = run.waiters.indexOf(check);
      if (at !== -1) run.waiters.splice(at, 1);
      resolve(found || null);
      return true;
    };
    if (check()) return;
    run.waiters.push(check);
    timer = setTimeout(() => {
      const at = run.waiters.indexOf(check);
      if (at !== -1) run.waiters.splice(at, 1);
      resolve(null);
    }, ms);
    timer.unref?.();
  });
  return run;
}

/** An error a sign-in route can answer with: `status` and a sentence a
 *  person can act on, and `detail` for the log. */
export class SignInError extends Error {
  constructor(message, { status = 502, detail = '', retry = false } = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.retry = retry;
  }
}
