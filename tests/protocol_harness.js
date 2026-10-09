"use strict";
const { MCP, fixture, assert } = require("./node_harness");
const SUPPORTED = ["2026-07-28", "2025-11-25"];
const meta = (version = "2026-07-28") => ({
  "io.modelcontextprotocol/protocolVersion": version,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "protocol-consistency",
    version: "1",
  },
});
async function run(binary) {
  const f = await fixture(binary);
  try {
    let m = new MCP(binary, f.env);
    let d = await m.request("server/discover", { _meta: meta() });
    assert.deepEqual(d.result.supportedVersions, SUPPORTED);
    assert.equal(d.result.resultType, "complete");
    assert.equal(d.result.cacheScope, "private");
    assert.equal(d.result.ttlMs, 0);
    assert.equal(
      (await m.request("tools/list", { _meta: meta() })).result.tools.length,
      17,
    );
    for (const version of ["1900-01-01", "2025-06-18", "2027-01-01"]) {
      const r = await m.request("tools/list", { _meta: meta(version) });
      assert.equal(r.error.code, -32022);
      assert.deepEqual(r.error.data, {
        supported: SUPPORTED,
        requested: version,
      });
    }
    for (const bad of [
      {},
      { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
      { ...meta(), "io.modelcontextprotocol/protocolVersion": 123 },
      { ...meta(), "io.modelcontextprotocol/clientCapabilities": "malformed" },
    ])
      assert.equal(
        (
          await m.request("tools/call", {
            _meta: bad,
            name: "connector_list",
            arguments: {},
          })
        ).error.code,
        -32602,
      );
    assert.equal(
      (await m.request("tools/list", { _meta: meta("2025-11-25") })).error.code,
      -32600,
    );
    assert.equal(
      (await m.request("tools/list", { _meta: meta() })).result.tools.length,
      17,
    );
    const denied = await m.request("tools/call", {
      _meta: meta(),
      name: "connector_open",
      arguments: {
        backend: "openssh",
        target: "-untrusted-option",
        mode: "exec",
      },
    });
    assert.equal(denied.error.code, -32602);
    await m.close();
    m = await new MCP(binary, f.env).start();
    const list = (await m.request("tools/list")).result;
    assert.equal(list.tools.length, 17);
    assert(!("resultType" in list));
    await m.close();
    for (const version of ["1900-01-01", "2025-06-18", "2026-07-28"]) {
      m = new MCP(binary, f.env);
      const r = await m.request("initialize", {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: "legacy", version: "1" },
      });
      assert.equal(r.error.code, version === "2026-07-28" ? -32600 : -32022);
      if (version === "2026-07-28")
        assert(r.error.message.includes("server/discover"));
      m.process.stdin.end();
      await new Promise((resolve) => m.process.once("close", resolve));
    }
    assert.equal(f.bridge.sent.length, 0);
    console.log(
      "PASS: legacy and modern wire shapes, discovery, per-request metadata/version, OpenSSH option rejection",
    );
  } finally {
    await f.close();
  }
}
if (require.main === module)
  run(process.argv[2]).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { run };
