#!/usr/bin/env node
// A stand-in for Codex's own sign-in, drawn the way Codex 0.159.3 prints it
// (captured 2026-10-25 with an empty HOME, stopped before any sign-in):
//
//   codex login --device-auth   the steps, OpenAI's device page and a
//                               one-time code, then a wait for the person
//   codex login status          on stderr, exit 0 signed in, 1 not
//   codex logout
//   codex --version
//
//   fake-codex-login.mjs <args…> [--log file] [--mode m]
//
// Modes for `login --device-auth`:
//   normal   the page and the code, then a wait (the default)
//   wrap     the page cut across two lines
//   refuse   fails before any code, as a workspace that turns it off would
//   expire   gives up after a moment, as Codex does after fifteen minutes
//   unsaved  exits 0 having kept nothing
//
// The person "types the code on OpenAI's page" when a file named
// fake-approve appears in HOME: the fake then keeps a login (a file only it
// reads) and exits 0, as Codex does. The launcher Codex really is starts the
// binary as a child; so does this, so a test can see that both are ended.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const logFile = flag('--log', null);
const mode = flag('--mode', process.env.FAKE_CODEX_MODE || 'normal');
const args = argv.filter((a, i) => a !== '--log' && a !== '--mode' && argv[i - 1] !== '--log' && argv[i - 1] !== '--mode');
const note = (entry) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`); };

const home = process.env.HOME || '/nonexistent';
const LOGIN = path.join(home, '.codex', 'fake-login.json');
// A fake login is only ever written under a temporary HOME: a test that
// forgot to give it one must never touch a real ~/.claude or ~/.codex.
const tmp = fs.realpathSync(os.tmpdir());
const real = (() => { try { return fs.realpathSync(home); } catch { return home; } })();
if (!real.startsWith(`${tmp}${path.sep}`)) {
  process.stderr.write(`fake CLI: HOME ${home} is not under ${tmp}; refusing to run\n`);
  process.exit(3);
}
const APPROVE = path.join(home, 'fake-approve');

if (args[0] === '--version') {
  process.stdout.write('codex-cli 0.159.3\n');
  process.exit(0);
}
if (args[0] === 'login' && args[1] === 'status') {
  const on = fs.existsSync(LOGIN);
  process.stderr.write(on ? 'Logged in using ChatGPT\n' : 'Not logged in\n');
  process.exit(on ? 0 : 1);
}
if (args[0] === 'logout') {
  const on = fs.existsSync(LOGIN);
  fs.rmSync(LOGIN, { force: true });
  process.stderr.write(on ? 'Successfully logged out\n' : 'Not logged in\n');
  process.exit(0);
}
if (args[0] !== 'login' || args[1] !== '--device-auth') {
  process.stderr.write(`error: unexpected argument '${args.join(' ')}'\n`);
  process.exit(2);
}

// The launcher: start the "binary" as a child, the way codex.js does, and
// pass its exit on.
if (!process.env.FAKE_CODEX_CHILD) {
  // Which keys reached it: a sign-in is about the login, so none should.
  const KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'MARBLE_DRIVE_SECRET'];
  note({ pid: process.pid, args, keys: KEYS.filter((k) => process.env[k] !== undefined) });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
    stdio: 'inherit',
    env: { ...process.env, FAKE_CODEX_CHILD: '1' },
  });
  child.on('spawn', () => note({ child: child.pid }));
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  const E = '\u001b';
  const out = (s) => process.stdout.write(s);
  out(`\nWelcome to Codex [v${E}[90m0.159.3${E}[0m]\n${E}[90mOpenAI's command-line coding agent${E}[0m\n\n`);
  if (mode === 'refuse') {
    process.stderr.write('Error logging in with device code: device code login is not enabled for this Codex server. Use the browser login or verify the server URL.\n');
    process.exit(1);
  }
  out('Follow these steps to sign in with ChatGPT using device code authorization:\n\n');
  out('1. Open this link in your browser and sign in to your account\n');
  out(mode === 'wrap'
    ? `   ${E}[94mhttps://auth.openai.com/co${E}[0m\n${E}[94mdex/device${E}[0m\n\n`
    : `   ${E}[94mhttps://auth.openai.com/codex/device${E}[0m\n\n`);
  out(`2. Enter this one-time code ${E}[90m(expires in 15 minutes)${E}[0m\n   ${E}[94mFAKE-C0DE7${E}[0m\n\n`);
  out(`${E}[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.${E}[0m\n\n`);
  if (mode === 'expire') {
    setTimeout(() => {
      process.stderr.write('Error logging in with device code: device auth timed out after 15 minutes\n');
      process.exit(1);
    }, 300);
  } else {
    const wait = setInterval(() => {
      if (!fs.existsSync(APPROVE)) return;
      clearInterval(wait);
      fs.rmSync(APPROVE, { force: true });
      if (mode !== 'unsaved') {
        fs.mkdirSync(path.dirname(LOGIN), { recursive: true });
        fs.writeFileSync(LOGIN, JSON.stringify({ fake: true }), { mode: 0o600 });
      }
      process.stderr.write('Successfully logged in\n');
      process.exit(0);
    }, 25);
  }
}
