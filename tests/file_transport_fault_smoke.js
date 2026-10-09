#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  {
    MCP,
    FakeBridge,
    assert,
    command,
    readJSON,
    writeJSON,
    sleep,
  } = require("./node_harness");
class FileAdapter {
  constructor(root, token) {
    this.instance = crypto.randomUUID();
    this.directory = path.join(root, "instances", this.instance);
    fs.mkdirSync(this.directory, { recursive: true });
    this.token = token;
    this.fake = new FakeBridge();
    this.calls = [];
    this.blockedUntil = 0;
    this.gapSeconds = 0;
    this.working = false;
    this.publish();
    this.timer = setInterval(
      () => this.tick().catch((e) => (this.error = e)),
      2,
    );
  }
  publish() {
    writeJSON(path.join(this.directory, "ready.tmp"), {
      protocol_version: 2,
      bridge_instance: this.instance,
      last_poll_ms: Date.now(),
    });
    try {
      fs.renameSync(
        path.join(this.directory, "ready.tmp"),
        path.join(this.directory, "ready.json"),
      );
    } catch (e) {
      if (e.code !== "EPERM" && e.code !== "EACCES") throw e;
    }
  }
  pause(kind, seconds) {
    this.blockedUntil = Date.now() + seconds * 1000;
    const ready = path.join(this.directory, "ready.json");
    if (kind === "incomplete-json") fs.writeFileSync(ready, "{");
    else fs.rmSync(ready, { force: true });
  }
  async tick() {
    if (this.working) return;
    this.working = true;
    try {
      if (Date.now() >= this.blockedUntil) this.publish();
      for (const name of fs
        .readdirSync(this.directory)
        .filter((x) => x.endsWith(".request.json"))) {
        const file = path.join(this.directory, name),
          q = readJSON(file);
        fs.unlinkSync(file);
        assert.equal(q.token, this.token);
        assert(q.deadline_ms > Date.now());
        const response = {
          protocol_version: 2,
          bridge_instance: this.instance,
          id: q.id,
          ok: false,
          result: null,
          error: null,
        };
        try {
          this.calls.push(q.method);
          let result =
            q.method === "list_sessions"
              ? {
                  sessions: [
                    { id: this.instance + "/session/1", connected: true },
                  ],
                }
              : await this.fake.method(q.method, q.params);
          if (q.method === "attach")
            result.attachment_id = this.instance + "/attachment/1";
          if (q.method === "prepare_and_begin" && this.gapSeconds)
            this.pause(this.gapKind, this.gapSeconds);
          response.result = result;
          response.ok = true;
        } catch (e) {
          response.error = e.message;
        }
        const tmp = path.join(this.directory, q.id + ".response.tmp");
        writeJSON(tmp, response);
        fs.renameSync(tmp, path.join(this.directory, q.id + ".response.json"));
      }
    } finally {
      this.working = false;
    }
  }
  close() {
    clearInterval(this.timer);
    assert(!this.error, this.error?.message);
  }
}
async function run(binary) {
  for (const backend of ["securecrt", "xshell"])
    for (const gap of ["missing", "incomplete-json"]) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "securecrt-file-")),
        env = { ...process.env, SECURECRT_MCP_HOME: home };
      let m, a, b;
      try {
        assert.equal((await command(binary, ["init"], env)).code, 0);
        const cfg = path.join(home, "config.toml");
        fs.writeFileSync(
          cfg,
          fs
            .readFileSync(cfg, "utf8")
            .replace('mode = "client"', 'mode = "unrestricted"'),
        );
        const secretFile = path.join(
            home,
            backend === "securecrt" ? "bridge.json" : "xshell_bridge.json",
          ),
          // Mac init intentionally does not deploy an Xshell endpoint. This is an
          // explicitly constructed developer fixture, not a production fallback.
          secret = readJSON(
            fs.existsSync(secretFile)
              ? secretFile
              : path.join(home, "bridge.json"),
          ),
          ipc = path.join(home, backend + "-fixture-ipc");
        secret.ipc_dir = ipc;
        writeJSON(secretFile, secret);
        a = new FileAdapter(ipc, secret.token);
        b = new FileAdapter(ipc, secret.token);
        m = await new MCP(binary, env).start();
        const sid = (
          await m.tool("connector_open", {
            backend,
            target: a.instance + "/session/1",
            mode: "exec",
          })
        ).session_id;
        a.gapKind = gap;
        a.gapSeconds = 0.08;
        let v = await m.tool("connector_exec", {
          session_id: sid,
          command: "printf route-once",
          mode: "posix",
          timeout_ms: 2000,
          wait_ms: 3000,
        });
        if (["running", "starting"].includes(v.state))
          v = await m.done(v.command_id);
        assert.equal(v.state, "completed");
        assert.equal(v.exit_code, 0);
        assert.equal(a.fake.sent.length, 1);
        assert.equal(b.fake.sent.length, 0);
        assert(a.calls.includes("poll_bulk") || a.calls.includes("poll"));
        assert(
          !b.calls.some((x) =>
            ["poll_bulk", "poll", "prepare_and_begin", "begin"].includes(x),
          ),
        );
        a.pause("missing", 2);
        const before = [...b.calls];
        await m.tool("connector_read_screen", { session_id: sid }, true);
        assert.deepEqual(b.calls, before, "offline route substituted");
        console.log(
          "PASS: " +
            backend +
            " / " +
            gap +
            " publication gap, original route one send, offline fails closed",
        );
      } finally {
        if (m) await m.close();
        if (a) a.close();
        if (b) b.close();
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
}
if (require.main === module)
  run(process.argv[2]).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { run, FileAdapter };
