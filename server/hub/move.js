// server/hub/move.js
// Moving a drive's home (docs/superpowers/specs/2026-09-29-mac-home-drive-design.md,
// piece 5). The leaving host is HELD before its last upload (a hold file beside
// its hub settings, then a restart: it comes back on standby and stays there
// whatever the lease says), so the upload is the whole of it; the lease moves
// only after that upload, and the arriving host is released (its hold removed,
// restarted) only after its download matches. After a good move the leaving
// side stays held, and must say so on /health. Nothing here deletes anything.
//
// A side is { working, hold, release, health, healthy, upload, download }:
// hold() returns once the side answers /health on standby; release() once it
// answers at all; healthy() waits for it to answer as home (not standby).
// holdFile, if a side has one, names where its hold file is, for messages.
//
// Every failure after the leaving host was held goes through settle(): it
// reads the lease fresh and releases only the side the lease names (never one
// it merely believes should serve), and it never throws. If the lease cannot
// be read it releases nothing and says so. After the lease moved, a failure
// first tries to hand the lease back, and holds the arriving side if the lease
// then names the old home. A lease that names the arriving side is obeyed only
// if its download verified in this run; an unverified copy released as home
// would upload over the hub, so then the arriving side is held too and the
// owner is told to give the lease back by hand (leaseTo, `drive-home lease-to`).

const fail = (step, why) => ({ ok: false, step, why });
const otherOf = (side) => (side === 'mac' ? 'fly' : 'mac');

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
  const from = otherOf(to);
  const leaving = sides[from];
  const arriving = sides[to];
  const started = Date.now();

  let lease;
  try {
    lease = await client.get();
  } catch (err) {
    return fail('lease', `the lease could not be read (${err.message}); nothing was held`);
  }
  if (lease.home === to) {
    // The lease says so; make sure the side it names is really serving.
    let health;
    try {
      health = await arriving.health();
    } catch (err) {
      return fail('already', `the lease names ${to} (epoch ${lease.epoch}), but ${to} does not answer /health (${err.message})`);
    }
    if (!health?.ok || health.standby) {
      // The usual way here is a move that stopped on a copy it could not
      // verify, so the safe command, giving the drive back, comes first.
      return fail('already', `the lease names ${to} (epoch ${lease.epoch}), but ${to} is on standby (held, or its copy not verified); run drive-home lease-to ${from} to give the drive back to ${from}, whose copy is good (run drive-home lease-to ${to} only if you know ${to}'s copy is current)`);
    }
    return { ok: true, already: true, lease };
  }

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
      return fail(step, `${why}; the lease could not be read (${err.message}), so nothing was released; run drive-home again once it is reachable`);
    }
    if (current.home === to && !verified) {
      // Held, so neither a restart nor a reboot can bring the doubtful copy
      // up serving because the lease names it.
      let held = 'which is held';
      try {
        await arriving.hold();
      } catch (err) {
        held = `which could not be held (${err.message}): stop it by hand`;
      }
      return fail(step, `${why}; the lease still names ${to} (epoch ${current.epoch}), whose copy is not verified, so it was not released (${held}); run drive-home lease-to ${from} to give the drive back to ${from}, whose copy is good`);
    }
    try {
      await sides[current.home].release();
      return fail(step, `${why}; the lease names ${current.home} (epoch ${current.epoch}), which was released`);
    } catch (err) {
      return fail(step, `${why}; the lease names ${current.home} (epoch ${current.epoch}), which could not be released: ${err.message}`);
    }
  };

  const giveBack = async (epoch) => {
    try {
      await client.move(from, epoch);
    } catch (err) {
      log(`[move] could not hand the lease back: ${err.message}`);
    }
  };

  log(`[move] holding ${from}`);
  try {
    await leaving.hold();
  } catch (err) {
    return settle('hold', `${from} could not be held (${err.message})`);
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
    let after = null;
    try {
      after = await client.get();
    } catch { /* settle reports it */ }
    if (after?.home === from) {
      try {
        await arriving.hold();
      } catch (err) {
        why = `${why}; also, holding ${to} failed: ${err.message} — it may still be serving; the lease no longer names it, so its uploads stop`;
      }
    }
    return settle(step, why);
  };

  log(`[move] downloading on ${to}`);
  const down = await arriving.download().catch((err) => ({ ok: false, why: err.message }));
  if (!down.ok) return handBack('download', `the download on ${to} failed (${down.why})`);
  if (!down.matches) {
    // With the hub's file list, sizes and mtimes are compared file by file, so
    // the counts can agree while a file does not.
    return handBack('verify', `the download does not match the hub: hub ${down.state.files}/${down.state.documents}, here ${down.counts.files}/${down.counts.documents}`);
  }
  verified = true;
  try {
    await arriving.release();
    if (!(await arriving.healthy())) return handBack('start', `${to} did not come up as home`);
  } catch (err) {
    return handBack('start', `${to} did not start (${err.message})`);
  }
  const seconds = Math.round((Date.now() - started) / 1000);

  // The leaving side stays held. It must say so: a side that serves here is a
  // second writer.
  let health;
  try {
    health = await leaving.health();
  } catch (err) {
    health = { error: err.message };
  }
  if (!health?.ok || health.standby !== true) {
    const said = health?.error ? `did not answer /health (${health.error})` : 'does not say standby on /health';
    return {
      ok: false,
      step: 'verify-standby',
      lease: moved,
      seconds,
      why: `${to} is home (epoch ${moved.epoch}) and serving, but ${from} ${said}; make sure ${from} is not serving (drive-home lease-to ${to} holds it again)`,
    };
  }
  return { ok: true, lease: moved, seconds };
}

// Move only the lease, to a side whose copy the owner says is good: no upload
// and no download. For after a move stopped with the lease on a copy that was
// not verified (moveHome's message names it), or a side left on standby. The
// other side is held first, so there is never a moment with two homes; it
// refuses when the other side is serving as home, because its newest changes
// would be left behind (and then overwritten in the hub): use moveHome. It
// fails closed: when the lease names the other side, that side must say
// standby on /health, and one that cannot be read may be serving.
export async function leaseTo({ to, sides, client, log = console.log }) {
  const other = otherOf(to);
  let lease;
  try {
    lease = await client.get();
  } catch (err) {
    return fail('lease', `the lease could not be read (${err.message}); nothing was touched`);
  }
  if (lease.home === other) {
    let health;
    try {
      health = await sides[other].health();
    } catch (err) {
      return fail('health', `the lease names ${other} (epoch ${lease.epoch}), and ${other}'s /health could not be read (${err.message}), so it may be serving as home; nothing changed; run drive-home lease-to ${to} again once ${other} answers`);
    }
    if (health?.ok && !health.standby) {
      return fail('serving', `${other} is serving the drive as home (epoch ${lease.epoch}); moving only the lease would leave its newest changes behind: run drive-home to ${to}`);
    }
    if (!health?.ok || health.standby !== true) {
      return fail('health', `the lease names ${other} (epoch ${lease.epoch}), and ${other} does not say standby on /health, so it may be serving as home; nothing changed; run drive-home lease-to ${to} again once ${other} answers on standby`);
    }
  }

  log(`[lease-to] holding ${other}`);
  try {
    await sides[other].hold();
  } catch (err) {
    const file = sides[other].holdFile ?? 'hold-<drive> in its config folder';
    return fail('hold', `${other} could not be held (${err.message}); the lease was not moved (it names ${lease.home}, epoch ${lease.epoch}); a hold file may have been left on ${other} (${file}), and ${other} will come up on standby at its next restart until the file is removed`);
  }

  if (lease.home !== to) {
    try {
      lease = await client.move(to, lease.epoch);
    } catch (err) {
      // The request may have committed even though it threw.
      const fresh = await client.get().catch(() => null);
      if (fresh?.home !== to) {
        return fail('lease', `the lease could not move (${err.message}); ${other} is held and nothing serves; run drive-home lease-to ${to} again`);
      }
      lease = fresh;
    }
  }

  log(`[lease-to] releasing ${to}`);
  try {
    await sides[to].release();
    if (!(await sides[to].healthy())) {
      return fail('start', `the lease names ${to} (epoch ${lease.epoch}), but ${to} did not come up as home; ${other} is held`);
    }
  } catch (err) {
    return fail('start', `the lease names ${to} (epoch ${lease.epoch}), but ${to} could not be released (${err.message}); ${other} is held`);
  }
  return { ok: true, lease };
}
