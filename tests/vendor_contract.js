"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const root=path.join(__dirname,"../vendor/portable-pty"),original=JSON.parse(fs.readFileSync(path.join(root,"upstream-sha256.json"),"utf8"));
for(const [file,expected]of Object.entries(original)){
 let text=fs.readFileSync(path.join(root,file),"utf8").replaceAll("\r\n","\n");
 if(file==="Cargo.toml")text=text.replace("headless = []\n","");
 if(file==="src/win/psuedocon.rs")text=text.replace('(if cfg!(feature = "headless") { 0 } else { PSUEDOCONSOLE_INHERIT_CURSOR })',"PSUEDOCONSOLE_INHERIT_CURSOR");
 assert.equal(crypto.createHash("sha256").update(text).digest("hex"),expected,"unexpected upstream change: "+file);
}
assert(fs.readFileSync(path.join(root,"LICENSE.md"),"utf8").includes("Permission is hereby granted"));
assert(fs.readFileSync(path.join(root,"Cargo.toml"),"utf8").includes("headless = []"));
assert(fs.readFileSync(path.join(root,"src/win/psuedocon.rs"),"utf8").includes('cfg!(feature = "headless")'));
console.log("PASS: portable-pty provenance/license and exact two-file opt-in headless patch");
