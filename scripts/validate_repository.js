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
      .equals(fs.readFileSync(path.join(root, "README.en.md"))),
    "English README mirror drift",
  );
  for (const name of [
    "README.md",
    "README.en.md",
    "README.zh-CN.md",
    "CHANGELOG.md",
  ])
    assert(
      fs.readFileSync(path.join(root, name), "utf8").includes(version()),
      name,
    );
  for (const name of ["README.md", "README.en.md", "README.zh-CN.md"]) {
    const content = fs.readFileSync(path.join(root, name), "utf8");
    for (const target of [
      "README.md",
      "README.zh-CN.md",
      "docs/README.md",
      "docs/installation.md",
      "docs/agent-setup.md",
    ])
      assert(
        content.includes("](" + target + ")"),
        name + ": missing navigation " + target,
      );
    assert(
      content.includes("badge.svg?branch=main"),
      name + ": CI badge must select main",
    );
    assert(
      content.includes("/releases/latest)"),
      name + ": latest release link missing",
    );
  }
  const navigation = {
    "AGENTS.md": [
      "docs/README.md",
      "docs/agent-maintenance.md",
      "docs/agent-setup.md",
    ],
    "docs/README.md": [
      "installation.md",
      "agent-setup.md",
      "agent-usage.md",
      "agent-maintenance.md",
      "clients/codex.en.md",
      "clients/codex.md",
      "clients/claude.md",
      "troubleshooting.md",
      "security-model.md",
      "connectors.md",
      "architecture.md",
      "testing.md",
      "desktop-acceptance.md",
      "releases.md",
    ],
    "docs/agent-setup.md": [
      "installation.md",
      "agent-usage.md",
      "clients/codex.en.md",
      "clients/claude.md",
    ],
    "docs/agent-maintenance.md": [
      "README.md",
      "testing.md",
      "desktop-acceptance.md",
      "releases.md",
    ],
  };
  for (const [name, targets] of Object.entries(navigation)) {
    const content = fs.readFileSync(path.join(root, name), "utf8");
    for (const target of targets)
      assert(
        content.includes("](" + target + ")"),
        name + ": missing navigation " + target,
      );
  }
  for (const file of [
    ...fs
      .readdirSync(root)
      .filter((n) => n.endsWith(".md"))
      .map((n) => path.join(root, n)),
    ...walk(path.join(root, "docs")).filter((n) => n.endsWith(".md")),
  ]) {
    const content = fs.readFileSync(file, "utf8");
    // Include the destination of linked badges, whose labels contain an image.
    const links = [
      ...content.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g),
      ...content.matchAll(/\[!\[[^\]]*\]\([^)]+\)\]\(([^)]+)\)/g),
    ];
    for (const m of links) {
      const target = m[1].split("#")[0];
      if (target && !target.includes("://") && !target.startsWith("mailto:"))
        assert(
          fs.existsSync(path.resolve(path.dirname(file), target)),
          file + ": broken local link " + target,
        );
    }
  }
  console.log(
    "PASS: version/protocol, English README mirror, language/setup navigation, local documentation links (including badges)",
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
