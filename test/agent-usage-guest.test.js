// The usage meter on a drive hosted for someone else (MARBLE_GUEST=1): it
// never opens the person's Claude login to ask Anthropic, which would be
// handling their token. It asks Claude Code's own `/usage`, and reads the
// plan's limits from the words it prints (as 2.1.281 prints them). Off a
// guest, nothing changes.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-guest-home-'));
process.env.HOME = HOME;

const { CLI_USAGE_ARGS, collectUsageFromCli, parseCliReset, parseCliUsage } = await import('../server/agent/usage.js');
const { createDrive } = await import('../server/app.js');
const { loadConfig } = await import('../server/config.js');
const { createFakeProvider } = await import('./fixtures/fake-provider.js');

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude-auth.mjs', import.meta.url));
const NOW = Date.parse('2026-10-25T18:00:00Z');

// What `claude -p /usage` prints on a Claude plan, line for line as Claude
// Code 2.1.281 writes it (its usage command, read from the release).
const SAID = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  'Current session: 23% used · resets Oct 25, 4:30pm (America/Los_Angeles)',
  'Current week (all models): 41% used · resets Oct 27, 10am (America/Los_Angeles)',
  'Current week (Sonnet only): 12% used · resets Oct 27, 10am (America/Los_Angeles)',
  'Current week (Fable): 58% used · resets Oct 28, 10:59am (America/Los_Angeles)',
  '',
].join('\n');

test('Claude Code\'s own words become the same meter Anthropic\'s answer did', () => {
  const meter = parseCliUsage(SAID, { now: NOW });
  assert.equal(meter.id, 'claude-subscription');
  assert.equal(meter.available, true);
  assert.equal(meter.used, 23);
  assert.equal(meter.window, '5h');
  assert.equal(meter.resetsAt, '2026-10-25T23:30:00.000Z', '4:30pm in Los Angeles');
  assert.deepEqual(meter.windows.map((w) => `${w.id} ${w.used} ${w.resetsAt}`), [
    '5h 23 2026-10-25T23:30:00.000Z',
    'week 41 2026-10-27T17:00:00.000Z',
    'fable 58 2026-10-28T17:59:00.000Z',
  ]);
});

test('a CLI that is not on a plan has no meter; one on a plan that could not say has an unavailable one', () => {
  const cost = 'Total cost:            $0.0000\nTotal duration (API):  0s\nTotal duration (wall): 0s\nTotal code changes:    0 lines added, 0 lines removed\nUsage:                 0 input, 0 output, 0 cache read, 0 cache write\n';
  assert.equal(parseCliUsage(cost), null);
  const unsaid = parseCliUsage('You are currently using your subscription to power your Claude Code usage\n');
  assert.equal(unsaid.available, false);
  assert.equal(unsaid.id, 'claude-subscription');
  // A limit with no reset said still counts.
  assert.equal(parseCliUsage('Current week (all models): 7% used\n').used, 7);
});

test('a reset is read in the time zone it names, and a date with no year is the next one', () => {
  assert.equal(parseCliReset('Oct 27, 10am (UTC)', NOW), '2026-10-27T10:00:00.000Z');
  assert.equal(parseCliReset('Jan 2, 2027, 10am (UTC)', NOW), '2027-01-02T10:00:00.000Z');
  assert.equal(parseCliReset('Jan 2, 10am (UTC)', NOW), '2027-01-02T10:00:00.000Z');
  assert.equal(parseCliReset('Nov 2, 1:30am (America/New_York)', NOW), '2026-11-02T06:30:00.000Z', 'after the clocks go back');
  assert.equal(parseCliReset('Oct 27, 10am (Nowhere/Atall)', NOW), null);
  assert.equal(parseCliReset('soon', NOW), null);
});

test('the CLI is asked for /usage with no tools, no session kept and no key', async () => {
  let seen = null;
  const { meters } = await collectUsageFromCli({
    env: { PATH: '/bin', HOME, ANTHROPIC_API_KEY: 'sk-ant-key', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' },
    now: () => NOW,
    exec: async (command, args, options) => { seen = { command, args, env: options.env }; return { code: 0, stdout: SAID, stderr: '' }; },
  });
  assert.equal(seen.command, 'claude');
  assert.deepEqual(seen.args, CLI_USAGE_ARGS);
  assert.deepEqual(seen.args.slice(-2), ['--', '/usage']);
  assert.ok(seen.args.includes('--no-session-persistence'));
  assert.equal(seen.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(meters[0].used, 23);
  for (const answer of [{ missing: true }, { code: 1, stdout: '', stderr: 'x' }, { timedOut: true }]) {
    assert.deepEqual(await collectUsageFromCli({ exec: async () => answer }), { meters: [] });
  }
});

// ------------------------------------------------------------ on a drive

// Anthropic, as far as the meter's own request goes: every call to it is
// kept, and answered without the network.
const toAnthropic = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (/anthropic\.com/.test(String(url))) {
    toAnthropic.push({ url: String(url), authorization: options?.headers?.Authorization ?? null });
    return new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, options);
};

// The person's Claude Code, signed in, keeping its login in the file the
// meter used to read, and a `claude` that answers /usage.
const bin = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-guest-bin-'));
await fsp.writeFile(path.join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;
await fsp.mkdir(path.join(HOME, '.claude'), { recursive: true });
await fsp.writeFile(path.join(HOME, '.claude', 'fake-login.json'), '{}');
await fsp.writeFile(path.join(HOME, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-THEIRS' } }), { mode: 0o600 });

const drives = [];
test.after(async () => {
  for (const drive of drives) await drive.close();
  globalThis.fetch = realFetch;
});

async function host(env) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'usage-guest-'));
  const config = loadConfig({
    ...process.env,
    MARBLE_DRIVE_ROOT: root,
    MARBLE_DRIVE_AGENTS: '1',
    MARBLE_DRIVE_AGENT_NAMING: '0',
    MARBLE_DRIVE_AGENT_WORKDIR: path.join(root, '..', `${path.basename(root)}-work`),
    MARBLE_DRIVE_AGENT_KEYS: path.join(root, '..', `${path.basename(root)}-keys`),
    ...env,
  });
  const drive = await createDrive(config, {
    log: { log() {}, error() {}, info() {} },
    agentProviders: new Map([['claude-subscription', createFakeProvider({ id: 'claude-subscription' })]]),
  });
  drives.push(drive);
  const port = await new Promise((resolve) => drive.server.listen(0, '127.0.0.1', () => resolve(drive.server.address().port)));
  return `http://127.0.0.1:${port}`;
}

test('on a guest there is no Claude meter by default, and the login file is never used to ask Anthropic', async () => {
  // Claude Code 2.1.281 answers `claude -p /usage` with a breakdown, not the
  // plan's limits (config.cliUsage), so a guest asks nothing and shows nothing.
  const base = await host({ MARBLE_GUEST: '1' });
  const { meters } = await (await fetch(`${base}/agent/usage`)).json();
  assert.deepEqual(meters, []);
  assert.deepEqual(toAnthropic, [], 'no request with their token');
  assert.ok(fs.existsSync(path.join(HOME, '.claude', '.credentials.json')), 'and the file is left where it was');
});

test('on a guest with MARBLE_DRIVE_CLI_USAGE=1 the meter comes from Claude Code, and the login file is never used to ask Anthropic', async () => {
  const base = await host({ MARBLE_GUEST: '1', MARBLE_DRIVE_CLI_USAGE: '1' });
  const { meters } = await (await fetch(`${base}/agent/usage`)).json();
  assert.equal(meters.length, 1);
  assert.equal(meters[0].id, 'claude-subscription');
  assert.equal(meters[0].used, 23);
  assert.deepEqual(meters[0].windows.map((w) => w.id), ['5h', 'week', 'fable']);
  assert.deepEqual(toAnthropic, [], 'no request with their token');
  assert.ok(fs.existsSync(path.join(HOME, '.claude', '.credentials.json')), 'and the file is left where it was');
});

test('off a guest the meter is what it was: the login, asked of Anthropic', async () => {
  const base = await host({ MARBLE_GUEST: '' });
  await (await fetch(`${base}/agent/usage`)).json();
  assert.ok(toAnthropic.some((call) => call.url.endsWith('/api/oauth/usage') && call.authorization === 'Bearer sk-ant-oat01-THEIRS'));
});

test('what Claude Code 2.1.281 prints for `claude -p /usage` has no limits in it to read', () => {
  // Seen on the PC on Oct 25: print mode answers with a breakdown of what used
  // the plan, so the meter can only say it doesn't know (config.cliUsage).
  const said = [
    'You are currently using your subscription to power your Claude Code usage',
    '',
    "What's contributing to your limits usage?",
    'Approximate, based on local sessions on this machine — does not include other devices or claude.ai.',
    '',
    'Last 24h · 7768 requests · 2250 sessions',
    '  100% of your usage was while 4+ sessions ran in parallel',
  ].join('\n');
  const meter = parseCliUsage(said);
  assert.equal(meter.available, false);
  assert.equal(meter.used, null);
});
