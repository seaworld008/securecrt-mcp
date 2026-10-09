"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  net = require("node:net"),
  crypto = require("node:crypto"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJSON = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const writeJSON = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
function args(argv = process.argv.slice(2)) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      result._.push(argv[i]);
      continue;
    }
    const key = argv[i].slice(2).replaceAll("-", "_");
    if (["all_idle", "exercise_recovery"].includes(key)) {
      result[key] = true;
      continue;
    }
    if (key === "backend") {
      result.backend = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--"))
        result.backend.push(argv[++i]);
      continue;
    }
    const value = argv[++i];
    assert(value !== undefined, "missing option " + key);
    if (key === "target") {
      (result.targets ??= []).push(value);
    }
    result[key] = value;
  }
  return result;
}
async function command(binary, argv, env = process.env, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, argv, { env, windowsHide: true });
    let stdout = "",
      stderr = "";
    const { StringDecoder } = require("node:string_decoder");
    const outDecoder = new StringDecoder("utf8"),
      errDecoder = new StringDecoder("utf8");
    proc.stdout.on("data", (b) => (stdout += outDecoder.write(b)));
    proc.stderr.on("data", (b) => (stderr += errDecoder.write(b)));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("ControllerTimeout; outcome unknown; no replay"));
    }, timeout);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
const modernMeta = () => ({
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "node-controller",
    version: "1",
  },
});
class MCP {
  constructor(binary, env = process.env, protocol = "legacy") {
    this.protocol = protocol;
    this.index = 0;
    this.pending = new Map();
    this.errors = "";
    this.process = spawn(path.resolve(binary), ["serve"], {
      env,
      windowsHide: true,
    });
    this.buffer = "";
    const decoder = new (require("node:string_decoder").StringDecoder)("utf8");
    this.process.stdout.on("data", (b) => {
      this.buffer += decoder.write(b);
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        try {
          const value = JSON.parse(line),
            wait = this.pending.get(value.id);
          if (wait) {
            this.pending.delete(value.id);
            clearTimeout(wait.timer);
            wait.resolve(value);
          }
        } catch (e) {
          this.fail(e);
        }
      }
    });
    this.process.stderr.on("data", (b) => (this.errors += b));
    this.process.on("error", (e) => this.fail(e));
    this.process.on("close", (code) => {
      this.exitCode = code;
      this.fail(new Error("MCP exited " + code));
    });
  }
  fail(error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  async start() {
    if (this.protocol === "modern") await this.request("server/discover", {});
    else {
      await this.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "node-controller", version: "1" },
      });
      this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    }
    return this;
  }
  send(value) {
    this.process.stdin.write(JSON.stringify(value) + "\n");
  }
  request(method, params = {}) {
    const id = ++this.index;
    if (this.protocol === "modern") params = { ...params, _meta: modernMeta() };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("MCP response timeout; outcome unknown; no retry"));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  async tool(name, params = {}, expectError = false) {
    const r = await this.request("tools/call", { name, arguments: params });
    const failed = !!r.error || !!r.result?.isError;
    if (expectError) {
      assert(failed, JSON.stringify(r));
      return r;
    }
    if (failed && r.error?.data?.state) return r.error.data;
    assert(!failed, JSON.stringify(r));
    return JSON.parse(r.result.content.find((c) => c.type === "text").text);
  }
  async done(command_id, timeout = 40000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const v = await this.tool("connector_get_status", { command_id });
      if (!["starting", "running"].includes(v.state)) return v;
      await sleep(20);
    }
    throw new Error("command did not settle; inspect original tab; no replay");
  }
  async close() {
    this.process.stdin.end();
    if (this.exitCode !== undefined) {
      assert.equal(this.exitCode, 0, this.errors);
      return;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.process.kill();
        reject(new Error("MCP shutdown timeout"));
      }, 5000);
      this.process.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error("MCP exited " + code + ": " + this.errors));
      });
    });
  }
}
const bytesPage = (v) => {
  v = v.output || v;
  return v.base64 !== undefined
    ? Buffer.from(v.base64, "base64")
    : Buffer.from(v.text || "", "utf8");
};
async function fixture(binary, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "securecrt-node-")),
    env = { ...process.env, SECURECRT_MCP_HOME: home },
    bridge = new FakeBridge(options);
  await bridge.start();
  const init = await command(binary, ["init"], env);
  assert.equal(init.code, 0, init.stderr);
  const secret = readJSON(path.join(home, "bridge.json"));
  secret.port = bridge.port;
  // Developer TCP doubles must explicitly select TCP even when Windows init defaults to native file IPC.
  secret.ipc_dir = null;
  writeJSON(path.join(home, "bridge.json"), secret);
  bridge.token = secret.token;
  const file = path.join(home, "config.toml");
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace("port = 27855", "port = " + bridge.port)
      .replace('mode = "client"', 'mode = "unrestricted"'),
  );
  return {
    home,
    env,
    bridge,
    async close() {
      await bridge.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
class FakeBridge {
  constructor(options = {}) {
    Object.assign(
      this,
      {
        sent: [],
        interrupts: [],
        active: new Map(),
        bindings: new Map(),
        protocol: 2,
        oversized: false,
        persistent: false,
        delay: 0,
      },
      options,
    );
    this.sockets = new Set();
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      let buffer = "";
      const decoder = new (require("node:string_decoder").StringDecoder)(
        "utf8",
      );
      socket.on("data", (chunk) => {
        buffer += decoder.write(chunk);
        let i;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          this.handle(socket, line);
        }
      });
      socket.on("error", () => {});
    });
  }
  async start() {
    await new Promise((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = this.server.address().port;
  }
  async close() {
    for (const s of this.sockets) s.destroy();
    await new Promise((r) => this.server.close(r));
  }
  async handle(socket, line) {
    let request, response;
    try {
      request = JSON.parse(line);
      response = {
        protocol_version: this.protocol,
        bridge_instance: "fake-instance",
        id: request.id,
        ok: false,
        result: null,
        error: null,
      };
      assert(request.deadline_ms > Date.now(), "expired request");
      assert(!this.token || request.token === this.token, "invalid token");
      response.result = await this.method(request.method, request.params || {});
      response.ok = true;
      response.persistent = this.persistent && !!request.keep_alive;
    } catch (e) {
      response ??= { protocol_version: 2, id: request?.id, ok: false };
      response.error = e.message;
      response.error_code = e.message.split(":")[0];
      response.sent = false;
    }
    if (this.dropReply) {
      this.dropReply = false;
      return socket.destroy();
    }
    if (this.delay) await sleep(this.delay);
    const wire = Buffer.from(
      this.oversized
        ? "x".repeat(270000) + "\n"
        : JSON.stringify(response) + "\n",
    );
    if (this.fragmentReplies) {
      const utf8 = wire.findIndex((byte) => byte >= 128);
      const cuts = [1, 17, ...(utf8 >= 17 ? [utf8 + 1] : []), wire.length];
      let offset = 0;
      for (const end of cuts) {
        socket.write(wire.subarray(offset, end));
        offset = end;
        await sleep(1);
      }
      this.fragmentedResponses = (this.fragmentedResponses || 0) + 1;
      if (utf8 >= 17)
        this.fragmentedUTF8Responses = (this.fragmentedUTF8Responses || 0) + 1;
    } else socket.write(wire);
  }
  async method(name, p) {
    if (name === "poll_bulk") name = "poll";
    if (name === "ping")
      return {
        bridge_version: fs
          .readFileSync(path.join(ROOT, "Cargo.toml"), "utf8")
          .match(/^version = "([^"]+)"/m)[1],
        protocol_version: 2,
        python: "3.11.17",
        securecrt_version: "9.5.2",
        adapter_sha256: hash(path.join(ROOT, "bridge/securecrt_bridge.py")),
        api_capabilities: Object.fromEntries(
          readJSON(
            path.join(ROOT, "support/policy.json"),
          ).required_apis.securecrt.map((k) => [k, true]),
        ),
        capabilities: [
          "attachments",
          "prepare_and_begin",
          "poll_bulk",
          ...(this.persistent ? ["persistent_ndjson"] : []),
        ],
      };
    if (name === "list_sessions")
      return {
        sessions: [1, 2].map((i) => ({
          id: "fake-instance/fake-session-" + i,
          caption: "test " + i,
          connected: true,
        })),
      };
    if (name === "read_screen")
      return {
        text: "test output\nuser$ ",
        current_line: this.currentLine || "user$",
        screen_token: "test-token",
      };
    if (name === "attach") {
      const id = "fake-attachment-" + crypto.randomUUID();
      this.bindings.set(id, p.session);
      return {
        attachment_id: id,
        session: p.session,
        mode: p.mode || "shared",
        current_line: "user$",
      };
    }
    if (name === "heartbeat")
      return {
        attachment_id: p.attachment_id,
        session: this.bindings.get(p.attachment_id),
        unresolved: null,
      };
    if (name === "detach")
      return { detached: true, attachment_id: p.attachment_id };
    if (["prepare_and_begin", "begin"].includes(name)) {
      if (this.currentLine && this.currentLine !== "user$")
        throw new Error("input_context_required: inspect original terminal");
      if (p.expected_prompt && p.expected_prompt !== "user$")
        throw new Error("context_changed: wrong prompt");
      if (this.fault === "stale") {
        this.fault = null;
        throw new Error("stale_screen: changed");
      }
      const sid = this.bindings.get(p.attachment_id) || p.session || "default";
      assert(![...this.active.values()].some((v) => v.sid === sid), "busy");
      if (p.text.includes("grace-command")) this.graceUntil = Date.now() + 250;
      this.sent.push(p.text);
      this.active.set(p.capture_id, { ...p, sid });
      if (this.fault === "lost") {
        this.fault = null;
        this.dropReply = true;
      }
      if (this.fault === "no-send-evidence") {
        this.fault = null;
        return {};
      }
      return { sent: true, capture_id: p.capture_id };
    }
    if (name === "poll") {
      const v = this.active.get(p.capture_id);
      assert(v, "capture_mismatch");
      if (Date.now() < (this.graceUntil || 0))
        return {
          text: "",
          overflow: false,
          expired: false,
          capture_may_be_incomplete: true,
        };
      if (v.text.includes("slow-command") && this.pollDelay)
        await sleep(this.pollDelay);
      if (v.text.includes("slow-command"))
        return {
          text: "",
          overflow: false,
          expired: false,
          capture_may_be_incomplete: true,
        };
      const begin = v.text.match(/MCP_BEGIN_[a-f0-9]+/),
        end = v.text.match(/MCP_END_[a-f0-9]+/);
      const output = v.text.includes("many-lines")
        ? ("log-line " + "x".repeat(118) + "\n").repeat(1600)
        : v.text.includes("long-line")
          ? "中".repeat(70000)
          : v.text.includes("large-output")
            ? "中".repeat(3000)
            : "hello";
      return {
        text:
          begin && end
            ? "echoed input\n" +
              begin[0] +
              "\r\n" +
              output +
              "\r\n" +
              end[0] +
              " 0\r\n"
            : "ordinary output\nuser$",
        overflow: false,
        expired: false,
        capture_may_be_incomplete: false,
      };
    }
    if (name === "end") {
      this.active.delete(p.capture_id);
      return {
        released: true,
        unresolved: !p.confirmed_complete,
        restore_errors: [],
      };
    }
    if (name === "interrupt") {
      this.interrupts.push(p.capture_id);
      this.active.delete(p.capture_id);
      return { interrupt_sent: true, remote_termination_confirmed: false };
    }
    if (name === "acknowledge_idle") return { idle_acknowledged: true };
    if (name === "focus_session") return { focused: true };
    throw new Error("unknown/forbidden method " + name);
  }
}
module.exports = {
  ROOT,
  MCP,
  FakeBridge,
  fixture,
  sleep,
  hash,
  readJSON,
  writeJSON,
  args,
  command,
  bytesPage,
  assert,
};
