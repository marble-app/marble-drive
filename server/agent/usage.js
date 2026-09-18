// Remaining Claude / Cursor usage, as a percent. The host reads the CLI
// tokens from the macOS keychain and asks each vendor; it never logs those
// tokens and never returns them. Missing or unsigned-in is an empty list.
// A Claude token whose usage fetch fails is an unavailable meter, not a
// missing one — never a throw. Tests inject `usage` on createDrive so they
// never hit the network.

import { runCommand } from './providers/exec.js';

const CLAUDE_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const CURSOR_USAGE = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
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

const windowOf = (id, label, used, resetsAt, kind = 'quota') => (
  used == null ? null : { id, label, used, left: 100 - used, resetsAt: resetsAt ?? null, kind }
);

const CLAUDE_QUOTAS = [
  ['five_hour', '5h', 'Short-term'],
  ['seven_day', 'week', 'Weekly'],
];

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

export function unavailableMeter(id, label) {
  return {
    id,
    label,
    available: false,
    used: null,
    left: null,
    window: null,
    resetsAt: null,
    detail: 'Unavailable',
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

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export async function collectUsage({ exec = defaultExec, request = defaultRequest } = {}) {
  const meters = [];
  try {
    const claudeToken = claudeTokenFromKeychain(await readKeychain(exec, 'Claude Code-credentials'));
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
        meters.push(meter ?? unavailableMeter('claude-subscription', 'Claude'));
      } catch {
        meters.push(unavailableMeter('claude-subscription', 'Claude'));
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

export function cachedUsage(fn, ttl = CACHE_MS) {
  let memo = null;
  return async () => {
    if (memo && Date.now() - memo.at < ttl) return memo.value;
    const value = await fn();
    memo = { at: Date.now(), value };
    return value;
  };
}
