//! Delivery evidence is tri-state. Only a trusted, explicit pre-send rejection proves false.
use serde_json::{Value, json};
use std::fmt;

#[derive(Debug)]
pub struct BridgeFault {
    pub message: String,
    pub sent: Option<bool>,
}
impl fmt::Display for BridgeFault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for BridgeFault {}

pub fn code(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("stale_screen") {
        "stale_screen"
    } else if lower.contains("stale_session") {
        "stale_session"
    } else if lower.contains("context_changed") {
        "context_changed"
    } else if lower.contains("input_context_required") || lower.contains("prompt_mismatch") {
        "input_context_required"
    } else if lower.contains("operation_id conflict") || lower.contains("operation_conflict") {
        "operation_conflict"
    } else if lower.contains("busy") || lower.contains("unresolved") {
        "busy_unresolved"
    } else if lower.contains("audit") {
        "audit_unavailable"
    } else if lower.contains("custom_deny_rule") {
        "custom_deny_rule"
    } else if lower.contains("builtin_guardrail") {
        "builtin_guardrail"
    } else if lower.contains("protocol") || lower.contains("upgrade") {
        "bridge_incompatible"
    } else if lower.contains("expired command")
        || lower.contains("output expired")
        || lower.contains("unknown command_id")
    {
        "command_not_found"
    } else if lower.contains("invalid")
        || lower.contains("requires")
        || lower.contains("must be")
        || lower.contains("limit")
    {
        "invalid_parameters"
    } else if lower.contains("not in the finite") || lower.contains("observe mode") {
        "policy_rejected"
    } else if lower.contains("stale") || lower.contains("expired") {
        "expired_request"
    } else {
        "bridge_error"
    }
}

pub fn action(error_code: &str) -> &'static str {
    match error_code {
        "stale_screen" => {
            "Read the screen again; inspect changes before a new intended request. No automatic retry occurred."
        }
        "stale_session" => {
            "List sessions again and explicitly select the intended target; never substitute a tab index."
        }
        "context_changed" => {
            "Inspect the original terminal and wait for the original idle prompt. A new intended request may revalidate the same attachment after redraw; changed prompts require explicit inspection/re-attachment. Never automatically replay or acknowledge unresolved work."
        }
        "input_context_required" => {
            "Inspect the original terminal. Confirm an idle shell and target, then supply expected_prompt for a nonstandard prompt. Do not type into password prompts or REPLs."
        }
        "busy_unresolved" => {
            "Inspect bridge_status and the current command. If running, wait or explicitly interrupt. Only after confirming idle may the operator acknowledge_idle. Never auto-acknowledge."
        }
        "operation_conflict" => {
            "Retrieve the original operation; use a different operation_id only for a genuinely new intended command."
        }
        "audit_unavailable" => {
            "Repair the configured audit path/permissions; a pre-dispatch audit failure sends nothing."
        }
        "custom_deny_rule" | "builtin_guardrail" | "policy_rejected" => {
            "Use policy-check to inspect the effective local policy. Command authorization may be delegated with mode=client by the operator, not by an agent silently rewriting policy."
        }
        "bridge_incompatible" => {
            "Run upgrade, stop the old SecureCRT script, start the installed adapter, and run doctor."
        }
        "command_not_found" => {
            "The job is not retained in this MCP process. Inspect the original terminal; absence is NOT evidence of non-execution."
        }
        "invalid_parameters" => {
            "Correct parameters using the tool schema; nothing is replayed automatically."
        }
        _ => {
            "Inspect the original terminal and bridge_status. A lost response does not prove non-execution; never automatically replay."
        }
    }
}

pub fn details(error: &anyhow::Error) -> Value {
    let message = format!("{error:#}");
    let sent = error
        .downcast_ref::<BridgeFault>()
        .map_or(Some(false), |e| e.sent);
    let error_code = code(&message);
    json!({"state": if sent == Some(false) { "rejected" } else { "unknown" },
        "sent": sent, "error_code": error_code, "message": message,
        "action": action(error_code), "automatic_retry": false,
        "remote_termination_confirmed": false,
        "requires_idle_ack": sent != Some(false)})
}
