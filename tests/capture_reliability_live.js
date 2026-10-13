#!/usr/bin/env node
"use strict";
// Opt-in native acceptance. Never chooses a business tab, retries or interrupts.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {MCP,args,assert,sleep,hash,writeJSON}=require("./node_harness");
async function run(a) {
  assert(a.confirmed_idle==="true","explicit authorized idle-test confirmation required");
  assert(a.target && a.output,"fresh target ID and private output path required");
  const backend=a.backend?.[0]||"securecrt";
  assert(["securecrt","xshell"].includes(backend));
  const quick=Number(a.quick_count||100),mixed=Number(a.mixed_count||20);
  assert(Number.isInteger(quick)&&quick>=1&&quick<=1000);
  assert(Number.isInteger(mixed)&&mixed>=0&&mixed<=100);
  const binary=path.resolve(a._[0]),client=await new MCP(binary).start();
  const report={scope:"real native bridge and existing authenticated idle POSIX test tab",backend,
    prefer_native_log:a.prefer_native_log==="true",
    binary_sha256:hash(binary),adapter_sha256:hash(path.join(__dirname,"../bridge/windows_bridge.js")),
    quick_commands:[],mixed_commands:[],recoveries:0,automatic_replays:0,passed:false};
  const prefix="mcp-accept-"+crypto.randomUUID();let session;
  async function exec(command,operation,expectedExit=0) {
    const start=Date.now();
    const r=await client.tool("connector_exec",{session_id:session,command,mode:"posix",
      timeout_ms:10000,wait_ms:15000,max_bytes:65536,operation_id:prefix+"-"+operation,
      prefer_native_log:a.prefer_native_log==="true"});
    report.last_operation=operation;
    report.last_receipt={sent:r.sent,state:r.state,reason:r.reason,exit_code:r.exit_code,
      end_marker_observed:r.end_marker_observed,requires_idle_ack:r.requires_idle_ack,
      capture_may_be_incomplete:r.capture_may_be_incomplete,command_id:r.command_id};
    assert.equal(r.sent,true);assert.equal(r.state,"completed",r.reason);
    assert.equal(r.exit_code,expectedExit);assert.equal(r.end_marker_observed,true);
    assert.equal(r.requires_idle_ack,false);
    return {receipt:r,metrics:{elapsed_ms:Date.now()-start,first_output_us:r.timing.first_output_us,
      poll_calls:r.timing.poll_calls,observed_bytes:r.observed_output_bytes,
      retained_bytes:r.retained_bytes,incomplete:r.capture_may_be_incomplete,capture_transport:r.capture_transport}};
  }
  try {
    const listed=(await client.tool("connector_list"))[backend]||[];
    assert(listed.some(t=>t.id===a.target&&t.connected),"exact selected target absent; do not substitute");
    session=(await client.tool("connector_open",{backend,target:a.target,mode:"exec"})).session_id;
    const original=await client.tool("connector_read_screen",{session_id:session,context_only:true});
    assert(!original.unresolved && /[#$%]$/.test(original.current_line));
    for(let i=0;i<quick;i++) {
      const marker="QUICK_"+i;
      const commands=["true","printf '"+marker+"\\n'","(exit 7)",
        "printf '"+marker+"_中文\\nsecond\\n'","printf '"+marker+"_no_newline'"];
      const result=await exec(commands[i%5],"quick-"+i,i%5===2?7:0);
      if(i%5===1)assert.equal(result.receipt.text.trim(),marker);
      if(i%5===3)assert.equal(result.receipt.text.trim(),marker+"_中文\nsecond");
      if(i%5===4)assert.equal(result.receipt.text.trim(),marker+"_no_newline");
      assert.equal(result.receipt.capture_may_be_incomplete,false);
      report.quick_commands.push(result.metrics);
      if((i+1)%20===0) console.log("PROGRESS: "+(i+1)+"/"+quick+" quick commands");
    }
    for(let i=0;i<mixed;i++) {
      if(i%2===0) {
        const r=await exec("printf 'EARLY_"+i+"\\n'; sleep 1.2; printf 'LATE_"+i+"\\n'","delayed-"+i);
        assert(r.receipt.text.includes("EARLY_"+i+"\n")&&r.receipt.text.includes("LATE_"+i+"\n"));
        report.mixed_commands.push({...r.metrics,case:"delayed output"});
      } else {
        const r=await exec("(sleep 0.2; printf '\\r\\033[2K\\n' >/dev/tty) >/dev/null 2>&1 &","background-"+i);
        await sleep(300);
        const view=await client.tool("connector_read_screen",{session_id:session,context_only:true});
        if(view.current_line==="" && view.cursor_column===1) {
          const recovered=await client.tool("connector_restore_prompt",{session_id:session,confirmed_idle:true,
            screen_token:view.screen_token,expected_prompt:original.current_line});
          assert.equal(recovered.prompt_restored,true);report.recoveries++;
        } else assert.equal(view.current_line,original.current_line,"unexpected context; stop instead of typing");
        report.mixed_commands.push({...r.metrics,case:"delayed ANSI background output"});
        await exec("printf 'MONITOR_OK\\n'","monitor-"+i);
      }
    }
    const big=await exec("awk 'BEGIN { for(i=0;i<2500;i++) printf \"ROW_%04d_中文\\n\", i }'","large");
    let output=big.receipt.text,cursor=big.receipt.next_cursor,pages=1;
    while(cursor!==null) {
      const p=await client.tool("connector_read",{command_id:big.receipt.command_id,cursor,max_bytes:65536});
      assert(!p.gap);output+=p.text;cursor=p.next_cursor;pages++;
    }
    assert.equal(output.trim(),Array.from({length:2500},(_,i)=>"ROW_"+String(i).padStart(4,"0")+"_中文").join("\n"));
    assert.equal(big.receipt.capture_may_be_incomplete,false);
    report.large_output={...big.metrics,rows:2500,pages};
    const created=await exec("mktemp -d /tmp/securecrt-mcp-count.XXXXXXXX","counter-create");
    const directory=created.receipt.text.trim();assert(/^\/tmp\/securecrt-mcp-count\.[A-Za-z0-9]+$/.test(directory));
    const command="printf 'one\\n' >> '"+directory+"/count'";
    const once=await exec(command,"counter-once");
    const twice=await exec(command,"counter-once");
    assert.equal(twice.receipt.command_id,once.receipt.command_id);
    const count=await exec("wc -l < '"+directory+"/count'","counter-read");
    assert.equal(count.receipt.text.trim(),"1");
    const cleanup=await client.tool("connector_exec",{session_id:session,
      command:"rm -- '"+directory+"/count' && rmdir -- '"+directory+"'",mode:"posix",
      timeout_ms:10000,wait_ms:15000,operation_id:prefix+"-counter-clean"});
    if(cleanup.sent===false&&cleanup.state==="rejected"&&/guardrail|deny_rule/.test(cleanup.reason))
      report.cleanup={state:"blocked by existing policy; no alternate deletion attempted",sent:false,directory};
    else {assert.equal(cleanup.state,"completed",cleanup.reason);assert.equal(cleanup.exit_code,0);
      report.cleanup={state:"completed"};}
    report.counter={executions:1,duplicate_requests:2};
    const times=report.quick_commands.map(x=>x.elapsed_ms).sort((x,y)=>x-y);
    report.short_p50_ms=times[Math.floor(times.length*.5)];
    report.short_p95_ms=times[Math.min(times.length-1,Math.floor(times.length*.95))];
    report.passed=true;
  } catch(e) { report.error=e.message;report.failure_stack=e.stack;throw e; }
  finally {
    if(session) await client.tool("connector_close",{session_id:session}).catch(()=>{});
    await client.close();writeJSON(a.output,report);
  }
  console.log(JSON.stringify({passed:report.passed,quick:report.quick_commands.length,mixed:report.mixed_commands.length,
    p50_ms:report.short_p50_ms,p95_ms:report.short_p95_ms,recoveries:report.recoveries}));
}
if(require.main===module)run(args()).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run};
