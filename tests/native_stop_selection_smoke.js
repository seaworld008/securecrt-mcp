"use strict";
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{spawn}=require("node:child_process"),{assert}=require("./node_harness");
async function run(binary){
 if(process.platform!=="win32"){console.log("SKIP: Windows native stop selection");return;}
 const app=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-stop-selection-")),root=path.join(app,"ipc"),token="selection-fixture-token-".repeat(3),ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"],stops=[];
 fs.mkdirSync(root);fs.writeFileSync(path.join(app,"config.toml"),'[audit]\nenabled=false\n');fs.writeFileSync(path.join(app,"bridge.json"),JSON.stringify({host:"127.0.0.1",port:8765,token,max_request_bytes:262144,ipc_dir:root}));
 for(const id of ids)fs.mkdirSync(path.join(root,"instances",id),{recursive:true});
 const stopped=new Set();
 function tick(){for(const [i,id]of ids.entries()){
  const dir=path.join(root,"instances",id);if(!stopped.has(id))fs.writeFileSync(path.join(dir,"ready.json"),JSON.stringify({bridge_instance:id,protocol_version:2,last_poll_ms:Date.now()}));
  for(const n of fs.readdirSync(dir).filter(n=>n.endsWith(".request.json"))){let q;try{q=JSON.parse(fs.readFileSync(path.join(dir,n)))}catch{continue}
   fs.unlinkSync(path.join(dir,n));assert.equal(q.token,token);let result;
   if(q.method==="ping")result={platform:"Windows",capabilities:["graceful_stop"],adapter_sha256:"fixture-source"};
   else if(q.method==="list_sessions")result={sessions:[{id:id+"/session/1",tab_text:"TEST_BRIDGE_"+(i+1)}]};
   else if(q.method==="stop_host"){assert.equal(q.params.bridge_instance,id);assert.equal(q.params.adapter_sha256,"fixture-source");assert.equal(q.params.confirmed_idle,true);stops.push(id);stopped.add(id);fs.unlinkSync(path.join(dir,"ready.json"));result={stopped:true,sent:false};}
   else throw Error("unexpected native request");
   fs.writeFileSync(path.join(dir,q.id+".response.json"),JSON.stringify({id:q.id,protocol_version:2,bridge_instance:id,ok:true,sent:false,result}));
  }
 }}
 tick();const timer=setInterval(tick,10);
 function select(input,args=["--choose","--confirmed-idle"]){return new Promise((resolve,reject)=>{const child=spawn(path.resolve(binary),["stop-native-host",...args],{env:{...process.env,SECURECRT_MCP_HOME:app},windowsHide:true});let stdout="",stderr="";child.stdout.on("data",b=>stdout+=b);child.stderr.on("data",b=>stderr+=b);child.stdin.on("error",()=>{});child.stdin.end(input);const timeout=setTimeout(()=>{child.kill();reject(Error("selection timeout"))},15000);child.on("close",code=>{clearTimeout(timeout);resolve({code,stdout,stderr})});child.on("error",e=>{clearTimeout(timeout);reject(e)})})}
 try{
  let r=await select("0\n");assert.equal(r.code,0,r.stderr);assert(r.stdout.includes("TEST_BRIDGE_1")&&r.stdout.includes("TEST_BRIDGE_2")&&r.stdout.includes("Cancelled"));assert.deepEqual(stops,[]);
  r=await select("99\n");assert.notEqual(r.code,0);assert.deepEqual(stops,[]);
  r=await select("1\n",["--choose"]);assert.notEqual(r.code,0);assert.deepEqual(stops,[]);
  r=await select("1\n");assert.equal(r.code,0,r.stderr);assert.deepEqual(stops,[ids[0]]);assert(fs.existsSync(path.join(root,"instances",ids[1],"ready.json")));
  console.log("PASS: compiled stop selector labels, cancellation, invalid/unauthorized selection, exactly one stop and other host preserved");
 }finally{clearInterval(timer);fs.rmSync(app,{recursive:true,force:true})}
}
if(require.main===module)run(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1});module.exports={run};
