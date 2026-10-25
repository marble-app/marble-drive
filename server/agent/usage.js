// Remaining Claude / Cursor usage, as a percent. The host reads the CLI
// tokens from the macOS keychain and asks each vendor; it never logs those
// tokens and never returns them. Missing or unsigned-in is an empty list.
// A Claude token whose usage fetch fails is an unavailable meter, not a
// missing one — never a throw. Tests inject `usage` on createDrive so they
// never hit the network.
//
// Claude Code does not always keep its login in the keychain: since 2.1 a
// signed-in CLI may hold it only in ~/.claude/.credentials.json. Reading the
// keychain alone left a signed-in drive with no Claude meter at all, which
// the composer read as "no quota" and greyed out every Claude model. The
// file is the second place to look, never the first.
//
// A drive hosted for someone else reads neither (collectUsageFromCli). Their
// login is theirs: reading it to ask Anthropic is handling the token, which
// the terms for hosting Claude Code rule out. There Claude Code is asked
// instead: `/usage` is one of its own commands, and it prints the plan's
// limits as words, which are read back into the same meter.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { pickEnv } from './env.js';
import { runCommand } from './providers/exec.js';

const CLAUDE_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const CURSOR_USAGE = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const CLAUDE_CREDENTIALS = path.join(homedir(), '.claude', '.credentials.json');
const CACHE_MS = 60_000;

const clampPct = (value) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
};

export function claudeTokenFromKeychain(secret) {
  const raw = String(secret ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('{')) {
    try {
      const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
      return typeof token === 'string' && token.trim() ? token.trim() : null;
    } catch {
      return null;
    }
  }
  return raw;
}

/** The same credential as a file. Only the JSON shape counts here: a file
 *  that is not that object is not a token, and guessing one would spend a
 *  request to earn a 401. */
export function claudeTokenFromFile(contents) {
  const raw = String(contents ?? '').trim();
  return raw.startsWith('{') ? claudeTokenFromKeychain(raw) : null;
}

const windowOf = (id, label, used, resetsAt, kind = 'quota') => (
  used == null ? null : { id, label, used, left: 100 - used, resetsAt: resetsAt ?? null, kind }
);

const CLAUDE_QUOTAS = [
  ['five_hour', '5h', 'Short-term'],
  ['seven_day', 'week', 'Weekly'],
];

// Per-model weekly limits are entries in `limits` (kind `weekly_scoped`, group
// `weekly`), named by scope.model.display_name; there is no top-level
// seven_day_fable key. The name is matched as a word ("Fable", "Fable 5.1"),
// and the weekly group by prefix, so a renamed kind or a versioned model does
// not silently drop the slider. A missing array, a null scope or a missing
// percent is simply no window.
const fableLimit = (data) => (Array.isArray(data?.limits) ? data.limits : []).find((limit) => (
  [limit?.kind, limit?.group].some((field) => /^weekly/.test(String(field ?? '')))
  && /\bfable\b/i.test(String(limit.scope?.model?.display_name ?? ''))
  && limit.percent != null && clampPct(limit.percent) != null
)) ?? null;

export function parseClaudeUsage(data) {
  const five = clampPct(data?.five_hour?.utilization);
  const week = clampPct(data?.seven_day?.utilization);
  const used = five ?? week;
  if (used == null) return null;
  const window = five != null ? '5h' : 'week';
  const resetsAt = five != null
    ? (data?.five_hour?.resets_at ?? null)
    : (data?.seven_day?.resets_at ?? null);
  const left = 100 - used;
  const bits = [];
  if (five != null) bits.push(`5h ${five}% used`);
  if (week != null) bits.push(`week ${week}% used`);
  const windows = CLAUDE_QUOTAS
    .map(([key, id, label]) => windowOf(id, label, clampPct(data?.[key]?.utilization), data?.[key]?.resets_at))
    .filter(Boolean);
  const fable = fableLimit(data);
  if (fable) windows.push(windowOf('fable', 'Fable', clampPct(fable.percent), fable.resets_at));
  return {
    id: 'claude-subscription',
    label: 'Claude',
    available: true,
    used,
    left,
    window,
    resetsAt,
    detail: bits.join(' · '),
    windows,
  };
}

export function parseCursorUsage(data) {
  // Cursor's dashboard bar for Auto + Composer is autoPercentUsed.
  // totalPercentUsed blends that pool with the smaller API pool, so a
  // spent API bucket pulls the headline up (13% Auto reads as 20% total).
  const auto = clampPct(data?.planUsage?.autoPercentUsed);
  const api = clampPct(data?.planUsage?.apiPercentUsed);
  const total = clampPct(data?.planUsage?.totalPercentUsed);
  const used = auto ?? total;
  if (used == null) return null;
  const reset = data?.billingCycleEnd ?? null;
  const bits = [];
  if (auto != null) bits.push(`Cursor models ${auto}% used`);
  if (api != null) bits.push(`Other ${api}% used`);
  const windows = [
    windowOf('auto', 'Cursor models', auto, reset),
    windowOf('api', 'Other models', api, reset),
  ].filter(Boolean);
  return {
    id: 'cursor',
    label: 'Cursor',
    available: true,
    used,
    left: 100 - used,
    window: 'plan',
    resetsAt: reset,
    detail: bits.join(' · '),
    windows,
  };
}

// `reason` separates "we asked and were turned away for now" from "we asked
// and it broke". Only the first is worth remembering a stale number through,
// and only the first should slow the polling down.
export function unavailableMeter(id, label, reason = 'error') {
  return {
    id,
    label,
    available: false,
    used: null,
    left: null,
    window: null,
    resetsAt: null,
    reason,
    detail: reason === 'rate-limited' ? 'Rate limited — try again shortly' : 'Unavailable',
    windows: [],
  };
}

const defaultExec = (command, args) => runCommand(command, args, { timeout: 4_000 });

const defaultRequest = async (url, options = {}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

const readKeychain = async (exec, service) => {
  try {
    const result = await exec('security', ['find-generic-password', '-s', service, '-w']);
    if (result?.missing || result?.code !== 0) return '';
    return String(result.stdout ?? '').trim();
  } catch {
    return '';
  }
};

const readSecretFile = async (file) => {
  try {
    return String(await readFile(file, 'utf8')).trim();
  } catch {
    return '';
  }
};

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

/** 429 is the usage API's normal answer to a busy account, not a fault. It
 *  sends `retry-after: 0`, which is no help, so the caller picks the floor. */
const reasonFor = (response) => (Number(response?.status) === 429 ? 'rate-limited' : 'error');

export async function collectUsage({ exec = defaultExec, request = defaultRequest, credentialsFile = CLAUDE_CREDENTIALS } = {}) {
  const meters = [];
  try {
    const claudeToken = claudeTokenFromKeychain(await readKeychain(exec, 'Claude Code-credentials'))
      ?? claudeTokenFromFile(await readSecretFile(credentialsFile));
    if (claudeToken) {
      try {
        const response = await request(CLAUDE_USAGE, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${claudeToken}`,
            Accept: 'application/json',
          },
        });
        const meter = response?.ok ? parseClaudeUsage(await readJson(response)) : null;
        meters.push(meter ?? unavailableMeter('claude-subscription', 'Claude', reasonFor(response)));
      } catch {
        meters.push(unavailableMeter('claude-subscription', 'Claude', 'error'));
      }
    }

    const cursorToken = await readKeychain(exec, 'cursor-access-token');
    if (cursorToken) {
      try {
        const response = await request(CURSOR_USAGE, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cursorToken}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
        if (response?.ok) {
          const meter = parseCursorUsage(await readJson(response));
          if (meter) meters.push(meter);
        }
      } catch { /* fail closed */ }
    }
  } catch {
    return { meters: [] };
  }
  return { meters };
}

// ------------------------------------------------- asked of the CLI itself

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The wall time `parts` reads in `timeZone` at the instant `at`, as if UTC. */
const wallAt = (at, timeZone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
};

/** When a limit resets, from Claude Code's words for it ("Oct 25, 4:30pm
 *  (America/Los_Angeles)", "Jan 2, 2027, 10am (UTC)") as an ISO time, or
 *  null when it cannot be read. A date with no year is the next one. */
export function parseCliReset(text, now = Date.now()) {
  const found = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),(?: (\d{4}),)? (\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?:\s*\(([^)]+)\))?$/i.exec(String(text ?? '').trim());
  if (!found) return null;
  const month = MONTHS.indexOf(found[1].toLowerCase());
  if (month === -1) return null;
  const hour = (Number(found[4]) % 12) + (found[6].toLowerCase() === 'p' ? 12 : 0);
  const zone = found[7] ?? 'UTC';
  const at = (year) => {
    const wall = Date.UTC(year, month, Number(found[2]), hour, Number(found[5] ?? 0));
    // The instant whose wall time there is `wall`: once for the offset, once
    // more in case a clock change sits between.
    let instant = wall - (wallAt(wall, zone) - wall);
    instant = wall - (wallAt(instant, zone) - instant);
    return instant;
  };
  try {
    const thisYear = new Date(now).getUTCFullYear();
    let instant = at(found[3] ? Number(found[3]) : thisYear);
    if (!found[3] && instant < now - 183 * 86_400_000) instant = at(thisYear + 1);
    return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
  } catch {
    return null; // a time zone this machine does not know
  }
}

// One line of `/usage`: "Current session: 23% used · resets Oct 25, 4:30pm (UTC)".
const CLI_LIMIT = /^[ \t]*(Current session|Current week \(([^)\n]+)\)):[ \t]*(\d+(?:\.\d+)?)% used(?:[ \t]*[·•-][ \t]*resets[ \t]+([^\n]+?))?[ \t]*$/gim;

/**
 * Claude Code's own `/usage`, as a meter: the same one parseClaudeUsage
 * makes from Anthropic's answer, read from the words the CLI prints.
 * Null when the CLI is not on a Claude plan (it prints a session's cost
 * instead); an unavailable meter when it is, and could not say its limits.
 */
export function parseCliUsage(text, { now = Date.now() } = {}) {
  const said = String(text ?? '');
  const limits = {};
  for (const line of said.matchAll(CLI_LIMIT)) {
    const scope = line[2] ?? '';
    const key = !line[2] ? 'five_hour' : /^all models$/i.test(scope) ? 'seven_day' : /\bfable\b/i.test(scope) ? 'fable' : null;
    if (!key || limits[key]) continue;
    limits[key] = { utilization: Number(line[3]), resets_at: line[4] ? parseCliReset(line[4], now) : null };
  }
  if (!Object.keys(limits).length) {
    return /using your (?:subscription|overages)/i.test(said) ? unavailableMeter('claude-subscription', 'Claude', 'error') : null;
  }
  return parseClaudeUsage({
    five_hour: limits.five_hour,
    seven_day: limits.seven_day,
    limits: limits.fable ? [{ kind: 'weekly_scoped', group: 'weekly', percent: limits.fable.utilization, resets_at: limits.fable.resets_at, scope: { model: { display_name: 'Fable' } } }] : [],
  });
}

/** The arguments that ask Claude Code for `/usage`: no tools, no MCP server,
 *  none of the person's settings, and no session kept for it. */
export const CLI_USAGE_ARGS = ['-p', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--output-format', 'text', '--', '/usage'];

/** Usage on a drive hosted for someone else: Claude Code asked, its login
 *  never opened. No Cursor meter: that one reads a keychain. */
export async function collectUsageFromCli({ exec = runCommand, env = process.env, command = 'claude', timeout = 20_000, now = Date.now } = {}) {
  try {
    const cwd = path.join(tmpdir(), 'marble-agent-namer');
    await mkdir(cwd, { recursive: true });
    const result = await exec(command, CLI_USAGE_ARGS, { env: pickEnv(env), timeout, cwd });
    if (result?.missing || result?.aborted || result?.timedOut || result?.code) return { meters: [] };
    const meter = parseCliUsage(result.stdout, { now: now() });
    return { meters: meter ? [meter] : [] };
  } catch {
    return { meters: [] };
  }
}

// How long to wait before asking again, once the API has said "not now". The
// old code retried on the plain 60 s cache, which is the cadence that tripped
// the limit in the first place: the outage kept itself alive and the sliders
// sat at Unavailable for hours. Each further refusal widens the gap; one good
// answer puts it back to zero.
const BACKOFF_MS = [5, 15, 30, 60].map((min) => min * 60_000);

const rememberable = (meter) => meter?.available === true && meter?.used != null;

/** The last good reading, dressed as the answer we could not get. It keeps the
 *  number and says when it was true — an old percentage is information, and a
 *  slider that reads 0% / Unavailable is not. */
const asStale = (remembered, at) => ({ ...remembered, stale: true, at });

const readLast = async (file) => {
  if (!file) return null;
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
};

/** Reads usage, remembers what it last knew, and slows down when refused.
 *  `file` persists the last good reading so a host restart during a rate
 *  limit still has numbers to show; pass null to keep it in memory only. */
export function createUsageReader({ collect, ttl = CACHE_MS, now = Date.now, file = null } = {}) {
  let memo = null;
  let last = null;          // { at, meters: { [id]: meter } }, newest good reading per meter
  let loaded = false;
  let backoffUntil = 0;
  let step = 0;

  const load = async () => {
    if (loaded) return;
    loaded = true;
    const saved = await readLast(file);
    if (saved?.meters && typeof saved.meters === 'object') last = saved;
  };

  const save = async () => {
    if (!file || !last) return;
    try {
      await writeFile(file, JSON.stringify(last), 'utf8');
    } catch { /* a cache we cannot write is still a cache */ }
  };

  // Remember every meter that came back good; substitute the remembered one
  // wherever this reading has a login but no answer. A meter that is missing
  // entirely means signed out, and signed out is not staleness — it is the
  // truth, so nothing is substituted for it.
  const merge = (fresh) => {
    const meters = Array.isArray(fresh?.meters) ? fresh.meters : [];
    const good = {};
    for (const meter of meters) if (rememberable(meter)) good[meter.id] = meter;
    if (Object.keys(good).length) {
      last = { at: new Date(now()).toISOString(), meters: { ...(last?.meters ?? {}), ...good } };
    }
    return {
      ...fresh,
      meters: meters.map((meter) => {
        if (rememberable(meter)) return meter;
        const remembered = last?.meters?.[meter.id];
        return remembered ? asStale(remembered, last.at) : meter;
      }),
    };
  };

  return async () => {
    await load();
    const at = now();
    if (memo && at - memo.at < ttl) return memo.value;
    if (at < backoffUntil && memo) return memo.value;

    const fresh = await collect();
    const limited = (fresh?.meters ?? []).some((meter) => meter?.reason === 'rate-limited');
    if (limited) {
      backoffUntil = at + BACKOFF_MS[Math.min(step, BACKOFF_MS.length - 1)];
      step += 1;
    } else {
      backoffUntil = 0;
      step = 0;
    }

    const before = last;
    const value = merge(fresh);
    memo = { at, value };
    if (last !== before) await save();   // only a genuinely new reading is worth a write
    return value;
  };
}

