"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net"),
  { SecureCRTClient } = require("../clients/persistent_client"),
  { assert, writeJSON } = require("./node_harness");
async function run() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "client-contract-"));
  try {
    const file = path.join(home, "daemon.json"),
      client = new SecureCRTClient(home);
    for (const port of [1, 65536, "1234", null]) {
      writeJSON(file, { port, token: "fixture" });
      await assert.rejects(() => client.sessions(), /invalid daemon port/);
    }
    for (const kind of [
      "mismatch",
      "oversized",
      "unterminated",
      "error",
      "success",
    ]) {
      let calls = 0;
      const server = net.createServer((socket) => {
        socket.on("data", (b) => {
          calls++;
          const q = JSON.parse(b);
          if (kind === "oversized") socket.end("x".repeat(262145) + "\n");
          else if (kind === "unterminated") socket.end("{}");
          else
            socket.end(
              JSON.stringify({
                id: kind === "mismatch" ? "wrong" : q.id,
                ok: kind !== "error",
                error: "fixture-denial",
                result: { fixture: true },
              }) + "\n",
            );
        });
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      writeJSON(file, { port: server.address().port, token: "fixture" });
      if (kind === "success")
        assert.deepEqual(await client.sessions(), { fixture: true });
      else await assert.rejects(() => client.sessions());
      assert.equal(calls, 1, "client retried uncertain call");
      await new Promise((r) => server.close(r));
    }
    writeJSON(file, { port: 1234, token: "fixture" });
    await assert.rejects(
      () => client.call("exec", { text: "x".repeat(262144) }),
      /too large/,
    );
    if (process.platform !== "win32") {
      fs.renameSync(file, path.join(home, "actual.json"));
      fs.symlinkSync("actual.json", file);
      await assert.rejects(() => client.sessions(), /symlink/);
    }
    console.log(
      "PASS: Node daemon client endpoint validation, framing, identity, error, oversize, no retry, symlink",
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}
if (require.main === module)
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { run };
