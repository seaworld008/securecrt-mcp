#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  {
    ROOT,
    MCP,
    args,
    command,
    sleep,
    hash,
    readJSON,
    writeJSON,
    assert,
  } = require("./node_harness");
function selectedInstances(backend, explicit) {
  const targets = explicit.filter((target) => target.startsWith(backend + "="));
  if (!targets.length) return null;
  const instances = new Set(targets.map((target) => target.slice(backend.length + 1).split("/")[0]));
  assert([...instances].every((id) => /^[a-f0-9-]{36}$/i.test(id)), "explicit native target must contain its instance identity");
  return instances;
}
function scopedReports(reports, instances) {
  if (!instances) return reports;
  const selected = reports.filter((report) => instances.has(report.instance));
  assert.equal(new Set(selected.map((report) => report.instance)).size, instances.size, "selected native instance missing from runtime report");
  return selected;
}
async function runtimeProbe(binary, backend, explicit = []) {
  const home = process.env.SECURECRT_MCP_HOME || path.join(os.homedir(), ".securecrt-mcp"),
    config = readJSON(path.join(home, backend === "securecrt" ? "bridge.json" : "xshell_bridge.json")),
    selected = config.ipc_dir ? selectedInstances(backend, explicit) : null;
  if (!selected) return command(binary, ["doctor", "--backend", backend]);
  const reports = [];
  let code = 0;
  for (const instance of selected) {
    const probe = await command(binary, ["doctor", "--backend", backend, "--instance", instance]);
    const result = JSON.parse(probe.stdout);
    reports.push(...scopedReports(result.instances || [], new Set([instance])));
    if (probe.code !== 0) code = probe.code;
  }
  return {code, stdout: JSON.stringify({backend, instances: reports})};
}
async function identityPreflight(binary, backends, explicit = []) {
  const home =
      process.env.SECURECRT_MCP_HOME ||
      path.join(os.homedir(), ".securecrt-mcp"),
    identities = [];
  for (const backend of backends) {
    const config = readJSON(
      path.join(
        home,
        backend === "securecrt" ? "bridge.json" : "xshell_bridge.json",
      ),
    );
    const selected = config.ipc_dir ? selectedInstances(backend, explicit) : null;
    if (config.ipc_dir) {
      const expected = hash(path.join(ROOT, "bridge/windows_bridge.js")),
        instances = new Set();
      for (let pass = 0; pass < 3; pass++) {
        const directory = path.join(config.ipc_dir, "instances");
        if (fs.existsSync(directory))
          for (const name of fs.readdirSync(directory)) {
            if (selected && !selected.has(name)) continue;
            const dir = path.join(directory, name);
            try {
              if (
                Date.now() -
                  readJSON(path.join(dir, "ready.json")).last_poll_ms <
                5000
              )
                instances.add(dir);
            } catch {}
          }
        await sleep(30);
      }
      assert(instances.size, backend + ": no live native adapter");
      if (selected) assert.equal(instances.size, selected.size, "selected native instance is not online");
      for (const directory of instances) {
        const id = crypto.randomUUID(),
          tmp = path.join(directory, id + ".tmp"),
          reply = path.join(directory, id + ".response.json");
        writeJSON(tmp, {
          protocol_version: 2,
          id,
          client_id: "desktop-identity-preflight",
          token: config.token,
          deadline_ms: Date.now() + 5000,
          method: "ping",
          params: {},
        });
        fs.renameSync(tmp, path.join(directory, id + ".request.json"));
        const until = Date.now() + 6000;
        let value;
        while (Date.now() < until) {
          try {
            value = readJSON(reply);
            fs.unlinkSync(reply);
            break;
          } catch {
            await sleep(20);
          }
        }
        assert(value, backend + ": native identity ping did not respond");
        assert(
          value.id === id && value.ok,
          "native identity response mismatch",
        );
        const actual = value.result?.adapter_sha256;
        identities.push({
          backend,
          expected_sha256: expected,
          running_sha256: actual,
        });
        assert.equal(
          actual,
          expected,
          backend + ": running script differs; cancel and reload",
        );
      }
    }
    const probe = await runtimeProbe(binary, backend, explicit);
    if (probe.code !== 0) {
      let supports = [],
        validationFailed = true;
      try {
        if (backend === "securecrt" && !config.ipc_dir) {
          supports = probe.stdout
            .split(/\r?\n/)
            .filter((x) => x.startsWith("support="))
            .map((x) => JSON.parse(x.slice(8)));
          validationFailed = !probe.stderr.includes(
            "unsupported or incomplete runtime",
          );
        } else {
          const value = JSON.parse(probe.stdout);
          const reports = scopedReports(value.instances, selected);
          supports = reports.map((x) => x.support || {});
          validationFailed = reports.some(
            (x) => x.validation_error || !x.runtime,
          );
        }
      } catch {}
      const incomplete =
        supports.length &&
        supports.every(
          (r) =>
            r.tier === "tier_2" || (r.tier === "unknown" &&
            r.reasons?.length === 1 &&
            r.reasons[0] === "native_probe_incomplete_or_no_tab"),
        );
      assert(
        identities.some((x) => x.backend === backend) &&
          incomplete &&
          !validationFailed,
        backend + ": runtime identity/support gate failed before SSH",
      );
    }
    if (!config.ipc_dir) {
      const actual = probe.stdout.match(/"adapter_sha256"\s*:\s*"([a-f0-9]{64})"/),
        expected = hash(path.join(ROOT, "bridge/securecrt_bridge.py"));
      assert(actual, "TCP runtime report must contain its loaded adapter identity");
      assert.equal(actual[1], expected, "running TCP adapter differs from repository source");
      identities.push({backend, expected_sha256: expected, running_sha256: actual[1]});
    }
  }
  return identities;
}
async function discover(binary, backends, allIdle, explicit) {
  const client = await new MCP(binary).start(),
    targets = [],
    found = Object.fromEntries(backends.map((x) => [x, new Map()]));
  try {
    for (let i = 0; i < 3; i++) {
      const listed = await client.tool("connector_list");
      for (const b of backends)
        for (const item of listed[b] || [])
          if (item.connected) found[b].set(item.id, item);
      await sleep(30);
    }
    for (const b of backends)
      for (const id of found[b].keys()) {
        if (!allIdle && !explicit.includes(b + "=" + id)) continue;
        const label =
            b + "-tab-" + (1 + targets.filter((x) => x.backend === b).length),
          opened = await client.tool("connector_open", {
            backend: b,
            target: id,
            mode: "exec",
          });
        assert(opened.session_id, label + ": attachment rejected");
        try {
          const screen = await client.tool("connector_read_screen", {
            session_id: opened.session_id,
          });
          assert(
            /[#$%]$/.test(screen.current_line) && !screen.unresolved,
            label + ": requires verified idle shell",
          );
        } finally {
          await client.tool("connector_close", {
            session_id: opened.session_id,
          });
        }
        targets.push({ backend: b, target: id, label });
      }
    assert(targets.length, "No selected connected idle targets");
    assert(
      explicit.every((x) =>
        targets.some((t) => t.backend + "=" + t.target === x),
      ),
      "Some selected targets unavailable",
    );
    return targets;
  } finally {
    await client.close();
  }
}
async function isolation(
  binary,
  backend,
  targets,
  createClient = async () => new MCP(binary).start(),
  preferNativeLog = false,
) {
  const client = await createClient(),
    opened = [],
    jobs = [];
  const evidence = {
    expected_tabs: targets.length,
    sleep_seconds: 3,
    capture_budget_ms: 10000,
    submitted_count: 0,
    sent_count: 0,
    overlap_running_count: 0,
    overlap_states: [],
  };
  let phase = "open";
  try {
    assert(
      targets.length >= 2,
      "overlap requires at least two explicitly selected Tabs",
    );
    // Open every selected Tab before dispatching. Attachment preparation must not
    // consume the finite command overlap interval.
    for (const target of targets) {
      const value = await client.tool("connector_open", {
        backend,
        target: target.target,
        mode: "exec",
      });
      assert(value.session_id, "isolation attachment rejected");
      opened.push(value.session_id);
    }
    const markers = targets.map(
      (_, i) =>
        "MATRIX_ISOLATION_" + i + "_" + crypto.randomBytes(8).toString("hex"),
    );
    phase = "begin";
    const start = Date.now();
    const submissions = await Promise.all(
      opened.map((session_id, index) =>
        client
          .tool("connector_exec", {
            session_id,
            command: "sleep 3; printf '%s\\n' '" + markers[index] + "'",
            mode: "posix",
            wait_ms: 0,
            timeout_ms: 10000,
            prefer_native_log:preferNativeLog,
          })
          .then((value) => ({ value, index }))
          .catch((error) => ({ error, index })),
      ),
    );
    evidence.submit_wall_ms = Date.now() - start;
    for (const item of submissions) {
      if (item.value?.command_id) {
        jobs.push({ id: item.value.command_id, marker: markers[item.index] });
        evidence.submitted_count++;
      }
      if (item.value?.sent === true) evidence.sent_count++;
    }
    evidence.submission_states = submissions.map(
      (item) => item.value?.state || "dispatch_error",
    );
    assert(
      submissions.every((item) => !item.error && item.value?.command_id),
      "native dispatch did not return every tracked job",
    );
    assert(
      evidence.sent_count === targets.length,
      "not every native dispatch confirmed a send",
    );
    phase = "overlap";
    const sampleStart = Date.now();
    // Status requests are concurrent and inspect the retained Rust job registry.
    // A slow native scheduler must fail this gate if the first command has
    // already completed, rather than earning a sequential false PASS.
    const statuses = await Promise.all(
      jobs.map((job) =>
        client.tool("connector_get_status", { command_id: job.id }),
      ),
    );
    evidence.overlap_sample_wall_ms = Date.now() - sampleStart;
    evidence.overlap_observed_after_dispatch_ms = Date.now() - start;
    evidence.overlap_states = statuses.map((value) => value.state);
    evidence.overlap_running_count = statuses.filter((value) =>
      ["starting", "running"].includes(value.state),
    ).length;
    assert(
      evidence.overlap_running_count === targets.length,
      "not all selected Tabs were simultaneously starting/running after dispatch",
    );
    evidence.overlap_confirmed = true;
    for (const job of jobs) {
      phase = "status";
      const value = await client.done(job.id);
      assert(value.state === "completed" && value.exit_code === 0);
      phase = "read";
      const page = await client.tool("connector_read", {
          command_id: job.id,
          max_bytes: 65536,
        }),
        text = (page.output || page).text;
      assert(
        text.includes(job.marker) &&
          jobs.every((other) => other === job || !text.includes(other.marker)),
      );
    }
    return {
      backend,
      phase: "concurrent-tab-isolation",
      tabs: targets.length,
      passed: true,
      overlap_evidence: evidence,
    };
  } catch (error) {
    return {
      backend,
      phase: "concurrent-tab-isolation",
      tabs: targets.length,
      passed: false,
      failed_step: phase,
      error_type: error.name,
      overlap_evidence: evidence,
      automatic_retry: false,
    };
  } finally {
    for (const session_id of opened)
      try {
        await client.tool("connector_close", { session_id });
      } catch {}
    await client.close();
  }
}

async function run(a) {
  const start = Date.now(),
    binary = path.resolve(a._[0]),
    dir = path.resolve(a.output_dir || ".local-evidence/desktop-matrix"),
    backends = a.backend || ["securecrt", "xshell"],
    explicit = a.targets || [];
  fs.mkdirSync(dir, { recursive: true });
  assert(
    a.all_idle || explicit.length,
    "Use --all-idle or explicit --target backend=opaque-id",
  );
  const rev = await command("git", ["rev-parse", "HEAD"]),
    dirty = await command("git", [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]),
    revision = {
      commit: rev.code === 0 ? rev.stdout.trim() : null,
      working_tree_modified: dirty.code === 0 ? !!dirty.stdout.trim() : null,
    };
  const identities = await identityPreflight(binary, backends, a.all_idle ? [] : explicit);
  writeJSON(path.join(dir, "identity-preflight.json"), identities);
  console.log("PASS: native source identity before SSH probes");
  const targets = await discover(binary, backends, a.all_idle, explicit);
  console.log("Selected " + targets.length + " verified idle tabs");
  for (const b of ["securecrt", "xshell"])
    if (a["expect_" + b] !== undefined)
      assert.equal(
        targets.filter((t) => t.backend === b).length,
        Number(a["expect_" + b]),
        "tab coverage mismatch",
      );
  const results = [];
  let passing = targets;
  for (const phase of ["full-legacy", "minimal-modern"]) {
    const queue = [...passing],
      completed = [],
      workers = Array.from(
        { length: Math.min(Number(a.jobs || 4), 8, queue.length) },
        async () => {
          while (queue.length) {
            const t = queue.shift(),
              receipt = path.join(dir, t.label + "-" + phase + ".json"),
              cli =
                phase === "full-legacy"
                  ? [
                      path.join(ROOT, "tests/securecrt_desktop_smoke.js"),
                      binary,
                      "--backend",
                      t.backend,
                      "--session",
                      t.target,
                      "--protocol",
                      "legacy",
                      "--output",
                      receipt,
                      ...(a.exercise_recovery ? ["--exercise-recovery"] : []),
                      ...(a.prefer_native_log==="true"?["--prefer-native-log","true"]:[]),
                    ]
                  : [
                      path.join(ROOT, "tests/connector_acceptance.js"),
                      binary,
                      "--backend",
                      t.backend,
                      "--target",
                      t.target,
                      "--protocol",
                      "modern",
                      "--source-commit",
                      (revision.commit || "unpacked bundle") +
                        (revision.working_tree_modified
                          ? "; working-tree modified; see hashes"
                          : ""),
                      "--tested-on",
                      new Date().toISOString().slice(0, 10),
                      "--output",
                      receipt,
                      ...(a.prefer_native_log==="true"?["--prefer-native-log","true"]:[]),
                    ];
            const before = Date.now();
            let value,
              passed = false;
            try {
              const proc = await command(
                process.execPath,
                cli,
                process.env,
                150000,
              );
              value = fs.existsSync(receipt)
                ? readJSON(receipt)
                : { error_type: "MissingReceipt" };
              passed =
                proc.code === 0 &&
                (value.passed === true || value.status === "PASS");
            } catch {
              value = {
                error_type: "ControllerTimeout",
                requires_original_terminal_inspection: true,
              };
            }
            results.push({
              label: t.label,
              backend: t.backend,
              phase,
              passed,
              wall_ms: Date.now() - before,
              result: value,
            });
            if (passed) completed.push(t);
            console.log(
              (passed ? "PASS" : "FAIL") + ": " + t.label + " / " + phase,
            );
          }
        },
      );
    await Promise.all(workers);
    passing = completed;
  }
  for (const b of backends) {
    const selected = passing.filter((x) => x.backend === b);
    if (selected.length > 1) results.push(await isolation(binary, b, selected,undefined,a.prefer_native_log==="true"));
  }
  const runtime = {};
  for (const b of backends) {
    const probe = await runtimeProbe(binary, b, a.all_idle ? [] : explicit);
    const nativeIPC = probe.stdout.trimStart().startsWith("{");
    const selected = nativeIPC && !a.all_idle ? selectedInstances(b, explicit) : null;
    let passed = probe.code === 0;
    let selectedReports;
    if (selected) {
      try {
        selectedReports = scopedReports(JSON.parse(probe.stdout).instances, selected);
        passed = selectedReports.every((x) => x.runtime && !x.validation_error &&
          ["tier_1", "tier_2"].includes(x.support?.tier) &&
          x.runtime.adapter_sha256 === hash(path.join(ROOT,"bridge/windows_bridge.js")));
      } catch { passed = false; }
    }
    results.push({
      backend: b,
      phase: "runtime-and-source-identity",
      passed,
      scope: selected ? "explicit selected native instances" : nativeIPC ? "all online native instances" : "representative TCP bridge",
    });
    let native = [];
    try {
      if (b === "securecrt" && !nativeIPC) {
        const raw = probe.stdout
          .replaceAll("\r\n", "\n")
          .split("bridge: OK\n")[1];
        if (raw) {
          const begin = raw.indexOf("{");
          let end = raw.lastIndexOf("}");
          while (end > begin) {
            try {
              native = [JSON.parse(raw.slice(begin, end + 1))];
              break;
            } catch {
              end = raw.lastIndexOf("}", end - 1);
            }
          }
        }
      } else
        native = (selectedReports || JSON.parse(probe.stdout).instances).filter((x) => x.runtime)
          .map((x) => x.runtime);
    } catch {}
    runtime[b] = native.map((v) =>
      Object.fromEntries(
        [
          "script_engine",
          "python",
          "platform",
          "architecture",
          "os_version",
          "adapter_sha256",
          b + "_version",
        ].map((k) => [k, v[k]]),
      ),
    );
  }
  const sources = [
    "bridge/windows_bridge.js",
    "bridge/securecrt_bridge.py",
  ].filter((x) => fs.existsSync(path.join(ROOT, x)));
  const result = {
    scope: "real desktop / native SDK / SSH; UI startup separately checked",
    tested_on: new Date().toISOString().slice(0, 10),
    binary_sha256: hash(binary),
    code_revision: revision,
    source_sha256: Object.fromEntries(
      sources.map((x) => [x, hash(path.join(ROOT, x))]),
    ),
    tabs: Object.fromEntries(
      backends.map((b) => [b, targets.filter((t) => t.backend === b).length]),
    ),
    runtime,
    wall_seconds: (Date.now() - start) / 1000,
    explicit_recovery_probes: !!a.exercise_recovery,
    passed: results.every((x) => x.passed) && passing.length === targets.length,
    results,
  };
  writeJSON(path.join(dir, "matrix.json"), result);
  fs.writeFileSync(
    path.join(dir, "matrix.md"),
    "# Desktop acceptance\n\n" +
      (result.passed ? "PASS" : "FAIL") +
      "; " +
      targets.length +
      " tabs.\n\n| Target | Scenario | Result |\n| --- | --- | --- |\n" +
      results
        .map(
          (r) =>
            "| " +
            (r.label || r.backend) +
            " | " +
            r.phase +
            " | " +
            (r.passed ? "PASS" : "FAIL") +
            " |",
        )
        .join("\n") +
      "\n",
  );
  console.log(
    (result.passed ? "PASS" : "FAIL") +
      ": matrix; " +
      path.join(dir, "matrix.json"),
  );
  return result.passed ? 0 : 1;
}
if (require.main === module) {
  const a = args();
  run(a)
    .then((code) => (process.exitCode = code))
    .catch((e) => {
      const dir = path.resolve(
        a.output_dir || ".local-evidence/desktop-matrix",
      );
      fs.mkdirSync(dir, { recursive: true });
      writeJSON(path.join(dir, "matrix.json"), {
        passed: false,
        phase: "controller-or-preflight",
        error_type: e.name,
        requires_original_terminal_inspection: true,
        automatic_retry: false,
        reason:
          e.name === "AssertionError"
            ? e.message
            : "Inspect controller diagnostics; no automatic replay",
      });
      fs.writeFileSync(
        path.join(dir, "matrix.md"),
        "# Desktop acceptance\n\nFAIL: controller/preflight. Inspect original terminals before retrying.\n",
      );
      console.error("FAIL: controller/preflight; " + e.name);
      process.exitCode = 1;
    });
}
module.exports = { run, identityPreflight, discover, isolation, selectedInstances, scopedReports, runtimeProbe };
