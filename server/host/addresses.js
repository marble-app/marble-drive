// Each drive on the PC listens on a loopback address of its own, and
// marble-host reaches it from one of its own (docs/HOSTING.md, "marble-host
// and the sandbox").
//
// The owner's drive (127.0.0.1:4401), marble-host's router and admin API
// (4460, 4461) and cloudflared's metrics (20241) all listen on 127.0.0.1, and
// the owner's drive takes anything from loopback for the owner at its gate,
// which has no limit on wrong guesses. So every guest's unit denies
// 127.0.0.1 and ::1 (IPAddressDeny=), and each guest listens instead on
// 127.0.0.<10 + (port − 4500)>: 127.0.0.10 for port 4500 up to 127.0.0.109
// for 4599, derived here and nowhere else. systemd checks the far end of
// every packet a guest's sockets send or take in, so a connection from
// 127.0.0.1 into a guest is dropped too: marble-host binds 127.0.0.2 for
// every request it makes to one. A guest's own connections to itself come
// from its own address only once that address is on lo, which is what
// linux/pc-host/marble-guest-addresses.service does as root; otherwise Linux
// sends them from 127.0.0.1, its preferred source for the whole of 127/8.
//
// Linux takes all of 127.0.0.0/8 as this machine's, so binding any of these
// needs no root, and the tests do.

/** The ports a drive may have, and so the addresses: 4500-4599. */
export const GUEST_PORTS = Object.freeze({ from: 4500, to: 4599 });
const FIRST = 10;

/** Where marble-host's requests to a drive come from: never 127.0.0.1, which
 *  every guest's unit denies. */
export const HOST_SIDE = '127.0.0.2';

/** A drive's own address, 127.0.0.10 to 127.0.0.109, as run-guest checks it. */
export const GUEST_ADDRESS = /^127\.0\.0\.(1[0-9]|[2-9][0-9]|10[0-9])$/;

/** The address of the drive on `port`: 127.0.0.<10 + (port − 4500)>. */
export function guestAddress(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < GUEST_PORTS.from || n > GUEST_PORTS.to) {
    throw new Error(`port ${port} is not a drive's: a drive's port is ${GUEST_PORTS.from}-${GUEST_PORTS.to}, so that its address 127.0.0.<10 + port − ${GUEST_PORTS.from}> is one of 127.0.0.${FIRST} to 127.0.0.${FIRST + GUEST_PORTS.to - GUEST_PORTS.from}`);
  }
  return `127.0.0.${FIRST + n - GUEST_PORTS.from}`;
}
