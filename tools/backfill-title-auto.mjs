#!/usr/bin/env node
// The chats that predate the namer.
//
// `titleAuto` marks a title this host wrote, and runner.js will only replace
// one that carries it. Every conversation created before the field existed
// has no `titleAuto` at all, which reads as falsy — so the namer treats a
// sixty-character slice of someone's prompt as a name they chose, and leaves
// it there forever. This walks those conversations once and tells the two
// apart on evidence rather than on a guess: a title that is character-for-
// character `fallbackTitle(<the first thing typed>)` was written by the
// placeholder path in store.js. Nothing else could have produced it. Any
// other title — including one shorter than the cut, or one from a prompt
// that has since been edited — is left alone, because the cost of being
// wrong is overwriting a name somebody chose.
//
//   node tools/backfill-title-auto.mjs                 # say what would change
//   node tools/backfill-title-auto.mjs --apply         # set the flag
//   node tools/backfill-title-auto.mjs --apply --name  # and ask for a title now
//
// `--apply` alone leaves the placeholder showing until each chat's next turn
// ends, which for a finished chat is never. `--name` closes that gap: it runs
// the same namer the host runs, over conversations that are not running, and
// writes the answer straight in.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { fallbackTitle, nameConversation } from '../server/agent/namer.js';

/** The same model the host would use, so a backfilled name and a live one
 *  come from the same place. */
const MODEL = process.env.MARBLE_DRIVE_AGENT_NAMING_MODEL || 'haiku';

/** The placeholder rule store.js used before the namer existed, kept verbatim
 *  from 73df69c^:server/agent/store.js:204. Most of the board was titled by
 *  this line, not by fallbackTitle: it took sixty raw characters, attachment
 *  markup, newlines and all. A backfill that only knows the current rule
 *  mistakes every one of those for a name somebody chose. */
const legacyTitle = (text) => String(text ?? '').trim().slice(0, 60);

/** Either rule having produced this exact string is proof enough: a person
 *  naming a chat does not land character-for-character on a slice of their
 *  own prompt. */
const isPlaceholder = (title, prompt) =>
  title === fallbackTitle(prompt) || title === legacyTitle(prompt);

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const alsoName = args.has('--name');
/** Naming spawns a CLI per chat. A few at a time, so a backfill of sixty does
 *  not fight the turns the person is actually running for the machine. */
const LANES = 3;

const dirArg = process.argv.slice(2).find((a) => a.startsWith('--dir='));
const root = path.resolve(dirArg ? dirArg.slice('--dir='.length) : 'drive/.marble/agents');

/** store.js writes beside and renames over; so does this, or a backfill
 *  interrupted halfway leaves a conversation with no meta at all. */
async function writeMeta(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fsp.rename(tmp, file);
}

/** `titleAuto` belongs next to `title`, the way createConversation writes it —
 *  a backfilled meta should be indistinguishable from a fresh one. */
function withTitleAuto(meta, value) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = v;
    if (k === 'title') out.titleAuto = value;
  }
  if (!('titleAuto' in out)) out.titleAuto = value;
  return out;
}

async function readEvents(id) {
  let text;
  try {
    text = await fsp.readFile(path.join(root, id, 'events.jsonl'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** What the namer would have been handed at the end of the first turn: the
 *  prompt, and the first few things the agent said back. */
function firstTurn(events) {
  const asked = events.find((e) => e.type === 'user');
  if (!asked) return null;
  const said = events
    .filter((e) => e.type === 'text' && e.text && (!asked.turn || e.turn === asked.turn))
    .slice(0, 4)
    .map((e) => String(e.text));
  return { prompt: String(asked.text ?? ''), reply: said.join('\n\n') };
}

const ids = (await fsp.readdir(root, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const eligible = [];
const skipped = { already: 0, running: 0, untitled: 0, noPrompt: 0, chosen: [] };

for (const id of ids) {
  let meta;
  try {
    meta = JSON.parse(await fsp.readFile(path.join(root, id, 'meta.json'), 'utf8'));
  } catch {
    continue;
  }
  if ('titleAuto' in meta) { skipped.already += 1; continue; }
  // Mid-turn, the host owns this meta and will write it again when the turn
  // ends. Two writers, one file, and the loser's change is gone.
  if (meta.running) { skipped.running += 1; continue; }
  if (!meta.title) { skipped.untitled += 1; continue; }
  const turn = firstTurn(await readEvents(id));
  if (!turn) { skipped.noPrompt += 1; continue; }
  if (!isPlaceholder(meta.title, turn.prompt)) {
    skipped.chosen.push({ id, title: meta.title });
    continue;
  }
  eligible.push({ id, meta, turn });
}

console.log(`${ids.length} conversations under ${root}`);
console.log(`  ${skipped.already} already carry titleAuto (nothing to do)`);
console.log(`  ${skipped.running} running right now (skipped: the host owns that meta)`);
if (skipped.untitled) console.log(`  ${skipped.untitled} have no title at all`);
if (skipped.noPrompt) console.log(`  ${skipped.noPrompt} have no user event to compare against`);
console.log(`  ${skipped.chosen.length} carry a title that is not the placeholder — left alone:`);
for (const c of skipped.chosen) console.log(`      ${c.id}  ${JSON.stringify(c.title)}`);
console.log(`  ${eligible.length} are placeholders the namer may replace`);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to set the flag, --apply --name to also title them now.');
  process.exit(0);
}

let flagged = 0;
for (const row of eligible) {
  await writeMeta(path.join(root, row.id, 'meta.json'), withTitleAuto(row.meta, true));
  flagged += 1;
}
console.log(`\nSet titleAuto on ${flagged} conversations.`);

if (!alsoName) {
  console.log('Each will be named at the end of its next turn.');
  process.exit(0);
}

let named = 0;
let failed = 0;
const queue = eligible.slice();
await Promise.all(
  Array.from({ length: LANES }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      let title = null;
      try {
        title = await nameConversation({ prompt: row.turn.prompt, reply: row.turn.reply, model: MODEL });
      } catch (err) {
        console.error(`  ${row.id}: ${err.message}`);
      }
      const file = path.join(root, row.id, 'meta.json');
      // Re-read: this chat may have started a turn, or been renamed, in the
      // seconds the model took. Its meta now outranks the copy we held.
      let fresh;
      try {
        fresh = JSON.parse(await fsp.readFile(file, 'utf8'));
      } catch {
        continue;
      }
      if (!title) {
        failed += 1;
        console.log(`  ${row.id}: no title (placeholder kept)`);
        continue;
      }
      if (!fresh.titleAuto || fresh.title !== row.meta.title) {
        console.log(`  ${row.id}: changed under us, left alone`);
        continue;
      }
      await writeMeta(file, { ...fresh, title, titleAuto: false });
      named += 1;
      console.log(`  ${row.id}: ${JSON.stringify(row.meta.title.slice(0, 40))} -> ${JSON.stringify(title)}`);
    }
  }),
);
console.log(`\nNamed ${named}. ${failed} kept their placeholder.`);
