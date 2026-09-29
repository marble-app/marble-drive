// When each drive was online, asleep or stopped: the console's timeline.
//
// The Sprites API says only where a drive is now and the two edges of its
// last sleep (when it last started running, when it last paused). Kept at
// every read of the fleet, those edges add up to a history: each is a change
// of state at a time, and a drive holds a state until its next change. A cold
// drive's stop has no edge in the API, so it is dated when the console first
// sees it. Kept a week, on admin-p1's disk, so a restart keeps the picture.

import fsp from 'node:fs/promises';
import path from 'node:path';

const KEEP = 7 * 24 * 3600_000;
const STATE = { running: 'awake', warm: 'asleep', cold: 'stopped' };

export function createUptime({ file, now = () => Date.now() }) {
  let changes = null; // name → [[at, state], …], oldest first, no repeats
  let saving = null;

  async function load() {
    if (changes) return;
    try {
      changes = new Map(Object.entries(JSON.parse(await fsp.readFile(file, 'utf8'))));
    } catch {
      changes = new Map();
    }
  }

  function add(list, at, state) {
    if (!Number.isFinite(at) || !state) return;
    if (list.some(([t, s]) => t === at && s === state)) return;
    list.push([at, state]);
  }

  /** Fold one read of the fleet into the history. */
  async function record(rows) {
    await load();
    const t = now();
    for (const row of rows) {
      const list = changes.get(row.name) ?? [];
      const ran = Date.parse(row.ranAt);
      const warmed = Date.parse(row.warmedAt);
      add(list, ran, 'awake');
      add(list, warmed, 'asleep');
      const state = STATE[row.status];
      list.sort((a, b) => a[0] - b[0]);
      const last = list[list.length - 1];
      if (state && last?.[1] !== state) add(list, row.status === 'cold' ? t : Date.parse(row.since) || t, state);
      list.sort((a, b) => a[0] - b[0]);
      // A change to the state it was already in is no change.
      const kept = list.filter(([, s], i) => i === 0 || list[i - 1][1] !== s);
      // A week, and the change the week starts inside of.
      const from = kept.findLastIndex(([at]) => at < t - KEEP);
      changes.set(row.name, from > 0 ? kept.slice(from) : kept);
    }
    for (const name of changes.keys()) if (!rows.some((r) => r.name === name)) changes.delete(name);
    save();
  }

  function save() {
    if (saving) return;
    saving = setTimeout(async () => {
      saving = null;
      try {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, JSON.stringify(Object.fromEntries(changes)));
      } catch {}
    }, 1000);
    saving.unref?.();
  }

  /** The changes of the last `span` ms, with the one it starts inside of. */
  function of(name, span = 24 * 3600_000) {
    const list = changes?.get(name) ?? [];
    const from = list.findLastIndex(([at]) => at <= now() - span);
    return list.slice(Math.max(0, from));
  }

  return { load, record, of };
}
