// Each drive on the PC gets a loopback port of its own from HOST_GUEST_PORTS
// (4500-4599): the lowest one no drive in the registry holds and nothing on
// this machine is listening on. Never the dev host's, the owner's drive's, a
// trial drive's or the release smoke test's (4400, 4401, 4402, 4498), even in
// a range set to cover them, nor marble-host's own two.

import net from 'node:net';

import { NEVER_PORTS } from './settings.js';

/** Whether something answers on the port: a connection is made, or refused. */
export function listening(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** The port for a new drive, or null when the range is full. */
export async function pickPort({ range, taken = new Set(), never = [], inUse = listening }) {
  const off = new Set([...NEVER_PORTS, ...never]);
  for (let port = range.from; port <= range.to; port += 1) {
    if (off.has(port) || taken.has(port)) continue;
    if (await inUse(port)) continue;
    return port;
  }
  return null;
}
