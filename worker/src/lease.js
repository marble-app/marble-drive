// worker/src/lease.js
// Which machine is a drive's home. One writer at a time: a host serves the
// drive only while the lease names its machine, and every move names the epoch
// it moves from, so two moves at once cannot both win (docs/superpowers/specs/
// 2026-09-29-mac-home-drive-design.md, piece 2). Pure, so the Worker and the
// Node tests run the same code.

// As server/hub/settings.js: the owner's Mac, the owner's PC, and Fly.
export const MACHINES = ['mac', 'pc', 'fly'];

// Fly was home before any of this existed.
export const INITIAL = Object.freeze({ home: 'fly', epoch: 0, since: null });

export function move(lease, { to, epoch, now }) {
  const current = lease ?? INITIAL;
  if (!MACHINES.includes(to)) return { ok: false, status: 400, why: `to must be one of ${MACHINES.join(', ')}` };
  if (!Number.isInteger(epoch)) return { ok: false, status: 400, why: 'epoch must be an integer' };
  if (epoch !== current.epoch) {
    return { ok: false, status: 409, why: `the lease is at epoch ${current.epoch}, not ${epoch}`, lease: current };
  }
  return { ok: true, lease: { home: to, epoch: current.epoch + 1, since: new Date(now).toISOString() } };
}
