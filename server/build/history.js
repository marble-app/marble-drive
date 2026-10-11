// History: one timeline of an app's versions, the builds Build mode made and
// the person's own edits between them, newest first. Each entry says which
// parts it changed (data-marble-ids), so the page can light them, and how to
// go back: a build by its checkpoint (builds.view), an edit by the history
// checkpoint taken just before it (POST /restore).
//
// Read from what is already kept: the build state, the document's ops log
// (server/oplog.js: who wrote each op, by client) and its history checkpoints
// (store.history). Pure, so test/build.test.js can run it without a drive.

const SESSION_GAP = 90_000;
const BUILD_GRACE = 5_000;
const BEFORE_WINDOW = 2_000;
const ENTRIES_MAX = 120;
const IDS_MAX = 200;

const clip = (text, n) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The ids an op touches: its own, and the ones inside markup it inserts. */
export function idsOfOp(op) {
  const out = [];
  if (typeof op?.id === 'string' && op.id) out.push(op.id);
  else if (typeof op?.parentId === 'string' && op.parentId && op.type === 'insert') out.push(op.parentId);
  if (typeof op?.html === 'string') for (const m of op.html.matchAll(/data-marble-id="([^"]+)"/g)) out.push(m[1]);
  return out;
}
const idsOf = (lines) => [...new Set(lines.flatMap(idsOfOp))].slice(0, IDS_MAX);

/** What an edit session did, in a few words. */
function saidOf(lines) {
  const typed = lines.filter((l) => l.type === 'setText' && String(l.text ?? '').trim()).map((l) => clip(l.text, 48));
  if (typed.length) {
    const last = typed.at(-1);
    return typed.length === 1 ? `Wrote “${last}”` : `Wrote “${last}” and ${typed.length - 1} more`;
  }
  const n = new Set(lines.flatMap(idsOfOp)).size;
  const verb = lines.every((l) => l.type === 'insert') ? 'Added' : lines.every((l) => l.type === 'remove') ? 'Took out' : 'Changed';
  return `${verb} ${n || lines.length} part${(n || lines.length) === 1 ? '' : 's'}`;
}

/** Ops by one client, cut wherever it went quiet for a while. */
function sessions(lines) {
  const byClient = new Map();
  for (const line of lines) {
    if (!byClient.has(line.client)) byClient.set(line.client, []);
    byClient.get(line.client).push(line);
  }
  const out = [];
  for (const [client, list] of byClient) {
    list.sort((a, b) => a.t - b.t);
    let run = null;
    for (const line of list) {
      if (!run || line.t - run.at(-1).t > SESSION_GAP) { run = []; out.push({ client, lines: run }); }
      run.push(line);
    }
  }
  return out;
}

/** The checkpoint taken just before a write at `t`: the version to go back to. */
function beforeOf(checkpoints, t) {
  let best = null;
  for (const c of checkpoints) {
    if (c.t > t || c.t < t - BEFORE_WINDOW) continue;
    if (!best || c.t > best.t) best = c;
  }
  return best?.sha ?? null;
}

/**
 * @param {object} input
 * @param {object[]} input.builds       the build state's builds
 * @param {object[]} input.lines        the ops log's lines for the document
 * @param {object[]} input.checkpoints  store.history: { t, sha, label }
 * @param {number}   [input.now]
 */
export function timelineOf({ builds = [], lines = [], checkpoints = [], now = Date.now() }) {
  const entries = [];
  const windows = builds.map((b) => ({ b, from: b.startedAt ?? 0, to: (b.endedAt ?? now) + BUILD_GRACE, conversation: b.conversation }));
  const taken = new Set();
  for (const w of windows) {
    const mine = lines.filter((l) => w.conversation && l.client === `agent:${w.conversation}` && l.t >= w.from && l.t <= w.to);
    for (const l of mine) taken.add(l);
    // Each write the build made, in order: one apply_ops is one stamp.
    const byT = new Map();
    for (const l of mine) { if (!byT.has(l.t)) byT.set(l.t, []); byT.get(l.t).push(l); }
    const b = w.b;
    entries.push({
      kind: 'build',
      id: b.id,
      n: b.n,
      title: b.title,
      status: b.status,
      at: b.endedAt ?? b.startedAt ?? 0,
      startedAt: b.startedAt ?? null,
      endedAt: b.endedAt ?? null,
      showing: Boolean(b.showing),
      hasEnd: Boolean(b.hasEnd),
      ids: idsOf(mine),
      changes: [...byT].sort((x, y) => x[0] - y[0]).map(([at, batch]) => ({ at, count: batch.length, ids: idsOf(batch) })),
    });
  }
  for (const run of sessions(lines.filter((l) => !taken.has(l) && !String(l.client ?? '').startsWith('agent-undo:')))) {
    const first = run.lines[0];
    const last = run.lines.at(-1);
    const fromAgent = String(run.client ?? '').startsWith('agent:');
    entries.push({
      kind: fromAgent ? 'chat' : 'edit',
      id: `${fromAgent ? 'c' : 'e'}${first.t}-${String(run.client).slice(-8)}`,
      at: last.t,
      startedAt: first.t,
      count: run.lines.length,
      ids: idsOf(run.lines),
      said: fromAgent ? `Changed from a chat · ${saidOf(run.lines).replace(/^Wrote/, 'wrote')}` : saidOf(run.lines),
      before: beforeOf(checkpoints, first.t),
    });
  }
  entries.sort((a, b) => b.at - a.at);
  return entries.slice(0, ENTRIES_MAX);
}
