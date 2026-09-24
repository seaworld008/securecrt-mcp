use crate::execution::Engine;
use rmcp::{ErrorData as McpError, handler::server::wrapper::Parameters, tool, tool_router};
use serde_json::{Value, json};
use tokio::time::{Duration, timeout};

#[derive(Clone)]
pub struct SecureCrtServer {
    engine: Engine,
    xshell: Option<Engine>,
}
impl SecureCrtServer {
    pub fn new(engine: Engine, xshell: Option<Engine>) -> Self {
        Self { engine, xshell }
    }
}
fn result(value: anyhow::Result<Value>) -> Result<String, McpError> {
    value
        .and_then(|v| serde_json::to_string(&v).map_err(Into::into))
        .map_err(|e| McpError::invalid_params(e.to_string(), Some(crate::fault::details(&e))))
}

fn securecrt_capabilities() -> Value {
    json!([
        "exec",
        "batch",
        "screen_read",
        "interrupt",
        "acknowledge",
        "reuse_authenticated_session"
    ])
}

fn namespace_batch(mut value: Value, backend: &str) -> anyhow::Result<Value> {
    let id = value["batch_id"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("batch response omitted batch_id"))?;
    value["batch_id"] = json!(format!("{backend}/{id}"));
    Ok(value)
}

#[tool_router(server_handler)]
impl SecureCrtServer {
    #[tool(
        description = "List currently available sessions from every configured connector backend. IDs are opaque and backend-bound; capabilities describe which operations are valid for each session.",
        annotations(read_only_hint = true, destructive_hint = false)
    )]
    async fn connector_list(&self) -> Result<String, McpError> {
        let securecrt = match timeout(
            Duration::from_millis(250),
            self.engine.bridge.call("list_sessions", json!({})),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(anyhow::anyhow!("SecureCRT session probe timed out")),
        };
        let openssh = self.engine.connectors.list().await;
        result(
            async {
                let openssh = openssh?;
                let mut response = json!({
                    "securecrt": [],
                    "xshell": [],
                    "xshell_enumeration": "unavailable",
                    "openssh": openssh["sessions"].clone(),
                });
                match securecrt {
                    Ok(value) => {
                        response["securecrt"] = json!(value["sessions"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default()
                            .into_iter()
                            .map(|mut session| {
                                session["backend"] = json!("securecrt");
                                session["session_id"] = session["id"].clone();
                                session["capabilities"] = securecrt_capabilities();
                                session
                            })
                            .collect::<Vec<_>>());
                    }
                    Err(error) => response["securecrt_error"] = json!(error.to_string()),
                }
                if let Some(xshell) = &self.xshell {
                    match timeout(
                        // Xshell fans out to every live process. The calls are
                        // concurrent, but Windows file polling and a cold
                        // Xshell script can still need more than one second.
                        Duration::from_millis(3000),
                        xshell.bridge.call("list_sessions", json!({})),
                    )
                    .await
                    {
                        Ok(Ok(value)) => {
                            response["xshell"] = value["sessions"].clone();
                            response["xshell_enumeration"] = value["enumeration"].clone();
                            if value.get("discovery").is_some() {
                                response["xshell_discovery"] = value["discovery"].clone();
                            }
                            if let Some(sessions) = response["xshell"].as_array_mut() {
                                for session in sessions {
                                    session["backend"] = json!("xshell");
                                    session["capabilities"] = json!([
                                        "exec", "batch", "screen_read", "interrupt",
                                        "acknowledge", "reuse_authenticated_session",
                                        "named_session_discovery"
                                    ]);
                                }
                            }
                        }
                        Ok(Err(error)) => response["xshell_error"] = json!(error.to_string()),
                        Err(_) => response["xshell_error"] = json!("Xshell session probe timed out"),
                    }
                } else {
                    response["xshell_error"] = json!("Xshell bridge is not configured; run init and start xshell_bridge.py inside Xshell");
                }
                Ok(response)
            }
            .await,
        )
    }

    #[tool(
        description = "Open an explicit persistent OpenSSH command or PTY session, or bind an existing SecureCRT command session. Uses the user's ssh_config, Agent and known_hosts for OpenSSH; never stores credentials.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn connector_open(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorOpenParams>,
    ) -> Result<String, McpError> {
        if p.backend == crate::connector::ConnectorBackend::Xshell {
            let Some(xshell) = &self.xshell else {
                return result(Err(anyhow::anyhow!(
                    "Xshell bridge is not configured; run init and start xshell_bridge.py inside Xshell"
                )));
            };
            if p.mode != crate::connector::ConnectorMode::Exec {
                return result(Err(anyhow::anyhow!(
                    "Xshell backend exposes screen-backed exec only; native PTY is unavailable"
                )));
            }
            let value = xshell
                .attach(crate::terminal::AttachParams {
                    session: p.target,
                    mode: "shared".into(),
                    expected_prompt: None,
                })
                .await
                .map(|mut value| {
                    let attachment = value["attachment_id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned();
                    let instance = value["bridge_instance"].as_str().unwrap_or_default();
                    let attachment = if !instance.is_empty()
                        && !attachment.starts_with(&(instance.to_owned() + "/"))
                    {
                        format!("{instance}/{attachment}")
                    } else {
                        attachment
                    };
                    value["attachment_id"] = json!(attachment);
                    value["session_id"] = json!(format!("xshell/{attachment}"));
                    value["backend"] = json!("xshell");
                    value
                });
            return result(value);
        }
        if p.backend == crate::connector::ConnectorBackend::Securecrt {
            if p.mode != crate::connector::ConnectorMode::Exec {
                return result(Err(anyhow::anyhow!(
                    "SecureCRT backend supports connector exec mode only; use connector_stream_open for an OpenSSH PTY"
                )));
            }
            let value = self
                .engine
                .attach(crate::terminal::AttachParams {
                    session: p.target,
                    mode: "shared".into(),
                    expected_prompt: None,
                })
                .await
                .map(|mut value| {
                    let attachment = value["attachment_id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned();
                    value["session_id"] = json!(format!("securecrt/{attachment}"));
                    value["backend"] = json!("securecrt");
                    value
                });
            return result(value);
        }
        result(self.engine.connectors.open(p).await)
    }

    #[tool(
        description = "Execute one command on a persistent OpenSSH exec session. The SSH handshake is reused; output is bounded and cursor-paginated. Unknown outcomes are never replayed.",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false
        )
    )]
    async fn connector_exec(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorExecParams>,
    ) -> Result<String, McpError> {
        if let Some(attachment) = p.session_id.strip_prefix("xshell/") {
            let Some(xshell) = &self.xshell else {
                return result(Err(anyhow::anyhow!("Xshell bridge is unavailable")));
            };
            return result(
                xshell
                    .exec(crate::terminal::ExecParams {
                        attachment_id: attachment.to_owned(),
                        command: p.command,
                        mode: p.mode.unwrap_or_default(),
                        expected_prompt: p.expected_prompt,
                        operation_id: p.operation_id,
                        timeout_ms: p.timeout_ms,
                        wait_ms: p.wait_ms,
                        max_bytes: p.max_bytes,
                        wait_for: p.wait_for,
                    })
                    .await,
            );
        }
        if let Some(attachment) = p.session_id.strip_prefix("securecrt/") {
            return result(
                self.engine
                    .exec(crate::terminal::ExecParams {
                        attachment_id: attachment.to_owned(),
                        command: p.command,
                        mode: p.mode.unwrap_or_default(),
                        expected_prompt: p.expected_prompt,
                        operation_id: p.operation_id,
                        timeout_ms: p.timeout_ms,
                        wait_ms: p.wait_ms,
                        max_bytes: p.max_bytes,
                        wait_for: p.wait_for,
                    })
                    .await,
            );
        }
        result(self.engine.connectors.exec(p).await)
    }

    #[tool(
        description = "Execute a sequential batch on a persistent OpenSSH exec session. Commands stop at the first unknown or failed result.",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false
        )
    )]
    async fn connector_exec_batch(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorBatchParams>,
    ) -> Result<String, McpError> {
        if let Some(attachment) = p.session_id.strip_prefix("xshell/") {
            let Some(xshell) = &self.xshell else {
                return result(Err(anyhow::anyhow!("Xshell bridge is unavailable")));
            };
            return result(
                xshell
                    .exec_batch(crate::terminal::BatchParams {
                        attachment_id: attachment.to_owned(),
                        commands: p.commands,
                        operation_id: p.operation_id,
                        on_error: p.on_error,
                        timeout_ms: p.timeout_ms,
                    })
                    .await
                    .and_then(|value| namespace_batch(value, "xshell")),
            );
        }
        if let Some(attachment) = p.session_id.strip_prefix("securecrt/") {
            return result(
                self.engine
                    .exec_batch(crate::terminal::BatchParams {
                        attachment_id: attachment.to_owned(),
                        commands: p.commands,
                        operation_id: p.operation_id,
                        on_error: p.on_error,
                        timeout_ms: p.timeout_ms,
                    })
                    .await
                    .and_then(|value| namespace_batch(value, "securecrt")),
            );
        }
        result(
            self.engine
                .connectors
                .batch(p)
                .await
                .and_then(|value| namespace_batch(value, "openssh")),
        )
    }

    #[tool(
        description = "Read progress and results for a SecureCRT connector batch. This only reads the existing batch and never sends or retries commands.",
        annotations(read_only_hint = true, destructive_hint = false)
    )]
    async fn connector_get_batch_status(
        &self,
        Parameters(p): Parameters<crate::terminal::BatchStatusParams>,
    ) -> Result<String, McpError> {
        if let Some(id) = p.batch_id.strip_prefix("securecrt/") {
            return result(
                self.engine
                    .batch_status(id)
                    .await
                    .and_then(|value| namespace_batch(value, "securecrt")),
            );
        }
        if let Some(id) = p.batch_id.strip_prefix("xshell/") {
            return result(match &self.xshell {
                Some(xshell) => xshell
                    .batch_status(id)
                    .await
                    .and_then(|value| namespace_batch(value, "xshell")),
                None => Err(anyhow::anyhow!("Xshell bridge is unavailable")),
            });
        }
        if p.batch_id.starts_with("openssh/") {
            return result(Err(anyhow::anyhow!(
                "OpenSSH batches complete in connector_exec_batch; no separate status ledger is retained"
            )));
        }
        result(Err(anyhow::anyhow!(
            "batch_id must include its connector backend"
        )))
    }

    #[tool(
        description = "Read a connector command's bounded output by absolute cursor. Output is retained by command_id and this call never replays the command.",
        annotations(read_only_hint = true, destructive_hint = false)
    )]
    async fn connector_read(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorReadParams>,
    ) -> Result<String, McpError> {
        match self.engine.connectors.read(p.clone()).await {
            Ok(value) => result(Ok(value)),
            Err(_) => result(
                self.engine
                    .output(crate::model::OutputParams {
                        command_id: p.command_id,
                        cursor: p.cursor.and_then(|v| usize::try_from(v).ok()),
                        max_bytes: p.max_bytes,
                    })
                    .await,
            ),
        }
    }

    #[tool(
        description = "Read the current screen context for a screen-backed connector session. Returns the fresh token required for a later acknowledgement or guarded command.",
        annotations(read_only_hint = true, destructive_hint = false)
    )]
    async fn connector_read_screen(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorScreenParams>,
    ) -> Result<String, McpError> {
        if let Some(attachment) = p.session_id.strip_prefix("xshell/") {
            let Some(xshell) = &self.xshell else {
                return result(Err(anyhow::anyhow!("Xshell bridge is unavailable")));
            };
            return result(xshell.attachment_screen(attachment).await);
        }
        if let Some(attachment) = p.session_id.strip_prefix("securecrt/") {
            return result(self.engine.attachment_screen(attachment).await);
        }
        result(
            self.engine
                .bridge
                .call("read_screen", json!({"session": p.session_id}))
                .await,
        )
    }

    #[tool(
        description = "Get a connector session or command status. Provide exactly one session_id or command_id.",
        annotations(read_only_hint = true, destructive_hint = false)
    )]
    async fn connector_get_status(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorStatusParams>,
    ) -> Result<String, McpError> {
        if let Some(session_id) = p.session_id.as_deref() {
            if let Some(attachment) = session_id.strip_prefix("xshell/") {
                let Some(xshell) = &self.xshell else {
                    return result(Err(anyhow::anyhow!("Xshell bridge is unavailable")));
                };
                return result(xshell.attachment_status(attachment).await);
            }
            if let Some(attachment) = session_id.strip_prefix("securecrt/") {
                return result(self.engine.attachment_status(attachment).await);
            }
        }
        match self.engine.connectors.status_any(p.clone()).await {
            Ok(value) => result(Ok(value)),
            Err(_) => result(match p.command_id {
                Some(command_id) => self.engine.status(&command_id).await,
                None => Err(anyhow::anyhow!("SecureCRT status requires command_id")),
            }),
        }
    }

    #[tool(
        description = "Open a persistent OpenSSH PTY session for logs, REPLs, pagers and interactive programs. Screen-backed desktop connectors expose exec and screen capabilities instead of a native PTY.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn connector_stream_open(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorOpenParams>,
    ) -> Result<String, McpError> {
        if p.backend != crate::connector::ConnectorBackend::Openssh {
            return result(Err(anyhow::anyhow!(
                "connector_stream_open requires backend=openssh; this backend has no native PTY capability"
            )));
        }
        let mut p = p;
        p.mode = crate::connector::ConnectorMode::Pty;
        result(self.engine.connectors.open(p).await)
    }

    #[tool(
        description = "Read incremental OpenSSH PTY output by absolute cursor. Reports gaps when the bounded ring buffer overwrites old output.",
        annotations(read_only_hint = true, destructive_hint = false)
    )]
    async fn connector_stream_read(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorReadParams>,
    ) -> Result<String, McpError> {
        result(self.engine.connectors.stream_read(p).await)
    }

    #[tool(
        description = "Send explicit raw input to an OpenSSH PTY session. The client/model owns approval and password handling.",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false
        )
    )]
    async fn connector_stream_write(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorWriteParams>,
    ) -> Result<String, McpError> {
        result(self.engine.connectors.write(p).await)
    }

    #[tool(
        description = "Resize an OpenSSH PTY session.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn connector_resize(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorResizeParams>,
    ) -> Result<String, McpError> {
        result(self.engine.connectors.resize(p).await)
    }

    #[tool(
        description = "Send an explicit interrupt to a connector command or OpenSSH session. This does not prove remote termination.",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false
        )
    )]
    async fn connector_interrupt(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorInterruptParams>,
    ) -> Result<String, McpError> {
        match (p.session_id, p.command_id) {
            (Some(session_id), None) if session_id.starts_with("securecrt/") => result(Err(
                anyhow::anyhow!("SecureCRT interrupt requires command_id"),
            )),
            (Some(session_id), None) => result(
                self.engine
                    .connectors
                    .interrupt(crate::connector::ConnectorSessionParams { session_id })
                    .await,
            ),
            (None, Some(command_id)) => match self.engine.interrupt(&command_id).await {
                Ok(value) => result(Ok(value)),
                Err(error) => match &self.xshell {
                    Some(xshell) => result(xshell.interrupt(&command_id).await),
                    None => result(Err(error)),
                },
            },
            _ => result(Err(anyhow::anyhow!(
                "provide exactly one session_id or command_id"
            ))),
        }
    }

    #[tool(
        description = "Acknowledge that the operator inspected an unresolved connector session and confirmed its shell is idle. Screen-backed sessions require a fresh screen_token and exact expected_prompt. This does not prove remote termination.",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false
        )
    )]
    async fn connector_acknowledge(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorAcknowledgeParams>,
    ) -> Result<String, McpError> {
        if let Some(attachment) = p.session_id.strip_prefix("securecrt/") {
            let (Some(screen_token), Some(expected_prompt)) = (p.screen_token, p.expected_prompt)
            else {
                return result(Err(anyhow::anyhow!(
                    "SecureCRT acknowledgement requires screen_token and expected_prompt"
                )));
            };
            return result(
                self.engine
                    .attachment_acknowledge(attachment, screen_token, expected_prompt)
                    .await,
            );
        }
        if let Some(attachment) = p.session_id.strip_prefix("xshell/") {
            let (Some(screen_token), Some(expected_prompt)) = (p.screen_token, p.expected_prompt)
            else {
                return result(Err(anyhow::anyhow!(
                    "Xshell acknowledgement requires screen_token and expected_prompt"
                )));
            };
            let Some(xshell) = &self.xshell else {
                return result(Err(anyhow::anyhow!("Xshell bridge is unavailable")));
            };
            return result(
                xshell
                    .attachment_acknowledge(attachment, screen_token, expected_prompt)
                    .await,
            );
        }
        result(self.engine.connectors.acknowledge(p).await)
    }

    #[tool(
        description = "Renew a screen-backed connector lease or report a persistent connector session. No remote command is sent.",
        annotations(read_only_hint = true, destructive_hint = false)
    )]
    async fn connector_heartbeat(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorHeartbeatParams>,
    ) -> Result<String, McpError> {
        if let Some(attachment) = p.session_id.strip_prefix("securecrt/") {
            return result(self.engine.attachment_heartbeat(attachment).await);
        }
        if let Some(attachment) = p.session_id.strip_prefix("xshell/") {
            let Some(xshell) = &self.xshell else {
                return result(Err(anyhow::anyhow!("Xshell bridge is unavailable")));
            };
            return result(xshell.attachment_heartbeat(attachment).await);
        }
        result(
            self.engine
                .connectors
                .status(crate::connector::ConnectorSessionParams {
                    session_id: p.session_id,
                })
                .await,
        )
    }

    #[tool(
        description = "Close a connector session or release a screen-backed attachment. Remote termination is not claimed.",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false
        )
    )]
    async fn connector_close(
        &self,
        Parameters(p): Parameters<crate::connector::ConnectorSessionParams>,
    ) -> Result<String, McpError> {
        if let Some(attachment) = p.session_id.strip_prefix("securecrt/") {
            return result(self.engine.detach(attachment).await);
        }
        if let Some(attachment) = p.session_id.strip_prefix("xshell/") {
            let Some(xshell) = &self.xshell else {
                return result(Err(anyhow::anyhow!("Xshell bridge is unavailable")));
            };
            return result(xshell.detach(attachment).await);
        }
        result(self.engine.connectors.close(p).await)
    }

    #[tool(
        description = "Report connector session and command counts for the local process.",
        annotations(read_only_hint = true, destructive_hint = false)
    )]
    async fn connector_metrics(&self) -> Result<String, McpError> {
        result(self.engine.connectors.metrics().await)
    }
}
