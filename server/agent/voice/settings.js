// What a drive chose about voice, kept in the agents' settings.json under
// `voice`, and how much it has heard and said this month, kept beside it.
//
// The defaults are the spec's proposals, taken while the owner's answers are
// pending (docs/superpowers/specs/2026-10-10-voice-design.md, "Open
// questions"): voice on wherever there is a key; what you say is sent when you
// stop; speaking while a turn runs steers it; replies are read aloud only when
// you spoke; marin.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { VOICES } from './openai.js';

export const VOICE_DEFAULTS = Object.freeze({
  on: true,
  voice: 'marin',
  readAloud: 'spoken',
  sendWhenStop: true,
  whileRunning: 'steer',
});
const READ_ALOUD = new Set(['spoken', 'always', 'never']);
const WHILE_RUNNING = new Set(['steer', 'queue']);

/** The saved choice, with every field there and valid. */
export function voiceSettings(saved) {
  const v = saved && typeof saved === 'object' ? saved : {};
  return {
    on: typeof v.on === 'boolean' ? v.on : VOICE_DEFAULTS.on,
    voice: VOICES.includes(v.voice) ? v.voice : VOICE_DEFAULTS.voice,
    readAloud: READ_ALOUD.has(v.readAloud) ? v.readAloud : VOICE_DEFAULTS.readAloud,
    sendWhenStop: typeof v.sendWhenStop === 'boolean' ? v.sendWhenStop : VOICE_DEFAULTS.sendWhenStop,
    whileRunning: WHILE_RUNNING.has(v.whileRunning) ? v.whileRunning : VOICE_DEFAULTS.whileRunning,
    // Which models; not offered on the page, but a setting rather than a
    // constant, so a model that misbehaves is one line in settings.json.
    ...(typeof v.transcribeModel === 'string' && v.transcribeModel ? { transcribeModel: v.transcribeModel } : {}),
    ...(typeof v.speechModel === 'string' && v.speechModel ? { speechModel: v.speechModel } : {}),
  };
}

/** A PUT's `voice`, laid over what is saved: what is not valid is ignored. */
export function patchVoice(saved, body) {
  const next = { ...voiceSettings(saved) };
  if (!body || typeof body !== 'object') return next;
  if (typeof body.on === 'boolean') next.on = body.on;
  if (VOICES.includes(body.voice)) next.voice = body.voice;
  if (READ_ALOUD.has(body.readAloud)) next.readAloud = body.readAloud;
  if (typeof body.sendWhenStop === 'boolean') next.sendWhenStop = body.sendWhenStop;
  if (WHILE_RUNNING.has(body.whileRunning)) next.whileRunning = body.whileRunning;
  return next;
}

const monthOf = (now) => new Date(now).toISOString().slice(0, 7);

/** Seconds heard and characters spoken, this month. Counts only: no words,
 *  no audio. */
export function createVoiceUsage({ dir, now = () => Date.now() }) {
  const file = path.join(dir, 'voice-usage.json');
  let chain = Promise.resolve();
  const read = async () => {
    try {
      const saved = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (saved?.month === monthOf(now())) return { month: saved.month, heardSeconds: Number(saved.heardSeconds) || 0, spokenChars: Number(saved.spokenChars) || 0 };
    } catch {
      // None yet, or unreadable: start the month again.
    }
    return { month: monthOf(now()), heardSeconds: 0, spokenChars: 0 };
  };
  const add = ({ heardSeconds = 0, spokenChars = 0 }) => {
    chain = chain.then(async () => {
      const current = await read();
      current.heardSeconds += Math.max(0, Math.round(heardSeconds));
      current.spokenChars += Math.max(0, Math.round(spokenChars));
      await fsp.mkdir(dir, { recursive: true });
      const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, `${JSON.stringify(current)}\n`);
      await fsp.rename(tmp, file);
    }).catch(() => {});
    return chain;
  };
  return { read: async () => { await chain; return read(); }, add };
}
