// The words and the maths under the agent status widgets (the drive's page
// "Agent status", 1 October 2026): a chat's state, Quiet included; a step in
// plain words; a turn's ticks; the day's lanes; two chats changing the same
// page at once; and whether a usage window lasts to its reset.
//
// One module so that every place that says how the chats are doing says it
// the same way: the Agents page, the Drive, the host (which puts each chat's
// last step on its summary with `stepOf`), and later the Mac and the phone.
// It touches neither window nor document, so the tests import it in node.
// Loaded in the browser before agent-ui.js; in node, imported for its side
// effect, like agent-folders.js.

(() => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  /** How long a working chat may go without a step before it reads as
   *  Quiet, until the person sets it in Trace. Five minutes: a long command
   *  is often longer, and that is the point, it is worth a look. */
  const QUIET_AFTER_MS = 5 * MIN;

  // ---- a step, its kind and its words. The kind is what a tick draws; the
  // words are what a line under it says.
  const KINDS = [
    ['change', /^(Edit|MultiEdit|Write|NotebookEdit|apply_ops|create_document)$/],
    ['look', /^browser_/],
    ['ask', /^AskUserQuestion$/],
    ['talk', /^(send_message|wait_for_reply|SendMessage|list_agents)$/],
    ['run', /^(Bash|BashOutput|KillShell|Shell|shell|Agent|Task|Workflow|check_document)$/],
  ];

  const leaf = (p) => String(p ?? '').split('/').pop().replace(/\.mrbl$/, '');
  const toolOf = (e) => String(e?.name ?? '').split('__').pop();

  /** The kind of a step, or null for an event that is not one (text, a
   *  result, the turn starting). */
  const kindOf = (e) => {
    if (e?.type === 'ask') return 'ask';
    if (e?.type !== 'tool.call') return null;
    const name = toolOf(e);
    for (const [kind, test] of KINDS) if (test.test(name)) return kind;
    return 'read';
  };

  const fileOf = (input) => {
    const p = input?.path ?? input?.file_path ?? input?.notebook_path ?? null;
    return p ? leaf(p) : null;
  };

  /** A step in the words a person would use for it, or null. */
  const stepWords = (e) => {
    const kind = kindOf(e);
    if (!kind) return null;
    if (e.type === 'ask') {
      if (e.tool === 'AskUserQuestion') return 'Asking you a question';
      return `Asking you to allow ${e.displayName || e.tool || 'a step'}`;
    }
    const name = toolOf(e);
    const file = fileOf(e.input);
    switch (kind) {
      case 'change': return file ? `Changing ${file}` : 'Changing a page';
      case 'look': return 'Looking at the page in the browser';
      case 'ask': return 'Asking you a question';
      case 'talk': return 'Talking to another chat';
      case 'run':
        if (name === 'check_document') return `Checking ${file ?? 'a page'}`;
        if (name === 'Agent' || name === 'Task' || name === 'Workflow') return 'Working with helpers';
        return 'Running a command';
      default:
        if (name === 'Skill') return 'Reading a skill';
        return file ? `Reading ${file}` : 'Reading';
    }
  };

  /** What a summary carries of a step: small, and nothing of its input but
   *  the page's name, so a summary stays a summary. Null for a non-step. */
  const stepOf = (e) => {
    const kind = kindOf(e);
    if (!kind) return null;
    return {
      t: Number(e.t) || null,
      turn: e.turn ?? null,
      kind,
      tool: e.type === 'ask' ? (e.tool ?? null) : toolOf(e),
      words: stepWords(e),
    };
  };

  // ---- the state. Six words, one per look of the dot.
  //   waiting  a question or a permission is open
  //   working  in a turn, or in the queue for one
  //   quiet    in a turn, with no step for longer than the threshold
  //   failed   finished on an error or the watchdog, and not yet opened
  //   unseen   finished, and not yet opened
  //   idle     read, and asking for nothing

  /** When the running turn last showed a sign of work: its last step, or
   *  its start if it has taken none. Null when there is no running turn. */
  const lastSignOf = (s) => {
    if (!s?.running) return null;
    const started = Number(s.turnStartedAt) || 0;
    const step = Number(s.lastStep?.t) || 0;
    const at = Math.max(started, step);
    return at || null;
  };

  /** How long a running chat has gone without a step, or null. */
  const quietFor = (s, { now = Date.now() } = {}) => {
    const at = lastSignOf(s);
    return at == null ? null : Math.max(0, now - at);
  };

  const stateOf = (s, { now = Date.now(), quietAfterMs = QUIET_AFTER_MS } = {}) => {
    if (s?.asking) return 'waiting';
    if (s?.running || s?.queued || s?.status === 'running') {
      const quiet = quietFor(s, { now });
      return quiet != null && quiet > quietAfterMs ? 'quiet' : 'working';
    }
    if (s?.needsReview) return s.lastOutcome === 'failed' || s.lastOutcome === 'watchdog' ? 'failed' : 'unseen';
    return 'idle';
  };

  // ---- words for times and counts
  const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;
  const span = (ms) => {
    const m = Math.max(0, Math.round(ms / MIN));
    if (m < 1) return 'under a minute';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
    const d = Math.floor(h / 24);
    return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
  };
  const titleOf = (s) => s?.title || 'New chat';

  /** What a live chat is doing now, in one line. */
  const nowWords = (s, { now = Date.now(), quietAfterMs = QUIET_AFTER_MS } = {}) => {
    if (s?.asking) return 'Waiting for you';
    if (!s?.running && s?.queued) return 'In the queue';
    if (stateOf(s, { now, quietAfterMs }) === 'quiet') {
      const step = s.lastStep?.words;
      return `Quiet for ${span(quietFor(s, { now }))}${step ? `, last ${step.charAt(0).toLowerCase()}${step.slice(1)}` : ''}`;
    }
    const step = s?.lastStep;
    // A step from an earlier turn says nothing about this one.
    if (step?.words && (!s.turnStartedAt || !step.t || step.t >= s.turnStartedAt)) return step.words;
    return s?.activity || 'Working';
  };

  // ---- Glance: the one fact that wants you most, then the counts.
  const newest = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  const latest = (a, b) => (b.lastFinishedAt ?? 0) - (a.lastFinishedAt ?? 0);

  const glance = (summaries, { now = Date.now(), quietAfterMs = QUIET_AFTER_MS } = {}) => {
    const opts = { now, quietAfterMs };
    const all = [...(summaries ?? [])].filter((s) => s && !s.archived && !s.removed);
    const waiting = all.filter((s) => stateOf(s, opts) === 'waiting').sort(newest);
    const working = all.filter((s) => ['working', 'quiet'].includes(stateOf(s, opts))).sort(newest);
    const unread = all.filter((s) => ['unseen', 'failed'].includes(stateOf(s, opts))).sort(latest);
    let lead;
    if (waiting.length) {
      const s = waiting[0];
      lead = { state: 'waiting', count: waiting.length, words: waiting.length === 1 ? 'needs you' : 'need you', chat: s.id, sub: `${titleOf(s)} is waiting for you` };
    } else if (working.length) {
      const s = working[0];
      lead = { state: stateOf(s, opts), count: working.length, words: 'working', chat: s.id, sub: `${titleOf(s)}: ${nowWords(s, opts)}` };
    } else if (unread.length) {
      const s = unread[0];
      lead = { state: stateOf(s, opts), count: unread.length, words: 'to read', chat: s.id, sub: `Last to finish: ${titleOf(s)}` };
    } else {
      lead = { state: 'idle', count: 0, words: 'Nothing working', chat: null, sub: 'Every chat is read' };
    }
    return { lead, waiting, working, unread };
  };

  // ---- Trace: a turn's steps as ticks, each at the moment it was taken.
  const ticks = (events, { start = null, end = null } = {}) => {
    const steps = (events ?? []).filter((e) => kindOf(e) && Number.isFinite(e.t));
    const from = start ?? steps[0]?.t ?? 0;
    const to = end ?? steps.at(-1)?.t ?? from;
    const length = Math.max(to - from, 1);
    const counts = {};
    const out = steps.map((e) => {
      const kind = kindOf(e);
      counts[kind] = (counts[kind] ?? 0) + 1;
      return { kind, t: e.t, at: Math.max(0, Math.min(1, (e.t - from) / length)) };
    });
    return { ticks: out, counts, start: from, end: to };
  };

  // ---- Lanes: every turn's start, end and outcome.
  const outcomeOf = (t) => {
    if (t.status === 'running') return 'running';
    if (t.status === 'queued') return 'queued';
    if (t.status === 'failed') return 'failed';
    if (['cancelled', 'interrupted', 'removed', 'watchdog'].includes(t.status)) return 'stopped';
    return t.applied ? 'changed' : 'answered';
  };
  const endOf = (t, now = Date.now()) => t.finishedAt ?? (t.status === 'running' ? now : t.startedAt);
  const chatOf = (t) => t.cid ?? t.conversationId ?? null;

  /** How many turns were working at once, through a range: the step line,
   *  its peak and when the peak came. */
  const atOnce = (turns, { from = 0, now = Date.now() } = {}) => {
    const marks = [];
    for (const t of turns ?? []) {
      if (!t.startedAt || endOf(t, now) < from) continue;
      marks.push([Math.max(t.startedAt, from), 1]);
      // A running turn has not ended: it is one of the ones at once now.
      if (t.status !== 'running') marks.push([endOf(t, now), -1]);
    }
    // An end before a start at the same moment: back-to-back is not overlap.
    marks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let count = 0;
    let peak = 0;
    let peakAt = from;
    const points = [];
    for (const [at, d] of marks) {
      count += d;
      points.push([at, count]);
      if (count > peak) { peak = count; peakAt = at; }
    }
    return { points, peak, peakAt, now: count };
  };

  /** One lane per chat, ordered by its first turn in range. */
  const lanes = (turns, { from = 0, now = Date.now() } = {}) => {
    const byChat = new Map();
    for (const t of turns ?? []) {
      if (!t.startedAt || endOf(t, now) < from) continue;
      const cid = chatOf(t);
      if (!byChat.has(cid)) byChat.set(cid, []);
      byChat.get(cid).push(t);
    }
    const rows = [...byChat.entries()]
      .map(([cid, list]) => ({
        cid,
        turns: list.sort((a, b) => a.startedAt - b.startedAt),
        busy: list.reduce((sum, t) => sum + (endOf(t, now) - Math.max(t.startedAt, from)), 0),
      }))
      .sort((a, b) => a.turns[0].startedAt - b.turns[0].startedAt);
    return { rows, ...atOnce(turns, { from, now }) };
  };

  // ---- Where: two chats changing the same page in the same minutes.
  const pageOf = (t) => t.target ?? t.context?.target ?? null;

  /** Did this turn change this page? A turn that lists what it changed is
   *  taken at its word. One that does not is judged by its own page: a
   *  finished turn that applied something, or a running one, which may yet. */
  const changedPage = (t, path) => {
    const changed = t.changed ?? t.paths ?? null;
    if (changed) return [...changed].includes(path);
    if (pageOf(t) !== path) return false;
    return Boolean(t.applied) || t.status === 'running';
  };

  /** Every page two chats changed at once, with when. A pair of turns
   *  collides when they are different chats', their times overlap, and both
   *  changed the page. */
  const collisions = (turns, { now = Date.now(), from = 0 } = {}) => {
    const pages = new Map();
    const list = (turns ?? []).filter((t) => t.startedAt && endOf(t, now) >= from);
    for (const t of list) {
      const paths = new Set([...(t.changed ?? t.paths ?? []), pageOf(t)].filter(Boolean));
      for (const path of paths) {
        if (!changedPage(t, path)) continue;
        if (!pages.has(path)) pages.set(path, []);
        pages.get(path).push(t);
      }
    }
    const out = [];
    for (const [path, writers] of pages) {
      const times = [];
      for (let i = 0; i < writers.length; i += 1) {
        for (let j = i + 1; j < writers.length; j += 1) {
          const a = writers[i];
          const b = writers[j];
          if (chatOf(a) === chatOf(b)) continue;
          const start = Math.max(a.startedAt, b.startedAt);
          const end = Math.min(endOf(a, now), endOf(b, now));
          if (start >= end) continue;
          times.push({ start, end, chats: [chatOf(a), chatOf(b)], turns: [a.id, b.id] });
        }
      }
      if (times.length) out.push({ path, times: times.sort((x, y) => x.start - y.start) });
    }
    return out.sort((a, b) => b.times.length - a.times.length || a.path.localeCompare(b.path));
  };

  // ---- Pace: whether a usage window lasts to its reset at the rate so far.
  const WINDOW_MS = { '5h': 5 * HOUR, week: 7 * DAY };

  const parseReset = (value) => {
    if (value == null || value === '') return null;
    const raw = String(value).trim();
    const date = /^\d+$/.test(raw) ? new Date(Number(raw) > 1e11 ? Number(raw) : Number(raw) * 1000) : new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  };

  /** One window: how far through it is (`even`, where an even pace would
   *  have used by now, 0 to 1), whether it lasts, and if not, when it runs
   *  out. Null fields where the window does not say enough to know. */
  const pace = (w, { now = Date.now() } = {}) => {
    const used = Math.max(0, Math.min(100, Number(w?.used)));
    const reset = parseReset(w?.resetsAt);
    const length = w?.lengthMs ?? WINDOW_MS[w?.id] ?? null;
    if (!Number.isFinite(used) || !length || !reset || reset <= now) {
      return { used: Number.isFinite(used) ? used : null, reset, even: null, lasts: null, out: null };
    }
    const elapsed = Math.max(1, Math.min(length, length - (reset - now)));
    const even = elapsed / length;
    if (used <= 0) return { used, reset, even, lasts: true, out: null };
    if (used >= 100) return { used, reset, even, lasts: false, out: now };
    const out = now + ((100 - used) / used) * elapsed;
    return { used, reset, even, lasts: out >= reset, out: out >= reset ? null : out };
  };

  globalThis.marbleAgentStatus = {
    MIN, HOUR, DAY, QUIET_AFTER_MS,
    kindOf, stepWords, stepOf,
    stateOf, quietFor, nowWords, titleOf,
    glance, ticks,
    outcomeOf, endOf, atOnce, lanes,
    changedPage, collisions,
    parseReset, pace,
    plural, span,
  };
})();
