// A short command, run to find something out: is this CLI installed, is it
// signed in. Never a turn — the runner owns those. It always resolves, so a
// provider's detect() can report "not installed" instead of throwing.

import { spawn } from 'node:child_process';

export function runCommand(command, args = [], { timeout = 5_000, env = process.env, cwd = undefined, signal, onStdout } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let child = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, ...result });
    };

    const onAbort = () => {
      try {
        child?.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish({ code: null, missing: false, aborted: true });
    };

    if (signal?.aborted) {
      return finish({ code: null, missing: false, aborted: true });
    }

    try {
      child = spawn(command, args, { env, ...(cwd ? { cwd } : {}), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return finish({ code: null, missing: err.code === 'ENOENT', error: err.message });
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: null, missing: false, timedOut: true });
    }, timeout);
    timer.unref?.();

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => finish({ code: null, missing: err.code === 'ENOENT', error: err.message }));
    child.on('close', (code) => finish({ code, missing: false }));
  });
}
