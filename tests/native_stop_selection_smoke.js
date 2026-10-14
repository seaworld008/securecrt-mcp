"use strict";
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{spawn}=require("node:child_process"),{assert,command,hash,ROOT}=require("./node_harness"),{runtimeProbe}=require("./desktop_matrix");
async function run(binary){
 if(process.platform!=="win32"){console.log("SKIP: Windows native stop selection");return;}
 const app=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-stop-selection-")),root=path.join(app,"ipc"),token="selection-fixture-token-".repeat(3),ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"],stops=[];
 fs.mkdirSync(root);fs.writeFileSync(path.join(app,"config.toml"),'[audit]\nenabled=false\n');fs.writeFileSync(path.join(app,"bridge.json"),JSON.stringify({host:"127.0.0.1",port:8765,token,max_request_bytes:262144,ipc_dir:root}));
 for(const id of ids)fs.mkdirSync(path.join(root,"instances",id),{recursive:true});
 const stopped=new Set(),pings=[];
 const source=hash(path.join(ROOT,"bridge/windows_bridge.js")),version=fs.readFileSync(path.join(ROOT,"Cargo.toml"),"utf8").match(/^version = "([^"]+)"/m)[1];
 const apis=JSON.parse(fs.readFileSync(path.join(ROOT,"support/policy.json"),"utf8")).native_windows_required_apis;
 fs.copyFileSync(path.join(app,"bridge.json"),path.join(app,"xshell_bridge.json"));
 function tick(){for(const [i,id]of ids.entries()){
  const dir=path.join(root,"instances",id);if(!stopped.has(id)){
   const pending=path.join(dir,"ready.tmp"),ready=path.join(dir,"ready.json");
   fs.writeFileSync(pending,JSON.stringify({bridge_instance:id,protocol_version:2,last_poll_ms:Date.now()}));
   try{fs.renameSync(pending,ready)}catch(e){
    // Windows readers can briefly deny replacement. Keep the complete old
    // heartbeat and publish on the next tick instead of tearing it down.
    if(!["EPERM","EACCES","EBUSY"].includes(e.code)||!fs.existsSync(ready))throw e;
   }
  }
  for(const n of fs.readdirSync(dir).filter(n=>n.endsWith(".request.json"))){let q;try{q=JSON.parse(fs.readFileSync(path.join(dir,n)))}catch{continue}
   fs.unlinkSync(path.join(dir,n));assert.equal(q.token,token);let result;
   if(q.method==="ping"){pings.push(id);result={platform:"Windows",script_engine:"JScript",securecrt_version:"9.6.0",xshell_version:"8.0.0.26",bridge_version:version,protocol_version:2,capabilities:["graceful_stop"],adapter_sha256:i===0?source:"outdated-source",api_capabilities:Object.fromEntries([...apis.securecrt,...apis.xshell].map(name=>[name,true]))};}
   else if(q.method==="list_sessions")result={sessions:[{id:id+"/session/1",tab_text:"",caption:"DUPLICATE_TEST_CAPTION\u202e\u2066\x1b[31m\r\n",session_name:"TEST_BRIDGE_"+(i+1)}]};
   else if(q.method==="stop_host"){assert.equal(q.params.bridge_instance,id);assert.equal(q.params.adapter_sha256,source);assert.equal(q.params.confirmed_idle,true);stops.push(id);stopped.add(id);fs.unlinkSync(path.join(dir,"ready.json"));result={stopped:true,sent:false};}
   else throw Error("unexpected native request");
   fs.writeFileSync(path.join(dir,q.id+".response.json"),JSON.stringify({id:q.id,protocol_version:2,bridge_instance:id,ok:true,sent:false,result}));
  }
 }}
 tick();const timer=setInterval(tick,10);
 function select(input,args=["--choose","--confirmed-idle"]){return new Promise((resolve,reject)=>{const child=spawn(path.resolve(binary),["stop-native-host",...args],{env:{...process.env,SECURECRT_MCP_HOME:app},windowsHide:true});let stdout="",stderr="";child.stdout.on("data",b=>stdout+=b);child.stderr.on("data",b=>stderr+=b);child.stdin.on("error",()=>{});child.stdin.end(input);const timeout=setTimeout(()=>{child.kill();reject(Error("selection timeout"))},15000);child.on("close",code=>{clearTimeout(timeout);resolve({code,stdout,stderr})});child.on("error",e=>{clearTimeout(timeout);reject(e)})})}
 try{
  const prior=process.env.SECURECRT_MCP_HOME;process.env.SECURECRT_MCP_HOME=app;
  try{for(const backend of ["securecrt","xshell"]){
   pings.length=0;let probe=await runtimeProbe(binary,backend,[backend+"="+ids[0]+"/session/1"]);assert.equal(probe.code,0,probe.stderr);assert.deepEqual(pings,[ids[0]]);assert.equal(JSON.parse(probe.stdout).instances.length,1);
   pings.length=0;probe=await runtimeProbe(binary,backend,[backend+"="+ids[1]+"/session/1"]);assert.notEqual(probe.code,0);assert.deepEqual(pings,[ids[1]]);
   pings.length=0;probe=await command(binary,["doctor","--backend",backend],{...process.env,SECURECRT_MCP_HOME:app});assert.notEqual(probe.code,0);assert.equal(JSON.parse(probe.stdout).instances.length,2);assert.deepEqual(new Set(pings),new Set(ids));
   pings.length=0;await assert.rejects(runtimeProbe(binary,backend,[backend+"=33333333-3333-4333-8333-333333333333/session/1"]),/missing/);assert.deepEqual(pings,[]);
  }}finally{if(prior===undefined)delete process.env.SECURECRT_MCP_HOME;else process.env.SECURECRT_MCP_HOME=prior;}
  assert.deepEqual(stops,[]);
  console.log("PASS: compiled SecureCRT/Xshell doctor selects only the requested instance, preserves selected failures, rejects missing hosts and validates every host by default");
  let r=await select("0\n");assert.equal(r.code,0,r.stderr);assert(r.stdout.includes("DUPLICATE_TEST_CAPTION")&&r.stdout.includes("Cancelled"));assert(ids.every(id=>r.stdout.includes("instance: "+id)),"duplicate captions must show distinct stable instance IDs");assert(r.stdout.includes("\\u{202e}")&&r.stdout.includes("\\u{2066}"));assert(!/[\u202e\u2066\x1b\r]/.test(r.stdout),"untrusted labels must not reorder identity, inject ANSI or introduce extra lines");assert.deepEqual(stops,[]);
  r=await select("99\n");assert.notEqual(r.code,0);assert.deepEqual(stops,[]);
  r=await select("1\n",["--choose"]);assert.notEqual(r.code,0);assert.deepEqual(stops,[]);
  r=await select("1\n");assert.equal(r.code,0,r.stderr);assert.deepEqual(stops,[ids[0]]);assert(fs.existsSync(path.join(root,"instances",ids[1],"ready.json")));
  console.log("PASS: compiled stop selector labels, cancellation, invalid/unauthorized selection, exactly one stop and other host preserved");
 }finally{clearInterval(timer);fs.rmSync(app,{recursive:true,force:true})}
}
if(require.main===module)run(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1});module.exports={run};
