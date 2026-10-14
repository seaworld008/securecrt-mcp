// Deterministic adapter contract tests. No terminal or SSH input is sent.
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const source = fs.readFileSync("bridge/windows_bridge.js", "utf8");
const ctx = vm.createContext({});
vm.runInContext(source, ctx);
let now = 100000;
ctx.mcpNow = () => now;
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("PASS: " + name);
}
check("IPC response bursts expire and clock rollback restores idle pumping",()=>{
  assert.equal(ctx.mcpIpcYieldMs(0,100000),15);
  assert.equal(ctx.mcpIpcYieldMs(100000,100000),1);
  assert.equal(ctx.mcpIpcYieldMs(100000,100024),1);
  assert.equal(ctx.mcpIpcYieldMs(100000,100025),15);
  assert.equal(ctx.mcpIpcYieldMs(100000,99999),15);
  assert.equal(ctx.mcpIpcYieldMs(100000,110000),15);
});
function fixture(backend) {
  const state = { selected: "A", sends: [], failSend: false };
  function screen() {
    return {
      CurrentRow: backend === "xshell" ? 100 : 1,
      CurrentColumn: 7,
      Rows: 24,
      Columns: 100,
      Synchronous: false,
      IgnoreEscape: false,
      line: "user$ ",
      lines: {},
      queue: [],
      MatchIndex: 0,
      Get(r, c, r2, c2) {
        let rows = [];
        for (let i = r; i <= r2; i++)
          rows.push(
            (i === this.CurrentRow ? this.line : this.lines[i] || "").slice(
              i === r || backend !== "xshell" ? c - 1 : 0,
              c2,
            ),
          );
        return rows.join("\r\n") + (backend === "xshell" && r2 > r ? "\r\n" : "");
      },
      Get2(...args) {
        return this.Get(...args);
      },
      Send(text) {
        state.sends.push(text);
        if (state.failSend) throw Error("native send failure");
      },
      ReadString(...args) {
        assert.equal(args[args.length - 1], 1);
        assert.equal(
          typeof args[0],
          "string",
          "COM receives strings, not JS array dispatch",
        );
        this.stream =
          (this.stream || "") +
          (this.queue.length ? this.queue.join("\n") + "\n" : "");
        this.queue = [];
        let match = -1,
          index = 0;
        for (let i = 0; i < args.length - 1; i++) {
          const position = this.stream.indexOf(args[i]);
          if (position >= 0 && (match < 0 || position < match)) {
            match = position;
            index = i + 1;
          }
        }
        this.MatchIndex = index;
        // Real SecureCRT discards unmatched data on timeout and returns "".
        // A fake that returns the unmatched stream masks capture loss.
        const text = match < 0 ? "" : this.stream.slice(0, match);
        this.stream =
          match < 0 ? "" : this.stream.slice(match + args[index - 1].length);
        return text;
      },
      WaitForStrings() {
        return 0;
      },
    };
  }
  const screens = { A: screen(), B: screen() };
  const tabs = Object.keys(screens).map((name, i) => ({
    Caption: name,
    Index: i + 1,
    Screen: screens[name],
    Activate() {},
    Session: {
      Connected: true,
      Config: {
        GetOption(option) {
          return {
            Hostname: name,
            Username: "tester",
            Port: 22,
            "Protocol Name": "SSH2",
          }[option];
        },
      },
    },
  }));
  const session = {
    Connected: true,
    RemotePort: 22,
    UserName: "tester",
    get SessionName() {
      return state.selected;
    },
    get TabText() {
      return state.selected;
    },
    get RemoteAddress() {
      return state.selected;
    },
    SelectTabName(name) {
      if (!screens[name]) return false;
      state.selected = name;
      return true;
    },
    Sleep(ms) {
      now += ms;
    },
  };
  const host = {
    Version: "9.0.0",
    Session: session,
    get Screen() {
      return screens[state.selected];
    },
    GetTabCount() {
      return tabs.length;
    },
    GetTab(i) {
      return tabs[i - 1];
    },
    Sleep(ms) {
      now += ms;
    },
  };
  const adapter = new ctx.McpWindowsAdapter(
    host,
    backend,
    "instance",
    { terminal_version: "8.0.0.26" },
    ctx.mcpSha256(source),
  );
  adapter.discoverNames = () => ["A", "B"];
  let seq = 0;
  function call(method, params = {}, owner = "client") {
    return adapter.request(
      {
        protocol_version: 2,
        token: "secret",
        client_id: owner,
        id: String(++seq),
        deadline_ms: now + 30000,
        method,
        params,
      },
      "secret",
    );
  }
  return { adapter, call, host, state, screens, tabs };
}
check("normal stop requires authenticated idle and matching generation without terminal input", () => {
  for (const backend of ["securecrt", "xshell"]) {
    const f = fixture(backend), p = { confirmed_idle: true, bridge_instance: "instance", adapter_sha256: ctx.mcpSha256(source) };
    assert(!f.call("stop_host", { ...p, confirmed_idle: false }).ok);
    assert(!f.call("stop_host", { ...p, bridge_instance: "old" }).ok);
    assert(!f.call("stop_host", { ...p, adapter_sha256: "old-source" }).ok);
    f.adapter.captures.owned = {};
    assert(!f.call("stop_host", p).ok);
    delete f.adapter.captures.owned;
    f.adapter.unresolved.owned = {};
    assert(!f.call("stop_host", p).ok);
    delete f.adapter.unresolved.owned;
    f.adapter.hostRecord = () => { throw Error("ownership_conflict"); };
    assert(!f.call("stop_host", p).ok);
    assert(!f.adapter.stopRequested);
    f.adapter.hostRecord = () => {};
    const rejected = f.adapter.request({ protocol_version: 2, token: "wrong", id: "stop", client_id: "client", deadline_ms: now + 1000, method: "stop_host", params: p }, "secret");
    assert(!rejected.ok && !f.adapter.stopRequested);
    const stopped = f.call("stop_host", p);
    assert(stopped.ok && stopped.result.stopped && stopped.sent === false);
    assert.equal(f.adapter.stopRequested, true);
    assert.deepEqual(f.state.sends, []);
  }
});
check(
  "SHA-256 matches UTF-8, Unicode, block boundaries and packaged source",
  () => {
    for (const text of [
      "",
      "abc",
      "中文😀",
      "a".repeat(55),
      "b".repeat(64),
      "c".repeat(8192),
      source,
    ])
      assert.equal(
        ctx.mcpSha256(text),
        crypto.createHash("sha256").update(text).digest("hex"),
      );
  },
);
check(
  "JSON round-trip and rejection of malformed/prototype/duplicate keys",
  () => {
    for (const text of [
      "null",
      "true",
      "123.5",
      '["中文",1,false,null]',
      '{"line":"\\r\\n\\t\\u4e2d","n":-2e2}',
    ])
      assert.deepEqual(
        JSON.parse(ctx.mcpJson(ctx.mcpParse(text))),
        JSON.parse(text),
      );
    for (const text of [
      '{"a":1,"a":2}',
      '{"__proto__":{}}',
      '{"constructor":{}}',
      "[1,]",
      '{"a":1,}',
      "1 junk",
      "1e999",
      '"\\q"',
      '"\n"',
      "[".repeat(40) + "0" + "]".repeat(40),
    ])
      assert.throws(() => ctx.mcpParse(text));
  },
);
for (const backend of ["securecrt", "xshell"]) {
  check(
    backend +
      ": observed disconnect permanently invalidates the old generation",
    () => {
      const f = fixture(backend),
        sid = f.call("list_sessions").result.sessions[0].id;
      const aid = f.call("attach", { session: sid }).result.attachment_id;
      const connection =
        backend === "securecrt" ? f.tabs[0].Session : f.host.Session;
      connection.Connected = false;
      now += 250;
      f.adapter.maintain();
      assert.equal(f.call("read_screen", { session: sid }).ok, false);
      connection.Connected = true;
      now += 250;
      const fresh = f.call("list_sessions").result.sessions[0].id;
      assert.notEqual(fresh, sid);
      assert.equal(f.call("read_screen", { session: sid }).ok, false);
      assert.equal(
        f.call("prepare_and_begin", {
          attachment_id: aid,
          capture_id: "stale",
          text: "echo forbidden",
          runtime_ms: 10000,
        }).sent,
        false,
      );
      assert.equal(f.call("read_screen", { session: fresh }).ok, true);
      assert.equal(f.state.sends.length, 0);
    },
  );
  check(
    backend +
      ": authenticated capabilities and stable, connected session handles",
    () => {
      const f = fixture(backend);
      const list = f.call("list_sessions").result;
      assert.equal(list.sessions.length, 2);
      assert.equal(f.state.selected, "A");
      assert.equal(
        f.call("list_sessions").result.sessions[0].id,
        list.sessions[0].id,
      );
      assert.equal(f.call("ping").result.script_engine, "JScript");
      const denied = f.adapter.request(
        { protocol_version: 2, token: "wrong" },
        "secret",
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.sent, false);
    },
  );
  check(
    backend + ": ping never reads potentially invoking COM method properties",
    () => {
      const f = fixture(backend);
      f.call("list_sessions");
      for (const name of [
        "Send",
        "ReadString",
        "WaitForStrings",
        "Get",
        "Get2",
      ])
        Object.defineProperty(f.screens.A, name, {
          get() {
            throw Error("COM method accessed: " + name);
          },
        });
      Object.defineProperty(
        backend === "xshell" ? f.host.Session : f.host,
        "Sleep",
        {
          get() {
            throw Error("COM Sleep accessed");
          },
        },
      );
      const value = f.call("ping");
      assert.equal(value.ok, true);
      assert.equal(
        value.result.api_capabilities[
          backend === "xshell" ? "xsh.Screen.Send" : "tab.Screen.Send"
        ],
        null,
      );
      assert.deepEqual(JSON.parse(JSON.stringify(value.result.api_errors)), {});
      assert.equal(f.state.sends.length, 0);
    },
  );
  check(
    backend +
      ": typed input, wrong prompt and expired requests send zero input",
    () => {
      const f = fixture(backend),
        sid = f.call("list_sessions").result.sessions[0].id;
      assert.equal(
        f.call("attach", { session: sid, expected_prompt: "bad$" }).ok,
        false,
      );
      const aid = f.call("attach", { session: sid }).result.attachment_id;
      f.screens.A.line = "user$ typed";
      f.screens.A.CurrentColumn = 12;
      assert.equal(
        f.call("prepare_and_begin", {
          attachment_id: aid,
          capture_id: "c",
          text: "echo ok",
          runtime_ms: 10000,
        }).sent,
        false,
      );
      assert.equal(
        f.adapter.request(
          {
            id: "c",
            client_id: "client",
            protocol_version: 2,
            token: "secret",
            deadline_ms: now,
            method: "ping",
          },
          "secret",
        ).ok,
        false,
      );
      assert.equal(f.state.sends.length, 0);
    },
  );
  check(
    backend + ": cooperative exclusive ownership and observer cannot write",
    () => {
      const f = fixture(backend),
        sid = f.call("list_sessions").result.sessions[0].id;
      const aid = f.call("attach", { session: sid, mode: "observe" }, "other")
        .result.attachment_id;
      assert.equal(
        f.call("attach", { session: sid, mode: "exclusive" }).ok,
        false,
      );
      assert.equal(
        f.call(
          "prepare_and_begin",
          {
            attachment_id: aid,
            capture_id: "c",
            text: "echo no",
            runtime_ms: 10000,
          },
          "other",
        ).ok,
        false,
      );
      assert.equal(f.state.sends.length, 0);
    },
  );
  check(
    backend + ": Unicode capture, completion and native state restoration",
    () => {
      const f = fixture(backend),
        sid = f.call("list_sessions").result.sessions[0].id;
      const aid = f.call("attach", { session: sid }).result.attachment_id;
      assert.equal(
        f.call("prepare_and_begin", {
          attachment_id: aid,
          capture_id: "c",
          text: "echo 中文",
          runtime_ms: 10000,
          completion_marker: "END",
        }).result.sent,
        true,
      );
      assert.equal(f.screens.A.Synchronous, true);
      if (backend === "securecrt")
        f.screens.A.queue = ["BEGIN", "中文", "END 0"];
      else {
        f.screens.A.lines[100] = "user$ echo 中文";
        f.screens.A.lines[101] = "BEGIN";
        f.screens.A.lines[102] = "中文";
        f.screens.A.lines[103] = "END 0";
        f.screens.A.CurrentRow = 104;
      }
      const data = f.call("poll_bulk", { capture_id: "c" });
      assert.equal(data.ok, true);
      assert.equal(data.result.overflow, false);
      assert.match(data.result.text, /中文/);
      assert.equal(
        f.call("end", { capture_id: "c", confirmed_complete: true }).result
          .unresolved,
        false,
      );
      assert.equal(f.screens.A.Synchronous, false);
      assert.equal(f.screens.A.IgnoreEscape, false);
      assert.equal(
        f.call("prepare_and_begin", {
          attachment_id: aid,
          capture_id: "next",
          text: "echo next",
          runtime_ms: 10000,
          completion_marker: "END2",
        }).ok,
        true,
      );
      assert.equal(
        f.call("end", { capture_id: "next", confirmed_complete: true }).ok,
        true,
      );
    },
  );
  check(
    backend +
      ": native send failure stays unknown and fresh explicit ack is required",
    () => {
      const f = fixture(backend),
        sid = f.call("list_sessions").result.sessions[0].id;
      const aid = f.call("attach", { session: sid }).result.attachment_id;
      f.state.failSend = true;
      const value = f.call("prepare_and_begin", {
        attachment_id: aid,
        capture_id: "c",
        text: "echo uncertain",
        runtime_ms: 10000,
      });
      assert.equal(value.ok, false);
      assert.equal(value.sent, null);
      assert.ok(f.adapter.unresolved[sid]);
      f.state.failSend = false;
      assert.equal(
        f.call("prepare_and_begin", {
          attachment_id: aid,
          capture_id: "blocked",
          text: "echo no",
          runtime_ms: 10000,
        }).ok,
        false,
      );
      let view = f.call("read_screen", { session: sid }).result;
      f.screens.A.line = "changed$ ";
      assert.equal(
        f.call("acknowledge_idle", {
          session: sid,
          screen_token: view.screen_token,
          expected_prompt: "changed$",
        }).ok,
        false,
      );
      f.screens.A.line = "user$ ";
      view = f.call("read_screen", { session: sid }).result;
      assert.equal(
        f.call("acknowledge_idle", {
          session: sid,
          screen_token: view.screen_token,
          expected_prompt: "user$",
        }).result.idle_acknowledged,
        true,
      );
      assert.equal(f.state.sends.length, 1);
    },
  );
  check(
    backend +
      ": legacy fresh-screen begin is single use and does not leak attachments",
    () => {
      const f = fixture(backend),
        sid = f.call("list_sessions").result.sessions[0].id;
      const view = f.call("read_screen", { session: sid }).result;
      const params = {
        session: sid,
        screen_token: view.screen_token,
        expected_prompt: "user$",
        capture_id: "legacy",
        text: "echo legacy",
        runtime_ms: 10000,
      };
      assert.equal(f.call("begin", params).ok, true);
      assert.equal(
        f.call("end", { capture_id: "legacy", confirmed_complete: true }).ok,
        true,
      );
      assert.equal(Object.keys(f.adapter.attachments).length, 0);
      assert.equal(f.call("begin", params).ok, false);
      assert.equal(f.state.sends.length, 1);
    },
  );
  check(
    backend +
      ": watchdog preserves uncertain output and expired handle is not substituted",
    () => {
      const f = fixture(backend),
        sid = f.call("list_sessions").result.sessions[0].id;
      const aid = f.call("attach", { session: sid }).result.attachment_id;
      assert.equal(
        f.call("prepare_and_begin", {
          attachment_id: aid,
          capture_id: "slow",
          text: "sleep 2",
          runtime_ms: 1000,
        }).ok,
        true,
      );
      now += 1001;
      assert.equal(f.call("poll", { capture_id: "slow" }).result.expired, true);
      assert.ok(f.adapter.unresolved[sid]);
      assert.equal(f.screens.A.Synchronous, false);
      if (backend === "securecrt") {
        f.tabs[0].Session.Connected = false;
        f.tabs[0].Index = 3;
      } else f.host.Session.Connected = false;
      assert.equal(f.call("read_screen", { session: sid }).ok, false);
    },
  );
}
check(
  "Xshell synchronous capture pumps native output with a bounded sentinel wait",
  () => {
    const f = fixture("xshell"),
      calls = [];
    f.screens.A.WaitForStrings = (patterns, timeout) => {
      assert.equal(Array.isArray(patterns),false,"native numeric dispatch uses a plain object");
      assert.equal(patterns.length,1);
      calls.push([patterns, timeout]);
      return 0;
    };
    const sid = f.call("list_sessions").result.sessions[0].id;
    const aid = f.call("attach", { session: sid }).result.attachment_id;
    f.call("prepare_and_begin", {
      attachment_id: aid,
      capture_id: "pump",
      text: "printf ok",
      runtime_ms: 10000,
    });
    f.adapter.yieldHost(1000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 20);
    assert.equal(calls[0][0][0], "__MCP_HOST_YIELD_instance__");
    assert.equal(
      f.adapter.ping().api_capabilities["xsh.Screen.WaitForStrings"],
      true,
    );
  },
);
check(
  "Xshell bulk polling drains thousands of available rows without one IPC per row group",
  () => {
    const f = fixture("xshell"),
      s = f.screens.A;
    // Older native JScript builds may time out on every multiline pattern.
    // The fallback must still retain all rows within bounded receive waits.
    s.WaitForStrings = (patterns, timeout) => {
      assert.ok(timeout > 0 && timeout <= 50);
      now += timeout;
      return 0;
    };
    const sid = f.call("list_sessions").result.sessions[0].id;
    const aid = f.call("attach", { session: sid }).result.attachment_id;
    f.call("prepare_and_begin", {
      attachment_id: aid,
      capture_id: "large",
      text: "awk output",
      runtime_ms: 10000,
      completion_marker: "END",
    });
    s.lines[100] = "user$ ";
    s.CurrentRow = 2602;
    s.CurrentColumn = 1;
    s.line = "";
    for (let i = 0; i < 2500; i++)
      s.lines[101 + i] = String(i).padStart(4, "0") + "_中文_0123456789abcdef";
    s.lines[2601] = "END 0";
    let text = "",
      polls = 0;
    do {
      const value = f.call("poll_bulk", {
        capture_id: "large",
        max_reads: 128,
      }).result;
      assert.equal(value.overflow, false);
      assert.ok(Buffer.byteLength(value.text) <= 65536);
      text += value.text;
      polls++;
      assert.ok(
        polls <= 5,
        "bounded buffered output required too many round trips",
      );
    } while (!text.includes("END 0"));
    const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
    assert.deepEqual(
      lines.slice(0, -1),
      Array.from(
        { length: 2500 },
        (_, i) => String(i).padStart(4, "0") + "_中文_0123456789abcdef",
      ),
    );
    assert.equal(lines[lines.length - 1], "END 0");
  },
);
check("Xshell clamped scrollback recovers only its exact marker frame without dropping blank lines",()=>{
  const f=fixture("xshell"),s=f.screens.A,nonce="0123456789abcdef0123456789abcdef";
  s.CurrentRow=10290;s.Rows=50;
  const sid=f.call("list_sessions").result.sessions[0].id,aid=f.call("attach",{session:sid}).result.attachment_id;
  assert(f.call("prepare_and_begin",{attachment_id:aid,capture_id:"clamped",text:"printf harmless",runtime_ms:10000,completion_marker:"MCP_END_"+nonce}).ok);
  s.Rows=10290; // Native old builds count scrollback in Rows.
  s.lines[10290]="command echo still arriving";
  const pending=f.call("poll_bulk",{capture_id:"clamped"}).result;
  assert.equal(pending.overflow,false);assert.equal(pending.text,"");
  s.lines[10286]="MCP_BEGIN_"+nonce;s.lines[10287]="中文";s.lines[10288]="";s.lines[10289]="MCP_END_"+nonce+" 0";
  const v=f.call("poll_bulk",{capture_id:"clamped"}).result;
  assert.equal(v.overflow,false);assert.equal(v.capture_may_be_incomplete,false);
  assert.equal(v.text,"MCP_BEGIN_"+nonce+"\n中文\n\nMCP_END_"+nonce+" 0\n");
  assert.equal(f.call("poll_bulk",{capture_id:"clamped"}).result.text,"");
  s.lines[10287]="changed";
  const changed=f.call("poll_bulk",{capture_id:"clamped"}).result;
  assert.equal(changed.overflow,true);assert.equal(changed.capture_may_be_incomplete,true);
  assert.equal(f.state.sends.length,1,"frame changes never replay a command");
});
check("Xshell completed rows retain real blank lines and reject changing layouts", () => {
  const f=fixture("xshell"),s=f.screens.A;
  const sid=f.call("list_sessions").result.sessions[0].id;
  const aid=f.call("attach",{session:sid}).result.attachment_id;
  f.call("prepare_and_begin",{attachment_id:aid,capture_id:"layout",text:"printf harmless",runtime_ms:10000});
  let reads=0;
  s.Get=()=>++reads===1?"中文\n\nsecond":"中文\nsecond";
  assert.equal(f.adapter.completedRows(s,101,1,102,100),"中文\nsecond");
  assert.equal(reads,3);
  s.Get=()=>"中文\n\nsecond";
  assert.equal(f.adapter.completedRows(s,101,1,103,100),"中文\n\nsecond");
  s.Get=()=>String(++reads);
  assert.throws(()=>f.adapter.completedRows(s,101,1,102,100),/unstable_capture/);
  assert.equal(f.state.sends.length,1,"a layout race must never replay the command");
});
check("Xshell wait support requires measured timeout behavior and is cached", () => {
  const old=fixture("xshell");let calls=0;
  old.screens.A.WaitForStrings=()=>{calls++;return 0;};
  old.adapter.probeXshellWait(old.screens.A);
  assert.equal(old.adapter.xshellShortWait,false,"a successful immediate return is not a valid wait");
  old.adapter.probeXshellWait(old.screens.A);assert.equal(calls,1);
  const modern=fixture("xshell");
  modern.screens.A.WaitForStrings=(patterns,ms)=>{now+=ms;return 0;};
  modern.adapter.probeXshellWait(modern.screens.A);
  assert.equal(modern.adapter.xshellShortWait,true);
});
check(
  "SecureCRT bulk capture preserves 2500 UTF-8 rows and the actual exit suffix",
  () => {
    const f = fixture("securecrt"),
      s = f.screens.A;
    const sid = f.call("list_sessions").result.sessions[0].id;
    const aid = f.call("attach", { session: sid }).result.attachment_id;
    f.call("prepare_and_begin", {
      attachment_id: aid,
      capture_id: "large",
      text: "printf '\\nEND %s\\n'",
      runtime_ms: 10000,
      completion_marker: "END",
    });
    const rows = Array.from(
      { length: 2500 },
      (_, i) => String(i).padStart(4, "0") + "_中文_😀_0123456789abcdef",
    );
    s.queue = ["user$ printf '\\nEND %s\\n'", ...rows, "END 7"];
    let nativeReads = 0;
    const read = s.ReadString;
    s.ReadString = function (...args) {
      nativeReads++;
      return read.apply(this, args);
    };
    let text = "",
      polls = 0;
    do {
      const value = f.call("poll_bulk", {
        capture_id: "large",
        max_reads: 128,
      }).result;
      assert.equal(value.overflow, false);
      assert.ok(Buffer.byteLength(value.text) <= 65536);
      assert.ok(!/[\ud800-\udbff]$/.test(value.text));
      text += value.text;
      assert.ok(++polls <= 25);
    } while (!text.endsWith("END 7\n"));
    assert.deepEqual(text.split("\n").slice(1, -2), rows);
    assert.equal(
      nativeReads,
      2502,
      "line drains preserve delayed data instead of waiting for the final marker",
    );
  },
);
check(
  "SecureCRT marker timeout retains partial output without fabricating completion",
  () => {
    const f = fixture("securecrt"),
      s = f.screens.A;
    const sid = f.call("list_sessions").result.sessions[0].id;
    const aid = f.call("attach", { session: sid }).result.attachment_id;
    f.call("prepare_and_begin", {
      attachment_id: aid,
      capture_id: "partial",
      text: "finite command",
      runtime_ms: 1000,
      completion_marker: "END",
    });
    s.queue = ["partial 中文"];
    assert.equal(
      f.call("poll_bulk", { capture_id: "partial" }).result.text,
      "partial 中文\n",
    );
    s.queue = ["END"];
    assert.equal(
      f.call("poll_bulk", { capture_id: "partial" }).result.text,
      "END\n",
    );
    now += 1001;
    const value = f.call("poll_bulk", { capture_id: "partial" }).result;
    assert.equal(value.expired, true);
    assert.equal(value.text, "");
    assert.equal(
      f.call("end", { capture_id: "partial", confirmed_complete: false }).result
        .unresolved,
      true,
    );
  },
);
check(
  "SecureCRT unmatched native reads report loss rather than inventing a suffix",
  () => {
    const f = fixture("securecrt"),
      s = f.screens.A;
    const sid = f.call("list_sessions").result.sessions[0].id;
    const aid = f.call("attach", { session: sid }).result.attachment_id;
    f.call("prepare_and_begin", {
      attachment_id: aid,
      capture_id: "suffix",
      text: "finite command",
      runtime_ms: 10000,
      completion_marker: "END",
    });
    const replies = [
      ["body", 1],
      ["", 0],
      ["7", 1],
    ];
    const patterns = [];
    s.ReadString = (pattern, timeout) => {
      assert.equal(timeout, 1);
      patterns.push(pattern);
      const reply = replies.shift() || ["", 0];
      s.MatchIndex = reply[1];
      return reply[0];
    };
    let text = f.call("poll_bulk", { capture_id: "suffix" }).result.text;
    assert.equal(text, "body\n");
    text += f.call("poll_bulk", { capture_id: "suffix" }).result.text;
    assert.equal(text, "body\n7\n");
    assert.ok(patterns.every(x => x === "\n"));
    assert.equal(f.adapter.captures.suffix.incomplete, true);
  },
);
check(
  "SecureCRT completed capture pumps only its owned pre-display prompt transition",
  () => {
    const f = fixture("securecrt"),
      s = f.screens.A;
    s.Synchronous = true;
    const sid = f.call("list_sessions").result.sessions[0].id;
    const aid = f.call("attach", { session: sid }).result.attachment_id;
    f.call("prepare_and_begin", {
      attachment_id: aid,
      capture_id: "done",
      text: "printf ok",
      runtime_ms: 10000,
      completion_marker: "END",
    });
    f.call("end", { capture_id: "done", confirmed_complete: true });
    s.line = "";
    s.CurrentColumn = 1;
    let pumps = 0;
    s.ReadString = (pattern, timeout) => {
      assert.ok(pattern.startsWith("__MCP_IDLE_PUMP_"));
      assert.equal(timeout, 1);
      pumps++;
      s.line = "user$ ";
      s.CurrentColumn = 7;
      now += 1000;
      return "user$ ";
    };
    assert.equal(
      f.call("prepare_and_begin", {
        attachment_id: aid,
        capture_id: "next",
        text: "printf next",
        runtime_ms: 10000,
        completion_marker: "END2",
      }).ok,
      true,
    );
    assert.equal(pumps, 1);
    f.call("end", { capture_id: "next", confirmed_complete: true });
    s.line = "user$ typed";
    s.CurrentColumn = 12;
    assert.equal(
      f.call("prepare_and_begin", {
        attachment_id: aid,
        capture_id: "unsafe",
        text: "never send",
        runtime_ms: 10000,
      }).sent,
      false,
    );
    assert.equal(pumps, 1);
    assert.equal(f.state.sends.length, 2);
  },
);
check(
  "SecureCRT confirmed completion flushes only its owned prompt before a fresh attachment",
  () => {
    const f = fixture("securecrt"),
      s = f.screens.A;
    s.Synchronous = true;
    const sid = f.call("list_sessions").result.sessions[0].id;
    const aid = f.call("attach", { session: sid }).result.attachment_id;
    f.call("prepare_and_begin", {
      attachment_id: aid,
      capture_id: "done",
      text: "printf ok",
      runtime_ms: 10000,
      completion_marker: "END",
    });
    s.line = "";
    s.CurrentColumn = 1;
    let pumps = 0;
    s.ReadString = (pattern) => {
      assert.equal(pattern, "user$ ");
      pumps++;
      s.line = "user$ ";
      s.CurrentColumn = 7;
      return s.line;
    };
    assert.equal(
      f.call("end", { capture_id: "done", confirmed_complete: true }).result
        .unresolved,
      false,
    );
    assert.equal(s.Synchronous, true);
    assert.equal(pumps, 1);
    assert.equal(f.call("attach", { session: sid }).ok, true);
  },
);
check("SecureCRT: 100 distinct quick captures retain exact completion and never resend", () => {
  const f = fixture("securecrt"), s = f.screens.A;
  const sid = f.call("list_sessions").result.sessions[0].id;
  const aid = f.call("attach", {session: sid}).result.attachment_id;
  for(let i=0;i<100;i++) {
    const id="quick-"+i, marker="END_"+i;
    assert.equal(f.call("prepare_and_begin", {attachment_id:aid,capture_id:id,text:"printf harmless",runtime_ms:10000,completion_marker:marker}).sent,true);
    s.queue=["BEGIN_"+i,"中文_"+i,marker+" "+(i%2)];
    let text="";
    for(let n=0;n<4 && !text.endsWith(marker+" "+(i%2)+"\n");n++) text+=f.call("poll_bulk",{capture_id:id}).result.text;
    assert.equal(text,"BEGIN_"+i+"\n中文_"+i+"\n"+marker+" "+(i%2)+"\n");
    assert.equal(f.adapter.captures[id].completionObserved,true);
    assert.equal(f.call("end",{capture_id:id,confirmed_complete:true}).result.unresolved,false);
  }
  assert.equal(f.state.sends.length,100);
});
check("SecureCRT: delayed end keeps BEGIN/body across empty native timeout", () => {
  const f=fixture("securecrt"),s=f.screens.A;
  const sid=f.call("list_sessions").result.sessions[0].id;
  const aid=f.call("attach",{session:sid}).result.attachment_id;
  f.call("prepare_and_begin",{attachment_id:aid,capture_id:"delayed",text:"finite command",runtime_ms:10000,completion_marker:"END"});
  s.queue=["BEGIN","EARLY"];
  const first=f.call("poll_bulk",{capture_id:"delayed"}).result;
  assert.equal(first.text,"BEGIN\nEARLY\n");
  assert.equal(first.capture_may_be_incomplete,true);
  s.queue=["LATE","END 0"];
  assert.equal(f.call("poll_bulk",{capture_id:"delayed"}).result.text,"LATE\nEND 0\n");
  assert.equal(f.adapter.captures.delayed.completionObserved,true);
  assert.equal(f.state.sends.length,1);
});
check("SecureCRT: timeout discards a partial Unicode line and reports possible loss", () => {
  const f=fixture("securecrt"),s=f.screens.A;
  const sid=f.call("list_sessions").result.sessions[0].id;
  const aid=f.call("attach",{session:sid}).result.attachment_id;
  f.call("prepare_and_begin",{attachment_id:aid,capture_id:"partial-unicode",text:"finite command",runtime_ms:10000,completion_marker:"END"});
  s.stream="中文无换行";
  const r=f.call("poll_bulk",{capture_id:"partial-unicode"}).result;
  assert.equal(r.text,"");assert.equal(r.capture_may_be_incomplete,true);
  assert.equal(f.adapter.captures["partial-unicode"].completionObserved,undefined);
});
check("SecureCRT: inspected prompt restore sends one Enter and blocks unsafe recovery", () => {
  const f=fixture("securecrt"),s=f.screens.A;
  const sid=f.call("list_sessions").result.sessions[0].id;
  const aid=f.call("attach",{session:sid}).result.attachment_id;
  f.call("prepare_and_begin",{attachment_id:aid,capture_id:"done-for-restore",text:"finite command",runtime_ms:10000,completion_marker:"END"});
  s.queue=["BEGIN","END 0"];
  f.call("poll_bulk",{capture_id:"done-for-restore"});
  f.call("end",{capture_id:"done-for-restore",confirmed_complete:true});
  for(const line of ["Password:","user$ typed","--More--",":", ""]) {
    s.line=line;s.CurrentColumn=line.length+1;
    if(!line) s.CurrentColumn=1;
    const view=f.call("read_screen",{session:sid}).result;
    const p={attachment_id:aid,screen_token:view.screen_token,expected_prompt:"user$",confirmed_idle:true};
    if(line) assert.equal(f.call("restore_prompt",p).sent,false);
    else {
      assert.equal(view.restore_prompt_available,true);
      assert.equal(f.call("restore_prompt",{...p,confirmed_idle:false}).sent,false);
      assert.equal(f.call("restore_prompt",p,"other-owner").sent,false);
      const send=s.Send;s.Send=function(text){send.call(this,text);this.line="user$ ";this.CurrentColumn=7;};
      const restored=f.call("restore_prompt",p);
      assert.equal(restored.ok,true);assert.equal(restored.result.recovery_sent,true);
      assert.deepEqual(f.state.sends.slice(1),["\r"]);
      assert.equal(f.call("restore_prompt",p).sent,false);
    }
  }
});
check("SecureCRT: owned attachment renews expired enumeration lease without enumeration", () => {
  const f=fixture("securecrt");
  const sid=f.call("list_sessions").result.sessions[0].id;
  const aid=f.call("attach",{session:sid}).result.attachment_id;
  now+=120001;
  const r=f.call("heartbeat",{attachment_id:aid});assert.equal(r.ok,true);
  assert.ok(r.result.session_lease_expires_ms>now);
  assert.equal(f.call("read_screen",{session:sid}).ok,true);
  now+=600001;assert.equal(f.call("heartbeat",{attachment_id:aid}).sent,false);
  assert.equal(f.state.sends.length,0);
});
check("SecureCRT: input snapshot samples cursor after Get2 rendering", () => {
  const f=fixture("securecrt"),s=f.screens.A;
  const sid=f.call("list_sessions").result.sessions[0].id;
  const get=s.Get2;s.Get2=function(...args){this.CurrentColumn=8;return get.apply(this,args);};
  assert.equal(f.adapter.input(f.adapter.sessions[sid]).cursor_column,8);
});
check("SecureCRT: verified millisecond receive pump has no fixed one-second prompt wait", () => {
  const f=fixture("securecrt"),s=f.screens.A;
  let waits=0;
  s.WaitForString=function(pattern,timeout,ignoreCase,milliseconds){
    assert.equal(ignoreCase,false);assert.equal(milliseconds,true);
    assert.ok(timeout===1 || timeout===20);now+=timeout;waits++;return false;
  };
  const start=now;
  f.adapter.pumpPrompt(s,"user$ ");f.adapter.pumpPrompt(s,"user$ ");
  assert.equal(now-start,21);assert.equal(waits,2);
  assert.equal(f.state.sends.length,0);
  const legacy=fixture("securecrt");
  legacy.screens.A.WaitForString=()=>{now+=1000;return false;};
  legacy.adapter.pumpPrompt(legacy.screens.A,"user$ ");
  assert.equal(legacy.adapter.millisecondWait,false);
});
check(
  "IPC enumeration tolerates a response disappearing during native property reads",
  () => {
    const disappearing = {
      get Name() {
        throw Error("File not found");
      },
    };
    const files = [
      disappearing,
      { Name: "aaaa.request.json", Path: "C:\\ipc\\aaaa.request.json" },
      { Name: "bbbb.response.json", Path: "C:\\ipc\\bbbb.response.json" },
    ];
    ctx.Enumerator = function () {
      let i = 0;
      return {
        atEnd() {
          return i >= files.length;
        },
        item() {
          return files[i];
        },
        moveNext() {
          i++;
        },
      };
    };
    const paths = ctx.mcpRequestPaths(
      {
        GetFolder() {
          return { Files: files };
        },
      },
      "C:\\ipc",
    );
    assert.deepEqual(Array.from(paths), ["C:\\ipc\\aaaa.request.json"]);
  },
);
check(
  "SecureCRT process lock rejects a second start without changing the first instance",
  () => {
    const folders = new Set(["C:\\ipc"]),
      files = new Map(),
      notices = [],
      held = new Set();
    const fso = {
      BuildPath(a, b) {
        return a + "\\" + b;
      },
      FolderExists(p) {
        return folders.has(p);
      },
      FileExists(p) {
        return files.has(p);
      },
      CreateFolder(p) {
        if (folders.has(p)) throw Error("exists");
        folders.add(p);
      },
      OpenTextFile(p, mode, create) {
        if (held.has(p)) throw Error("permission denied");
        if (!create && !files.has(p)) throw Error("missing");
        files.set(p, "");
        held.add(p);
        return {
          Close() {
            held.delete(p);
          },
        };
      },
      GetFolder() {
        return { Attributes: 0, SubFolders: { Count: 0 }, Files: { Count: 1 } };
      },
      CreateTextFile(p) {
        return {
          Write(v) {
            files.set(p, v);
          },
          Close() {},
        };
      },
      DeleteFile(p) {
        files.delete(p);
      },
      MoveFile(a, b) {
        files.set(b, files.get(a));
        files.delete(a);
      },
      DeleteFolder(p) {
        folders.delete(p);
      },
    };
    const read = ctx.mcpReadUtf8,
      notify = ctx.mcpNotify;
    ctx.mcpReadUtf8 = (p) => files.get(p);
    ctx.mcpNotify = (f, d, m) => notices.push(m);
    try {
      const owner = ctx.mcpClaimHost(fso, "C:\\ipc", "securecrt", {
        runtime: { host_pid: 123 },
        bridge_instance: "first",
      });
      assert.equal(typeof owner.owner, "string");
      assert.equal(held.size,0,"native Cancel must not retain a lifetime COM stream");
      assert.equal(
        ctx.mcpClaimHost(fso, "C:\\ipc", "securecrt", {
          runtime: { host_pid: 123 },
          bridge_instance: "second",
        }),
        false,
      );
      assert.equal(JSON.parse(files.get(owner.owner)).bridge_instance, "first");
      assert.equal(notices.length, 1);
      assert.notEqual(
        ctx.mcpClaimHost(fso, "C:\\ipc", "securecrt", {
          runtime: { host_pid: 456 },
          bridge_instance: "other-process",
        }),
        false,
      );
      assert.equal(
        ctx.mcpClaimHost(fso, "C:\\ipc", "securecrt", {
          runtime: { host_pid: "../unsafe" },
          bridge_instance: "invalid",
        }),
        null,
      );
      now += 30001;
      const paused=JSON.parse(files.get(owner.owner));paused.capture_count=1;
      files.set(owner.owner,JSON.stringify(paused));
      assert.equal(
        ctx.mcpClaimHost(fso, "C:\\ipc", "securecrt", {
          runtime: { host_pid: 123 },
          bridge_instance: "recovered",
        }),
        false,
      );
      assert.equal(JSON.parse(files.get(owner.owner)).bridge_instance, "first");
      paused.capture_count=0;paused.unresolved_count=1;files.set(owner.owner,JSON.stringify(paused));
      assert.equal(ctx.mcpClaimHost(fso,"C:\\ipc","securecrt",{runtime:{host_pid:123},bridge_instance:"uncertain"}),false);
      paused.unresolved_count=0;files.set(owner.owner,JSON.stringify(paused));
      const restarted = ctx.mcpClaimHost(fso, "C:\\ipc", "securecrt", {
        runtime: { host_pid: 123 },
        bridge_instance: "restarted",
      });
      assert.equal(
        JSON.parse(files.get(restarted.owner)).bridge_instance,
        "restarted",
      );
      assert.throws(()=>ctx.mcpHostRecord(fso,owner,{instance:"first",captures:{},unresolved:{}},true),/ownership_conflict/);
      assert.equal(held.size,0,"stale owner's rejection releases the critical section");
      const move=fso.MoveFile;
      fso.MoveFile=()=>{throw Error("owner replacement denied");};
      assert.throws(()=>ctx.mcpHostRecord(fso,restarted,{instance:"restarted",captures:{owned:{}},unresolved:{}},true),/state was not persisted/);
      assert.equal(held.size,0,"failed owner persistence releases its short lock");
      assert.equal(ctx.mcpClaimHost(fso,"C:\\ipc","securecrt",{runtime:{host_pid:123},bridge_instance:"unsafe-reclaim"}),false,"missing owner after failed replacement never authorizes takeover");
      fso.MoveFile=move;files.set(restarted.owner,JSON.stringify({bridge_instance:"restarted",last_poll_ms:now,fenced:true,active:true,capture_count:0,unresolved_count:0}));
      assert.equal(
        ctx.mcpClaimHost(fso, "C:\\ipc", "securecrt", {
          runtime: { host_pid: 123 },
          bridge_instance: "duplicate",
        }),
        false,
      );
    } finally {
      ctx.mcpReadUtf8 = read;
      ctx.mcpNotify = notify;
    }
  },
);
check("SecureCRT: raw logging is opt-in and existing user logs remain untouched",()=>{
  for(const opted of [false,true]) {
    const f=fixture("securecrt"),native=f.tabs[0].Session,s=f.screens.A;
    native.Logging=true;native.LogFileName="user-owned.log";
    native.Log=()=>{throw Error("must not touch user logging");};
    f.adapter.captureFiles={create:()=>{throw Error("must not create capture");}};
    const sid=f.call("list_sessions").result.sessions[0].id;
    const aid=f.call("attach",{session:sid,mode:"shared"}).result.attachment_id;
    assert(f.call("prepare_and_begin",{attachment_id:aid,capture_id:"owned-log",text:"true",runtime_ms:5000,completion_marker:"END",prefer_native_log:opted}).ok);
    assert.equal(s.Synchronous,true);s.queue=["END 0"];
    f.call("poll",{capture_id:"owned-log"});
    assert(f.call("end",{capture_id:"owned-log",confirmed_complete:true}).ok);
    assert.equal(native.Logging,true);assert.equal(native.LogFileName,"user-owned.log");
  }
});
function logFixture(failStart=false) {
  const f=fixture("securecrt"),native=f.tabs[0].Session,files=new Set(),calls=[];
  native.Logging=false;native.LogFileName="original.log";
  native.Log=(enabled)=>{calls.push(enabled);native.Logging=enabled;if(enabled&&failStart)throw Error("SDK rejected logging");};
  f.adapter.captureFiles={create:(id)=>{const p="private/"+id+".capture.raw";files.add(p);return p;},size:()=>128,
    remove:(p)=>files.delete(p),hasMarker:()=>true};
  const sid=f.call("list_sessions").result.sessions[0].id;
  const aid=f.call("attach",{session:sid,mode:"shared"}).result.attachment_id;
  return {...f,native,files,calls,sid,aid};
}
check("SecureCRT: raw capture closes/flushed the owned logger and restores runtime state",()=>{
  const f=logFixture(),s=f.screens.A;
  const begin=f.call("prepare_and_begin",{attachment_id:f.aid,capture_id:"owned-log",text:"true",runtime_ms:5000,completion_marker:"END",prefer_native_log:true});
  assert(begin.ok);assert.equal(s.Synchronous,false);assert.equal(f.native.Logging,true);
  s.CurrentRow=3;s.line="user$ ";s.lines[2]="END 0";
  const poll=f.call("poll",{capture_id:"owned-log"}).result;
  assert.equal(poll.capture_transport,"native_raw_log");assert.equal(poll.native_log_stopped,true);
  assert.equal(f.native.LogFileName,"original.log");assert.equal(f.native.Logging,false);
  const end=f.call("end",{capture_id:"owned-log",confirmed_complete:true,capture_log_reader:true}).result;
  assert.equal(end.unresolved,false);assert.equal(f.files.size,1,"Rust keeps the file through final flush");
  assert.equal(f.adapter.attachments[f.aid].lastComplete,"owned-log");
  assert.equal(s.Synchronous,false);assert.deepEqual(f.calls,[true,false]);
});
check("SecureCRT: a pre-send log failure rolls back before the receive fallback",()=>{
  const f=logFixture(true);
  assert(f.call("prepare_and_begin",{attachment_id:f.aid,capture_id:"owned-log",text:"true",runtime_ms:5000,completion_marker:"END",prefer_native_log:true}).ok);
  assert.equal(f.native.Logging,false);assert.equal(f.native.LogFileName,"original.log");assert.equal(f.files.size,0);
  assert.equal(f.state.sends.length,1);assert.equal(f.screens.A.Synchronous,true);
});
check("SecureCRT drains its completed log queue before switching to ReadString",()=>{
  const f=logFixture(),s=f.screens.A;let pumps=0;
  s.WaitForString=()=>{pumps++;};
  assert(f.call("prepare_and_begin",{attachment_id:f.aid,capture_id:"raw",text:"true",runtime_ms:5000,completion_marker:"END",prefer_native_log:true}).ok);
  assert(f.call("end",{capture_id:"raw",confirmed_complete:true,capture_log_reader:true}).ok);
  s.line="user$ typed";s.CurrentColumn=12;
  assert.equal(f.call("prepare_and_begin",{attachment_id:f.aid,capture_id:"unsafe",text:"never",runtime_ms:5000}).sent,false);
  assert.equal(pumps,0,"do not drain operator input");
  s.line="user$ ";s.CurrentColumn=7;
  assert(f.call("prepare_and_begin",{attachment_id:f.aid,capture_id:"lines",text:"true",runtime_ms:5000,completion_marker:"NEXT"}).ok);
  assert(pumps>=2&&pumps<=4,"bounded completion drain and stable-frame validation");assert.equal(f.state.sends.length,2);
  assert.equal(f.adapter.attachments[f.aid].completedWithLog,false);
});
check("SecureCRT: logger watchdog cleans its file and never stops a changed operator log",()=>{
  for(const changed of [false,true]) {
    const f=logFixture();
    assert(f.call("prepare_and_begin",{attachment_id:f.aid,capture_id:"owned-log",text:"true",runtime_ms:5000,completion_marker:"END",prefer_native_log:true}).ok);
    if(changed) f.native.LogFileName="new-operator.log";
    const end=f.call("end",{capture_id:"owned-log",confirmed_complete:false}).result;
    assert.equal(end.unresolved,true);assert.equal(f.screens.A.Synchronous,false);
    if(changed){assert.equal(f.native.Logging,true);assert.equal(f.native.LogFileName,"new-operator.log");assert.deepEqual(f.calls,[true]);}
    else {assert.equal(f.native.Logging,false);assert.equal(f.files.size,0);assert.equal(f.native.LogFileName,"original.log");}
  }
});
check("SecureCRT: millisecond scheduler pumps only an explicitly owned raw capture",()=>{
  const f=logFixture(),s=f.screens.A,waits=[];
  s.WaitForString=(sentinel,time,ignore,milliseconds)=>{assert.equal(milliseconds,true);waits.push(time);};
  f.adapter.yieldHost(10);assert.equal(waits.length,0,"idle polling must not consume incoming data");
  assert(f.call("prepare_and_begin",{attachment_id:f.aid,capture_id:"owned-log",text:"true",runtime_ms:5000,completion_marker:"END",prefer_native_log:true}).ok);
  f.adapter.yieldHost(15);assert.deepEqual(waits,[1]);
  f.adapter.yieldHost(1);assert.deepEqual(waits,[1,1]);
  f.call("end",{capture_id:"owned-log",confirmed_complete:false});
  f.adapter.yieldHost(10);assert.deepEqual(waits,[1,1]);
});
check("Xshell session logging preserves escaped paths, user logging and encoding",()=>{
  const f=fixture("xshell"),s=f.screens.A,session=f.host.Session,calls=[];
  let actual="C:\\existing\\user.log",utf8=true;
  Object.defineProperty(session,"LogFilePath",{get(){return actual.replace(/\\/g,"\\\\");},set(v){actual=String(v).replace(/\\\\/g,"\\");}});
  session.Logging=false;session.IsUtf8=()=>utf8;
  session.StartLog=()=>{calls.push("start");session.Logging=true;};
  session.StopLog=()=>{calls.push("stop");session.Logging=false;};
  f.adapter.captureFiles={create:()=>"C:\\private\\owned.capture.log",size:()=>128,remove:()=>calls.push("remove"),hasMarker:()=>true};
  const sid=f.call("list_sessions").result.sessions[0].id,aid=f.call("attach",{session:sid}).result.attachment_id;
  const begin=(id)=>f.call("prepare_and_begin",{attachment_id:aid,capture_id:id,text:"true",runtime_ms:5000,completion_marker:"END",prefer_native_log:true});
  assert(begin("owned").ok);assert.equal(s.Synchronous,false);assert.equal(session.Logging,true);
  s.lines[100]="user$ ";s.lines[101]="END 0";s.CurrentRow=102;s.line="user$ ";
  const poll=f.call("poll_bulk",{capture_id:"owned"}).result;
  assert.equal(poll.capture_transport,"native_session_log");assert.equal(poll.native_log_stopped,true);
  assert.equal(actual,"C:\\existing\\user.log");assert.equal(session.Logging,false);
  assert(f.call("end",{capture_id:"owned",confirmed_complete:true,capture_log_reader:true}).ok);
  assert.deepEqual(calls,["start","stop"]);
  utf8=false;assert(begin("encoding").ok);assert.equal(f.adapter.captures.encoding.logFile,undefined);
  f.call("end",{capture_id:"encoding",confirmed_complete:true});
  utf8=true;session.Logging=true;assert(begin("user-log").ok);assert.equal(f.adapter.captures["user-log"].logFile,undefined);
  f.call("end",{capture_id:"user-log",confirmed_complete:true});assert.equal(session.Logging,true);
  assert.deepEqual(calls,["start","stop"]);
  session.Logging=false;assert(begin("operator-change").ok);actual="C:\\operator\\new.log";
  const ended=f.call("end",{capture_id:"operator-change",confirmed_complete:false});
  assert.equal(ended.result.unresolved,true);assert.equal(session.Logging,true);assert.equal(actual,"C:\\operator\\new.log");
  assert.deepEqual(calls,["start","stop","start"]);
});
console.log(
  "PASS: " +
    passed +
    " native contract groups; mocks only, desktop acceptance remains required",
);
