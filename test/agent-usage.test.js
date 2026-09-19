import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claudeTokenFromFile, claudeTokenFromKeychain, collectUsage, parseClaudeUsage, parseCursorUsage } from '../server/agent/usage.js';

test('Claude compact meter is the 5-hour window even when the week is higher', () => {
  const meter = parseClaudeUsage({
    five_hour: { utilization: 23, resets_at: '2026-09-17T22:30:00Z' },
    seven_day: { utilization: 80, resets_at: '2026-09-20T10:59:59Z' },
    limits: [
      { kind: 'weekly_all', percent: 80, is_active: true, resets_at: '2026-09-20T10:59:59Z' },
    ],
  });
  assert.equal(meter.id, 'claude-subscription');
  assert.equal(meter.label, 'Claude');
  assert.equal(meter.used, 23);
  assert.equal(meter.left, 77);
  assert.equal(meter.window, '5h');
  assert.equal(meter.resetsAt, '2026-09-17T22:30:00Z');
  assert.match(meter.detail, /23%/);
  assert.match(meter.detail, /80%/);
  assert.deepEqual(meter.windows, [
    { id: '5h', label: 'Short-term', used: 23, left: 77, resetsAt: '2026-09-17T22:30:00Z', kind: 'quota' },
    { id: 'week', label: 'Weekly', used: 80, left: 20, resetsAt: '2026-09-20T10:59:59Z', kind: 'quota' },
  ]);
});

test('Claude usage is used percent of the 5-hour window', () => {
  const meter = parseClaudeUsage({
    five_hour: { utilization: 23, resets_at: '2026-09-17T22:30:00Z' },
    seven_day: { utilization: 41, resets_at: '2026-09-20T10:59:59Z' },
    limits: [
      { kind: 'session', percent: 23, is_active: true, resets_at: '2026-09-17T22:30:00Z' },
      { kind: 'weekly_all', percent: 41, is_active: false, resets_at: '2026-09-20T10:59:59Z' },
    ],
  });
  assert.equal(meter.used, 23);
  assert.equal(meter.window, '5h');
  assert.deepEqual(meter.windows.map((item) => `${item.label} ${item.used}`), ['Short-term 23', 'Weekly 41']);
});

test('Claude usage with a spent session window reads as fully used', () => {
  const meter = parseClaudeUsage({
    five_hour: { utilization: 100, resets_at: '2026-09-17T22:30:00Z' },
    seven_day: { utilization: 95, resets_at: '2026-09-20T10:59:59Z' },
    limits: [{ kind: 'session', percent: 100, is_active: true, resets_at: '2026-09-17T22:30:00Z' }],
  });
  assert.equal(meter.used, 100);
  assert.equal(meter.left, 0);
});

test('Claude settings windows are short-term and weekly, not extra shares', () => {
  const meter = parseClaudeUsage({
    five_hour: { utilization: 10, resets_at: '2026-09-17T22:30:00Z' },
    seven_day: { utilization: 40, resets_at: '2026-09-20T10:59:59Z' },
    seven_day_sonnet: { utilization: 12, resets_at: '2026-09-20T10:59:59Z' },
    seven_day_breakdown: {
      rows: [
        { key: 'claude_code', display_name: 'Claude Code', percent: 97 },
        { key: 'chat', display_name: 'Chats', percent: 3 },
      ],
    },
  });
  assert.deepEqual(meter.windows.map((window) => `${window.id} ${window.label} ${window.used}`), [
    '5h Short-term 10',
    'week Weekly 40',
  ]);
  assert.equal(meter.windows.every((window) => window.kind === 'quota'), true);
});

// The shape Anthropic actually returns (captured 2026-09-18): per-model weekly
// limits are `weekly_scoped` entries in `limits`, named by scope.model.
const scoped = (name, percent, resetsAt = '2026-09-20T11:00:00+00:00') => ({
  kind: 'weekly_scoped', group: 'weekly', percent, severity: 'normal', resets_at: resetsAt, is_active: false,
  scope: { model: { id: null, display_name: name }, surface: null },
});

test('Claude usage carries a Fable window from the weekly_scoped limit named Fable', () => {
  const meter = parseClaudeUsage({
    five_hour: { utilization: 44, resets_at: '2026-09-18T20:30:00+00:00' },
    seven_day: { utilization: 9, resets_at: '2026-09-20T11:00:00+00:00' },
    seven_day_sonnet: null,
    nimbus_quill: { utilization: 0, resets_at: null },
    limits: [
      { kind: 'session', group: 'session', percent: 44, resets_at: '2026-09-18T20:30:00+00:00', scope: null, is_active: true },
      { kind: 'weekly_all', group: 'weekly', percent: 9, resets_at: '2026-09-20T11:00:00+00:00', scope: null, is_active: false },
      scoped('Fable', 12.4),
    ],
  });
  assert.deepEqual(meter.windows.map((window) => `${window.id} ${window.label} ${window.used}`), [
    '5h Short-term 44',
    'week Weekly 9',
    'fable Fable 12',
  ]);
  const fable = meter.windows.find((window) => window.id === 'fable');
  assert.equal(fable.left, 88);
  assert.equal(fable.resetsAt, '2026-09-20T11:00:00+00:00');
  assert.equal(fable.kind, 'quota');
  // The compact Claude meter is still the 5-hour window.
  assert.equal(meter.used, 44);
});

test('a scoped limit for another model is not Fable, and the name match ignores case', () => {
  const other = parseClaudeUsage({
    five_hour: { utilization: 10 }, seven_day: { utilization: 40 },
    limits: [scoped('Sonnet', 77)],
  });
  assert.equal(other.windows.some((window) => window.id === 'fable'), false);
  const loud = parseClaudeUsage({
    five_hour: { utilization: 10 }, seven_day: { utilization: 40 },
    limits: [scoped('SONNET', 77), scoped('FABLE', 5)],
  });
  assert.equal(loud.windows.find((window) => window.id === 'fable').used, 5);
});

test('a versioned or renamed Fable scope still counts: the match is on the name, not the exact kind', () => {
  const named = parseClaudeUsage({
    five_hour: { utilization: 10 }, seven_day: { utilization: 40 },
    limits: [scoped('Fable 5.1', 33)],
  });
  assert.equal(named.windows.find((window) => window.id === 'fable').used, 33);
  const kind = parseClaudeUsage({
    five_hour: { utilization: 10 }, seven_day: { utilization: 40 },
    limits: [{ ...scoped('Fable', 21), kind: 'weekly_model' }],
  });
  assert.equal(kind.windows.find((window) => window.id === 'fable').used, 21);
  const group = parseClaudeUsage({
    five_hour: { utilization: 10 }, seven_day: { utilization: 40 },
    limits: [{ ...scoped('Fable', 17), kind: 'scoped_model' }],
  });
  assert.equal(group.windows.find((window) => window.id === 'fable').used, 17, 'group: weekly is enough');
  // A model that merely contains the letters is not Fable.
  const other = parseClaudeUsage({
    five_hour: { utilization: 10 }, seven_day: { utilization: 40 },
    limits: [scoped('Unfabled', 9), { ...scoped('Fable', 9), group: 'session', kind: 'session' }],
  });
  assert.equal(other.windows.some((window) => window.id === 'fable'), false);
});

test('Claude usage has no Fable window when there is no limits array, or the percent is missing', () => {
  const none = parseClaudeUsage({ five_hour: { utilization: 10 }, seven_day: { utilization: 40 } });
  assert.equal(none.windows.some((window) => window.id === 'fable'), false);
  const junk = parseClaudeUsage({
    five_hour: { utilization: 10 }, seven_day: { utilization: 40 },
    limits: [null, 'x', { kind: 'weekly_scoped', scope: null }, { ...scoped('Fable', 0), percent: null }],
  });
  assert.equal(junk.windows.some((window) => window.id === 'fable'), false);
});

test('Cursor usage is used percent of the Cursor-models pool', () => {
  const meter = parseCursorUsage({
    billingCycleEnd: '1789861494000',
    planUsage: { autoPercentUsed: 12.52, apiPercentUsed: 100, totalPercentUsed: 19.92 },
  });
  assert.equal(meter.id, 'cursor');
  assert.equal(meter.label, 'Cursor');
  assert.equal(meter.used, 13);
  assert.equal(meter.left, 87);
  assert.match(meter.detail, /Cursor models 13%/);
  assert.deepEqual(meter.windows, [
    { id: 'auto', label: 'Cursor models', used: 13, left: 87, resetsAt: '1789861494000', kind: 'quota' },
    { id: 'api', label: 'Other models', used: 100, left: 0, resetsAt: '1789861494000', kind: 'quota' },
  ]);
});

test('Claude keychain JSON yields the OAuth access token and nothing else', () => {
  const secret = JSON.stringify({
    claudeAiOauth: { accessToken: 'sk-ant-oat-test', refreshToken: 'sk-ant-ort-test' },
  });
  assert.equal(claudeTokenFromKeychain(secret), 'sk-ant-oat-test');
  assert.equal(claudeTokenFromKeychain('not-json'), 'not-json');
  assert.equal(claudeTokenFromKeychain(''), null);
});

test('collectUsage asks Claude and Cursor with the tokens from the keychain, never returning the secrets', async () => {
  const calls = [];
  const meters = await collectUsage({
    exec: async (command, args) => {
      calls.push({ command, args });
      if (args.includes('Claude Code-credentials')) {
        return { code: 0, stdout: JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-test' } }), stderr: '', missing: false };
      }
      if (args.includes('cursor-access-token')) {
        return { code: 0, stdout: 'cursor-token-test', stderr: '', missing: false };
      }
      return { code: 1, stdout: '', stderr: 'not found', missing: false };
    },
    request: async (url, options) => {
      const auth = options.headers?.Authorization ?? '';
      calls.push({
        url: String(url),
        method: options.method ?? 'GET',
        hasBearer: auth.startsWith('Bearer '),
      });
      if (String(url).includes('oauth/usage')) {
        return {
          ok: true,
          json: async () => ({
            five_hour: { utilization: 10, resets_at: '2026-09-17T22:30:00Z' },
            seven_day: { utilization: 20, resets_at: '2026-09-20T10:59:59Z' },
            limits: [{ kind: 'session', percent: 10, is_active: true, resets_at: '2026-09-17T22:30:00Z' }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          planUsage: { autoPercentUsed: 5, apiPercentUsed: 8, totalPercentUsed: 6 },
        }),
      };
    },
  });
  assert.equal(meters.meters.length, 2);
  assert.equal(meters.meters[0].used, 10);
  assert.equal(meters.meters[1].used, 5);
  assert.equal(JSON.stringify(meters).includes('sk-ant-oat-test'), false);
  assert.equal(JSON.stringify(meters).includes('cursor-token-test'), false);
  assert.ok(calls.every((call) => !JSON.stringify(call).includes('sk-ant-oat-test')));
  assert.ok(calls.every((call) => !JSON.stringify(call).includes('cursor-token-test')));
  assert.ok(calls.some((call) => call.url?.includes('/api/oauth/usage') && call.hasBearer));
  assert.ok(calls.some((call) => call.url?.includes('GetCurrentPeriodUsage') && call.method === 'POST' && call.hasBearer));
});

test('a missing keychain is an empty list, not a throw', async () => {
  const { meters } = await collectUsage({
    exec: async () => ({ code: 1, stdout: '', stderr: 'not found', missing: true }),
    credentialsFile: path.join(os.tmpdir(), 'marble-no-such-credentials.json'),
    request: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.deepEqual(meters, []);
});

test('a signed-in CLI that keeps its login in a file still has a Claude meter', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marble-usage-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.credentials.json');
  await fs.writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-file' } }), 'utf8');
  const asked = [];
  const { meters } = await collectUsage({
    // No keychain entry at all: this is the 2.1 CLI, signed in, file-only.
    exec: async () => ({ code: 1, stdout: '', stderr: 'not found', missing: true }),
    credentialsFile: file,
    request: async (url, options) => {
      asked.push({ url: String(url), hasBearer: String(options.headers?.Authorization ?? '').startsWith('Bearer ') });
      return {
        ok: true,
        json: async () => ({
          five_hour: { utilization: 31, resets_at: '2026-09-19T22:30:00Z' },
          seven_day: { utilization: 44, resets_at: '2026-09-22T10:59:59Z' },
        }),
      };
    },
  });
  assert.equal(meters.length, 1);
  assert.equal(meters[0].id, 'claude-subscription');
  assert.equal(meters[0].available, true);
  assert.equal(meters[0].used, 31);
  assert.ok(asked.some((call) => call.url.includes('/api/oauth/usage') && call.hasBearer));
  assert.equal(JSON.stringify({ meters, asked }).includes('sk-ant-oat-file'), false);
});

test('the keychain wins over the file, and a file that is not the login is not a token', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'marble-usage-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  assert.equal(claudeTokenFromFile(JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-file' } })), 'sk-ant-oat-file');
  assert.equal(claudeTokenFromFile('sk-ant-oat-bare'), null, 'a bare string in a file is not the login shape');
  assert.equal(claudeTokenFromFile('{ not json'), null);
  assert.equal(claudeTokenFromFile(''), null);

  const file = path.join(dir, '.credentials.json');
  await fs.writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-file' } }), 'utf8');
  let bearer = '';
  await collectUsage({
    exec: async (command, args) => (args.includes('Claude Code-credentials')
      ? { code: 0, stdout: JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-chain' } }), stderr: '', missing: false }
      : { code: 1, stdout: '', stderr: 'not found', missing: true }),
    credentialsFile: file,
    request: async (url, options) => {
      if (String(url).includes('oauth/usage')) bearer = String(options.headers?.Authorization ?? '');
      return { ok: false, json: async () => ({}) };
    },
  });
  assert.equal(bearer, 'Bearer sk-ant-oat-chain');
});

test('a Claude usage fetch that fails is an unavailable meter, not a missing one', async () => {
  const { meters } = await collectUsage({
    exec: async (command, args) => {
      if (args.includes('Claude Code-credentials')) {
        return { code: 0, stdout: JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-test' } }), stderr: '', missing: false };
      }
      return { code: 1, stdout: '', stderr: 'not found', missing: true };
    },
    request: async () => ({ ok: false, json: async () => ({}) }),
  });
  assert.equal(meters.length, 1);
  assert.equal(meters[0].id, 'claude-subscription');
  assert.equal(meters[0].available, false);
  assert.equal(meters[0].used, null);
  assert.match(meters[0].detail, /unavailable/i);
  assert.equal(JSON.stringify(meters).includes('sk-ant-oat-test'), false);
});
