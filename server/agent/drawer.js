// Who draws a chat's progress.
//
// The card under a turn used to be a kit: a dozen views wired to tool names
// (a dot grid when a command looked like tests, an outline when apply_ops
// landed), and a strip of thumbnails of every view it had shown. The kit only
// knew the kinds of work it was built for, and its end state was a picture of
// pictures. So the drawing is now a model's: a second, small agent reads the
// turn's steps as they happen and answers with the widget as it should look
// right now. How it should draw is not in this file. It is a skill,
// agent-plugin/skills/drawing-progress/SKILL.md, read fresh before every
// draw, so changing how progress looks is an edit to that page, not a release.
//
// Each drawing is stored as a `progress.drawn` event on the turn, so a reload,
// the Widgets view and a phone all show the same latest drawing. Drawing never
// blocks or fails a turn: no CLI, no answer, a bad answer, and the card keeps
// what it had.

import fsp from 'node:fs/promises';
import path from 'node:path';

import { pickEnv } from './env.js';
import { scratch } from './namer.js';
import { runCommand } from './providers/exec.js';
import { PLUGIN_DIR } from './skills.js';

export const SKILL_PATH = path.join(PLUGIN_DIR, 'skills', 'drawing-progress', 'SKILL.md');

/** How often a running turn is redrawn. The first drawing waits for there to
 *  be something to draw; after that, a moment worth seeing (a test result, a
 *  change landing, a question) redraws sooner than a run of reads does. */
export const PACE = {
  firstMs: 4_000,
  gapMs: 20_000,
  momentMs: 8_000,
  /** Draws in flight across every chat on the host. */
  concurrent: 2,
};

const LOG_LINES = 70;
const ASK_MAX = 1_500;
const HTML_MAX = 40_000;

const trim = (text, n) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const tail = (p) => String(p ?? '').split('/').slice(-2).join('/');

/** One line for a step, in the words a reader of the log needs. */
export function stepLine(event) {
  const input = event.input ?? {};
  switch (event.type) {
    case 'tool.call': {
      const name = event.name;
      if (/^(Bash|Shell|shell)$/.test(name)) return `run: ${trim(input.command, 200)}${input.description ? ` (${trim(input.description, 80)})` : ''}`;
      if (name === 'apply_ops') {
        const kinds = [...new Set((input.ops ?? []).map((op) => op?.op).filter(Boolean))].join(', ');
        return `change page ${input.path}: ${(input.ops ?? []).length} ops (${kinds})${input.note ? ` — ${trim(input.note, 160)}` : ''}${(input.ops ?? []).slice(0, 3).map((op) => ` | ${trim(op?.html ?? op?.text ?? op?.value ?? '', 120)}`).join('')}`;
      }
      if (/^(Read|read_document)$/.test(name)) return `read ${tail(input.file_path ?? input.path)}`;
      if (/^(Edit|MultiEdit)$/.test(name)) return `edit ${tail(input.file_path)}${input.new_string ? `: ${trim(input.new_string, 120)}` : ''}`;
      if (name === 'Write') return `write ${tail(input.file_path)}`;
      if (/^(Grep|Glob)$/.test(name)) return `search for ${trim(input.pattern, 80)}`;
      if (name === 'WebFetch') return `open ${trim(input.url, 120)}`;
      if (/^(WebSearch|web_search)$/.test(name)) return `search the web: ${trim(input.query ?? input.search_term, 100)}`;
      if (name === 'TodoWrite' || name === 'updateTodos') {
        const todos = (input.todos ?? []).map((t) => `[${t.status ?? ''}] ${trim(t.content ?? t.text, 80)}`).join('; ');
        return `plan: ${todos}`;
      }
      if (name === 'create_document') return `make document ${input.path}`;
      if (name === 'Agent' || name === 'Task') return `hand off: ${trim(input.description ?? input.prompt, 120)}`;
      return `${name}: ${trim(JSON.stringify(input), 160)}`;
    }
    case 'tool.result': {
      const text = event.tail ? `${trim(event.summary, 160)} … ${trim(event.tail, 500)}` : trim(event.summary, 300);
      return `  → ${event.denied ? 'refused' : event.ok === false ? 'failed' : 'ok'}${text ? `: ${text}` : ''}`;
    }
    case 'text': return `says: ${trim(event.text, 400)}`;
    case 'ops.applied': return `  landed ${event.count} change(s) on ${event.path ?? 'the page'}`;
    case 'document.changed': return `  wrote ${event.path}`;
    case 'ask': return `asks the person: ${event.tool ?? ''} ${trim(JSON.stringify(event.input ?? {}), 200)}`;
    default: return '';
  }
}

/** A moment worth seeing sooner than the steady pace. */
const isMoment = (event, line) =>
  event.type === 'ops.applied'
  || event.type === 'ask'
  || event.type === 'document.changed'
  || (event.type === 'tool.call' && /^(TodoWrite|updateTodos|create_document)$/.test(event.name))
  || (event.type === 'tool.result' && /\b(pass|passed|fail|failed|tests?)\b/i.test(line));

export function drawPrompt({ ask, state, ran, lines, skipped, last }) {
  return [
    'The ask:',
    '"""',
    trim(ask, ASK_MAX) || '(nothing)',
    '"""',
    '',
    `State: ${state}, ${ran}.`,
    '',
    `Steps${skipped ? ` (the ${skipped} before these are left out)` : ''}:`,
    ...lines,
    '',
    last ? 'Last drawing:' : 'There is no drawing yet.',
    ...(last ? ['"""', last, '"""'] : []),
    '',
    `Answer with the widget's HTML as it should look now${state === 'working' ? '' : ', at the end of the turn'}.`,
    'Every name and number in it must be in the ask or the steps above. Anything not there yet is a hollow slot or "more to come", never a guessed name.',
  ].join('\n');
}

/** What a model answered, as a widget, or null. Fences and words around the
 *  markup are taken off. Script stays: it runs in the same sandbox as a
 *  chat visual, and one line of it beats fifteen hundred hand-written dots. */
export function cleanDrawing(raw) {
  let html = String(raw ?? '').trim();
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(html);
  if (fenced) html = fenced[1].trim();
  const first = html.search(/<(style|div|section|figure|p|ul|ol|svg|table|span|script|h[1-6])\b/i);
  if (first < 0) return null;
  html = html.slice(first);
  const last = html.lastIndexOf('>');
  html = html.slice(0, last + 1);
  html = html.replace(/<\/?(html|head|body)\b[^>]*>/gi, '').trim();
  if (!html || html.length > HTML_MAX) return null;
  return html;
}

// The fingernail: a side of a box inked 2 px or more thicker than the rest,
// as a border or as an inset shadow standing in for one. The skill says
// never, and Design Don'ts puts it first, but the drawer is a small model
// that still reaches for it to mark a note, so it is taken off here too.
const SIDE = /\bborder-(?:left|right|top|bottom|inline|block|inline-start|inline-end|block-start|block-end)(?:-width)?\s*:\s*([^;}"]*);?/gi;
const WIDTHS = /\bborder-width\s*:\s*([^;}"]*);?/gi;
const INSET = /\bbox-shadow\s*:\s*([^;}"]*);?/gi;

const px = (token) => {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(token);
  if (!m) return token === 'thick' ? 5 : token === 'medium' ? 3 : token === 'thin' ? 1 : null;
  return Math.abs(Number(m[1])) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1);
};
const thick = (value) => value.trim().split(/\s+/).some((t) => (px(t) ?? 0) >= 2);
const lopsided = (value) => {
  const w = value.trim().split(/\s+/).map(px);
  return w.length > 1 && !w.includes(null) && Math.max(...w) >= 2 && Math.min(...w) !== Math.max(...w);
};
// One layer of `inset X Y [blur …]` with one offset 2 px or more, the other 0,
// and no blur: a stripe. A ring (`inset 0 0 0 1px`) is not.
const stripe = (value) => value.split(/,(?![^(]*\))/).some((layer) => {
  const t = layer.trim().split(/\s+/);
  if (t[0] !== 'inset') return false;
  const [x, y, blur] = t.slice(1, 4).map(px);
  if (x == null || y == null) return false;
  return ((x >= 2) !== (y >= 2)) && Math.min(x, y) === 0 && !blur;
});

function nails(css, cut) {
  return css
    .replace(SIDE, (all, value) => (thick(value) ? cut(all) : all))
    .replace(WIDTHS, (all, value) => (lopsided(value) ? cut(all) : all))
    .replace(INSET, (all, value) => (stripe(value) ? cut(all) : all));
}

/** Whether markup or words carry a fingernail anywhere. */
export function hasFingernail(text) {
  let found = false;
  nails(String(text ?? ''), (all) => { found = true; return all; });
  return found;
}

/** The drawing with every fingernail in its styles taken off. Words are left
 *  alone; only `<style>` blocks and `style` attributes are read. */
export function unfingernail(html) {
  const cut = () => '';
  const off = (all, open, css, close) => open + nails(css, cut) + close;
  return String(html)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, off)
    .replace(/(\sstyle\s*=\s*")([^"]*)(")/gi, off)
    .replace(/(\sstyle\s*=\s*')([^']*)(')/gi, off);
}

const ran = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

/** Ask the CLI for a drawing. Null — never a throw — when there is none. */
export async function drawWithCli({ system, prompt, model = 'haiku', exec = runCommand, env = process.env, timeout = 45_000, log = console } = {}) {
  const cwd = await scratch();
  const args = [
    '-p',
    '--model', model,
    '--tools', '',
    '--setting-sources', 'project',
    '--system-prompt', system,
    '--output-format', 'text',
    '--', prompt,
  ];
  // No extended thinking: with it a drawing took fifty seconds and five
  // thousand tokens; without, seven seconds and a few hundred, and it looks
  // the same. A widget that arrives after the moment it shows is no widget.
  const result = await exec('claude', args, { timeout, env: { ...pickEnv(env), MAX_THINKING_TOKENS: '0' }, cwd });
  if (result.missing || result.aborted) return null;
  if (result.timedOut || result.code) {
    log.error?.(`[agents] drawing progress failed: ${result.timedOut ? 'timed out' : result.stderr?.trim() || `exit ${result.code}`}`);
    return null;
  }
  return cleanDrawing(result.stdout);
}

/** The skill without its front matter: the system prompt every draw gets. */
export async function readSkill(file = SKILL_PATH) {
  const text = await fsp.readFile(file, 'utf8');
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

/** Watches turns and redraws them. `draw({ system, prompt })` answers with a
 *  widget or null; `emit(turn, event)` stores and publishes. */
export function createDrawer({ draw, emit, skill = readSkill, pace = PACE, now = Date.now, log = console }) {
  const turns = new Map(); // turn id → what has been seen and drawn
  let busy = 0;
  const waiting = [];
  const slot = () => (busy < pace.concurrent ? (busy += 1, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve)));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else busy -= 1;
  };

  function stateOf(turn) {
    let s = turns.get(turn.id);
    if (!s) {
      s = { turn, lines: [], skipped: 0, calls: 0, html: null, timer: null, drawing: null, dirty: false, lastAt: 0, asking: false, ended: null, started: now() };
      turns.set(turn.id, s);
    }
    return s;
  }

  function schedule(s, wait) {
    if (s.ended) return;
    if (s.drawing) { s.dirty = true; return; }
    const at = Math.max(0, wait);
    if (s.timer && s.timerAt <= now() + at) return;
    clearTimeout(s.timer);
    s.timerAt = now() + at;
    s.timer = setTimeout(() => { s.timer = null; run(s, false); }, at);
    s.timer.unref?.();
  }

  async function run(s, final) {
    s.dirty = false;
    const state = final ? s.ended : s.asking ? 'asking' : 'working';
    const task = (async () => {
      await slot();
      try {
        const system = await skill();
        const prompt = drawPrompt({ ask: s.turn.prompt, state, ran: ran(now() - s.started), lines: s.lines, skipped: s.skipped, last: s.html });
        const drawn = await draw({ system, prompt });
        // Unless the work is a side border itself, drawn on its silhouette.
        const html = drawn && (hasFingernail(`${s.turn.prompt}\n${s.lines.join('\n')}`) ? drawn : unfingernail(drawn));
        // A running draw that comes back after the turn ended is stale; the
        // final one is on its way.
        if (!html || (s.ended && !final) || html === s.html) return;
        s.html = html;
        await emit(s.turn, { type: 'progress.drawn', html, state, ...(final ? { final: true } : {}) });
      } catch (err) {
        log.error?.(`[agents] drawing progress: ${err.message}`);
      } finally {
        release();
      }
    })();
    s.drawing = task;
    await task;
    s.drawing = null;
    s.lastAt = now();
    if (s.dirty && !s.ended) schedule(s, pace.gapMs);
  }

  return {
    /** A step of a running turn. */
    note(turn, event) {
      const line = stepLine(event);
      if (!line) return;
      const s = stateOf(turn);
      s.lines.push(line);
      if (s.lines.length > LOG_LINES) { s.skipped += s.lines.length - LOG_LINES; s.lines.splice(0, s.lines.length - LOG_LINES); }
      if (event.type === 'tool.call') s.calls += 1;
      if (event.type === 'ask') s.asking = true;
      if (event.type === 'tool.result' && s.asking) s.asking = false;
      // A turn that only answers in words gets no widget.
      if (!s.calls) return;
      const since = now() - s.lastAt;
      if (!s.lastAt && !s.html) schedule(s, pace.firstMs);
      else schedule(s, (isMoment(event, line) ? pace.momentMs : pace.gapMs) - since);
    },
    /** The turn is over: one last drawing, of how it ended. */
    async end(turn, status) {
      const s = turns.get(turn.id);
      if (!s) return;
      turns.delete(turn.id);
      clearTimeout(s.timer);
      s.ended = { completed: 'done', failed: 'failed', cancelled: 'stopped', interrupted: 'stopped' }[status] ?? 'done';
      if (s.drawing) await s.drawing.catch(() => {});
      if (!s.calls) return;
      await run(s, true);
    },
    get size() { return turns.size; },
  };
}
