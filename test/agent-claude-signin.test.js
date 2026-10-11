// Connect your Claude, the host half: `claude setup-token` run in a
// pseudo-terminal, its sign-in address read, the pasted code handed back, the
// token read. The command here is a fake drawn from what Claude Code 2.1.281
// really prints (test/fixtures/fake-claude-setup-token.mjs); the pseudo-
// terminal is the real `script`.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createClaudeSignIn, findSignInError, findSignInUrl, findToken, ptyCommand, stripTerminal,
} from '../server/agent/claude-signin.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude-setup-token.mjs', import.meta.url));
const URL_SHOWN = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=FAKEchallengeFAKEchallengeFAKEchallenge0123&code_challenge_method=S256&state=FAKEstateFAKEstateFAKEstate-0123456789_ab';
const TOKEN = 'sk-ant-oat01-FAKEfakeFAKEfake_0123456789-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-AA';

let hasScript = true;
try {
  execFileSync('sh', ['-c', 'command -v script'], { stdio: 'ignore' });
} catch {
  hasScript = false;
}
const needsPty = { skip: hasScript ? false : 'no `script` on this machine' };

/** A `claude` on its own PATH that is the fake, in one mode, logging to a file. */
async function fakeClaude(mode = 'normal') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-claude-'));
  const log = path.join(dir, 'log');
  const bin = path.join(dir, 'claude');
  await fsp.writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@" --log "${log}" --mode ${mode}\n`, { mode: 0o755 });
  const entries = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    dir,
    env: () => ({ PATH: `${dir}:${process.env.PATH}`, HOME: dir }),
    entries,
    pid: () => entries().find((e) => e.pid)?.pid ?? null,
    codes: () => entries().filter((e) => e.code).map((e) => e.code),
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

test('the address is read from the terminal hyperlink, even when the text is cut at 80 columns', () => {
  // Real bytes from Claude Code 2.1.281 at 80 columns, the PKCE values swapped.
  const real = '\u001b[1C\u001b[1A\u001b[38;5;246mBrowser didn\'t open? Use the url below to sign in (c to copy)\u001b[39m\r\r\n\r\r\n'
    + `\u001b]8;id=1qh2pnt;${URL_SHOWN}\u0007\u001b[38;5;246m${URL_SHOWN.slice(0, 80)}\u001b[39m\u001b]8;;\u0007\r\r\n`
    + `\u001b]8;id=1qh2pnt;${URL_SHOWN}\u0007\u001b[38;5;246m${URL_SHOWN.slice(80, 160)}\u001b[39m\u001b]8;;\u0007\r\r\n`
    + '\r\r\n\u001b[2GPaste\u001b[8Gcode\u001b[13Ghere\u001b[18Gif\u001b[21Gprompted\u001b[30G>\r\r\n';
  assert.equal(findSignInUrl(real), URL_SHOWN);
  assert.match(stripTerminal(real), /Paste code here if prompted >/, 'a cursor move to a column reads as a space');
});

test('with no hyperlink, an address cut across lines is joined back together', () => {
  const lines = URL_SHOWN.match(/.{1,80}/g);
  const plain = `Browser didn't open? Use the url below to sign in\r\n\r\n${lines.map((l) => `\u001b[38;5;246m${l}\u001b[39m\r\n`).join('')}\r\n\r\n Paste code here if prompted >\r\n`;
  assert.equal(findSignInUrl(plain), URL_SHOWN);
  assert.equal(findSignInUrl('Welcome to Claude Code\r\nOpening browser to sign in…'), null, 'no address yet');
  assert.equal(findSignInUrl('See https://docs.claude.com/en/docs for help'), null, 'a link that is not a sign-in');
});

test('the token is read whole, on one line or cut across several, and errors are named', () => {
  const one = `\u001b[38;5;114m✓ Long-lived authentication token created successfully!\u001b[39m\r\r\n\r\r\nYour OAuth token (valid for 1 year):\r\r\n\r\r\n\u001b[38;5;220m${TOKEN}\u001b[39m\r\r\n\r\r\nStore this token securely.`;
  assert.equal(findToken(one), TOKEN);
  const cut = `Your OAuth token (valid for 1 year):\r\n\r\n${TOKEN.match(/.{1,80}/g).join('\r\n')}\r\n\r\nStore this token securely. You won't be able to see it again.`;
  assert.equal(findToken(cut), TOKEN);
  const cutNoGap = `${TOKEN.match(/.{1,80}/g).join('\r\n')}\r\nStore this token securely.`;
  assert.equal(findToken(cutNoGap), TOKEN, 'a line with spaces ends it');
  assert.equal(findToken('Use this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>'), null);

  assert.equal(findSignInError('\u001b[38;5;211mOAuth error: Request failed with status code 400\u001b[39m\u001b[K\r\nPress Enter to retry.'), 'Request failed with status code 400');
  assert.match(findSignInError('setup-token creates a long-lived Claude.ai subscription token, which this policy does not permit.\r\n'), /does not permit/);
  assert.equal(findSignInError('\u001b[38;5;211mOAuth error: Request fai'), null, 'not until the line is whole');
  assert.equal(findSignInError('Paste code here if prompted >'), null);
});

test('the pseudo-terminal is script on Linux (util-linux or busybox) and BSD script on a Mac, 1000 columns wide', () => {
  const linux = ptyCommand(['claude', 'setup-token'], 'linux');
  assert.equal(linux.command, 'script');
  assert.deepEqual(linux.args.slice(0, 3), ['-q', '-f', '-c']);
  assert.match(linux.args[3], /^stty cols 1000 rows 50 2>\/dev\/null; exec 'claude' 'setup-token'$/);
  assert.equal(linux.args[4], '/dev/null');
  const mac = ptyCommand(['/opt/my claude', 'setup-token'], 'darwin');
  assert.deepEqual(mac.args.slice(0, 4), ['-q', '/dev/null', 'sh', '-c']);
  assert.match(mac.args[4], /exec '\/opt\/my claude' 'setup-token'$/);
});

// ------------------------------------------------------------- running it

test('start reads the address; the code reaches the command; the token comes back; nothing is left running', needsPty, async (t) => {
  const fake = await fakeClaude();
  const signIn = createClaudeSignIn({ env: fake.env, log: { error() {} } });
  t.after(() => signIn.close());
  const { url } = await signIn.start();
  assert.equal(url, URL_SHOWN);
  assert.equal(signIn.waiting(), true);
  const pid = fake.pid();
  assert.ok(pid && alive(pid), 'the command is waiting for its code');
  assert.deepEqual(fake.entries()[0].args, ['setup-token']);

  const { token } = await signIn.finish('  good-code-from-claude#FAKEstate  ');
  assert.equal(token, TOKEN);
  assert.deepEqual(fake.codes(), ['good-code-from-claude#FAKEstate'], 'the code, trimmed, and only once');
  assert.equal(signIn.waiting(), false);
  assert.ok(await until(() => !alive(pid)), 'the command is gone');
  await assert.rejects(signIn.finish('good-again'), { status: 409 });
});

test('an address and token the terminal cut across lines still come through', needsPty, async (t) => {
  const fake = await fakeClaude('wrap');
  const signIn = createClaudeSignIn({ env: fake.env, log: { error() {} } });
  t.after(() => signIn.close());
  assert.equal((await signIn.start()).url, URL_SHOWN);
  assert.equal((await signIn.finish('good-wrapped')).token, TOKEN);
});

test('a code Claude refuses is a 400 that says to start again, and ends the run', needsPty, async (t) => {
  const fake = await fakeClaude();
  const signIn = createClaudeSignIn({ env: fake.env, log: { error() {} } });
  t.after(() => signIn.close());
  await signIn.start();
  const pid = fake.pid();
  await assert.rejects(signIn.finish('not-a-real-code'), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /didn't accept that code/);
    assert.equal(err.detail, 'Request failed with status code 400');
    return true;
  });
  assert.ok(await until(() => !alive(pid)), 'the command is gone');
});

test('a sign-in that gets no code in time is ended and its command killed', needsPty, async (t) => {
  const fake = await fakeClaude();
  const signIn = createClaudeSignIn({ env: fake.env, waitMs: 400, log: { error() {} } });
  t.after(() => signIn.close());
  await signIn.start();
  const pid = fake.pid();
  assert.ok(alive(pid));
  assert.ok(await until(() => !alive(pid), 3_000), 'killed after its wait');
  assert.equal(signIn.waiting(), false);
  await assert.rejects(signIn.finish('good-late'), (err) => err.status === 409 && /ended/.test(err.message));
  assert.deepEqual(fake.codes(), [], 'the late code never reached anything');
});

test('starting again ends the first run; cancel ends the second', needsPty, async (t) => {
  const fake = await fakeClaude();
  const signIn = createClaudeSignIn({ env: fake.env, log: { error() {} } });
  t.after(() => signIn.close());
  await signIn.start();
  const first = fake.pid();
  await signIn.start();
  const second = fake.entries().filter((e) => e.pid).at(-1).pid;
  assert.notEqual(first, second);
  assert.ok(await until(() => !alive(first)), 'the first is gone');
  assert.ok(alive(second));
  signIn.cancel();
  assert.ok(await until(() => !alive(second)), 'the second is gone');
});

test('a command that never shows an address, or refuses, fails start and is not left running', needsPty, async (t) => {
  const silent = await fakeClaude('silent');
  const quiet = createClaudeSignIn({ env: silent.env, urlWaitMs: 600, log: { error() {} } });
  t.after(() => quiet.close());
  await assert.rejects(quiet.start(), (err) => err.status === 502 && /didn't start/.test(err.message));
  assert.ok(await until(() => !alive(silent.pid())), 'the silent one is gone');

  const policy = await fakeClaude('policy');
  const refused = createClaudeSignIn({ env: policy.env, log: { error() {} } });
  t.after(() => refused.close());
  await assert.rejects(refused.start(), /does not permit/);

  const none = createClaudeSignIn({ env: { PATH: '/nonexistent' }, urlWaitMs: 2_000, log: { error() {} } });
  await assert.rejects(none.start(), { status: 502 });
});

test('a code is asked for whole before anything is sent', async () => {
  const signIn = createClaudeSignIn({ env: { PATH: '/nonexistent' } });
  await assert.rejects(signIn.finish(''), { status: 400 });
  await assert.rejects(signIn.finish('two words'), { status: 400 });
  await assert.rejects(signIn.finish('good-but-nothing-waiting'), { status: 409 });
});
