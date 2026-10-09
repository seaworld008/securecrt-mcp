#!/usr/bin/env node
"use strict";
const { spawn } = require("node:child_process");
const argv = process.argv.slice(2);
let binary = "securecrt-mcp";
if (argv[0] === "--binary") {
  binary = argv[1];
  argv.splice(0, 2);
}
const action = argv[0];
if (
  !["sessions", "screen", "run", "policy-check"].includes(action) ||
  (action === "screen" && (argv[1] !== "--session" || argv.length !== 3)) ||
  (["run", "policy-check"].includes(action) &&
    (argv[1] !== "--input" || argv.length !== 3)) ||
  (action === "sessions" && argv.length !== 1)
) {
  console.error(
    "Usage: securecrt_client.js [--binary PATH] sessions|screen --session ID|run --input JSON_OR_-|policy-check --input JSON_OR_-",
  );
  process.exit(2);
}
const proc = spawn(binary, argv, {
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});
proc.on("error", (e) => {
  console.error("Cannot launch securecrt-mcp: " + e.message);
  process.exitCode = 127;
});
proc.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
