"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {MCP,command,assert,bytesPage}=require("./node_harness");
async function run(binary){
 if(process.platform!=="win32"){console.log("SKIP: native Windows ConPTY");return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"mcp-conpty-")),fake=path.join(root,"ssh.exe"),source=path.join(root,"ssh.rs");
 const isolated=path.join(root,"securecrt-mcp.exe");fs.copyFileSync(binary,isolated);binary=isolated;
 fs.writeFileSync(source,'use std::io; fn main(){println!("LOCAL_PTY_READY");let mut line=String::new();io::stdin().read_line(&mut line).unwrap();println!("LOCAL_PTY_INPUT:{}",line.trim());}');
 const built=await command("rustc",["--edition","2021",source,"-o",fake]);assert.equal(built.code,0,built.stderr);
 try{for(const enabled of [false,true]){
  const home=path.join(root,"app-"+enabled),env={...process.env,SECURECRT_MCP_HOME:home,PATH:root+path.delimiter+process.env.PATH};
  const init=await command(binary,["init"],env);assert.equal(init.code,0,init.stderr);
  if(enabled){const cfg=path.join(home,"config.toml");fs.writeFileSync(cfg,fs.readFileSync(cfg,"utf8").replace("allow_raw_send = false","allow_raw_send = true"));}
  const client=await new MCP(binary,env).start();let sid,cursor=0,text="";
  async function read(){const r=await client.tool("connector_stream_read",{command_id:sid,cursor,max_bytes:65536,wait_ms:1000});assert(!r.gap);assert(r.next_cursor>=cursor);cursor=r.next_cursor;text+=bytesPage(r).toString("utf8");assert(!text.includes("\x1b[6n"),"headless console must not require cursor replies");text=text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g,"").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").replaceAll("\r","");return r;}
  try{
   sid=(await client.tool("connector_stream_open",{backend:"openssh",target:"local-pty.fixture",mode:"pty",rows:24,cols:80})).session_id;
   const deadline=Date.now()+10000;while(!text.includes("LOCAL_PTY_READY")){const r=await read();assert(r.state!=="completed","local fixture exited: "+text);assert(Date.now()<deadline,"local ConPTY blocked before console output: "+text);}
   if(!enabled){const denied=await client.tool("connector_stream_write",{session_id:sid,text:"MUST_NOT_SEND",append_enter:true},true);assert(/interactive raw input disabled/.test(JSON.stringify(denied)));continue;}
   const resized=await client.tool("connector_resize",{session_id:sid,rows:40,cols:120});assert(resized.resized);
   assert((await client.tool("connector_stream_write",{session_id:sid,text:"UTF8_中文",append_enter:true})).sent);
   const until=Date.now()+10000;while(!text.includes("LOCAL_PTY_INPUT:UTF8_中文")){await read();assert(Date.now()<until,"native ConPTY Unicode round trip failed");}
   const events=fs.readFileSync(path.join(home,"audit.jsonl"),"utf8").trim().split("\n").map(JSON.parse);assert.equal(events.filter(e=>e.event==="stream_write").length,1);
  }finally{if(sid)await client.tool("connector_close",{session_id:sid});await client.close();}
 }}finally{fs.rmSync(root,{recursive:true,force:true});}
 console.log("PASS: compiled MCP / real Windows ConPTY / no cursor handshake, default raw denial, explicit Unicode round trip, resize and audit (fake SSH, no network)");
}
if(require.main===module)run(path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1});
module.exports={run};
