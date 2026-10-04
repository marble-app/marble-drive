// Fan out (v5, Notes and Sketches/Ask at Anything, "Where parallel work
// helps").
//
// Rounding corners needs no workers: one rule, everywhere. A label per row,
// an icon per item, a rewrite per paragraph each need judgment part by part,
// and those are the one place a change waits on a model. The agent writes one
// plan and splits the parts into shards; one worker per shard, at most four
// at once, is given the plan, its shard's brief and its shard's elements —
// nothing else of the page, no conversation, no tools — and answers with ops.
//
// A worker is untrusted. Its reply is `{"ops": […]}` and nothing else; every
// op must stay inside its shard (its ids and what is inside them) and write
// no script, and is then landed by `apply` (server/agent/tools.js) through
// the same path as apply_ops: repaired and validated against the document as
// it is, refused if a part changed after the worker was shown it, recorded
// for undo, said on the page. A shard that fails lands none of its ops and
// says why; the others still land, each as soon as its worker is done.
//
// The same plumbing as the callout's offer (server/agent/offer.js): the
// installed CLI on the login, never a key, a hard timeout for each worker,
// and the turn's own signal to stop all of them.

import { pickEnv } from '../agent/env.js';
import { scratch } from '../agent/namer.js';
import { runCommand } from '../agent/providers/exec.js';
import { subtreesOf } from '../agent/source.js';
import { parseSource } from '../engine.js';

export const CONCURRENCY = 4;
export const TIMEOUT = 120_000;
export const SHARDS_MIN = 2;
export const SHARDS_MAX = 8;
export const IDS_MAX = 24;
export const MODELS = ['haiku', 'sonnet'];
// The markup one worker is shown, whole: collectSlices' budget for a read,
// worked out from one parse of the page rather than one per id (a shard of 24
// ids on a 700 KB page would otherwise hold the host for most of a second).
const BUDGET = 12_000;
const PLAN_MAX = 4_000;
const BRIEF_MAX = 2_000;
const OPS_MAX = 24;
const WHY_MAX = 160;

const quote = (id) => `"${id}"`;

export function fanOutPrompt({ plan = '', brief = '', ids = [], markup = '' }) {
  const said = String(brief ?? '').trim();
  return [
    'You are one of several workers changing parts of a web page side by side. Every worker follows the same plan; you have only your own parts.',
    '',
    'The plan, for every part:',
    '"""',
    String(plan).trim(),
    '"""',
    ...(said ? ['', 'For your parts in particular:', '"""', said, '"""'] : []),
    '',
    'Your parts, as markup. data-marble-id is each element\'s address:',
    '"""',
    markup,
    '"""',
    '',
    `You may change only these elements: ${ids.map(quote).join(', ')}, and the elements inside them. Anything you insert or move must go inside them. An edit to anything else fails your whole reply, and none of it is used.`,
    '',
    'Reply with ONLY a JSON object, no prose and no code fence:',
    '{"ops": [ … ]}',
    '',
    'Each op is one of:',
    '{"type": "setText", "id": "…", "text": "…"} replaces an element\'s text (plain text, no markup)',
    '{"type": "setInner", "id": "…", "html": "…"} replaces what is inside an element',
    '{"type": "setAttr", "id": "…", "name": "…", "value": "…"} sets one attribute; a null value removes it',
    '{"type": "insert", "parentId": "…", "beforeId": "…" or null, "html": "…"} adds markup inside parentId, before beforeId or at its end',
    '{"type": "move", "id": "…", "parentId": "…", "beforeId": "…" or null} moves an element',
    '{"type": "remove", "id": "…"} removes an element',
    '',
    `- At most ${OPS_MAX} ops. Use the ids exactly as they are written above.`,
    '- New elements need no data-marble-id; each is given one. Never reuse an id that is already on the page.',
    '- No scripts, no on… attributes, no javascript: links.',
    '- Keep each part\'s look and structure unless the plan says to change them.',
    '- Leave out a part that needs no change. If none do, reply {"ops": []}.',
  ].join('\n');
}

/** A worker's ops, or null when its reply is anything but `{"ops": […]}`
 *  (one code fence round the whole of it is forgiven). Each op is only
 *  checked to be an op-shaped object here; what it does is checked later. */
export function readOps(raw) {
  let text = String(raw ?? '').trim();
  const fenced = /^```(?:json)?[ \t]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  if (!text.startsWith('{')) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'ops' || !Array.isArray(value.ops)) return null;
  const opShaped = (op) => op && typeof op === 'object' && !Array.isArray(op) && typeof op.type === 'string';
  return value.ops.every(opShaped) ? value.ops : null;
}

/** Why these are not a fan out, or null when they are. Nothing is run. */
function checkInput({ plan, shards, model }) {
  if (typeof plan !== 'string' || !plan.trim()) return 'a fan out needs a plan: what every part should become';
  if (plan.length > PLAN_MAX) return `the plan is ${plan.length} characters; keep it under ${PLAN_MAX}`;
  if (model !== undefined && model !== null && !MODELS.includes(model)) return `model is haiku or sonnet, not "${model}"`;
  if (!Array.isArray(shards) || shards.length < SHARDS_MIN || shards.length > SHARDS_MAX) {
    return `a fan out takes ${SHARDS_MIN} to ${SHARDS_MAX} shards, not ${Array.isArray(shards) ? shards.length : 'none'}; for fewer parts, use apply_ops`;
  }
  for (const [i, shard] of shards.entries()) {
    const ids = shard?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > IDS_MAX || !ids.every((id) => typeof id === 'string' && id)) {
      return `shard ${i + 1} needs 1 to ${IDS_MAX} ids`;
    }
    if (shard.brief !== undefined && shard.brief !== null && typeof shard.brief !== 'string') return `shard ${i + 1}'s brief is not text`;
    if ((shard.brief ?? '').length > BRIEF_MAX) return `shard ${i + 1}'s brief is over ${BRIEF_MAX} characters`;
  }
  return null;
}

/** Why these shards do not fit this page — an id it does not have, or two
 *  shards that share a part — or null. */
function checkShards(lists, subtrees) {
  for (const [i, ids] of lists.entries()) {
    const absent = ids.find((id) => !subtrees[i].parts.has(id));
    if (absent !== undefined) return `no element with id "${absent}" in the document (shard ${i + 1})`;
    for (const id of ids) {
      const j = subtrees.findIndex(({ parts }, k) => k !== i && parts.has(id));
      if (j === -1) continue;
      return lists[j].includes(id)
        ? `"${id}" is in shard ${i + 1} and in shard ${j + 1}: give each part to one shard`
        : `"${id}" (shard ${i + 1}) is inside shard ${j + 1}: shards must not overlap`;
    }
  }
  return null;
}

/** Every id an op addresses: what it changes, and where it puts things. */
export const targetsOf = (op) => ['id', 'parentId', 'beforeId']
  .filter((field) => op?.[field] !== undefined && op?.[field] !== null)
  .map((field) => op[field]);

// What would run something, or load a page into this one, when the document
// is opened: the agent may write it, a worker may not. Read as a browser
// reads it — parsed, entities decoded, a table row in a table, an svg's
// insides as an svg's — not matched as text, which is spelled around in a
// dozen ways.
const RUNS_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'base', 'meta']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'srcdoc', 'data', 'poster', 'background', 'ping', 'to', 'from', 'values']);
// A URL is read with every control character and space taken out (a browser
// drops tabs and newlines anywhere in one, and both ends' controls).
const RUNS_URL = /^(?:javascript:|vbscript:|data:text\/html)/i;
const runsAsUrl = (value) => RUNS_URL.test(String(value ?? '').replace(/[\u0000-\u0020\u007f-\u009f]/g, ''));
const runsAttr = (name, value) => /^on/i.test(name) || (URL_ATTRS.has(name.toLowerCase()) && runsAsUrl(value));

// Elements whose insides a page reads as text. Text with a tag in it is
// markup as soon as the element sits in an <svg> or <math>, where these are
// elements like any other and an <img> inside them breaks out to the page.
const RAW_TEXT = new Set(['style', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'noscript', 'plaintext', 'iframe', 'script']);
// Every place the markup can land, as a browser would parse it there: the
// page (inside a <template>, rows and cells keep their own tags and
// attributes instead of being dropped), an <svg>, and <math>.
const CONTEXTS = [
  (html) => `<!doctype html><template>${html}</template>`,
  (html) => `<!doctype html><svg>${html}</svg>`,
  (html) => `<!doctype html><math>${html}</math>`,
];
const textOf = (node) => (node.childNodes ?? []).map((child) => (child.nodeName === '#text' ? child.value : textOf(child))).join('');

function markupRuns(html) {
  const runs = (node) => {
    for (const child of [...(node.childNodes ?? []), ...(node.content ? [node.content] : [])]) {
      const tag = child.tagName?.toLowerCase();
      if (tag && RUNS_TAGS.has(tag)) return true;
      if (tag && RAW_TEXT.has(tag) && textOf(child).includes('<')) return true;
      for (const attr of child.attrs ?? []) {
        if (runsAttr(attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name, attr.value)) return true;
      }
      if (runs(child)) return true;
    }
    return false;
  };
  return CONTEXTS.some((wrap) => runs(parseSource(wrap(html))));
}

function writesScript(op, parts) {
  // A script already on the page is run by what it holds and where it is
  // loaded from: a worker changes neither.
  if (op.id && parts.get(op.id)?.tag === 'script' && op.type !== 'remove' && op.type !== 'move') return true;
  if (op.type === 'setAttr') return runsAttr(String(op.name ?? ''), op.value);
  if (typeof op.html === 'string') return markupRuns(op.html);
  return false;
}

const firstLine = (text) => String(text ?? '').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, WHY_MAX) ?? '';

/**
 * Run one worker per shard, at most `concurrency` at once, and hand each
 * checked reply to `apply(shardIndex, ops, { known })` as soon as it is in:
 * `known` is what the worker was shown, id → hash, and an `apply` that finds
 * one of those changed refuses the shard. `apply` answers `{ applied }` or
 * `{ error }`. `onFailed(shardIndex, ids, error, { inside })` hears each shard
 * that fails (not one stopped by `signal`); `inside` is each of its ids → the
 * ids at or inside it. Never throws.
 *
 * Returns `{ applied, shards: [{ ids, applied, error? }] }`; `error` alone
 * when the shards are not a fan out; `missing: true` when there is no
 * `claude` to run.
 */
export async function runFanOut({
  source,
  docPath = '',
  plan,
  note = '',
  shards,
  model,
  exec = runCommand,
  env = process.env,
  signal,
  apply,
  onFailed = null,
  timeout = TIMEOUT,
  concurrency = CONCURRENCY,
  log = console,
} = {}) {
  const wrong = checkInput({ plan, shards, model });
  if (wrong) return { error: wrong, applied: 0, shards: [] };
  const lists = shards.map((shard) => [...new Set(shard.ids)]);
  // Each shard's elements and everything inside them, with what each is now:
  // what its worker is shown, what it may touch, and what it saw.
  const subtrees = subtreesOf(source, lists);
  const clash = checkShards(lists, subtrees);
  if (clash) return { error: clash, applied: 0, shards: [] };

  let cwd;
  try {
    cwd = await scratch();
  } catch (err) {
    return { error: `the workers have nowhere to run: ${err.message}`, applied: 0, shards: [] };
  }
  const results = lists.map((ids) => ({ ids, applied: 0 }));
  const stopped = () => Boolean(signal?.aborted);
  let missing = false;

  const fail = (k, error, { said = true } = {}) => {
    results[k].error = error;
    if (!said) return;
    try {
      onFailed?.(k, results[k].ids, error, { inside: subtrees[k].inside });
    } catch (err) {
      log.error?.(`[agents] fan out could not say shard ${k + 1} failed: ${err.message}`);
    }
  };

  async function work(k) {
    const ids = lists[k];
    if (stopped()) return fail(k, 'stopped', { said: false });
    if (missing) return fail(k, 'the claude CLI is not installed here', { said: false });

    // Only the shard's own elements, and only whole: a worker shown an
    // outline would be rewriting what it never read.
    const { parts, top } = subtrees[k];
    const markup = top.map((id) => parts.get(id).html).join('\n\n');
    if (markup.length > BUDGET) return fail(k, `too big to show a worker whole (${markup.length} characters; at most ${BUDGET}): use smaller shards, or apply_ops`);
    const known = new Map([...parts].map(([id, part]) => [id, part.hash]));

    const ask = fanOutPrompt({ plan, brief: shards[k].brief ?? '', ids, markup });
    let result;
    try {
      // No tools, and no MCP server of the login's either: a worker can only
      // answer.
      result = await exec('claude', ['-p', '--model', model ?? 'sonnet', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--output-format', 'text', '--', ask], {
        timeout, env: pickEnv(env), cwd, signal,
      });
    } catch (err) {
      result = { code: null, error: err.message };
    }
    if (result?.missing) {
      missing = true;
      return fail(k, 'the claude CLI is not installed here', { said: false });
    }
    if (result?.aborted || stopped()) return fail(k, 'stopped', { said: false });
    if (result?.timedOut) return fail(k, `took longer than ${Math.round(timeout / 1000)} s`);
    if (!result || result.code || result.error) {
      const why = firstLine(result?.stderr) || firstLine(result?.error) || `exit ${result?.code}`;
      log.error?.(`[agents] fan out worker for ${docPath} (${note || 'no note'}) failed: ${why}`);
      return fail(k, `the worker failed: ${why}`);
    }

    const ops = readOps(result.stdout);
    if (!ops) return fail(k, 'its reply was not {"ops": […]}');
    if (ops.length > OPS_MAX) return fail(k, `${ops.length} ops is more than ${OPS_MAX}: use smaller shards`);
    const outside = ops.flatMap(targetsOf).find((id) => !parts.has(id));
    if (outside !== undefined) return fail(k, `edited outside its shard (${quote(outside)})`);
    if (ops.some((op) => writesScript(op, parts))) return fail(k, 'wrote a script, which a worker may not');
    // Done after the stop: nobody is waiting for it any more.
    if (stopped()) return fail(k, 'stopped', { said: false });

    let landed;
    try {
      landed = await apply(k, ops, { known });
    } catch (err) {
      landed = { error: err.message };
    }
    // Refused because the turn stopped while the batch waited its turn: a
    // stop, not a failure.
    if (landed?.error) return fail(k, landed.error, { said: !stopped() });
    results[k].applied = landed?.applied ?? 0;
  }

  let next = 0;
  const lane = async () => {
    while (next < lists.length) await work(next++);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, lists.length) }, lane));

  const applied = results.reduce((sum, shard) => sum + shard.applied, 0);
  return { applied, shards: results, ...(missing ? { missing: true } : {}) };
}
