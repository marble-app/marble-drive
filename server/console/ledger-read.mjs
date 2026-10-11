// Reading one drive's ledger: run on the sprite by the console (uploaded, then
// `node ledger-read.mjs <since>`), it prints every ledger line after `since`
// (unix seconds), one per line, and changes nothing. Plain Node, because it
// runs outside any release. Capped, so a drive that has not been read for a
// long time is caught up over several reads, oldest first.

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.env.MARBLE_PROBE_DRIVE || '/drive', '.marble', 'usage');
const since = Number(process.argv[2]) || 0;
const CAP = Number(process.env.MARBLE_LEDGER_CAP || 5000);
const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const from = new Date(since * 1000).toISOString().slice(0, 10);

let names = [];
try {
  names = fs.readdirSync(DIR).filter((n) => FILE.test(n) && FILE.exec(n)[1] >= from).sort();
} catch {}
let printed = 0;
const out = [];
for (const name of names) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(DIR, name), 'utf8');
  } catch {
    continue;
  }
  for (const raw of text.split('\n')) {
    if (!raw) continue;
    let t;
    try {
      t = JSON.parse(raw).t;
    } catch {
      continue;
    }
    if (!(t > since)) continue;
    out.push(raw);
    printed += 1;
    if (printed >= CAP) break;
  }
  if (printed >= CAP) break;
}
process.stdout.write(`${JSON.stringify({ ledger: out.length, more: printed >= CAP })}\n${out.join('\n')}${out.length ? '\n' : ''}`);
