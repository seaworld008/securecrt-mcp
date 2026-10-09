#!/usr/bin/env node
"use strict";
const { observeOriginalPrompt } = require("./securecrt_desktop_smoke");
const { assert } = require("./node_harness");
async function readOnce(client, session_id, prompt) {
  const view = await client.tool("connector_read_screen", { session_id });
  return { view, matched: view.current_line === prompt, reads: 1, wall_ms: 0 };
}
function fixture(lines, { rpc_ms = 0, error = false } = {}) {
  let elapsed = 0;
  const calls = [];
  let index = 0;
  return {
    calls,
    timing: {
      now: () => elapsed,
      wait: async (ms) => {
        assert(ms > 0 && ms <= 50);
        elapsed += ms;
      },
    },
    client: {
      async tool(name, params) {
        assert.equal(
          name,
          "connector_read_screen",
          "observer sent/acknowledged/replayed a business command",
        );
        assert.deepEqual(params, { session_id: "fixture-session" });
        calls.push(name);
        elapsed += rpc_ms;
        if (error) throw new Error("read-only transport failure");
        return {
          current_line: lines[Math.min(index++, lines.length - 1)],
          screen_token: "fixture-token",
        };
      },
    },
  };
}
async function run(observer = observeOriginalPrompt) {
  const delayed = fixture(["", "", "user$"]);
  const restored = await observer(
    delayed.client,
    "fixture-session",
    "user$",
    delayed.timing,
  );
  assert.equal(
    restored.matched,
    true,
    "delayed empty frames must settle to the exact original prompt",
  );
  assert.equal(restored.view.current_line, "user$");
  assert.equal(restored.reads, 3);
  assert.equal(restored.wall_ms, 100);
  console.log(
    "PASS: delayed empty -> empty -> exact original prompt, bounded read-only observation",
  );
  for (const lines of [[""], ["unexpected$"], ["user$ "]]) {
    const f = fixture(lines),
      result = await observer(f.client, "fixture-session", "user$", f.timing);
    assert.equal(
      result.matched,
      false,
      "unexpected/empty/whitespace-different prompt must not be accepted",
    );
    assert.equal(result.wall_ms, 3000);
    assert.equal(result.reads, f.calls.length);
    assert(result.reads <= 61);
    assert(f.calls.every((name) => name === "connector_read_screen"));
    console.log(
      "PASS: persistent " +
        JSON.stringify(lines[0]) +
        " fails within unchanged 3000ms observation budget",
    );
  }
  const late = fixture(["user$"], { rpc_ms: 3001 }),
    expired = await observer(
      late.client,
      "fixture-session",
      "user$",
      late.timing,
    );
  assert.equal(
    expired.matched,
    false,
    "an RPC returning the correct prompt after the observation deadline must not pass",
  );
  assert.equal(late.calls.length, 1);
  const broken = fixture([""], { error: true });
  await assert.rejects(
    () => observer(broken.client, "fixture-session", "user$", broken.timing),
    /transport failure/,
  );
  assert.equal(
    broken.calls.length,
    1,
    "transport error triggered retry/fallback",
  );
  console.log(
    "PASS: late RPC does not extend budget; read failure has no retry, ack, send, interrupt or replay",
  );
}
if (require.main === module)
  run(
    process.argv.includes("--baseline") ? readOnce : observeOriginalPrompt,
  ).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { run };
