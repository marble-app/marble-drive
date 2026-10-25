// Connect your Claude, the host half: `claude auth login --claudeai` run in a
// pseudo-terminal, its sign-in address read, the pasted code typed into its
// prompt, and the sign-in counted done when the command exits 0 and `claude
// auth status` says signed in. No token is read or kept here. The command is
// a fake drawn from what Claude Code 2.1.281 really prints
// (test/fixtures/fake-claude-auth.mjs); the pseudo-terminal is the real
// `script`.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  claudeLogout, claudeStatus, createClaudeSignIn, findExit, findLoginOutcome, findSignInError, findSignInUrl, ptyCommand, stripTerminal,
} from '../server/agent/claude-signin.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude-auth.mjs', import.meta.url));
const URL_SHOWN = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload+user%3Aplugins&code_challenge=FAKEchallengeFAKEchallengeFAKEchallenge0123&code_challenge_method=S256&state=FAKEstateFAKEstateFAKEstate-0123456789_ab';

let hasScript = true;
try {
  execFileSync('sh', ['-c', 'command -v script'], { stdio: 'ignore' });
} catch {
  hasScript = false;
}
const needsPty = { skip: hasScript ? false : 'no `script` on this machine' };

/** A `claude` on its own PATH that is the fake, in one mode, logging to a
 *  file, with a HOME of its own where its "login" lands. */
async function fakeClaude(mode = 'normal') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-claude-'));
  const home = path.join(dir, 'home');
  await fsp.mkdir(home);
  const log = path.join(dir, 'log');
  const bin = path.join(dir, 'claude');
  await fsp.writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@" --log "${log}" --mode ${mode}\n`, { mode: 0o755 });
  const entries = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    dir,
    home,
    // Keys in the host's environment, as on a drive that has them: none may
    // reach the sign-in.
    env: () => ({ PATH: `${dir}:${process.env.PATH}`, HOME: home, ANTHROPIC_API_KEY: 'sk-ant-api03-host', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-host', MARBLE_DRIVE_SECRET: 'hush' }),
    entries,
    runs: () => entries().filter((e) => e.pid && e.args[0] === 'auth' && e.args[1] === 'login'),
    pid: () => entries().filter((e) => e.pid && e.args[1] === 'login').at(-1)?.pid ?? null,
    codes: () => entries().filter((e) => e.code).map((e) => e.code),
    signedIn: () => fs.existsSync(path.join(home, '.claude', 'fake-login.json')),
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
const quiet = { error() {} };

// ---------------------------------------------------------------- reading it

test('the address is read from what Claude Code 2.1.281 prints: a terminal hyperlink, then the text', () => {
  // The bytes `claude auth login --claudeai` printed on 2026-10-25 in a
  // pseudo-terminal with an empty HOME, the PKCE values swapped.
  const real = 'Opening browser to sign in…\r\n'
    + `If the browser didn't open, visit: \u001b]8;;${URL_SHOWN}\u0007\u001b[94m${URL_SHOWN}\u001b[39m\u001b]8;;\u0007\r\n`
    + 'Paste code here if prompted > ';
  assert.equal(findSignInUrl(real), URL_SHOWN);
  assert.match(stripTerminal(real), /Paste code here if prompted > $/);
  // The text alone, cut at 80 columns by a narrow terminal, is joined back.
  const cut = `Opening browser to sign in…\r\nIf the browser didn't open, visit:\r\n${URL_SHOWN.match(/.{1,80}/g).map((l) => `\u001b[94m${l}\u001b[39m\r\n`).join('')}Paste code here if prompted > `;
  assert.equal(findSignInUrl(cut), URL_SHOWN);
  assert.equal(findSignInUrl('Opening browser to sign in…'), null, 'no address yet');
  assert.equal(findSignInUrl('See https://docs.claude.com/en/docs for help\r\n'), null, 'a link that is not a sign-in');
  // Only Anthropic's own page is opened for the person.
  assert.equal(findSignInUrl('visit: https://evil.example/oauth/authorize?x=1\r\nPaste code here if prompted > '), null);
});

test('what came of a code is read from its own words, and the shell says the exit', () => {
  assert.deepEqual(findLoginOutcome('\r\nLogin successful.\r\n'), { ok: true });
  assert.deepEqual(findLoginOutcome('Invalid code. Please make sure the full code was copied.\r\n'), { invalid: true });
  assert.deepEqual(findLoginOutcome('\r\nLogin failed: Request failed with status code 400\r\n'), { error: 'Request failed with status code 400' });
  assert.deepEqual(findLoginOutcome('\r\nmarble-exit:1\r\n'), { error: 'it exited 1' }, 'an exit with nothing said is a failure');
  assert.equal(findLoginOutcome('Login fai'), null, 'not until the line is whole');
  assert.equal(findLoginOutcome('Paste code here if prompted > '), null);
  assert.equal(findExit('marble-pid:12\r\n…\r\nmarble-exit:0\r\n'), 0);
  assert.equal(findExit('still going'), null);
  assert.equal(findSignInError('Managed settings on this machine configure a Cloud gateway sign-in; run interactive /login to authenticate.\n'), 'Managed settings on this machine configure a Cloud gateway sign-in; run interactive /login to authenticate.');
});

test('the pseudo-terminal is script on Linux and BSD script on a Mac, 1000 columns wide, echo off', () => {
  const linux = ptyCommand(['claude', 'auth', 'login', '--claudeai'], 'linux', { watch: true });
  assert.equal(linux.command, 'script');
  assert.deepEqual(linux.args.slice(0, 3), ['-q', '-f', '-c']);
  assert.match(linux.args[3], /^stty cols 1000 rows 50 -echo 2>\/dev\/null; echo "marble-pid:\$\$"; 'claude' 'auth' 'login' '--claudeai'; printf/);
  assert.match(linux.args[3], /marble-exit:%s/);
  assert.equal(linux.args[4], '/dev/null');
  const mac = ptyCommand(['/opt/my claude', 'auth', 'login'], 'darwin', { watch: true });
  assert.deepEqual(mac.args.slice(0, 4), ['-q', '/dev/null', 'sh', '-c']);
  assert.match(mac.args[4], /'\/opt\/my claude' 'auth' 'login'/);
  assert.match(ptyCommand(['claude', 'x'], 'linux').args[3], /exec 'claude' 'x'$/, 'without watch, the command is the shell');
});

test('claude auth status is read for whether it is signed in, and nothing about the account', async () => {
  const calls = [];
  const exec = (answer) => async (command, args, options) => { calls.push({ command, args, env: options.env }); return answer; };
  const on = await claudeStatus({ exec: exec({ code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'a@b.c', orgName: 'Org' }) }), env: { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-ant-x' } });
  assert.deepEqual(on, { installed: true, signedIn: true, method: 'claude.ai' });
  assert.deepEqual(calls[0].args, ['auth', 'status', '--json']);
  assert.equal(calls[0].env.ANTHROPIC_API_KEY, undefined, 'asked about the login, not a key');
  assert.deepEqual(await claudeStatus({ exec: exec({ code: 1, stdout: '{"loggedIn": false, "authMethod": "none"}' }) }), { installed: true, signedIn: false, method: null });
  assert.deepEqual(await claudeStatus({ exec: exec({ code: 0, stdout: 'not json' }) }), { installed: true, signedIn: false, method: null });
  assert.deepEqual(await claudeStatus({ exec: exec({ missing: true }) }), { installed: false, signedIn: false, method: null });
  const out = await claudeLogout({ exec: exec({ code: 0, stdout: 'Successfully logged out from your Anthropic account.\n' }) });
  assert.equal(out.ok, true);
  assert.deepEqual(calls.at(-1).args, ['auth', 'logout']);
});

// ------------------------------------------------------------- running it

test('start reads the address; the code reaches the prompt; it signs in; nothing is kept here or left running', needsPty, async (t) => {
  const fake = await fakeClaude();
  const signIn = createClaudeSignIn({ env: fake.env, log: quiet });
  t.after(() => signIn.close());
  const { url } = await signIn.start();
  assert.equal(url, URL_SHOWN);
  assert.equal(signIn.waiting(), true);
  const pid = fake.pid();
  assert.ok(pid && alive(pid), 'the command is waiting for its code');
  assert.deepEqual(fake.runs()[0].args, ['auth', 'login', '--claudeai']);
  assert.deepEqual(fake.runs()[0].keys, [], 'no key and no token reaches the sign-in');

  const done = await signIn.finish('  good-code-from-claude#FAKEstate  ');
  assert.deepEqual(done, { signedIn: true, method: 'claude.ai' });
  assert.equal(JSON.stringify(done).includes('sk-ant'), false, 'nothing like a token comes back');
  assert.deepEqual(fake.codes(), ['good-code-from-claude#FAKEstate'], 'the code, trimmed, and only once');
  assert.equal(fake.signedIn(), true, 'the login is the CLI\'s own, under its home');
  assert.equal(signIn.waiting(), false);
  assert.ok(await until(() => !alive(pid)), 'the command is gone');
  await assert.rejects(signIn.finish('good-again#x'), { status: 409 });

  assert.equal((await signIn.status()).signedIn, true);
  assert.equal((await signIn.signOut()).ok, true);
  assert.equal(fake.signedIn(), false, 'Disconnect is the CLI\'s own logout');
  assert.equal((await signIn.status()).signedIn, false);
});

test('an address the terminal cut across lines still comes through', needsPty, async (t) => {
  const fake = await fakeClaude('wrap');
  const signIn = createClaudeSignIn({ env: fake.env, log: quiet });
  t.after(() => signIn.close());
  assert.equal((await signIn.start()).url, URL_SHOWN);
  assert.equal((await signIn.finish('good-wrapped#s')).signedIn, true);
});

test('half a code is a 400 the same sign-in can take again; a refused one ends it', needsPty, async (t) => {
  const fake = await fakeClaude();
  const signIn = createClaudeSignIn({ env: fake.env, log: quiet });
  t.after(() => signIn.close());
  await signIn.start();
  const pid = fake.pid();
  await assert.rejects(signIn.finish('good-but-no-state'), (err) => err.status === 400 && err.retry === true && /isn't the whole code/.test(err.message));
  assert.equal(signIn.waiting(), true, 'still waiting at its prompt');
  assert.ok(alive(pid));
  assert.equal((await signIn.finish('good-whole#state')).signedIn, true, 'the whole code, pasted again, signs in');

  await signIn.start();
  const second = fake.pid();
  await assert.rejects(signIn.finish('wrong-code#state'), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /didn't accept that code/);
    assert.equal(err.detail, 'Request failed with status code 400');
    return true;
  });
  assert.equal(signIn.waiting(), false);
  assert.ok(await until(() => !alive(second)), 'the command is gone');
});

test('a sign-in that says it worked but left no login is not taken for one', needsPty, async (t) => {
  const fake = await fakeClaude('unsaved');
  const signIn = createClaudeSignIn({ env: fake.env, log: quiet });
  t.after(() => signIn.close());
  await signIn.start();
  await assert.rejects(signIn.finish('good-code#s'), (err) => err.status === 502 && /didn't finish/.test(err.message));
});

test('a sign-in that gets no code in time is ended and its command killed', needsPty, async (t) => {
  const fake = await fakeClaude();
  const signIn = createClaudeSignIn({ env: fake.env, waitMs: 400, log: quiet });
  t.after(() => signIn.close());
  await signIn.start();
  const pid = fake.pid();
  assert.ok(alive(pid));
  assert.ok(await until(() => !alive(pid), 3_000), 'killed after its wait');
  assert.equal(signIn.waiting(), false);
  await assert.rejects(signIn.finish('good-late#s'), (err) => err.status === 409 && /ended/.test(err.message));
  assert.deepEqual(fake.codes(), [], 'the late code never reached anything');
});

test('starting again ends the first run; cancel ends the second', needsPty, async (t) => {
  const fake = await fakeClaude();
  const signIn = createClaudeSignIn({ env: fake.env, log: quiet });
  t.after(() => signIn.close());
  await signIn.start();
  const first = fake.pid();
  await signIn.start();
  const second = fake.pid();
  assert.notEqual(first, second);
  assert.ok(await until(() => !alive(first)), 'the first is gone');
  assert.ok(alive(second));
  signIn.cancel();
  assert.ok(await until(() => !alive(second)), 'the second is gone');
  assert.equal(signIn.waiting(), false);
});

test('a command that never shows an address, or refuses, fails start and is not left running', needsPty, async (t) => {
  const silent = await fakeClaude('silent');
  const quietRun = createClaudeSignIn({ env: silent.env, urlWaitMs: 600, log: quiet });
  t.after(() => quietRun.close());
  await assert.rejects(quietRun.start(), (err) => err.status === 502 && /didn't start/.test(err.message));
  assert.ok(await until(() => !alive(silent.pid())), 'the silent one is gone');

  const managed = await fakeClaude('managed');
  const refused = createClaudeSignIn({ env: managed.env, log: quiet });
  t.after(() => refused.close());
  await assert.rejects(refused.start(), /Managed settings/);

  const none = createClaudeSignIn({ env: { PATH: '/nonexistent' }, urlWaitMs: 2_000, log: quiet });
  await assert.rejects(none.start(), { status: 502 });
});

test('a code is asked for whole before anything is sent', async () => {
  const signIn = createClaudeSignIn({ env: { PATH: '/nonexistent' } });
  await assert.rejects(signIn.finish(''), { status: 400 });
  await assert.rejects(signIn.finish('two words'), { status: 400 });
  await assert.rejects(signIn.finish('good-but-nothing-waiting#s'), { status: 409 });
});
