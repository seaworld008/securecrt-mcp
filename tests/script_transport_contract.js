"use strict";
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const {randomUUID,createHash} = require("node:crypto");
const {uploadScript} = require("../clients/script_transport");
function shell(command) {
  return process.platform === "win32"
    ? spawnSync("wsl.exe", ["--exec", "sh", "-c", command], {encoding:"utf8",windowsHide:true})
    : spawnSync("sh", ["-c", command], {encoding:"utf8"});
}
async function run() {
  const root="/tmp/securecrt-transport-"+randomUUID();
  const result=shell("mkdir -m 700 '"+root+"'");
  assert.equal(result.status,0,"local POSIX shell required (WSL on Windows)");
  const source="#!/bin/sh\r\nprintf '%s\\n' '中文 😀 $ ` \" single quote: '\\'' end'\r\n"+"# chunk\n".repeat(1200);
  const normalized=source.replace(/\r\n?/g,"\n");
  const destination=root+"/中文 'quoted' script.sh";
  const seen=new Set();let calls=0;
  const execute=async(command,options)=>{
    assert(!seen.has(options.operation_id));seen.add(options.operation_id);calls++;
    const r=shell(command);
    return {state:"completed",sent:true,exit_code:r.status,text:r.stdout,
      requires_idle_ack:false,capture_may_be_incomplete:false,truncated:false};
  };
  try {
    const receipt=await uploadScript(execute,source,destination,{chunk_bytes:256});
    assert.equal(receipt.sha256,createHash("sha256").update(normalized).digest("hex"));
    assert.equal(receipt.executed,false);assert.equal(receipt.rpc_calls,calls);
    const q="'"+destination.replaceAll("'","'\\''")+"'";
    assert.equal(shell("cat -- "+q).stdout,normalized);
    assert.equal(shell("stat -c '%a' -- "+q).stdout.trim(),"600");
    let stopped=0;
    await assert.rejects(()=>uploadScript(async()=>{stopped++;return {state:"unknown",sent:null};},"echo harmless\n",root+"/unknown"),
      e=>e.automatic_retry===false && e.staging_path.startsWith(root+"/unknown.mcp-"));
    assert.equal(stopped,1,"uncertainty must prevent all further writes, including cleanup");
    for(const bad of ["relative","/tmp/../test","/tmp/line\npath","/tmp/"])
      await assert.rejects(()=>uploadScript(execute,"x",bad));
    console.log("PASS: local POSIX/WSL chunk transfer, quoting/Unicode/LF, exact SHA-256, 0600, atomic rename, no uncertain replay");
  } finally {
    assert.equal(shell("rm -rf -- '"+root+"'").status,0);
  }
}
if(require.main===module) run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
