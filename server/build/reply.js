// A comment pinned to the app, answered in its thread.
//
// The same plumbing as the callout's offer (server/agent/offer.js): the
// installed CLI on the login, no tools, a hard timeout, and no answer is not
// an error — the thread says it could not answer. The model reads the
// comment, the thread so far, the element it is pinned to and an outline of
// the page, and answers in words; when the comment asks for something to be
// different, it also offers the change, which Build that files as a note for
// the next build.

import { pickEnv } from '../agent/env.js';
import { runCommand } from '../agent/providers/exec.js';
import { scratch } from '../agent/namer.js';

const HTML_MAX = 5_000;
const OUTLINE_MAX = 3_000;
const ANSWER_MAX = 600;
const OFFER_MAX = 200;

const readable = (html) => String(html ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function replyPrompt({ title = '', html = '', outline = '', thread = [] }) {
  const said = thread.filter((line) => line.text).map((line) => `${line.who === 'agent' ? 'You' : 'Them'}: ${line.text}`);
  return [
    'You answer for an app in Marble Drive, as the app: the person pins comments to it and reads your answer in the comment\'s thread, signed with the app\'s name. They never see an agent, a model or a job, so never mention one; say "I" for the app and what it will do in the next build.',
    '',
    `The app: ${title || '(untitled)'}`,
    'Its parts:',
    '"""',
    String(outline || '(empty)').slice(0, OUTLINE_MAX),
    '"""',
    'The comment is pinned to this element:',
    '"""',
    readable(html).slice(0, HTML_MAX) || '(the page)',
    '"""',
    'The thread, oldest first:',
    ...said,
    '',
    'Answer their last line. Reply with ONLY a JSON object, no prose and no code fence:',
    '{"answer": "…", "offer": "…" or null}',
    '- answer: one to three plain sentences, as you would say it to them. Say why the app is the way it is when they ask; never invent facts about their data.',
    '- offer: when what they said asks for the app to be different, the change as a short instruction for the next build (e.g. "Group the four invitations past three days on top"). Otherwise null.',
  ].join('\n');
}

export function readReply(raw) {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const answer = String(value?.answer ?? '').replace(/\s+/g, ' ').trim().slice(0, ANSWER_MAX);
  if (!answer) return null;
  const offer = typeof value?.offer === 'string' ? value.offer.replace(/\s+/g, ' ').trim().slice(0, OFFER_MAX) : '';
  return { answer, offer: offer || null };
}

/** Ask the installed CLI. Returns null — never throws — without an answer. */
export async function writeReply({ title = '', html = '', outline = '', thread = [], model = 'haiku', exec = runCommand, env = process.env, timeout = 30_000, log = console } = {}) {
  if (!thread.some((line) => line.who !== 'agent' && line.text)) return null;
  const ask = replyPrompt({ title, html, outline, thread });
  const cwd = await scratch();
  const result = await exec('claude', ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--output-format', 'text', '--', ask], {
    timeout, env: pickEnv(env), cwd,
  });
  if (result.aborted || result.missing) return null;
  if (result.timedOut || result.code) {
    log.error?.(`[builds] reply failed: ${result.timedOut ? 'timed out' : result.stderr?.trim() || `exit ${result.code}`}`);
    return null;
  }
  return readReply(result.stdout);
}
