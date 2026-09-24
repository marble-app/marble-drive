// The console's view of the fleet comes from the Sprites API through the CLI,
// which never wakes a drive: who exists, awake or asleep and since when, the
// link, labels and checkpoints. Nothing else from the API is passed on.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSprites } from '../server/console/sprites.js';
import { fakeFleet } from './fixtures/console-fleet.js';

test('the list is one row per drive: name, awake or asleep since when, link, access, labels', async () => {
  const fleet = await fakeFleet();
  const sprites = createSprites({ bin: fleet.bin, org: 'marble-drive' });
  const rows = await sprites.list();
  assert.deepEqual(rows.map((r) => r.name), ['admin-p1', 't-bryan', 't-irene', 't-peiling', 't-sam', 't-sangho']);
  const sam = rows.find((r) => r.name === 't-sam');
  assert.equal(sam.awake, true);
  assert.ok(sam.since, 'awake since it woke');
  const irene = rows.find((r) => r.name === 't-irene');
  assert.equal(irene.awake, false);
  assert.equal(irene.since, fleet.state.sprites.find((s) => s.name === 't-irene').last_warming_at, 'asleep since it paused');
  assert.equal(irene.access, 'public');
  assert.equal(rows[0].access, 'private');
  assert.deepEqual(rows[0].labels, ['marble-owner']);
  assert.equal(irene.url, 'https://t-irene-b3fwm.sprites.app');
  assert.deepEqual(Object.keys(irene).sort(), ['access', 'awake', 'createdAt', 'labels', 'name', 'since', 'status', 'url']);
  assert.deepEqual((await fleet.calls())[0], ['api', '-o', 'marble-drive', '/v1/sprites/']);
});

test('checkpoints leave out the live one, newest first', async () => {
  const fleet = await fakeFleet({ checkpoints: { 't-bryan': [
    { id: 'v6', create_time: '2026-09-24T05:16:53Z', comment: 'before deploy x' },
    { id: 'v5', create_time: '2026-09-24T05:08:00Z', comment: 'before deploy y' },
  ] } });
  const sprites = createSprites({ bin: fleet.bin, org: 'marble-drive' });
  assert.deepEqual(await sprites.checkpoints('t-bryan'), [
    { id: 'v6', at: '2026-09-24T05:16:53Z', comment: 'before deploy x' },
    { id: 'v5', at: '2026-09-24T05:08:00Z', comment: 'before deploy y' },
  ]);
});

test('the commands a job runs are built as argument lists, for the drive named', async () => {
  const sprites = createSprites({ bin: '/x/sprite', org: 'marble-drive' });
  assert.deepEqual(sprites.command.exec('t-sam', ['cat', 'a b'], { files: [['/tmp/l', '/r']] }),
    ['/x/sprite', ['exec', '-o', 'marble-drive', '-s', 't-sam', '--no-stdin', '--file', '/tmp/l:/r', '--', 'cat', 'a b']]);
  assert.deepEqual(sprites.command.checkpoint('t-sam', 'before x'), ['/x/sprite', ['checkpoint', 'create', '-o', 'marble-drive', '-s', 't-sam', '--comment', 'before x']]);
  assert.deepEqual(sprites.command.restore('t-sam', 'v3'), ['/x/sprite', ['restore', 'v3', '-o', 'marble-drive', '-s', 't-sam']]);
  assert.deepEqual(sprites.command.access('t-sam', 'public'), ['/x/sprite', ['config', 'update', '--url-auth', 'public', '-o', 'marble-drive', '-s', 't-sam']]);
  assert.throws(() => sprites.command.access('t-sam', 'everyone'), /public or private/);
});
