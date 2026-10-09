#!/usr/bin/env node
"use strict";
const net = require("node:net"),
  { MCP, fixture, assert, sleep } = require("./node_harness");
async function run(binary) {
  const f = await fixture(binary, { persistent: true });
  let m;
  try {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: "127.0.0.1",
        port: f.bridge.port,
      });
      let count = 0,
        buf = "";
      socket.on("error", reject);
      socket.on("data", (b) => {
        buf += b;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const r = JSON.parse(buf.slice(0, i));
          buf = buf.slice(i + 1);
          assert.equal(r.id, "fragment-" + count);
          assert(r.ok && r.persistent);
          if (++count === 2) {
            socket.destroy();
            resolve();
          } else send();
        }
      });
      function send() {
        const wire =
          JSON.stringify({
            protocol_version: 2,
            id: "fragment-" + count,
            token: f.bridge.token,
            client_id: "wire-test",
            keep_alive: true,
            deadline_ms: Date.now() + 5000,
            method: "ping",
            params: {},
          }) + "\n";
        socket.write(wire.slice(0, 17));
        socket.write(wire.slice(17));
      }
      socket.once("connect", send);
    });
    m = await new MCP(binary, f.env).start();
    const target = (await m.tool("connector_list")).securecrt[0].id;
    let sid = (
      await m.tool("connector_open", {
        backend: "securecrt",
        target,
        mode: "exec",
      })
    ).session_id;
    f.bridge.fault = "lost";
    const result = await m.tool("connector_exec", {
      session_id: sid,
      command: "printf lost",
      operation_id: "lost-reply",
      mode: "posix",
      wait_ms: 10000,
    });
    assert.equal(result.state, "unknown");
    assert.equal(result.sent, null);
    const before = f.bridge.sent.length;
    assert.equal(
      (
        await m.tool("connector_exec", {
          session_id: sid,
          command: "printf lost",
          operation_id: "lost-reply",
          mode: "posix",
        })
      ).command_id,
      result.command_id,
    );
    assert.equal(f.bridge.sent.length, before);
    await m.tool("connector_interrupt", { command_id: result.command_id });
    const view = await m.tool("connector_read_screen", { session_id: sid });
    await m.tool("connector_acknowledge", {
      session_id: sid,
      confirmed_idle: true,
      screen_token: view.screen_token,
      expected_prompt: "user$",
    });
    sid = (
      await m.tool("connector_open", {
        backend: "securecrt",
        target,
        mode: "exec",
      })
    ).session_id;
    let batch = await m.tool("connector_exec_batch", {
      session_id: sid,
      commands: ["printf one", "printf two"],
      operation_id: "batch-wire",
      on_error: "stop",
    });
    const until = Date.now() + 8000;
    while (batch.state === "running" && Date.now() < until) {
      await sleep(20);
      batch = await m.tool("connector_get_batch_status", {
        batch_id: batch.batch_id,
      });
    }
    assert.equal(batch.state, "completed");
    assert.equal(batch.results.length, 2);
    console.log(
      "PASS: fragmented persistent wire, lost-after-send unknown, exactly one send, explicit recovery, batch",
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
