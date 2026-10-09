#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  { MCP, sleep, args, writeJSON, assert } = require("./node_harness");
const fingerprint = (item) =>
  Object.fromEntries(
    [
      "index",
      "configured_host",
      "configured_user",
      "protocol",
      "port",
      "session_name",
      "remote_address",
      "remote_port",
      "user",
    ]
      .filter((k) => k in item)
      .map((k) => [k, item[k]]),
  );
async function run(a) {
  const start = Date.now(),
    dir = path.resolve(a.control_dir);
  assert(!fs.existsSync(dir), "control directory must be new");
  fs.mkdirSync(dir, { recursive: true });
  const client = await new MCP(a._[0]).start(),
    backend = a.backend[0],
    receipt = {
      scope: "real MCP / native UI disconnect and reconnect / SSH",
      backend,
      checks: [],
      passed: false,
    };
  async function phase(stage, flag) {
    writeJSON(path.join(dir, "status.json"), { stage });
    console.log("WAIT: " + stage);
    const until = Date.now() + Number(a.ui_timeout || 180) * 1000;
    while (!fs.existsSync(path.join(dir, flag))) {
      assert(
        Date.now() < until,
        "UI phase not confirmed; no automatic recovery",
      );
      await sleep(50);
    }
  }
  try {
    let targets = (await client.tool("connector_list"))[backend];
    const original = targets.find((x) => x.id === a.target && x.connected);
    assert(original, "explicit connected target missing");
    const identity = JSON.stringify(fingerprint(original)),
      old = (
        await client.tool("connector_open", {
          backend,
          target: a.target,
          mode: "exec",
        })
      ).session_id;
    const view = await client.tool("connector_read_screen", {
      session_id: old,
    });
    assert(/[#$%]$/.test(view.current_line) && !view.unresolved);
    receipt.checks.push("original idle connected attachment");
    await phase("await_disconnect", "disconnected.flag");
    const until = Date.now() + 3000;
    while (true) {
      targets = (await client.tool("connector_list"))[backend] || [];
      if (!targets.some((x) => x.id === a.target && x.connected)) break;
      assert(Date.now() < until, "disconnected target still connected");
      await sleep(50);
    }
    async function rejectOld() {
      const r = await client.tool("connector_exec", {
        session_id: old,
        command: "printf 'LIFECYCLE_MUST_NOT_SEND\\n'",
        mode: "posix",
        wait_ms: 0,
      });
      assert(
        r.sent === false && r.state === "rejected",
        "old attachment did not fail before send",
      );
    }
    await rejectOld();
    receipt.checks.push("disconnected old attachment rejected with sent=false");
    await phase("await_reconnect", "reconnected.flag");
    const matches = (
      (await client.tool("connector_list"))[backend] || []
    ).filter((x) => x.connected && JSON.stringify(fingerprint(x)) === identity);
    assert(matches.length === 1, "reconnected identity missing or ambiguous");
    assert(
      matches[0].id !== a.target,
      "reconnection revived old native handle",
    );
    await rejectOld();
    receipt.checks.push(
      "reconnected generation rejects old attachment with sent=false",
    );
    const sid = (
        await client.tool("connector_open", {
          backend,
          target: matches[0].id,
          mode: "exec",
        })
      ).session_id,
      marker = "LIFECYCLE_FRESH_" + crypto.randomUUID().replaceAll("-", "");
    let result = await client.tool("connector_exec", {
      session_id: sid,
      command: "printf '%s\\n' '" + marker + "'",
      mode: "posix",
      timeout_ms: 10000,
      wait_ms: 0,
    });
    if (["starting", "running"].includes(result.state))
      result = { ...result, ...(await client.done(result.command_id, 15000)) };
    assert(
      result.state === "completed" &&
        result.exit_code === 0 &&
        !result.requires_idle_ack,
    );
    const page = await client.tool("connector_read", {
      command_id: result.command_id,
      max_bytes: 65536,
    });
    assert.equal(page.text.trim(), marker);
    await client.tool("connector_close", { session_id: sid });
    receipt.checks.push("fresh generation executes exactly one unique marker");
    receipt.passed = true;
  } catch (e) {
    receipt.error_type = e.name;
    throw e;
  } finally {
    await client.close();
    receipt.wall_seconds = (Date.now() - start) / 1000;
    writeJSON(a.output, receipt);
    writeJSON(path.join(dir, "status.json"), {
      stage: "finished",
      passed: receipt.passed,
    });
  }
  console.log("PASS: native disconnect/reconnect lifecycle");
}
if (require.main === module)
  run(args()).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { run };
