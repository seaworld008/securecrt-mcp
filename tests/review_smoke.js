#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { MCP, fixture, assert } = require("./node_harness");
async function run(binary) {
  const f = await fixture(binary);
  let m;
  try {
    const cfg = path.join(f.home, "config.toml");
    fs.writeFileSync(
      cfg,
      fs.readFileSync(cfg, "utf8").replace("max_jobs = 32", "max_jobs = 4"),
    );
    m = await new MCP(binary, f.env).start();
    const target = (await m.tool("connector_list")).securecrt[0].id,
      sid = (
        await m.tool("connector_open", {
          backend: "securecrt",
          target,
          mode: "exec",
        })
      ).session_id;
    const exec = (extra) =>
      m.tool("connector_exec", {
        session_id: sid,
        command: "printf hello",
        mode: "posix",
        wait_ms: 10000,
        ...extra,
      });
    await exec({ operation_id: "original" });
    for (let i = 0; i < 12; i++)
      assert.equal(
        (await exec({ operation_id: "cache-" + i })).state,
        "completed",
      );
    const before = f.bridge.sent.length,
      old = await m.tool(
        "connector_exec",
        {
          session_id: sid,
          command: "printf hello",
          mode: "posix",
          operation_id: "original",
        },
        true,
      );
    assert.equal(old.error.data.error_code, "command_not_found");
    assert.equal(f.bridge.sent.length, before, "eviction replayed");
    f.bridge.fault = "no-send-evidence";
    const unknown = await exec({});
    assert.equal(unknown.state, "unknown");
    assert.equal(unknown.sent, null);
    await m.close();
    m = null;
    f.bridge.active.clear(); // Explicit fixture reset; never a production recovery.
    m = await new MCP(binary, f.env).start();
    const fresh = (
      await m.tool("connector_open", {
        backend: "securecrt",
        target,
        mode: "exec",
      })
    ).session_id;
    const grace = await m.tool("connector_exec", {
      session_id: fresh,
      command: "grace-command",
      mode: "posix",
      wait_ms: 0,
    });
    assert.equal(grace.state, "running");
    await m.close();
    m = null;
    assert.equal(
      f.bridge.active.size,
      0,
      "graceful EOF abandoned almost complete capture",
    );
    assert.equal(f.bridge.interrupts.length, 0);
    console.log(
      "PASS: cache eviction no replay, malformed send evidence retained unknown, bounded graceful EOF drain, shutdown no implicit interrupt",
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
