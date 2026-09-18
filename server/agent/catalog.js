// Shared catalog helpers for the Agents picker: Cursor’s model list bakes
// effort and speed into the id, Claude’s does not, and each CLI has its own
// Shift+Tab mode cycle.

import os from 'node:os';
import path from 'node:path';

import { runCommand } from './providers/exec.js';

export const CLAUDE_MODES = [
  { id: 'auto', label: 'Auto' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
  { id: 'manual', label: 'Ask me' },
  { id: 'bypassPermissions', label: 'Bypass permissions' },
];

export const CURSOR_MODES = [
  { id: 'agent', label: 'Run Everything' },
  { id: 'plan', label: 'Plan' },
  { id: 'ask', label: 'Ask' },
  { id: 'review', label: 'Auto-review' },
];

const EFFORT_KEYS = ['xhigh', 'high', 'medium', 'low'];
const EFFORT_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  fast: 'Fast',
  'low-fast': 'Low Fast',
  'medium-fast': 'Medium Fast',
  'high-fast': 'High Fast',
  'xhigh-fast': 'Extra High Fast',
};

export function nextMode(modes, current) {
  const ids = (modes ?? []).map((item) => item.id);
  if (!ids.length) return current ?? '';
  const index = ids.indexOf(current);
  return ids[(index < 0 ? 0 : index + 1) % ids.length];
}

export function splitCursorModel(id) {
  if (!id) return { family: '', effort: '' };
  let rest = String(id);
  let fast = false;
  if (rest.endsWith('-fast')) {
    fast = true;
    rest = rest.slice(0, -5);
  }
  for (const key of EFFORT_KEYS) {
    const suffix = `-${key}`;
    if (rest.endsWith(suffix)) {
      return { family: rest.slice(0, -suffix.length), effort: fast ? `${key}-fast` : key };
    }
  }
  if (fast) return { family: rest, effort: 'fast' };
  return { family: rest, effort: '' };
}

export function composeCursorModel(family, effort) {
  if (!family) return family;
  if (!effort) return family;
  return `${family}-${effort}`;
}

export function resolveCursorModel(model, effort, fallback) {
  const raw = model || fallback;
  if (!raw) return fallback;
  const parts = splitCursorModel(raw);
  const family = parts.family || raw;
  if (effort == null || effort === '') return model ? raw : fallback;
  return composeCursorModel(family, effort);
}

const familyLabel = (label, effort) => {
  let text = String(label ?? '').replace(/\s*\(default\)\s*$/i, '').trim();
  if (effort) {
    text = text.replace(/\s+(Extra High|High|Medium|Low)(\s+Fast)?$/i, '').trim();
    text = text.replace(/\s+Fast$/i, '').trim();
  }
  text = text.replace(/^Cursor\s+/i, '').trim();
  return text || String(label ?? '');
};

export function groupCursorModels(models) {
  const families = new Map();
  for (const item of models ?? []) {
    const { family, effort } = splitCursorModel(item.id);
    const key = family || item.id;
    if (!families.has(key)) {
      families.set(key, {
        id: key,
        label: familyLabel(item.label ?? item.id, effort),
        efforts: [],
        hasBare: false,
      });
    }
    const group = families.get(key);
    if (!effort) group.hasBare = true;
    if (effort && !group.efforts.some((entry) => entry.id === effort)) {
      group.efforts.push({ id: effort, label: EFFORT_LABELS[effort] || effort });
    }
  }
  return [...families.values()];
}

function grokVersion(id) {
  const hit = String(id).match(/grok[^\d]*(\d+(?:\.\d+)?)/i);
  return hit ? Number(hit[1]) : 0;
}

export function pickCursorPickerModels(models) {
  const grouped = (models ?? []).some((item) => Array.isArray(item?.efforts) || item?.hasBare)
    ? [...models]
    : groupCursorModels(models);
  const auto = grouped.find((item) => item.id === 'auto');
  const groks = grouped.filter((item) => /grok/i.test(item.id) || /grok/i.test(item.label ?? ''));
  const best = [...groks].sort((a, b) => grokVersion(b.id) - grokVersion(a.id) || b.id.localeCompare(a.id))[0];
  return [auto, best].filter(Boolean);
}

export const PICKER_PROVIDER_ORDER = ['claude-subscription', 'cursor', 'claude-api'];

export function sortProviders(list) {
  const rank = (id) => {
    const index = PICKER_PROVIDER_ORDER.indexOf(id);
    return index < 0 ? PICKER_PROVIDER_ORDER.length + 1 : index;
  };
  return [...(list ?? [])].sort((a, b) => rank(a.id) - rank(b.id) || String(a.id).localeCompare(String(b.id)));
}

export function filesEditedLabel(n) {
  const count = Number(n) || 0;
  return `${count} document${count === 1 ? '' : 's'} changed`;
}

export async function driveWhere(root, { exec = runCommand, home = os.homedir() } = {}) {
  const resolved = path.resolve(root);
  let shown = resolved;
  if (resolved === home) shown = '~';
  else if (resolved.startsWith(`${home}${path.sep}`)) shown = `~${resolved.slice(home.length)}`;
  const git = await exec('git', ['-C', resolved, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = git.code === 0 ? String(git.stdout ?? '').trim() : '';
  return { path: shown, branch: branch && branch !== 'HEAD' ? branch : null };
}
