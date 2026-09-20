// Fold the finished parts into the real document as two new elements: one
// <style data-marble-id="phone-style"> before </head> and one <script> before
// </body>. Everything else in the file is left byte-for-byte alone, so the
// diff a person reads is exactly "the document learned about phones".
//
// usage: node integrate.mjs [--dry] shell band columns cards
import fs from 'node:fs';
import path from 'node:path';

const DOC = '/Users/bryanmin/Development/3rd-year-projects/marble-drive/drive/Research/Research Vision Docs/Research Vision.mrbl';
const here = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const parts = args.filter(a => !a.startsWith('--'));

const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trimEnd() : '');

let css = '', js = '';
for (const p of parts) {
  const c = read(path.join(here, `ws-${p}`, 'part.css'));
  const j = read(path.join(here, `ws-${p}`, 'part.js'));
  if (c) css += `\n  /* ── ${p} ${'─'.repeat(Math.max(0, 62 - p.length))} */\n` + c.replace(/^/gm, '  ') + '\n';
  if (j) js += `\n/* ── ${p} ${'─'.repeat(Math.max(0, 64 - p.length))} */\n` + j + '\n';
}

const HEAD = `<style data-marble-id="phone-style">
  /* The document on a phone.

     Everything above this block describes a wide two-pane workspace: a rail
     that is always there, a band pinned across the top, a pool of three to six
     columns side by side. A phone has room for exactly one of those things at
     a time, so none of it is deleted here — it is re-laid-out, at one
     breakpoint, over the same elements.

     The breakpoint is asked of the container, not the window, for the same
     reason the rest of this file does it: a host that docks a panel beside the
     page shrinks <html> and leaves the viewport where it was, and a media
     query would go on insisting there is room that is no longer there.

     One rule underneath all of it: on a phone, content is the page and chrome
     is summoned. The eight views are this document's main verb, so they are
     the one piece of chrome that stays on screen — under the thumb, where
     tapping one visibly changes what you are reading. Everything else is a
     second-order dial and lives behind a disclosure. */
${css}
</style>
`;

const BODY = `<script>
/* The phone chrome's behaviour. Everything it creates is
   data-marble-transient: it belongs to the page, not to the file, so none of
   it is ever written back. Nothing here files an op, because none of it is a
   change to the document — it is a way of reading one. Every window.marble
   use is guarded, so the file still opens with no host at all. */
${js}
</script>
`;

let src = fs.readFileSync(DOC, 'utf8');
const beforeIds = (src.replace(/<script[\s\S]*?<\/script>/gi, '').match(/data-marble-id="/g) || []).length;

if (src.includes('data-marble-id="phone-style"')) {
  console.error('refusing: the document already has a phone-style block. Remove it first.');
  process.exit(1);
}
if (!src.includes('</head>') || !src.includes('</body>')) {
  console.error('refusing: could not find </head> or </body>.');
  process.exit(1);
}

src = src.replace('</head>', HEAD + '</head>');
src = src.replace('</body>', BODY + '</body>');

const afterIds = (src.replace(/<script[\s\S]*?<\/script>/gi, '').match(/data-marble-id="/g) || []).length;
console.log(`ids before ${beforeIds} → after ${afterIds} (+${afterIds - beforeIds}, expected +1 for phone-style)`);
console.log(`css ${css.split('\n').length} lines, js ${js.split('\n').length} lines`);

if (dry) { fs.writeFileSync(path.join(here, 'preview.mrbl'), src); console.log('dry run → preview.mrbl'); }
else { fs.writeFileSync(DOC, src); console.log('written:', DOC); }
