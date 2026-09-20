// What a chat is called.
//
// A conversation's name used to be the first sixty characters of whatever
// someone happened to type — pasted-image markup and all. That is a slice of
// a sentence, not a name, and a board of them reads like a log file. So the
// slice stays, but only as a placeholder: the row has to say something while
// the turn runs. Once the first turn is over, a small model reads what was
// asked and what came back and writes a short title over it.
//
// Two rules keep it honest. `titleAuto` marks a name this file wrote, and
// only such a name is ever replaced — a title the person typed is theirs.
// And naming never blocks or fails a turn: no CLI, no answer, no network,
// the placeholder simply stays.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { pickEnv } from './env.js';
import { runCommand } from './providers/exec.js';

/** Long enough for five words, short enough for a pane's title bar. */
export const TITLE_MAX = 48;
/** The placeholder keeps the old width: it is a quotation, not a name. */
export const PLACEHOLDER_MAX = 60;

const PROMPT_MAX = 1_500;
const REPLY_MAX = 800;

/** An attachment is markup the composer wrote, not something the person said.
 *  Its tags make a title that says nothing; the text inside one does not. */
const unwrapAttachments = (text) =>
  String(text ?? '')
    .replace(/<pasted-image\b[^>]*>[\s\S]*?<\/pasted-image>/g, ' ')
    .replace(/<pasted-image\b[^>]*\/?>/g, ' ')
    .replace(/<\/?pasted-text\b[^>]*>/g, ' ');

/** The name a chat wears until the model has read it: the first line of the
 *  prompt, cleaned of markup. Written the moment the message lands, so no row
 *  on the board is ever blank. */
export function fallbackTitle(text) {
  const clean = unwrapAttachments(text).replace(/\s+/g, ' ').trim();
  return clean.slice(0, PLACEHOLDER_MAX).trim();
}

export function titlePrompt({ prompt, reply = '' }) {
  const asked = unwrapAttachments(prompt).trim().slice(0, PROMPT_MAX);
  const answered = String(reply ?? '').trim().slice(0, REPLY_MAX);
  return [
    'Name this chat, the way a tab in a browser is named.',
    '',
    'What the person asked:',
    '"""',
    asked || '(nothing)',
    '"""',
    ...(answered ? ['', 'How the assistant answered:', '"""', answered, '"""'] : []),
    '',
    'Reply with ONLY the title. Two to five words, Title Case, naming the',
    'subject of the work — not the person, not the assistant, not the word',
    '"chat". No quotes, no trailing punctuation, no explanation.',
  ].join('\n');
}

/** A model told to answer with only a title mostly does, and sometimes adds a
 *  line in front. The last non-empty line is the answer either way. Anything
 *  that still does not look like a title is refused rather than shown: the
 *  placeholder is a worse name, but it is never a sentence of apology. */
export function cleanTitle(raw) {
  const lines = String(raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let title = lines[lines.length - 1] ?? '';
  title = title
    .replace(/^(?:title|name)\s*[:\-—]\s*/i, '')
    .replace(/^[#>*\-\s]+/, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
    .replace(/[.,;:!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return null;
  // A refusal, an error, or a model that explained itself in one line. A real
  // title is short; eighty characters of prose is not one.
  if (title.length > 80) return null;
  if (/^(i\b|i['’](m|ll)\b|sorry|error|unable|cannot|can't)/i.test(title)) return null;
  if (title.length <= TITLE_MAX) return title;
  // Cut at a word, not mid-word, and never leave a dangling separator.
  const cut = title.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > 12 ? cut.slice(0, space) : cut).replace(/[\s\-–—:,]+$/, '');
}

/** The CLIs are asked from an empty directory with `--setting-sources project`
 *  (claude) or a throwaway workspace (cursor): naming a chat must not run the
 *  person's hooks, skills or memory, and must not touch their project. */
async function scratch() {
  const dir = path.join(os.tmpdir(), 'marble-agent-namer');
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function claudeArgs(model, prompt) {
  return [
    '-p',
    '--model', model,
    '--tools', '',
    '--setting-sources', 'project',
    '--output-format', 'text',
    '--', prompt,
  ];
}

/** Ask whichever CLI is installed for a title. Returns null — never throws —
 *  when there is no answer to be had. */
export async function nameConversation({
  prompt,
  reply = '',
  model = 'haiku',
  exec = runCommand,
  env = process.env,
  timeout = 45_000,
  signal,
  log = console,
} = {}) {
  if (!String(prompt ?? '').trim() && !String(reply ?? '').trim()) return null;
  const ask = titlePrompt({ prompt, reply });
  const cwd = await scratch();
  const clean = pickEnv(env);
  // Haiku over the login, the same way a subscription turn runs: no key in
  // the environment, so naming never bills an API account by accident.
  const attempts = [
    { command: 'claude', args: claudeArgs(model, ask) },
    { command: 'cursor-agent', args: ['-p', '--mode', 'ask', '--trust', '--workspace', cwd, '--output-format', 'text', '--', ask] },
  ];
  for (const attempt of attempts) {
    const result = await exec(attempt.command, attempt.args, { timeout, env: clean, cwd, signal });
    if (result.aborted) return null;
    if (result.missing) continue; // that CLI is not installed; try the next
    if (result.timedOut || result.code) {
      const why = result.timedOut ? 'timed out' : result.stderr?.trim() || `exit ${result.code}`;
      log.error?.(`[agents] naming with ${attempt.command} failed: ${why}`);
      continue;
    }
    const title = cleanTitle(result.stdout);
    if (title) return title;
  }
  return null;
}
