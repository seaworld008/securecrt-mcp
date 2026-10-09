"use strict";
// Small dependency-free ZIP32 writer/reader. Binary bytes never pass through text or a shell.
const zlib = require("node:zlib"),
  assert = require("node:assert/strict");
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const parts = [],
    central = [];
  let offset = 0;
  for (const e of entries) {
    assert(
      !e.name.startsWith("/") && !e.name.split("/").includes(".."),
      "unsafe archive path",
    );
    const name = Buffer.from(e.name, "utf8"),
      data = Buffer.from(e.data),
      packed = zlib.deflateRawSync(data),
      crc = crc32(data),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    parts.push(header, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(0x314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(((e.mode || 0o100644) << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += header.length + name.length + packed.length;
  }
  assert(entries.length < 65536 && offset < 0xffffffff, "ZIP32 limit");
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
function unzip(bytes) {
  const members = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6),
      method = bytes.readUInt16LE(offset + 8),
      crc = bytes.readUInt32LE(offset + 14),
      packedLength = bytes.readUInt32LE(offset + 18),
      length = bytes.readUInt32LE(offset + 22),
      nameLength = bytes.readUInt16LE(offset + 26),
      extra = bytes.readUInt16LE(offset + 28),
      name = bytes
        .subarray(offset + 30, offset + 30 + nameLength)
        .toString("utf8");
    assert(!(flags & 8) && method === 8, "unsupported zip feature");
    assert(!members.has(name), "duplicate archive member");
    const start = offset + 30 + nameLength + extra,
      data = zlib.inflateRawSync(bytes.subarray(start, start + packedLength));
    assert.equal(data.length, length);
    assert.equal(crc32(data), crc, "CRC mismatch");
    members.set(name, data);
    offset = start + packedLength;
  }
  assert.equal(
    bytes.readUInt32LE(offset),
    0x02014b50,
    "missing central directory",
  );
  assert.equal(
    bytes.readUInt32LE(bytes.length - 22),
    0x06054b50,
    "missing ZIP end",
  );
  assert.equal(
    bytes.readUInt16LE(bytes.length - 12),
    members.size,
    "ZIP member count",
  );
  return members;
}
module.exports = { zip, unzip, crc32 };
