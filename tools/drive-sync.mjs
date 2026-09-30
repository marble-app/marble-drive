#!/usr/bin/env node
// The hub by hand, and what tools/drive-home.mjs runs on each machine.
//
//   node tools/drive-sync.mjs up [--root <dir>] [--epoch <n>] [--force]
//   node tools/drive-sync.mjs down [--root <dir>]
//   node tools/drive-sync.mjs counts [--root <dir>]
//   node tools/drive-sync.mjs state
//   node tools/drive-sync.mjs trash-prefix
//
// Settings from the file MARBLE_HUB_ENV names. --root defaults to
// MARBLE_DRIVE_ROOT. Prints one JSON object; exits 0 whenever it printed one
// (a refusal is {"ok":false,"why":…}), 1 only when something broke.

import { loadHubSettings } from '../server/hub/settings.js';
import { createLeaseClient } from '../server/hub/lease-client.js';
import { down, rcloneEnv, readState, scan, trashPrefix, up } from '../server/hub/sync.js';

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at < 0 ? null : rest[at + 1] ?? true;
};
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

try {
  const root = flag('root') ?? process.env.MARBLE_DRIVE_ROOT;
  if (command === 'counts') {
    const { byPath, ...counts } = await scan(root); // not the file list: thousands of lines
    print(counts);
  } else {
    const settings = loadHubSettings(process.env.MARBLE_HUB_ENV);
    if (!settings) throw new Error('no hub: set MARBLE_HUB_ENV to the hub settings file');
    if (command === 'up') {
      const epoch = flag('epoch') !== null ? Number(flag('epoch')) : (await createLeaseClient({ settings }).get()).epoch;
      print(await up({ root, settings, epoch, force: flag('force') === true }));
    } else if (command === 'down') {
      print(await down({ root, settings }));
    } else if (command === 'state') {
      print(await readState({ settings, env: await rcloneEnv(settings) }));
    } else if (command === 'trash-prefix') {
      print({ prefix: await trashPrefix({ settings }) });
    } else {
      throw new Error(`unknown command ${command ?? '(none)'}: up, down, counts, state, trash-prefix`);
    }
  }
} catch (err) {
  console.error(`drive-sync: ${err.message}`);
  process.exit(1);
}
