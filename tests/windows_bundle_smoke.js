"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  { assert, hash } = require("./node_harness"),
  { manifest } = require("../scripts/package_release");

async function run(binary) {
  if (process.platform !== "win32") {
    console.log("SKIP: Windows CMD installation requires Windows");
    return;
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-bundle-")),
    bundle = path.join(sandbox, "新用户 package with spaces"),
    app = path.join(sandbox, "application"),
    codex = path.join(sandbox, "codex"),
    env = { ...process.env, USERPROFILE: path.join(sandbox, "profile"),
      CODEX_HOME: codex, SECURECRT_MCP_HOME: app };
  function launch(name, selectedEnv = env) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", `""${path.join(bundle, name)}" <NUL"`],
        { env: selectedEnv, windowsHide: true, windowsVerbatimArguments: true });
      let stdout = "", stderr = "";
      child.stdout.on("data", b => stdout += b);
      child.stderr.on("data", b => stderr += b);
      const timer = setTimeout(() => { child.kill(); reject(new Error("CMD timeout")); }, 45000);
      child.on("error", e => { clearTimeout(timer); reject(e); });
      child.on("close", code => { clearTimeout(timer); resolve({code, stdout, stderr}); });
    });
  }
  try {
    fs.mkdirSync(bundle);
    // Use the actual bundle manifest, without installing into the operator's home.
    for (const e of manifest(path.resolve(binary), "validation-windows")) {
      if (e.name.endsWith(".cmd") || e.name === "securecrt-mcp.exe")
        fs.writeFileSync(path.join(bundle, e.name), e.data);
    }
    fs.mkdirSync(codex);
    const config = path.join(codex, "config.toml");
    fs.writeFileSync(config, '# preserve comment\n[mcp_servers.other]\ncommand = "keep"\n');
    let r = await launch("install.cmd");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert(r.stdout.includes("Local installation checked"));
    assert(fs.existsSync(path.join(app, "bin/securecrt-mcp.exe")));
    const preserved = [config, ...["config.toml", "bridge.json", "xshell_bridge.json"].map(f => path.join(app, f))];
    const hashes = preserved.map(hash);
    r = await launch("install.cmd");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(preserved.map(hash), hashes, "reinstall changed configuration/tokens");
    assert(fs.readFileSync(config, "utf8").includes('command = "keep"'));
    r = await launch("show-paths.cmd");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert(r.stdout.includes("xshell_installed_script="));
    assert(r.stdout.includes("bridge_script="));
    for (const name of ["check-securecrt.cmd", "check-xshell.cmd"]) {
      r = await launch(name);
      assert.notEqual(r.code, 0, "absent bridge must not report success");
      assert(r.stdout.includes("runtime check did not pass"), r.stdout + r.stderr);
      assert(!r.stdout.includes("runtime check passed."));
    }
    const otherCodex = path.join(sandbox, "no-codex"), otherApp = path.join(sandbox, "other-app");
    r = await launch("initialize-only.cmd", {...env, CODEX_HOME: otherCodex, SECURECRT_MCP_HOME: otherApp});
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert(!fs.existsSync(otherCodex), "init-only must not configure Codex");
    assert(fs.existsSync(path.join(otherApp, "config.toml")));
    const defaultEnv = {...env, CODEX_HOME: path.join(sandbox, "default-codex")};
    delete defaultEnv.SECURECRT_MCP_HOME;
    r = await launch("install.cmd", defaultEnv);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert(fs.existsSync(path.join(env.USERPROFILE, ".securecrt-mcp/bin/securecrt-mcp.exe")));
    assert(fs.existsSync(path.join(env.USERPROFILE, "Documents/NetSarang Computer/8/Xshell/Scripts/securecrt-mcp-xshell.js")));
    fs.writeFileSync(config, "this is invalid TOML");
    r = await launch("install.cmd");
    assert.notEqual(r.code, 0);
    assert(!r.stdout.includes("Local installation checked"));
    assert.equal(fs.readFileSync(config, "utf8"), "this is invalid TOML");
    fs.renameSync(path.join(bundle, "securecrt-mcp.exe"), path.join(bundle, "binary.saved"));
    r = await launch("install.cmd");
    assert.equal(r.code, 2);
    assert(r.stdout.includes("Extract the complete ZIP first"));
    console.log("PASS: real Windows CMD install/reinstall, paths with spaces and Unicode, config/token preservation, init-only, absent bridge, invalid config and missing EXE");
  } finally {
    fs.rmSync(sandbox, {recursive: true, force: true});
  }
}
if (require.main === module) run(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { run };
