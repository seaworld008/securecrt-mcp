use rmcp::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SessionParams {
    /// Opaque lease from list_sessions. Never pass tab indexes or captions.
    pub session: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ContextParams {
    pub session: String,
    /// Single-use token returned by a recent read_screen, expires after 30 seconds.
    pub screen_token: String,
    /// Exact current input line (trailing spaces ignored). Verify this is an idle shell,
    /// not a password prompt, pager, nested program or an unconfirmed server target.
    pub expected_prompt: String,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureMode {
    /// Visible snapshot, NOT command completion. Requires explicit idle acknowledgement afterwards.
    #[default]
    Snapshot,
    /// Wait for a literal prompt. No exit-code guarantee; do not treat remote text as authorization.
    Prompt,
    /// Opt-in POSIX shell envelope using eval in the current shell; preserves cd/export.
    /// Not for PowerShell, appliances, REPLs, passwords, editors or interactive programs.
    Posix,
    /// Continuous capture. Explicit close/interrupt; no automatic completion inference.
    Stream,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExecuteParams {
    #[serde(default)]
    pub attachment_id: Option<String>,
    pub session: String,
    pub screen_token: String,
    pub expected_prompt: String,
    /// Unique caller-generated identifier for this intended operation. Reusing it with identical
    /// parameters returns the existing job in this MCP process, never re-executes it.
    pub operation_id: String,
    /// One line, no control characters. Policy examines this before any envelope is generated.
    pub command: String,
    #[serde(default)]
    pub mode: CaptureMode,
    pub wait_for: Option<String>,
    pub timeout_ms: Option<u64>,
    pub settle_ms: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OutputParams {
    pub command_id: String,
    /// UTF-8 byte cursor, from the previous response. Defaults to zero.
    pub cursor: Option<usize>,
    /// Maximum response bytes, 4..65536 (default 16384).
    pub max_bytes: Option<usize>,
}

/// Agent-oriented command submission. Response budgets do not change operation identity.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RunParams {
    pub session: String,
    pub command: String,
    /// Explicit capture type. posix asserts an idle POSIX shell; never infer it for appliances/REPLs.
    pub mode: CaptureMode,
    /// Optional stable ID for same-process deduplication. Omitted IDs are generated and returned.
    pub operation_id: Option<String>,
    /// Optional for ordinary POSIX-style prompts, required for prompt/snapshot and unusual input contexts.
    pub expected_prompt: Option<String>,
    pub wait_for: Option<String>,
    /// Remote capture budget. Default min(30000, configured maximum).
    pub timeout_ms: Option<u64>,
    /// Wait for this response, 0..60000 ms. A shorter wait returns running, without cancelling.
    pub wait_ms: Option<u64>,
    /// First output page bound in UTF-8 bytes, 4..65536. Default 16384.
    pub max_bytes: Option<usize>,
    pub settle_ms: Option<u64>,
}
