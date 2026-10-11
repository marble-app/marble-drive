import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'macos', 'finder-helper');

test('finder helper maps drive paths the way /a/ expects', { skip: os.platform() !== 'darwin' }, () => {
  const bin = path.join(os.tmpdir(), `marble-map-tests-${process.pid}`);
  const compiled = spawnSync('swiftc', [
    '-parse-as-library',
    path.join(HERE, 'Mapping.swift'),
    path.join(HERE, 'MappingTests.swift'),
    '-o', bin,
  ], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const ran = spawnSync(bin, { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.match(ran.stdout, /all passed/);
});
