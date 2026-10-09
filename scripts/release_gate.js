#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process"),
  { version } = require("./package_release");
function invoke(binary, args) {
  const p = spawnSync(binary, args, { encoding: "utf8", windowsHide: true });
  if (p.error) throw p.error;
  return p;
}
function git(...args) {
  const p = invoke("git", args);
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim();
}
function run() {
  const v = version();
  assert(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(v));
  const tag = "v" + v,
    source = git("rev-parse", "HEAD"),
    request = fs.existsSync(".github/release-request.json")
      ? JSON.parse(fs.readFileSync(".github/release-request.json", "utf8"))
      : {},
    automatic = process.env.EVENT === "workflow_run";
  if (automatic && (request.enabled !== true || request.tag !== tag)) {
    console.log("No matching approved release request; nothing to publish.");
    return;
  }
  if (!automatic)
    assert.equal(process.env.REF_NAME, tag, "tag/version mismatch");
  const notes =
    request.tag === tag ? request.notes || "CHANGELOG.md" : "CHANGELOG.md";
  assert(
    /^[A-Za-z0-9_./-]+$/.test(notes) &&
      !notes.split("/").includes("..") &&
      fs.statSync(notes).isFile(),
    "invalid/missing release notes",
  );
  const existing = invoke("gh", [
    "api",
    "repos/" + process.env.GH_REPO + "/releases/tags/" + tag,
  ]);
  if (existing.status === 0) {
    assert.equal(
      JSON.parse(existing.stdout).draft,
      false,
      "existing draft requires inspection",
    );
    console.log("Release already exists; preserve assets: " + tag);
    return;
  }
  assert(existing.stderr.includes("HTTP 404"), existing.stderr);
  const found = invoke("git", [
    "rev-parse",
    "--verify",
    "refs/tags/" + tag + "^{commit}",
  ]);
  if (found.status === 0)
    assert.equal(found.stdout.trim(), source, "existing tag differs");
  else assert(automatic, "pushed tag missing");
  if (automatic) {
    const main = invoke("gh", [
      "api",
      "repos/" + process.env.GH_REPO + "/git/ref/heads/main",
      "--jq",
      ".object.sha",
    ]);
    assert.equal(main.status, 0, main.stderr);
    assert.equal(
      main.stdout.trim(),
      source,
      "main moved; refuse unselected commit",
    );
  }
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    "publish=true\ntag=" +
      tag +
      "\nsource_sha=" +
      source +
      "\nnotes=" +
      notes +
      "\n",
  );
  console.log("Selected exact tested source: " + source + " / " + tag);
}
if (require.main === module)
  try {
    run();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
module.exports = { run };
