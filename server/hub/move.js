// server/hub/move.js
// Moving a drive's home (docs/superpowers/specs/2026-09-29-mac-home-drive-design.md,
// piece 5). The leaving host stops before its last upload, so the upload is
// the whole of it; the lease moves only after that upload, and the arriving
// host serves only after its download matches. Nothing here deletes anything.
//
// Every failure after the leaving host stopped goes through settle(): it reads
// the lease fresh and starts only the side the lease names (never one it merely
// believes should serve), and it never throws. If the lease cannot be read it
// starts nothing and says so. After the lease moved, a failure first tries to
// hand the lease back; the arriving side is started (as standby) only if the
// lease then names the old home. A lease that names the arriving side is
// obeyed only if its download verified in this run; an unverified copy started
// as home would upload over the hub, so then nothing is started.

const fail = (step, why) => ({ ok: false, step, why });

export async function moveHome({
  to,
  sides,
  client,
  now = false,
  waitIdleMs = 10 * 60_000,
  pollMs = 5_000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.log,
}) {
  const from = to === 'mac' ? 'fly' : 'mac';
  const leaving = sides[from];
  const arriving = sides[to];
  const started = Date.now();

  let lease;
  try {
    lease = await client.get();
  } catch (err) {
    return fail('lease', `the lease could not be read (${err.message}); nothing was stopped`);
  }
  if (lease.home === to) return { ok: true, already: true, lease };

  if (!now) {
    const deadline = Date.now() + waitIdleMs;
    for (;;) {
      let working;
      try {
        working = await leaving.working();
      } catch (err) {
        return fail('idle', `could not ask ${from} whether an agent is working (${err.message}); nothing moved (use --now to go without waiting)`);
      }
      if (working === 0) break;
      if (Date.now() >= deadline) return fail('idle', `an agent was working on ${from} the whole time; nothing moved (use --now to stop it)`);
      log(`[move] waiting: ${working} running on ${from}`);
      await sleep(pollMs);
    }
  }

  let verified = false;
  const settle = async (step, why) => {
    let current;
    try {
      current = await client.get();
    } catch (err) {
      return fail(step, `${why}; the lease could not be read (${err.message}), so nothing was started; run drive-home again once it is reachable`);
    }
    if (current.home === to && !verified) {
      return fail(step, `${why}; the lease still names ${to} (epoch ${current.epoch}), whose copy is not verified, so nothing was started; run drive-home to ${from} once the lease is reachable`);
    }
    try {
      await sides[current.home].start();
      return fail(step, `${why}; the lease names ${current.home} (epoch ${current.epoch}), which was started`);
    } catch (err) {
      return fail(step, `${why}; the lease names ${current.home} (epoch ${current.epoch}), which could not be started: ${err.message}`);
    }
  };

  const giveBack = async (epoch) => {
    try {
      await client.move(from, epoch);
    } catch (err) {
      log(`[move] could not hand the lease back: ${err.message}`);
    }
  };

  log(`[move] stopping ${from}`);
  try {
    await leaving.stop();
  } catch (err) {
    return settle('stop', `${from} would not stop (${err.message})`);
  }
  const upload = await leaving.upload({ epoch: lease.epoch }).catch((err) => ({ ok: false, why: err.message }));
  if (!upload.ok) return settle('upload', `the last upload from ${from} did not happen (${upload.why})`);

  let moved;
  try {
    moved = await client.move(to, lease.epoch);
  } catch (err) {
    // The request may have committed even though it threw: look, and undo it.
    if (err.status !== 409) {
      try {
        const fresh = await client.get();
        if (fresh.home === to) await giveBack(fresh.epoch);
      } catch { /* settle reports an unreadable lease */ }
    }
    return settle('lease', `the lease could not move (${err.message})`);
  }

  const handBack = async (step, why) => {
    await giveBack(moved.epoch);
    try {
      const after = await client.get();
      if (after.home === from) await arriving.start().catch(() => {}); // comes up standby
    } catch { /* settle reports it */ }
    return settle(step, why);
  };

  log(`[move] downloading on ${to}`);
  const down = await arriving.download().catch((err) => ({ ok: false, why: err.message }));
  if (!down.ok) return handBack('download', `the download on ${to} failed (${down.why})`);
  if (!down.matches) {
    return handBack('verify', `counts differ: hub ${down.state.files}/${down.state.documents}, here ${down.counts.files}/${down.counts.documents}`);
  }
  verified = true;
  try {
    await arriving.start();
    if (!(await arriving.healthy())) return handBack('start', `${to} did not come up as home`);
  } catch (err) {
    return handBack('start', `${to} did not start (${err.message})`);
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  try {
    await leaving.start();
  } catch (err) {
    return { ok: true, lease: moved, seconds, warning: `${from} did not restart as standby: ${err.message}` };
  }
  return { ok: true, lease: moved, seconds };
}
