// Whether this sprite should stay awake: some piece of work is still getting
// somewhere, and someone has used the drive within the last day.
//
// Each item is a turn or a job: { key, pid?, output?, lastProgress?,
// pausedSince }, with times read from the awake clock. A paused item (waiting on
// a person or another agent) holds for `pausedMs`; any other holds while it has
// made progress within `noProgressMs`. An item with a pid is also measured here,
// so a job that prints nothing but keeps using CPU or I/O counts as progressing.
//
// Letting go ends nothing. The sprite freezes with the work in it, and the
// work carries on where it was when someone opens the drive again.

export function createHold({ clock, progress, limits }) {
  let lastUse = clock.now();
  const seen = new Map(); // key → { sample, at }

  // What an item has done so far: its processes' CPU and I/O where they can be
  // read, and how much it has printed (`output`, a count its owner keeps).
  // Any change since the last look is progress, now.
  function progressedAt(item) {
    const own = item.lastProgress ?? null;
    const measure = `${item.pid && progress ? progress.sample(item.pid) : ''}|${item.output ?? ''}`;
    const prior = seen.get(item.key);
    if (!prior) {
      // First sight: an item with no time of its own has just started.
      seen.set(item.key, { measure, at: own ?? clock.now() });
    } else if (measure !== prior.measure) {
      prior.measure = measure;
      prior.at = clock.now();
    }
    return Math.max(own ?? -Infinity, seen.get(item.key).at);
  }

  function holds(items) {
    const keys = new Set(items.map((item) => item.key));
    for (const key of seen.keys()) if (!keys.has(key)) seen.delete(key);
    const now = clock.now();
    if (!items.length || now - lastUse >= limits.maxMs) return false;
    let any = false;
    for (const item of items) {
      // Measure every item, so none misses a sample it would need next time.
      const at = progressedAt(item);
      const alive = item.pausedSince !== null && item.pausedSince !== undefined
        ? now - item.pausedSince < limits.pausedMs
        : now - at < limits.noProgressMs;
      any = any || alive;
    }
    return any;
  }

  return {
    holds,
    /** Someone is using the drive: the day starts again. */
    used: () => { lastUse = clock.now(); },
  };
}
