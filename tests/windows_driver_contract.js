#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  vm = require("node:vm");
const { assert } = require("./node_harness");
const {
  buildStressDriver,
  writeJScript,
  preserveStressFailure,
} = require("./portable_windows_smoke");
function run(baseline = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "WSH 中文 driver "));
  try {
    const stop = "C:\\临时目录\\MCP 中文 bootstrap\\concurrent-ipc\\stop.flag";
    const manifest = {
      ipc_dir: "C:\\临时目录\\MCP 中文 bootstrap\\concurrent-ipc",
      bridge_instance: "fixture-instance",
      token: "fixture-token",
      runtime: {},
    };
    const source = '// 原生源码注释\nvar fixtureNativeText="中文_😀";',
      file = path.join(directory, "driver.js");
    const driver = buildStressDriver(source, stop, manifest);
    if (baseline) fs.writeFileSync(file, driver, "ascii");
    else writeJScript(file, driver);
    const bytes = fs.readFileSync(file),
      text = bytes.toString("utf8");
    // Validate actual disk bytes, not the pre-encoding JavaScript value.
    const decodedStop = JSON.parse(text.match(/var stopPath=([^;]+);/)[1]);
    assert.equal(
      decodedStop,
      stop,
      "ASCII write corrupted the Chinese/astral stop path",
    );
    assert(
      bytes.every((byte) => byte < 128),
      "classic JScript driver must be pure ASCII with Unicode escapes",
    );
    let captured;
    const context = {
      mcpServeWindows(host, backend, loadedManifest, loadedSource) {
        captured = {
          host,
          backend,
          manifest: loadedManifest,
          source: loadedSource,
        };
      },
      WScript: {
        Echo() {},
        Quit() {
          throw new Error("driver aborted");
        },
      },
    };
    vm.runInNewContext(text, context);
    assert.equal(context.fixtureNativeText, "中文_😀");
    assert.equal(captured.manifest.ipc_dir, manifest.ipc_dir);
    assert.equal(captured.source, source);
    assert.equal(captured.backend, "securecrt");
    console.log(
      "PASS: actual ASCII driver bytes restore Chinese/astral stop, IPC manifest and native source without path substitution",
    );
    const primary = new Error("native stress not ready"),
      cleanup = new Error("native stress shutdown timeout"),
      state = {
        exit_code: null,
        signal_code: null,
        kill_requested: true,
        diagnostic: "fixture native diagnostic",
      };
    const result = preserveStressFailure(primary, cleanup, state);
    assert.equal(
      result,
      primary,
      "cleanup replaced the original startup error",
    );
    assert.equal(result.message, "native stress not ready");
    assert.equal(result.cleanup_error, "native stress shutdown timeout");
    assert.equal(result.native_stress, state);
    const cleanupOnly = preserveStressFailure(null, cleanup, state);
    assert.equal(cleanupOnly, cleanup);
    assert.equal(preserveStressFailure(null, null, state), null);
    console.log(
      "PASS: startup/IPC primary error survives cleanup failure with diagnostics and honest pending-exit state",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
if (require.main === module)
  try {
    run(process.argv.includes("--baseline"));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
module.exports = { run };
