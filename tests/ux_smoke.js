#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { MCP, fixture, assert, command } = require("./node_harness");
async function run(binary) {
  const f = await fixture(binary);
  let m;
  try {
    const cfg = path.join(f.home, "config.toml");
    fs.writeFileSync(
      cfg,
      fs
        .readFileSync(cfg, "utf8")
        .replace('mode = "unrestricted"', 'mode = "client"'),
    );
    m = await new MCP(binary, f.env).start();
    const target = (await m.tool("connector_list")).securecrt[0].id;
    let sid = (
      await m.tool("connector_open", {
        backend: "securecrt",
        target,
        mode: "exec",
      })
    ).session_id;
    const exec = (command = "printf hello", extra = {}) =>
      m.tool("connector_exec", {
        session_id: sid,
        command,
        mode: "posix",
        wait_ms: 10000,
        ...extra,
      });
    const first = await exec("printf hello", { operation_id: "ux-one" });
    assert.equal(first.state, "completed");
    assert.equal(first.sent, true);
    assert.equal(first.remote_termination_confirmed, false);
    const before = f.bridge.sent.length;
    assert.equal(
      (await exec("printf hello", { operation_id: "ux-one", max_bytes: 4 }))
        .command_id,
      first.command_id,
    );
    assert.equal(f.bridge.sent.length, before);
    for (const command of [
      "grep 'deny' fake.conf",
      "grep 'shutdown' fake.conf",
      "systemctl status fake",
      "systemctl stop fake-only",
      "rm -rf /tmp/FAKE-ONLY",
    ])
      assert.equal((await exec(command)).state, "completed");
    f.bridge.currentLine = "Password:";
    assert.equal((await exec()).sent, false);
    f.bridge.currentLine = ">";
    assert.equal((await exec()).sent, false);
    f.bridge.currentLine = "user$";
    f.bridge.fault = "stale";
    const denied = await exec();
    assert.equal(denied.state, "rejected");
    assert.equal(denied.sent, false);
    assert.equal((await exec()).state, "completed");
    f.bridge.fault = "lost";
    const lost = await exec("printf uncertain", { operation_id: "lost" });
    assert.equal(lost.state, "unknown");
    assert.equal(lost.sent, null);
    const after = f.bridge.sent.length;
    assert.equal(
      (await exec("printf uncertain", { operation_id: "lost" })).command_id,
      lost.command_id,
    );
    assert.equal(f.bridge.sent.length, after);
    await m.tool(
      "connector_exec",
      { session_id: sid, command: "printf blocked", mode: "posix" },
      true,
    );
    assert.equal(f.bridge.sent.length, after);
    assert.equal(f.bridge.interrupts.length, 0);
    await m.close();
    m = null;
    f.bridge.active.clear();
    const input = path.join(f.home, "request.json");
    fs.writeFileSync(
      input,
      JSON.stringify({
        session: target,
        command: "printf '%s' '$HOME | quoted 中文'",
        mode: "posix",
      }),
    );
    const cli = await command(
      process.execPath,
      [
        path.join(__dirname, "../clients/securecrt_client.js"),
        "--binary",
        path.resolve(binary),
        "run",
        "--input",
        input,
      ],
      f.env,
    );
    assert.equal(cli.code, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).state, "completed");
    assert(f.bridge.sent.at(-1).includes("$HOME | quoted 中文"));
    const policy = await command(
      binary,
      ["policy-check", "--input", input],
      f.env,
    );
    assert.equal(JSON.parse(policy.stdout).mode, "client");
    console.log(
      "PASS: client policy, context/password/continuation/stale guard, lost send reply no replay, uncertainty interlock, byte-safe Node CLI forwarding",
    );
  } finally {
    if (m) await m.close();
    await f.close();
  }
}
if (require.main === module)
  run(process.argv[2]).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { run };
