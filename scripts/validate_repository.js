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
const bilingualGuides = [
  ["README.md", "README.en.md"],
  ["docs/README.md", "docs/README.en.md"],
  ["docs/installation.md", "docs/installation.en.md"],
  ["docs/agent-usage.md", "docs/agent-usage.en.md"],
  ["docs/clients/codex.md", "docs/clients/codex.en.md"],
  ["docs/clients/claude.md", "docs/clients/claude.en.md"],
];
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
function codeExamples(content) {
  return [...content.matchAll(/^```([^\n]*)\n([\s\S]*?)^```\s*$/gm)].map(
    ([, language, body]) => [
      language,
      body
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n"),
    ],
  );
}
function anchors(content) {
  // Only the current bilingual guides need heading/explicit-anchor checks.
  const prose = content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  const ids = new Set(
    [...prose.matchAll(/<a\s+id="([^"]+)"\s*>/g)].map((m) => m[1]),
  );
  const counts = new Map();
  for (const [, heading] of prose.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = heading
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    const count = counts.get(slug) || 0;
    ids.add(count ? slug + "-" + count : slug);
    counts.set(slug, count + 1);
  }
  return ids;
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
    "Simplified Chinese README mirror drift",
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
    const english = name === "README.en.md";
    assert(
      content.split("\n")[2].startsWith(
        "[简体中文](README.md) · [English](README.en.md)",
      ),
      name + ": language navigation must prefer Simplified Chinese",
    );
    for (const target of [
      "README.md",
      "README.en.md",
      english ? "docs/README.en.md" : "docs/README.md",
      english ? "docs/installation.en.md" : "docs/installation.md",
      english ? "docs/agent-usage.en.md" : "docs/agent-usage.md",
      english ? "docs/clients/codex.en.md" : "docs/clients/codex.md",
      english ? "docs/clients/claude.en.md" : "docs/clients/claude.md",
      english ? "docs/agent-setup.md#english-prompt" : "docs/agent-setup.md",
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
    const prompt = content.match(/^```text\n([\s\S]*?)^```/m);
    assert(prompt, name + ": short setup prompt missing");
    assert.equal(
      prompt[1].trimEnd().split("\n").length,
      8,
      name + ": setup prompt must contain eight lines",
    );
  }
  for (const [chinese, english] of bilingualGuides.slice(1)) {
    for (const name of [chinese, english]) {
      const relative = (target) =>
        path.relative(path.dirname(name), target).split(path.sep).join("/");
      assert(
        read(name).split("\n")[2].startsWith(
          `[简体中文](${relative(chinese)}) · [English](${relative(english)})`,
        ),
        name + ": bilingual navigation missing or out of order",
      );
    }
    assert.deepEqual(
      codeExamples(read(chinese)),
      codeExamples(read(english)),
      chinese + ": translated command/configuration examples drift",
    );
  }
  const setup = read("docs/agent-setup.md");
  assert(
    setup.includes("## 中文提示词") &&
      setup.includes("## English prompt") &&
      setup.indexOf("## 中文提示词") < setup.indexOf("## English prompt"),
    "Agent setup must retain both detailed prompts, Chinese first",
  );
  const navigation = {
    "AGENTS.md": [
      "README.md",
      "README.en.md",
      "docs/README.md",
      "docs/README.en.md",
      "docs/agent-maintenance.md",
      "docs/agent-setup.md",
    ],
    "CONTRIBUTING.md": [
      "README.md",
      "README.en.md",
      "docs/README.md",
      "docs/README.en.md",
    ],
    "SECURITY.md": [
      "README.md",
      "README.en.md",
      "docs/README.md",
      "docs/README.en.md",
      "docs/installation.en.md",
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
    "docs/README.en.md": [
      "../README.en.md",
      "installation.en.md",
      "agent-setup.md#english-prompt",
      "agent-usage.en.md",
      "agent-maintenance.md",
      "clients/codex.en.md",
      "clients/codex.md",
      "clients/claude.en.md",
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
      "installation.en.md",
      "agent-usage.md",
      "agent-usage.en.md",
      "clients/codex.md",
      "clients/codex.en.md",
      "clients/claude.md",
      "clients/claude.en.md",
    ],
    "docs/agent-maintenance.md": [
      "README.md",
      "README.en.md",
      "testing.md",
      "desktop-acceptance.md",
      "releases.md",
    ],
  };
  for (const suffix of ["", ".en"]) {
    const prompt = suffix ? "#english-prompt" : "#中文提示词";
    navigation[`docs/installation${suffix}.md`] = [
      `README${suffix}.md`,
      `agent-setup.md${prompt}`,
      `agent-usage${suffix}.md`,
      `clients/codex${suffix}.md`,
      `clients/claude${suffix}.md`,
    ];
    navigation[`docs/agent-usage${suffix}.md`] = [
      `README${suffix}.md`,
      `installation${suffix}.md`,
      `agent-setup.md${prompt}`,
      `clients/codex${suffix}.md`,
      `clients/claude${suffix}.md`,
    ];
    navigation[`docs/clients/codex${suffix}.md`] = [
      `../README${suffix}.md`,
      `../installation${suffix}.md`,
      `../agent-usage${suffix}.md`,
    ];
    navigation[`docs/clients/claude${suffix}.md`] = [
      `../README${suffix}.md`,
      `../installation${suffix}.md`,
      `../agent-usage${suffix}.md`,
      `../agent-setup.md${prompt}`,
    ];
  }
  for (const [name, targets] of Object.entries(navigation)) {
    const content = fs.readFileSync(path.join(root, name), "utf8");
    for (const target of targets)
      assert(
        content.includes("](" + target + ")"),
        name + ": missing navigation " + target,
      );
  }
  const guideAnchors = new Map(
    [...bilingualGuides.flat(), "README.zh-CN.md", "docs/agent-setup.md"].map(
      (name) => [path.join(root, name), anchors(read(name))],
    ),
  );
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
      const [target, fragment] = m[1].split("#");
      if (!target.includes("://") && !target.startsWith("mailto:")) {
        const resolved = target
          ? path.resolve(path.dirname(file), target)
          : file;
        assert(
          fs.existsSync(resolved),
          file + ": broken local link " + target,
        );
        if (fragment && guideAnchors.has(resolved))
          assert(
            guideAnchors.get(resolved).has(decodeURIComponent(fragment)),
            file + ": broken bilingual guide anchor " + m[1],
          );
      }
    }
  }
  console.log(
    "PASS: version/protocol, Simplified Chinese README mirror, bilingual navigation/examples, eight-line prompts, local documentation links/guide anchors (including badges)",
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
