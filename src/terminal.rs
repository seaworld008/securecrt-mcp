//! Public persistent-terminal contracts. Approval is for each tool invocation, never the attachment lifetime.
use crate::model::CaptureMode;
use rmcp::schemars::JsonSchema;
use serde::{Deserialize, Serialize};
fn shared() -> String {
    "shared".into()
}
#[derive(Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AttachParams {
    pub session: String,
    /// shared, exclusive (connector-cooperative, NOT a native keyboard lock), or observe.
    #[serde(default = "shared")]
    pub mode: String,
    pub expected_prompt: Option<String>,
}
#[derive(Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AttachmentParams {
    pub attachment_id: String,
}
#[derive(Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExecParams {
    pub attachment_id: String,
    pub command: String,
    /// Explicit terminal dialect. posix is only for an already confirmed POSIX shell.
    pub mode: CaptureMode,
    pub operation_id: Option<String>,
    pub timeout_ms: Option<u64>,
    pub wait_ms: Option<u64>,
    pub max_bytes: Option<usize>,
    pub wait_for: Option<String>,
}
#[derive(Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BatchParams {
    pub attachment_id: String,
    /// All commands are supplied up front in the client's approval context. Maximum 20.
    pub commands: Vec<String>,
    pub operation_id: Option<String>,
    /// stop (default) or continue on a confirmed nonzero exit. Uncertainty always stops.
    pub on_error: Option<String>,
    pub timeout_ms: Option<u64>,
}
#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BatchStatusParams {
    pub batch_id: String,
}
#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StreamReadParams {
    pub command_id: String,
    pub cursor: Option<usize>,
    pub max_bytes: Option<usize>,
    /// Wait for data or local terminal state, 0..60000ms. Never sends remote input.
    pub wait_ms: Option<u64>,
}
#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StreamWriteParams {
    pub command_id: String,
    /// Interactive raw input requires explicit local allow_raw_send. Client approval remains authoritative.
    pub text: String,
    pub append_enter: Option<bool>,
}
