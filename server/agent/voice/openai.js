// The host's ears and voice: OpenAI's transcription and speech endpoints,
// with the `openai` key the drive keeps for Codex (server/agent/keys.js).
//
// Node 22's fetch, FormData and Blob, and no SDK. The key goes only into an
// Authorization header to `baseURL`; it is never in an error this throws, and
// OpenAI's own error text (which can quote part of a key) is never passed on.
// A clip is held in memory for one request and never written anywhere.
//
// Field shapes, checked against OpenAI's docs on 2026-10-10:
//   POST /v1/audio/transcriptions, multipart: file, model, keywords[] (one per
//     term; gpt-transcribe's hint for names and terms). Answers { text }.
//   POST /v1/audio/speech, JSON: model, voice, input, instructions,
//     response_format. Answers the audio, streamed.

const DEFAULTS = {
  transcribeModel: 'gpt-transcribe',
  speechModel: 'gpt-4o-mini-tts',
  voice: 'marin',
};
export const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
export const INSTRUCTIONS = 'Speak plainly and at an even, unhurried pace, like a colleague giving a quick update.';
const TIMEOUT_MS = 60_000;
const MAX_KEYWORDS = 40;

const WORDS = {
  noKey: 'Voice needs an OpenAI key on this drive. Add one in Settings › Voice.',
  refused: "OpenAI didn't accept the key in Settings › Voice.",
  down: "OpenAI didn't answer. Try again.",
  limited: 'OpenAI turned it down: the account is out of credit or busy. Try again later.',
  unreadable: "OpenAI couldn't read that recording. Try again.",
  nothing: "Didn't catch anything. Try again a little closer.",
};

/** A failure said for a person. `status` is what the route answers with. */
export class VoiceError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
    this.code = code;
  }
}

const EXTENSION = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg' };
export const baseType = (type) => String(type ?? '').split(';')[0].trim().toLowerCase();

const failed = (status) => {
  if (status === 401 || status === 403) return new VoiceError(502, WORDS.refused, 'refused');
  if (status === 429) return new VoiceError(502, WORDS.limited, 'limited');
  if (status === 400 || status === 413 || status === 415) return new VoiceError(502, WORDS.unreadable, 'unreadable');
  return new VoiceError(502, WORDS.down, 'down');
};

export function createVoice({ keys, baseURL = 'https://api.openai.com', fetch = globalThis.fetch, settings = async () => ({}) }) {
  const key = () => keys?.value?.('openai') ?? null;
  const pick = async () => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries((await settings()) ?? {}).filter(([, v]) => typeof v === 'string' && v)) });

  function available() {
    return key() ? { ok: true } : { ok: false, why: 'no-key' };
  }

  /** One request to OpenAI. An abort from the caller is rethrown as itself;
   *  anything else that is not an answer is "didn't answer". */
  async function call(route, init, signal) {
    const secret = key();
    if (!secret) throw new VoiceError(409, WORDS.noKey, 'no-key');
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetch(new URL(route, baseURL), {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${secret}` },
        signal: both,
      });
    } catch (err) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      throw new VoiceError(502, WORDS.down, 'down');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw failed(response.status);
    }
    return response;
  }

  /** A clip in, its words out. `keywords` are names the drive spells its own
   *  way, so they come back spelled that way. */
  async function transcribe({ audio, type, keywords = [], signal } = {}) {
    const { transcribeModel } = await pick();
    const kind = baseType(type);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: kind || 'application/octet-stream' }), `clip.${EXTENSION[kind] ?? 'webm'}`);
    form.append('model', transcribeModel);
    // whisper-1 takes no keywords; its free-text prompt carries them instead.
    const terms = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, MAX_KEYWORDS);
    if (terms.length) {
      if (/^whisper/.test(transcribeModel)) form.append('prompt', terms.join(', '));
      else for (const term of terms) form.append('keywords[]', term);
    }
    const response = await call('/v1/audio/transcriptions', { method: 'POST', body: form }, signal);
    let body;
    try {
      body = await response.json();
    } catch {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      throw new VoiceError(502, WORDS.down, 'down');
    }
    const text = String(body?.text ?? '').trim();
    if (!text) throw new VoiceError(422, WORDS.nothing, 'nothing');
    return { text };
  }

  /** Words in, audio out: the fetch Response, its body still streaming. */
  async function speak({ text, voice, instructions = INSTRUCTIONS, signal } = {}) {
    const chosen = await pick();
    return call('/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chosen.speechModel,
        voice: VOICES.includes(voice) ? voice : VOICES.includes(chosen.voice) ? chosen.voice : DEFAULTS.voice,
        input: String(text ?? ''),
        instructions,
        response_format: 'mp3',
      }),
    }, signal);
  }

  return { available, transcribe, speak };
}

export const VOICE_WORDS = WORDS;
