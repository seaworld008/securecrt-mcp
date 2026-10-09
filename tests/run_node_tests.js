#!/usr/bin/env node
"use strict";
const path = require("node:path"),
  { command, assert } = require("./node_harness");
async function run(binary) {
  binary = path.resolve(binary);
  for (const name of [
    "windows_bridge_test.js",
    "windows_driver_contract.js",
    "client_contract.js",
    "desktop_matrix_contract.js",
    "original_prompt_observer_contract.js",
    "protocol_harness.js",
    "mcp_smoke.js",
    "ux_smoke.js",
    "review_smoke.js",
    "cancellation_race_smoke.js",
    "performance_smoke.js",
    "persistent_fault_smoke.js",
    "file_transport_fault_smoke.js",
    "daemon_smoke.js",
    "installation_env_smoke.js",
  ]) {
    console.log("RUN: " + name);
    const result = await command(
      process.execPath,
      [path.join(__dirname, name), binary],
      process.env,
      120000,
    );
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.equal(result.code, 0, name + " failed");
  }
  const packageResult = await command(
    process.execPath,
    [
      path.join(__dirname, "package_smoke.js"),
      binary,
      process.platform === "win32" ? "validation-windows" : "validation-native",
    ],
    process.env,
    120000,
  );
  process.stdout.write(packageResult.stdout);
  if (packageResult.stderr) process.stderr.write(packageResult.stderr);
  assert.equal(packageResult.code, 0, "package validation failed");
  if (process.platform === "win32") {
    const p = await command(
      process.execPath,
      [path.join(__dirname, "portable_windows_smoke.js"), binary],
      process.env,
      180000,
    );
    process.stdout.write(p.stdout);
    if (p.stderr) process.stderr.write(p.stderr);
    assert.equal(p.code, 0, "Windows WSH bootstrap failed");
  }
  console.log(
    "PASS: full Node compiled regression suite (live desktop separately required)",
  );
}
if (require.main === module)
  run(process.argv[2]).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { run };
