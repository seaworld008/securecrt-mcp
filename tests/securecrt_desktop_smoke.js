#!/usr/bin/env node
"use strict";
const { MCP, sleep, args, writeJSON, assert, hash } = require("./node_harness");
async function run(a) {
  const backend = Array.isArray(a.backend)
      ? a.backend[0]
      : a.backend || "securecrt",
    mcp = await new MCP(a._[0], process.env, a.protocol || "legacy").start(),
    opened = [];
  const report = {
    scope: "real MCP / native desktop / SSH",
    backend,
    protocol: a.protocol || "legacy",
    binary_sha256: hash(a._[0]),
    checks: [],
  };
  const check = (name, condition) => {
    if (!condition) report.failure = { check: name };
    assert(condition, name);
    report.checks.push(name);
    console.log("PASS: " + name);
  };
  async function open(target) {
    const v = await mcp.tool("connector_open", {
      backend,
      target,
      mode: "exec",
    });
    assert(v.session_id, "attach failed; inspect original terminal; no retry");
    opened.push(v.session_id);
    return v.session_id;
  }
  async function execute(sid, command, options = {}) {
    const start = Date.now();
    let v = await mcp.tool("connector_exec", {
      session_id: sid,
      command,
      mode: "posix",
      timeout_ms: 10000,
      wait_ms: 0,
      ...options,
    });
    if (["starting", "running"].includes(v.state))
      v = { ...v, ...(await mcp.done(v.command_id)) };
    if (!v.command_id) return v;
    const page = await mcp.tool("connector_read", {
      command_id: v.command_id,
      max_bytes: options.max_bytes || 65536,
    });
    return { ...v, ...(page.output || page), wall_ms: Date.now() - start };
  }
  try {
    const tools = (await mcp.request("tools/list")).result.tools;
    check(
      "unified connector tool discovery",
      tools.every((t) => t.name.startsWith("connector_")),
    );
    const listed = await mcp.tool("connector_list");
    check(
      "explicit connected target",
      listed[backend].some((s) => s.id === a.session && s.connected),
    );
    let sid = await open(a.session);
    const screen = await mcp.tool("connector_read_screen", { session_id: sid }),
      prompt = screen.current_line;
    check(
      "fresh native screen and idle prompt",
      !!screen.screen_token && /[#$%]$/.test(prompt),
    );
    const first = await execute(sid, "printf 'SCRT_MCP_DESKTOP_OK\\n'", {
      operation_id: "desktop-dedup",
    });
    check(
      "POSIX marker completion",
      first.state === "completed" &&
        first.exit_code === 0 &&
        first.text.includes("SCRT_MCP_DESKTOP_OK"),
    );
    const again = await execute(sid, "printf 'SCRT_MCP_DESKTOP_OK\\n'", {
      operation_id: "desktop-dedup",
    });
    check(
      "same operation returns same command without replay",
      first.command_id === again.command_id,
    );
    let v = await execute(sid, "printf '中文_no_newline'");
    check(
      "Unicode and no-newline capture",
      v.state === "completed" && v.text.includes("中文_no_newline"),
    );
    v = await execute(sid, "sh -c 'exit 7'");
    check(
      "nonzero exit code retained",
      v.state === "completed" && v.exit_code === 7,
    );
    let batch = await mcp.tool("connector_exec_batch", {
      session_id: sid,
      commands: ["hostname", "uptime", "pwd"],
    });
    const until = Date.now() + 20000;
    while (batch.state === "running" && Date.now() < until) {
      await sleep(20);
      batch = await mcp.tool("connector_get_batch_status", {
        batch_id: batch.batch_id,
      });
    }
    report.diagnostics_batch = {
      state: batch.state,
      results: batch.results?.map((v) =>
        Object.fromEntries(
          ["state", "exit_code", "sent", "error_code", "requires_idle_ack"].map(
            (k) => [k, v[k]],
          ),
        ),
      ),
    };
    check(
      "three-command diagnostics batch",
      batch.state === "completed" &&
        batch.results.length === 3 &&
        batch.results.every((r) => r.exit_code === 0),
    );
    const timings = [];
    for (let i = 0; i < 20; i++) {
      const marker = "DESKTOP_REUSE_" + String(i).padStart(2, "0");
      v = await execute(sid, "printf '" + marker + "\\n'");
      if (v.state !== "completed")
        report.failure = {
          phase: "continuous_reuse",
          index: i,
          state: v.state,
          sent: v.sent,
          error_code: v.error_code,
        };
      assert(
        v.state === "completed" && v.exit_code === 0 && v.text.includes(marker),
        "continuous reuse failed; no replay",
      );
      timings.push(v.wall_ms);
    }
    check(
      "twenty consecutive commands retain original attachment",
      timings.length === 20,
    );
    const sorted = [...timings].sort((a, b) => a - b);
    report.short_command_wall_ms = {
      median: sorted[10],
      p95: sorted[18],
      samples: timings,
    };
    v = await execute(
      sid,
      "awk 'BEGIN {for (i=0;i<2500;i++) printf \"%04d_中文_0123456789abcdef\\n\", i}'",
      { max_bytes: 1024 },
    );
    report.large_output_capture = Object.fromEntries(
      [
        "state",
        "exit_code",
        "sent",
        "error_code",
        "requires_idle_ack",
        "wall_ms",
      ].map((k) => [k, v[k]]),
    );
    let pages = 1,
      text = v.text,
      cursor = v.next_cursor;
    while (cursor !== null && cursor !== undefined) {
      const page = await mcp.tool("connector_read", {
        command_id: v.command_id,
        cursor,
        max_bytes: 1024,
      });
      text += (page.output || page).text;
      cursor = (page.output || page).next_cursor;
      assert(++pages < 200, "pagination bound");
    }
    const lines = text
        .split(/\r?\n/)
        .filter((x) => x.trim())
        .map((x) => x.trimEnd()),
      expected = Array.from(
        { length: 2500 },
        (_, i) => String(i).padStart(4, "0") + "_中文_0123456789abcdef",
      );
    const exact = JSON.stringify(lines) === JSON.stringify(expected);
    report.large_output_integrity = {
      rows: lines.length,
      expected_rows: 2500,
      exact_ordered_rows: exact,
    };
    check(
      "large UTF-8 output pagination",
      v.state === "completed" &&
        !v.requires_idle_ack &&
        pages > 1 &&
        text.includes("0000_中文_") &&
        text.includes("2499_中文_") &&
        !v.truncated,
    );
    check(
      "all 2500 UTF-8 rows match exactly in order without loss or duplicates",
      exact,
    );
    report.large_output = {
      pages,
      bytes: Buffer.byteLength(text),
      capture_budget_ms: 10000,
      wall_ms_to_first_page: v.wall_ms,
    };
    v = await execute(sid, "printf 'SHOULD_NOT_SEND'", {
      expected_prompt: "not-the-real-prompt",
    });
    check(
      "wrong prompt rejected before native send",
      v.state === "rejected" && v.sent === false,
    );
    check(
      "attachment heartbeat",
      (await mcp.tool("connector_heartbeat", { session_id: sid }))
        .unresolved === null,
    );
    if (a.peer) {
      const peer = await open(a.peer);
      const first = await mcp.tool("connector_exec", {
          session_id: sid,
          command: "sleep 1; printf 'TAB_A\\n'",
          mode: "posix",
          wait_ms: 0,
          timeout_ms: 10000,
        }),
        second = await mcp.tool("connector_exec", {
          session_id: peer,
          command: "printf 'TAB_B\\n'",
          mode: "posix",
          wait_ms: 0,
          timeout_ms: 10000,
        });
      check(
        "independent tab completion",
        (await mcp.done(first.command_id)).exit_code === 0 &&
          (await mcp.done(second.command_id)).exit_code === 0,
      );
    }
    if (a.exercise_recovery) {
      v = await mcp.tool("connector_exec", {
        session_id: sid,
        command: "sleep 2",
        mode: "posix",
        timeout_ms: 1000,
        wait_ms: 10000,
      });
      report.timeout_probe = Object.fromEntries(
        ["state", "exit_code", "sent", "error_code", "requires_idle_ack"].map(
          (k) => [k, v[k]],
        ),
      );
      check(
        "timeout preserves uncertainty",
        ["timed_out", "unknown"].includes(v.state) && v.requires_idle_ack,
      );
      await sleep(2000);
      let view = await mcp.tool("connector_read_screen", { session_id: sid });
      check(
        "original prompt restored after finite sleep",
        view.current_line === prompt,
      );
      v = await execute(sid, "printf 'BUSY_SHOULD_NOT_SEND'");
      check(
        "unresolved session refuses new input",
        v.state === "rejected" && v.sent === false,
      );
      view = await mcp.tool("connector_read_screen", { session_id: sid });
      const refused = await mcp.tool(
        "connector_acknowledge",
        {
          session_id: sid,
          confirmed_idle: false,
          screen_token: view.screen_token,
          expected_prompt: prompt,
        },
        true,
      );
      check(
        "false idle confirmation cannot clear uncertainty",
        refused.error.message.includes("confirmed_idle"),
      );
      let ack = await mcp.tool("connector_acknowledge", {
        session_id: sid,
        confirmed_idle: true,
        screen_token: view.screen_token,
        expected_prompt: prompt,
      });
      check("explicit recovery with fresh context", ack.idle_acknowledged);
      opened.splice(opened.indexOf(sid), 1);
      sid = await open(a.session);
      v = await execute(sid, "printf 'RECOVERED\\n'");
      check(
        "new attachment works after recovery",
        v.state === "completed" && v.text.includes("RECOVERED"),
      );
      v = await mcp.tool("connector_exec", {
        session_id: sid,
        command: "sleep 10",
        mode: "posix",
        timeout_ms: 20000,
        wait_ms: 0,
      });
      await sleep(100);
      const interrupted = await mcp.tool("connector_interrupt", {
        command_id: v.command_id,
      });
      check(
        "explicit Ctrl+C on the tracked command",
        interrupted.interrupt_sent && !interrupted.remote_termination_confirmed,
      );
      check(
        "interrupt outcome retained",
        (await mcp.done(v.command_id)).state === "cancelled",
      );
      const until = Date.now() + 3000;
      do {
        view = await mcp.tool("connector_read_screen", { session_id: sid });
        if (view.current_line === prompt || Date.now() >= until) break;
        await sleep(50);
      } while (true);
      check(
        "idle prompt after explicit interrupt",
        view.current_line === prompt,
      );
      ack = await mcp.tool("connector_acknowledge", {
        session_id: sid,
        confirmed_idle: true,
        screen_token: view.screen_token,
        expected_prompt: prompt,
      });
      check("explicit post-interrupt recovery", ack.idle_acknowledged);
      opened.splice(opened.indexOf(sid), 1);
    }
    report.passed = true;
    return report;
  } catch (e) {
    report.passed = false;
    report.error_type = e.name;
    if (a.output) writeJSON(a.output, report);
    throw e;
  } finally {
    for (const sid of opened)
      await mcp.tool("connector_close", { session_id: sid });
    await mcp.close();
  }
}
if (require.main === module) {
  const a = args();
  run(a)
    .then((v) => {
      if (a.output) writeJSON(a.output, v);
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
module.exports = { run };
