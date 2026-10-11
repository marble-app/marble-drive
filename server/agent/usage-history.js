// Daily Claude Code usage, read from the transcripts Claude Code writes to
// ~/.claude/projects/**/*.jsonl. The usage API only reports the current
// windows; this is the only history there is.
//
// Only counts leave the scan: never message text, prompts or paths. A message
// is repeated once per content block and again in resumed sessions, so records
// are de-duplicated globally on message.id + requestId. Unreadable files and
// bad lines are skipped, and a missing root is an empty history — never a
// throw. Only files whose contents changed (size or mtime) are read again.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const DAY_MS = 86_400_000;
const DEFAULT_WEEKS = 26;
const MAX_WEEKS = 53;
const TTL_MS = 60_000;

export const FAMILIES = ['opus', 'sonnet', 'fable', 'haiku', 'other'];

export function familyOf(model) {
  const id = String(model ?? '').toLowerCase();
  for (const family of ['opus', 'sonnet', 'haiku', 'fable']) {
    if (id.includes(family)) return family;
  }
  return 'other';
}

const clampWeeks = (weeks) => {
  const n = Number(weeks);
  if (weeks == null || !Number.isFinite(n)) return DEFAULT_WEEKS;
  return Math.max(1, Math.min(MAX_WEEKS, Math.trunc(n)));
};

const walk = async (dir, out = []) => {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
};

const parseFile = async (file) => {
  const records = [];
  let n = 0;
  try {
    const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const text of lines) {
      n += 1;
      if (!text.includes('"assistant"') || !text.includes('"usage"')) continue;
      let row;
      try {
        row = JSON.parse(text);
      } catch {
        continue;
      }
      if (row?.type !== 'assistant') continue;
      const usage = row.message?.usage;
      const ts = Date.parse(row.timestamp);
      if (!usage || Number.isNaN(ts)) continue;
      if (row.message?.model === '<synthetic>') continue;
      records.push({
        id: row.message?.id ? `${row.message.id}:${row.requestId ?? ''}` : `${file}:${n}`,
        ts,
        family: familyOf(row.message?.model),
        tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        cacheRead: usage.cache_read_input_tokens ?? 0,
      });
    }
  } catch {
    return [];
  }
  return records;
};

export function createUsageHistory({
  root = path.join(os.homedir(), '.claude', 'projects'),
  ttl = TTL_MS,
  now = () => new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
} = {}) {
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const files = new Map();
  const memo = new Map();
  const inflight = new Map();
  const stats = { filesParsed: 0 };

  const refresh = async (sinceMs) => {
    const live = new Set();
    for (const file of await walk(root)) {
      let stat;
      try {
        stat = await fs.promises.stat(file);
      } catch {
        continue;
      }
      // A file last written before the range began holds nothing in range.
      if (stat.mtimeMs < sinceMs) continue;
      live.add(file);
      const known = files.get(file);
      if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) continue;
      stats.filesParsed += 1;
      files.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, records: await parseFile(file) });
    }
    for (const file of files.keys()) if (!live.has(file)) files.delete(file);
  };

  const build = async (weeks) => {
    const current = now();
    const to = dayKey.format(current);
    const [y, m, d] = to.split('-').map(Number);
    const base = Date.UTC(y, m - 1, d);
    const count = weeks * 7;
    const dates = Array.from({ length: count }, (_, i) => new Date(base - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
    // Two days of slack: a time zone offset can move a day boundary by up to 14 h.
    await refresh(base - (count + 1) * DAY_MS);

    const days = new Map(dates.map((date) => [date, { date, messages: 0, tokens: 0, cacheRead: 0, byModel: {} }]));
    const seen = new Set();
    for (const { records } of files.values()) {
      for (const record of records) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        const day = days.get(dayKey.format(record.ts));
        if (!day) continue;
        day.messages += 1;
        day.tokens += record.tokens;
        day.cacheRead += record.cacheRead;
        const model = day.byModel[record.family] ?? (day.byModel[record.family] = { messages: 0, tokens: 0 });
        model.messages += 1;
        model.tokens += record.tokens;
      }
    }
    return {
      source: 'claude-code-local',
      tz: timeZone,
      generatedAt: current.toISOString(),
      from: dates[0],
      to,
      days: [...days.values()],
    };
  };

  const history = async ({ weeks } = {}) => {
    const n = clampWeeks(weeks);
    const cached = memo.get(n);
    if (cached && Date.now() - cached.at < ttl) return cached.value;
    if (inflight.has(n)) return inflight.get(n);
    const pending = build(n)
      .then((value) => {
        memo.set(n, { at: Date.now(), value });
        return value;
      })
      .finally(() => inflight.delete(n));
    inflight.set(n, pending);
    return pending;
  };
  history.stats = stats;
  return history;
}
