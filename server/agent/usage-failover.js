// What to do when a Claude turn dies because its usage window is spent.
// The runner and the page both ask these. Neither one decides the phrases
// or the effort ladder on its own.

import { groupCursorModels, pickCursorPickerModels } from './catalog.js';

export const CLAUDE_PROVIDERS = new Set(['claude-subscription', 'claude-api']);
export const CONTINUE = 'Continue';
export const BRIEF_CAP = 24_000;

const LADDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_WORD = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' };

// "session limit" is Claude's 5-hour window ("You've hit your session limit").
// The same phrase is what a Cursor stop has to match to continue on to Grok.
// It does not match "hit your limit": the word session sits between them.
const SPENT = /hit your limit|session limit|out of extra usage|extra usage limit|usage limit/i;
const RETRY = /try again|retry|rate limit|overloaded/i;

export const STAY = {
  signedOut: '— Cursor is unavailable, so this chat stayed on Claude',
  unreadable: "— Cursor's model list could not be read, so this chat stayed on Claude",
  noGrok: '— no Grok model is available, so this chat stayed on Claude',
  noFurther: '— no Grok model is available, so this chat stayed on Cursor',
};

// Fable's window is the one that usually runs out, and continuing on Fable
// would spend it again. Opus is the model the handoff uses instead.
const CLAUDE_ON_CURSOR = { opus: 'opus', sonnet: 'sonnet', haiku: 'haiku', fable: 'opus' };

const INSTRUCTION = [
  'Claude stopped because its usage was used up. Finish the work it started.',
  'The files on disk are the current state. Read them.',
  'Do not redo edits that are already there, and do not revert them.',
].join(' ');

const INSTRUCTION_AFTER_CURSOR = [
  'The Cursor model stopped because its usage was used up. Finish the work it started.',
  'The files on disk are the current state. Read them.',
  'Do not redo edits that are already there, and do not revert them.',
].join(' ');

export function usageStopped(error) {
  const text = String(error ?? '');
  if (!text.trim()) return false;
  if (RETRY.test(text)) return false;
  return SPENT.test(text);
}

function nearest(effort, offered) {
  const from = LADDER.indexOf(effort);
  if (from < 0 || !offered.length) return null;
  let best = null;
  let bestDist = Infinity;
  let bestAt = -1;
  for (const id of offered) {
    const at = LADDER.indexOf(id);
    if (at < 0) continue;
    const dist = Math.abs(at - from);
    if (dist < bestDist || (dist === bestDist && at > bestAt)) {
      best = id;
      bestDist = dist;
      bestAt = at;
    }
  }
  return best;
}

/** The effort word to store beside the Grok family. `''` means the bare model. */
export function matchEffort(effort, family) {
  const offered = (family?.efforts ?? []).map((entry) => entry.id).filter((id) => LADDER.includes(id));
  const bare = Boolean(family?.hasBare);
  const wanted = effort == null || effort === '' ? null : String(effort);
  if (!wanted) {
    if (bare) return '';
    if (offered.includes('high')) return 'high';
    return nearest('high', offered) ?? '';
  }
  if (offered.includes(wanted)) return wanted;
  const near = nearest(wanted, offered);
  if (near) return near;
  if (bare) return '';
  return offered.includes('high') ? 'high' : (offered[0] ?? '');
}

/** The Grok entry of the composer's Cursor pick. Never Auto. */
export function pickGrok(models) {
  return pickCursorPickerModels(models).find((item) => item.id !== 'auto' && /grok/i.test(`${item.id} ${item.label ?? ''}`)) ?? null;
}

function grouped(models) {
  return (models ?? []).some((item) => Array.isArray(item?.efforts) || item?.hasBare)
    ? [...models]
    : groupCursorModels(models);
}

function hasToken(id, token) {
  return new RegExp(`(?:^|-)${token}(?:-|$)`).test(String(id));
}

/** `claude-opus-5-5` is 505, `claude-opus-4-8` is 408, `claude-4.6-opus` is 406. */
function familyRank(id, word) {
  const text = String(id);
  const after = new RegExp(`(?:^|-)${word}-(\\d+)(?:-(\\d+))?(?:-|$)`).exec(text);
  if (after) return Number(after[1]) * 100 + (after[2] == null ? 0 : Number(after[2]));
  const before = new RegExp(`(\\d+)(?:\\.(\\d+))?-${word}(?:-|$)`).exec(text);
  if (before) return Number(before[1]) * 100 + (before[2] == null ? 0 : Number(before[2]));
  return 0;
}

/** Cursor's family for the Claude model this chat was using. The newest plain
 *  one: thinking and max are different products, and Fable maps to Opus. */
export function pickSameModel(models, claudeModel) {
  const word = CLAUDE_ON_CURSOR[String(claudeModel ?? '')];
  if (!word) return null;
  const matched = grouped(models).filter((item) => item.id !== 'auto' && hasToken(item.id, word));
  const plain = matched.filter((item) => !hasToken(item.id, 'thinking') && !hasToken(item.id, 'max'));
  const pool = plain.length ? plain : matched.filter((item) => !hasToken(item.id, 'max'));
  return [...pool].sort((a, b) => familyRank(b.id, word) - familyRank(a.id, word) || b.id.localeCompare(a.id))[0] ?? null;
}

/** The next model in the chain. Claude goes to the same family on Cursor.
 *  That family, once it also stops, goes to Grok. Grok does not continue. */
export function handoffModel(models, { model, usageLane } = {}) {
  if (usageLane === 'grok') return null;
  if (usageLane === 'model') return pickGrok(models);
  return pickSameModel(models, model) ?? pickGrok(models);
}

export function handoffLane(family) {
  if (!family) return null;
  return /grok/i.test(`${family.id} ${family.label ?? ''}`) ? 'grok' : 'model';
}

/** A spent window that this chat should continue past. Claude always can.
 *  Cursor can only when it is the middle of the chain, still on the same model. */
export function usageHandoffDue({ provider, usageLane, error } = {}) {
  if (!usageStopped(error)) return false;
  if (CLAUDE_PROVIDERS.has(provider)) return true;
  return provider === 'cursor' && usageLane === 'model';
}

export function continuedLabel(familyLabel, effort) {
  const word = EFFORT_WORD[effort] ?? '';
  return [familyLabel, word].filter(Boolean).join(' ');
}

function changeLine(event) {
  if (event.type === 'ops.applied') {
    const count = Number(event.count) || 0;
    return `${event.path} (${count} element${count === 1 ? '' : 's'})`;
  }
  if (event.type === 'document.changed') return String(event.path ?? '');
  return '';
}

/** The text the next model receives ahead of the word Continue. The bubble stays Continue. */
export function usageBrief(events, error, { afterCursor = false } = {}) {
  const list = Array.isArray(events) ? events : [];
  let people = list.filter((event) => event.type === 'user').map((event) => String(event.text ?? ''));
  let said = list.filter((event) => event.type === 'text' && event.text).map((event) => String(event.text));
  const changes = list.map(changeLine).filter(Boolean);
  const fileList = changes.length ? changes.map((line) => `- ${line}`).join('\n') : '- (nothing recorded)';
  const stopped = error ? [`Stopped: ${error}`] : [];

  const build = () => {
    const task = people.length ? people.map((text) => `Person: ${text}`).join('\n') : '(no message recorded)';
    const where = [...said.map((text) => `Agent: ${text}`), ...stopped].join('\n') || '(no agent text)';
    return [
      afterCursor ? INSTRUCTION_AFTER_CURSOR : INSTRUCTION,
      '',
      'The task:',
      task,
      '',
      'What already changed:',
      fileList,
      '',
      'Where it stopped:',
      where,
    ].join('\n');
  };

  while (build().length > BRIEF_CAP && said.length > 1) said.shift();
  if (build().length > BRIEF_CAP && said.length === 1) {
    const over = build().length - BRIEF_CAP;
    said[0] = said[0].slice(Math.min(over, said[0].length));
    if (!said[0]) said = [];
  }
  while (build().length > BRIEF_CAP && people.length) people.shift();
  if (build().length > BRIEF_CAP && stopped.length) {
    const over = build().length - BRIEF_CAP;
    stopped[0] = stopped[0].slice(Math.min(over, stopped[0].length));
  }
  return build();
}
