use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeRequest {
    pub id: String,
    pub token: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeResponse {
    pub id: String,
    pub ok: bool,
    #[serde(default)]
    pub result: Value,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SessionParams {
    /// Session selector returned by securecrt_list_sessions, for example "tab:2".
    /// Exact tab captions are also accepted by the SecureCRT bridge.
    pub session: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadScreenParams {
    /// Session selector returned by securecrt_list_sessions.
    pub session: String,
    /// First visible terminal row to read (1-based). Defaults to 1.
    pub start_row: Option<u32>,
    /// Last visible terminal row to read (1-based). Defaults to the current screen row count.
    pub end_row: Option<u32>,
    /// Trim trailing whitespace and blank lines. Defaults to true.
    pub trim: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ExecuteCommandParams {
    /// Session selector returned by securecrt_list_sessions.
    pub session: String,
    /// Command to send to the existing SecureCRT session.
    pub command: String,
    /// Optional literal text to wait for. When supplied, SecureCRT ReadString is used.
    pub wait_for: Option<String>,
    /// Maximum wait time in milliseconds. Defaults to 5000 and is capped by configuration.
    pub timeout_ms: Option<u64>,
    /// When no wait_for is supplied, wait this long before taking a visible-screen snapshot.
    /// Defaults to 750 ms.
    pub settle_ms: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SendTextParams {
    /// Session selector returned by securecrt_list_sessions.
    pub session: String,
    /// Raw text to send. This tool is disabled by default because it bypasses command policy.
    pub text: String,
    /// Append Enter/CR after the text. Defaults to false.
    pub append_enter: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct InterruptParams {
    /// Session selector returned by securecrt_list_sessions.
    pub session: String,
}
