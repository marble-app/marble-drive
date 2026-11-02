import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PERSONAL, claudeLoginFor, describeLogin, limitResetsAt, listClaudeAccounts, publicAccount, sharesSessions } from '../server/agent/claude-accounts.js';

const here = () => true;

test('logins are listed Personal first, one per config dir, named by label or folder', () => {
  const accounts = listClaudeAccounts([
    { folder: 'Ai2', configDir: '/h/.claude-ai2' },
    { folder: 'Work/Ai2 Notes', configDir: '/h/.claude-ai2' },
    { label: 'Lab', configDir: '/h/.claude-lab', folders: ['Lab'] },
    { folder: 'Rel', configDir: 'relative/dir' },
  ], { exists: here });
  assert.deepEqual(accounts.map((a) => [a.id, a.label, a.folders]), [
    [PERSONAL, 'Personal', []],
    ['ai2', 'Ai2', ['Ai2', 'Work/Ai2 Notes']],
    ['lab', 'Lab', ['Lab']],
  ]);
  assert.deepEqual(Object.keys(publicAccount(accounts[1])).sort(), ['fallback', 'folders', 'id', 'label', 'paused', 'present'], 'no config dir goes to the page');
});

test('a chat on a picked login runs there, wherever its document is', () => {
  const entries = [{ folder: 'Ai2', configDir: '/h/.claude-ai2' }];
  assert.equal(claudeLoginFor({ target: 'Chat.mrbl', entries, choice: 'ai2', exists: here }).configDir, '/h/.claude-ai2');
  assert.equal(claudeLoginFor({ target: 'Chat.mrbl', entries, choice: 'ai2', exists: here }).how, 'chosen');
  const personal = claudeLoginFor({ target: 'Ai2/x.mrbl', entries, choice: PERSONAL, exists: here });
  assert.equal(personal.id, PERSONAL);
  assert.equal(personal.configDir, null);
});

test('without a pick, the folder decides, and a login this machine lacks is skipped', () => {
  const entries = [{ folder: 'Ai2', configDir: '/h/.claude-ai2' }, { folder: 'Gone', configDir: '/nowhere' }];
  const exists = (dir) => dir !== '/nowhere';
  assert.equal(claudeLoginFor({ target: 'Ai2/AstaUI/x.mrbl', entries, exists }).how, 'folder');
  assert.equal(claudeLoginFor({ target: 'Ai2 Notes.mrbl', entries, exists }).id, PERSONAL);
  assert.equal(claudeLoginFor({ target: 'Gone/x.mrbl', entries, exists }).id, PERSONAL);
  assert.equal(claudeLoginFor({ target: 'Ai2/x.mrbl', entries, choice: 'gone', exists }).id, 'ai2', 'a pick that is not here falls back to the folder');
});

test('a login that is out hands its turns to its fallback, and only then', () => {
  const entries = [{ folder: 'Ai2', configDir: '/h/.claude-ai2', fallback: 'personal' }];
  assert.equal(claudeLoginFor({ target: 'Ai2/x.mrbl', entries, exists: here }).id, 'ai2');
  const stand = claudeLoginFor({ target: 'Ai2/x.mrbl', entries, out: new Set(['ai2']), exists: here });
  assert.deepEqual([stand.id, stand.how, stand.from, stand.configDir], [PERSONAL, 'fallback', 'ai2', null]);
  assert.equal(claudeLoginFor({ target: 'Chat.mrbl', entries, choice: 'ai2', out: new Set(['ai2']), exists: here }).id, PERSONAL, 'a hand pick falls back too');
  const none = [{ folder: 'Ai2', configDir: '/h/.claude-ai2' }];
  assert.equal(claudeLoginFor({ target: 'Ai2/x.mrbl', entries: none, out: new Set(['ai2']), exists: here }).id, 'ai2', 'no fallback named, no move');
  const both = claudeLoginFor({ target: 'Ai2/x.mrbl', entries, out: new Set(['ai2', PERSONAL]), exists: here });
  assert.equal(both.id, 'ai2', 'a fallback that is out too is no help');
});

test('a paused login gives its folders back to Personal, but not a chat that picked it', () => {
  const entries = [{ folder: 'Ai2', configDir: '/h/.claude-ai2', paused: true }];
  assert.equal(claudeLoginFor({ target: 'Ai2/x.mrbl', entries, exists: here }).id, PERSONAL);
  assert.equal(claudeLoginFor({ target: 'Ai2/x.mrbl', entries, choice: 'ai2', exists: here }).id, 'ai2');
  assert.equal(listClaudeAccounts(entries, { exists: here })[1].paused, true);
});

test('the reset a limit message names is read in its own time zone', () => {
  const now = Date.parse('2026-11-01T15:30:00-08:00');
  const spend = "You've hit your individual spend limit · run /usage-credits to ask your admin for a higher limit · your weekly limit resets Nov 2, 12pm (America/Los_Angeles)";
  assert.equal(new Date(limitResetsAt(spend, { now })).toISOString(), '2026-11-02T20:00:00.000Z');
  assert.equal(new Date(limitResetsAt('resets 10:30am (America/Los_Angeles)', { now })).toISOString(), '2026-11-02T18:30:00.000Z', 'a time already past today is tomorrow');
  assert.equal(new Date(limitResetsAt('resets 7pm (America/Los_Angeles)', { now })).toISOString(), '2026-11-02T03:00:00.000Z');
  assert.equal(limitResetsAt('Claude reported an error', { now }), null);
});

test('two logins share sessions when their projects folders are one folder', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'accts-'));
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude-ai2'));
  fs.symlinkSync(path.join(home, '.claude', 'projects'), path.join(home, '.claude-ai2', 'projects'));
  fs.mkdirSync(path.join(home, '.claude-lab', 'projects'), { recursive: true });
  assert.equal(sharesSessions(null, path.join(home, '.claude-ai2'), { home }), true);
  assert.equal(sharesSessions(null, path.join(home, '.claude-lab'), { home }), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('who a login is comes from auth status under its config dir', async () => {
  const seen = [];
  const exec = async (cmd, args, { env }) => {
    seen.push(env.CLAUDE_CONFIG_DIR ?? null);
    return { stdout: JSON.stringify({ loggedIn: true, email: 'a@b.org', orgName: 'Ai2', subscriptionType: 'enterprise', accessToken: 'nope' }) };
  };
  const who = await describeLogin({ id: 'ai2', configDir: '/h/.claude-ai2' }, { exec });
  assert.deepEqual(who, { signedIn: true, email: 'a@b.org', org: 'Ai2', plan: 'enterprise' });
  assert.deepEqual(seen, ['/h/.claude-ai2']);
  assert.deepEqual(await describeLogin({ id: 'x', configDir: null }, { exec: async () => ({ stdout: '{"loggedIn":false}' }) }), { signedIn: false });
  assert.deepEqual(await describeLogin({ id: 'x', configDir: null }, { exec: async () => { throw new Error('timed out'); } }), { signedIn: null }, 'a check that failed is not a sign-out');
});
