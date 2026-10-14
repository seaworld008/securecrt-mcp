"use strict";

// ASCII console messages work with the user's existing Windows code page.
// Keep the terminal UI step manual: starting a separate /SCRIPT process may
// attach to a disconnected tab instead of the user's authenticated session.
function entry(commands, success, failure) {
  return Buffer.from([
    "@echo off",
    "setlocal DisableDelayedExpansion",
    'cd /d "%~dp0"',
    'if not exist "%~dp0securecrt-mcp.exe" goto missing',
    ...commands.flatMap((args) => [
      '"%~dp0securecrt-mcp.exe" ' + args,
      'set "mcp_exit=%errorlevel%"',
      'if not "%mcp_exit%"=="0" goto failed',
    ]),
    "echo.",
    "echo " + success,
    "echo Read START-HERE.md for the next step.",
    "pause",
    "exit /b 0",
    ":missing",
    "echo Missing securecrt-mcp.exe. Extract the complete ZIP first.",
    'set "mcp_exit=2"',
    ":failed",
    "echo.",
    "echo " + failure,
    "echo Keep the error above. See START-HERE.md for troubleshooting.",
    "pause",
    "exit /b %mcp_exit%",
    "",
  ].join("\r\n"), "ascii");
}

function windowsUserFiles() {
  const files = Object.entries({
    "install.cmd": entry(
      ["install", "doctor --offline", "doctor --backend xshell --offline", "paths"],
      "Local installation checked. Load the terminal script, then reload Codex.",
      "Installation or local checks did not complete. Do not continue yet.",
    ),
    "show-paths.cmd": entry(
      ["paths"],
      "Use the script path for your terminal in its Run Script menu.",
      "Could not determine the configured paths.",
    ),
    "check-securecrt.cmd": entry(
      ["doctor --backend securecrt"],
      "SecureCRT runtime check passed. This does not test remote commands or client approvals.",
      "SecureCRT runtime check did not pass. Check the script and application directory.",
    ),
    "check-xshell.cmd": entry(
      ["doctor --backend xshell"],
      "Xshell runtime check passed. This does not test remote commands or client approvals.",
      "Xshell runtime check did not pass. Check the script and application directory.",
    ),
    "initialize-only.cmd": entry(
      ["init", "doctor --offline", "doctor --backend xshell --offline", "paths"],
      "Local initialization checked. Register this stable EXE path in your MCP client with serve.",
      "Initialization or local checks did not complete. Do not continue yet.",
    ),
  }).map(([name, data]) => ({ name, data }));
  for (const backend of ["securecrt", "xshell"]) {
    files.push({name: "stop-" + backend + ".cmd", data: entry([
      'stop-native-host --backend ' + backend + ' --choose --confirmed-idle',
    ], "Stop request finished. Review the result above; SSH connections remain open.",
    "Bridge was not confirmed stopped. Inspect its state; do not retry an unknown result.")});
    const file = files[files.length - 1];
    file.data = Buffer.from(file.data.toString("ascii").replace("setlocal DisableDelayedExpansion\r\n","setlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\n").replace(
      '"%~dp0securecrt-mcp.exe" stop-native-host',
      'echo Confirm no command is running or unresolved before stopping the bridge.\r\nchoice /c YN /n /m "Stop the idle bridge? [Y/N] "\r\nif errorlevel 2 exit /b 0\r\nif errorlevel 1 goto confirmed\r\nexit /b 1\r\n:confirmed\r\n"%~dp0securecrt-mcp.exe" stop-native-host',
    ), "ascii");
  }
  return files;
}

module.exports = { windowsUserFiles };
