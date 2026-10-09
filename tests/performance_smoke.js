#!/usr/bin/env node
"use strict";
const {
  MCP,
  fixture,
  assert,
  writeJSON,
  args,
  sleep,
} = require("./node_harness");
async function run(binary) {
  const f = await fixture(binary, { persistent: true });
  let m;
  try {
    m = await new MCP(binary, f.env).start();
    const ids = (await m.tool("connector_list")).securecrt.map((x) => x.id),
      opened = [];
    for (const target of ids)
      opened.push(
        (
          await m.tool("connector_open", {
            backend: "securecrt",
            target,
            mode: "exec",
          })
        ).session_id,
      );
    const exec = (command, sid = opened[0], wait_ms = 10000) =>
      m.tool("connector_exec", {
        session_id: sid,
        command,
        mode: "posix",
        wait_ms,
        timeout_ms: 10000,
      });
    const times = [];
    for (let i = 0; i < 20; i++) {
      const start = Date.now(),
        v = await exec("printf hello");
      assert.equal(v.state, "completed");
      assert.equal(v.exit_code, 0);
      times.push(Date.now() - start);
    }
    async function readAll(command) {
      let cursor = 0,
        text = "",
        pages = 0;
      do {
        const p = await m.tool("connector_read", {
          command_id: command,
          cursor,
          max_bytes: 65536,
        });
        text += p.text;
        cursor = p.next_cursor;
        assert(++pages < 100);
      } while (cursor !== null);
      return { text, pages };
    }
    let start = Date.now(),
      v = await exec("many-lines"),
      many_ms = Date.now() - start;
    assert.equal(v.state, "completed");
    const output = await readAll(v.command_id);
    assert.equal(output.text.split("log-line ").length - 1, 1600);
    assert(Buffer.byteLength(output.text) > 100000);
    start = Date.now();
    v = await exec("long-line");
    const long_ms = Date.now() - start;
    assert.equal(v.state, "completed");
    const large = await readAll(v.command_id);
    assert.equal(large.text, "中".repeat(70000) + "\n");
    const jobs = await Promise.all(
      opened.map((sid) => exec("printf hello", sid, 0)),
    );
    for (const job of jobs)
      assert.equal((await m.done(job.command_id)).state, "completed");
    const before = f.bridge.sent.length;
    let batch = await m.tool("connector_exec_batch", {
      session_id: opened[0],
      commands: ["printf one", "printf two"],
      operation_id: "batch-perf",
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
    assert(batch.results.every((x) => x.exit_code === 0));
    assert.equal(
      (
        await m.tool("connector_exec_batch", {
          session_id: opened[0],
          commands: ["printf one", "printf two"],
          operation_id: "batch-perf",
        })
      ).batch_id,
      batch.batch_id,
    );
    assert.equal(f.bridge.sent.length, before + 2);
    const metrics = await m.tool("connector_metrics");
    assert(metrics.persistent);
    const sorted = [...times].sort((a, b) => a - b),
      report = {
        label: "persistent",
        scope:
          "compiled Rust / Node fake TCP bridge; NOT native SDK, SSH, VPN or model latency",
        commands: 20,
        short_commands_ms: times,
        short_p50_ms: sorted[10],
        short_total_ms: times.reduce((a, b) => a + b, 0),
        many_lines: 1600,
        many_output_bytes: Buffer.byteLength(output.text),
        many_lines_ms: many_ms,
        long_line_bytes: 210000,
        long_line_ms: long_ms,
        multi_tab_count: opened.length,
        latency: metrics,
      };
    console.log("PERFORMANCE_REPORT=" + JSON.stringify(report));
    return report;
  } finally {
    if (m) await m.close();
    await f.close();
  }
}
if (require.main === module) {
  const a = args();
  run(a._[0])
    .then((r) => {
      if (a.output) writeJSON(a.output, r);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
module.exports = { run };
