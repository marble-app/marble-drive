// GET /health/study: what the probe study counts in a drive on the owner's PC,
// read from the drive's own logs and answered as numbers only (server/app.js;
// docs/HOSTING.md, "The study on each drive"). marble-host asks each study
// drive and its Console shows the answer; nothing anyone wrote is in it.
//
// A prompt is a `user` event in .marble/agents/<conversation>/events.jsonl.
// Not every one is the person's. One that another agent sent carries `from`,
// an automation running on its schedule begins "This is a scheduled run", and
// the "Continue" a chat sends itself when its plan runs out follows a
// `usage.continued`. Those are left out. Of the rest:
//
//   builds   "Build mode, build N:", a build started from marks on an app
//   marks    the marks those builds took, and marks sent into a build running
//   buttons  a press rather than words: the brief of a data-marble-run element
//            in one of the drive's documents, "The person pressed …", Build
//            mode's resume, and an action a selection drafts ("Try 3
//            variations of …", "Automate …:", "Make … alive:", the merge)
//
// and every other prompt was typed. `days` is how many days, in the drive's
// zone, hold a prompt. A turn runs from its `turn.started` to its end, or to
// what came next in its conversation if it has none; a prompt sent while a
// turn of another conversation ran was sent while another agent worked.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import { CONTINUE } from './agent/usage-failover.js';
import { localTime } from './daily.js';

const CONVERSATION = /^[0-9a-f]{12}$/;
// The only lines worth parsing; the rest are only looked at for their time.
const WANTED = /"type":"(?:user|turn\.(?:started|completed|failed|cancelled|interrupted)|usage\.continued)"/;
const STAMP = /"t":(\d+)/;
const ENDS = new Set(['turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted']);

const SCHEDULED = /^This is a scheduled run\b/;
const BUILD = /^Build mode, build \d+:/;
const STEER = /^More marks for this build \(build \d+\)/;
const RESUME = /^Build mode: build \d+ of "/;
const PRESSED = /^The person pressed\b/;
// The actions a selection offers, as they draft the ask (runtime/agent-offer.js,
// actionWords; runtime/agent-marks.js, Explore; runtime/collab.js, the merge).
const OFFERED = /^(?:Try \d+ variations of |Explore \d+ variations of |Merge these two versions |Automate (?:this|these) [^:\n]*: |Make (?:this|these) [^:\n]* (?:alive|interactive|visual): )/;
// How each kind of mark is put into words, one numbered line each
// (server/build/brief.js, phraseOf). test/health-study.test.js builds a brief
// with every kind, so a change of wording there fails here.
const MARK = /^(\d+)\. (?:The prompt the app was made from|Sent by the person to be made now|A note on|Ink sketched over|A box sketched around|An arrow sketched from|A part dragged on the app|A comment thread pinned to|A piece placed on)\b/;

// A document is read for its buttons' briefs. One bigger than this is all
// pictures, and has none worth the read.
const DOC_MAX = 16 * 1024 * 1024;
const RUN = /\sdata-marble-run\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const unescaped = (value) =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
const plain = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** How many marks a build's prompt carries: its numbered lines, in order,
 *  each in the words a mark is put in, outside the markup a piece brings. */
export function marksIn(text) {
  let n = 0;
  let fenced = false;
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line.startsWith('Also on the app, waiting') || line === 'How to build:') break;
    const mark = MARK.exec(line);
    if (mark && Number(mark[1]) === n + 1) n += 1;
  }
  return n;
}

/** Which of the person's prompts a prompt was: 'build', 'steer' (marks into
 *  a running build), 'button', or 'typed'. */
export function kindOf(text, briefs = new Set()) {
  const said = String(text ?? '').trimStart();
  if (BUILD.test(said)) return 'build';
  if (STEER.test(said)) return 'steer';
  if (RESUME.test(said) || PRESSED.test(said) || OFFERED.test(said) || briefs.has(plain(said))) return 'button';
  return 'typed';
}

/** Every document under the drive's root, never through a link or into a
 *  folder whose name starts with a dot. */
async function* documents(dir, depth = 0) {
  if (depth > 64) return;
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const here = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* documents(here, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.mrbl')) yield here;
  }
}

/** The briefs the drive's buttons carry today, as a pressed one sends them. */
export async function briefsIn(root) {
  const briefs = new Set();
  for await (const file of documents(root)) {
    const info = await fsp.stat(file).catch(() => null);
    if (!info || info.size > DOC_MAX) continue;
    const source = await fsp.readFile(file, 'utf8').catch(() => '');
    for (const match of source.matchAll(RUN)) {
      const brief = plain(unescaped(match[1] ?? match[2] ?? ''));
      if (brief) briefs.add(brief);
    }
  }
  return briefs;
}

/** One conversation's prompts and turns, read a line at a time. */
async function readConversation(file, id, briefs, prompts, turns) {
  let lastT = 0;
  let open = null;
  let continued = false;
  const close = (turn, at) => {
    if (turn && turn.end === null) turn.end = Math.max(turn.start, at);
  };
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    const stamp = STAMP.exec(line.slice(0, 80));
    if (stamp) lastT = Math.max(lastT, Number(stamp[1]));
    if (!WANTED.test(line)) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // a line still being written, or one torn by a crash
    }
    const t = Number(event.t) || lastT;
    if (event.type === 'usage.continued') {
      continued = true;
    } else if (event.type === 'user') {
      const automatic = Boolean(event.from) || SCHEDULED.test(String(event.text ?? '').trimStart()) || (continued && event.text === CONTINUE);
      continued = false;
      if (automatic) continue;
      const kind = kindOf(event.text, briefs);
      prompts.push({ t, id, kind, marks: kind === 'build' || kind === 'steer' ? marksIn(event.text) : 0 });
    } else if (event.type === 'turn.started' && event.turn) {
      // A turn of this conversation that never said it ended ended here.
      close(open, t);
      open = { id, start: t, end: null };
      turns.set(event.turn, open);
    } else if (ENDS.has(event.type) && event.turn) {
      const turn = turns.get(event.turn);
      if (turn) close(turn, t);
      if (turn === open) open = null;
    }
  }
  close(open, lastT);
}

/** The counts, from the logs as they are now. */
export async function countStudy({ root, zone = 'America/Los_Angeles', now = Date.now }) {
  const agents = path.join(root, '.marble', 'agents');
  const briefs = await briefsIn(root);
  const prompts = [];
  const turns = new Map();
  const entries = await fsp.readdir(agents, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !CONVERSATION.test(entry.name)) continue;
    const file = path.join(agents, entry.name, 'events.jsonl');
    const info = await fsp.lstat(file).catch(() => null);
    if (!info?.isFile()) continue;
    await readConversation(file, entry.name, briefs, prompts, turns);
  }

  const days = new Set();
  const perConversation = new Map();
  const running = [...turns.values()].filter((turn) => turn.end !== null);
  let builds = 0;
  let marks = 0;
  let buttons = 0;
  let whileAnother = 0;
  for (const prompt of prompts) {
    days.add(localTime(prompt.t, zone).date);
    perConversation.set(prompt.id, (perConversation.get(prompt.id) ?? 0) + 1);
    if (prompt.kind === 'build') builds += 1;
    if (prompt.kind === 'button') buttons += 1;
    marks += prompt.marks;
    if (running.some((turn) => turn.id !== prompt.id && turn.start <= prompt.t && prompt.t < turn.end)) whileAnother += 1;
  }
  return {
    ok: true,
    at: new Date(now()).toISOString(),
    days: days.size,
    prompts: prompts.length,
    builds,
    marks,
    buttons,
    conversations: perConversation.size,
    singlePromptConversations: [...perConversation.values()].filter((n) => n === 1).length,
    promptsWhileAnotherWorked: whileAnother,
  };
}

/** The counts, at most `keepMs` old (five minutes): a drive's whole history
 *  is read for each fresh answer. Asked twice at once, it is counted once. */
export function createStudyHealth({ root, zone, now = Date.now, keepMs = 5 * 60_000 }) {
  let kept = null;
  let asking = null;
  return {
    async read() {
      if (kept && now() - kept.at < keepMs) return kept.body;
      asking ??= countStudy({ root, zone, now })
        .then((body) => {
          kept = { at: now(), body };
          return body;
        })
        .finally(() => {
          asking = null;
        });
      return asking;
    },
  };
}
