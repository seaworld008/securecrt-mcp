#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { root, version } = require("./package_release");
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}
function run() {
  const source = fs.readFileSync(
    path.join(root, "bridge/securecrt_bridge.py"),
    "utf8",
  );
  assert.equal(
    source.match(/^BRIDGE_VERSION\s*=\s*['"]([^'"]+)['"]/m)[1],
    version(),
  );
  assert.equal(source.match(/^PROTOCOL_VERSION\s*=\s*(\d+)/m)[1], "2");
  assert(
    fs
      .readFileSync(path.join(root, "README.md"))
      .equals(fs.readFileSync(path.join(root, "README.zh-CN.md"))),
    "Chinese README mirror drift",
  );
  for (const name of ["README.md", "README.en.md", "CHANGELOG.md"])
    assert(
      fs.readFileSync(path.join(root, name), "utf8").includes(version()),
      name,
    );
  for (const file of [
    ...fs
      .readdirSync(root)
      .filter((n) => n.endsWith(".md"))
      .map((n) => path.join(root, n)),
    ...walk(path.join(root, "docs")).filter((n) => n.endsWith(".md")),
  ])
    for (const m of fs
      .readFileSync(file, "utf8")
      .matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (target && !target.includes("://") && !target.startsWith("mailto:"))
        assert(
          fs.existsSync(path.resolve(path.dirname(file), target)),
          file + ": broken local link " + target,
        );
    }
  console.log(
    "PASS: version/protocol, bilingual mirror, local documentation links",
  );
}
if (require.main === module)
  try {
    run();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
module.exports = { run };
