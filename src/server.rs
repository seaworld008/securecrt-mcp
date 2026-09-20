use crate::{
    audit::AuditLog,
    bridge::BridgeClient,
    config::Config,
    model::{
        ExecuteCommandParams, InterruptParams, ReadScreenParams, SendTextParams, SessionParams,
    },
    policy::{Decision, PolicyEngine},
};
use rmcp::{ErrorData as McpError, handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{Value, json};

#[derive(Clone)]
pub struct SecureCrtServer {
    bridge: BridgeClient,
    policy: PolicyEngine,
    audit: AuditLog,
    config: Config,
}

impl SecureCrtServer {
    pub fn new(
        bridge: BridgeClient,
        policy: PolicyEngine,
        audit: AuditLog,
        config: Config,
    ) -> Self {
        Self {
            bridge,
            policy,
            audit,
            config,
        }
    }

    async fn bridge_json(&self, method: &str, params: Value) -> Result<String, McpError> {
        let result = self
            .bridge
            .call(method, params)
            .await
            .map_err(mcp_internal)?;
        serde_json::to_string_pretty(&result).map_err(mcp_internal)
    }
}

#[tool_router(server_handler)]
impl SecureCrtServer {
    #[tool(
        description = "Check whether the in-process SecureCRT Python bridge is running and reachable."
    )]
    async fn securecrt_bridge_status(&self) -> Result<String, McpError> {
        self.bridge_json("ping", json!({})).await
    }

    #[tool(
        description = "List tabs in the SecureCRT window that is running the bridge, including tab id, caption, connection state, and best-effort session metadata."
    )]
    async fn securecrt_list_sessions(&self) -> Result<String, McpError> {
        self.bridge_json("list_sessions", json!({})).await
    }

    #[tool(
        description = "Read the currently visible terminal text from an existing SecureCRT tab without sending anything to the remote host."
    )]
    async fn securecrt_read_screen(
        &self,
        Parameters(params): Parameters<ReadScreenParams>,
    ) -> Result<String, McpError> {
        self.bridge_json(
            "read_screen",
            json!({
                "session": params.session,
                "start_row": params.start_row,
                "end_row": params.end_row,
                "trim": params.trim.unwrap_or(true),
            }),
        )
        .await
    }

    #[tool(
        description = "Bring an existing SecureCRT tab to the foreground. This changes local UI focus only; it does not send a remote command."
    )]
    async fn securecrt_focus_session(
        &self,
        Parameters(params): Parameters<SessionParams>,
    ) -> Result<String, McpError> {
        self.bridge_json("focus_session", json!({"session": params.session}))
            .await
    }

    #[tool(
        description = "Execute one command in an existing SecureCRT tab. The local policy engine evaluates the command before any text is sent. In safe mode only read-oriented commands are allowed by default."
    )]
    async fn securecrt_execute_command(
        &self,
        Parameters(params): Parameters<ExecuteCommandParams>,
    ) -> Result<String, McpError> {
        let decision = self.policy.classify_command(&params.command);
        let allowed = decision.decision == Decision::Allow;
        let _ = self
            .audit
            .record(
                "execute_command",
                Some(&params.session),
                allowed,
                &decision.reason,
                Some(&params.command),
            )
            .await;

        if !allowed {
            return Err(McpError::invalid_params(
                format!(
                    "command blocked by securecrt-mcp policy: {}",
                    decision.reason
                ),
                None,
            ));
        }

        let timeout_ms = params
            .timeout_ms
            .unwrap_or(5_000)
            .clamp(100, self.config.bridge.max_command_timeout_ms);
        let settle_ms = params.settle_ms.unwrap_or(750).clamp(25, 10_000);

        self.bridge_json(
            "execute_command",
            json!({
                "session": params.session,
                "command": params.command,
                "wait_for": params.wait_for,
                "timeout_ms": timeout_ms,
                "settle_ms": settle_ms,
            }),
        )
        .await
    }

    #[tool(
        description = "Send raw text to a SecureCRT tab. Disabled by default because raw text can bypass command safety policy. Enable policy.allow_raw_send only when you intentionally want this capability."
    )]
    async fn securecrt_send_text(
        &self,
        Parameters(params): Parameters<SendTextParams>,
    ) -> Result<String, McpError> {
        let allowed = self.policy.raw_send_allowed();
        let reason = if allowed {
            "raw send enabled by local policy"
        } else {
            "raw send is disabled by local policy"
        };
        let _ = self
            .audit
            .record(
                "send_text",
                Some(&params.session),
                allowed,
                reason,
                Some(&params.text),
            )
            .await;
        if !allowed {
            return Err(McpError::invalid_params(reason, None));
        }

        self.bridge_json(
            "send_text",
            json!({
                "session": params.session,
                "text": params.text,
                "append_enter": params.append_enter.unwrap_or(false),
            }),
        )
        .await
    }

    #[tool(
        description = "Send Ctrl+C to an existing SecureCRT tab to interrupt a foreground command. Enabled by default in safe mode and can be disabled in local policy."
    )]
    async fn securecrt_interrupt(
        &self,
        Parameters(params): Parameters<InterruptParams>,
    ) -> Result<String, McpError> {
        let allowed = self.policy.interrupt_allowed();
        let reason = if allowed {
            "interrupt enabled by local policy"
        } else {
            "interrupt disabled by local policy"
        };
        let _ = self
            .audit
            .record("interrupt", Some(&params.session), allowed, reason, None)
            .await;
        if !allowed {
            return Err(McpError::invalid_params(reason, None));
        }

        self.bridge_json("interrupt", json!({"session": params.session}))
            .await
    }
}

fn mcp_internal(error: impl std::fmt::Display) -> McpError {
    McpError::internal_error(error.to_string(), None)
}
