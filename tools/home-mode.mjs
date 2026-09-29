#!/usr/bin/env node
// Which way this machine should start its host: `serve` or `standby`
// (tools/sprite/serve.sh asks before every start). Without MARBLE_HUB_ENV the
// drive has one home, so always `serve`. A hub file that cannot be read means
// `standby`: better a drive that waits than two that write.

import { createLeaseClient, decideMode } from '../server/hub/lease-client.js';
import { loadHubSettings } from '../server/hub/settings.js';

let decided;
try {
  const settings = loadHubSettings(process.env.MARBLE_HUB_ENV);
  decided = await decideMode({ settings, client: settings ? createLeaseClient({ settings }) : null });
} catch (err) {
  decided = { mode: 'standby', why: `the hub settings could not be read: ${err.message}` };
}
console.error(`[home] ${decided.mode}: ${decided.why}`);
console.log(decided.mode);
