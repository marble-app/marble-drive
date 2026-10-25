// Each drive on the PC gets a port of its own from HOST_GUEST_PORTS
// (4500-4599), and with it a loopback address of its own
// (server/host/addresses.js): the lowest port no drive in the registry holds
// and nothing on this machine answers on at that address. Never the dev
// host's, the owner's drive's, a trial drive's or the release smoke test's
// (4400, 4401, 4402, 4498), even in a range set to cover them, nor
// marble-host's own two.

import net from 'node:net';

import { guestAddress, HOST_SIDE } from './addresses.js';
import { NEVER_PORTS } from './settings.js';

/** Whether something answers on the port at `host`: a connection is made,
 *  or refused. Asked from marble-host's own address, as every request to a
 *  drive is: a drive's unit drops one from 127.0.0.1 unanswered. */
export function listening(port, host, { from = HOST_SIDE, timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host, localAddress: from });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Whether a drive given this port could listen there: nothing answers at
 *  the address that comes with it. */
export const portInUse = (port) => listening(port, guestAddress(port));

/** The port for a new drive, or null when the range is full. */
export async function pickPort({ range, taken = new Set(), never = [], inUse = portInUse }) {
  const off = new Set([...NEVER_PORTS, ...never]);
  for (let port = range.from; port <= range.to; port += 1) {
    if (off.has(port) || taken.has(port)) continue;
    if (await inUse(port)) continue;
    return port;
  }
  return null;
}
