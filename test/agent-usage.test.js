import assert from 'node:assert/strict';
import test from 'node:test';

import { claudeTokenFromKeychain, collectUsage, parseClaudeUsage, parseCursorUsage } from '../server/agent/usage.js';

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
    request: async () => {
      throw new Error('should not fetch');
    },
  });
  assert.deepEqual(meters, []);
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
