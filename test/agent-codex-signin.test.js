// Connect your ChatGPT, the host half: `codex login --device-auth` run for
// the page, OpenAI's device page and the one-time code read off what it
// prints, and the sign-in counted done when the command exits 0 and `codex
// login status` says it is signed in with ChatGPT. Nothing comes back
// through Marble: OpenAI hands the login to the waiting command. The command
// is a fake drawn from what Codex 0.159.3 really prints
// (test/fixtures/fake-codex-login.mjs), launcher and child both, as the real
// one is.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  codexLogout, codexStatus, createCodexSignIn, findDeviceCode, findDeviceError, findDeviceUrl, findExpiry,
} from '../server/agent/codex-signin.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-codex-login.mjs', import.meta.url));
const quiet = { error() {} };

// The bytes `codex login --device-auth` printed on 2026-10-25, through pipes
// (and the same through a pseudo-terminal, with \r\n), the code swapped.
const E = '\u001b';
const REAL = `\nWelcome to Codex [v${E}[90m0.159.3${E}[0m]\n${E}[90mOpenAI's command-line coding agent${E}[0m\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   ${E}[94mhttps://auth.openai.com/codex/device${E}[0m\n\n2. Enter this one-time code ${E}[90m(expires in 15 minutes)${E}[0m\n   ${E}[94mH43K-QK7PD${E}[0m\n\n${E}[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.${E}[0m\n\n`;

/** A `codex` on its own PATH that is the fake, in one mode, logging to a
 *  file, with a HOME of its own where its "login" lands. */
async function fakeCodex(mode = 'normal') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-codex-'));
  const home = path.join(dir, 'home');
  await fsp.mkdir(home);
  const log = path.join(dir, 'log');
  await fsp.writeFile(path.join(dir, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@" --log "${log}" --mode ${mode}\n`, { mode: 0o755 });
  const entries = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    home,
    env: () => ({ PATH: `${dir}:${process.env.PATH}`, HOME: home, CODEX_API_KEY: 'sk-proj-host', OPENAI_API_KEY: 'sk-host', MARBLE_DRIVE_SECRET: 'hush' }),
    entries,
    /** The launcher's pid and its child's, of the latest run. */
    pids: () => {
      const all = entries();
      const at = all.findLastIndex((e) => e.pid);
      return [all[at]?.pid, all.slice(at + 1).find((e) => e.child)?.child].filter(Boolean);
    },
    /** The person types the code on OpenAI's page. */
    approve: () => fsp.writeFile(path.join(home, 'fake-approve'), ''),
    signedIn: () => fs.existsSync(path.join(home, '.codex', 'fake-login.json')),
  };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (check, ms = 5_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

// ---------------------------------------------------------------- reading it

test('OpenAI\'s page, the code and how long it lasts are read from what Codex prints', () => {
  assert.equal(findDeviceUrl(REAL), 'https://auth.openai.com/codex/device');
  assert.equal(findDeviceCode(REAL), 'H43K-QK7PD');
  assert.equal(findExpiry(REAL), 15);
  const pty = REAL.replace(/\n/g, '\r\n');
  assert.equal(findDeviceUrl(pty), 'https://auth.openai.com/codex/device');
  assert.equal(findDeviceCode(pty), 'H43K-QK7PD');
  // A narrow terminal cut the link: it is joined back.
  const cut = REAL.replace('https://auth.openai.com/codex/device', `https://auth.openai.com/co${E}[0m\n${E}[94mdex/device`);
  assert.equal(findDeviceUrl(cut), 'https://auth.openai.com/codex/device');
  // Not until it is whole: the code's line may still be arriving.
  const half = REAL.slice(0, REAL.indexOf('QK7PD') + 2);
  assert.equal(findDeviceCode(half), null);
  assert.equal(findDeviceCode(REAL.slice(0, REAL.indexOf('2. Enter'))), null, 'no code yet');
  // Only OpenAI's own page is shown to the person.
  assert.equal(findDeviceUrl('1. Open this link\n   https://auth.openai.com.evil.example/codex/device\n\n'), null);
});

test('what Codex said went wrong is read whole', () => {
  assert.equal(findDeviceError('Error logging in with device code: device auth timed out after 15 minutes\n'), 'device auth timed out after 15 minutes');
  assert.equal(findDeviceError('Error logging in with device code: device code request failed with status 403\n'), 'device code request failed with status 403');
  assert.equal(findDeviceError('Error logging in with dev'), null, 'not until the line is whole');
  assert.equal(findDeviceError(REAL), null);
});

test('codex login status is read for how Codex is signed in, and nothing else', async () => {
  const calls = [];
  const exec = (answer) => async (command, args, options) => { calls.push({ command, args, env: options.env }); return answer; };
  // Codex answers on stderr.
  assert.deepEqual(await codexStatus({ exec: exec({ code: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' }), env: { PATH: '/bin', HOME: '/h', CODEX_API_KEY: 'sk-k' } }), { installed: true, signedIn: true, method: 'chatgpt' });
  assert.deepEqual(calls[0].args, ['login', 'status']);
  assert.equal(calls[0].env.CODEX_API_KEY, undefined, 'asked about the login, not a key');
  assert.deepEqual(await codexStatus({ exec: exec({ code: 0, stderr: 'Logged in using an API key - sk-proj-***ABCD\n' }) }), { installed: true, signedIn: true, method: 'api-key' });
  assert.deepEqual(await codexStatus({ exec: exec({ code: 1, stderr: 'Not logged in\n' }) }), { installed: true, signedIn: false, method: null });
  assert.deepEqual(await codexStatus({ exec: exec({ missing: true }) }), { installed: false, signedIn: false, method: null });
  assert.equal((await codexLogout({ exec: exec({ code: 0, stderr: 'Successfully logged out\n' }) })).ok, true);
  assert.deepEqual(calls.at(-1).args, ['logout']);
});

// ------------------------------------------------------------- running it

test('start answers OpenAI\'s page and the code; the login lands; nothing is left running', async (t) => {
  const fake = await fakeCodex();
  let landed = 0;
  const signIn = createCodexSignIn({ env: fake.env, onSignedIn: async () => { landed += 1; }, log: quiet });
  t.after(() => signIn.close());
  const started = await signIn.start();
  assert.equal(started.url, 'https://auth.openai.com/codex/device');
  assert.equal(started.code, 'FAKE-C0DE7');
  const minutes = (Date.parse(started.expiresAt) - Date.now()) / 60_000;
  assert.ok(minutes > 14.5 && minutes <= 15, `lasts 15 minutes, not ${minutes}`);
  assert.equal(signIn.status().state, 'waiting');
  assert.equal(signIn.waiting(), true);
  const [launcher, child] = fake.pids();
  assert.ok(alive(launcher) && alive(child), 'the launcher and the binary it started wait');
  assert.deepEqual(fake.entries()[0].args, ['login', '--device-auth']);
  assert.deepEqual(fake.entries()[0].keys, [], 'no key reaches the sign-in');

  await fake.approve();
  assert.ok(await until(() => signIn.status().state === 'signed-in'), signIn.status().state);
  const after = signIn.status();
  assert.equal(after.code, 'FAKE-C0DE7', 'the code it showed is still what it says');
  assert.equal(landed, 1, 'told once');
  assert.equal(fake.signedIn(), true, 'the login is Codex\'s own, under its home');
  assert.ok(await until(() => !alive(launcher) && !alive(child)));
  assert.equal(signIn.waiting(), false);

  assert.equal((await signIn.loginStatus()).method, 'chatgpt');
  assert.equal((await signIn.signOut()).ok, true);
  assert.equal(fake.signedIn(), false, 'Disconnect is Codex\'s own logout');
});

test('a code that runs out says so; a sign-in nobody finishes is ended, launcher and binary both', async (t) => {
  const expiring = await fakeCodex('expire');
  const signIn = createCodexSignIn({ env: expiring.env, log: quiet });
  t.after(() => signIn.close());
  await signIn.start();
  assert.ok(await until(() => signIn.status().state === 'expired'), signIn.status().state);
  assert.match(signIn.status().error, /ran out/);

  const slow = await fakeCodex();
  const timed = createCodexSignIn({ env: slow.env, waitMs: 400, log: quiet });
  t.after(() => timed.close());
  await timed.start();
  const pids = slow.pids();
  assert.equal(pids.length, 2);
  assert.ok(await until(() => pids.every((pid) => !alive(pid)), 3_000), 'both are killed after the wait');
  assert.equal(timed.status().state, 'expired');
});

test('starting again ends the first, cancel ends the second, and a status after says ended', async (t) => {
  const fake = await fakeCodex();
  const signIn = createCodexSignIn({ env: fake.env, log: quiet });
  t.after(() => signIn.close());
  await signIn.start();
  const first = fake.pids();
  await signIn.start();
  const second = fake.pids();
  assert.notDeepEqual(first, second);
  assert.ok(await until(() => first.every((pid) => !alive(pid))), 'the first is gone, child and all');
  assert.ok(second.every(alive));
  assert.equal(signIn.status().state, 'waiting');
  signIn.cancel();
  assert.ok(await until(() => second.every((pid) => !alive(pid))), 'the second is gone');
  assert.ok(await until(() => signIn.status().state === 'ended'), signIn.status().state);
});

test('a Codex that refuses, exits without a ChatGPT login, or is missing says so plainly', async (t) => {
  const refusing = await fakeCodex('refuse');
  const refused = createCodexSignIn({ env: refusing.env, log: quiet });
  t.after(() => refused.close());
  await assert.rejects(refused.start(), (err) => err.status === 502 && /didn't start: device code login is not enabled/.test(err.message));

  const unsaved = await fakeCodex('unsaved');
  const empty = createCodexSignIn({ env: unsaved.env, log: quiet });
  t.after(() => empty.close());
  await empty.start();
  await unsaved.approve();
  assert.ok(await until(() => empty.status().state === 'failed'), empty.status().state);
  assert.match(empty.status().error, /isn't signed in to ChatGPT/);

  const none = createCodexSignIn({ env: { PATH: '/nonexistent' }, log: quiet });
  await assert.rejects(none.start(), (err) => err.status === 502 && /can't run/.test(err.message));
});
