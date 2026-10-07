//! Support diagnostics share the versioned policy used by the matrix documents.
use anyhow::{Context, Result};
use chrono::{NaiveDate, Utc};
use serde_json::{Value, json};
use tokio::{
    process::Command,
    time::{Duration, timeout},
};

const POLICY: &str = include_str!("../support/policy.json");

fn version(value: &str) -> Option<(u64, u64)> {
    let first = value.split_whitespace().next()?;
    let mut numbers = first.split('.');
    Some((
        numbers.next()?.parse().ok()?,
        numbers.next().unwrap_or("0").parse().ok()?,
    ))
}

fn floor(policy: &Value, name: &str) -> (u64, u64) {
    (
        policy[name][0].as_u64().expect("policy major"),
        policy[name][1].as_u64().expect("policy minor"),
    )
}

pub fn report(backend: &str, runtime: Option<&Value>) -> Value {
    let policy: Value = serde_json::from_str(POLICY).expect("compiled support policy");
    let required = policy["required_apis"][backend]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut detected = Vec::new();
    let mut missing = Vec::new();
    let mut unknown = Vec::new();
    for name in required {
        match runtime.and_then(|r| r["api_capabilities"][name.as_str().unwrap()].as_bool()) {
            Some(true) => detected.push(name),
            Some(false) => missing.push(name),
            None => unknown.push(name),
        }
    }
    let mut reasons = Vec::new();
    let mut unsupported = !missing.is_empty();
    if unsupported {
        reasons.push("required_native_api_missing");
    }
    if let Some(runtime) = runtime {
        let expected_script = if backend == "securecrt" {
            crate::BRIDGE_SCRIPT
        } else {
            crate::XSHELL_BRIDGE_SCRIPT
        };
        if runtime["adapter_sha256"]
            .as_str()
            .is_some_and(|hash| hash != crate::digest::sha256_hex(expected_script))
        {
            unsupported = true;
            reasons.push("running_adapter_differs_from_binary");
        }
        if let Some(python) = runtime["python"].as_str().and_then(version) {
            if python < floor(&policy, "python_floor") {
                unsupported = true;
                reasons.push("bridge_python_below_policy_floor");
            }
            if backend == "securecrt"
                && runtime["securecrt_version"]
                    .as_str()
                    .and_then(version)
                    .is_some_and(|v| v >= (9, 6))
                && python == (3, 8)
            {
                unsupported = true;
                reasons.push("securecrt_9_6_removed_python_3_8");
            }
        }
        let product = if backend == "securecrt" {
            "securecrt_version"
        } else {
            "xshell_version"
        };
        let minimum = floor(
            &policy,
            if backend == "securecrt" {
                "securecrt_floor"
            } else {
                "xshell_floor"
            },
        );
        if runtime[product]
            .as_str()
            .and_then(version)
            .is_some_and(|v| v < minimum)
        {
            unsupported = true;
            reasons.push("terminal_below_bridge_floor");
        }
    }
    let certified = runtime.is_some_and(|runtime| {
        policy["tier_1_certificates"]
            .as_array()
            .is_some_and(|certificates| {
                certificates.iter().any(|certificate| {
                    let today = Utc::now().date_naive();
                    let date = certificate["tested_on"]
                        .as_str()
                        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
                    certificate["backend"] == backend
                        && date.is_some_and(|date| {
                            date <= today
                                && today.signed_duration_since(date).num_days()
                                    <= policy["certificate_max_age_days"].as_i64().unwrap_or(90)
                        })
                        && [
                            "platform",
                            "os_version",
                            "architecture",
                            "python",
                            "adapter_sha256",
                            if backend == "securecrt" {
                                "securecrt_version"
                            } else {
                                "xshell_version"
                            },
                        ]
                        .iter()
                        .all(|key| {
                            !certificate[*key].is_null() && certificate[*key] == runtime[*key]
                        })
                })
            })
    });
    let tier = if unsupported {
        "unsupported"
    } else if runtime.is_none() || !unknown.is_empty() {
        "unknown"
    } else if certified {
        "tier_1"
    } else {
        "tier_2"
    };
    if tier == "tier_2" {
        reasons.push("no_exact_tier_1_runtime_certificate");
    }
    if !unknown.is_empty() {
        reasons.push("native_probe_incomplete_or_no_tab");
    }
    json!({"policy_version":policy["policy_version"], "review_date":policy["review_date"],
    "backend":backend,"tier":tier,"reasons":reasons,"detected_apis":detected,
    "missing_apis":missing,"unknown_apis":unknown,"probe_is_smoke_certification":false,
    "repair_guidance":[
        "Install a Python engine supported by this exact terminal version and architecture; macOS requires restarting the terminal after installation.",
        "Run upgrade without --force, cancel the old bridge only when idle, and start the installed script inside the terminal.",
        "For unknown tab APIs, open an explicitly verified test session and repeat doctor; run the opt-in matrix smoke before claiming Tier 1."
    ]})
}

pub async fn openssh_report() -> Result<Value> {
    let output = timeout(
        Duration::from_secs(5),
        Command::new("ssh").arg("-V").output(),
    )
    .await
    .context("ssh version probe timed out")??;
    let text = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let null_config = if cfg!(windows) { "NUL" } else { "/dev/null" };
    // Isolated config avoids evaluating operator Match exec clauses or connecting.
    let config = timeout(
        Duration::from_secs(5),
        Command::new("ssh")
            .args(["-G", "-T", "-F", null_config, "--", "support-probe.invalid"])
            .output(),
    )
    .await
    .context("ssh configuration probe timed out")??;
    let supported = output.status.success() && config.status.success();
    Ok(
        json!({"backend":"openssh","tier":if supported {"tier_2"} else {"unsupported"},
        "version":text,"local_cli_probe":supported,"remote_authentication_tested":false,
        "detected_capabilities":if supported {vec!["ssh_version","config_dump","explicit_config","disable_pty","option_terminator"]} else {vec![]},
        "missing_capabilities":if supported {vec![]} else {vec!["system_openssh_cli"]},
        "repair_guidance":["Install/enable the OS OpenSSH client and rerun doctor. Keep known_hosts validation enabled; a local CLI probe does not certify exec or PTY authentication."],
        "policy_version":"2026-10-07","review_date":"2026-11-07"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_api_is_unsupported_but_tabless_probe_is_unknown() {
        let policy: Value = serde_json::from_str(POLICY).unwrap();
        let mut apis = serde_json::Map::new();
        for name in policy["required_apis"]["securecrt"].as_array().unwrap() {
            apis.insert(name.as_str().unwrap().into(), json!(true));
        }
        let mut runtime = json!({"python":"3.11.17","securecrt_version":"9.5.2 (ARM64 build 3325)","api_capabilities":apis});
        assert_eq!(report("securecrt", Some(&runtime))["tier"], json!("tier_2"));
        runtime["api_capabilities"]["tab.Screen.Get2"] = json!(false);
        assert_eq!(
            report("securecrt", Some(&runtime))["tier"],
            json!("unsupported")
        );
        runtime["api_capabilities"]["tab.Screen.Get2"] = Value::Null;
        assert_eq!(
            report("securecrt", Some(&runtime))["tier"],
            json!("unknown")
        );
        assert_eq!(report("securecrt", None)["tier"], json!("unknown"));
    }
    #[test]
    fn securecrt_python_3_8_removal_is_platform_independent() {
        let runtime = json!({"python":"3.8.10","securecrt_version":"9.6.0"});
        assert_eq!(
            report("securecrt", Some(&runtime))["tier"],
            json!("unsupported")
        );
    }
}
