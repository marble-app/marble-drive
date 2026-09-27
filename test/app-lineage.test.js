import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

// A template or starter that changed without its lineage being rewritten would
// ship a version no later release can recognise as a base.
test('every app lineage ends at today’s source (node tools/app-lineage.mjs)', () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ['tools/app-lineage.mjs', '--check'], { stdio: 'pipe' }));
});
