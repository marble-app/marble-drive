// What a fresh callout card offers for one element.
//
// The card opens with plain suggestions for the kind of thing it is about (a
// row, a heading) so it is never empty. Then it asks here, once, for
// suggestions written for *this* element: a small model reads the element's
// own markup — from the store, never the page's copy — and answers with
// three things a person might want done to it, plus the idea the Automate it
// and Make it interactive actions should start from, and what Try variations
// should vary.
//
// The same plumbing as the chat namer (namer.js): the installed CLI on the
// login, never a key, a hard timeout, and no answer is not an error. The page
// keeps its defaults.

import { pickEnv } from './env.js';
import { runCommand } from './providers/exec.js';
import { scratch } from './namer.js';

const HTML_MAX = 4_000;
const WORDS_MAX = 400;
const SUGGESTION_MAX = 70;

/** Tags and whitespace off, for a model that only needs to read it. */
const readable = (html) => String(html ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function offerPrompt({ title = '', html = '', words = '' }) {
  const element = readable(html).slice(0, HTML_MAX);
  const said = String(words ?? '').trim().slice(0, WORDS_MAX);
  return [
    'Someone is looking at one element of a document in an editor where an AI agent can change the page.',
    'Suggest what they might want done to it.',
    '',
    `The document is called: ${title || '(untitled)'}`,
    'The element, as markup:',
    '"""',
    element || '(nothing)',
    '"""',
    ...(said ? ['', 'They selected these words in it:', '"""', said, '"""'] : []),
    '',
    'Reply with ONLY a JSON object, no prose and no code fence:',
    '{"suggestions": ["…", "…", "…"], "automatic": "…", "interactive": "…", "variations": "…"}',
    '',
    '- suggestions: three short requests, each under 60 characters, written as the person would type them, specific to this content (not generic advice like "improve it").',
    '- automatic: one short phrase for what could happen here by itself or at the press of a button, e.g. "a Fill button that looks up the authors from the title".',
    '- interactive: one short phrase for how it could be acted on rather than read, e.g. "click a status to flip it".',
    '- variations: three ways three versions of it could differ, as one short phrase, e.g. "as a card, compact, or title first".',
  ].join('\n');
}

const clean = (text, max) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/^["'“]|["'”]$/g, '');
  return t && t.length <= max ? t : null;
};

/** The model's answer, or null when it is not the shape asked for. */
export function readOffer(raw) {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const suggestions = (Array.isArray(value?.suggestions) ? value.suggestions : [])
    .map((s) => clean(s, SUGGESTION_MAX))
    .filter(Boolean)
    .slice(0, 3);
  if (!suggestions.length) return null;
  const read = {
    suggestions,
    automatic: clean(value.automatic, 90),
    interactive: clean(value.interactive, 90),
  };
  const variations = clean(value.variations, 70);
  if (variations) read.variations = variations;
  return read;
}

/** Ask the installed CLI. Returns null — never throws — without an answer. */
export async function writeOffer({
  title = '',
  html = '',
  words = '',
  model = 'haiku',
  exec = runCommand,
  env = process.env,
  timeout = 20_000,
  signal,
  log = console,
} = {}) {
  if (!readable(html) && !String(words).trim()) return null;
  const ask = offerPrompt({ title, html, words });
  const cwd = await scratch();
  const result = await exec('claude', ['-p', '--model', model, '--tools', '', '--setting-sources', 'project', '--output-format', 'text', '--', ask], {
    timeout, env: pickEnv(env), cwd, signal,
  });
  if (result.aborted || result.missing) return null;
  if (result.timedOut || result.code) {
    log.error?.(`[agents] offer failed: ${result.timedOut ? 'timed out' : result.stderr?.trim() || `exit ${result.code}`}`);
    return null;
  }
  return readOffer(result.stdout);
}
