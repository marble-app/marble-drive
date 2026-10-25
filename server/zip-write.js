// Writing a zip as it is sent, one entry at a time.
//
// The drive's export (server/export.js) is every document and file in a
// drive, and a drive can hold a recorded talk or an album of WAVs. So nothing
// here holds an entry whole unless it was handed one whole. An entry whose
// bytes arrive as a stream is written as they come: its CRC and sizes are
// counted on the way past and follow it in a data descriptor, and the
// directory at the end is written from what was counted. A reader that goes by
// the directory, as server/zip.js and every unzip do, reads it like any other.
//
//   Readable.from(zipStream(entries)).pipe(res)
//
// An entry is { name, modified } and one of:
//
//   folder: true             a folder; its name ends with a slash
//   data                     a Buffer or a string, there in full
//   chunks, size             a function giving an async iterable of Buffers,
//                            and the most bytes it will give, which decides
//                            whether the entry needs zip64 before its header
//                            is written
//
// with `deflate: true` to compress it (documents and text; a picture or a
// recording is compressed already). An entry handed over whole and not
// compressed is stored. One that streams is always deflated, at level 0 when
// it is not to be compressed, which is the bytes as they are in blocks of
// 64 KB: stored bytes give no sign of where they end, so an unzip that reads
// front to back (the Finder's) can't find the end of a stored entry whose size
// comes after it. Names are UTF-8. Zip64 is used for an entry that may pass
// 4 GB, and for the directory when the whole does or there are more than
// 65,535 entries; `{ zip64: true }` uses it for everything, which is how a test
// reads it without writing 4 GB.

import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

const deflateRaw = promisify(zlib.deflateRaw);

const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const LOCATOR = 0x07064b50;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
// Bit 3: the CRC and sizes come after the data. Bit 11: the name is UTF-8.
const STREAMED = 0x0008;
const UTF8 = 0x0800;
// What reading an entry needs: 2.0 for deflate and folders, 4.5 for zip64.
const NEEDS = 20;
const NEEDS64 = 45;
// Made on Unix, so the modes in the external attributes are read.
const MADE_BY = 3 << 8;
const FILE_MODE = 0o100644;
const FOLDER_MODE = 0o040755;
// An entry this big or bigger is written as zip64 from its header on. Below
// 4 GB, because a deflated entry can come out a little larger than it went in.
const ZIP64_AT = 0xf0000000;
const LEVEL = 6;

// zlib.crc32 came in Node 22.2; engines says 22.
const TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
export const crc32 = zlib.crc32 ?? ((data, value = 0) => {
  let c = ~value;
  for (let i = 0; i < data.length; i += 1) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
});

/** A time as the two DOS words a zip header holds: local time, two-second
 *  steps, 1980 to 2107. The exact time, in UTC, rides in the extra field. */
function dosTime(ms) {
  let d = new Date(Number.isFinite(ms) ? ms : 0);
  if (d.getFullYear() < 1980) d = new Date(1980, 0, 1);
  if (d.getFullYear() > 2107) d = new Date(2107, 11, 31, 23, 59, 58);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** The extended timestamp (0x5455): the modification time, in seconds since
 *  1970, which unzip and the Finder read in place of the DOS one. */
function stampField(ms) {
  const field = Buffer.alloc(9);
  field.writeUInt16LE(0x5455, 0);
  field.writeUInt16LE(5, 2);
  field.writeUInt8(1, 4);
  field.writeUInt32LE(Math.max(0, Math.min(MAX32, Math.floor((Number(ms) || 0) / 1000))), 5);
  return field;
}

/** The zip64 extra field (0x0001), with the eight-byte values given, in the
 *  order the format fixes: size, compressed size, where the header is. */
function zip64Field(values) {
  const field = Buffer.alloc(4 + 8 * values.length);
  field.writeUInt16LE(0x0001, 0);
  field.writeUInt16LE(8 * values.length, 2);
  values.forEach((value, i) => field.writeBigUInt64LE(BigInt(value), 4 + 8 * i));
  return field;
}

/** A streamed entry's bytes, deflated, with its CRC and both sizes counted
 *  into `tally` as they pass. */
async function* bytesOf(entry, tally) {
  const source = entry.chunks();
  const counted = new Transform({
    transform(chunk, _encoding, done) {
      tally.crc = crc32(chunk, tally.crc);
      tally.size += chunk.length;
      done(null, chunk);
    },
  });
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });
  // pipeline hands back its last stream, and tears every one of them down if
  // any fails or this stops reading: a reader that hangs up closes the file.
  const deflated = pipeline(Readable.from(source, { objectMode: false }), counted, zlib.createDeflateRaw({ level: entry.deflate ? LEVEL : 0 }), (err) => settle(err));
  for await (const chunk of deflated) {
    tally.packed += chunk.length;
    yield chunk;
  }
  const err = await finished;
  if (err) throw err;
}

export async function* zipStream(entries, { zip64: always = false } = {}) {
  let offset = 0;
  const records = [];
  const out = (buffer) => {
    offset += buffer.length;
    return buffer;
  };

  for await (const entry of entries) {
    const folder = Boolean(entry.folder);
    const name = Buffer.from(folder && !entry.name.endsWith('/') ? `${entry.name}/` : entry.name, 'utf8');
    if (name.length > MAX16) throw new Error(`a name in this zip is longer than ${MAX16} bytes`);
    const { time, date } = dosTime(entry.modified);
    const stamp = stampField(entry.modified);
    const start = offset;
    const tally = { crc: 0, size: 0, packed: 0 };

    // Whole in hand: compressed here, and the header says everything.
    let whole = null;
    if (!folder && entry.data !== undefined) {
      const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
      whole = entry.deflate ? await deflateRaw(raw, { level: LEVEL }) : raw;
      Object.assign(tally, { crc: crc32(raw), size: raw.length, packed: whole.length });
    }
    const streamed = !folder && whole === null;
    const method = streamed || (whole && entry.deflate) ? 8 : 0;
    const big = always || (whole ? Math.max(tally.size, tally.packed) >= ZIP64_AT : streamed && !(Number(entry.size) < ZIP64_AT));
    const flags = UTF8 | (streamed ? STREAMED : 0);

    const extra = Buffer.concat([...(big ? [zip64Field(streamed ? [0, 0] : [tally.size, tally.packed])] : []), stamp]);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(LOCAL, 0);
    head.writeUInt16LE(big ? NEEDS64 : NEEDS, 4);
    head.writeUInt16LE(flags, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(streamed ? 0 : tally.crc, 14);
    head.writeUInt32LE(big ? MAX32 : streamed ? 0 : tally.packed, 18);
    head.writeUInt32LE(big ? MAX32 : streamed ? 0 : tally.size, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(extra.length, 28);
    yield out(Buffer.concat([head, name, extra]));

    if (whole?.length) yield out(whole);
    if (streamed) {
      for await (const chunk of bytesOf(entry, tally)) yield out(chunk);
      if (!big && (tally.size >= MAX32 || tally.packed >= MAX32)) {
        throw new Error(`"${entry.name}" came out past 4 GB after its header said it would not`);
      }
      const descriptor = Buffer.alloc(big ? 24 : 16);
      descriptor.writeUInt32LE(DESCRIPTOR, 0);
      descriptor.writeUInt32LE(tally.crc, 4);
      if (big) {
        descriptor.writeBigUInt64LE(BigInt(tally.packed), 8);
        descriptor.writeBigUInt64LE(BigInt(tally.size), 16);
      } else {
        descriptor.writeUInt32LE(tally.packed, 8);
        descriptor.writeUInt32LE(tally.size, 12);
      }
      yield out(descriptor);
    }
    records.push({ name, flags, method, time, date, stamp, start, folder, big, ...tally });
  }

  // The directory: what each entry turned out to be, and where it starts.
  const at = offset;
  for (const r of records) {
    const wide = always || r.big;
    const sizes64 = wide || r.size >= MAX32 || r.packed >= MAX32;
    const start64 = always || r.start >= MAX32;
    const values = [...(sizes64 ? [r.size, r.packed] : []), ...(start64 ? [r.start] : [])];
    const extra = Buffer.concat([...(values.length ? [zip64Field(values)] : []), r.stamp]);
    const needs = values.length ? NEEDS64 : NEEDS;
    const head = Buffer.alloc(46);
    head.writeUInt32LE(CENTRAL, 0);
    head.writeUInt16LE(MADE_BY | needs, 4);
    head.writeUInt16LE(needs, 6);
    head.writeUInt16LE(r.flags, 8);
    head.writeUInt16LE(r.method, 10);
    head.writeUInt16LE(r.time, 12);
    head.writeUInt16LE(r.date, 14);
    head.writeUInt32LE(r.crc, 16);
    head.writeUInt32LE(sizes64 ? MAX32 : r.packed, 20);
    head.writeUInt32LE(sizes64 ? MAX32 : r.size, 24);
    head.writeUInt16LE(r.name.length, 28);
    head.writeUInt16LE(extra.length, 30);
    head.writeUInt16LE(0, 32);
    head.writeUInt16LE(0, 34);
    head.writeUInt16LE(0, 36);
    // The Unix mode in the high half; 0x10 is DOS's own word for a folder.
    head.writeUInt32LE((((r.folder ? FOLDER_MODE : FILE_MODE) << 16) | (r.folder ? 0x10 : 0)) >>> 0, 38);
    head.writeUInt32LE(start64 ? MAX32 : r.start, 42);
    yield out(Buffer.concat([head, r.name, extra]));
  }
  const length = offset - at;
  const count = records.length;

  const wide = always || count >= MAX16 || at >= MAX32 || length >= MAX32;
  if (wide) {
    const end64 = Buffer.alloc(56);
    end64.writeUInt32LE(END64, 0);
    end64.writeBigUInt64LE(44n, 4);
    end64.writeUInt16LE(MADE_BY | NEEDS64, 12);
    end64.writeUInt16LE(NEEDS64, 14);
    end64.writeUInt32LE(0, 16);
    end64.writeUInt32LE(0, 20);
    end64.writeBigUInt64LE(BigInt(count), 24);
    end64.writeBigUInt64LE(BigInt(count), 32);
    end64.writeBigUInt64LE(BigInt(length), 40);
    end64.writeBigUInt64LE(BigInt(at), 48);
    const where = offset;
    yield out(end64);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(LOCATOR, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(where), 8);
    locator.writeUInt32LE(1, 16);
    yield out(locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(always ? MAX16 : Math.min(count, MAX16), 8);
  end.writeUInt16LE(always ? MAX16 : Math.min(count, MAX16), 10);
  end.writeUInt32LE(always ? MAX32 : Math.min(length, MAX32), 12);
  end.writeUInt32LE(always ? MAX32 : Math.min(at, MAX32), 16);
  end.writeUInt16LE(0, 20);
  yield out(end);
}
