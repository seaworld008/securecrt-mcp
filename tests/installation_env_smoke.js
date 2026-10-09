"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { command, assert } = require("./node_harness");

function decodeTomlBasicString(value) {
  assert(value.startsWith('"') && value.endsWith('"'), "expected a TOML basic string");
  let result = "";
  for (let i = 1; i < value.length - 1; i++) {
    const ch = value[i];
    if (ch !== "\\") {
      result += ch;
      continue;
    }
    const escaped = value[++i];
    const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
    if (Object.hasOwn(simple, escaped)) {
      result += simple[escaped];
      continue;
    }
    assert(["u", "U"].includes(escaped), "invalid TOML basic string escape");
    const width = escaped === "u" ? 4 : 8,
      digits = value.slice(i + 1, i + 1 + width);
    assert.equal(digits.length, width, "truncated TOML Unicode escape");
    assert.match(digits, /^[0-9a-fA-F]+$/, "invalid TOML Unicode escape");
    const codePoint = Number.parseInt(digits, 16);
    assert(codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff), "invalid Unicode scalar");
    result += String.fromCodePoint(codePoint);
    i += width;
  }
  return result;
}

function tomlStringValue(text, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    assignment = new RegExp(`^\\s*${escapedKey}\\s*=\\s*(\\"(?:\\\\.|[^\\"\\\\\\r\\n])*\\"|'[^'\\r\\n]*')\\s*(?:#.*)?$`, "m"),
    value = text.match(assignment)?.[1];
  assert(value, `missing single-line TOML string for ${key}`);
  return value.startsWith("'") ? value.slice(1, -1) : decodeTomlBasicString(value);
}

async function run(binary) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "securecrt-install-env-"));
  try {
    const home = path.join(sandbox, "home"),
      codexHome = path.join(sandbox, "codex"),
      // POSIX permits this literal backslash; on Windows this models separators
      // emitted as a TOML literal string by toml_edit.
      appRoot = path.join(sandbox, "chosen\\root");
    assert.equal(tomlStringValue("SECURECRT_MCP_HOME = 'C:\\Users\\Codex\\app'", "SECURECRT_MCP_HOME"), "C:\\Users\\Codex\\app");
    assert.equal(
      tomlStringValue('SECURECRT_MCP_HOME = "C:\\\\app\\\\\\"quoted\\\"\\\\\\u96ea\\\\\\U0001F680"', "SECURECRT_MCP_HOME"),
      'C:\\app\\"quoted"\\雪\\🚀',
    );
    assert.equal(tomlStringValue(`SECURECRT_MCP_HOME = '${appRoot}'`, "SECURECRT_MCP_HOME"), appRoot);
    fs.mkdirSync(home);
    fs.mkdirSync(codexHome);
    const configPath = path.join(codexHome, "config.toml"),
      original =
        '# preserve this operator comment\n[mcp_servers.other]\ncommand = "keep-other"\n[mcp_servers.securecrt]\ndefault_tools_approval_mode = "prompt"\nenabled_tools = ["connector_list"]\n[mcp_servers.securecrt.env]\nOTHER_CODEX_SETTING = "keep-env"\n';
    fs.writeFileSync(configPath, original);
    const installEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: codexHome,
      SECURECRT_MCP_HOME: appRoot,
    };
    let result = await command(binary, ["install"], installEnv, 60000);
    assert.equal(result.code, 0, result.stderr);
    const installed = path.join(appRoot, "bin", process.platform === "win32" ? "securecrt-mcp.exe" : "securecrt-mcp");
    let text = fs.readFileSync(configPath, "utf8");
    const emittedRoot = tomlStringValue(text, "SECURECRT_MCP_HOME");
    assert.equal(emittedRoot, appRoot, text);

    // A second install must retain operator-owned Codex settings and the other env key.
    result = await command(binary, ["install"], installEnv, 60000);
    assert.equal(result.code, 0, result.stderr);
    text = fs.readFileSync(configPath, "utf8");
    assert.ok(text.includes("# preserve this operator comment"));
    assert.ok(text.includes('default_tools_approval_mode = "prompt"'));
    assert.ok(text.includes('enabled_tools = ["connector_list"]'));
    assert.ok(text.includes('OTHER_CODEX_SETTING = "keep-env"'));
    assert.equal(tomlStringValue(text, "SECURECRT_MCP_HOME"), appRoot);

    // Simulate GUI startup: inherit Codex's environment but not the install shell variable.
    const guiEnv = { ...installEnv };
    delete guiEnv.SECURECRT_MCP_HOME;
    // Codex applies the env entry from config.toml when it starts the MCP process.
    guiEnv.SECURECRT_MCP_HOME = emittedRoot;
    result = await command(installed, ["paths"], guiEnv, 30000);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes(appRoot), result.stdout);
    assert.ok(!result.stdout.includes(path.join(home, ".securecrt-mcp")), result.stdout);
    result = await command(installed, ["doctor", "--offline"], guiEnv, 30000);
    assert.equal(result.code, 0, result.stderr);
    console.log("PASS: install persists chosen app root for GUI cold start");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

if (require.main === module)
  run(process.argv[2]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { run };
