// What to do when a Claude turn dies because its usage window is spent.
// The runner and the page both ask these. Neither one decides the phrases
// or the effort ladder on its own.

import { pickCursorPickerModels } from './catalog.js';

export const CLAUDE_PROVIDERS = new Set(['claude-subscription', 'claude-api']);
export const CONTINUE = 'Continue';
export const BRIEF_CAP = 24_000;

const LADDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_WORD = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' };

const SPENT = /hit your limit|out of extra usage|extra usage limit|usage limit/i;
const RETRY = /try again|retry|rate limit|overloaded/i;

export const STAY = {
  signedOut: '— Cursor is unavailable, so this chat stayed on Claude',
  unreadable: "— Cursor's model list could not be read, so this chat stayed on Claude",
  noGrok: '— no Grok model is available, so this chat stayed on Claude',
};

const INSTRUCTION = [
  'Claude stopped because its usage was used up. Finish the work it started.',
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

/** The text Grok receives ahead of the word Continue. The bubble stays Continue. */
export function usageBrief(events, error) {
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
      INSTRUCTION,
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
