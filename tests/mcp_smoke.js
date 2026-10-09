#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  {
    MCP,
    fixture,
    assert,
    command,
    readJSON,
    writeJSON,
    sleep,
  } = require("./node_harness");
async function run(binary) {
  const f = await fixture(binary),
    { bridge, env, home } = f;
  let mcp;
  try {
    const config = path.join(home, "config.toml"),
      saved = fs.readFileSync(config, "utf8"),
      token = readJSON(path.join(home, "bridge.json")).token;
    assert.equal((await command(binary, ["upgrade"], env)).code, 0);
    assert.equal(
      fs.readFileSync(config, "utf8"),
      saved,
      "upgrade reset policy",
    );
    assert.equal(
      readJSON(path.join(home, "bridge.json")).token,
      token,
      "upgrade rotated token",
    );
    assert(
      (await command(binary, ["doctor", "--offline"], env)).stdout.includes(
        "offline_checks=OK",
      ),
    );
    // Windows upgrade intentionally refreshes native IPC. Restore the isolated
    // developer TCP fixture after testing token/config preservation.
    const testSecret = readJSON(path.join(home, "bridge.json"));
    testSecret.ipc_dir = null;
    writeJSON(path.join(home, "bridge.json"), testSecret);
    const codex = (
      await command(
        binary,
        ["codex-config", "--approval-mode", "prompt", "--toolset", "terminal"],
        env,
      )
    ).stdout;
    assert(
      codex.includes('default_tools_approval_mode = "prompt"') &&
        codex.includes("connector_list") &&
        !codex.includes("securecrt_connector_list"),
    );
    fs.writeFileSync(
      config,
      saved.replace("max_output_bytes = 1048576", "max_output_bytes = 4096"),
    );
    mcp = await new MCP(binary, env).start();
    const tools = (await mcp.request("tools/list")).result.tools,
      names = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(tools.length, 17);
    assert(
      names.connector_exec.annotations.destructiveHint &&
        !names.connector_exec.annotations.readOnlyHint &&
        names.connector_read_screen.annotations.readOnlyHint,
    );
    const listed = await mcp.tool("connector_list");
    assert.equal(listed.securecrt.length, 2);
    assert.deepEqual(listed.openssh, []);
    let sid = (
      await mcp.tool("connector_open", {
        backend: "securecrt",
        target: listed.securecrt[0].id,
        mode: "exec",
      })
    ).session_id;
    const exec = (command, extra = {}) =>
      mcp.tool("connector_exec", {
        session_id: sid,
        command,
        mode: "posix",
        timeout_ms: 5000,
        wait_ms: 10000,
        ...extra,
      });
    const job = await exec("printf hello", { operation_id: "dedup" });
    assert.equal(job.state, "completed");
    assert.equal(job.text, "hello\n");
    const count = bridge.sent.length;
    assert.equal(
      (await exec("printf hello", { operation_id: "dedup" })).command_id,
      job.command_id,
    );
    assert.equal(bridge.sent.length, count);
    await mcp.tool(
      "connector_exec",
      {
        session_id: sid,
        command: "printf other",
        mode: "posix",
        operation_id: "dedup",
      },
      true,
    );
    assert.equal(bridge.sent.length, count);
    const policyDenied = await exec("systemctl restart test-only");
    assert.equal(policyDenied.state, "rejected");
    assert.equal(policyDenied.sent, false);
    assert.equal(bridge.sent.length, count, "policy denial sent input");
    for (const extra of [
      { timeout_ms: 0 },
      { max_bytes: 0 },
      { wait_ms: 60001 },
    ]) {
      const r = await mcp.tool(
        "connector_exec",
        { session_id: sid, command: "printf hello", mode: "posix", ...extra },
        true,
      );
      assert.equal(r.error.data.sent, false);
    }
    await mcp.tool(
      "connector_stream_write",
      { session_id: sid, text: "secret" },
      true,
    );
    let large = await exec("large-output");
    assert(large.truncated);
    const page = await mcp.tool("connector_read", {
      command_id: large.command_id,
      max_bytes: 4,
    });
    assert.equal(page.text, "中");
    assert.equal(page.next_cursor, 3);
    await mcp.tool(
      "connector_read",
      { command_id: large.command_id, cursor: 1 },
      true,
    );
    let slow = await exec("slow-command", { wait_ms: 0, timeout_ms: 4000 });
    const busy = await mcp.tool(
      "connector_exec",
      { session_id: sid, command: "printf later", mode: "posix" },
      true,
    );
    assert.equal(busy.error.data.sent, false);
    await mcp.tool("connector_interrupt", { command_id: slow.command_id });
    assert.equal((await mcp.done(slow.command_id)).state, "cancelled");
    assert.equal(bridge.interrupts.length, 1);
    async function acknowledge() {
      const view = await mcp.tool("connector_read_screen", { session_id: sid });
      await mcp.tool("connector_acknowledge", {
        session_id: sid,
        confirmed_idle: true,
        screen_token: view.screen_token,
        expected_prompt: "user$",
      });
      sid = (
        await mcp.tool("connector_open", {
          backend: "securecrt",
          target: listed.securecrt[0].id,
          mode: "exec",
        })
      ).session_id;
    }
    await acknowledge();
    await sleep(100);
    assert.equal(
      (await mcp.tool("connector_get_status", { command_id: slow.command_id }))
        .requires_idle_ack,
      false,
      "cancelled+ack job overwritten by late runner",
    );
    const timed = await exec("slow-command", { timeout_ms: 1000 });
    assert.equal(timed.state, "timed_out");
    assert.equal(bridge.interrupts.length, 1, "automatic timeout interrupt");
    await acknowledge();
    assert.equal(
      (await mcp.tool("connector_get_status", { command_id: timed.command_id }))
        .requires_idle_ack,
      false,
      "acknowledged job still asks idle acknowledgement",
    );
    const prompt = await exec("printf prompt", {
      mode: "prompt",
      expected_prompt: "user$",
      wait_for: "user$",
    });
    assert.equal(prompt.state, "completed");
    assert.equal(prompt.exit_code, null);
    const snap = await exec("printf snapshot", {
      mode: "snapshot",
      expected_prompt: "user$",
    });
    assert.equal(snap.state, "unknown");
    assert(snap.requires_idle_ack);
    await mcp.tool(
      "connector_exec",
      { session_id: sid, command: "printf blocked", mode: "posix" },
      true,
    );
    await acknowledge();
    bridge.protocol = 1;
    assert(
      (await mcp.tool("connector_list")).securecrt_error.includes("protocol"),
    );
    bridge.protocol = 2;
    bridge.oversized = true;
    assert((await mcp.tool("connector_list")).securecrt_error);
    bridge.oversized = false;
    await mcp.close();
    mcp = null;
    fs.writeFileSync(
      config,
      fs
        .readFileSync(config, "utf8")
        .replace('file = "audit.jsonl"', 'file = "missing/audit.jsonl"'),
    );
    mcp = await new MCP(binary, env).start();
    sid = (
      await mcp.tool("connector_open", {
        backend: "securecrt",
        target: listed.securecrt[0].id,
        mode: "exec",
      })
    ).session_id;
    const before = bridge.sent.length,
      denied = await exec("printf audit");
    assert.equal(denied.state, "rejected");
    assert.equal(bridge.sent.length, before, "audit failed open");
    await mcp.close();
    mcp = null;
    const records = fs
      .readFileSync(path.join(home, "audit.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert(records.some((r) => r.event === "terminal_state"));
    assert(records.every((r) => r.command === undefined || r.command === null));
    console.log(
      "PASS: compiled MCP, tool annotations, policy/parameter gates, idempotency, UTF-8, busy, cancellation, prompt/snapshot, timeout no interrupt, malformed bridge frames, fail-closed audit, upgrade/config",
    );
  } finally {
    if (mcp) await mcp.close();
    await f.close();
  }
}
if (require.main === module)
  run(path.resolve(process.argv[2])).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { run };
