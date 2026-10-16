// Reading a zip without unpacking it.
//
// A PowerPoint file is a zip of XML and pictures, and so is everything else
// Office writes. The host only ever wants a few entries out of one — the
// slides' XML and the pictures they name — and a deck with its talk recorded
// into it can be a gigabyte of sound nobody asked for. So this reads the
// central directory at the end of the file, and then only the entries asked
// for, by offset, from a file handle or a buffer. Nothing is extracted to disk.
//
//   const zip = await openZip(pathOrBuffer)
//   zip.names()              → every entry, in the order the directory lists them
//   zip.has(name)            → boolean
//   zip.size(name)           → its size once inflated, as the directory says
//   await zip.read(name)     → Buffer, inflated; refused above `limit`
//   await zip.close()
//
// Stored and deflated entries are read; anything else (a deflate64, an
// encrypted entry) is refused by name rather than read as garbage. Zip64 is
// followed for the directory and the sizes, because a long recording pushes a
// deck past four gigabytes more often than anyone expects.

import fsp from 'node:fs/promises';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

// Off the event loop: a deck's recorded talk is tens of megabytes to inflate,
// and the host has pages to answer while it does.
const inflateRaw = promisify(zlib.inflateRaw);

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX32 = 0xffffffff;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** Random access over a buffer or a file, the same two calls either way. */
async function sourceOf(input) {
  if (Buffer.isBuffer(input)) {
    return {
      size: input.length,
      read: async (at, length) => input.subarray(at, Math.min(input.length, at + length)),
      close: async () => {},
    };
  }
  const handle = await fsp.open(input, 'r');
  const { size } = await handle.stat();
  return {
    size,
    read: async (at, length) => {
      const buf = Buffer.alloc(Math.max(0, Math.min(length, size - at)));
      if (!buf.length) return buf;
      const { bytesRead } = await handle.read(buf, 0, buf.length, at);
      return buf.subarray(0, bytesRead);
    },
    close: () => handle.close(),
  };
}

/** The end of central directory record: the last thing in a zip, followed by
 *  a comment of up to 64 KB, so it is looked for backwards from the end. */
async function findEnd(src) {
  const span = Math.min(src.size, 22 + 0xffff);
  const tail = await src.read(src.size - span, span);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD) continue;
    const at = src.size - span + i;
    let count = tail.readUInt16LE(i + 10);
    let length = tail.readUInt32LE(i + 12);
    let offset = tail.readUInt32LE(i + 16);
    if (offset === MAX32 || length === MAX32 || count === 0xffff) {
      const locator = await src.read(at - 20, 20);
      if (locator.length === 20 && locator.readUInt32LE(0) === EOCD64_LOCATOR) {
        const end64 = await src.read(Number(locator.readBigUInt64LE(8)), 56);
        if (end64.readUInt32LE(0) !== EOCD64) throw fail('this zip’s directory is damaged');
        count = Number(end64.readBigUInt64LE(32));
        length = Number(end64.readBigUInt64LE(40));
        offset = Number(end64.readBigUInt64LE(48));
      }
    }
    return { count, length, offset };
  }
  throw fail('not a zip file');
}

/** Sizes and offsets that did not fit in 32 bits are in the zip64 extra
 *  field, in this order, and only the ones that overflowed are there. */
function zip64(extra, entry) {
  for (let i = 0; i + 4 <= extra.length; ) {
    const tag = extra.readUInt16LE(i);
    const size = extra.readUInt16LE(i + 2);
    if (tag === 0x0001) {
      let at = i + 4;
      const next = () => {
        const value = Number(extra.readBigUInt64LE(at));
        at += 8;
        return value;
      };
      if (entry.size === MAX32) entry.size = next();
      if (entry.packed === MAX32) entry.packed = next();
      if (entry.offset === MAX32) entry.offset = next();
      return;
    }
    i += 4 + size;
  }
}

export async function openZip(input) {
  const src = await sourceOf(input);
  try {
    const end = await findEnd(src);
    const dir = await src.read(end.offset, end.length);
    const entries = new Map();
    let at = 0;
    for (let n = 0; n < end.count && at + 46 <= dir.length; n++) {
      if (dir.readUInt32LE(at) !== CENTRAL) throw fail('this zip’s directory is damaged');
      const flags = dir.readUInt16LE(at + 8);
      const nameLength = dir.readUInt16LE(at + 28);
      const extraLength = dir.readUInt16LE(at + 30);
      const commentLength = dir.readUInt16LE(at + 32);
      const nameBytes = dir.subarray(at + 46, at + 46 + nameLength);
      // Bit 11 says the name is UTF-8; without it, it is the old DOS page,
      // which for the ASCII names Office writes is the same thing.
      const name = nameBytes.toString(flags & 0x800 ? 'utf8' : 'latin1');
      const entry = {
        name,
        encrypted: Boolean(flags & 1),
        method: dir.readUInt16LE(at + 10),
        packed: dir.readUInt32LE(at + 20),
        size: dir.readUInt32LE(at + 24),
        offset: dir.readUInt32LE(at + 42),
      };
      zip64(dir.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength), entry);
      entries.set(name, entry);
      at += 46 + nameLength + extraLength + commentLength;
    }

    async function read(name, { limit = 256 * 1024 * 1024 } = {}) {
      const entry = entries.get(name);
      if (!entry) throw fail(`no "${name}" in this zip`, 404);
      if (entry.encrypted) throw fail(`"${name}" is encrypted`);
      if (entry.size > limit) throw fail(`"${name}" is larger than ${limit} bytes`);
      const local = await src.read(entry.offset, 30);
      if (local.length < 30 || local.readUInt32LE(0) !== LOCAL) throw fail(`"${name}" is damaged`);
      const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const packed = await src.read(start, entry.packed);
      if (entry.method === 0) return packed;
      if (entry.method === 8) {
        // The directory's size is a claim; the limit is held against what
        // actually comes out, so a lying entry cannot inflate past it.
        return inflateRaw(packed, { maxOutputLength: Math.max(limit, 1) });
      }
      throw fail(`"${name}" is compressed in a way this host does not read (method ${entry.method})`);
    }

    return {
      names: () => [...entries.keys()],
      has: (name) => entries.has(name),
      size: (name) => entries.get(name)?.size ?? 0,
      read,
      close: () => src.close(),
    };
  } catch (err) {
    await src.close().catch(() => {});
    throw err;
  }
}
