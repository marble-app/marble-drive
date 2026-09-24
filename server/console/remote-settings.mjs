// Run on a drive's sprite by the console: change one of the drive's own Agents
// settings the way its owner's browser would, by signing in to its host on
// loopback with the passphrase and saving the setting. Loopback, because a
// private drive's link needs a Fly sign-in the console does not have.
//
//   node remote-settings.mjs <payload.json>
//   payload: { "secret": "...", "settings": { "claudeAuth": "login" } }
//
// The payload file holds the passphrase, so it is removed first thing.

import fs from 'node:fs';

const file = process.argv[2];
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.rmSync(file, { force: true });
const base = `http://127.0.0.1:${process.env.MARBLE_PROBE_PORT || 4400}`;

const gate = await fetch(`${base}/gate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ secret: payload.secret }),
});
const cookie = (gate.headers.get('set-cookie') ?? '').split(';')[0];
if (!gate.ok || !cookie) {
  console.error(`the drive did not let the console in (${gate.status})`);
  process.exit(1);
}
const put = await fetch(`${base}/agent/settings`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', cookie, origin: base },
  body: JSON.stringify(payload.settings),
});
if (!put.ok) {
  console.error(`the drive refused the setting (${put.status}): ${(await put.text()).slice(0, 200)}`);
  process.exit(1);
}
const saved = await put.json().catch(() => ({}));
for (const key of Object.keys(payload.settings)) console.log(`${key}: ${saved[key] ?? payload.settings[key]}`);
