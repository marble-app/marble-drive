// The small jobs beside a turn run on whichever CLI the drive has connected
// (server/agent/side-model.js): Claude when it works, on its login, a plan
// token, a key or starter credit, else Codex on the ChatGPT login or an
// OpenAI key, else nothing. Each CLI is asked whether it works in its own
// words; the commands here are fakes that answer as Claude Code 2.1.281 and
// Codex 0.159.3 do.

import assert from 'node:assert/strict';
import test from 'node:test';

import { agentHostEnv, KEY_VARIABLES } from '../server/agent/index.js';
import { claudeArgs, codexArgs, codexFor, createSideModel, CODEX_FOR_CLAUDE } from '../server/agent/side-model.js';

const quiet = { error() {} };

/** A machine with the CLIs given: `claude` signed in or not, `codex` with
 *  the ChatGPT login or not, each answering a job with `answer`. Every call
 *  is kept. */
function machine({ claude = null, codex = null, answer = () => ({ code: 0, stdout: 'An answer\n', stderr: '' }) } = {}) {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, env: options?.env ?? {}, timeout: options?.timeout });
    if (command === 'claude') {
      if (!claude) return { missing: true, code: null, stdout: '', stderr: '' };
      if (args[0] === 'auth') {
        return claude.login
          ? { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }), stderr: '' }
          : { code: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }), stderr: '' };
      }
      return answer('claude', args, options);
    }
    if (command === 'codex') {
      if (!codex) return { missing: true, code: null, stdout: '', stderr: '' };
      if (args[0] === 'login') return codex.login ? { code: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' } : { code: 1, stdout: '', stderr: 'Not logged in\n' };
      return answer('codex', args, options);
    }
    return { missing: true, code: null, stdout: '', stderr: '' };
  };
  return { exec, calls, jobs: () => calls.filter((c) => (c.command === 'claude' && c.args[0] === '-p') || (c.command === 'codex' && c.args[0] === 'exec')) };
}

const HOST = { PATH: '/bin', HOME: '/home/ana' };

test('Claude only: the job runs on Claude\'s login, with no key in its environment', async () => {
  const m = machine({ claude: { login: true } });
  const side = createSideModel({ exec: m.exec, env: { ...HOST, ANTHROPIC_API_KEY: 'sk-ant-host' }, secrets: () => ({}), log: quiet });
  assert.deepEqual(await side.ways(), [{ cli: 'claude', how: 'login' }, { cli: 'claude', how: 'api' }]);
  const result = await side.run({ job: 'test', prompt: 'Name this', model: 'haiku', timeout: 5_000 });
  assert.equal(result.cli, 'claude');
  assert.equal(result.how, 'login');
  assert.equal(result.stdout, 'An answer\n');
  const [job] = m.jobs();
  assert.deepEqual(job.args, claudeArgs({ prompt: 'Name this', model: 'haiku' }));
  assert.equal(job.env.ANTHROPIC_API_KEY, undefined, 'the login, not the key');
  assert.deepEqual(Object.keys(job.env).sort(), ['HOME', 'PATH']);
});

test('Codex only: the job runs on the ChatGPT login, as Codex\'s own model for that size of job', async () => {
  const m = machine({ codex: { login: true } });
  const side = createSideModel({ exec: m.exec, env: HOST, log: quiet });
  assert.deepEqual(await side.ways(), [{ cli: 'codex', how: 'chatgpt' }]);
  const result = await side.run({ job: 'test', prompt: 'Name this', system: 'You draw widgets.', model: 'haiku', timeout: 5_000 });
  assert.equal(result.cli, 'codex');
  const [job] = m.jobs();
  assert.equal(job.command, 'codex');
  assert.deepEqual(job.args.slice(0, 4), ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config']);
  assert.equal(job.args[job.args.indexOf('-s') + 1], 'read-only');
  assert.equal(job.args[job.args.indexOf('-m') + 1], CODEX_FOR_CLAUDE.haiku.model);
  assert.ok(job.args.includes('model_reasoning_effort="low"'));
  for (const off of ['features.shell_tool=false', 'features.unified_exec=false', 'features.browser_use=false', 'features.computer_use=false']) assert.ok(job.args.includes(off), off);
  assert.ok(job.args.includes('developer_instructions="You draw widgets."'), 'the system prompt goes in as instructions');
  assert.deepEqual(job.args.slice(-2), ['--', 'Name this'], 'the question last, after --');
  assert.equal(job.env.CODEX_API_KEY, undefined);
});

test('both: Claude first; a quick refusal moves on to Codex; a slow one does not', async () => {
  let claudeAnswers = { code: 1, stdout: '', stderr: "You've hit your session limit · resets 4pm" };
  const m = machine({
    claude: { login: true },
    codex: { login: true },
    answer: (cli) => (cli === 'claude' ? claudeAnswers : { code: 0, stdout: 'From Codex\n', stderr: '' }),
  });
  const errors = [];
  const side = createSideModel({ exec: m.exec, env: HOST, log: { error: (line) => errors.push(line) } });
  assert.deepEqual((await side.ways()).map((w) => w.cli), ['claude', 'codex']);
  const refused = await side.run({ job: 'naming', prompt: 'x', model: 'sonnet', timeout: 5_000 });
  assert.equal(refused.cli, 'codex');
  assert.equal(refused.stdout, 'From Codex\n');
  assert.match(errors[0], /naming on claude \(login\) failed: You've hit your session limit/);
  const codexJob = m.jobs().at(-1);
  assert.equal(codexJob.args[codexJob.args.indexOf('-m') + 1], CODEX_FOR_CLAUDE.sonnet.model);
  assert.ok(codexJob.timeout <= 5_000, 'the second way gets what is left of the time, not more');

  claudeAnswers = { code: null, stdout: '', stderr: '', timedOut: true };
  const before = m.jobs().length;
  const slow = await side.run({ job: 'naming', prompt: 'x', model: 'haiku', timeout: 5_000 });
  assert.equal(slow.cli, 'claude');
  assert.equal(slow.timedOut, true);
  assert.equal(m.jobs().length, before + 1, 'a timeout spends the job\'s time: Codex is not asked too');
});

test('neither: nothing to run on, said as missing, and nothing is started', async () => {
  const signedOut = machine({ claude: { login: false }, codex: { login: false } });
  const side = createSideModel({ exec: signedOut.exec, env: HOST, log: quiet });
  assert.deepEqual(await side.ways(), []);
  const result = await side.run({ job: 'test', prompt: 'x', timeout: 5_000 });
  assert.equal(result.missing, true);
  assert.equal(signedOut.jobs().length, 0);

  const bare = machine();
  assert.deepEqual(await createSideModel({ exec: bare.exec, env: HOST, log: quiet }).ways(), [], 'neither CLI installed');
});

test('keys: Claude on the drive\'s API key or a plan token, Codex on its OpenAI key, each with only its own secret', async () => {
  const m = machine({ claude: { login: false }, codex: { login: false } });
  const keys = { ANTHROPIC_API_KEY: 'sk-ant-api03-drive', CODEX_API_KEY: 'sk-proj-drive', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-older' };
  const side = createSideModel({ exec: m.exec, env: HOST, secrets: () => keys, log: quiet });
  assert.deepEqual(await side.ways(), [{ cli: 'claude', how: 'token' }, { cli: 'claude', how: 'api' }, { cli: 'codex', how: 'api' }]);
  await side.run({ job: 'test', prompt: 'x', timeout: 5_000 });
  const [job] = m.jobs();
  assert.equal(job.env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-older');
  assert.equal(job.env.ANTHROPIC_API_KEY, undefined, 'one secret per way');

  const codexOnly = machine({ codex: { login: false } });
  const onKey = createSideModel({ exec: codexOnly.exec, env: HOST, secrets: () => ({ CODEX_API_KEY: 'sk-proj-drive' }), log: quiet });
  await onKey.run({ job: 'test', prompt: 'x', timeout: 5_000 });
  assert.equal(codexOnly.jobs()[0].env.CODEX_API_KEY, 'sk-proj-drive');
});

test('starter credit is a way for Claude where the drive has it, through the proxy', async () => {
  const m = machine({ claude: { login: false } });
  const side = createSideModel({ exec: m.exec, env: { ...HOST, MARBLE_CREDIT_URL: 'https://marbledrive.app/_credit', MARBLE_CREDIT_TOKEN: 'credit-token' }, log: quiet });
  assert.deepEqual(await side.ways(), [{ cli: 'claude', how: 'credit' }]);
  await side.run({ job: 'test', prompt: 'x', timeout: 5_000 });
  const [job] = m.jobs();
  assert.equal(job.env.ANTHROPIC_BASE_URL, 'https://marbledrive.app/_credit');
  assert.equal(job.env.ANTHROPIC_API_KEY, 'credit-token');
});

test('what works is asked once a minute, and asked again after a sign-in', async () => {
  let at = 0;
  const m = machine({ claude: { login: true } });
  const side = createSideModel({ exec: m.exec, env: HOST, now: () => at, log: quiet });
  await side.ways();
  await side.ways();
  const probes = () => m.calls.filter((c) => c.args[0] === 'auth' || c.args[0] === 'login').length;
  assert.equal(probes(), 2, 'one look at each CLI');
  at = 61_000;
  await side.ways();
  assert.equal(probes(), 4);
  side.forget();
  await side.ways();
  assert.equal(probes(), 6);
});

test('a Codex model the account does not have falls back to Codex\'s own default', async () => {
  const m = machine({
    codex: { login: true },
    answer: (_cli, args) => (args.includes('-m')
      ? { code: 1, stdout: '', stderr: "Error: The model 'gpt-6-luna' does not exist or you do not have access to it." }
      : { code: 0, stdout: 'From the default\n', stderr: '' }),
  });
  const side = createSideModel({ exec: m.exec, env: HOST, log: quiet });
  const result = await side.run({ job: 'test', prompt: 'x', model: 'haiku', timeout: 5_000 });
  assert.equal(result.stdout, 'From the default\n');
  assert.equal(m.jobs().length, 2);
  assert.equal(m.jobs()[1].args.includes('-m'), false);
});

test('Claude\'s model names, families and ids, map to Codex\'s in one place', () => {
  assert.deepEqual(codexFor('haiku'), CODEX_FOR_CLAUDE.haiku);
  assert.deepEqual(codexFor('claude-opus-5-5[1m]'), CODEX_FOR_CLAUDE.opus);
  assert.deepEqual(codexFor('fable'), CODEX_FOR_CLAUDE.fable);
  assert.deepEqual(codexFor('sonnet', 'high'), { ...CODEX_FOR_CLAUDE.sonnet, effort: 'high' }, 'an effort the job asked for wins');
  assert.deepEqual(codexFor(undefined), CODEX_FOR_CLAUDE.haiku);
  assert.deepEqual(codexArgs({ prompt: 'p', model: null, effort: 'low' }).includes('-m'), false);
});

test('a stop is a stop: nothing more is asked', async () => {
  const m = machine({ claude: { login: true }, codex: { login: true }, answer: () => ({ code: null, stdout: '', stderr: '', aborted: true }) });
  const side = createSideModel({ exec: m.exec, env: HOST, log: quiet });
  const stop = new AbortController();
  stop.abort();
  assert.equal((await side.run({ job: 'test', prompt: 'x', signal: stop.signal })).aborted, true);
  assert.equal(m.jobs().length, 0);
  const aborted = await side.run({ job: 'test', prompt: 'x' });
  assert.equal(aborted.aborted, true);
  assert.equal(m.jobs().length, 1, 'Codex is not asked after Claude was stopped');
});

test('on a drive hosted for someone else, the host\'s own keys and starter credit never reach an agent', () => {
  const env = { PATH: '/bin', HOME: '/var/lib/marble-guests/ana/home', ANTHROPIC_API_KEY: 'sk-ant-owner', CODEX_API_KEY: 'sk-proj-owner', OPENAI_API_KEY: 'sk-owner', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-owner', CURSOR_API_KEY: 'cur', MARBLE_CREDIT_URL: 'https://x', MARBLE_CREDIT_TOKEN: 't', GIT_AUTHOR_NAME: 'ana' };
  const guest = agentHostEnv({ guest: true }, env);
  for (const name of KEY_VARIABLES) assert.equal(name in guest, false, name);
  assert.equal(guest.GIT_AUTHOR_NAME, 'ana');
  assert.equal(guest.HOME, env.HOME);
  assert.equal(agentHostEnv({ guest: false }, env), env, 'the owner\'s own drive keeps what its environment holds');
});
