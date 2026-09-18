import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../server/config.js';

test('the host listens on loopback unless told otherwise', () => {
  // A laptop on café wifi with no secret set is an open drive to the room. The
  // way in from another device is a proxy on this machine (Tailscale Serve),
  // and a container says HOST=0.0.0.0 for itself.
  assert.equal(loadConfig({}).host, '127.0.0.1');
  assert.equal(loadConfig({ HOST: '0.0.0.0' }).host, '0.0.0.0');
});

test('agent limits default to no cap and a 30 minute stall', () => {
  const config = loadConfig({});
  assert.equal(config.agentMaxMinutes, 0);
  assert.equal(config.agentStallMinutes, 30);
});
