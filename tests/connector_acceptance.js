#!/usr/bin/env node
"use strict";
const {
  MCP,
  bytesPage,
  sleep,
  args,
  writeJSON,
  assert,
} = require("./node_harness");
async function run(a) {
  const mcp = await new MCP(
    a._[0],
    process.env,
    a.protocol || "legacy",
  ).start();
  let sid;
  const checks = [];
  const check = (name, condition) => {
    assert(condition, name);
    checks.push(name);
    console.log("PASS: " + name);
  };
  try {
    const opened = await mcp.tool("connector_open", {
      backend: Array.isArray(a.backend) ? a.backend[0] : a.backend,
      target: a.target,
      mode: "exec",
      config_path: a.config_path,
    });
    check("attach", !!opened.session_id);
    sid = opened.session_id;
    const exec = (p) =>
      mcp.tool("connector_exec", {
        session_id: sid,
        mode: "posix",
        wait_ms: 10000,
        timeout_ms: 10000,
        ...p,
      });
    const result = await exec({ command: "printf 'MCP_ACCEPTANCE_OK\\n'" });
    check(
      "exec",
      result.state === "completed" &&
        result.exit_code === 0 &&
        bytesPage(result).includes("MCP_ACCEPTANCE_OK"),
    );
    let batch = await mcp.tool("connector_exec_batch", {
      session_id: sid,
      commands: [
        "printf 'BATCH_A\\n'",
        "printf 'BATCH_B\\n'",
        "printf 'BATCH_C\\n'",
      ],
    });
    const until = Date.now() + 20000;
    while (batch.state === "running" && Date.now() < until) {
      await sleep(20);
      batch = await mcp.tool("connector_get_batch_status", {
        batch_id: batch.batch_id,
      });
    }
    check(
      "batch",
      batch.state === "completed" &&
        batch.results.length === 3 &&
        batch.results.every((r) => (r.result || r).exit_code === 0),
    );
    const expected = "分页_中文_".repeat(12),
      large = await exec({
        command: "printf '%s\\n' '" + expected + "'",
        max_bytes: 16,
      });
    let data = bytesPage(large),
      cursor = (large.output || large).next_cursor,
      pages = 1;
    while (cursor !== null && cursor !== undefined) {
      const page = await mcp.tool("connector_read", {
        command_id: large.command_id,
        cursor,
        max_bytes: 16,
      });
      data = Buffer.concat([data, bytesPage(page)]);
      cursor = (page.output || page).next_cursor;
      assert(++pages < 100, "pagination bound");
    }
    check("pagination", pages > 1 && data.toString("utf8").includes(expected));
    const backend = Array.isArray(a.backend) ? a.backend[0] : a.backend;
    const params = {
      session_id: sid,
      mode: "posix",
      command:
        backend === "openssh"
          ? "printf 'MUST_NOT_SEND'\n"
          : "printf 'MUST_NOT_SEND'",
      ...(backend === "openssh"
        ? {}
        : { expected_prompt: "not-the-verified-prompt" }),
    };
    const response = await mcp.request("tools/call", {
      name: "connector_exec",
      arguments: params,
    });
    const denied =
      response.error?.data ||
      JSON.parse(response.result.content.find((c) => c.type === "text").text);
    check("rejection", denied.state === "rejected" && denied.sent === false);
    return {
      scope: "live_connector",
      backend,
      protocol: a.protocol || "legacy",
      status: "PASS",
      checks,
      pages,
      source_commit: a.source_commit,
      tested_on: a.tested_on,
    };
  } finally {
    if (sid) await mcp.tool("connector_close", { session_id: sid });
    await mcp.close();
  }
}
if (require.main === module) {
  const a = args();
  run(a)
    .then((v) => writeJSON(a.output, v))
    .catch((e) => {
      writeJSON(a.output, {
        status: "FAIL",
        backend: a.backend?.[0],
        protocol: a.protocol || "legacy",
        error_type: e.name,
        source_commit: a.source_commit,
        tested_on: a.tested_on,
      });
      console.error(e.message);
      process.exitCode = 1;
    });
}
module.exports = { run };
