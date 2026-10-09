#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { assert } = require("./node_harness"),
  { run: pack, manifest } = require("../scripts/package_release"),
  { unzip } = require("../scripts/zip");
function run(binary, target) {
  binary = path.resolve(binary);
  const archive = pack(binary, target),
    bytes = fs.readFileSync(archive),
    [checksum, filename] = fs
      .readFileSync(archive + ".sha256", "ascii")
      .trim()
      .split("  ");
  assert.equal(filename, path.basename(archive));
  assert.equal(
    checksum,
    crypto.createHash("sha256").update(bytes).digest("hex"),
  );
  // Verify executable permission bits used by Finder and Unix ZIP extractors.
  const permissions = new Map();
  let central = bytes.readUInt32LE(bytes.length - 6);
  while (bytes.readUInt32LE(central) === 0x02014b50) {
    const size = bytes.readUInt16LE(central + 28),
      extra = bytes.readUInt16LE(central + 30),
      comment = bytes.readUInt16LE(central + 32);
    const name = bytes
      .subarray(central + 46, central + 46 + size)
      .toString("utf8");
    permissions.set(name, bytes.readUInt32LE(central + 38) >>> 16);
    central += 46 + size + extra + comment;
  }
  assert(
    permissions.get(path.basename(binary)) & 0o111,
    "binary lost executable mode",
  );
  if (!target.toLowerCase().includes("windows"))
    assert(
      permissions.get("install.command") & 0o111,
      "Finder installer lost executable mode",
    );
  const members = unzip(bytes),
    expected = manifest(binary, target);
  for (const guide of [
    "AGENTS.md",
    "docs/README.md",
    "docs/agent-setup.md",
    "docs/agent-maintenance.md",
  ])
    assert(members.has(guide), "archive lacks Agent documentation: " + guide);
  assert.equal(members.size, expected.length);
  for (const e of expected)
    assert(
      members.get(e.name)?.equals(e.data),
      "archive bytes mismatch " + e.name,
    );
  assert(members.get(path.basename(binary)).equals(fs.readFileSync(binary)));
  assert(
    ![...members.keys()].some(
      (n) => n.endsWith(".py") && n !== "bridge/securecrt_bridge.py",
    ),
    "non-native Python leaked into bundle",
  );
  if (target.toLowerCase().includes("windows"))
    assert(
      ![...members.keys()].some((n) => n.endsWith(".py")),
      "Windows bundle contains Python",
    );
  for (const [name, data] of members)
    if (name.endsWith(".md"))
      for (const m of data
        .toString("utf8")
        .matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
        const link = m[1].split("#")[0];
        if (link && !link.includes("://") && !link.startsWith("mailto:")) {
          const dest = path.posix.normalize(
            path.posix.join(path.posix.dirname(name), link),
          );
          assert(
            members.has(dest),
            "archive link missing: " + name + " -> " + link,
          );
        }
      }
  console.log(
    "PASS: exact manifest/bytes/CRC/SHA256, no tool Python, platform adapter boundary, archive links",
  );
  return archive;
}
if (require.main === module)
  try {
    run(process.argv[2], process.argv[3] || "validation-native");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
module.exports = { run };
