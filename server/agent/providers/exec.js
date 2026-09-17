// A short command, run to find something out: is this CLI installed, is it
// signed in. Never a turn — the runner owns those. It always resolves, so a
// provider's detect() can report "not installed" instead of throwing.

import { spawn } from 'node:child_process';

export function runCommand(command, args = [], { timeout = 5_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };

    let child;
    try {
      child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return finish({ code: null, missing: err.code === 'ENOENT', error: err.message });
    }

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: null, missing: false, timedOut: true });
    }, timeout);
    timer.unref?.();

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => finish({ code: null, missing: err.code === 'ENOENT', error: err.message }));
    child.on('close', (code) => finish({ code, missing: false }));
  });
}
