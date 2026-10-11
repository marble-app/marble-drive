#!/usr/bin/env node
// Write templates/lineage/<app>.json.gz: every version of each app page this
// repo has ever shipped, so a running host can tell which one a document was
// built from and bring it forward (server/app-updates.js).
//
// A release is a tarball with no git history, which is why the history is a
// file. Lines are stored once across versions, so twenty versions of the Drive
// cost little more than one.
//
//   node tools/app-lineage.mjs           rewrite every lineage from git + the working tree
//   node tools/app-lineage.mjs --check   exit 1 if any lineage is missing today's source
//
// Run it after changing a template or a starter that is listed in APPS, and
// commit the result with the change (test/app-lineage.test.js checks).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { APPS, LINEAGE_DIR, versionId } from '../server/app-lineage.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const check = process.argv.includes('--check');

let stale = 0;
for (const app of APPS) {
  const file = path.join(REPO, app.source);
  if (!fs.existsSync(file)) continue;
  const current = fs.readFileSync(file, 'utf8');
  const out = path.join(REPO, LINEAGE_DIR, `${app.id}.json.gz`);

  if (check) {
    const known = fs.existsSync(out) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(out))) : null;
    const last = known?.versions.at(-1);
    if (last?.id !== versionId(current)) {
      console.error(`${app.id}: ${app.source} has changed since its lineage was written`);
      stale++;
    }
    continue;
  }

  const sources = [];
  const seen = new Set();
  const add = (source, commit, date) => {
    const id = versionId(source);
    if (seen.has(id)) return;
    seen.add(id);
    sources.push({ id, commit, date, source });
  };
  for (const line of git('log', '--reverse', '--format=%H %cI', '--', app.source).trim().split('\n').filter(Boolean)) {
    const [commit, date] = line.split(' ');
    let source;
    try {
      source = git('show', `${commit}:${app.source}`);
    } catch {
      continue; // the commit that deleted it
    }
    add(source, commit.slice(0, 12), date);
  }
  // The working tree last, so a version not yet committed is still the newest.
  add(current, null, null);
  // What is shipping is always the last version, even when an older commit
  // happened to hold the same bytes.
  const now = versionId(current);
  sources.push(...sources.splice(sources.findIndex((s) => s.id === now), 1));

  const lines = [];
  const index = new Map();
  const versions = sources.map(({ id, commit, date, source }) => ({
    id,
    commit,
    date,
    lines: (source.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line) => {
      if (!index.has(line)) {
        index.set(line, lines.length);
        lines.push(line);
      }
      return index.get(line);
    }),
  }));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zlib.gzipSync(JSON.stringify({ app: app.id, source: app.source, lines, versions }), { level: 9 }));
  console.log(`${app.id.padEnd(11)} ${String(versions.length).padStart(3)} versions  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
if (stale) process.exit(1);
