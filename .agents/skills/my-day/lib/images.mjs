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

// A real browser UA — Wikimedia and several CDNs 400/403 anything that looks
// like a bot. We are fetching public images for a personal page, one at a time.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

async function fetchTo(src, dest) {
  if (/^https?:\/\//i.test(src)) {
    let ref;
    try { ref = new URL(src).origin + '/'; } catch {}
    const res = await fetch(src, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
        ...(ref ? { Referer: ref } : {}),
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const type = res.headers.get('content-type') || '';
    const isPdf = /application\/pdf/i.test(type) || /\.pdf($|\?)/i.test(src) || /arxiv\.org\/pdf\//i.test(src);
    if (!isPdf && !/^image\//i.test(type) && !/\.(png|jpe?g|webp|gif)$/i.test(src)) {
      throw new Error(`not an image (${type})`);
    }
    const len = Number(res.headers.get('content-length') || 0);
    if (isPdf && len > 30 * 1024 * 1024) throw new Error(`pdf too large (${Math.round(len / 1e6)}MB)`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) throw new Error('too small');
    // sips renders page 1 of a PDF, which is exactly the paper screenshot we want.
    fs.writeFileSync(isPdf ? dest + '.pdf' : dest, buf);
    if (isPdf) fs.renameSync(dest + '.pdf', dest);
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
