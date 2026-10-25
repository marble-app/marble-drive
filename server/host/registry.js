// The drives marble-host runs, and what happened to them.
//
// registry.json is small and rewritten whole: a temporary file beside it,
// flushed, then renamed over it, so a crash or a PC switched off mid-write
// leaves the old file or the new one and never half of either. A file that
// cannot be read is an error, not an empty registry: forgetting every drive
// would leave them running with nobody watching, and a new drive could be
// given a port one of them holds.
//
// A drive: { name, port, owner, channel: canary|everyone, release, previous,
// state: making|running|suspended|failed|removed, created, cohort, restarts,
// heldFrom (a release it was rolled back from, so it is not moved there
// again), checking (a release it was moved to whose check has not passed),
// door: { reported } for a drive the door asked for }.
//
// events.jsonl is one line per thing that happened ({ at, drive, kind,
// detail }), the newest last, trimmed to the last few thousand.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const empty = () => ({ version: 1, drives: {}, channels: { canary: null, everyone: null }, paused: false, releases: [] });

/** Write a file so that a crash leaves either its old contents or its new ones. */
export async function atomicWrite(file, text, mode = 0o600) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const handle = await fsp.open(tmp, 'w', mode);
  try {
    await handle.writeFile(text);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  // The rename itself, on disk.
  const dir = await fsp.open(path.dirname(file), 'r').catch(() => null);
  if (dir) {
    await dir.sync().catch(() => {});
    await dir.close();
  }
}

export async function openRegistry({ dir, now = () => new Date().toISOString(), keepEvents = 5000 }) {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'registry.json');
  const eventsFile = path.join(dir, 'events.jsonl');
  let data;
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    data = { ...empty(), ...parsed, channels: { ...empty().channels, ...(parsed.channels ?? {}) } };
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`${file} cannot be read (${err.message}); marble-host will not start without it`);
    data = empty();
  }

  // One change at a time, in the order asked.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  const clone = (x) => (x === undefined || x === null ? null : structuredClone(x));
  let eventLines = null;

  return {
    file,
    eventsFile,
    /** A copy of everything. */
    get: () => structuredClone(data),
    drive: (name) => clone(Object.hasOwn(data.drives, name) ? data.drives[name] : null),
    drives: () => Object.values(data.drives).map(clone),
    channels: () => ({ ...data.channels }),
    paused: () => Boolean(data.paused),
    /** `fn` changes a copy; it is written, then becomes the registry. What
     *  `fn` returns is returned. A write that fails changes nothing. */
    update: (fn) =>
      serial(async () => {
        const next = structuredClone(data);
        const result = await fn(next);
        await atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
        data = next;
        return result;
      }),
    /** Something that happened, for the Console and `pc-host.mjs events`. */
    event: (drive, kind, detail = {}) =>
      serial(async () => {
        const line = { at: now(), drive: drive ?? null, kind, detail };
        await fsp.appendFile(eventsFile, `${JSON.stringify(line)}\n`, { mode: 0o600 });
        eventLines = eventLines === null ? null : eventLines + 1;
        if (eventLines === null || eventLines > keepEvents * 2) {
          const text = await fsp.readFile(eventsFile, 'utf8').catch(() => '');
          const lines = text.split('\n').filter(Boolean);
          eventLines = lines.length;
          if (lines.length > keepEvents) {
            await atomicWrite(eventsFile, `${lines.slice(-keepEvents).join('\n')}\n`);
            eventLines = keepEvents;
          }
        }
        return line;
      }),
    /** The newest first. */
    async events(limit = 100) {
      const text = await fsp.readFile(eventsFile, 'utf8').catch(() => '');
      const out = [];
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
        if (!lines[i]) continue;
        try {
          out.push(JSON.parse(lines[i]));
        } catch {}
      }
      return out;
    },
  };
}
