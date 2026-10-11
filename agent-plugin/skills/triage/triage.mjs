#!/usr/bin/env node
// The triage skill's hands (SKILL.md beside this file says when and how).
//
//   node triage.mjs facts [--days 14]   read every chat, checkout, spec and
//                                       commit; write the facts and a first
//                                       grouping; print a summary
//   node triage.mjs board               print the board as last saved
//   node triage.mjs save <file>         check a board and save it; the Console
//                                       shows it within seconds
//
// Run from the drive (an agent's working directory), or pass --drive <dir>.
// The workshop's checkouts are where the Console says they are
// (.marble/console/features-config.json); --src overrides.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { collect, createFeatures } = await import(path.join(here, '..', '..', '..', 'server', 'console', 'features.js'));

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const verb = args[0];
const driveDir = path.resolve(flag('drive', process.cwd()));
const dir = path.join(driveDir, '.marble', 'console');

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function srcDir() {
  const given = flag('src');
  if (given) return path.resolve(given);
  try {
    const cfg = JSON.parse(await fsp.readFile(path.join(dir, 'features-config.json'), 'utf8'));
    if (cfg.src && (await exists(path.join(cfg.src, 'marble-drive', '.git')))) return cfg.src;
  } catch {}
  for (const guess of [process.env.MARBLE_DRIVE_CONSOLE_SRC, '/home/sprite/src', path.join(os.homedir(), 'Development', '3rd-year-projects')]) {
    if (guess && (await exists(path.join(guess, 'marble-drive', '.git')))) return guess;
  }
  throw new Error('no marble-drive checkout found: pass --src <the folder that holds marble-drive>');
}

if (!(await exists(path.join(driveDir, '.marble')))) {
  console.error(`triage: ${driveDir} is not a drive (no .marble). Run it from the drive, or pass --drive.`);
  process.exit(2);
}

const src = await srcDir();
const features = createFeatures({ dir, driveDir, src });

if (verb === 'facts') {
  const facts = await collect({ driveDir, src, days: Number(flag('days', 14)), cacheFile: path.join(dir, 'features-cache.json') });
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(features.files.factsFile, `${JSON.stringify(facts, null, 1)}\n`);
  const board = await features.board();
  console.log(JSON.stringify({
    facts: features.files.factsFile,
    board: features.files.boardFile,
    window: `${facts.days} days`,
    commits: facts.commits.length,
    worktreesWithWork: facts.worktrees.length,
    specs: facts.specs.length,
    chats: facts.chats.length,
    draftFeatures: facts.draft.features.length,
    looseChats: facts.draft.loose.length,
    savedFeatures: board.features.length,
    lastRead: board.readAt ? new Date(board.readAt).toISOString() : null,
  }, null, 2));
} else if (verb === 'board') {
  console.log(JSON.stringify(await features.board(), null, 2));
} else if (verb === 'save') {
  const file = args[1];
  if (!file) {
    console.error('triage: save needs the board file');
    process.exit(2);
  }
  try {
    const input = JSON.parse(await fsp.readFile(file, 'utf8'));
    const saved = await features.save(input, { by: flag('by') });
    console.log(`saved ${saved.features.length} features and ${saved.loose.length} unplaced chats to ${features.files.boardFile}`);
  } catch (err) {
    console.error(`triage: not saved: ${err.message}`);
    process.exit(1);
  }
} else {
  console.error('usage: triage.mjs facts [--days 14] | board | save <file> [--by <chat id>]');
  process.exit(2);
}
