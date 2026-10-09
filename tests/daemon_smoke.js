#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  { fixture, assert, command, sleep, writeJSON } = require("./node_harness"),
  { SecureCRTClient } = require("../clients/persistent_client");
async function run(binary) {
  binary = path.resolve(binary);
  const f = await fixture(binary, { persistent: true });
  let proc;
  try {
    proc = spawn(binary, ["daemon"], {
      env: f.env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errors = "";
    proc.stderr.on("data", (b) => (errors += b));
    const endpoint = path.join(f.home, "daemon.json"),
      until = Date.now() + 5000;
    while (!fs.existsSync(endpoint)) {
      assert(Date.now() < until, "daemon did not publish: " + errors);
      await sleep(20);
    }
    const cli = async (method, params) => {
      const input = path.join(f.home, "request.json");
      writeJSON(input, params);
      const p = await command(
        binary,
        ["session", method, "--input", input],
        f.env,
      );
      assert.equal(p.code, 0, p.stderr);
      return JSON.parse(p.stdout);
    };
    const target = (await cli("sessions", {})).sessions[0].id,
      binding = await cli("attach", {
        session: target,
        mode: "shared",
        expected_prompt: "user$",
      }),
      job = await cli("exec", {
        attachment_id: binding.attachment_id,
        command: "printf hello",
        mode: "posix",
        operation_id: "persistent-cli-op",
      });
    assert.equal(job.state, "completed");
    assert.equal(job.exit_code, 0);
    assert.equal(
      (await cli("output", { command_id: job.command_id })).text,
      "hello\n",
    );
    const before = f.bridge.sent.length;
    assert.equal(
      (
        await cli("exec", {
          attachment_id: binding.attachment_id,
          command: "printf hello",
          mode: "posix",
          operation_id: "persistent-cli-op",
        })
      ).command_id,
      job.command_id,
    );
    assert.equal(f.bridge.sent.length, before);
    const client = new SecureCRTClient(f.home);
    assert.equal((await client.output(job.command_id)).text, "hello\n");
    const input = path.join(f.home, "run.json");
    writeJSON(input, {
      session: target,
      command: "printf hello",
      mode: "posix",
    });
    const routed = JSON.parse(
      (await command(binary, ["run", "--input", input], f.env)).stdout,
    );
    assert.equal(routed.client, "persistent_daemon");
    assert(routed.output_available_after_exit);
    assert.equal((await client.output(routed.command_id)).text, "hello\n");
    await cli("detach", { attachment_id: binding.attachment_id });
    assert.equal((await command(binary, ["daemon", "--stop"], f.env)).code, 0);
    await new Promise((resolve, reject) => {
      if (proc.exitCode !== null) return resolve();
      const timer = setTimeout(
        () => reject(new Error("daemon shutdown timeout")),
        5000,
      );
      proc.once("close", (code) => {
        clearTimeout(timer);
        assert.equal(code, 0, errors);
        resolve();
      });
    });
    assert(!fs.existsSync(endpoint), "stale daemon identity");
    proc = null;
    console.log(
      "PASS: retained daemon attachments/results across CLI and Node processes, dedup, explicit stop removes endpoint",
    );
  } finally {
    if (proc) proc.kill();
    await f.close();
  }
}
if (require.main === module)
  run(process.argv[2]).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { run };
