#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { zip } = require("./zip"),
  { windowsScripts } = require("./portable_scripts");
const root = path.resolve(__dirname, "..");
const version = () =>
  fs
    .readFileSync(path.join(root, "Cargo.toml"), "utf8")
    .match(/^version\s*=\s*"([^"]+)"/m)[1];
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}
function manifest(binary, target) {
  let files = [
    "LICENSE",
    "Cargo.toml",
    "README.md",
    "README.en.md",
    "README.zh-CN.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "ROADMAP.md",
    "AGENTS.md",
  ].map((n) => path.join(root, n));
  files.push(
    ...walk(path.join(root, "docs")).filter((n) => /\.(md|json)$/.test(n)),
    ...walk(path.join(root, "clients")).filter((n) => /\.(js|ps1)$/.test(n)),
    ...walk(path.join(root, "support")).filter((n) => n.endsWith(".json")),
    ...walk(path.join(root, "bridge")).filter((n) => n.endsWith(".js")),
  );
  if (!target.toLowerCase().includes("windows"))
    files.push(path.join(root, "bridge/securecrt_bridge.py"));
  files.push(
    ...walk(path.join(root, "tests")).filter((n) => n.endsWith(".js")),
    ...walk(path.join(root, "scripts")).filter((n) => n.endsWith(".js")),
  );
  const installers = target.toLowerCase().includes("windows")
    ? [
        {
          name: "install.cmd",
          data: Buffer.from(
            '@echo off\r\ncd /d "%~dp0"\r\nsecurecrt-mcp.exe install\r\nif errorlevel 1 pause\r\n',
          ),
        },
      ]
    : [
        {
          name: "install.command",
          data: Buffer.from(
            '#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\n./securecrt-mcp install\n',
          ),
          mode: 0o100755,
        },
      ];
  const entries = [
    ...installers,
    {
      name: path.basename(binary),
      data: fs.readFileSync(binary),
      mode: 0o100755,
    },
    ...files.map((file) => ({
      name: path.relative(root, file).split(path.sep).join("/"),
      data: fs.readFileSync(file),
      mode: fs.statSync(file).mode,
    })),
  ];
  if (target.toLowerCase().includes("windows"))
    for (const [name, data] of Object.entries(windowsScripts(root, binary)))
      entries.push({ name, data });
  assert.equal(
    new Set(entries.map((e) => e.name)).size,
    entries.length,
    "duplicate manifest member",
  );
  return entries;
}
function run(binary, target) {
  binary = path.resolve(binary);
  assert(fs.statSync(binary).isFile());
  assert(/^[a-zA-Z0-9_-]+$/.test(target), "invalid target");
  const dest = path.join(root, "dist");
  fs.mkdirSync(dest, { recursive: true });
  if (target.toLowerCase().includes("windows"))
    for (const [name, data] of Object.entries(windowsScripts(root, binary)))
      fs.writeFileSync(path.join(dest, name), data);
  const archive = path.join(
      dest,
      "securecrt-mcp-" + version() + "-" + target + ".zip",
    ),
    data = zip(manifest(binary, target));
  fs.writeFileSync(archive, data);
  const checksum = crypto.createHash("sha256").update(data).digest("hex");
  fs.writeFileSync(
    archive + ".sha256",
    checksum + "  " + path.basename(archive) + "\n",
  );
  console.log(path.basename(archive) + " " + checksum);
  return archive;
}
if (require.main === module)
  try {
    run(process.argv[2], process.argv[3]);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
module.exports = { run, manifest, version, root };
