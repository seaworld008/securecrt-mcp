#!/usr/bin/env node
"use strict";
const { fixture, MCP, assert, sleep } = require("./node_harness");
async function run(binary) {
  const f = await fixture(binary, { pollDelay: 150, persistent: true });
  let m;
  try {
    m = await new MCP(binary, f.env).start();
    const target = (await m.tool("connector_list")).securecrt[0].id;
    const sid = (
      await m.tool("connector_open", {
        backend: "securecrt",
        target,
        mode: "exec",
      })
    ).session_id;
    const job = await m.tool("connector_exec", {
      session_id: sid,
      command: "slow-command",
      mode: "posix",
      wait_ms: 0,
      timeout_ms: 10000,
    });
    // Leave the polling task in a real TCP exchange while explicit interrupt publishes Cancelled.
    await sleep(30);
    await m.tool("connector_interrupt", { command_id: job.command_id });
    assert.equal(
      (await m.tool("connector_get_status", { command_id: job.command_id }))
        .state,
      "cancelled",
    );
    const view = await m.tool("connector_read_screen", { session_id: sid });
    const ack = await m.tool("connector_acknowledge", {
      session_id: sid,
      confirmed_idle: true,
      screen_token: view.screen_token,
      expected_prompt: "user$",
    });
    assert(ack.idle_acknowledged);
    await sleep(250);
    const settled = await m.tool("connector_get_status", {
      command_id: job.command_id,
    });
    assert.equal(settled.state, "cancelled");
    assert.equal(
      settled.requires_idle_ack,
      false,
      "late polling finish overwrote explicit idle acknowledgement",
    );
    assert.equal(f.bridge.interrupts.length, 1);
    assert.equal(f.bridge.sent.length, 1, "cancelled command replayed");
    console.log(
      "PASS: delayed in-flight poll cannot restore uncertainty after Cancelled + explicit fresh idle acknowledgement",
    );
  } finally {
    if (m) await m.close();
    await f.close();
  }
}
if (require.main === module)
  run(process.argv[2]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { run };
