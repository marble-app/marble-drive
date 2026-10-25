#!/usr/bin/env node
// A stand-in for Claude Code's own sign-in, drawn the way Claude Code 2.1.281
// prints it (captured 2026-10-25 in a pseudo-terminal, BROWSER=false and an
// empty HOME, stopped before any sign-in):
//
//   claude auth login --claudeai   "Opening browser to sign in…", the address
//                                  as a terminal hyperlink and as text, then
//                                  "Paste code here if prompted > " and a line
//                                  read from stdin
//   claude auth status [--json]    the CLI's JSON, exit 0 signed in, 1 not
//   claude auth logout             forgets the login
//   claude -p /usage               the plan's limits, as the CLI prints them
//   claude --version
//
//   fake-claude-auth.mjs <args…> [--log file] [--mode m]
//
// Modes for `auth login`:
//   normal   the address in a hyperlink and on one wide line (the default)
//   wrap     no hyperlink, and the address cut at 80 columns
//   silent   prints nothing and waits
//   managed  refuses before any address, as managed settings would
//   unsaved  says it signed in, and keeps nothing
//
// A code `good…#state` signs in: the "login" is a file under HOME that only
// this fake reads. A code without a # gets "Invalid code" and the prompt
// waits on; anything else gets "Login failed". Every code received is
// appended to the log, after a first line with this process's pid. The
// address is made up in the CLI's own shape.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const logFile = flag('--log', null);
const mode = flag('--mode', process.env.FAKE_CLAUDE_MODE || 'normal');
const args = argv.filter((a, i) => a !== '--log' && a !== '--mode' && argv[i - 1] !== '--log' && argv[i - 1] !== '--mode');
const note = (entry) => { if (logFile) fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`); };
// Which keys reached it: a sign-in is about the login, so none should.
const KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY', 'MARBLE_DRIVE_SECRET'];
note({ pid: process.pid, args, keys: KEYS.filter((k) => process.env[k] !== undefined) });

const home = process.env.HOME || '/nonexistent';
const LOGIN = path.join(home, '.claude', 'fake-login.json');
const signedIn = () => fs.existsSync(LOGIN);

const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload+user%3Aplugins&code_challenge=FAKEchallengeFAKEchallengeFAKEchallenge0123&code_challenge_method=S256&state=FAKEstateFAKEstateFAKEstate-0123456789_ab';

const E = '\u001b';
const out = (s) => process.stdout.write(s);

if (args[0] === '--version') {
  out('2.1.281 (Claude Code)\n');
  process.exit(0);
}

if (args[0] === 'auth' && args[1] === 'status') {
  const on = signedIn();
  out(`${JSON.stringify(on
    ? { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'someone@example.com', orgId: 'fake-org', orgName: "Someone's Organization", subscriptionType: 'max' }
    : { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }, null, 2)}\n`);
  process.exit(on ? 0 : 1);
}

if (args[0] === 'auth' && args[1] === 'logout') {
  fs.rmSync(LOGIN, { force: true });
  out('Successfully logged out from your Anthropic account.\n');
  process.exit(0);
}

if (args[0] === '-p' && args.at(-1) === '/usage') {
  if (signedIn()) {
    out('You are currently using your subscription to power your Claude Code usage\n\n');
    out(`${process.env.FAKE_CLAUDE_USAGE ?? 'Current session: 23% used · resets Oct 25, 4:30pm (UTC)\nCurrent week (all models): 41% used · resets Oct 27, 10am (UTC)\nCurrent week (Fable): 58% used · resets Oct 28, 10:59am (UTC)'}\n`);
  } else {
    out('Total cost:            $0.0000\nTotal duration (API):  0s\nTotal duration (wall): 0s\nTotal code changes:    0 lines added, 0 lines removed\nUsage:                 0 input, 0 output, 0 cache read, 0 cache write\n');
  }
  process.exit(0);
}

if (args[0] !== 'auth' || args[1] !== 'login') {
  process.stderr.write(`error: unknown command '${args.join(' ')}'\n`);
  process.exit(1);
}

if (mode === 'managed') {
  process.stderr.write('Managed settings on this machine configure a Cloud gateway sign-in; run interactive /login to authenticate.\n');
  process.exit(1);
}
if (mode === 'silent') {
  setInterval(() => {}, 1000);
} else {
  out('Opening browser to sign in…\r\n');
  if (mode === 'wrap') {
    out(`If the browser didn't open, visit:\r\n${URL.match(/.{1,80}/g).map((part) => `${E}[94m${part}${E}[39m\r\n`).join('')}`);
  } else {
    out(`If the browser didn't open, visit: ${E}]8;;${URL}\u0007${E}[94m${URL}${E}[39m${E}]8;;\u0007\r\n`);
  }
  out('Paste code here if prompted > ');
}

// The CLI reads a line, as readline does, and checks it has both halves.
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const code = line.trim();
  if (!code) return;
  note({ code });
  const [authorization, state] = code.split('#');
  if (!authorization || !state) {
    process.stderr.write('Invalid code. Please make sure the full code was copied.\n');
    return;
  }
  if (authorization.startsWith('good')) {
    if (mode !== 'unsaved') {
      fs.mkdirSync(path.dirname(LOGIN), { recursive: true });
      fs.writeFileSync(LOGIN, JSON.stringify({ fake: true }), { mode: 0o600 });
    }
    out('Login successful.\n');
    setTimeout(() => process.exit(0), 50);
    return;
  }
  out('\n');
  process.stderr.write('Login failed: Request failed with status code 400\n');
  setTimeout(() => process.exit(1), 50);
});
