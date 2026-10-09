"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  net = require("node:net"),
  { randomUUID } = require("node:crypto");
class SecureCRTClient {
  constructor(
    home = process.env.SECURECRT_MCP_HOME ||
      path.join(os.homedir(), ".securecrt-mcp"),
  ) {
    this.home = home;
  }
  async call(method, params = {}) {
    const file = path.join(this.home, "daemon.json");
    if (fs.lstatSync(file).isSymbolicLink())
      throw new Error("refusing symlink daemon endpoint");
    const endpoint = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      !Number.isInteger(endpoint.port) ||
      endpoint.port < 1024 ||
      endpoint.port > 65535
    )
      throw new Error("invalid daemon port");
    const id = randomUUID(),
      payload = Buffer.from(
        JSON.stringify({ id, token: endpoint.token, method, params }) + "\n",
      );
    if (payload.length > 262144) throw new Error("request too large");
    return new Promise((resolve, reject) => {
      const stream = net.createConnection({
        host: "127.0.0.1",
        port: endpoint.port,
      });
      let data = Buffer.alloc(0),
        settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        reject(error);
      };
      stream.setTimeout(2000, () =>
        fail(new Error("response timeout; outcome unknown; no retry")),
      );
      stream.once("connect", () => {
        stream.setTimeout(75000);
        stream.write(payload);
      });
      stream.on("error", fail);
      stream.on("end", () =>
        fail(new Error("invalid reply; outcome unknown; no retry")),
      );
      stream.on("data", (chunk) => {
        data = Buffer.concat([data, chunk]);
        const end = data.indexOf(10);
        if (end < 0) {
          if (data.length > 262144)
            fail(new Error("oversized reply; outcome unknown; no retry"));
          return;
        }
        if (end + 1 > 262144)
          return fail(new Error("oversized reply; outcome unknown; no retry"));
        try {
          const value = JSON.parse(data.subarray(0, end).toString("utf8"));
          if (value.id !== id)
            throw new Error("response mismatch; do not replay");
          if (!value.ok) throw new Error(value.error);
          settled = true;
          stream.destroy();
          resolve(value.result);
        } catch (error) {
          fail(error);
        }
      });
    });
  }
  sessions() {
    return this.call("sessions");
  }
  attach(session, mode = "shared", expected_prompt = null) {
    return this.call("attach", { session, mode, expected_prompt });
  }
  execute(attachment_id, command, mode = "posix", options = {}) {
    return this.call("exec", { attachment_id, command, mode, ...options });
  }
  output(command_id, options = {}) {
    return this.call("output", { command_id, ...options });
  }
  detach(attachment_id) {
    return this.call("detach", { attachment_id });
  }
}
module.exports = { SecureCRTClient };
