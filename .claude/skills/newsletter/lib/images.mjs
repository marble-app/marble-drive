#!/usr/bin/env node
// images.mjs — turn a picture into a data: URI the newsletter can carry.
//
// The doc is `net=none`, so an external <img src> never loads. Anything visual
// has to be inlined. This fetches (URL) or reads (path), downscales with `sips`
// to a sane width, re-encodes as JPEG, and prints a `data:image/jpeg;base64,…`.
//
//   images.mjs <url|path> [--width 480] [--max-kb 90] [--quiet]
//
// Fails soft: on any error it prints nothing and exits 0, so a caller can do
//   IMG=$(node lib/images.mjs "$url") ; [ -n "$IMG" ] && ...
// Batch form for build.mjs:
//   images.mjs --batch <json-file>
//     json: [{ "key": "...", "src": "url-or-path", "width": 480 }]
//   prints { "<key>": "data:...", ... }  (missing key = failed, omitted)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    flags[a.slice(2)] = v;
  } else pos.push(a);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-img-'));
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

async function fetchTo(src, dest) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, {
      headers: { 'User-Agent': 'bryans-bulletin/1.0', Accept: 'image/*' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/^image\//i.test(type) && !/\.(png|jpe?g|webp|gif)$/i.test(src)) {
      throw new Error(`not an image (${type})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error('too small');
    fs.writeFileSync(dest, buf);
  } else {
    if (!fs.existsSync(src)) throw new Error('no file');
    fs.copyFileSync(src, dest);
  }
}

function toDataUri(infile, width, maxKb) {
  const stem = path.join(TMP, 'o-' + crypto.randomBytes(4).toString('hex'));
  const out = stem + '.jpg';
  // sips: normalize to JPEG, cap the long edge. Second pass if still heavy.
  execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', String(width), infile, '--out', out], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let buf = fs.readFileSync(out);
  if (buf.length > maxKb * 1024) {
    const out2 = stem + '-2.jpg';
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '45',
      '-Z', String(Math.round(width * 0.8)), infile, '--out', out2],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    buf = fs.readFileSync(out2);
  }
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function one(src, width, maxKb) {
  const raw = path.join(TMP, 'in-' + crypto.randomBytes(4).toString('hex'));
  await fetchTo(src, raw);
  return toDataUri(raw, width, maxKb);
}

const width = Number(flags.width || 480);
const maxKb = Number(flags['max-kb'] || 90);

try {
  if (flags.batch) {
    const jobs = JSON.parse(fs.readFileSync(flags.batch, 'utf8'));
    const out = {};
    for (const job of jobs) {
      try {
        out[job.key] = await one(job.src, Number(job.width || width), maxKb);
      } catch (e) {
        if (!flags.quiet) console.error(`[images] ${job.key}: ${e.message}`);
      }
    }
    console.log(JSON.stringify(out));
  } else {
    if (!pos[0]) { console.error('usage: images.mjs <url|path> [--width N] [--max-kb N] | --batch <file>'); process.exit(1); }
    const uri = await one(pos[0], width, maxKb);
    process.stdout.write(uri);
  }
} catch (e) {
  if (!flags.quiet) console.error(`[images] ${e.message}`);
  // soft fail: no output, exit 0
}
