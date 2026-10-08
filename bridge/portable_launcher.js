// Generated distributions embed both the native bridge and the Rust executable.
// No downloads, Python interpreter, registry edits or administrator access.
var MCP_STARTED = false;
function mcpStart() {
    if (MCP_STARTED) return;
    MCP_STARTED = true;
    var shell = new ActiveXObject("WScript.Shell");
    var stage="load native bridge";
    try {
        eval(MCP_NATIVE_SOURCE);
        var host = MCP_BACKEND == "xshell" ? xsh : crt;
        var fso = new ActiveXObject("Scripting.FileSystemObject");
        function mkdir(path) {
            if (!fso.FolderExists(path)) {
                var parent = fso.GetParentFolderName(path);
                if (parent && !fso.FolderExists(parent)) mkdir(parent);
                fso.CreateFolder(path);
            }
        }
        var root = String(shell.Environment("Process")("SECURECRT_MCP_HOME"));
        if (!root) root = shell.ExpandEnvironmentStrings("%USERPROFILE%") + "\\.securecrt-mcp";
        root = fso.GetAbsolutePathName(root);
        mkdir(root);
        var dir = fso.BuildPath(fso.BuildPath(root, "bin"), MCP_BINARY_SHA256);
        mkdir(dir);
        var exe = fso.BuildPath(dir, "securecrt-mcp.exe");
        stage="extract embedded program";
        // Always stage the bundled bytes; the executable verifies its own SHA-256.
        // Reuse an existing identical-length binary only after portable-init validates it.
        function extract() {
            var xml = new ActiveXObject("MSXML2.DOMDocument.6.0");
            var node = xml.createElement("payload");
            node.dataType = "bin.base64"; node.text = MCP_BINARY_BASE64.join("");
            var stream = new ActiveXObject("ADODB.Stream");
            stream.Type = 1; stream.Open();
            try { stream.Write(node.nodeTypedValue); stream.SaveToFile(exe, 2); }
            finally { stream.Close(); }
        }
        if (!fso.FileExists(exe) || Number(fso.GetFile(exe).Size) != MCP_BINARY_SIZE) extract();
        var manifest = fso.BuildPath(root, "native-start-" + new Date().getTime() + "-" + Math.floor(Math.random()*1000000) + ".json");
        function init() {
            return shell.Run('"' + exe + '" portable-init --backend ' + MCP_BACKEND +
                ' --manifest "' + manifest + '" --expected-sha256 ' + MCP_BINARY_SHA256, 0, true);
        }
        stage="initialize embedded program";
        var status = init();
        if (status != 0) { extract(); status = init(); }
        if (status != 0 || !fso.FileExists(manifest)) mcpFail("Portable initialization failed (exit " + status + ")");
        stage="read startup manifest";
        var config;
        try { config = mcpParse(mcpReadUtf8(manifest)); }
        finally { if (fso.FileExists(manifest)) fso.DeleteFile(manifest, true); }
        stage="start native adapter";
        var actualSourceHash=mcpSha256(MCP_NATIVE_SOURCE);
        if(actualSourceHash!=config.adapter_sha256) throw "native source checksum mismatch: "+actualSourceHash+" != "+config.adapter_sha256;
        mcpServeWindows(host, MCP_BACKEND, config, MCP_NATIVE_SOURCE);
    } catch (error) {
        // Script cancellation must remain quiet; startup/runtime errors remain visible.
        var message = stage+": "+String(error.description || error.message || error);
        try {
            if (root && typeof mcpWriteJson=="function") mcpWriteJson(new ActiveXObject("Scripting.FileSystemObject"), root+"\\"+MCP_BACKEND+"-startup-error.json", {stage:stage,error:message,time_ms:new Date().getTime()});
        } catch(logError) {}
        if (!/cancel|interrupt|aborted/i.test(message)) {
            if (root && typeof mcpNotify=="function") mcpNotify(new ActiveXObject("Scripting.FileSystemObject"),root,"SecureCRT MCP: "+message,16);
            else shell.Popup("SecureCRT MCP: " + message, 5, "SecureCRT MCP", 16);
        }
    }
}
function Main() { mcpStart(); }
function main() { mcpStart(); }
// SecureCRT executes the script body; Xshell invokes Main itself.
if (MCP_BACKEND == "securecrt") mcpStart();
