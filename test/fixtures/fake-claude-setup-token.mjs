#!/usr/bin/env node
// A stand-in for `claude setup-token`, drawn the way Claude Code 2.1.281
// draws it in a pseudo-terminal (captured 2026-10-11 with BROWSER=false and a
// fresh HOME): words placed with cursor moves instead of spaces, a spinner,
// the sign-in address as a terminal hyperlink and as dim text, then
// "Paste code here if prompted >" and a raw-mode read of the code.
//
//   fake-claude-setup-token.mjs setup-token [--log file] [--mode m]
//
// Modes:
//   normal  the address in a hyperlink and on one wide line (the default)
//   wrap    no hyperlink, and the address and token cut at 80 columns
//   policy  refuses before any address, as a managed policy would
//   silent  draws the banner and then nothing
//
// A code starting `good` is accepted and a token printed; anything else gets
// the CLI's own "OAuth error" and "Press Enter to retry". Every code received
// is appended to the log, after a first line with this process's pid. The
// address and token are made up in the CLI's own shapes.

import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const log = flag('--log', null);
const mode = flag('--mode', 'normal');
const note = (entry) => { if (log) fs.appendFileSync(log, `${JSON.stringify(entry)}\n`); };
note({ pid: process.pid, args: args.filter((a) => !a.startsWith('--') && a !== log && a !== mode) });

if (args[0] !== 'setup-token') {
  process.stderr.write(`error: unknown command '${args[0]}'\n`);
  process.exit(1);
}

const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=FAKEchallengeFAKEchallengeFAKEchallenge0123&code_challenge_method=S256&state=FAKEstateFAKEstateFAKEstate-0123456789_ab';
const TOKEN = 'sk-ant-oat01-FAKEfakeFAKEfake_0123456789-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-AA';

const E = '\u001b';
const out = (s) => process.stdout.write(s);
const placed = (col, words) => {
  let line = '';
  let at = col;
  for (const word of words.split(' ')) {
    line += `${E}[${at}G${word}`;
    at += word.length + 1;
  }
  return line;
};
const cut = (s, width = 80) => s.match(new RegExp(`.{1,${width}}`, 'g'));

out(`${E}7${E}[r${E}8${E}[?25h${E}[?25l${E}[?2004h${E}[?2031h${E}[?1004h${E}[38;5;174mWelcome${E}[9Gto${E}[12GClaude${E}[19GCode${E}[24G${E}[38;5;246mv2.1.281${E}[39m\r\r\n\r\r\n`);
out(`${E}[1m${placed(2, 'This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required.')}${E}[22m\r\r\n\r\r\n`);
if (mode === 'policy') {
  out(`${E}[38;5;211msetup-token creates a long-lived Claude.ai subscription token, which this policy does not permit.${E}[39m\r\r\n`);
  process.exit(1);
}
out(`${E}[2G${E}[38;5;231m·${E}[39m${placed(4, 'Opening browser to sign in…')}\r\r\n`);
for (const frame of ['✢', '*', '✶', '✻', '✽']) out(`\r${E}[1C${E}[1A${E}[38;5;231m${frame}${E}[39m\r\r\n`);
if (mode === 'silent') setInterval(() => {}, 1000);
else {
  out(`\r${E}[1C${E}[1A${E}[38;5;246mBrowser didn't open? Use the url below to sign in (c to copy)${E}[39m\r\r\n\r\r\n`);
  if (mode === 'wrap') {
    for (const part of cut(URL)) out(`${E}[38;5;246m${part}${E}[39m\r\r\n`);
  } else {
    out(`${E}]8;id=fake;${URL}\u0007${E}[38;5;246m${URL}${E}[39m${E}]8;;\u0007\r\r\n`);
  }
  out(`\r\r\n\r\r\n${placed(2, 'Paste code here if prompted >')}\r\r\n`);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
let typed = '';
process.stdin.on('data', (chunk) => {
  for (const ch of chunk.toString('utf8')) {
    if (ch !== '\r' && ch !== '\n') {
      typed += ch;
      continue;
    }
    const code = typed;
    typed = '';
    if (!code) continue;
    note({ code });
    out(`${E}(B\u000f\r${E}[31C${E}[1A${'*'.repeat(Math.max(0, code.length - 6))}${code.slice(-6)}\r\r\n`);
    if (code.startsWith('good')) {
      out(`\r\r\n${E}[38;5;114m✓ Long-lived authentication token created successfully!${E}[39m\r\r\n\r\r\n`);
      out(`Your OAuth token (valid for 1 year):\r\r\n\r\r\n`);
      if (mode === 'wrap') for (const part of cut(TOKEN)) out(`${E}[38;5;220m${part}${E}[39m\r\r\n`);
      else out(`${E}[38;5;220m${TOKEN}${E}[39m\r\r\n`);
      out(`\r\r\n${E}[2mStore this token securely. You won't be able to see it again.${E}[22m\r\r\n\r\r\n`);
      out(`${E}[2mUse this token by setting: export CLAUDE_CODE_OAUTH_TOKEN=<token>${E}[22m\r\r\n`);
      setTimeout(() => process.exit(0), 100);
    } else {
      out(`\r${E}[1C${E}[4A${E}[38;5;211mOAuth error: Request failed with status code 400${E}[39m${E}[K\r${E}[2B${E}[K\r${E}[1C${E}[1B${E}[38;5;153mPress ${E}[1mEnter${E}[22m to retry.\r${E}[1B${E}[39m${E}[K\r\n`);
    }
  }
});
