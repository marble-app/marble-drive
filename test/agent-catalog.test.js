import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CLAUDE_MODES,
  CURSOR_MODES,
  composeCursorModel,
  driveWhere,
  filesEditedLabel,
  groupCursorModels,
  nextMode,
  pickCursorPickerModels,
  resolveCursorModel,
  sortProviders,
  splitCursorModel,
} from '../server/agent/catalog.js';

test('Cursor model ids split into a family and an effort or speed', () => {
  assert.deepEqual(splitCursorModel('cursor-grok-4.6-xhigh'), { family: 'cursor-grok-4.6', effort: 'xhigh' });
  assert.deepEqual(splitCursorModel('cursor-grok-4.6-xhigh-fast'), { family: 'cursor-grok-4.6', effort: 'xhigh-fast' });
  assert.deepEqual(splitCursorModel('composer-2.5-fast'), { family: 'composer-2.5', effort: 'fast' });
  assert.deepEqual(splitCursorModel('gpt-5.2'), { family: 'gpt-5.2', effort: '' });
  assert.equal(composeCursorModel('cursor-grok-4.6', 'xhigh'), 'cursor-grok-4.6-xhigh');
  assert.equal(resolveCursorModel('cursor-grok-4.6', 'xhigh', 'composer-2.5'), 'cursor-grok-4.6-xhigh');
  assert.equal(resolveCursorModel('cursor-grok-4.6-high', 'xhigh-fast', 'composer-2.5'), 'cursor-grok-4.6-xhigh-fast');
  assert.equal(resolveCursorModel(null, null, 'composer-2.5'), 'composer-2.5');
  assert.equal(resolveCursorModel('opus', 'high', 'composer-2.5'), 'composer-2.5');
  assert.equal(resolveCursorModel('fable', 'high', 'grok-4.7'), 'grok-4.7');
  assert.equal(resolveCursorModel('claude-opus-5-5[1m]', 'high', 'composer-2.5'), 'composer-2.5');
  assert.equal(resolveCursorModel('claude-opus-5-5', 'high', 'composer-2.5'), 'claude-opus-5-5-high');
});

test('Cursor catalogs collapse effort variants into one family with effort radios', () => {
  const grouped = groupCursorModels([
    { id: 'auto', label: 'Auto (default)' },
    { id: 'composer-2.5', label: 'Composer 2.5' },
    { id: 'composer-2.5-fast', label: 'Composer 2.5 Fast' },
    { id: 'cursor-grok-4.6-high', label: 'Cursor Grok 4.6' },
    { id: 'cursor-grok-4.6-xhigh', label: 'Cursor Grok 4.6 Extra High' },
    { id: 'cursor-grok-4.6-xhigh-fast', label: 'Cursor Grok 4.6 Extra High Fast' },
  ]);
  assert.deepEqual(grouped.map((item) => item.id), ['auto', 'composer-2.5', 'cursor-grok-4.6']);
  assert.equal(grouped.find((item) => item.id === 'cursor-grok-4.6').label, 'Grok 4.6');
  assert.deepEqual(
    grouped.find((item) => item.id === 'cursor-grok-4.6').efforts.map((item) => item.id),
    ['high', 'xhigh', 'xhigh-fast'],
  );
  assert.deepEqual(
    grouped.find((item) => item.id === 'composer-2.5').efforts.map((item) => item.id),
    ['fast'],
  );
});

test('the Cursor picker only offers Auto and the best Grok family', () => {
  const older = pickCursorPickerModels([
    { id: 'auto', label: 'Auto (default)' },
    { id: 'composer-2.5', label: 'Composer 2.5' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
    { id: 'cursor-grok-4.5-high', label: 'Grok 4.5' },
    { id: 'cursor-grok-4.6-high', label: 'Grok 4.6' },
    { id: 'cursor-grok-4.6-xhigh', label: 'Grok 4.6 Extra High' },
  ]);
  assert.deepEqual(older.map((item) => item.id), ['auto', 'cursor-grok-4.6']);
  const picked = pickCursorPickerModels([
    { id: 'auto', label: 'Auto (default)' },
    { id: 'cursor-grok-4.6-high', label: 'Grok 4.6' },
    { id: 'grok-4.7-high', label: 'Grok 4.7  High' },
    { id: 'grok-4.7-high-fast', label: 'Grok 4.7  High Fast' },
    { id: 'grok-4.7-xhigh', label: 'Grok 4.7  Extra High' },
  ]);
  assert.deepEqual(picked.map((item) => item.id), ['auto', 'grok-4.7']);
  assert.equal(picked.find((item) => item.id === 'grok-4.7').label, 'Grok 4.7');
  assert.deepEqual(
    picked.find((item) => item.id === 'grok-4.7').efforts.map((item) => item.id),
    ['high', 'high-fast', 'xhigh'],
  );
  assert.equal(resolveCursorModel('grok-4.7', 'high', 'composer-2.5'), 'grok-4.7-high');
});

test('picker providers sort Claude, Cursor, then the API-key Claude', () => {
  const sorted = sortProviders([
    { id: 'claude-api', label: 'Claude API' },
    { id: 'fake', label: 'Fake' },
    { id: 'cursor', label: 'Cursor' },
    { id: 'claude-subscription', label: 'Claude' },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ['claude-subscription', 'cursor', 'claude-api', 'fake']);
});

test('Shift+Tab walks each CLI’s modes and wraps', () => {
  assert.equal(nextMode(CLAUDE_MODES, 'auto'), 'acceptEdits');
  assert.equal(nextMode(CLAUDE_MODES, 'bypassPermissions'), 'auto');
  assert.equal(nextMode(CLAUDE_MODES, 'default'), 'auto', 'a mode from before auto existed steps onto the wheel');
  assert.equal(nextMode(CURSOR_MODES, 'agent'), 'plan');
  assert.equal(nextMode(CURSOR_MODES, 'review'), 'agent');
  assert.equal(CURSOR_MODES[0].label, 'Run Everything');
});

test('files-edited copy is countable English', () => {
  assert.equal(filesEditedLabel(0), '0 documents changed');
  assert.equal(filesEditedLabel(1), '1 document changed');
  assert.equal(filesEditedLabel(71), '71 documents changed');
});

test('the drive where-line uses a home tilde and the git branch', async () => {
  const home = '/Users/bryanmin';
  const exec = async (command, args) => {
    assert.equal(command, 'git');
    assert.deepEqual(args.slice(0, 2), ['-C', path.join(home, 'Development', 'marble-drive')]);
    return { code: 0, stdout: 'main\n', stderr: '' };
  };
  assert.deepEqual(
    await driveWhere(path.join(home, 'Development', 'marble-drive'), { exec, home }),
    { path: '~/Development/marble-drive', branch: 'main' },
  );
  assert.deepEqual(
    await driveWhere('/tmp/scratch', { exec: async () => ({ code: 128, stdout: '', stderr: '' }), home }),
    { path: '/tmp/scratch', branch: null },
  );
  assert.equal(os.homedir().length > 1, true);
});
