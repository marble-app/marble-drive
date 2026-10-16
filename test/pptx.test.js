// test/pptx.test.js
// A PowerPoint dropped on the Drive becomes a deck of the drive's own: its
// slides in order, every box where its author put it, the text editable and
// still bold where it was bold, pictures and sound brought along, the notes
// under each slide, and a first line that says what did not come across.
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDrive } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { build } from '../server/gallery.js';
import { ledeFor, pptxToDeck } from '../server/pptx.js';
import { child, parseXml, textOf } from '../server/xml.js';
import { openZip } from '../server/zip.js';
import { BIG_PNG, makePptx, PNG, zipOf } from './fixtures/pptx.js';

const deckOf = async (buf = makePptx(), options = {}) =>
  pptxToDeck(buf, { starter: await build('slides', { name: 'Fixture' }), fileName: 'Fixture.pptx', ...options });

/** The slides of a deck, as the HTML of each <li>. */
const slidesOf = (source) => {
  const list = /<ol class="slides"[\s\S]*?<\/ol>/.exec(source)[0];
  return [...list.matchAll(/<li class="slide"[\s\S]*?<\/li>/g)].map((m) => m[0]);
};

test('a zip is read by entry, stored or deflated, from bytes or a file', async () => {
  const buf = zipOf({ 'a.xml': '<a>deflated</a>', 'b.png': PNG });
  const fromBytes = await openZip(buf);
  assert.deepEqual(fromBytes.names(), ['a.xml', 'b.png']);
  assert.equal((await fromBytes.read('a.xml')).toString(), '<a>deflated</a>');
  assert.deepEqual(await fromBytes.read('b.png'), PNG);
  await assert.rejects(fromBytes.read('c.xml'), /no "c.xml"/);
  await assert.rejects(fromBytes.read('a.xml', { limit: 4 }), /larger than 4 bytes/);

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-'));
  try {
    await fsp.writeFile(path.join(dir, 'x.zip'), buf);
    const fromFile = await openZip(path.join(dir, 'x.zip'));
    assert.equal((await fromFile.read('a.xml')).toString(), '<a>deflated</a>');
    await fromFile.close();
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
  await assert.rejects(openZip(Buffer.from('not a zip at all, just words')), /not a zip file/);
});

test('XML keeps text, entities and CDATA, and walks by prefixed name', () => {
  const root = parseXml('<?xml version="1.0"?><a:p x="1 &amp; 2"><a:t>Tom &amp; &#x4A;erry</a:t><a:br/><a:t><![CDATA[<raw>]]></a:t><!-- gone --></a:p>');
  assert.equal(root.name, 'a:p');
  assert.equal(root.attrs.x, '1 & 2');
  assert.equal(textOf(child(root, 'a:t')), 'Tom & Jerry');
  assert.equal(textOf(root), 'Tom & Jerry<raw>');
});

test('the slides come in the deck’s order, with their notes, from the Slides starter', async () => {
  const deck = await deckOf();
  assert.equal(deck.slides, 3);
  const slides = slidesOf(deck.source);
  assert.equal(slides.length, 3);
  assert.match(slides[0], /<span style="font-weight:300">Hello <\/span><span style="font-weight:700">world<\/span>/, 'Calibri Light is Calibri, light');
  assert.match(slides[1], /<img class="bx"/, 'the equation, as its fallback picture');
  assert.match(slides[2], /the source/);
  assert.match(slides[0], /<p class="notes" data-marble-id="[0-9a-f]{8}" data-marble-editable[^>]*>Say hello\.\nThen the rest &lt;slowly&gt;\.<\/p>/);
  // The starter is still the starter: its bar, its adder and its script.
  assert.match(deck.source, /class="btn play"/);
  assert.match(deck.source, /id="tpl-slide"/);
  assert.match(deck.source, /<title>Fixture<\/title>/);
});

test('every addressed part has an id of its own, and the master’s parts have none', async () => {
  const { source } = await deckOf();
  const ids = [...source.matchAll(/data-marble-id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'no id twice');
  const band = /<div class="bx" style="left:0%;top:96.111%[^"]*background:#4f81bd"><\/div>/;
  assert.equal(slidesOf(source).filter((s) => band.test(s)).length, 3, 'the master’s band is on every slide, with no id');
});

test('a placeholder takes its place from the layout or the master, and its type from the master’s styles', async () => {
  const [first] = slidesOf((await deckOf()).source);
  // The title: no xfrm on the slide or the layout, so the master's.
  assert.match(first, /data-marble-rich role="heading" aria-level="2" data-anchor="ctr" style="left:5%;top:5.34%;width:90%;height:22.222%/);
  // 44pt on a 720pt slide, in the master's major face.
  assert.match(first, /font-size:6.111cqi;color:#000000;font-family:&quot;Calibri Light&quot;/);
  // The body: the layout moved it; the slide halves its type to fit.
  assert.match(first, /style="left:10%;top:26.667%;width:80%;height:62.222%/);
  assert.match(first, /<p data-bu="•" style="padding-left:2.5cqi;text-indent:-2.5cqi;--bu-w:2.5cqi;font-size:1.944cqi/);
  assert.match(first, /<p data-bu="–" style="padding-left:7.5cqi[^"]*font-size:1.667cqi[^"]*">A smaller one<\/p>/);
  assert.match(first, /<p style="font-size:1.944cqi[^"]*">No bullet &amp; plain<\/p>/);
});

test('pictures are cropped as cropped, tables keep their look, and a group places its children', async () => {
  const [first, , third] = slidesOf((await deckOf()).source);
  assert.match(first, /<div class="bx crop" data-marble-id="[^"]+" style="left:70%;top:62.222%;width:20%;height:26.667%"><img alt="A red square" src="data:image\/png;base64,[^"]+" style="left:-12.5%;top:0%;width:125%;height:100%"><\/div>/);
  // PowerPoint's default table style: a header in the first accent, white and bold.
  assert.match(first, /<td data-marble-id="[^"]+" data-marble-rich style="[^"]*background:#4f81bd[^"]*"><p style="[^"]*color:#ffffff[^"]*font-weight:700">Year<\/p><\/td>/);
  assert.match(first, /background:#ffee00[^"]*"><p[^>]*>4.5%<\/p>/);
  // The oval is in a group scaled by half; its style fills it and makes its text white.
  assert.match(third, /data-anchor="ctr" style="left:20%;top:44.444%;width:10%;height:8.889%;background:#c0504d;border:0.278cqi solid #28415f;border-radius:50%/);
  assert.match(third, /color:#ffffff[^"]*">In a group<\/p>/);
  assert.match(third, /<path d="M0,914400 L457200,0 L914400,914400 Z" fill="#00aa55"\/>/);
  assert.match(third, /marker-end="url\(#m[0-9a-f]+\)"/);
  assert.match(third, /<span style="color:#0000ff;text-decoration:underline"><a href="https:\/\/example.com\/source" target="_blank" rel="noopener">the source<\/a><\/span>/);
});

test('a sound keeps its icon and plays from it; pictures and clips go wherever putBlob says', async () => {
  const put = [];
  const deck = await deckOf(makePptx({ picture: BIG_PNG }), {
    putBlob: async (bytes, type) => {
      put.push({ type, bytes: bytes.length });
      return `data-marble-blob="${'a'.repeat(63)}${put.length}" data-marble-type="${type}" src="x"`;
    },
  });
  assert.deepEqual(put.map((p) => p.type).sort(), ['audio/mpeg', 'image/png', 'image/png', 'image/png']);
  const [first] = slidesOf(deck.source);
  assert.match(first, /<div class="bx media" data-marble-id="[^"]+" role="button" aria-label="Play the sound" title="Play the sound" style="[^"]+"><audio preload="none" data-marble-blob="a+\d" data-marble-type="audio\/mpeg" src="x"><\/audio><\/div>/);
  assert.equal(deck.missing.find((m) => m.kind === 'sound'), undefined);
});

test('the first line says where the deck came from and what did not come across', async () => {
  const deck = await deckOf();
  assert.deepEqual(deck.missing, [{ kind: 'chart', slides: [1] }]);
  assert.deepEqual(deck.hidden, [3]);
  assert.match(deck.source, /<p class="lede"[^>]*>Made from Fixture.pptx. Not brought over: the chart on slide 1. Slide 3 was hidden in PowerPoint.<\/p>/);
  assert.equal(
    ledeFor({ fileName: 'Q3.pptx', missing: [{ kind: 'chart', slides: [2, 5] }, { kind: 'video', slides: [7] }], hidden: [] }),
    'Made from Q3.pptx. Not brought over: the charts on slides 2 and 5 and the video on slide 7.',
  );
  assert.equal(ledeFor({ fileName: 'Q3.pptx', missing: [], hidden: [] }), 'Made from Q3.pptx.');
});

test('a 4:3 deck says its shape; a 16:9 one leaves the starter’s', async () => {
  assert.match((await deckOf(makePptx({ width: 9144000, height: 6858000 }))).source, /<ol class="slides"[^>]*style="--ratio: 1.333">/);
  assert.doesNotMatch((await deckOf()).source, /--ratio:/);
});

test('something that is not a PowerPoint is refused by name', async () => {
  await assert.rejects(deckOf(zipOf({ 'word/document.xml': '<w:document/>' })), /not a PowerPoint file/);
  await assert.rejects(deckOf(Buffer.from('hello')), /not a zip file/);
});

// ----------------------------------------------------------------- the host

async function host(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'pptx-drive-'));
  const drive = await createDrive(loadConfig({ MARBLE_DRIVE_ROOT: root }), { log: { log() {}, error() {}, info() {} }, agents: false });
  t.after(async () => {
    await drive.close();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const port = await new Promise((r) => drive.server.listen(0, '127.0.0.1', () => r(drive.server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const upload = async (folder, name, body) =>
    (await fetch(`${base}/drive/upload-file?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`, { method: 'POST', body })).json();
  const slidesFrom = async (body) => {
    const res = await fetch(`${base}/drive/slides-from`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  return { drive, base, upload, slidesFrom };
}

test('the host makes a deck beside a PowerPoint in the drive, and puts the PowerPoint in the Trash', async (t) => {
  const { drive, base, upload, slidesFrom } = await host(t);
  await drive.store.mkdir('Talks');
  const put = await upload('Talks', 'Q3 Review (final).pptx', makePptx({ picture: BIG_PNG }));
  assert.equal(put.path, 'Talks/Q3 Review final.pptx');

  const made = await slidesFrom({ path: put.path });
  assert.equal(made.status, 200);
  assert.equal(made.body.path, 'Talks/Q3 Review final');
  assert.equal(made.body.slides, 3);
  assert.deepEqual(made.body.missing, [{ kind: 'chart', slides: [1] }]);

  const source = await drive.store.read('Talks/Q3 Review final');
  assert.match(source, /<title>Q3 Review final<\/title>/);
  // The big picture is a blob the page resolves; the 1x1 ones stay inline.
  const blob = /<img alt="A red square" data-marble-blob="([0-9a-f]{64})" data-marble-type="image\/png" src="data:image\/gif/.exec(source);
  assert.ok(blob, 'the big picture went to the blob store');
  assert.match(source, /src="data:image\/png;base64,/);
  assert.equal(await drive.store.hasFile('Talks/Q3 Review final.pptx'), false);
  assert.ok((await drive.store.listTrash()).some((e) => e.path === 'Talks/Q3 Review final.pptx'), 'the PowerPoint can be got back');

  // A clip is played by seeking into it, so a blob answers a range.
  const ranged = await fetch(`${base}/blob/${blob[1]}`, { headers: { Range: 'bytes=0-15' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), `bytes 0-15/${BIG_PNG.length}`);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), BIG_PNG.subarray(0, 16));
  const tail = await fetch(`${base}/blob/${blob[1]}`, { headers: { Range: 'bytes=-4' } });
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), BIG_PNG.subarray(-4));
  assert.equal((await fetch(`${base}/blob/${blob[1]}`, { headers: { Range: `bytes=${BIG_PNG.length}-` } })).status, 416);

  // Twice is two decks, not one overwritten.
  const again = await upload('Talks', 'Q3 Review (final).pptx', makePptx());
  const second = await slidesFrom({ path: again.path, keep: true });
  assert.equal(second.body.path, 'Talks/Q3 Review final 1');
  assert.ok(await drive.store.hasFile(again.path), '`keep` leaves the PowerPoint where it was');
});

test('a file that is not a PowerPoint, or not a readable one, is left as it came', async (t) => {
  const { drive, upload, slidesFrom } = await host(t);
  const song = await upload('', 'song.mp3', Buffer.from('ID3'));
  assert.equal((await slidesFrom({ path: song.path })).status, 400);
  const broken = await upload('', 'Broken.pptx', Buffer.from('this is not a zip'));
  const tried = await slidesFrom({ path: broken.path });
  assert.equal(tried.status, 400);
  assert.match(tried.body.error, /not a zip file/);
  assert.ok(await drive.store.hasFile('Broken.pptx'));
  assert.equal(await drive.store.has('Broken'), false);
  assert.equal((await slidesFrom({ path: 'Nowhere.pptx' })).status, 404);
});
