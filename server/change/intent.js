// A few words about the look of a page, as one rule (v5, Notes and
// Sketches/Ask at Anything, "How a change runs": Intent).
//
// "Round the corners" needs no agent: it is one value on every part of one
// kind. The line (runtime/change-line.js) tries its words here first when they
// sound like a look; a small model reads them beside an outline of the page
// (each kind of part as a selector, how many, and how the first of them looks)
// and answers with one selector and a few declarations, or with none. The page
// checks the rule again against what is really there before anything moves,
// and anything this cannot say as one rule goes to the agent as it was asked.
//
// The same plumbing as the callout's offer (server/agent/offer.js): the
// installed CLI on the login, never a key, no tools, a hard timeout, and no
// answer is not an error. The reply is untrusted input: one selector and only
// the properties below, or no rule at all.

import { pickEnv } from '../agent/env.js';
import { scratch } from '../agent/namer.js';
import { runCommand } from '../agent/providers/exec.js';

const WORDS_MAX = 300;
const OUTLINE_MAX = 40;
const FIELD_MAX = 120;
const SELECTOR_MAX = 300;
const VALUE_MAX = 120;
const DECLARATIONS_MAX = 6;
// The page waits as long, and no longer: an ask that is not a look (a dark
// mode, a new column) goes to the agent within this.
export const TIMEOUT = 6_000;

const SIDES = '(?:-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?';
/** What one rule may set: a look that the engine can turn, nothing that
 *  loads, lays out a page anew or hides a part. */
export const ALLOWED = new RegExp(`^(?:border-radius|padding${SIDES}|margin${SIDES}|gap|row-gap|column-gap|font-size|font-weight|line-height|letter-spacing|color|background-color|border-color|opacity)$`);
export const PROPERTIES = ['border-radius', 'padding', 'padding-*', 'margin', 'margin-*', 'gap', 'row-gap', 'column-gap', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color', 'border-color', 'opacity'];

// Characters that end a declaration or a rule, open markup, or start a
// comment or an at-rule: a value or a selector holding one could break out of
// the one rule it is written into.
const BREAKS = /[;{}<>!\\]|\/\*|@/;
const SELECTOR_BREAKS = /[;{}<]|\/\*|@|\n/;
const LOADS = /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|@import/i;

const field = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, FIELD_MAX);

export function intentPrompt({ words = '', outline = [], ids = [] }) {
  const parts = (Array.isArray(outline) ? outline : []).slice(0, OUTLINE_MAX).map((o) => {
    const look = [
      ['radius', o?.radius], ['padding', o?.padding], ['font-size', o?.fontSize],
      ['colour', o?.color], ['background', o?.background],
    ].filter(([, v]) => field(v)).map(([k, v]) => `${k} ${field(v)}`).join('; ');
    return `- ${field(o?.selector)} ×${Number(o?.count) || 1}${look ? `: ${look}` : ''}`;
  }).filter((line) => !line.startsWith('-  ×'));
  const scope = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && /^[\w-]{1,40}$/.test(id)).slice(0, 20);
  return [
    'Someone typed a few words about how a web page looks. Turn them into ONE CSS rule, or say there is none.',
    '',
    `Their words: "${String(words).replace(/\s+/g, ' ').trim().slice(0, WORDS_MAX)}"`,
    scope.length
      ? `They are about what is inside ${scope.map((id) => `[data-marble-id="${id}"]`).join(', ')} (inclusive). The selector must match nothing outside it.`
      : 'They are about the whole page.',
    '',
    'The kinds of part on the page, as selectors, how many there are, and how the first of each looks:',
    ...(parts.length ? parts : ['- (none listed)']),
    '',
    'Reply with ONLY a JSON object, no prose and no code fence:',
    '{"selector": "…", "declarations": {"property": "value"}, "unit": "…"}',
    '',
    `- selector: one CSS selector that matches exactly the parts the words are about, usually one of the selectors above${scope.length ? ', narrowed with the [data-marble-id="…"] it is inside' : ''}.`,
    `- declarations: one to six, using only these properties: ${PROPERTIES.join(', ')}. Plain values (px, em, numbers, colours, or the page's own var(--…)); no url().`,
    '- unit: the parts\' plural noun as a person would say it, e.g. "cards", "rows", "buttons".',
    '',
    'If the words ask for anything one rule with those properties cannot do (new content, a different layout, judgment part by part, a question), reply {"selector": null}.',
  ].join('\n');
}

const valueOf = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v || v.length > VALUE_MAX || BREAKS.test(v) || LOADS.test(v)) return null;
  return v;
};

/** The model's rule, or null when it is not one selector and a few allowed
 *  declarations. */
export function parseIntent(raw) {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const selector = typeof value.selector === 'string' ? value.selector.replace(/\s+/g, ' ').trim() : '';
  if (!selector || selector.length > SELECTOR_MAX || SELECTOR_BREAKS.test(selector)) return null;
  const given = value.declarations;
  if (!given || typeof given !== 'object' || Array.isArray(given)) return null;
  const entries = Object.entries(given);
  if (!entries.length || entries.length > DECLARATIONS_MAX) return null;
  const declarations = {};
  for (const [name, raw] of entries) {
    const prop = String(name).trim().toLowerCase();
    if (!ALLOWED.test(prop)) return null;
    const v = valueOf(raw);
    if (v === null) return null;
    declarations[prop] = v;
  }
  const unit = typeof value.unit === 'string' && /^[a-z][a-z -]{0,23}$/i.test(value.unit.trim()) ? value.unit.trim().toLowerCase() : 'parts';
  return { selector, declarations, unit, verb: verbOf(declarations) };
}

/** What the page is doing, from what the rule sets: never a word of the
 *  model's. The page says Squaring for a radius that goes down. */
export function verbOf(declarations) {
  const family = (prop) => {
    if (prop === 'border-radius') return 'Rounding';
    if (/^(?:padding|margin|gap|row-gap|column-gap|line-height|letter-spacing)/.test(prop)) return 'Spacing';
    if (prop === 'font-size') return 'Resizing';
    if (prop === 'font-weight') return 'Weighting';
    if (/color$/.test(prop)) return 'Recolouring';
    if (prop === 'opacity') return 'Fading';
    return 'Restyling';
  };
  const verbs = new Set(Object.keys(declarations ?? {}).map(family));
  return verbs.size === 1 ? [...verbs][0] : 'Restyling';
}

/** Ask the installed CLI. Returns null — never throws — without a rule. */
export async function readIntent({
  words = '',
  outline = [],
  ids = [],
  model = 'haiku',
  exec = runCommand,
  env = process.env,
  timeout = TIMEOUT,
  signal,
  log = console,
} = {}) {
  if (!String(words).trim()) return null;
  try {
    const ask = intentPrompt({ words, outline, ids });
    const cwd = await scratch();
    const result = await exec('claude', ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--output-format', 'text', '--', ask], {
      timeout, env: pickEnv(env), cwd, signal,
    });
    if (!result || result.aborted || result.missing) return null;
    if (result.timedOut || result.code) {
      log.error?.(`[agents] change intent failed: ${result.timedOut ? 'timed out' : result.stderr?.trim() || `exit ${result.code}`}`);
      return null;
    }
    return parseIntent(result.stdout);
  } catch (err) {
    log.error?.(`[agents] change intent failed: ${err?.message ?? err}`);
    return null;
  }
}
