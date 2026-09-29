// server/hub/move.js
// Moving a drive's home (docs/superpowers/specs/2026-09-29-mac-home-drive-design.md,
// piece 5). The leaving host stops before its last upload, so the upload is
// the whole of it; the lease moves only after that upload, and the arriving
// host starts only after its download matches. Any failure before the
// arriving host serves puts things back: the lease where it was, the old home
// serving. Nothing here deletes anything.

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

  const lease = await client.get();
  if (lease.home === to) return { ok: true, already: true, lease };

  if (!now) {
    const deadline = Date.now() + waitIdleMs;
    for (;;) {
      const working = await leaving.working();
      if (working === 0) break;
      if (Date.now() >= deadline) return fail('idle', `an agent was working on ${from} the whole time; nothing moved (use --now to stop it)`);
      log(`[move] waiting: ${working} running on ${from}`);
      await sleep(pollMs);
    }
  }

  log(`[move] stopping ${from}`);
  await leaving.stop();
  const upload = await leaving.upload({ epoch: lease.epoch }).catch((err) => ({ ok: false, why: err.message }));
  if (!upload.ok) {
    await leaving.start();
    return fail('upload', `the last upload from ${from} did not happen (${upload.why}); ${from} is serving again`);
  }

  let moved;
  try {
    moved = await client.move(to, lease.epoch);
  } catch (err) {
    await leaving.start();
    return fail('lease', `the lease could not move (${err.message}); ${from} is serving again`);
  }

  const handBack = async (step, why) => {
    await client.move(from, moved.epoch).catch((err) => log(`[move] could not hand the lease back: ${err.message}`));
    await arriving.start().catch(() => {});
    await leaving.start();
    return fail(step, `${why}; the lease is back on ${from}, which is serving again`);
  };

  log(`[move] downloading on ${to}`);
  const down = await arriving.download().catch((err) => ({ ok: false, why: err.message }));
  if (!down.ok) return handBack('download', `the download on ${to} failed (${down.why})`);
  if (!down.matches) {
    return handBack('verify', `counts differ: hub ${down.state.files}/${down.state.documents}, here ${down.counts.files}/${down.counts.documents}`);
  }
  await arriving.start();
  if (!(await arriving.healthy())) return handBack('start', `${to} did not come up as home`);
  await leaving.start();
  return { ok: true, lease: moved, seconds: Math.round((Date.now() - started) / 1000) };
}
