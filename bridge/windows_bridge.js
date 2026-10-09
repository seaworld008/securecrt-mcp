// Windows Active Scripting bridge. ES3 only; native APIs stay on the host thread.
// This module is also exercised with deterministic native API fixtures.
var MCP_WINDOWS_VERSION = "0.5.3";
function mcpFail(message) { throw String(message); }
function mcpError(e) { return String(e.description || e.message || e) + (e.number ? " ("+e.number+")" : ""); }
function mcpNow() { return new Date().getTime(); }
function mcpOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function mcpCount(o) { var n=0;for(var k in o) if(mcpOwn(o,k)) n++;return n; }
function mcpTrim(s) { return String(s).replace(/\s+$/, ""); }
function mcpUtf8(s) { return unescape(encodeURIComponent(String(s))); }
function mcpSize(s) { return mcpUtf8(s).length; }
function mcpString(s, name, limit) {
    if (typeof s != "string" || s.length > (limit || 65536)) mcpFail("invalid " + name);
    return s;
}
function mcpJson(value) {
    function quote(s) {
        return '"' + String(s).replace(/["\\\u0000-\u001f\u007f-\uffff]/g, function(c) {
            if (c == '"' || c == "\\") return "\\" + c;
            return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
        }) + '"';
    }
    if (value === null || typeof value == "undefined") return "null";
    if (typeof value == "string") return quote(value);
    if (typeof value == "boolean") return value ? "true" : "false";
    if (typeof value == "number") { if (!isFinite(value)) mcpFail("invalid JSON number"); return String(value); }
    var out = [], k;
    if (value instanceof Array) {
        for (k = 0; k < value.length; k++) out.push(mcpJson(value[k]));
        return "[" + out.join(",") + "]";
    }
    for (k in value) if (mcpOwn(value, k)) out.push(quote(k) + ":" + mcpJson(value[k]));
    return "{" + out.join(",") + "}";
}
function mcpParse(source) {
    // Never eval IPC JSON. Bound recursive descent and reject duplicate/prototype keys.
    source = String(source).replace(/^\ufeff/, "");
    var i = 0, depth = 0;
    function ws() { while (/\s/.test(source.charAt(i)) && i < source.length) i++; }
    function str() {
        var out = "", c, h;
        i++;
        while (i < source.length) {
            c = source.charAt(i++);
            if (c == '"') return out;
            if (c == "\\") {
                c = source.charAt(i++);
                if (c == "u") {
                    h = source.substr(i, 4);
                    if (!/^[0-9a-fA-F]{4}$/.test(h)) mcpFail("invalid JSON escape");
                    out += String.fromCharCode(parseInt(h, 16)); i += 4;
                } else {
                    var escapes = {'"':'"', '\\':'\\', '/':'/', b:'\b', f:'\f', n:'\n', r:'\r', t:'\t'};
                    if (!mcpOwn(escapes, c)) mcpFail("invalid JSON escape");
                    out += escapes[c];
                }
            } else { if (c.charCodeAt(0) < 32) mcpFail("invalid JSON string"); out += c; }
        }
        mcpFail("unterminated JSON string");
    }
    function value() {
        if (++depth > 32) mcpFail("JSON nesting limit");
        ws(); var c = source.charAt(i), result, key, match;
        if (c == '"') result = str();
        else if (c == "{" || c == "[") {
            var object = c == "{"; result = object ? {} : []; i++; ws();
            if (source.charAt(i) != (object ? "}" : "]")) while (true) {
                if (object) {
                    if (source.charAt(i) != '"') mcpFail("invalid JSON key");
                    key = str(); ws();
                    if (key == "__proto__" || key == "constructor" || key == "prototype" || mcpOwn(result, key)) mcpFail("invalid JSON key");
                    if (source.charAt(i++) != ":") mcpFail("invalid JSON colon");
                    result[key] = value();
                } else result.push(value());
                ws(); c = source.charAt(i);
                if (c != ",") break;
                i++; ws();
            }
            if (source.charAt(i++) != (object ? "}" : "]")) mcpFail("invalid JSON end");
        } else {
            match = /^(true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.substr(i));
            if (!match) mcpFail("invalid JSON value");
            i += match[0].length;
            result = match[0] == "true" ? true : match[0] == "false" ? false : match[0] == "null" ? null : Number(match[0]);
            if (typeof result == "number" && !isFinite(result)) mcpFail("invalid JSON number");
        }
        depth--; return result;
    }
    var result = value(); ws(); if (i != source.length) mcpFail("trailing JSON data"); return result;
}
function mcpSha256(text) {
    var bytes = mcpUtf8(text), words = [], i, j, a, b, c, d, e, f, g, h, t1, t2;
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function ro(x,n) { return (x >>> n) | (x << (32-n)); }
    for (i=0;i<bytes.length;i++) words[i>>2] = (words[i>>2] || 0) | bytes.charCodeAt(i) << (24-(i%4)*8);
    words[bytes.length>>2] = (words[bytes.length>>2] || 0) | 0x80 << (24-(bytes.length%4)*8);
    var total = ((bytes.length+9+63)>>6)<<4;
    for (i=0;i<total;i++) words[i] = words[i] || 0;
    words[total-1] = bytes.length*8;
    for (i=0;i<total;i+=16) {
        var w = words.slice(i,i+16);
        for (j=16;j<64;j++) w[j] = ((ro(w[j-2],17)^ro(w[j-2],19)^(w[j-2]>>>10))+w[j-7]+(ro(w[j-15],7)^ro(w[j-15],18)^(w[j-15]>>>3))+w[j-16])|0;
        a=H[0];b=H[1];c=H[2];d=H[3];e=H[4];f=H[5];g=H[6];h=H[7];
        for(j=0;j<64;j++) {
            t1=(h+(ro(e,6)^ro(e,11)^ro(e,25))+((e&f)^(~e&g))+K[j]+w[j])|0;
            t2=((ro(a,2)^ro(a,13)^ro(a,22))+((a&b)^(a&c)^(b&c)))|0;
            h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
        }
        var v=[a,b,c,d,e,f,g,h]; for(j=0;j<8;j++) H[j]=(H[j]+v[j])|0;
    }
    var hex="";for(i=0;i<8;i++) hex+=("00000000"+(H[i]>>>0).toString(16)).slice(-8);return hex;
}
function McpWindowsAdapter(host, backend, instance, runtime, sourceHash) {
    this.host=host;this.backend=backend;this.instance=instance;this.runtime=runtime || {};
    this.sourceHash=sourceHash;this.sessions={};this.attachments={};this.tokens={};this.captures={};this.unresolved={};
    this.owner="legacy";this.deadline=0;this.sent=false;this.counter=0;
    this.events=[];this.stage="created";this.observedApis={};
    this.metrics={requests:0,native_reads:0,context_rejections:0};
}
McpWindowsAdapter.prototype.unique=function(kind) { return this.instance+"/"+kind+"/"+(++this.counter); };
McpWindowsAdapter.prototype.record=function(event,capture,detail) {
    this.events.push({time_ms:mcpNow(),event:event,capture_id:capture || null,detail:detail || null});
    if(this.events.length>32) this.events.shift();
};
McpWindowsAdapter.prototype.metadata=function(tab) {
    if(this.backend=="xshell") {
        var s=this.host.Session;
        return {session_name:String(s.SessionName),tab_text:String(s.TabText),remote_address:String(s.RemoteAddress),remote_port:Number(s.RemotePort),user:String(s.UserName)};
    }
    this.stage="read tab.Session.Config";
    var cfg=tab.Session.Config;
    function option(name) { try { var value=cfg.GetOption(name);return value==null?null:String(value); } catch(e) { return null; } }
    return {configured_host:option("Hostname"),configured_user:option("Username"),protocol:option("Protocol Name"),port:option("Port")};
};
McpWindowsAdapter.prototype.screenObject=function(entry) { return this.backend=="xshell" ? this.host.Screen : entry.tab.Screen; };
McpWindowsAdapter.prototype.get=function(s,r,c,r2,c2) { this.metrics.native_reads++;var value=String(this.backend=="xshell"?s.Get(r,c,r2,c2):s.Get2(r,c,r2,c2));this.observedApis[this.backend=="xshell"?"xsh.Screen.Get":"tab.Screen.Get2"]=true;return value; };
McpWindowsAdapter.prototype.input=function(entry) {
    var s=this.screenObject(entry),r=Number(s.CurrentRow),c=Number(s.CurrentColumn),cols=Number(s.Columns);
    return {current_line:mcpTrim(this.get(s,r,1,r,cols)),cursor_row:r,cursor_column:c,columns:cols};
};
McpWindowsAdapter.prototype.sameInput=function(a,b) { return mcpJson(a)==mcpJson(b); };
McpWindowsAdapter.prototype.session=function(id) {
    mcpString(id,"session",512);var e=this.sessions[id];
    if(!e || e.invalid || (mcpNow()>e.expires && !this.unresolved[id])) mcpFail("stale_session: list and inspect again");
    if(this.backend=="xshell") {
        var current=this.metadata();
        if(current.session_name!=e.metadata.session_name || current.tab_text!=e.metadata.tab_text) {
            if(!this.host.Session.SelectTabName(e.metadata.session_name || e.metadata.tab_text)) mcpFail("session_not_found");
            this.observedApis["xsh.Session.SelectTabName"]=true;
        }
        if(!this.host.Session.Connected || mcpJson(this.metadata())!=mcpJson(e.metadata)) { e.invalid=true;mcpFail("stale_session: endpoint changed"); }
    } else {
        try {
            if(!e.tab.Session.Connected || Number(e.tab.Index)!=e.index || String(e.tab.Caption)!=e.caption || mcpJson(this.metadata(e.tab))!=mcpJson(e.metadata)) e.invalid=true;
        } catch(error) { e.invalid=true; }
        if(e.invalid) mcpFail("stale_session: endpoint changed");
    }
    e.expires=mcpNow()+120000;return e;
};
McpWindowsAdapter.prototype.capabilities=function() { return ["session_leases","screen_tokens","attachments","prepare_and_begin","per_session_capture","interrupt","ack_fresh_view","poll_bulk","file_ipc"]; };
McpWindowsAdapter.prototype.ping=function() {
    var apis={},apiErrors={},names=this.backend=="xshell"?
        ["xsh.Session.Connected","xsh.Session.SelectTabName","xsh.Session.SessionName","xsh.Session.TabText","xsh.Session.Sleep","xsh.Screen.Get","xsh.Screen.CurrentRow","xsh.Screen.CurrentColumn","xsh.Screen.Rows","xsh.Screen.Columns","xsh.Screen.Synchronous","xsh.Screen.Send","xsh.Screen.WaitForStrings"]:
        ["crt.GetTabCount","crt.GetTab","crt.Sleep","tab.Caption","tab.Index","tab.Session.Connected","tab.Screen.Get2","tab.Screen.CurrentRow","tab.Screen.CurrentColumn","tab.Screen.Rows","tab.Screen.Columns","tab.Screen.ReadString","tab.Screen.MatchIndex","tab.Screen.Synchronous","tab.Screen.IgnoreEscape","tab.Screen.Send"];
    // COM method property reads can invoke the method, even under typeof.
    // Only inspect scalar properties. Methods are confirmed by successful real
    // calls; ping must never wait for input or send anything to the terminal.
    var methods=/\.(GetTabCount|GetTab|Sleep|SelectTabName|Get|Get2|ReadString|Send|WaitForStrings)$/;
    for(var i=0;i<names.length;i++) {
        if(methods.test(names[i])) { apis[names[i]]=this.observedApis[names[i]] || null;continue; }
        try {
            var parts=names[i].split("."),value;
            if(parts[0]=="tab") { if(this.host.GetTabCount()<1) { apis[names[i]]=null;continue; } value=this.host.GetTab(1); }
            else value=this.host;
            for(var j=1;j<parts.length;j++) value=value[parts[j]];
            apis[names[i]]=value!=null;
        } catch(e) { apis[names[i]]=false;apiErrors[names[i]]=mcpError(e); }
    }
    if(this.backend=="xshell") apis["xsh.binding_reference_safe"]=true;
    var result={bridge_version:MCP_WINDOWS_VERSION,protocol_version:2,script_engine:"JScript",python:null,platform:"Windows",architecture:this.runtime.architecture || "unknown",os_version:this.runtime.os_version || "unknown",adapter_sha256:this.sourceHash,api_capabilities:apis,api_errors:apiErrors,capabilities:this.capabilities(),metrics:this.metrics,unresolved_sessions:[]};
    result.recent_events=this.events;
    result[this.backend+"_version"]=this.runtime.terminal_version || "unknown";
    if(this.backend=="securecrt") result.securecrt_version=String(this.host.Version);
    for(var key in this.unresolved) if(mcpOwn(this.unresolved,key)) result.unresolved_sessions.push(this.unresolved[key]);
    result.unresolved=result.unresolved_sessions.length?result.unresolved_sessions[0]:null;
    return result;
};
McpWindowsAdapter.prototype.list=function() {
    var out=[],errors=[],self=this;
    function add(tab,index) {
        var metadata=self.metadata(tab),id=null,key;
        if(self.backend=="securecrt") { for(key in self.sessions) if(mcpOwn(self.sessions,key)) {
            var old=self.sessions[key];
            try {
                if(!old.invalid && old.index==index && old.tab.Session.Connected && Number(old.tab.Index)==index && String(old.tab.Caption)==old.caption && mcpJson(self.metadata(old.tab))==mcpJson(old.metadata)) { id=key;break; }
            } catch(error) {}
        } }
        else { for(key in self.sessions) if(mcpOwn(self.sessions,key) && !self.sessions[key].invalid && mcpJson(self.sessions[key].metadata)==mcpJson(metadata)) { id=key;break; } }
        if(!id) id=self.unique("session");
        if(!mcpOwn(self.sessions,id) && mcpCount(self.sessions)>=128) mcpFail("session_limit");
        var e={metadata:metadata,expires:mcpNow()+120000,tab:tab,index:index,caption:tab?String(tab.Caption):null};
        if(self.backend=="securecrt" && self.sessions[id]) { e=self.sessions[id];e.expires=mcpNow()+120000; }
        self.sessions[id]=e;
        var value={id:id,session_id:id,connected:true,lease_expires_ms:e.expires,capabilities:self.capabilities()};
        for(var key in metadata) if(mcpOwn(metadata,key)) value[key]=metadata[key];
        if(tab) { value.caption=e.caption;value.index=index;value.unresolved=self.unresolved[id] || null; }
        out.push(value);
    }
    if(this.backend=="securecrt") {
        this.stage="read crt.GetTabCount";var count=Number(this.host.GetTabCount());this.observedApis["crt.GetTabCount"]=true;
        for(var i=1;i<=count;i++) {
            this.stage="read crt.GetTab("+i+")";var tab=this.host.GetTab(i);this.observedApis["crt.GetTab"]=true;
            this.stage="read tab.Session.Connected (tab "+i+")";
            if(tab.Session.Connected) { this.stage="register tab "+i;add(tab,i); }
        }
    } else if(this.host.Session.Connected) {
        var original=this.metadata(),names=[original.session_name],seen={};
        if(this.discoverNames) names=names.concat(this.discoverNames());
        try {
            for(var n=0;n<names.length && n<128;n++) {
                var name=names[n];if(!name || seen["$"+name]) continue;seen["$"+name]=true;
                try { if(name!=original.session_name) { var selected=this.host.Session.SelectTabName(name);this.observedApis["xsh.Session.SelectTabName"]=true;if(!selected) continue; } if(this.host.Session.Connected) add(null,0); }
                catch(e) { errors.push({name:name,error:"session_select_failed"}); }
            }
        } finally { if(this.metadata().session_name!=original.session_name) this.host.Session.SelectTabName(original.session_name); }
    }
    return {bridge_instance:this.instance,enumeration:this.backend=="xshell"?"named_files":"tabs",sessions:out,capabilities:this.capabilities(),discovery:{errors:errors}};
};
McpWindowsAdapter.prototype.readScreen=function(id) {
    var e=this.session(id),s=this.screenObject(e),value=this.input(e),r=value.cursor_row;
    var first=this.backend=="xshell"?Math.max(0,r-49):1,last=this.backend=="xshell"?r:Number(s.Rows);
    var text=this.get(s,first,1,last,value.columns);if(mcpSize(text)>65536) mcpFail("screen_too_large");
    var token=this.unique("screen"),digest=mcpSha256(text+"\x00"+value.cursor_row+":"+value.cursor_column);
    this.tokens[token]={session:id,digest:digest,expires:mcpNow()+30000};
    value.text=text;value.rows=last-first+1;value.session=id;value.screen_token=token;
    value.token_expires_ms=mcpNow()+30000;value.configured_endpoint=e.metadata;value.unresolved=this.unresolved[id] || null;
    return value;
};
McpWindowsAdapter.prototype.attachment=function(id,write) {
    var a=this.attachments[id];if(!a || mcpNow()>a.expires) mcpFail("stale_attachment");
    if(a.owner!=this.owner) mcpFail("ownership_conflict");if(write && a.mode=="observe") mcpFail("observe attachment does not permit writes");
    this.session(a.session);a.expires=mcpNow()+600000;return a;
};
McpWindowsAdapter.prototype.attach=function(p) {
    if(mcpCount(this.attachments)>=128) mcpFail("attachment_limit");
    var e=this.session(p.session),input=this.input(e),mode=p.mode || "shared";
    if(mode!="shared" && mode!="exclusive" && mode!="observe") mcpFail("invalid ownership mode");
    this.ownership(p.session);
    if(mode=="exclusive") for(var other in this.attachments) if(mcpOwn(this.attachments,other)) {
        var existing=this.attachments[other];
        if(existing.session==p.session && existing.owner!=this.owner && mcpNow()<existing.expires) mcpFail("ownership_conflict");
    }
    if(p.expected_prompt!=null && input.current_line!=mcpTrim(p.expected_prompt)) mcpFail("prompt_mismatch");
    if(mode!="observe" && p.expected_prompt==null && (!/[#$%]$/.test(input.current_line) || /password|passphrase|--more--/i.test(input.current_line))) mcpFail("input_context_required");
    var id=this.unique("attachment");
    this.attachments[id]={session:p.session,entry:e,context:input,mode:mode,owner:this.owner,expires:mcpNow()+600000,awaiting:false,marker:null};
    return {attachment_id:id,session:p.session,current_line:input.current_line,mode:mode,configured_endpoint:e.metadata,unresolved:this.unresolved[p.session] || null};
};
McpWindowsAdapter.prototype.ownership=function(sid) {
    for(var id in this.attachments) if(mcpOwn(this.attachments,id)) {
        var a=this.attachments[id];if(a.session==sid && a.owner!=this.owner && a.mode=="exclusive" && mcpNow()<a.expires) mcpFail("ownership_conflict");
    }
};
McpWindowsAdapter.prototype.beforeSend=function() { if(this.deadline && mcpNow()>=this.deadline) mcpFail("expired request immediately before native send; nothing sent"); };
McpWindowsAdapter.prototype.yieldHost=function(ms) {
    if(this.backend=="xshell" && mcpCount(this.captures)>0) {
        // Synchronous capture requires a native wait to pump incoming output.
        // A never-sent instance-specific sentinel permits a bounded bulk pump;
        // waiting for each newline would turn long output into one RPC per row.
        this.host.Screen.WaitForStrings(["__MCP_HOST_YIELD_"+this.instance+"__"],Math.max(1,Math.min(20,ms)));
        this.observedApis["xsh.Screen.WaitForStrings"]=true;
    } else if(this.backend=="xshell") {
        this.host.Session.Sleep(ms);this.observedApis["xsh.Session.Sleep"]=true;
    } else {
        this.host.Sleep(ms);this.observedApis["crt.Sleep"]=true;
    }
};

McpWindowsAdapter.prototype.context=function(a) {
    var expected=a.context,until=mcpNow()+1500,stable=0;
    if(!a.awaiting) { if(this.sameInput(expected,this.input(a.entry))) return; }
    else while(mcpNow()<until) {
        this.beforeSend();var current=this.input(a.entry);
        if(current.columns!=expected.columns) break;
        if(current.current_line==expected.current_line && current.cursor_column==expected.cursor_column) {
            stable++;if(stable==2) { a.context=current;a.awaiting=false;return; }
        } else {
            stable=0;var line=current.current_line;
            var owned=a.marker && line.indexOf(a.marker+" ")==0 && /^\d{1,3}$/.test(line.substr(a.marker.length+1)) && Number(line.substr(a.marker.length+1))<=255;
            var pending=line==expected.current_line && current.cursor_column<expected.cursor_column;
            if(line && !owned && !pending) break;
            if(this.backend=="securecrt") {
                // A completed command can leave its prompt in the native
                // pre-display buffer. Sleep does not consume that buffer.
                // Pump only a verified blank/owned transition, never new input.
                var screen=this.screenObject(a.entry);
                screen.ReadString("__MCP_IDLE_PUMP_"+this.instance+"__",1);
                this.observedApis["tab.Screen.ReadString"]=true;
            }
        }
        this.yieldHost(10);
    }
    this.metrics.context_rejections++;mcpFail("context_changed: inspect original input boundary; nothing sent");
};
McpWindowsAdapter.prototype.begin=function(p) {
    var a=this.attachment(p.attachment_id,true),sid=a.session,e=this.session(sid),s=this.screenObject(e);
    if(p.session && p.session!=sid) mcpFail("attachment_mismatch");this.ownership(sid);
    if(this.unresolved[sid]) mcpFail("unresolved: inspect and acknowledge idle first");
    if(mcpCount(this.captures)>=16) mcpFail("capture_limit");
    for(var key in this.captures) if(mcpOwn(this.captures,key) && this.captures[key].session==sid) mcpFail("busy");
    if(mcpOwn(this.captures,p.capture_id)) mcpFail("capture_id conflict");
    mcpString(p.capture_id,"capture_id",128);mcpString(p.text,"text",65536);
    if(p.capture_id=="__proto__" || p.capture_id=="constructor" || p.capture_id=="prototype") mcpFail("invalid capture_id");
    if(p.completion_marker!=null) mcpString(p.completion_marker,"completion_marker",256);
    if(/[\u0000-\u001f\u007f]/.test(p.text)) mcpFail("control characters not accepted");
    if(typeof p.runtime_ms!="number" || p.runtime_ms<1000 || p.runtime_ms>3600000 || p.runtime_ms%1) mcpFail("invalid runtime_ms");
    if(p.expected_prompt!=null && this.input(e).current_line!=mcpTrim(p.expected_prompt)) mcpFail("prompt_mismatch");
    this.context(a);this.session(sid);this.beforeSend();
    var c={id:p.capture_id,session:sid,owner:this.owner,entry:e,aid:p.attachment_id,until:mcpNow()+p.runtime_ms,heartbeat:mcpNow(),oldSync:s.Synchronous,oldIgnore:null,marker:p.completion_marker || null,pending:"",row:Number(s.CurrentRow),column:Number(s.CurrentColumn),partial:""};
    c.anchorRow=c.row;c.anchorColumn=c.column;c.anchor=this.get(s,c.row,1,c.row,Math.max(1,c.column-1));
    this.captures[c.id]=c;
    this.record("begin",c.id);
    try {
        if(this.backend=="securecrt") { c.oldIgnore=s.IgnoreEscape;s.IgnoreEscape=true; }
        s.Synchronous=true;this.beforeSend();this.sent=true;s.Send(p.text+"\r");this.observedApis[this.backend=="xshell"?"xsh.Screen.Send":"tab.Screen.Send"]=true;
    } catch(err) { this.end({capture_id:c.id,confirmed_complete:false});throw err; }
    return {capture_id:c.id,sent:true};
};
McpWindowsAdapter.prototype.beginScreen=function(p) {
    var token=this.tokens[p.screen_token];delete this.tokens[p.screen_token];
    var view=this.readScreen(p.session),digest=mcpSha256(view.text+"\x00"+view.cursor_row+":"+view.cursor_column);
    if(!token || token.session!=p.session || token.digest!=digest || token.expires<mcpNow() || view.current_line!=mcpTrim(p.expected_prompt)) mcpFail("stale_screen: inspect again; nothing sent");
    var a=this.attach({session:p.session,mode:"shared",expected_prompt:p.expected_prompt});
    p.attachment_id=a.attachment_id;
    try { var result=this.begin(p);this.captures[p.capture_id].temporaryAttachment=true;return result; }
    catch(error) { delete this.attachments[a.attachment_id];throw error; }
};
McpWindowsAdapter.prototype.poll=function(p) {
    var c=this.captures[p.capture_id];
    if(!c) {
        this.record("poll_missing",p.capture_id);
        for(var k in this.unresolved) if(mcpOwn(this.unresolved,k) && this.unresolved[k].capture_id==p.capture_id) return {text:"",expired:true,overflow:false,capture_may_be_incomplete:true};
        mcpFail("capture_mismatch");
    }
    if(c.owner!=this.owner) mcpFail("ownership_conflict");this.session(c.session);c.heartbeat=mcpNow();
    var s=this.screenObject(c.entry),text="",overflow=false,started=mcpNow(),limit=Math.min(256,Math.max(1,p.max_reads || 128)),i;
    if(this.backend=="securecrt") {
        if(!c.pending && c.marker && !c.markerLineDone) {
            // Match the actual result line, not the marker literal in the
            // echoed command. ReadString drains native output in one call;
            // one COM call per row cannot keep up with large UTF-8 captures.
            var delimiter=c.markerSeen?"\n":"\n"+c.marker+" ";
            var bulk=String(s.ReadString(delimiter,1)),bulkMatch=Number(s.MatchIndex);
            this.metrics.native_reads++;this.observedApis["tab.Screen.ReadString"]=true;
            c.pending=bulk+(bulkMatch==1?delimiter:"");
            if(bulkMatch==1) { if(c.markerSeen) c.markerLineDone=true;else c.markerSeen=true; }
        } else if(!c.pending && !c.marker) for(i=0;i<limit;i++) {
            var patterns=p.wait_for?[p.wait_for,"\n"]:["\n"];
            var line=String(p.wait_for?s.ReadString(p.wait_for,"\n",1):s.ReadString("\n",1)),match=Number(s.MatchIndex);this.metrics.native_reads++;this.observedApis["tab.Screen.ReadString"]=true;
            if(match>0 && match<=patterns.length) line+=patterns[match-1];
            c.pending+=line;
            if(mcpSize(c.pending)>65536 || !match || (c.marker && line.indexOf(c.marker+" ")>=0) || mcpNow()-started>=75) break;
        }
        var end=Math.min(c.pending.length,16384);if(end<c.pending.length && /[\ud800-\udbff]/.test(c.pending.charAt(end-1))) end--;
        text=c.pending.substr(0,end);c.pending=c.pending.substr(end);
        if(mcpSize(c.pending)>16777216) { c.pending="";overflow=true; }
    } else {
        if(!c.pending && c.marker && !c.markerPumpDone) {
            // Keep the native receive loop pumping through complete bursts,
            // including background Tabs. Tiny sentinel waits can return only
            // a few rendered rows, making IPC latency throttle SSH reception.
            var pumped=Number(s.WaitForStrings(["\n"+c.marker+" "],Math.max(1,Math.min(1000,c.until-mcpNow()))));
            this.observedApis["xsh.Screen.WaitForStrings"]=true;
            if(pumped>0) c.markerPumpDone=true;
        }
        if(!c.pending) for(i=0;i<limit;i++) {
            var row=Number(s.CurrentRow),anchor=this.get(s,c.anchorRow,1,c.anchorRow,Math.max(1,c.anchorColumn-1));
            if(anchor!=c.anchor || row<c.row) { overflow=true;break; }
            var remaining=16777216-mcpSize(text),width=Math.max(1,Number(s.Columns))*4+2;
            if(remaining<width) break;
            var last=Math.min(row-1,c.row+Math.max(1,Math.floor(remaining/width))-1);
            if(last>=c.row) {
                var first=this.get(s,c.row,c.column,c.row,Number(s.Columns));
                if(first.indexOf(c.partial)!=0) { overflow=true;break; }
                else {
                    text+=first.substr(c.partial.length)+"\n";c.partial="";
                    if(last>c.row) text+=this.get(s,c.row+1,1,last,Number(s.Columns))+"\n";
                    c.row=last+1;c.column=1;
                }
            }
            if(!c.marker && c.row==row && !overflow) {
                var partial=this.get(s,row,c.column,row,Number(s.Columns));
                if(partial.indexOf(c.partial)!=0) overflow=true;else { text+=partial.substr(c.partial.length);c.partial=partial; }
            }
            if(overflow || mcpSize(text)>16777216 || (c.marker && text.indexOf("\n"+c.marker+" ")>=0) || (!c.marker && text) || mcpNow()>=c.until || mcpNow()-started>=75) break;
            if(last>=row-1) {
                this.yieldHost(20);this.session(c.session);s=this.screenObject(c.entry);
            }
        }
        c.pending+=text;
        if(mcpSize(c.pending)>16777216) { overflow=true;c.pending=""; }
        var xsEnd=Math.min(c.pending.length,16384);if(xsEnd<c.pending.length && /[\ud800-\udbff]/.test(c.pending.charAt(xsEnd-1))) xsEnd--;
        text=c.pending.substr(0,xsEnd);c.pending=c.pending.substr(xsEnd);
    }
    this.record("poll",c.id,{elapsed_ms:mcpNow()-started,characters:text.length,pending_characters:c.pending.length});
    return {text:text,overflow:overflow,expired:mcpNow()>=c.until,current_line:this.input(c.entry).current_line,pending_bytes:mcpSize(c.pending),capture_may_be_incomplete:overflow};
};
McpWindowsAdapter.prototype.end=function(p) {
    var c=this.captures[p.capture_id];if(!c) {
        for(var sid in this.unresolved) if(mcpOwn(this.unresolved,sid) && this.unresolved[sid].capture_id==p.capture_id && this.unresolved[sid].owner==this.owner) return {released:true,unresolved:true,restore_errors:[]};
        mcpFail("capture_mismatch");
    }
    if(typeof p.confirmed_complete!="boolean") mcpFail("invalid confirmed_complete");delete this.captures[p.capture_id];
    this.record("end",c.id,p.confirmed_complete?"confirmed":"uncertain");
    var errors=[];
    try {
        this.session(c.session);var s=this.screenObject(c.entry);
        if(this.backend=="securecrt" && p.confirmed_complete && c.marker) {
            // Finish the owned pre-display transition before releasing the
            // attachment; a newly opened attachment cannot safely pump it.
            var line=this.input(c.entry).current_line;
            if(!line || line.indexOf(c.marker+" ")==0) {
                s.ReadString(c.anchor || "__MCP_IDLE_PUMP_"+this.instance+"__",1);
                this.observedApis["tab.Screen.ReadString"]=true;
            }
        }
        s.Synchronous=c.oldSync;if(this.backend=="securecrt") s.IgnoreEscape=c.oldIgnore;
    } catch(e) { errors.push("native_state_restore_failed"); }
    if(!p.confirmed_complete || errors.length) this.unresolved[c.session]={session:c.session,capture_id:c.id,owner:c.owner,deadline_expired:mcpNow()>=c.until};
    var a=this.attachments[c.aid];if(a) { a.awaiting=!!(p.confirmed_complete && c.marker && !errors.length);a.marker=c.marker; }
    if(c.temporaryAttachment) delete this.attachments[c.aid];
    return {released:true,unresolved:!!this.unresolved[c.session],restore_errors:errors};
};
McpWindowsAdapter.prototype.ack=function(p) {
    for(var k in this.captures) if(mcpOwn(this.captures,k) && this.captures[k].session==p.session) mcpFail("busy");
    this.ownership(p.session);var token=this.tokens[p.screen_token];delete this.tokens[p.screen_token];
    var view=this.readScreen(p.session),digest=mcpSha256(view.text+"\x00"+view.cursor_row+":"+view.cursor_column);
    if(!token || token.session!=p.session || mcpNow()>token.expires || token.digest!=digest) mcpFail("stale_screen");
    if(view.current_line!=mcpTrim(p.expected_prompt)) mcpFail("prompt_mismatch");
    delete this.unresolved[p.session];
    for(k in this.attachments) if(mcpOwn(this.attachments,k)) {
        var a=this.attachments[k];if(a.owner==this.owner && a.session==p.session) { a.context=this.input(a.entry);a.awaiting=false;a.marker=null; }
    }
    view.unresolved=null;return {idle_acknowledged:true,remote_termination_confirmed:false,screen:view};
};
McpWindowsAdapter.prototype.maintain=function() {
    var now=mcpNow(),k,c;
    // Observed disconnects permanently invalidate a generation. Reconnecting
    // the same saved profile must never revive an old attachment or token.
    if(!this.lastConnectionCheck || now-this.lastConnectionCheck>=200) {
        this.lastConnectionCheck=now;
        for(k in this.sessions) if(mcpOwn(this.sessions,k) && !this.sessions[k].invalid) {
            var entry=this.sessions[k];
            try {
                if(this.backend=="securecrt") {
                    if(!entry.tab.Session.Connected || Number(entry.tab.Index)!=entry.index || String(entry.tab.Caption)!=entry.caption) entry.invalid=true;
                } else if(String(this.host.Session.SessionName)==entry.metadata.session_name && !this.host.Session.Connected) entry.invalid=true;
            } catch(disconnected) { entry.invalid=true; }
        }
    }
    for(k in this.captures) if(mcpOwn(this.captures,k)) { c=this.captures[k];if(now>=c.until || now-c.heartbeat>10000) { this.record("watchdog",k);this.end({capture_id:k,confirmed_complete:false}); } }
    for(k in this.tokens) if(mcpOwn(this.tokens,k) && now>this.tokens[k].expires) delete this.tokens[k];
    for(k in this.attachments) if(mcpOwn(this.attachments,k) && now>this.attachments[k].expires) delete this.attachments[k];
    for(k in this.sessions) if(mcpOwn(this.sessions,k) && now>this.sessions[k].expires && !this.unresolved[k]) {
        var protectedSession=false;
        for(var aid in this.attachments) if(mcpOwn(this.attachments,aid) && this.attachments[aid].session==k) protectedSession=true;
        for(var cid in this.captures) if(mcpOwn(this.captures,cid) && this.captures[cid].session==k) protectedSession=true;
        if(!protectedSession) delete this.sessions[k];
    }
};
McpWindowsAdapter.prototype.dispatch=function(method,p) {
    this.maintain();var a,e,c;
    if(method=="ping") return this.ping();
    if(method=="list_sessions") return this.list();
    if(method=="read_screen") return this.readScreen(p.session);
    if(method=="attach") return this.attach(p);
    if(method=="detach") { this.attachment(p.attachment_id,false);delete this.attachments[p.attachment_id];return {detached:true,sent:false,remote_termination_confirmed:false}; }
    if(method=="heartbeat") { a=this.attachment(p.attachment_id,false);return {attachment_id:p.attachment_id,session:a.session,unresolved:this.unresolved[a.session] || null}; }
    if(method=="prepare_and_begin") return this.begin(p);
    if(method=="begin") return this.beginScreen(p);
    if(method=="poll" || method=="poll_bulk") return this.poll(p);
    if(method=="end") { c=this.captures[p.capture_id];if(c && c.owner!=this.owner) mcpFail("ownership_conflict");return this.end(p); }
    if(method=="acknowledge_idle") return this.ack(p);
    if(method=="focus_session") { e=this.session(p.session);if(this.backend=="securecrt") e.tab.Activate();return {focused:true}; }
    if(method=="interrupt") {
        c=this.captures[p.capture_id] || this.unresolved[p.session];
        if(!c || c.session!=p.session || (c.id || c.capture_id)!=p.capture_id || c.owner!=this.owner) mcpFail("capture_mismatch");
        e=this.session(p.session);this.ownership(p.session);this.beforeSend();this.sent=true;this.screenObject(e).Send("\x03");
        if(this.captures[p.capture_id]) this.end({capture_id:p.capture_id,confirmed_complete:false});
        return {interrupt_sent:true,remote_termination_confirmed:false};
    }
    mcpFail("unsupported native method");
};
McpWindowsAdapter.prototype.request=function(request,token) {
    this.sent=false;var result={id:request.id,protocol_version:2,bridge_instance:this.instance,ok:false,sent:false};
    try {
        if(request.protocol_version!=2 || typeof request.token!="string") mcpFail("authentication failed");
        var mismatch=request.token.length^token.length;for(var i=0;i<Math.max(request.token.length,token.length);i++) mismatch|=(request.token.charCodeAt(i)||0)^(token.charCodeAt(i)||0);
        if(mismatch) mcpFail("authentication failed");
        mcpString(request.id,"id",128);mcpString(request.client_id,"client_id",128);
        if(typeof request.deadline_ms!="number" || !isFinite(request.deadline_ms) || request.deadline_ms<=mcpNow()) mcpFail("expired_request");
        mcpString(request.method,"method",64);
        if(request.params!=null && (typeof request.params!="object" || request.params instanceof Array)) mcpFail("invalid params");
        this.owner=request.client_id;this.deadline=request.deadline_ms;this.metrics.requests++;
        result.result=this.dispatch(request.method,request.params || {});result.ok=true;
    } catch(e) { result.error=mcpError(e).substr(0,1024);result.error_code=result.error.split(":")[0]; }
    finally { this.deadline=0;result.sent=this.sent?(result.ok?true:null):false; }
    return result;
};

function mcpReadUtf8(path) {
    var stream=new ActiveXObject("ADODB.Stream");stream.Type=2;stream.Charset="utf-8";stream.Open();
    try { stream.LoadFromFile(path);return stream.ReadText(); } finally { stream.Close(); }
}
function mcpWriteJson(fso,path,value) {
    var tmp=path+".tmp",handle=fso.CreateTextFile(tmp,true,false);
    try { handle.Write(mcpJson(value)); } finally { handle.Close(); }
    // The previous heartbeat can remain visible while a concurrent reader holds it.
    try { if(fso.FileExists(path)) fso.DeleteFile(path,true);fso.MoveFile(tmp,path); }
    catch(e) { if(fso.FileExists(tmp)) fso.DeleteFile(tmp,true); }
}
// Result consumers remove response files concurrently with native enumeration.
// A disappearing unrelated file must never terminate the terminal script.
function mcpRequestPaths(fso,dir) {
    var paths=[],files=new Enumerator(fso.GetFolder(dir).Files);
    while(!files.atEnd()) {
        try {
            var file=files.item(),name=String(file.Name);
            if(/^[a-f0-9-]+\.request\.json$/i.test(name)) paths.push(String(file.Path));
        } catch(error) { /* A concurrent consumer removed this file. */ }
        try { files.moveNext(); } catch(error) { break; }
    }
    paths.sort();return paths;
}
function mcpNotify(fso,dir,message,style) {
    var shell=new ActiveXObject("WScript.Shell");
    var script=fso.BuildPath(dir,"notice-"+mcpNow()+"-"+Math.floor(Math.random()*100000)+".vbs"),file=fso.CreateTextFile(script,true,true);
    // A separate, short-lived OS process shows the notice while the bridge keeps polling.
    try { file.Write('Set s=CreateObject("WScript.Shell")\r\ns.Popup "'+message.replace(/"/g,'""').replace(/\n/g,'" & vbCrLf & "')+'", 5, "SecureCRT MCP", '+(4096+(style || 64))+'\r\nSet f=CreateObject("Scripting.FileSystemObject")\r\nOn Error Resume Next\r\nf.DeleteFile WScript.ScriptFullName, True\r\n'); }
    finally { file.Close(); }
    shell.Run('"'+shell.ExpandEnvironmentStrings("%WINDIR%")+'\\System32\\wscript.exe" //nologo "'+script+'"',0,false);
}
function mcpNotifyStarted(fso,dir,backend,count) {
    mcpNotify(fso,dir,(backend=="xshell"?"Xshell":"SecureCRT")+" MCP \u5df2\u542f\u52a8\uff0c\u5df2\u8fde\u63a5\u4f1a\u8bdd\uff1a"+count+"\u3002\n\u65e0\u9700 Python\uff1b\u5173\u95ed\u63d0\u793a\u540e\u7ee7\u7eed\u8fd0\u884c\u3002",64);
}
function mcpClaimHost(fso,root,backend,manifest) {
    // SecureCRT enumerates all tabs in one process. Other processes have separate locks.
    if(backend!="securecrt" || !/^[0-9]+$/.test(String(manifest.runtime.host_pid || ""))) return null;
    var hosts=fso.BuildPath(root,"hosts");if(!fso.FolderExists(hosts)) fso.CreateFolder(hosts);
    var path=fso.BuildPath(hosts,String(manifest.runtime.host_pid)),owner=fso.BuildPath(path,"owner.json"),leasePath=fso.BuildPath(path,"lease.lock"),lease;
    if(fso.FolderExists(path)) {
        if(Number(fso.GetFolder(path).Attributes)&1024) mcpFail("invalid native host lock directory");
        if(Number(fso.GetFolder(path).SubFolders.Count)>0 || Number(fso.GetFolder(path).Files.Count)>2) mcpFail("unexpected files in native host lock directory");
        var previous=null;try { previous=mcpParse(mcpReadUtf8(owner)); } catch(e) {}
        // An open native TextStream denies a second writer. The scripting
        // engine releases COM handles even when Script > Cancel skips finally.
        // Heartbeat expiry alone is never sufficient evidence to take over.
        if(fso.FileExists(leasePath)) {
            try { lease=fso.OpenTextFile(leasePath,2,false); } catch(held) {}
        }
        if(!lease && previous && mcpNow()-previous.last_poll_ms<30000) {
            mcpNotify(fso,hosts,"SecureCRT MCP \u5df2\u7ecf\u542f\u52a8\uff0c\u65e0\u9700\u91cd\u590d\u8fd0\u884c\u3002\n\u540c\u4e00\u7a97\u53e3\u7684\u6240\u6709\u5df2\u8fde\u63a5 Tab \u7531\u539f\u811a\u672c\u7ba1\u7406\u3002",64);
            return false;
        }
        if(!lease) {
            mcpNotify(fso,hosts,"SecureCRT MCP \u5df2\u6709\u811a\u672c\u542f\u52a8\uff0c\u4f46\u6682\u672a\u54cd\u5e94\u3002\n\u8bf7\u5148\u505c\u6b62\u65e7\u811a\u672c\uff0c\u518d\u91cd\u65b0\u8fd0\u884c\u3002",48);
            return false;
        }
    } else {
        try { fso.CreateFolder(path); }
        catch(error) { mcpNotify(fso,hosts,"SecureCRT MCP \u6b63\u5728\u542f\u52a8\uff0c\u65e0\u9700\u91cd\u590d\u8fd0\u884c\u3002",64);return false; }
        lease=fso.OpenTextFile(leasePath,2,true);
    }
    try { mcpWriteJson(fso,owner,{bridge_instance:manifest.bridge_instance,last_poll_ms:mcpNow()}); }
    catch(error) { lease.Close();throw error; }
    return {owner:owner,lease:lease,leasePath:leasePath};
}
function mcpServeWindows(host,backend,manifest,source) {
    if(mcpSha256(source)!=manifest.adapter_sha256) mcpFail("native bridge source mismatch");
    var fso=new ActiveXObject("Scripting.FileSystemObject"),root=manifest.ipc_dir;
    function mkdir(path) { if(!fso.FolderExists(path)) { var parent=fso.GetParentFolderName(path);if(parent && !fso.FolderExists(parent)) mkdir(parent);fso.CreateFolder(path); } }
    var lock=mcpClaimHost(fso,root,backend,manifest);if(lock===false) return;
    var dir=fso.BuildPath(fso.BuildPath(root,"instances"),manifest.bridge_instance);mkdir(dir);
    var ready=fso.BuildPath(dir,"ready.json"),adapter=new McpWindowsAdapter(host,backend,manifest.bridge_instance,manifest.runtime,manifest.adapter_sha256);
    if(backend=="xshell") adapter.discoverNames=function() {
        var names=[],path=String(host.Session.Path),folder=fso.GetParentFolderName(path),budget=0;
        function walk(path,depth) {
            if(depth>12 || budget++>256 || names.length>=128 || !fso.FolderExists(path)) return;
            var item,newFolder,files=new Enumerator(fso.GetFolder(path).Files);
            for(;!files.atEnd();files.moveNext()) { item=files.item();if(/\.xsh$/i.test(item.Name)) names.push(String(item.Name).replace(/\.xsh$/i,""));if(names.length>=128) break; }
            var folders=new Enumerator(fso.GetFolder(path).SubFolders);
            for(;!folders.atEnd();folders.moveNext()) { newFolder=folders.item();if(!(Number(newFolder.Attributes)&1024)) walk(String(newFolder.Path),depth+1); }
        }
        if(folder) walk(folder,0);return names;
    };
    var heartbeat=0;
    try {
        var initial;
        try { initial=adapter.list(); }
        catch(error) { mcpFail(adapter.stage+": "+mcpError(error)); }
        // Xshell may still be completing its saved-session startup here.
        // Waiting on its screen before a capture can be permission denied;
        // observe this method only when actually pumping synchronous output.
        mcpWriteJson(fso,fso.BuildPath(root,backend+"-status.json"),{state:"running",backend:backend,version:MCP_WINDOWS_VERSION,script_engine:"JScript",connected_sessions:initial.sessions.length,started_ms:mcpNow()});
        mcpNotifyStarted(fso,dir,backend,initial.sessions.length);
        while(true) {
            adapter.maintain();
            if(mcpNow()-heartbeat>=1000) {
                mcpWriteJson(fso,ready,{bridge_instance:adapter.instance,host_pid:manifest.runtime.host_pid || null,bridge_version:MCP_WINDOWS_VERSION,protocol_version:2,script_engine:"JScript",last_poll_ms:mcpNow()});
                mcpWriteJson(fso,fso.BuildPath(dir,"diagnostic.json"),{recent_events:adapter.events,metrics:adapter.metrics});
                if(lock) mcpWriteJson(fso,lock.owner,{bridge_instance:adapter.instance,last_poll_ms:mcpNow()});
                heartbeat=mcpNow();
            }
            adapter.stage="enumerate IPC requests";
            var paths=mcpRequestPaths(fso,dir);
            for(var i=0;i<paths.length;i++) {
                var path=paths[i],base=fso.GetBaseName(path).replace(/\.request$/,"");
                adapter.stage="read IPC request";
                if(!fso.FileExists(path)) continue;
                if(fso.GetFile(path).Size>262144) { fso.DeleteFile(path,true);continue; }
                var request;
                try { request=mcpParse(mcpReadUtf8(path)); }
                catch(error) { fso.DeleteFile(path,true);continue; }
                adapter.stage="claim IPC request";
                if(!fso.FileExists(path)) continue;
                fso.DeleteFile(path,true);
                if(!request || request.id!=base) continue;
                adapter.stage="dispatch "+request.method;
                var response=adapter.request(request,manifest.token);
                adapter.stage="publish IPC response";
                mcpWriteJson(fso,fso.BuildPath(dir,base+".response.json"),response);
            }
            adapter.yieldHost(paths.length?1:15);
        }
    } catch(error) {
        mcpFail(adapter.stage+": "+mcpError(error));
    } finally {
        for(var id in adapter.captures) if(mcpOwn(adapter.captures,id)) adapter.end({capture_id:id,confirmed_complete:false});
        try { if(fso.FileExists(ready)) fso.DeleteFile(ready,true); } catch(e) {}
        try { mcpWriteJson(fso,fso.BuildPath(root,backend+"-status.json"),{state:"stopped",backend:backend,stopped_ms:mcpNow()}); } catch(e) {}
        try { if(lock) { lock.lease.Close();if(fso.FileExists(lock.owner)) fso.DeleteFile(lock.owner,true);if(fso.FileExists(lock.leasePath)) fso.DeleteFile(lock.leasePath,true);fso.DeleteFolder(fso.GetParentFolderName(lock.owner),false); } } catch(e) {}
    }
}
