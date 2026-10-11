// A run the host starts on its own, once a day.
//
// The day button starts `/my-day` from a page; this starts the same run with no
// page open, at a set hour in a set zone. A paused Fly Sprite runs no timers,
// so being on time is someone else's job: whatever wakes the sprite (a cron
// ping from outside, or the owner opening the drive) sends a request, and every
// request nudges this. The minute tick is for a host that is simply awake.
//
// "Already ran today" is read off the conversations, not kept here: a run with
// the day's title started today, from here or from the button, is the day's
// run. So a restart does not start a second one, and pressing the button at
// 6:00 means nothing starts at 6:30.

export const DAY_TITLE = 'Today’s day';

/** HH:MM → minutes after midnight, or null. */
export function parseAt(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** The date (YYYY-MM-DD) and minutes after midnight at `t` in `zone`. */
export function localTime(t, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(t))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * `start({ prompt, target, title })` begins the run; `conversations()` lists
 * every conversation's meta (title, createdAt). Returns `{ nudge, check, stop }`,
 * or an inert pair when the schedule is off or cannot be read.
 */
export function createDaily({
  at,
  zone,
  prompt,
  target,
  title = DAY_TITLE,
  start,
  conversations,
  now = Date.now,
  tickMs = 60_000,
  retryMs = 15 * 60_000,
  schedule = setInterval,
  log = console,
}) {
  const inert = { nudge() {}, check: async () => null, stop() {} };
  if (!at || !target) return inert;
  const atMinutes = parseAt(at);
  if (atMinutes === null) {
    log.error?.(`[day] MARBLE_DRIVE_DAY_AT is "${at}", not HH:MM — no daily run`);
    return inert;
  }
  try {
    localTime(0, zone);
  } catch {
    log.error?.(`[day] MARBLE_DRIVE_DAY_TZ "${zone}" is not a time zone — no daily run`);
    return inert;
  }

  let done = null; // the date whose run exists
  let lastTry = -Infinity;
  let checking = null;

  async function check() {
    const t = now();
    const { date, minutes } = localTime(t, zone);
    if (minutes < atMinutes || done === date || t - lastTry < retryMs) return null;
    // Before the start, not after it: a start that fails halfway may have made
    // a conversation, and the next try should find it rather than race it.
    lastTry = t;
    const ran = (await conversations()).some(
      (meta) => meta.title === title && localTime(meta.createdAt, zone).date === date,
    );
    if (ran) {
      done = date;
      return null;
    }
    const { id } = await start({ prompt, target, title });
    done = date;
    log.log?.(`[day] started ${prompt} → ${target} for ${date} (${id})`);
    return id;
  }

  // One check at a time: a burst of requests on waking is one run, not ten.
  function nudge() {
    if (checking) return checking;
    checking = check()
      .catch((err) => {
        log.error?.(`[day] could not start ${prompt}: ${err.message}`);
        return null;
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  }

  const timer = schedule ? schedule(nudge, tickMs) : null;
  timer?.unref?.();
  return { nudge, check, stop: () => timer && clearInterval(timer) };
}
