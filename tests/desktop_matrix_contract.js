#!/usr/bin/env node
"use strict";
const { isolation } = require("./desktop_matrix");
const { assert, fixture, MCP } = require("./node_harness");
class IsolationDouble {
  constructor(mode) {
    this.mode = mode;
    this.opened = [];
    this.dispatches = [];
    this.waiters = [];
    this.closed = [];
    this.statusCalls = 0;
  }
  async tool(name, p) {
    if (name === "connector_open") {
      this.opened.push(p.target);
      return { session_id: "private-binding-" + this.opened.length };
    }
    if (name === "connector_exec") {
      assert.equal(
        this.opened.length,
        2,
        "dispatch occurred before all attachments existed",
      );
      assert(p.command.startsWith("sleep 3; printf "));
      assert.equal(p.timeout_ms, 10000);
      assert.equal(p.wait_ms, 0);
      const marker = p.command.match(/'(MATRIX_ISOLATION_[^']+)'$/)[1],
        index = this.dispatches.length;
      this.dispatches.push({ id: "private-job-" + index, marker });
      // Neither submission resolves until both are submitted: the controller
      // must dispatch concurrently through its one MCP client.
      return new Promise((resolve) => {
        this.waiters.push(() =>
          resolve({
            command_id: "private-job-" + index,
            sent: true,
            state: "running",
          }),
        );
        if (this.waiters.length === 2) this.waiters.forEach((ready) => ready());
      });
    }
    if (name === "connector_get_status") {
      this.statusCalls++;
      return {
        state:
          this.mode === "sequential" && p.command_id === "private-job-0"
            ? "completed"
            : "running",
      };
    }
    if (name === "connector_read") {
      const job = this.dispatches.find((j) => j.id === p.command_id);
      return {
        text:
          this.mode === "cross-talk"
            ? this.dispatches.map((j) => j.marker).join("\n")
            : job.marker + "\n",
      };
    }
    if (name === "connector_close") {
      this.closed.push(p.session_id);
      return { closed: true };
    }
    throw new Error("unexpected method " + name);
  }
  async done() {
    return { state: "completed", exit_code: 0 };
  }
  async close() {
    this.processClosed = true;
  }
}
async function run() {
  for (const mode of ["overlap", "sequential", "cross-talk"]) {
    const client = new IsolationDouble(mode);
    let watchdog;
    const result = await Promise.race([
      isolation(
        "unused-binary",
        "securecrt",
        [{ target: "private-target-a" }, { target: "private-target-b" }],
        async () => client,
      ),
      new Promise((_, reject) => {
        watchdog = setTimeout(
          () =>
            reject(
              new Error("dispatch was serialized or controller did not settle"),
            ),
          2000,
        );
      }),
    ]).finally(() => clearTimeout(watchdog));
    assert.equal(result.passed, mode === "overlap");
    assert.equal(client.dispatches.length, 2, "command was replayed");
    assert.equal(client.closed.length, 2);
    assert(client.processClosed);
    const evidence = result.overlap_evidence;
    assert.equal(evidence.submitted_count, 2);
    assert.equal(evidence.sent_count, 2);
    assert.equal(evidence.sleep_seconds, 3);
    assert.equal(evidence.capture_budget_ms, 10000);
    if (mode === "overlap") {
      assert(evidence.overlap_confirmed);
      assert.equal(evidence.overlap_running_count, 2);
    }
    if (mode === "sequential") {
      assert.equal(result.failed_step, "overlap");
      assert.equal(evidence.overlap_running_count, 1);
      assert.equal(result.automatic_retry, false);
    }
    if (mode === "cross-talk") assert.equal(result.failed_step, "read");
    const wire = JSON.stringify(result);
    assert(
      !wire.includes("private-"),
      "receipt leaked fixture target/attachment/job handles",
    );
    console.log(
      "PASS: isolation controller / " +
        mode +
        " / bounded sleep, concurrent dispatch, overlap gate, sanitized evidence, no replay",
    );
  }
}
if (require.main === module)
  run()
    .then(() => (process.argv[2] ? compiledOverlap(process.argv[2]) : null))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
module.exports = { run, compiledOverlap };

async function compiledOverlap(binary) {
  const f = await fixture(binary, { persistent: true });
  try {
    const original = f.bridge.method.bind(f.bridge);
    f.bridge.method = async (name, p) => {
      if (["begin", "prepare_and_begin"].includes(name)) {
        const response = await original(name, p);
        const active = f.bridge.active.get(p.capture_id);
        active.readyAt = Date.now() + 3000;
        return response;
      }
      if (["poll", "poll_bulk"].includes(name)) {
        const active = f.bridge.active.get(p.capture_id);
        assert(active);
        if (Date.now() < active.readyAt)
          return {
            text: "",
            overflow: false,
            expired: false,
            capture_may_be_incomplete: true,
          };
        const begin = active.text.match(/MCP_BEGIN_[a-f0-9]+/)[0],
          end = active.text.match(/MCP_END_[a-f0-9]+/)[0],
          marker = active.text.match(/MATRIX_ISOLATION_[0-9]+_[a-f0-9]+/)[0];
        return {
          text: begin + "\n" + marker + "\n" + end + " 0\n",
          overflow: false,
          expired: false,
          capture_may_be_incomplete: false,
        };
      }
      return original(name, p);
    };
    const targets = [
        { target: "fake-instance/fake-session-1" },
        { target: "fake-instance/fake-session-2" },
      ],
      result = await isolation(binary, "securecrt", targets, async () =>
        new MCP(binary, f.env).start(),
      );
    assert(result.passed, JSON.stringify(result));
    assert.equal(result.overlap_evidence.overlap_running_count, 2);
    assert.equal(result.overlap_evidence.sent_count, 2);
    assert.equal(f.bridge.sent.length, 2);
    assert.equal(f.bridge.interrupts.length, 0);
    console.log(
      "PASS: compiled MCP / real TCP fake bridge / two simultaneous running jobs / complete isolated markers / exactly two sends",
    );
  } finally {
    await f.close();
  }
}
