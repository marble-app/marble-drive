// Cursor Grok shapes a TypeSafe question and splits a low-confidence one.
// Ask mode, no tools: the answer is JSON, not an edit.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseCursorModels } from '../agent/providers/cursor.js';
import { runCommand } from '../agent/providers/exec.js';
import { asQuestionList, parseJsonBlock } from './json.js';
import { cancelledError } from './pipeline.js';

export const LLM_MODEL = 'cursor-grok-4.8-high';

export function resolveGrokHigh(models, prefer = LLM_MODEL) {
  const ids = (models ?? []).map((item) => (typeof item === 'string' ? item : item?.id)).filter(Boolean);
  if (ids.includes(prefer)) return prefer;
  const highs = ids.filter((id) => /grok/i.test(id) && /-high$/.test(id));
  highs.sort((a, b) => {
    const num = (id) => Number(/grok[^\d]*(\d+(?:\.\d+)?)/i.exec(id)?.[1] || 0);
    return num(b) - num(a);
  });
  return highs[0] || prefer;
}

export function shapePrompt(origin) {
  return `You write TypeSafe System One questions for a Recursive Subquestions pipeline.

The user's task:
${origin}

Write 2–5 sentences explaining which TypeSafe question you will ask and why. Then a blank line. Then ONLY JSON for that question:
{"type":"choice"|"noul"|"score","text":"<the question>","criteria":<see below>}

Rules:
- type "choice": criteria is an object mapping option id to a short rubric. Include "no_match" when nothing may fit.
- type "noul": criteria is optional {"true":"...","false":"..."}. text is a yes/no question.
- type "score": criteria is an array of at least two level descriptions, low to high.
- Put the full meaning in text. Do not mention TypeSafe or confidence.
- Independent of later splits. One judgment, not a plan.
- The question must still be a decision the original task needs.
- Prefer type "choice" when the task is to make, show, or choose an interface. Options are mutually exclusive design defaults, plus no_match.
- Must not replace a make, show, or design task with a domain fact (a sports outcome, a quantity, a world-knowledge Score or Noul).
- Must not drop any part of the task because code can filter, list, or look it up. If the user asked to show games and standings, both remain in the task; ask the underspecified interface decision.
- If a System One model could answer from world knowledge without deciding the user's goal, rewrite.`;
}

export function splitPrompt(node) {
  return `You are splitting a question that a TypeSafe System One model was not confident enough to answer.

Original task:
${node.origin}

Current question (${node.type}, confidence ${node.confidence}):
${node.text}

Write 2–5 sentences explaining the independent dimensions of the original task you will cut along. Then a blank line. Then ONLY a JSON array of 2–4 narrower TypeSafe questions:
[{"type":"choice"|"noul"|"score","text":"...","criteria":...}, ...]

Cut along independent dimensions of the original task, not facets of the current wording. Each child must be answerable on its own and useful for composing the original task.
Do not paraphrase the current question. No child may forget the original task.
If the original task is to make, show, or design an interface, at least one child must be about that interface, and at least one child must be about content the user named.
Do not name widgets unless the original task is about widgets.`;
}

export function textFromCursor(stdout) {
  const raw = String(stdout ?? '');
  const chunks = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event.type !== 'assistant') continue;
      const text = (event.message?.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      if (text) chunks.push(text);
    } catch {
      // not a stream-json line
    }
  }
  return chunks.length ? chunks.join('') : raw;
}

async function listedGrok(exec, env, signal) {
  const probe = await exec('cursor-agent', ['models'], { timeout: 8_000, env, signal });
  if (probe.missing || probe.code || probe.aborted) return [];
  return parseCursorModels(probe.stdout);
}

export async function complete({
  prompt,
  model = LLM_MODEL,
  exec = runCommand,
  timeout = 180_000,
  env = process.env,
  signal,
  onChunk,
} = {}) {
  if (signal?.aborted) throw cancelledError();
  const modelId = resolveGrokHigh(await listedGrok(exec, env, signal), model);
  if (signal?.aborted) throw cancelledError();
  const workspace = path.join(os.tmpdir(), 'marble-typesafe-llm');
  await fsp.mkdir(workspace, { recursive: true });
  const result = await exec(
    'cursor-agent',
    [
      '-p',
      '--mode', 'ask',
      '--trust',
      '--workspace', workspace,
      '--model', modelId,
      '--output-format', 'text',
      '--',
      prompt,
    ],
    {
      timeout,
      env,
      signal,
      onStdout: (chunk) => onChunk?.(String(chunk)),
    },
  );
  if (result.aborted || signal?.aborted) throw cancelledError();
  if (result.missing) {
    const err = new Error('cursor-agent is not installed');
    err.status = 503;
    throw err;
  }
  if (result.timedOut) {
    const err = new Error('cursor-agent timed out');
    err.status = 504;
    throw err;
  }
  if (result.code) {
    const err = new Error(result.stderr?.trim() || `cursor-agent exited ${result.code}`);
    err.status = 502;
    throw err;
  }
  return textFromCursor(result.stdout);
}

export async function shapeWithLlm(origin, opts = {}) {
  const run = opts.complete ?? complete;
  const parsed = parseJsonBlock(await run({ prompt: shapePrompt(origin), ...opts }));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.type || !parsed.text) {
    const err = new Error('shape did not return a TypeSafe question');
    err.status = 502;
    throw err;
  }
  return parsed;
}

export async function splitWithLlm(node, opts = {}) {
  const run = opts.complete ?? complete;
  return asQuestionList(parseJsonBlock(await run({ prompt: splitPrompt(node), ...opts })));
}

export function repairPrompt(node, detail) {
  return `TypeSafe rejected this System One question. The validator said:
${detail}

The rejected question:
${JSON.stringify({ type: node.type, text: node.text, criteria: node.criteria ?? null }, null, 2)}

Write 2–5 sentences on what was invalid and how you will fix it. Then a blank line. Then ONLY JSON for a valid replacement:
{"type":"choice"|"noul"|"score","text":"<the question>","criteria":<see below>}

Rules:
- type "choice": criteria is an object mapping option id to a short rubric. Include "no_match" when nothing may fit.
- type "noul": criteria is optional {"true":"...","false":"..."}. text is a yes/no question.
- type "score": criteria is an array of at least two level descriptions, low to high.
- Keep the same judgment if possible. Do not mention TypeSafe or confidence.`;
}

export async function repairWithLlm(nodes, detail, opts = {}) {
  const run = opts.complete ?? complete;
  const out = [];
  for (const node of nodes ?? []) {
    const parsed = parseJsonBlock(await run({ prompt: repairPrompt(node, detail), ...opts }));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.type) {
      const err = new Error('repair did not return a TypeSafe question');
      err.status = 502;
      throw err;
    }
    out.push(parsed);
  }
  return out;
}
