#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  { spawn } = require("node:child_process"),
  {
    ROOT,
    command,
    assert,
    sleep,
    hash,
    writeJSON,
    readJSON,
  } = require("./node_harness"),
  { windowsScripts } = require("../scripts/portable_scripts");
function buildStressDriver(source, stop, manifest) {
  return (
    source +
    "\nmcpNotifyStarted=function(){};\nvar stopPath=" +
    JSON.stringify(stop) +
    ';\nvar host={GetTabCount:function(){return 0;},Sleep:function(ms){if(new ActiveXObject("Scripting.FileSystemObject").FileExists(stopPath)) throw "script cancelled";WScript.Sleep(ms);}};\ntry{mcpServeWindows(host,"securecrt",' +
    JSON.stringify(manifest) +
    "," +
    JSON.stringify(source) +
    ');}catch(e){if(String(e).indexOf("cancelled")<0){WScript.Echo(mcpError(e));WScript.Quit(9);}}'
  );
}
function writeJScript(file, source) {
  // Classic WSH reads this as ASCII. Escape UTF-16 code units before encoding,
  // preserving Chinese paths and surrogate pairs inside JScript/JSON strings.
  const ascii = source.replace(
    /[\u0080-\uffff]/g,
    (value) => "\\u" + value.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  fs.writeFileSync(file, ascii, "ascii");
}
function preserveStressFailure(primary, cleanup, state) {
  const failure = primary || cleanup;
  if (!failure) return null;
  failure.native_stress = state;
  if (primary && cleanup) failure.cleanup_error = cleanup.message;
  return failure;
}
async function stress(work, source, cscript) {
  const root = path.join(work, "concurrent-ipc");
  fs.mkdirSync(root);
  const stop = path.join(root, "stop.flag"),
    directory = path.join(root, "instances", "stress-instance"),
    manifest = {
      bridge_instance: "stress-instance",
      ipc_dir: root,
      adapter_sha256: crypto.createHash("sha256").update(source).digest("hex"),
      token: "stress-token",
      runtime: {},
    };
  const driver = path.join(work, "concurrent-ipc.js");
  writeJScript(driver, buildStressDriver(source, stop, manifest));
  const proc = spawn(cscript, ["//nologo", "//E:JScript", driver], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostic = "",
    spawnFailure,
    primaryFailure,
    cleanupFailure,
    closed = false,
    completedRequests = 0,
    phase = "startup";
  proc.on("error", (error) => {
    spawnFailure = error;
  });
  proc.on("close", () => {
    closed = true;
  });
  proc.stdout.on("data", (b) => (diagnostic += b));
  proc.stderr.on("data", (b) => (diagnostic += b));
  try {
    const until = Date.now() + 40000;
    while (!fs.existsSync(path.join(directory, "ready.json"))) {
      if (spawnFailure) throw spawnFailure;
      assert(
        proc.exitCode === null && Date.now() < until,
        "native stress not ready",
      );
      await sleep(10);
    }
    phase = "ipc";
    for (let batch = 0; batch < 200; batch++) {
      const pending = [];
      for (let i = 0; i < 4; i++) {
        const id = crypto.randomUUID(),
          tmp = path.join(directory, id + ".tmp");
        writeJSON(tmp, {
          id,
          protocol_version: 2,
          token: "stress-token",
          client_id: "stress-client",
          deadline_ms: Date.now() + 35000,
          method: "list_sessions",
          params: {},
        });
        fs.renameSync(tmp, path.join(directory, id + ".request.json"));
        pending.push(path.join(directory, id + ".response.json"));
      }
      const until = Date.now() + 35000;
      while (pending.length) {
        assert(
          proc.exitCode === null && Date.now() < until,
          "native stress exited/timeout; no replay",
        );
        for (let i = pending.length - 1; i >= 0; i--)
          try {
            const value = readJSON(pending[i]);
            assert(value.ok);
            assert.deepEqual(value.result.sessions, []);
            fs.unlinkSync(pending[i]);
            pending.splice(i, 1);
            completedRequests++;
          } catch (e) {
            if (!["ENOENT", "EPERM", "EACCES"].includes(e.code)) throw e;
          }
        await sleep(1);
      }
    }
    console.log(
      "PASS: 800 authenticated native IPC requests with concurrent deletion",
    );
    phase = "completed";
  } catch (error) {
    primaryFailure = error;
  } finally {
    try {
      fs.writeFileSync(stop, "stop");
      await new Promise((resolve, reject) => {
        if (proc.exitCode !== null || closed) return resolve();
        const timer = setTimeout(() => {
          proc.kill();
          const error = new Error("native stress shutdown timeout");
          error.kill_requested = true;
          reject(error);
        }, 5000);
        proc.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (!primaryFailure && !cleanupFailure) {
    try {
      assert.equal(proc.exitCode, 0, diagnostic);
      assert(
        !fs.existsSync(path.join(directory, "ready.json")),
        "cancel left registry",
      );
    } catch (error) {
      primaryFailure = error;
    }
  }
  const state = {
    scope: "isolated Windows WSH/native fixture; no SSH",
    phase,
    completed_requests: completedRequests,
    exit_code: proc.exitCode,
    signal_code: proc.signalCode,
    closed,
    kill_requested: !!cleanupFailure?.kill_requested,
    diagnostic,
    cleanup_error: cleanupFailure?.message || null,
    primary_error: primaryFailure
      ? { name: primaryFailure.name, message: primaryFailure.message }
      : null,
  };
  const failure = preserveStressFailure(primaryFailure, cleanupFailure, state);
  if (failure) {
    const save = () => {
      state.exit_code = proc.exitCode;
      state.signal_code = proc.signalCode;
      state.closed = closed;
      state.diagnostic = diagnostic;
      try {
        const directory = path.join(ROOT, ".local-evidence");
        fs.mkdirSync(directory, { recursive: true });
        writeJSON(
          path.join(directory, "windows-native-stress-diagnostic.json"),
          state,
        );
      } catch (error) {
        failure.diagnostic_write_error = error.message;
      }
    };
    save();
    if (!closed) proc.once("close", save);
    console.error("NATIVE_STRESS_DIAGNOSTIC=" + JSON.stringify(state));
    throw failure;
  }
}
async function run(binary) {
  assert.equal(process.platform, "win32", "WSH smoke requires Windows");
  binary = path.resolve(binary);
  const generated = windowsScripts(ROOT, binary),
    source = fs.readFileSync(
      path.join(ROOT, "bridge/windows_bridge.js"),
      "utf8",
    ),
    digest = hash(binary),
    windir = process.env.WINDIR,
    work = fs.mkdtempSync(path.join(os.tmpdir(), "MCP 中文 bootstrap "));
  let primaryFailure;
  try {
    await stress(work, source, path.join(windir, "System32/cscript.exe"));
    const core = path.join(work, "core.js");
    writeJScript(
      core,
      source +
        String.raw`
if(mcpSha256("abc")!="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") throw Error("SHA mismatch");
if(mcpParse(mcpJson({text:"\u4e2d\u6587",list:[1,true,null]})).text!="\u4e2d\u6587") throw Error("JSON mismatch");
var fso=new ActiveXObject("Scripting.FileSystemObject"),xml=new ActiveXObject("MSXML2.DOMDocument.6.0"),node=xml.createElement("test");node.dataType="bin.base64";node.text="YWJj";
var stream=new ActiveXObject("ADODB.Stream");stream.Type=1;stream.Open();stream.Write(node.nodeTypedValue);stream.Close();
if(typeof fso.CreateTextFile=="undefined") throw Error("COM method unavailable");
var caught=false;try{mcpFail("test detailed error");}catch(e){caught=mcpError(e).indexOf("test detailed error")>=0;}if(!caught)throw Error("error detail unavailable");
WScript.Echo("PASS: classic JScript SHA/JSON and COM extraction");
`,
    );
    for (const engine of ["System32", "SysWOW64"]) {
      const cscript = path.join(windir, engine, "cscript.exe");
      let p = await command(
        cscript,
        ["//nologo", "//E:JScript", core],
        process.env,
        30000,
      );
      assert.equal(p.code, 0, p.stdout + p.stderr);
      for (const backend of ["xshell", "securecrt"]) {
        const profile = path.join(work, engine + "-" + backend),
          env = {
            ...process.env,
            SECURECRT_MCP_HOME: profile,
            PATH: path.join(windir, engine),
          };
        let entry =
          generated["securecrt-mcp-" + backend + ".js"].toString("ascii");
        if (backend === "securecrt")
          entry = entry.split("\n").slice(2).join("\n");
        entry = entry
          .replace(
            'shell.Popup("SecureCRT MCP: " + message, 0, "SecureCRT MCP", 16);',
            "throw error;",
          )
          .replace(
            "eval(MCP_NATIVE_SOURCE);",
            "eval(MCP_NATIVE_SOURCE);mcpNotifyStarted=function(){};mcpNotify=function(f,d,m,style){if(style==16) WScript.Quit(9);};",
          );
        const driver = path.join(work, engine + "-" + backend + ".js");
        writeJScript(
          driver,
          'var turns=0;function stop(ms){if(++turns>3)throw Error("script cancelled");WScript.Sleep(ms);}var xsh={Session:{Connected:false,Sleep:stop,Path:""},Screen:{}};var crt={Version:"9.0.0",GetTabCount:function(){return 0;},Sleep:stop};\n' +
            entry +
            (backend === "xshell" ? "\nMain();" : "") +
            '\nif(turns<1)throw Error("native loop did not start");',
        );
        let token, config;
        for (let iteration = 1; iteration <= 2; iteration++) {
          p = await command(
            cscript,
            ["//nologo", "//E:JScript", driver],
            env,
            45000,
          );
          assert.equal(p.code, 0, p.stdout + p.stderr);
          const secret = readJSON(
            path.join(
              profile,
              backend === "securecrt" ? "bridge.json" : "xshell_bridge.json",
            ),
          );
          assert.equal(
            path.resolve(secret.ipc_dir),
            path.join(profile, backend + "-native-ipc"),
          );
          assert.equal(
            hash(path.join(profile, "bin", digest, "securecrt-mcp.exe")),
            digest,
          );
          const files = fs.readdirSync(profile);
          assert(
            !files.some(
              (n) =>
                n.endsWith(".py") ||
                n.endsWith(".bak") ||
                /^native-start-.*\.json$/.test(n),
            ),
            "Python/backups/token manifest leaked",
          );
          function readyFiles(dir) {
            return fs
              .readdirSync(dir, { withFileTypes: true })
              .some((e) =>
                e.isDirectory()
                  ? readyFiles(path.join(dir, e.name))
                  : e.name === "ready.json",
              );
          }
          assert(
            !readyFiles(path.join(profile, backend + "-native-ipc")),
            "cancelled registry",
          );
          const bytes = fs.readFileSync(path.join(profile, "config.toml"));
          if (iteration === 1) {
            token = secret.token;
            config = bytes;
          } else {
            assert.equal(secret.token, token);
            assert(bytes.equals(config));
          }
        }
        if (engine === "System32" && backend === "xshell") {
          p = await command(binary, ["upgrade"], env);
          assert.equal(p.code, 0, p.stderr);
          const secret = readJSON(path.join(profile, "xshell_bridge.json"));
          assert.equal(secret.token, token);
          assert.equal(
            path.resolve(secret.ipc_dir),
            path.join(profile, "xshell-native-ipc"),
          );
          assert(
            fs.existsSync(
              path.join(profile, "xshell-scripts/securecrt-mcp-xshell.js"),
            ),
          );
          assert(
            fs.existsSync(path.join(profile, "securecrt-mcp-securecrt.js")),
          );
          assert(
            fs.readFileSync(path.join(profile, "config.toml")).equals(config),
          );
        }
        console.log(
          "PASS: " +
            engine +
            " " +
            backend +
            " embedded extraction, Python/Node absent child PATH, restart token/config preserved",
        );
      }
    }
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch (error) {
      if (primaryFailure) {
        primaryFailure.workspace_cleanup_error = error.message;
      } else throw error;
    }
  }
}
if (require.main === module)
  run(process.argv[2]).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = {
  run,
  buildStressDriver,
  writeJScript,
  preserveStressFailure,
};
