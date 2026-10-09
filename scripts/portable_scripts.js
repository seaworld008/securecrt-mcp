"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
function windowsScripts(repository, binary) {
  const payload = fs.readFileSync(binary),
    encoded = payload.toString("base64"),
    source = fs.readFileSync(
      path.join(repository, "bridge/windows_bridge.js"),
      "utf8",
    ),
    launcher = fs.readFileSync(
      path.join(repository, "bridge/portable_launcher.js"),
      "utf8",
    );
  const ascii = (value) =>
    JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  const common =
    "// Self-contained Windows package; select this file inside the terminal.\nvar MCP_BINARY_SHA256 = " +
    ascii(crypto.createHash("sha256").update(payload).digest("hex")) +
    ";\nvar MCP_BINARY_SIZE = " +
    payload.length +
    ";\nvar MCP_NATIVE_SOURCE = " +
    ascii(source) +
    ";\nvar MCP_BINARY_BASE64 = [\n" +
    Array.from({ length: Math.ceil(encoded.length / 8192) }, (_, i) =>
      ascii(encoded.slice(i * 8192, (i + 1) * 8192)),
    ).join(",\n") +
    "\n];\n" +
    launcher;
  return Object.fromEntries(
    ["xshell", "securecrt"].map((backend) => [
      "securecrt-mcp-" + backend + ".js",
      Buffer.from(
        (backend === "securecrt"
          ? '# $language = "JScript"\n# $interface = "1.0"\n'
          : "") +
          "var MCP_BACKEND = " +
          ascii(backend) +
          ";\n" +
          common,
        "ascii",
      ),
    ]),
  );
}
module.exports = { windowsScripts };
