// A conversation read a few turns at a time.
//
// A long chat is thousands of events and megabytes of tool input, and the
// person opening it reads the last screen. So the page asks for the last few
// turns, and for the few before those only when it scrolls up to them.
//
// The cut is by turn, never by position: a turn comes whole, with the events
// written about it later (an undo, an answer), so the page can draw it once
// and never be told about half of one. Events that belong to no turn go with
// the turns around them.

const ENDS = new Set(['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted', 'turn.removed', 'turn.combined']);

/**
 * `last` turns of `events`, ending before the turn `before` (or at the end).
 * A turn still going is always in the newest slice, however far back it began.
 * Returns the slice, the id to ask `before` for the next one (null at the top),
 * the ids of every turn older than the slice, and the newest seq in the whole
 * conversation, which is where a live stream starts.
 */
export function sliceTurns(events, { last = 3, before = null } = {}) {
  const seq = events.length ? events[events.length - 1].seq ?? 0 : 0;
  const first = new Map();
  const ended = new Set();
  for (const event of events) {
    if (!event.turn) continue;
    if (!first.has(event.turn)) first.set(event.turn, event.seq);
    if (ENDS.has(event.type)) ended.add(event.turn);
  }
  const order = [...first.keys()];
  let end = order.length;
  if (before) {
    const at = order.indexOf(before);
    end = at < 0 ? 0 : at;
  }
  const want = Math.max(0, Math.floor(Number(last) || 0));
  // No turns: the caller wanted the conversation's meta, not its words.
  if (!want) return { events: [], earlier: null, older: [], seq };
  let start = Math.max(0, end - want);
  if (end === order.length) {
    const open = order.findIndex((turn) => !ended.has(turn));
    if (open >= 0 && open < start) start = open;
  }
  const keep = new Set(order.slice(start, end));
  const from = start === 0 ? -Infinity : first.get(order[start]);
  const to = end < order.length ? first.get(order[end]) : Infinity;
  return {
    events: events.filter((event) => (event.turn ? keep.has(event.turn) : event.seq >= from && event.seq < to)),
    earlier: start > 0 ? order[start] : null,
    older: order.slice(0, start),
    seq,
  };
}
