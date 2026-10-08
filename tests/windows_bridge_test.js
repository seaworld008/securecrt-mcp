// Deterministic adapter contract tests. No terminal or SSH input is sent.
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const source = fs.readFileSync('bridge/windows_bridge.js', 'utf8');
const ctx = vm.createContext({});
vm.runInContext(source, ctx);
let now = 100000;
ctx.mcpNow = () => now;
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS: ' + name); }
function fixture(backend) {
    const state = {selected: 'A', sends: [], failSend: false};
    function screen() {
        return {
            CurrentRow: backend === 'xshell' ? 100 : 1, CurrentColumn: 7,
            Rows: 24, Columns: 100, Synchronous: false, IgnoreEscape: false,
            line: 'user$ ', lines: {}, queue: [], MatchIndex: 0,
            Get(r, c, r2, c2) {
                let rows = [];
                for (let i = r; i <= r2; i++) rows.push((i === this.CurrentRow ? this.line : this.lines[i] || '').slice(c-1, c2));
                return rows.join('\r\n');
            },
            Get2(...args) { return this.Get(...args); },
            Send(text) {
                state.sends.push(text);
                if (state.failSend) throw Error('native send failure');
            },
            ReadString(...args) {
                assert.equal(args[args.length-1], 1);
                assert.equal(typeof args[0], 'string', 'COM receives strings, not JS array dispatch');
                this.stream=(this.stream||'')+(this.queue.length?this.queue.join('\n')+'\n':'');this.queue=[];
                let match=-1,index=0;
                for(let i=0;i<args.length-1;i++) {
                    const position=this.stream.indexOf(args[i]);
                    if(position>=0 && (match<0 || position<match)) { match=position;index=i+1; }
                }
                this.MatchIndex=index;
                const text=match<0?this.stream:this.stream.slice(0,match);
                this.stream=match<0?'':this.stream.slice(match+args[index-1].length);
                return text;
            },
            WaitForStrings() { return 0; }
        };
    }
    const screens = {A: screen(), B: screen()};
    const tabs = Object.keys(screens).map((name,i) => ({
        Caption:name,Index:i+1,Screen:screens[name],Activate(){},
        Session:{Connected:true,Config:{GetOption(option){return ({Hostname:name,Username:'tester',Port:22,'Protocol Name':'SSH2'})[option];}}}
    }));
    const session = {
        Connected:true,RemotePort:22,UserName:'tester',
        get SessionName(){return state.selected;}, get TabText(){return state.selected;},
        get RemoteAddress(){return state.selected;},
        SelectTabName(name){if (!screens[name]) return false;state.selected=name;return true;},
        Sleep(ms){now+=ms;}
    };
    const host = {Version:'9.0.0',Session:session,get Screen(){return screens[state.selected];},
                  GetTabCount(){return tabs.length;},GetTab(i){return tabs[i-1];},Sleep(ms){now+=ms;}};
    const adapter = new ctx.McpWindowsAdapter(host, backend, 'instance', {terminal_version:'8.0.0.26'}, ctx.mcpSha256(source));
    adapter.discoverNames = () => ['A','B'];
    let seq = 0;
    function call(method, params={}, owner='client') {
        return adapter.request({protocol_version:2,token:'secret',client_id:owner,id:String(++seq),
                                deadline_ms:now+30000,method,params}, 'secret');
    }
    return {adapter,call,host,state,screens,tabs};
}
check('SHA-256 matches UTF-8, Unicode, block boundaries and packaged source', () => {
    for (const text of ['', 'abc', '中文😀', 'a'.repeat(55), 'b'.repeat(64), 'c'.repeat(8192), source])
        assert.equal(ctx.mcpSha256(text), crypto.createHash('sha256').update(text).digest('hex'));
});
check('JSON round-trip and rejection of malformed/prototype/duplicate keys', () => {
    for (const text of ['null','true','123.5','["中文",1,false,null]','{"line":"\\r\\n\\t\\u4e2d","n":-2e2}'])
        assert.deepEqual(JSON.parse(ctx.mcpJson(ctx.mcpParse(text))), JSON.parse(text));
    for (const text of ['{"a":1,"a":2}', '{"__proto__":{}}', '{"constructor":{}}', '[1,]', '{"a":1,}', '1 junk', '1e999', '"\\q"', '"\n"', '['.repeat(40)+'0'+']'.repeat(40)])
        assert.throws(() => ctx.mcpParse(text));
});
for (const backend of ['securecrt','xshell']) {
    check(backend + ': observed disconnect permanently invalidates the old generation', () => {
        const f=fixture(backend),sid=f.call('list_sessions').result.sessions[0].id;
        const aid=f.call('attach',{session:sid}).result.attachment_id;
        const connection=backend==='securecrt'?f.tabs[0].Session:f.host.Session;
        connection.Connected=false;now+=250;f.adapter.maintain();
        assert.equal(f.call('read_screen',{session:sid}).ok,false);
        connection.Connected=true;now+=250;
        const fresh=f.call('list_sessions').result.sessions[0].id;
        assert.notEqual(fresh,sid);
        assert.equal(f.call('read_screen',{session:sid}).ok,false);
        assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'stale',text:'echo forbidden',runtime_ms:10000}).sent,false);
        assert.equal(f.call('read_screen',{session:fresh}).ok,true);
        assert.equal(f.state.sends.length,0);
    });
    check(backend + ': authenticated capabilities and stable, connected session handles', () => {
        const f=fixture(backend);
        const list=f.call('list_sessions').result;
        assert.equal(list.sessions.length,2);assert.equal(f.state.selected,'A');
        assert.equal(f.call('list_sessions').result.sessions[0].id,list.sessions[0].id);
        assert.equal(f.call('ping').result.script_engine,'JScript');
        const denied=f.adapter.request({protocol_version:2,token:'wrong'},'secret');
        assert.equal(denied.ok,false);assert.equal(denied.sent,false);
    });
    check(backend + ': ping never reads potentially invoking COM method properties', () => {
        const f=fixture(backend);
        f.call('list_sessions');
        for (const name of ['Send','ReadString','WaitForStrings','Get','Get2'])
            Object.defineProperty(f.screens.A,name,{get(){throw Error('COM method accessed: '+name);}});
        Object.defineProperty(backend==='xshell'?f.host.Session:f.host,'Sleep',
            {get(){throw Error('COM Sleep accessed');}});
        const value=f.call('ping');
        assert.equal(value.ok,true);
        assert.equal(value.result.api_capabilities[backend==='xshell'?'xsh.Screen.Send':'tab.Screen.Send'],null);
        assert.deepEqual(JSON.parse(JSON.stringify(value.result.api_errors)),{});
        assert.equal(f.state.sends.length,0);
    });
    check(backend + ': typed input, wrong prompt and expired requests send zero input', () => {
        const f=fixture(backend),sid=f.call('list_sessions').result.sessions[0].id;
        assert.equal(f.call('attach',{session:sid,expected_prompt:'bad$'}).ok,false);
        const aid=f.call('attach',{session:sid}).result.attachment_id;
        f.screens.A.line='user$ typed';f.screens.A.CurrentColumn=12;
        assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'c',text:'echo ok',runtime_ms:10000}).sent,false);
        assert.equal(f.adapter.request({id:'c',client_id:'client',protocol_version:2,token:'secret',deadline_ms:now,method:'ping'},'secret').ok,false);
        assert.equal(f.state.sends.length,0);
    });
    check(backend + ': cooperative exclusive ownership and observer cannot write', () => {
        const f=fixture(backend),sid=f.call('list_sessions').result.sessions[0].id;
        const aid=f.call('attach',{session:sid,mode:'observe'},'other').result.attachment_id;
        assert.equal(f.call('attach',{session:sid,mode:'exclusive'}).ok,false);
        assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'c',text:'echo no',runtime_ms:10000},'other').ok,false);
        assert.equal(f.state.sends.length,0);
    });
    check(backend + ': Unicode capture, completion and native state restoration', () => {
        const f=fixture(backend),sid=f.call('list_sessions').result.sessions[0].id;
        const aid=f.call('attach',{session:sid}).result.attachment_id;
        assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'c',text:'echo 中文',runtime_ms:10000,completion_marker:'END'}).result.sent,true);
        assert.equal(f.screens.A.Synchronous,true);
        if (backend==='securecrt') f.screens.A.queue=['BEGIN','中文','END 0'];
        else {f.screens.A.lines[100]='user$ echo 中文';f.screens.A.lines[101]='BEGIN';f.screens.A.lines[102]='中文';f.screens.A.lines[103]='END 0';f.screens.A.CurrentRow=104;}
        const data=f.call('poll_bulk',{capture_id:'c'});
        assert.equal(data.ok,true);assert.equal(data.result.overflow,false);assert.match(data.result.text,/中文/);
        assert.equal(f.call('end',{capture_id:'c',confirmed_complete:true}).result.unresolved,false);
        assert.equal(f.screens.A.Synchronous,false);assert.equal(f.screens.A.IgnoreEscape,false);
        assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'next',text:'echo next',runtime_ms:10000,completion_marker:'END2'}).ok,true);
        assert.equal(f.call('end',{capture_id:'next',confirmed_complete:true}).ok,true);
    });
    check(backend + ': native send failure stays unknown and fresh explicit ack is required', () => {
        const f=fixture(backend),sid=f.call('list_sessions').result.sessions[0].id;
        const aid=f.call('attach',{session:sid}).result.attachment_id;
        f.state.failSend=true;
        const value=f.call('prepare_and_begin',{attachment_id:aid,capture_id:'c',text:'echo uncertain',runtime_ms:10000});
        assert.equal(value.ok,false);assert.equal(value.sent,null);assert.ok(f.adapter.unresolved[sid]);
        f.state.failSend=false;
        assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'blocked',text:'echo no',runtime_ms:10000}).ok,false);
        let view=f.call('read_screen',{session:sid}).result;
        f.screens.A.line='changed$ ';
        assert.equal(f.call('acknowledge_idle',{session:sid,screen_token:view.screen_token,expected_prompt:'changed$'}).ok,false);
        f.screens.A.line='user$ ';
        view=f.call('read_screen',{session:sid}).result;
        assert.equal(f.call('acknowledge_idle',{session:sid,screen_token:view.screen_token,expected_prompt:'user$'}).result.idle_acknowledged,true);
        assert.equal(f.state.sends.length,1);
    });
    check(backend + ': legacy fresh-screen begin is single use and does not leak attachments', () => {
        const f=fixture(backend),sid=f.call('list_sessions').result.sessions[0].id;
        const view=f.call('read_screen',{session:sid}).result;
        const params={session:sid,screen_token:view.screen_token,expected_prompt:'user$',capture_id:'legacy',text:'echo legacy',runtime_ms:10000};
        assert.equal(f.call('begin',params).ok,true);
        assert.equal(f.call('end',{capture_id:'legacy',confirmed_complete:true}).ok,true);
        assert.equal(Object.keys(f.adapter.attachments).length,0);
        assert.equal(f.call('begin',params).ok,false);assert.equal(f.state.sends.length,1);
    });
    check(backend + ': watchdog preserves uncertain output and expired handle is not substituted', () => {
        const f=fixture(backend),sid=f.call('list_sessions').result.sessions[0].id;
        const aid=f.call('attach',{session:sid}).result.attachment_id;
        assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'slow',text:'sleep 2',runtime_ms:1000}).ok,true);
        now+=1001;
        assert.equal(f.call('poll',{capture_id:'slow'}).result.expired,true);
        assert.ok(f.adapter.unresolved[sid]);assert.equal(f.screens.A.Synchronous,false);
        if (backend==='securecrt') {f.tabs[0].Session.Connected=false;f.tabs[0].Index=3;}
        else f.host.Session.Connected=false;
        assert.equal(f.call('read_screen',{session:sid}).ok,false);
    });
}
check('Xshell synchronous capture pumps native output with a bounded sentinel wait', () => {
    const f=fixture('xshell'),calls=[];
    f.screens.A.WaitForStrings=(patterns,timeout)=>{calls.push([patterns,timeout]);return 0;};
    const sid=f.call('list_sessions').result.sessions[0].id;
    const aid=f.call('attach',{session:sid}).result.attachment_id;
    f.call('prepare_and_begin',{attachment_id:aid,capture_id:'pump',text:'printf ok',runtime_ms:10000});
    f.adapter.yieldHost(1000);
    assert.equal(calls.length,1);assert.equal(calls[0][1],20);
    assert.equal(calls[0][0][0],'__MCP_HOST_YIELD_instance__');
    assert.equal(f.adapter.ping().api_capabilities['xsh.Screen.WaitForStrings'],true);
});
check('Xshell bulk polling drains thousands of available rows without one IPC per row group', () => {
    const f=fixture('xshell'),s=f.screens.A;
    const sid=f.call('list_sessions').result.sessions[0].id;
    const aid=f.call('attach',{session:sid}).result.attachment_id;
    f.call('prepare_and_begin',{attachment_id:aid,capture_id:'large',text:'awk output',runtime_ms:10000,completion_marker:'END'});
    s.lines[100]='user$ ';s.CurrentRow=2602;s.CurrentColumn=1;s.line='';
    for(let i=0;i<2500;i++) s.lines[101+i]=String(i).padStart(4,'0')+'_中文_0123456789abcdef';
    s.lines[2601]='END 0';
    let text='',polls=0;
    do {
        const value=f.call('poll_bulk',{capture_id:'large',max_reads:128}).result;
        assert.equal(value.overflow,false);assert.ok(Buffer.byteLength(value.text)<=65536);
        text+=value.text;polls++;
        assert.ok(polls<=5,'bounded buffered output required too many round trips');
    } while(!text.includes('END 0'));
    const lines=text.replace(/\r\n/g,'\n').split('\n').filter(Boolean);
    assert.deepEqual(lines.slice(0,-1),Array.from({length:2500},(_,i)=>String(i).padStart(4,'0')+'_中文_0123456789abcdef'));
    assert.equal(lines[lines.length-1],'END 0');
});
check('SecureCRT bulk capture preserves 2500 UTF-8 rows and the actual exit suffix', () => {
    const f=fixture('securecrt'),s=f.screens.A;
    const sid=f.call('list_sessions').result.sessions[0].id;
    const aid=f.call('attach',{session:sid}).result.attachment_id;
    f.call('prepare_and_begin',{attachment_id:aid,capture_id:'large',text:"printf '\\nEND %s\\n'",runtime_ms:10000,completion_marker:'END'});
    const rows=Array.from({length:2500},(_,i)=>String(i).padStart(4,'0')+'_中文_😀_0123456789abcdef');
    s.queue=["user$ printf '\\nEND %s\\n'",...rows,'END 7'];
    let nativeReads=0;const read=s.ReadString;
    s.ReadString=function(...args){nativeReads++;return read.apply(this,args);};
    let text='',polls=0;
    do {
        const value=f.call('poll_bulk',{capture_id:'large',max_reads:128}).result;
        assert.equal(value.overflow,false);assert.ok(Buffer.byteLength(value.text)<=65536);
        assert.ok(!/[\ud800-\udbff]$/.test(value.text));
        text+=value.text;assert.ok(++polls<=10);
    } while(!text.endsWith('END 7\n'));
    assert.deepEqual(text.split('\n').slice(1,-2),rows);
    assert.equal(nativeReads,2,'large capture uses two native reads regardless of row count');
});
check('SecureCRT marker timeout retains partial output without fabricating completion', () => {
    const f=fixture('securecrt'),s=f.screens.A;
    const sid=f.call('list_sessions').result.sessions[0].id;
    const aid=f.call('attach',{session:sid}).result.attachment_id;
    f.call('prepare_and_begin',{attachment_id:aid,capture_id:'partial',text:'finite command',runtime_ms:1000,completion_marker:'END'});
    s.queue=['partial 中文'];
    assert.equal(f.call('poll_bulk',{capture_id:'partial'}).result.text,'partial 中文\n');
    s.queue=['END'];
    assert.equal(f.call('poll_bulk',{capture_id:'partial'}).result.text,'END\n');
    now+=1001;
    const value=f.call('poll_bulk',{capture_id:'partial'}).result;
    assert.equal(value.expired,true);assert.equal(value.text,'');
    assert.equal(f.call('end',{capture_id:'partial',confirmed_complete:false}).result.unresolved,true);
});
check('SecureCRT marker prefix does not complete a capture before the real exit suffix', () => {
    const f=fixture('securecrt'),s=f.screens.A;
    const sid=f.call('list_sessions').result.sessions[0].id;
    const aid=f.call('attach',{session:sid}).result.attachment_id;
    f.call('prepare_and_begin',{attachment_id:aid,capture_id:'suffix',text:'finite command',runtime_ms:10000,completion_marker:'END'});
    const replies=[['body',1],['',0],['7',1]];const patterns=[];
    s.ReadString=(pattern,timeout)=>{assert.equal(timeout,1);patterns.push(pattern);const reply=replies.shift();s.MatchIndex=reply[1];return reply[0];};
    let text=f.call('poll_bulk',{capture_id:'suffix'}).result.text;
    assert.equal(text,'body\nEND ');
    assert.equal(f.call('poll_bulk',{capture_id:'suffix'}).result.text,'');
    text+=f.call('poll_bulk',{capture_id:'suffix'}).result.text;
    assert.equal(text,'body\nEND 7\n');assert.deepEqual(patterns,['\nEND ','\n','\n']);
});
check('SecureCRT completed capture pumps only its owned pre-display prompt transition', () => {
    const f=fixture('securecrt'),s=f.screens.A;
    s.Synchronous=true;
    const sid=f.call('list_sessions').result.sessions[0].id;
    const aid=f.call('attach',{session:sid}).result.attachment_id;
    f.call('prepare_and_begin',{attachment_id:aid,capture_id:'done',text:'printf ok',runtime_ms:10000,completion_marker:'END'});
    f.call('end',{capture_id:'done',confirmed_complete:true});
    s.line='';s.CurrentColumn=1;
    let pumps=0;
    s.ReadString=(pattern,timeout)=>{assert.ok(pattern.startsWith('__MCP_IDLE_PUMP_'));assert.equal(timeout,1);pumps++;s.line='user$ ';s.CurrentColumn=7;now+=1000;return 'user$ ';};
    assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'next',text:'printf next',runtime_ms:10000,completion_marker:'END2'}).ok,true);
    assert.equal(pumps,1);
    f.call('end',{capture_id:'next',confirmed_complete:true});
    s.line='user$ typed';s.CurrentColumn=12;
    assert.equal(f.call('prepare_and_begin',{attachment_id:aid,capture_id:'unsafe',text:'never send',runtime_ms:10000}).sent,false);
    assert.equal(pumps,1);assert.equal(f.state.sends.length,2);
});
check('SecureCRT confirmed completion flushes only its owned prompt before a fresh attachment', () => {
    const f=fixture('securecrt'),s=f.screens.A;s.Synchronous=true;
    const sid=f.call('list_sessions').result.sessions[0].id;
    const aid=f.call('attach',{session:sid}).result.attachment_id;
    f.call('prepare_and_begin',{attachment_id:aid,capture_id:'done',text:'printf ok',runtime_ms:10000,completion_marker:'END'});
    s.line='';s.CurrentColumn=1;let pumps=0;
    s.ReadString=pattern=>{assert.equal(pattern,'user$ ');pumps++;s.line='user$ ';s.CurrentColumn=7;return s.line;};
    assert.equal(f.call('end',{capture_id:'done',confirmed_complete:true}).result.unresolved,false);
    assert.equal(s.Synchronous,true);assert.equal(pumps,1);
    assert.equal(f.call('attach',{session:sid}).ok,true);
});
check('IPC enumeration tolerates a response disappearing during native property reads', () => {
    const disappearing={get Name(){throw Error('File not found');}};
    const files=[disappearing,{Name:'aaaa.request.json',Path:'C:\\ipc\\aaaa.request.json'},
                 {Name:'bbbb.response.json',Path:'C:\\ipc\\bbbb.response.json'}];
    ctx.Enumerator=function(){let i=0;return {atEnd(){return i>=files.length;},item(){return files[i];},moveNext(){i++;}};};
    const paths=ctx.mcpRequestPaths({GetFolder(){return {Files:files};}},'C:\\ipc');
    assert.deepEqual(Array.from(paths),['C:\\ipc\\aaaa.request.json']);
});
check('SecureCRT process lock rejects a second start without changing the first instance', () => {
    const folders=new Set(['C:\\ipc']), files=new Map(), notices=[], held=new Set();
    const fso={
        BuildPath(a,b){return a+'\\'+b;},FolderExists(p){return folders.has(p);},FileExists(p){return files.has(p);},
        CreateFolder(p){if(folders.has(p)) throw Error('exists');folders.add(p);},
        OpenTextFile(p,mode,create){if(held.has(p)) throw Error('permission denied');if(!create && !files.has(p)) throw Error('missing');files.set(p,'');held.add(p);return {Close(){held.delete(p);}};},
        GetFolder(){return {Attributes:0,SubFolders:{Count:0},Files:{Count:1}};},
        CreateTextFile(p){return {Write(v){files.set(p,v);},Close(){}};},
        DeleteFile(p){files.delete(p);},MoveFile(a,b){files.set(b,files.get(a));files.delete(a);},DeleteFolder(p){folders.delete(p);}
    };
    const read=ctx.mcpReadUtf8, notify=ctx.mcpNotify;
    ctx.mcpReadUtf8=p=>files.get(p);ctx.mcpNotify=(f,d,m)=>notices.push(m);
    try {
        const owner=ctx.mcpClaimHost(fso,'C:\\ipc','securecrt',{runtime:{host_pid:123},bridge_instance:'first'});
        assert.equal(typeof owner.owner,'string');
        assert.equal(ctx.mcpClaimHost(fso,'C:\\ipc','securecrt',{runtime:{host_pid:123},bridge_instance:'second'}),false);
        assert.equal(JSON.parse(files.get(owner.owner)).bridge_instance,'first');assert.equal(notices.length,1);
        assert.notEqual(ctx.mcpClaimHost(fso,'C:\\ipc','securecrt',{runtime:{host_pid:456},bridge_instance:'other-process'}),false);
        assert.equal(ctx.mcpClaimHost(fso,'C:\\ipc','securecrt',{runtime:{host_pid:'../unsafe'},bridge_instance:'invalid'}),null);
        now+=30001;
        assert.equal(ctx.mcpClaimHost(fso,'C:\\ipc','securecrt',{runtime:{host_pid:123},bridge_instance:'recovered'}),false);
        assert.equal(JSON.parse(files.get(owner.owner)).bridge_instance,'first');
        owner.lease.Close();
        const restarted=ctx.mcpClaimHost(fso,'C:\\ipc','securecrt',{runtime:{host_pid:123},bridge_instance:'restarted'});
        assert.equal(JSON.parse(files.get(restarted.owner)).bridge_instance,'restarted');
        assert.equal(ctx.mcpClaimHost(fso,'C:\\ipc','securecrt',{runtime:{host_pid:123},bridge_instance:'duplicate'}),false);
    } finally {ctx.mcpReadUtf8=read;ctx.mcpNotify=notify;}
});
console.log('PASS: '+passed+' native contract groups; mocks only, desktop acceptance remains required');
