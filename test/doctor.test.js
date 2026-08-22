// Every document this repo can produce, checked against the format's own
// doctor rather than against a second opinion written here. If a starter drifts
// out of the invariants that keep a .mrbl addressable, this is where it shows.

import assert from 'node:assert/strict';
import test from 'node:test';

import { STARTERS, build } from '../server/gallery.js';
import { buildDrive } from '../server/seed.js';

const { examine } = await import(
  new URL('scripts/doctor.js', import.meta.resolve('@bdhmin/marble/package.json')).href
);

const report = (findings) =>
  findings.map((finding) => `${finding.line}: ${finding.message ?? JSON.stringify(finding)}`).join('\n');

for (const starter of STARTERS) {
  test(`the ${starter.id} starter passes marble doctor`, async () => {
    const source = await build(starter.id, { name: starter.id });
    const findings = examine(`${starter.id}.mrbl`, source);
    assert.deepEqual(findings, [], `\n${report(findings)}`);
  });
}

test('the Drive document passes marble doctor', async () => {
  const source = await buildDrive();
  const findings = examine('drive.mrbl', source);
  assert.deepEqual(findings, [], `\n${report(findings)}`);
});

test('the Drive names no route, because a document never does', async () => {
  const source = await buildDrive();
  // The Drive's verbs come through `marble.drive`, which is the host's job to
  // provide. A path in here would be this document only ever opening on one.
  assert.ok(!/['"`]\/(?:ops|docs|events|intent|zoom|drive|blob|history|restore)\b/.test(source));
  assert.match(source, /marble\.drive/);
});
